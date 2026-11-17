"""Prospective same-source Standard/offload comparison, separate from old trials.

Only existing verified acquisitions and the immutable original24-case fixture are
accepted. No acquisition, baseline substitution, precision or decoder changes.
"""
from __future__ import annotations
import argparse
from contextlib import redirect_stdout
from dataclasses import asdict
import gc
import hashlib
import json
import os
from pathlib import Path
import re
import socket
import stat
import sys
import threading
import time
import uuid

SCRIPT = Path(__file__).resolve()
ROOT = SCRIPT.parents[3]
sys.path.insert(0, str(SCRIPT.parent)); sys.path.insert(0, str(ROOT))
import run_installed_generation_qualification as original
import run_trained_context_qualification as owned
from offload_guarded_restart import guarded_restart_readiness

HOLDOUT_SHA256 = "8c017723bd8d44bff52f4d5ad8a66cc76eacd5dcbdce7b0097a3d294a7d4039b"
NAMESPACE = ROOT / ".local-codex/optional-generation"
RSS_LIMIT = 4 * 1024**3
MEMORY_PHASES = ("runtime-initialization", "load", "first", "warm", "cleanup")


def directory(path, *, create=False, exclusive=False):
    path = path.absolute()
    for item in [*reversed(path.parents), path]:
        if item == path and exclusive:
            item.mkdir(exist_ok=False)
        try:
            facts = item.lstat()
        except FileNotFoundError:
            if not create: raise
            item.mkdir(exist_ok=False); facts = item.lstat()
        if not stat.S_ISDIR(facts.st_mode) or stat.S_ISLNK(facts.st_mode) or getattr(facts, "st_file_attributes", 0) & 0x400:
            raise ValueError("Redirected qualification output refused.")
    return path


def write_json(folder, name, value, *, exclusive=False):
    directory(folder)
    target = folder / name
    try:
        facts = target.lstat()
        if not stat.S_ISREG(facts.st_mode) or getattr(facts, "st_file_attributes", 0) & 0x400:
            raise ValueError("Redirected qualification output refused.")
    except FileNotFoundError:
        pass
    with target.open("x" if exclusive else "w", encoding="utf-8") as output:
        output.write(json.dumps(value, indent=2) + "\n")


def require_current_parent_inputs(report, folder, source, operator):
    # A child can reject drift before producing a semantic result. Stop here
    # before that rejection is mistaken for an ordinary failed/denied cohort.
    if owned.source_identity() != source or owned.sha256_file(SCRIPT) != operator:
        report.update(status="aborted-source-drift", qualification_complete=False)
        write_json(folder, "report.json", report)
        raise SystemExit(1)


def profile_for_manifest(relative):
    match = re.fullmatch(r"\.local-codex/model-qualification/(qwen|qwen15)-[a-f0-9-]{36}/acquisition\.json", relative)
    if not match: raise ValueError("Existing fixed acquisition required.")
    return "qwen15-bfloat16" if match[1] == "qwen15" else "qwen05-float32"


def fixed_plan(relative):
    profile = profile_for_manifest(relative)
    original.configure_model_profile(profile)
    fixture = SCRIPT.with_name("installed_generation_holdout.json")
    if owned.sha256_file(fixture) != HOLDOUT_SHA256:
        raise ValueError("Original heldout fixture changed.")
    plan = original.heldout_plan()
    historical = {key: plan.pop(key) for key in ("absolute_quality_floor", "absolute_quality_rationale", "quality_metric", "throughput_metric", "resource_metrics")}
    plan["historical_original_gates_not_applied"] = historical
    plan["optional_acceptance"] = {
        "protocol": "prospective-optional-memory-v2",
        "matched_pairs": "Zero baseline-correct cases lost, no invalid accepted outputs, zero operational failures and at least one correct accepted case per phase. This is compatibility of a memory option; small-model results do not pass the original95percent automatic-use quality gate.",
        "standard_denied_exception": "Only pinned1.5B CPU: no invented baseline/ratio; require>=23of24 correct in first/warm phases across all3repetitions for each decoder.",
        "resource_delivery": "All required cohorts execute with confirmed cleanup/native0; new4GiB sampled whole-child RSS abort,1GiBCPU/2GiBCUDA weight ceilings and12GiB owned staging. Existing finite generation1200s deadline.",
        "throughput": "Report complete delivery and any slowdown; no improvement threshold for this optional mode. Historical original95percent/1.20 gates and failures remain unchanged."
    }
    plan["cuda_runtime_initialization"] = "Fixed16x16float32 matrix multiply, synchronization and deletion before observed runtime floors; same common initialization as original harness, charged to whole delivery. No private workspace clearing."
    plan["guarded_restart"] = guarded_restart_readiness()
    return plan


