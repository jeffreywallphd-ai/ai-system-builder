"""Admission for a fixed approved model or a separate tiny generated input.

No interpreter/model selector, download, installation, inference or accuracy run.
The owning trusted Node composition separately checks production dependencies.
"""
from __future__ import annotations
import ast
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import sys

ROOT = Path(__file__).resolve().parents[4]
PYTHON_RELATIVE = "artifacts/tmp/lancedb-python312-ai-runtime/Scripts/python.exe"
SOURCE_RELATIVE = "dev-tools/scripts/qualification/run_installed_generation_qualification.py"
MAXIMUM_WEIGHTS = 1024 ** 3
TINY_PROFILE = "generated-tiny-qwen2-v1"
TINY_MODEL_ID = "aisb-testing/tiny-qwen2-v1"
TINY_DISPLAY_NAME = "Generated tiny training input"
TINY_FILES = ("config.json", "generation_config.json", "model.safetensors",
              "special_tokens_map.json", "tokenizer.json", "tokenizer_config.json")
TINY_CONFIGURATION = {"vocab_size": 64, "hidden_size": 16, "intermediate_size": 32,
                      "num_hidden_layers": 1, "num_attention_heads": 2,
                      "num_key_value_heads": 2, "max_position_embeddings": 128,
                      "bos_token_id": 1, "eos_token_id": 2, "pad_token_id": 0,
                      "tie_word_embeddings": False}


def deny():
    raise ValueError("The fixed training prerequisites are unavailable.")


def regular(root, relative, maximum):
    if not isinstance(relative, str) or len(relative) > 512 or "\\" in relative or any(p in ("", ".", "..") for p in relative.split("/")):
        deny()
    target = root.joinpath(*relative.split("/"))
    if not target.is_relative_to(root) or target.resolve() != target:
        deny()
    for current in [root, *[root.joinpath(*target.relative_to(root).parts[:i]) for i in range(1, len(target.relative_to(root).parts) + 1)]]:
        info = current.lstat()
        if stat.S_ISLNK(info.st_mode) or getattr(info, "st_file_attributes", 0) & 0x400:
            deny()
    info = target.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or not 0 < info.st_size <= maximum:
        deny()
    return target, info


def digest_regular(root, relative, maximum):
    target, before = regular(root, relative, maximum)
    digest = hashlib.sha256()
    total = 0
    with target.open("rb") as stream:
        opened = os.fstat(stream.fileno())
        if (opened.st_dev, opened.st_ino, opened.st_size) != (before.st_dev, before.st_ino, before.st_size):
            deny()
        while chunk := stream.read(64 * 1024):
            total += len(chunk)
            if total > maximum:
                deny()
            digest.update(chunk)
        after = os.fstat(stream.fileno())
    _, current = regular(root, relative, maximum)
    identity = lambda value: (value.st_dev, value.st_ino, value.st_size, value.st_mtime_ns)
    if total != before.st_size or identity(before) != identity(after) or identity(before) != identity(current):
        deny()
    return digest.hexdigest(), total


def fixed_model(root):
    """Read only three literal constants; never import the accuracy runner."""
    source, _ = regular(root, SOURCE_RELATIVE, 256 * 1024)
    tree = ast.parse(source.read_text(encoding="utf-8"))
    result = {}
    for node in tree.body:
        if isinstance(node, ast.Assign) and len(node.targets) == 1 and isinstance(node.targets[0], ast.Name) and node.targets[0].id in ("MODEL", "REVISION", "MODEL_FILES"):
            name = node.targets[0].id
            if name in result:
                deny()
            result[name] = ast.literal_eval(node.value)
    if (result.get("MODEL"), result.get("REVISION")) != ("Qwen/Qwen2.5-0.5B-Instruct", "7ae557604adf67be50417f59c2c2f167def9a775"):
        deny()
    files = result.get("MODEL_FILES")
    if not isinstance(files, dict) or len(files) != 8 or "model.safetensors" not in files or any(not isinstance(k, str) or not re.fullmatch(r"[A-Za-z0-9_.-]{1,64}", k) or not isinstance(v, str) or not re.fullmatch(r"[a-f0-9]{64}", v) for k, v in files.items()):
        deny()
    return result


