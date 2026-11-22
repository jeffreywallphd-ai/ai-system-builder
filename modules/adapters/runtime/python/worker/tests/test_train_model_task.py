from __future__ import annotations

import importlib
import json
import sys
from types import SimpleNamespace
from pathlib import Path

import pytest

from modules.adapters.runtime.python.worker.models import TrainModelTaskRequest

train_model_module = importlib.import_module("modules.adapters.runtime.python.worker.tasks.train_model")
multimodal_module = importlib.import_module("modules.adapters.runtime.python.worker.tasks.train_model_multimodal")


def _validation_comparison_fixture(monkeypatch, *, baseline=4.0, candidate=3.0, fail_at=None):
    calls = []
    class Dataset:
        def __init__(self, rows): self.rows = list(rows)
        def __len__(self): return len(self.rows)
        def select(self, indices):
            calls.append(("select", tuple(indices)))
            return Dataset(self.rows[index] for index in indices)
    validation = Dataset(range(100))
    class Trainer:
        def __init__(self, **kwargs):
            self.validation = kwargs["eval_dataset"]
            self.state = SimpleNamespace(log_history=[])
            calls.append(("create", self.validation))
        def evaluate(self, *, eval_dataset, metric_key_prefix):
            assert eval_dataset is self.validation
            calls.append((metric_key_prefix, eval_dataset))
            if fail_at == metric_key_prefix: raise ValueError("synthetic-private-evaluation-failure")
            value = baseline if metric_key_prefix == "baseline_validation" else candidate
            return {metric_key_prefix + "_loss": value, "private": "must-not-be-copied"}
        def train(self):
            calls.append(("train",))
            return SimpleNamespace(metrics={"loss": 2.0, "baseline_validation_loss": 999.0})
    monkeypatch.setitem(sys.modules, "transformers", SimpleNamespace(Trainer=Trainer,
        TrainerCallback=type("Callback", (), {}), DataCollatorForLanguageModeling=lambda **_: object()))
    def run(**options):
        return train_model_module._run_trainer(object(), object(), {"train": [1, 2]}, options.pop("validation", validation),
            SimpleNamespace(output_dir="synthetic-checkpoints"), **options)
    return run, calls, validation


def test_validation_baseline_compares_same_bounded_subset_before_and_after_training(monkeypatch):
    run, calls, original = _validation_comparison_fixture(monkeypatch)
    metrics, checkpoints = run(compare_validation_baseline=True)
    assert [row[0] for row in calls] == ["select", "create", "baseline_validation", "train", "trained_validation"]
    assert calls[0][1] == tuple(range(32))
    selected = calls[1][1]
    assert selected is not original and selected.rows == list(range(32))
    assert calls[2][1] is calls[4][1] is selected
    assert metrics == {"loss": 2.0, "baseline_validation_loss": 4.0, "trained_validation_loss": 3.0,
                       "validation_loss_delta": -1.0, "validation_sample_count": 32.0}
    assert checkpoints == [] and "private" not in json.dumps(metrics)


def test_validation_baseline_is_opt_in_and_does_not_change_ordinary_training(monkeypatch):
    run, calls, validation = _validation_comparison_fixture(monkeypatch)
    metrics, _ = run()
    assert calls == [("create", validation), ("train",)]
    assert metrics == {"loss": 2.0, "baseline_validation_loss": 999.0}


@pytest.mark.parametrize("value", [None, 1, "true", {}, []])
def test_validation_baseline_requires_an_explicit_internal_boolean(monkeypatch, value):
    run, calls, _ = _validation_comparison_fixture(monkeypatch)
    with pytest.raises(ValueError): run(compare_validation_baseline=value)
    assert calls == []


@pytest.mark.parametrize("missing", [None, []])
def test_validation_baseline_missing_data_fails_before_trainer_or_training(monkeypatch, missing):
    run, calls, _ = _validation_comparison_fixture(monkeypatch)
    with pytest.raises(ValueError): run(compare_validation_baseline=True, validation=missing)
    assert calls == []


@pytest.mark.parametrize("baseline,candidate", [(True, 1.0), (float("nan"), 1.0), (float("inf"), 1.0), (-1.0, 1.0),
                                               (1.0, False), (1.0, float("nan")), (1.0, float("inf")), (1.0, -1.0), (1.0, "1.0")])
def test_validation_baseline_rejects_invalid_measurements_without_success(monkeypatch, baseline, candidate):
    run, calls, _ = _validation_comparison_fixture(monkeypatch, baseline=baseline, candidate=candidate)
    with pytest.raises(ValueError): run(compare_validation_baseline=True)
    if type(baseline) is not float or not 0 <= baseline < float("inf"):
        assert not any(row[0] == "train" for row in calls)


