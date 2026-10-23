from __future__ import annotations

from pathlib import Path
from contextlib import redirect_stdout
import io
import json
import sys
import weakref
from threading import Lock
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

from modules.adapters.runtime.python.worker.models import ExampleGenerationConfig, LocalModelConfig
from modules.adapters.runtime.python.worker.tasks import local_text_generation as generation
from modules.adapters.runtime.python.worker.tasks import example_generation as examples
from modules.adapters.runtime.python.worker.tasks.markdown_chunking import MarkdownChunk
from modules.adapters.runtime.python.worker.tasks.local_model_offload import OffloadAdmissionError


class BoundedGeneratorTests(unittest.TestCase):
    def setUp(self):
        self.previous_cache = dict(generation._GENERATOR_CACHE)
        self.previous_references = dict(generation._RESOLVED_MODEL_REFERENCES)
        generation._GENERATOR_CACHE.clear()
        self.reference = Path.cwd() / "synthetic-local-model"
        generation._RESOLVED_MODEL_REFERENCES["fixture/model"] = str(self.reference)
        self.calls = []
        self.moves = []
        self.token_count = 2
        owner = self
        class Tokenizer:
            pad_token_id = 0
            eos_token_id = 1
            def __call__(self, prompt, **kwargs):
                owner.tokenizer_options = kwargs
                return {"input_ids": SimpleNamespace(shape=(1, owner.token_count), to=lambda device: owner.moves.append(device))}
            def decode(self, tokens, **kwargs):
                return "synthetic-answer"
        def forward(input_ids, logits_to_keep=0):
            pass
        def generate(**kwargs):
            self.calls.append(kwargs)
            return [[1, 2, 9]]
        model = SimpleNamespace(forward=forward, generation_config=SimpleNamespace(), generate=generate,
            to=Mock(side_effect=AssertionError("unsafe model rematerialization")), cpu=Mock(side_effect=AssertionError("unsafe model rematerialization")),
            state_dict=Mock(side_effect=AssertionError("unsafe model rematerialization")))
        self.model = model
        self.generator = object.__new__(generation.BoundedOffloadGenerator)
        self.generator._owner = self.generator
        self.generator._model_id = "fixture/model"
        self.generator._operation_lock = Lock()
        self.generator._closed = False
        self.generator._poisoned = False
        self.generator._decoder = None
        self.generator._generation_params = {"max_new_tokens": 32}
        self.generator._bundle = SimpleNamespace(model=model, tokenizer=Tokenizer(), inference_mode="causal",
            inventory=SimpleNamespace(root=self.reference, source_digest="synthetic", verify_unchanged=Mock()),
            resources=SimpleNamespace(cpu_required_bytes=100, cpu_weight_bytes=0, cuda_required_bytes=0, cuda_weight_bytes=0),
            lease=SimpleNamespace(), model_references=[])
        self.path_patch = patch.object(generation, "_validate_huggingface_snapshot_path")
        self.memory_patch = patch.object(generation, "_read_system_memory_snapshot", return_value=SimpleNamespace(available_bytes=1024**3))
        self.path_patch.start(); self.memory_patch.start()

    def tearDown(self):
        self.path_patch.stop(); self.memory_patch.stop()
        generation._GENERATOR_CACHE.clear(); generation._GENERATOR_CACHE.update(self.previous_cache)
        generation._RESOLVED_MODEL_REFERENCES.clear(); generation._RESOLVED_MODEL_REFERENCES.update(self.previous_references)

    def test_shared_cached_weights_do_not_share_request_generation_parameters(self):
        first = self.generator.for_request({"max_new_tokens": 32})
        second = self.generator.for_request({"max_new_tokens": 64})
        self.assertEqual(first.generate_text("Synthetic request"), "synthetic-answer")
        self.assertEqual(second.generate_text("Synthetic request"), "synthetic-answer")
        self.assertEqual([call["max_new_tokens"] for call in self.calls], [32, 64])
        self.assertEqual(self.tokenizer_options["max_length"], 2049)
        self.assertTrue(self.tokenizer_options["truncation"])

    def test_overflow_sentinel_denies_without_generation_or_device_transfer(self):
        self.token_count = 2049
        with self.assertRaises(OffloadAdmissionError):
            self.generator.generate_text("Synthetic oversized request")
        self.assertFalse(self.calls)
        self.assertFalse(self.moves)

    def test_forward_resource_denial_is_truthful_and_does_not_poison_an_unstarted_forward(self):
        with patch.object(generation, "_read_system_memory_snapshot", return_value=SimpleNamespace(available_bytes=99)), redirect_stdout(io.StringIO()) as output:
            with self.assertRaises(generation.GenerationInsufficientResourcesError):
                self.generator.generate_text("Synthetic request")
        self.assertEqual(json.loads(output.getvalue()), {"event": "runtime.generation_model.forward_resources_insufficient",
            "availableMemoryBytes": 99, "requiredMemoryBytes": 100,
            "availableAcceleratorMemoryBytes": 0, "requiredAcceleratorMemoryBytes": 0})
        self.assertFalse(self.calls)
        self.assertFalse(self.generator._poisoned)
        self.assertEqual(self.generator.generate_text("Synthetic retry"), "synthetic-answer")

    def test_forward_resource_failure_is_not_wrapped_as_inference_or_hidden_by_skip(self):
        config = ExampleGenerationConfig(mode="qa", failurePolicy="skip", model=LocalModelConfig(provider="transformers", modelId="fixture/model"))
        chunk = MarkdownChunk("synthetic-source", 0, "Synthetic source.")
        fake = SimpleNamespace(generate_text=Mock(side_effect=generation.GenerationInsufficientResourcesError("Insufficient current memory.")))
        with patch.object(examples, "get_or_create_local_text_generator", return_value=fake):
            with self.assertRaises(generation.GenerationInsufficientResourcesError):
                examples.generate_qa_examples_for_chunks([chunk], config)
            with self.assertRaises(generation.GenerationInsufficientResourcesError):
                examples.generate_task_examples_for_chunks([chunk], config, "llm-classification", {"labelSet": ["ready", "other"]})

    def test_unknown_host_or_insufficient_accelerator_headroom_denies_without_forward(self):
        self.generator._bundle.resources.cuda_required_bytes = 200
        for memory in (None, SimpleNamespace(available_bytes=1000)):
            with self.subTest(known_memory=memory is not None), \
                    patch.object(generation, "_read_system_memory_snapshot", return_value=memory), \
                    patch.object(generation, "_available_cuda_memory_bytes", return_value=199), \
                    redirect_stdout(io.StringIO()):
                with self.assertRaises(generation.GenerationInsufficientResourcesError):
                    self.generator.generate_text("Synthetic request")
                self.assertFalse(self.calls)
                self.assertFalse(self.generator._poisoned)

    def test_rebound_or_changed_source_denies_before_every_forward(self):
        generation._RESOLVED_MODEL_REFERENCES["fixture/model"] = str(self.reference.parent / "replacement")
        with self.assertRaises(OffloadAdmissionError):
            self.generator.generate_text("Synthetic request")
        self.assertFalse(self.calls)
        generation._RESOLVED_MODEL_REFERENCES["fixture/model"] = str(self.reference)
        self.generator._bundle.inventory.verify_unchanged.side_effect = OffloadAdmissionError()
        with self.assertRaises(OffloadAdmissionError):
            self.generator.generate_text("Synthetic request")
        self.assertFalse(self.calls)

    def test_close_invalidates_all_views_without_moving_or_reconstructing_model(self):
        view = self.generator.for_request({"max_new_tokens": 64})
        self.generator._decoder = SimpleNamespace(model=self.model)
        with patch.object(generation, "release_offload_lease") as release:
            self.generator.close()
        release.assert_called_once()
        self.assertIsNone(self.generator._bundle.model)
        self.assertIsNone(self.generator._bundle.tokenizer)
        self.assertIsNone(self.generator._decoder)
        for method in (self.model.to, self.model.cpu, self.model.state_dict):
            method.assert_not_called()
        with self.assertRaises(OffloadAdmissionError):
            view.generate_text("Synthetic request")

    def test_context_or_conversation_cannot_implicitly_acquire_dataset_offload(self):
        config = ExampleGenerationConfig(mode="qa", model=LocalModelConfig(provider="transformers", modelId="fixture/model", inferenceMode="causal", device="cpu", torchDtype="float32", memoryMode="offload-v1"))
        with patch.object(generation, "load_bounded_local_model") as load:
            with self.assertRaises(generation.GenerationInsufficientResourcesError):
                generation.get_or_create_local_text_generator(config)
        load.assert_not_called()

    def test_interrupted_supplier_forward_denies_all_cached_views_until_unload(self):
        view = self.generator.for_request({"max_new_tokens": 32})
        self.model.generate = Mock(side_effect=RuntimeError("synthetic interrupted offload forward"))
        with self.assertRaises(RuntimeError):
            view.generate_text("Synthetic request")
        self.assertTrue(self.generator._poisoned)
        with self.assertRaises(OffloadAdmissionError):
            view.generate_text("Synthetic retry")
        with self.assertRaises(OffloadAdmissionError):
            self.generator.for_request({"max_new_tokens": 32})
        self.assertEqual(self.model.generate.call_count, 1)
        with patch.object(generation, "release_offload_lease") as release:
            self.generator.close()
        release.assert_called_once()

    def test_completed_decoder_output_validation_keeps_bounded_repair_available(self):
        for code in ("decoder-output-invalid", "decoder-output-empty", "decoder-output-truncated"):
            decoder = SimpleNamespace(generate=Mock(side_effect=generation.ConstrainedJsonDecoderError(code, "synthetic invalid output")))
            self.generator._decoder = decoder
            with self.assertRaises(generation.ConstrainedJsonDecoderError):
                self.generator.generate_text("Synthetic request", constrained_json_schema={"type": "object"})
            self.assertFalse(self.generator._poisoned)
            self.generator.for_request({"max_new_tokens": 32})


