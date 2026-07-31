from __future__ import annotations

from collections import OrderedDict
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from hashlib import sha256
import importlib
import importlib.metadata as importlib_metadata
import importlib.util
import json
import re
import sys
from threading import Lock
from typing import Any


OUTLINES_VERSION = "1.3.2"
OUTLINES_CORE_VERSION = "0.2.14"
JSONSCHEMA_VERSION = "4.26.0"

CONSTRAINED_JSON_MAX_SCHEMA_BYTES = 64 * 1024
CONSTRAINED_JSON_MAX_SCHEMA_DEPTH = 20
CONSTRAINED_JSON_MAX_SCHEMA_NODES = 1_024
CONSTRAINED_JSON_MAX_TOTAL_PROPERTIES = 128
CONSTRAINED_JSON_MAX_TOTAL_ENUM_VALUES = 256
CONSTRAINED_JSON_MAX_OUTPUT_BYTES = 64 * 1024
CONSTRAINED_JSON_CACHE_MAX_ENTRIES = 4
CONSTRAINED_JSON_CACHE_MAX_SCHEMA_BYTES = 256 * 1024

_SUPPORTED_PYTHON_MIN = (3, 10)
_SUPPORTED_PYTHON_MAX_EXCLUSIVE = (3, 14)
_FIELD_NAME_PATTERN = re.compile(r"^[A-Za-z_][A-Za-z0-9_-]{0,63}$")
_UNSAFE_FIELD_NAMES = {"__proto__", "constructor", "prototype"}
_ALLOWED_SCHEMA_KEYS = {
    "$schema",
    "additionalProperties",
    "anyOf",
    "const",
    "enum",
    "items",
    "maxItems",
    "maxLength",
    "maxProperties",
    "minItems",
    "minLength",
    "minProperties",
    "oneOf",
    "properties",
    "required",
    "type",
    "uniqueItems",
}
_ALLOWED_TYPES = {"array", "boolean", "null", "number", "object", "string"}
_DRAFT_2020_12 = "https://json-schema.org/draft/2020-12/schema"


class ConstrainedJsonDecoderError(RuntimeError):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.error_code = code
        self.stage = "generation"


@dataclass(frozen=True)
class ConstrainedJsonDecoderRuntimeStatus:
    available: bool
    reason: str


@dataclass(frozen=True)
class ConstrainedJsonSchemaPlan:
    schema: dict[str, Any]
    canonical_schema: str
    constraint_schema: str
    fingerprint: str
    byte_count: int
    node_count: int
    property_count: int
    enum_value_count: int


@dataclass(frozen=True)
class ConstrainedJsonProcessorCacheStats:
    entries: int
    retained_schema_bytes: int
    hits: int
    misses: int
    evictions: int


@dataclass
class _CompiledConstraint:
    processor: Any
    validate: Callable[[Any], None]


@dataclass
class _SchemaCounters:
    nodes: int = 0
    properties: int = 0
    enum_values: int = 0


def get_constrained_json_decoder_runtime_status() -> ConstrainedJsonDecoderRuntimeStatus:
    python_version = sys.version_info[:2]
    if not (_SUPPORTED_PYTHON_MIN <= python_version < _SUPPORTED_PYTHON_MAX_EXCLUSIVE):
        return ConstrainedJsonDecoderRuntimeStatus(False, "python-version-unsupported")

    expected = {
        "jsonschema": JSONSCHEMA_VERSION,
        "outlines": OUTLINES_VERSION,
        "outlines-core": OUTLINES_CORE_VERSION,
    }
    modules = ("jsonschema", "outlines", "outlines_core")
    try:
        if any(importlib.util.find_spec(module_name) is None for module_name in modules):
            return ConstrainedJsonDecoderRuntimeStatus(False, "dependency-unavailable")
        if any(
            importlib_metadata.version(distribution_name) != version
            for distribution_name, version in expected.items()
        ):
            return ConstrainedJsonDecoderRuntimeStatus(False, "dependency-version-mismatch")
    except Exception:
        return ConstrainedJsonDecoderRuntimeStatus(False, "dependency-unavailable")
    return ConstrainedJsonDecoderRuntimeStatus(True, "ready")


def _schema_error(code: str, message: str) -> ConstrainedJsonDecoderError:
    return ConstrainedJsonDecoderError(code, message)


def _require_bounded_integer(value: Any, *, minimum: int, maximum: int) -> None:
    if isinstance(value, bool) or not isinstance(value, int) or value < minimum or value > maximum:
        raise _schema_error(
            "decoder-schema-invalid",
            "The structured output layout contains an invalid limit.",
        )