@pytest.mark.parametrize("stage", ["baseline_validation", "trained_validation"])
def test_validation_baseline_supplier_failure_is_not_retried_or_hidden(monkeypatch, stage):
    run, calls, _ = _validation_comparison_fixture(monkeypatch, fail_at=stage)
    with pytest.raises(ValueError, match="The validation comparison could not be measured.") as failure:
        run(compare_validation_baseline=True)
    assert str(failure.value.__cause__) == "synthetic-private-evaluation-failure"
    assert "private" not in str(failure.value)
    assert sum(row[0] == stage for row in calls) == 1
    assert sum(row[0] == "train" for row in calls) == (0 if stage == "baseline_validation" else 1)


def test_validation_baseline_small_dataset_uses_only_its_available_rows(monkeypatch):
    run, calls, validation = _validation_comparison_fixture(monkeypatch, baseline=0.0, candidate=0.0)
    validation.rows = ["first", "second"]
    metrics, _ = run(compare_validation_baseline=True)
    assert calls[0] == ("select", (0, 1))
    assert metrics["validation_sample_count"] == 2.0 and metrics["validation_loss_delta"] == 0.0


@pytest.mark.parametrize("report", [{}, {"wrong_loss": 1.0}, {"baseline_validation_loss": None}, [], None])
def test_validation_baseline_missing_or_foreign_supplier_keys_do_not_become_zero(report):
    with pytest.raises(ValueError): train_model_module._validation_loss(report, "baseline_validation_loss")


@pytest.mark.parametrize("key,value", [("validation_sample_count", 0.0), ("validation_sample_count", 33.0),
                                      ("validation_sample_count", 1.5), ("validation_loss_delta", 1.0),
                                      ("validation_loss_delta", float("nan")), ("baseline_validation_loss", True)])
def test_validation_baseline_history_requires_consistent_measured_facts(key, value):
    metrics = {"baseline_validation_loss": 4.0, "trained_validation_loss": 3.0,
               "validation_sample_count": 2.0, "validation_loss_delta": -1.0}
    metrics[key] = value
    with pytest.raises(ValueError): train_model_module._validation_comparison_report(metrics)


def test_validation_baseline_wrong_subset_size_cannot_silently_expand_evaluation(monkeypatch):
    run, calls, validation = _validation_comparison_fixture(monkeypatch)
    validation.select = lambda _: validation
    with pytest.raises(ValueError): run(compare_validation_baseline=True)
    assert calls == []


@pytest.mark.parametrize("value", [1, "true", None])
def test_validation_baseline_invalid_private_option_fails_before_model_paths_or_output(monkeypatch, tmp_path, value):
    request = _request(tmp_path)
    monkeypatch.setattr(train_model_module, "_local_training_model_reference", lambda _: pytest.fail("No model path inspection."))
    with pytest.raises(ValueError): train_model_module.train_model_from_local_files(request, compare_validation_baseline=value)
    assert not (tmp_path / "out").exists()


def test_validation_baseline_cannot_select_the_ordinary_download_capable_loader(tmp_path):
    request = _request(tmp_path)
    with pytest.raises(ValueError): train_model_module._train_model(request, compare_validation_baseline=True)
    assert not (tmp_path / "out").exists()


@pytest.mark.parametrize("phase,expected_training", [("baseline-validation", 0), ("training", 0), ("trained-validation", 1), ("comparison-complete", 1)])
def test_validation_baseline_checks_existing_cancellation_at_each_phase(monkeypatch, phase, expected_training):
    run, calls, _ = _validation_comparison_fixture(monkeypatch)
    cancellation = train_model_module.TrainingCancellationRequested("synthetic-cancelled")
    phases = []
    def progress(value):
        phases.append(value)
        if value == phase: raise cancellation
    with pytest.raises(train_model_module.TrainingCancellationRequested) as failure:
        run(compare_validation_baseline=True, on_validation_progress=progress)
    assert failure.value is cancellation and phases[-1] == phase
    assert sum(row[0] == "train" for row in calls) == expected_training


def test_validation_baseline_evaluator_cancellation_keeps_original_identity():
    cancellation = train_model_module.TrainingCancellationRequested("synthetic-cancelled")
    class CancelledTrainer:
        def evaluate(self, **_): raise cancellation
    with pytest.raises(train_model_module.TrainingCancellationRequested) as failure:
        train_model_module._measure_validation_loss(CancelledTrainer(), object(), "baseline_validation")
    assert failure.value is cancellation


