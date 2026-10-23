"""Bounded input admission for the explicit local-model offload profile.

No model imports, installs or network during module import. Cooperative file
checks do not establish native reparse/ACL race protection.
"""
from __future__ import annotations

from dataclasses import dataclass
import hashlib
import json
import math
import os
from pathlib import Path
import re
import stat
import time
from collections.abc import Mapping
import uuid

MODE = "offload-v1"
CAPABILITY = "dataset-preparation.offload-v1"
CPU_WEIGHT_LIMIT = 1024**3
CUDA_WEIGHT_LIMIT = 2 * 1024**3
STAGING_LIMIT = 12 * 1024**3
MAX_INPUT_TOKENS = 2048
MAX_NEW_TOKENS = 512
MAX_MODEL_BYTES = 20 * 1024**3
MAX_TENSORS = 50_000
MAX_SHARDS = 2048
MAX_HEADER_BYTES = 16 * 1024**2
MAX_CONFIG_BYTES = 1024**2
MAX_INSPECTION_SECONDS = 120
# Inspected native Qwen2.5 text-only template used by both pinned acquisitions.
# It loops over the two bounded system/user messages; arbitrary Jinja is outside
# this initial profile. This is a rendering-policy digest, not model provenance.
_SUPPORTED_CHAT_TEMPLATE = "cd8e9439f0570856fd70470bf8889ebd8b5d1107207f67a5efb46e342330527f"
_NAME = re.compile(r"[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*")
_SHARD = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,159}\.safetensors")
_DTYPE_BYTES = {"F32": 4, "F16": 2, "BF16": 2, "I64": 8, "I32": 4, "I16": 2, "I8": 1, "U8": 1, "BOOL": 1}


class OffloadAdmissionError(RuntimeError):
    def __init__(self):
        super().__init__("The selected model does not meet the low-memory input policy.")


def _regular(path: Path) -> os.stat_result:
    try:
        for item in (path, *path.parents):
            observed = item.lstat()
            if stat.S_ISLNK(observed.st_mode) or getattr(observed, "st_file_attributes", 0) & 0x400:
                raise OffloadAdmissionError()
        observed = path.lstat()
        if not stat.S_ISREG(observed.st_mode):
            raise OffloadAdmissionError()
        return observed
    except OSError:
        raise OffloadAdmissionError() from None


def _identity(value: os.stat_result) -> tuple[int, int, int, int]:
    return value.st_dev, value.st_ino, value.st_size, value.st_mtime_ns


def _bounded_bytes(path: Path, maximum: int) -> bytes:
    before = _regular(path)
    if not 0 < before.st_size <= maximum:
        raise OffloadAdmissionError()
    try:
        with path.open("rb") as stream:
            body = stream.read(maximum + 1)
            opened = os.fstat(stream.fileno())
        if len(body) != before.st_size or _identity(opened) != _identity(before) or _identity(_regular(path)) != _identity(before):
            raise OffloadAdmissionError()
        return body
    except OSError:
        raise OffloadAdmissionError() from None


