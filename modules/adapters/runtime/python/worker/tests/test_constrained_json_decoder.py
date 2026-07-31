from __future__ import annotations

from copy import deepcopy
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from modules.adapters.runtime.python.worker.tasks import constrained_json_decoder as decoder_module

from modules.adapters.runtime.python.worker.tasks.constrained_json_decoder import (
    BoundedConstrainedJsonProcessorCache,
    ConstrainedJsonDecoder,
    ConstrainedJsonDecoderError,
    _CompiledConstraint,
    _configure_windows_eager_outlines_torch_kernel,
    compile_constrained_json_schema,
    get_constrained_json_decoder_runtime_status,
)


def _schema(*, field_name: str = "answer", const_value: str | None = None) -> dict:
    field_schema: dict[str, object] = {
        "type": "string",
        "minLength": 1,
        "maxLength": 100,
    }
    if const_value is not None:
        field_schema["const"] = const_value
    return {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "type": "object",
        "additionalProperties": False,
        "required": [field_name],
        "properties": {field_name: field_schema},
    }


class _FakeProcessor:
    def __init__(self) -> None:
        self.reset_count = 0

    def reset(self) -> None:
        self.reset_count += 1


class _FakeInputIds:
    shape = (1, 2)


class _FakeTokenizer:
    eos_token_id = 99

    def __init__(self, decoded: str = '{"answer":"ok"}') -> None:
        self.decoded = decoded

    def decode(self, _token_ids, skip_special_tokens: bool = True) -> str:
        if not skip_special_tokens:
            raise AssertionError("Decoder output must omit special tokens.")
        return self.decoded


class _FakeModel:
    generation_config = SimpleNamespace(eos_token_id=99)
    config = SimpleNamespace(eos_token_id=99)

    def __init__(self, generated_tokens: list[int] | None = None) -> None:
        self.generated_tokens = generated_tokens or [10, 99]
        self.calls: list[dict] = []

    def generate(self, **kwargs):
        self.calls.append(kwargs)
        return SimpleNamespace(sequences=[[1, 2, *self.generated_tokens]])


def _constraint_factory(
    expected: object,
    processors: list[_FakeProcessor] | None = None,
):
    def create(_plan):
        processor = _FakeProcessor()
        if processors is not None:
            processors.append(processor)

        def validate(payload: object) -> None:
            if payload != expected:
                raise ValueError("private generated payload must not escape")

        return _CompiledConstraint(processor=processor, validate=validate)

    return create


