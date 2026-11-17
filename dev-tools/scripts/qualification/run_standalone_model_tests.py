"""Offline current-runtime diagnostics, runnable without the coding agent.

These are measurements of an exposed synthetic corpus, not roadmap qualification.
No downloads, offload leases, baseline substitution, or acceptance-policy changes.
"""
from __future__ import annotations

import argparse
from contextlib import redirect_stderr, redirect_stdout
from datetime import datetime, timezone
import gc
import hashlib
import importlib.metadata
import json
import math
import os
from pathlib import Path
import re
import socket
import stat
import subprocess
import sys
import time
import types
import uuid

SCRIPT = Path(__file__).resolve()
ROOT = SCRIPT.parents[3]
sys.path.insert(0, str(SCRIPT.parent))
sys.path.insert(0, str(ROOT))
import run_installed_generation_qualification as original
import run_trained_context_qualification as owned
from model_qualification_lock import QualificationBusy, slot

OUTPUT = ".local-codex/standalone-model-tests"
PACKAGES = ("torch", "transformers", "accelerate", "safetensors", "pydantic")
CORPUS_SHA256 = "8c017723bd8d44bff52f4d5ad8a66cc76eacd5dcbdce7b0097a3d294a7d4039b"


def now():
    return datetime.now(timezone.utc).isoformat()


def safe_directory(path, *, create=False):
    # Admit every ancestor before creating anything beneath it; refuse redirects.
    for item in [*reversed(path.absolute().parents), path.absolute()]:
        try:
            facts = item.lstat()
        except FileNotFoundError:
            if not create:
                raise
            item.mkdir(exist_ok=False)
            facts = item.lstat()
        if not stat.S_ISDIR(facts.st_mode) or getattr(facts, "st_file_attributes", 0) & 0x400:
            raise ValueError("Unsafe evidence directory.")
    return path


def save(folder, name, value):
    if not re.fullmatch(r"[a-z0-9-]+\.json", name):
        raise ValueError("Invalid evidence name.")
    safe_directory(folder)
    target = folder / name
    if target.exists() or target.is_symlink():
        facts = target.lstat()
        if not stat.S_ISREG(facts.st_mode) or getattr(facts, "st_file_attributes", 0) & 0x400:
            raise ValueError("Unsafe evidence file.")
    content = json.dumps(value, indent=2, allow_nan=False) + "\n"
    if len(content.encode()) > 2 * 1024**2:
        raise ValueError("Evidence exceeded its bound.")
    temporary = folder / ("pending-" + uuid.uuid4().hex + ".json")
    with temporary.open("x", encoding="utf-8") as stream:
        stream.write(content)
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temporary, target)


def bindings():
    corpus = SCRIPT.with_name("installed_generation_holdout.json")
    if owned.sha256_file(corpus) != CORPUS_SHA256:
        raise ValueError("Diagnostic corpus changed.")
    observed = subprocess.run(["node", "--input-type=module", "-e", "import {readAssetSystemSourceIdentity} from './dev-tools/scripts/qualification/asset-system-source-identity.mjs'; console.log(await readAssetSystemSourceIdentity(process.cwd()));"],
                              cwd=ROOT, capture_output=True, text=True, timeout=30)
    source = observed.stdout.strip()
    if observed.returncode or not re.fullmatch(r"source\.[a-f0-9]{64}", source):
        raise ValueError("Source identity unavailable.")
    return {"source": source, "operator_sha256": owned.sha256_file(SCRIPT),
            "corpus_sha256": CORPUS_SHA256,
            "supervisor_sha256": owned.sha256_file(Path(owned.__file__)),
            "qualification_lock_sha256": owned.sha256_file(SCRIPT.with_name("model_qualification_lock.py")),
            "model_verifier_sha256": owned.sha256_file(Path(original.__file__))}


def find_manifest(profile):
    original.configure_model_profile(profile)
    base = ROOT / ".local-codex/model-qualification"
    safe_directory(base)
    found = []
    for directory in base.iterdir():
        if re.fullmatch(re.escape(original.MODEL_CACHE_PREFIX) + r"-[a-f0-9-]{36}", directory.name):
            relative = (directory / "acquisition.json").relative_to(ROOT).as_posix()
            # Fully hash weights even when discovering; never choose by mtime.
            original.verified_model(relative)
            found.append(relative)
    if len(found) != 1:
        raise ValueError("Exactly one verified cached acquisition is required.")
    return found[0]


