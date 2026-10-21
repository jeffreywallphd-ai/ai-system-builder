"""Exact synthetic Context comparison; no models, credentials or content caches.

Run with the repository-pinned Context dependencies. All generated material is
synthetic and confined to an ignored, uniquely named local qualification run.
"""
from __future__ import annotations

import argparse
from contextlib import contextmanager
import ctypes
import hashlib
import importlib.util
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

ROOT = Path(__file__).resolve().parents[3]
SOURCE = "modules/adapters/runtime/python/worker/tasks/context_artifact_operation.py"
BASELINE_COMMIT = "9a681ef79356e6b9a7aac7b30cd46040f85f07b4"
BASELINE_SHA256 = "24a98c96a5f9db75d776dc115abf43ef84ae4dce0a308217d0f357ae60bce30b"
sys.path.insert(0, str(ROOT))


def digest(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def run_root(run_id: str) -> Path:
    if not re.fullmatch(r"[a-f0-9]{32}", run_id):
        raise ValueError("Invalid qualification run identity.")
    path = ROOT / ".local-codex" / "context-efficiency" / run_id
    path.resolve(strict=False).relative_to(ROOT.resolve())
    path.mkdir(parents=True, exist_ok=True)
    path.resolve().relative_to(ROOT.resolve())
    return path


def rss(pid: int) -> int:
    """Numeric working set only, for the launched qualification child."""
    if os.name != "nt":
        return int(Path(f"/proc/{pid}/statm").read_text().split()[1]) * os.sysconf("SC_PAGE_SIZE")

    class Counters(ctypes.Structure):
        _fields_ = [("cb", ctypes.c_ulong), ("faults", ctypes.c_ulong)] + [(name, ctypes.c_size_t) for name in ("peak", "working", "pool_peak", "pool", "nonpaged_peak", "nonpaged", "pagefile", "pagefile_peak")]

    kernel, psapi = ctypes.WinDLL("kernel32", use_last_error=True), ctypes.WinDLL("psapi", use_last_error=True)
    kernel.OpenProcess.argtypes = [ctypes.c_ulong, ctypes.c_int, ctypes.c_ulong]
    kernel.OpenProcess.restype = ctypes.c_void_p
    kernel.CloseHandle.argtypes = [ctypes.c_void_p]
    psapi.GetProcessMemoryInfo.argtypes = [ctypes.c_void_p, ctypes.POINTER(Counters), ctypes.c_ulong]
    handle = kernel.OpenProcess(0x0400 | 0x0010, False, pid)
    if not handle:
        raise OSError("Qualification memory sampling is unavailable.")
    try:
        counters = Counters(); counters.cb = ctypes.sizeof(counters)
        if not psapi.GetProcessMemoryInfo(handle, ctypes.byref(counters), counters.cb):
            raise OSError("Qualification memory sampling is unavailable.")
        return int(counters.working)
    finally:
        kernel.CloseHandle(handle)


def load_runtime(variant: str, folder: Path):
    if variant == "candidate":
        from modules.adapters.runtime.python.worker.tasks import context_artifact_operation
        return context_artifact_operation
    source = subprocess.run(["git", "show", f"{BASELINE_COMMIT}:{SOURCE}"], cwd=ROOT, capture_output=True, timeout=10, check=True).stdout
    if digest(source) != BASELINE_SHA256:
        raise ValueError("Unchanged baseline source verification failed.")
    path = folder / "verified_baseline.py"
    path.write_bytes(source)
    name = "modules.adapters.runtime.python.worker.tasks._qualification_baseline"
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def dimensions_for(count: int) -> int:
    # A single 100k x 384 float32 Lance file exceeds the unchanged 128MiB
    # member ceiling. Compare an explicitly separate, supported 128D cohort.
    return 128 if count == 100000 else 384


def vector(topic: int, dimensions: int) -> list[float]:
    return [1.0 if index == topic else 0.0 for index in range(dimensions)]


def prepare(folder: Path, count: int) -> dict:
    from modules.adapters.runtime.python.worker.tasks.context_generation import ContextChunk, _write_rag_database, RAG_MEDIA_TYPE
    path = folder / f"corpus-{count}.lancedb.zip"
    dimensions = dimensions_for(count)
    source_digest = "sha256:" + digest(f"synthetic-context-v1:{count}".encode())
    chunks = [ContextChunk(id=f"fixture-{i:06d}", text=f"Synthetic qualification passage {i}.", citation={"sourceArtifactId": "fixture-source", "sourceDigest": source_digest, "chunkIndex": i}) for i in range(count)]
    prototypes = [vector(index, dimensions) for index in range(dimensions)]
    vectors = [prototypes[i // 5 if i < 40 else 32 + i % (dimensions - 32)] for i in range(count)]
    manifest = {"schemaVersion": "1", "kind": "rag-database", "name": "Synthetic qualification", "mediaType": RAG_MEDIA_TYPE, "createdAt": "2026-10-21T00:00:00Z", "sources": [{"artifactId": "fixture-source", "digest": source_digest, "mediaType": "text/plain", "sizeBytes": count * 64, "chunkCount": count, "chunkingMode": "extracted"}], "manualEntries": [], "chunking": {"strategy": "fixed-length", "chunkCharacters": 256, "overlapCharacters": 0}, "embedding": {"provider": "transformers", "modelId": "synthetic/deterministic-one-hot-v1", "dimensions": dimensions}}
    manifest["embedding"]["dimensions"] = dimensions
    _write_rag_database(path, chunks, vectors, manifest)
    result = {"path": path.name, "bytes": path.stat().st_size, "sha256": digest(path.read_bytes()), "chunks": count, "dimensions": dimensions, "corpus_id": f"synthetic-context-v1-{count}-{dimensions}d"}
    (folder / f"corpus-{count}.json").write_text(json.dumps(result), encoding="utf-8")
    return result


def child(args) -> None:
    folder = run_root(args.run_id)
    if args.child == "prepare":
        print(json.dumps(prepare(folder, args.chunks[0])), flush=True)
        return
    import lancedb  # Initialize the native event loop before memory sampling.
    from modules.adapters.runtime.python.worker.models import ContextArtifactOperationTaskRequest
    module = load_runtime(args.variant, folder)
    corpus = json.loads((folder / f"corpus-{args.chunks[0]}.json").read_text())
    path = folder / corpus["path"]
    stages = {}

    class TimedQuery:
        def __init__(self, query):
            self.query = query

        def distance_type(self, *values):
            self.query = self.query.distance_type(*values); return self

        def bypass_vector_index(self):
            self.query = self.query.bypass_vector_index(); return self

        def select(self, *values):
            self.query = self.query.select(*values); return self

        def limit(self, *values):
            self.query = self.query.limit(*values); return self

        def to_arrow(self):
            started = time.perf_counter()
            try:
                return self.query.to_arrow()
            finally:
                stages["exact_search"] = (time.perf_counter() - started) * 1000

    class TimedTable:
        def __init__(self, table):
            self.table = table

        def search(self, *values, **keywords):
            return TimedQuery(self.table.search(*values, **keywords))

    for name, label in [("_validated_input_path", "path_digest"), ("_validated_rag_table", "table_validation")]:
        original = getattr(module, name)

        def wrapped(*values, _original=original, _label=label, **keywords):
            started = time.perf_counter()
            try:
                result = _original(*values, **keywords)
                if _label == "table_validation":
                    database, table, rows, dimensions = result
                    return database, TimedTable(table), rows, dimensions
                return result
            finally:
                stages[_label] = stages.get(_label, 0.0) + (time.perf_counter() - started) * 1000

        setattr(module, name, wrapped)
    original_materialize = module._materialized_rag

    @contextmanager
    def materialize(*values):
        entered = time.perf_counter(); cleanup_started = None
        try:
            with original_materialize(*values) as value:
                stages["materialize"] = (time.perf_counter() - entered) * 1000
                try:
                    yield value
                finally:
                    cleanup_started = time.perf_counter()
        finally:
            if cleanup_started is not None:
                stages["cleanup"] = (time.perf_counter() - cleanup_started) * 1000

    module._materialized_rag = materialize

    def embedding(texts, _settings):
        started = time.perf_counter()
        values = [vector(int(text.rsplit("-", 1)[1]), corpus["dimensions"]) for text in texts]
        stages["embedding"] = (time.perf_counter() - started) * 1000
        return values

    print(json.dumps({"kind": "ready", "pid": os.getpid(), "parent_pid": os.getppid(), "rss_bytes": rss(os.getpid())}), flush=True)
    if sys.stdin.readline().strip() != "run":
        raise ValueError("Qualification handshake failed.")
    samples, answers, stage_samples = [], [], []
    iterations = 1 if args.phase == "memory" else 5 + args.samples
    for index in range(iterations):
        stages.clear()
        request = ContextArtifactOperationTaskRequest.model_validate({"workspaceId": "workspace.fixture", "operation": "query", "artifactId": "fixture-context", "localPath": str(path), "mediaType": module.RAG_MEDIA_TYPE, "digest": "sha256:" + corpus["sha256"], "sizeBytes": corpus["bytes"], "query": f"topic-{index % 8}", "maximumResults": 5, "runtime": {"runtimeWorkingDirectory": str(folder)}})
        started = time.perf_counter()
        result = module.operate_on_context_artifact(request, embedding_provider=embedding)
        duration = (time.perf_counter() - started) * 1000
        if list(folder.glob(".rag-lancedb-read-*")):
            raise ValueError("Private materialization cleanup did not complete.")
        expected = {f"fixture-{index % 8 * 5 + i:06d}" for i in range(5)}
        if {match["id"] for match in result["matches"]} != expected:
            raise ValueError("Synthetic exact retrieval quality failed.")
        if index == 0:
            cold_ms = duration
        if args.phase == "memory" or index >= 5:
            samples.append(duration); answers.append(result["matches"]); stage_samples.append(dict(stages))
    print(json.dumps({"kind": "result", "cold_ms": cold_ms, "samples_ms": samples, "stages_ms": stage_samples, "answers": answers, "cleanup_passed": True}), flush=True)


def run_child(args, folder: Path, count: int, mode: str, variant="candidate", phase="timing") -> dict:
    command = [sys.executable, "-B", str(Path(__file__).resolve()), "--child", mode, "--run-id", folder.name, "--chunks", str(count), "--variant", variant, "--phase", phase, "--samples", str(args.samples)]
    process = subprocess.Popen(command, cwd=ROOT, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding="utf-8", creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
    try:
        if mode == "prepare":
            output, _error = process.communicate(timeout=120)
            if process.returncode:
                raise RuntimeError("Synthetic package preparation failed within existing limits.")
            return json.loads(output)
        messages = queue.Queue(maxsize=4)
        overflow = threading.Event()

        def drain(stream, collect):
            total = 0
            while line := stream.readline(1024 * 1024 + 1):
                total += len(line)
                if total > 1024 * 1024:
                    overflow.set(); return
                if collect:
                    try:
                        messages.put_nowait(line)
                    except queue.Full:
                        overflow.set(); return

        readers = [threading.Thread(target=drain, args=(process.stdout, True), daemon=True), threading.Thread(target=drain, args=(process.stderr, False), daemon=True)]
        for reader in readers:
            reader.start()
        line = messages.get(timeout=30)
        ready = json.loads(line)
        if ready.get("kind") != "ready" or (ready["pid"] != process.pid and ready["parent_pid"] != process.pid):
            raise ValueError("Qualification child identity is invalid.")
        baseline_rss = ready["rss_bytes"]; peak = baseline_rss
        process.stdin.write("run\n"); process.stdin.flush()
        started = time.monotonic()
        while process.poll() is None:
            if overflow.is_set():
                raise RuntimeError("Qualification output exceeded its bound.")
            if time.monotonic() - started > 180:
                raise TimeoutError("Qualification operation exceeded its time budget.")
            try:
                peak = max(peak, rss(ready["pid"]))
            except OSError:
                process.wait(timeout=0.25)  # The Windows venv redirector may outlive its child briefly.
            if peak > 3 * 1024 ** 3:
                raise RuntimeError("Qualification process exceeded its memory budget.")
            time.sleep(0.005)
        for reader in readers:
            reader.join(timeout=2)
        if overflow.is_set() or any(reader.is_alive() for reader in readers):
            raise RuntimeError("Qualification output is unavailable.")
        if process.returncode:
            raise RuntimeError("Qualification operation failed.")
        result = json.loads(messages.get(timeout=1))
        if result.get("kind") != "result" or not messages.empty():
            raise ValueError("Qualification returned unexpected output.")
        result.update({"baseline_rss_bytes": baseline_rss, "peak_rss_bytes": peak, "incremental_peak_rss_bytes": max(0, peak - baseline_rss)})
        return result
    finally:
        if process.poll() is None:
            if os.name == "nt":
                subprocess.run(["taskkill", "/PID", str(process.pid), "/T", "/F"], capture_output=True, timeout=10)
            else:
                process.kill()
            process.wait(timeout=10)
        for stream in (process.stdin, process.stdout, process.stderr):
            stream.close()


def compare(baseline: dict, candidate: dict) -> dict:
    left, right = baseline["answers"], candidate["answers"]
    if len(left) != len(right):
        raise ValueError("Quality samples differ.")
    delta = 0.0
    for expected, actual in zip(left, right, strict=True):
        if len(expected) != len(actual):
            raise ValueError("Exact result counts differ.")
        for before, after in zip(expected, actual, strict=True):
            if any(isinstance(score, bool) or not isinstance(score, (int, float)) or not math.isfinite(score) for score in (before.get("score"), after.get("score"))):
                raise ValueError("Exact numerical tolerance failed.")
            if {k: v for k, v in before.items() if k != "score"} != {k: v for k, v in after.items() if k != "score"}:
                raise ValueError("Exact result identities, order or citations differ.")
            delta = max(delta, abs(before["score"] - after["score"]))
    if not math.isfinite(delta) or delta > 1e-6:
        raise ValueError("Exact numerical tolerance failed.")
    return {"identities_order_citations_equal": True, "maximum_score_delta": delta, "answer_sha256": digest(json.dumps(left, sort_keys=True).encode())}


def percentile95(values):
    return sorted(values)[math.ceil(len(values) * 0.95) - 1]


def reduction(baseline: float, candidate: float) -> float:
    if any(isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or value <= 0 for value in (baseline, candidate)):
        raise ValueError("Positive measured RSS is required for qualification.")
    return 1 - candidate / baseline


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--chunks", nargs="+", type=int, choices=[1000, 10000, 100000], default=[1000, 10000, 100000])
    parser.add_argument("--samples", type=int, choices=range(5, 31), default=20)
    parser.add_argument("--child", choices=["prepare", "measure"])
    parser.add_argument("--run-id")
    parser.add_argument("--variant", choices=["baseline", "candidate"], default="candidate")
    parser.add_argument("--phase", choices=["timing", "memory"], default="timing")
    args = parser.parse_args()
    if args.child:
        child(args); return
    folder = run_root(uuid.uuid4().hex)
    import lancedb
    import pyarrow
    report = {"schema_version": "context-efficiency-qualification-v1", "environment": {"profile": "local-native-deterministic-fixture", "platform": sys.platform, "python": sys.version.split()[0], "lancedb": lancedb.__version__, "pyarrow": pyarrow.__version__, "model": "deterministic-one-hot-v1", "model_load_ms": None, "artifact_storage_retrieve_ms": None, "os_file_cache_state": "uncontrolled", "rss_sample_interval_ms": 5}, "baseline": {"commit": BASELINE_COMMIT, "source_sha256_normalized": BASELINE_SHA256}, "candidate_source_sha256": digest((ROOT / SOURCE).read_bytes()), "probe_source_sha256": digest(Path(__file__).read_bytes()), "warmups": 5, "samples": args.samples, "workloads": [], "pending": ["Representative real local embedding-model CPU/accelerator timing, memory and labeled recall qualification.", "Host artifact-storage retrieval latency lies outside this worker-local measurement boundary."]}
    for count in args.chunks:
        item = {"chunks": count, "attempts": []}
        try:
            item["corpus"] = run_child(args, folder, count, "prepare")
            results = {}
            for variant in ("baseline", "candidate"):
                timed = run_child(args, folder, count, "measure", variant)
                memory = [run_child(args, folder, count, "measure", variant, "memory") for _ in range(3)]
                results[variant] = timed
                item[variant] = {"cold_ms": timed["cold_ms"], "samples_ms": timed["samples_ms"], "p50_ms": statistics.median(timed["samples_ms"]), "p95_ms": percentile95(timed["samples_ms"]), "stages_ms": timed["stages_ms"], "memory_runs": [{key: run[key] for key in ("baseline_rss_bytes", "peak_rss_bytes", "incremental_peak_rss_bytes", "cleanup_passed")} for run in memory], "incremental_peak_rss_bytes": statistics.median(run["incremental_peak_rss_bytes"] for run in memory)}
                item["attempts"].append({"variant": variant, "status": "passed", "memory_runs": 3, "timing_samples": args.samples})
            item["quality"] = compare(results["baseline"], results["candidate"])
            item["rss_reduction_ratio"] = reduction(item["baseline"]["incremental_peak_rss_bytes"], item["candidate"]["incremental_peak_rss_bytes"])
            item["p95_ratio"] = item["candidate"]["p95_ms"] / item["baseline"]["p95_ms"]
            item["status"] = "passed" if count == 1000 or item["rss_reduction_ratio"] >= 0.25 and item["p95_ratio"] <= 1.05 else "failed-budget"
        except Exception as error:
            item["status"] = "unavailable" if "corpus" not in item else "failed"
            item["attempts"].append({"status": item["status"], "error_type": type(error).__name__})
        report["workloads"].append(item)
        (folder / "report.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
        print(json.dumps({"chunks": count, "status": item["status"], "rss_reduction_ratio": item.get("rss_reduction_ratio"), "p95_ratio": item.get("p95_ratio")}), flush=True)
    print(json.dumps({"report": (folder / "report.json").relative_to(ROOT).as_posix()}), flush=True)
    if any(item["status"] != "passed" for item in report["workloads"]):
        raise SystemExit(1)


if __name__ == "__main__":
    main()
