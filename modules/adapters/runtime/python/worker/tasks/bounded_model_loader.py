"""Pinned native-Qwen2 loader for the explicit dataset-preparation profile.

This module does not import a model framework or perform I/O on import. Parameter
placement and cooperative ownership are not a kernel process-memory guarantee.
"""
from __future__ import annotations

from dataclasses import dataclass
import gc
import importlib.metadata
import importlib.util
import inspect
from pathlib import Path
import shutil
from typing import Any, Callable
import weakref

from .local_model_offload import (
    CPU_WEIGHT_LIMIT, CUDA_WEIGHT_LIMIT, MAX_INPUT_TOKENS, MAX_NEW_TOKENS,
    LocalModelInventory, OffloadAdmissionError, OffloadResourcePlan,
    ORDINARY_OFFLOAD, OwnedOffloadLease, inspect_local_model, plan_resources, validate_device_map, fit_cpu_residency,
)
from .offload_recovery import require_fresh_guarded_context, require_guarded_context


def offload_runtime_available() -> bool:
    try:
        return (importlib.metadata.version("transformers") == "4.51.3"
                and importlib.metadata.version("accelerate") == "1.14.0"
                and importlib.metadata.version("torch").split("+", 1)[0] == "2.6.0"
                and importlib.metadata.version("safetensors") == "0.5.2"
                and all(importlib.util.find_spec(name) is not None for name in ("torch", "safetensors")))
    except Exception:
        return False


def validate_offload_config(model_config: Any, generation_params: dict) -> None:
    if (model_config.memoryMode != "offload-v1" or model_config.provider != "transformers"
            or model_config.inferenceMode not in {"auto", "causal", "chat"}
            or model_config.device not in {"cpu", "cuda"}
            or model_config.torchDtype not in {"float32", "float16", "bfloat16"}
            or model_config.memoryOverflowPolicy != "none"
            or model_config.adapterModelId or model_config.adapterRevision):
        raise OffloadAdmissionError()
    maximum = generation_params.get("max_new_tokens")
    if type(maximum) is not int or not 0 < maximum <= MAX_NEW_TOKENS:
        raise OffloadAdmissionError()
    if set(generation_params).difference({"max_new_tokens", "temperature", "top_p"}):
        raise OffloadAdmissionError()


def validate_generation_limits(model: Any, input_ids: Any, generation_params: dict) -> None:
    shape = getattr(input_ids, "shape", ())
    if len(shape) != 2 or shape[0] != 1 or not 0 < shape[1] <= MAX_INPUT_TOKENS:
        raise OffloadAdmissionError()
    maximum = generation_params.get("max_new_tokens")
    if type(maximum) is not int or not 0 < maximum <= MAX_NEW_TOKENS:
        raise OffloadAdmissionError()
    config = getattr(model, "generation_config", None)
    if config is None:
        raise OffloadAdmissionError()
    for name in ("num_beams", "num_beam_groups", "num_return_sequences"):
        if getattr(config, name, 1) != 1 or type(getattr(config, name, 1)) is not int:
            raise OffloadAdmissionError()
    for name in ("output_attentions", "output_hidden_states", "output_scores", "output_logits", "return_dict_in_generate"):
        if getattr(config, name, False) not in (False, None):
            raise OffloadAdmissionError()
    if (getattr(config, "cache_implementation", None) not in (None, "dynamic")
            or getattr(config, "guidance_scale", None) not in (None, 1)
            or getattr(config, "penalty_alpha", None) is not None
            or getattr(config, "use_cache", True) is not True
            or getattr(config, "dola_layers", None) is not None
            or getattr(config, "prompt_lookup_num_tokens", None) is not None
            or getattr(config, "assistant_early_exit", None) is not None
            or getattr(config, "is_assistant", False) is not False
            or getattr(config, "token_healing", False) is not False):
        raise OffloadAdmissionError()
    try:
        # Pinned generate selects logits_to_keep=1 from this named capability.
        # Do not change decoding or budget full-prompt vocabulary logits.
        if "logits_to_keep" not in inspect.signature(model.forward).parameters:
            raise OffloadAdmissionError()
    except (TypeError, ValueError):
        raise OffloadAdmissionError() from None


