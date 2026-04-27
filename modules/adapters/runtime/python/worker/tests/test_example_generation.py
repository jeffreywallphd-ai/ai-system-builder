from __future__ import annotations

import io
import json
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
from unittest.mock import patch

from modules.adapters.runtime.python.worker.models import ExampleGenerationConfig
from modules.adapters.runtime.python.worker.tasks.example_generation import (
    GeneratedQaExample,
    _GENERATOR_CACHE,
    _RESOLVED_MODEL_REFERENCES,
    ensure_generation_model_downloaded,
    generate_qa_examples_for_chunks,
)
from modules.adapters.runtime.python.worker.tasks.local_text_generation import _resolve_auto_inference_mode
from modules.adapters.runtime.python.worker.tasks.markdown_chunking import MarkdownChunk


class _FakeGenerator:
    def __init__(self, _config, _params):
        self.calls: list[str] = []

    def generate_text(self, prompt: str) -> str:
        self.calls.append(prompt)
        if "Return only the question." in prompt:
            return "Generated question?"
        return "Generated answer."


class _EchoingGenerator:
    def __init__(self, _config, _params):
        self.calls: list[str] = []

    def generate_text(self, prompt: str) -> str:
        self.calls.append(prompt)
        return prompt


class _ReasoningGenerator:
    def __init__(self, _config, _params):
        self.calls: list[str] = []

    def generate_text(self, prompt: str) -> str:
        self.calls.append(prompt)
        if "Return only the question." in prompt:
            return "<think>\nIdentify a grounded question.\n</think>\n\nQuestion: What does the context describe?"
        return "<think>\nUse only the supplied context.\n</think>\n\nAnswer: The context describes generated content."


class _EmptyMessageErrorGenerator:
    def generate_text(self, _prompt: str) -> str:
        raise NotImplementedError()


class _EncoderDecoderConfig:
    is_encoder_decoder = True


class _DecoderOnlyConfig:
    is_encoder_decoder = False


class _ConfigFactory:
    def __init__(self, config):
        self._config = config

    def from_pretrained(self, _model_reference):
        return self._config


class _TokenizerFactory:
    def __init__(self, chat_template=None):
        self._chat_template = chat_template

    def from_pretrained(self, _model_reference):
        return SimpleNamespace(chat_template=self._chat_template)