def _inert_transformers(monkeypatch, fail_at=None, *, successful_output=False):
    calls = []
    def tokenizer(reference, **kwargs):
        calls.append(("tokenizer", reference, kwargs))
        if fail_at == "tokenizer":
            raise OSError("Synthetic local tokenizer refusal.")
        return _FakeTokenizer() if successful_output else SimpleNamespace(pad_token="<pad>", eos_token="<eos>")
    def model(reference, **kwargs):
        calls.append(("model", reference, kwargs))
        if fail_at == "model":
            raise OSError("Synthetic local model refusal.")
        return _FakeModel() if successful_output else SimpleNamespace()
    monkeypatch.setitem(sys.modules, "transformers", SimpleNamespace(
        AutoTokenizer=SimpleNamespace(from_pretrained=tokenizer),
        AutoModelForCausalLM=SimpleNamespace(from_pretrained=model),
        BitsAndBytesConfig=lambda **kwargs: kwargs,
    ))
    monkeypatch.setitem(sys.modules, "torch", SimpleNamespace(cuda=SimpleNamespace(is_available=lambda: True), float16="float16"))
    monkeypatch.setitem(sys.modules, "bitsandbytes", SimpleNamespace())
    return calls


@pytest.mark.parametrize("method", ["lora", "qlora", "full-finetune"])
def test_private_training_loader_uses_only_local_safe_weights(monkeypatch, tmp_path, method):
    calls = _inert_transformers(monkeypatch)
    train_model_module._load_transformers_objects(str(tmp_path), method, {}, local_files_only=True)
    assert [call[0] for call in calls] == ["tokenizer", "model"]
    assert all(call[1] == str(tmp_path) for call in calls)
    assert calls[0][2] == {"use_fast": True, "local_files_only": True, "trust_remote_code": False, "token": False}
    expected = {"local_files_only": True, "trust_remote_code": False, "token": False, "use_safetensors": True, "weights_only": True}
    if method == "qlora":
        expected.update(device_map="auto", quantization_config={"load_in_4bit": True, "load_in_8bit": False,
            "bnb_4bit_quant_type": "nf4", "bnb_4bit_compute_dtype": "float16"})
    assert calls[1][2] == expected


def test_ordinary_training_loader_keeps_its_existing_defaults(monkeypatch):
    calls = _inert_transformers(monkeypatch)
    train_model_module._load_transformers_objects("synthetic/base", "full-finetune", {})
    assert calls == [("tokenizer", "synthetic/base", {"use_fast": True}), ("model", "synthetic/base", {})]


@pytest.mark.parametrize("value", [None, "", "synthetic/base", "https://example.invalid/model", "missing", "file"])
def test_private_training_requires_a_local_directory_before_output_or_dataset_io(monkeypatch, tmp_path, value):
    payload = _request(tmp_path)
    if value == "missing":
        value = str(tmp_path / "missing-model")
    elif value == "file":
        file = tmp_path / "not-a-model-directory"
        file.write_bytes(b"synthetic")
        value = str(file)
    payload.baseModel.localPath = value
    monkeypatch.setattr(train_model_module, "_load_dataset", lambda *args: pytest.fail("Invalid source reached dataset IO."))
    calls = _inert_transformers(monkeypatch)
    with pytest.raises(ValueError, match="^A local model directory is required for private training\\.$"):
        train_model_module.train_model_from_local_files(payload)
    assert calls == [] and not (tmp_path / "out").exists()


@pytest.mark.parametrize("training_task", sorted(train_model_module.NON_TEXT_TRAINING_TASKS))
def test_private_training_refuses_unqualified_multimodal_loaders_before_effects(monkeypatch, tmp_path, training_task):
    payload = _request(tmp_path, training_task=training_task)
    payload.baseModel.localPath = str(tmp_path)
    monkeypatch.setattr(train_model_module, "_load_dataset", lambda *args: pytest.fail("Unsupported task reached dataset IO."))
    calls = _inert_transformers(monkeypatch)
    with pytest.raises(ValueError, match="^This private training task is unavailable\\.$"):
        train_model_module.train_model_from_local_files(payload)
    assert calls == [] and not (tmp_path / "out").exists()


@pytest.mark.parametrize("training_task", sorted(train_model_module.TEXT_CAUSAL_TRAINING_TASKS))
@pytest.mark.parametrize("fail_at", ["tokenizer", "model"])
def test_private_training_captures_original_directory_and_never_retries_ordinary_loader(monkeypatch, tmp_path, training_task, fail_at):
    payload = _request(tmp_path, training_task=training_task)
    local_model = tmp_path / "original-model"
    local_model.mkdir()
    payload.baseModel.localPath = str(local_model)
    monkeypatch.setattr(train_model_module, "_load_dataset", lambda *args: ({"train": object()}, None))
    calls = _inert_transformers(monkeypatch, fail_at)
    def progress(record):
        if record["stage"] == "initializing":
            payload.baseModel.localPath = None
            payload.baseModel.modelId = "synthetic/changed-provider"
    result = train_model_module.train_model_from_local_files(payload, on_progress=progress)
    assert result.status == "failed" and result.generatedModelCandidate is None
    assert result.error["details"]["stage"] == "model-loading"
    assert len(calls) == (1 if fail_at == "tokenizer" else 2)
    assert all(reference == str(local_model) and kwargs["local_files_only"] is True
               and kwargs["trust_remote_code"] is False and kwargs["token"] is False
               for _, reference, kwargs in calls)
    if fail_at == "model":
        assert calls[1][2]["use_safetensors"] is True and calls[1][2]["weights_only"] is True


