"""Tiny native supplier compatibility; no acquisition or quality/resource claim."""
import gc
import json
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from modules.adapters.runtime.python.worker.models import LocalModelConfig
from modules.adapters.runtime.python.worker.tasks import bounded_model_loader as loader
from modules.adapters.runtime.python.worker.tests.test_local_model_offload import CONFIG


class NativeTiedDiskForwardTests(unittest.TestCase):
    def test_tiny_tied_qwen_disk_forward_parity_repeated_use_and_cleanup(self):
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
            self.assertTrue((root / "model.safetensors").is_file())
            self.assertFalse((cache / ".aisb-offload-v1" / "active").exists())


if __name__ == "__main__":
    unittest.main()