class ConstrainedJsonSchemaTests(unittest.TestCase):
    def test_uses_outlines_eager_mask_kernel_on_windows(self) -> None:
        def eager_kernel(*_args):
            return None

        compiled_kernel = SimpleNamespace(_torchdynamo_orig_callable=eager_kernel)
        kernels = SimpleNamespace(_apply_token_bitmask_inplace_kernel=compiled_kernel)
        with (
            patch.object(decoder_module.sys, "platform", "win32"),
            patch.object(decoder_module.importlib, "import_module", return_value=kernels),
        ):
            _configure_windows_eager_outlines_torch_kernel()

        self.assertIs(kernels._apply_token_bitmask_inplace_kernel, eager_kernel)

    def test_leaves_outlines_mask_kernel_unchanged_off_windows(self) -> None:
        with (
            patch.object(decoder_module.sys, "platform", "linux"),
            patch.object(decoder_module.importlib, "import_module") as import_module,
        ):
            _configure_windows_eager_outlines_torch_kernel()

        import_module.assert_not_called()

    def test_reports_dependency_and_python_readiness_without_throwing(self) -> None:
        with patch.object(decoder_module.sys, "version_info", (3, 14, 1)):
            unsupported = get_constrained_json_decoder_runtime_status()
        self.assertFalse(unsupported.available)
        self.assertEqual(unsupported.reason, "python-version-unsupported")

        versions = {
            "jsonschema": "4.26.0",
            "outlines": "1.3.2",
            "outlines-core": "0.2.14",
        }
        with (
            patch.object(decoder_module.sys, "version_info", (3, 12, 9)),
            patch.object(decoder_module.importlib.util, "find_spec", return_value=SimpleNamespace()),
            patch.object(decoder_module.importlib_metadata, "version", side_effect=lambda name: versions[name]),
        ):
            ready = get_constrained_json_decoder_runtime_status()
        self.assertTrue(ready.available)
        self.assertEqual(ready.reason, "ready")

        with (
            patch.object(decoder_module.sys, "version_info", (3, 12, 9)),
            patch.object(decoder_module.importlib.util, "find_spec", side_effect=RuntimeError("private path")),
        ):
            unavailable = get_constrained_json_decoder_runtime_status()
        self.assertFalse(unavailable.available)
        self.assertEqual(unavailable.reason, "dependency-unavailable")

    def test_canonicalizes_equivalent_exact_schemas_deterministically(self) -> None:
        original = _schema()
        reordered = {
            "properties": original["properties"],
            "required": original["required"],
            "additionalProperties": False,
            "type": "object",
            "$schema": "https://json-schema.org/draft/2020-12/schema",
        }

        first = compile_constrained_json_schema(original)
        second = compile_constrained_json_schema(reordered)

        self.assertEqual(first.canonical_schema, second.canonical_schema)
        self.assertEqual(first.fingerprint, second.fingerprint)
        self.assertEqual(first.property_count, 1)
        self.assertGreater(first.node_count, 1)

    def test_preserves_property_order_for_the_generation_grammar(self) -> None:
        schema = _schema(field_name="firstField")
        schema["required"] = ["firstField", "secondField"]
        schema["properties"]["secondField"] = {"type": "string", "maxLength": 100}

        plan = compile_constrained_json_schema(schema)

        self.assertEqual(list(plan.schema["properties"]), ["firstField", "secondField"])
        self.assertLess(
            plan.constraint_schema.index('"firstField"'),
            plan.constraint_schema.index('"secondField"'),
        )

    def test_rejects_raw_references_unknown_rules_and_open_root_objects(self) -> None:
        reference = _schema()
        reference["properties"]["answer"] = {"$ref": "https://invalid.example/schema"}
        open_root = _schema()
        del open_root["additionalProperties"]
        inconsistent = _schema()
        inconsistent["properties"]["answer"]["minLength"] = 20
        inconsistent["properties"]["answer"]["maxLength"] = 10

        for value, code in (
            (reference, "decoder-schema-unsupported"),
            (open_root, "decoder-schema-invalid"),
            (inconsistent, "decoder-schema-invalid"),
        ):
            with self.subTest(code=code):
                with self.assertRaises(ConstrainedJsonDecoderError) as raised:
                    compile_constrained_json_schema(value)
                self.assertEqual(raised.exception.code, code)

    def test_rejects_excessive_choices_properties_and_depth(self) -> None:
        choices = _schema()
        choices["properties"]["answer"]["enum"] = [f"choice-{index}" for index in range(65)]

        properties = _schema()
        properties["required"] = []
        properties["properties"] = {
            f"field_{index}": {"type": "string", "maxLength": 10}
            for index in range(49)
        }

        nested = _schema()
        current = nested["properties"]["answer"]
        for _ in range(22):
            child = {
                "type": "object",
                "additionalProperties": False,
                "required": ["child"],
                "properties": {"child": {"type": "string", "maxLength": 10}},
            }
            current.clear()
            current.update(child)
            current = current["properties"]["child"]

        for value in (choices, properties, nested):
            with self.subTest(value=value):
                with self.assertRaises(ConstrainedJsonDecoderError) as raised:
                    compile_constrained_json_schema(value)
                self.assertEqual(raised.exception.code, "decoder-schema-limit")