def make_plan(args):
    if len(set(args.devices)) != len(args.devices) or len(set(args.modes)) != len(args.modes):
        raise ValueError("Duplicate cohort selection.")
    manifest = args.model_manifest or find_manifest(args.model_profile)
    original.configure_model_profile(args.model_profile)
    original.verified_model(manifest)
    return {"schema_version": "standalone-model-plan-v1", "created_at": now(),
            "bindings": bindings(), "model_profile": args.model_profile,
            "model": original.MODEL, "revision": original.REVISION, "precision": original.MODEL_PRECISION,
            "manifest": manifest, "memory_mode": "standard", "overflow_policy": "none",
            "devices": args.devices, "modes": args.modes, "repeats": args.repeats,
            "corpus_cases_per_phase": 24, "cases_per_phase": args.case_limit, "phases": ["first", "warm"],
            "diagnostic_case_limit": args.case_limit,
            "case_selection": "first-n-exposed-corpus-in-original-order",
            "cooperative_stop_seconds": 1080, "cleanup_reserve_seconds": 120,
            "deadline_seconds_per_cohort": 1200, "rss_safety_ceiling_bytes": 4 * 1024**3,
            "qualification_complete": False, "purpose": "current-runtime-diagnostics-exposed-corpus"}


class SafeRuntimeSink:
    """Retain only finite resource events, never prompts, raw output or errors."""
    def __init__(self, report):
        self.report, self.buffer, self.total = report, "", 0

    def write(self, value):
        self.total += len(value.encode("utf-8", errors="replace"))
        if self.total > 1024**2:
            self.report["diagnostic_overflow"] = True
            return len(value)
        self.buffer += value
        if len(self.buffer) > 8192:
            self.buffer = ""
            return len(value)
        while "\n" in self.buffer:
            line, self.buffer = self.buffer.split("\n", 1)
            try:
                row = json.loads(line)
                event = row.get("event")
                if event not in {"runtime.generation_model.resources_insufficient", "runtime.generation_model.forward_resources_insufficient"}:
                    continue
                fields = ("availableMemoryBytes", "requiredMemoryBytes", "availableAcceleratorMemoryBytes", "requiredAcceleratorMemoryBytes")
                clean = {key: row[key] for key in fields if key in row and (row[key] is None or type(row[key]) is int and 0 <= row[key] < 2**63)}
                events = self.report.setdefault("resource_events", [])
                if len(events) < 64:
                    events.append({"event": event, **clean})
            except (ValueError, AttributeError, TypeError):
                pass
        return len(value)

    def flush(self):
        pass


def failure(error):
    # Do not persist arbitrary exception strings, paths, tracebacks or payloads.
    allowed = {"ValueError", "RuntimeError", "OSError", "FileNotFoundError", "TimeoutExpired",
               "PermissionError", "MemoryError", "OutOfMemoryError", "EOFError", "BrokenPipeError",
               "JSONDecodeError", "TypeError", "KeyError", "IndexError", "UnicodeDecodeError",
               "GenerationInsufficientResourcesError", "GenerationModelLoadError", "GenerationRuntimeDependencyError",
               "ConstrainedJsonDecoderError", "GenerationOutputValidationError", "KeyboardInterrupt"}
    name = type(error).__name__
    return name if name in allowed else "DiagnosticFailure"


def failure_log(error, stage):
    """Bounded source locations only: never exception text, locals or full paths."""
    if stage not in {'runtime-initialization','model-load','generation','output-validation','case-contract','measurement','cleanup',
                     'operator-planning','operator-admission','operator-execution'}:
        raise ValueError('Unknown failure stage.')
    frames = []
    trace = error.__traceback__
    while trace is not None:
        code = trace.tb_frame.f_code
        try:
            relative = Path(code.co_filename).relative_to(ROOT).as_posix()
        except ValueError:
            relative = ''
        if (relative.startswith(('dev-tools/scripts/qualification/', 'modules/adapters/runtime/python/worker/'))
                and re.fullmatch(r'[a-zA-Z0-9_./-]+\.py', relative)
                and '..' not in Path(relative).parts
                and re.fullmatch(r'[a-zA-Z_][a-zA-Z0-9_]{0,79}', code.co_name)
                and 0 < trace.tb_lineno < 1_000_000):
            frames.append({'file':relative,'function':code.co_name,'line':trace.tb_lineno})
        trace = trace.tb_next
    causes, seen = [], {id(error)}
    cause = error.__cause__ or error.__context__
    while cause is not None and id(cause) not in seen and len(causes) < 4:
        seen.add(id(cause)); causes.append(failure(cause))
        cause = cause.__cause__ or cause.__context__
    return {'stage':stage,'error_type':failure(error),'source_frames':frames[-8:], 'cause_types':causes}


def production():
    generation, runtime = original.modules_for("candidate", ROOT)
    from modules.adapters.runtime.python.worker.models import ExampleGenerationConfig
    from modules.adapters.runtime.python.worker.tasks.markdown_chunking import MarkdownChunk
    from modules.adapters.runtime.python.worker.tasks.structured_output_runtime import RuntimeStructuredOutput
    from modules.adapters.runtime.python.worker.tasks import bounded_model_loader
    return generation, runtime, ExampleGenerationConfig, MarkdownChunk, RuntimeStructuredOutput, bounded_model_loader


