"""Fixed trained-model Context comparison. Offline, safe weights, no prompt logs.

The unchanged retrieval algorithm and current retrieval algorithm use one common
current embedding runtime. CUDA is a newly supported transient placement, not a
claim that the historical release supported CUDA. All model load costs are timed.
"""
from __future__ import annotations
import argparse
import hashlib
import importlib.metadata
import json
import math
import os
from pathlib import Path
import queue
import re
import statistics
import subprocess
import sys
import threading
import time
import uuid

SCRIPT = Path(__file__).resolve()
ROOT = SCRIPT.parents[3]
sys.path.insert(0, str(SCRIPT.parent))
sys.path.insert(0, str(ROOT))
from trained_context_fixture import TOPICS, relevant_ids, rows
from run_context_efficiency_qualification import BASELINE_COMMIT, BASELINE_SHA256, compare, load_runtime, percentile95, reduction, rss
from windows_qualification_memory import constrain_current_process, memory_profile_evidence
from observe_windows_process_exit import observe

MODEL = "sentence-transformers/all-MiniLM-L6-v2"
REVISION = "1110a243fdf4706b3f48f1d95db1a4f5529b4d41"
FILES = {
    "config.json": "953f9c0d463486b10a6871cc2fd59f223b2c70184f49815e7efbcab5d8908b41",
    "tokenizer.json": "be50c3628f2bf5bb5e3a7f17b1f74611b2561a3a27eeab05e5aa30f411572037",
    "tokenizer_config.json": "acb92769e8195aabd29b7b2137a9e6d6e25c476a4f15aa4355c233426c61576b",
    "special_tokens_map.json": "303df45a03609e4ead04bc3dc1536d0ab19b5358db685b6f3da123d05ec200e3",
    "vocab.txt": "07eced375cec144d27c900241f3e339478dec958f92fddbc551f295c992038a3",
    "model.safetensors": "53aa51172d142c89d9012cce15ae4d6cc0ca6895895114379cacb4fab128d9db",
}

_UNCONFIRMED_CHILD = None


def failure_kind(error):
    name = type(error).__name__
    return name if name in {"ValueError", "RuntimeError", "OSError", "TimeoutExpired", "Empty", "JSONDecodeError"} else "QualificationFailure"


class UnconfirmedChildExit(RuntimeError):
    def __init__(self, launcher_pid, workload_error=None, cleanup_errors=()):
        super().__init__("Owned child shutdown could not be confirmed; further cohorts are refused.")
        self.evidence = {"launcher_pid": launcher_pid, "workload_failure_type": failure_kind(workload_error) if workload_error is not None else None, "cleanup_failure_types": list(cleanup_errors)}


def physical_exit_code(process, native_thread, native_result):
    if os.name != "nt":
        return process.poll()
    if native_thread is not None:
        try:
            native_thread.join(timeout=5)
        except (RuntimeError, OSError):
            return None
        if not native_thread.is_alive() and len(native_result) == 1 and type(native_result[0]) is int and 0 <= native_result[0] <= 0xFFFFFFFF:
            return native_result[0]
    return None