def staging_observation(path):
    directory(path.parent.parent)
    try: directory(path.parent)
    except FileNotFoundError: return 0, True
    try: facts = path.lstat()
    except FileNotFoundError: return 0, True
    if not stat.S_ISDIR(facts.st_mode) or getattr(facts, "st_file_attributes", 0) & 0x400:
        raise ValueError("Uncertain staging preserved.")
    total = 0
    for count, item in enumerate(path.iterdir()):
        if count >= 2 or item.name not in {"owner", "index.json"}:
            raise ValueError("Unknown staging preserved.")
        facts = item.lstat()
        if not stat.S_ISREG(facts.st_mode) or getattr(facts, "st_file_attributes", 0) & 0x400:
            raise ValueError("Uncertain staging preserved.")
        total += facts.st_size
    return total, False


def initialize_cuda_runtime_floor(torch):
    # Match the original harness: charge common BLAS initialization before
    # measuring the runtime floor, without loading a model or clearing workspaces.
    matrix = torch.zeros((16, 16), dtype=torch.float32, device="cuda")
    result = matrix @ matrix
    torch.cuda.synchronize()
    del result, matrix
    torch.cuda.empty_cache()
    return torch.cuda.memory_allocated(), torch.cuda.memory_reserved()


def cleanup_observations_pass(report):
    if (report.get("cleanup_errors") != []
            or type(report.get("stage_observation_error_count")) is not int
            or report["stage_observation_error_count"] != 0
            or report.get("runtime_vram_floor_observed") is not True
            or any(report.get(key) is not True for key in ("monitor_stopped", "generator_cache_empty", "staging_absence_confirmed"))
            or type(report.get("stage_final_bytes")) is not int or report["stage_final_bytes"] != 0):
        return False
    values = [report.get(key) for key in ("runtime_allocated_vram_floor_bytes", "runtime_reserved_vram_floor_bytes",
                                         "remaining_allocated_vram_bytes", "remaining_reserved_vram_bytes")]
    if not all(type(value) is int and value >= 0 for value in values):
        return False
    allocated_floor, reserved_floor, allocated, reserved = values
    return allocated_floor <= reserved_floor and allocated <= reserved and allocated <= allocated_floor and reserved <= reserved_floor


