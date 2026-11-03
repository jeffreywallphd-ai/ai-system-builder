"""Tiny native supplier compatibility; no acquisition or quality/resource claim."""
from contextlib import ExitStack, contextmanager
import gc
import hashlib
import json
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from modules.adapters.runtime.python.worker.models import LocalModelConfig
from modules.adapters.runtime.python.worker.tasks import bounded_model_loader as loader
from modules.adapters.runtime.python.worker.tests.test_local_model_offload import CONFIG


# Public Qwen/Qwen2.5-0.5B-Instruct chat format, revision
# 7ae557604adf67be50417f59c2c2f167def9a775; exact production-admitted hash.
# Reused metadata only: no model weights, download or private instructions.
_PUBLIC_QWEN_CHAT_TEMPLATE = '{%- if tools %}\n    {{- \'<|im_start|>system\\n\' }}\n    {%- if messages[0][\'role\'] == \'system\' %}\n        {{- messages[0][\'content\'] }}\n    {%- else %}\n        {{- \'You are Qwen, created by Alibaba Cloud. You are a helpful assistant.\' }}\n    {%- endif %}\n    {{- "\\n\\n# Tools\\n\\nYou may call one or more functions to assist with the user query.\\n\\nYou are provided with function signatures within <tools></tools> XML tags:\\n<tools>" }}\n    {%- for tool in tools %}\n        {{- "\\n" }}\n        {{- tool | tojson }}\n    {%- endfor %}\n    {{- "\\n</tools>\\n\\nFor each function call, return a json object with function name and arguments within <tool_call></tool_call> XML tags:\\n<tool_call>\\n{\\"name\\": <function-name>, \\"arguments\\": <args-json-object>}\\n</tool_call><|im_end|>\\n" }}\n{%- else %}\n    {%- if messages[0][\'role\'] == \'system\' %}\n        {{- \'<|im_start|>system\\n\' + messages[0][\'content\'] + \'<|im_end|>\\n\' }}\n    {%- else %}\n        {{- \'<|im_start|>system\\nYou are Qwen, created by Alibaba Cloud. You are a helpful assistant.<|im_end|>\\n\' }}\n    {%- endif %}\n{%- endif %}\n{%- for message in messages %}\n    {%- if (message.role == "user") or (message.role == "system" and not loop.first) or (message.role == "assistant" and not message.tool_calls) %}\n        {{- \'<|im_start|>\' + message.role + \'\\n\' + message.content + \'<|im_end|>\' + \'\\n\' }}\n    {%- elif message.role == "assistant" %}\n        {{- \'<|im_start|>\' + message.role }}\n        {%- if message.content %}\n            {{- \'\\n\' + message.content }}\n        {%- endif %}\n        {%- for tool_call in message.tool_calls %}\n            {%- if tool_call.function is defined %}\n                {%- set tool_call = tool_call.function %}\n            {%- endif %}\n            {{- \'\\n<tool_call>\\n{"name": "\' }}\n            {{- tool_call.name }}\n            {{- \'", "arguments": \' }}\n            {{- tool_call.arguments | tojson }}\n            {{- \'}\\n</tool_call>\' }}\n        {%- endfor %}\n        {{- \'<|im_end|>\\n\' }}\n    {%- elif message.role == "tool" %}\n        {%- if (loop.index0 == 0) or (messages[loop.index0 - 1].role != "tool") %}\n            {{- \'<|im_start|>user\' }}\n        {%- endif %}\n        {{- \'\\n<tool_response>\\n\' }}\n        {{- message.content }}\n        {{- \'\\n</tool_response>\' }}\n        {%- if loop.last or (messages[loop.index0 + 1].role != "tool") %}\n            {{- \'<|im_end|>\\n\' }}\n        {%- endif %}\n    {%- endif %}\n{%- endfor %}\n{%- if add_generation_prompt %}\n    {{- \'<|im_start|>assistant\\n\' }}\n{%- endif %}\n'