def _validate_schema_node(
    value: Any,
    *,
    depth: int,
    counters: _SchemaCounters,
) -> None:
    if depth > CONSTRAINED_JSON_MAX_SCHEMA_DEPTH:
        raise _schema_error(
            "decoder-schema-limit",
            "The structured output layout has too many nested levels.",
        )
    counters.nodes += 1
    if counters.nodes > CONSTRAINED_JSON_MAX_SCHEMA_NODES:
        raise _schema_error(
            "decoder-schema-limit",
            "The structured output layout is too complex.",
        )
    if not isinstance(value, dict):
        raise _schema_error(
            "decoder-schema-invalid",
            "The structured output layout is invalid.",
        )

    unknown_keys = set(value).difference(_ALLOWED_SCHEMA_KEYS)
    if unknown_keys:
        raise _schema_error(
            "decoder-schema-unsupported",
            "The structured output layout uses an unsupported rule.",
        )

    schema_uri = value.get("$schema")
    if schema_uri is not None and schema_uri != _DRAFT_2020_12:
        raise _schema_error(
            "decoder-schema-unsupported",
            "The structured output layout uses an unsupported schema version.",
        )

    schema_type = value.get("type")
    if schema_type is not None and schema_type not in _ALLOWED_TYPES:
        raise _schema_error(
            "decoder-schema-unsupported",
            "The structured output layout uses an unsupported value type.",
        )

    if schema_type == "object" and value.get("additionalProperties") is not False:
        raise _schema_error(
            "decoder-schema-unsupported",
            "Token constraints require an exact set of output fields.",
        )
    if schema_type == "array" and "items" not in value:
        raise _schema_error(
            "decoder-schema-invalid",
            "The structured output layout contains an incomplete list rule.",
        )

    if "additionalProperties" in value and value["additionalProperties"] is not False:
        raise _schema_error(
            "decoder-schema-unsupported",
            "Token constraints require an exact set of output fields.",
        )

    properties = value.get("properties")
    if properties is not None:
        if not isinstance(properties, dict) or len(properties) > 48:
            raise _schema_error(
                "decoder-schema-limit",
                "The structured output layout contains too many fields.",
            )
        counters.properties += len(properties)
        if counters.properties > CONSTRAINED_JSON_MAX_TOTAL_PROPERTIES:
            raise _schema_error(
                "decoder-schema-limit",
                "The structured output layout contains too many fields.",
            )
        for field_name, field_schema in properties.items():
            if (
                not isinstance(field_name, str)
                or not _FIELD_NAME_PATTERN.fullmatch(field_name)
                or field_name in _UNSAFE_FIELD_NAMES
            ):
                raise _schema_error(
                    "decoder-schema-invalid",
                    "The structured output layout contains an invalid field name.",
                )
            _validate_schema_node(
                field_schema,
                depth=depth + 1,
                counters=counters,
            )

    required = value.get("required")
    if required is not None:
        if (
            not isinstance(required, list)
            or len(required) > 48
            or any(not isinstance(item, str) for item in required)
            or len(set(required)) != len(required)
        ):
            raise _schema_error(
                "decoder-schema-invalid",
                "The structured output layout contains an invalid required-field list.",
            )
        if properties is not None and any(item not in properties for item in required):
            raise _schema_error(
                "decoder-schema-invalid",
                "The structured output layout requires an unknown field.",
            )

    for union_key in ("anyOf", "oneOf"):
        alternatives = value.get(union_key)
        if alternatives is None:
            continue
        if not isinstance(alternatives, list) or not 1 <= len(alternatives) <= 4:
            raise _schema_error(
                "decoder-schema-limit",
                "The structured output layout contains an invalid choice rule.",
            )
        for alternative in alternatives:
            _validate_schema_node(
                alternative,
                depth=depth + 1,
                counters=counters,
            )

    if "items" in value:
        _validate_schema_node(value["items"], depth=depth + 1, counters=counters)

    enum_values = value.get("enum")
    if enum_values is not None:
        if isinstance(enum_values, list) and len(enum_values) > 64:
            raise _schema_error(
                "decoder-schema-limit",
                "The structured output layout contains too many allowed choices.",
            )
        if (
            not isinstance(enum_values, list)
            or not enum_values
            or any(
                not isinstance(item, (str, int, float, bool))
                or isinstance(item, str) and len(item) > 8_000
                or isinstance(item, float) and not (-sys.float_info.max <= item <= sys.float_info.max)
                for item in enum_values
            )
            or len({json.dumps(item, sort_keys=True) for item in enum_values}) != len(enum_values)
        ):
            raise _schema_error(
                "decoder-schema-invalid",
                "The structured output layout contains invalid allowed choices.",
            )
        counters.enum_values += len(enum_values)
        if counters.enum_values > CONSTRAINED_JSON_MAX_TOTAL_ENUM_VALUES:
            raise _schema_error(
                "decoder-schema-limit",
                "The structured output layout contains too many allowed choices.",
            )

    if "const" in value:
        const_value = value["const"]
        if (
            not isinstance(const_value, (str, int, float, bool))
            or isinstance(const_value, str) and len(const_value) > 8_000
            or isinstance(const_value, float) and not (-sys.float_info.max <= const_value <= sys.float_info.max)
        ):
            raise _schema_error(
                "decoder-schema-invalid",
                "The structured output layout contains an invalid fixed value.",
            )

    for limit_name in ("minLength", "maxLength"):
        if limit_name in value:
            _require_bounded_integer(value[limit_name], minimum=0, maximum=8_000)
    for limit_name in ("minItems", "maxItems"):
        if limit_name in value:
            _require_bounded_integer(value[limit_name], minimum=0, maximum=32)
    for limit_name in ("minProperties", "maxProperties"):
        if limit_name in value:
            _require_bounded_integer(value[limit_name], minimum=0, maximum=64)
    if "uniqueItems" in value and value["uniqueItems"] is not True:
        raise _schema_error(
            "decoder-schema-invalid",
            "The structured output layout contains an invalid list rule.",
        )
    for lower_name, upper_name in (
        ("minLength", "maxLength"),
        ("minItems", "maxItems"),
        ("minProperties", "maxProperties"),
    ):
        if lower_name in value and upper_name in value and value[lower_name] > value[upper_name]:
            raise _schema_error(
                "decoder-schema-invalid",
                "The structured output layout contains inconsistent limits.",
            )