def compare_pair(standard, optional, plan, *, model_profile, device):
    def bounded(value, maximum): return type(value) is int and 0 <= value <= maximum
    def observed_phases(report):
        required = MEMORY_PHASES if report.get("status") == "measured" else ("runtime-initialization", "load", "cleanup")
        for phase in required:
            item = report.get("phase_memory", {}).get(phase, {})
            before, peak, after = (item.get(key) for key in ("start_rss_bytes", "peak_rss_bytes", "end_rss_bytes"))
            if not all(bounded(value, RSS_LIMIT) and value > 0 for value in (before, peak, after)) or peak < max(before, after):
                return False
        return True
    valid = (optional.get("status") == "measured" and optional.get("cleanup_passed") is True and cleanup_observations_pass(optional)
             and type(optional.get("physical_exit_code")) is int and optional["physical_exit_code"] == 0 and bounded(optional.get("peak_rss_bytes"), RSS_LIMIT)
             and not optional.get("diagnostic_overflow", False))
    denied = standard.get("status") == "denied"
    special = denied and model_profile == "qwen15-bfloat16" and device == "cpu"
    valid = valid and (special or standard.get("status") == "measured")
    valid = (valid and type(standard.get("physical_exit_code")) is int and standard["physical_exit_code"] == 0
             and standard.get("cleanup_passed") is True and cleanup_observations_pass(standard) and not standard.get("diagnostic_overflow", False))
    valid = valid and bounded(standard.get("peak_rss_bytes"), RSS_LIMIT) and observed_phases(standard) and observed_phases(optional)
    resources = optional.get("resources", {})
    valid = (valid and optional.get("source_stable") is True and standard.get("source_stable") is True
             and bounded(optional.get("stage_peak_bytes"), 12 * 1024**3)
             and optional.get("stage_final_bytes") == 0 and optional.get("staging_absence_confirmed") is True
             and bounded(resources.get("cpu_weight_bytes"), 1024**3)
             and bounded(resources.get("cuda_weight_bytes"), 2 * 1024**3))
    expected = [row["id"] for row in plan["heldout"]]
    phases = []
    for phase in ("first", "warm"):
        after = optional.get("phases", {}).get(phase, {}).get("cases", [])
        before = standard.get("phases", {}).get(phase, {}).get("cases", [])
        complete = [row["id"] for row in after] == expected
        regressions = None
        if not denied:
            complete = complete and [row["id"] for row in before] == expected
            regressions = sum(a["correct"] and not b["correct"] for a, b in zip(before, after)) if complete else None
        correct = sum(row["correct"] for row in after)
        invalid_accepted = sum(row.get("invalid_accepted", False) for row in after)
        baseline_invalid_accepted = sum(row.get("invalid_accepted", False) for row in before)
        operational = sum(row.get("operational_errors", 0) for row in after)
        baseline_operational = sum(row.get("operational_errors", 0) for row in before)
        valid = (valid and complete and correct > 0 and operational == 0 and baseline_operational == 0
                 and invalid_accepted == 0 and baseline_invalid_accepted == 0
                 and (correct >= 23 if special else regressions == 0))
        phases.append({"phase": phase, "optional_correct": correct, "baseline_correct": None if denied else sum(row["correct"] for row in before),
                       "baseline_correct_lost": regressions, "invalid_accepted": invalid_accepted,
                       "baseline_invalid_accepted": baseline_invalid_accepted, "operational_errors": operational,
                       "baseline_operational_errors": baseline_operational, "fixed_cases_complete": complete})
    rate = standard.get("accepted_per_minute", 0)
    return {"passed": bool(valid), "standard_denied": denied, "special_denied_cpu_floor": special, "phases": phases,
            "delivery_ratio": optional.get("accepted_per_minute", 0) / rate if not denied and rate > 0 else None}


def schema_identity(plan):
    from modules.adapters.runtime.python.worker.tasks import example_generation as generation
    schema = generation.build_task_structured_output_schema(plan["task_type"], {"labelSet": plan["labels"]})
    return hashlib.sha256(json.dumps(schema, sort_keys=True).encode()).hexdigest()


def validate_child_result(result, protocol, plan, model_profile, protocol_sha):
    expected = {"operator_sha256": protocol["operator_sha256"], "protocol_sha256": protocol_sha,
                "model_profile": model_profile, "precision": plan["precision"], "device": protocol["device"],
                "mode": protocol["mode"], "replicate": protocol["replicate"], "variant": protocol["variant"],
                "memory_mode": "offload-v1" if protocol["variant"] == "candidate" else "standard",
                "schema_sha256": protocol["schema_sha256"], "configured_generation_params": plan["generation_params"]}
    if any(result.get(key) != value for key, value in expected.items()):
        raise ValueError("Child semantic result binding failed.")
    if result.get("status") == "measured" and result.get("effective_sampling") != plan["effective_sampling"]:
        raise ValueError("Child effective sampling binding failed.")


def memory_tick(report, phase, value):
    if phase not in MEMORY_PHASES or type(value) is not int or value <= 0:
        raise ValueError("Invalid phase memory observation.")
    item = report["phase_memory"][phase]
    item["peak_rss_bytes"] = max(item["peak_rss_bytes"], value)