def finish_owned_child(process, readers, native_thread, native_result, stderr_tail, folder, workload_error):
    global _UNCONFIRMED_CHILD
    cleanup_errors = []
    if process.poll() is None:
        try:
            if os.name == "nt":
                stopped = subprocess.run(["taskkill", "/PID", str(process.pid), "/T", "/F"], capture_output=True, timeout=10)
                if stopped.returncode:
                    cleanup_errors.append("TerminationUnavailable")
            else:
                process.kill()
        except (OSError, subprocess.SubprocessError) as error:
            cleanup_errors.append(failure_kind(error))
    # A termination error must not skip independent exit confirmation.
    try:
        process.wait(timeout=10)
    except (OSError, subprocess.SubprocessError) as error:
        cleanup_errors.append(failure_kind(error))
    reader_join_failed = False
    for reader in readers:
        try:
            reader.join(timeout=2)
        except (RuntimeError, OSError):
            cleanup_errors.append("ReaderJoinUnavailable")
            reader_join_failed = True
    observed = physical_exit_code(process, native_thread, native_result)
    confirmed = process.poll() is not None and observed is not None and not reader_join_failed and not any(reader.is_alive() for reader in readers)
    if not confirmed:
        _UNCONFIRMED_CHILD = UnconfirmedChildExit(process.pid, workload_error, cleanup_errors)
    # A live reader may own a buffered stream lock. Never close it synchronously.
    if confirmed:
        try:
            for stream in (process.stdin, process.stdout, process.stderr):
                stream.close()
        except OSError as error:
            _UNCONFIRMED_CHILD = UnconfirmedChildExit(process.pid, workload_error, [*cleanup_errors, failure_kind(error)])
    try:
        if stderr_tail:
            diagnostic = folder / f"private-diagnostic-{uuid.uuid4().hex}.log"
            with diagnostic.open("x", encoding="utf-8") as output:
                output.write("".join(stderr_tail))
    finally:
        if _UNCONFIRMED_CHILD is not None:
            raise _UNCONFIRMED_CHILD from None


def abort_unconfirmed_child(error, report, save):
    if isinstance(error, UnconfirmedChildExit):
        report.update(status="aborted-unconfirmed-child-exit", qualification_complete=False, cleanup_pending=error.evidence)
        save()
        raise SystemExit(1) from None


def sha256_file(path):
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def verified_model(relative):
    if not re.fullmatch(r"\.local-codex/model-qualification/minilm-[a-f0-9-]{36}/acquisition\.json", relative):
        raise ValueError("Qualification requires the fixed isolated embedding acquisition.")
    manifest = ROOT / relative
    for component in [manifest, *manifest.parents]:
        if component == ROOT.parent:
            break
        stat = component.lstat()
        if component.is_symlink() or getattr(stat, "st_file_attributes", 0) & 0x400:
            raise ValueError("Redirected model inputs are forbidden.")
    if manifest.stat().st_size > 64 * 1024:
        raise ValueError("Model evidence exceeds its bound.")
    data = json.loads(manifest.read_text(encoding="utf-8"))
    if (data.get("model"), data.get("revision"), data.get("status")) != (MODEL, REVISION, "verified"):
        raise ValueError("Embedding identity is invalid.")
    if {entry["name"]: entry["sha256"] for entry in data["files"]} != FILES or len(data["files"]) != len(FILES):
        raise ValueError("Embedding file evidence differs from the fixed revision.")
    if {item.name for item in manifest.parent.iterdir()} != set(FILES) | {"acquisition.json"}:
        raise ValueError("Unexpected model files are forbidden.")
    for name, digest in FILES.items():
        target = manifest.parent / name
        stat = target.lstat()
        if not target.is_file() or target.is_symlink() or getattr(stat, "st_file_attributes", 0) & 0x400 or not 0 < stat.st_size <= 100 * 1024 ** 2 or sha256_file(target) != digest:
            raise ValueError("Embedding file integrity failed.")
    return manifest.parent


def source_identity():
    output = subprocess.check_output(["node", "--input-type=module", "-e", "import {readAssetSystemSourceIdentity} from './dev-tools/scripts/qualification/asset-system-source-identity.mjs'; console.log(await readAssetSystemSourceIdentity(process.cwd()));"], cwd=ROOT, timeout=30, text=True).strip()
    if not re.fullmatch(r"source\.[a-f0-9]{64}", output):
        raise ValueError("Source identity unavailable.")
    return output


def runtime(model_path):
    os.environ.update(HF_HUB_OFFLINE="1", TRANSFORMERS_OFFLINE="1", HF_HUB_DISABLE_TELEMETRY="1", TOKENIZERS_PARALLELISM="false")
    import torch
    torch.set_num_threads(4)
    torch.manual_seed(17)
    def deny_pickle(*_args, **_kwargs):
        raise RuntimeError("Pickle loading is forbidden during qualification.")
    torch.load = deny_pickle
    from modules.adapters.runtime.python.worker.tasks import local_text_generation
    local_text_generation._RESOLVED_MODEL_REFERENCES[MODEL] = str(model_path)
    return torch