def test_private_training_keeps_installed_cuda_requirement(monkeypatch, tmp_path):
    calls = _inert_transformers(monkeypatch)
    monkeypatch.setitem(sys.modules, "torch", SimpleNamespace(cuda=SimpleNamespace(is_available=lambda: False)))
    with pytest.raises(RuntimeError, match="QLoRA requires CUDA"):
        train_model_module._load_transformers_objects(str(tmp_path), "qlora", {}, local_files_only=True)
    assert calls == []


@pytest.mark.parametrize("mode,attributes", [(0o120777, 0), (0o040700, 0x400)])
def test_private_training_refuses_link_or_reparse_root_before_effects(monkeypatch, tmp_path, mode, attributes):
    payload = _request(tmp_path)
    root = tmp_path / "synthetic-model-root"
    root.mkdir()
    payload.baseModel.localPath = str(root)
    original = Path.lstat
    def lstat(path, *args, **kwargs):
        return SimpleNamespace(st_mode=mode, st_file_attributes=attributes) if path == root else original(path, *args, **kwargs)
    monkeypatch.setattr(Path, "lstat", lstat)
    calls = _inert_transformers(monkeypatch)
    with pytest.raises(ValueError, match="^A local model directory is required for private training\\.$"):
        train_model_module.train_model_from_local_files(payload)
    assert calls == [] and not (tmp_path / "out").exists()


@pytest.mark.parametrize("compare", [False, True])
def test_private_local_training_serializes_calls_validation_and_returns_candidate(monkeypatch, tmp_path, compare):
    payload = _request(tmp_path)
    payload.baseModel.localPath = str(tmp_path)
    calls = _inert_transformers(monkeypatch, successful_output=True)
    monkeypatch.setattr(train_model_module, "_load_dataset", lambda payload: ({"train": object()}, None))
    monkeypatch.setattr(train_model_module, "_tokenize_dataset", _tokenize_fixture)
    monkeypatch.setattr(train_model_module, "_apply_lora", lambda model, payload: model)
    monkeypatch.setattr(train_model_module, "_build_training_args", lambda payload, output: SimpleNamespace(output_dir=str(output / "ckpt")))
    measured = {"loss": 0.125, **({"baseline_validation_loss": 4.0, "trained_validation_loss": 3.0,
                    "validation_loss_delta": -1.0, "validation_sample_count": 2.0} if compare else {})}
    observed_progress = []
    def run_trainer(*args, **kwargs):
        assert kwargs.get("compare_validation_baseline", False) is compare
        if compare:
            for phase in ("baseline-validation", "training", "trained-validation", "comparison-complete"):
                kwargs["on_validation_progress"](phase)
        return measured, []
    monkeypatch.setattr(train_model_module, "_run_trainer", run_trainer)
    validated = []
    def validate(output, **kwargs):
        # Test the actual orchestration/serialization handoff, not tensor loading.
        # A fake Torch module must never enter the real native tensor reader.
        assert (output / "adapter_model.safetensors").is_file()
        assert kwargs == {"expected_lora": True, "expected_recurrent_additions": False}
        validated.append(output)
        return {"status": "valid", "warnings": [], "errors": [], "validationReportPath": "synthetic-validation",
                "serializationFormat": "adapter-safetensors"}
    monkeypatch.setattr(train_model_module, "validate_model_output", validate)
    result = train_model_module.train_model_from_local_files(payload, compare_validation_baseline=compare, on_progress=observed_progress.append)
    assert result.status == "succeeded" and result.metrics == measured
    assert result.generatedModelCandidate["artifactForm"] == "adapter"
    assert result.generatedModelCandidate["baseModelId"] == "org/base"
    assert result.generatedModelCandidate["metadata"]["validation"]["validationReportPath"]
    assert (tmp_path / "out" / "adapter_model.safetensors").is_file()
    assert (tmp_path / "out" / "training-run.json").is_file()
    run_history = json.loads((tmp_path / "out" / "training-run.json").read_text(encoding="utf8"))
    if compare:
        expected = {"protocol": "fixed-first-32-validation-loss-v1", "maximumRows": 32, "sampleCount": 2,
                    "baselineLoss": 4.0, "trainedLoss": 3.0, "lossDelta": -1.0, "interpretation": "measurement-only"}
        assert run_history["validationComparison"] == result.generatedModelCandidate["metadata"]["validationComparison"] == expected
        assert "passed" not in json.dumps(expected) and "accuracy" not in json.dumps(expected)
        assert [row["stage"] for row in observed_progress if row.get("stage") in {"baseline-validation", "trained-validation", "comparison-complete"}] == ["baseline-validation", "trained-validation", "comparison-complete"]
    else:
        assert "validationComparison" not in run_history and "validationComparison" not in result.generatedModelCandidate["metadata"]
    assert validated == [tmp_path / "out"]
    assert [call[0] for call in calls] == ["tokenizer", "model"]
    assert calls[1][2]["use_safetensors"] is True