class PhaseSampler:
    def __init__(self, report, read_rss, read_stage):
        self.report = report; self.read_rss = read_rss; self.read_stage = read_stage
        self.lock = threading.RLock(); self.phase = "runtime-initialization"; self.previous = self.phase

    def enter(self, name):
        with self.lock:
            value = self.read_rss()
            memory_tick(self.report, self.phase, value)
            self.report["phase_memory"][self.phase]["end_rss_bytes"] = value
            self.phase = name
            self.report["phase_memory"][name]["start_rss_bytes"] = value
            memory_tick(self.report, name, value)

    def fence_cleanup(self):
        # No observation callback here: even an unavailable RSS API cannot
        # prevent teardown. Waiting for this lock drains any admitted file probe.
        with self.lock:
            self.previous = self.phase; self.phase = "cleanup"

    def cleanup_boundary(self):
        with self.lock:
            value = self.read_rss()
            memory_tick(self.report, self.previous, value)
            self.report["phase_memory"][self.previous]["end_rss_bytes"] = value
            self.report["phase_memory"]["cleanup"]["start_rss_bytes"] = value
            memory_tick(self.report, "cleanup", value)

    def sample(self):
        with self.lock:
            memory_tick(self.report, self.phase, self.read_rss())
            if self.phase != "cleanup":
                size, _absent = self.read_stage()
                self.report["stage_peak_bytes"] = max(self.report["stage_peak_bytes"], size)


def cleanup_steps(report, actions):
    """Fixed in-process cleanup stages: observations never gate owned release."""
    errors = []
    for name in ("phase", "restore-generator", "restore-parser", "remove-hook", "drop-view", "unload", "collect",
                 "accelerator", "stop-monitor", "stage", "rss"):
        try:
            actions[name]()
        except Exception as error:
            errors.append({"stage": name, "error_class": type(error).__name__})
            error.__traceback__ = None
    report["cleanup_errors"] = errors