class ExampleGenerationTests(unittest.TestCase):
    def setUp(self) -> None:
        _GENERATOR_CACHE.clear()
        _RESOLVED_MODEL_REFERENCES.clear()

    def test_generates_qa_examples_from_chunks(self) -> None:
        config = ExampleGenerationConfig.model_validate(
            {
                "mode": "qa",
                "model": {"provider": "transformers", "modelId": "test-model"},
                "generationParams": {"maxNewTokens": 24},
            }
        )

        with patch(
            "modules.adapters.runtime.python.worker.tasks.example_generation.get_or_create_local_text_generator",
            return_value=_FakeGenerator(None, None),
        ):
            examples = generate_qa_examples_for_chunks(
                [MarkdownChunk(artifact_id="artifact-1", chunk_index=0, text="chunk text")],
                config,
            )

        self.assertEqual(
            examples,
            [
                GeneratedQaExample(
                    artifact_id="artifact-1",
                    chunk_index=0,
                    question="Generated question?",
                    answer="Generated answer.",
                    generation_mode="qa",
                )
            ],
        )

    def test_local_model_inference_mode_validation_rejects_invalid_value(self) -> None:
        with self.assertRaisesRegex(ValueError, "inferenceMode"):
            ExampleGenerationConfig.model_validate(
                {
                    "mode": "qa",
                    "model": {
                        "provider": "transformers",
                        "modelId": "test-model",
                        "inferenceMode": "invalid",
                    },
                }
            )

    def test_invalid_prompt_echo_raises_for_fail_policy(self) -> None:
        config = ExampleGenerationConfig.model_validate(
            {
                "mode": "qa",
                "failurePolicy": "fail",
                "model": {"provider": "transformers", "modelId": "test-model"},
            }
        )

        with patch(
            "modules.adapters.runtime.python.worker.tasks.example_generation.get_or_create_local_text_generator",
            return_value=_EchoingGenerator(None, None),
        ):
            with self.assertRaisesRegex(ValueError, "echoed"):
                generate_qa_examples_for_chunks(
                    [MarkdownChunk(artifact_id="artifact-1", chunk_index=0, text="Some context")],
                    config,
                )

    def test_invalid_prompt_echo_skips_chunk_for_skip_policy(self) -> None:
        config = ExampleGenerationConfig.model_validate(
            {
                "mode": "qa",
                "failurePolicy": "skip",
                "model": {"provider": "transformers", "modelId": "test-model"},
            }
        )

        with patch(
            "modules.adapters.runtime.python.worker.tasks.example_generation.get_or_create_local_text_generator",
            return_value=_EchoingGenerator(None, None),
        ):
            examples = generate_qa_examples_for_chunks(
                [MarkdownChunk(artifact_id="artifact-1", chunk_index=0, text="Some context")],
                config,
            )

        self.assertEqual(examples, [])

    def test_generation_skip_logs_raw_prepared_data_and_errors(self) -> None:
        config = ExampleGenerationConfig.model_validate(
            {
                "mode": "qa",
                "failurePolicy": "skip",
                "model": {"provider": "transformers", "modelId": "test-model"},
            }
        )
        output = io.StringIO()

        with patch(
            "modules.adapters.runtime.python.worker.tasks.example_generation.get_or_create_local_text_generator",
            return_value=_EchoingGenerator(None, None),
        ):
            with redirect_stdout(output):
                examples = generate_qa_examples_for_chunks(
                    [MarkdownChunk(artifact_id="artifact-1", chunk_index=0, text="Some context")],
                    config,
                )

        self.assertEqual(examples, [])
        diagnostic = json.loads(output.getvalue().strip())
        self.assertEqual(diagnostic["event"], "runtime.dataset_preparation.generation.chunk_failed")
        self.assertEqual(diagnostic["rawData"]["chunk"]["text"], "Some context")
        self.assertIn("questionPrompt", diagnostic["preparedData"])
        self.assertTrue(any("echoed" in error for error in diagnostic["errors"]))

    def test_generation_skip_logs_error_type_when_exception_message_is_empty(self) -> None:
        config = ExampleGenerationConfig.model_validate(
            {
                "mode": "qa",
                "failurePolicy": "skip",
                "model": {"provider": "transformers", "modelId": "test-model"},
            }
        )
        output = io.StringIO()

        with patch(
            "modules.adapters.runtime.python.worker.tasks.example_generation.get_or_create_local_text_generator",
            return_value=_EmptyMessageErrorGenerator(),
        ):
            with redirect_stdout(output):
                examples = generate_qa_examples_for_chunks(
                    [MarkdownChunk(artifact_id="artifact-1", chunk_index=0, text="Some context")],
                    config,
                )

        self.assertEqual(examples, [])
        diagnostic = json.loads(output.getvalue().strip())
        self.assertEqual(diagnostic["errors"], ["NotImplementedError"])

    def test_extracts_question_and_answer_from_reasoning_model_wrappers(self) -> None:
        config = ExampleGenerationConfig.model_validate(
            {
                "mode": "qa",
                "failurePolicy": "fail",
                "model": {"provider": "transformers", "modelId": "test-model", "inferenceMode": "chat"},
            }
        )

        with patch(
            "modules.adapters.runtime.python.worker.tasks.example_generation.get_or_create_local_text_generator",
            return_value=_ReasoningGenerator(None, None),
        ):
            examples = generate_qa_examples_for_chunks(
                [MarkdownChunk(artifact_id="artifact-1", chunk_index=0, text="The context describes generated content.")],
                config,
            )

        self.assertEqual(examples[0].question, "What does the context describe?")
        self.assertEqual(examples[0].answer, "The context describes generated content.")

    def test_auto_inference_mode_resolves_encoder_decoder_models_to_text2text(self) -> None:
        transformers = SimpleNamespace(
            AutoConfig=_ConfigFactory(_EncoderDecoderConfig()),
            AutoTokenizer=_TokenizerFactory(chat_template="unused"),
        )
        config = ExampleGenerationConfig.model_validate(
            {
                "mode": "qa",
                "model": {"provider": "transformers", "modelId": "google/flan-t5-base", "inferenceMode": "auto"},
            }
        )

        with patch.dict("sys.modules", {"transformers": transformers}):
            resolved = _resolve_auto_inference_mode(config.model)

        self.assertEqual(resolved, "text2text")

    def test_auto_inference_mode_resolves_chat_template_models_to_chat(self) -> None:
        transformers = SimpleNamespace(
            AutoConfig=_ConfigFactory(_DecoderOnlyConfig()),
            AutoTokenizer=_TokenizerFactory(chat_template="{{ messages }}"),
        )
        config = ExampleGenerationConfig.model_validate(
            {
                "mode": "qa",
                "model": {"provider": "transformers", "modelId": "Qwen/Qwen3-1.7B", "inferenceMode": "auto"},
            }
        )

        with patch.dict("sys.modules", {"transformers": transformers}):
            resolved = _resolve_auto_inference_mode(config.model)

        self.assertEqual(resolved, "chat")

    def test_auto_inference_mode_resolves_decoder_only_without_chat_template_to_causal(self) -> None:
        transformers = SimpleNamespace(
            AutoConfig=_ConfigFactory(_DecoderOnlyConfig()),
            AutoTokenizer=_TokenizerFactory(chat_template=None),
        )
        config = ExampleGenerationConfig.model_validate(
            {
                "mode": "qa",
                "model": {"provider": "transformers", "modelId": "gpt2", "inferenceMode": "auto"},
            }
        )

        with patch.dict("sys.modules", {"transformers": transformers}):
            resolved = _resolve_auto_inference_mode(config.model)

        self.assertEqual(resolved, "causal")

    def test_reuses_cached_generator_for_same_model_config(self) -> None:
        config = ExampleGenerationConfig.model_validate(
            {
                "mode": "qa",
                "model": {"provider": "transformers", "modelId": "test-model", "device": "cpu"},
            }
        )

        instance_count = 0

        class _CountingGenerator(_FakeGenerator):
            def __init__(self, model_config, params):
                nonlocal instance_count
                instance_count += 1
                super().__init__(model_config, params)

        with patch(
            "modules.adapters.runtime.python.worker.tasks.local_text_generation.TransformersText2TextGenerator",
            _CountingGenerator,
        ):
            generate_qa_examples_for_chunks([MarkdownChunk("a", 0, "first")], config)
            generate_qa_examples_for_chunks([MarkdownChunk("a", 1, "second")], config)

        self.assertEqual(instance_count, 1)

    def test_ensure_generation_model_downloaded_returns_cached_when_present(self) -> None:
        snapshot_download = unittest.mock.Mock()
        with patch.dict("sys.modules", {"huggingface_hub": SimpleNamespace(snapshot_download=snapshot_download)}):
            snapshot_download.return_value = "/tmp/hf-cache/model"
            result = ensure_generation_model_downloaded(
                ExampleGenerationConfig.model_validate(
                    {
                        "mode": "qa",
                        "model": {"provider": "transformers", "modelId": "test-model"},
                    }
                ).model
            )

        self.assertFalse(result.downloaded)
        self.assertTrue(result.from_cache)
        self.assertEqual(result.local_path, "/tmp/hf-cache/model")
        snapshot_download.assert_called_once_with(repo_id="test-model", local_files_only=True)

    def test_ensure_generation_model_downloaded_uses_existing_safetensors_cache_before_download(self) -> None:
        with TemporaryDirectory() as temporary_directory:
            cache_root = Path(temporary_directory)
            snapshot_path = cache_root / "models--Qwen--Qwen3-8B" / "snapshots" / "abcdef"
            snapshot_path.mkdir(parents=True, exist_ok=True)
            (snapshot_path / "model-00001-of-00002.safetensors").write_bytes(b"weights")

            snapshot_download = unittest.mock.Mock(side_effect=RuntimeError("should-not-download"))
            with patch.dict(
                "sys.modules",
                {"huggingface_hub": SimpleNamespace(snapshot_download=snapshot_download)},
            ):
                with patch.dict("os.environ", {"HF_HUB_CACHE": temporary_directory}, clear=False):
                    result = ensure_generation_model_downloaded(
                        ExampleGenerationConfig.model_validate(
                            {
                                "mode": "qa",
                                "model": {"provider": "transformers", "modelId": "Qwen/Qwen3-8B"},
                            }
                        ).model
                    )

        self.assertFalse(result.downloaded)
        self.assertTrue(result.from_cache)
        self.assertEqual(result.local_path, str(snapshot_path))
        snapshot_download.assert_not_called()

    def test_ensure_generation_model_downloaded_auto_downloads_when_missing_from_cache(self) -> None:
        snapshot_download = unittest.mock.Mock()
        with patch.dict("sys.modules", {"huggingface_hub": SimpleNamespace(snapshot_download=snapshot_download)}):
            snapshot_download.side_effect = [RuntimeError("cache-miss"), "/tmp/hf-cache/model"]
            result = ensure_generation_model_downloaded(
                ExampleGenerationConfig.model_validate(
                    {
                        "mode": "qa",
                        "model": {"provider": "transformers", "modelId": "test-model"},
                    }
                ).model
            )

        self.assertTrue(result.downloaded)
        self.assertFalse(result.from_cache)
        self.assertEqual(result.local_path, "/tmp/hf-cache/model")
        self.assertEqual(snapshot_download.call_count, 2)

    def test_ensure_generation_model_downloaded_raises_when_download_fails(self) -> None:
        snapshot_download = unittest.mock.Mock(side_effect=RuntimeError("cannot-download"))
        with patch.dict("sys.modules", {"huggingface_hub": SimpleNamespace(snapshot_download=snapshot_download)}):
            with self.assertRaisesRegex(RuntimeError, "Automatic download failed"):
                ensure_generation_model_downloaded(
                    ExampleGenerationConfig.model_validate(
                        {
                            "mode": "qa",
                            "model": {"provider": "transformers", "modelId": "test-model"},
                        }
                    ).model
                )


if __name__ == "__main__":
    unittest.main()