def cleanup_snapshot(runtime, loader, allocated, reserved, allocated_floor, reserved_floor):
    values = (allocated, reserved, allocated_floor, reserved_floor)
    if any(type(value) is not int or value < 0 for value in values) or allocated > reserved or allocated_floor > reserved_floor:
        raise ValueError("Invalid cleanup observations.")
    cache_empty, leases_empty = not runtime._GENERATOR_CACHE, not loader._RETAINED_LEASES
    return {"runtime_allocated_vram_floor_bytes": allocated_floor, "runtime_reserved_vram_floor_bytes": reserved_floor,
            "remaining_allocated_vram_bytes": allocated, "remaining_reserved_vram_bytes": reserved,
            "generator_cache_empty": cache_empty, "retained_leases_empty": leases_empty,
            "cleanup_passed": cache_empty and leases_empty and allocated <= allocated_floor and reserved <= reserved_floor}


def phase_progress(phases, expected=24):
    """Finite partial observations, never a denominator-adjusted quality pass."""
    result = {}
    for name in ("first", "warm"):
        cases = phases.get(name, {}).get("cases", [])
        if not isinstance(cases, list) or len(cases) > expected:
            raise ValueError("Invalid diagnostic progress.")
        if any(not isinstance(row, dict) or type(row.get("seconds")) not in (int, float)
               or not math.isfinite(row["seconds"]) or not 0 <= row["seconds"] <= 1200 for row in cases):
            raise ValueError("Invalid diagnostic duration.")
        result[name] = {"recorded_cases": len(cases), "expected_cases": expected,
            "complete": len(cases) == expected,
            "correct": sum(row.get("correct") is True for row in cases),
            "accepted": sum(row.get("accepted") is True for row in cases),
            "case_seconds": sum(row["seconds"] for row in cases)}
    return result


def stop_before_case(started, durations, *, clock=time.perf_counter, cutoff_seconds=1080):
    # Advisory scheduling only. A slow first case can still hit the unchanged
    # native watchdog. Never claim a graceful stop until unload and exit occur.
    reserve = max(durations, default=0) * 1.5
    if type(cutoff_seconds) is not int or cutoff_seconds not in (1080, 2160):
        raise ValueError("Unsupported cooperative stop window.")
    return clock() - started + reserve >= cutoff_seconds


class GenerationObservation:
    """Child-local numeric observations; no token IDs, text or sampling changes.

    Forward timings on CUDA are host dispatch timings, not kernel durations.
    Only the complete generate call synchronizes CUDA at its boundaries.
    """
    def __init__(self, generator, sync, device):
        self.generator, self.model, self.sync = generator, generator._model, sync
        self.device, self.current, self.forward_started = device, None, None
        self.handles, self.original = [], self.model.generate
        try:
            self.handles.append(self.model.register_forward_pre_hook(self.before_forward))
            self.handles.append(self.model.register_forward_hook(self.after_forward))
            self.model.generate = self.generate
        except BaseException:
            self.close()
            raise

    def begin(self):
        self.current = {"forward_calls": 0, "first_forward_seconds": 0,
            "subsequent_forward_seconds": 0,
            "forward_timing_kind": "cpu-wall" if self.device == "cpu" else "cuda-host-dispatch"}
        self.attempt_started = time.perf_counter()
        self.forward_started = None

    def before_forward(self, _model, _inputs):
        if self.current is not None:
            self.forward_started = time.perf_counter()

    def after_forward(self, _model, _inputs, _output):
        if self.current is not None and self.forward_started is not None:
            key = "first_forward_seconds" if not self.current["forward_calls"] else "subsequent_forward_seconds"
            self.current[key] += time.perf_counter() - self.forward_started
            self.current["forward_calls"] += 1
            self.forward_started = None

    def generate(self, *args, **kwargs):
        if self.current is None:
            raise ValueError("Missing diagnostic attempt.")
        ids = kwargs.get("input_ids")
        if ids is None or len(ids.shape) != 2 or ids.shape[0] != 1:
            raise ValueError("Unexpected diagnostic batch.")
        self.current["input_tokens"] = int(ids.shape[-1])
        self.sync()
        tick = time.perf_counter()
        self.current["preparation_seconds"] = tick - self.attempt_started
        try:
            output = self.original(*args, **kwargs)
            self.sync()
            # Constrained generation requests a supplier ModelOutput; ordinary
            # generation returns a Tensor. Observe sequences, return the exact
            # original object and leave the decoder's contract unchanged.
            sequences = getattr(output, "sequences", None)
            if sequences is None:
                sequences = output.get("sequences") if isinstance(output, dict) else output
            generated = int(sequences.shape[-1]) - self.current["input_tokens"]
            limit = kwargs.get("max_new_tokens")
            if type(limit) is not int or not 0 <= generated <= limit:
                raise ValueError("Unexpected diagnostic output size.")
            eos = kwargs.get("eos_token_id", self.model.generation_config.eos_token_id)
            eos = [eos] if type(eos) is int else eos
            last = int(sequences[0, -1].item()) if generated else None
            self.current.update(generated_tokens=generated, output_token_limit=limit,
                termination="eos" if eos and last in eos else "max-output" if generated == limit else "other")
            return output
        finally:
            self.sync()
            self.current["generate_seconds"] = time.perf_counter() - tick

    def close(self):
        self.model.generate = self.original
        for handle in self.handles:
            handle.remove()
        self.handles.clear()
        self.current = None


