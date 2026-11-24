from __future__ import annotations

import json
import re
import stat
import sys
import tempfile
from collections import OrderedDict
from types import BuiltinMethodType, FunctionType, GetSetDescriptorType, MethodType, ModuleType
from shutil import rmtree
from datetime import datetime, timezone
from decimal import Decimal
from math import ceil, isfinite
from pathlib import Path
from threading import get_ident
from typing import Any, Callable

from ..models import TrainModelTaskRequest, TrainModelTaskResult
from ..native.windows_original_worker_launch import (LaunchUnavailable, OriginalTrainingDenseTensorStream,
    OriginalTrainingOutputFamily, OriginalTrainingOutputGraph, _fail_output_family, _output_family_snapshot,
    resolve_original_training_references)
from .model_serialization import DEFAULT_MAX_SHARD_SIZE, save_adapter_pretrained, save_full_model_pretrained, write_serialization_manifest
from .model_validation import validate_model_output

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
_NATIVE_TENSOR_STREAM = OriginalTrainingDenseTensorStream
_NATIVE_OUTPUT_INIT = OriginalTrainingOutputGraph.__init__
_NATIVE_OUTPUT_GUARD = OriginalTrainingOutputGraph.guard
_NATIVE_OUTPUT_PREPARE = OriginalTrainingOutputGraph.prepare
_NATIVE_OUTPUT_ASSERT_SEALED = OriginalTrainingOutputGraph.assert_sealed
_NATIVE_OUTPUT_FAMILY_TYPE = OriginalTrainingOutputFamily
_NATIVE_OUTPUT_FAMILY_SNAPSHOT = _output_family_snapshot
_NATIVE_OUTPUT_FAMILY_FAIL = _fail_output_family
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
    __slots__ = ("payload","view","model_reference","dataset_references","_resolve","_serialize",
        "_tensor_stream_type","_embedding_status","_embedding_model","_embedding_tokenizer",
        "_embedding_observation_lost","_tensor_selection_slot","_metadata_slot","_output_graph_type","_output_slot","_request_stamp",
        "_run_identity","_training_driver","_training_slot","_thread",
        "_output_family_type","_output_family_snapshot","_output_family_fail")

    def __init__(self, payload, view):
        if type(payload) is not TrainModelTaskRequest:
            raise ValueError("The private protected training request is unavailable.")
        self.payload, self.view = payload, view
        self._resolve, self._serialize = _NATIVE_REFERENCE_RESOLVER, _NATIVE_REQUEST_SERIALIZER
        self._tensor_stream_type = _NATIVE_TENSOR_STREAM
        self._embedding_status, self._tensor_selection_slot = "unknown", None
        self._embedding_model = None
        self._embedding_tokenizer, self._metadata_slot = None, None
        self._output_graph_type, self._output_slot = _ProtectedTrainingOutputGraph, None
        self._output_family_type = _NATIVE_OUTPUT_FAMILY_TYPE
        self._output_family_snapshot, self._output_family_fail = _NATIVE_OUTPUT_FAMILY_SNAPSHOT, _NATIVE_OUTPUT_FAMILY_FAIL
        started = datetime.now(timezone.utc)
        self._run_identity = (f"train-{started.strftime('%Y%m%d%H%M%S')}", started.isoformat())
        self._training_driver, self._training_slot = _run_trainer_impl, None
        self._thread = get_ident()
        self._embedding_observation_lost = False
        try:
            request = self._serialize(payload,mode="json")
            self._request_stamp = json.dumps(request,sort_keys=True,allow_nan=False,separators=(",",":"))
        except Exception: raise ValueError("The private protected training request is unavailable.") from None
        model,inputs = self._resolve(view,request)
        self.model_reference, self.dataset_references = model, inputs

    def assert_snapshot(self):
        """Fixed typed request comparison; no Native or business observer call."""
        if type(self) is not _ProtectedTrainingUse or type(self.payload) is not TrainModelTaskRequest:
            raise ValueError("The private protected training request is unavailable.")
        try:
            request = self._serialize(self.payload,mode="json")
            stamp = json.dumps(request,sort_keys=True,allow_nan=False,separators=(",",":"))
        except Exception: raise ValueError("The private protected training request is unavailable.") from None
        if stamp != self._request_stamp:
            # Keep the established original-view refusal type without invoking
            # a Native observer in the passive post-resource comparison.
            raise LaunchUnavailable()
        return request

    def assert_current(self):
        request = _ProtectedTrainingUse.assert_snapshot(self)
        if self._resolve(self.view,request) != (self.model_reference,self.dataset_references):
            raise ValueError("The private protected training references are unavailable.")


