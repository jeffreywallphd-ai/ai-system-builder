from __future__ import annotations

from pathlib import Path

from modules.adapters.runtime.python.worker.tasks.model_serialization import save_adapter_pretrained, save_full_model_pretrained


class _FakeModel:
    def save_pretrained(self, output: str, safe_serialization: bool = True, max_shard_size: str | None = None):
        out = Path(output)
        out.mkdir(parents=True, exist_ok=True)
        if max_shard_size == "1KB":
            (out / "model-00001-of-00002.safetensors").write_bytes(b"a")
            (out / "model-00002-of-00002.safetensors").write_bytes(b"b")
            (out / "model.safetensors.index.json").write_text('{"weight_map": {"x": "model-00001-of-00002.safetensors"}}', encoding="utf-8")
        else:
            (out / "model.safetensors").write_bytes(b"a")
        (out / "config.json").write_text("{}", encoding="utf-8")


class _FakeAdapterModel:
    def save_pretrained(self, output: str, safe_serialization: bool = True):
        out = Path(output)
        out.mkdir(parents=True, exist_ok=True)
        (out / "adapter_model.safetensors").write_bytes(b"adapter")
        (out / "adapter_config.json").write_text("{}", encoding="utf-8")


class _FakeTokenizer:
    def save_pretrained(self, output: str):
        out = Path(output)
        out.mkdir(parents=True, exist_ok=True)
        (out / "tokenizer.json").write_text("{}", encoding="utf-8")


def test_save_full_model_writes_sharded_index(tmp_path: Path) -> None:
    result = save_full_model_pretrained(_FakeModel(), _FakeTokenizer(), tmp_path, max_shard_size="1KB")
    assert result["serializationFormat"] == "sharded-safetensors"
    assert (tmp_path / "model.safetensors.index.json").exists()


def test_save_adapter_writes_adapter_files(tmp_path: Path) -> None:
    result = save_adapter_pretrained(_FakeAdapterModel(), _FakeTokenizer(), tmp_path)
    assert result["serializationFormat"] == "adapter-safetensors"
    assert (tmp_path / "adapter_model.safetensors").exists()
    assert (tmp_path / "adapter_config.json").exists()