def prepare(folder, count, model_path, device):
    torch = runtime(model_path)
    from modules.adapters.runtime.python.worker.models import ContextGenerationTaskRequest
    from modules.adapters.runtime.python.worker.tasks.context_generation import generate_context_artifact
    content = b"".join((json.dumps(row, separators=(",", ":")) + "\n").encode() for row in rows(count))
    source = folder / f"source-{count}.jsonl"
    source.write_bytes(content)
    request = ContextGenerationTaskRequest.model_validate({"workspaceId": "workspace.fixture", "kind": "rag-database", "name": f"Trained qualification {count} {device}", "sources": [{"artifactId": "artifact.fixture", "localPath": str(source), "mediaType": "application/jsonl", "originalName": source.name, "sourceDigest": "sha256:" + hashlib.sha256(content).hexdigest(), "sizeBytes": len(content)}], "manualEntries": [], "chunking": {"strategy": "fixed-length", "chunkCharacters": 256, "overlapCharacters": 0, "textFields": ["text"], "maximumChunks": count}, "embedding": {"provider": "transformers", "modelId": MODEL, "dimensions": 128 if count == 100000 else 384, "batchSize": 128, **({"device":device} if device!="cpu" else {})}, "runtime": {"runtimeWorkingDirectory": str(folder)}})
    observed=set()
    def placement(layer, inputs):
        if isinstance(layer,torch.nn.Embedding) and inputs and hasattr(inputs[0],"device"):
            if layer.weight.device!=inputs[0].device:
                raise ValueError("Generation tensor placement differs.")
            observed.add(str(inputs[0].device))
    hook=torch.nn.modules.module.register_module_forward_pre_hook(placement)
    started = time.perf_counter()
    try:
        result = generate_context_artifact(request)
        if device=="cuda": torch.cuda.synchronize()
    finally:
        hook.remove()
    if observed!={"cuda:0" if device=="cuda" else "cpu"}:
        raise ValueError("Actual generation tensor placement failed.")
    path = folder / result["output"]["outputHandle"]
    if "device" in result["manifest"]["embedding"]:
        raise ValueError("Portable manifest retained transient placement.")
    value = {"path": path.name, "bytes": path.stat().st_size, "sha256": sha256_file(path), "source_digest": "sha256:" + hashlib.sha256(content).hexdigest(), "corpus_sha256": hashlib.sha256(content).hexdigest(), "dimensions": request.embedding.dimensions, "chunks": count, "generation_device": "cpu-default" if device=="cpu" else device, "actual_tensor_devices":sorted(observed), "generation_ms": (time.perf_counter() - started) * 1000}
    (folder / f"corpus-{count}.json").write_text(json.dumps(value), encoding="utf-8")
    return value