def _check_protected_use(use, payload=None):
    if use is None: return
    if type(use) is not _ProtectedTrainingUse or payload is not None and use.payload is not payload:
        raise ValueError("The private protected training inputs are unavailable.")
    # Call the fixed class operation; an instance cannot select another guard.
    _ProtectedTrainingUse.assert_current(use)
    training = use._training_slot
    if training is not None:
        if type(training) is not dict or type(training.get("snapshot")) is not FunctionType:
            raise ValueError("The private training binding is unavailable.")
        training["snapshot"]()


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
        stream = None
        def binding():
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
                    or use._embedding_observation_lost):
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
        def plain(value, *, strip_paths=False, typed_tokens=True, legacy_tokens=False):
            nodes, characters, active = 0, 0, set()
            def visit(item,depth=0):
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
                    if type(item) is not dict or len(item) > maximum_bytes or any(type(k) is not str for k in item):
                        raise ValueError("The private metadata value is unavailable.")
                    result = {}
                    for key,value in item.items():
                        if strip_paths and key in path_keys: continue
                        if (strip_paths and key in ("auto_map","auto_mapping","_auto_class") and value is not None
                                and not (type(value) is dict and not value)):
                            raise ValueError("Custom metadata code export is unavailable.")
                        result[visit(key,depth+1)] = visit(value,depth+1)
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
            config = plain(raw,strip_paths=True)
            files = list(history_files)
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


def _write_protected_training_output(use, *, configuration, reservation, admission, _family=None):
    """Seal the captured single-file candidate; no training, Save or Root grant."""
    if type(use) is not _ProtectedTrainingUse or use._output_slot is not None:
        raise ValueError("The private trained output is unavailable.")
    slot = {"stage":"planning","selection":None,"metadata":None,"graph":None,
        "files":None,"entered":False,"returned":False,"current":None,"family":_family}
    use._output_slot = slot
    family_type, family_snapshot, family_fail = _NATIVE_OUTPUT_FAMILY_TYPE, _NATIVE_OUTPUT_FAMILY_SNAPSHOT, _NATIVE_OUTPUT_FAMILY_FAIL
    owned_family = None
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
                    or use._output_family_snapshot is not family_snapshot or use._output_family_fail is not family_fail):
                raise ValueError("The private output family binding changed.")
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


def _load_dataset(payload: TrainModelTaskRequest, *, local_dataset_refs=None, _protected_use=None) -> tuple[Any, Any]:
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
) -> tuple[Any, Any]:
    _check_protected_use(_protected_use)
    if _protected_use is not None and (not local_files_only or base_model_ref != _protected_use.model_reference
            or method != _protected_use.payload.method):
        raise ValueError("The private protected training model is unavailable.")
    if local_files_only:
        base_model_ref = _local_training_model_reference(base_model_ref)
    _check_protected_use(_protected_use)
    try:
        from transformers import AutoModelForCausalLM, AutoTokenizer
    except Exception as error:  # pragma: no cover
        raise RuntimeError("transformers is required for model training.") from error
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

    column_names = list(dataset["train"].column_names)
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

    def tokenize(batch: dict[str, list[Any]]) -> dict[str, Any]:
        _check_protected_use(_protected_use)
        row_count = max((len(values) for values in batch.values() if isinstance(values, list)), default=0)
        texts = [format_row(batch, index) for index in range(row_count)]
        _check_protected_use(_protected_use)
        encoded = tokenizer(texts, truncation=True, padding="max_length", max_length=block_size)
        _check_protected_use(_protected_use)
        encoded["labels"] = list(encoded["input_ids"])
        _check_protected_use(_protected_use)
        return encoded

    columns = dataset["train"].column_names
    _check_protected_use(_protected_use)
    result = dataset.map(tokenize, batched=True, remove_columns=columns)
    _check_protected_use(_protected_use)
    return result