def compile_constrained_json_schema(value: Any) -> ConstrainedJsonSchemaPlan:
    if (
        not isinstance(value, dict)
        or value.get("$schema") != _DRAFT_2020_12
        or value.get("type") != "object"
        or value.get("additionalProperties") is not False
    ):
        raise _schema_error(
            "decoder-schema-invalid",
            "The structured output layout is incomplete or invalid.",
        )
    try:
        canonical_schema = json.dumps(
            value,
            ensure_ascii=False,
            allow_nan=False,
            sort_keys=True,
            separators=(",", ":"),
        )
        constraint_schema = json.dumps(
            value,
            ensure_ascii=False,
            allow_nan=False,
            sort_keys=False,
            separators=(",", ":"),
        )
    except (TypeError, ValueError) as error:
        raise _schema_error(
            "decoder-schema-invalid",
            "The structured output layout is invalid.",
        ) from error
    byte_count = len(canonical_schema.encode("utf-8"))
    if byte_count > CONSTRAINED_JSON_MAX_SCHEMA_BYTES:
        raise _schema_error(
            "decoder-schema-limit",
            "The structured output layout is too large.",
        )
    counters = _SchemaCounters()
    _validate_schema_node(value, depth=0, counters=counters)
    normalized_schema = json.loads(constraint_schema)
    return ConstrainedJsonSchemaPlan(
        schema=normalized_schema,
        canonical_schema=canonical_schema,
        constraint_schema=constraint_schema,
        fingerprint=sha256(canonical_schema.encode("utf-8")).hexdigest(),
        byte_count=byte_count,
        node_count=counters.nodes,
        property_count=counters.properties,
        enum_value_count=counters.enum_values,
    )