def _planning_inputs(model: Any, inventory: LocalModelInventory, dtype_bytes: int):
    expected = model.state_dict()
    parameters = dict(model.named_parameters(remove_duplicate=False))
    aliases: dict[int, list[str]] = {}
    for name, parameter in parameters.items():
        aliases.setdefault(id(parameter), []).append(name)
    tied = tuple(tuple(names) for names in aliases.values() if len(names) > 1)
    incoming = {entry.name: entry for entry in inventory.tensors}
    if set(incoming).difference(expected):
        raise OffloadAdmissionError()
    for names in tied:
        canonical = "model.embed_tokens.weight" if "model.embed_tokens.weight" in names else names[0]
        if sum(name in incoming for name in names) != 1 or canonical not in incoming:
            raise OffloadAdmissionError()
    tied_lookup = {name: names for names in tied for name in names}
    sizes = {}
    for name, tensor in expected.items():
        choices = tied_lookup.get(name, (name,))
        entry = next((incoming[choice] for choice in choices if choice in incoming), None)
        if entry is None or tuple(tensor.shape) != entry.shape or entry.dtype not in {"F32", "F16", "BF16"}:
            raise OffloadAdmissionError()
        sizes[name] = entry.elements * dtype_bytes
    unsplit = []
    layer_sizes = []
    for name, module in model.named_modules():
        if type(module).__name__ == "Qwen2DecoderLayer" or not list(module.children()):
            names = tuple(key for key in sizes if not name or key.startswith(name + "."))
            if names:
                unsplit.append(names)
                layer_sizes.append(sum(sizes[key] for key in names))
    if not layer_sizes or getattr(model, "_keep_in_fp32_modules", None):
        raise OffloadAdmissionError()
    return sizes, tied, tuple(unsplit), max(layer_sizes)


def _nonpersistent_buffer_modules(model: Any, sizes: dict) -> tuple[str, ...]:
    buffers = [(name, value) for name, value in model.named_buffers() if name not in sizes]
    if sum(value.numel() * value.element_size() for name, value in buffers) > 1024**2:
        raise OffloadAdmissionError()
    return tuple(sorted({name.rsplit(".", 1)[0] for name, value in buffers}))


def _bind_safe_disk_aliases(loaded: tuple, inventory: LocalModelInventory, *,
                            tied_groups: tuple, device_map: dict, dtype: str) -> tuple:
    """Pinned supplier seam before dispatch: bind absent tied names to safe bytes.

    Accelerate's disk reader looks up a tensor name before considering pointer
    ties. The index therefore needs a verified alias for an omitted tied head.
    No weights are copied or materialized by this operation.
    """
    if not isinstance(loaded, tuple) or len(loaded) != 6:
        raise OffloadAdmissionError()
    incoming = {entry.name: entry for entry in inventory.tensors}
    def destination(name):
        covering = [key for key in device_map if not key or name == key or name.startswith(key + ".")]
        if not covering:
            raise OffloadAdmissionError()
        return device_map[max(covering, key=len)]
    expected = {name for name in incoming if destination(name) == "disk"}
    index = loaded[4]
    if index is None and not expected:
        return loaded
    if type(index) is not dict:
        raise OffloadAdmissionError()
    if set(index) != expected:
        raise OffloadAdmissionError()
    bound = {}
    for name, value in index.items():
        entry = incoming[name]
        if (type(value) is not dict or set(value) != {"safetensors_file", "weight_name", "dtype"}
                or not isinstance(value["safetensors_file"], str)
                or Path(value["safetensors_file"]) != inventory.root / entry.shard
                or value["weight_name"] != name or value["dtype"] != dtype):
            raise OffloadAdmissionError()
        bound[name] = dict(value)
    for group in tied_groups:
        if destination(group[0]) != "disk":
            continue
        sources = [name for name in group if name in incoming]
        # This initial native-Qwen2 profile only supports the canonical tied
        # input embedding source. A separately serialized head may contain
        # different bytes and cannot silently replace that canonical source.
        if (set(group) != {"model.embed_tokens.weight", "lm_head.weight"}
                or sources != ["model.embed_tokens.weight"]):
            raise OffloadAdmissionError()
        source = bound[sources[0]]
        for name in group:
            if destination(name) != "disk":
                raise OffloadAdmissionError()
            if name not in incoming:
                bound[name] = dict(source)
    return (*loaded[:4], bound, loaded[5])