def classification_outcome(examples, labels, expected):
    """Score the product return, including invalid acceptance, without retaining it.

    An invalid historical return is a quality failure, not a worker failure.
    Never normalize it into a rejection or serialize unknown labels/fields.
    """
    if not isinstance(examples, list) or len(examples) > 1:
        raise ValueError("Unbounded result.")
    if not examples:
        return {"accepted": False, "correct": False, "invalid_accepted": False, "status": "wrong-or-rejected"}
    fields = examples[0].structured_fields
    label = fields.get("label") if type(fields) is dict else None
    valid = type(label) is str and label in labels and fields == {"label": label}
    if not valid:
        return {"accepted": True, "correct": False, "invalid_accepted": True, "status": "invalid-accepted"}
    return {"accepted": True, "correct": label == expected, "invalid_accepted": False,
            "predicted_label": label, "status": "correct" if label == expected else "wrong-or-rejected"}


def measure(args, folder, plan):
    report = {"schema_version": "standalone-model-cohort-v1", "status": "running", "started_at": now(),
              "device": args.device, "mode": args.profile, "replicate": args.count,
              "model_profile": plan["model_profile"], "bindings": plan["bindings"],
              "model": plan["model"], "revision": plan["revision"], "precision": plan["precision"],
              "memory_mode": "standard", "phases": {}, "cleanup_passed": False,
              "qualification_complete": False}
    save(folder, "cohort.json", report)
    started = time.perf_counter()
    runtime = generator = torch = generation = original_generate = original_parse = hook = observer = None
    floor_allocated = floor_reserved = 0
    delivery_started = None
    failure_stage = 'runtime-initialization'
    devices, mismatches = set(), []
    sink = SafeRuntimeSink(report)
    def deny(*_args, **_kwargs):
        raise RuntimeError("Network and pickle disabled.")
    os.environ.update(HF_HUB_OFFLINE="1", TRANSFORMERS_OFFLINE="1", HF_HUB_DISABLE_TELEMETRY="1", TOKENIZERS_PARALLELISM="false")
    socket.socket.connect = deny
    socket.socket.connect_ex = deny
    socket.create_connection = deny
    with redirect_stdout(sink), redirect_stderr(sink):
      try:
        original.configure_model_profile(plan["model_profile"])
        model = original.verified_model(plan["manifest"])
        os.environ["HF_HUB_CACHE"] = str(model.parent)
        import torch
        torch.load = deny
        torch.set_num_threads(4)
        generation, runtime, ExampleGenerationConfig, MarkdownChunk, RuntimeStructuredOutput, loader = production()
        if runtime._GENERATOR_CACHE or loader._RETAINED_LEASES:
            raise ValueError("Unexpected model owner.")
        runtime._RESOLVED_MODEL_REFERENCES[plan["model"]] = str(model)
        corpus = original.heldout_plan()
        config = ExampleGenerationConfig.model_validate({"mode": "qa", "failurePolicy": "skip", "promptTemplate": corpus["prompt"],
            "model": {"provider": "transformers", "modelId": plan["model"], "inferenceMode": "chat", "device": args.device,
                      "torchDtype": plan["precision"], "memoryMode": "standard", "memoryOverflowPolicy": "none"},
            "generationParams": corpus["generation_params"]})
        recipe = {"labelSet": corpus["labels"]}
        schema = generation.build_task_structured_output_schema(corpus["task_type"], recipe)
        structured = RuntimeStructuredOutput(schema=schema, example=generation.build_task_structured_output_example(corpus["task_type"], recipe),
            schema_fingerprint=hashlib.sha256(json.dumps(schema, sort_keys=True).encode()).hexdigest(),
            payload_key="example", purpose_paths={"label": ("label",)}, constrained_decoding=args.profile == "constrained")
        report["schema_sha256"] = structured.schema_fingerprint
        def sync():
            if args.device == "cuda":
                torch.cuda.synchronize()
        if args.device == "cuda":
            if not torch.cuda.is_available():
                report["status"] = "unavailable-device"
                return
            matrix = torch.zeros((16, 16), device="cuda")
            product = matrix @ matrix
            sync()
            del matrix, product
            torch.cuda.empty_cache()
            floor_allocated, floor_reserved = torch.cuda.memory_allocated(), torch.cuda.memory_reserved()
            torch.cuda.reset_peak_memory_stats()
        report["runtime_vram_floor_observed"] = True
        report["environment"] = {"python": sys.version.split()[0], "platform": sys.platform,
            "packages": {name: importlib.metadata.version(name) for name in PACKAGES},
            "cuda_runtime": torch.version.cuda,
            "accelerator": torch.cuda.get_device_name() if args.device == "cuda" else None}
        report["runtime_initialization_seconds"] = time.perf_counter() - started
        save(folder, "cohort.json", report)
        delivery_started = tick = time.perf_counter()
        failure_stage = 'model-load'
        generator = runtime.get_or_create_local_text_generator(config)
        sync()
        report["load_seconds"] = time.perf_counter() - tick
        if type(generator) is not runtime.TransformersChatGenerator or loader._RETAINED_LEASES:
            raise ValueError("Unexpected generator/offload mode.")
        effective = generator._model.generation_config.to_dict() | generator._generation_params
        if any(effective.get(key) != value for key, value in corpus["effective_sampling"].items()) or str(generator._model.dtype) != "torch." + plan["precision"]:
            raise ValueError("Effective settings differ.")
        report["effective_sampling"] = corpus["effective_sampling"]
        report["actual_precision"] = str(generator._model.dtype)
        report["effective_runtime"] = {"threads": torch.get_num_threads(),
            "use_cache": effective.get("use_cache") if type(effective.get("use_cache")) is bool else None,
            "attention": getattr(generator._model.config, "_attn_implementation", None)
                if getattr(generator._model.config, "_attn_implementation", None) in {"eager", "sdpa", "flash_attention_2", "flex_attention"} else "unreported"}
        observer = GenerationObservation(generator, sync, args.device)
        original_generate, original_parse = generator.generate_text, generation._parse_task_structured_output
        current = {}
        def observe_generate(*a, **kw):
            current["attempts"] += 1
            observer.begin()
            try:
                return original_generate(*a, **kw)
            except generation.ConstrainedJsonDecoderError as error:
                current["invalid_attempts" if original.decoder_failure_kind(error.code) == "invalid-output" else "operational_errors"] += 1
                raise
            except Exception as error:
                current["operational_errors"] += 1
                current['failure_log'] = failure_log(error, 'generation')
                raise
            finally:
                attempts = current.setdefault("generation_observations", [])
                if len(attempts) >= 8:
                    raise ValueError("Diagnostic attempt bound exceeded.")
                attempts.append(observer.current)
                observer.current = None
        def observe_parse(*a, **kw):
            try:
                return original_parse(*a, **kw)
            except ValueError as error:
                current["invalid_attempts"] += 1
                failures = current.setdefault('validation_failures', [])
                if len(failures) < 2: failures.append(failure_log(error, 'output-validation'))
                raise
        def placement(layer, inputs):
            if isinstance(layer, torch.nn.Embedding) and inputs and hasattr(inputs[0], "device"):
                devices.add(str(inputs[0].device))
                if layer.weight.device != inputs[0].device:
                    mismatches.append(True)
        hook = generator._model.get_input_embeddings().register_forward_pre_hook(placement)
        generator.generate_text, generation._parse_task_structured_output = observe_generate, observe_parse
        case_limit = plan.get("diagnostic_case_limit", 24)
        durations, budget_stopped = [], False
        for phase in ("first", "warm"):
            tick = time.perf_counter()
            result = {"cases": []}
            report["phases"][phase] = result
            for index, row in enumerate(corpus["heldout"][:case_limit]):
                if stop_before_case(started, durations, cutoff_seconds=plan.get("cooperative_stop_seconds_by_device", {}).get(args.device, 1080)):
                    budget_stopped = True
                    break
                torch.manual_seed(17 + index)
                sync()
                current = {"id": row["id"], "attempts": 0, "invalid_attempts": 0, "operational_errors": 0,
                           "repairs": 0, "correct": False, "accepted": False, "status": "running"}
                def repaired(_event):
                    current["repairs"] += 1
                case_started = time.perf_counter()
                try:
                    failure_stage = 'generation'
                    examples = generation.generate_task_examples_for_chunks([MarkdownChunk("synthetic-diagnostic", index, row["text"])], config,
                        corpus["task_type"], recipe, structured_output=structured, on_output_repair=repaired)
                    failure_stage = 'case-contract'
                    current.update(classification_outcome(examples, corpus["labels"], row["label"]))
                    del examples
                except (generation.GenerationOutputValidationError, generation.ConstrainedJsonDecoderError) as error:
                    current["status"] = "rejected"
                    current["error_type"] = failure(error)
                    current['failure_log'] = failure_log(error, 'output-validation')
                    if current["operational_errors"]:
                        raise
                finally:
                    sync()
                    current["seconds"] = time.perf_counter() - case_started
                    durations.append(current["seconds"])
                    result["cases"].append(current)
                    report["progress"] = phase_progress(report["phases"], case_limit)
                    save(folder, "cohort.json", report)
            result.update(original.phase_counts(result["cases"]))
            result["correct"] = sum(row["correct"] for row in result["cases"])
            result["invalid_accepted"] = sum(row.get("invalid_accepted") is True for row in result["cases"])
            result["seconds"] = time.perf_counter() - tick
            result["accuracy"] = result["correct"] / case_limit if not budget_stopped else None
            result["correct_per_minute"] = result["correct"] * 60 / result["seconds"]
            report["progress"] = phase_progress(report["phases"], case_limit)
            if budget_stopped:
                break
        report["actual_tensor_devices"] = sorted(devices)
        report["placement_observed"] = bool(devices)
        report["tensor_placement_mismatch_count"] = len(mismatches)
        if (durations or not budget_stopped) and (devices != {"cuda:0" if args.device == "cuda" else "cpu"} or mismatches):
            raise ValueError("Tensor placement differs.")
        report["peak_allocated_vram_bytes"] = torch.cuda.max_memory_allocated() if args.device == "cuda" else 0
        report["peak_reserved_vram_bytes"] = torch.cuda.max_memory_reserved() if args.device == "cuda" else 0
        report["status"] = "incomplete-budget-stop" if budget_stopped else "measured"
      except Exception as error:
        report.update(status="denied-memory" if type(error).__name__ == "GenerationInsufficientResourcesError" else "failed", error_type=failure(error), failure_log=failure_log(error, failure_stage))
      finally:
        try:
            if generator is not None and original_generate is not None:
                generator.generate_text = original_generate
            if generation is not None and original_parse is not None:
                generation._parse_task_structured_output = original_parse
            if hook is not None:
                hook.remove()
            if observer is not None:
                observer.close()
            observer = None
            generator = original_generate = original_parse = None
            if runtime is not None:
                tick = time.perf_counter()
                runtime.unload_generation_models()
                gc.collect()
                if args.device == "cuda" and torch is not None and torch.cuda.is_available():
                    torch.cuda.synchronize()
                    torch.cuda.empty_cache()
                    report["remaining_allocated_vram_bytes"] = torch.cuda.memory_allocated()
                    report["remaining_reserved_vram_bytes"] = torch.cuda.memory_reserved()
                report["cleanup_seconds"] = time.perf_counter() - tick
                report.update(cleanup_snapshot(runtime, loader, report.get("remaining_allocated_vram_bytes", 0),
                    report.get("remaining_reserved_vram_bytes", 0), floor_allocated, floor_reserved))
                if delivery_started is not None:
                    report["model_delivery_seconds"] = time.perf_counter() - delivery_started
        except Exception as error:
            report["cleanup_error_type"] = failure(error)
            report['cleanup_failure_log'] = failure_log(error, 'cleanup')
        report.update(finished_at=now(), whole_delivery_seconds=time.perf_counter() - started)
        if report["status"] == "measured" and (not report["cleanup_passed"] or report.get("diagnostic_overflow")):
            report["status"] = "failed-cleanup-or-diagnostics"
        save(folder, "cohort.json", report)