class NativeTiedDiskForwardTests(unittest.TestCase):
    def test_tiny_tied_qwen_disk_forward_parity_repeated_use_and_cleanup(self):
        self.exercise_tiny_disk_forward(sharded=False)

    def test_tiny_sharded_tied_qwen_disk_forward_parity_repeated_use_and_cleanup(self):
        self.exercise_tiny_disk_forward(sharded=True)

    def exercise_tiny_disk_forward(self, *, sharded):
        try:
            import torch
            from safetensors.torch import save_file
            from tokenizers import Tokenizer, models
            from transformers import Qwen2Config, Qwen2ForCausalLM
        except ImportError:
            self.skipTest("Managed native inference libraries unavailable")
        if not loader.offload_runtime_available():
            self.skipTest("Reviewed native supplier versions unavailable")
        torch.set_num_threads(1)
        torch.manual_seed(13)
        config = {**CONFIG, "tie_word_embeddings": True, "pad_token_id": 0, "bos_token_id": 1, "eos_token_id": 2}
        tokens = torch.tensor([[1, 5, 7]])
        with TemporaryDirectory() as temporary:
            cache = Path(temporary).absolute()
            root = cache / "tiny"; root.mkdir()
            original = Qwen2ForCausalLM(Qwen2Config(**config)).eval()
            with torch.no_grad():
                expected = original(tokens).logits.clone()
            weights = {name: value for name, value in original.state_dict().items() if name != "lm_head.weight"}
            if sharded:
                weight_map = {}
                for group in range(2):
                    shard = f"model-{group + 1:05d}-of-00002.safetensors"
                    selected = {name: value for number, (name, value) in enumerate(weights.items()) if number % 2 == group}
                    save_file(selected, str(root / shard))
                    weight_map.update(dict.fromkeys(selected, shard))
                (root / "model.safetensors.index.json").write_text(json.dumps({"weight_map": weight_map}), encoding="utf8")
                del selected
            else:
                save_file(weights, str(root / "model.safetensors"))
            del weights, original
            gc.collect()
            (root / "config.json").write_text(json.dumps(config), encoding="utf-8")
            vocab = {"<pad>": 0, "<s>": 1, "</s>": 2, "<unk>": 3, **{f"t{i}": i for i in range(4, 32)}}
            # Match the admitted acquisition's BPE schema, rather than adding
            # newer optional serialization fields to the supported profile.
            tokenizer_json = json.loads(Tokenizer(models.BPE(vocab=vocab, merges=[])).to_str())
            for key in ("ignore_merges", "continuing_subword_prefix", "end_of_word_suffix"):
                tokenizer_json["model"].pop(key, None)
            (root / "tokenizer.json").write_text(json.dumps(tokenizer_json), encoding="utf-8")
            (root / "tokenizer_config.json").write_text(json.dumps({"tokenizer_class": "Qwen2Tokenizer", "eos_token": "</s>", "unk_token": "<unk>", "pad_token": "<pad>", "model_max_length": 2048}), encoding="utf-8")
            placement = {"model.embed_tokens": "disk", "lm_head": "disk", "model.layers.0": "cpu",
                         "model.layers.1": "disk", "model.norm": "disk", "model.rotary_emb": "disk"}
            model_config = LocalModelConfig(provider="transformers", modelId="fixture/tiny", inferenceMode="causal",
                                            device="cpu", torchDtype="float32", memoryMode="offload-v1")
            def load():
                with patch("accelerate.infer_auto_device_map", return_value=placement):
                    return loader.load_bounded_local_model(model_config, {"max_new_tokens": 16}, reference=root,
                        cache_root=cache, read_memory=lambda: SimpleNamespace(available_bytes=8 * 1024**3), read_cuda_memory=lambda: 0)
            # The uncorrected inspected dispatcher must reproduce the observed
            # failure on this independent tiny model before checking parity.
            with patch.object(loader, "_bind_dispatch_ties"):
                broken = load()
            try:
                with torch.no_grad(), self.assertRaises(RuntimeError):
                    broken.model(tokens)
            finally:
                broken.model = None; broken.tokenizer = None
                loader.release_offload_lease(broken.lease, broken.model_references)
            bundle = load()
            try:
                for _ in range(2):
                    with torch.no_grad():
                        actual = bundle.model(tokens).logits
                    torch.testing.assert_close(actual, expected, rtol=1e-5, atol=1e-6)
                    for module in bundle.model.modules():
                        if type(module).__name__ == "Qwen2RMSNorm":
                            self.assertEqual(tuple(module.weight.shape), (8,))
                        hook = getattr(module, "_hf_hook", None)
                        if hook is not None and getattr(hook, "tied_params_map", None) is not None:
                            self.assertNotIn(0, hook.tied_params_map)
                    del actual, module, hook
            finally:
                bundle.model = None; bundle.tokenizer = None
                loader.release_offload_lease(bundle.lease, bundle.model_references)
            self.assertTrue(bundle.lease.released)
            self.assertTrue((root / ("model-00001-of-00002.safetensors" if sharded else "model.safetensors")).is_file())
            self.assertFalse((cache / ".aisb-offload-v1" / "active").exists())


