from __future__ import annotations

from collections.abc import Mapping
import json
from pathlib import Path
from shutil import rmtree
import sys
from tempfile import TemporaryDirectory
from threading import Thread
from types import SimpleNamespace
import unittest
from os import environ
from unittest.mock import patch

from modules.adapters.runtime.python.worker.models import ExampleGenerationConfig, LocalModelConfig
from modules.adapters.runtime.python.worker.tasks.local_text_generation import (
    CHECKPOINT_SNAPSHOT_PROFILE,
    DEFAULT_MAX_NEW_TOKENS,
    GENERIC_TRANSFORMERS_SNAPSHOT_PROFILE,
    GenerationInsufficientResourcesError,
    GenerationModelDownloadError,
    GenerationModelDownloadInvalidError,
    GenerationModelLoadError,
    GenerationRuntimeDependencyError,
    _attach_lora_adapter,
    _GENERATOR_CACHE,
    _GENERATOR_CACHE_LOCK,
    _RESOLVED_MODEL_REFERENCES,
    _SystemMemorySnapshot,
    _create_structured_snapshot_tqdm,
    _ensure_model_load_resources,
    _start_snapshot_cache_progress_monitor,
    _resolve_snapshot_download_profile,
    _structured_huggingface_file_progress,
    _validate_snapshot_profile_result,
    _move_tokenized_inputs_to_model_device,
    _resolve_generation_params,
    _resolve_model_kwargs,
    _supports_manual_device_move,
    configure_huggingface_download_environment,
    describe_loaded_generation_models,
    ensure_generation_model_downloaded,
    ensure_generation_adapter_is_available,
    ensure_generation_model_is_available,
    get_or_create_local_text_generator,
)
from modules.adapters.runtime.python.worker.tasks.constrained_json_decoder import (
    ConstrainedJsonDecoderError,
)


class _FakeTensor:
    def __init__(self, values: list[int]):
        self.values = values
        self.shape = (1, len(values))
        self.moved_to = None

    def __getitem__(self, item):
        return self.values[item]

    def to(self, device):
        self.moved_to = device
        return self


class _FakeTokenizer:
    supports_chat = True
    pad_token_id = 0
    eos_token_id = 99

    def __init__(self):
        self.message_calls: list[list[dict[str, str]]] = []

    def __call__(self, prompt: str, return_tensors: str = "pt"):
        del return_tensors
        if prompt == "prompt":
            return {"input_ids": _FakeTensor([11, 22, 33])}
        return {"input_ids": _FakeTensor([1, 2, 3])}

    def decode(self, ids, skip_special_tokens: bool = True):
        del skip_special_tokens
        return " ".join(str(token) for token in ids)

    def apply_chat_template(
        self,
        messages,
        tokenize=True,
        add_generation_prompt=True,
        return_tensors="pt",
        return_dict=False,
    ):
        del tokenize, add_generation_prompt, return_tensors
        self.message_calls.append(messages)
        if not self.supports_chat:
            raise AttributeError("missing")
        if return_dict:
            return {"input_ids": _FakeTensor([7, 8]), "attention_mask": _FakeTensor([1, 1])}
        return _FakeTensor([7, 8])


class _FakeBatchEncoding(Mapping):
    def __init__(self):
        self._values = {"input_ids": _FakeTensor([7, 8]), "attention_mask": _FakeTensor([1, 1])}

    def __getitem__(self, key):
        return self._values[key]

    def __iter__(self):
        return iter(self._values)

    def __len__(self):
        return len(self._values)


class _BatchEncodingChatTokenizer(_FakeTokenizer):
    def apply_chat_template(
        self,
        _messages,
        tokenize=True,
        add_generation_prompt=True,
        return_tensors="pt",
        return_dict=False,
    ):
        del _messages, tokenize, add_generation_prompt, return_tensors, return_dict
        return _FakeBatchEncoding()


class _ThinkingAwareChatTokenizer(_FakeTokenizer):
    def __init__(self):
        self.template_calls: list[dict] = []

    def apply_chat_template(
        self,
        _messages,
        tokenize=True,
        add_generation_prompt=True,
        return_tensors="pt",
        return_dict=False,
        enable_thinking=True,
    ):
        self.template_calls.append(
            {
                "tokenize": tokenize,
                "add_generation_prompt": add_generation_prompt,
                "return_tensors": return_tensors,
                "return_dict": return_dict,
                "enable_thinking": enable_thinking,
            }
        )
        if return_dict:
            return {"input_ids": _FakeTensor([7, 8]), "attention_mask": _FakeTensor([1, 1])}
        return _FakeTensor([7, 8])


class _FakeModel:
    def __init__(self):
        self.device = "cpu"
        self.generate_calls: list[dict] = []

    def to(self, _device):
        return self

    def generate(self, **kwargs):
        self.generate_calls.append(kwargs)
        input_ids = kwargs["input_ids"]
        if isinstance(input_ids, _FakeTensor):
            values = input_ids.values
        else:
            values = input_ids
        return [[*values, 44, 55]]


class _FakePipeline:
    def __call__(self, _prompt, **_kwargs):
        return [{"generated_text": "text2text output"}]


class _FakeConstrainedJsonDecoder:
    def __init__(self) -> None:
        self.calls: list[dict] = []

    def generate(self, **kwargs) -> str:
        self.calls.append(kwargs)
        return '{"answer":"ok"}'


class _NoChatTokenizer:
    def __call__(self, _prompt: str, return_tensors: str = "pt"):
        del return_tensors
        return {"input_ids": _FakeTensor([1, 2, 3])}

    def decode(self, ids, skip_special_tokens: bool = True):
        del skip_special_tokens
        return " ".join(str(token) for token in ids)