class GenerationUnloadOrderingTests(unittest.TestCase):
    def setUp(self):
        self.previous_cache = dict(generation._GENERATOR_CACHE)
        generation._GENERATOR_CACHE.clear()

    def tearDown(self):
        generation._GENERATOR_CACHE.clear()
        generation._GENERATOR_CACHE.update(self.previous_cache)

    def test_last_standard_owner_is_gone_before_collection_and_allocator_release(self):
        class StandardGenerator:
            pass
        generation._GENERATOR_CACHE[("synthetic-standard",)] = StandardGenerator()
        observed = weakref.ref(generation._GENERATOR_CACHE[("synthetic-standard",)])
        real_collect = generation.gc.collect
        steps = []
        def collect():
            self.assertIsNone(observed())
            steps.append("collect")
            return real_collect()
        def empty_cache():
            self.assertIsNone(observed())
            self.assertFalse(generation._GENERATOR_CACHE)
            steps.append("allocator")
        torch = SimpleNamespace(cuda=SimpleNamespace(is_available=lambda: True, empty_cache=empty_cache))
        with patch.object(generation, "_describe_loaded_generation_models_unlocked", return_value=[]), \
                patch.object(generation, "retry_retained_offload_cleanup"), \
                patch.object(generation.gc, "collect", side_effect=collect), \
                patch.dict(sys.modules, {"torch": torch}):
            self.assertEqual(generation.unload_generation_models(), [])
        self.assertEqual(steps, ["collect", "allocator"])

    def test_empty_cache_still_collects_and_releases_allocator(self):
        torch = SimpleNamespace(cuda=SimpleNamespace(is_available=lambda: True, empty_cache=Mock()))
        with patch.object(generation, "_describe_loaded_generation_models_unlocked", return_value=[]), \
                patch.object(generation, "retry_retained_offload_cleanup"), \
                patch.object(generation.gc, "collect") as collect, \
                patch.dict(sys.modules, {"torch": torch}):
            self.assertEqual(generation.unload_generation_models(), [])
        collect.assert_called_once()
        torch.cuda.empty_cache.assert_called_once()

    def test_failed_offload_close_retains_cache_owner_and_does_not_claim_release(self):
        class UncertainOffload:
            def close(self):
                raise OffloadAdmissionError()
        owner = UncertainOffload()
        generation._GENERATOR_CACHE[("synthetic-offload",)] = owner
        with patch.object(generation, "BoundedOffloadGenerator", UncertainOffload), \
                patch.object(generation, "_describe_loaded_generation_models_unlocked", return_value=[]), \
                patch.object(generation.gc, "collect") as collect, \
                patch.object(generation, "retry_retained_offload_cleanup") as retry:
            with self.assertRaises(OffloadAdmissionError):
                generation.unload_generation_models()
        self.assertIs(generation._GENERATOR_CACHE[("synthetic-offload",)], owner)
        collect.assert_not_called()
        retry.assert_not_called()


if __name__ == "__main__":
    unittest.main()
