from __future__ import annotations

from dataclasses import dataclass
from hashlib import sha256
import hmac
import json
import re
from typing import Any


_MAX_CONFIG_BYTES = 64 * 1024
_MAX_SCHEMA_DEPTH = 20
_MAX_SCHEMA_NODES = 1_024
_MAX_PATH_DEPTH = 5
_FINGERPRINT_PATTERN = re.compile(r"^[a-f0-9]{64}$")
_FIELD_NAME_PATTERN = re.compile(r"^[A-Za-z_][A-Za-z0-9_-]{0,63}$")
_PURPOSES = {
    "instruction",
    "input",
    "context",
    "output",
    "thought",
    "label",
    "expected-output",
    "anchor-text",
    "positive-text",
    "query",
    "passage",
    "caption",
}


@dataclass(frozen=True)
class RuntimeStructuredOutput:
    schema: dict[str, Any]
    example: dict[str, Any]
    schema_fingerprint: str
    payload_key: str
    purpose_paths: dict[str, tuple[str, ...]]
    constrained_decoding: bool


class StructuredOutputValidationError(ValueError):
    pass


def _canonical_json(value: Any) -> str:
    return json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    )


def _validate_schema_definition(value: Any, depth: int = 0, nodes: list[int] | None = None) -> None:
    if nodes is None:
        nodes = [0]
    if depth > _MAX_SCHEMA_DEPTH:
        raise StructuredOutputValidationError("The generated output layout is too deeply nested.")
    nodes[0] += 1
    if nodes[0] > _MAX_SCHEMA_NODES or not isinstance(value, dict):
        raise StructuredOutputValidationError("The generated output layout is too complex.")
    for key in ("properties",):
        child_map = value.get(key)
        if child_map is not None:
            if not isinstance(child_map, dict) or len(child_map) > 128:
                raise StructuredOutputValidationError("The generated output layout contains invalid fields.")
            for field_name, child in child_map.items():
                if not isinstance(field_name, str) or not _FIELD_NAME_PATTERN.fullmatch(field_name):
                    raise StructuredOutputValidationError("The generated output layout contains an invalid field name.")
                _validate_schema_definition(child, depth + 1, nodes)
    for key in ("anyOf", "oneOf"):
        alternatives = value.get(key)
        if alternatives is not None:
            if not isinstance(alternatives, list) or not 1 <= len(alternatives) <= 8:
                raise StructuredOutputValidationError("The generated output layout contains an invalid choice.")
            for child in alternatives:
                _validate_schema_definition(child, depth + 1, nodes)
    items = value.get("items")
    if items is not None:
        _validate_schema_definition(items, depth + 1, nodes)
    additional = value.get("additionalProperties")
    if isinstance(additional, dict):
        _validate_schema_definition(additional, depth + 1, nodes)


def resolve_runtime_structured_output(
    runtime: Any,
) -> RuntimeStructuredOutput:
    if not isinstance(runtime, dict) or not isinstance(runtime.get("structuredOutput"), dict):
        raise StructuredOutputValidationError("Compiled generated output settings are missing.")
    raw = runtime["structuredOutput"]
    if set(raw) != {
        "schema",
        "example",
        "schemaFingerprint",
        "payloadKey",
        "purposePaths",
        "constrainedDecoding",
    }:
        raise StructuredOutputValidationError("Compiled generated output settings are invalid.")
    schema = raw.get("schema")
    example = raw.get("example")
    fingerprint = raw.get("schemaFingerprint")
    payload_key = raw.get("payloadKey")
    raw_paths = raw.get("purposePaths")
    constrained = raw.get("constrainedDecoding")
    if (
        not isinstance(schema, dict)
        or not isinstance(example, dict)
        or not isinstance(fingerprint, str)
        or not _FINGERPRINT_PATTERN.fullmatch(fingerprint)
        or payload_key not in {"example", "value"}
        or not isinstance(raw_paths, dict)
        or not isinstance(constrained, bool)
    ):
        raise StructuredOutputValidationError("Compiled generated output settings are invalid.")
    purpose_paths: dict[str, tuple[str, ...]] = {}
    for purpose, path in raw_paths.items():
        if (
            purpose not in _PURPOSES
            or not isinstance(path, list)
            or not 1 <= len(path) <= _MAX_PATH_DEPTH
            or any(not isinstance(part, str) or not _FIELD_NAME_PATTERN.fullmatch(part) for part in path)
        ):
            raise StructuredOutputValidationError("The generated output field mapping is invalid.")
        purpose_paths[purpose] = tuple(path)
    fingerprint_input = {
        "schema": schema,
        "example": example,
        "payloadKey": payload_key,
        "purposePaths": raw_paths,
        "constrainedDecoding": constrained,
    }
    serialized = _canonical_json(fingerprint_input)
    if len(serialized.encode("utf-8")) > _MAX_CONFIG_BYTES:
        raise StructuredOutputValidationError("The generated output layout is too large.")
    expected = sha256(serialized.encode("utf-8")).hexdigest()
    if not hmac.compare_digest(fingerprint, expected):
        raise StructuredOutputValidationError("The generated output layout fingerprint is invalid.")
    _validate_schema_definition(schema)
    validate_json_schema_value(example, schema, "example output")
    return RuntimeStructuredOutput(
        schema=schema,
        example=example,
        schema_fingerprint=fingerprint,
        payload_key=payload_key,
        purpose_paths=purpose_paths,
        constrained_decoding=constrained,
    )


