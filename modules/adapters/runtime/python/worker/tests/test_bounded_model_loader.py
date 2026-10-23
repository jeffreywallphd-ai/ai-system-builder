from __future__ import annotations

from contextlib import nullcontext
import gc
import json
from pathlib import Path
import sys
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from modules.adapters.runtime.python.worker.models import LocalModelConfig
from modules.adapters.runtime.python.worker.tasks import bounded_model_loader as loader
from modules.adapters.runtime.python.worker.tasks.local_model_offload import OffloadAdmissionError
from modules.adapters.runtime.python.worker.tests.test_local_model_offload import CONFIG, TOKENIZER, write_weights


def model_config(**overrides):
    return LocalModelConfig(provider="transformers", modelId="fixture/tiny", inferenceMode="causal",
                            device="cpu", torchDtype="float32", memoryMode="offload-v1", **overrides)


class GenerationBoundsTests(unittest.TestCase):
    def test_capability_requires_the_reviewed_supplier_versions_without_importing_models(self):
        versions = {"transformers": "4.51.3", "accelerate": "1.14.0", "torch": "2.6.0+cu126", "safetensors": "0.5.2"}
        with patch.object(loader.importlib.metadata, "version", side_effect=lambda name: versions[name]), patch.object(loader.importlib.util, "find_spec", return_value=SimpleNamespace()):
            self.assertTrue(loader.offload_runtime_available())
            for name in tuple(versions):
                original = versions[name]
                versions[name] = "99.0"
                self.assertFalse(loader.offload_runtime_available())
                versions[name] = original
        with patch.object(loader.importlib.metadata, "version", side_effect=RuntimeError("synthetic")):
            self.assertFalse(loader.offload_runtime_available())

    def fake_model(self, **settings):
        def forward(input_ids, logits_to_keep=0):
            pass
        return SimpleNamespace(forward=forward, generation_config=SimpleNamespace(**settings))

    def test_full_prompt_and_token_boundary_is_inclusive(self):
        loader.validate_generation_limits(self.fake_model(), SimpleNamespace(shape=(1, 2048)), {"max_new_tokens": 512})

    def test_batch_prompt_generation_and_configuration_expansion_deny(self):
        for shape, tokens, settings in (
            ((2, 10), 256, {}), ((1, 2049), 256, {}), ((1, 0), 256, {}),
            ((1, 10), 513, {}), ((1, 10), True, {}),
            ((1, 10), 256, {"num_beams": 2}), ((1, 10), 256, {"num_return_sequences": 2}),
            ((1, 10), 256, {"output_scores": True}), ((1, 10), 256, {"output_logits": True}),
            ((1, 10), 256, {"cache_implementation": "static"}),
            ((1, 10), 256, {"guidance_scale": 2}), ((1, 10), 256, {"penalty_alpha": 0.6}),
            ((1, 10), 256, {"use_cache": False}), ((1, 10), 256, {"dola_layers": "low"}),
            ((1, 10), 256, {"prompt_lookup_num_tokens": 8}), ((1, 10), 256, {"assistant_early_exit": 2}),
            ((1, 10), 256, {"token_healing": True}),
        ):
            with self.subTest(shape=shape, tokens=tokens, settings=settings):
                with self.assertRaises(OffloadAdmissionError):
                    loader.validate_generation_limits(self.fake_model(**settings), SimpleNamespace(shape=shape), {"max_new_tokens": tokens})

    def test_named_last_token_logits_capability_is_required(self):
        model = self.fake_model()
        model.forward = lambda **kwargs: None
        with self.assertRaises(OffloadAdmissionError):
            loader.validate_generation_limits(model, SimpleNamespace(shape=(1, 10)), {"max_new_tokens": 256})

    def test_unsupported_profile_combinations_deny_before_framework_import(self):
        base = model_config()
        for changes in ({"device": "auto"}, {"torchDtype": "auto"}, {"inferenceMode": "text2text"},
                        {"adapterModelId": "fixture/adapter"}, {"memoryOverflowPolicy": "limited"},
                        {"memoryMode": "standard"}):
            with self.subTest(changes=changes):
                with self.assertRaises(OffloadAdmissionError):
                    loader.validate_offload_config(base.model_copy(update=changes), {"max_new_tokens": 256})
        with self.assertRaises(OffloadAdmissionError):
            loader.validate_offload_config(base, {"max_new_tokens": 256, "num_beams": 8})