class BoundedConstrainedJsonProcessorCache:
    def __init__(
        self,
        *,
        max_entries: int = CONSTRAINED_JSON_CACHE_MAX_ENTRIES,
        max_schema_bytes: int = CONSTRAINED_JSON_CACHE_MAX_SCHEMA_BYTES,
    ) -> None:
        if max_entries < 1 or max_schema_bytes < CONSTRAINED_JSON_MAX_SCHEMA_BYTES:
            raise ValueError("Constrained JSON cache limits are invalid.")
        self._max_entries = max_entries
        self._max_schema_bytes = max_schema_bytes
        self._entries: OrderedDict[str, tuple[int, _CompiledConstraint]] = OrderedDict()
        self._retained_schema_bytes = 0
        self._hits = 0
        self._misses = 0
        self._evictions = 0
        self._lock = Lock()

    def get_or_create(
        self,
        plan: ConstrainedJsonSchemaPlan,
        factory: Callable[[ConstrainedJsonSchemaPlan], _CompiledConstraint],
    ) -> _CompiledConstraint:
        with self._lock:
            cached = self._entries.pop(plan.fingerprint, None)
            if cached is not None:
                self._entries[plan.fingerprint] = cached
                self._hits += 1
                return cached[1]
            self._misses += 1
            try:
                compiled = factory(plan)
            except ConstrainedJsonDecoderError:
                raise
            except Exception as error:
                raise ConstrainedJsonDecoderError(
                    "decoder-schema-compile-failed",
                    "Token constraints could not be prepared for this output layout.",
                ) from error
            if not callable(getattr(compiled.processor, "reset", None)) or not callable(compiled.validate):
                raise ConstrainedJsonDecoderError(
                    "decoder-schema-compile-failed",
                    "Token constraints could not be prepared for this output layout.",
                )
            self._entries[plan.fingerprint] = (plan.byte_count, compiled)
            self._retained_schema_bytes += plan.byte_count
            while (
                len(self._entries) > self._max_entries
                or self._retained_schema_bytes > self._max_schema_bytes
            ):
                _, (removed_bytes, _) = self._entries.popitem(last=False)
                self._retained_schema_bytes -= removed_bytes
                self._evictions += 1
            return compiled

    def stats(self) -> ConstrainedJsonProcessorCacheStats:
        with self._lock:
            return ConstrainedJsonProcessorCacheStats(
                entries=len(self._entries),
                retained_schema_bytes=self._retained_schema_bytes,
                hits=self._hits,
                misses=self._misses,
                evictions=self._evictions,
            )


def _normalize_eos_token_ids(model: Any, tokenizer: Any) -> set[int]:
    candidates = [
        getattr(getattr(model, "generation_config", None), "eos_token_id", None),
        getattr(getattr(model, "config", None), "eos_token_id", None),
        getattr(tokenizer, "eos_token_id", None),
    ]
    normalized: set[int] = set()
    for candidate in candidates:
        values = candidate if isinstance(candidate, (list, tuple, set)) else [candidate]
        for value in values:
            if isinstance(value, int) and not isinstance(value, bool) and value >= 0:
                normalized.add(value)
    return normalized


def _to_integer_token(value: Any) -> int | None:
    if hasattr(value, "item"):
        value = value.item()
    return value if isinstance(value, int) and not isinstance(value, bool) else None


def _configure_windows_eager_outlines_torch_kernel() -> None:
    """Avoid Outlines' optional Torch compiler path on Windows.

    The pinned outlines-core kernel is decorated with ``torch.compile``. On a
    normal end-user Windows installation, Torch may spend substantial memory
    probing for an MSVC compiler before falling back to eager execution. The
    original eager callable is retained by Torch, so use it directly on
    Windows without changing the token mask or schema enforcement behavior.
    """

    if sys.platform != "win32":
        return
    torch_kernels = importlib.import_module("outlines_core.kernels.torch")
    compiled_kernel = getattr(torch_kernels, "_apply_token_bitmask_inplace_kernel", None)
    eager_kernel = getattr(compiled_kernel, "_torchdynamo_orig_callable", None)
    if callable(eager_kernel):
        setattr(torch_kernels, "_apply_token_bitmask_inplace_kernel", eager_kernel)