def _build_training_args(payload: TrainModelTaskRequest, output_dir: Path, *, _protected_use=None) -> Any:
    _check_protected_use(_protected_use,payload)
    try:
        from transformers import TrainingArguments
    except Exception as error:  # pragma: no cover
        raise RuntimeError("transformers is required for TrainingArguments.") from error

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
    result = TrainingArguments(
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
    if (use._tensor_selection_slot is not None or use._metadata_slot is not None
            or model is not use._embedding_model or tokenizer is not use._embedding_tokenizer
            or use._training_driver is not _run_trainer_impl):
        raise ValueError("The private training binding is unavailable.")
    identity, driver = use._run_identity, use._training_driver
    slot = {"stage":"running", "model":model, "tokenizer":tokenizer, "args":args,
        "driver":driver, "identity":identity, "metrics":None, "history":None, "files":None,
        "entered":False, "returned":False}
    use._training_slot = slot  # One original attempt, retained before SDK calls.
    captured = None
    def snapshot():
        _ProtectedTrainingUse.assert_snapshot(use)
        if (use._training_slot is not slot or slot["stage"] != ("running" if captured is None else "complete")
                or use._run_identity is not identity or use._training_driver is not driver
                or use._embedding_model is not model or use._embedding_tokenizer is not tokenizer
                or slot["model"] is not model or slot["tokenizer"] is not tokenizer or slot["args"] is not args
                or slot["driver"] is not driver or slot["identity"] is not identity):
            raise ValueError("The private training binding changed.")
        if captured is not None and (slot["files"] is not captured[0] or slot["metrics"] is not captured[1]
                or slot["history"] is not captured[2] or not slot["entered"] or not slot["returned"]):
            raise ValueError("The private completed training history changed.")
    slot["snapshot"] = snapshot
    try:
        _check_protected_use(use); snapshot()
        slot["entered"] = True
        metrics, checkpoints = driver(model, tokenizer, dataset, eval_dataset, args,
            on_progress=on_progress, compare_validation_baseline=compare_validation_baseline,
            on_validation_progress=on_validation_progress, _protected_use=use)
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
            "checkpointFilesVerified":False, "candidateValidation":"pending",
            "serializationManifestPath":"serialization_manifest.json"}
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
        return metrics, checkpoints
    except BaseException as error:
        slot["failed_stage"] = slot["stage"]; slot["stage"] = "failed"
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
) -> tuple[dict[str, float], list[dict[str, Any]]]:
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
    _check_protected_use(_protected_use)
    if compare_validation_baseline and _protected_use is not None:
        eval_dataset, sample_count = _validation_subset(eval_dataset)
        _check_protected_use(_protected_use)

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

        def on_substep_end(self, _args: Any, state: Any, _control: Any, **_kwargs: Any) -> None:
            self._report_completed_batch(_args, state)

        def on_step_end(self, _args: Any, state: Any, _control: Any, **_kwargs: Any) -> None:
            self._report_completed_batch(_args, state)

    collator = DataCollatorForLanguageModeling(tokenizer=tokenizer, mlm=False)
    if _protected_use is not None: _protected_use._training_slot["collator"] = collator
    training_data = dataset["train"]
    _check_protected_use(_protected_use)
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
    _check_protected_use(_protected_use)
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
    _check_protected_use(_protected_use)
    baseline = _measure_validation_loss(trainer, eval_dataset, "baseline_validation",
        **({"_captured_evaluate":captured_evaluate} if captured_evaluate is not None else {})) if compare_validation_baseline else None
    _check_protected_use(_protected_use)
    if compare_validation_baseline and on_validation_progress is not None:
        on_validation_progress("training")
    _check_protected_use(_protected_use)
    train_result = trainer.train() if captured_train is None else captured_train()
    if _protected_use is not None: _protected_use._training_slot["train_result"] = train_result
    _check_protected_use(_protected_use)
    metrics: dict[str, float] = (dict(_freeze_training_metrics(train_result.metrics)) if _protected_use is not None else
        {k: float(v) for k, v in train_result.metrics.items() if isinstance(v, (int, float))})
    if compare_validation_baseline:
        if on_validation_progress is not None:
            on_validation_progress("trained-validation")
        _check_protected_use(_protected_use)
        trained = _measure_validation_loss(trainer, eval_dataset, "trained_validation",
            **({"_captured_evaluate":captured_evaluate} if captured_evaluate is not None else {}))
        _check_protected_use(_protected_use)
        if on_validation_progress is not None:
            on_validation_progress("comparison-complete")
        # These exact measured fields override similarly named supplier metrics.
        metrics.update(baseline_validation_loss=baseline, trained_validation_loss=trained,
                       validation_loss_delta=trained - baseline, validation_sample_count=float(sample_count))

    checkpoints = []
    if _protected_use is not None:
        history = _freeze_training_history(trainer.state.log_history)
        _check_protected_use(_protected_use)
        output = str(Path(_protected_use.payload.output["outputDirectory"]) / "checkpoints")
        checkpoints = [{"path":output, "step":step, "metric":"loss", "value":loss} for step,loss in history]
    else:
        for state in trainer.state.log_history:
            if "loss" in state and "step" in state:
                checkpoints.append({"path": str(args.output_dir), "step": int(state["step"]), "metric": "loss", "value": float(state["loss"])})
    _check_protected_use(_protected_use)
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
                **({"_protected_use":_protected_use} if _protected_use is not None else {}))
            if local_model_ref is not None else _load_transformers_objects(base_model_ref, payload.method, quantization)
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
        run_metadata_path = _write_run_metadata(
            output_path,
            {
                "runId": run_id,
                "method": payload.method,
                "trainingTask": training_task,
                "baseModel": payload.baseModel.model_dump(mode="json"),
                "datasets": [dataset_entry.model_dump(mode="json") for dataset_entry in payload.datasets],
                "startedAt": datetime.now(timezone.utc).isoformat(),
                "status": "failed" if validation_enabled and validation["status"] == "invalid" else "succeeded",
                "serializationManifestPath": manifest_path,
                **({"validationComparison": comparison} if comparison is not None else {}),
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
