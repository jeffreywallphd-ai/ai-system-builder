"""Model-free input semantics and positive discovery-denial boundaries."""
from dataclasses import replace
import json
import hashlib
from pathlib import Path
from types import SimpleNamespace
from tempfile import TemporaryDirectory
import unittest
import warnings
from unittest.mock import patch

from modules.adapters.runtime.python.worker.tasks import bounded_model_inputs as inputs
from modules.adapters.runtime.python.worker.tasks import bounded_model_loader as loader
from modules.adapters.runtime.python.worker.tasks import local_model_offload as offload
from modules.adapters.runtime.python.worker.tasks.local_model_offload import inspect_local_model, OffloadAdmissionError
from modules.adapters.runtime.python.worker.tests.test_local_model_offload import CONFIG, TOKENIZER, write_weights
from modules.adapters.runtime.python.worker.tests import test_bounded_model_loader as fixtures


class AddedToken:
    def __init__(self, content, **flags):
        self.content, self.flags = content, flags
    def __str__(self):
        return self.content
    def __eq__(self, other):
        return type(other) is AddedToken and self.content == other.content and self.flags == other.flags


class AdmittedInputTests(unittest.TestCase):
    def setUp(self):
        self.temp = TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).absolute()
        self.write("config.json", CONFIG)
        self.write("tokenizer.json", TOKENIZER)
        self.write("tokenizer_config.json", {})
        write_weights(self.root / "model.safetensors")

    def write(self, name, data):
        (self.root / name).write_text(json.dumps(data), encoding="utf8")

    def admitted(self):
        return inputs.AdmittedModelInputs.from_inventory(inspect_local_model(self.root))

    def test_single_and_sharded_maps_come_from_complete_inspected_tensors(self):
        one = self.admitted()
        self.assertEqual(one.sharded_metadata(), {"all_checkpoint_keys": ["model.embed_tokens.weight"],
            "weight_map": {"model.embed_tokens.weight": "model.safetensors"}})
        (self.root / "model.safetensors").unlink()
        keys = ["model.embed_tokens.weight", "model.norm.weight"]
        shards = ["model-00001-of-00002.safetensors", "model-00002-of-00002.safetensors"]
        for key, shard in zip(keys, shards):
            write_weights(self.root / shard, {key: {"dtype": "F32", "shape": [2, 2], "data_offsets": [0, 16]}})
        self.write("model.safetensors.index.json", {"metadata": {}, "weight_map": dict(zip(keys, shards))})
        two = self.admitted()
        self.assertEqual(two.checkpoint_files, tuple(str(self.root / name) for name in shards))
        self.assertEqual(two.weight_map, dict(zip(keys, shards)))
        self.assertEqual(set(two.sharded_metadata()["all_checkpoint_keys"]), set(keys))

    def test_modern_decoder_preserves_flags_ids_null_and_ignores_legacy_maps(self):
        self.write("tokenizer_config.json", {"bos_token": None, "eos_token": "finish", "add_prefix_space": True,
            "clean_up_tokenization_spaces": False, "added_tokens_decoder": {"12": {
                "content": "finish", "lstrip": True, "rstrip": False, "normalized": False, "special": True}}})
        self.write("special_tokens_map.json", {"eos_token": "legacy"})
        self.write("added_tokens.json", {"legacy": 13})
        settings = self.admitted().tokenizer_kwargs(AddedToken)
        self.assertIsNone(settings["bos_token"])
        self.assertTrue(settings["add_prefix_space"])
        self.assertFalse(settings["clean_up_tokenization_spaces"])
        self.assertEqual(settings["eos_token"].flags, {"lstrip": True, "rstrip": False, "normalized": False, "special": True})
        self.assertEqual(set(settings["added_tokens_decoder"]), {12})
        self.assertIs(settings["eos_token"], settings["added_tokens_decoder"][12])

    def test_legacy_special_map_and_json_added_token_precedence(self):
        self.write("tokenizer_config.json", {"eos_token": "config", "additional_special_tokens": ["keep"]})
        self.write("special_tokens_map.json", {"eos_token": {"content": "map", "lstrip": True},
            "additional_special_tokens": ["extra"]})
        self.write("added_tokens.json", {"legacy": 4})
        self.write("tokenizer.json", {**TOKENIZER, "added_tokens": [
            {"id": 4, "content": "json-wins", "special": False, "normalized": True}]})
        settings = self.admitted().tokenizer_kwargs(AddedToken)
        self.assertEqual(str(settings["eos_token"]), "map")
        self.assertEqual(settings["eos_token"].flags, {"lstrip": True, "special": True})
        self.assertEqual([str(item) for item in settings["additional_special_tokens"]], ["keep", "extra"])
        self.assertEqual(str(settings["added_tokens_decoder"][4]), "json-wins")

    def test_changed_missing_unbound_and_traversing_inputs_deny(self):
        inventory = inspect_local_model(self.root)
        self.write("tokenizer_config.json", {"eos_token": "mutated"})
        with self.assertRaises(OffloadAdmissionError): inputs.AdmittedModelInputs.from_inventory(inventory)
        (self.root / "tokenizer_config.json").unlink()
        with self.assertRaises(OffloadAdmissionError): inputs.AdmittedModelInputs.from_inventory(inventory)
        self.write("tokenizer_config.json", {})
        for changed in (replace(inventory, bindings=tuple(row for row in inventory.bindings if row[0] != "tokenizer.json")),
                        replace(inventory, tensors=(replace(inventory.tensors[0], shard="../private.safetensors"),))):
            with self.assertRaises(OffloadAdmissionError): inputs.AdmittedModelInputs.from_inventory(changed)

    def test_deep_excess_nodes_duplicate_nonfinite_and_private_fields_deny(self):
        for raw in ('{"x":1,"x":2}', '{"x":NaN}', '{"x":' * 35 + '0' + '}' * 35):
            (self.root / "generation_config.json").write_text(raw, encoding="utf8")
            with self.assertRaises(OffloadAdmissionError): self.admitted()
        self.write("generation_config.json", {"eos_token_id": 2})
        with patch.object(inputs, "_MAX_NODES", 2), self.assertRaises(OffloadAdmissionError): self.admitted()
        for value in ({"from_slow": True}, {"gguf_file": "other"}, {"auto_map": {}}, {"tokenizer_file": "other"}):
            self.write("tokenizer_config.json", value)
            with self.assertRaises(OffloadAdmissionError): self.admitted()

    def test_absent_generation_and_explicit_values_are_distinct(self):
        self.assertIsNone(self.admitted().generation)
        self.write("generation_config.json", {"eos_token_id": None, "do_sample": False})
        self.assertEqual(self.admitted().generation, {"eos_token_id": None, "do_sample": False})
        self.assertNotIn("synthetic", repr(self.admitted()))

    def test_private_numeric_field_payloads_deny_before_supplier_diagnostics(self):
        for settings in ({"temperature": "synthetic-private-text"}, {"top_k": True},
                         {"do_sample": "private"}, {"__dict__": {}}, {"repetition_penalty": []}):
            self.write("generation_config.json", settings)
            with self.assertRaises(OffloadAdmissionError): self.admitted()

    def test_standalone_template_wins_over_explicit_null_without_resolving_a_directory(self):
        # Synthetic allowlisted template exercises precedence. The production
        # allowlist remains unchanged, and arbitrary templates still deny.
        template = "synthetic-template"
        self.write("tokenizer_config.json", {"chat_template": None})
        (self.root / "chat_template.jinja").write_text(template, encoding="utf8")
        with patch.object(offload, "_SUPPORTED_CHAT_TEMPLATE", hashlib.sha256(template.encode()).hexdigest()):
            self.assertEqual(self.admitted().tokenizer_kwargs(AddedToken)["chat_template"], template)