@pytest.mark.parametrize("entry", ["orchestration", "loader"])
@pytest.mark.parametrize("config_kind", ["adapter", "malformed", "directory"])
def test_private_training_refuses_adapter_roots_before_imports_or_output(monkeypatch, tmp_path, entry, config_kind):
    import builtins
    payload = _request(tmp_path)
    payload.baseModel.localPath = str(tmp_path)
    config = tmp_path / "adapter_config.json"
    if config_kind == "directory":
        config.mkdir()
    else:
        config.write_text('{"base_model_name_or_path":"synthetic/unapproved-base"}' if config_kind == "adapter" else "not-json")
    (tmp_path / "adapter_model.bin").write_bytes(b"inert fixture; never deserialized")
    original = builtins.__import__
    def no_engine_import(name, *args, **kwargs):
        if name in {"transformers", "datasets", "torch", "peft"}:
            pytest.fail("An adapter root reached a training supplier import.")
        return original(name, *args, **kwargs)
    monkeypatch.setattr(builtins, "__import__", no_engine_import)
    with pytest.raises(ValueError, match="^Adapter model loading is unavailable for private training\\.$"):
        if entry == "orchestration":
            train_model_module.train_model_from_local_files(payload)
        else:
            train_model_module._load_transformers_objects(str(tmp_path), "lora", {}, local_files_only=True)
    assert not (tmp_path / "out").exists()


def test_private_training_rechecks_adapter_refusal_after_progress_before_dataset_io(monkeypatch, tmp_path):
    payload = _request(tmp_path)
    payload.baseModel.localPath = str(tmp_path)
    dataset_reads = []
    def unexpected_dataset_read(*args):
        dataset_reads.append(True)
        raise RuntimeError("Synthetic unexpected dataset read.")
    monkeypatch.setattr(train_model_module, "_load_dataset", unexpected_dataset_read)
    def progress(record):
        if record["stage"] == "initializing":
            (tmp_path / "adapter_config.json").write_text("{}")
    result = train_model_module.train_model_from_local_files(payload, on_progress=progress)
    assert result.status == "failed" and result.error["details"]["stage"] == "base-model-resolution"
    assert dataset_reads == []


def test_private_training_rechecks_adapter_refusal_after_tokenizer_before_model_factory(monkeypatch, tmp_path):
    calls = _inert_transformers(monkeypatch)
    original = sys.modules["transformers"].AutoTokenizer.from_pretrained
    def tokenizer(reference, **kwargs):
        (tmp_path / "adapter_config.json").write_text("{}")
        return original(reference, **kwargs)
    monkeypatch.setattr(sys.modules["transformers"].AutoTokenizer, "from_pretrained", tokenizer)
    with pytest.raises(ValueError, match="^Adapter model loading is unavailable for private training\\.$"):
        train_model_module._load_transformers_objects(str(tmp_path), "lora", {}, local_files_only=True)
    assert [call[0] for call in calls] == ["tokenizer"]


@pytest.mark.parametrize("entry", ["orchestration", "loader"])
def test_private_training_refuses_unknown_adapter_config_presence(monkeypatch, tmp_path, entry):
    payload = _request(tmp_path)
    payload.baseModel.localPath = str(tmp_path)
    original = Path.lstat
    def lstat(path, *args, **kwargs):
        if path == tmp_path / "adapter_config.json":
            raise PermissionError("Synthetic inaccessible entry.")
        return original(path, *args, **kwargs)
    monkeypatch.setattr(Path, "lstat", lstat)
    calls = _inert_transformers(monkeypatch)
    monkeypatch.setattr(train_model_module, "_load_dataset", lambda *args: ({"train": object()}, None))
    with pytest.raises(ValueError, match="^A local model directory is required for private training\\.$"):
        if entry == "orchestration":
            train_model_module.train_model_from_local_files(payload)
        else:
            train_model_module._load_transformers_objects(str(tmp_path), "lora", {}, local_files_only=True)
    assert calls == [] and not (tmp_path / "out").exists()


def test_ordinary_training_loader_keeps_adapter_loading_policy(monkeypatch, tmp_path):
    (tmp_path / "adapter_config.json").write_text("{}")
    calls = _inert_transformers(monkeypatch)
    train_model_module._load_transformers_objects(str(tmp_path), "lora", {})
    assert calls == [("tokenizer", str(tmp_path), {"use_fast": True}), ("model", str(tmp_path), {})]


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
        header = json.dumps({"test.lora_A.weight": {"dtype": "F32", "shape": [1], "data_offsets": [0, 4]}}).encode()
        header += b" " * (-len(header) % 8)
        (out / "adapter_model.safetensors").write_bytes(len(header).to_bytes(8, "little") + header + b"\x00" * 4)
        (out / "adapter_config.json").write_text("{}", encoding="utf-8")


