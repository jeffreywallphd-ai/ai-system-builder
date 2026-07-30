from __future__ import annotations

import json
import unittest
from unittest.mock import patch

from modules.adapters.runtime.python.worker.models import ExampleGenerationConfig
from modules.adapters.runtime.python.worker.tasks.example_generation import (
    generate_task_examples_for_chunks,
)
from modules.adapters.runtime.python.worker.tasks.markdown_chunking import MarkdownChunk
from modules.adapters.runtime.python.worker.tasks.structured_output_runtime import (
    StructuredOutputValidationError,
    resolve_runtime_structured_output,
    validate_json_schema_value,
)
from modules.adapters.runtime.python.worker.tests.structured_output_test_fixtures import (
    runtime_structured_output_fixture,
    runtime_structured_output_from_schema,
)


class StructuredOutputRuntimeTests(unittest.TestCase):
    def test_verifies_fingerprint_and_rejects_tampering(self) -> None:
        runtime = runtime_structured_output_fixture(constrained=True)
        resolved = resolve_runtime_structured_output(runtime)
        self.assertTrue(resolved.constrained_decoding)
        runtime["structuredOutput"]["purposePaths"]["output"] = ["changed"]
        with self.assertRaisesRegex(StructuredOutputValidationError, "fingerprint"):
            resolve_runtime_structured_output(runtime)

    def test_validates_nested_exact_fields_without_jsonschema_dependency(self) -> None:
        schema = {
            "type": "object",
            "additionalProperties": False,
            "required": ["group"],
            "properties": {
                "group": {
                    "type": "object",
                    "additionalProperties": False,
                    "required": ["answer"],
                    "properties": {
                        "answer": {"type": "string", "minLength": 1, "maxLength": 20}
                    },
                }
            },
        }
        validate_json_schema_value({"group": {"answer": "grounded"}}, schema)
        with self.assertRaisesRegex(StructuredOutputValidationError, "unexpected"):
            validate_json_schema_value(
                {"group": {"answer": "grounded", "extra": "no"}},
                schema,
            )

    def test_custom_paths_drive_parsing_and_checked_generation(self) -> None:
        example_schema = {
            "type": "object",
            "additionalProperties": False,
            "required": ["request_text", "source_text", "answer_text"],
            "properties": {
                "request_text": {"type": "string", "minLength": 1, "maxLength": 2000},
                "source_text": {"type": "string", "maxLength": 8000},
                "answer_text": {"type": "string", "minLength": 1, "maxLength": 8000},
            },
        }
        schema = {
            "$schema": "https://json-schema.org/draft/2020-12/schema",
            "type": "object",
            "additionalProperties": False,
            "required": ["schemaVersion", "taskType", "status", "example"],
            "properties": {
                "schemaVersion": {"const": "1"},
                "taskType": {"const": "llm-instruction"},
                "status": {"enum": ["ok", "skip"]},
                "example": {"anyOf": [example_schema, {"type": "null"}]},
            },
            "oneOf": [
                {"properties": {"status": {"const": "ok"}, "example": example_schema}},
                {"properties": {"status": {"const": "skip"}, "example": {"type": "null"}}},
            ],
        }
        runtime = runtime_structured_output_from_schema(
            schema,
            "example",
            {
                "instruction": ["request_text"],
                "input": ["source_text"],
                "output": ["answer_text"],
            },
            constrained=True,
        )
        structured_output = resolve_runtime_structured_output(runtime)
        response = {
            "schemaVersion": "1",
            "taskType": "llm-instruction",
            "status": "ok",
            "example": {
                "request_text": "What is stated?",
                "source_text": "Grounded source text.",
                "answer_text": "Grounded source text is stated.",
            },
        }

        class Generator:
            def __init__(self) -> None:
                self.schema = None

            def generate_text(self, _prompt, _system_prompt=None, **kwargs):
                self.schema = kwargs.get("constrained_json_schema")
                return json.dumps(response)

        generator = Generator()
        config = ExampleGenerationConfig.model_validate(
            {
                "mode": "qa",
                "model": {
                    "provider": "transformers",
                    "modelId": "Qwen/Qwen2.5-7B-Instruct",
                    "inferenceMode": "chat",
                },
            }
        )
        with patch(
            "modules.adapters.runtime.python.worker.tasks.example_generation.get_or_create_local_text_generator",
            return_value=generator,
        ):
            examples = generate_task_examples_for_chunks(
                [MarkdownChunk("source-a", 0, "Grounded source text.")],
                config,
                "llm-instruction",
                {"taskType": "llm-instruction"},
                structured_output,
            )
        self.assertEqual(generator.schema, schema)
        self.assertEqual(examples[0].question, "What is stated?")
        self.assertEqual(examples[0].structured_fields, response["example"])


if __name__ == "__main__":
    unittest.main()