class ConstrainedJsonDecoder:
    def __init__(
        self,
        model: Any,
        tokenizer: Any,
        *,
        cache: BoundedConstrainedJsonProcessorCache | None = None,
        constraint_factory: Callable[[ConstrainedJsonSchemaPlan], _CompiledConstraint] | None = None,
        logits_processor_list_factory: Callable[[Any], Any] | None = None,
    ) -> None:
        self._model = model
        self._tokenizer = tokenizer
        self._cache = cache or BoundedConstrainedJsonProcessorCache()
        self._constraint_factory = constraint_factory or self._build_outlines_constraint
        self._uses_default_constraint_factory = constraint_factory is None
        self._logits_processor_list_factory = (
            logits_processor_list_factory or self._build_logits_processor_list
        )
        self._outlines_model: Any | None = None

    @property
    def cache_stats(self) -> ConstrainedJsonProcessorCacheStats:
        return self._cache.stats()

    def _build_outlines_constraint(
        self,
        plan: ConstrainedJsonSchemaPlan,
    ) -> _CompiledConstraint:
        status = get_constrained_json_decoder_runtime_status()
        if not status.available:
            raise ConstrainedJsonDecoderError(
                "decoder-unavailable",
                "Token constraints are not available in this Python runtime.",
            )
        try:
            from jsonschema import Draft202012Validator
            from outlines.backends import get_json_schema_logits_processor
            from outlines.models.transformers import Transformers

            _configure_windows_eager_outlines_torch_kernel()
            Draft202012Validator.check_schema(plan.schema)
            validator = Draft202012Validator(plan.schema)
            if self._outlines_model is None:
                self._outlines_model = Transformers(self._model, self._tokenizer)
            processor = get_json_schema_logits_processor(
                "outlines_core",
                self._outlines_model,
                plan.constraint_schema,
            )
            return _CompiledConstraint(processor=processor, validate=validator.validate)
        except ConstrainedJsonDecoderError:
            raise
        except Exception as error:
            raise ConstrainedJsonDecoderError(
                "decoder-schema-compile-failed",
                "Token constraints could not be prepared for this output layout.",
            ) from error

    @staticmethod
    def _build_logits_processor_list(processor: Any) -> Any:
        try:
            from transformers import LogitsProcessorList

            return LogitsProcessorList([processor])
        except Exception as error:
            raise ConstrainedJsonDecoderError(
                "decoder-unavailable",
                "Token constraints are not available in this Python runtime.",
            ) from error

    def generate(
        self,
        *,
        generation_inputs: Mapping[str, Any],
        generation_params: Mapping[str, Any],
        input_ids: Any,
        schema: Any,
    ) -> str:
        plan = compile_constrained_json_schema(schema)
        if self._uses_default_constraint_factory:
            status = get_constrained_json_decoder_runtime_status()
            if not status.available:
                raise ConstrainedJsonDecoderError(
                    "decoder-unavailable",
                    "Token constraints are not available in this Python runtime.",
                )
        compiled = self._cache.get_or_create(plan, self._constraint_factory)
        compiled.processor.reset()

        if any(
            key in generation_params
            for key in ("logits_processor", "return_dict_in_generate", "output_scores")
        ):
            raise ConstrainedJsonDecoderError(
                "decoder-generation-failed",
                "Token-constrained generation could not be started safely.",
            )
        try:
            output = self._model.generate(
                **dict(generation_inputs),
                **dict(generation_params),
                logits_processor=self._logits_processor_list_factory(compiled.processor),
                return_dict_in_generate=True,
                output_scores=False,
            )
        except ConstrainedJsonDecoderError:
            raise
        except Exception as error:
            raise ConstrainedJsonDecoderError(
                "decoder-generation-failed",
                "Token-constrained generation did not complete.",
            ) from error

        sequences = getattr(output, "sequences", None)
        if sequences is None and isinstance(output, Mapping):
            sequences = output.get("sequences")
        try:
            first_output = sequences[0]
            prompt_length = input_ids.shape[-1]
            generated_ids = first_output[prompt_length:]
            generated_count = len(generated_ids)
        except Exception as error:
            raise ConstrainedJsonDecoderError(
                "decoder-output-invalid",
                "Token-constrained generation returned an invalid result.",
            ) from error
        if generated_count < 1:
            raise ConstrainedJsonDecoderError(
                "decoder-output-empty",
                "Token-constrained generation returned no output.",
            )

        eos_token_ids = _normalize_eos_token_ids(self._model, self._tokenizer)
        if not eos_token_ids:
            raise ConstrainedJsonDecoderError(
                "decoder-tokenizer-unsupported",
                "The selected model tokenizer cannot confirm structured completion.",
            )
        final_token = _to_integer_token(generated_ids[-1])
        if final_token not in eos_token_ids:
            raise ConstrainedJsonDecoderError(
                "decoder-output-truncated",
                "Token-constrained generation reached its output limit before completion.",
            )

        try:
            text = self._tokenizer.decode(generated_ids, skip_special_tokens=True).strip()
        except Exception as error:
            raise ConstrainedJsonDecoderError(
                "decoder-output-invalid",
                "Token-constrained generation returned an invalid result.",
            ) from error
        if not text:
            raise ConstrainedJsonDecoderError(
                "decoder-output-empty",
                "Token-constrained generation returned no output.",
            )
        if len(text.encode("utf-8")) > CONSTRAINED_JSON_MAX_OUTPUT_BYTES:
            raise ConstrainedJsonDecoderError(
                "decoder-output-invalid",
                "Token-constrained generation exceeded its output limit.",
            )
        try:
            payload = json.loads(text)
            compiled.validate(payload)
        except Exception as error:
            raise ConstrainedJsonDecoderError(
                "decoder-output-invalid",
                "Token-constrained generation did not match the required output layout.",
            ) from error
        return json.dumps(
            payload,
            ensure_ascii=False,
            allow_nan=False,
            sort_keys=True,
            separators=(",", ":"),
        )