class IntegratedDiscoveryFreeTests(unittest.TestCase):
    # Reuse setup mechanics, not legacy TestCase discovery. The separate fake
    # supplier suite still checks all nineteen original pure cases once.
    setUp = fixtures.PinnedLoaderBoundaryTests.setUp
    tearDown = fixtures.PinnedLoaderBoundaryTests.tearDown
    infer = fixtures.PinnedLoaderBoundaryTests.infer
    tokenizer = fixtures.PinnedLoaderBoundaryTests.tokenizer
    dispatch = fixtures.PinnedLoaderBoundaryTests.dispatch
    load = fixtures.PinnedLoaderBoundaryTests.load

    def test_constructor_failure_restores_exact_shared_dtype_and_releases_lease(self):
        self.failure = "init"
        self.default_dtype = "bfloat16"
        with self.assertRaises(OffloadAdmissionError):
            self.load()
        self.assertEqual(self.default_dtype, "bfloat16")
        self.assertFalse((self.cache / ".aisb-offload-v1" / "active").exists())
        self.assertFalse(loader._RETAINED_LEASES)

    def close(self, bundle):
        bundle.model = None; bundle.tokenizer = None
        loader.release_offload_lease(bundle.lease, bundle.model_references)

    def test_successful_path_cannot_call_outer_model_or_tokenizer_resolvers(self):
        # The fake model's from_pretrained is a hard denial. Tokenizer is a
        # constructor-only callable (no resolver); no real frameworks import.
        with patch("socket.create_connection", side_effect=AssertionError("No network")), \
             patch("tempfile.mkdtemp", side_effect=AssertionError("No supplier temp")):
            bundle = self.load()
        try:
            self.assertIsNone(self.calls[0][0])
            self.assertNotIn("name_or_path", self.tokenizer_options)
            self.assertNotIn("tokenizer_file", self.tokenizer_options)
            self.assertIsNone(self.calls[0][1]["hf_quantizer"])
            self.assertIsNone(self.calls[0][1]["key_mapping"])
        finally: self.close(bundle)

    def test_valid_two_shard_load_uses_explicit_map_without_any_directory_resolver(self):
        base = self.modules["transformers"].Qwen2ForCausalLM
        class TwoTensorQwen(base):
            def state_dict(self):
                return {"model.embed_tokens.weight": self.parameter, "model.norm.weight": self.parameter2}
            def __init__(self, config):
                super().__init__(config)
                self.parameter2 = SimpleNamespace(shape=(2, 2), dtype="torch.float32")
            def named_modules(self):
                return [("model.embed_tokens", SimpleNamespace(children=lambda: [])),
                        ("model.norm", SimpleNamespace(children=lambda: []))]
        self.modules["transformers"].Qwen2ForCausalLM = TwoTensorQwen
        self.modules["accelerate"].infer_auto_device_map = lambda *args, **kwargs: {"": "cpu"}
        (self.root / "model.safetensors").unlink()
        weight_map = {"model.embed_tokens.weight": "model-00001-of-00002.safetensors",
                      "model.norm.weight": "model-00002-of-00002.safetensors"}
        for name, shard in weight_map.items():
            write_weights(self.root / shard, {name: {"dtype": "F32", "shape": [2, 2], "data_offsets": [0, 16]}})
        (self.root / "model.safetensors.index.json").write_text(json.dumps({"weight_map": weight_map}), encoding="utf8")
        with patch("socket.create_connection", side_effect=AssertionError("No network")), \
             patch("tempfile.mkdtemp", side_effect=AssertionError("No supplier temp")):
            bundle = self.load()
        try:
            self.assertEqual(self.calls[0][1]["sharded_metadata"]["weight_map"], weight_map)
            self.assertEqual(self.calls[0][1]["checkpoint_files"], [str(self.root / name) for name in weight_map.values()])
            self.assertEqual(self.dispatch_options["device_map"], {"": "cpu"})
        finally: self.close(bundle)

    def test_generation_defaults_use_native_config_and_file_overrides_are_preserved(self):
        config = {**CONFIG, "eos_token_id": 3, "pad_token_id": 0}
        (self.root / "config.json").write_text(json.dumps(config), encoding="utf8")
        bundle = self.load()
        try: self.assertEqual(bundle.model.generation_config.eos_token_id, 3)
        finally: self.close(bundle)
        (self.root / "generation_config.json").write_text('{"eos_token_id":null,"do_sample":false}', encoding="utf8")
        bundle = self.load()
        try:
            self.assertIsNone(bundle.model.generation_config.eos_token_id)
            self.assertFalse(bundle.model.generation_config.do_sample)
        finally: self.close(bundle)

    def test_expanding_generation_defaults_deny_before_weight_loader_and_dispatch(self):
        (self.root / "generation_config.json").write_text('{"num_beams":2}', encoding="utf8")
        with self.assertRaises(OffloadAdmissionError): self.load()
        self.assertFalse(self.calls)
        self.assertFalse(hasattr(self, "dispatch_options"))
        self.assertFalse((self.cache / ".aisb-offload-v1" / "active").exists())

    def test_supplier_validation_warning_cannot_escape_with_private_metadata(self):
        base = self.modules["transformers"].GenerationConfig
        class WarningConfig(base):
            def __init__(self, **kwargs):
                warnings.warn("synthetic-private-metadata", UserWarning)
                super().__init__(**kwargs)
        self.modules["transformers"].GenerationConfig = WarningConfig
        (self.root / "generation_config.json").write_text('{"do_sample":true,"temperature":0.7}', encoding="utf8")
        with warnings.catch_warnings(record=True) as escaped:
            warnings.simplefilter("always")
            bundle = self.load()
        try:
            self.assertEqual(escaped, [])
            self.assertTrue(bundle.model.generation_config.do_sample)
            self.assertEqual(bundle.model.generation_config.temperature, 0.7)
        finally: self.close(bundle)


if __name__ == "__main__": unittest.main()