def _bind_dispatch_ties(model: Any, tied_groups: tuple) -> None:
    """Remove the pinned dispatcher's meta-pointer sentinel before first use.

    Every meta tensor has data_ptr()==0. Treating that sentinel as a real tied
    allocation can reuse embedding storage for an unrelated disk-backed norm.
    Preserve real pointers and only retain the admitted tied-name metadata.
    """
    candidates = [(prefix, getattr(module, "_hf_hook", None)) for prefix, module in model.named_modules()]
    candidates = [(prefix, hook) for prefix, hook in candidates if hook is not None]
    if not candidates:
        if "disk" in model.hf_device_map.values():
            raise OffloadAdmissionError()
        return
    from accelerate.hooks import AlignDevicesHook, SequentialHook
    tied_names = {name for group in tied_groups for name in group}
    hooks = []
    maps = {}
    def inspect_hook(hook, prefix):
        if type(hook) is SequentialHook:
            for child in hook.hooks:
                inspect_hook(child, prefix)
        elif type(hook) is AlignDevicesHook:
            mapping = hook.tied_params_map
            if (mapping is not None and (type(mapping) is not dict
                    or (0 in mapping and mapping[0] != {}))) or type(hook.tied_params_names) is not set:
                raise OffloadAdmissionError()
            if mapping is not None:
                maps[id(mapping)] = mapping
            if any(not isinstance(name, str) for name in hook.tied_params_names):
                raise OffloadAdmissionError()
            hooks.append((hook, {name for name in hook.tied_params_names
                                if (prefix + "." + name if prefix else name) in tied_names}))
        else:
            raise OffloadAdmissionError()
    for prefix, hook in candidates:
        inspect_hook(hook, prefix)
    for mapping in maps.values():
        mapping.pop(0, None)
    for hook, names in hooks:
        hook.tied_params_names = names


def _validate_loaded_parameters(model: Any, shapes: dict, dtype: str) -> None:
    parameters = dict(model.named_parameters(remove_duplicate=False))
    if set(parameters) != set(shapes):
        raise OffloadAdmissionError()
    for name, parameter in parameters.items():
        if tuple(parameter.shape) != shapes[name] or str(parameter.dtype) != "torch." + dtype:
            raise OffloadAdmissionError()


@dataclass(repr=False)
class BoundedModelBundle:
    model: Any
    tokenizer: Any
    inference_mode: str
    inventory: LocalModelInventory
    lease: OwnedOffloadLease
    resources: OffloadResourcePlan
    model_references: list


# Failed/uncertain model references retain the exclusive slot. Unload retries
# only after references are actually gone; an ambient stale slot is never adopted.
_RETAINED_LEASES: list[tuple[OwnedOffloadLease, list]] = []


def release_offload_lease(lease: OwnedOffloadLease, references: list) -> None:
    gc.collect()
    if any(reference() is not None for reference in references):
        if not any(existing is lease for existing, _references in _RETAINED_LEASES):
            _RETAINED_LEASES.append((lease, references))
        raise OffloadAdmissionError()
    try:
        lease.seal()
        lease.cleanup(model_released=True)
    except OffloadAdmissionError:
        if not any(existing is lease for existing, _references in _RETAINED_LEASES):
            _RETAINED_LEASES.append((lease, references))
        raise
    _RETAINED_LEASES[:] = [(existing, refs) for existing, refs in _RETAINED_LEASES if existing is not lease]


def retry_retained_offload_cleanup() -> None:
    for lease, references in list(_RETAINED_LEASES):
        release_offload_lease(lease, references)


def load_bounded_local_model(
    model_config: Any,
    generation_params: dict,
    *,
    reference: Path,
    cache_root: Path,
    read_memory: Callable,
    read_cuda_memory: Callable,
    _recovery=ORDINARY_OFFLOAD,
) -> BoundedModelBundle:
    arguments = dict(reference=reference, cache_root=cache_root, read_memory=read_memory,
                     read_cuda_memory=read_cuda_memory, _recovery=_recovery)
    if _recovery is ORDINARY_OFFLOAD:
        return _load_bounded_local_model(model_config, generation_params, **arguments)
    context = require_fresh_guarded_context(_recovery)
    try:
        return _load_bounded_local_model(model_config, generation_params, **arguments)
    except BaseException:
        context.retain_failure()
        raise