def verify_model(root, acquisition):
    if not isinstance(acquisition, str) or not re.fullmatch(r"\.local-codex/model-qualification/qwen-[a-f0-9-]{36}/acquisition\.json", acquisition):
        deny()
    fixed = fixed_model(root)
    manifest, _ = regular(root, acquisition, 64 * 1024)
    data = json.loads(manifest.read_text(encoding="utf-8"))
    if not isinstance(data, dict) or (data.get("model"), data.get("revision"), data.get("status")) != (fixed["MODEL"], fixed["REVISION"], "verified"):
        deny()
    entries = data.get("files")
    if not isinstance(entries, list) or len(entries) != 8 or any(not isinstance(row, dict) or not isinstance(row.get("name"), str) or not isinstance(row.get("sha256"), str) for row in entries):
        deny()
    if {row.get("name"): row.get("sha256") for row in entries} != fixed["MODEL_FILES"]:
        deny()
    names = []
    with os.scandir(manifest.parent) as entries:
        for entry in entries:
            if len(names) == 9:
                deny()
            names.append(entry.name)
    if set(names) != set(fixed["MODEL_FILES"]) | {"acquisition.json"}:
        deny()
    total = 0
    for name, expected in fixed["MODEL_FILES"].items():
        relative = (manifest.parent / name).relative_to(root).as_posix()
        digest, size = digest_regular(root, relative, MAXIMUM_WEIGHTS if name == "model.safetensors" else 16 * 1024 ** 2)
        if digest != expected:
            deny()
        total += size
    if total > MAXIMUM_WEIGHTS + 64 * 1024 ** 2:
        deny()
    return {"modelId": fixed["MODEL"], "revision": fixed["REVISION"], "modelRelativeDirectory": manifest.parent.relative_to(root).as_posix(), "modelFiles": 8, "modelBytes": total}


def tiny_acquisition(value):
    return isinstance(value, str) and re.fullmatch(
        r"\.local-codex/training-inputs/tiny-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/input\.json", value) is not None