class SafeDiskAliasTests(unittest.TestCase):
    def setUp(self):
        self.root = Path("synthetic-model").absolute()
        self.source = "model.embed_tokens.weight"
        self.alias = "lm_head.weight"
        self.inventory = SimpleNamespace(root=self.root, tensors=(SimpleNamespace(
            name=self.source, shard="model.safetensors", shape=(2, 2), dtype="F32"),))
        self.index = {self.source: {"safetensors_file": str(self.root / "model.safetensors"),
                                  "weight_name": self.source, "dtype": "float32"}}
        self.device_map = {"model.embed_tokens": "disk", "lm_head": "disk"}

    def bind(self, index=None, loaded=None):
        return loader._bind_safe_disk_aliases(
            loaded if loaded is not None else (None, [], [], [], self.index if index is None else index, []),
            self.inventory, tied_groups=((self.source, self.alias),), device_map=self.device_map, dtype="float32")

    def test_missing_tied_head_gets_a_separate_exact_canonical_safe_reference(self):
        bound = self.bind()[4]
        self.assertEqual(bound[self.alias], self.index[self.source])
        self.assertIsNot(bound[self.alias], bound[self.source])
        self.assertNotIn(self.alias, self.index)

    def test_source_path_weight_dtype_coverage_and_supplier_shape_denials(self):
        for field, value in (("safetensors_file", str(self.root / "other.safetensors")),
                             ("weight_name", self.alias), ("dtype", "bfloat16")):
            with self.subTest(field=field), self.assertRaises(OffloadAdmissionError):
                self.bind({self.source: {**self.index[self.source], field: value}})
        for value in ({}, {**self.index, self.alias: self.index[self.source]}, {self.source: {**self.index[self.source], "extra": 1}}):
            with self.subTest(index=value), self.assertRaises(OffloadAdmissionError):
                self.bind(value)
        for value in ((), (None,) * 7, (None, [], [], [], None, []), (None, [], [], [], [], [])):
            with self.subTest(loaded=value), self.assertRaises(OffloadAdmissionError):
                self.bind(loaded=value)

    def test_split_group_or_noncanonical_serialized_alias_denies(self):
        self.device_map["lm_head"] = "cpu"
        with self.assertRaises(OffloadAdmissionError):
            self.bind()
        self.device_map["lm_head"] = "disk"
        self.inventory.tensors = (SimpleNamespace(name=self.alias, shard="model.safetensors"),)
        with self.assertRaises(OffloadAdmissionError):
            self.bind({self.alias: {**self.index[self.source], "weight_name": self.alias}})

    def test_separately_serialized_tied_head_is_not_replaced_by_an_alias(self):
        self.inventory.tensors += (SimpleNamespace(name=self.alias, shard="model.safetensors"),)
        with self.assertRaises(OffloadAdmissionError):
            self.bind({**self.index, self.alias: {**self.index[self.source], "weight_name": self.alias}})

    def test_pinned_supplier_exact_alias_lookup_reads_the_canonical_tensor(self):
        # These optional native libraries are already managed by the repository;
        # the inert suite still covers all binding denials when absent.
        try:
            import torch
            from safetensors.torch import save_file
            from accelerate.utils.offload import OffloadedWeightsLoader
        except ImportError:
            self.skipTest("Managed native inference libraries unavailable")
        with TemporaryDirectory() as temporary:
            self.root = Path(temporary).absolute()
            self.inventory.root = self.root
            self.index[self.source]["safetensors_file"] = str(self.root / "model.safetensors")
            expected = torch.arange(4, dtype=torch.float32).reshape(2, 2)
            save_file({self.source: expected}, str(self.root / "model.safetensors"))
            reader = OffloadedWeightsLoader(index=self.bind()[4], device="cpu")
            self.assertTrue(torch.equal(reader[self.alias], expected))

    def test_meta_tie_sentinel_is_removed_without_touching_real_tied_storage(self):
        try:
            from accelerate.hooks import AlignDevicesHook, SequentialHook
        except ImportError:
            self.skipTest("Managed native inference libraries unavailable")
        real = object()
        mapping = {0: {}, 123: {"cpu": real}}
        embedding = AlignDevicesHook(execution_device="cpu", tied_params_map=mapping)
        embedding.tied_params_names = {"weight"}
        norm = AlignDevicesHook(execution_device="cpu", tied_params_map=mapping)
        norm.tied_params_names = {"weight"}
        model = SimpleNamespace(hf_device_map={"": "disk"}, named_modules=lambda: [
            ("model.embed_tokens", SimpleNamespace(_hf_hook=embedding)),
            ("model.norm", SimpleNamespace(_hf_hook=SequentialHook(norm)))])
        loader._bind_dispatch_ties(model, ((self.source, self.alias),))
        self.assertEqual(mapping, {123: {"cpu": real}})
        self.assertEqual(embedding.tied_params_names, {"weight"})
        self.assertEqual(norm.tied_params_names, set())
        mapping[0] = {"cpu": real}
        with self.assertRaises(OffloadAdmissionError):
            loader._bind_dispatch_ties(model, ((self.source, self.alias),))
        model.named_modules = lambda: [("", SimpleNamespace(_hf_hook=object()))]
        with self.assertRaises(OffloadAdmissionError):
            loader._bind_dispatch_ties(model, ())

    def test_loaded_shape_precision_and_parameter_name_drift_deny(self):
        model = SimpleNamespace(named_parameters=lambda **kwargs: [("weight", SimpleNamespace(shape=(2, 2), dtype="torch.float32"))])
        loader._validate_loaded_parameters(model, {"weight": (2, 2)}, "float32")
        for shapes, dtype in (({"weight": (4,)}, "float32"), ({"other": (2, 2)}, "float32"), ({"weight": (2, 2)}, "bfloat16")):
            with self.assertRaises(OffloadAdmissionError):
                loader._validate_loaded_parameters(model, shapes, dtype)


