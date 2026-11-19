"""Regrade a fresh fixed Context worker matrix; never run model inference."""
from __future__ import annotations
import hashlib
import importlib.metadata
import json
import math
import os
from pathlib import Path
import re
import statistics
import stat
import subprocess
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))
import run_trained_context_qualification as qualification
from trained_context_fixture import TOPICS, relevant_ids, rows

REPORT = "docs/operations/headless-context-increment-qualification.json"
LABELS = ("cpu-reference", "cpu-repeat", "cpu-constrained", "cuda-reference", "cuda-repeat")
PAIRS = ((LABELS[0], LABELS[1]), (LABELS[0], LABELS[2]), (LABELS[3], LABELS[4]))
THRESHOLDS = {"recall_at_5_minimum": .90, "maximum_recall_loss": .02, "score_tolerance": 1e-6,
              "sampled_query_rss_bytes": 2 * 1024 ** 3, "torch_query_vram_bytes": 512 * 1024 ** 2}


def require(condition):
    if not condition:
        raise ValueError("Context qualification evidence is invalid or stale.")


def bounded_json(root, relative, pattern, maximum=2 * 1024 ** 2):
    require(isinstance(relative, str) and re.fullmatch(pattern, relative) is not None)
    target = root / relative
    ancestors = {}
    for component in (target, *target.parents):
        if component == root:
            break
        info = component.lstat()
        require(not stat.S_ISLNK(info.st_mode) and not getattr(info, "st_file_attributes", 0) & 0x400)
        ancestors[component] = (info.st_dev, info.st_ino)
    def identity(info):
        # Python3.12 Windows path stat exposes birth time as ctime, while fstat
        # exposes change time. Compare common fields across the two APIs and
        # retain each API's ctime for its own before/after check.
        return (info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns)
    before = target.lstat()
    require(stat.S_ISREG(before.st_mode) and 0 < before.st_size <= maximum)
    descriptor = os.open(target, os.O_RDONLY | getattr(os, "O_BINARY", 0) | getattr(os, "O_NOFOLLOW", 0))
    try:
        opened = os.fstat(descriptor)
        require(stat.S_ISREG(opened.st_mode) and identity(opened) == identity(before))
        raw = bytearray()
        while len(raw) <= maximum:
            block = os.read(descriptor, maximum + 1 - len(raw))
            if not block:
                break
            raw.extend(block)
        require(len(raw) <= maximum and len(raw) == before.st_size)
        after_fd, after_path = os.fstat(descriptor), target.lstat()
        require(identity(after_fd) == identity(before) == identity(after_path))
        require(opened.st_ctime_ns == after_fd.st_ctime_ns and before.st_ctime_ns == after_path.st_ctime_ns)
        for component, expected in ancestors.items():
            info = component.lstat()
            require((info.st_dev, info.st_ino) == expected and not stat.S_ISLNK(info.st_mode)
                    and not getattr(info, "st_file_attributes", 0) & 0x400)
    finally:
        os.close(descriptor)
    def pairs(items):
        value = {}
        for key, item in items:
            require(key not in value)
            value[key] = item
        return value
    def invalid_constant(_):
        raise ValueError("Non-finite evidence is forbidden.")
    return json.loads(raw, object_pairs_hook=pairs, parse_constant=invalid_constant), hashlib.sha256(raw).hexdigest()


