from __future__ import annotations

import json
import hashlib
import re
import os
import stat
import sys
import tempfile
from collections import OrderedDict
from types import BuiltinMethodType, FunctionType, GetSetDescriptorType, MethodType, ModuleType
from shutil import rmtree
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from math import ceil, isfinite
from pathlib import Path
from threading import get_ident
from time import monotonic_ns
from typing import Any, Callable
from weakref import WeakKeyDictionary, ref

from ..models import TrainModelTaskRequest, TrainModelTaskResult
from ..native.windows_original_worker_launch import (LaunchUnavailable, OriginalTrainingDenseTensorStream,
    OriginalTrainingOutputFamily, OriginalTrainingOutputGraph, _fail_output_family, _output_family_snapshot,
    _resolve_output_family_for_training, _claim_output_family_training, _guard_output_family_training,
    _output_family_training_binding,
    retire_original_training_output_family, admit_retired_training_output_family, _copy_model_json,
    resolve_original_training_references, resolve_original_training_task_id,
    read_original_training_input_bytes, read_original_training_output_chunks)
from .model_serialization import DEFAULT_MAX_SHARD_SIZE, save_adapter_pretrained, save_full_model_pretrained, write_serialization_manifest
from .model_validation import validate_model_output, validate_protected_training_output_chunks
from .original_training_output_delivery import (capture_original_output_delivery,original_output_delivery_matches,
    begin_original_output_delivery, tee_original_output_delivery, finish_original_output_delivery,
    abort_original_output_delivery)

SUPPORTED_METHODS = {"lora", "qlora", "full-finetune"}
SUPPORTED_DATASET_FORMATS = {"jsonl", "json", "csv", "parquet"}
DEFAULT_TRAINING_TASK = "llm-instruction"
TEXT_CAUSAL_TRAINING_TASKS = {
    "llm-instruction",
    "llm-classification",
    "llm-extraction",
    "llm-embedding",
    "llm-reranker",
}
NON_TEXT_TRAINING_TASKS = {
    "diffusion-lora",
    "vision-classification",
    "vision-detection",
    "vision-segmentation",
}
DIFFUSION_TRAINING_TASKS = {"diffusion-lora"}
VISION_TRAINING_TASKS = {"vision-classification", "vision-detection", "vision-segmentation"}
DEFAULT_SEQUENCE_LENGTH = 512
MAX_REASONABLE_TOKENIZER_LENGTH = 1_000_000
_NATIVE_REQUEST_SERIALIZER = TrainModelTaskRequest.__pydantic_serializer__.to_python
_NATIVE_REFERENCE_RESOLVER = resolve_original_training_references
_NATIVE_TASK_ID_RESOLVER = resolve_original_training_task_id
_NATIVE_TRAINING_INPUT_READER = read_original_training_input_bytes
_NATIVE_TRAINING_OUTPUT_READER = read_original_training_output_chunks
_ORIGINAL_OUTPUT_DELIVERIES = WeakKeyDictionary()
_ORIGINAL_OUTPUT_ABORT = abort_original_output_delivery
_NATIVE_TENSOR_STREAM = OriginalTrainingDenseTensorStream
_NATIVE_OUTPUT_INIT = OriginalTrainingOutputGraph.__init__
_NATIVE_OUTPUT_GUARD = OriginalTrainingOutputGraph.guard
_NATIVE_OUTPUT_PREPARE = OriginalTrainingOutputGraph.prepare
_NATIVE_OUTPUT_ASSERT_SEALED = OriginalTrainingOutputGraph.assert_sealed
_NATIVE_OUTPUT_FAMILY_TYPE = OriginalTrainingOutputFamily
_NATIVE_OUTPUT_FAMILY_SNAPSHOT = _output_family_snapshot
_NATIVE_OUTPUT_FAMILY_FAIL = _fail_output_family
_NATIVE_CHECKPOINT_FAMILY_RESOLVE = _resolve_output_family_for_training
_NATIVE_CHECKPOINT_FAMILY_CLAIM = _claim_output_family_training
_NATIVE_CHECKPOINT_FAMILY_GUARD = _guard_output_family_training
_NATIVE_CHECKPOINT_FAMILY_OWNER = _output_family_training_binding
_NATIVE_OUTPUT_FAMILY_RETIRE = retire_original_training_output_family
_NATIVE_RETIRED_FAMILY_ADMIT = admit_retired_training_output_family
_NATIVE_RESULT_COPY = _copy_model_json
_RESULT_FACTORY = TrainModelTaskResult.__pydantic_validator__.validate_python
_RESULT_CLASS = TrainModelTaskResult
_RESULT_API = tuple((base,name,type.__getattribute__(base,"__dict__").get(name))
    for base in type.__getattribute__(_RESULT_CLASS,"__mro__")
    for name in ("__getattribute__","__getattr__","__init__","model_post_init","model_dump",
        "__dict__","__pydantic_extra__","__pydantic_private__",
        "__pydantic_serializer__","__pydantic_validator__"))
_SDK_ATTRIBUTE_MISSING = object()
_PURPOSE_PATH_SEGMENT = re.compile(r"^[A-Za-z_][A-Za-z0-9_-]{0,63}$")
_TRAINING_TASK_REQUIRED_PURPOSES = {
    "llm-instruction": ("instruction", "output"),
    "llm-classification": ("label",),
    "llm-extraction": ("expected-output",),
    "llm-embedding": ("anchor-text", "positive-text"),
    "llm-reranker": ("query", "passage"),
    "diffusion-lora": ("caption",),
    "vision-classification": ("label",),
    "vision-detection": ("label",),
    "vision-segmentation": ("label",),
}
_CHECKPOINT_EXPORTS = WeakKeyDictionary()
_TRAINING_PIPELINES = WeakKeyDictionary()
_TRAINING_WORKFLOWS = WeakKeyDictionary()


class _TrainingWorkflowBinding:
    __slots__ = ("slot","claim","__weakref__")
    def __init__(self,slot,claim):
        object.__setattr__(self,"slot",slot);object.__setattr__(self,"claim",claim)
    def __setattr__(self,_name,_value):raise ValueError("The private workflow proof is immutable.")


def _record_workflow_training_claim(use,family,slot,snapshot):
    reference = _TRAINING_WORKFLOWS.get(use)
    proof = reference() if reference is not None else None
    if proof is None:
        if use._workflow_slot is not None:raise ValueError("The private workflow owner is unavailable.")
        return
    if (type(proof) is not _TrainingWorkflowBinding or use._workflow_slot is not proof.slot
            or proof.slot.get("proof") is not proof):raise ValueError("The private workflow owner changed.")
    claim = _NATIVE_CHECKPOINT_FAMILY_OWNER(family)
    if (type(claim) is not tuple or len(claim) != 3 or claim[0] is not use or claim[1] is not slot
            or claim[2] is not snapshot):raise ValueError("The private workflow claim is unavailable.")
    proof.claim(family,claim)


class _TrainingPipelineBinding:
    """Private passive proof, retained by its Use without a global strong cycle."""
    __slots__ = ("slot", "snapshot", "__weakref__")

    def __init__(self, slot, snapshot):
        object.__setattr__(self,"slot",slot)
        object.__setattr__(self,"snapshot",snapshot)

    def __setattr__(self,_name,_value):
        raise ValueError("The private training pipeline proof is immutable.")


def _training_pipeline_proof(use):
    reference = _TRAINING_PIPELINES.get(use)
    proof = reference() if reference is not None else None
    if proof is None:
        if use._pipeline_slot is not None:
            raise ValueError("The private training pipeline proof is unavailable.")
    elif (type(proof) is not _TrainingPipelineBinding or use._pipeline_slot is not proof.slot
            or proof.slot.get("proof") is not proof):
        raise ValueError("The private training pipeline proof changed.")
    return proof


class _CheckpointExport:
    """Fixed private proof; weak registry values cannot retain an old run."""
    __slots__ = ("current","snapshot","__weakref__")

    def __init__(self,current,snapshot):
        object.__setattr__(self,"current",current)
        object.__setattr__(self,"snapshot",snapshot)

    def __setattr__(self,_name,_value):
        raise ValueError("The private checkpoint export is immutable.")


def _checkpoint_export_proof(use):
    stored = _CHECKPOINT_EXPORTS.get(use)
    proof = stored() if stored is not None else None
    if proof is None:
        if use._checkpoint_export_guard is not None or use._checkpoint_export_binding is not None:
            raise ValueError("The private checkpoint export is unavailable.")
    elif (type(proof) is not _CheckpointExport or use._checkpoint_export_binding is not proof
            or use._checkpoint_export_guard is not proof.current):
        raise ValueError("The private checkpoint export changed.")
    return proof


class TrainingCancellationRequested(RuntimeError):
    pass


def _training_error_type(error: BaseException) -> str:
    """Fixed diagnostic types only; never inspect custom names or error text."""
    for error_class, name in (
        (ValueError, "ValueError"), (RuntimeError, "RuntimeError"),
        (TypeError, "TypeError"), (MemoryError, "MemoryError"),
        (ImportError, "ImportError"), (ModuleNotFoundError, "ModuleNotFoundError"),
        (OSError, "OSError"), (AttributeError, "AttributeError"),
        (KeyError, "KeyError"), (IndexError, "IndexError"),
        (AssertionError, "AssertionError"),
    ):
        if type(error) is error_class:
            return name
    return "OtherError"


def _require_non_empty(value: str | None, field: str) -> str:
    if value is None or value.strip() == "":
        raise ValueError(f"{field} is required.")
    return value.strip()