class PinnedLoaderBoundaryTests(unittest.TestCase):
    def setUp(self):
        self.temporary = TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.cache = Path(self.temporary.name).absolute()
        self.root = self.cache / "snapshot"
        self.root.mkdir()
        (self.root / "config.json").write_text(json.dumps(CONFIG), encoding="utf-8")
        (self.root / "tokenizer.json").write_text(json.dumps(TOKENIZER), encoding="utf-8")
        (self.root / "tokenizer_config.json").write_text("{}", encoding="utf-8")
        write_weights(self.root / "model.safetensors")
        self.calls = []
        self.holders = []
        self.failure = None
        self.information = {"missing_keys": [], "unexpected_keys": [], "mismatched_keys": [], "error_msgs": []}
        owner = self

        class FakeQwen:
            def __init__(self, config):
                self.parameter = SimpleNamespace(shape=(2, 2), dtype="torch.float32")
                self.hf_device_map = {"model.embed_tokens": "cpu"}
            def tie_weights(self):
                pass
            def state_dict(self):
                return {"model.embed_tokens.weight": self.parameter}
            def named_parameters(self, **kwargs):
                return self.state_dict().items()
            def named_modules(self):
                return [("model.embed_tokens", self)]
            def named_buffers(self):
                return []
            def children(self):
                return []
            @classmethod
            def from_pretrained(cls, reference, **kwargs):
                owner.calls.append((reference, kwargs))
                model = cls(kwargs["config"])
                if owner.failure == "retained":
                    owner.holders.append(model)
                    raise RuntimeError("synthetic-private-load-error")
                if owner.failure == "load":
                    try:
                        raise ValueError("synthetic-inner-private-detail")
                    except ValueError as error:
                        raise RuntimeError("synthetic-private-load-error") from error
                return model, owner.information

        tokenizer = SimpleNamespace(pad_token_id=0, eos_token_id=1, chat_template="template")
        self.modules = {
            "torch": SimpleNamespace(float32="float32", float16="float16", bfloat16="bfloat16", cuda=SimpleNamespace(is_available=lambda: True)),
            "accelerate": SimpleNamespace(init_empty_weights=lambda **kwargs: nullcontext(), infer_auto_device_map=self.infer),
            "transformers": SimpleNamespace(Qwen2TokenizerFast=SimpleNamespace(from_pretrained=self.tokenizer),
                Qwen2Config=SimpleNamespace(from_dict=lambda value: value), Qwen2ForCausalLM=FakeQwen),
        }
        self.tokenizer_value = tokenizer
        loader._RETAINED_LEASES.clear()

    def tearDown(self):
        self.holders.clear()
        gc.collect()
        loader.retry_retained_offload_cleanup()

    def infer(self, model, **kwargs):
        self.map_options = kwargs
        return {"model.embed_tokens": "cpu"}

    def tokenizer(self, reference, **kwargs):
        self.tokenizer_options = kwargs
        return self.tokenizer_value

    def load(self):
        with patch.dict(sys.modules, self.modules), patch.object(loader, "offload_runtime_available", return_value=True):
            return loader.load_bounded_local_model(model_config(), {"max_new_tokens": 256}, reference=self.root, cache_root=self.cache,
                read_memory=lambda: SimpleNamespace(available_bytes=8 * 1024**3), read_cuda_memory=lambda: 0)

    def test_pinned_safe_weight_call_uses_bounded_meta_map_and_no_secondary_temp(self):
        bundle = self.load()
        options = self.calls[0][1]
        self.assertTrue(options["local_files_only"])
        self.assertFalse(options["trust_remote_code"])
        self.assertTrue(options["use_safetensors"])
        self.assertTrue(options["weights_only"])
        self.assertTrue(options["low_cpu_mem_usage"])
        self.assertFalse(options["offload_state_dict"])
        self.assertFalse(options["offload_buffers"])
        self.assertEqual(options["torch_dtype"], "float32")
        self.assertEqual(self.map_options["max_memory"], {"cpu": 1024**3})
        self.assertFalse(self.map_options["fallback_allocation"])
        self.assertEqual(self.map_options["no_split_module_classes"], ["Qwen2DecoderLayer"])
        self.assertEqual(self.tokenizer_options, {"local_files_only": True, "trust_remote_code": False,
            "tokenizer_file": str(self.root / "tokenizer.json"), "vocab_file": None, "merges_file": None})
        bundle.model = None
        bundle.tokenizer = None
        loader.release_offload_lease(bundle.lease, bundle.model_references)
        self.assertTrue(bundle.lease.released)
        self.assertTrue((self.root / "model.safetensors").exists())

    def test_nested_supplier_load_failure_has_no_live_reference_or_stage_leak(self):
        self.failure = "load"
        with self.assertRaises(OffloadAdmissionError) as caught:
            self.load()
        self.assertNotIn("private", str(caught.exception))
        self.assertFalse((self.cache / ".aisb-offload-v1" / "active").exists())
        self.assertFalse(loader._RETAINED_LEASES)

    def test_retained_partial_model_keeps_slot_until_actual_release(self):
        self.failure = "retained"
        with self.assertRaises(OffloadAdmissionError):
            self.load()
        self.assertTrue((self.cache / ".aisb-offload-v1" / "active").exists())
        self.assertEqual(len(loader._RETAINED_LEASES), 1)
        with self.assertRaises(OffloadAdmissionError):
            loader.retry_retained_offload_cleanup()
        self.holders.clear()
        loader.retry_retained_offload_cleanup()
        self.assertFalse((self.cache / ".aisb-offload-v1" / "active").exists())

    def test_missing_or_unexpected_weights_deny_and_release_owned_staging(self):
        for information in ({"missing_keys": ["missing.weight"]}, {"unexpected_keys": ["unexpected.weight"]},
                            {"mismatched_keys": ["bad.weight"]}, {"error_msgs": ["private"]}):
            with self.subTest(information=information):
                self.information = information
                with self.assertRaises(OffloadAdmissionError):
                    self.load()
                self.assertFalse((self.cache / ".aisb-offload-v1" / "active").exists())

    def test_all_disk_map_denies_before_model_and_staging(self):
        self.modules["accelerate"].infer_auto_device_map = lambda *args, **kwargs: {"": "disk"}
        with self.assertRaises(OffloadAdmissionError):
            self.load()
        self.assertFalse(self.calls)
        self.assertFalse((self.cache / ".aisb-offload-v1").exists())

    def test_resource_admission_reserves_transients_before_final_resident_placement(self):
        original = loader.plan_resources
        calls = []
        def observed(config, **facts):
            calls.append(facts["cpu_weight_bytes"])
            return original(config, **facts)
        with patch.object(loader, "plan_resources", side_effect=observed):
            bundle = self.load()
        self.assertEqual(calls, [0, 16])
        bundle.model = None
        bundle.tokenizer = None
        loader.release_offload_lease(bundle.lease, bundle.model_references)

    def test_tokenizer_external_paths_and_alternate_selectors_deny_before_supplier(self):
        outside = self.cache / "outside-private.json"
        outside.write_text("synthetic-private-content", encoding="utf-8")
        original = Path.open
        def checked_open(path, *args, **kwargs):
            self.assertNotEqual(path, outside, "External tokenizer input was opened")
            return original(path, *args, **kwargs)
        for settings in ({"tokenizer_file": str(outside)}, {"vocab_file": str(outside)},
                         {"merges_file": str(outside)}, {"fast_tokenizer_files": [str(outside)]},
                         {"tokenizer_class": "CustomTokenizer"}, {"chat_template": "{{ 'x' * 999999999 }}"}):
            with self.subTest(settings=settings):
                (self.root / "tokenizer_config.json").write_text(json.dumps(settings), encoding="utf-8")
                with patch.object(Path, "open", new=checked_open):
                    with self.assertRaises(OffloadAdmissionError):
                        self.load()
                self.assertFalse(self.calls)
                self.assertFalse(hasattr(self, "tokenizer_options"))

    def test_adapter_discovery_denies_before_tokenizer_model_or_owned_staging(self):
        for name in ("adapter_config.json", "ADAPTER_CONFIG.JSON", "adapter_model.safetensors",
                     "adapter_model.fp16.safetensors", "adapter_model.bin"):
            with self.subTest(name=name):
                target = self.root / name
                target.write_text('{"base_model_name_or_path":"unadmitted-local-model"}', encoding="utf-8")
                try:
                    with self.assertRaises(OffloadAdmissionError):
                        self.load()
                    self.assertFalse(self.calls)
                    self.assertFalse(hasattr(self, "tokenizer_options"))
                    self.assertFalse((self.cache / ".aisb-offload-v1" / "active").exists())
                finally:
                    target.unlink()

    def test_tied_checkpoint_requires_canonical_input_embeddings(self):
        parameter = SimpleNamespace(shape=(2, 2))
        names = ("model.embed_tokens.weight", "lm_head.weight")
        skeleton = SimpleNamespace(
            state_dict=lambda: dict.fromkeys(names, parameter),
            named_parameters=lambda **kwargs: dict.fromkeys(names, parameter).items(),
            named_modules=lambda: [("model.embed_tokens", SimpleNamespace(children=lambda: [])), ("lm_head", SimpleNamespace(children=lambda: []))],
        )
        entry = SimpleNamespace(name=names[0], dtype="F32", shape=(2, 2), elements=4)
        sizes, tied, groups, largest = loader._planning_inputs(skeleton, SimpleNamespace(tensors=(entry,)), 4)
        self.assertEqual(tied, (names,))
        self.assertEqual(largest, 16)
        entry.name = names[1]
        with self.assertRaises(OffloadAdmissionError):
            loader._planning_inputs(skeleton, SimpleNamespace(tensors=(entry,)), 4)


if __name__ == "__main__":
    unittest.main()