def validate_report(report, source, baseline, versions=None):
    require(isinstance(report, dict) and report.get("schema_version") == "approved-context-query-qualification-v1")
    require(report.get("status") == "worker-targets-met" and report.get("qualification_complete") is False)
    require(report.get("source_revision") == source and report.get("source_stable") is True and report.get("model_stable") is True)
    require((report.get("model"), report.get("revision"), report.get("model_files")) ==
            (qualification.MODEL, qualification.REVISION, qualification.FILES))
    require((report.get("chunks"), report.get("warmups"), report.get("samples"), report.get("seed"), report.get("cpu_threads")) == (1000, 5, 8, 17, 4))
    require(report.get("thresholds") == THRESHOLDS and report.get("recorded_ordinary_baseline") == baseline)
    require(report.get("helper_sha256") == qualification.sha256_file(qualification.SCRIPT))
    require(report.get("fixture_sha256") == qualification.sha256_file(qualification.SCRIPT.parent / "trained_context_fixture.py"))
    require(report.get("heldout_sha256") == hashlib.sha256(json.dumps(TOPICS).encode()).hexdigest())
    corpus = list(rows(1000))
    corpus_digest = hashlib.sha256(b"".join((json.dumps(row, separators=(",", ":")) + "\n").encode() for row in corpus)).hexdigest()
    attempts = report.get("attempts")
    require(isinstance(attempts, list) and len(attempts) == 6)
    require(all(isinstance(entry, dict) for entry in attempts))
    require([entry.get("label") for entry in attempts] == ["cpu-generation", *LABELS])
    require(all(entry.get("status") == "observed" for entry in attempts))
    generated = attempts[0]
    require((generated.get("device"), generated.get("profile")) == ("cpu", "reference"))
    generation = generated["result"]
    require(isinstance(generation, dict))
    require(type(generation.get("physical_exit_code")) is int and generation["physical_exit_code"] == 0)
    require((generation.get("corpus_sha256"), generation.get("source_digest"), generation.get("chunks"), generation.get("dimensions"), generation.get("actual_tensor_devices")) ==
            (corpus_digest, "sha256:" + corpus_digest, 1000, 384, ["cpu"]))
    results = {}
    for entry in attempts[1:]:
        device = "cuda" if entry["label"].startswith("cuda") else "cpu"
        profile = "constrained-2gib" if entry["label"] == "cpu-constrained" else "reference"
        require((entry.get("device"), entry.get("profile")) == (device, profile))
        result = entry["result"]
        require(qualification.approved_query_targets_met(result, device, profile, baseline[device]))
        require(isinstance(result.get("environment"), dict))
        if versions is not None:
            require(all(result["environment"].get(key) == value for key, value in versions.items()))
        baseline_rss, peak_rss, incremental_rss = (result.get(key) for key in ("baseline_rss_bytes", "peak_rss_bytes", "incremental_peak_rss_bytes"))
        require(all(type(value) is int for value in (baseline_rss, peak_rss, incremental_rss)))
        require(0 < baseline_rss <= peak_rss and incremental_rss == peak_rss - baseline_rss)
        for kind in ("vram", "reserved"):
            remaining = result.get("remaining_vram_bytes" if kind == "vram" else "remaining_reserved_bytes")
            floor = result.get("runtime_vram_floor_bytes" if kind == "vram" else "runtime_reserved_floor_bytes")
            peak = result.get("peak_vram_bytes" if kind == "vram" else "peak_reserved_vram_bytes")
            require(all(type(value) is int for value in (remaining, floor, peak)) and 0 <= remaining <= floor <= peak)
            require(device != "cpu" or (remaining, floor, peak) == (0, 0, 0))
        answers = result.get("answers")
        require(isinstance(answers, list) and len(answers) == 8)
        recalls = []
        for sample, matches in enumerate(answers):
            require(isinstance(matches, list) and len(matches) == 5)
            seen = set()
            for item in matches:
                require(isinstance(item, dict) and set(item) == {"id", "excerpt", "score", "citation"})
                citation = item["citation"]
                require(isinstance(citation, dict))
                index = citation.get("rowIndex")
                require(type(index) is int and 0 <= index < 1000)
                require(citation == {"sourceArtifactId": "artifact.fixture", "sourceDigest": "sha256:" + corpus_digest,
                                     "chunkIndex": index, "rowIndex": index, "field": "text"})
                require(item["id"] == f"artifact.fixture:row:{index}" and item["id"] not in seen)
                require(item["excerpt"] == corpus[index]["text"] and type(item["score"]) in (int, float) and math.isfinite(item["score"]))
                seen.add(item["id"])
            recalls.append(len(seen & relevant_ids((5 + sample) % len(TOPICS))) / 5)
        require(result["query_recalls"] == recalls and result["recall_at_5"] == statistics.mean(recalls))
        require(type(result.get("cold_ms")) in (int, float) and math.isfinite(result["cold_ms"]) and result["cold_ms"] > 0)
        memory = result["environment"]["memory_profile"]
        if profile == "constrained-2gib":
            for name in ("peak_process_commit_bytes", "peak_job_commit_bytes"):
                require(type(memory.get(name)) is int and 0 < memory[name] <= 2 * 1024 ** 3)
        results[entry["label"]] = result
    expected = [{"left": left, "right": right, "status": "passed", **qualification.compare(results[left], results[right])} for left, right in PAIRS]
    require(report.get("comparisons") == expected)
    return {"profiles": len(results), "comparisons": len(expected), "recall_minimum": min(r["recall_at_5"] for r in results.values()),
            "maximum_sampled_query_rss_bytes": max(r["peak_rss_bytes"] for r in results.values()),
            "maximum_torch_query_vram_bytes": max(r["peak_vram_bytes"] for r in results.values())}


def main():
    root = qualification.ROOT
    source = qualification.source_identity()
    public, _ = bounded_json(root, REPORT, re.escape(REPORT))
    require(public.get("schemaVersion") == "headless-context-increment-qualification-v1")
    measurement = public["measurement"]
    report, digest = bounded_json(root, measurement["localEvidenceRef"], r"\.local-codex/trained-context/[a-f0-9]{32}/approved-query-report\.json")
    require(digest == measurement["sha256"] and measurement["sourceRevision"] == source)
    versions = {"platform": sys.platform, "python": sys.version.split()[0],
                **{name: importlib.metadata.version(name) for name in ("torch", "transformers", "lancedb", "pyarrow")}}
    observed = validate_report(report, source, qualification.approved_query_baseline(), versions)
    require(measurement["observed"] == observed)
    require(qualification.source_identity() == source)
    print(json.dumps({"status": "passed", "scope": "current-source fixed worker measurements; host proof is separate", **observed}))


def cli():
    try:
        main()
    except (KeyError, TypeError, ValueError, OSError, AttributeError, RecursionError, subprocess.SubprocessError):
        print(json.dumps({"status": "failed", "reason": "Context evidence is missing, changed or does not meet the fixed targets."}))
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(cli())