def measure(args, folder):
    # Establish the actual native worker before any plan/model/stage admission
    # can reject. Measurement still starts at the later ready/run boundary.
    print(json.dumps({"kind": "identity", "pid": os.getpid(), "parent_pid": os.getppid()}), flush=True)
    if sys.stdin.readline().strip() != "observe": raise ValueError("Invalid native observation handshake.")
    if not re.fullmatch(r"[a-f0-9]{32}", args.run_id or ""): raise ValueError("Invalid owned run identity.")
    folder = directory(folder)
    plan = fixed_plan(args.model_manifest)
    model_path = original.verified_model(args.model_manifest)
    operator = owned.sha256_file(SCRIPT)
    protocol_path = folder / "run-plan.json"
    original.checked_path(str(protocol_path.relative_to(ROOT)).replace("\\", "/"))
    with protocol_path.open("rb") as source:
        protocol_bytes = source.read(65537)
    protocol_sha = hashlib.sha256(protocol_bytes).hexdigest()
    if len(protocol_bytes) > 65536 or protocol_sha != os.environ.get("AISB_OPTIONAL_PLAN_SHA256"):
        raise ValueError("Qualification plan binding failed.")
    protocol = json.loads(protocol_bytes.decode("utf-8"))
    if (protocol.get("operator_sha256") != operator or protocol.get("manifest") != args.model_manifest
            or protocol.get("variant") != args.variant or protocol.get("device") != args.device
            or protocol.get("mode") != args.profile or protocol.get("replicate") not in (0, 1, 2)
            or protocol.get("plan_sha256") != hashlib.sha256(json.dumps(plan, sort_keys=True).encode()).hexdigest()):
        raise ValueError("Qualification child profile differs.")
    if owned.source_identity() != protocol.get("source_revision"):
        raise ValueError("Child source binding failed.")
    stage = model_path.parent / ".aisb-offload-v1/active"
    if not staging_observation(stage)[1]: raise ValueError("Existing staging preserved.")
    os.environ.update(HF_HUB_OFFLINE="1", TRANSFORMERS_OFFLINE="1", HF_HUB_DISABLE_TELEMETRY="1",
                      TOKENIZERS_PARALLELISM="false", HF_HUB_CACHE=str(model_path.parent))
    print(json.dumps({"kind": "ready", "pid": os.getpid(), "parent_pid": os.getppid(), "rss_bytes": owned.rss(os.getpid())}), flush=True)
    if sys.stdin.readline().strip() != "run": raise ValueError("Invalid owned handshake.")
    report = {"kind": "result", "operator_sha256": operator, "protocol_sha256": protocol_sha,
              "model_profile": original.MODEL_PROFILE, "precision": plan["precision"], "device": args.device,
              "mode": args.profile, "replicate": protocol["replicate"], "variant": args.variant,
              "status": "running", "cleanup_passed": False, "phases": {}, "stage_peak_bytes": 0,
              "memory_mode": "offload-v1" if args.variant == "candidate" else "standard",
              "configured_generation_params": plan["generation_params"], "schema_sha256": protocol["schema_sha256"],
              "phase_memory": {phase: {"start_rss_bytes": None, "peak_rss_bytes": 0, "end_rss_bytes": None} for phase in MEMORY_PHASES}}
    started = time.perf_counter(); runtime = None; generator = None; selected_class = None; prior_generate = None; prior_parse = None
    allocated_floor = reserved_floor = 0
    floor_observed = False
    monitor_stop = threading.Event(); monitor = None; hook = None; stage_errors = []
    torch = None
    sampler = PhaseSampler(report, lambda: owned.rss(os.getpid()), lambda: staging_observation(stage))
    report["phase_memory"]["runtime-initialization"]["start_rss_bytes"] = owned.rss(os.getpid())
    def sample_stage():
        while not monitor_stop.wait(.005):
            try:
                sampler.sample()
            except Exception:
                stage_errors.append("UncertainMemoryOrStageObservation"); return
    def deny(*_args, **_kwargs): raise RuntimeError("Network/pickle forbidden during qualification.")
    socket.socket.connect = deny; socket.socket.connect_ex = deny; socket.create_connection = deny
    directory(folder)
    with (folder / "private-diagnostic.log").open("x", encoding="utf-8") as output:
      with redirect_stdout(original.BoundedDiagnosticSink(output, report)):
        try:
            monitor = threading.Thread(target=sample_stage, daemon=True); monitor.start()
            import torch
            torch.set_num_threads(4); torch.manual_seed(17); torch.load = deny
            from modules.adapters.runtime.python.worker.tasks import local_text_generation as runtime, example_generation as generation
            from modules.adapters.runtime.python.worker.models import ExampleGenerationConfig
            from modules.adapters.runtime.python.worker.tasks.markdown_chunking import MarkdownChunk
            from modules.adapters.runtime.python.worker.tasks.structured_output_runtime import RuntimeStructuredOutput
            runtime._RESOLVED_MODEL_REFERENCES[original.MODEL] = str(model_path)
            allocated_floor = reserved_floor = 0
            if args.device == "cuda":
                if not torch.cuda.is_available(): raise RuntimeError("Required CUDA unavailable.")
                allocated_floor, reserved_floor = initialize_cuda_runtime_floor(torch)
                torch.cuda.reset_peak_memory_stats()
            floor_observed = True
            report["runtime_initialization_seconds"] = time.perf_counter() - started
            config = ExampleGenerationConfig.model_validate({"mode": "qa", "failurePolicy": "skip", "promptTemplate": plan["prompt"],
                "model": {"provider": "transformers", "modelId": original.MODEL, "inferenceMode": "chat", "device": args.device,
                          "torchDtype": plan["precision"], "memoryMode": "offload-v1" if args.variant == "candidate" else "standard", "memoryOverflowPolicy": "none"},
                "generationParams": plan["generation_params"]})
            recipe = {"labelSet": plan["labels"]}
            schema = generation.build_task_structured_output_schema(plan["task_type"], recipe)
            structured = RuntimeStructuredOutput(schema=schema, example=generation.build_task_structured_output_example(plan["task_type"], recipe),
                schema_fingerprint=hashlib.sha256(json.dumps(schema, sort_keys=True).encode()).hexdigest(), payload_key="example",
                purpose_paths={"label": ("label",)}, constrained_decoding=args.profile == "constrained")
            if structured.schema_fingerprint != protocol["schema_sha256"]:
                raise ValueError("Structured schema differs from frozen plan.")
            sampler.enter("load")
            loading = time.perf_counter()
            generator = runtime.get_or_create_local_text_generator(config, allow_offload=args.variant == "candidate")
            if args.device == "cuda": torch.cuda.synchronize()
            report["load_seconds"] = time.perf_counter() - loading
            effective = generator._model.generation_config.to_dict() | generator._generation_params
            if any(effective.get(key) != value for key, value in plan["effective_sampling"].items()) or str(generator._model.dtype) != "torch." + plan["precision"]:
                raise ValueError("Precision or sampling changed.")
            report["effective_sampling"] = {key: effective[key] for key in plan["effective_sampling"]}
            report["device_map"] = getattr(generator._model, "hf_device_map", None)
            if args.variant == "candidate": report["resources"] = asdict(generator._owner._bundle.resources)
            devices = set()
            def placement(module, inputs, result):
                if isinstance(module, torch.nn.Embedding): devices.add(str(result.device))
            hook = torch.nn.modules.module.register_module_forward_hook(placement)
            selected_class = type(generator); prior_generate = selected_class.generate_text; prior_parse = generation._parse_task_structured_output
            current = {}
            def observed_generate(self, *arguments, **keywords):
                current["attempts"] += 1
                try: return prior_generate(self, *arguments, **keywords)
                except generation.ConstrainedJsonDecoderError as error:
                    if original.decoder_failure_kind(error.code) == "invalid-output": current["invalid_attempts"] += 1
                    else: current["operational_errors"] += 1
                    raise
                except Exception:
                    current["operational_errors"] += 1; raise
            def observed_parse(*arguments, **keywords):
                try: return prior_parse(*arguments, **keywords)
                except ValueError:
                    current["invalid_attempts"] += 1; raise
            selected_class.generate_text = observed_generate; generation._parse_task_structured_output = observed_parse
            for phase in ("first", "warm"):
                sampler.enter(phase)
                phase_started = time.perf_counter(); entry = {"cases": []}; report["phases"][phase] = entry
                for index, row in enumerate(plan["heldout"]):
                    torch.manual_seed(17 + index)
                    current = {"id": row["id"], "attempts": 0, "invalid_attempts": 0, "operational_errors": 0, "repairs": 0,
                               "correct": False, "accepted": False, "invalid_accepted": False, "status": "running"}
                    case_started = time.perf_counter()
                    def repaired(_event): current["repairs"] += 1
                    try:
                        examples = generation.generate_task_examples_for_chunks([MarkdownChunk("synthetic-heldout", index, row["text"])],
                            config, plan["task_type"], recipe, structured_output=structured, on_output_repair=repaired)
                        if len(examples) > 1: raise ValueError("Unbounded result.")
                        current["accepted"] = bool(examples)
                        current["correct"] = bool(examples and examples[0].structured_fields == {"label": row["label"]})
                        current["invalid_accepted"] = bool(examples and (set(examples[0].structured_fields) != {"label"} or examples[0].structured_fields["label"] not in plan["labels"]))
                        current["status"] = "correct" if current["correct"] else "wrong-label" if examples else "skip-or-rejected"
                        del examples
                    except (generation.GenerationOutputValidationError, generation.ConstrainedJsonDecoderError) as error:
                        current["status"] = "rejected"; current["error_class"] = type(error).__name__
                        if isinstance(error, generation.ConstrainedJsonDecoderError) and error.code in generation._NON_RETRYABLE_CONSTRAINED_DECODER_CODES: raise
                    finally:
                        if args.device == "cuda": torch.cuda.synchronize()
                        current["seconds"] = time.perf_counter() - case_started; entry["cases"].append(current)
                        write_json(folder, "cohort.json", report)
                entry.update(seconds=time.perf_counter() - phase_started, correct=sum(row["correct"] for row in entry["cases"]), **original.phase_counts(entry["cases"]))
            report["actual_embedding_output_devices"] = sorted(devices)
            if devices != {"cuda:0" if args.device == "cuda" else "cpu"}: raise ValueError("Actual execution placement differs.")
            report["peak_allocated_vram_bytes"] = torch.cuda.max_memory_allocated() if args.device == "cuda" else 0
            report["peak_reserved_vram_bytes"] = torch.cuda.max_memory_reserved() if args.device == "cuda" else 0
            report["status"] = "measured"
        except Exception as error:
            report["status"] = "denied" if type(error).__name__ == "GenerationInsufficientResourcesError" and generator is None else "failed"
            report["error_class"] = type(error).__name__
            error.__traceback__ = None
        finally:
            cleanup = time.perf_counter()
            sampler.fence_cleanup()
            def restore_generator():
                if selected_class is not None and prior_generate is not None: selected_class.generate_text = prior_generate
            def restore_parser():
                if prior_parse is not None: generation._parse_task_structured_output = prior_parse
            def remove_hook():
                if hook is not None: hook.remove()
            def drop_view():
                nonlocal generator, prior_generate, prior_parse
                generator = None; prior_generate = None; prior_parse = None
            def unload():
                if runtime is not None: runtime.unload_generation_models()
                report["generator_cache_empty"] = runtime is None or not runtime._GENERATOR_CACHE
            def accelerator():
                if torch is not None and args.device == "cuda" and torch.cuda.is_available():
                    torch.cuda.synchronize(); torch.cuda.empty_cache()
                    report["remaining_allocated_vram_bytes"] = torch.cuda.memory_allocated()
                    report["remaining_reserved_vram_bytes"] = torch.cuda.memory_reserved()
                else: report.update(remaining_allocated_vram_bytes=0, remaining_reserved_vram_bytes=0)
            def stop_monitor():
                monitor_stop.set()
                if monitor is not None: monitor.join(timeout=2)
                report["monitor_stopped"] = monitor is None or not monitor.is_alive()
            def final_rss():
                ending_rss = owned.rss(os.getpid())
                memory_tick(report, "cleanup", ending_rss)
                report["phase_memory"]["cleanup"]["end_rss_bytes"] = ending_rss
                report["remaining_rss_bytes"] = ending_rss
            def final_stage():
                final_bytes, absent = staging_observation(stage)
                report.update(stage_final_bytes=final_bytes, staging_absence_confirmed=absent)
            cleanup_steps(report, {"phase": sampler.cleanup_boundary, "restore-generator": restore_generator, "restore-parser": restore_parser,
                "remove-hook": remove_hook, "drop-view": drop_view, "unload": unload, "collect": gc.collect, "accelerator": accelerator,
                "stop-monitor": stop_monitor, "stage": final_stage, "rss": final_rss})
            report.update(runtime_allocated_vram_floor_bytes=allocated_floor, runtime_reserved_vram_floor_bytes=reserved_floor,
                          runtime_vram_floor_observed=floor_observed, stage_observation_error_count=len(stage_errors))
            report["cleanup_passed"] = cleanup_observations_pass(report)
            report.update(cleanup_seconds=time.perf_counter() - cleanup, whole_delivery_seconds=time.perf_counter() - started)
            report["accepted_per_minute"] = 60 * sum(value.get("correct", 0) for value in report["phases"].values()) / report["whole_delivery_seconds"]
            report["commit_measurement"] = "Private commit not sampled; RSS includes runtime imports, load, forward and unload. Sampling is not an allocation cap."
            report["source_stable"] = owned.source_identity() == protocol["source_revision"]
            write_json(folder, "cohort.json", report)
    print(json.dumps(report), flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model-manifest", required=True)
    parser.add_argument("--child", choices=["measure"]); parser.add_argument("--run-id")
    parser.add_argument("--count", type=int, choices=[1], default=1); parser.add_argument("--samples", type=int, choices=[1], default=1)
    parser.add_argument("--variant", choices=["baseline", "candidate"], default="candidate")
    parser.add_argument("--device", choices=["cpu", "cuda"], default="cpu")
    parser.add_argument("--phase", choices=["timing"], default="timing")
    parser.add_argument("--profile", choices=["unchecked", "constrained"], default="unchecked")
    args = parser.parse_args()
    if args.child:
        # Path construction has no I/O; measure observes the worker before
        # validating the run identity, directory or any semantic input.
        measure(args, NAMESPACE / (args.run_id or "invalid")); return 0
    plan = fixed_plan(args.model_manifest)
    if args.run_id is not None: raise ValueError("Parent run identity is generated.")
    original.verified_model(args.model_manifest)
    directory(NAMESPACE, create=True); folder = directory(NAMESPACE / uuid.uuid4().hex, exclusive=True)
    source = owned.source_identity(); operator = owned.sha256_file(SCRIPT)
    schema_sha = schema_identity(plan)
    report = {"schema_version": "optional-generation-qualification-v1", "source_revision": source, "operator_sha256": operator,
              "model_profile": original.MODEL_PROFILE, "model": original.MODEL, "revision": original.REVISION, "plan": plan,
              "plan_sha256": hashlib.sha256(json.dumps(plan, sort_keys=True).encode()).hexdigest(), "holdout_sha256": HOLDOUT_SHA256, "schema_sha256": schema_sha,
              "rss_abort_bytes": RSS_LIMIT, "deadline_seconds": 1200, "rss_sample_interval_ms": 5, "status": "running", "qualification_complete": False, "cohorts": [],
              "supervision_protocol": "early-native-identity-v1",
              "measurement_boundary": "Same final current source; Standard versus explicit offload-v1. Whole child includes runtime imports, fresh load, first24/warm24 requests, all repairs/failures and unload. No original baseline replacement; no throughput-improvement claim. OS file cache uncontrolled. Repetitions do not enlarge the24 distinct fixed cases."}
    write_json(folder, "report.json", report, exclusive=True)
    owned.SCRIPT = SCRIPT  # Fixed inspected script; no arbitrary command input.
    previous = os.environ.get("AISB_OPTIONAL_PLAN_SHA256")
    try:
        for device in ("cpu", "cuda"):
          for mode in ("unchecked", "constrained"):
            cohort = {"device": device, "mode": mode, "pairs": [], "status": "running"}; report["cohorts"].append(cohort)
            for replicate in range(3):
                pair = {}; cohort["pairs"].append(pair)
                for variant in ("baseline", "candidate"):
                    require_current_parent_inputs(report, folder, source, operator)
                    child_folder = directory(NAMESPACE / uuid.uuid4().hex, exclusive=True)
                    protocol = {"operator_sha256": operator, "source_revision": source, "schema_sha256": schema_sha, "manifest": args.model_manifest, "variant": variant, "device": device,
                                "mode": mode, "replicate": replicate, "plan_sha256": report["plan_sha256"]}
                    write_json(child_folder, "run-plan.json", protocol, exclusive=True)
                    protocol_sha = owned.sha256_file(child_folder / "run-plan.json")
                    os.environ["AISB_OPTIONAL_PLAN_SHA256"] = protocol_sha
                    try:
                        result = owned.run_child(args, child_folder, 1, "measure", variant, device, profile=mode, execution_seconds=1200, early_identity=True)
                        require_current_parent_inputs(report, folder, source, operator)
                        validate_child_result(result, protocol, plan, original.MODEL_PROFILE, protocol_sha)
                        if not result.get("source_stable"):
                            report.update(status="aborted-source-drift", qualification_complete=False)
                            write_json(folder, "report.json", report); raise SystemExit(1)
                        result["artifact"] = str((child_folder / "observed.json").relative_to(ROOT)).replace("\\", "/")
                        pair[variant] = result
                        write_json(child_folder, "observed.json", result, exclusive=True)
                        pair[variant]["observed_sha256"] = owned.sha256_file(child_folder / "observed.json")
                    except owned.UnconfirmedChildExit as error:
                        report.update(status="aborted-unconfirmed-child-exit", qualification_complete=False, cleanup_pending=error.evidence)
                        write_json(folder, "report.json", report); raise
                    except Exception as error:
                        pair[variant] = {"status": "failed", "error_class": type(error).__name__, "artifact": child_folder.name}
                        lifecycle = getattr(error, "owned_child_failure", None)
                        if lifecycle is not None:
                            pair[variant]["supervision_failure"] = lifecycle
                    write_json(folder, "report.json", report)
                    print(json.dumps({"device": device, "mode": mode, "replicate": replicate, "variant": variant, "status": pair[variant]["status"]}), flush=True)
                pair["comparison"] = compare_pair(pair["baseline"], pair["candidate"], plan, model_profile=original.MODEL_PROFILE, device=device)
                write_json(folder, "report.json", report)
            cohort["status"] = "passed" if all(pair["comparison"]["passed"] for pair in cohort["pairs"]) else "failed"
    finally:
        if previous is None: os.environ.pop("AISB_OPTIONAL_PLAN_SHA256", None)
        else: os.environ["AISB_OPTIONAL_PLAN_SHA256"] = previous
    report["source_stable"] = owned.source_identity() == source
    report["operator_stable"] = owned.sha256_file(SCRIPT) == operator
    report["inputs_stable"] = fixed_plan(args.model_manifest) == plan
    original.verified_model(args.model_manifest)
    report["qualification_complete"] = report["source_stable"] and report["operator_stable"] and report["inputs_stable"] and all(row["status"] == "passed" for row in report["cohorts"])
    report["status"] = "passed" if report["qualification_complete"] else "failed"
    write_json(folder, "report.json", report)
    print(json.dumps({"status": report["status"], "report": str((folder / "report.json").relative_to(ROOT)).replace("\\", "/")}), flush=True)
    return 0 if report["qualification_complete"] else 1


if __name__ == "__main__": raise SystemExit(main())