def _to_dict(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        return value
    return {}


def _validate_training_seed(value):
    if value is not None and (type(value) is not int or not 0 <= value < 2**32):
        raise ValueError("Training seed must be a whole number from 0 to 4294967295.")
    return value


def _text_training_settings(payload):
    seed = _validate_training_seed(_to_dict(payload.commonParameters).get("seed"))
    advanced = _to_dict(payload.advancedParameters)
    scheduler = advanced.get("schedulerType")
    if scheduler is None: scheduler = "linear"
    if type(scheduler) is not str or re.fullmatch(r"[a-z][a-z0-9_]{0,63}",scheduler) is None:
        raise ValueError("Select a supported training scheduler.")
    interval = advanced.get("evalIntervalSteps")
    if interval is None: interval = 0
    if type(interval) is not int or not 0 <= interval <= 2**53-1:
        raise ValueError("Evaluation interval must be a nonnegative whole number.")
    if interval > 0 and not any(row.splitRole == "validation" for row in payload.datasets):
        raise ValueError("Select a validation dataset or turn off interval evaluation.")
    return seed, scheduler, interval


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


def _resolve_training_task(payload: TrainModelTaskRequest) -> str:
    raw = payload.trainingTask
    if not raw and isinstance(payload.runMetadata, dict):
        metadata_task = payload.runMetadata.get("trainingTask")
        if isinstance(metadata_task, str):
            raw = metadata_task
        else:
            metadata_task = payload.runMetadata.get("trainingTaskType")
            raw = metadata_task if isinstance(metadata_task, str) else raw
    normalized = str(raw or DEFAULT_TRAINING_TASK).strip().lower()
    return normalized or DEFAULT_TRAINING_TASK


def _training_task_tags(training_task: str) -> list[str]:
    return {
        "llm-instruction": ["text-generation"],
        "llm-classification": ["text-classification"],
        "llm-extraction": ["token-classification", "text-generation"],
        "llm-embedding": ["sentence-similarity", "feature-extraction"],
        "llm-reranker": ["text-ranking"],
        "diffusion-lora": ["text-to-image"],
        "vision-classification": ["image-classification"],
        "vision-detection": ["object-detection"],
        "vision-segmentation": ["image-segmentation"],
    }.get(training_task, [])


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


def _resolve_training_purpose_paths(
    payload: TrainModelTaskRequest,
) -> dict[str, tuple[str, ...]] | None:
    resolved: list[dict[str, tuple[str, ...]] | None] = []
    fingerprints: list[str | None] = []
    for dataset in payload.datasets:
        metadata = _to_dict(dataset.metadata)
        artifact_metadata = _to_dict(metadata.get("artifactMetadata"))
        runtime_metadata = _to_dict(artifact_metadata.get("runtime"))
        structured_output = _to_dict(
            artifact_metadata.get("structuredOutput")
            or runtime_metadata.get("structuredOutput")
            or metadata.get("structuredOutput")
        )
        raw_paths = structured_output.get("purposePaths")
        if raw_paths is None:
            resolved.append(None)
            fingerprints.append(None)
            continue
        raw_fingerprint = structured_output.get("schemaFingerprint")
        if (
            not isinstance(raw_fingerprint, str)
            or re.fullmatch(r"[a-f0-9]{64}", raw_fingerprint) is None
        ):
            raise ValueError("Dataset structured-output metadata is invalid.")
        if not isinstance(raw_paths, dict) or len(raw_paths) > 32:
            raise ValueError("Dataset structured-output purpose paths are invalid.")
        normalized: dict[str, tuple[str, ...]] = {}
        for purpose, raw_path in raw_paths.items():
            if (
                not isinstance(purpose, str)
                or len(purpose) > 64
                or not isinstance(raw_path, list)
                or not 1 <= len(raw_path) <= 8
                or any(
                    not isinstance(segment, str)
                    or not _PURPOSE_PATH_SEGMENT.fullmatch(segment)
                    for segment in raw_path
                )
            ):
                raise ValueError("Dataset structured-output purpose paths are invalid.")
            normalized[purpose] = tuple(raw_path)
        resolved.append(normalized)
        fingerprints.append(raw_fingerprint)

    available = [paths for paths in resolved if paths is not None]
    if not available:
        return None
    if len(available) != len(resolved):
        raise ValueError(
            "Selected datasets do not share the same generated field layout. Prepare matching dataset versions before training."
        )
    canonical = json.dumps(available[0], sort_keys=True)
    if any(json.dumps(paths, sort_keys=True) != canonical for paths in available[1:]):
        raise ValueError(
            "Selected datasets do not share the same generated field layout. Prepare matching dataset versions before training."
        )
    available_fingerprints = [
        fingerprint for fingerprint in fingerprints if fingerprint is not None
    ]
    if any(
        fingerprint != available_fingerprints[0]
        for fingerprint in available_fingerprints[1:]
    ):
        raise ValueError(
            "Selected datasets do not share the same generated field layout. Prepare matching dataset versions before training."
        )
    return available[0]


def _sdk_static_attribute(cls, name):
    bases = type.__getattribute__(cls,"__mro__")
    if len(bases) > 64: raise ValueError("The private SDK class is unavailable.")
    for base in bases:
        namespace = type.__getattribute__(base,"__dict__")
        if name in namespace: return namespace[name]
    return _SDK_ATTRIBUTE_MISSING


def _sdk_passive_fields(obj):
    cls = type(obj); descriptor = _sdk_static_attribute(cls,"__dict__")
    if type(descriptor) is not GetSetDescriptorType:
        raise ValueError("The private SDK fields are unavailable.")
    fields = descriptor.__get__(obj,cls)
    if type(fields) is not dict: raise ValueError("The private SDK fields are unavailable.")
    return fields


def _capture_passive_sdk_attribute(obj, name, expected):
    """Capture fixed field paths; final reads never invoke SDK properties."""
    witnesses = []
    def fields(owner, member):
        cls=type(owner); original=_sdk_passive_fields(owner)
        definitions=tuple((key,_sdk_static_attribute(cls,key)) for key in
            ("__dict__","__getattribute__","__getattr__",member))
        witnesses.append((owner,cls,original,definitions))
        return original
    root=fields(obj,name); descriptor=_sdk_static_attribute(type(obj),name)
    direct = descriptor is _SDK_ATTRIBUTE_MISSING or descriptor is None
    if direct and root.get(name,None) is expected:
        path=((root,name,expected),)
    else:
        module_name, class_name = (("transformers.tokenization_utils_fast","PreTrainedTokenizerFast")
            if name=="backend_tokenizer" else ("peft.peft_model","PeftModel"))
        module=sys.modules.get(module_name)
        cls=vars(module).get(class_name) if isinstance(module,ModuleType) else None
        canonical=_sdk_static_attribute(cls,name) if isinstance(cls,type) else None
        if type(descriptor) is not property or descriptor is not canonical:
            raise ValueError("The private SDK attribute profile is unavailable.")
        if name=="backend_tokenizer" and root.get("_tokenizer") is expected:
            if _sdk_static_attribute(type(obj),"_tokenizer") is not _SDK_ATTRIBUTE_MISSING:
                raise ValueError("The private tokenizer field profile is unavailable.")
            fields(obj,"_tokenizer")
            path=((root,"_tokenizer",expected),)
        elif name=="peft_config":
            # Pinned PEFT's property selects _peft_config for prompt learning.
            # The fixed LoRA writer supports only its explicit nonprompt branch.
            if (root.get("_is_prompt_learning") is not False
                    or _sdk_static_attribute(type(obj),"_is_prompt_learning") is not _SDK_ATTRIBUTE_MISSING
                    or _sdk_static_attribute(type(obj),"base_model") is not _SDK_ATTRIBUTE_MISSING):
                raise ValueError("The private SDK configuration branch is unavailable.")
            fields(obj,"_is_prompt_learning"); fields(obj,"base_model")
            modules=root.get("_modules")
            if type(modules) is not dict: raise ValueError("The private SDK module fields are unavailable.")
            base=modules.get("base_model"); base_fields=fields(base,"peft_config")
            if (_sdk_static_attribute(type(base),"peft_config") not in (_SDK_ATTRIBUTE_MISSING,None)
                    or base_fields.get("peft_config") is not expected):
                raise ValueError("The private SDK configuration profile is unavailable.")
            path=((root,"_is_prompt_learning",False),(root,"_modules",modules),
                (modules,"base_model",base),(base_fields,"peft_config",expected))
        else: raise ValueError("The private SDK attribute profile is unavailable.")
    def read():
        for owner,cls,original,definitions in witnesses:
            if type(owner) is not cls or _sdk_passive_fields(owner) is not original:
                raise ValueError("The private SDK field binding changed.")
            if any(_sdk_static_attribute(cls,key) is not value for key,value in definitions):
                raise ValueError("The private SDK attribute definition changed.")
        if any(container.get(key,None) is not original for container,key,original in path):
            raise ValueError("The private SDK attribute changed.")
        return expected
    read()
    return read


class _ProtectedTrainingUse:
    """Fixed private view use, not a caller-selected guard or public capability."""
    __slots__ = ("payload","view","model_reference","dataset_references","_resolve","_resolve_task_id","_serialize",
        "_tensor_stream_type","_embedding_status","_embedding_model","_embedding_tokenizer",
        "_embedding_observation_lost","_tensor_selection_slot","_metadata_slot","_output_graph_type","_output_slot","_request_stamp",
        "_run_identity","_training_driver","_training_slot","_thread","_completion_helpers",
        "_dataset_reader","_dataset_loader","_dataset_parquet_reader","_dataset_slot",
        "_pipeline_driver","_pipeline_helpers","_pipeline_slot",
        "_result_validation_driver","_result_validation_helpers","_result_validation_slot",
        "_workflow_driver","_workflow_helpers","_workflow_slot",
        "_output_family_type","_output_family_snapshot","_output_family_fail",
        "_checkpoint_slot","_checkpoint_family_resolve","_checkpoint_family_claim","_checkpoint_family_guard",
        "_checkpoint_family_owner","_checkpoint_export_guard","_checkpoint_export_binding","_final_result_slot","__weakref__")

    def __init__(self, payload, view):
        if type(payload) is not TrainModelTaskRequest:
            raise ValueError("The private protected training request is unavailable.")
        self.payload, self.view = payload, view
        self._resolve, self._serialize = _NATIVE_REFERENCE_RESOLVER, _NATIVE_REQUEST_SERIALIZER
        self._resolve_task_id = _NATIVE_TASK_ID_RESOLVER
        self._dataset_reader, self._dataset_loader = _NATIVE_TRAINING_INPUT_READER, _load_protected_dataset
        self._dataset_parquet_reader = _read_protected_parquet_tables
        self._dataset_slot = None
        self._pipeline_driver, self._pipeline_helpers = _run_protected_training_pipeline, _PROTECTED_PIPELINE_HELPERS
        self._pipeline_slot = None
        self._result_validation_driver = _validate_protected_training_results
        self._result_validation_helpers = _PROTECTED_RESULT_VALIDATION_HELPERS
        self._result_validation_slot = None
        self._workflow_driver,self._workflow_helpers,self._workflow_slot = _run_protected_training_workflow,_PROTECTED_WORKFLOW_HELPERS,None
        self._tensor_stream_type = _NATIVE_TENSOR_STREAM
        self._embedding_status, self._tensor_selection_slot = "unknown", None
        self._embedding_model = None
        self._embedding_tokenizer, self._metadata_slot = None, None
        self._output_graph_type, self._output_slot = _ProtectedTrainingOutputGraph, None
        self._completion_helpers = _PROTECTED_COMPLETION_HELPERS
        self._output_family_type = _NATIVE_OUTPUT_FAMILY_TYPE
        self._output_family_snapshot, self._output_family_fail = _NATIVE_OUTPUT_FAMILY_SNAPSHOT, _NATIVE_OUTPUT_FAMILY_FAIL
        self._checkpoint_slot = None
        self._checkpoint_export_guard = None
        self._checkpoint_export_binding = None
        self._final_result_slot = None
        self._checkpoint_family_resolve, self._checkpoint_family_claim = _NATIVE_CHECKPOINT_FAMILY_RESOLVE, _NATIVE_CHECKPOINT_FAMILY_CLAIM
        self._checkpoint_family_guard = _NATIVE_CHECKPOINT_FAMILY_GUARD
        self._checkpoint_family_owner = _NATIVE_CHECKPOINT_FAMILY_OWNER
        self._training_driver, self._training_slot = _run_trainer_impl, None
        self._thread = get_ident()
        self._embedding_observation_lost = False
        try:
            request = self._serialize(payload,mode="json")
            self._request_stamp = json.dumps(request,sort_keys=True,allow_nan=False,separators=(",",":"))
        except Exception: raise ValueError("The private protected training request is unavailable.") from None
        task_resolver, reference_resolver = self._resolve_task_id, self._resolve
        task_id = task_resolver(view,request)
        self._run_identity = (task_id,datetime.now(timezone.utc).isoformat())
        _ORIGINAL_OUTPUT_DELIVERIES[self] = capture_original_output_delivery(view,request)
        model,inputs = reference_resolver(view,request)
        if (self._resolve_task_id is not task_resolver or self._resolve is not reference_resolver
                or self._serialize is not _NATIVE_REQUEST_SERIALIZER or self.view is not view
                or task_resolver(view,request) != task_id):
            raise ValueError("The private original training task changed.")
        self.model_reference, self.dataset_references = model, inputs

    def assert_snapshot(self):
        """Fixed typed request comparison; no Native or business observer call."""
        if type(self) is not _ProtectedTrainingUse or type(self.payload) is not TrainModelTaskRequest:
            raise ValueError("The private protected training request is unavailable.")
        if (getattr(self,"_completion_helpers",None) is not _PROTECTED_COMPLETION_HELPERS
                or any(original is not current for original,current in zip(self._completion_helpers,
                    (_protected_output_seal_facts,_sealed_training_checkpoint_facts,_finalize_protected_training_result)))):
            raise ValueError("The private training completion helpers changed.")
        if (getattr(self,"_result_validation_driver",None) is not _validate_protected_training_results
                or getattr(self,"_result_validation_helpers",None) is not _PROTECTED_RESULT_VALIDATION_HELPERS
                or type(self._result_validation_helpers) is not tuple or len(self._result_validation_helpers) != 11
                or any(original is not current for original,current in zip(self._result_validation_helpers,
                    (_NATIVE_TRAINING_OUTPUT_READER,validate_protected_training_output_chunks,_protected_output_seal_facts,
                     _resolve_training_task,_training_result_summary,capture_original_output_delivery,original_output_delivery_matches,
                     begin_original_output_delivery,tee_original_output_delivery,finish_original_output_delivery,
                     abort_original_output_delivery)))):
            raise ValueError("The private result validation helpers changed.")
        if getattr(self,"_workflow_slot",None) is not None or _TRAINING_WORKFLOWS.get(self) is not None:
            _ProtectedTrainingUse.assert_workflow_helpers(self)
        if (self._pipeline_driver is not _run_protected_training_pipeline
                or self._pipeline_helpers is not _PROTECTED_PIPELINE_HELPERS
                or self._pipeline_slot is not None and any(original is not current for original,current in zip(self._pipeline_helpers,
                    (_bind_protected_checkpoint_schedule,_load_dataset,_load_transformers_objects,
                     _resolve_training_purpose_paths,_resolve_effective_sequence_length,_tokenize_dataset,
                     _apply_lora,_build_training_args,_run_trainer,_capture_pipeline_dataset_binding)))):
            raise ValueError("The private training pipeline helpers changed.")
        if (self._resolve_task_id is not _NATIVE_TASK_ID_RESOLVER or self._resolve is not _NATIVE_REFERENCE_RESOLVER
                or self._dataset_reader is not _NATIVE_TRAINING_INPUT_READER or self._dataset_loader is not _load_protected_dataset
                or self._dataset_parquet_reader is not _read_protected_parquet_tables
                or self._serialize is not _NATIVE_REQUEST_SERIALIZER or type(self._run_identity) is not tuple
                or len(self._run_identity) != 2 or any(type(value) is not str for value in self._run_identity)):
            raise ValueError("The private original training identity changed.")
        try:
            request = self._serialize(self.payload,mode="json")
            stamp = json.dumps(request,sort_keys=True,allow_nan=False,separators=(",",":"))
        except Exception: raise ValueError("The private protected training request is unavailable.") from None
        if stamp != self._request_stamp:
            # Keep the established original-view refusal type without invoking
            # a Native observer in the passive post-resource comparison.
            raise LaunchUnavailable()
        if (self not in _ORIGINAL_OUTPUT_DELIVERIES or
                self._result_validation_helpers[6](_ORIGINAL_OUTPUT_DELIVERIES[self],self.view) is not True):
            raise ValueError("The private output delivery owner changed.")
        return request

    def assert_workflow_helpers(self):
        if (getattr(self,"_workflow_driver",None) is not _run_protected_training_workflow
                or getattr(self,"_workflow_helpers",None) is not _PROTECTED_WORKFLOW_HELPERS
                or type(self._workflow_helpers) is not tuple or len(self._workflow_helpers) != 12
                or any(original is not current for original,current in zip(self._workflow_helpers,
                    (_run_protected_training_pipeline,_validate_protected_training_results,_NATIVE_OUTPUT_FAMILY_RETIRE,
                     _NATIVE_RETIRED_FAMILY_ADMIT,_prepare_protected_workflow_result,_passive_workflow_result,
                     _record_workflow_training_claim,_RESULT_FACTORY,_NATIVE_RESULT_COPY,
                     _NATIVE_CHECKPOINT_FAMILY_OWNER,_training_task_tags,_RESULT_API)))):
            raise ValueError("The private workflow helpers changed.")

    def assert_current(self):
        request = _ProtectedTrainingUse.assert_snapshot(self)
        task_resolver, reference_resolver = self._resolve_task_id,self._resolve
        view,identity = self.view,self._run_identity
        references = (self.model_reference,self.dataset_references)
        if task_resolver(view,request) != identity[0]:
            raise ValueError("The private original training task changed.")
        resolved = reference_resolver(view,request)
        _ProtectedTrainingUse.assert_snapshot(self)
        if (self.view is not view or self._run_identity is not identity or self._resolve_task_id is not task_resolver
                or self._resolve is not reference_resolver or self.model_reference is not references[0]
                or self.dataset_references is not references[1] or resolved != references):
            raise ValueError("The private protected training references are unavailable.")
        if task_resolver(view,request) != identity[0]:
            raise ValueError("The private original training task changed.")


def _check_protected_use(use, payload=None):
    if use is None: return
    if type(use) is not _ProtectedTrainingUse or payload is not None and use.payload is not payload:
        raise ValueError("The private protected training inputs are unavailable.")
    export_proof = _checkpoint_export_proof(use)
    pipeline = _training_pipeline_proof(use)
    if export_proof is not None:
        # Only a registered same-view export can borrow the parent's live proof.
        # Its fixed current operation includes the original Native permission/
        # resource checks. Repeat only passive local proof after those callbacks.
        export_proof.current()
        if _checkpoint_export_proof(use) is not export_proof:
            raise ValueError("The private checkpoint export changed.")
        export_proof.snapshot()
        if pipeline is not None: pipeline.snapshot()
        return
    # Call the fixed class operation; an instance cannot select another guard.
    _ProtectedTrainingUse.assert_current(use)
    training = use._training_slot
    if training is not None:
        if type(training) is not dict or type(training.get("snapshot")) is not FunctionType:
            raise ValueError("The private training binding is unavailable.")
        training["snapshot"]()
    checkpoint = use._checkpoint_slot
    if type(checkpoint) is dict and checkpoint.get("family") is not None:
        _NATIVE_CHECKPOINT_FAMILY_GUARD(checkpoint["family"],use,checkpoint)
    _checkpoint_snapshot(use)
    if _training_pipeline_proof(use) is not pipeline:
        raise ValueError("The private training pipeline proof changed.")
    if pipeline is not None: pipeline.snapshot()


def _checkpoint_snapshot(use):
    slot = use._checkpoint_slot
    if slot is None: return
    if type(slot) is not dict or type(slot.get("snapshot")) is not FunctionType:
        raise ValueError("The private checkpoint binding is unavailable.")
    family = slot.get("family")
    if family is None and slot.get("stage") != "binding":
        raise ValueError("The private checkpoint family is unavailable.")
    if family is not None:
        record = _NATIVE_OUTPUT_FAMILY_SNAPSHOT(family)
        proof = record.get("training_owner")
        if (type(proof) is not tuple or len(proof) != 3 or proof[0] is not use
                or proof[1] is not slot or proof[2] is not slot["snapshot"]):
            raise ValueError("The private checkpoint owner changed.")
    slot["snapshot"]()


def _bind_protected_checkpoint_schedule(use):
    """Bind finite snapshot-only policy; no SDK/controller/Root activation."""
    if type(use) is not _ProtectedTrainingUse or get_ident() != use._thread:
        raise ValueError("The private checkpoint binding is unavailable.")
    if use._checkpoint_slot is not None:
        previous = use._checkpoint_slot
        if type(previous) is dict and previous.get("stage") in ("binding","arguments-constructing"):
            if previous.get("family") is not None: _fail_checkpoint_arguments(use,previous)
            elif previous.get("owner") is use: previous["stage"] = "failed"
        raise ValueError("The private checkpoint attempt is unavailable.")
    if use._training_slot is not None or use._tensor_selection_slot is not None or use._metadata_slot is not None:
        raise ValueError("The private checkpoint binding is unavailable.")
    slot = {"owner":use,"stage":"binding","family":None,"steps":None,"arguments":None,"arguments_type":None}
    family = stamp = schedule = admission = business = reservation = resource = None
    resolve, claim = _NATIVE_CHECKPOINT_FAMILY_RESOLVE, _NATIVE_CHECKPOINT_FAMILY_CLAIM
    def snapshot():
        _ProtectedTrainingUse.assert_snapshot(use)
        if (use._checkpoint_slot is not slot or slot["owner"] is not use or slot["snapshot"] is not snapshot
                or type(slot.get("stage")) is not str or slot["stage"] not in ("binding","ready","arguments-constructing","arguments-ready")
                or use._checkpoint_family_resolve is not resolve or use._checkpoint_family_claim is not claim
                or use._checkpoint_family_guard is not _NATIVE_CHECKPOINT_FAMILY_GUARD
                or use._checkpoint_family_owner is not _NATIVE_CHECKPOINT_FAMILY_OWNER
                or use._output_family_snapshot is not _NATIVE_OUTPUT_FAMILY_SNAPSHOT
                or use._output_family_fail is not _NATIVE_OUTPUT_FAMILY_FAIL):
            raise ValueError("The private checkpoint binding changed.")
        if family is not None:
            record = _NATIVE_OUTPUT_FAMILY_SNAPSHOT(family)
            proof = record.get("training_owner")
            if (slot["family"] is not family or record["view"] is not use.view
                    or type(proof) is not tuple or len(proof) != 3
                    or proof[0] is not use or proof[1] is not slot or proof[2] is not snapshot
                    or record["admission"] is not admission or record["methods"]["business"] is not business
                    or record["reservation"] is not reservation or record["methods"]["resource"] is not resource
                    or slot.get("result_business") is not business or slot.get("result_resource") is not resource
                    or json.dumps(record["outputs"],sort_keys=True,allow_nan=False,separators=(",",":")) != stamp):
                raise ValueError("The private checkpoint family changed.")
        if schedule is not None and slot["steps"] is not schedule:
            raise ValueError("The private checkpoint schedule changed.")
        if schedule is not None and any(type(slot.get(key)) is not int or slot.get(key) != value
                for key,value in (("maximum_steps",maximum),("interval",interval),("retention",retention))):
            raise ValueError("The private checkpoint settings changed.")
        arguments = slot["arguments"]
        if arguments is not None:
            cls = slot["arguments_type"]
            fields = _sdk_passive_fields(arguments)
            if (type(arguments) is not cls or _sdk_static_attribute(cls,"should_save") is not slot["save_property"]
                    or any(type(fields.get(key)) is not type(value) or fields.get(key) != value
                        for key,value in slot["argument_fields"])):
                raise ValueError("The private checkpoint arguments changed.")
    slot["snapshot"] = snapshot; use._checkpoint_slot = slot
    try:
        _check_protected_use(use)
        request = _ProtectedTrainingUse.assert_snapshot(use)
        selected = resolve(use.view,request)
        snapshot()
        if selected is None: raise ValueError("The private checkpoint family is unavailable.")
        claim(selected,use,slot,snapshot)
        # Failure authority starts only after the original one-use claim succeeds.
        family = selected; slot["family"] = family
        if _TRAINING_WORKFLOWS.get(use) is not None:
            _record_workflow_training_claim(use,family,slot,snapshot)
        record = _NATIVE_OUTPUT_FAMILY_SNAPSHOT(family)
        # Freeze the method already held by the genuine Native family before
        # SDK/model callbacks. Never reacquire an observer with getattr later.
        admission,business = record["admission"],record["methods"]["business"]
        reservation,resource = record["reservation"],record["methods"]["resource"]
        if (type(business) not in (MethodType,BuiltinMethodType) or business.__self__ is not admission
                or type(resource) not in (MethodType,BuiltinMethodType) or resource.__self__ is not reservation):
            raise ValueError("The private checkpoint admission is unavailable.")
        slot.update(result_business=business,result_resource=resource)
        stamp = json.dumps(record["outputs"],sort_keys=True,allow_nan=False,separators=(",",":"))
        common, advanced = _to_dict(use.payload.commonParameters), _to_dict(use.payload.advancedParameters)
        maximum = common.get("maxSteps")
        interval, retention = advanced.get("checkpointIntervalSteps",50), advanced.get("saveTotalLimit",2)
        if any(type(value) is not int or not 1 <= value <= 2**31-1 for value in (maximum,interval,retention)):
            raise ValueError("The private checkpoint settings are unavailable.")
        count = (maximum+interval-1)//interval
        if count > 15 or count > retention or len(record["outputs"]) != count+1:
            raise ValueError("The private checkpoint capacity is unavailable.")
        schedule = tuple(range(interval,maximum+1,interval))
        if not schedule or schedule[-1] != maximum: schedule += (maximum,)
        slot.update(steps=schedule,maximum_steps=maximum,interval=interval,retention=retention,stage="ready")
        _check_protected_use(use); snapshot()
        return schedule
    except BaseException:
        slot["stage"] = "failed"
        if family is not None:
            try: _NATIVE_OUTPUT_FAMILY_FAIL(family)
            except BaseException: pass
        raise ValueError("The private checkpoint schedule is unavailable.") from None


def _record_protected_embedding_status(use, status):
    if use is None: return
    _check_protected_use(use)
    if status not in ("unchanged","resized"):
        raise ValueError("The private embedding observation is unavailable.")
    if use._embedding_status != "resized": use._embedding_status = status
    use._embedding_observation_lost = False


def _capture_protected_training_tensor_stream(model, use, *, maximum_bytes, chunk_bytes):
    """Select the fixed model/PEFT state; never infer a provider or Save grant."""
    _check_protected_use(use)
    if (type(use) is not _ProtectedTrainingUse or use.dataset_references is None
            or use._tensor_selection_slot is not None):
        raise ValueError("The private trained tensor export is unavailable.")
    slot = {"model":model,"state_method":None,"adapter_method":None,"state":None,"selected":None,
        "stage":"capturing","entered":False,"returned":False,"stream":None}
    use._tensor_selection_slot = slot  # One attempt, retained BEFORE suppliers.
    try:
        if (type(maximum_bytes) is not int or not 1 <= maximum_bytes <= 2**53-1
                or type(chunk_bytes) is not int or not 4096 <= chunk_bytes <= 1024**2):
            raise ValueError("The private tensor limits are unavailable.")
        embedding_status = use._embedding_status
        export_proof = _checkpoint_export_proof(use)
        stream = None
        def binding():
            if _checkpoint_export_proof(use) is not export_proof:
                raise ValueError("The private checkpoint export changed.")
            if export_proof is not None: export_proof.snapshot()
            _ProtectedTrainingUse.assert_snapshot(use)
            if (use._embedding_model is not model or use._embedding_status != embedding_status
                    or use._embedding_observation_lost):
                raise ValueError("The private trained model binding changed.")
            if stream is not None and slot["stream"] is not stream:
                raise ValueError("The private selected stream changed.")
        def current():
            _check_protected_use(use)
            binding()
        if use._embedding_model is not model or use._embedding_observation_lost:
            raise ValueError("The private trained model binding is unavailable.")
        method = use.payload.method
        adapter = method in ("lora","qlora")
        save_embeddings, getter = False, None
        if adapter:
            if use._embedding_status not in ("unchanged","resized"):
                raise ValueError("The private embedding observation is unavailable.")
            # _apply_lora already loads this pinned SDK. Never import/install or
            # choose its auto embedding/provider discovery during serialization.
            module = sys.modules.get("peft")
            if type(module) is not ModuleType: raise ValueError("The private adapter exporter is unavailable.")
            namespace = vars(module); getter = namespace.get("get_peft_model_state_dict")
            config_type = namespace.get("LoraConfig")
            peft_type = namespace.get("PeftType")
            if (type(getter) is not FunctionType or getter.__module__ != "peft.utils.save_and_load"
                    or not isinstance(config_type,type) or not isinstance(peft_type,type)):
                raise ValueError("The private adapter exporter is unavailable.")
            lora_type = peft_type.LORA
            slot["adapter_method"] = getter
            current()
            configurations = model.peft_config
            current()
            if type(configurations) is not dict or set(configurations) != {"default"}:
                raise ValueError("The private adapter configuration is unavailable.")
            configuration = configurations["default"]
            if type(configuration) is not config_type: raise ValueError("The private adapter configuration is unavailable.")
            current()
            configuration_fields = _sdk_passive_fields(configuration)
            if type(configuration_fields) is not dict:
                raise ValueError("The private adapter configuration is unavailable.")
            targets = configuration_fields.get("target_modules")
            if (type(targets) not in (set,frozenset,list,tuple) or not 1 <= len(targets) <= 4096
                    or any(type(name) is not str or not 1 <= len(name) <= 512 for name in targets)):
                raise ValueError("The private adapter targets are unavailable.")
            targets = frozenset(targets)
            configuration_reader = _capture_passive_sdk_attribute(model,"peft_config",configurations)
            def fixed_policy(fields):
                # These selector branches are fixed by _apply_lora. In particular,
                # another bias/PEFT/DoRA policy can silently change saved tensors.
                if (fields.get("peft_type") is not lora_type or type(fields.get("bias")) is not str
                        or fields["bias"] != "none" or fields.get("use_dora") is not False
                        or fields.get("modules_to_save") is not None
                        or fields.get("trainable_token_indices") is not None):
                    raise ValueError("The private adapter selection policy changed.")
            fixed_policy(configuration_fields)
            # Names from pinned PEFT0.15.2's embedding profile; include qualified
            # targets too. True preserves embeddings without provider discovery.
            save_embeddings = use._embedding_status == "resized" or any(
                name.rsplit(".",1)[-1] in ("embed_tokens","lm_head") for name in targets)
            def adapter_snapshot():
                binding()
                observed_configurations = configuration_reader()
                # Read fixed dataclass fields after the final live-view callback;
                # no SDK/property callback may change them between proof and use.
                fields = _sdk_passive_fields(configuration)
                if fields is not configuration_fields: raise ValueError("The private adapter configuration changed.")
                observed_targets = fields.get("target_modules")
                if (observed_configurations is not configurations or set(configurations) != {"default"}
                        or configurations.get("default") is not configuration
                        or type(observed_targets) not in (set,frozenset,list,tuple) or len(observed_targets) > 4096
                        or any(type(name) is not str for name in observed_targets) or frozenset(observed_targets) != targets):
                    raise ValueError("The private adapter configuration changed.")
                fixed_policy(fields)
            def adapter_current():
                observed_configurations = model.peft_config
                current()
                adapter_snapshot()
        elif method != "full-finetune":
            raise ValueError("The private training method is unavailable.")
        slot["selection_current"] = adapter_current if adapter else current
        slot["selection_snapshot"] = adapter_snapshot if adapter else binding
        slot["configuration"] = configuration if adapter else None
        state_method = model.state_dict
        slot["state_method"] = state_method
        current()
        if type(state_method) not in (MethodType,BuiltinMethodType) or state_method.__self__ is not model:
            raise ValueError("The private model state is unavailable.")
        slot.update(stage="model-state",entered=True,returned=False)
        state = state_method(); slot.update(state=state,returned=True)
        current()
        if type(state) not in (dict,OrderedDict) or not 1 <= len(state) <= 4096:
            raise ValueError("The private model state is unavailable.")
        state = dict(state); slot["state"] = state
        selected = state
        if adapter:
            adapter_current()
            slot.update(stage="adapter-state",entered=True,returned=False)
            selected = getter(model,state_dict=state,adapter_name="default",unwrap_compiled=False,
                save_embedding_layers=save_embeddings)
            slot.update(selected=selected,returned=True)
            current()
            adapter_current()
        if type(selected) not in (dict,OrderedDict) or not 1 <= len(selected) <= 4096:
            raise ValueError("The private selected model state is unavailable.")
        selected = dict(selected); slot["selected"] = selected
        request = use._serialize(use.payload,mode="json")
        current()
        slot["stage"] = "tensor-stream"
        stream = use._tensor_stream_type(use.view,request,selected,maximum_bytes=maximum_bytes,chunk_bytes=chunk_bytes)
        slot["stream"] = stream
        current()
        if adapter: adapter_current()
        slot["stage"] = "captured"
        return stream
    except BaseException:
        slot["failed_stage"] = slot["stage"]
        slot["stage"] = "failed"
        raise ValueError("The private trained tensor export is unavailable.") from None


def _capture_protected_training_metadata(model, tokenizer, use, *, maximum_bytes):
    """Capture local metadata bytes, never call an SDK path writer or provider.

    The finite fast-tokenizer profile is intentionally separate from physical
    output creation. Its immutable bytes still require the original output
    owner's live guards and real reader/host qualification before product use.
    """
    if type(use) is not _ProtectedTrainingUse or use._metadata_slot is not None:
        raise ValueError("The private trained metadata export is unavailable.")
    slot = {"model":model,"tokenizer":tokenizer,"stage":"capturing","operations":[],"files":None}
    use._metadata_slot = slot  # Retain the attempt before any SDK access.
    try:
        _check_protected_use(use)
        if type(maximum_bytes) is not int or not 1 <= maximum_bytes <= 64*1024**2:
            raise ValueError("The private metadata limit is unavailable.")
        selection = use._tensor_selection_slot
        if (type(selection) is not dict or selection.get("stage") != "captured"
                or selection.get("model") is not model
                or type(selection.get("selection_current")) is not FunctionType):
            raise ValueError("The private selected model is unavailable.")
        selection_current = selection["selection_current"]
        selection_snapshot = selection.get("selection_snapshot")
        if type(selection_snapshot) is not FunctionType:
            raise ValueError("The private selected model snapshot is unavailable.")
        bindings = slot["bindings"] = []
        package = None
        history = use._training_slot
        checkpoint_guard = use._checkpoint_export_guard
        checkpoint_record = checkpoint_guard() if checkpoint_guard is not None else None
        if history is not None:
            if type(history) is not dict or history.get("stage") != "complete" or type(history.get("snapshot")) is not FunctionType:
                raise ValueError("The private completed training history is unavailable.")
            history_snapshot, history_files = history["snapshot"], history["files"]
        else:
            history_snapshot, history_files = None, ()
        def snapshot():
            _ProtectedTrainingUse.assert_snapshot(use)
            selection_snapshot()
            if (use._metadata_slot is not slot or use._tensor_selection_slot is not selection or selection.get("stage") != "captured"
                    or use._embedding_model is not model or use._embedding_tokenizer is not tokenizer
                    or use._embedding_observation_lost or use._checkpoint_export_guard is not checkpoint_guard):
                raise ValueError("The private metadata binding changed.")
            # Read actual SDK references AFTER all original-view callbacks. A
            # matching earlier snapshot is not proof of the current receiver.
            for reader in bindings: reader()
            if (use._metadata_slot is not slot or use._embedding_model is not model
                    or use._embedding_tokenizer is not tokenizer or use._embedding_observation_lost):
                raise ValueError("The private metadata binding changed.")
            if package is not None and slot["files"] is not package:
                raise ValueError("The private metadata package changed.")
            if use._training_slot is not history:
                raise ValueError("The private completed training history changed.")
            if history_snapshot is not None:
                history_snapshot()
                if history.get("files") is not history_files:
                    raise ValueError("The private completed training history changed.")
        def current():
            _check_protected_use(use)
            selection_current()
            snapshot()
        slot["metadata_current"] = current
        slot["metadata_snapshot"] = snapshot
        current()
        def operation(label, supplier, *args, **kwargs):
            current()
            flight = {"label":label,"supplier":supplier,"args":args,"kwargs":kwargs,"returned":False,"result":None}
            slot["operations"].append(flight); slot["stage"] = label
            result = supplier(*args,**kwargs)
            flight.update(result=result,returned=True)
            current()
            return result
        missing = object()
        def read(obj, name, default=missing):
            return operation("metadata-read",getattr,obj,name,default)
        def bound(obj, name):
            method = read(obj,name)
            if type(method) not in (MethodType,BuiltinMethodType) or method.__self__ is not obj:
                raise ValueError("The private metadata method is unavailable.")
            return method
        tokenizers = sys.modules.get("tokenizers")
        if type(tokenizers) is not ModuleType:
            raise ValueError("The private fast tokenizer is unavailable.")
        namespace = vars(tokenizers)
        backend_type, token_type = namespace.get("Tokenizer"), namespace.get("AddedToken")
        if not isinstance(backend_type,type) or not isinstance(token_type,type):
            raise ValueError("The private fast tokenizer is unavailable.")
        token_state = token_type.__getstate__
        backend = read(tokenizer,"backend_tokenizer")
        if type(backend) is not backend_type:
            raise ValueError("The private fast tokenizer is unavailable.")
        bindings.append(_capture_passive_sdk_attribute(tokenizer,"backend_tokenizer",backend))
        backend_export = bound(backend,"to_str")
        configuration = selection["configuration"] if use.payload.method in ("lora","qlora") else read(model,"config")
        if use.payload.method == "full-finetune": bindings.append(_capture_passive_sdk_attribute(model,"config",configuration))
        config_export = bound(configuration,"to_dict")
        generation = read(model,"generation_config",None) if use.payload.method == "full-finetune" else None
        if use.payload.method == "full-finetune": bindings.append(_capture_passive_sdk_attribute(model,"generation_config",generation))
        generation_export = bound(generation,"to_dict") if generation is not None else None
        peft = sys.modules.get("peft")
        enums = tuple(value for name in ("PeftType","TaskType")
            if isinstance(peft,ModuleType) and isinstance(value:=vars(peft).get(name),type))
        path_keys = frozenset(("_name_or_path","name_or_path","tokenizer_file","special_tokens_map_file",
            "vocab_file","merges_file","cache_dir","device_map"))
        def token_record(value, typed=True, legacy=False):
            if type(value) is not token_type:
                raise ValueError("The private added token is unavailable.")
            record = operation("added-token-state",token_state,value)
            if (type(record) is not dict or set(record) != {"content","single_word","lstrip","rstrip","normalized","special"}
                    or type(record["content"]) is not str
                    or any(type(record[k]) is not bool for k in record if k != "content")):
                raise ValueError("The private added token is unavailable.")
            record = dict(record)
            if legacy: record.pop("special")
            if typed: record["__type"] = "AddedToken"
            return record
        def plain(value, *, strip_paths=False, typed_tokens=True, legacy_tokens=False, model_config=False):
            nodes, characters, active = 0, 0, set()
            def visit(item,depth=0,*,index_map=False):
                nonlocal nodes,characters
                nodes += 1
                if nodes > min(maximum_bytes,1_000_000) or depth > 32:
                    raise ValueError("The private metadata structure is too large.")
                if item is None or type(item) is bool: return item
                if type(item) is str:
                    characters += len(item)
                    if characters > maximum_bytes: raise ValueError("The private metadata is too large.")
                    return item
                if type(item) is int and item.bit_length() <= 256: return item
                if type(item) is float and isfinite(item): return item
                if type(item) in enums: return visit(item.value,depth+1)
                if type(item) is token_type:
                    return visit(token_record(item,typed_tokens,legacy_tokens),depth+1)
                identity = id(item)
                if identity in active: raise ValueError("The private metadata is cyclic.")
                active.add(identity)
                try:
                    if type(item) in (list,tuple):
                        if len(item) > maximum_bytes: raise ValueError("The private metadata is too large.")
                        return [visit(v,depth+1) for v in item]
                    if type(item) in (set,frozenset):
                        if len(item) > 4096 or any(type(v) is not str for v in item):
                            raise ValueError("The private metadata set is unavailable.")
                        return [visit(v,depth+1) for v in sorted(item)]
                    if type(item) is not dict or len(item) > maximum_bytes:
                        raise ValueError("The private metadata value is unavailable.")
                    result = {}
                    for key,value in item.items():
                        # These two standard model-config maps use integer IDs
                        # in the pinned SDK. Convert only exact bounded ints at
                        # that fixed location; arbitrary keys stay unsupported.
                        if index_map and type(key) is int and 0 <= key <= 2**53-1:
                            key = str(key)
                        if type(key) is not str or key in result:
                            raise ValueError("The private metadata key is unavailable.")
                        if strip_paths and key in path_keys: continue
                        if (strip_paths and key in ("auto_map","auto_mapping","_auto_class") and value is not None
                                and not (type(value) is dict and not value)):
                            raise ValueError("Custom metadata code export is unavailable.")
                        result[visit(key,depth+1)] = visit(value,depth+1,
                            index_map=model_config and depth == 0 and key in ("id2label","pruned_heads"))
                    return result
                finally: active.remove(identity)
            return visit(value)
        def encode(value):
            data = bytearray()
            for part in json.JSONEncoder(ensure_ascii=False,allow_nan=False,sort_keys=True,separators=(",",":")).iterencode(value):
                encoded = part.encode("utf8")
                if len(data)+len(encoded) > maximum_bytes: raise ValueError("The private metadata is too large.")
                data.extend(encoded)
            return bytes(data)
        def no_duplicates(pairs):
            result = {}
            for key,value in pairs:
                if key in result: raise ValueError("The private tokenizer JSON is unavailable.")
                result[key] = value
            return result
        def capture():
            current()
            if read(tokenizer,"backend_tokenizer") is not backend:
                raise ValueError("The private tokenizer binding changed.")
            if use.payload.method == "full-finetune":
                if read(model,"config") is not configuration or read(model,"generation_config",None) is not generation:
                    raise ValueError("The private model configuration changed.")
            raw = operation("model-configuration",config_export)
            if type(raw) is not dict: raise ValueError("The private model configuration is unavailable.")
            config = plain(raw,strip_paths=True,model_config=use.payload.method == "full-finetune")
            files = list(history_files)
            if checkpoint_record is not None:
                identity,step = checkpoint_record
                files.append(("training-run.json",encode({"runId":identity[0],"startedAt":identity[1],
                    "method":use.payload.method,"status":"checkpoint-snapshot","trainingStatus":"running",
                    "checkpointStep":step,"candidateValidation":"pending"})))
            if use.payload.method in ("lora","qlora"):
                config["base_model_name_or_path"] = use.payload.baseModel.modelId
                config["inference_mode"] = True
                files.append(("adapter_config.json",encode(config)))
            else:
                files.append(("config.json",encode(config)))
                if generation_export is not None:
                    generated = operation("generation-configuration",generation_export)
                    if type(generated) is not dict: raise ValueError("The private generation configuration is unavailable.")
                    files.append(("generation_config.json",encode(plain(generated,strip_paths=True))))
            initial = read(tokenizer,"init_kwargs")
            vocabulary = read(tokenizer,"vocab_files_names")
            if (type(initial) is not dict or len(initial) > 4096 or any(type(k) is not str for k in initial)
                    or type(vocabulary) is not dict or len(vocabulary) > 64 or any(type(k) is not str for k in vocabulary)):
                raise ValueError("The private tokenizer configuration is unavailable.")
            token_config = {}
            for key in initial:
                if key not in path_keys and key not in vocabulary:
                    token_config[key] = read(tokenizer,key,initial[key])
            token_config["model_max_length"] = read(tokenizer,"model_max_length")
            token_config["clean_up_tokenization_spaces"] = read(tokenizer,"clean_up_tokenization_spaces")
            special = read(tokenizer,"special_tokens_map")
            extra = read(tokenizer,"extra_special_tokens")
            if type(special) is not dict or type(extra) is not dict:
                raise ValueError("The private special tokens are unavailable.")
            token_config.update(special)
            if "extra_special_tokens" not in token_config:
                token_config["extra_special_tokens"] = extra; token_config.update(extra)
            template = read(tokenizer,"chat_template",None)
            if template is not None:
                token_config["chat_template"] = ([{"name":k,"template":v} for k,v in template.items()]
                    if type(template) is dict else template)
            inputs = read(tokenizer,"init_inputs")
            if type(inputs) not in (tuple,list): raise ValueError("The private tokenizer inputs are unavailable.")
            if inputs: token_config["init_inputs"] = inputs
            token_config = plain(token_config,strip_paths=True)
            decoder = read(tokenizer,"added_tokens_decoder")
            if (type(decoder) is not dict or len(decoder) > 4096
                    or any(type(k) is not int or not 0 <= k < 2**32 for k in decoder)):
                raise ValueError("The private added-token decoder is unavailable.")
            token_config["added_tokens_decoder"] = {str(k):token_record(v,typed=False) for k,v in decoder.items()}
            token_config["tokenizer_class"] = type(tokenizer).__name__
            if read(tokenizer,"_auto_class",None) is not None or read(tokenizer,"_auto_map",None) is not None:
                raise ValueError("Custom tokenizer code export is unavailable.")
            processor = read(tokenizer,"_processor_class",None)
            if processor is not None: token_config["processor_class"] = plain(processor)
            files.append(("tokenizer_config.json",encode(token_config)))
            extended = read(tokenizer,"special_tokens_map_extended")
            if type(extended) is not dict: raise ValueError("The private special tokens are unavailable.")
            files.append(("special_tokens_map.json",encode(plain(extended,typed_tokens=False,legacy_tokens=True))))
            tokenizer_json = operation("fast-tokenizer-json",backend_export,pretty=False)
            if type(tokenizer_json) is not str or len(tokenizer_json) > maximum_bytes or len(tokenizer_json.encode("utf8")) > maximum_bytes:
                raise ValueError("The private fast tokenizer JSON is too large.")
            parsed = json.loads(tokenizer_json,object_pairs_hook=no_duplicates,
                parse_constant=lambda _: (_ for _ in ()).throw(ValueError("Invalid tokenizer JSON")))
            if type(parsed) is not dict: raise ValueError("The private fast tokenizer JSON is unavailable.")
            files.append(("tokenizer.json",encode(plain(parsed))))
            if sum(len(data) for _,data in files) > maximum_bytes:
                raise ValueError("The private metadata package is too large.")
            return tuple(files)
        first = capture(); slot["files"] = first
        second = capture()  # One bounded consistency comparison, never a retry.
        current()
        if first != second: raise ValueError("The private metadata changed during capture.")
        package = first
        current()
        slot["stage"] = "captured"
        return first
    except BaseException:
        slot["failed_stage"] = slot["stage"]; slot["stage"] = "failed"
        raise ValueError("The private trained metadata export is unavailable.") from None


class _ProtectedTrainingOutputGraph(OriginalTrainingOutputGraph):
    """The original Native graph with the fixed SDK binding check added last."""
    def __init__(self, use, request, configuration, files, reservation, admission, *, _family=None):
        if type(use) is not _ProtectedTrainingUse or type(self) is not use._output_graph_type:
            raise LaunchUnavailable()
        slot = use._output_slot
        if (type(slot) is not dict or type(slot.get("current")) is not FunctionType
                or type(slot.get("snapshot")) is not FunctionType):
            raise LaunchUnavailable()
        self._sdk_current, self._sdk_snapshot, self._sdk_guard_active = slot["current"], slot["snapshot"], False
        _NATIVE_OUTPUT_INIT(self,use.view,request,configuration,files,reservation,admission,
            **({"_family":_family} if _family is not None else {}))

    def guard(self):
        if self._sdk_guard_active:
            self.phase = "failed"
            raise LaunchUnavailable()
        self._sdk_guard_active = True
        try:
            self._sdk_current()
            _NATIVE_OUTPUT_GUARD(self)
            # No added Native/business callback may follow the original final
            # resource proof. Only fixed local identity/settings reads remain.
            self._sdk_snapshot()
            if self.phase in ("failed","retired") or self.owner.unknown or self.owner.pending:
                raise LaunchUnavailable()
        except BaseException:
            self.phase = "failed"
            raise LaunchUnavailable() from None
        finally: self._sdk_guard_active = False


def _protected_output_seal_facts(graph):
    """Read bounded passive facts; callers must retain their original seal proof."""
    if type(graph) is not _ProtectedTrainingOutputGraph:
        raise ValueError("The private checkpoint graph is unavailable.")
    fields = _sdk_passive_fields(graph)
    files = fields.get("records")
    if type(fields.get("phase")) is not str or fields["phase"] != "sealed" or type(files) is not list or not 1 <= len(files) <= 32:
        raise ValueError("The private checkpoint files are unavailable.")
    captured = []
    for file in files:
        if (type(file) is not dict or type(file.get("name")) is not str
                or re.fullmatch(r"[A-Za-z0-9_.-]{1,128}",file["name"]) is None
                or type(file.get("sizeBytes")) is not int or file["sizeBytes"] <= 0
                or type(file.get("sha256")) is not str or re.fullmatch(r"[a-f0-9]{64}",file["sha256"]) is None):
            raise ValueError("The private checkpoint files are unavailable.")
        captured.append((file["name"],file["sizeBytes"],file["sha256"]))
    if len({file[0] for file in captured}) != len(captured):
        raise ValueError("The private checkpoint files are unavailable.")
    return tuple(captured)


def _write_protected_training_output(use, *, configuration, reservation, admission, _family=None):
    """Seal the captured single-file candidate; no training, Save or Root grant."""
    if type(use) is not _ProtectedTrainingUse or use._output_slot is not None:
        raise ValueError("The private trained output is unavailable.")
    slot = {"stage":"planning","selection":None,"metadata":None,"graph":None,
        "files":None,"entered":False,"returned":False,"current":None,"family":_family,"seal_facts":None}
    use._output_slot = slot
    family_type, family_snapshot, family_fail = _NATIVE_OUTPUT_FAMILY_TYPE, _NATIVE_OUTPUT_FAMILY_SNAPSHOT, _NATIVE_OUTPUT_FAMILY_FAIL
    owned_family = seal_facts = None
    read_seal_facts = use._completion_helpers[0]
    try:
        if _family is not None:
            if type(_family) is not family_type:
                raise ValueError("The private output family is unavailable.")
            original = family_snapshot(_family)
            if (original["view"] is not use.view or
                    json.dumps(original["request"],sort_keys=True,allow_nan=False,separators=(",",":")) != use._request_stamp):
                raise ValueError("The private output family binding is unavailable.")
            owned_family = _family  # Failure authority belongs only to this original view/request.
        if (use._output_family_type is not family_type or use._output_family_snapshot is not family_snapshot
                or use._output_family_fail is not family_fail):
            raise ValueError("The private output family helpers changed.")
        if _family is not None and (type(_family) is not family_type or type(family_snapshot) is not FunctionType
                or type(family_fail) is not FunctionType):
            raise ValueError("The private output family is unavailable.")
        _check_protected_use(use)
        selection, metadata = use._tensor_selection_slot, use._metadata_slot
        if (type(selection) is not dict or selection.get("stage") != "captured"
                or type(metadata) is not dict or metadata.get("stage") != "captured"
                or type(selection.get("selection_current")) is not FunctionType
                or type(selection.get("selection_snapshot")) is not FunctionType
                or type(metadata.get("metadata_current")) is not FunctionType
                or type(metadata.get("metadata_snapshot")) is not FunctionType):
            raise ValueError("The private output inputs are unavailable.")
        stream, captured_files = selection.get("stream"), metadata.get("files")
        if type(stream) is not use._tensor_stream_type or stream.phase != "bound" or type(captured_files) is not tuple:
            raise ValueError("The private output inputs are unavailable.")
        slot.update(selection=selection,metadata=metadata,stream=stream)
        selection_current, metadata_current = selection["selection_current"], metadata["metadata_current"]
        selection_snapshot, metadata_snapshot = selection["selection_snapshot"], metadata["metadata_snapshot"]
        def snapshot():
            _ProtectedTrainingUse.assert_snapshot(use)
            selection_snapshot(); metadata_snapshot()
            if (use._output_slot is not slot or use._tensor_selection_slot is not selection
                    or use._metadata_slot is not metadata or selection.get("stage") != "captured"
                    or metadata.get("stage") != "captured" or selection.get("stream") is not stream
                    or metadata.get("files") is not captured_files or slot["stage"] == "failed"):
                raise ValueError("The private output inputs changed.")
            if (slot["family"] is not _family or use._output_family_type is not family_type
                    or use._output_family_snapshot is not family_snapshot or use._output_family_fail is not family_fail
                    or _protected_output_seal_facts is not read_seal_facts or slot["seal_facts"] is not seal_facts):
                raise ValueError("The private output family binding changed.")
            if seal_facts is not None and read_seal_facts(slot["graph"]) != seal_facts:
                raise ValueError("The private output seal facts changed.")
            if _family is not None:
                record = family_snapshot(_family)  # Fixed passive Native-owned map checks only.
                if (record["view"] is not use.view or
                        json.dumps(record["request"],sort_keys=True,allow_nan=False,separators=(",",":")) != use._request_stamp):
                    raise ValueError("The private output family binding changed.")
        def current():
            if use._output_slot is not slot:
                raise ValueError("The private output attempt changed.")
            _check_protected_use(use)
            selection_current(); metadata_current()
            snapshot()
        slot["current"] = current
        slot["snapshot"] = snapshot
        current()
        if use.payload.method == "full-finetune":
            # The supported flat profile must not silently discard a requested
            # split. Match decimal SDK units and its single oversized-tensor rule;
            # safetensors header bytes do not count as tensor storage.
            size = _parse_max_shard_size(use.payload)
            match = re.fullmatch(r"(0|[1-9][0-9]{0,14})(\.[0-9]{1,9})?\s*(KB|MB|GB|TB)",size,re.IGNORECASE)
            if match is None: raise ValueError("The private shard profile is unavailable.")
            limit = int(Decimal(match[1]+(match[2] or ""))*{"KB":10**3,"MB":10**6,"GB":10**9,"TB":10**12}[match[3].upper()])
            if limit < 1 or stream.tensor_bytes > limit and len(stream.tensor_sizes) != 1:
                raise ValueError("The private single-file shard profile is unavailable.")
            weight_name = "model.safetensors"
        elif use.payload.method in ("lora","qlora"): weight_name = "adapter_model.safetensors"
        else: raise ValueError("The private output profile is unavailable.")
        rows, streams, names = [], {}, set()
        if type(configuration) is not dict or type(configuration.get("bufferBytes")) is not int:
            raise ValueError("The private output configuration is unavailable.")
        chunk_bytes = configuration["bufferBytes"]
        if not 4096 <= chunk_bytes <= 1024**2 or stream.chunk_bytes > chunk_bytes:
            raise ValueError("The private output chunks are unavailable.")
        def chunks(raw):
            for offset in range(0,len(raw),chunk_bytes):
                current()
                yield raw[offset:offset+chunk_bytes]
                current()
        for row in captured_files:
            if (type(row) is not tuple or len(row) != 2 or type(row[0]) is not str
                    or type(row[1]) is not bytes or not row[1] or row[0] in names):
                raise ValueError("The private metadata files are unavailable.")
            name,raw = row; names.add(name)
            rows.append({"name":name,"sizeBytes":len(raw)}); streams[name] = chunks(raw)
        if weight_name in names: raise ValueError("The private output files are unavailable.")
        rows.append({"name":weight_name,"sizeBytes":stream.size_bytes}); streams[weight_name] = stream
        slot["files"] = tuple((r["name"],r["sizeBytes"]) for r in rows)
        request = use._serialize(use.payload,mode="json"); current()
        slot.update(stage="constructing",entered=True,returned=False)
        graph = use._output_graph_type(use,request,configuration,rows,reservation,admission,
            **({"_family":_family} if _family is not None else {}))
        slot.update(graph=graph,returned=True)
        current()
        slot["stage"] = "writing"
        _NATIVE_OUTPUT_PREPARE(graph,streams)
        # Capture before another task/SDK observer. The original readback below
        # must verify this same state; passive checks also fence its last callback.
        seal_facts = read_seal_facts(graph)
        if tuple((name,size) for name,size,_ in seal_facts) != slot["files"]:
            raise ValueError("The private output seal inventory changed.")
        slot["seal_facts"] = seal_facts
        current()
        _NATIVE_OUTPUT_ASSERT_SEALED(graph)
        current()
        slot["stage"] = "sealed"
        return graph
    except BaseException:
        slot["failed_stage"] = slot["stage"]; slot["stage"] = "failed"
        if owned_family is not None:
            try: family_fail(owned_family)
            except BaseException: pass  # A forged/unregistered family supplies no effect or recovery authority.
        raise ValueError("The private trained output is unavailable.") from None


def _capture_local_dataset_references(payload, references):
    if references is None: return None
    if (type(references) is not tuple or len(references) != len(payload.datasets)
            or not 1 <= len(references) <= 16 or any(type(value) is not str or not 0 < len(value) <= 4096
                or not Path(value).is_absolute() or value.startswith(("\\\\","//"))
                or any(ord(c)<32 or ord(c)==127 for c in value) for value in references)):
        raise ValueError("The private protected training inputs are unavailable.")
    return references


def _read_protected_parquet_tables(raw, check):
    """Self-contained memory buffers only; inspect metadata before data/schema."""
    import pyarrow as pa
    check()
    import pyarrow.parquet as pq
    check()
    from base64 import b64decode
    check()
    from pyarrow._parquet import _reconstruct_filemetadata
    check()
    # The pinned public read_metadata opens an Arrow data reader and may run
    # registered extension decoders. This fixed metadata-only SDK function
    # consumes the bounded Compact-Thrift footer directly; never use pickle.
    if pa.__version__ != "25.0.0" or len(raw) < 12 or raw[:4] != b"PAR1" or raw[-4:] != b"PAR1":
        raise ValueError("The private Parquet metadata profile is unavailable.")
    footer_length = int.from_bytes(raw[-8:-4], "little")
    if not 0 < footer_length <= len(raw) - 12:
        raise ValueError("The private Parquet footer is unavailable.")
    footer = raw[-8-footer_length:-8]
    metadata = _reconstruct_filemetadata(pa.py_buffer(footer))
    check()
    encoded_schema = (metadata.metadata or {}).get(b"ARROW:schema")
    # Dictionary conversion collapses duplicate keys. Refuse ambiguous raw
    # occurrences too, including reserved text in unrelated footer metadata.
    if footer.count(b"ARROW:schema") != (0 if encoded_schema is None else 1):
        raise ValueError("The private Parquet schema metadata is ambiguous.")
    if encoded_schema is not None:
        schema_bytes = b64decode(encoded_schema, validate=True)
        if b"ARROW:extension:name" in schema_bytes:
            raise ValueError("The private Parquet extension profile is unavailable.")
        schema_stream = pa.BufferReader(schema_bytes)
        message = pa.ipc.read_message(schema_stream)  # Envelope only, never read_schema.
        if message.type != "schema" or schema_stream.tell() != len(schema_bytes):
            raise ValueError("The private Parquet schema envelope is unavailable.")
    for group_index in range(metadata.num_row_groups):
        check()
        group = metadata.row_group(group_index)
        for column_index in range(group.num_columns):
            if group.column(column_index).file_path:
                raise ValueError("The private Parquet file must be self-contained.")
    check()
    with pq.ParquetFile(pa.BufferReader(raw), metadata=metadata,
            memory_map=False, pre_buffer=False, arrow_extensions_enabled=False) as source:
        check()
        for batch in source.iter_batches(batch_size=10_000, use_threads=False):
            check()
            yield pa.Table.from_batches([batch]).replace_schema_metadata(None)
            check()


def _load_protected_dataset(payload, references, use):
    """One original-byte load; no path, Dataset builder, cache or partial split."""
    if (type(use) is not _ProtectedTrainingUse or get_ident() != use._thread
            or use.payload is not payload):
        raise ValueError("The private protected training inputs are unavailable.")
    request = _ProtectedTrainingUse.assert_snapshot(use)
    if references is not use.dataset_references:
        raise ValueError("The private protected training inputs are unavailable.")
    previous = use._dataset_slot
    if previous is not None:
        if type(previous) is dict and previous.get("stage") in ("loading", "parsing"):
            previous["stage"] = "failed"  # Caught owned reentry invalidates the first load.
        raise ValueError("The private dataset load is unavailable.")
    slot = {"stage": "loading"}
    use._dataset_slot = slot
    view, reader, parquet_reader = use.view, use._dataset_reader, use._dataset_parquet_reader
    identity, stamp = use._run_identity, use._request_stamp

    def snapshot():
        _ProtectedTrainingUse.assert_snapshot(use)
        if (use._dataset_slot is not slot or type(slot.get("stage")) is not str
                or slot["stage"] not in ("loading", "parsing") or use.view is not view
                or use._dataset_reader is not reader or use._run_identity is not identity
                or use._dataset_parquet_reader is not parquet_reader
                or use._request_stamp != stamp or use.dataset_references is not references):
            raise ValueError("The private dataset load changed.")

    def check():
        snapshot()
        _check_protected_use(use, payload)
        snapshot()

    try:
        check()
        selections = request["datasets"]
        formats = {row.get("format") for row in selections}
        if (not 1 <= len(selections) <= 16 or len(formats) != 1
                or next(iter(formats)) not in ("json", "jsonl", "csv", "parquet")
                or any(row.get("splitRole") not in ("train", "validation") for row in selections)
                or not any(row["splitRole"] == "train" for row in selections)):
            raise ValueError("The private training dataset selection is unavailable.")
        fmt = next(iter(formats))
        # Imports are observers too. Do not read bytes after an import withdraws
        # permission, and never fall back to the ordinary path-based builder.
        from datasets import Dataset, DatasetDict
        check()
        import pyarrow as pa
        check()
        from io import BytesIO, StringIO
        check()
        fixed_dataset, fixed_dict, fixed_concat = Dataset, DatasetDict, pa.concat_tables
        raw_files = reader(view, request)
        check()
        if (type(raw_files) is not tuple or len(raw_files) != len(selections)
                or any(type(raw) is not bytes or not raw for raw in raw_files)):
            raise ValueError("The private dataset bytes are unavailable.")
        slot["stage"] = "parsing"
        splits = {"train": [], "validation": []}
        for selected, raw in zip(selections, raw_files):
            check()
            tables = []
            if fmt == "csv":
                from datasets.packaged_modules.csv.csv import CsvConfig
                check()
                from pandas import read_csv
                check()
                # Configuration only, never DatasetBuilder (which creates a
                # cache directory). Preserve the installed reader's defaults.
                options = CsvConfig().pd_read_csv_kwargs
                check()
                with read_csv(BytesIO(raw), iterator=True, **options) as chunks:
                    check()
                    for frame in chunks:
                        check()
                        tables.append(pa.Table.from_pandas(frame, preserve_index=False))
                        check()
            elif fmt in ("json", "jsonl"):
                from pyarrow.json import read_json, ReadOptions
                check()
                try:
                    table = read_json(pa.BufferReader(raw), read_options=ReadOptions(use_threads=False))
                except pa.ArrowInvalid:
                    check()
                    from datasets.packaged_modules.json.json import pandas_read_json
                    check()
                    frame = pandas_read_json(StringIO(raw.decode("utf-8-sig")))
                    check()
                    if frame.columns.tolist() == [0]:
                        frame.columns = ["text"]
                    table = pa.Table.from_pandas(frame, preserve_index=False)
                check()
                tables.append(table)
            else:
                # Parquet's embedded Arrow schema can activate extension
                # decoders during opening. The memory-only reader below must
                # reject that metadata before constructing its data reader.
                tables.extend(parquet_reader(raw, check))
            check()
            if not tables:
                raise ValueError("The private training dataset is empty.")
            for table in tables:
                check()
                if type(table) is not pa.Table:
                    raise ValueError("The private training dataset table is unavailable.")
                splits[selected["splitRole"]].append(table.replace_schema_metadata(None))
                check()
        result = fixed_dict()
        for name, tables in splits.items():
            if not tables:
                continue
            check()
            table = fixed_concat(tables, promote_options="default").replace_schema_metadata(None)
            check()
            if len(table) == 0:
                raise ValueError("The private training dataset is empty.")
            result[name] = fixed_dataset(table,
                fingerprint=identity[0].replace("-", "") + "_" + name + "_loaded_v1")
            check()
        check()
        validation = dict.get(result, "validation")
        slot["stage"] = "complete"
        return result, validation
    except BaseException as error:
        slot["stage"] = "failed"
        if isinstance(error, (LaunchUnavailable, TrainingCancellationRequested, KeyboardInterrupt, SystemExit)):
            raise
        # SDK parser exceptions can quote rows, paths or remote references.
        raise ValueError("The private training dataset could not be loaded.") from None


def _load_dataset(payload: TrainModelTaskRequest, *, local_dataset_refs=None, _protected_use=None) -> tuple[Any, Any]:
    if _protected_use is not None:
        if (type(_protected_use) is not _ProtectedTrainingUse or get_ident() != _protected_use._thread
                or _protected_use.payload is not payload):
            raise ValueError("The private protected training inputs are unavailable.")
        _ProtectedTrainingUse.assert_snapshot(_protected_use)
        # Dispatch the captured original only after fixed passive validation.
        # A replaced module helper cannot receive a live Use before this check.
        return _protected_use._dataset_loader(payload, local_dataset_refs, _protected_use)
    _check_protected_use(_protected_use,payload)
    if _protected_use is not None and local_dataset_refs != _protected_use.dataset_references:
        raise ValueError("The private protected training inputs are unavailable.")
    local_dataset_refs = _capture_local_dataset_references(payload,local_dataset_refs)
    train_files: list[str] = []
    validation_files: list[str] = []
    dataset_format: str | None = None

    for index,dataset in enumerate(payload.datasets):
        # Held-out test data is not a training or validation input. Match the
        # existing multimodal separation without inspecting its paths or bytes.
        if dataset.splitRole == "test":
            continue
        if dataset.splitRole not in {"train", "validation"}:
            raise ValueError("Unsupported training dataset split role.")
        _require_non_empty(dataset.artifactId, "datasets[].artifactId")
        path = _dataset_path(dataset) if local_dataset_refs is None else Path(local_dataset_refs[index])
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

    # Validate local selections first, including when this optional dependency
    # is absent. Installing it cannot make an invalid training request valid.
    try:
        from datasets import load_dataset
    except Exception as error:  # pragma: no cover - dependency failure
        raise RuntimeError("datasets is required for model training dataset loading.") from error

    dataset_dict = {"train": train_files}
    if validation_files:
        dataset_dict["validation"] = validation_files

    # JSON Lines uses Datasets' built-in local JSON reader, not a Hub dataset.
    builder = "json" if dataset_format == "jsonl" else dataset_format
    _check_protected_use(_protected_use,payload)  # Imports and callbacks grant no renewed authority.
    loaded = load_dataset(builder, data_files=dataset_dict)
    _check_protected_use(_protected_use,payload)
    if len(loaded["train"]) == 0:
        raise ValueError("Training dataset is empty; refusing to train.")
    return loaded, loaded["validation"] if "validation" in loaded else None


def _resolve_base_model(payload: TrainModelTaskRequest) -> str:
    if payload.baseModel.localPath and payload.baseModel.localPath.strip():
        return payload.baseModel.localPath.strip()
    if payload.baseModel.modelId and payload.baseModel.modelId.strip():
        return payload.baseModel.modelId.strip()
    raise ValueError("baseModel must include modelId or localPath for Python-side training.")


def _local_training_model_reference(reference: str | None) -> str:
    # Read-time preflight only; the execution owner still needs exact Model
    # content/custody proof. No ancestor or native mutation fence is asserted.
    try:
        if not isinstance(reference, str) or not reference.strip():
            raise ValueError()
        path = Path(reference.strip())
        if not path.is_absolute():
            raise ValueError()
        facts = path.lstat()
        if not stat.S_ISDIR(facts.st_mode) or getattr(facts, "st_file_attributes", 0) & 0x400:
            raise ValueError()
        try:
            (path / "adapter_config.json").lstat()
        except FileNotFoundError:
            return str(path)
    except (OSError, ValueError):
        raise ValueError("A local model directory is required for private training.") from None
    # Pinned Transformers auto-discovers this entry, substitutes another base
    # locator and loads adapter weights via PEFT's separate kwargs/weight path.
    # Neither malformed, linked nor directory entries authorize that topology.
    raise ValueError("Adapter model loading is unavailable for private training.")


def _load_transformers_objects(
    base_model_ref: str, method: str, quantization: dict[str, Any], *, local_files_only: bool = False, _protected_use=None,
    training_seed: int | None = None,
) -> tuple[Any, Any]:
    _check_protected_use(_protected_use)
    training_seed = _validate_training_seed(training_seed)
    if _protected_use is not None and (not local_files_only or base_model_ref != _protected_use.model_reference
            or method != _protected_use.payload.method
            or training_seed != _validate_training_seed(_to_dict(_protected_use.payload.commonParameters).get("seed"))):
        raise ValueError("The private protected training model is unavailable.")
    if local_files_only:
        base_model_ref = _local_training_model_reference(base_model_ref)
    _check_protected_use(_protected_use)
    try:
        from transformers import AutoModelForCausalLM, AutoTokenizer
        if training_seed is not None: from transformers import set_seed
    except Exception as error:  # pragma: no cover
        raise RuntimeError("transformers is required for model training.") from error
    _check_protected_use(_protected_use)
    if training_seed is not None:
        set_seed(training_seed)  # Before model/embedding/adapter initialization; never select another provider.
        _check_protected_use(_protected_use)

    model_kwargs: dict[str, Any] = {}
    if method == "qlora":
        try:
            import torch
            import bitsandbytes  # noqa: F401
            from transformers import BitsAndBytesConfig
        except Exception as error:
            raise RuntimeError("QLoRA requires bitsandbytes + torch CUDA support in the Python runtime.") from error

        _check_protected_use(_protected_use)
        if not torch.cuda.is_available():
            raise RuntimeError("QLoRA requires CUDA GPU support; torch.cuda.is_available() is false.")

        _check_protected_use(_protected_use)
        model_kwargs["quantization_config"] = BitsAndBytesConfig(
            load_in_4bit=bool(quantization.get("loadIn4Bit", True)),
            load_in_8bit=bool(quantization.get("loadIn8Bit", False)),
            bnb_4bit_quant_type=str(quantization.get("bnb4BitQuantType", "nf4")),
            bnb_4bit_compute_dtype=getattr(__import__("torch"), str(quantization.get("bnb4BitComputeDtype", "float16"))),
        )
        model_kwargs["device_map"] = "auto"

    # Chosen by the private Python entry, never by a raw Task payload flag.
    # Failure must propagate; retrying ordinary loading would weaken this policy.
    local_kwargs = {"local_files_only": True, "trust_remote_code": False, "token": False} if local_files_only else {}
    _check_protected_use(_protected_use)
    tokenizer = AutoTokenizer.from_pretrained(base_model_ref, use_fast=True, **local_kwargs)
    _check_protected_use(_protected_use)
    if tokenizer.pad_token is None:
        if tokenizer.eos_token is not None:
            tokenizer.pad_token = tokenizer.eos_token
        elif hasattr(tokenizer, "add_special_tokens"):
            tokenizer.add_special_tokens({"pad_token": "<pad>"})
        else:
            raise RuntimeError("Tokenizer does not define a pad or EOS token and cannot add a pad token.")

    if local_files_only:
        # Tokenizer/import callbacks and intervening work grant no permission to
        # discover an adapter. Observe again at the model-factory handoff.
        _check_protected_use(_protected_use)
        _local_training_model_reference(base_model_ref)
        model_kwargs.update(local_kwargs, use_safetensors=True, weights_only=True)
    _check_protected_use(_protected_use)
    model = AutoModelForCausalLM.from_pretrained(base_model_ref, **model_kwargs)
    _check_protected_use(_protected_use)
    _synchronize_model_token_embeddings(model, tokenizer,
        **({"_protected_use":_protected_use} if _protected_use is not None else {}))
    _check_protected_use(_protected_use)
    return model, tokenizer


def _synchronize_model_token_embeddings(model: Any, tokenizer: Any, *, _protected_use=None) -> None:
    _check_protected_use(_protected_use)
    previous_status = None
    if _protected_use is not None:
        if (_protected_use._embedding_observation_lost
                or _protected_use._embedding_model is not None and _protected_use._embedding_model is not model):
            raise ValueError("The private embedding model binding is unavailable.")
        _protected_use._embedding_model = model
        _protected_use._embedding_tokenizer = tokenizer
        previous_status = _protected_use._embedding_status
        # Retain uncertainty before any supplier can mutate the model or fail.
        # A caught failure or later no-op cannot recertify an unknown resize.
        _protected_use._embedding_status = "unknown"
        _protected_use._embedding_observation_lost = True
    try:
        tokenizer_size = len(tokenizer)
    except Exception:
        return

    _check_protected_use(_protected_use)

    if tokenizer_size <= 0:
        return
    get_embeddings = getattr(model,"get_input_embeddings",None)
    _check_protected_use(_protected_use)
    if get_embeddings is None: return
    embeddings = get_embeddings()
    _check_protected_use(_protected_use)
    model_vocab_size = getattr(embeddings, "num_embeddings", None)
    _check_protected_use(_protected_use)
    if not isinstance(model_vocab_size,int):
        return
    if _protected_use is not None and (type(model_vocab_size) is not int or model_vocab_size < 0):
        return
    if tokenizer_size <= model_vocab_size:
        _record_protected_embedding_status(_protected_use,"resized" if previous_status == "resized" else "unchanged")
        return

    resize_embeddings = getattr(model,"resize_token_embeddings",None)
    _check_protected_use(_protected_use)
    if resize_embeddings is None:
        raise RuntimeError(
            f"Tokenizer vocabulary size ({tokenizer_size}) exceeds model embedding size ({model_vocab_size}), "
            "and this model does not support embedding resizing."
        )

    _check_protected_use(_protected_use)
    resize_embeddings(tokenizer_size)
    _check_protected_use(_protected_use)
    _record_protected_embedding_status(_protected_use,"resized")


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


def _tokenize_dataset(
    dataset: Any,
    tokenizer: Any,
    max_sequence_length: int | None,
    *,
    training_task: str | None = None,
    purpose_paths: dict[str, tuple[str, ...]] | None = None,
    _protected_use=None,
) -> Any:
    _check_protected_use(_protected_use)
    block_size = _to_positive_int(max_sequence_length) or DEFAULT_SEQUENCE_LENGTH

    private_splits = None
    if _protected_use is not None:
        # The general DatasetDict mapper fingerprints this closure and may use
        # file caches. Neither behavior is appropriate for an original Use.
        from datasets import Dataset, DatasetDict
        from datasets.table import InMemoryTable
        from pyarrow import Table as ArrowTable
        fixed_map, fixed_dict, fixed_dataset = Dataset.map, DatasetDict, Dataset
        run_id = _protected_use._run_identity[0]

        def memory_binding(split):
            if type(split) is not Dataset:
                raise ValueError("The private in-memory training dataset is unavailable.")
            data = object.__getattribute__(split, "__dict__")
            table, indices = data.get("_data"), data.get("_indices")
            format_kwargs, indexes = data.get("_format_kwargs"), data.get("_indexes")
            if (type(table) is not InMemoryTable or indices is not None
                    or data.get("_format_type") is not None or type(format_kwargs) is not dict or format_kwargs
                    or data.get("_format_columns") is not None or type(indexes) is not dict or indexes):
                raise ValueError("The private in-memory training dataset is unavailable.")
            arrow = object.__getattribute__(table, "__dict__").get("table")
            if type(arrow) is not ArrowTable:
                raise ValueError("The private in-memory training table is unavailable.")
            return table, arrow

        if type(dataset) is not DatasetDict or set(dict.keys(dataset)) not in (
                {"train"}, {"train", "validation"}):
            raise ValueError("The private training dataset splits are unavailable.")
        private_splits = tuple((name, split, memory_binding(split), len(split))
            for name, split in dict.items(dataset))
        if any(size <= 0 for _, _, _, size in private_splits):
            raise ValueError("The private training dataset split is empty.")
        _check_protected_use(_protected_use)

        mapping_splits = []

        def assert_memory_sources():
            if tuple(dict.keys(dataset)) != tuple(row[0] for row in private_splits):
                raise ValueError("The private training dataset splits changed.")
            for name, split, binding, size in private_splits:
                current = memory_binding(split)
                if (dict.__getitem__(dataset, name) is not split
                        or current[0] is not binding[0] or current[1] is not binding[1]
                        or len(split) != size):
                    raise ValueError("The private in-memory training dataset changed.")
            for _, split, binding, size in mapping_splits:
                current = memory_binding(split)
                if current[0] is not binding[0] or current[1] is not binding[1] or len(split) != size:
                    raise ValueError("The private training mapping source changed.")

        assert_memory_sources()
        for name, _, binding, size in private_splits:
            _check_protected_use(_protected_use)
            assert_memory_sources()
            # Keep caller-visible derived indexes out of SDK reads. This new
            # private view uses the captured Arrow values, without feature
            # metadata that could activate image/audio path or URL decoders.
            split = fixed_dataset(binding[1].replace_schema_metadata(None),
                fingerprint=run_id.replace("-", "") + "_" + name + "_inputs_v1")
            mapping_splits.append((name, split, memory_binding(split), size))
            _check_protected_use(_protected_use)
            assert_memory_sources()

    train_split = (dataset["train"] if private_splits is None else
        next(split for name, split, _, _ in mapping_splits if name == "train"))
    column_names = list(train_split.column_names)
    if purpose_paths is not None and training_task in _TRAINING_TASK_REQUIRED_PURPOSES:
        missing_purposes = [
            purpose
            for purpose in _TRAINING_TASK_REQUIRED_PURPOSES[training_task]
            if purpose not in purpose_paths
        ]
        if missing_purposes:
            raise ValueError(
                "Prepared dataset field layout is missing training-purpose mappings: "
                + ", ".join(missing_purposes)
                + "."
            )

    def format_row(batch: dict[str, list[Any]], index: int) -> str:
        def value(column: str) -> str:
            values = batch.get(column, [])
            if index >= len(values):
                return ""
            raw = values[index]
            if isinstance(raw, (dict, list)):
                return json.dumps(raw, ensure_ascii=False)
            return "" if raw is None else str(raw)

        def path_value(path: tuple[str, ...]) -> str:
            values = batch.get(path[0], [])
            if index >= len(values):
                return ""
            raw: Any = values[index]
            for segment in path[1:]:
                if not isinstance(raw, dict):
                    return ""
                raw = raw.get(segment)
            if isinstance(raw, (dict, list)):
                return json.dumps(raw, ensure_ascii=False)
            return "" if raw is None else str(raw)

        def purpose_value(purpose: str) -> str:
            path = purpose_paths.get(purpose) if purpose_paths else None
            return path_value(path) if path else ""

        if purpose_paths is not None and training_task == "llm-instruction":
            instruction = purpose_value("instruction")
            input_value = purpose_value("input")
            context = purpose_value("context")
            thought = purpose_value("thought")
            output = purpose_value("output")
            input_block = f"\nInput:\n{input_value}" if input_value else ""
            context_block = f"\nContext:\n{context}" if context else ""
            thought_block = f"\nThought:\n{thought}" if thought else ""
            return f"Instruction:\n{instruction}{input_block}{context_block}{thought_block}\nResponse:\n{output}"

        if purpose_paths is not None and training_task == "llm-classification":
            return f"Text:\n{value('text')}\nLabel:\n{purpose_value('label')}"

        if purpose_paths is not None and training_task == "llm-extraction":
            return f"Text:\n{value('text')}\nExpected output:\n{purpose_value('expected-output')}"

        if purpose_paths is not None and training_task == "llm-embedding":
            negative = value("negativeText")
            negative_block = f"\nNegative:\n{negative}" if negative else ""
            return f"Anchor:\n{purpose_value('anchor-text')}\nPositive:\n{purpose_value('positive-text')}{negative_block}"

        if purpose_paths is not None and training_task == "llm-reranker":
            negative = value("negativePassage")
            negative_block = f"\nNegative passage:\n{negative}" if negative else ""
            return f"Query:\n{purpose_value('query')}\nPassage:\n{purpose_value('passage')}\nRelevance:\n{value('relevance')}{negative_block}"

        instruction_output_column = (
            "output"
            if "output" in column_names
            else "answer"
            if "answer" in column_names
            else None
        )
        if "instruction" in column_names and instruction_output_column is not None:
            instruction = value("instruction")
            input_value = (
                value("input")
                if "input" in column_names
                else value("question")
                if "question" in column_names
                else ""
            )
            context = value("context")
            thought = value("thought")
            output = value(instruction_output_column)
            input_block = f"\nInput:\n{input_value}" if input_value else ""
            context_block = f"\nContext:\n{context}" if context else ""
            thought_block = f"\nThought:\n{thought}" if thought else ""
            return f"Instruction:\n{instruction}{input_block}{context_block}{thought_block}\nResponse:\n{output}"

        if {"text", "label"}.issubset(column_names):
            return f"Text:\n{value('text')}\nLabel:\n{value('label')}"

        if {"text", "expectedOutput"}.issubset(column_names):
            return f"Text:\n{value('text')}\nExpected output:\n{value('expectedOutput')}"

        if {"anchorText", "positiveText"}.issubset(column_names):
            negative = value("negativeText")
            negative_block = f"\nNegative:\n{negative}" if negative else ""
            return f"Anchor:\n{value('anchorText')}\nPositive:\n{value('positiveText')}{negative_block}"

        if {"query", "passage", "relevance"}.issubset(column_names):
            negative = value("negativePassage")
            negative_block = f"\nNegative passage:\n{negative}" if negative else ""
            return f"Query:\n{value('query')}\nPassage:\n{value('passage')}\nRelevance:\n{value('relevance')}{negative_block}"

        for candidate in ["text", "prompt", "input", "completion", "output"]:
            if candidate in column_names:
                return value(candidate)

        return " ".join(value(column) for column in column_names if value(column))

    def check_tokenization_current():
        _check_protected_use(_protected_use)
        if private_splits is not None:
            assert_memory_sources()

    def tokenize(batch: dict[str, list[Any]]) -> dict[str, Any]:
        check_tokenization_current()
        row_count = max((len(values) for values in batch.values() if isinstance(values, list)), default=0)
        texts = [format_row(batch, index) for index in range(row_count)]
        check_tokenization_current()
        encoded = tokenizer(texts, truncation=True, padding="max_length", max_length=block_size)
        check_tokenization_current()
        encoded["labels"] = list(encoded["input_ids"])
        check_tokenization_current()
        return encoded

    columns = train_split.column_names
    _check_protected_use(_protected_use)
    if private_splits is None:
        result = dataset.map(tokenize, batched=True, remove_columns=columns)
    else:
        mapped = {}
        for name, split, _, size in mapping_splits:
            _check_protected_use(_protected_use)
            assert_memory_sources()
            # One synchronous row avoids a large transient padded batch. Total
            # data/process memory still requires the original resource owner.
            result_split = fixed_map(split, tokenize, batched=True, batch_size=1,
                writer_batch_size=1, remove_columns=list(split.column_names),
                keep_in_memory=True, load_from_cache_file=False, cache_file_name=None,
                num_proc=None, new_fingerprint=run_id.replace("-", "") + "_" + name + "_tokens_v1")
            _check_protected_use(_protected_use)
            assert_memory_sources()
            memory_binding(result_split)
            if len(result_split) != size:
                raise ValueError("The private tokenized dataset row count changed.")
            mapped[name] = result_split
        result = fixed_dict(mapped)
        _check_protected_use(_protected_use)
        assert_memory_sources()
    _check_protected_use(_protected_use)
    return result


def _fail_checkpoint_arguments(use, slot=None):
    if slot is None: slot = use._checkpoint_slot
    if type(slot) is not dict: return
    try:
        family = slot.get("family")
        if family is not None:
            proof = _NATIVE_CHECKPOINT_FAMILY_OWNER(family)
            if type(proof) is tuple and len(proof) == 3 and proof[0] is use and proof[1] is slot:
                slot["stage"] = "failed"
                _NATIVE_OUTPUT_FAMILY_FAIL(family)
    except BaseException: pass


def _checkpoint_argument_factory(base, use, slot):
    if type(base) is not type or slot["stage"] != "arguments-constructing":
        _fail_checkpoint_arguments(use,slot)
        raise ValueError("The private checkpoint arguments are unavailable.")
    original_snapshot = slot["snapshot"]
    def check():
        _check_protected_use(use)
        original_snapshot()
    class SnapshotArguments(base):
        @property
        def should_save(self):
            check()
            return False  # No SDK directory/model/optimizer/state path writing.
    slot["arguments_type"] = SnapshotArguments
    slot["save_property"] = vars(SnapshotArguments)["should_save"]
    def create(**options):
        try:
            check()
            result = SnapshotArguments(**options,save_only_model=True,save_strategy="steps")
            check()
            if type(result) is not SnapshotArguments:
                raise ValueError("The private checkpoint argument receiver is unavailable.")
            fields = _sdk_passive_fields(result)
            expected = (("max_steps",slot["maximum_steps"]),("save_steps",slot["interval"]),
                ("save_total_limit",slot["retention"]),("save_only_model",True))
            if any(type(fields.get(key)) is not type(value) or fields.get(key) != value for key,value in expected):
                raise ValueError("The private checkpoint settings changed.")
            strategy = fields.get("save_strategy")
            if not isinstance(strategy,str) or strategy != "steps":
                raise ValueError("The private checkpoint strategy is unavailable.")
            slot.update(arguments=result,argument_fields=expected+(("save_strategy",strategy),),stage="arguments-ready")
            check()
            return result
        except BaseException:
            _fail_checkpoint_arguments(use,slot)
            raise ValueError("The private checkpoint arguments are unavailable.") from None
    return create


def _build_training_args(payload: TrainModelTaskRequest, output_dir: Path, *, _protected_use=None) -> Any:
    implementation = _build_training_args_impl
    if _protected_use is None:
        return implementation(payload,output_dir)
    use = _protected_use
    if type(use) is not _ProtectedTrainingUse or get_ident() != use._thread:
        raise ValueError("The private checkpoint argument binding is unavailable.")
    original = use._checkpoint_slot
    family = original.get("family") if type(original) is dict else None
    # A duplicate completed setup has no new effect and cannot poison its owner.
    if type(original) is dict and original.get("stage") == "arguments-ready":
        try: _checkpoint_snapshot(use)  # Fixed passive original-owner proof only.
        except BaseException: pass  # A forged ready record is an owned failure.
        else: raise ValueError("The private checkpoint argument attempt is unavailable.")
    try:
        _check_protected_use(use,payload)
        if use.dataset_references is not None:
            family = _NATIVE_CHECKPOINT_FAMILY_RESOLVE(use.view,_ProtectedTrainingUse.assert_snapshot(use))
        if family is not None:
            proof = _NATIVE_OUTPUT_FAMILY_SNAPSHOT(family).get("training_owner")
            if (type(original) is not dict or use._checkpoint_slot is not original
                    or type(proof) is not tuple or len(proof) != 3 or proof[0] is not use
                    or proof[1] is not original or proof[2] is not original.get("snapshot")):
                raise ValueError("The private checkpoint argument binding is unavailable.")
        elif original is not None:
            raise ValueError("The private checkpoint family is unavailable.")
        return implementation(payload,output_dir,_protected_use=use,_checkpoint_binding=original)
    except BaseException:
        # The Native marker survives a missing local slot. It is also the limit
        # of failure authority: another use's family must remain untouched.
        if family is not None:
            try:
                proof = _NATIVE_CHECKPOINT_FAMILY_OWNER(family)
                if type(proof) is tuple and len(proof) == 3 and proof[0] is use:
                    if type(proof[1]) is dict: proof[1]["stage"] = "failed"
                    _NATIVE_OUTPUT_FAMILY_FAIL(family)
            except BaseException: pass
        _fail_checkpoint_arguments(use,original)
        raise


def _build_training_args_impl(payload: TrainModelTaskRequest, output_dir: Path, *, _protected_use=None,
        _checkpoint_binding=None) -> Any:
    _check_protected_use(_protected_use,payload)
    seed, scheduler, evaluation_interval = _text_training_settings(payload)
    checkpoint = _checkpoint_binding
    if _protected_use is not None and _protected_use._checkpoint_slot is not checkpoint:
        raise ValueError("The private checkpoint argument binding changed.")
    if checkpoint is not None:
        if checkpoint["stage"] != "ready":
            if checkpoint["stage"] == "arguments-constructing": _fail_checkpoint_arguments(_protected_use)
            raise ValueError("The private checkpoint argument attempt is unavailable.")
        checkpoint["stage"] = "arguments-constructing"
    try:
        from transformers import TrainingArguments
    except Exception as error:  # pragma: no cover
        if checkpoint is not None: _fail_checkpoint_arguments(_protected_use)
        raise RuntimeError("transformers is required for TrainingArguments.") from error

    arguments_factory = (TrainingArguments if checkpoint is None else
        _checkpoint_argument_factory(TrainingArguments,_protected_use,checkpoint))

    try:
        import torch
        dataloader_pin_memory = bool(torch.cuda.is_available())
    except Exception:
        dataloader_pin_memory = False
    _check_protected_use(_protected_use,payload)

    common = _to_dict(payload.commonParameters)
    advanced = _to_dict(payload.advancedParameters)
    common_max_steps = common.get("maxSteps")
    normalized_max_steps = int(common_max_steps) if isinstance(common_max_steps, (int, float)) else -1
    _check_protected_use(_protected_use,payload)
    result = arguments_factory(
        output_dir=str(output_dir / "checkpoints"),
        num_train_epochs=float(common.get("numEpochs", 1)),
        max_steps=normalized_max_steps,
        per_device_train_batch_size=int(common.get("batchSize", 1)),
        per_device_eval_batch_size=int(common.get("batchSize", 1)),
        learning_rate=float(common.get("learningRate", 5e-5)),
        weight_decay=float(common.get("weightDecay", 0.0)),
        seed=42 if seed is None else seed,
        lr_scheduler_type=scheduler,
        gradient_accumulation_steps=int(advanced.get("gradientAccumulationSteps", 1)),
        warmup_steps=int(advanced.get("warmupSteps", 0)),
        warmup_ratio=float(advanced.get("warmupRatio", 0.0)),
        save_steps=int(advanced.get("checkpointIntervalSteps", 50)),
        eval_strategy="steps" if evaluation_interval > 0 else "no",
        eval_steps=evaluation_interval if evaluation_interval > 0 else None,
        logging_steps=1,
        save_total_limit=int(advanced.get("saveTotalLimit", 2)),
        label_names=["labels"],
        dataloader_pin_memory=dataloader_pin_memory,
        bf16=advanced.get("mixedPrecision") == "bf16",
        fp16=advanced.get("mixedPrecision") == "fp16",
        gradient_checkpointing=bool(advanced.get("gradientCheckpointing", False)),
        report_to=[],
        remove_unused_columns=False,
    )
    _check_protected_use(_protected_use,payload)
    return result


def _apply_lora(model: Any, payload: TrainModelTaskRequest, *, _protected_use=None) -> Any:
    _check_protected_use(_protected_use,payload)
    if _protected_use is not None and (_protected_use._embedding_model is not model
            or _protected_use._embedding_observation_lost):
        raise ValueError("The private adapter model binding is unavailable.")
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

    _check_protected_use(_protected_use,payload)
    lora_config = LoraConfig(**lora_config_args)
    _check_protected_use(_protected_use,payload)
    result = get_peft_model(model, lora_config)
    _check_protected_use(_protected_use,payload)
    if _protected_use is not None:
        if _protected_use._embedding_model is not model:
            raise ValueError("The private adapter model binding is unavailable.")
        _protected_use._embedding_model = result
    return result


def _validation_loss(report: Any, key: str) -> float:
    value = report.get(key) if type(report) is dict else None
    if type(value) not in (int, float):
        raise ValueError("The validation comparison needs finite nonnegative loss measurements.")
    try:
        result = float(value)
    except (OverflowError, ValueError):
        raise ValueError("The validation comparison needs finite nonnegative loss measurements.") from None
    if not isfinite(result) or result < 0:
        raise ValueError("The validation comparison needs finite nonnegative loss measurements.")
    return result


def _validation_subset(dataset: Any) -> tuple[Any, int]:
    try:
        count = min(len(dataset), 32) if dataset is not None else 0
        if count < 1:
            raise ValueError()
        subset = dataset.select(range(count))
        if len(subset) != count:
            raise ValueError()
        return subset, count
    except TrainingCancellationRequested:
        raise
    except Exception:
        raise ValueError("The saved validation sample is unavailable.") from None


def _measure_validation_loss(trainer: Any, subset: Any, prefix: str, *, _captured_evaluate=None) -> float:
    try:
        evaluate = trainer.evaluate if _captured_evaluate is None else _captured_evaluate
        measured = evaluate(eval_dataset=subset, metric_key_prefix=prefix)
    except TrainingCancellationRequested:
        raise
    except Exception as error:
        # Retain the cause in memory; do not copy supplier messages into the
        # existing task error/progress/log output.
        raise ValueError("The validation comparison could not be measured.") from error
    return _validation_loss(measured, prefix + "_loss")


def _validation_comparison_report(metrics: dict[str, float]) -> dict[str, Any]:
    baseline = _validation_loss(metrics, "baseline_validation_loss")
    trained = _validation_loss(metrics, "trained_validation_loss")
    count = _validation_loss(metrics, "validation_sample_count")
    delta = metrics.get("validation_loss_delta")
    if not 1 <= count <= 32 or count != int(count) or type(delta) not in (int, float) or delta != trained - baseline:
        raise ValueError("The validation comparison summary is unavailable.")
    return {"protocol": "fixed-first-32-validation-loss-v1", "maximumRows": 32, "sampleCount": int(count),
            "baselineLoss": baseline, "trainedLoss": trained, "lossDelta": float(delta), "interpretation": "measurement-only"}


def _freeze_training_metrics(raw):
    if type(raw) is not dict or len(raw) > 256:
        raise ValueError("The private training metrics are unavailable.")
    result = []
    for key, value in raw.items():
        if (type(key) is not str or re.fullmatch(r"[A-Za-z][A-Za-z0-9_.-]{0,95}", key) is None
                or type(value) not in (int, float)):
            raise ValueError("The private training metrics are unavailable.")
        number = float(value)
        if not isfinite(number):
            raise ValueError("The private training metrics are unavailable.")
        result.append((key, number))
    return tuple(sorted(result))


def _freeze_training_history(raw, *, loss_key="loss"):
    if type(raw) is not list or len(raw) > 4096:
        raise ValueError("The private training history is unavailable.")
    result = []
    for row in raw:
        if type(row) is not dict or len(row) > 256:
            raise ValueError("The private training history is unavailable.")
        if loss_key not in row or "step" not in row:
            continue
        step, loss = row["step"], row[loss_key]
        if (type(step) is not int or not 0 <= step <= 2**53-1 or type(loss) not in (int, float)
                or result and step < result[-1][0]):
            raise ValueError("The private training history is unavailable.")
        loss = float(loss)
        if not isfinite(loss):
            raise ValueError("The private training history is unavailable.")
        result.append((step, loss))
    return tuple(result)


def _protected_checkpoint_trainer(base, use, model, tokenizer, args):
    """Fixed snapshot dispatch for one original Trainer; no SDK path writer.

    SDK internals remain trusted. The closure pins the task-owned handoff and
    each fresh export to the original permission/resource lifetime. It does not
    supply a producer, durable reservation, result Save or host qualification.
    """
    slot = use._checkpoint_slot
    training = use._training_slot
    if (type(slot) is not dict or slot.get("stage") != "arguments-ready"
            or slot.get("arguments") is not args or type(training) is not dict
            or training.get("stage") != "running" or "checkpoint_execution" in training):
        raise ValueError("The private checkpoint handler is unavailable.")
    family = slot["family"]
    record = _NATIVE_OUTPUT_FAMILY_SNAPSHOT(family)
    configurations = tuple(dict(row) for row in record["outputs"])
    reservation, admission = record["reservation"], record["admission"]
    schedule = slot["steps"]
    embedding_status = use._embedding_status
    view,model_reference,dataset_references = use.view,use.model_reference,use.dataset_references
    training_snapshot,binding_snapshot = training["snapshot"],slot["snapshot"]
    execution = {"stage":"constructing","trainer":None,"active":None,"saved":(),"exports":[]}
    training["checkpoint_execution"] = execution  # One attempt before SDK callbacks.
    retained, retained_seals = [], []
    read_seal_facts = use._completion_helpers[0]
    pipeline_reader = _training_pipeline_proof
    pipeline_proof = pipeline_reader(use)
    expected_methods = {}
    export_type = _ProtectedTrainingUse
    select = _capture_protected_training_tensor_stream
    metadata = _capture_protected_training_metadata
    write = _write_protected_training_output

    def fail():
        execution["stage"] = "failed"
        _fail_checkpoint_arguments(use,slot)

    def passive():
        if _training_pipeline_proof is not pipeline_reader or pipeline_reader(use) is not pipeline_proof:
            raise ValueError("The private checkpoint pipeline proof changed.")
        if pipeline_proof is not None: pipeline_proof.snapshot()
        if (use._checkpoint_slot is not slot or use._training_slot is not training
                or training.get("checkpoint_execution") is not execution
                or execution["stage"] not in ("constructing","training","saving","complete")
                or slot.get("arguments") is not args or training.get("snapshot") is not training_snapshot
                or slot.get("snapshot") is not binding_snapshot
                or use.view is not view or use.model_reference != model_reference or use.dataset_references != dataset_references
                or use._serialize is not _NATIVE_REQUEST_SERIALIZER or use._resolve is not _NATIVE_REFERENCE_RESOLVER
                or use._embedding_status != embedding_status or use._embedding_observation_lost
                or use._checkpoint_export_guard is not None or use._checkpoint_export_binding is not None
                or _ProtectedTrainingUse is not export_type
                or _capture_protected_training_tensor_stream is not select
                or _capture_protected_training_metadata is not metadata or _write_protected_training_output is not write
                or execution["saved"] != tuple(retained)):
            raise ValueError("The private checkpoint execution changed.")
        for child,output,graph,facts in retained_seals:
            if (child._output_slot is not output or output.get("stage") != "sealed"
                    or output.get("graph") is not graph or output.get("seal_facts") is not facts
                    or read_seal_facts(graph) != facts):
                raise ValueError("The private checkpoint seal facts changed.")
        _checkpoint_snapshot(use)
        training_snapshot()
        receiver = execution["trainer"]
        if receiver is not None:
            fields = _sdk_passive_fields(receiver)
            if (type(receiver) is not SnapshotTrainer or fields.get("model") is not model
                    or fields.get("args") is not args or fields.get("processing_class") is not tokenizer
                    or any(name in fields or vars(SnapshotTrainer).get(name) is not function
                        for name,function in expected_methods.items())):
                raise ValueError("The private checkpoint receiver changed.")

    def check():
        _check_protected_use(use)
        passive()

    def save(receiver, selected_model, trial):
        # A foreign receiver has no failure authority over the original attempt.
        if get_ident() != use._thread:
            raise ValueError("The private checkpoint thread is unavailable.")
        if receiver is not execution["trainer"] or receiver is None:
            if execution["trainer"] is None and type(receiver) is SnapshotTrainer: fail()
            raise ValueError("The private checkpoint receiver is unavailable.")
        try:
            if execution["stage"] != "training" or selected_model is not model or trial is not None:
                raise ValueError("The private checkpoint handoff is unavailable.")
            check()
            state = _sdk_passive_fields(receiver).get("state")
            step = _sdk_passive_fields(state).get("global_step")
            index = len(retained)
            if type(step) is not int or index >= len(schedule) or step != schedule[index]:
                raise ValueError("The private checkpoint step is unavailable.")
            current_record = _NATIVE_OUTPUT_FAMILY_SNAPSHOT(family)
            if len(current_record["members"]) != index:
                raise ValueError("The private checkpoint inventory changed.")
            execution["stage"] = "saving"
            child = export_type(use.payload,use.view)
            execution["exports"].append(child)  # Retain every attempted export.
            execution["active"] = child
            identity = use._run_identity
            export_proof = None
            def export_snapshot():
                passive()  # No business/Native observer after final resource proof.
                current_state = _sdk_passive_fields(receiver).get("state")
                if (execution["stage"] != "saving" or execution["active"] is not child
                        or child._checkpoint_export_guard is not export_guard or child._run_identity is not identity
                        or _checkpoint_export_proof(child) is not export_proof
                        or child.view is not view or child.payload is not use.payload
                        or child.model_reference != model_reference or child.dataset_references != dataset_references
                        or child._serialize is not _NATIVE_REQUEST_SERIALIZER or child._resolve is not _NATIVE_REFERENCE_RESOLVER
                        or child._training_slot is not None or child._checkpoint_slot is not None
                        or child._embedding_model is not model or child._embedding_tokenizer is not tokenizer
                        or child._embedding_status != embedding_status or child._embedding_observation_lost
                        or use._run_identity is not identity or current_state is not state
                        or type(_sdk_passive_fields(state).get("global_step")) is not int
                        or _sdk_passive_fields(state)["global_step"] != step):
                    raise ValueError("The private checkpoint export changed.")
                _ProtectedTrainingUse.assert_snapshot(child)
                return identity,step
            def export_guard():
                check()
                return export_snapshot()
            child._checkpoint_export_guard = export_guard
            export_proof = _CheckpointExport(export_guard,export_snapshot)
            child._checkpoint_export_binding = export_proof
            _CHECKPOINT_EXPORTS[child] = ref(export_proof)
            child._run_identity = identity
            child._embedding_model,child._embedding_tokenizer = model,tokenizer
            child._embedding_status = use._embedding_status
            child._embedding_observation_lost = use._embedding_observation_lost
            configuration = configurations[index]
            export_guard()
            select(model,child,maximum_bytes=configuration["maximumCopyBytes"],chunk_bytes=configuration["bufferBytes"])
            export_guard()
            metadata(model,tokenizer,child,maximum_bytes=min(configuration["maximumCopyBytes"],64*1024**2))
            export_guard()
            graph = write(child,configuration=configuration,reservation=reservation,admission=admission,_family=family)
            output = child._output_slot
            facts = output.get("seal_facts") if type(output) is dict else None
            if type(facts) is not tuple or read_seal_facts(graph) != facts:
                raise ValueError("The private checkpoint seal evidence is unavailable.")
            retained_seals.append((child,output,graph,facts))
            export_guard()
            member_record = _NATIVE_OUTPUT_FAMILY_SNAPSHOT(family)
            if (len(member_record["members"]) != index+1 or member_record["members"][-1]["graph"] is not graph
                    or member_record["members"][-1]["stage"] != "sealed"):
                raise ValueError("The private checkpoint sealing is unavailable.")
            retained.append((step,configuration["freshName"],graph))
            execution.update(saved=tuple(retained),active=None,stage="training")
            check()
        except BaseException:
            fail()
            raise ValueError("The private checkpoint could not be saved.") from None

    def deny(receiver,*_args,**_kwargs):
        if get_ident() == use._thread and receiver is execution["trainer"] and receiver is not None: fail()
        raise ValueError("The private SDK path operation is unavailable.")

    class SnapshotTrainer(base):
        _save_checkpoint = save
        save_model = _save = save_state = _rotate_checkpoints = _sorted_checkpoints = deny
        _save_optimizer_and_scheduler = _save_scaler = _save_rng_state = deny
        _load_from_checkpoint = _load_best_model = _load_optimizer_and_scheduler = _load_scaler = deny
        _push_from_checkpoint = push_to_hub = init_hf_repo = deny

    expected_methods.update({name:function for name,function in vars(SnapshotTrainer).items() if type(function) is FunctionType})

    def attach(receiver):
        try:
            check()
            if execution["stage"] != "constructing" or execution["trainer"] is not None or type(receiver) is not SnapshotTrainer:
                raise ValueError("The private checkpoint receiver is unavailable.")
            execution.update(trainer=receiver,stage="training")
            check()
        except BaseException:
            fail(); raise ValueError("The private checkpoint handler is unavailable.") from None

    def finish():
        try:
            check()
            members = _NATIVE_OUTPUT_FAMILY_SNAPSHOT(family)["members"]
            if (execution["stage"] != "training" or tuple(row[0] for row in retained) != schedule
                    or len(members) != len(retained) or any(member["graph"] is not row[2] or member["stage"] != "sealed"
                        for member,row in zip(members,retained))):
                raise ValueError("The private checkpoint schedule is incomplete.")
            execution["stage"] = "complete"
            check()
            return tuple((step,name,facts) for (step,name,_),(_,_,_,facts) in zip(retained,retained_seals))
        except BaseException:
            fail(); raise ValueError("The private checkpoint schedule is incomplete.") from None
    return SnapshotTrainer,attach,check,finish


def _sealed_training_checkpoint_facts(use):
    """Read fixed Native-owned seal facts only; no SDK or business callback."""
    _checkpoint_snapshot(use)
    checkpoint,training = use._checkpoint_slot,use._training_slot
    if type(checkpoint) is not dict or type(training) is not dict:
        raise ValueError("The private checkpoint evidence is unavailable.")
    execution = training.get("checkpoint_execution")
    if type(execution) is not dict or type(execution.get("stage")) is not str or execution["stage"] != "complete":
        raise ValueError("The private checkpoint evidence is unavailable.")
    schedule,saved = checkpoint["steps"],execution.get("saved")
    record = _NATIVE_OUTPUT_FAMILY_SNAPSHOT(checkpoint["family"])
    members = record["members"]
    if (type(saved) is not tuple or len(saved) != len(schedule)
            or len(record["outputs"]) != len(schedule)+1
            or not len(schedule) <= len(members) <= len(schedule)+1):
        raise ValueError("The private checkpoint evidence changed.")
    result = []
    for index,step in enumerate(schedule):
        row,member = saved[index],members[index]
        if (type(row) is not tuple or len(row) != 3 or type(row[0]) is not int or row[0] != step
                or row[1] != record["outputs"][index]["freshName"] or member["graph"] is not row[2]
                or type(member.get("stage")) is not str or member["stage"] != "sealed" or type(row[2]) is not _ProtectedTrainingOutputGraph):
            raise ValueError("The private checkpoint evidence changed.")
        result.append((step,row[1],use._completion_helpers[0](row[2])))
    return tuple(result)


def _finalize_protected_training_result(use):
    """Seal the final original result; no reader-validation, Save or Root grant."""
    if type(use) is not _ProtectedTrainingUse or get_ident() != use._thread:
        raise ValueError("The private final training result is unavailable.")
    if use._final_result_slot is not None:
        previous = use._final_result_slot
        if type(previous) is dict and previous.get("stage") in ("planning","capturing","writing"):
            retained = _NATIVE_CHECKPOINT_FAMILY_OWNER(previous.get("family"))
            if (previous.get("owner") is use and type(retained) is tuple and len(retained) == 3
                    and retained[0] is use and retained[1] is previous.get("checkpoint")):
                previous["stage"] = "failed"
                _fail_checkpoint_arguments(use,retained[1])
        raise ValueError("The private final result attempt is unavailable.")
    checkpoint,history = use._checkpoint_slot,use._training_slot
    if (type(checkpoint) is not dict or type(history) is not dict or history.get("stage") != "complete"
            or type(history.get("snapshot")) is not FunctionType):
        raise ValueError("The private completed training result is unavailable.")
    family = checkpoint.get("family")
    proof = _NATIVE_CHECKPOINT_FAMILY_OWNER(family)
    if type(proof) is not tuple or len(proof) != 3 or proof[0] is not use or proof[1] is not checkpoint:
        raise ValueError("The private final result owner is unavailable.")
    _checkpoint_snapshot(use)
    record = _NATIVE_OUTPUT_FAMILY_SNAPSHOT(family)
    if len(record["members"]) != len(checkpoint["steps"]):
        raise ValueError("The private final result inventory is unavailable.")
    slot = {"stage":"planning","owner":use,"checkpoint":checkpoint,"family":family,"export":None,"graph":None}
    use._final_result_slot = slot  # Retain one owned attempt before SDK suppliers.
    model,tokenizer,view,identity = use._embedding_model,use._embedding_tokenizer,use.view,use._run_identity
    history_snapshot,history_files = history["snapshot"],history["files"]
    configuration = dict(record["outputs"][-1])
    reservation,admission = record["reservation"],record["admission"]
    export_type,select,metadata,write = (_ProtectedTrainingUse,_capture_protected_training_tensor_stream,
        _capture_protected_training_metadata,_write_protected_training_output)
    pipeline_reader = _training_pipeline_proof
    pipeline_proof = pipeline_reader(use)
    child = export_proof = None

    def passive():
        if _training_pipeline_proof is not pipeline_reader or pipeline_reader(use) is not pipeline_proof:
            raise ValueError("The private final pipeline proof changed.")
        if pipeline_proof is not None: pipeline_proof.snapshot()
        if (use._final_result_slot is not slot or slot["family"] is not family
                or slot["owner"] is not use or slot["checkpoint"] is not checkpoint
                or slot["stage"] not in ("planning","capturing","writing","sealed")
                or use.view is not view or use._run_identity is not identity
                or use._embedding_model is not model or use._embedding_tokenizer is not tokenizer
                or use._training_slot is not history or history.get("stage") != "complete"
                or history.get("snapshot") is not history_snapshot or history.get("files") is not history_files
                or use._checkpoint_slot is not checkpoint or use._serialize is not _NATIVE_REQUEST_SERIALIZER
                or use._resolve is not _NATIVE_REFERENCE_RESOLVER or _ProtectedTrainingUse is not export_type
                or _capture_protected_training_tensor_stream is not select
                or _capture_protected_training_metadata is not metadata or _write_protected_training_output is not write):
            raise ValueError("The private final result binding changed.")
        _checkpoint_snapshot(use)
        history_snapshot()
        current_record = _NATIVE_OUTPUT_FAMILY_SNAPSHOT(family)
        if configuration != current_record["outputs"][-1]:
            raise ValueError("The private final result configuration changed.")
        if child is not None:
            if (slot["export"] is not child or _checkpoint_export_proof(child) is not export_proof
                    or child.view is not view or child.payload is not use.payload or child._run_identity is not identity
                    or child._embedding_model is not model or child._embedding_tokenizer is not tokenizer
                    or child._training_slot is not history or child._checkpoint_slot is not None
                    or child.model_reference != use.model_reference or child.dataset_references != use.dataset_references
                    or child._serialize is not _NATIVE_REQUEST_SERIALIZER or child._resolve is not _NATIVE_REFERENCE_RESOLVER
                    or child._embedding_status != use._embedding_status or child._embedding_observation_lost):
                raise ValueError("The private final result export changed.")
            _ProtectedTrainingUse.assert_snapshot(child)

    def current():
        _check_protected_use(use)
        passive()

    try:
        current()
        child = export_type(use.payload,view)
        child._run_identity = identity
        child._embedding_model,child._embedding_tokenizer = model,tokenizer
        child._embedding_status = use._embedding_status
        child._embedding_observation_lost = use._embedding_observation_lost
        child._training_slot = history
        export_proof = _CheckpointExport(current,passive)
        child._checkpoint_export_guard,child._checkpoint_export_binding = current,export_proof
        _CHECKPOINT_EXPORTS[child] = ref(export_proof)
        slot.update(export=child,stage="capturing")
        current()
        select(model,child,maximum_bytes=configuration["maximumCopyBytes"],chunk_bytes=configuration["bufferBytes"])
        current()
        metadata(model,tokenizer,child,maximum_bytes=min(configuration["maximumCopyBytes"],64*1024**2))
        current()
        slot["stage"] = "writing"
        graph = write(child,configuration=configuration,reservation=reservation,admission=admission,_family=family)
        current()
        members = _NATIVE_OUTPUT_FAMILY_SNAPSHOT(family)["members"]
        if len(members) != len(checkpoint["steps"])+1 or members[-1]["graph"] is not graph or members[-1]["stage"] != "sealed":
            raise ValueError("The private final result sealing is unavailable.")
        slot.update(graph=graph,stage="sealed")
        passive()
        return graph
    except BaseException:
        slot["stage"] = "failed"
        _fail_checkpoint_arguments(use,checkpoint)
        raise ValueError("The private final training result is unavailable.") from None


_PROTECTED_COMPLETION_HELPERS = (_protected_output_seal_facts,
    _sealed_training_checkpoint_facts,_finalize_protected_training_result)


def _run_trainer(model, tokenizer, dataset, eval_dataset, args, *, on_progress=None,
        compare_validation_baseline=False, on_validation_progress=None, _protected_use=None):
    if _protected_use is None:
        return _run_trainer_impl(model, tokenizer, dataset, eval_dataset, args, on_progress=on_progress,
            compare_validation_baseline=compare_validation_baseline, on_validation_progress=on_validation_progress)
    use = _protected_use
    if type(use) is not _ProtectedTrainingUse or get_ident() != use._thread:
        raise ValueError("The private training binding is unavailable.")
    previous = use._training_slot
    if previous is not None:
        if type(previous) is dict and previous.get("stage") == "running": previous["stage"] = "failed"
        raise ValueError("The private training attempt is unavailable.")
    _check_protected_use(use)
    checkpoint_family = _NATIVE_CHECKPOINT_FAMILY_RESOLVE(use.view,_ProtectedTrainingUse.assert_snapshot(use))
    checkpoint = use._checkpoint_slot
    if (checkpoint is not None or checkpoint_family is not None) and (
            type(checkpoint) is not dict or checkpoint.get("stage") != "arguments-ready"
            or checkpoint.get("arguments") is not args):
        if checkpoint_family is not None:
            proof = _NATIVE_OUTPUT_FAMILY_SNAPSHOT(checkpoint_family).get("training_owner")
            if type(proof) is tuple and len(proof) == 3 and proof[0] is use:
                _NATIVE_OUTPUT_FAMILY_FAIL(checkpoint_family)
        _fail_checkpoint_arguments(use)
        raise ValueError("The private checkpoint handler is unavailable.")
    if (use._tensor_selection_slot is not None or use._metadata_slot is not None
            or model is not use._embedding_model or tokenizer is not use._embedding_tokenizer
            or use._training_driver is not _run_trainer_impl):
        raise ValueError("The private training binding is unavailable.")
    identity, driver = use._run_identity, use._training_driver
    slot = {"stage":"running", "model":model, "tokenizer":tokenizer, "args":args,
        "driver":driver, "identity":identity, "metrics":None, "history":None, "files":None,
        "entered":False, "returned":False}
    use._training_slot = slot  # One original attempt, retained before SDK calls.
    captured = checkpoint_facts = None
    checkpoint_reader, finalize = use._completion_helpers[1:]
    def snapshot():
        _ProtectedTrainingUse.assert_snapshot(use)
        if (use._training_slot is not slot or type(slot.get("stage")) is not str or slot["stage"] != ("running" if captured is None else "complete")
                or use._run_identity is not identity or use._training_driver is not driver
                or use._embedding_model is not model or use._embedding_tokenizer is not tokenizer
                or slot["model"] is not model or slot["tokenizer"] is not tokenizer or slot["args"] is not args
                or slot["driver"] is not driver or slot["identity"] is not identity
                or _finalize_protected_training_result is not finalize):
            raise ValueError("The private training binding changed.")
        if captured is not None and (slot["files"] is not captured[0] or slot["metrics"] is not captured[1]
                or slot["history"] is not captured[2] or not slot["entered"] or not slot["returned"]):
            raise ValueError("The private completed training history changed.")
        if checkpoint_facts is not None and checkpoint_reader(use) != checkpoint_facts:
            raise ValueError("The private completed checkpoint evidence changed.")
    slot["snapshot"] = snapshot
    try:
        _check_protected_use(use); snapshot()
        slot["entered"] = True
        result = driver(model, tokenizer, dataset, eval_dataset, args,
            on_progress=on_progress, compare_validation_baseline=compare_validation_baseline,
            on_validation_progress=on_validation_progress, _protected_use=use)
        if checkpoint_family is not None:
            metrics, checkpoints, checkpoint_facts = result
            if type(checkpoint_facts) is not tuple or not checkpoint_facts:
                raise ValueError("The private completed checkpoint evidence is unavailable.")
        else: metrics, checkpoints = result
        slot["returned"] = True
        _check_protected_use(use); snapshot()
        frozen_metrics = _freeze_training_metrics(metrics)
        # The driver builds these records from its actual numeric log history.
        # They are observations, never proof that a checkpoint file was written.
        frozen_history = _freeze_training_history(checkpoints, loss_key="value")
        request = _ProtectedTrainingUse.assert_snapshot(use)
        artifact_form = "adapter" if request["method"] in ("lora", "qlora") else "full-model"
        serialization = {"serializationFormat":"adapter-safetensors" if artifact_form == "adapter" else "safetensors",
            "safetensorsFiles":["adapter_model.safetensors" if artifact_form == "adapter" else "model.safetensors"],
            "indexFile":None, "maxShardSize":_parse_max_shard_size(use.payload)}
        validation = {"status":"unknown", "warnings":["Protected output reader validation has not run."],
            "errors":[], "validationReportPath":None}
        run = {"runId":identity[0], "startedAt":identity[1], "method":request["method"],
            "trainingTask":_resolve_training_task(use.payload), "baseModel":request["baseModel"],
            "datasets":request["datasets"], "status":"training-complete", "metrics":dict(frozen_metrics),
            "history":[{"step":step,"loss":loss} for step,loss in frozen_history],
            "checkpointFilesVerified":checkpoint_facts is not None, "candidateValidation":"pending",
            "serializationManifestPath":"serialization_manifest.json"}
        if checkpoint_facts is not None:
            run["checkpointSnapshots"] = [{"step":step,"name":name,"files":[
                {"name":file,"sizeBytes":size,"sha256":sha} for file,size,sha in files]}
                for step,name,files in checkpoint_facts]
        manifest = {"runId":identity[0], "method":request["method"], "trainingTask":run["trainingTask"],
            "serialization":serialization, "validation":validation}
        files = []
        for name, value in (("training-run.json",run),("serialization_manifest.json",manifest)):
            encoded = bytearray()
            for part in json.JSONEncoder(ensure_ascii=False,allow_nan=False,sort_keys=True,separators=(",",":")).iterencode(value):
                raw = part.encode("utf8")
                if len(encoded) + len(raw) > 128*1024:
                    raise ValueError("The private training record is too large.")
                encoded.extend(raw)
            files.append((name, bytes(encoded)))
        files = tuple(files)
        _check_protected_use(use); snapshot()
        slot.update(metrics=frozen_metrics,history=frozen_history,files=files)
        captured = (files, frozen_metrics, frozen_history)
        slot["stage"] = "complete"; snapshot()
        if checkpoint_family is not None: finalize(use)
        snapshot()
        return metrics, checkpoints
    except BaseException as error:
        slot["failed_stage"] = slot["stage"]; slot["stage"] = "failed"
        if checkpoint_family is not None: _fail_checkpoint_arguments(use,checkpoint)
        if isinstance(error, (TrainingCancellationRequested, LaunchUnavailable)):
            raise
        raise ValueError("The private training attempt is unavailable.") from None


def _run_trainer_impl(
    model: Any,
    tokenizer: Any,
    dataset: Any,
    eval_dataset: Any | None,
    args: Any,
    *,
    on_progress: Callable[[dict[str, int]], None] | None = None,
    compare_validation_baseline: bool = False,
    on_validation_progress: Callable[[str], None] | None = None,
    _protected_use=None,
) -> tuple[dict[str, float], list[dict[str, Any]]] | tuple[dict[str, float], list[dict[str, Any]], tuple[Any, ...]]:
    if type(compare_validation_baseline) is not bool:
        raise ValueError("The private validation comparison option is unavailable.")
    sample_count = 0
    if compare_validation_baseline and _protected_use is None:
        eval_dataset, sample_count = _validation_subset(eval_dataset)
    try:
        from transformers import DataCollatorForLanguageModeling, Trainer, TrainerCallback
    except Exception as error:  # pragma: no cover
        raise RuntimeError("transformers Trainer is required for training.") from error
    # Capture the loaded SDK operations before collator, constructor, progress
    # or subset callbacks can replace instance/class dispatch. SDK internals are
    # still trusted; this binds the task-owned call boundary, not arbitrary code.
    train_function = evaluate_function = None
    if _protected_use is not None:
        if type(Trainer) is not type:
            raise ValueError("The private trainer class is unavailable.")
        train_function = _sdk_static_attribute(Trainer,"train")
        evaluate_function = _sdk_static_attribute(Trainer,"evaluate") if compare_validation_baseline else None
        if type(train_function) is not FunctionType or compare_validation_baseline and type(evaluate_function) is not FunctionType:
            raise ValueError("The private trainer operation is unavailable.")
    checkpoint_attach = checkpoint_check = checkpoint_finish = None
    if _protected_use is not None and _protected_use._checkpoint_slot is not None:
        Trainer,checkpoint_attach,checkpoint_check,checkpoint_finish = _protected_checkpoint_trainer(
            Trainer,_protected_use,model,tokenizer,args)
    def current():
        if checkpoint_check is not None: checkpoint_check()
        else: _check_protected_use(_protected_use)
    current()
    if compare_validation_baseline and _protected_use is not None:
        eval_dataset, sample_count = _validation_subset(eval_dataset)
        current()

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
        def __init__(self) -> None:
            self.completed_batches = 0

        def _report_completed_batch(self, _args: Any, state: Any) -> None:
            current()
            if on_progress is None:
                return
            total_batches = estimate_total_batches()
            self.completed_batches = min(self.completed_batches + 1, total_batches)
            total_epochs = int(_args.num_train_epochs) if isinstance(_args.num_train_epochs, (int, float)) else 0
            current_epoch = int(state.epoch) + 1 if isinstance(state.epoch, (int, float)) else 1
            on_progress({
                "epoch": max(current_epoch, 1),
                "totalEpochs": max(total_epochs, 1),
                "batch": self.completed_batches,
                "totalBatches": max(total_batches, 0),
            })
            current()

        def on_substep_end(self, _args: Any, state: Any, _control: Any, **_kwargs: Any) -> None:
            self._report_completed_batch(_args, state)

        def on_step_end(self, _args: Any, state: Any, _control: Any, **_kwargs: Any) -> None:
            self._report_completed_batch(_args, state)

    collator = DataCollatorForLanguageModeling(tokenizer=tokenizer, mlm=False)
    if _protected_use is not None: _protected_use._training_slot["collator"] = collator
    training_data = dataset["train"]
    current()
    trainer = Trainer(
        model=model,
        args=args,
        train_dataset=training_data,
        eval_dataset=eval_dataset,
        processing_class=tokenizer,
        data_collator=collator,
        callbacks=[_TrainingProgressCallback()],
    )
    captured_train = captured_evaluate = None
    if _protected_use is not None:
        if type(trainer) is not Trainer:
            raise ValueError("The private trainer receiver is unavailable.")
        captured_train = MethodType(train_function,trainer)
        captured_evaluate = MethodType(evaluate_function,trainer) if evaluate_function is not None else None
        _protected_use._training_slot.update(trainer=trainer,train_operation=captured_train,evaluate_operation=captured_evaluate)
    if checkpoint_attach is not None: checkpoint_attach(trainer)
    current()
    if on_progress is not None:
        total_epochs = int(ceil(float(getattr(args, "num_train_epochs", 1) or 1)))
        on_progress({
            "epoch": 0,
            "totalEpochs": max(total_epochs, 1),
            "batch": 0,
            "totalBatches": estimate_total_batches(),
        })
    if compare_validation_baseline and on_validation_progress is not None:
        on_validation_progress("baseline-validation")
    current()
    baseline = _measure_validation_loss(trainer, eval_dataset, "baseline_validation",
        **({"_captured_evaluate":captured_evaluate} if captured_evaluate is not None else {})) if compare_validation_baseline else None
    current()
    if compare_validation_baseline and on_validation_progress is not None:
        on_validation_progress("training")
    current()
    train_result = trainer.train() if captured_train is None else captured_train()
    if _protected_use is not None: _protected_use._training_slot["train_result"] = train_result
    current()
    checkpoint_facts = checkpoint_finish() if checkpoint_finish is not None else None
    metrics: dict[str, float] = (dict(_freeze_training_metrics(train_result.metrics)) if _protected_use is not None else
        {k: float(v) for k, v in train_result.metrics.items() if isinstance(v, (int, float))})
    if compare_validation_baseline:
        if on_validation_progress is not None:
            on_validation_progress("trained-validation")
        current()
        trained = _measure_validation_loss(trainer, eval_dataset, "trained_validation",
            **({"_captured_evaluate":captured_evaluate} if captured_evaluate is not None else {}))
        current()
        if on_validation_progress is not None:
            on_validation_progress("comparison-complete")
        # These exact measured fields override similarly named supplier metrics.
        metrics.update(baseline_validation_loss=baseline, trained_validation_loss=trained,
                       validation_loss_delta=trained - baseline, validation_sample_count=float(sample_count))

    checkpoints = []
    if _protected_use is not None:
        history = _freeze_training_history(trainer.state.log_history)
        current()
        output = str(Path(_protected_use.payload.output["outputDirectory"]) / "checkpoints")
        checkpoints = [{"path":output, "step":step, "metric":"loss", "value":loss} for step,loss in history]
    else:
        for state in trainer.state.log_history:
            if "loss" in state and "step" in state:
                checkpoints.append({"path": str(args.output_dir), "step": int(state["step"]), "metric": "loss", "value": float(state["loss"])})
    current()
    return (metrics, checkpoints, checkpoint_facts) if checkpoint_finish is not None else (metrics, checkpoints)


def _capture_pipeline_dataset_binding(dataset):
    """Capture only plain in-memory values, never a Dataset callback or decoder."""
    from datasets import Dataset, DatasetDict
    from datasets.table import InMemoryTable
    from pyarrow import Table
    if type(dataset) is not DatasetDict or set(dict.keys(dataset)) not in ({"train"},{"train","validation"}):
        raise ValueError("The private pipeline datasets are unavailable.")
    def facts(split):
        if type(split) is not Dataset:
            raise ValueError("The private pipeline dataset is unavailable.")
        fields = object.__getattribute__(split,"__dict__")
        table = fields.get("_data")
        if (type(table) is not InMemoryTable or fields.get("_indices") is not None
                or fields.get("_format_type") is not None or fields.get("_format_columns") is not None
                or type(fields.get("_format_kwargs")) is not dict or fields["_format_kwargs"]
                or type(fields.get("_indexes")) is not dict or fields["_indexes"]):
            raise ValueError("The private pipeline dataset format changed.")
        arrow = object.__getattribute__(table,"__dict__").get("table")
        if type(arrow) is not Table or arrow.num_rows <= 0:
            raise ValueError("The private pipeline table is unavailable.")
        return table,arrow
    captured = tuple((name,split,*facts(split)) for name,split in dict.items(dataset))
    def snapshot():
        if tuple(dict.keys(dataset)) != tuple(row[0] for row in captured):
            raise ValueError("The private pipeline dataset splits changed.")
        for name,split,table,arrow in captured:
            current = facts(split)
            if dict.__getitem__(dataset,name) is not split or current[0] is not table or current[1] is not arrow:
                raise ValueError("The private pipeline dataset values changed.")
    snapshot()
    return snapshot


def _run_protected_training_pipeline(use, *, on_progress=None):
    """Compose private stages into a sealed internal graph; no Save/host grant."""
    if type(use) is not _ProtectedTrainingUse or get_ident() != use._thread:
        raise ValueError("The private training pipeline is unavailable.")
    _ProtectedTrainingUse.assert_snapshot(use)
    previous = use._pipeline_slot
    if previous is not None:
        if type(previous) is dict and (type(previous.get("stage")) is not str or previous["stage"] not in ("complete","failed")):
            previous["stage"] = "failed"
            _fail_checkpoint_arguments(use)
        raise ValueError("The private training pipeline attempt is unavailable.")
    if (use._checkpoint_export_guard is not None or use._dataset_slot is not None
            or use._checkpoint_slot is not None or use._training_slot is not None
            or use._embedding_model is not None or use._final_result_slot is not None):
        raise ValueError("The private training pipeline inputs are unavailable.")
    payload,view,identity,helpers = use.payload,use.view,use._run_identity,use._pipeline_helpers
    (bind_checkpoints,load_data,load_model,purpose_mapping,sequence_length,tokenize,
        apply_adapter,arguments,train,capture_data) = helpers
    slot = {"stage":"binding","proof":None,"graph":None}
    use._pipeline_slot = slot
    model = tokenizer = loaded = tokenized = train_args = None
    data_bindings = []
    proof = None
    def snapshot():
        _ProtectedTrainingUse.assert_snapshot(use)
        if (use._pipeline_slot is not slot or slot["proof"] is not proof
                or _training_pipeline_proof(use) is not proof or use.payload is not payload
                or use.view is not view or use._run_identity is not identity or use._pipeline_helpers is not helpers
                or type(slot.get("stage")) is not str
                or slot["stage"] not in ("binding","dataset-loading","model-loading","sequence-length",
                    "tokenization","adapter-configuration","training-arguments","training","complete")):
            raise ValueError("The private training pipeline changed.")
        for binding in data_bindings: binding()
        if tokenizer is not None and use._embedding_tokenizer is not tokenizer:
            raise ValueError("The private pipeline tokenizer changed.")
        if model is not None and slot["stage"] != "adapter-configuration" and use._embedding_model is not model:
            raise ValueError("The private pipeline model changed.")
        training = use._training_slot
        if tokenized is not None and type(training) is dict:
            execution = training.get("checkpoint_execution")
            receiver = execution.get("trainer") if type(execution) is dict else None
            if receiver is not None:
                fields = _sdk_passive_fields(receiver)
                if (fields.get("train_dataset") is not dict.__getitem__(tokenized,"train")
                        or fields.get("eval_dataset") is not dict.get(tokenized,"validation")):
                    raise ValueError("The private pipeline Trainer datasets changed.")
        if train_args is not None:
            checkpoint = use._checkpoint_slot
            if type(checkpoint) is not dict or checkpoint.get("arguments") is not train_args:
                raise ValueError("The private pipeline training arguments changed.")
        if slot["stage"] == "complete":
            final = use._final_result_slot
            if (type(final) is not dict or type(final.get("stage")) is not str
                    or final["stage"] != "sealed" or final.get("graph") is not slot["graph"]):
                raise ValueError("The private pipeline final output changed.")
    proof = _TrainingPipelineBinding(slot,snapshot)
    slot["proof"] = proof; _TRAINING_PIPELINES[use] = ref(proof)
    def current():
        _check_protected_use(use,payload)
        snapshot()
    def progress(value):
        current()
        if on_progress is not None: on_progress(value)
        current()
    def stage(name,message):
        slot["stage"] = name
        progress({"stage":name,"message":message})
    try:
        current()
        bind_checkpoints(use)  # A missing family denies before dataset/model IO.
        current()
        purposes = purpose_mapping(payload)
        current()
        stage("dataset-loading","Loading the approved training data.")
        loaded,evaluation = load_data(payload,local_dataset_refs=use.dataset_references,_protected_use=use)
        data_bindings.append(capture_data(loaded))
        if evaluation is not dict.get(loaded,"validation"):
            raise ValueError("The private pipeline validation split changed.")
        current()
        stage("model-loading","Loading the selected local model.")
        seed = _text_training_settings(payload)[0]
        model,tokenizer = load_model(use.model_reference,payload.method,
            _to_dict(_to_dict(payload.advancedParameters).get("quantization")),
            local_files_only=True,_protected_use=use,training_seed=seed)
        current()
        stage("sequence-length","Preparing the selected model inputs.")
        length,_ = sequence_length(model,tokenizer,_to_dict(payload.commonParameters).get("maxSequenceLength"))
        current()
        stage("tokenization","Preparing training tokens in memory.")
        tokenized = tokenize(loaded,tokenizer,length,training_task=_resolve_training_task(payload),
            purpose_paths=purposes,_protected_use=use)
        data_bindings.append(capture_data(tokenized))
        current()
        if payload.method in ("lora","qlora"):
            stage("adapter-configuration","Preparing the selected training adapter.")
            model = apply_adapter(model,payload,_protected_use=use)
            current()
        stage("training-arguments","Applying the approved training settings.")
        train_args = arguments(payload,Path(payload.output["outputDirectory"]),_protected_use=use)
        current()
        stage("training","Training the selected model.")
        def training_progress(value):
            if type(value) is not dict:
                raise ValueError("The private training progress is unavailable.")
            progress({**value,"stage":"training"})
        train(model,tokenizer,tokenized,dict.get(tokenized,"validation"),train_args,
            on_progress=training_progress,compare_validation_baseline=False,_protected_use=use)
        current()
        final = use._final_result_slot
        if type(final) is not dict or final.get("stage") != "sealed" or type(final.get("graph")) is not _ProtectedTrainingOutputGraph:
            raise ValueError("The private pipeline final output is unavailable.")
        slot["graph"] = final["graph"]
        slot["stage"] = "complete"
        progress({"stage":"staged","message":"Training finished. The output files still need checking."})
        return slot["graph"]
    except BaseException as error:
        slot["stage"] = "failed"
        _fail_checkpoint_arguments(use)
        if isinstance(error,(TrainingCancellationRequested,LaunchUnavailable,KeyboardInterrupt,SystemExit)):raise
        raise ValueError("The private training pipeline could not finish.") from None


_PROTECTED_PIPELINE_HELPERS = (_bind_protected_checkpoint_schedule,_load_dataset,_load_transformers_objects,
    _resolve_training_purpose_paths,_resolve_effective_sequence_length,_tokenize_dataset,
    _apply_lora,_build_training_args,_run_trainer,_capture_pipeline_dataset_binding)


def _training_result_summary(result,files,*,role,step,name,identity,method,training_task,original_records):
    """Small immutable data summary, never original custody or run authority."""
    if (type(result) is not dict or result.get("profile") != role or result.get("files") is not files
            or type(result.get("metadata")) is not dict or type(result.get("tensorShapeSummary")) is not dict
            or not 1 <= len(result["tensorShapeSummary"]) <= 4096
            or result.get("serializationFormat") != ("safetensors" if method == "full-finetune" else "adapter-safetensors")):
        raise ValueError("The private checked training result is unavailable.")
    run = result["metadata"].get("training-run.json")
    if (type(run) is not dict or run.get("runId") != identity[0] or run.get("startedAt") != identity[1]
            or run.get("method") != method):
        raise ValueError("The private checked training lineage changed.")
    if role == "checkpoint":
        if type(run.get("checkpointStep")) is not int or run["checkpointStep"] != step:
            raise ValueError("The private checked checkpoint schedule changed.")
    elif (role != "candidate" or run.get("trainingTask") != training_task
            or any(expected not in files for expected in original_records)):
        raise ValueError("The private checked final training records changed.")
    return (role,step,name,files,result["serializationFormat"],len(result["tensorShapeSummary"]))


def _validate_protected_training_results(use):
    """Bind structural facts to this original run; no completion/custody grant.

    Consume every checkpoint and final stream once. Retain only small immutable
    summaries, never model bodies or the parser's full metadata. Actual resource
    ownership, permanent retirement, Save and public task activation are separate.
    """
    if type(use) is not _ProtectedTrainingUse or get_ident() != use._thread:
        raise ValueError("The private training result validation is unavailable.")
    previous = use._result_validation_slot
    if previous is not None:
        if type(previous) is dict and (type(previous.get("stage")) is not str or
                previous["stage"] not in ("complete","failed")):
            previous["stage"] = "failed"
            _fail_checkpoint_arguments(use)
        raise ValueError("The private training result validation attempt is unavailable.")
    slot = {"stage":"validating","facts":None}
    use._result_validation_slot = slot  # Reserve before any Native observer.
    original_abort,original_delivery = _ORIGINAL_OUTPUT_ABORT,_ORIGINAL_OUTPUT_DELIVERIES.get(use)
    try:
        _ProtectedTrainingUse.assert_snapshot(use)
        _checkpoint_snapshot(use)  # Passive original owner/method binding first.
        pipeline,history,checkpoint = use._pipeline_slot,use._training_slot,use._checkpoint_slot
        proof = _training_pipeline_proof(use)
        if (type(pipeline) is not dict or type(pipeline.get("stage")) is not str or pipeline["stage"] != "complete" or proof is None
                or type(history) is not dict or type(history.get("stage")) is not str or history["stage"] != "complete"
                or type(history.get("snapshot")) is not FunctionType
                or type(checkpoint) is not dict):
            raise ValueError("The private completed training run is unavailable.")
        identity,view,helpers = use._run_identity,use.view,use._result_validation_helpers
        reader,validate,seal_facts,resolve_task,summary,_,_,begin_delivery,tee_delivery,finish_delivery,_ = helpers
        delivery = _ORIGINAL_OUTPUT_DELIVERIES[use]
        request = _ProtectedTrainingUse.assert_snapshot(use)
        training_task = resolve_task(use.payload)
        family = checkpoint["family"];record = _NATIVE_OUTPUT_FAMILY_SNAPSHOT(family)
        business,resource,history_snapshot = checkpoint["result_business"],checkpoint["result_resource"],history["snapshot"]
        steps = checkpoint["steps"];final = use._final_result_slot
        if (type(steps) is not tuple or type(final) is not dict or type(final.get("stage")) is not str or final["stage"] != "sealed"
                or pipeline.get("graph") is not final.get("graph")
                or len(record["members"]) != len(steps)+1 or len(record["outputs"]) != len(steps)+1):
            raise ValueError("The private completed output family is unavailable.")
        graphs = tuple(member["graph"] for member in record["members"])
        configurations = tuple(tuple(sorted(row.items())) for row in record["outputs"])
        inventories = tuple(seal_facts(graph) for graph in graphs)
        original_records = history["files"]
        if (graphs[-1] is not final["graph"] or type(original_records) is not tuple or len(original_records) != 2
                or tuple(name for name,_ in original_records) != ("training-run.json","serialization_manifest.json")
                or any(type(raw) is not bytes or not 0 < len(raw) <= 128*1024 for _,raw in original_records)):
            raise ValueError("The private completed training records are unavailable.")
        expected_records = tuple((name,len(raw),hashlib.sha256(raw).hexdigest()) for name,raw in original_records)
        def snapshot():
            _ProtectedTrainingUse.assert_snapshot(use)
            if (use._result_validation_slot is not slot or type(slot.get("stage")) is not str or slot["stage"] != "validating"
                    or use._pipeline_slot is not pipeline or _training_pipeline_proof(use) is not proof
                    or use._training_slot is not history or use._checkpoint_slot is not checkpoint
                    or use._final_result_slot is not final or use._run_identity is not identity or use.view is not view
                    or use._result_validation_helpers is not helpers or history["files"] is not original_records
                    or checkpoint["steps"] is not steps or checkpoint.get("result_business") is not business
                    or checkpoint.get("result_resource") is not resource or history.get("snapshot") is not history_snapshot
                    or final.get("graph") is not graphs[-1]):
                raise ValueError("The private training result binding changed.")
            _checkpoint_snapshot(use)
            history_snapshot()
            proof.snapshot()
            current = _NATIVE_OUTPUT_FAMILY_SNAPSHOT(family)
            if (current is not record or len(current["members"]) != len(graphs)
                    or tuple(tuple(sorted(row.items())) for row in current["outputs"]) != configurations
                    or any(member["graph"] is not graph or type(member.get("stage")) is not str or member["stage"] != "sealed"
                        for member,graph in zip(current["members"],graphs))
                    or tuple(seal_facts(graph) for graph in graphs) != inventories):
                raise ValueError("The private original result inventory changed.")
        def current():
            # Retain original model/input Native admission without invoking the
            # older family guard's dynamically read business/resource methods.
            _ProtectedTrainingUse.assert_current(use)
            snapshot()
            for kind,method in (("resource",resource),("business",business)):
                if method() is not True:
                    raise ValueError("The private result permission is no longer available.")
                snapshot()  # Business is last; no observer follows this proof.
        summaries = []
        current()
        begin_delivery(delivery,graphs,inventories,steps,current)
        for index,(graph,files,configuration) in enumerate(zip(graphs,inventories,configurations)):
            settings = dict(configuration)
            current()
            stream = reader(graph,view,request)
            current()
            stream = tee_delivery(delivery,stream,index)
            result = validate(stream,files,method=request["method"],
                maximum_copy_bytes=settings["maximumCopyBytes"],
                maximum_metadata_bytes=min(settings["maximumCopyBytes"],64*1024**2),
                chunk_bytes=settings["bufferBytes"])
            current()  # A parser return alone cannot establish current binding.
            role = "candidate" if index == len(graphs)-1 else "checkpoint"
            summaries.append(summary(result,files,role=role,step=steps[index] if role == "checkpoint" else None,
                name=settings["freshName"],identity=identity,method=request["method"],
                training_task=training_task,original_records=expected_records))
            del result  # Do not retain each checkpoint's metadata or tensors.
            current()
        facts = tuple(summaries)
        current()
        finish_delivery(delivery)
        current()
        slot.update(facts=facts,stage="complete")
        return facts
    except BaseException as error:
        slot["stage"] = "failed"
        original_abort(original_delivery)
        _fail_checkpoint_arguments(use)
        if isinstance(error,(TrainingCancellationRequested,LaunchUnavailable,KeyboardInterrupt,SystemExit)):raise
        raise ValueError("The private training results could not be checked.") from None


_PROTECTED_RESULT_VALIDATION_HELPERS = (_NATIVE_TRAINING_OUTPUT_READER,
    validate_protected_training_output_chunks,_protected_output_seal_facts,_resolve_training_task,_training_result_summary,
    capture_original_output_delivery,original_output_delivery_matches,begin_original_output_delivery,tee_original_output_delivery,
    finish_original_output_delivery,abort_original_output_delivery)


def _passive_workflow_result(result,copy,api):
    """Closed data only; no model dump, SDK getter or virtual comparison."""
    if any(type.__getattribute__(base,"__dict__").get(name) is not original for base,name,original in api):
        raise ValueError("The private result schema changed.")
    if result is None:return None
    if type(result) is not _RESULT_CLASS:raise ValueError("The private workflow result changed.")
    fields = object.__getattribute__(result,"__dict__")
    if (type(fields) is not dict or object.__getattribute__(result,"__pydantic_extra__") is not None
            or object.__getattribute__(result,"__pydantic_private__") is not None):
        raise ValueError("The private workflow result fields changed.")
    return copy(fields)


def _prepare_protected_workflow_result(use,facts,configurations,copy,tags):
    request = _ProtectedTrainingUse.assert_snapshot(use)
    history = use._training_slot
    if (type(facts) is not tuple or not facts or type(history) is not dict
            or type(history.get("metrics")) is not tuple or type(history.get("history")) is not tuple):
        raise ValueError("The private workflow history is unavailable.")
    method = request["method"];task = _resolve_training_task(use.payload)
    directories = tuple(dict(row)["freshParent"]+"\\"+dict(row)["freshName"] for row in configurations)
    output = directories[-1];adapter = method in ("lora","qlora")
    serialization = "adapter-safetensors" if adapter else "safetensors"
    checkpoints = [{"step":fact[1],"path":directories[index],"files":[
        {"name":name,"sizeBytes":size,"sha256":sha} for name,size,sha in fact[3]]}
        for index,fact in enumerate(facts[:-1])]
    metadata = {"runtimeTask":"train-model","trainingTask":task,
        "runMetadataPath":output+"\\training-run.json",
        "serialization":{"serializationFormat":serialization},
        "validation":{"status":"valid","scope":"structural","serializationFormat":serialization},
        "modelReadiness":"not-qualified","modelQuality":"not-measured",
        "files":[{"name":name,"sizeBytes":size,"sha256":sha} for name,size,sha in facts[-1][3]],
        "history":[{"step":step,"loss":loss} for step,loss in history["history"]]}
    base = request["baseModel"]
    return copy({"runId":use._run_identity[0],"status":"succeeded","outputDirectory":output,
        "outputModelName":request["output"]["outputModelName"],"checkpoints":checkpoints,
        "metrics":dict(history["metrics"]),"logs":[],"warnings":[],
        "generatedModelCandidate":{"displayName":request["output"]["outputModelName"],"modelId":None,
            "localPath":output,"artifactForm":"adapter" if adapter else "full-model",
            "inferenceMode":base.get("inferenceMode"),"taskTags":tags(task),
            "baseModelId":base.get("modelId"),"adapterOfModelId":base.get("modelId") if adapter else None,
            "generatedFromRunId":use._run_identity[0],"serializationFormat":serialization,"metadata":metadata}})


def _run_protected_training_workflow(use,*,on_progress=None):
    """Original private task path; output staging is not Save or readiness."""
    if type(use) is not _ProtectedTrainingUse or get_ident() != use._thread:
        raise ValueError("The private training workflow is unavailable.")
    _ProtectedTrainingUse.assert_snapshot(use)
    _ProtectedTrainingUse.assert_workflow_helpers(use)
    if use._workflow_slot is not None:
        previous = use._workflow_slot
        if type(previous) is dict and type(previous.get("stage")) is str and previous["stage"] not in ("complete","failed"):
            previous["stage"] = "failed"
        raise ValueError("The private workflow attempt is unavailable.")
    helpers,view,payload,identity = use._workflow_helpers,use.view,use.payload,use._run_identity
    run,validate,retire,admit,prepare,passive,record_claim,factory,copy,owner_reader,tags,api = helpers
    slot = {"stage":"running","proof":None,"claim":None,"result":None,"facts":None,"cleanup":None}
    use._workflow_slot = slot
    ownership = result = frozen = facts = cleanup = None
    cleanup_attempted = False
    proof = None
    def snapshot():
        _ProtectedTrainingUse.assert_snapshot(use)
        if (use._workflow_slot is not slot or slot["proof"] is not proof or use._workflow_helpers is not helpers
                or use.view is not view or use.payload is not payload or use._run_identity is not identity
                or type(slot["stage"]) is not str or slot["stage"] not in ("running","closing","admitting")
                or slot["claim"] is not ownership or slot["result"] is not result or slot["facts"] is not facts
                or slot["cleanup"] is not cleanup):
            raise ValueError("The private training workflow changed.")
        if ownership is not None and owner_reader(ownership[0]) is not ownership[1]:
            raise ValueError("The private workflow claim changed.")
        if ownership is not None:
            binding = ownership[1][1]
            if (use._checkpoint_slot is not binding or binding.get("owner") is not use
                    or binding.get("family") is not ownership[0] or binding.get("snapshot") is not ownership[1][2]
                    or type(binding.get("stage")) is not str
                    or binding["stage"] not in ("binding","ready","arguments-constructing","arguments-ready")):
                raise ValueError("The private workflow checkpoint owner changed.")
        if result is not None and passive(result,copy,api) != frozen:
            raise ValueError("The private workflow result changed.")
    def claim_original(family,claim):
        nonlocal ownership
        snapshot()
        if ownership is not None:raise ValueError("The private workflow claim is repeated.")
        ownership = (family,claim);slot["claim"] = ownership
        snapshot()
    proof = _TrainingWorkflowBinding(slot,claim_original);slot["proof"] = proof
    _TRAINING_WORKFLOWS[use] = ref(proof)
    def progress(value):
        snapshot()
        if on_progress is not None:on_progress(value)
        snapshot()
    try:
        snapshot();passive(None,copy,api)
        run(use,on_progress=progress)
        snapshot()
        facts = validate(use);slot["facts"] = facts
        snapshot()
        if ownership is None:raise ValueError("The private workflow output owner is missing.")
        book = _NATIVE_OUTPUT_FAMILY_SNAPSHOT(ownership[0])
        configurations = tuple(tuple(row.items()) for row in book["outputs"])
        data = prepare(use,facts,configurations,copy,tags)
        snapshot();passive(None,copy,api)
        result = factory(data);slot["result"] = result
        frozen = passive(result,copy,api)
        snapshot();_check_protected_use(use);snapshot()
        progress({"stage":"closing-output","message":"Closing the saved training result files."})
        slot["stage"] = "closing"
        cleanup_attempted = True
        cleanup = retire(ownership[0]);slot["cleanup"] = cleanup
        if cleanup is not True:raise ValueError("The private output IO did not retire.")
        snapshot()
        slot["stage"] = "admitting"
        progress({"stage":"completed","message":"Training output checks and local file closure finished."})
        _ProtectedTrainingUse.assert_current(use);snapshot()
        if admit(ownership[0],use,ownership[1][1]) is not True:
            raise ValueError("The private workflow permission is unavailable.")
        snapshot()  # Passive only after the final business admission.
        slot["stage"] = "complete"
        return result
    except BaseException as error:
        slot["stage"] = "failed"
        if isinstance(error,(TrainingCancellationRequested,KeyboardInterrupt,SystemExit)):raise
        raise ValueError("The private training workflow could not finish.") from None
    finally:
        # This exact tuple was captured immediately after the genuine claim,
        # before SDK callbacks. Failed/foreign claims grant no cleanup authority.
        if ownership is not None and not cleanup_attempted:
            try:
                if owner_reader(ownership[0]) is ownership[1]:
                    cleanup_attempted = True;cleanup = retire(ownership[0]);slot["cleanup"] = cleanup
            except BaseException:slot["cleanup"] = False


_PROTECTED_WORKFLOW_HELPERS = (_run_protected_training_pipeline,_validate_protected_training_results,
    _NATIVE_OUTPUT_FAMILY_RETIRE,_NATIVE_RETIRED_FAMILY_ADMIT,_prepare_protected_workflow_result,
    _passive_workflow_result,_record_workflow_training_claim,_RESULT_FACTORY,_NATIVE_RESULT_COPY,
    _NATIVE_CHECKPOINT_FAMILY_OWNER,_training_task_tags,_RESULT_API)


def _capture_training_hardware(model) -> dict[str, Any] | None:
    """Bounded descriptive facts from the model already used by this run.

    Never import another runtime, read tensors, enumerate machines or probe a
    provider. Observation failure leaves facts unrecorded, not training failed.
    The original execution owner still enforces admission and process limits.
    """
    try:
        torch_module = sys.modules.get("torch")
        torch_fields = vars(torch_module) if isinstance(torch_module, ModuleType) else {}
        precision_names = ("float32", "float16", "bfloat16", "float64", "int8", "uint8")
        known_types = tuple((name, torch_fields.get(name)) for name in precision_names)
        devices, precisions = set(), set()
        for index, parameter in enumerate(model.parameters()):
            if index >= 8192:
                return None
            device = parameter.device.type
            devices.add(device if type(device) is str and device in ("cpu", "cuda", "mps", "xpu") else "other")
            dtype = parameter.dtype
            precisions.add(next((name for name, value in known_types if value is not None and dtype is value), "other"))
        if not devices or not precisions:
            return None

        def loaded_version(name):
            module = sys.modules.get(name)
            value = vars(module).get("__version__") if isinstance(module, ModuleType) else None
            if not isinstance(value, str):
                return None
            value = str.__str__(value)  # TorchVersion is a str subclass; do not call a custom __str__.
            # Recognize ordinary distribution versions only. Unknown forms stay
            # unrecorded; separators used by credentials/paths are not allowed.
            return value if len(value) <= 64 and re.fullmatch(
                r"[0-9]+\.[0-9]+(?:\.[0-9]+)*(?:a[0-9]+|b[0-9]+|rc[0-9]+)?"
                r"(?:\.(?:dev|post)[0-9]+)?(?:\+[a-z0-9.]{1,32})?", value) else None

        cpu_count = os.cpu_count()
        return {"devices": sorted(devices), "precisions": sorted(precisions),
            "logicalCpuCount": cpu_count if type(cpu_count) is int and 1 <= cpu_count <= 4096 else None,
            "pythonVersion": f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}",
            "pytorchVersion": loaded_version("torch"), "transformersVersion": loaded_version("transformers")}
    except Exception:
        return None