def child(args, folder):
    print(json.dumps({"kind": "ready", "pid": os.getpid(), "parent_pid": os.getppid(), "rss_bytes": owned.rss(os.getpid())}), flush=True)
    if sys.stdin.readline().strip() != "run":
        raise ValueError("Invalid owned handshake.")
    with slot("worker"):
        child_with_slot(args, folder)


def child_with_slot(args, folder):
    plan_path = original.checked_path((folder.parent / "plan.json").relative_to(ROOT).as_posix())
    if plan_path.stat().st_size > 65536 or owned.sha256_file(plan_path) != os.environ.get("AISB_STANDALONE_PLAN_SHA256"):
        raise ValueError("Plan integrity failed.")
    plan = json.loads(plan_path.read_text(encoding="utf-8"))
    if bindings() != plan["bindings"] or args.model_manifest != plan["manifest"] or args.device not in plan["devices"] or args.profile not in plan["modes"] or args.count not in range(1, plan["repeats"] + 1):
        raise ValueError("Candidate or plan changed.")
    measure(args, folder, plan)
    if bindings() != plan["bindings"]:
        raise ValueError("Candidate changed during measurement.")
    print(json.dumps({"kind": "result", "report": "cohort.json"}), flush=True)


def run_matrix(args, folder, plan):
    report = {"schema_version": "standalone-model-summary-v1", "started_at": now(), "status": "running",
              "qualification_complete": False, "plan_sha256": owned.sha256_file(folder / "plan.json"), "cohorts": []}
    save(folder, "summary.json", report)
    owned.SCRIPT = SCRIPT
    try:
        for repeat in range(1, args.repeats + 1):
          for device in args.devices:
            for mode in args.modes:
                if bindings() != plan["bindings"]:
                    raise ValueError("Candidate changed.")
                cohort = folder / f"{device}-{mode}-{repeat}"
                cohort.mkdir(exist_ok=False)
                item = {"directory": cohort.name, "status": "running", "started_at": now()}
                report["cohorts"].append(item)
                save(folder, "summary.json", report)
                print(f"Testing {plan['model_profile']} / {cohort.name}; progress: {cohort / 'cohort.json'}", flush=True)
                prior_rss = owned.rss
                prior_finish = owned.finish_owned_child
                prior_observe = owned.observe
                peak_rss = 0
                last_progress_at = time.monotonic()
                def sample_rss(pid):
                    nonlocal peak_rss, last_progress_at
                    value = prior_rss(pid)
                    peak_rss = max(peak_rss, value)
                    if time.monotonic() - last_progress_at >= 30:
                        last_progress_at = time.monotonic()
                        try:
                            progress_path = cohort / "cohort.json"
                            if progress_path.stat().st_size <= 2 * 1024**2:
                                progress = json.loads(progress_path.read_text(encoding="utf-8"))
                                completed = sum(len(phase.get("cases", [])) for phase in progress.get("phases", {}).values())
                                expected = plan.get("diagnostic_case_limit", 24) * 2
                                print(f"  {cohort.name}: {completed}/{expected} cases recorded; observed peak RSS {peak_rss / 1024**3:.2f} GiB", flush=True)
                        except (OSError, ValueError, TypeError, AttributeError):
                            pass
                    return value
                def finish_redacted(process, readers, native_thread, native_result, stderr_tail, output, error):
                    # Native extensions can bypass Python's redirected stderr.
                    # Retain volume, never their raw text, in supervisor evidence.
                    item["suppressed_stderr_characters"] = sum(len(line) for line in stderr_tail)
                    lifecycle = prior_finish(process, readers, native_thread, native_result, [], output, error)
                    item["lifecycle"] = lifecycle
                    return lifecycle
                def observe_exit(pid, on_open, timeout):
                    entry = {"pid": pid, "native_exit_code": None}
                    item.setdefault("native_observations", []).append(entry)
                    try:
                        code = prior_observe(pid, on_open, timeout)
                        entry["native_exit_code"] = code
                        return code
                    except Exception as error:
                        entry["error_type"] = failure(error)
                        entry['failure_log'] = failure_log(error, 'operator-execution')
                        raise
                try:
                    os.environ["AISB_STANDALONE_RUN_ID"] = folder.name
                    os.environ["AISB_STANDALONE_PLAN_SHA256"] = report["plan_sha256"]
                    owned.rss = sample_rss
                    owned.finish_owned_child = finish_redacted
                    owned.observe = observe_exit
                    observed = owned.run_child(types.SimpleNamespace(samples=8, model_manifest=plan["manifest"]), cohort, repeat,
                        "measure", "candidate", device, "timing", mode, execution_seconds=1200)
                    value = json.loads((cohort / "cohort.json").read_text(encoding="utf-8"))
                    item.update(status=value["status"], observation=observed, cleanup_passed=value["cleanup_passed"],
                        phases={key: {k: v for k, v in phase.items() if k != "cases"} for key, phase in value["phases"].items()})
                except BaseException as error:
                    item.update(status="interrupted" if isinstance(error, KeyboardInterrupt) else "failed-supervision", error_type=failure(error), failure_log=failure_log(error,'operator-execution'))
                    lifecycle = getattr(error, "owned_child_failure", None)
                    if lifecycle:
                        item["lifecycle"] = lifecycle
                    if isinstance(error, owned.UnconfirmedChildExit):
                        item["cleanup_pending"] = error.evidence
                    if isinstance(error, (KeyboardInterrupt, owned.UnconfirmedChildExit)):
                        raise
                finally:
                    owned.rss = prior_rss
                    owned.finish_owned_child = prior_finish
                    owned.observe = prior_observe
                    item["peak_observed_rss_bytes"] = peak_rss
                    # The child may be killed before its final aggregate/save.
                    # Preserve completed cases without copying raw/unbounded data
                    # or allowing a child's stale running status to override failure.
                    try:
                        progress_path = cohort / "cohort.json"
                        if progress_path.stat().st_size <= 2 * 1024**2:
                            value = json.loads(progress_path.read_text(encoding="utf-8"))
                            item["progress"] = phase_progress(value["phases"], plan.get("diagnostic_case_limit", 24))
                    except (OSError, ValueError, TypeError, AttributeError, KeyError):
                        item["progress_status"] = "unavailable"
                    item["finished_at"] = now()
                    save(folder, "summary.json", report)
                print(f"  {item['status']}", flush=True)
                for phase, value in item.get("phases", {}).items():
                    print(f"    {phase}: {value.get('correct', 0)}/{plan.get('diagnostic_case_limit', 24)} correct; {value.get('seconds', 0):.1f} seconds", flush=True)
        report["source_stable"] = bindings() == plan["bindings"]
        if not report["source_stable"]:
            raise ValueError("Candidate changed.")
        original.configure_model_profile(plan["model_profile"])
        original.verified_model(plan["manifest"])
        report["status"] = "measurements-complete" if all(row["status"] == "measured" for row in report["cohorts"]) else "incomplete-see-cohorts"
    except BaseException as error:
        report.update(status="interrupted" if isinstance(error, KeyboardInterrupt) else "aborted", error_type=failure(error), failure_log=failure_log(error,'operator-execution'))
    finally:
        report["finished_at"] = now()
        save(folder, "summary.json", report)
        files = {p.relative_to(folder).as_posix(): owned.sha256_file(p) for p in folder.rglob("*.json") if p.name != "evidence-index.json"}
        save(folder, "evidence-index.json", {"schema_version": "standalone-model-evidence-v1", "files": files})
    print(f"Evidence: {folder / 'summary.json'}", flush=True)
    return 0 if report["status"] == "measurements-complete" else 1