def _json(body: bytes) -> dict:
    def nonfinite(_value):
        raise OffloadAdmissionError()

    def unique(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise OffloadAdmissionError()
            result[key] = value
        return result
    try:
        value = json.loads(body.decode("utf-8"), object_pairs_hook=unique, parse_constant=nonfinite)
        if not isinstance(value, dict):
            raise OffloadAdmissionError()
        return value
    except (ValueError, UnicodeError, RecursionError):
        raise OffloadAdmissionError() from None


def _hash(path: Path, deadline: float) -> str:
    before = _regular(path)
    if not 0 < before.st_size <= MAX_MODEL_BYTES:
        raise OffloadAdmissionError()
    digest = hashlib.sha256()
    count = 0
    try:
        with path.open("rb") as stream:
            if _identity(os.fstat(stream.fileno())) != _identity(before):
                raise OffloadAdmissionError()
            while block := stream.read(1024**2):
                count += len(block)
                if count > before.st_size or time.monotonic() > deadline:
                    raise OffloadAdmissionError()
                digest.update(block)
            opened = os.fstat(stream.fileno())
        if count != before.st_size or _identity(opened) != _identity(before) or _identity(_regular(path)) != _identity(before):
            raise OffloadAdmissionError()
        return digest.hexdigest()
    except OSError:
        raise OffloadAdmissionError() from None


@dataclass(frozen=True)
class TensorInventoryEntry:
    name: str
    shard: str
    dtype: str
    shape: tuple[int, ...]
    elements: int


@dataclass(frozen=True, repr=False)
class LocalModelInventory:
    root: Path
    _config_bytes: bytes
    tensors: tuple[TensorInventoryEntry, ...]
    bindings: tuple[tuple[str, int, str], ...]
    source_digest: str
    directory_names: tuple[str, ...]

    @property
    def config(self) -> dict:
        # Do not let a consumer change the admitted allocation policy by mutating
        # a dict retained inside an otherwise frozen inventory.
        return _json(self._config_bytes)

    def verify_unchanged(self) -> None:
        try:
            if tuple(sorted(item.name for item in self.root.iterdir())) != self.directory_names:
                raise OffloadAdmissionError()
        except OSError:
            raise OffloadAdmissionError() from None
        deadline = time.monotonic() + MAX_INSPECTION_SECONDS
        for name, size, digest in self.bindings:
            path = self.root / name
            if _regular(path).st_size != size or _hash(path, deadline) != digest:
                raise OffloadAdmissionError()


def _tensor_entries(path: Path, deadline: float) -> tuple[list[TensorInventoryEntry], str]:
    observed = _regular(path)
    if not 8 < observed.st_size <= MAX_MODEL_BYTES:
        raise OffloadAdmissionError()
    try:
        with path.open("rb") as stream:
            if _identity(os.fstat(stream.fileno())) != _identity(observed):
                raise OffloadAdmissionError()
            prefix = stream.read(8)
            header_length = int.from_bytes(prefix, "little")
            if not 0 < header_length <= min(MAX_HEADER_BYTES, observed.st_size - 8):
                raise OffloadAdmissionError()
            header_bytes = stream.read(header_length)
            header = _json(header_bytes)
            digest = hashlib.sha256(prefix + header_bytes)
            count = 8 + len(header_bytes)
            while block := stream.read(1024**2):
                count += len(block)
                if count > observed.st_size or time.monotonic() > deadline:
                    raise OffloadAdmissionError()
                digest.update(block)
            if count != observed.st_size or _identity(os.fstat(stream.fileno())) != _identity(observed):
                raise OffloadAdmissionError()
        if _identity(_regular(path)) != _identity(observed):
            raise OffloadAdmissionError()
    except OSError:
        raise OffloadAdmissionError() from None
    if not 1 <= len(header) <= MAX_TENSORS + 1:
        raise OffloadAdmissionError()
    payload_bytes = observed.st_size - 8 - header_length
    result, intervals = [], []
    for name, record in header.items():
        if name == "__metadata__":
            if not isinstance(record, dict) or any(not isinstance(key, str) or not isinstance(value, str) for key, value in record.items()):
                raise OffloadAdmissionError()
            continue
        if not isinstance(name, str) or len(name) > 512 or not _NAME.fullmatch(name) or not isinstance(record, dict) or set(record) != {"dtype", "shape", "data_offsets"}:
            raise OffloadAdmissionError()
        dtype, shape, offsets = record["dtype"], record["shape"], record["data_offsets"]
        if not isinstance(dtype, str) or dtype not in _DTYPE_BYTES or not isinstance(shape, list) or len(shape) > 8 or not isinstance(offsets, list) or len(offsets) != 2:
            raise OffloadAdmissionError()
        elements = 1
        for dimension in shape:
            if type(dimension) is not int or not 0 <= dimension <= 2**24:
                raise OffloadAdmissionError()
            elements *= dimension
            if elements > MAX_MODEL_BYTES // _DTYPE_BYTES[dtype]:
                raise OffloadAdmissionError()
        if any(type(value) is not int or not 0 <= value <= payload_bytes for value in offsets) or offsets[1] - offsets[0] != elements * _DTYPE_BYTES[dtype]:
            raise OffloadAdmissionError()
        intervals.append(tuple(offsets))
        result.append(TensorInventoryEntry(name, path.name, dtype, tuple(shape), elements))
    covered = 0
    for start, end in sorted(intervals):
        if start != covered:
            raise OffloadAdmissionError()
        covered = end
    if not result or covered != payload_bytes:
        raise OffloadAdmissionError()
    return result, digest.hexdigest()


def _validate_config(config: dict) -> None:
    # Inspect every field that can change native Qwen2 allocation before a meta
    # constructor runs. Unknown layouts/rotary extensions need separate support.
    allowed = {
        "model_type", "architectures", "hidden_size", "intermediate_size",
        "num_hidden_layers", "num_attention_heads", "num_key_value_heads",
        "vocab_size", "max_position_embeddings", "head_dim", "partial_rotary_factor",
        "rope_theta", "rope_scaling", "sliding_window", "use_sliding_window",
        "max_window_layers", "attention_dropout", "hidden_act", "initializer_range",
        "rms_norm_eps", "tie_word_embeddings", "use_cache", "torch_dtype",
        "transformers_version", "bos_token_id", "eos_token_id", "pad_token_id",
        "attention_bias", "mlp_bias", "_name_or_path",
    }
    if set(config).difference(allowed) or config.get("model_type") != "qwen2":
        raise OffloadAdmissionError()
    for key, maximum in (("hidden_size", 8192), ("intermediate_size", 65536), ("num_hidden_layers", 128), ("num_attention_heads", 128), ("num_key_value_heads", 128), ("vocab_size", 262144), ("max_position_embeddings", 131072)):
        value = config.get(key)
        if type(value) is not int or not 0 < value <= maximum:
            raise OffloadAdmissionError()
    if config["hidden_size"] % config["num_attention_heads"] or config["num_attention_heads"] % config["num_key_value_heads"]:
        raise OffloadAdmissionError()
    if config.get("head_dim", config["hidden_size"] // config["num_attention_heads"]) != config["hidden_size"] // config["num_attention_heads"]:
        raise OffloadAdmissionError()
    if type(config.get("head_dim", 1)) is not int or type(config.get("partial_rotary_factor", 1)) not in (int, float) or config.get("partial_rotary_factor", 1) != 1 or config.get("rope_scaling") is not None:
        raise OffloadAdmissionError()
    for key in ("tie_word_embeddings", "use_cache", "use_sliding_window", "attention_bias", "mlp_bias"):
        if key in config and type(config[key]) is not bool:
            raise OffloadAdmissionError()
    if config.get("use_sliding_window", False):
        raise OffloadAdmissionError()
    for key, maximum in (("sliding_window", 131072), ("max_window_layers", 128)):
        if key in config and config[key] is not None and (type(config[key]) is not int or not 0 <= config[key] <= maximum):
            raise OffloadAdmissionError()
    for key, minimum, maximum in (("rope_theta", 1, 10**8), ("attention_dropout", 0, 1), ("initializer_range", 0, 1), ("rms_norm_eps", 1e-12, 1)):
        if key in config and (type(config[key]) not in (int, float) or not minimum <= config[key] <= maximum or not math.isfinite(config[key])):
            raise OffloadAdmissionError()
    if config.get("hidden_act", "silu") != "silu" or config.get("architectures", ["Qwen2ForCausalLM"]) != ["Qwen2ForCausalLM"]:
        raise OffloadAdmissionError()
    for key in ("bos_token_id", "eos_token_id", "pad_token_id"):
        value = config.get(key)
        if value is None:
            continue
        values = value if key == "eos_token_id" and isinstance(value, list) else [value]
        if not 0 < len(values) <= 16 or any(type(item) is not int or not 0 <= item < config["vocab_size"] for item in values):
            raise OffloadAdmissionError()


def _validate_template(value) -> None:
    try:
        if value is not None and (not isinstance(value, str) or len(value) > 65536 or hashlib.sha256(value.encode("utf-8")).hexdigest() != _SUPPORTED_CHAT_TEMPLATE):
            raise OffloadAdmissionError()
    except UnicodeError:
        raise OffloadAdmissionError() from None


def _validate_tokenizer_settings(value: dict, config: dict) -> None:
    allowed = {"add_bos_token", "add_prefix_space", "added_tokens_decoder", "additional_special_tokens",
               "bos_token", "chat_template", "clean_up_tokenization_spaces", "eos_token", "errors",
               "model_max_length", "pad_token", "split_special_tokens", "tokenizer_class", "unk_token"}
    if set(value).difference(allowed) or value.get("tokenizer_class", "Qwen2Tokenizer") not in ("Qwen2Tokenizer", "Qwen2TokenizerFast"):
        raise OffloadAdmissionError()
    _validate_template(value.get("chat_template"))
    if "model_max_length" in value and (type(value["model_max_length"]) is not int or not 0 < value["model_max_length"] <= 131072):
        raise OffloadAdmissionError()
    for name in ("add_bos_token", "add_prefix_space", "clean_up_tokenization_spaces", "split_special_tokens"):
        if name in value and type(value[name]) is not bool:
            raise OffloadAdmissionError()
    if value.get("errors", "replace") not in ("replace", "strict"):
        raise OffloadAdmissionError()
    def token(item):
        if isinstance(item, str) and 0 < len(item) <= 1024:
            return
        if isinstance(item, dict) and set(item).issubset({"content", "lstrip", "rstrip", "normalized", "single_word", "special"}) and isinstance(item.get("content"), str) and 0 < len(item["content"]) <= 1024 and all(type(flag) is bool for key, flag in item.items() if key != "content"):
            return
        raise OffloadAdmissionError()
    for name in ("bos_token", "eos_token", "pad_token", "unk_token"):
        if value.get(name) is not None:
            token(value[name])
    additional = value.get("additional_special_tokens", [])
    decoder = value.get("added_tokens_decoder", {})
    if not isinstance(additional, list) or len(additional) > 4096 or not isinstance(decoder, dict) or len(decoder) > 4096:
        raise OffloadAdmissionError()
    for item in additional:
        token(item)
    for key, item in decoder.items():
        if not isinstance(key, str) or not re.fullmatch(r"[0-9]{1,6}", key) or int(key) >= config["vocab_size"]:
            raise OffloadAdmissionError()
        token(item)


def _validate_tokenizer_json(value: dict, config: dict) -> None:
    if set(value).difference({"version", "truncation", "padding", "added_tokens", "normalizer", "pre_tokenizer", "post_processor", "decoder", "model"}):
        raise OffloadAdmissionError()
    if value.get("truncation") is not None or value.get("padding") is not None:
        raise OffloadAdmissionError()
    model = value.get("model")
    if not isinstance(model, dict) or model.get("type") != "BPE" or set(model).difference({"type", "dropout", "unk_token", "continuing_subword_prefix", "end_of_word_suffix", "fuse_unk", "byte_fallback", "vocab", "merges"}):
        raise OffloadAdmissionError()
    if model.get("dropout") is not None or model.get("unk_token") is not None or model.get("continuing_subword_prefix", "") != "" or model.get("end_of_word_suffix", "") != "" or model.get("fuse_unk", False) is not False or model.get("byte_fallback", False) is not False:
        raise OffloadAdmissionError()
    vocab, merges = model.get("vocab"), model.get("merges")
    if not isinstance(vocab, dict) or not 0 < len(vocab) <= config["vocab_size"] or not isinstance(merges, list) or len(merges) > 2 * config["vocab_size"]:
        raise OffloadAdmissionError()
    if any(not isinstance(token, str) or not 0 < len(token) <= 4096 or type(index) is not int or not 0 <= index < config["vocab_size"] for token, index in vocab.items()) or len(set(vocab.values())) != len(vocab):
        raise OffloadAdmissionError()
    for merge in merges:
        if not (isinstance(merge, str) and len(merge) <= 8192 or isinstance(merge, list) and len(merge) == 2 and all(isinstance(part, str) and len(part) <= 4096 for part in merge)):
            raise OffloadAdmissionError()
    added = value.get("added_tokens", [])
    if not isinstance(added, list) or len(added) > 4096:
        raise OffloadAdmissionError()
    for token in added:
        if not isinstance(token, dict) or set(token).difference({"id", "content", "single_word", "lstrip", "rstrip", "normalized", "special"}) or type(token.get("id")) is not int or not 0 <= token["id"] < config["vocab_size"] or not isinstance(token.get("content"), str) or not 0 < len(token["content"]) <= 1024 or any(type(flag) is not bool for key, flag in token.items() if key not in {"id", "content"}):
            raise OffloadAdmissionError()
    # Restrict native transformations that can expand a small prompt before the
    # overflow-sentinel tokenizer bound. No template postprocessor or arbitrary
    # precompiled normalization program is admitted in this initial profile.
    if value.get("normalizer") not in (None, {"type": "NFC"}):
        raise OffloadAdmissionError()
    byte_level = {"type": "ByteLevel", "add_prefix_space": False, "trim_offsets": False, "use_regex": False}
    for key in ("post_processor", "decoder"):
        if value.get(key) not in (None, byte_level):
            raise OffloadAdmissionError()
    pre = value.get("pre_tokenizer")
    if pre is not None:
        if not isinstance(pre, dict) or set(pre) != {"type", "pretokenizers"} or pre["type"] != "Sequence" or not isinstance(pre["pretokenizers"], list) or len(pre["pretokenizers"]) > 4:
            raise OffloadAdmissionError()
        for part in pre["pretokenizers"]:
            if part == byte_level:
                continue
            if not isinstance(part, dict) or set(part) != {"type", "pattern", "behavior", "invert"} or part["type"] != "Split" or part["behavior"] != "Isolated" or part["invert"] is not False or not isinstance(part["pattern"], dict) or set(part["pattern"]) != {"Regex"} or not isinstance(part["pattern"]["Regex"], str) or len(part["pattern"]["Regex"]) > 8192:
                raise OffloadAdmissionError()


def inspect_local_model(root: Path) -> LocalModelInventory:
    """Admit a finite native Qwen2 safe-weight input before meta construction.

    Initial support covers native Qwen2/Qwen2.5 causal models. Other layouts
    remain explicit unsupported inputs rather than speculative model factories.
    """
    if not root.is_absolute() or ".." in root.parts:
        raise OffloadAdmissionError()
    config_path = root / "config.json"
    identities = {config_path: _identity(_regular(config_path))}
    config_bytes = _bounded_bytes(config_path, MAX_CONFIG_BYTES)
    config = _json(config_bytes)
    _validate_config(config)
    parsed_digests = {config_path.name: hashlib.sha256(config_bytes).hexdigest()}
    deadline = time.monotonic() + MAX_INSPECTION_SECONDS
    names = set()
    try:
        for index, item in enumerate(root.iterdir()):
            # Native from_pretrained still discovers PEFT metadata and can
            # redirect the base path before loading unbound adapter weights.
            # This profile admits no adapters, including case-insensitive names.
            if (index >= MAX_TENSORS
                    or item.name.casefold().startswith(("adapter_config", "adapter_model"))
                    or item.suffix.lower() in {".bin", ".pt", ".pth", ".pkl", ".pickle"}):
                raise OffloadAdmissionError()
            names.add(item.name)
    except OSError:
        raise OffloadAdmissionError() from None
    safe_names = {name for name in names if name.endswith(".safetensors")}
    weight_map = None
    inputs = [config_path]
    if "model.safetensors.index.json" in names:
        index_path = root / "model.safetensors.index.json"
        identities[index_path] = _identity(_regular(index_path))
        index_bytes = _bounded_bytes(index_path, MAX_HEADER_BYTES)
        weight_map = _json(index_bytes).get("weight_map")
        parsed_digests[index_path.name] = hashlib.sha256(index_bytes).hexdigest()
        if not isinstance(weight_map, dict) or not 0 < len(weight_map) <= MAX_TENSORS or any(not isinstance(name, str) or not isinstance(shard, str) or not _SHARD.fullmatch(shard) for name, shard in weight_map.items()):
            raise OffloadAdmissionError()
        if set(weight_map.values()) != safe_names:
            raise OffloadAdmissionError()
        inputs.append(index_path)
    elif safe_names != {"model.safetensors"}:
        raise OffloadAdmissionError()
    if not 0 < len(safe_names) <= MAX_SHARDS or any(not _SHARD.fullmatch(name) for name in safe_names):
        raise OffloadAdmissionError()
    entries = []
    tensor_names = set()
    for name in sorted(safe_names):
        path = root / name
        identities[path] = _identity(_regular(path))
        inputs.append(path)
        shard_entries, shard_digest = _tensor_entries(path, deadline)
        parsed_digests[path.name] = shard_digest
        for tensor in shard_entries:
            if tensor.name in tensor_names or (weight_map is not None and weight_map.get(tensor.name) != name):
                raise OffloadAdmissionError()
            tensor_names.add(tensor.name)
            entries.append(tensor)
            if len(entries) > MAX_TENSORS:
                raise OffloadAdmissionError()
    # Bind the native fast-tokenizer and generation inputs the supplier will read
    # from this folder, not just weights. Never retain their private contents.
    tokenizer_files = {"tokenizer.json", "tokenizer_config.json", "vocab.json", "merges.txt", "special_tokens_map.json", "added_tokens.json", "generation_config.json", "chat_template.jinja"}
    if not {"tokenizer.json", "tokenizer_config.json"}.issubset(names):
        raise OffloadAdmissionError()
    for name in sorted(tokenizer_files.intersection(names)):
        path = root / name
        identities[path] = _identity(_regular(path))
        data = _bounded_bytes(path, 32 * 1024**2 if name == "tokenizer.json" else 8 * 1024**2)
        if name.endswith(".json"):
            value = _json(data)
            if name == "tokenizer_config.json":
                _validate_tokenizer_settings(value, config)
            elif name == "tokenizer.json":
                _validate_tokenizer_json(value, config)
        elif name == "chat_template.jinja":
            try:
                _validate_template(data.decode("utf-8"))
            except UnicodeError:
                raise OffloadAdmissionError() from None
        parsed_digests[name] = hashlib.sha256(data).hexdigest()
        inputs.append(path)
    if weight_map is not None and tensor_names != set(weight_map):
        raise OffloadAdmissionError()
    if sum(_regular(path).st_size for path in inputs) > MAX_MODEL_BYTES:
        raise OffloadAdmissionError()
    bindings = tuple((path.name, _regular(path).st_size, _hash(path, deadline)) for path in inputs)
    if any(_identity(_regular(path)) != identities[path] for path in inputs) or any(digest != parsed_digests[name] for name, _size, digest in bindings):
        raise OffloadAdmissionError()
    digest = hashlib.sha256(json.dumps(bindings, separators=(",", ":")).encode()).hexdigest()
    return LocalModelInventory(root, config_bytes, tuple(entries), bindings, digest, tuple(sorted(names)))


@dataclass(frozen=True)
class OffloadResourcePlan:
    cpu_weight_bytes: int
    cuda_weight_bytes: int
    largest_layer_bytes: int
    cpu_required_bytes: int
    cuda_required_bytes: int
    staging_reservation_bytes: int
    kv_bytes: int
    prefill_scratch_bytes: int
    loading_transient_bytes: int
    conversion_transient_bytes: int


def validate_device_map(
    device_map: Mapping,
    tensor_bytes: Mapping[str, int],
    *,
    device: str,
    tied_groups: tuple[tuple[str, ...], ...],
    unsplit_groups: tuple[tuple[str, ...], ...],
    nonpersistent_buffer_modules: tuple[str, ...] = (),
) -> tuple[int, int]:
    """Validate exact parameter coverage and residency independently of inference."""
    if device not in {"cpu", "cuda"} or not isinstance(device_map, Mapping) or not device_map or not tensor_bytes:
        raise OffloadAdmissionError()
    destinations = {}
    allowed_devices = {"cpu", "disk"} if device == "cpu" else {"cpu", "disk", 0}
    for prefix, destination in device_map.items():
        if not isinstance(prefix, str) or (prefix and not _NAME.fullmatch(prefix)) or type(destination) not in (str, int) or destination not in allowed_devices:
            raise OffloadAdmissionError()
        if not any(not prefix or name == prefix or name.startswith(prefix + ".") for name in tensor_bytes) and prefix not in nonpersistent_buffer_modules:
            raise OffloadAdmissionError()
    for name, size in tensor_bytes.items():
        if type(size) is not int or not 0 < size <= MAX_MODEL_BYTES:
            raise OffloadAdmissionError()
        covering = [prefix for prefix in device_map if not prefix or name == prefix or name.startswith(prefix + ".")]
        if not covering:
            raise OffloadAdmissionError()
        destinations[name] = device_map[max(covering, key=len)]
    if set(destinations.values()) == {"disk"} or (device == "cuda" and 0 not in destinations.values()):
        raise OffloadAdmissionError()
    for group in (*tied_groups, *unsplit_groups):
        if not group or any(name not in destinations for name in group) or len({destinations[name] for name in group}) != 1:
            raise OffloadAdmissionError()
    if any(len({tensor_bytes[name] for name in group}) != 1 for group in tied_groups):
        raise OffloadAdmissionError()
    aliases = {name: group[0] for group in tied_groups for name in group}
    seen = set()
    cpu_bytes = cuda_bytes = 0
    for name, size in tensor_bytes.items():
        identity = aliases.get(name, name)
        if identity in seen:
            continue
        seen.add(identity)
        if destinations[name] == "cpu":
            cpu_bytes += size
        elif destinations[name] == 0:
            cuda_bytes += size
    if cpu_bytes > CPU_WEIGHT_LIMIT or cuda_bytes > CUDA_WEIGHT_LIMIT:
        raise OffloadAdmissionError()
    return cpu_bytes, cuda_bytes


def fit_cpu_residency(device_map: Mapping, tensor_bytes: Mapping[str, int], *,
                      maximum_bytes: int, tied_groups: tuple[tuple[str, ...], ...],
                      unsplit_groups: tuple[tuple[str, ...], ...]) -> dict:
    """Only move complete, connected CPU placements to disk; never change execution.

    The caller validates the supplier map first and independently validates the
    result. All aliases/no-split groups move together, including when a supplier
    represents one tied group through several map prefixes.
    """
    if type(maximum_bytes) is not int or not 0 <= maximum_bytes <= CPU_WEIGHT_LIMIT:
        raise OffloadAdmissionError()
    result = dict(device_map)
    owners = {}
    for name in tensor_bytes:
        covering = [key for key in result if not key or name == key or name.startswith(key + ".")]
        if not covering:
            raise OffloadAdmissionError()
        owners[name] = max(covering, key=len)
    components = {key: {key} for key in result if result[key] == "cpu"}
    for group in (*tied_groups, *unsplit_groups):
        keys = {owners[name] for name in group}
        if any(result[key] != "cpu" for key in keys):
            continue
        merged = set().union(*(components[key] for key in keys))
        for key in merged:
            components[key] = merged
    aliases = {name: group[0] for group in tied_groups for name in group}
    weights = {}
    seen = set()
    for name, size in tensor_bytes.items():
        alias = aliases.get(name, name)
        if alias in seen or result[owners[name]] != "cpu":
            continue
        seen.add(alias)
        component = tuple(sorted(components[owners[name]]))
        weights[component] = weights.get(component, 0) + size
    resident = sum(weights.values())
    for keys, size in sorted(weights.items(), key=lambda entry: (-entry[1], entry[0])):
        if resident <= maximum_bytes:
            break
        for key in keys:
            result[key] = "disk"
        resident -= size
    return result


def plan_resources(
    config: dict,
    *,
    dtype_bytes: int,
    device: str,
    cpu_weight_bytes: int,
    cuda_weight_bytes: int,
    largest_layer_bytes: int,
    largest_source_tensor_bytes: int,
    largest_target_tensor_bytes: int,
    largest_conversion_source_bytes: int,
    available_cpu_bytes: int,
    available_cuda_bytes: int,
    available_disk_bytes: int,
    staging_reservation_bytes: int,
) -> OffloadResourcePlan:
    """Finite conservative admission, not a whole-process allocation guarantee.

    The runtime reserve is additional to observed available RAM after imports.
    Prefill scratch allows three float32 attention matrices, bounded MLP/hidden
    workspaces, and logits. KV gets a second-copy/transient allowance. Actual
    process peaks and the 2048/512 boundary still need qualification.
    """
    _validate_config(config)
    if dtype_bytes not in (2, 4) or type(dtype_bytes) is not int or device not in {"cpu", "cuda"}:
        raise OffloadAdmissionError()
    values = (cpu_weight_bytes, cuda_weight_bytes, largest_layer_bytes, largest_source_tensor_bytes, largest_target_tensor_bytes, largest_conversion_source_bytes, available_cpu_bytes, available_cuda_bytes, available_disk_bytes, staging_reservation_bytes)
    if any(type(value) is not int or not 0 <= value <= 2**63 - 1 for value in values):
        raise OffloadAdmissionError()
    if cpu_weight_bytes > CPU_WEIGHT_LIMIT or cuda_weight_bytes > CUDA_WEIGHT_LIMIT or not 0 < staging_reservation_bytes <= STAGING_LIMIT or largest_layer_bytes <= 0 or not 0 < largest_source_tensor_bytes <= MAX_MODEL_BYTES or not 0 < largest_target_tensor_bytes <= largest_layer_bytes or largest_conversion_source_bytes > largest_source_tensor_bytes:
        raise OffloadAdmissionError()
    if device == "cpu" and cuda_weight_bytes:
        raise OffloadAdmissionError()
    kv = 2 * config["num_hidden_layers"] * (MAX_INPUT_TOKENS + MAX_NEW_TOKENS) * config["num_key_value_heads"] * (config["hidden_size"] // config["num_attention_heads"]) * dtype_bytes
    scratch = (3 * config["num_attention_heads"] * MAX_INPUT_TOKENS**2 * 4
               + 6 * MAX_INPUT_TOKENS * config["hidden_size"] * 4
               + 4 * MAX_INPUT_TOKENS * config["intermediate_size"] * 4
               + 2 * config["vocab_size"] * 4)
    execution_limit = CPU_WEIGHT_LIMIT if device == "cpu" else CUDA_WEIGHT_LIMIT
    if largest_layer_bytes > execution_limit:
        raise OffloadAdmissionError()
    # The pinned loader obtains the source-width safe tensor on CPU before
    # casting. Source and converted storage can coexist, even for CUDA targets.
    loading_transient = largest_source_tensor_bytes + largest_target_tensor_bytes
    cpu_required = cpu_weight_bytes + 1024**3 + loading_transient
    cuda_required = 0
    if device == "cpu":
        cpu_required = cpu_weight_bytes + 1024**3 + max(loading_transient, largest_layer_bytes + largest_conversion_source_bytes + 2 * kv + scratch)
    else:
        cuda_required = cuda_weight_bytes + largest_layer_bytes + largest_conversion_source_bytes + 2 * kv + scratch + 256 * 1024**2
    if available_cpu_bytes < cpu_required or available_cuda_bytes < cuda_required or available_disk_bytes < staging_reservation_bytes + 64 * 1024**2:
        raise OffloadAdmissionError()
    return OffloadResourcePlan(cpu_weight_bytes, cuda_weight_bytes, largest_layer_bytes, cpu_required, cuda_required, staging_reservation_bytes, kv, scratch, loading_transient, largest_conversion_source_bytes)


def _directory_identity(path: Path) -> tuple[int, int]:
    try:
        for item in (path, *path.parents):
            observed = item.lstat()
            if not stat.S_ISDIR(observed.st_mode) or stat.S_ISLNK(observed.st_mode) or getattr(observed, "st_file_attributes", 0) & 0x400:
                raise OffloadAdmissionError()
        observed = path.lstat()
        return observed.st_dev, observed.st_ino
    except OSError:
        raise OffloadAdmissionError() from None


class OwnedOffloadLease:
    """One exclusive offload-cache slot, with conservative uncertain cleanup.

    The native safe-weight route references original shards and writes at most
    its bounded index here. Never recursively delete, recover ambient leaves or
    delete originals. A stale/foreign active slot denies admission. Filesystem
    identity checks are cooperative, not an ACL/reparse race guarantee.
    """
    def __init__(self, cache_root: Path, reservation: int):
        if not cache_root.is_absolute() or ".." in cache_root.parts or type(reservation) is not int or not 0 < reservation <= STAGING_LIMIT:
            raise OffloadAdmissionError()
        _directory_identity(cache_root)
        self.root = cache_root / ".aisb-offload-v1"
        try:
            self.root.mkdir(mode=0o700, exist_ok=True)
            self._root_identity = _directory_identity(self.root)
            if list(self.root.iterdir()):
                raise OffloadAdmissionError()
            self.path = self.root / "active"
            self.path.mkdir(mode=0o700)
            self._identity = _directory_identity(self.path)
            self._owner = uuid.uuid4().hex.encode("ascii")
            with (self.path / "owner").open("xb") as stream:
                stream.write(self._owner)
        except OSError:
            raise OffloadAdmissionError() from None
        self.reservation = reservation
        self.released = False
        self._sealed = None
        self._removed: set[str] = set()

    def _check_identity(self) -> None:
        if self.released or _directory_identity(self.root) != self._root_identity or _directory_identity(self.path) != self._identity:
            raise OffloadAdmissionError()
        if "owner" not in self._removed and _bounded_bytes(self.path / "owner", 32) != self._owner:
            raise OffloadAdmissionError()

    def seal(self) -> None:
        self._check_identity()
        if self._sealed is not None:
            self._verify_sealed()
            return
        try:
            names = {item.name for item in self.path.iterdir()}
            if not names.issubset({"owner", "index.json"}) or "owner" not in names:
                raise OffloadAdmissionError()
            if sum(_regular(self.path / name).st_size for name in names) > self.reservation:
                raise OffloadAdmissionError()
            deadline = time.monotonic() + MAX_INSPECTION_SECONDS
            self._sealed = tuple((name, _identity(_regular(self.path / name)), _hash(self.path / name, deadline)) for name in sorted(names))
        except OSError:
            raise OffloadAdmissionError() from None

    def _verify_sealed(self) -> None:
        if {item.name for item in self.path.iterdir()} != {name for name, _identity_value, _digest in self._sealed}.difference(self._removed):
            raise OffloadAdmissionError()
        deadline = time.monotonic() + MAX_INSPECTION_SECONDS
        for name, identity, digest in self._sealed:
            if name in self._removed:
                continue
            if _identity(_regular(self.path / name)) != identity or _hash(self.path / name, deadline) != digest:
                raise OffloadAdmissionError()

    def cleanup(self, *, model_released: bool) -> None:
        if self.released:
            return
        self._check_identity()
        if model_released is not True or self._sealed is None:
            raise OffloadAdmissionError()
        try:
            self._verify_sealed()
            # All contents were checked before the first removal. The only
            # removal targets are files in this exact exclusively created leaf.
            for name, _identity_value, _digest in self._sealed:
                self._check_identity()
                self._verify_sealed()
                if name != "owner" and name not in self._removed:
                    (self.path / name).unlink()
                    self._removed.add(name)
            self._check_identity()
            self._verify_sealed()
            if "owner" not in self._removed:
                (self.path / "owner").unlink()
                self._removed.add("owner")
            self.path.rmdir()
            self.released = True
        except OSError:
            # Retain the slot/reservation after failed or uncertain cleanup.
            raise OffloadAdmissionError() from None