def _write_run_metadata(output_path: Path, metadata: dict[str, Any]) -> str:
    run_metadata_path = output_path / "training-run.json"
    run_metadata_path.write_text(json.dumps(metadata, ensure_ascii=False, indent=2), encoding="utf-8")
    return str(run_metadata_path)


def train_model(
    payload: TrainModelTaskRequest,
    *,
    on_progress: Callable[[dict[str, Any]], None] | None = None,
) -> TrainModelTaskResult:
    return _train_model(payload, on_progress=on_progress)


def train_model_from_local_files(
    payload: TrainModelTaskRequest,
    *,
    on_progress: Callable[[dict[str, Any]], None] | None = None,
    compare_validation_baseline: bool = False,
    _model_view: object | None = None,
) -> TrainModelTaskResult:
    """Private load policy, not task admission or Model integrity/ownership proof.

    The execution owner must independently prove authority, installed readiness,
    exact model bytes/custody and resource limits before calling this entry.
    No raw task route or capability activates this function.
    """
    if type(compare_validation_baseline) is not bool:
        raise ValueError("The private validation comparison option is unavailable.")
    if _resolve_training_task(payload) not in TEXT_CAUSAL_TRAINING_TASKS:
        raise ValueError("This private training task is unavailable.")
    # Capture the original local locator before progress/supplier callbacks.
    local_dataset_refs = None; protected_use = None
    if _model_view is not None:
        if type(payload) is not TrainModelTaskRequest:
            raise ValueError("The private protected Model request is unavailable.")
        protected_use = _ProtectedTrainingUse(payload,_model_view)
        local_dataset_refs = protected_use.dataset_references
        local_model_ref = _local_training_model_reference(protected_use.model_reference)
        _check_protected_use(protected_use,payload)
    else:
        local_model_ref = _local_training_model_reference(payload.baseModel.localPath)
    return _train_model(payload, on_progress=on_progress, local_model_ref=local_model_ref,
        compare_validation_baseline=compare_validation_baseline,
        **({"local_dataset_refs":local_dataset_refs} if local_dataset_refs is not None else {}),
        **({"_protected_use":protected_use} if protected_use is not None else {}))