class LocalTextGenerationTests(unittest.TestCase):
    def setUp(self) -> None:
        _GENERATOR_CACHE.clear()

    def test_auto_model_placement_fails_before_cache_lookup_without_accelerate(self) -> None:
        config = ExampleGenerationConfig(
            mode="qa",
            model=LocalModelConfig(
                provider="transformers",
                modelId="Qwen/Qwen2.5-7B-Instruct",
                device="auto",
            ),
        )

        with patch(
            "modules.adapters.runtime.python.worker.tasks.local_text_generation._is_module_available",
            return_value=False,
        ):
            with self.assertRaisesRegex(
                GenerationRuntimeDependencyError,
                "Automatic model placement is unavailable",
            ):
                ensure_generation_model_is_available(config)

    def test_generation_availability_never_starts_a_network_download(self) -> None:
        calls: list[dict] = []

        def fake_snapshot_download(**kwargs):
            calls.append(kwargs)
            return "C:/hf/snapshots/qwen"

        config = ExampleGenerationConfig.model_validate(
            {
                "mode": "qa",
                "model": {
                    "provider": "transformers",
                    "modelId": "Qwen/Qwen2.5-7B-Instruct",
                },
            }
        )
        with (
            patch.dict(
                sys.modules,
                {
                    "huggingface_hub": SimpleNamespace(
                        snapshot_download=fake_snapshot_download
                    )
                },
            ),
            patch(
                "modules.adapters.runtime.python.worker.tasks.local_text_generation._validate_huggingface_snapshot_path"
            ),
            patch(
                "modules.adapters.runtime.python.worker.tasks.local_text_generation._validate_snapshot_profile_result",
                side_effect=RuntimeError(
                    "Hugging Face model snapshot is incomplete: complete model weights are missing."
                ),
            ),
        ):
            with self.assertRaisesRegex(RuntimeError, "not fully downloaded"):
                ensure_generation_model_is_available(config)

        self.assertEqual(len(calls), 1)
        self.assertTrue(calls[0]["local_files_only"])

    def test_lora_adapter_availability_uses_exact_local_revision_and_base_association(self) -> None:
        with TemporaryDirectory() as directory:
            snapshot = (
                Path(directory)
                / "models--generated--chat-lora"
                / "snapshots"
                / "training-run-1"
            )
            snapshot.mkdir(parents=True)
            (snapshot / "adapter_config.json").write_text(
                json.dumps({"base_model_name_or_path": "owner/base-chat"}),
                encoding="utf-8",
            )
            (snapshot / "adapter_model.safetensors").write_bytes(b"adapter")
            config = ExampleGenerationConfig(
                mode="qa",
                model=LocalModelConfig(
                    provider="transformers",
                    modelId="owner/base-chat",
                    adapterModelId="generated/chat-lora",
                    adapterRevision="training-run-1",
                ),
            )

            with patch.dict(environ, {"HF_HUB_CACHE": directory}):
                availability = ensure_generation_adapter_is_available(config)

            self.assertTrue(availability.from_cache)
            self.assertEqual(availability.model_id, "generated/chat-lora")
            self.assertEqual(Path(availability.local_path or ""), snapshot)

    def test_lora_adapter_availability_rejects_a_different_base_association(self) -> None:
        with TemporaryDirectory() as directory:
            snapshot = (
                Path(directory)
                / "models--generated--chat-lora"
                / "snapshots"
                / "training-run-1"
            )
            snapshot.mkdir(parents=True)
            (snapshot / "adapter_config.json").write_text(
                json.dumps({"base_model_name_or_path": "owner/other-base"}),
                encoding="utf-8",
            )
            (snapshot / "adapter_model.safetensors").write_bytes(b"adapter")
            config = ExampleGenerationConfig(
                mode="qa",
                model=LocalModelConfig(
                    provider="transformers",
                    modelId="owner/base-chat",
                    adapterModelId="generated/chat-lora",
                    adapterRevision="training-run-1",
                ),
            )

            with (
                patch.dict(environ, {"HF_HUB_CACHE": directory}),
                self.assertRaisesRegex(RuntimeError, "association does not match"),
            ):
                ensure_generation_adapter_is_available(config)

    def test_lora_adapter_availability_accepts_only_the_resolved_legacy_base_reference(self) -> None:
        with TemporaryDirectory() as directory:
            base_snapshot = Path(directory) / "models--owner--base-chat" / "snapshots" / "base-revision"
            adapter_snapshot = (
                Path(directory)
                / "models--generated--chat-lora"
                / "snapshots"
                / "training-run-1"
            )
            base_snapshot.mkdir(parents=True)
            adapter_snapshot.mkdir(parents=True)
            (adapter_snapshot / "adapter_config.json").write_text(
                json.dumps({"base_model_name_or_path": str(base_snapshot)}),
                encoding="utf-8",
            )
            (adapter_snapshot / "adapter_model.safetensors").write_bytes(b"adapter")
            config = ExampleGenerationConfig(
                mode="qa",
                model=LocalModelConfig(
                    provider="transformers",
                    modelId="owner/base-chat",
                    adapterModelId="generated/chat-lora",
                    adapterRevision="training-run-1",
                ),
            )

            with (
                patch.dict(environ, {"HF_HUB_CACHE": directory}),
                patch.dict(
                    _RESOLVED_MODEL_REFERENCES,
                    {"owner/base-chat": str(base_snapshot)},
                ),
            ):
                availability = ensure_generation_adapter_is_available(config)

            self.assertTrue(availability.from_cache)

    def test_lora_attachment_uses_the_validated_local_adapter_reference(self) -> None:
        calls: list[tuple[object, str, bool]] = []

        class FakePeftModel:
            @staticmethod
            def from_pretrained(model, adapter_reference, is_trainable=False):
                calls.append((model, adapter_reference, is_trainable))
                return "attached-model"

        base_model = object()
        config = LocalModelConfig(
            provider="transformers",
            modelId="owner/base-chat",
            adapterModelId="generated/chat-lora",
        )
        with (
            patch(
                "modules.adapters.runtime.python.worker.tasks.local_text_generation._is_module_available",
                return_value=True,
            ),
            patch(
                "modules.adapters.runtime.python.worker.tasks.local_text_generation._resolved_model_reference_for",
                return_value="C:/host-cache/adapter-snapshot",
            ),
            patch.dict(sys.modules, {"peft": SimpleNamespace(PeftModel=FakePeftModel)}),
        ):
            attached = _attach_lora_adapter(base_model, config)

        self.assertEqual(attached, "attached-model")
        self.assertEqual(
            calls,
            [(base_model, "C:/host-cache/adapter-snapshot", False)],
        )

    def test_configures_huggingface_downloads_with_http_default_and_explicit_xet_override(self) -> None:
        previous_xet = environ.pop("HF_HUB_DISABLE_XET", None)
        previous_xet_cache = environ.pop("HF_XET_CACHE", None)
        previous_hf_home = environ.get("HF_HOME")
        previous_download_timeout = environ.pop("HF_HUB_DOWNLOAD_TIMEOUT", None)
        previous_etag_timeout = environ.pop("HF_HUB_ETAG_TIMEOUT", None)
        previous_symlink_warning = environ.pop("HF_HUB_DISABLE_SYMLINKS_WARNING", None)

        try:
            environ["HF_HOME"] = "C:/hf-home"
            configure_huggingface_download_environment()

            self.assertEqual(environ.get("HF_HUB_DISABLE_XET"), "1")
            self.assertEqual(environ.get("HF_XET_CACHE"), str(Path("C:/hf-home") / "xet"))
            self.assertEqual(environ.get("HF_HUB_DOWNLOAD_TIMEOUT"), "60")
            self.assertEqual(environ.get("HF_HUB_ETAG_TIMEOUT"), "30")
            self.assertEqual(environ.get("HF_HUB_DISABLE_SYMLINKS_WARNING"), "1")

            environ["HF_HUB_DISABLE_XET"] = "0"
            configure_huggingface_download_environment()
            self.assertEqual(environ.get("HF_HUB_DISABLE_XET"), "0")
        finally:
            if previous_xet is not None:
                environ["HF_HUB_DISABLE_XET"] = previous_xet
            else:
                environ.pop("HF_HUB_DISABLE_XET", None)
            if previous_xet_cache is not None:
                environ["HF_XET_CACHE"] = previous_xet_cache
            else:
                environ.pop("HF_XET_CACHE", None)
            if previous_hf_home is not None:
                environ["HF_HOME"] = previous_hf_home
            else:
                environ.pop("HF_HOME", None)
            if previous_download_timeout is not None:
                environ["HF_HUB_DOWNLOAD_TIMEOUT"] = previous_download_timeout
            else:
                environ.pop("HF_HUB_DOWNLOAD_TIMEOUT", None)
            if previous_etag_timeout is not None:
                environ["HF_HUB_ETAG_TIMEOUT"] = previous_etag_timeout
            else:
                environ.pop("HF_HUB_ETAG_TIMEOUT", None)
            if previous_symlink_warning is not None:
                environ["HF_HUB_DISABLE_SYMLINKS_WARNING"] = previous_symlink_warning
            else:
                environ.pop("HF_HUB_DISABLE_SYMLINKS_WARNING", None)

    def test_text_to_image_download_uses_checkpoint_snapshot_profile(self) -> None:
        profile = _resolve_snapshot_download_profile(
            LocalModelConfig(provider="transformers", modelId="stabilityai/stable-diffusion-xl-base-1.0"),
            {"inferenceMode": "text-to-image", "taskTags": ["text-to-image"], "artifactForm": "checkpoint"},
        )

        self.assertEqual(profile.name, "checkpoint")
        self.assertEqual(profile.allow_patterns, ("*.ckpt", "*.safetensors"))
        self.assertIn("*/*", profile.ignore_patterns)
        self.assertIn("*lora*", profile.ignore_patterns)
        self.assertIn("*adapter*", profile.ignore_patterns)

    def test_stable_diffusion_download_uses_checkpoint_profile_even_without_task_hints(self) -> None:
        profile = _resolve_snapshot_download_profile(
            LocalModelConfig(provider="transformers", modelId="stabilityai/stable-diffusion-xl-base-1.0"),
            None,
        )

        self.assertEqual(profile.name, "checkpoint")

    def test_model_download_passes_checkpoint_patterns_and_emits_structured_progress(self) -> None:
        calls: list[dict] = []
        progress_events: list[dict] = []
        snapshot_dir = "C:/hf/snapshots/sdxl"

        def fake_snapshot_download(**kwargs):
            calls.append(kwargs)
            if kwargs.get("local_files_only") is True:
                raise RuntimeError("cache miss")
            tqdm_class = kwargs.get("tqdm_class")
            self.assertIsNotNone(tqdm_class)
            progress = tqdm_class(total=2)
            progress.update(1)
            progress.update(1)
            progress.close()
            return snapshot_dir

        fake_hub = SimpleNamespace(snapshot_download=fake_snapshot_download)
        with (
            patch.dict(sys.modules, {"huggingface_hub": fake_hub}),
            patch("modules.adapters.runtime.python.worker.tasks.local_text_generation._snapshot_file_stats", return_value={"fileCount": 1, "totalBytes": 7}),
            patch("modules.adapters.runtime.python.worker.tasks.local_text_generation._validate_huggingface_snapshot_path"),
            patch("modules.adapters.runtime.python.worker.tasks.local_text_generation._validate_snapshot_profile_result"),
            patch("modules.adapters.runtime.python.worker.tasks.local_text_generation._to_huggingface_snapshot_handle", return_value="hf-cache:snapshot"),
        ):
            result = ensure_generation_model_downloaded(
                LocalModelConfig(provider="transformers", modelId="stabilityai/stable-diffusion-xl-base-1.0"),
                on_progress=progress_events.append,
                download_context={"inferenceMode": "text-to-image", "taskTags": ["text-to-image"]},
            )

        download_call = calls[-1]
        self.assertEqual(download_call["allow_patterns"], ["*.ckpt", "*.safetensors"])
        self.assertEqual(download_call["ignore_patterns"], ["*/*", "*lora*", "*LoRA*", "*adapter*", "*Adapter*"])
        self.assertFalse(download_call["local_files_only"])
        self.assertEqual(result.local_path, snapshot_dir)
        self.assertTrue(any(event.get("stage") == "snapshot-progress" for event in progress_events))
        self.assertTrue(any(event.get("completedFileCount") == 2 for event in progress_events))

    def test_structured_snapshot_tqdm_reports_byte_progress(self) -> None:
        progress_events: list[dict] = []
        tqdm_class = _create_structured_snapshot_tqdm(
            "stabilityai/stable-diffusion-xl-base-1.0",
            "checkpoint",
            progress_events.append,
        )

        progress = tqdm_class(total=100, unit="B")
        progress.update(25)
        progress.close()

        byte_progress = [event for event in progress_events if event.get("progressUnit") == "bytes"]
        self.assertGreaterEqual(len(byte_progress), 1)
        self.assertEqual(byte_progress[-1]["downloadedBytes"], 25)
        self.assertEqual(byte_progress[-1]["totalBytes"], 100)
        self.assertEqual(byte_progress[-1]["downloadPercent"], 25)

    def test_structured_snapshot_tqdm_throttles_rapid_updates(self) -> None:
        progress_events: list[dict] = []
        tqdm_class = _create_structured_snapshot_tqdm(
            "stabilityai/stable-diffusion-xl-base-1.0",
            "checkpoint",
            progress_events.append,
        )

        progress = tqdm_class(total=100, unit="B")
        for _ in range(100):
            progress.update(1)
        progress.close()

        byte_progress = [
            event for event in progress_events if event.get("progressUnit") == "bytes"
        ]
        self.assertLessEqual(len(byte_progress), 3)
        self.assertEqual(byte_progress[-1]["downloadedBytes"], 100)

    def test_structured_huggingface_file_progress_bridges_http_byte_progress(self) -> None:
        import huggingface_hub.file_download as file_download

        progress_events: list[dict] = []
        original_context = file_download._get_progress_bar_context

        with _structured_huggingface_file_progress(
            "stabilityai/stable-diffusion-xl-base-1.0",
            "checkpoint",
            progress_events.append,
        ):
            with file_download._get_progress_bar_context(
                desc="sd_xl_base_1.0.safetensors",
                log_level=20,
                total=100,
                initial=10,
                unit="B",
                unit_scale=True,
                name="huggingface_hub.http_get",
            ) as progress:
                progress.update(20)

        self.assertIs(file_download._get_progress_bar_context, original_context)
        byte_progress = [event for event in progress_events if event.get("progressUnit") == "bytes"]
        self.assertGreaterEqual(len(byte_progress), 1)
        self.assertEqual(byte_progress[-1]["stage"], "snapshot-progress")
        self.assertEqual(byte_progress[-1]["downloadedBytes"], 30)
        self.assertEqual(byte_progress[-1]["totalBytes"], 100)
        self.assertNotIn("downloadName", byte_progress[-1])
        self.assertEqual(byte_progress[-1]["downloadBackend"], "http")

    def test_structured_snapshot_tqdm_supports_concurrent_download_lock_protocol(self) -> None:
        from tqdm.contrib.concurrent import ensure_lock

        progress_events: list[dict] = []
        tqdm_class = _create_structured_snapshot_tqdm(
            "stabilityai/stable-diffusion-xl-base-1.0",
            "checkpoint",
            progress_events.append,
        )

        with ensure_lock(tqdm_class) as lock:
            self.assertIsNotNone(lock)

        progress = tqdm_class(total=1)
        progress.update(1)
        progress.close()

        self.assertTrue(any(event.get("stage") == "snapshot-progress" for event in progress_events))
        self.assertTrue(any(event.get("completedFileCount") == 1 for event in progress_events))

    def test_snapshot_cache_progress_monitor_reports_observed_bytes(self) -> None:
        progress_events: list[dict] = []

        cache_root = Path.cwd() / "artifacts" / "hf-cache-progress-test"
        rmtree(cache_root, ignore_errors=True)
        self.addCleanup(lambda: rmtree(cache_root, ignore_errors=True))
        cache_root.mkdir(parents=True)

        with patch.dict(
            environ,
            {
                "HF_HUB_CACHE": str(cache_root),
                "HF_XET_CACHE": str(cache_root / "xet-cache"),
                "AI_SYSTEM_BUILDER_HF_DOWNLOAD_PROGRESS_INTERVAL_SECONDS": "0.01",
            },
        ):
            stop_monitor = _start_snapshot_cache_progress_monitor(
                "test-org/test-model",
                "checkpoint",
                progress_events.append,
            )
            repo_cache = cache_root / "models--test-org--test-model" / "blobs"
            repo_cache.mkdir(parents=True)
            (repo_cache / "partial.safetensors.incomplete").write_bytes(b"123456789")
            stop_monitor()

        cache_progress = [event for event in progress_events if event.get("stage") == "snapshot-cache-progress"]
        self.assertGreaterEqual(len(cache_progress), 1)
        self.assertEqual(cache_progress[-1]["observedFileCount"], 1)
        self.assertEqual(cache_progress[-1]["observedTotalBytes"], 9)
        self.assertEqual(cache_progress[-1]["observedHubTotalBytes"], 9)
        self.assertEqual(cache_progress[-1]["observedXetTotalBytes"], 0)
        self.assertEqual(cache_progress[-1]["profile"], "checkpoint")

    def test_checkpoint_validation_rejects_only_small_auxiliary_lora_files(self) -> None:
        snapshot_path = Path.cwd() / "artifacts" / "hf-checkpoint-validation-test"
        rmtree(snapshot_path, ignore_errors=True)
        self.addCleanup(lambda: rmtree(snapshot_path, ignore_errors=True))
        snapshot_path.mkdir(parents=True)
        (snapshot_path / "sd_xl_offset_example-lora_1.0.safetensors").write_bytes(b"small")

        with patch.dict(environ, {"AI_SYSTEM_BUILDER_HF_CHECKPOINT_MIN_BYTES": "100"}):
            with self.assertRaisesRegex(RuntimeError, "Auxiliary LoRA/adapter files"):
                _validate_snapshot_profile_result(
                    LocalModelConfig(provider="transformers", modelId="stabilityai/stable-diffusion-xl-base-1.0"),
                    CHECKPOINT_SNAPSHOT_PROFILE,
                    str(snapshot_path),
                )

            (snapshot_path / "sd_xl_base_1.0.safetensors").write_bytes(b"x" * 101)
            _validate_snapshot_profile_result(
                LocalModelConfig(provider="transformers", modelId="stabilityai/stable-diffusion-xl-base-1.0"),
                CHECKPOINT_SNAPSHOT_PROFILE,
                str(snapshot_path),
            )

    def test_transformers_snapshot_requires_complete_weights_and_tokenizer(self) -> None:
        snapshot_path = Path.cwd() / "artifacts" / "hf-transformers-validation-test"
        rmtree(snapshot_path, ignore_errors=True)
        self.addCleanup(lambda: rmtree(snapshot_path, ignore_errors=True))
        snapshot_path.mkdir(parents=True)
        (snapshot_path / "config.json").write_text("{}", encoding="utf-8")
        (snapshot_path / "merges.txt").write_text("merge", encoding="utf-8")

        with self.assertRaisesRegex(RuntimeError, "model weights are missing"):
            _validate_snapshot_profile_result(
                LocalModelConfig(provider="transformers", modelId="Qwen/Qwen2.5-7B-Instruct"),
                GENERIC_TRANSFORMERS_SNAPSHOT_PROFILE,
                str(snapshot_path),
            )

        (snapshot_path / "model.safetensors").write_bytes(b"weights")
        with self.assertRaisesRegex(RuntimeError, "tokenizer files are missing"):
            _validate_snapshot_profile_result(
                LocalModelConfig(provider="transformers", modelId="Qwen/Qwen2.5-7B-Instruct"),
                GENERIC_TRANSFORMERS_SNAPSHOT_PROFILE,
                str(snapshot_path),
            )

        (snapshot_path / "vocab.json").write_text("{}", encoding="utf-8")
        _validate_snapshot_profile_result(
            LocalModelConfig(provider="transformers", modelId="Qwen/Qwen2.5-7B-Instruct"),
            GENERIC_TRANSFORMERS_SNAPSHOT_PROFILE,
            str(snapshot_path),
        )

    def test_transformers_snapshot_rejects_missing_indexed_weight_shards(self) -> None:
        snapshot_path = Path.cwd() / "artifacts" / "hf-transformers-shard-validation-test"
        rmtree(snapshot_path, ignore_errors=True)
        self.addCleanup(lambda: rmtree(snapshot_path, ignore_errors=True))
        snapshot_path.mkdir(parents=True)
        (snapshot_path / "config.json").write_text("{}", encoding="utf-8")
        (snapshot_path / "tokenizer.json").write_text("{}", encoding="utf-8")
        (snapshot_path / "model.safetensors.index.json").write_text(
            json.dumps({"weight_map": {"layer": "model-00001-of-00002.safetensors"}}),
            encoding="utf-8",
        )

        with self.assertRaisesRegex(RuntimeError, "weight shards are missing or invalid"):
            _validate_snapshot_profile_result(
                LocalModelConfig(provider="transformers", modelId="Qwen/Qwen2.5-7B-Instruct"),
                GENERIC_TRANSFORMERS_SNAPSHOT_PROFILE,
                str(snapshot_path),
            )

        (snapshot_path / "model-00001-of-00002.safetensors").write_bytes(b"weights")
        _validate_snapshot_profile_result(
            LocalModelConfig(provider="transformers", modelId="Qwen/Qwen2.5-7B-Instruct"),
            GENERIC_TRANSFORMERS_SNAPSHOT_PROFILE,
            str(snapshot_path),
        )

    def test_model_download_reports_cache_miss_cause_before_snapshot_download(self) -> None:
        calls: list[dict] = []
        progress_events: list[dict] = []

        def fake_snapshot_download(**kwargs):
            calls.append(kwargs)
            if kwargs.get("local_files_only") is True:
                raise RuntimeError("cache is incomplete")
            return "C:/hf/snapshots/sdxl"

        fake_hub = SimpleNamespace(snapshot_download=fake_snapshot_download)
        with (
            patch.dict(sys.modules, {"huggingface_hub": fake_hub}),
            patch("modules.adapters.runtime.python.worker.tasks.local_text_generation._snapshot_file_stats", return_value={"fileCount": 1, "totalBytes": 7}),
            patch("modules.adapters.runtime.python.worker.tasks.local_text_generation._validate_huggingface_snapshot_path"),
            patch("modules.adapters.runtime.python.worker.tasks.local_text_generation._validate_snapshot_profile_result"),
            patch("modules.adapters.runtime.python.worker.tasks.local_text_generation._to_huggingface_snapshot_handle", return_value="hf-cache:snapshot"),
        ):
            ensure_generation_model_downloaded(
                LocalModelConfig(provider="transformers", modelId="stabilityai/stable-diffusion-xl-base-1.0"),
                on_progress=progress_events.append,
                download_context={"inferenceMode": "text-to-image"},
            )

        cache_miss_event = next(event for event in progress_events if event.get("stage") == "cache-miss")
        self.assertEqual(cache_miss_event["errorType"], "RuntimeError")
        self.assertNotIn("errorMessage", cache_miss_event)
        self.assertEqual(cache_miss_event["profile"], "checkpoint")

    def test_incomplete_transformers_cache_is_resumed_instead_of_accepted(self) -> None:
        calls: list[dict] = []

        def fake_snapshot_download(**kwargs):
            calls.append(kwargs)
            return "C:/hf/snapshots/qwen"

        fake_hub = SimpleNamespace(snapshot_download=fake_snapshot_download)
        with (
            patch.dict(sys.modules, {"huggingface_hub": fake_hub}),
            patch(
                "modules.adapters.runtime.python.worker.tasks.local_text_generation._validate_huggingface_snapshot_path"
            ),
            patch(
                "modules.adapters.runtime.python.worker.tasks.local_text_generation._validate_snapshot_profile_result",
                side_effect=[
                    RuntimeError(
                        "Hugging Face model snapshot is incomplete: complete model weights are missing."
                    ),
                    None,
                ],
            ),
            patch(
                "modules.adapters.runtime.python.worker.tasks.local_text_generation._snapshot_file_stats",
                side_effect=[
                    {"fileCount": 4, "totalBytes": 1_000},
                    {"fileCount": 9, "totalBytes": 10_000},
                ],
            ),
            patch(
                "modules.adapters.runtime.python.worker.tasks.local_text_generation._to_huggingface_snapshot_handle",
                return_value="models--qwen--snapshot",
            ),
        ):
            result = ensure_generation_model_downloaded(
                LocalModelConfig(
                    provider="transformers",
                    modelId="Qwen/Qwen2.5-7B-Instruct",
                )
            )

        self.assertEqual(len(calls), 2)
        self.assertTrue(calls[0]["local_files_only"])
        self.assertFalse(calls[1]["local_files_only"])
        self.assertTrue(result.downloaded)
        self.assertFalse(result.from_cache)

    def test_interrupted_model_download_retries_from_saved_cache(self) -> None:
        calls: list[dict] = []
        progress_events: list[dict] = []

        def fake_snapshot_download(**kwargs):
            calls.append(kwargs)
            if kwargs.get("local_files_only") is True:
                raise RuntimeError("cache miss")
            if len(calls) == 2:
                raise TimeoutError("private transport failure")
            return "C:/hf/snapshots/qwen"

        fake_hub = SimpleNamespace(snapshot_download=fake_snapshot_download)
        with (
            patch.dict(sys.modules, {"huggingface_hub": fake_hub}),
            patch(
                "modules.adapters.runtime.python.worker.tasks.local_text_generation._snapshot_file_stats",
                return_value={"fileCount": 9, "totalBytes": 10_000},
            ),
            patch(
                "modules.adapters.runtime.python.worker.tasks.local_text_generation._validate_huggingface_snapshot_path"
            ),
            patch(
                "modules.adapters.runtime.python.worker.tasks.local_text_generation._validate_snapshot_profile_result"
            ),
            patch(
                "modules.adapters.runtime.python.worker.tasks.local_text_generation._to_huggingface_snapshot_handle",
                return_value="models--qwen--snapshot",
            ),
            patch(
                "modules.adapters.runtime.python.worker.tasks.local_text_generation._cleanup_failed_huggingface_cache"
            ) as cleanup,
            patch(
                "modules.adapters.runtime.python.worker.tasks.local_text_generation.time.sleep"
            ) as sleep,
        ):
            result = ensure_generation_model_downloaded(
                LocalModelConfig(
                    provider="transformers",
                    modelId="Qwen/Qwen2.5-3B-Instruct",
                ),
                on_progress=progress_events.append,
            )

        self.assertEqual(len(calls), 3)
        self.assertTrue(result.downloaded)
        cleanup.assert_not_called()
        sleep.assert_called_once_with(1.0)
        retry = next(
            event for event in progress_events if event.get("stage") == "snapshot-retry"
        )
        self.assertEqual(retry["attemptNumber"], 2)
        self.assertTrue(retry["cachePreserved"])
        self.assertNotIn("private transport failure", str(progress_events))

    def test_failed_model_download_preserves_partial_cache_and_returns_safe_error(self) -> None:
        calls: list[dict] = []

        def fake_snapshot_download(**kwargs):
            calls.append(kwargs)
            if kwargs.get("local_files_only") is True:
                raise RuntimeError("cache miss")
            raise TimeoutError("C:/private/cache token=secret")

        fake_hub = SimpleNamespace(snapshot_download=fake_snapshot_download)
        with (
            patch.dict(sys.modules, {"huggingface_hub": fake_hub}),
            patch(
                "modules.adapters.runtime.python.worker.tasks.local_text_generation._snapshot_file_stats",
                return_value={"fileCount": 7, "totalBytes": 8_000},
            ),
            patch(
                "modules.adapters.runtime.python.worker.tasks.local_text_generation._cleanup_failed_huggingface_cache"
            ) as cleanup,
            patch(
                "modules.adapters.runtime.python.worker.tasks.local_text_generation.time.sleep"
            ),
        ):
            with self.assertRaisesRegex(
                GenerationModelDownloadError,
                "Retry to resume the saved partial download",
            ) as raised:
                ensure_generation_model_downloaded(
                    LocalModelConfig(
                        provider="transformers",
                        modelId="Qwen/Qwen2.5-3B-Instruct",
                    )
                )

        self.assertEqual(len(calls), 4)
        cleanup.assert_not_called()
        self.assertNotIn("private", str(raised.exception))
        self.assertEqual(raised.exception.error_code, "model_download_interrupted")

    def test_model_download_policy_failure_cleans_bounded_cache_without_retry(self) -> None:
        calls: list[dict] = []

        def fake_snapshot_download(**kwargs):
            calls.append(kwargs)
            if kwargs.get("local_files_only") is True:
                raise RuntimeError("cache miss")
            raise RuntimeError("Hugging Face snapshot exceeded the configured byte limit.")

        fake_hub = SimpleNamespace(snapshot_download=fake_snapshot_download)
        with (
            patch.dict(sys.modules, {"huggingface_hub": fake_hub}),
            patch(
                "modules.adapters.runtime.python.worker.tasks.local_text_generation._snapshot_file_stats",
                return_value={"fileCount": 7, "totalBytes": 8_000},
            ),
            patch(
                "modules.adapters.runtime.python.worker.tasks.local_text_generation._cleanup_failed_huggingface_cache"
            ) as cleanup,
            patch(
                "modules.adapters.runtime.python.worker.tasks.local_text_generation.time.sleep"
            ) as sleep,
        ):
            with self.assertRaisesRegex(RuntimeError, "configured byte limit"):
                ensure_generation_model_downloaded(
                    LocalModelConfig(
                        provider="transformers",
                        modelId="Qwen/Qwen2.5-3B-Instruct",
                    )
                )

        self.assertEqual(len(calls), 2)
        cleanup.assert_called_once_with("Qwen/Qwen2.5-3B-Instruct")
        sleep.assert_not_called()

    def test_model_download_returns_after_valid_profile_cache_hit(self) -> None:
        calls: list[dict] = []

        def fake_snapshot_download(**kwargs):
            calls.append(kwargs)
            return "C:/hf/snapshots/sdxl"

        fake_hub = SimpleNamespace(snapshot_download=fake_snapshot_download)
        with (
            patch.dict(sys.modules, {"huggingface_hub": fake_hub}),
            patch("modules.adapters.runtime.python.worker.tasks.local_text_generation._snapshot_file_stats", return_value={"fileCount": 1, "totalBytes": 7}),
            patch("modules.adapters.runtime.python.worker.tasks.local_text_generation._validate_huggingface_snapshot_path"),
            patch("modules.adapters.runtime.python.worker.tasks.local_text_generation._validate_snapshot_profile_result"),
            patch("modules.adapters.runtime.python.worker.tasks.local_text_generation._to_huggingface_snapshot_handle", return_value="hf-cache:snapshot"),
        ):
            result = ensure_generation_model_downloaded(
                LocalModelConfig(provider="transformers", modelId="stabilityai/stable-diffusion-xl-base-1.0"),
                download_context={"inferenceMode": "text-to-image"},
            )

        self.assertEqual(len(calls), 1)
        self.assertTrue(calls[0]["local_files_only"])
        self.assertFalse(result.downloaded)
        self.assertTrue(result.from_cache)

    def test_checkpoint_download_fails_clearly_when_no_top_level_checkpoint_is_available(self) -> None:
        def fake_snapshot_download(**kwargs):
            if kwargs.get("local_files_only") is True:
                raise RuntimeError("cache miss")
            return "C:/hf/snapshots/sdxl"

        def fail_validation(*_args):
            raise RuntimeError(
                "Hugging Face model 'stabilityai/stable-diffusion-xl-base-1.0' did not expose a top-level .safetensors or .ckpt checkpoint."
            )

        fake_hub = SimpleNamespace(snapshot_download=fake_snapshot_download)
        with (
            patch.dict(sys.modules, {"huggingface_hub": fake_hub}),
            patch("modules.adapters.runtime.python.worker.tasks.local_text_generation._validate_huggingface_snapshot_path"),
            patch("modules.adapters.runtime.python.worker.tasks.local_text_generation._validate_snapshot_profile_result", side_effect=fail_validation),
            patch("modules.adapters.runtime.python.worker.tasks.local_text_generation.time.sleep"),
        ):
            with self.assertRaisesRegex(
                GenerationModelDownloadInvalidError,
                "complete model",
            ):
                ensure_generation_model_downloaded(
                    LocalModelConfig(provider="transformers", modelId="stabilityai/stable-diffusion-xl-base-1.0"),
                    download_context={"inferenceMode": "text-to-image"},
                )

    def test_model_download_rejects_noncanonical_ids_before_cache_or_network_access(self) -> None:
        with self.assertRaisesRegex(ValueError, "canonical owner/model"):
            ensure_generation_model_downloaded(
                LocalModelConfig(provider="transformers", modelId="../private-model")
            )

    def test_snapshot_progress_rejects_declared_downloads_above_the_byte_budget(self) -> None:
        progress_events: list[dict] = []
        with patch.dict(environ, {"AI_SYSTEM_BUILDER_HF_MAX_MODEL_BYTES": "1024"}):
            tqdm_class = _create_structured_snapshot_tqdm(
                "test-org/test-model",
                "checkpoint",
                progress_events.append,
            )
            with self.assertRaisesRegex(RuntimeError, "byte limit"):
                tqdm_class(total=2048, unit="B")

    def test_download_progress_and_events_do_not_disclose_model_ids_paths_or_raw_errors(self) -> None:
        progress_events: list[dict] = []
        with patch("builtins.print") as print_mock:
            from modules.adapters.runtime.python.worker.tasks.local_text_generation import _report_model_download_progress

            _report_model_download_progress(
                "private-org/private-model",
                progress_events.append,
                "snapshot-failed",
                "Download failed.",
                localPath="C:/private/cache/model",
                errorMessage="token=secret",
                errorType="RuntimeError",
            )

        serialized = str(progress_events) + str(print_mock.call_args_list)
        self.assertNotIn("private-org/private-model", serialized)
        self.assertNotIn("C:/private/cache/model", serialized)
        self.assertNotIn("token=secret", serialized)
        self.assertIn("RuntimeError", serialized)

    def test_auto_device_uses_transformers_device_map_and_saved_weight_dtype(self) -> None:
        config = ExampleGenerationConfig.model_validate(
            {"mode": "qa", "model": {"provider": "transformers", "modelId": "m", "device": "auto"}}
        )

        self.assertEqual(
            _resolve_model_kwargs(config.model),
            {"device_map": "auto", "torch_dtype": "auto"},
        )

    def test_generation_params_use_model_agnostic_default_token_budget(self) -> None:
        config = ExampleGenerationConfig.model_validate(
            {"mode": "qa", "model": {"provider": "transformers", "modelId": "m"}}
        )

        self.assertEqual(_resolve_generation_params(config)["max_new_tokens"], DEFAULT_MAX_NEW_TOKENS)

    def test_quantized_models_are_not_moved_manually_after_load(self) -> None:
        class _QuantizedModel(_FakeModel):
            quantization_config = object()

        self.assertFalse(_supports_manual_device_move(_QuantizedModel()))

    def test_device_map_offload_does_not_move_inputs_to_meta_device(self) -> None:
        input_ids = _FakeTensor([1, 2, 3])
        attention_mask = _FakeTensor([1, 1, 1])
        model = _FakeModel()
        model.device = "meta"
        model.hf_device_map = {"model.embed_tokens": "cpu", "lm_head": "disk"}

        moved = _move_tokenized_inputs_to_model_device(
            {"input_ids": input_ids, "attention_mask": attention_mask},
            model,
        )

        self.assertIs(moved["input_ids"], input_ids)
        self.assertEqual(input_ids.moved_to, "cpu")
        self.assertEqual(attention_mask.moved_to, "cpu")

    def test_meta_only_device_map_leaves_inputs_on_existing_device(self) -> None:
        input_ids = _FakeTensor([1, 2, 3])
        model = _FakeModel()
        model.device = "meta"
        model.hf_device_map = {"model.embed_tokens": "meta", "lm_head": "disk"}

        moved = _move_tokenized_inputs_to_model_device({"input_ids": input_ids}, model)

        self.assertIs(moved["input_ids"], input_ids)
        self.assertIsNone(input_ids.moved_to)

    def test_text2text_mode_uses_text2text_pipeline_behavior(self) -> None:
        config = ExampleGenerationConfig.model_validate(
            {"mode": "qa", "model": {"provider": "transformers", "modelId": "m", "inferenceMode": "text2text"}}
        )
        with patch(
            "modules.adapters.runtime.python.worker.tasks.local_text_generation.TransformersText2TextGenerator._build_pipeline",
            return_value=_FakePipeline(),
        ):
            generator = get_or_create_local_text_generator(config)

        self.assertEqual(generator.generate_text("prompt"), "text2text output")

    def test_model_initialization_failure_uses_a_stable_safe_error(self) -> None:
        config = ExampleGenerationConfig.model_validate(
            {
                "mode": "qa",
                "model": {
                    "provider": "transformers",
                    "modelId": "test-org/test-model",
                    "inferenceMode": "causal",
                },
            }
        )
        private_error = "C:\\private\\cache\\token=secret"

        with patch(
            "modules.adapters.runtime.python.worker.tasks.local_text_generation.TransformersCausalGenerator._load_model",
            side_effect=RuntimeError(private_error),
        ):
            with self.assertRaises(GenerationModelLoadError) as context:
                get_or_create_local_text_generator(config)

        self.assertEqual(
            str(context.exception),
            "The selected generation model could not be loaded by the local runtime.",
        )
        self.assertNotIn(private_error, str(context.exception))

    def test_model_load_rejects_implicit_disk_offload_when_memory_is_insufficient(self) -> None:
        with TemporaryDirectory() as directory:
            config = LocalModelConfig(
                provider="transformers",
                modelId="test-org/test-model",
                inferenceMode="chat",
                device="auto",
                torchDtype="auto",
            )
            with (
                patch(
                    "modules.adapters.runtime.python.worker.tasks.local_text_generation._resolved_model_reference_for",
                    return_value=directory,
                ),
                patch(
                    "modules.adapters.runtime.python.worker.tasks.local_text_generation._snapshot_model_weight_bytes",
                    return_value=15 * 1024 ** 3,
                ),
                patch(
                    "modules.adapters.runtime.python.worker.tasks.local_text_generation._read_system_memory_snapshot",
                    return_value=_SystemMemorySnapshot(
                        total_bytes=16 * 1024 ** 3,
                        available_bytes=9 * 1024 ** 3,
                    ),
                ),
                patch(
                    "modules.adapters.runtime.python.worker.tasks.local_text_generation._available_cuda_memory_bytes",
                    return_value=0,
                ),
            ):
                with self.assertRaises(GenerationInsufficientResourcesError):
                    _ensure_model_load_resources(config)

    def test_model_load_allows_only_configured_bounded_system_memory_overflow(self) -> None:
        with TemporaryDirectory() as directory:
            limited = LocalModelConfig(
                provider="transformers",
                modelId="test-org/test-model",
                inferenceMode="chat",
                device="auto",
                torchDtype="auto",
                memoryOverflowPolicy="limited",
            )
            extended = limited.model_copy(update={"memoryOverflowPolicy": "extended"})
            with (
                patch(
                    "modules.adapters.runtime.python.worker.tasks.local_text_generation._resolved_model_reference_for",
                    return_value=directory,
                ),
                patch(
                    "modules.adapters.runtime.python.worker.tasks.local_text_generation._snapshot_model_weight_bytes",
                    return_value=4 * 1024 ** 3,
                ),
                patch(
                    "modules.adapters.runtime.python.worker.tasks.local_text_generation._read_system_memory_snapshot",
                    return_value=_SystemMemorySnapshot(
                        total_bytes=16 * 1024 ** 3,
                        available_bytes=5 * 1024 ** 3,
                    ),
                ),
                patch(
                    "modules.adapters.runtime.python.worker.tasks.local_text_generation._available_cuda_memory_bytes",
                    return_value=0,
                ),
            ):
                self.assertEqual(
                    _ensure_model_load_resources(limited),
                    {
                        "estimatedMemoryOverflowBytes": 1024 ** 3,
                        "memoryOverflowLimitBytes": 1024 ** 3,
                    },
                )
                self.assertEqual(
                    _ensure_model_load_resources(extended),
                    {
                        "estimatedMemoryOverflowBytes": 1024 ** 3,
                        "memoryOverflowLimitBytes": 4 * 1024 ** 3,
                    },
                )

            cuda_only = extended.model_copy(update={"device": "cuda"})
            with (
                patch(
                    "modules.adapters.runtime.python.worker.tasks.local_text_generation._resolved_model_reference_for",
                    return_value=directory,
                ),
                patch(
                    "modules.adapters.runtime.python.worker.tasks.local_text_generation._snapshot_model_weight_bytes",
                    return_value=4 * 1024 ** 3,
                ),
                patch(
                    "modules.adapters.runtime.python.worker.tasks.local_text_generation._read_system_memory_snapshot",
                    return_value=_SystemMemorySnapshot(
                        total_bytes=16 * 1024 ** 3,
                        available_bytes=12 * 1024 ** 3,
                    ),
                ),
                patch(
                    "modules.adapters.runtime.python.worker.tasks.local_text_generation._available_cuda_memory_bytes",
                    return_value=1024 ** 3,
                ),
            ):
                with self.assertRaises(GenerationInsufficientResourcesError):
                    _ensure_model_load_resources(cuda_only)

    def test_model_status_does_not_block_while_a_model_is_loading(self) -> None:
        completed: list[list[dict[str, str | None]]] = []

        def read_status() -> None:
            completed.append(describe_loaded_generation_models())

        _GENERATOR_CACHE_LOCK.acquire()
        reader = Thread(target=read_status)
        try:
            reader.start()
            reader.join(timeout=0.25)
            completed_without_waiting = not reader.is_alive()
        finally:
            _GENERATOR_CACHE_LOCK.release()
            reader.join(timeout=1)

        self.assertTrue(completed_without_waiting)
        self.assertEqual(completed, [[]])

    def test_causal_mode_slices_prompt_tokens(self) -> None:
        config = ExampleGenerationConfig.model_validate(
            {"mode": "qa", "model": {"provider": "transformers", "modelId": "m", "inferenceMode": "causal"}}
        )

        fake_model = _FakeModel()
        with patch(
            "modules.adapters.runtime.python.worker.tasks.local_text_generation.TransformersCausalGenerator._load_model",
            return_value=(_FakeTokenizer(), fake_model),
        ):
            generator = get_or_create_local_text_generator(config)

        self.assertEqual(generator.generate_text("prompt"), "44 55")
        self.assertEqual(fake_model.generate_calls[0]["pad_token_id"], 0)

    def test_causal_mode_routes_an_explicit_schema_through_the_decoder(self) -> None:
        config = ExampleGenerationConfig.model_validate(
            {"mode": "qa", "model": {"provider": "transformers", "modelId": "m", "inferenceMode": "causal"}}
        )
        fake_model = _FakeModel()
        fake_decoder = _FakeConstrainedJsonDecoder()
        schema = {
            "$schema": "https://json-schema.org/draft/2020-12/schema",
            "type": "object",
            "additionalProperties": False,
            "required": ["answer"],
            "properties": {"answer": {"type": "string", "maxLength": 100}},
        }
        with (
            patch(
                "modules.adapters.runtime.python.worker.tasks.local_text_generation.TransformersCausalGenerator._load_model",
                return_value=(_FakeTokenizer(), fake_model),
            ),
            patch(
                "modules.adapters.runtime.python.worker.tasks.local_text_generation.ConstrainedJsonDecoder",
                return_value=fake_decoder,
            ),
        ):
            generator = get_or_create_local_text_generator(config)
            result = generator.generate_text("prompt", constrained_json_schema=schema)

        self.assertEqual(result, '{"answer":"ok"}')
        self.assertEqual(len(fake_decoder.calls), 1)
        self.assertEqual(fake_decoder.calls[0]["schema"], schema)
        self.assertEqual(fake_decoder.calls[0]["generation_params"]["max_new_tokens"], DEFAULT_MAX_NEW_TOKENS)
        self.assertEqual(fake_model.generate_calls, [])

    def test_text2text_mode_rejects_token_constraints_without_fallback(self) -> None:
        config = ExampleGenerationConfig.model_validate(
            {"mode": "qa", "model": {"provider": "transformers", "modelId": "m", "inferenceMode": "text2text"}}
        )
        with patch(
            "modules.adapters.runtime.python.worker.tasks.local_text_generation.TransformersText2TextGenerator._build_pipeline",
            return_value=_FakePipeline(),
        ):
            generator = get_or_create_local_text_generator(config)

        with self.assertRaises(ConstrainedJsonDecoderError) as raised:
            generator.generate_text("prompt", constrained_json_schema={})

        self.assertEqual(raised.exception.code, "decoder-inference-mode-unsupported")

    def test_chat_mode_uses_chat_template_when_available(self) -> None:
        config = ExampleGenerationConfig.model_validate(
            {"mode": "qa", "model": {"provider": "transformers", "modelId": "m", "inferenceMode": "chat"}}
        )

        fake_model = _FakeModel()
        with patch(
            "modules.adapters.runtime.python.worker.tasks.local_text_generation.TransformersCausalGenerator._load_model",
            return_value=(_FakeTokenizer(), fake_model),
        ):
            generator = get_or_create_local_text_generator(config)

        self.assertEqual(generator.generate_text("prompt"), "44 55")
        self.assertIn("attention_mask", fake_model.generate_calls[0])

    def test_chat_mode_preserves_system_and_user_roles(self) -> None:
        config = ExampleGenerationConfig.model_validate(
            {"mode": "qa", "model": {"provider": "transformers", "modelId": "m", "inferenceMode": "chat"}}
        )
        fake_model = _FakeModel()
        tokenizer = _FakeTokenizer()
        with patch(
            "modules.adapters.runtime.python.worker.tasks.local_text_generation.TransformersCausalGenerator._load_model",
            return_value=(tokenizer, fake_model),
        ):
            generator = get_or_create_local_text_generator(config)

        self.assertEqual(
            generator.generate_text("source and schema", system_prompt="trusted task policy"),
            "44 55",
        )
        self.assertEqual(
            tokenizer.message_calls[0],
            [
                {"role": "system", "content": "trusted task policy"},
                {"role": "user", "content": "source and schema"},
            ],
        )

    def test_chat_mode_disables_template_thinking_when_supported(self) -> None:
        config = ExampleGenerationConfig.model_validate(
            {"mode": "qa", "model": {"provider": "transformers", "modelId": "m", "inferenceMode": "chat"}}
        )

        fake_model = _FakeModel()
        tokenizer = _ThinkingAwareChatTokenizer()
        with patch(
            "modules.adapters.runtime.python.worker.tasks.local_text_generation.TransformersCausalGenerator._load_model",
            return_value=(tokenizer, fake_model),
        ):
            generator = get_or_create_local_text_generator(config)

        self.assertEqual(generator.generate_text("prompt"), "44 55")
        self.assertEqual(tokenizer.template_calls[0]["enable_thinking"], False)

    def test_chat_mode_accepts_batch_encoding_tokenizer_output(self) -> None:
        config = ExampleGenerationConfig.model_validate(
            {"mode": "qa", "model": {"provider": "transformers", "modelId": "m", "inferenceMode": "chat"}}
        )

        fake_model = _FakeModel()
        with patch(
            "modules.adapters.runtime.python.worker.tasks.local_text_generation.TransformersCausalGenerator._load_model",
            return_value=(_BatchEncodingChatTokenizer(), fake_model),
        ):
            generator = get_or_create_local_text_generator(config)

        self.assertEqual(generator.generate_text("prompt"), "44 55")
        self.assertIsInstance(fake_model.generate_calls[0]["input_ids"], _FakeTensor)
        self.assertIn("attention_mask", fake_model.generate_calls[0])

    def test_chat_mode_fails_clearly_without_chat_template(self) -> None:
        config = ExampleGenerationConfig.model_validate(
            {"mode": "qa", "model": {"provider": "transformers", "modelId": "m", "inferenceMode": "chat"}}
        )

        with patch(
            "modules.adapters.runtime.python.worker.tasks.local_text_generation.TransformersCausalGenerator._load_model",
            return_value=(_NoChatTokenizer(), _FakeModel()),
        ):
            generator = get_or_create_local_text_generator(config)

        with self.assertRaisesRegex(RuntimeError, "apply_chat_template"):
            generator.generate_text("prompt")


if __name__ == "__main__":
    unittest.main()