def measure(args, folder, model_path):
    torch = runtime(model_path)
    import lancedb, pyarrow
    from modules.adapters.runtime.python.worker.models import ContextArtifactOperationTaskRequest
    from modules.adapters.runtime.python.worker.tasks.context_generation import _embed_with_transformers
    module = load_runtime(args.variant, folder)
    corpus = json.loads((folder / f"corpus-{args.count}.json").read_text())
    path = folder / corpus["path"]
    devices = set()
    mismatches = []
    def placement_hook(layer, inputs):
        if isinstance(layer, torch.nn.Embedding) and inputs and hasattr(inputs[0], "device"):
            device = str(inputs[0].device)
            devices.add(device)
            if layer.weight.device != inputs[0].device:
                mismatches.append(True)
    hook = torch.nn.modules.module.register_module_forward_pre_hook(placement_hook)
    progress_path=folder/f"query-progress-{uuid.uuid4().hex}.json"
    progress={"status":"running","variant":args.variant,"device":args.device,"profile":args.profile,"phase":args.phase,"queries":[]}
    def save_progress(): progress_path.write_text(json.dumps(progress,indent=2)+"\n",encoding="utf-8")
    save_progress()
    def common_embedding(texts, settings):
        return _embed_with_transformers(texts, settings.model_copy(update={"device": args.device}))
    module._embed_with_transformers = common_embedding
    initial_allocated=initial_reserved=0
    if args.device == "cuda":
        if not torch.cuda.is_available():
            raise RuntimeError("Required CUDA profile unavailable.")
        torch.cuda.synchronize()
        # Initialize the runtime-owned cuBLAS workspace separately from model
        # ownership. Its stable allocation survives empty_cache by design.
        matrix=torch.zeros((16,16),device="cuda")
        multiplied=matrix@matrix
        torch.cuda.synchronize()
        del matrix,multiplied
        torch.cuda.empty_cache()
        initial_allocated=torch.cuda.memory_allocated()
        initial_reserved=torch.cuda.memory_reserved()
        torch.cuda.reset_peak_memory_stats()
    print(json.dumps({"kind": "ready", "pid": os.getpid(), "parent_pid": os.getppid(), "rss_bytes": rss(os.getpid())}), flush=True)
    if sys.stdin.readline().strip() != "run":
        raise ValueError("Invalid qualification handshake.")
    durations, answers, recalls = [], [], []
    iterations = 1 if args.phase == "memory" else 5 + args.samples
    try:
        for index in range(iterations):
            query_index = index % len(TOPICS)
            request = ContextArtifactOperationTaskRequest.model_validate({"workspaceId": "workspace.fixture", "operation": "query", "artifactId": "fixture-context", "localPath": str(path), "mediaType": module.RAG_MEDIA_TYPE, "digest": "sha256:" + corpus["sha256"], "sizeBytes": corpus["bytes"], "query": TOPICS[query_index][0], "maximumResults": 5, "embeddingDevice": args.device, "runtime": {"runtimeWorkingDirectory": str(folder)}})
            started = time.perf_counter()
            result = module.operate_on_context_artifact(request)
            if args.device == "cuda":
                torch.cuda.synchronize()
            elapsed = (time.perf_counter() - started) * 1000
            if list(folder.glob(".rag-lancedb-read-*")):
                raise ValueError("Private materialization cleanup failed.")
            matches = result["matches"]
            if any(item["citation"]["sourceArtifactId"] != "artifact.fixture" or item["citation"]["sourceDigest"] != corpus["source_digest"] for item in matches):
                raise ValueError("Retrieval citation authority failed.")
            recall = len({item["id"] for item in matches} & relevant_ids(query_index)) / 5
            progress["queries"].append({"query_index":query_index,"warmup":args.phase!="memory" and index<5,"milliseconds":elapsed,"recall_at_5":recall})
            save_progress()
            if index == 0:
                cold = elapsed
            if args.phase == "memory" or index >= 5:
                durations.append(elapsed); answers.append(matches); recalls.append(recall)
        expected = "cuda:0" if args.device == "cuda" else "cpu"
        if devices != {expected} or mismatches:
            raise ValueError("Actual embedding tensor placement failed.")
        allocated = torch.cuda.memory_allocated() if args.device == "cuda" else 0
        reserved = torch.cuda.memory_reserved() if args.device == "cuda" else 0
        if allocated>initial_allocated or reserved>initial_reserved:
            raise ValueError(f"Embedding accelerator cleanup failed: allocated={allocated}, reserved={reserved}.")
        environment={"platform":sys.platform,"python":sys.version.split()[0],"torch":torch.__version__,"transformers":importlib.metadata.version("transformers"),"lancedb":lancedb.__version__,"pyarrow":pyarrow.__version__,"cuda_runtime":torch.version.cuda,"accelerator":torch.cuda.get_device_name() if args.device=="cuda" else None,"accelerator_memory_bytes":torch.cuda.get_device_properties(0).total_memory if args.device=="cuda" else 0, "memory_profile":memory_profile_evidence() if args.profile=="constrained-2gib" else {"profile":"physical-reference"}}
        progress["status"]="passed"
        print(json.dumps({"kind": "result", "environment":environment, "cold_ms": cold, "samples_ms": durations, "answers": answers, "recall_at_5": statistics.mean(recalls), "query_recalls": recalls, "actual_tensor_devices": sorted(devices), "peak_vram_bytes": torch.cuda.max_memory_allocated() if args.device == "cuda" else 0, "runtime_vram_floor_bytes":initial_allocated,"runtime_reserved_floor_bytes":initial_reserved,"remaining_vram_bytes":allocated,"remaining_reserved_bytes":reserved,"cleanup_passed":True}), flush=True)
    finally:
        if progress["status"]=="running": progress["status"]="failed"
        save_progress()
        hook.remove()