def _load_bounded_local_model(
    model_config: Any,
    generation_params: dict,
    *,
    reference: Path,
    cache_root: Path,
    read_memory: Callable,
    read_cuda_memory: Callable,
    _recovery=ORDINARY_OFFLOAD,
) -> BoundedModelBundle:
    if _recovery is not ORDINARY_OFFLOAD:
        require_guarded_context(_recovery)
    validate_offload_config(model_config, generation_params)
    if not offload_runtime_available() or _RETAINED_LEASES:
        raise OffloadAdmissionError()
    inventory = inspect_local_model(reference)
    import torch
    from accelerate import init_empty_weights, infer_auto_device_map
    from transformers import Qwen2TokenizerFast, Qwen2Config, Qwen2ForCausalLM

    dtype = {"float32": torch.float32, "float16": torch.float16, "bfloat16": torch.bfloat16}[model_config.torchDtype]
    dtype_bytes = 4 if model_config.torchDtype == "float32" else 2
    if model_config.device == "cuda" and not torch.cuda.is_available():
        raise OffloadAdmissionError()
    native_config = Qwen2Config.from_dict(inventory.config)
    with init_empty_weights(include_buffers=False):
        skeleton = Qwen2ForCausalLM(native_config)
    skeleton.tie_weights()
    sizes, tied, unsplit, largest = _planning_inputs(skeleton, inventory, dtype_bytes)
    shapes = {name: tuple(value.shape) for name, value in skeleton.named_parameters(remove_duplicate=False)}
    buffer_modules = _nonpersistent_buffer_modules(skeleton, sizes)
    max_memory = {"cpu": CPU_WEIGHT_LIMIT}
    if model_config.device == "cuda":
        max_memory[0] = CUDA_WEIGHT_LIMIT
    device_map = infer_auto_device_map(skeleton, max_memory=max_memory, dtype=dtype,
                                      no_split_module_classes=["Qwen2DecoderLayer"],
                                      offload_buffers=False, fallback_allocation=False)
    cpu_bytes, cuda_bytes = validate_device_map(device_map, sizes, device=model_config.device, tied_groups=tied, unsplit_groups=unsplit, nonpersistent_buffer_modules=buffer_modules)
    del skeleton
    gc.collect()
    memory = read_memory()
    if memory is None:
        raise OffloadAdmissionError()
    # A safe-weight index stores names/paths, not copied tensor data. Bound its
    # worst-case serialized entries before the supplier can write anything.
    reservation = max(64 * 1024, sum(len(name.encode("utf-8")) + len(str(reference).encode("utf-8")) + 2048 for name in sizes))
    def resource_plan(cpu_weight_bytes):
        return plan_resources(inventory.config, dtype_bytes=dtype_bytes, device=model_config.device,
                               cpu_weight_bytes=cpu_weight_bytes, cuda_weight_bytes=cuda_bytes, largest_layer_bytes=largest,
                               largest_source_tensor_bytes=max(entry.elements * (4 if entry.dtype == "F32" else 2) for entry in inventory.tensors),
                               largest_target_tensor_bytes=max(sizes.values()),
                               largest_conversion_source_bytes=max((entry.elements * (4 if entry.dtype == "F32" else 2)
                                   for entry in inventory.tensors if entry.dtype != {"float32": "F32", "float16": "F16", "bfloat16": "BF16"}[model_config.torchDtype]), default=0),
                               available_cpu_bytes=memory.available_bytes,
                               available_cuda_bytes=read_cuda_memory() if model_config.device == "cuda" else 0,
                               available_disk_bytes=shutil.disk_usage(cache_root).free,
                               staging_reservation_bytes=reservation)
    # Weight limits are ceilings. Reserve the unchanged execution/loading costs
    # first, then reduce whole CPU-resident placements if current free RAM needs
    # more disk backing. This does not retry on a resource failure or change the
    # selected execution device, dtype, decoder, profile or any reserve.
    minimum = resource_plan(0)
    resident_limit = min(CPU_WEIGHT_LIMIT, memory.available_bytes - minimum.cpu_required_bytes)
    if cpu_bytes > resident_limit:
        device_map = fit_cpu_residency(device_map, sizes, maximum_bytes=resident_limit,
                                      tied_groups=tied, unsplit_groups=unsplit)
        cpu_bytes, cuda_bytes = validate_device_map(device_map, sizes, device=model_config.device,
            tied_groups=tied, unsplit_groups=unsplit, nonpersistent_buffer_modules=buffer_modules)
    resources = resource_plan(cpu_bytes)
    inventory.verify_unchanged()
    lease = (OwnedOffloadLease(cache_root, reservation) if _recovery is ORDINARY_OFFLOAD
             else OwnedOffloadLease(cache_root, reservation, _recovery=_recovery))
    references = []

    class TrackedQwen2ForCausalLM(Qwen2ForCausalLM):
        def __init__(self, config):
            # Observe even partially constructed instances without retaining them.
            references.append(weakref.ref(self))
            super().__init__(config)

        @classmethod
        def _load_pretrained_model(cls, *args, **kwargs):
            loaded = super()._load_pretrained_model(*args, **kwargs)
            return _bind_safe_disk_aliases(loaded, inventory, tied_groups=tied,
                                          device_map=device_map, dtype=model_config.torchDtype)

    def construct():
        try:
            tokenizer = Qwen2TokenizerFast.from_pretrained(
                str(reference), local_files_only=True, trust_remote_code=False,
                tokenizer_file=str(reference / "tokenizer.json"),
                vocab_file=str(reference / "vocab.json") if "vocab.json" in inventory.directory_names else None,
                merges_file=str(reference / "merges.txt") if "merges.txt" in inventory.directory_names else None,
            )
            model, information = TrackedQwen2ForCausalLM.from_pretrained(
                str(reference), config=native_config, local_files_only=True,
                trust_remote_code=False, use_safetensors=True, weights_only=True,
                torch_dtype=dtype, low_cpu_mem_usage=True, device_map=device_map,
                offload_folder=str(lease.path), offload_state_dict=False,
                offload_buffers=False, output_loading_info=True, ignore_mismatched_sizes=False,
            )
            permitted_missing = {name for group in tied for name in group if name not in {entry.name for entry in inventory.tensors}}
            if (set(information.get("missing_keys", ())).difference(permitted_missing)
                    or information.get("unexpected_keys") or information.get("mismatched_keys") or information.get("error_msgs")):
                raise OffloadAdmissionError()
            if model.hf_device_map != device_map:
                raise OffloadAdmissionError()
            validate_device_map(model.hf_device_map, sizes, device=model_config.device, tied_groups=tied, unsplit_groups=unsplit, nonpersistent_buffer_modules=buffer_modules)
            _bind_dispatch_ties(model, tied)
            _validate_loaded_parameters(model, shapes, model_config.torchDtype)
            inventory.verify_unchanged()
            if getattr(tokenizer, "pad_token_id", None) is None:
                tokenizer.pad_token_id = getattr(tokenizer, "eos_token_id", None)
            inference = model_config.inferenceMode
            if inference == "auto":
                inference = "chat" if isinstance(getattr(tokenizer, "chat_template", None), str) and tokenizer.chat_template.strip() else "causal"
            lease.seal()
            return model, tokenizer, inference
        except Exception as error:
            # Never retain a supplier traceback that owns a partially loaded
            # model. Do not run hooks, .to/.cpu or state_dict during teardown.
            seen = set()
            current = error
            while current is not None and id(current) not in seen:
                seen.add(id(current))
                following = current.__cause__ or current.__context__
                current.__traceback__ = None
                current.__cause__ = None
                current.__context__ = None
                current = following
            return None

    result = construct()
    if result is None:
        release_offload_lease(lease, references)
        raise OffloadAdmissionError()
    model, tokenizer, inference = result
    return BoundedModelBundle(model, tokenizer, inference, inventory, lease, resources, references)
