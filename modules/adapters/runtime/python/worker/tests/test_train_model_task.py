from __future__ import annotations

import importlib
import sys
from types import SimpleNamespace
from pathlib import Path

from modules.adapters.runtime.python.worker.models import TrainModelTaskRequest

train_model_module = importlib.import_module("modules.adapters.runtime.python.worker.tasks.train_model")
multimodal_module = importlib.import_module("modules.adapters.runtime.python.worker.tasks.train_model_multimodal")


def _request(tmp_path: Path, method: str = "lora", training_task: str = "llm-instruction") -> TrainModelTaskRequest:
    dataset_path = tmp_path / "train.jsonl"
    dataset_path.write_text('{"text":"hello"}\n', encoding="utf-8")
    return TrainModelTaskRequest.model_validate(
        {
            "trainingTask": training_task,
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


def test_tokenize_dataset_formats_classification_rows_for_causal_training() -> None:
    class _Split:
        column_names = ["text", "label"]

    class _DatasetDict(dict):
        def __init__(self):
            super().__init__({"train": _Split()})

        def map(self, callback, *, batched: bool, remove_columns: list[str]):
            assert batched is True
            assert remove_columns == ["text", "label"]
            return callback({"text": ["Payment failed"], "label": ["billing"]})

    class _Tokenizer:
        captured_texts: list[str] | None = None

        def __call__(self, texts, **_kwargs):
            self.captured_texts = texts
            return {"input_ids": [[1, 2, 3]]}

    tokenizer = _Tokenizer()

    tokenized = train_model_module._tokenize_dataset(_DatasetDict(), tokenizer, 128)

    assert tokenizer.captured_texts == ["Text:\nPayment failed\nLabel:\nbilling"]
    assert tokenized["labels"] == [[1, 2, 3]]


def test_tokenize_dataset_uses_nested_purpose_paths_for_custom_instruction_fields() -> None:
    class _Split:
        column_names = ["request", "result"]

    class _DatasetDict(dict):
        def __init__(self):
            super().__init__({"train": _Split()})

        def map(self, callback, *, batched: bool, remove_columns: list[str]):
            assert batched is True
            assert remove_columns == ["request", "result"]
            return callback(
                {
                    "request": [
                        {
                            "task": "Answer the input using only the context.",
                            "input": "What does the policy say?",
                            "context": "Policy text",
                        }
                    ],
                    "result": [
                        {
                            "thought": "The policy text directly supports the explanation.",
                            "answer": "The policy explanation",
                        }
                    ],
                }
            )

    class _Tokenizer:
        captured_texts: list[str] | None = None

        def __call__(self, texts, **_kwargs):
            self.captured_texts = texts
            return {"input_ids": [[1, 2, 3]]}

    tokenizer = _Tokenizer()
    train_model_module._tokenize_dataset(
        _DatasetDict(),
        tokenizer,
        128,
        training_task="llm-instruction",
        purpose_paths={
            "instruction": ("request", "task"),
            "input": ("request", "input"),
            "context": ("request", "context"),
            "thought": ("result", "thought"),
            "output": ("result", "answer"),
        },
    )

    assert tokenizer.captured_texts == [
        "Instruction:\nAnswer the input using only the context.\nInput:\nWhat does the policy say?\nContext:\nPolicy text\nThought:\nThe policy text directly supports the explanation.\nResponse:\nThe policy explanation"
    ]


def test_resolve_training_purpose_paths_requires_matching_dataset_layouts(tmp_path: Path) -> None:
    payload = _request(tmp_path)
    payload.datasets[0].metadata = {
        "artifactMetadata": {
            "structuredOutput": {
                "schemaFingerprint": "a" * 64,
                "purposePaths": {
                    "instruction": ["request"],
                    "output": ["answer"],
                }
            }
        }
    }
    resolved = train_model_module._resolve_training_purpose_paths(payload)
    assert resolved == {
        "instruction": ("request",),
        "output": ("answer",),
    }

    second = payload.datasets[0].model_copy(deep=True)
    second.artifactId = "dataset-2"
    second.metadata = None
    payload.datasets.append(second)
    try:
        train_model_module._resolve_training_purpose_paths(payload)
    except ValueError as error:
        assert "same generated field layout" in str(error)
    else:
        raise AssertionError("Mixed purpose-map metadata should fail closed.")

    payload.datasets = [payload.datasets[0], payload.datasets[0].model_copy(deep=True)]
    payload.datasets[1].artifactId = "dataset-2"
    payload.datasets[1].metadata["artifactMetadata"]["structuredOutput"][
        "schemaFingerprint"
    ] = "b" * 64
    try:
        train_model_module._resolve_training_purpose_paths(payload)
    except ValueError as error:
        assert "same generated field layout" in str(error)
    else:
        raise AssertionError("Mismatched schema fingerprints should fail closed.")


def test_multimodal_label_collectors_use_nested_purpose_paths() -> None:
    purpose_paths = {"label": ("result", "category")}
    classification_rows = [{"result": {"category": "invoice"}}]
    detection_rows = [
        {
            "boundingBoxes": [[1, 2, 3, 4]],
            "boxFormat": "xywh",
            "result": {"category": "invoice"},
        }
    ]

    assert multimodal_module._collect_classification_labels(
        classification_rows, purpose_paths
    ) == ["invoice"]
    assert multimodal_module._collect_detection_labels(
        detection_rows, purpose_paths
    ) == ["invoice"]
    assert multimodal_module._collect_segmentation_labels(
        classification_rows, purpose_paths
    ) == ["invoice"]


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


def test_train_model_routes_vision_training_task_to_multimodal_trainer(monkeypatch, tmp_path: Path) -> None:
    captured: dict[str, object] = {}

    def fake_train_vision_model(payload, **kwargs):
        captured["payload"] = payload
        captured.update(kwargs)
        return train_model_module.TrainModelTaskResult(runId=kwargs["run_id"], status="succeeded", outputModelName=kwargs["output_model_name"])

    monkeypatch.setattr(multimodal_module, "train_vision_model", fake_train_vision_model)
    payload = _request(tmp_path, method="full-finetune", training_task="vision-detection")

    result = train_model_module.train_model(payload)

    assert result.status == "succeeded"
    assert captured["payload"] is payload
    assert captured["training_task"] == "vision-detection"


def test_train_model_routes_diffusion_training_task_to_multimodal_trainer(monkeypatch, tmp_path: Path) -> None:
    captured: dict[str, object] = {}

    def fake_train_diffusion_lora_model(payload, **kwargs):
        captured["payload"] = payload
        captured.update(kwargs)
        return train_model_module.TrainModelTaskResult(runId=kwargs["run_id"], status="succeeded", outputModelName=kwargs["output_model_name"])

    monkeypatch.setattr(multimodal_module, "train_diffusion_lora_model", fake_train_diffusion_lora_model)
    payload = _request(tmp_path, method="lora", training_task="diffusion-lora")

    result = train_model_module.train_model(payload)

    assert result.status == "succeeded"
    assert captured["payload"] is payload
    assert captured["training_task"] == "diffusion-lora"


def test_train_model_lora_path_returns_real_result_with_mocks(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setattr(train_model_module, "_load_dataset", lambda payload: ({"train": type("T", (), {"column_names": ["text"]})()}, None))
    monkeypatch.setattr(train_model_module, "_resolve_base_model", lambda payload: "org/base")
    monkeypatch.setattr(train_model_module, "_load_transformers_objects", lambda *args, **kwargs: (_FakeModel(), _FakeTokenizer()))
    monkeypatch.setattr(train_model_module, "_tokenize_dataset", lambda dataset, tokenizer, max_length: {"train": [{"input_ids": [1], "labels": [1]}]})
    monkeypatch.setattr(train_model_module, "_apply_lora", lambda model, payload: model)
    monkeypatch.setattr(train_model_module, "_build_training_args", lambda payload, output: type("Args", (), {"output_dir": str(output / "ckpt")} )())
    monkeypatch.setattr(train_model_module, "_run_trainer", lambda *args, **kwargs: ({"loss": 0.1}, [{"path": "x", "step": 1, "metric": "loss", "value": 0.1}]))

    result = train_model_module.train_model(_request(tmp_path, "lora", "llm-classification"))

    assert result.status == "succeeded"
    assert result.generatedModelCandidate is not None
    assert result.generatedModelCandidate["artifactForm"] == "adapter"
    assert "provider" not in result.generatedModelCandidate
    assert result.generatedModelCandidate["taskTags"] == ["text-classification"]
    assert result.generatedModelCandidate["metadata"]["trainingTask"] == "llm-classification"
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