class ConstrainedJsonCacheTests(unittest.TestCase):
    def test_reuses_then_evicts_processors_under_entry_and_byte_bounds(self) -> None:
        cache = BoundedConstrainedJsonProcessorCache(max_entries=2)
        created: list[_FakeProcessor] = []
        factory = _constraint_factory({"answer": "ok"}, created)
        first = compile_constrained_json_schema(_schema(const_value="one"))
        second = compile_constrained_json_schema(_schema(const_value="two"))
        third = compile_constrained_json_schema(_schema(const_value="three"))

        cache.get_or_create(first, factory)
        cache.get_or_create(first, factory)
        cache.get_or_create(second, factory)
        cache.get_or_create(third, factory)

        stats = cache.stats()
        self.assertEqual(len(created), 3)
        self.assertEqual(stats.entries, 2)
        self.assertEqual(stats.hits, 1)
        self.assertEqual(stats.misses, 3)
        self.assertEqual(stats.evictions, 1)
        self.assertLessEqual(stats.retained_schema_bytes, 256 * 1024)

    def test_sanitizes_compilation_failures_and_does_not_cache_them(self) -> None:
        cache = BoundedConstrainedJsonProcessorCache()
        plan = compile_constrained_json_schema(_schema())

        def fail(_plan):
            raise RuntimeError("secret prompt C:\\private\\model stack")

        for _ in range(2):
            with self.assertRaises(ConstrainedJsonDecoderError) as raised:
                cache.get_or_create(plan, fail)
            self.assertEqual(raised.exception.code, "decoder-schema-compile-failed")
            self.assertNotIn("private", str(raised.exception).lower())
        self.assertEqual(cache.stats().entries, 0)
        self.assertEqual(cache.stats().misses, 2)