def _same_json_value(left: Any, right: Any) -> bool:
    try:
        return _canonical_json(left) == _canonical_json(right)
    except (TypeError, ValueError):
        return False


def validate_json_schema_value(value: Any, schema: dict[str, Any], path: str = "output") -> None:
    alternatives = schema.get("anyOf")
    if alternatives is not None:
        if not any(_matches(value, alternative, path) for alternative in alternatives):
            raise StructuredOutputValidationError(f"{path} did not match an allowed value shape.")
    alternatives = schema.get("oneOf")
    if alternatives is not None:
        if sum(1 for alternative in alternatives if _matches(value, alternative, path)) != 1:
            raise StructuredOutputValidationError(f"{path} did not match exactly one required shape.")
    if "const" in schema and not _same_json_value(value, schema["const"]):
        raise StructuredOutputValidationError(f"{path} did not match its required value.")
    if "enum" in schema and not any(_same_json_value(value, item) for item in schema["enum"]):
        raise StructuredOutputValidationError(f"{path} was not one of the allowed values.")

    schema_type = schema.get("type")
    type_matches = {
        "null": value is None,
        "boolean": isinstance(value, bool),
        "number": isinstance(value, (int, float)) and not isinstance(value, bool),
        "string": isinstance(value, str),
        "array": isinstance(value, list),
        "object": isinstance(value, dict),
    }
    if schema_type is not None and not type_matches.get(schema_type, False):
        raise StructuredOutputValidationError(f"{path} had the wrong value type.")

    if isinstance(value, str):
        if len(value) < int(schema.get("minLength", 0)) or len(value) > int(schema.get("maxLength", len(value))):
            raise StructuredOutputValidationError(f"{path} did not meet its text-length rule.")
    if isinstance(value, list):
        if len(value) < int(schema.get("minItems", 0)) or len(value) > int(schema.get("maxItems", len(value))):
            raise StructuredOutputValidationError(f"{path} did not meet its list-size rule.")
        if schema.get("uniqueItems") is True:
            canonical_items = [_canonical_json(item) for item in value]
            if len(set(canonical_items)) != len(canonical_items):
                raise StructuredOutputValidationError(f"{path} contained repeated list values.")
        if isinstance(schema.get("items"), dict):
            for index, item in enumerate(value):
                validate_json_schema_value(item, schema["items"], f"{path}[{index}]")
    if isinstance(value, dict):
        if len(value) < int(schema.get("minProperties", 0)) or len(value) > int(schema.get("maxProperties", len(value))):
            raise StructuredOutputValidationError(f"{path} did not meet its field-count rule.")
        properties = schema.get("properties") if isinstance(schema.get("properties"), dict) else {}
        required = schema.get("required") if isinstance(schema.get("required"), list) else []
        missing = [field for field in required if field not in value]
        if missing:
            raise StructuredOutputValidationError(f"{path} was missing a required field.")
        additional = schema.get("additionalProperties", True)
        for field_name, field_value in value.items():
            if field_name in properties:
                validate_json_schema_value(field_value, properties[field_name], f"{path}.{field_name}")
            elif additional is False:
                raise StructuredOutputValidationError(f"{path} contained an unexpected field.")
            elif isinstance(additional, dict):
                validate_json_schema_value(field_value, additional, f"{path}.{field_name}")


def _matches(value: Any, schema: Any, path: str) -> bool:
    if not isinstance(schema, dict):
        return False
    try:
        validate_json_schema_value(value, schema, path)
        return True
    except StructuredOutputValidationError:
        return False


def read_purpose_value(payload: dict[str, Any], path: tuple[str, ...]) -> Any:
    current: Any = payload
    for part in path:
        if not isinstance(current, dict) or part not in current:
            raise StructuredOutputValidationError("A required generated output field is missing.")
        current = current[part]
    return current
