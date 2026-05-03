from __future__ import annotations

import sys
from types import SimpleNamespace
from pathlib import Path

from modules.adapters.runtime.python.worker.models import TrainModelTaskRequest
from modules.adapters.runtime.python.worker.tasks import train_model as train_model_module


def _request(tmp_path: Path, method: str = "lora") -> TrainModelTaskRequest:
    dataset_path = tmp_path / "train.jsonl"
    dataset_path.write_text('{"text":"hello"}\n', encoding="utf-8")
    return TrainModelTaskRequest.model_validate(
        {
            "baseModel": {"modelRecordId": "base-1", "modelId": "org/base"},
            "datasets": [{"artifactId": "dataset-1", "splitRole": "train", "path": str(dataset_path), "format": "jsonl"}],
            "method": method,
            "commonParameters": {"numEpochs": 1},
            "output": {"outputModelName": "demo-adapter", "outputDirectory": str(tmp_path / "out")},
            "validation": {"enabled": True, "expectedLoRA": method in {"lora", "qlora"}},
        }
    )


class _FakeModel:
    def save_pretrained(self, output: str, safe_serialization: bool = True, max_shard_size: str | None = None):
        out = Path(output)
        out.mkdir(parents=True, exist_ok=True)
        (out / "model.safetensors").write_bytes(b"tensor")
        (out / "config.json").write_text("{}", encoding="utf-8")


class _FakeTokenizer:
    pad_token = None
    eos_token = "<eos>"

    def save_pretrained(self, output: str):
        out = Path(output)
        out.mkdir(parents=True, exist_ok=True)
        (out / "tokenizer.json").write_text("{}", encoding="utf-8")


def test_resolve_effective_sequence_length_clamps_to_model_context_window() -> None:
    model = SimpleNamespace(config=SimpleNamespace(n_positions=1024))
    tokenizer = SimpleNamespace(model_max_length=2048)

    length, warning = train_model_module._resolve_effective_sequence_length(model, tokenizer, 2048)

    assert length == 1024
    assert warning is not None
    assert "position embedding overflow" in warning


def test_resolve_effective_sequence_length_ignores_transformers_sentinel_tokenizer_limit() -> None:
    model = SimpleNamespace(config=SimpleNamespace())
    tokenizer = SimpleNamespace(model_max_length=1000000000000000019884624838656)

    length, warning = train_model_module._resolve_effective_sequence_length(model, tokenizer, 2048)

    assert length == 2048
    assert warning is None


def test_synchronize_model_token_embeddings_resizes_when_tokenizer_has_added_tokens() -> None:
    class _Embedding:
        num_embeddings = 10

    class _TokenizerWithAddedTokens:
        def __len__(self):
            return 12

    class _ResizableModel:
        resized_to: int | None = None

        def get_input_embeddings(self):
            return _Embedding()

        def resize_token_embeddings(self, size: int) -> None:
            self.resized_to = size

    model = _ResizableModel()

    train_model_module._synchronize_model_token_embeddings(model, _TokenizerWithAddedTokens())

    assert model.resized_to == 12


def test_train_model_validates_required_inputs(tmp_path: Path) -> None:
    payload = _request(tmp_path)
    payload.datasets = []
    result = train_model_module.train_model(payload)

    assert result.status == "failed"
    assert result.error is not None
    assert "at least one" in result.error["message"].lower()


def test_train_model_rejects_unsupported_method(tmp_path: Path) -> None:
    payload = _request(tmp_path)
    payload.method = "full-finetune"
    payload.baseModel.modelId = None
    payload.baseModel.localPath = None

    result = train_model_module.train_model(payload)
    assert result.status == "failed"
    assert "modelid or localpath" in result.error["message"].lower()