class NativeTextGenerationParityTests(unittest.TestCase):
    """Synthetic behavior comparisons; never a downloaded-model accuracy test."""

    def test_modern_tokens_chat_and_generation_file(self):
        self.exercise_text_and_generation("modern")

    def test_legacy_tokens_and_model_generation_fallback(self):
        self.exercise_text_and_generation("legacy")

    def test_empty_decoder_ignores_legacy_and_preserves_nulls(self):
        self.exercise_text_and_generation("empty")

    def exercise_text_and_generation(self, mode):
        try:
            import torch
            from safetensors.torch import save_file
            from tokenizers import Tokenizer, models, pre_tokenizers
            from transformers import GenerationConfig, Qwen2Config, Qwen2ForCausalLM, Qwen2TokenizerFast
        except ImportError:
            self.skipTest("Managed native inference libraries unavailable")
        if not loader.offload_runtime_available():
            self.skipTest("Reviewed native supplier versions unavailable")
        torch.set_num_threads(1)
        torch.manual_seed(37)
        # Byte-level coverage makes Unicode/whitespace observations meaningful.
        vocab = {text: index for index, text in enumerate(sorted(pre_tokenizers.ByteLevel.alphabet()))}
        vocab.update({text: len(vocab) + index for index, text in enumerate(
            ("<|endoftext|>", "<|im_start|>", "<|im_end|>", "<pad>", "<s>", "</s>", "<unk>", "<mark>", "<legacy>"))})
        config = {**CONFIG, "vocab_size": 512, "tie_word_embeddings": True,
                  "bos_token_id": vocab["<s>"], "eos_token_id": None, "pad_token_id": vocab["<pad>"]}
        def token(content, **flags):
            return {"content": content, "single_word": False, "lstrip": False, "rstrip": False,
                    "normalized": False, "special": True, **flags}
        mark = token("<mark>", lstrip=True, rstrip=True, special=False)
        settings = {"tokenizer_class": "Qwen2TokenizerFast", "model_max_length": 2048,
                    "bos_token": "<s>", "eos_token": "<|im_end|>", "pad_token": "<pad>",
                    "unk_token": "<unk>", "add_prefix_space": False, "clean_up_tokenization_spaces": False,
                    "split_special_tokens": False, "additional_special_tokens": ["<|im_start|>", "<|im_end|>"]}
        backend = json.loads(Tokenizer(models.BPE(vocab=vocab, merges=[])).to_str())
        for key in ("ignore_merges", "continuing_subword_prefix", "end_of_word_suffix"):
            backend["model"].pop(key, None)
        byte_level = {"type": "ByteLevel", "add_prefix_space": False, "trim_offsets": False, "use_regex": False}
        backend.update(normalizer={"type": "NFC"}, pre_tokenizer={"type": "Sequence", "pretokenizers": [byte_level]},
                       post_processor=byte_level, decoder=byte_level,
                       added_tokens=[{"id": vocab["<mark>"], **mark}])
        # Conflict deliberately: native modern decoders ignore both legacy files.
        special = {"eos_token": token("</s>"), "additional_special_tokens": [token("<legacy>")]}
        legacy = {"<mark>": vocab["<mark>"], "<legacy>": vocab["<legacy>"]}
        generation = {"do_sample": False, "max_new_tokens": 2, "eos_token_id": None,
                      "bos_token_id": vocab["<s>"], "pad_token_id": vocab["<pad>"], "use_cache": True}
        if mode == "modern":
            settings["added_tokens_decoder"] = {str(vocab["<mark>"]): mark,
                str(vocab["<|im_start|>"]): token("<|im_start|>"), str(vocab["<|im_end|>"]): token("<|im_end|>")}
            settings["chat_template"] = None  # The separately bound file wins.
        elif mode == "empty":
            settings.update(added_tokens_decoder={}, eos_token=None, pad_token=None)
            generation["temperature"] = None
        else:
            self.assertEqual(mode, "legacy")
            generation = None
        placement = {"model.embed_tokens": "disk", "lm_head": "disk", "model.layers.0": "cpu",
                     "model.layers.1": "disk", "model.norm": "disk", "model.rotary_emb": "disk"}
        selected = LocalModelConfig(provider="transformers", modelId="fixture/text-generation",
                                    inferenceMode="auto", device="cpu", torchDtype="float32", memoryMode="offload-v1")
        inputs = torch.tensor([[vocab["<s>"], vocab["A"], vocab["B"]]])
        attention = torch.ones_like(inputs)
        with TemporaryDirectory() as temporary:
            cache = Path(temporary).absolute()
            root = cache / "text-generation"; root.mkdir()
            original = Qwen2ForCausalLM(Qwen2Config(**config)).eval()
            weights = {name: value for name, value in original.state_dict().items() if name != "lm_head.weight"}
            save_file(weights, str(root / "model.safetensors"))
            del weights
            for name, value in (("config.json", config), ("tokenizer.json", backend),
                                ("tokenizer_config.json", settings), ("special_tokens_map.json", special),
                                ("added_tokens.json", legacy)):
                (root / name).write_text(json.dumps(value), encoding="utf8")
            if generation is not None:
                (root / "generation_config.json").write_text(json.dumps(generation), encoding="utf8")
            if mode == "modern":
                self.assertEqual(hashlib.sha256(_PUBLIC_QWEN_CHAT_TEMPLATE.encode()).hexdigest(),
                                 "cd8e9439f0570856fd70470bf8889ebd8b5d1107207f67a5efb46e342330527f")
                template_file = root / "chat_template.jinja"
                template_file.write_bytes(_PUBLIC_QWEN_CHAT_TEMPLATE.encode("utf8"))
                self.assertEqual(hashlib.sha256(template_file.read_bytes()).hexdigest(),
                                 "cd8e9439f0570856fd70470bf8889ebd8b5d1107207f67a5efb46e342330527f")
            # Independent normal supplier resolution is restricted to our fresh
            # local fixture. Denial sentinels below apply only to the candidate.
            expected_tokenizer = Qwen2TokenizerFast.from_pretrained(str(root), local_files_only=True)
            if expected_tokenizer.pad_token_id is None:
                expected_tokenizer.pad_token_id = expected_tokenizer.eos_token_id
            expected_generation = (GenerationConfig.from_pretrained(str(root), local_files_only=True)
                                   if generation is not None else GenerationConfig.from_model_config(original.config))
            original.generation_config = expected_generation
            expected_steps, observer = self.observe_cache(original)
            try:
                with torch.no_grad():
                    expected_output = original.generate(inputs, attention_mask=attention, max_new_tokens=2, do_sample=False)
            finally:
                observer.remove()
            self.assertEqual(expected_steps, [(3, 0), (1, 3)])
            self.assertEqual(tuple(expected_output.shape), (1, 5))
            del original
            gc.collect()
            with self.discovery_denials() as guards, patch("accelerate.infer_auto_device_map", return_value=placement):
                bundle = None
                try:
                    previous_dtype = torch.get_default_dtype()
                    try:
                        torch.set_default_dtype(torch.float64)
                        bundle = loader.load_bounded_local_model(selected, {"max_new_tokens": 2}, reference=root,
                            cache_root=cache, read_memory=lambda: SimpleNamespace(available_bytes=8 * 1024**3), read_cuda_memory=lambda: 0)
                        self.assertIs(torch.get_default_dtype(), torch.float64)
                    finally:
                        torch.set_default_dtype(previous_dtype)
                    self.assertEqual(bundle.inference_mode, "chat" if mode == "modern" else "causal")
                    self.assertEqual(bundle.tokenizer.get_vocab(), expected_tokenizer.get_vocab())
                    self.assertEqual(self.token_flags(bundle.tokenizer), self.token_flags(expected_tokenizer))
                    self.assertEqual(bundle.tokenizer.convert_tokens_to_ids("<mark>"), vocab["<mark>"])
                    self.assertEqual("<legacy>" in bundle.tokenizer.additional_special_tokens, mode == "legacy")
                    for key in ("bos_token_id", "eos_token_id", "pad_token_id", "unk_token_id", "model_max_length"):
                        self.assertEqual(getattr(bundle.tokenizer, key), getattr(expected_tokenizer, key), key)
                    for text in ("A B", " leading  spaces\nnext", "café cafe\u0301", "日本語 😀", " A <mark> B ", "<|im_start|>user"):
                        actual_ids = bundle.tokenizer.encode(text, add_special_tokens=False)
                        self.assertTrue(actual_ids)
                        self.assertEqual(actual_ids, expected_tokenizer.encode(text, add_special_tokens=False))
                        for skip in (False, True):
                            self.assertEqual(bundle.tokenizer.decode(actual_ids, skip_special_tokens=skip),
                                             expected_tokenizer.decode(actual_ids, skip_special_tokens=skip))
                    self.assertEqual(bundle.tokenizer.encode("café"), bundle.tokenizer.encode("cafe\u0301"))
                    if mode == "modern":
                        messages = [{"role": "system", "content": "Use short replies."}, {"role": "user", "content": "Hello"}]
                        for tokenize in (False, True):
                            self.assertEqual(bundle.tokenizer.apply_chat_template(messages, tokenize=tokenize, add_generation_prompt=True),
                                             expected_tokenizer.apply_chat_template(messages, tokenize=tokenize, add_generation_prompt=True))
                    for key in ("do_sample", "max_new_tokens", "eos_token_id", "bos_token_id", "pad_token_id",
                                "use_cache", "temperature", "top_p", "num_beams", "num_return_sequences"):
                        self.assertEqual(getattr(bundle.model.generation_config, key), getattr(expected_generation, key), key)
                    self.assertTrue(bundle.model.generation_config.use_cache)
                    for _ in range(2):
                        actual_steps, observer = self.observe_cache(bundle.model)
                        try:
                            with torch.no_grad():
                                actual_output = bundle.model.generate(inputs, attention_mask=attention, max_new_tokens=2, do_sample=False)
                        finally:
                            observer.remove()
                        self.assertEqual(actual_steps, [(3, 0), (1, 3)])
                        torch.testing.assert_close(actual_output, expected_output, rtol=0, atol=0)
                        del actual_output
                    for guard in guards:
                        guard.assert_not_called()
                finally:
                    if bundle is not None:
                        bundle.model = None; bundle.tokenizer = None
                        loader.release_offload_lease(bundle.lease, bundle.model_references)
                self.assertTrue(bundle.lease.released)
            self.assertFalse((cache / ".aisb-offload-v1" / "active").exists())
            self.assertTrue((root / "model.safetensors").is_file())

    @staticmethod
    def token_flags(tokenizer):
        return {index: (str(value), value.single_word, value.lstrip, value.rstrip, value.normalized, value.special)
                for index, value in tokenizer.added_tokens_decoder.items()}

    @staticmethod
    def observe_cache(model):
        steps = []
        def observe(_model, args, kwargs):
            inputs = kwargs.get("input_ids", args[0] if args else None)
            if inputs is None:
                raise AssertionError("Expected synthetic input IDs")
            past = kwargs.get("past_key_values")
            steps.append((int(inputs.shape[-1]), 0 if past is None else int(past.get_seq_length())))
        return steps, model.register_forward_pre_hook(observe, with_kwargs=True)

    @staticmethod
    @contextmanager
    def discovery_denials():
        guards = []
        # Fixed callable boundaries in the reviewed supplier; no file-open or
        # path-inspection denial that could hide legitimate inventory checks.
        targets = (
            "transformers.AutoConfig.from_pretrained", "transformers.AutoTokenizer.from_pretrained",
            "transformers.Qwen2TokenizerFast.from_pretrained", "transformers.Qwen2ForCausalLM.from_pretrained",
            "transformers.GenerationConfig.from_pretrained", "transformers.utils.hub.cached_file",
            "transformers.utils.hub.cached_files", "transformers.utils.hub.hf_hub_download",
            "transformers.utils.hub.snapshot_download", "transformers.utils.hub.download_url",
            "transformers.utils.find_adapter_config_file", "transformers.utils.download_url",
            "transformers.tokenization_utils_base.cached_file", "transformers.configuration_utils.cached_file",
            "transformers.modeling_utils.cached_file", "transformers.modeling_utils.download_url",
            "transformers.generation.configuration_utils.cached_file",
            "transformers.utils.peft_utils.find_adapter_config_file", "huggingface_hub.hf_hub_download",
            "huggingface_hub.snapshot_download", "socket.create_connection", "socket.socket.connect",
            "tempfile.mkdtemp", "tempfile.mkstemp", "tempfile.NamedTemporaryFile", "tempfile.TemporaryDirectory",
        )
        from transformers import modeling_utils
        if hasattr(modeling_utils, "find_adapter_config_file"):
            targets += ("transformers.modeling_utils.find_adapter_config_file",)
        with ExitStack() as stack:
            for target in targets:
                guards.append(stack.enter_context(patch(target, side_effect=AssertionError("Unexpected supplier discovery"))))
            yield guards


if __name__ == "__main__":
    unittest.main()