class ConstrainedJsonGenerationTests(unittest.TestCase):
    def test_attaches_resets_and_reuses_the_processor_for_valid_eos_output(self) -> None:
        model = _FakeModel()
        tokenizer = _FakeTokenizer()
        processors: list[_FakeProcessor] = []
        decoder = ConstrainedJsonDecoder(
            model,
            tokenizer,
            constraint_factory=_constraint_factory({"answer": "ok"}, processors),
            logits_processor_list_factory=lambda processor: [processor],
        )

        first = decoder.generate(
            generation_inputs={"input_ids": _FakeInputIds()},
            generation_params={"max_new_tokens": 32},
            input_ids=_FakeInputIds(),
            schema=_schema(),
        )
        second = decoder.generate(
            generation_inputs={"input_ids": _FakeInputIds()},
            generation_params={"max_new_tokens": 32},
            input_ids=_FakeInputIds(),
            schema=deepcopy(_schema()),
        )

        self.assertEqual(first, '{"answer":"ok"}')
        self.assertEqual(second, first)
        self.assertEqual(len(model.calls), 2)
        self.assertEqual(len(processors), 1)
        self.assertEqual(processors[0].reset_count, 2)
        self.assertEqual(model.calls[0]["logits_processor"], [processors[0]])
        self.assertIs(model.calls[0]["return_dict_in_generate"], True)
        self.assertIs(model.calls[0]["output_scores"], False)

    def test_supports_nested_json_when_it_matches_the_exact_validator(self) -> None:
        nested_payload = {"result": {"name": "Ada", "active": True}}
        nested_schema = {
            "$schema": "https://json-schema.org/draft/2020-12/schema",
            "type": "object",
            "additionalProperties": False,
            "required": ["result"],
            "properties": {
                "result": {
                    "type": "object",
                    "additionalProperties": False,
                    "required": ["name", "active"],
                    "properties": {
                        "name": {"type": "string", "maxLength": 100},
                        "active": {"type": "boolean"},
                    },
                }
            },
        }
        decoder = ConstrainedJsonDecoder(
            _FakeModel(),
            _FakeTokenizer('{"result":{"name":"Ada","active":true}}'),
            constraint_factory=_constraint_factory(nested_payload),
            logits_processor_list_factory=lambda processor: [processor],
        )

        result = decoder.generate(
            generation_inputs={"input_ids": _FakeInputIds()},
            generation_params={"max_new_tokens": 64},
            input_ids=_FakeInputIds(),
            schema=nested_schema,
        )

        self.assertEqual(result, '{"result":{"active":true,"name":"Ada"}}')

    def test_fails_closed_for_truncation_without_a_second_generation(self) -> None:
        model = _FakeModel(generated_tokens=[10, 11])
        decoder = ConstrainedJsonDecoder(
            model,
            _FakeTokenizer(),
            constraint_factory=_constraint_factory({"answer": "ok"}),
            logits_processor_list_factory=lambda processor: [processor],
        )

        with self.assertRaises(ConstrainedJsonDecoderError) as raised:
            decoder.generate(
                generation_inputs={"input_ids": _FakeInputIds()},
                generation_params={"max_new_tokens": 2},
                input_ids=_FakeInputIds(),
                schema=_schema(),
            )

        self.assertEqual(raised.exception.code, "decoder-output-truncated")
        self.assertEqual(len(model.calls), 1)

    def test_fails_closed_for_invalid_json_and_schema_mismatch(self) -> None:
        for decoded in ("not json", '{"answer":"wrong"}'):
            model = _FakeModel()
            decoder = ConstrainedJsonDecoder(
                model,
                _FakeTokenizer(decoded),
                constraint_factory=_constraint_factory({"answer": "ok"}),
                logits_processor_list_factory=lambda processor: [processor],
            )
            with self.subTest(decoded=decoded):
                with self.assertRaises(ConstrainedJsonDecoderError) as raised:
                    decoder.generate(
                        generation_inputs={"input_ids": _FakeInputIds()},
                        generation_params={"max_new_tokens": 32},
                        input_ids=_FakeInputIds(),
                        schema=_schema(),
                    )
                self.assertEqual(raised.exception.code, "decoder-output-invalid")
                self.assertNotIn("payload", str(raised.exception).lower())
                self.assertEqual(len(model.calls), 1)

    def test_rejects_caller_processor_overrides_before_model_generation(self) -> None:
        model = _FakeModel()
        decoder = ConstrainedJsonDecoder(
            model,
            _FakeTokenizer(),
            constraint_factory=_constraint_factory({"answer": "ok"}),
            logits_processor_list_factory=lambda processor: [processor],
        )

        with self.assertRaises(ConstrainedJsonDecoderError) as raised:
            decoder.generate(
                generation_inputs={"input_ids": _FakeInputIds()},
                generation_params={"logits_processor": []},
                input_ids=_FakeInputIds(),
                schema=_schema(),
            )

        self.assertEqual(raised.exception.code, "decoder-generation-failed")
        self.assertEqual(raised.exception.error_code, "decoder-generation-failed")
        self.assertEqual(raised.exception.stage, "generation")
        self.assertEqual(model.calls, [])

    def test_sanitizes_model_failures_without_retry(self) -> None:
        class FailingModel(_FakeModel):
            def generate(self, **kwargs):
                self.calls.append(kwargs)
                raise RuntimeError("secret prompt C:\\private\\model stack")

        model = FailingModel()
        decoder = ConstrainedJsonDecoder(
            model,
            _FakeTokenizer(),
            constraint_factory=_constraint_factory({"answer": "ok"}),
            logits_processor_list_factory=lambda processor: [processor],
        )

        with self.assertRaises(ConstrainedJsonDecoderError) as raised:
            decoder.generate(
                generation_inputs={"input_ids": _FakeInputIds()},
                generation_params={"max_new_tokens": 32},
                input_ids=_FakeInputIds(),
                schema=_schema(),
            )

        self.assertEqual(raised.exception.code, "decoder-generation-failed")
        self.assertNotIn("private", str(raised.exception).lower())
        self.assertEqual(len(model.calls), 1)


if __name__ == "__main__":
    unittest.main()
