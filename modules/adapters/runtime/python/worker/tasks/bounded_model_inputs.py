"""Private, discovery-free inputs for the pinned optional Qwen2 adapter.

No framework imports, directory resolution, cache lookup or file writes occur
here. These cooperative checks do not establish native source custody.
"""
from __future__ import annotations

from dataclasses import dataclass
import hashlib
import math
import re

from .local_model_offload import (
    LocalModelInventory, OffloadAdmissionError, _bounded_bytes, _json,
    _validate_template, _validate_tokenizer_json, _validate_tokenizer_settings,
)


_METADATA = frozenset({"tokenizer.json", "tokenizer_config.json", "special_tokens_map.json",
                       "added_tokens.json", "generation_config.json", "chat_template.jinja"})
_SPECIAL = frozenset({"bos_token", "eos_token", "unk_token", "pad_token", "additional_special_tokens"})
_TOKEN_FIELDS = frozenset({"content", "single_word", "lstrip", "rstrip", "normalized", "special"})
_MAX_NODES = 1_000_000
_MAX_DEPTH = 32


def _finite(value):
    """Bound parsed structure as well as the existing serialized byte limits."""
    pending = [(value, 0)]
    count = 0
    while pending:
        item, depth = pending.pop()
        count += 1
        if count > _MAX_NODES or depth > _MAX_DEPTH:
            raise OffloadAdmissionError()
        if type(item) is dict:
            if any(type(key) is not str for key in item):
                raise OffloadAdmissionError()
            pending.extend((child, depth + 1) for child in item.values())
        elif type(item) is list:
            pending.extend((child, depth + 1) for child in item)
        elif type(item) not in (str, int, float, bool, type(None)):
            raise OffloadAdmissionError()
        elif type(item) is float and not math.isfinite(item):
            raise OffloadAdmissionError()
        if count + len(pending) > _MAX_NODES:
            raise OffloadAdmissionError()
    return value


def _token(value, added_token, *, special=None):
    if isinstance(value, added_token):
        return value
    if type(value) is str:
        if not 0 < len(value) <= 1024:
            raise OffloadAdmissionError()
        return value
    if (type(value) is not dict or set(value).difference(_TOKEN_FIELDS)
            or type(value.get("content")) is not str or not 0 < len(value["content"]) <= 1024
            or any(type(flag) is not bool for key, flag in value.items() if key != "content")):
        raise OffloadAdmissionError()
    settings = dict(value)
    if special is not None:
        settings["special"] = special
    return added_token(**settings)