class _FakeTokenizer:
    pad_token = None
    eos_token = "<eos>"

    def save_pretrained(self, output: str):
        out = Path(output)
        out.mkdir(parents=True, exist_ok=True)
        (out / "tokenizer.json").write_text("{}", encoding="utf-8")


@pytest.mark.parametrize("operation,stage", [
    ("_resolve_training_purpose_paths", "purpose-mapping"),
    ("_resolve_base_model", "base-model-resolution"),
    ("_load_dataset", "dataset-loading"),
    ("_load_transformers_objects", "model-loading"),
    ("_resolve_effective_sequence_length", "sequence-length"),
    ("_tokenize_dataset", "tokenization"),
    ("_apply_lora", "adapter-configuration"),
    ("_build_training_args", "training-arguments"),
    ("_run_trainer", "training-loop"),
    ("save_adapter_pretrained", "serialization"),
    ("validate_model_output", "validation"),
    ("write_serialization_manifest", "serialization-manifest"),
    ("_write_run_metadata", "run-metadata"),
    ("_training_task_tags", "generated-candidate"),
])
def test_caught_training_failures_identify_only_fixed_stage_and_error_type(monkeypatch, tmp_path, operation, stage):
    # Exercise the real orchestration with inert suppliers, never Torch or a model.
    monkeypatch.setattr(train_model_module, "_load_dataset", lambda payload: ({"train": object()}, None))
    monkeypatch.setattr(train_model_module, "_resolve_base_model", lambda payload: "synthetic/base")
    monkeypatch.setattr(train_model_module, "_load_transformers_objects", lambda *args: (_FakeModel(), _FakeTokenizer()))
    monkeypatch.setattr(train_model_module, "_tokenize_dataset", lambda *args, **kwargs: {"train": object()})
    monkeypatch.setattr(train_model_module, "_apply_lora", lambda model, payload: model)
    monkeypatch.setattr(train_model_module, "_build_training_args", lambda *args: object())
    monkeypatch.setattr(train_model_module, "_run_trainer", lambda *args, **kwargs: ({}, []))
    def fail(*args, **kwargs):
        raise ValueError("private-synthetic-message C:\\private\\model")
    monkeypatch.setattr(train_model_module, operation, fail)
    result = train_model_module.train_model(_request(tmp_path))
    assert result.status == "failed" and result.generatedModelCandidate is None
    assert result.error["code"] == "training_failed"
    # Preserve the existing task error semantics; the new details carry no text.
    assert result.error["message"] == "private-synthetic-message C:\\private\\model"
    assert result.error["details"] == {
        "method": "lora", "trainingTask": "llm-instruction",
        "stage": stage, "errorType": "ValueError",
    }
    assert "private" not in json.dumps(result.error["details"])


def test_training_error_type_does_not_read_custom_error_text_or_names():
    class PrivateError(RuntimeError):
        def __str__(self):
            raise AssertionError("Diagnostic type projection must not read error text.")
    assert train_model_module._training_error_type(PrivateError()) == "OtherError"
    for error, expected in [(ValueError(), "ValueError"), (RuntimeError(), "RuntimeError"),
                            (TypeError(), "TypeError"), (MemoryError(), "MemoryError"),
                            (ImportError(), "ImportError"), (ModuleNotFoundError(), "ModuleNotFoundError")]:
        assert train_model_module._training_error_type(error) == expected


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


def test_training_cancellation_removes_worker_owned_output(monkeypatch, tmp_path: Path) -> None:
    payload = _request(tmp_path)
    payload.output.pop("outputDirectory", None)
    output_path = tmp_path / "cancelled-output"
    monkeypatch.setattr(
        train_model_module.tempfile,
        "mkdtemp",
        lambda prefix: str(output_path),
    )

    def cancel(_progress) -> None:
        raise train_model_module.TrainingCancellationRequested(
            "Model training cancellation requested."
        )

    try:
        train_model_module.train_model(payload, on_progress=cancel)
    except train_model_module.TrainingCancellationRequested:
        pass
    else:
        raise AssertionError("Expected cooperative training cancellation.")

    assert not output_path.exists()


