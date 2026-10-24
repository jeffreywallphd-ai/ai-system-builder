from __future__ import annotations

import json
import os
from pathlib import Path
import unittest
from types import SimpleNamespace

from modules.adapters.runtime.python.worker.tasks.constrained_json_decoder import (
    ConstrainedJsonDecoder,
    ConstrainedJsonDecoderError,
    compile_constrained_json_schema,
    get_constrained_json_decoder_runtime_status,
)
from modules.adapters.runtime.python.worker.tasks.example_generation import (
    _remove_schema_property,
    build_task_structured_output_schema,
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
            (
                self._instruction_generation_schema(),
                {
                    "schemaVersion": "1",
                    "taskType": "llm-instruction",
                    "status": "ok",
                    "example": {
                        "instruction": "Answer the input using only the provided context.",
                        "input": "When are refund requests accepted?",
                        "output": "Refund requests are accepted within 30 days.",
                    },
                },
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

    def test_lazy_masks_match_core_token_choices_unicode_whitespace_and_padding(self) -> None:
        if not get_constrained_json_decoder_runtime_status().available:
            self.skipTest("The exact optional decoder dependencies are unavailable.")
        import torch
        from transformers import AutoTokenizer
        from outlines_core import Guide, Index, Vocabulary
        from outlines_core.json_schema import build_regex_from_schema

        tokenizer = AutoTokenizer.from_pretrained(self._require_controlled_tokenizer_path(), local_files_only=True)
        decoder = ConstrainedJsonDecoder(_TokenizerOnlyModel(), tokenizer)
        # Independent Core baseline for small tractable layouts only. Never build
        # the known huge all-state index for the full instruction layout above.
        from outlines.models.transformers import Transformers
        wrapped = Transformers(_TokenizerOnlyModel(), tokenizer).tokenizer
        projection = {}
        for word, token in wrapped.get_vocab().items():
            projection.setdefault(wrapped.convert_token_to_string(word), []).append(token)
        projection.pop(wrapped.convert_token_to_string(wrapped.eos_token), None)
        vocabulary = Vocabulary(wrapped.eos_token_id, projection)
        cases = [
            ({"type": "string", "enum": ["yes", "no"]}, "yes"),
            ({"type": "string", "minLength": 1, "maxLength": 10}, "café ✓"),
            ({"type": "string", "minLength": 1, "maxLength": 10}, 'line\n"\\'),
            ({"type": "array", "items": {"type": "boolean"}, "maxItems": 2}, [True, False]),
            ({"anyOf": [{"type": "null"}, {"type": "number"}]}, 1.25),
        ]
        for rule, value in cases:
            schema = {"$schema": "https://json-schema.org/draft/2020-12/schema", "type": "object",
                      "additionalProperties": False, "properties": {"answer": rule}, "required": ["answer"]}
            plan = compile_constrained_json_schema(schema)
            index = Index(build_regex_from_schema(plan.constraint_schema), vocabulary)
            compiled = decoder._build_outlines_constraint(plan)
            for spaced in (False, True):
                text = json.dumps({"answer": value}, ensure_ascii=False, separators=None if spaced else (",", ":"))
                target = tokenizer.encode(text, add_special_tokens=False)
                for padding in (0, 271):
                    guide = Guide(index)
                    compiled.processor.reset()
                    seen = [tokenizer.eos_token_id]
                    for position, token in enumerate([*target, tokenizer.eos_token_id]):
                        with self.subTest(rule=rule, spaced=spaced, padding=padding, position=position):
                            width = len(tokenizer) + padding
                            expected = torch.zeros(width, dtype=torch.bool)
                            expected[guide.get_tokens()] = True
                            actual = torch.isfinite(compiled.processor(torch.tensor([seen]), torch.zeros((1, width)))[0])
                            self.assertTrue(torch.equal(expected, actual))
                            self.assertTrue(actual[token])
                            if padding: self.assertFalse(actual[len(tokenizer):].any())
                        if token != tokenizer.eos_token_id: guide.advance(token)
                        seen.append(token)

    def test_real_lazy_processor_denies_invalid_prefix_and_empty_score_set(self) -> None:
        if not get_constrained_json_decoder_runtime_status().available:
            self.skipTest("The exact optional decoder dependencies are unavailable.")
        import torch
        from transformers import AutoTokenizer
        tokenizer = AutoTokenizer.from_pretrained(self._require_controlled_tokenizer_path(), local_files_only=True)
        decoder = ConstrainedJsonDecoder(_TokenizerOnlyModel(), tokenizer)
        compiled = decoder._build_outlines_constraint(compile_constrained_json_schema({
            "$schema": "https://json-schema.org/draft/2020-12/schema", "type": "object",
            "additionalProperties": False, "properties": {"answer": {"const": "yes"}}, "required": ["answer"],
        }))
        seen = [tokenizer.eos_token_id]
        initial = compiled.processor(torch.tensor([seen]), torch.zeros((1, len(tokenizer))))
        invalid = tokenizer.encode('}', add_special_tokens=False)[0]
        self.assertTrue(torch.isneginf(initial[0, invalid]))
        with self.assertRaises(ConstrainedJsonDecoderError):
            compiled.processor(torch.tensor([[*seen, invalid]]), torch.zeros((1, len(tokenizer))))
        compiled.processor.reset()
        with self.assertRaises(ConstrainedJsonDecoderError):
            compiled.processor(torch.tensor([seen]), torch.full((1, len(tokenizer)), float('-inf')))

    def test_native_masks_exclude_holes_eos_aliases_and_padding_on_available_devices(self) -> None:
        if not get_constrained_json_decoder_runtime_status().available:
            self.skipTest("The exact optional decoder dependencies are unavailable.")
        import torch
        from modules.adapters.runtime.python.worker.tasks.constrained_json_logits_processor import BoundedLazyTokenMaskCompiler
        # A small real native vocabulary with deliberate holes and an EOS alias.
        tokens = {'a': 0, 'EOS': 1, 'alias': 3, 'b': 5}
        tokenizer = SimpleNamespace(get_vocab=lambda: tokens, eos_token_id=1, eos_token='EOS',
            convert_token_to_string=lambda word: 'EOS' if word == 'alias' else word,
            tokenizer=SimpleNamespace(encode=lambda text, **kw: [0]))
        compiler = BoundedLazyTokenMaskCompiler(SimpleNamespace(tensor_library_name='torch', tokenizer=tokenizer), ConstrainedJsonDecoderError)
        devices = ['cpu'] + (['cuda'] if torch.cuda.is_available() else [])
        for device in devices:
            with self.subTest(device=device):
                processor = compiler.compile_regex('ab')
                seen = [1]
                for selected in (0, 5, 1):
                    scores = processor(torch.tensor([seen], device=device), torch.zeros((1, 10), device=device))
                    self.assertTrue(torch.isfinite(scores[0, selected]))
                    self.assertTrue(torch.isneginf(scores[0, [2, 3, 4, 6, 7, 8, 9]]).all())
                    self.assertEqual(bool(torch.isfinite(scores[0, 1])), selected == 1)
                    seen.append(selected)
                # A completed batch row may be presented again while another
                # row is still running. EOS must remain the sole allowed token.
                scores = processor(torch.tensor([seen], device=device), torch.zeros((1, 10), device=device))
                self.assertEqual(torch.isfinite(scores).nonzero().tolist(), [[0, 1]])
                processor = compiler.compile_regex('a|ab')
                # Row zero ends early; a hole is used as synthetic pad ID.
                for sequences, allowed_tokens in [
                    ([[1], [1]], [0, 0]),
                    ([[1, 0], [1, 0]], [1, 5]),
                    ([[1, 0, 1], [1, 0, 5]], [1, 1]),
                    ([[1, 0, 1, 2], [1, 0, 5, 1]], [1, 1]),
                ]:
                    scores = processor(torch.tensor(sequences, device=device), torch.zeros((2, 10), device=device))
                    for row, token in enumerate(allowed_tokens):
                        self.assertTrue(torch.isfinite(scores[row, token]))
                    self.assertTrue(torch.isneginf(scores[:, [2, 3, 4, 6, 7, 8, 9]]).all())

    @staticmethod
    def _instruction_generation_schema() -> dict[str, object]:
        schema = build_task_structured_output_schema("llm-instruction")
        _remove_schema_property(schema, ("example", "context"))
        return schema


if __name__ == "__main__":
    unittest.main()