@dataclass(frozen=True, repr=False)
class AdmittedModelInputs:
    """Transient private metadata; never serialize this object into evidence."""
    tokenizer_json: str
    settings: dict
    special_map: dict | None
    legacy_added: dict | None
    json_added: tuple
    generation: dict | None
    checkpoint_files: tuple[str, ...]
    weight_map: dict[str, str]

    @classmethod
    def from_inventory(cls, inventory: LocalModelInventory):
        if type(inventory) is not LocalModelInventory:
            raise OffloadAdmissionError()
        bindings = {name: (size, digest) for name, size, digest in inventory.bindings}
        if len(bindings) != len(inventory.bindings):
            raise OffloadAdmissionError()
        values = {}
        tokenizer_json = None
        # The set is fixed. In particular, no optional supplier filename is
        # discovered, and no vocab/merges/slow-tokenizer conversion is requested.
        for name in sorted(_METADATA.intersection(inventory.directory_names)):
            if name not in bindings:
                raise OffloadAdmissionError()
            raw = _bounded_bytes(inventory.root / name, 32 * 1024**2 if name == "tokenizer.json" else 8 * 1024**2)
            size, digest = bindings[name]
            if len(raw) != size or hashlib.sha256(raw).hexdigest() != digest:
                raise OffloadAdmissionError()
            try:
                if name == "chat_template.jinja":
                    values[name] = raw.decode("utf-8")
                    _validate_template(values[name])
                else:
                    values[name] = _finite(_json(raw))
                    if name == "tokenizer.json":
                        tokenizer_json = raw.decode("utf-8")
            except (UnicodeError, RecursionError):
                raise OffloadAdmissionError() from None
        if tokenizer_json is None or "tokenizer_config.json" not in values:
            raise OffloadAdmissionError()
        config = inventory.config
        settings = values["tokenizer_config.json"]
        _validate_tokenizer_settings(settings, config)
        tokenizer = values["tokenizer.json"]
        _validate_tokenizer_json(tokenizer, config)
        settings = dict(settings)
        settings.pop("tokenizer_class", None)
        if "chat_template.jinja" in values:
            settings["chat_template"] = values["chat_template.jinja"]
        special = values.get("special_tokens_map.json")
        if special is not None:
            if set(special).difference(_SPECIAL):
                raise OffloadAdmissionError()
            _validate_tokenizer_settings(special, config)
        legacy = values.get("added_tokens.json")
        if legacy is not None and (len(legacy) > 4096 or any(
                not 0 < len(token) <= 1024 or type(index) is not int or not 0 <= index < config["vocab_size"]
                for token, index in legacy.items()) or len(set(legacy.values())) != len(legacy)):
            raise OffloadAdmissionError()
        generation = values.get("generation_config.json")
        if generation is not None and any(
                not re.fullmatch(r"[A-Za-z][A-Za-z0-9_]{0,63}", key)
                and key not in {"_from_model_config", "_commit_hash"} for key in generation):
            raise OffloadAdmissionError()
        if generation is not None:
            # These fields appear verbatim in supplier validation diagnostics.
            # Deny text/containers/booleans where native numeric semantics apply.
            for name in ("temperature", "top_p", "min_p", "typical_p", "epsilon_cutoff", "eta_cutoff",
                         "diversity_penalty", "repetition_penalty", "encoder_repetition_penalty",
                         "length_penalty", "max_time"):
                value = generation.get(name)
                if value is not None and (type(value) not in (int, float)
                        or (type(value) is float and not math.isfinite(value))):
                    raise OffloadAdmissionError()
            for name in ("max_length", "max_new_tokens", "min_length", "min_new_tokens", "top_k",
                         "num_beams", "num_beam_groups", "num_return_sequences"):
                if generation.get(name) is not None and type(generation[name]) is not int:
                    raise OffloadAdmissionError()
            if "do_sample" in generation and type(generation["do_sample"]) is not bool:
                raise OffloadAdmissionError()
        weight_map = {entry.name: entry.shard for entry in inventory.tensors}
        if not weight_map or len(weight_map) != len(inventory.tensors):
            raise OffloadAdmissionError()
        shards = sorted(set(weight_map.values()))
        for name in shards:
            if not re.fullmatch(r"[A-Za-z0-9_.-]+\.safetensors", name) or name not in bindings:
                raise OffloadAdmissionError()
        return cls(tokenizer_json, settings, special, legacy,
                   tuple(tokenizer.get("added_tokens", [])), generation,
                   tuple(str(inventory.root / name) for name in shards), weight_map)

    def tokenizer_kwargs(self, added_token):
        """Mirror pinned fast-loader precedence without any directory resolver."""
        settings = dict(self.settings)
        decoder = {}
        token_map = {}
        if "added_tokens_decoder" in settings:
            for index, value in settings.pop("added_tokens_decoder").items():
                if type(value) is not dict:
                    raise OffloadAdmissionError()
                token = _token(value, added_token)
                decoder[int(index)] = token
                token_map[str(token)] = token
        else:
            # The pinned loader ignores legacy special/added files when a
            # modern added_tokens_decoder is present (including an empty one).
            for key, value in (self.special_map or {}).items():
                if key == "additional_special_tokens" and type(value) is list:
                    merged = list(settings.pop(key, []) or [])
                    for item in value:
                        item = _token(item, added_token, special=True)
                        if item not in merged:
                            merged.append(item)
                    settings[key] = merged
                else:
                    settings[key] = _token(value, added_token, special=True) if value is not None else None
            special_names = []
            for key in _SPECIAL.intersection(settings):
                if settings[key] is not None:
                    if key == "additional_special_tokens":
                        special_names.extend(str(item) for item in settings[key])
                    else:
                        special_names.append(str(settings[key]))
            for text, index in (self.legacy_added or {}).items():
                special = text in special_names
                token = added_token(text, rstrip=False, lstrip=False, normalized=not special, special=special)
                decoder[index] = token
                token_map[str(token)] = token
            # tokenizer.json wins over the legacy added_tokens.json by ID.
            for value in self.json_added:
                token = _token({key: item for key, item in value.items() if key != "id"}, added_token)
                decoder[value["id"]] = token
                token_map[str(token)] = token
        for key in _SPECIAL.intersection(settings):
            value = settings[key]
            if key == "additional_special_tokens":
                settings[key] = [_token(item, added_token) for item in value]
            elif value is not None:
                token = _token(value, added_token)
                settings[key] = token_map.get(str(token), token)
        settings["added_tokens_decoder"] = decoder
        return settings

    def sharded_metadata(self):
        # Supply the complete inspected map for both single-file and sharded
        # layouts. The lower loader need not reopen an index to find its keys.
        return {"all_checkpoint_keys": list(self.weight_map), "weight_map": dict(self.weight_map)}