def strict_json(raw):
    def unique(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                deny()
            result[key] = value
        return result
    return json.loads(raw, object_pairs_hook=unique, parse_constant=lambda _: deny())


def inspect_tiny(root, acquisition, expected_hash):
    """Inspect only the exact newly declared input; never import a model library.

    The later owning effect plan supplies the manifest hash. This is ordinary
    stable-file admission, not a hostile-filesystem or native ownership proof.
    """
    if not tiny_acquisition(acquisition) or not isinstance(expected_hash, str) or not re.fullmatch(r"[a-f0-9]{64}", expected_hash):
        deny()
    manifest, _ = regular(root, acquisition, 8192)
    actual_hash, _ = digest_regular(root, acquisition, 8192)
    if actual_hash != expected_hash:
        deny()
    value = strict_json(manifest.read_bytes())
    if (not isinstance(value, dict) or set(value) != {"schemaVersion", "inputProfile", "modelId", "provider", "displayName", "seed", "configuration", "generatorSha256", "files"} or
            value["schemaVersion"] != "tiny-training-input-v1" or value["inputProfile"] != TINY_PROFILE or
            value["modelId"] != TINY_MODEL_ID or value["provider"] != "unknown" or value["displayName"] != TINY_DISPLAY_NAME or
            type(value["seed"]) is not int or value["seed"] != 13 or value["configuration"] != TINY_CONFIGURATION or
            any(type(value["configuration"][key]) is not type(item) for key, item in TINY_CONFIGURATION.items())):
        deny()
    generator = Path(__file__).resolve().relative_to(ROOT).as_posix()
    if value["generatorSha256"] != digest_regular(root, generator, 64 * 1024)[0]:
        deny()
    rows = value["files"]
    if not isinstance(rows, dict) or set(rows) != set(TINY_FILES):
        deny()
    names = []
    with os.scandir(manifest.parent) as entries:
        for entry in entries:
            if len(names) == 7:
                deny()
            names.append(entry.name)
    if set(names) != set(TINY_FILES) | {"input.json"}:
        deny()
    total = 0
    for name in TINY_FILES:
        row = rows[name]
        if (not isinstance(row, dict) or set(row) != {"sha256", "bytes"} or
                not isinstance(row["sha256"], str) or not re.fullmatch(r"[a-f0-9]{64}", row["sha256"]) or
                type(row["bytes"]) is not int):
            deny()
        maximum = 512 * 1024 if name == "model.safetensors" else 64 * 1024
        actual, size = digest_regular(root, (manifest.parent / name).relative_to(root).as_posix(), maximum)
        if (actual, size) != (row["sha256"], row["bytes"]):
            deny()
        total += size
    if total > 1024 * 1024:
        deny()
    config = strict_json((manifest.parent / "config.json").read_bytes())
    tokenizer = strict_json((manifest.parent / "tokenizer_config.json").read_bytes())
    if (not isinstance(config, dict) or any(config.get(key) != item or type(config.get(key)) is not type(item) for key, item in TINY_CONFIGURATION.items()) or
            config.get("model_type") != "qwen2" or config.get("architectures") != ["Qwen2ForCausalLM"] or
            "auto_map" in config or not isinstance(tokenizer, dict) or "auto_map" in tokenizer or
            tokenizer.get("tokenizer_class") != "PreTrainedTokenizerFast"):
        deny()
    # Recheck the manifest after all reads; its expected hash is never inferred
    # from an untrusted file encountered during inspection.
    if digest_regular(root, acquisition, 8192)[0] != expected_hash:
        deny()
    return {"modelId": TINY_MODEL_ID, "provider": "unknown", "displayName": TINY_DISPLAY_NAME,
            "inputProfile": TINY_PROFILE, "modelRelativeDirectory": manifest.parent.relative_to(root).as_posix(),
            "modelFiles": 6, "modelBytes": total, "manifestSha256": expected_hash}


def _generate_tiny(directory):
    # The only heavy imports in this file. Inspection and ordinary tests never
    # reach this effect; its real invocation needs a separate owned-run plan.
    import torch
    from tokenizers import Tokenizer, models, pre_tokenizers
    from transformers import PreTrainedTokenizerFast, Qwen2Config, Qwen2ForCausalLM
    torch.set_num_threads(1)
    torch.manual_seed(13)
    model = Qwen2ForCausalLM(Qwen2Config(**TINY_CONFIGURATION))
    model.save_pretrained(directory, safe_serialization=True)
    vocabulary = {"[PAD]": 0, "[BOS]": 1, "[EOS]": 2, "[UNK]": 3}
    for index in range(4, 64):
        vocabulary[f"token{index}"] = index
    backend = Tokenizer(models.WordLevel(vocabulary, unk_token="[UNK]"))
    backend.pre_tokenizer = pre_tokenizers.Whitespace()
    tokenizer = PreTrainedTokenizerFast(tokenizer_object=backend, pad_token="[PAD]", bos_token="[BOS]", eos_token="[EOS]", unk_token="[UNK]", model_max_length=128)
    tokenizer.save_pretrained(directory)


def create_tiny(root, acquisition):
    """Create only fresh input bytes, never a trained model, task or result."""
    if (not tiny_acquisition(acquisition) or any(os.getenv(key) != "1" for key in
            ("HF_HUB_OFFLINE", "TRANSFORMERS_OFFLINE", "HF_DATASETS_OFFLINE", "PIP_NO_INDEX")) or
            os.getenv("PYTHON_RUNTIME_QUALIFICATION_SCENARIO") != "training-model-host"):
        deny()
    directory = root.joinpath(*acquisition.split("/")).parent
    # Check only known ancestors. Never scan, adopt, overwrite or clean an old
    # slot, including a directory left by an interrupted generation attempt.
    for current in (root, root / ".local-codex", root / ".local-codex/training-inputs"):
        if not current.exists() and current != root:
            current.mkdir()
        info = current.lstat()
        if not stat.S_ISDIR(info.st_mode) or current.is_symlink() or getattr(info, "st_file_attributes", 0) & 0x400 or current.resolve() != current:
            deny()
    directory.mkdir(exist_ok=False)
    _generate_tiny(directory)

    def normalize_new_tokenizer():
        # This closure is reached only after this invocation exclusively created
        # the slot. Never normalize an existing acquisition or relax inspection.
        relative = (directory / "tokenizer_config.json").relative_to(root).as_posix()
        target, before = regular(root, relative, 64 * 1024)
        identity = lambda value: (value.st_dev, value.st_ino, value.st_size, value.st_mtime_ns, value.st_nlink)
        with target.open("rb") as stream:
            opened = os.fstat(stream.fileno())
            original = stream.read(64 * 1024 + 1)
            after = os.fstat(stream.fileno())
        _, named = regular(root, relative, 64 * 1024)
        if (len(original) > 64 * 1024 or len(original) != before.st_size or
                identity(before) != identity(opened) or identity(opened) != identity(after) or
                identity(after) != identity(named) or opened.st_ctime_ns != after.st_ctime_ns or
                before.st_ctime_ns != named.st_ctime_ns):
            deny()
        configuration = strict_json(original)
        if (not isinstance(configuration, dict) or "auto_map" in configuration or
                configuration.get("tokenizer_class") not in ("PreTrainedTokenizer", "PreTrainedTokenizerFast")):
            deny()
        if configuration["tokenizer_class"] == "PreTrainedTokenizerFast":
            return  # Preserve already-explicit supplier bytes exactly.
        # The pinned serializer strips Fast even for the generic fast-only
        # tokenizer. Keep the producer's actual explicit class in its own output.
        configuration["tokenizer_class"] = "PreTrainedTokenizerFast"
        payload = (json.dumps(configuration, sort_keys=True, separators=(",", ":")) + "\n").encode("utf-8")
        if len(payload) > 64 * 1024:
            deny()
        # r+b does not truncate on open. Reject drift before any write, then bind
        # the final manifest to the newly written bytes. This is not Native custody.
        with target.open("r+b") as stream:
            opened = os.fstat(stream.fileno())
            current = stream.read(64 * 1024 + 1)
            after = os.fstat(stream.fileno())
            _, named = regular(root, relative, 64 * 1024)
            if (identity(before) != identity(opened) or identity(opened) != identity(after) or
                    identity(after) != identity(named) or current != original or
                    opened.st_ctime_ns != after.st_ctime_ns or before.st_ctime_ns != named.st_ctime_ns):
                deny()
            stream.seek(0)
            if stream.write(payload) != len(payload):
                raise OSError("The fixed training metadata write did not complete.")
            stream.truncate(len(payload))
            stream.flush()
            os.fsync(stream.fileno())

    normalize_new_tokenizer()
    rows = {}
    for name in TINY_FILES:
        digest, size = digest_regular(root, (directory / name).relative_to(root).as_posix(), 512 * 1024 if name == "model.safetensors" else 64 * 1024)
        rows[name] = {"sha256": digest, "bytes": size}
    generator = Path(__file__).resolve().relative_to(ROOT).as_posix()
    manifest = {"schemaVersion": "tiny-training-input-v1", "inputProfile": TINY_PROFILE,
                "modelId": TINY_MODEL_ID, "provider": "unknown", "displayName": TINY_DISPLAY_NAME,
                "seed": 13, "configuration": TINY_CONFIGURATION,
                "generatorSha256": digest_regular(root, generator, 64 * 1024)[0], "files": rows}
    raw = (json.dumps(manifest, sort_keys=True, separators=(",", ":")) + "\n").encode()
    with (directory / "input.json").open("xb") as stream:
        stream.write(raw)
    expected = hashlib.sha256(raw).hexdigest()
    return inspect_tiny(root, acquisition, expected)


def failure_details(error):
    """Fixed diagnostic facts only; no exception text, paths or traceback text."""
    types = {"ValueError", "TypeError", "KeyError", "RuntimeError", "OSError", "MemoryError",
             "ImportError", "ModuleNotFoundError", "FileNotFoundError", "FileExistsError",
             "PermissionError", "JSONDecodeError"}
    stages = {"main": "entry-admission", "inspect": "inspect-local-inputs", "fixed_model": "inspect-model-pins",
              "verify_model": "verify-existing-model", "regular": "verify-local-file", "digest_regular": "verify-local-file",
              "create_tiny": "create-tiny-inputs", "_generate_tiny": "generate-tiny-model",
              "normalize_new_tokenizer": "normalize-tokenizer-metadata", "inspect_tiny": "verify-generated-inputs"}
    stage = "entry-admission"
    frame = error.__traceback__
    for _ in range(64):
        if frame is None:
            break
        code = frame.tb_frame.f_code
        if code.co_filename == __file__ and code.co_name in stages:
            stage = stages[code.co_name]
        frame = frame.tb_next
    error_type = type(error).__name__
    return {"stage": stage, "errorType": error_type if error_type in types else "UnhandledError"}


def inspect(root, acquisition, manifest_hash=None):
    fixed_python, _ = regular(root, PYTHON_RELATIVE, 128 * 1024 ** 2)
    if Path(sys.executable).resolve() != fixed_python or sys.version_info[:2] != (3, 12):
        deny()
    python_hash, _ = digest_regular(root, PYTHON_RELATIVE, 128 * 1024 ** 2)
    if tiny_acquisition(acquisition):
        return {"schemaVersion": "training-local-inputs-v2", "status": "verified-inputs-only", "pythonSha256": python_hash,
                "pythonRelative": PYTHON_RELATIVE, **inspect_tiny(root, acquisition, manifest_hash), "accuracyExecuted": False, "launchAuthorized": False}
    if manifest_hash is not None:
        deny()
    return {"schemaVersion": "training-local-inputs-v1", "status": "verified-inputs-only", "pythonSha256": python_hash,
            "pythonRelative": PYTHON_RELATIVE, **verify_model(root, acquisition), "accuracyExecuted": False, "launchAuthorized": False}


def main():
    if sys.argv[1:] not in (["--inspect"], ["--create-tiny-input"]) or os.name != "nt":
        deny()
    if sys.argv[1:] == ["--create-tiny-input"]:
        fixed_python, _ = regular(ROOT, PYTHON_RELATIVE, 128 * 1024 ** 2)
        if Path(sys.executable).resolve() != fixed_python or sys.version_info[:2] != (3, 12):
            deny()
        result = create_tiny(ROOT, os.getenv("VISUAL_COMPOSER_TRAINING_MODEL_ACQUISITION"))
        print(json.dumps({"schemaVersion": "tiny-training-input-created-v1", **result, "accuracyExecuted": False, "launchAuthorized": False}, separators=(",", ":")))
        return
    # An exact known acquisition is supplied by the owning qualification plan.
    result = inspect(ROOT, os.getenv("VISUAL_COMPOSER_TRAINING_MODEL_ACQUISITION"), os.getenv("VISUAL_COMPOSER_TRAINING_INPUT_SHA256"))
    body = json.dumps(result, separators=(",", ":"))
    if len(body.encode("utf-8")) > 4096:
        deny()
    print(body)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(json.dumps({"schemaVersion": "training-local-inputs-v1", "status": "unavailable", "reason": "fixed-input-prerequisites", "accuracyExecuted": False, "launchAuthorized": False, "diagnostics": failure_details(error)}))
        raise SystemExit(1) from None