def child(args, folder):
    if args.profile=="constrained-2gib":
        constrain_current_process()
    model = verified_model(args.model_manifest)
    if args.child == "prepare":
        print(json.dumps({"kind":"ready", "pid":os.getpid(), "parent_pid":os.getppid(), "rss_bytes":rss(os.getpid())}),flush=True)
        if sys.stdin.readline().strip() != "run":
            raise ValueError("Invalid preparation handshake.")
        print(json.dumps({"kind":"result", "corpus":prepare(folder, args.count, model,args.device)}), flush=True)
    else:
        measure(args, folder, model)


def run_child(args, folder, count, mode, variant="candidate", device="cpu", phase="timing",profile="reference"):
    if _UNCONFIRMED_CHILD is not None:
        raise _UNCONFIRMED_CHILD
    command = [sys.executable, "-s", "-B", str(SCRIPT), "--child", mode, "--run-id", folder.name, "--count", str(count), "--variant", variant, "--device", device, "--phase", phase, "--profile",profile,"--samples", str(args.samples), "--model-manifest", args.model_manifest]
    process = subprocess.Popen(command, cwd=ROOT, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding="utf-8", creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
    stderr_tail=[]; readers=[]; native_thread=None; native_result=[]
    try:
        messages = queue.Queue(maxsize=4); overflow = threading.Event()
        def drain(stream, collect):
            total = 0
            while line := stream.readline(1024 * 1024 + 1):
                total += len(line)
                if total > 1024 * 1024:
                    overflow.set(); return
                if collect:
                    try: messages.put_nowait(line)
                    except queue.Full: overflow.set(); return
                else:
                    stderr_tail.append(line)
        readers = [threading.Thread(target=drain, args=(process.stdout, True), daemon=True), threading.Thread(target=drain, args=(process.stderr, False), daemon=True)]
        for reader in readers: reader.start()
        ready = json.loads(messages.get(timeout=60))
        if ready.get("kind") != "ready" or any(type(ready.get(key)) is not int or not 0 < ready[key] <= 0xFFFFFFFF for key in ("pid", "parent_pid")) or (ready["pid"] != process.pid and ready["parent_pid"] != process.pid):
            raise ValueError("Qualification child identity failed.")
        if os.name == "nt":
            native_ready = threading.Event()
            def native():
                try:
                    native_result.append(observe(ready["pid"], native_ready.set, (900 if mode == "prepare" else 600) * 1000 + 30_000))
                except Exception:
                    native_result.append(None)
                    native_ready.set()
            native_thread = threading.Thread(target=native, daemon=True)
            native_thread.start()
            if not native_ready.wait(5) or native_result:
                raise RuntimeError("Owned native child observation unavailable.")
        elif ready["pid"] != process.pid:
            raise ValueError("A distinct native worker cannot be observed on this profile.")
        baseline = peak = ready["rss_bytes"]
        process.stdin.write("run\n"); process.stdin.flush()
        started = time.monotonic()
        while process.poll() is None:
            if overflow.is_set() or time.monotonic() - started > (900 if mode == "prepare" else 600):
                raise RuntimeError("Trained qualification exceeded a bound.")
            try: peak = max(peak, rss(ready["pid"]))
            except OSError: process.wait(timeout=0.25)
            if peak > 4 * 1024 ** 3:
                raise RuntimeError("Qualification child exceeded the fixed 4GiB safety ceiling.")
            time.sleep(0.005)
        for reader in readers: reader.join(timeout=2)
        if overflow.is_set() or any(reader.is_alive() for reader in readers) or process.returncode or physical_exit_code(process, native_thread, native_result) != 0:
            raise RuntimeError("Trained qualification failed.")
        result = json.loads(messages.get(timeout=1))
        if result.get("kind") != "result" or not messages.empty():
            raise ValueError("Qualification output invalid.")
        if mode == "prepare":
            result["corpus"].update(generation_initial_rss_bytes=baseline,generation_peak_rss_bytes=peak,physical_exit_code=0)
            return result["corpus"]
        result.update(baseline_rss_bytes=baseline, peak_rss_bytes=peak, incremental_peak_rss_bytes=max(0, peak-baseline),physical_exit_code=0)
        return result
    finally:
        finish_owned_child(process, readers, native_thread, native_result, stderr_tail, folder, sys.exc_info()[1])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model-manifest", required=True)
    parser.add_argument("--samples", type=int, choices=range(8,31), default=30)
    parser.add_argument("--chunks", nargs="+", type=int, choices=[1000,10000,100000], default=[1000,10000,100000])
    parser.add_argument("--child", choices=["prepare","measure"])
    parser.add_argument("--run-id")
    parser.add_argument("--count", type=int, choices=[1000,10000,100000])
    parser.add_argument("--variant", choices=["baseline","candidate"], default="candidate")
    parser.add_argument("--device", choices=["cpu","cuda"], default="cpu")
    parser.add_argument("--phase", choices=["timing","memory"], default="timing")
    parser.add_argument("--profile",choices=["reference","constrained-2gib"],default="reference")
    args = parser.parse_args()
    run_id = args.run_id if args.child else uuid.uuid4().hex
    if not re.fullmatch(r"[a-f0-9]{32}", str(run_id)):
        raise ValueError("Invalid qualification run identity.")
    folder = ROOT / ".local-codex/trained-context" / run_id
    folder.mkdir(parents=True, exist_ok=bool(args.child))
    if args.child: child(args, folder); return
    verified_model(args.model_manifest)
    source = source_identity()
    report = {"schema_version":"trained-context-qualification-v1", "source_revision":source, "model":MODEL, "revision":REVISION, "baseline_retrieval_commit":BASELINE_COMMIT, "baseline_retrieval_sha256":BASELINE_SHA256, "common_embedding_runtime":"current fixed runtime; identical trained model and device for each matched pair", "precision":"float32", "cpu_threads":4, "seed":17, "warmups":5, "samples":args.samples, "memory_runs":3, "rss_sample_interval_ms":5, "measurement_boundary":"Shared Python/Torch/Lance imports and CUDA context initialization excluded; every timed query includes package hashing/materialization/validation, fresh trained model load/inference, exact search and cleanup. OS file cache warmth uncontrolled; no cross-request model/vector cache.", "heldout_sha256":hashlib.sha256(json.dumps(TOPICS).encode()).hexdigest(), "status":"running", "workloads":[], "attempts":[]}
    def save(): (folder / "report.json").write_text(json.dumps(report,indent=2)+"\n",encoding="utf-8")
    save()
    report["attempts"].append({"phase":"default-cpu-generation","chunks":1000,"status":"running"}); save()
    try:
        report["cpu_default_generation"]=run_child(args,folder,1000,"prepare",device="cpu")
        report["attempts"][-1]["status"]="passed"
    except Exception as error:
        report["attempts"][-1].update(status="failed",error_type=type(error).__name__)
        abort_unconfirmed_child(error, report, save)
    save()
    for count in args.chunks:
        report["attempts"].append({"phase":"prepare","chunks":count,"status":"running"}); save()
        try:
            corpus = run_child(args,folder,count,"prepare",device="cuda")
            report["attempts"][-1]["status"]="passed"; save()
        except Exception as error:
            report["attempts"][-1].update(status="failed",error_type=type(error).__name__)
            abort_unconfirmed_child(error, report, save)
            save(); continue
        for device,profile in [("cpu","reference"),("cuda","reference"),("cpu","constrained-2gib")]:
            item={"chunks":count,"device":device,"profile":profile,"corpus":corpus,"attempts":[]}; report["workloads"].append(item); results={}; save()
            try:
                for variant in ["baseline","candidate"]:
                    item["attempts"].append({"variant":variant,"phase":"timing","status":"running"}); save()
                    timed=run_child(args,folder,count,"measure",variant,device,profile=profile)
                    results[variant]=timed
                    item[variant]={key:value for key,value in timed.items() if key not in ("answers","kind")}
                    item[variant].update(p95_ms=percentile95(timed["samples_ms"]),memory_runs=[])
                    item["attempts"][-1]["status"]="passed"; save()
                    for memory_index in range(3):
                        item["attempts"].append({"variant":variant,"phase":"memory","sample":memory_index,"status":"running"}); save()
                        measured=run_child(args,folder,count,"measure",variant,device,"memory",profile)
                        item[variant]["memory_runs"].append({key:measured[key] for key in ("baseline_rss_bytes","peak_rss_bytes","incremental_peak_rss_bytes","cleanup_passed","physical_exit_code")})
                        item[variant]["incremental_peak_rss_bytes"]=statistics.median(run["incremental_peak_rss_bytes"] for run in item[variant]["memory_runs"])
                        item["attempts"][-1]["status"]="passed"; save()
                item["quality"]=compare(results["baseline"],results["candidate"])
                item["rss_reduction_ratio"]=reduction(item["baseline"]["incremental_peak_rss_bytes"],item["candidate"]["incremental_peak_rss_bytes"])
                item["p95_ratio"]=item["candidate"]["p95_ms"]/item["baseline"]["p95_ms"]
                quality=item["candidate"]["recall_at_5"]>=0.90 and item["candidate"]["recall_at_5"]>=item["baseline"]["recall_at_5"]-0.02
                budget=count==1000 or item["rss_reduction_ratio"]>=0.25 and item["p95_ratio"]<=1.05
                item["status"]="passed" if quality and budget else "failed-quality-or-budget"
            except Exception as error:
                item["status"]="failed"; item["attempts"].append({"status":"failed","error_type":type(error).__name__})
                abort_unconfirmed_child(error, report, save)
            save(); print(json.dumps({"chunks":count,"device":device,"profile":profile,"status":item["status"]}),flush=True)
    report["source_stable"]=source_identity()==source
    try:
        verified_model(args.model_manifest)
        packages=[item["corpus"] for item in report["workloads"]]
        if report.get("cpu_default_generation"): packages.append(report["cpu_default_generation"])
        report["inputs_stable"]=all(sha256_file(folder/item["path"])==item["sha256"] for item in packages)
    except (ValueError,OSError): report["inputs_stable"]=False
    successful=report["source_stable"] and report["inputs_stable"] and "cpu_default_generation" in report and len(report["workloads"])==len(args.chunks)*3 and all(item["status"]=="passed" for item in report["workloads"])
    complete=args.samples==30 and set(args.chunks)=={1000,10000,100000} and len(args.chunks)==3
    report["qualification_complete"]=successful and complete
    report["status"]=("passed" if complete else "diagnostic-passed") if successful else "failed"
    save(); print(json.dumps({"status":report["status"],"report":str((folder/"report.json").relative_to(ROOT)).replace("\\","/")}),flush=True)
    if not successful: raise SystemExit(1)


if __name__ == "__main__": main()
