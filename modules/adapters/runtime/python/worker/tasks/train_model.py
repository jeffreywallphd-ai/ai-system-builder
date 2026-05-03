from __future__ import annotations

import json
import tempfile
from datetime import datetime, timezone
from math import ceil
from pathlib import Path
from typing import Any, Callable

from ..models import TrainModelTaskRequest, TrainModelTaskResult
from .model_serialization import DEFAULT_MAX_SHARD_SIZE, save_adapter_pretrained, save_full_model_pretrained, write_serialization_manifest
from .model_validation import validate_model_output

SUPPORTED_METHODS = {"lora", "qlora", "full-finetune"}
SUPPORTED_DATASET_FORMATS = {"jsonl", "json", "csv", "parquet"}
DEFAULT_SEQUENCE_LENGTH = 512
MAX_REASONABLE_TOKENIZER_LENGTH = 1_000_000


def _require_non_empty(value: str | None, field: str) -> str:
    if value is None or value.strip() == "":
        raise ValueError(f"{field} is required.")
    return value.strip()


def _to_dict(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        return value
    return {}


def _to_positive_int(value: Any) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        candidate = int(value)
        return candidate if candidate > 0 else None
    if isinstance(value, str) and value.strip():
        try:
            candidate = int(value.strip())
        except ValueError:
            return None
        return candidate if candidate > 0 else None
    return None


def _parse_max_shard_size(payload: TrainModelTaskRequest) -> str:
    output = _to_dict(payload.output)
    raw = output.get("maxShardSize")
    return str(raw).strip() if isinstance(raw, str) and raw.strip() else DEFAULT_MAX_SHARD_SIZE


def _dataset_path(dataset: Any) -> Path:
    if dataset.path is None:
        raise ValueError(f"Dataset '{dataset.artifactId}' is missing path; runtime storage binding must provide a local dataset path.")
    return Path(dataset.path)


def _infer_dataset_format(dataset: Any, path: Path) -> str:
    if dataset.format and dataset.format.strip():
        fmt = dataset.format.strip().lower()
    else:
        ext = path.suffix.lower().lstrip(".")
        fmt = "jsonl" if ext == "jsonl" else ext
    if fmt not in SUPPORTED_DATASET_FORMATS:
        raise ValueError(f"Unsupported dataset format '{fmt}'. Supported formats: {', '.join(sorted(SUPPORTED_DATASET_FORMATS))}.")
    return fmt


def _load_dataset(payload: TrainModelTaskRequest) -> tuple[Any, Any]:
    try:
        from datasets import load_dataset
    except Exception as error:  # pragma: no cover - dependency failure
        raise RuntimeError("datasets is required for model training dataset loading.") from error

    train_files: list[str] = []
    validation_files: list[str] = []
    dataset_format: str | None = None

    for dataset in payload.datasets:
        _require_non_empty(dataset.artifactId, "datasets[].artifactId")
        path = _dataset_path(dataset)
        if not path.exists():
            raise ValueError(f"Dataset path does not exist: {path}")
        fmt = _infer_dataset_format(dataset, path)
        dataset_format = dataset_format or fmt
        if dataset_format != fmt:
            raise ValueError("All training dataset files must use the same format in this runtime implementation.")
        if dataset.splitRole == "validation":
            validation_files.append(str(path))
        else:
            train_files.append(str(path))

    if not train_files:
        raise ValueError("At least one train split dataset is required.")

    dataset_dict = {"train": train_files}
    if validation_files:
        dataset_dict["validation"] = validation_files

    loaded = load_dataset(dataset_format, data_files=dataset_dict)
    if len(loaded["train"]) == 0:
        raise ValueError("Training dataset is empty; refusing to train.")
    return loaded, loaded["validation"] if "validation" in loaded else None


def _resolve_base_model(payload: TrainModelTaskRequest) -> str:
    if payload.baseModel.localPath and payload.baseModel.localPath.strip():
        return payload.baseModel.localPath.strip()
    if payload.baseModel.modelId and payload.baseModel.modelId.strip():
        return payload.baseModel.modelId.strip()
    raise ValueError("baseModel must include modelId or localPath for Python-side training.")


def _load_transformers_objects(base_model_ref: str, method: str, quantization: dict[str, Any]) -> tuple[Any, Any]:
    try:
        from transformers import AutoModelForCausalLM, AutoTokenizer
    except Exception as error:  # pragma: no cover
        raise RuntimeError("transformers is required for model training.") from error

    model_kwargs: dict[str, Any] = {}
    if method == "qlora":
        try:
            import torch
            import bitsandbytes  # noqa: F401
            from transformers import BitsAndBytesConfig
        except Exception as error:
            raise RuntimeError("QLoRA requires bitsandbytes + torch CUDA support in the Python runtime.") from error

        if not torch.cuda.is_available():
            raise RuntimeError("QLoRA requires CUDA GPU support; torch.cuda.is_available() is false.")

        model_kwargs["quantization_config"] = BitsAndBytesConfig(
            load_in_4bit=bool(quantization.get("loadIn4Bit", True)),
            load_in_8bit=bool(quantization.get("loadIn8Bit", False)),
            bnb_4bit_quant_type=str(quantization.get("bnb4BitQuantType", "nf4")),
            bnb_4bit_compute_dtype=getattr(__import__("torch"), str(quantization.get("bnb4BitComputeDtype", "float16"))),
        )
        model_kwargs["device_map"] = "auto"

    tokenizer = AutoTokenizer.from_pretrained(base_model_ref, use_fast=True)
    if tokenizer.pad_token is None:
        if tokenizer.eos_token is not None:
            tokenizer.pad_token = tokenizer.eos_token
        elif hasattr(tokenizer, "add_special_tokens"):
            tokenizer.add_special_tokens({"pad_token": "<pad>"})
        else:
            raise RuntimeError("Tokenizer does not define a pad or EOS token and cannot add a pad token.")

    model = AutoModelForCausalLM.from_pretrained(base_model_ref, **model_kwargs)
    _synchronize_model_token_embeddings(model, tokenizer)
    return model, tokenizer


def _synchronize_model_token_embeddings(model: Any, tokenizer: Any) -> None:
    try:
        tokenizer_size = len(tokenizer)
    except Exception:
        return

    if tokenizer_size <= 0 or not hasattr(model, "get_input_embeddings"):
        return

    embeddings = model.get_input_embeddings()
    model_vocab_size = getattr(embeddings, "num_embeddings", None)
    if not isinstance(model_vocab_size, int) or tokenizer_size <= model_vocab_size:
        return

    if not hasattr(model, "resize_token_embeddings"):
        raise RuntimeError(
            f"Tokenizer vocabulary size ({tokenizer_size}) exceeds model embedding size ({model_vocab_size}), "
            "and this model does not support embedding resizing."
        )

    model.resize_token_embeddings(tokenizer_size)


def _read_model_context_length(model: Any, tokenizer: Any) -> int | None:
    candidates: list[int] = []
    config = getattr(model, "config", None)
    for attribute in [
        "max_position_embeddings",
        "n_positions",
        "max_sequence_length",
        "seq_length",
        "max_seq_len",
    ]:
        value = _to_positive_int(getattr(config, attribute, None))
        if value is not None:
            candidates.append(value)

    tokenizer_limit = _to_positive_int(getattr(tokenizer, "model_max_length", None))
    if tokenizer_limit is not None and tokenizer_limit <= MAX_REASONABLE_TOKENIZER_LENGTH:
        candidates.append(tokenizer_limit)

    return min(candidates) if candidates else None


def _resolve_effective_sequence_length(model: Any, tokenizer: Any, requested_length: Any) -> tuple[int, str | None]:
    requested = _to_positive_int(requested_length) or DEFAULT_SEQUENCE_LENGTH
    model_context_length = _read_model_context_length(model, tokenizer)
    if model_context_length is None or requested <= model_context_length:
        return requested, None

    return (
        model_context_length,
        (
            f"Requested sequence length {requested} exceeds the base model context length "
            f"{model_context_length}; using {model_context_length} to prevent position embedding overflow."
        ),
    )


def _tokenize_dataset(dataset: Any, tokenizer: Any, max_sequence_length: int | None) -> Any:
    block_size = _to_positive_int(max_sequence_length) or DEFAULT_SEQUENCE_LENGTH

    text_column = "text"
    if text_column not in dataset["train"].column_names:
        # fallback for common instruction datasets
        for candidate in ["prompt", "input", "completion", "output"]:
            if candidate in dataset["train"].column_names:
                text_column = candidate
                break

    def tokenize(batch: dict[str, list[Any]]) -> dict[str, Any]:
        texts = [str(item) for item in batch.get(text_column, [])]
        encoded = tokenizer(texts, truncation=True, padding="max_length", max_length=block_size)
        encoded["labels"] = list(encoded["input_ids"])
        return encoded

    return dataset.map(tokenize, batched=True, remove_columns=dataset["train"].column_names)


def _build_training_args(payload: TrainModelTaskRequest, output_dir: Path) -> Any:
    try:
        from transformers import TrainingArguments
    except Exception as error:  # pragma: no cover
        raise RuntimeError("transformers is required for TrainingArguments.") from error

    try:
        import torch
        dataloader_pin_memory = bool(torch.cuda.is_available())
    except Exception:
        dataloader_pin_memory = False

    common = _to_dict(payload.commonParameters)
    advanced = _to_dict(payload.advancedParameters)
    common_max_steps = common.get("maxSteps")
    normalized_max_steps = int(common_max_steps) if isinstance(common_max_steps, (int, float)) else -1
    return TrainingArguments(
        output_dir=str(output_dir / "checkpoints"),
        num_train_epochs=float(common.get("numEpochs", 1)),
        max_steps=normalized_max_steps,
        per_device_train_batch_size=int(common.get("batchSize", 1)),
        per_device_eval_batch_size=int(common.get("batchSize", 1)),
        learning_rate=float(common.get("learningRate", 5e-5)),
        weight_decay=float(common.get("weightDecay", 0.0)),
        gradient_accumulation_steps=int(advanced.get("gradientAccumulationSteps", 1)),
        warmup_steps=int(advanced.get("warmupSteps", 0)),
        warmup_ratio=float(advanced.get("warmupRatio", 0.0)),
        save_steps=int(advanced.get("checkpointIntervalSteps", 50)),
        eval_steps=int(advanced.get("evalIntervalSteps", 0)) if int(advanced.get("evalIntervalSteps", 0)) > 0 else None,
        logging_steps=10,
        save_total_limit=int(advanced.get("saveTotalLimit", 2)),
        label_names=["labels"],
        dataloader_pin_memory=dataloader_pin_memory,
        bf16=advanced.get("mixedPrecision") == "bf16",
        fp16=advanced.get("mixedPrecision") == "fp16",
        gradient_checkpointing=bool(advanced.get("gradientCheckpointing", False)),
        report_to=[],
        remove_unused_columns=False,
    )


def _apply_lora(model: Any, payload: TrainModelTaskRequest) -> Any:
    try:
        from peft import LoraConfig, TaskType, get_peft_model
    except Exception as error:  # pragma: no cover
        raise RuntimeError("peft is required for LoRA/QLoRA training.") from error

    advanced = _to_dict(payload.advancedParameters)
    lora = _to_dict(advanced.get("lora"))
    raw_target_modules = lora.get("targetModules")
    target_modules = (
        [entry.strip() for entry in raw_target_modules if isinstance(entry, str) and entry.strip()]
        if isinstance(raw_target_modules, list)
        else None
    )
    lora_config_args = {
        "r": int(lora.get("rank", 16)),
        "lora_alpha": int(lora.get("alpha", 32)),
        "lora_dropout": float(lora.get("dropout", 0.05)),
        "bias": "none",
        "task_type": TaskType.CAUSAL_LM,
    }
    if target_modules:
        lora_config_args["target_modules"] = target_modules

    lora_config = LoraConfig(**lora_config_args)
    return get_peft_model(model, lora_config)


def _run_trainer(
    model: Any,
    tokenizer: Any,
    dataset: Any,
    eval_dataset: Any | None,
    args: Any,
    *,
    on_progress: Callable[[dict[str, int]], None] | None = None,
) -> tuple[dict[str, float], list[dict[str, Any]]]:
    try:
        from transformers import DataCollatorForLanguageModeling, Trainer, TrainerCallback
    except Exception as error:  # pragma: no cover
        raise RuntimeError("transformers Trainer is required for training.") from error

    def gradient_accumulation_steps() -> int:
        return max(int(getattr(args, "gradient_accumulation_steps", 1) or 1), 1)

    def estimate_total_batches() -> int:
        max_steps = getattr(args, "max_steps", -1)
        if isinstance(max_steps, int) and max_steps > 0:
            return max_steps * gradient_accumulation_steps()

        train_rows = len(dataset["train"])
        per_device_batch_size = max(int(getattr(args, "per_device_train_batch_size", 1) or 1), 1)
        epochs = max(int(ceil(float(getattr(args, "num_train_epochs", 1) or 1))), 1)
        return max(ceil(train_rows / per_device_batch_size), 1) * epochs

    class _TrainingProgressCallback(TrainerCallback):
        def on_step_end(self, _args: Any, state: Any, _control: Any, **_kwargs: Any) -> None:
            if on_progress is None:
                return
            total_steps = estimate_total_batches()
            current_step = int(state.global_step) if isinstance(state.global_step, int) else 0
            total_epochs = int(_args.num_train_epochs) if isinstance(_args.num_train_epochs, (int, float)) else 0
            current_epoch = int(state.epoch) + 1 if isinstance(state.epoch, (int, float)) else 1
            on_progress({
                "epoch": max(current_epoch, 1),
                "totalEpochs": max(total_epochs, 1),
                "batch": min(max(current_step * gradient_accumulation_steps(), 0), total_steps),
                "totalBatches": max(total_steps, 0),
            })

    trainer = Trainer(
        model=model,
        args=args,
        train_dataset=dataset["train"],
        eval_dataset=eval_dataset,
        processing_class=tokenizer,
        data_collator=DataCollatorForLanguageModeling(tokenizer=tokenizer, mlm=False),
        callbacks=[_TrainingProgressCallback()],
    )
    if on_progress is not None:
        total_epochs = int(ceil(float(getattr(args, "num_train_epochs", 1) or 1)))
        on_progress({
            "epoch": 0,
            "totalEpochs": max(total_epochs, 1),
            "batch": 0,
            "totalBatches": estimate_total_batches(),
        })
    train_result = trainer.train()
    metrics: dict[str, float] = {k: float(v) for k, v in train_result.metrics.items() if isinstance(v, (int, float))}

    checkpoints = []
    for state in trainer.state.log_history:
        if "loss" in state and "step" in state:
            checkpoints.append({"path": str(args.output_dir), "step": int(state["step"]), "metric": "loss", "value": float(state["loss"])})
    return metrics, checkpoints


def _write_run_metadata(output_path: Path, metadata: dict[str, Any]) -> str:
    run_metadata_path = output_path / "training-run.json"
    run_metadata_path.write_text(json.dumps(metadata, ensure_ascii=False, indent=2), encoding="utf-8")
    return str(run_metadata_path)


def train_model(
    payload: TrainModelTaskRequest,
    *,
    on_progress: Callable[[dict[str, Any]], None] | None = None,
) -> TrainModelTaskResult:
    _require_non_empty(payload.output.get("outputModelName"), "output.outputModelName")

    if payload.method not in SUPPORTED_METHODS:
        raise ValueError(f"Training method '{payload.method}' is not supported. Supported methods: {', '.join(sorted(SUPPORTED_METHODS))}")

    run_id = f"train-{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')}"
    output_model_name = payload.output.get("outputModelName")
    output_directory = payload.output.get("outputDirectory") or tempfile.mkdtemp(prefix=f"{output_model_name}-")

    output_path = Path(output_directory)
    output_path.mkdir(parents=True, exist_ok=True)

    warnings: list[str] = []
    logs: list[str] = []

    try:
        if on_progress is not None:
            on_progress({"stage": "initializing", "message": "Loading training datasets and model assets..."})

        dataset, eval_dataset = _load_dataset(payload)
        base_model_ref = _resolve_base_model(payload)

        advanced = _to_dict(payload.advancedParameters)
        quantization = _to_dict(advanced.get("quantization"))
        model, tokenizer = _load_transformers_objects(base_model_ref, payload.method, quantization)

        effective_sequence_length, sequence_length_warning = _resolve_effective_sequence_length(
            model,
            tokenizer,
            _to_dict(payload.commonParameters).get("maxSequenceLength"),
        )
        if sequence_length_warning is not None:
            warnings.append(sequence_length_warning)
            logs.append(sequence_length_warning)

        tokenized = _tokenize_dataset(dataset, tokenizer, effective_sequence_length)
        tokenized_eval = tokenized["validation"] if "validation" in tokenized else None

        if payload.method in {"lora", "qlora"}:
            model = _apply_lora(model, payload)
            logs.append(f"Applied {payload.method.upper()} adapter config.")

        train_args = _build_training_args(payload, output_path)
        def on_training_progress(progress: dict[str, int]) -> None:
            message = (
                f"Epoch [{progress.get('epoch', 0)}]/[{progress.get('totalEpochs', 0)}], "
                f"Batch [{progress.get('batch', 0)}]/[{progress.get('totalBatches', 0)}]"
            )
            logs.append(message)
            if on_progress is not None:
                on_progress({**progress, "message": message, "stage": "training"})

        metrics, checkpoints = _run_trainer(model, tokenizer, tokenized, tokenized_eval, train_args, on_progress=on_training_progress)

        if on_progress is not None:
            on_progress({"stage": "serializing", "message": "Serializing trained model artifacts..."})

        max_shard_size = _parse_max_shard_size(payload)
        if payload.method in {"lora", "qlora"}:
            serialization = save_adapter_pretrained(model, tokenizer, output_path)
            artifact_form = "adapter"
        else:
            serialization = save_full_model_pretrained(model, tokenizer, output_path, max_shard_size=max_shard_size)
            artifact_form = "full-model"

        if on_progress is not None:
            on_progress({"stage": "validating", "message": "Running post-training validation..."})

        validation_config = _to_dict(payload.validation)
        validation_enabled = bool(validation_config.get("enabled", True))
        validation = (
            validate_model_output(
                output_path,
                expected_lora=bool(validation_config.get("expectedLoRA", payload.method in {"lora", "qlora"})),
                expected_recurrent_additions=bool(validation_config.get("expectedRecurrentAdditions", False)),
            )
            if validation_enabled
            else {
                "status": "unknown",
                "warnings": ["Validation was disabled and did not run."],
                "errors": [],
                "validationReportPath": None,
            }
        )

        manifest_path = write_serialization_manifest(output_path, {
            "runId": run_id,
            "method": payload.method,
            "serialization": serialization,
            "validation": validation,
        })

        run_metadata_path = _write_run_metadata(
            output_path,
            {
                "runId": run_id,
                "method": payload.method,
                "baseModel": payload.baseModel.model_dump(mode="json"),
                "datasets": [dataset_entry.model_dump(mode="json") for dataset_entry in payload.datasets],
                "startedAt": datetime.now(timezone.utc).isoformat(),
                "status": "failed" if validation_enabled and validation["status"] == "invalid" else "succeeded",
                "serializationManifestPath": manifest_path,
            },
        )

        generated_model_path = str(output_path)
        model_id = payload.baseModel.modelId

        if validation["status"] == "invalid":
            warnings.append("Training output validation failed.")

        metadata = {
            "runtimeTask": "train-model",
            "runMetadataPath": run_metadata_path,
            "validation": validation,
            "serialization": serialization,
        }

        final_status = "failed" if validation_enabled and validation["status"] == "invalid" else "succeeded"
        generated_candidate = None
        if final_status == "succeeded":
            generated_candidate = {
                "displayName": output_model_name,
                "modelId": None,
                "localPath": generated_model_path,
                "artifactForm": artifact_form,
                "inferenceMode": payload.baseModel.inferenceMode,
                "baseModelId": model_id,
                "adapterOfModelId": model_id if artifact_form == "adapter" else None,
                "generatedFromRunId": run_id,
                "serializationFormat": validation.get("serializationFormat") or serialization.get("serializationFormat"),
                "metadata": metadata,
            }

        if on_progress is not None:
            on_progress({"stage": "completed", "message": "Training task completed."})

        return TrainModelTaskResult(
            runId=run_id,
            status=final_status,
            outputDirectory=str(output_path),
            outputModelName=output_model_name,
            logs=logs,
            warnings=warnings + validation.get("warnings", []),
            checkpoints=checkpoints,
            metrics=metrics,
            validationReportPath=validation.get("validationReportPath"),
            generatedModelCandidate=generated_candidate,
            error=(
                {
                    "code": "validation_failed",
                    "message": "Training artifacts failed post-training validation.",
                    "details": {
                        "validationStatus": validation.get("status"),
                        "validationErrors": validation.get("errors", []),
                    },
                }
                if final_status == "failed"
                else None
            ),
        )
    except Exception as error:
        if on_progress is not None:
            on_progress({"stage": "failed", "message": f"Training failed: {error}"})
        return TrainModelTaskResult(
            runId=run_id,
            status="failed",
            outputDirectory=str(output_path),
            outputModelName=output_model_name,
            logs=logs,
            warnings=warnings,
            error={
                "code": "training_failed",
                "message": str(error),
                "details": {
                    "method": payload.method,
                },
            },
        )
