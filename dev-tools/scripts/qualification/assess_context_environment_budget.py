"""Assess the explicitly approved environment alternative on a fresh full matrix.

This never rewrites the original25percent gate, raw results or earlier failures.
Run the full existing trained Context matrix on final source before this command.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import math
from pathlib import Path
import re
import stat
import statistics
import sys

SCRIPT = Path(__file__).resolve()
ROOT = SCRIPT.parents[3]
sys.path.insert(0, str(SCRIPT.parent))
import run_trained_context_qualification as trained

RSS_BUDGET = 2 * 1024**3
VRAM_BUDGET = 512 * 1024**2
APPROVAL = "user-approved-existing-context-environment-alternative-2026-10-22"
ENVIRONMENT = {"platform": "win32", "python": "3.12.8", "torch": "2.6.0+cu126", "transformers": "4.51.3",
               "lancedb": "0.34.0", "pyarrow": "25.0.0", "cuda_runtime": "12.6"}
ACCELERATOR = "NVIDIA GeForce RTX 4060"
ACCELERATOR_BYTES = 8585216000


def bounded_report_bytes(target):
    with target.open("rb") as source: raw = source.read(8 * 1024**2 + 1)
    if len(raw) > 8 * 1024**2: raise ValueError("Oversized evidence refused.")
    return raw


def assess(data, expected_source):
    def require(value, message):
        if not value: raise ValueError(message)
    def bounded(value, maximum): return type(value) is int and 0 <= value <= maximum
    def exited(value): return type(value) is int and value == 0
    require(data.get("schema_version") == "trained-context-qualification-v1" and data.get("source_revision") == expected_source,
            "Wrong source or protocol.")
    require(data.get("model") == trained.MODEL and data.get("revision") == trained.REVISION
            and data.get("baseline_retrieval_commit") == trained.BASELINE_COMMIT
            and data.get("baseline_retrieval_sha256") == trained.BASELINE_SHA256, "Wrong fixed model or baseline.")
    require(data.get("source_stable") is True and data.get("inputs_stable") is True and not data.get("cleanup_pending"), "Unstable or uncertain run.")
    require(data.get("status") in {"passed", "failed"}, "Nonterminal report refused.")
    require(data.get("precision") == "float32" and data.get("cpu_threads") == 4 and data.get("seed") == 17
            and data.get("samples") == 30 and data.get("warmups") == 5 and data.get("memory_runs") == 3
            and data.get("rss_sample_interval_ms") == 5, "Incomplete fixed matrix.")
    require(data.get("heldout_sha256") == hashlib.sha256(json.dumps(trained.TOPICS).encode()).hexdigest(), "Wrong fixed query population.")
    default_corpus = data.get("cpu_default_generation", {})
    require(exited(default_corpus.get("physical_exit_code")) and default_corpus.get("chunks") == 1000
            and default_corpus.get("dimensions") == 384 and default_corpus.get("generation_device") == "cpu-default"
            and default_corpus.get("actual_tensor_devices") == ["cpu"], "Default CPU generation missing.")
    attempts = data.get("attempts", [])
    require(attempts == [{"phase": "default-cpu-generation", "chunks": 1000, "status": "passed"}]
            + [{"phase": "prepare", "chunks": count, "status": "passed"} for count in (1000, 10000, 100000)], "Preparation matrix incomplete.")
    workloads = data.get("workloads", [])
    expected = {(count, device, profile) for count in (1000, 10000, 100000)
                for device, profile in (("cpu", "reference"), ("cuda", "reference"), ("cpu", "constrained-2gib"))}
    actual = [(item.get("chunks"), item.get("device"), item.get("profile")) for item in workloads]
    require(len(actual) == 9 and set(actual) == expected, "Missing or duplicate cohorts.")
    outcomes = []
    for item in workloads:
        schedule = []
        for variant in ("baseline", "candidate"):
            schedule.append({"variant": variant, "phase": "timing", "status": "passed"})
            schedule.extend({"variant": variant, "phase": "memory", "sample": index, "status": "passed"} for index in range(3))
        require(item.get("status") in {"passed", "failed-quality-or-budget"}
                and item.get("attempts") == schedule, "Execution matrix incomplete.")
        require(exited(item.get("corpus", {}).get("physical_exit_code")), "Corpus preparation exit unconfirmed.")
        require(item["corpus"].get("chunks") == item["chunks"] and item["corpus"].get("dimensions") == (128 if item["chunks"] == 100000 else 384)
                and item["corpus"].get("generation_device") == "cuda"
                and item["corpus"].get("actual_tensor_devices") == ["cuda:0"], "Corpus scale or generation device differs.")
        source_digest = item["corpus"].get("source_digest")
        require(isinstance(source_digest, str) and re.fullmatch(r"sha256:[a-f0-9]{64}", source_digest), "Corpus source binding missing.")
        values = {}
        for variant in ("baseline", "candidate"):
            arm = item.get(variant, {})
            require(len(arm.get("memory_runs", [])) == 3, "Fresh memory repetitions missing.")
            require(len(arm.get("samples_ms", [])) == 30 and all(type(value) in (int, float) and math.isfinite(value) and value > 0 for value in arm["samples_ms"]), "Invalid timing samples.")
            require(len(arm.get("answers", [])) == 30 and all(len(answer) == 5 for answer in arm["answers"]), "Returned result sets missing.")
            require(all(row.get("citation", {}).get("sourceArtifactId") == "artifact.fixture"
                        and row["citation"].get("sourceDigest") == source_digest
                        for answer in arm["answers"] for row in answer), "Result citation authority differs.")
            recalls = [len({row["id"] for row in answer} & trained.relevant_ids((index + 5) % len(trained.TOPICS))) / 5
                       for index, answer in enumerate(arm["answers"])]
            recall = statistics.mean(recalls)
            require(arm.get("query_recalls") == recalls and arm.get("recall_at_5") == recall, "Recall evidence differs from results.")
            peaks = []
            for observed in (arm, *arm["memory_runs"]):
                require(exited(observed.get("physical_exit_code")) and observed.get("cleanup_passed") is True, "Unconfirmed exit or cleanup.")
                require(bounded(observed.get("peak_rss_bytes"), RSS_BUDGET) and observed["peak_rss_bytes"] > 0, "Process RSS budget exceeded or missing.")
                require(bounded(observed.get("peak_vram_bytes"), VRAM_BUDGET) and bounded(observed.get("peak_reserved_vram_bytes"), VRAM_BUDGET), "Query VRAM budget exceeded or missing.")
                require(observed["peak_vram_bytes"] <= observed["peak_reserved_vram_bytes"]
                        and (observed["peak_vram_bytes"] > 0 if item["device"] == "cuda" else observed["peak_reserved_vram_bytes"] == 0), "Contradictory query VRAM observations.")
                require(observed.get("actual_tensor_devices") == ["cuda:0" if item["device"] == "cuda" else "cpu"], "Execution device differs.")
                require(bounded(observed.get("runtime_vram_floor_bytes"), VRAM_BUDGET) and bounded(observed.get("runtime_reserved_floor_bytes"), VRAM_BUDGET)
                        and bounded(observed.get("remaining_vram_bytes"), VRAM_BUDGET) and bounded(observed.get("remaining_reserved_bytes"), VRAM_BUDGET)
                        and observed["remaining_vram_bytes"] <= observed.get("runtime_vram_floor_bytes", -1)
                        and observed["remaining_reserved_bytes"] <= observed.get("runtime_reserved_floor_bytes", -1), "Accelerator release unconfirmed.")
                require(observed["runtime_vram_floor_bytes"] <= observed["runtime_reserved_floor_bytes"]
                        and observed["remaining_vram_bytes"] <= observed["remaining_reserved_bytes"]
                        and (item["device"] == "cuda" or observed["runtime_reserved_floor_bytes"] == observed["remaining_reserved_bytes"] == 0), "Contradictory release observations.")
                environment = observed.get("environment", {})
                require(all(environment.get(key) == value for key, value in ENVIRONMENT.items()), "Named host/runtime contract differs.")
                require(environment.get("accelerator") == (ACCELERATOR if item["device"] == "cuda" else None)
                        and type(environment.get("accelerator_memory_bytes")) is int
                        and environment["accelerator_memory_bytes"] == (ACCELERATOR_BYTES if item["device"] == "cuda" else 0), "Named accelerator contract differs.")
                profile = environment.get("memory_profile", {})
                if item["profile"] == "constrained-2gib":
                    require(profile.get("profile") == "windows-owned-job-2gib" and profile.get("enforced") is True
                            and profile.get("process_commit_limit_bytes") == RSS_BUDGET and profile.get("job_commit_limit_bytes") == RSS_BUDGET
                            and bounded(profile.get("peak_process_commit_bytes"), RSS_BUDGET) and profile["peak_process_commit_bytes"] > 0
                            and bounded(profile.get("peak_job_commit_bytes"), RSS_BUDGET) and profile["peak_job_commit_bytes"] > 0, "Constrained CPU enforcement missing.")
                else: require(profile == {"profile": "physical-reference"}, "Reference environment differs.")
                peaks.append(observed["peak_rss_bytes"])
            values[variant] = {"recall": recall, "p95_ms": trained.percentile95(arm["samples_ms"]), "maximum_rss_bytes": max(peaks)}
        exact = trained.compare(item["baseline"], item["candidate"])
        require(item.get("quality") == exact, "Exact-result digest differs.")
        require(values["candidate"]["recall"] >= .9 and values["candidate"]["recall"] >= values["baseline"]["recall"] - .02, "Recall gate failed.")
        ratio = values["candidate"]["p95_ms"] / values["baseline"]["p95_ms"]
        require(ratio <= 1.05, "P95 latency gate failed.")
        outcomes.append({"chunks": item["chunks"], "device": item["device"], "profile": item["profile"], "values": values,
                         "p95_ratio": ratio, "exact": exact, "original_status_preserved": item.get("status"), "approved_environment_passed": True})
    return {"schema_version": "context-environment-budget-assessment-v1", "source_revision": expected_source,
            "approval_ref": APPROVAL, "process_rss_budget_bytes": RSS_BUDGET, "query_allocated_reserved_vram_budget_bytes": VRAM_BUDGET,
            "qualification_complete": True, "cohorts": outcomes,
            "scope": "Only Context existing approved environment-budget alternative; original25percent results remain unchanged. No generative-model, other hardware or security qualification."}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--report", required=True); parser.add_argument("--expected-source", required=True)
    args = parser.parse_args()
    if not re.fullmatch(r"\.local-codex/trained-context/[a-f0-9]{32}/report\.json", args.report) or not re.fullmatch(r"source\.[a-f0-9]{64}", args.expected_source):
        raise ValueError("Fixed current-source report required.")
    target = ROOT / args.report
    for path in (target, *target.parents):
        facts = path.lstat()
        if stat.S_ISLNK(facts.st_mode) or getattr(facts, "st_file_attributes", 0) & 0x400: raise ValueError("Redirected evidence refused.")
    if not target.is_file() or trained.source_identity() != args.expected_source: raise ValueError("Current source differs.")
    raw = bounded_report_bytes(target)
    digest = hashlib.sha256(raw).hexdigest()
    result = assess(json.loads(raw.decode("utf-8")), args.expected_source)
    if trained.source_identity() != args.expected_source or hashlib.sha256(bounded_report_bytes(target)).hexdigest() != digest: raise ValueError("Evidence changed during assessment.")
    result.update(raw_report=args.report, raw_report_sha256=digest, assessor_sha256=trained.sha256_file(SCRIPT))
    with target.with_name("approved-budget-assessment.json").open("x", encoding="utf-8") as output:
        output.write(json.dumps(result, indent=2) + "\n")
    print(json.dumps({"qualification_complete": True, "report": str(target.with_name("approved-budget-assessment.json").relative_to(ROOT)).replace("\\", "/")}), flush=True)


if __name__ == "__main__": main()