def _train_model(
    payload: TrainModelTaskRequest,
    *,
    on_progress: Callable[[dict[str, Any]], None] | None = None,
    local_model_ref: str | None = None,
    compare_validation_baseline: bool = False,
    local_dataset_refs: tuple[str,...] | None = None,
    _protected_use=None,
) -> TrainModelTaskResult:
    _check_protected_use(_protected_use,payload)
    if _protected_use is not None and (local_model_ref != _protected_use.model_reference
            or local_dataset_refs != _protected_use.dataset_references):
        raise ValueError("The private protected training inputs are unavailable.")
    if type(compare_validation_baseline) is not bool or compare_validation_baseline and local_model_ref is None:
        raise ValueError("The private local validation comparison is unavailable.")
    if _protected_use is not None:
        if compare_validation_baseline:raise ValueError("Model-quality scoring is not part of this private workflow.")
        return _run_protected_training_workflow(_protected_use,on_progress=on_progress)
    if local_dataset_refs is not None:
        if (_protected_use is None or local_model_ref is None
                or _resolve_training_task(payload) not in TEXT_CAUSAL_TRAINING_TASKS):
            raise ValueError("The private protected training inputs are unavailable.")
        local_dataset_refs = _capture_local_dataset_references(payload,local_dataset_refs)
    if _protected_use is not None:
        original_progress = on_progress
        def protected_progress(value):
            _check_protected_use(_protected_use,payload)
            if original_progress is not None: original_progress(value)
            _check_protected_use(_protected_use,payload)
        on_progress = protected_progress
    _require_non_empty(payload.output.get("outputModelName"), "output.outputModelName")
    training_task = _resolve_training_task(payload)

    if payload.method not in SUPPORTED_METHODS:
        raise ValueError(f"Training method '{payload.method}' is not supported. Supported methods: {', '.join(sorted(SUPPORTED_METHODS))}")

    training_seed = _text_training_settings(payload)[0] if training_task in TEXT_CAUSAL_TRAINING_TASKS else None
    seed_options = {"training_seed":training_seed} if training_seed is not None else {}

    started_instant = datetime.now(timezone.utc)
    started_at = started_instant.isoformat(timespec="milliseconds").replace("+00:00", "Z")
    started_ns = monotonic_ns()

    run_id = (_protected_use._run_identity[0] if _protected_use is not None else
        f"train-{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')}")
    output_model_name = payload.output.get("outputModelName")
    configured_output_directory = payload.output.get("outputDirectory")
    _check_protected_use(_protected_use,payload)
    output_directory = configured_output_directory or tempfile.mkdtemp(prefix=f"{output_model_name}-")

    output_path = Path(output_directory)
    _check_protected_use(_protected_use,payload)
    output_path.mkdir(parents=True, exist_ok=True)
    _check_protected_use(_protected_use,payload)

    warnings: list[str] = []
    logs: list[str] = []

    if training_task not in TEXT_CAUSAL_TRAINING_TASKS and training_task not in NON_TEXT_TRAINING_TASKS:
        return TrainModelTaskResult(
            runId=run_id,
            status="failed",
            outputDirectory=str(output_path),
            outputModelName=output_model_name,
            logs=logs,
            warnings=warnings,
            error={
                "code": "training_task_unknown",
                "message": f"Training task '{training_task}' is not recognized.",
                "details": {
                    "trainingTask": training_task,
                    "supportedTrainingTasks": sorted(TEXT_CAUSAL_TRAINING_TASKS | NON_TEXT_TRAINING_TASKS),
                },
            },
        )

    stage = "purpose-mapping"
    try:
        purpose_paths = _resolve_training_purpose_paths(payload)
        if training_task in DIFFUSION_TRAINING_TASKS:
            stage = "diffusion-delegate"
            from .train_model_multimodal import train_diffusion_lora_model

            return train_diffusion_lora_model(
                payload,
                training_task=training_task,
                run_id=run_id,
                output_path=output_path,
                output_model_name=output_model_name,
                purpose_paths=purpose_paths,
                on_progress=on_progress,
            )

        if training_task in VISION_TRAINING_TASKS:
            stage = "vision-delegate"
            from .train_model_multimodal import train_vision_model

            return train_vision_model(
                payload,
                training_task=training_task,
                run_id=run_id,
                output_path=output_path,
                output_model_name=output_model_name,
                purpose_paths=purpose_paths,
                on_progress=on_progress,
            )

        stage = "initializing"
        if on_progress is not None:
            on_progress({"stage": "initializing", "message": "Loading training datasets and model assets..."})

        stage = "base-model-resolution"
        base_model_ref = _local_training_model_reference(local_model_ref) if local_model_ref is not None else _resolve_base_model(payload)
        _check_protected_use(_protected_use,payload)
        stage = "dataset-loading"
        dataset, eval_dataset = _load_dataset(payload,
            **({"local_dataset_refs":local_dataset_refs} if local_dataset_refs is not None else {}),
            **({"_protected_use":_protected_use} if _protected_use is not None else {}))
        _check_protected_use(_protected_use,payload)

        stage = "model-loading"
        advanced = _to_dict(payload.advancedParameters)
        quantization = _to_dict(advanced.get("quantization"))
        model, tokenizer = (
            _load_transformers_objects(base_model_ref, payload.method, quantization, local_files_only=True,
                **({"_protected_use":_protected_use} if _protected_use is not None else {}),**seed_options)
            if local_model_ref is not None else _load_transformers_objects(base_model_ref, payload.method, quantization,**seed_options)
        )
        _check_protected_use(_protected_use,payload)

        stage = "sequence-length"
        effective_sequence_length, sequence_length_warning = _resolve_effective_sequence_length(
            model,
            tokenizer,
            _to_dict(payload.commonParameters).get("maxSequenceLength"),
        )
        _check_protected_use(_protected_use,payload)
        if sequence_length_warning is not None:
            warnings.append(sequence_length_warning)
            logs.append(sequence_length_warning)

        stage = "tokenization"
        tokenized = _tokenize_dataset(
            dataset,
            tokenizer,
            effective_sequence_length,
            training_task=training_task,
            purpose_paths=purpose_paths,
            **({"_protected_use":_protected_use} if _protected_use is not None else {}),
        )
        _check_protected_use(_protected_use,payload)
        tokenized_eval = tokenized["validation"] if "validation" in tokenized else None

        if payload.method in {"lora", "qlora"}:
            stage = "adapter-configuration"
            model = _apply_lora(model, payload,**({"_protected_use":_protected_use} if _protected_use is not None else {}))
            _check_protected_use(_protected_use,payload)
            logs.append(f"Applied {payload.method.upper()} adapter config.")

        stage = "training-arguments"
        train_args = _build_training_args(payload, output_path,
            **({"_protected_use":_protected_use} if _protected_use is not None else {}))
        _check_protected_use(_protected_use,payload)
        def on_training_progress(progress: dict[str, int]) -> None:
            message = (
                f"Epoch [{progress.get('epoch', 0)}]/[{progress.get('totalEpochs', 0)}], "
                f"Batch [{progress.get('batch', 0)}]/[{progress.get('totalBatches', 0)}]"
            )
            logs.append(message)
            if on_progress is not None:
                on_progress({**progress, "message": message, "stage": "training"})

        stage = "training-loop"
        def on_validation_progress(phase: str) -> None:
            messages = {"baseline-validation": "Measuring starting validation loss.", "training": "Training the selected model.",
                        "trained-validation": "Measuring trained validation loss.", "comparison-complete": "Validation measurements are ready for review."}
            if phase not in messages:
                raise ValueError("The private validation progress phase is unavailable.")
            if on_progress is not None:
                # The existing task callback checks cancellation at each boundary.
                on_progress({"stage": phase, "message": messages[phase]})
        metrics, checkpoints = _run_trainer(model, tokenizer, tokenized, tokenized_eval, train_args, on_progress=on_training_progress,
            **({"compare_validation_baseline": True, "on_validation_progress": on_validation_progress} if compare_validation_baseline else {}),
            **({"_protected_use":_protected_use} if _protected_use is not None else {}))
        _check_protected_use(_protected_use,payload)
        comparison = _validation_comparison_report(metrics) if compare_validation_baseline else None

        stage = "serialization"
        if on_progress is not None:
            on_progress({"stage": "serializing", "message": "Serializing trained model artifacts..."})

        max_shard_size = _parse_max_shard_size(payload)
        _check_protected_use(_protected_use,payload)
        if payload.method in {"lora", "qlora"}:
            serialization = save_adapter_pretrained(
                model,
                tokenizer,
                output_path,
                base_model_id=payload.baseModel.modelId,
            )
            artifact_form = "adapter"
        else:
            serialization = save_full_model_pretrained(model, tokenizer, output_path, max_shard_size=max_shard_size)
            artifact_form = "full-model"
        _check_protected_use(_protected_use,payload)

        stage = "validation"
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

        stage = "serialization-manifest"
        _check_protected_use(_protected_use,payload)
        manifest_path = write_serialization_manifest(output_path, {
            "runId": run_id,
            "method": payload.method,
            "trainingTask": training_task,
            "serialization": serialization,
            "validation": validation,
        })

        stage = "run-metadata"
        _check_protected_use(_protected_use,payload)
        # Model loading, training and serialization have ended. This is pipeline
        # timing, not original worker/IO settlement or a resource-budget proof.
        hardware = _capture_training_hardware(model) if local_model_ref is not None else None
        completed_instant = datetime.now(timezone.utc)
        completed_at = completed_instant.isoformat(timespec="milliseconds").replace("+00:00", "Z")
        duration_ms = (monotonic_ns() - started_ns) // 1_000_000
        recorded_duration = duration_ms if type(duration_ms) is int and 0 <= duration_ms <= 604_800_000 else None
        execution_history = ({"schema": "model-training-execution-v1", "runId": run_id,
            "startedAt": started_at, "completedAt": completed_at, "durationMs": recorded_duration,
            "hardware": hardware, "interpretation": "reported-runtime-facts"}
            if hardware is not None and recorded_duration is not None and
                timedelta(0) <= completed_instant - started_instant <= timedelta(days=7) else None)
        run_metadata_path = _write_run_metadata(
            output_path,
            {
                "runId": run_id,
                "method": payload.method,
                "trainingTask": training_task,
                "baseModel": payload.baseModel.model_dump(mode="json"),
                "datasets": [dataset_entry.model_dump(mode="json") for dataset_entry in payload.datasets],
                "startedAt": started_at,
                "completedAt": completed_at,
                **({"durationMs": recorded_duration} if recorded_duration is not None else {}),
                "status": "failed" if validation_enabled and validation["status"] == "invalid" else "succeeded",
                "serializationManifestPath": manifest_path,
                **({"validationComparison": comparison} if comparison is not None else {}),
                **({"executionHistory": execution_history} if execution_history is not None else {}),
            },
        )

        stage = "generated-candidate"
        generated_model_path = str(output_path)
        model_id = payload.baseModel.modelId

        if validation["status"] == "invalid":
            warnings.append("Training output validation failed.")

        metadata = {
            "runtimeTask": "train-model",
            "trainingTask": training_task,
            "runMetadataPath": run_metadata_path,
            "validation": validation,
            "serialization": serialization,
            **({"validationComparison": comparison} if comparison is not None else {}),
            **({"executionHistory": execution_history} if execution_history is not None else {}),
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
                "taskTags": _training_task_tags(training_task),
                "baseModelId": model_id,
                "adapterOfModelId": model_id if artifact_form == "adapter" else None,
                "generatedFromRunId": run_id,
                "serializationFormat": validation.get("serializationFormat") or serialization.get("serializationFormat"),
                "metadata": metadata,
            }

        stage = "completion-report"
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
    except TrainingCancellationRequested:
        if not configured_output_directory:
            rmtree(output_path, ignore_errors=True)
        raise
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
                    "trainingTask": training_task,
                    "stage": stage,
                    "errorType": _training_error_type(error),
                },
            },
        )
