from __future__ import annotations

import json
import os
from pathlib import Path
import unittest

from modules.adapters.runtime.python.worker.tasks.constrained_json_decoder import (
    ConstrainedJsonDecoder,
    compile_constrained_json_schema,
    get_constrained_json_decoder_runtime_status,
)


class _TokenizerOnlyModel:
    device = "cpu"


class ConstrainedJsonOutlinesIntegrationTests(unittest.TestCase):
    def _require_controlled_tokenizer_path(self) -> Path:
        configured = os.environ.get("ASB_QWEN_TOKENIZER_PATH")
        if not configured:
            self.skipTest("ASB_QWEN_TOKENIZER_PATH is not configured.")
        path = Path(configured)
        if not path.is_absolute() or not path.is_dir():
            self.fail("ASB_QWEN_TOKENIZER_PATH must identify an existing absolute directory.")
        return path

    def test_real_outlines_processor_accepts_only_flat_and_nested_qwen_json_tokens(self) -> None:
        runtime_status = get_constrained_json_decoder_runtime_status()
        if not runtime_status.available:
            self.skipTest(f"Constrained decoder runtime is unavailable: {runtime_status.reason}")

        import torch
        from transformers import AutoTokenizer

        tokenizer = AutoTokenizer.from_pretrained(
            self._require_controlled_tokenizer_path(),
            local_files_only=True,
        )
        decoder = ConstrainedJsonDecoder(_TokenizerOnlyModel(), tokenizer)
        cases = (
            (
                {
                    "$schema": "https://json-schema.org/draft/2020-12/schema",
                    "type": "object",
                    "additionalProperties": False,
                    "properties": {"answer": {"type": "string", "enum": ["yes"]}},
                    "required": ["answer"],
                },
                {"answer": "yes"},
            ),
            (
                {
                    "$schema": "https://json-schema.org/draft/2020-12/schema",
                    "type": "object",
                    "additionalProperties": False,
                    "properties": {
                        "example": {
                            "type": "object",
                            "additionalProperties": False,
                            "properties": {
                                "answer": {"type": "string", "enum": ["yes"]},
                                "tags": {
                                    "type": "array",
                                    "items": {"type": "string", "enum": ["one", "two"]},
                                    "minItems": 2,
                                    "maxItems": 2,
                                },
                            },
                            "required": ["answer", "tags"],
                        }
                    },
                    "required": ["example"],
                },
                {"example": {"answer": "yes", "tags": ["one", "two"]}},
            ),
        )

        for schema, payload in cases:
            with self.subTest(payload=payload):
                plan = compile_constrained_json_schema(schema)
                compiled = decoder._build_outlines_constraint(plan)
                processor = compiled.processor
                target = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
                target_ids = tokenizer.encode(target, add_special_tokens=False)
                self.assertTrue(target_ids)

                observed_ids = [tokenizer.eos_token_id]
                for target_id in target_ids:
                    scores = torch.zeros((1, len(tokenizer)), dtype=torch.float32)
                    masked_scores = processor(torch.tensor([observed_ids]), scores)
                    self.assertTrue(torch.isneginf(masked_scores[0]).any())
                    self.assertTrue(torch.isfinite(masked_scores[0, target_id]))
                    observed_ids.append(target_id)

                final_scores = processor(
                    torch.tensor([observed_ids]),
                    torch.zeros((1, len(tokenizer)), dtype=torch.float32),
                )
                self.assertTrue(torch.isfinite(final_scores[0, tokenizer.eos_token_id]))
                compiled.validate(payload)


if __name__ == "__main__":
    unittest.main()
