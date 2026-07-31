from __future__ import annotations

from hashlib import sha256
import json
from typing import Any

from modules.adapters.runtime.python.worker.tasks.example_generation import (
    build_task_structured_output_schema,
)


_PURPOSE_PATHS: dict[str, dict[str, list[str]]] = {
    "llm-instruction": {
        "instruction": ["instruction"],
        "input": ["input"],
        "context": ["context"],
        "output": ["output"],
    },
    "llm-classification": {"label": ["label"]},
    "llm-extraction": {"expected-output": ["expectedOutput"]},
    "llm-embedding": {
        "anchor-text": ["anchorText"],
        "positive-text": ["positiveText"],
    },
    "llm-reranker": {"query": ["query"], "passage": ["passage"]},
    "diffusion-lora": {"caption": ["caption"]},
    "vision-classification": {"label": ["label"]},
    "vision-detection": {"label": ["labels"]},
    "vision-segmentation": {"label": ["label"]},
}


def _example_from_schema(schema: dict[str, Any]) -> Any:
    if "const" in schema:
        return schema["const"]
    if isinstance(schema.get("enum"), list) and schema["enum"]:
        return schema["enum"][0]
    if isinstance(schema.get("anyOf"), list):
        non_null = [
            option
            for option in schema["anyOf"]
            if isinstance(option, dict) and option.get("type") != "null"
        ]
        return _example_from_schema(non_null[0] if non_null else schema["anyOf"][0])
    schema_type = schema.get("type")
    if schema_type == "object":
        properties = schema.get("properties")
        required = schema.get("required")
        if isinstance(properties, dict) and isinstance(required, list):
            return {
                name: _example_from_schema(properties[name])
                for name in required
                if name in properties
            }
        additional = schema.get("additionalProperties")
        if isinstance(additional, dict):
            return {"field": _example_from_schema(additional)}
        return {}
    if schema_type == "array":
        return [_example_from_schema(schema.get("items") or {"type": "string"})]
    if schema_type == "number":
        return 0
    if schema_type == "boolean":
        return True
    if schema_type == "null":
        return None
    return "example"


def _image_schema(task_type: str) -> dict[str, Any]:
    purpose = "caption" if task_type == "diffusion-lora" else "label"
    field_name = _PURPOSE_PATHS[task_type][purpose][0]
    maximum = 500 if purpose == "caption" else 120
    value_schema = {
        "type": "object",
        "additionalProperties": False,
        "required": [field_name],
        "properties": {
            field_name: {
                "type": "string",
                "minLength": 1,
                "maxLength": maximum,
            }
        },
    }
    return {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "type": "object",
        "additionalProperties": False,
        "required": ["schemaVersion", "taskType", "fieldKind", "status", "value"],
        "properties": {
            "schemaVersion": {"const": "1"},
            "taskType": {"const": task_type},
            "fieldKind": {"const": purpose},
            "status": {"enum": ["ok", "skip"]},
            "value": {"anyOf": [value_schema, {"type": "null"}]},
        },
        "oneOf": [
            {"properties": {"status": {"const": "ok"}, "value": value_schema}},
            {"properties": {"status": {"const": "skip"}, "value": {"type": "null"}}},
        ],
    }


def runtime_structured_output_fixture(
    task_type: str = "llm-instruction",
    task_recipe: dict[str, Any] | None = None,
    *,
    constrained: bool = False,
) -> dict[str, Any]:
    schema = (
        _image_schema(task_type)
        if task_type.startswith("vision-") or task_type == "diffusion-lora"
        else build_task_structured_output_schema(task_type, task_recipe)
    )
    return runtime_structured_output_from_schema(
        schema,
        (
            "value"
            if task_type.startswith("vision-") or task_type == "diffusion-lora"
            else "example"
        ),
        _PURPOSE_PATHS[task_type],
        constrained=constrained,
    )


def runtime_structured_output_from_schema(
    schema: dict[str, Any],
    payload_key: str,
    purpose_paths: dict[str, list[str]],
    *,
    constrained: bool = False,
    example: dict[str, Any] | None = None,
) -> dict[str, Any]:
    resolved_example = example or _example_from_schema(schema)
    resolved_paths = {
        purpose: list(path)
        for purpose, path in purpose_paths.items()
    }
    fingerprint_input = {
        "schema": schema,
        "example": resolved_example,
        "payloadKey": payload_key,
        "purposePaths": resolved_paths,
        "constrainedDecoding": constrained,
    }
    serialized = json.dumps(
        fingerprint_input,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )
    return {
        "structuredOutput": {
            **fingerprint_input,
            "schemaFingerprint": sha256(serialized.encode("utf-8")).hexdigest(),
        }
    }