def test_tokenize_dataset_maps_question_and_answer_instruction_aliases() -> None:
    class _Split:
        column_names = ["instruction", "question", "context", "answer"]

    class _DatasetDict(dict):
        def __init__(self):
            super().__init__({"train": _Split()})

        def map(self, callback, *, batched: bool, remove_columns: list[str]):
            assert batched is True
            assert remove_columns == ["instruction", "question", "context", "answer"]
            return callback(
                {
                    "instruction": ["Answer using only the supplied context."],
                    "question": ["What changed?"],
                    "context": ["The policy changed yesterday."],
                    "answer": ["The policy changed yesterday."],
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
    )

    assert tokenizer.captured_texts == [
        "Instruction:\nAnswer using only the supplied context.\nInput:\nWhat changed?\nContext:\nThe policy changed yesterday.\nResponse:\nThe policy changed yesterday."
    ]


def test_resolve_training_purpose_paths_reads_runtime_artifact_metadata(tmp_path: Path) -> None:
    payload = _request(tmp_path)
    payload.datasets[0].metadata = {
        "artifactMetadata": {
            "runtime": {
                "structuredOutput": {
                    "schemaFingerprint": "a" * 64,
                    "purposePaths": {
                        "instruction": ["question"],
                        "output": ["answer"],
                    },
                }
            }
        }
    }

    assert train_model_module._resolve_training_purpose_paths(payload) == {
        "instruction": ("question",),
        "output": ("answer",),
    }


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


@pytest.mark.parametrize("selection", ["empty", "validation-only", "test-only", "unknown-role"])
def test_dataset_split_preflight_runs_before_training_dependency_import(monkeypatch, tmp_path, selection):
    import builtins

    request = _request(tmp_path)
    if selection == "empty":
        request.datasets = []
    else:
        role = {"validation-only": "validation", "test-only": "test", "unknown-role": "not-a-split"}[selection]
        request.datasets = [request.datasets[0].model_copy(update={"splitRole": role})]
    imports = []
    original_import = builtins.__import__

    def guarded_import(name, *args, **kwargs):
        if name == "datasets":
            imports.append(name)
            raise AssertionError("Invalid training selections cannot load a training dependency.")
        return original_import(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", guarded_import)
    expected = "Unsupported training dataset split role" if selection == "unknown-role" else "At least one train split dataset"
    with pytest.raises(ValueError, match=expected):
        train_model_module._load_dataset(request)
    assert imports == []


@pytest.mark.parametrize("test_file_exists", [False, True])
def test_heldout_test_selection_is_not_a_training_or_validation_file(monkeypatch, tmp_path, test_file_exists):
    request = _request(tmp_path)
    heldout = tmp_path / "heldout.jsonl"
    if test_file_exists:
        heldout.write_text('{"text":"Synthetic held-out test row"}\n', encoding="utf-8")
    request.datasets.append(request.datasets[0].model_copy(update={"artifactId": "heldout-test", "splitRole": "test", "path": str(heldout)}))
    original_exists = Path.exists
    checked = []
    loaded = {"train": [{"text": "Synthetic training row"}]}

    def exists(candidate):
        checked.append(candidate)
        if candidate == heldout:
            raise AssertionError("Held-out paths cannot enter training input inspection.")
        return original_exists(candidate)

    def load_local(name, *, data_files):
        assert name == "json"
        assert data_files == {"train": [request.datasets[0].path]}
        return loaded

    monkeypatch.setattr(Path, "exists", exists)
    monkeypatch.setitem(sys.modules, "datasets", SimpleNamespace(load_dataset=load_local))
    actual, evaluation = train_model_module._load_dataset(request)
    assert actual is loaded
    assert evaluation is None
    assert heldout not in checked


def test_train_model_validates_required_inputs(tmp_path: Path) -> None:
    payload = _request(tmp_path)
    payload.datasets = []
    result = train_model_module.train_model(payload)

    assert result.status == "failed"
    assert result.error is not None
    assert "at least one" in result.error["message"].lower()


def test_train_model_rejects_missing_base_model_before_loading(monkeypatch, tmp_path: Path) -> None:
    payload = _request(tmp_path)
    payload.method = "full-finetune"
    payload.baseModel.modelId = None
    payload.baseModel.localPath = None
    def forbidden(*args, **kwargs):
        raise AssertionError("No dataset or model load is permitted before base-model preflight.")
    monkeypatch.setattr(train_model_module, "_load_dataset", forbidden)
    monkeypatch.setattr(train_model_module, "_load_transformers_objects", forbidden)

    result = train_model_module.train_model(payload)
    assert result.status == "failed"
    assert "modelid or localpath" in result.error["message"].lower()


@pytest.mark.parametrize("format_name,builder", [("jsonl", "json"), ("json", "json"), ("csv", "csv"), ("parquet", "parquet")])
@pytest.mark.parametrize("explicit_format", [True, False])
def test_local_dataset_formats_select_only_the_builtin_reader(monkeypatch, tmp_path, format_name, builder, explicit_format):
    request = _request(tmp_path)
    path = tmp_path / ("train." + format_name)
    path.write_text("fixture")
    request.datasets[0].path = str(path)
    request.datasets[0].format = format_name if explicit_format else None
    calls = []
    def load_local(name, *, data_files):
        calls.append((name, data_files))
        assert name in {"json", "csv", "parquet"}
        return {"train": [{"text": "fixture"}]}
    monkeypatch.setitem(sys.modules, "datasets", SimpleNamespace(load_dataset=load_local))
    loaded, evaluation = train_model_module._load_dataset(request)
    assert len(loaded["train"]) == 1
    assert evaluation is None
    assert calls == [(builder, {"train": [str(path)]})]


def test_local_jsonl_reader_keeps_validation_split(monkeypatch, tmp_path):
    request = _request(tmp_path)
    validation = request.datasets[0].model_copy(update={"artifactId": "validation-1", "splitRole": "validation"})
    request.datasets.append(validation)
    expected = {"train": [{"text": "train"}], "validation": [{"text": "validation"}]}
    def load_local(name, *, data_files):
        assert name == "json"
        assert data_files == {"train": [validation.path], "validation": [validation.path]}
        return expected
    monkeypatch.setitem(sys.modules, "datasets", SimpleNamespace(load_dataset=load_local))
    loaded, evaluation = train_model_module._load_dataset(request)
    assert loaded is expected
    assert evaluation is expected["validation"]


def _tokenize_fixture(dataset, tokenizer, max_length, *, training_task, purpose_paths):
    assert training_task in {"llm-instruction", "llm-classification"}
    assert purpose_paths is None
    assert max_length == train_model_module.DEFAULT_SEQUENCE_LENGTH
    return {"train": [{"input_ids": [1], "labels": [1]}]}


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
    monkeypatch.setattr(train_model_module, "_tokenize_dataset", _tokenize_fixture)
    monkeypatch.setattr(train_model_module, "_apply_lora", lambda model, payload: model)
    monkeypatch.setattr(train_model_module, "_build_training_args", lambda payload, output: type("Args", (), {"output_dir": str(output / "ckpt")} )())
    monkeypatch.setattr(train_model_module, "_run_trainer", lambda *args, **kwargs: ({"loss": 0.1}, [{"path": "x", "step": 1, "metric": "loss", "value": 0.1}]))

    result = train_model_module.train_model(_request(tmp_path, "lora", "llm-classification"))

    assert result.status == "succeeded"
    assert result.generatedModelCandidate is not None
    assert result.generatedModelCandidate["artifactForm"] == "adapter"
    assert result.generatedModelCandidate["baseModelId"] == "org/base"
    assert result.generatedModelCandidate["adapterOfModelId"] == "org/base"
    assert "provider" not in result.generatedModelCandidate
    assert result.generatedModelCandidate["taskTags"] == ["text-classification"]
    assert result.generatedModelCandidate["metadata"]["trainingTask"] == "llm-classification"
    assert result.generatedModelCandidate["metadata"]["validation"]["validationReportPath"]


def test_train_model_invalid_validation_fails_and_blocks_generated_registration(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setattr(train_model_module, "_load_dataset", lambda payload: ({"train": type("T", (), {"column_names": ["text"]})()}, None))
    monkeypatch.setattr(train_model_module, "_resolve_base_model", lambda payload: "org/base")
    monkeypatch.setattr(train_model_module, "_load_transformers_objects", lambda *args, **kwargs: (_FakeModel(), _FakeTokenizer()))
    monkeypatch.setattr(train_model_module, "_tokenize_dataset", _tokenize_fixture)
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
    monkeypatch.setattr(train_model_module, "_tokenize_dataset", _tokenize_fixture)
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
        def __init__(self, **kwargs):
            self.args = kwargs["args"]
            self.callbacks = kwargs["callbacks"]
            self.state = SimpleNamespace(log_history=[], global_step=0, epoch=0.0)

        def train(self):
            callback = self.callbacks[0]
            callback.on_substep_end(self.args, self.state, None)
            self.state.global_step = 1
            callback.on_step_end(self.args, self.state, None)
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
            gradient_accumulation_steps=2,
            num_train_epochs=1,
        ),
        on_progress=progress_events.append,
    )

    assert progress_events[:3] == [
        {"epoch": 0, "totalEpochs": 1, "batch": 0, "totalBatches": 59},
        {"epoch": 1, "totalEpochs": 1, "batch": 1, "totalBatches": 59},
        {"epoch": 1, "totalEpochs": 1, "batch": 2, "totalBatches": 59},
    ]


def test_valid_training_selection_retains_explicit_missing_dependency_failure(monkeypatch, tmp_path):
    import builtins

    request = _request(tmp_path)
    imports = []
    original_import = builtins.__import__

    def unavailable(name, *args, **kwargs):
        if name == "datasets":
            imports.append(name)
            raise ModuleNotFoundError("Synthetic missing training dependency")
        return original_import(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", unavailable)
    with pytest.raises(RuntimeError, match="datasets is required for model training dataset loading"):
        train_model_module._load_dataset(request)
    assert imports == ["datasets"]
