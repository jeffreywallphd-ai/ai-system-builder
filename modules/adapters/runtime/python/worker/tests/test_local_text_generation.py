from __future__ import annotations

from collections.abc import Mapping
import unittest
from os import environ
from unittest.mock import patch

from modules.adapters.runtime.python.worker.models import ExampleGenerationConfig
from modules.adapters.runtime.python.worker.tasks.local_text_generation import (
    DEFAULT_MAX_NEW_TOKENS,
    _GENERATOR_CACHE,
    _move_tokenized_inputs_to_model_device,
    _resolve_generation_params,
    _resolve_model_kwargs,
    _supports_manual_device_move,
    configure_huggingface_download_environment,
    get_or_create_local_text_generator,
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
        _messages,
        tokenize=True,
        add_generation_prompt=True,
        return_tensors="pt",
        return_dict=False,
    ):
        del tokenize, add_generation_prompt, return_tensors
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

    def test_configures_huggingface_downloads_without_disabling_xet(self) -> None:
        previous_xet = environ.pop("HF_HUB_DISABLE_XET", None)
        previous_symlink_warning = environ.pop("HF_HUB_DISABLE_SYMLINKS_WARNING", None)

        try:
            configure_huggingface_download_environment()

            self.assertIsNone(environ.get("HF_HUB_DISABLE_XET"))
            self.assertEqual(environ.get("HF_HUB_DISABLE_SYMLINKS_WARNING"), "1")
        finally:
            if previous_xet is not None:
                environ["HF_HUB_DISABLE_XET"] = previous_xet
            else:
                environ.pop("HF_HUB_DISABLE_XET", None)
            if previous_symlink_warning is not None:
                environ["HF_HUB_DISABLE_SYMLINKS_WARNING"] = previous_symlink_warning
            else:
                environ.pop("HF_HUB_DISABLE_SYMLINKS_WARNING", None)

    def test_auto_device_uses_transformers_device_map(self) -> None:
        config = ExampleGenerationConfig.model_validate(
            {"mode": "qa", "model": {"provider": "transformers", "modelId": "m", "device": "auto"}}
        )

        self.assertEqual(_resolve_model_kwargs(config.model), {"device_map": "auto"})

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