def main():
    if "--all-blocked" in sys.argv[1:]:
        from run_model_blocker_tests import main as blocker_main
        return blocker_main([value for value in sys.argv[1:] if value != "--all-blocked"])
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run", action="store_true", help="Load models; omitted means plan only")
    parser.add_argument("--plan-only", action="store_true", help="Verify inputs without loading a model, including through a launcher")
    parser.add_argument("--model-profile", choices=original.MODEL_PROFILES, default="qwen15-bfloat16")
    parser.add_argument("--model-manifest")
    parser.add_argument("--devices", nargs="+", choices=("cpu", "cuda"), default=["cpu"])
    parser.add_argument("--modes", nargs="+", choices=("unchecked", "constrained"), default=["unchecked", "constrained"])
    parser.add_argument("--repeats", type=int, choices=(1, 2, 3), default=1)
    parser.add_argument("--case-limit", type=int, choices=(1, 6, 24), default=24,
                        help="First N exposed cases per phase; diagnostic only, never qualification")
    # Fixed owned supervisor protocol; not configurable shell execution.
    parser.add_argument("--child", choices=("measure",))
    for flag in ("run-id", "variant", "device", "phase", "profile", "samples"):
        parser.add_argument("--" + flag)
    parser.add_argument("--count", type=int)
    args = parser.parse_args()
    if args.child:
        run_id = os.environ.get("AISB_STANDALONE_RUN_ID", "")
        if not re.fullmatch(r"[a-f0-9]{32}", run_id) or args.device not in ("cpu", "cuda") or args.profile not in ("unchecked", "constrained") or args.run_id != f"{args.device}-{args.profile}-{args.count}":
            raise ValueError("Invalid owned cohort.")
        folder = safe_directory(ROOT / OUTPUT / run_id / args.run_id)
        child(args, folder)
        return 0
    folder = safe_directory(ROOT / OUTPUT, create=True) / uuid.uuid4().hex
    folder.mkdir(exist_ok=False)
    print(f"Evidence directory: {folder}", flush=True)
    try:
        plan = make_plan(args)
        save(folder, "plan.json", plan)
    except Exception as error:
        save(folder, "summary.json", {"status": "preflight-failed", "error_type": failure(error), "failure_log":failure_log(error,'operator-planning'), "qualification_complete": False,
             "next_step": "Check the existing pinned model acquisition, Node and Python runtime; no download was attempted."})
        print(f"Preflight failed ({failure(error)}). Evidence: {folder / 'summary.json'}", flush=True)
        print(json.dumps(failure_log(error,'operator-planning')), flush=True)
        return 1
    if not args.run or args.plan_only:
        save(folder, "summary.json", {"status": "planned-not-executed", "qualification_complete": False})
        print("Plan only: no model loaded. Omit --plan-only when using a launcher, or add --run when using Python directly.", flush=True)
        return 0
    try:
        with slot("coordinator"):
            # A child can outlive its launcher. Refuse until its OS slot is free.
            with slot("worker"):
                pass
            return run_matrix(args, folder, plan)
    except QualificationBusy as error:
        save(folder, "summary.json", {"status": "admission-busy", "qualification_complete": False,
             "error_type": failure(error), "failure_log": failure_log(error, "operator-admission"),
             "next_step": "Another model test is still running. Retry after it exits. Do not delete lock files."})
        print(json.dumps({"status": "operator-refused", "reason_code": "model-test-busy",
                          "next_step": "Retry after the other model test exits. Do not delete lock files."}), flush=True)
        return 1


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(json.dumps({"status": "operator-failed", "error_type": failure(error), "failure_log":failure_log(error,'operator-admission')}), file=sys.stderr, flush=True)
        raise SystemExit(1) from None