def test_train_model_lora_path_returns_real_result_with_mocks(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setattr(train_model_module, "_load_dataset", lambda payload: ({"train": type("T", (), {"column_names": ["text"]})()}, None))
    monkeypatch.setattr(train_model_module, "_resolve_base_model", lambda payload: "org/base")
    monkeypatch.setattr(train_model_module, "_load_transformers_objects", lambda *args, **kwargs: (_FakeModel(), _FakeTokenizer()))
    monkeypatch.setattr(train_model_module, "_tokenize_dataset", lambda dataset, tokenizer, max_length: {"train": [{"input_ids": [1], "labels": [1]}]})
    monkeypatch.setattr(train_model_module, "_apply_lora", lambda model, payload: model)
    monkeypatch.setattr(train_model_module, "_build_training_args", lambda payload, output: type("Args", (), {"output_dir": str(output / "ckpt")} )())
    monkeypatch.setattr(train_model_module, "_run_trainer", lambda *args, **kwargs: ({"loss": 0.1}, [{"path": "x", "step": 1, "metric": "loss", "value": 0.1}]))

    result = train_model_module.train_model(_request(tmp_path, "lora"))

    assert result.status == "succeeded"
    assert result.generatedModelCandidate is not None
    assert result.generatedModelCandidate["artifactForm"] == "adapter"
    assert "provider" not in result.generatedModelCandidate
    assert result.generatedModelCandidate["metadata"]["validation"]["validationReportPath"]


def test_train_model_invalid_validation_fails_and_blocks_generated_registration(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setattr(train_model_module, "_load_dataset", lambda payload: ({"train": type("T", (), {"column_names": ["text"]})()}, None))
    monkeypatch.setattr(train_model_module, "_resolve_base_model", lambda payload: "org/base")
    monkeypatch.setattr(train_model_module, "_load_transformers_objects", lambda *args, **kwargs: (_FakeModel(), _FakeTokenizer()))
    monkeypatch.setattr(train_model_module, "_tokenize_dataset", lambda dataset, tokenizer, max_length: {"train": [{"input_ids": [1], "labels": [1]}]})
    monkeypatch.setattr(train_model_module, "_apply_lora", lambda model, payload: model)
    monkeypatch.setattr(train_model_module, "_build_training_args", lambda payload, output: type("Args", (), {"output_dir": str(output / "ckpt")} )())
    monkeypatch.setattr(train_model_module, "_run_trainer", lambda *args, **kwargs: ({"loss": 0.1}, []))
    monkeypatch.setattr(
        train_model_module,
        "validate_model_output",
        lambda *args, **kwargs: {"status": "invalid", "warnings": [], "errors": ["bad tensors"], "validationReportPath": "/tmp/report.md"},
    )

    result = train_model_module.train_model(_request(tmp_path, "lora"))

    assert result.status == "failed"
    assert result.generatedModelCandidate is None
    assert result.error is not None
    assert result.error["code"] == "validation_failed"


def test_train_model_validation_disabled_marks_unknown(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setattr(train_model_module, "_load_dataset", lambda payload: ({"train": type("T", (), {"column_names": ["text"]})()}, None))
    monkeypatch.setattr(train_model_module, "_resolve_base_model", lambda payload: "org/base")
    monkeypatch.setattr(train_model_module, "_load_transformers_objects", lambda *args, **kwargs: (_FakeModel(), _FakeTokenizer()))
    monkeypatch.setattr(train_model_module, "_tokenize_dataset", lambda dataset, tokenizer, max_length: {"train": [{"input_ids": [1], "labels": [1]}]})
    monkeypatch.setattr(train_model_module, "_apply_lora", lambda model, payload: model)
    monkeypatch.setattr(train_model_module, "_build_training_args", lambda payload, output: type("Args", (), {"output_dir": str(output / "ckpt")} )())
    monkeypatch.setattr(train_model_module, "_run_trainer", lambda *args, **kwargs: ({"loss": 0.1}, []))
    monkeypatch.setattr(train_model_module, "validate_model_output", lambda *args, **kwargs: (_ for _ in ()).throw(AssertionError("should not run")))

    request = _request(tmp_path, "lora")
    request.validation = {"enabled": False}
    result = train_model_module.train_model(request)

    assert result.status == "succeeded"
    assert result.generatedModelCandidate is not None
    assert result.generatedModelCandidate["metadata"]["validation"]["status"] == "unknown"


def test_train_model_qlora_reports_runtime_limitations(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setattr(train_model_module, "_load_dataset", lambda payload: ({"train": type("T", (), {"column_names": ["text"]})()}, None))
    monkeypatch.setattr(train_model_module, "_resolve_base_model", lambda payload: "org/base")
    monkeypatch.setattr(train_model_module, "_load_transformers_objects", lambda *args, **kwargs: (_ for _ in ()).throw(RuntimeError("QLoRA requires CUDA GPU support")))

    result = train_model_module.train_model(_request(tmp_path, "qlora"))
    assert result.status == "failed"
    assert "qlora requires cuda" in result.error["message"].lower()


def test_apply_lora_lets_peft_infer_target_modules_when_not_configured(monkeypatch, tmp_path: Path) -> None:
    captured: dict[str, object] = {}

    class _FakeLoraConfig:
        def __init__(self, **kwargs):
            captured.update(kwargs)

    def fake_get_peft_model(model, config):
        captured["model"] = model
        captured["config"] = config
        return "peft-model"

    monkeypatch.setitem(
        sys.modules,
        "peft",
        SimpleNamespace(
            LoraConfig=_FakeLoraConfig,
            TaskType=SimpleNamespace(CAUSAL_LM="causal-lm"),
            get_peft_model=fake_get_peft_model,
        ),
    )
    payload = _request(tmp_path, "lora")
    payload.advancedParameters = {"lora": {"targetModules": []}}

    result = train_model_module._apply_lora("base-model", payload)

    assert result == "peft-model"
    assert "target_modules" not in captured
    assert captured["model"] == "base-model"


def test_apply_lora_uses_sanitized_explicit_target_modules(monkeypatch, tmp_path: Path) -> None:
    captured: dict[str, object] = {}

    class _FakeLoraConfig:
        def __init__(self, **kwargs):
            captured.update(kwargs)

    monkeypatch.setitem(
        sys.modules,
        "peft",
        SimpleNamespace(
            LoraConfig=_FakeLoraConfig,
            TaskType=SimpleNamespace(CAUSAL_LM="causal-lm"),
            get_peft_model=lambda model, config: model,
        ),
    )
    payload = _request(tmp_path, "lora")
    payload.advancedParameters = {"lora": {"targetModules": [" q_proj ", "", 42, "v_proj"]}}

    train_model_module._apply_lora("base-model", payload)

    assert captured["target_modules"] == ["q_proj", "v_proj"]


def test_run_trainer_reports_estimated_total_batches_before_training(monkeypatch) -> None:
    class _FakeTrainerCallback:
        pass

    class _FakeDataCollator:
        def __init__(self, **_kwargs):
            pass

    class _FakeTrainer:
        state = SimpleNamespace(log_history=[])

        def __init__(self, **_kwargs):
            pass

        def train(self):
            return SimpleNamespace(metrics={})

    monkeypatch.setitem(
        sys.modules,
        "transformers",
        SimpleNamespace(
            DataCollatorForLanguageModeling=_FakeDataCollator,
            Trainer=_FakeTrainer,
            TrainerCallback=_FakeTrainerCallback,
        ),
    )
    progress_events: list[dict[str, int]] = []

    train_model_module._run_trainer(
        model=object(),
        tokenizer=object(),
        dataset={"train": [object()] * 117},
        eval_dataset=None,
        args=SimpleNamespace(
            output_dir="/tmp/checkpoints",
            max_steps=-1,
            per_device_train_batch_size=2,
            gradient_accumulation_steps=1,
            num_train_epochs=1,
        ),
        on_progress=progress_events.append,
    )

    assert progress_events[0] == {"epoch": 0, "totalEpochs": 1, "batch": 0, "totalBatches": 59}
