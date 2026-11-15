import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import unittest

MODULE = Path(__file__).resolve().parents[1] / "assess_context_environment_budget.py"
spec = importlib.util.spec_from_file_location("context_environment_budget", MODULE)
assessment = importlib.util.module_from_spec(spec); spec.loader.exec_module(assessment)
trained = assessment.trained


class ContextEnvironmentBudgetTests(unittest.TestCase):
    def matrix(self):
        results = [[{"id": value, "score": 1.0, "citation": {"sourceArtifactId": "artifact.fixture"}}
                    for value in sorted(trained.relevant_ids((index + 5) % len(trained.TOPICS)))] for index in range(30)]
        for answer in results:
            for row in answer: row["citation"]["sourceDigest"] = "sha256:" + "a" * 64
        data = {"schema_version": "trained-context-qualification-v1", "source_revision": "source.fixture",
                "model": trained.MODEL, "revision": trained.REVISION, "baseline_retrieval_commit": trained.BASELINE_COMMIT,
                "baseline_retrieval_sha256": trained.BASELINE_SHA256, "source_stable": True, "inputs_stable": True,
                "precision": "float32", "cpu_threads": 4, "seed": 17, "samples": 30, "warmups": 5, "memory_runs": 3,
                "rss_sample_interval_ms": 5, "heldout_sha256": hashlib.sha256(json.dumps(trained.TOPICS).encode()).hexdigest(),
                "cpu_default_generation": {"physical_exit_code": 0, "chunks": 1000, "dimensions": 384, "generation_device": "cpu-default", "actual_tensor_devices": ["cpu"]},
                "attempts": [{"phase": "default-cpu-generation", "chunks": 1000, "status": "passed"}] + [{"phase": "prepare", "chunks": count, "status": "passed"} for count in (1000, 10000, 100000)], "workloads": [], "status": "failed"}
        for count in (1000, 10000, 100000):
            for device, profile in (("cpu", "reference"), ("cuda", "reference"), ("cpu", "constrained-2gib")):
                memory_profile = {"profile": "physical-reference"} if profile == "reference" else {
                    "profile": "windows-owned-job-2gib", "enforced": True,
                    "process_commit_limit_bytes": assessment.RSS_BUDGET, "job_commit_limit_bytes": assessment.RSS_BUDGET,
                    "peak_process_commit_bytes": 1024**3, "peak_job_commit_bytes": 1024**3}
                observed = {"physical_exit_code": 0, "cleanup_passed": True, "peak_rss_bytes": 1024**3,
                            "peak_vram_bytes": 100 if device == "cuda" else 0, "peak_reserved_vram_bytes": 200 if device == "cuda" else 0, "remaining_vram_bytes": 0, "remaining_reserved_bytes": 0,
                            "runtime_vram_floor_bytes": 0, "runtime_reserved_floor_bytes": 0,
                            "actual_tensor_devices": ["cuda:0" if device == "cuda" else "cpu"], "environment": {**assessment.ENVIRONMENT, "memory_profile": memory_profile,
                                "accelerator": assessment.ACCELERATOR if device == "cuda" else None, "accelerator_memory_bytes": assessment.ACCELERATOR_BYTES if device == "cuda" else 0}}
                baseline = {**copy.deepcopy(observed), "memory_runs": [copy.deepcopy(observed) for _ in range(3)],
                            "samples_ms": [10.0] * 30, "answers": copy.deepcopy(results), "query_recalls": [1.0] * 30, "recall_at_5": 1.0}
                candidate = copy.deepcopy(baseline); candidate["samples_ms"] = [5.0] * 30
                data["workloads"].append({"chunks": count, "device": device, "profile": profile,
                    "corpus": {"physical_exit_code": 0, "source_digest": "sha256:" + "a" * 64, "chunks": count, "dimensions": 128 if count == 100000 else 384, "generation_device": "cuda", "actual_tensor_devices": ["cuda:0"]}, "baseline": baseline, "candidate": candidate,
                    "quality": trained.compare(baseline, candidate), "status": "failed-quality-or-budget", "attempts": [step for variant in ("baseline", "candidate") for step in [{"variant": variant, "phase": "timing", "status": "passed"}, *[{"variant": variant, "phase": "memory", "sample": index, "status": "passed"} for index in range(3)]]]})
        return data

    def test_all_nine_current_cohorts_use_the_explicit_alternative_without_rewriting_old_failure(self):
        data = self.matrix(); before = copy.deepcopy(data)
        result = assessment.assess(data, "source.fixture")
        self.assertTrue(result["qualification_complete"])
        self.assertEqual(len(result["cohorts"]), 9)
        self.assertEqual(data, before)
        self.assertTrue(all(item["original_status_preserved"] == "failed-quality-or-budget" for item in result["cohorts"]))

    def test_missing_duplicate_stale_or_incomplete_protocol_is_refused(self):
        for field, value in (("source_revision", "source.other"), ("source_stable", False), ("inputs_stable", False),
                             ("samples", 8), ("warmups", 4), ("memory_runs", 2), ("precision", "bfloat16"),
                             ("heldout_sha256", "changed"), ("cleanup_pending", {"status": "uncertain"}), ("status", "running")):
            data = self.matrix(); data[field] = value
            with self.subTest(field=field), self.assertRaises(ValueError): assessment.assess(data, "source.fixture")
        data = self.matrix(); data["workloads"][-1] = copy.deepcopy(data["workloads"][0])
        with self.assertRaises(ValueError): assessment.assess(data, "source.fixture")

    def test_both_arms_and_each_fresh_memory_child_must_meet_budget_exit_and_cleanup(self):
        for variant in ("baseline", "candidate"):
            for key, value in (("peak_rss_bytes", assessment.RSS_BUDGET + 1), ("peak_vram_bytes", assessment.VRAM_BUDGET + 1),
                               ("peak_reserved_vram_bytes", assessment.VRAM_BUDGET + 1), ("peak_rss_bytes", True),
                               ("physical_exit_code", 7), ("physical_exit_code", False), ("cleanup_passed", False), ("remaining_reserved_bytes", 1), ("runtime_reserved_floor_bytes", float("inf"))):
                for memory in (False, True):
                    data = self.matrix(); arm = data["workloads"][1][variant]
                    target = arm["memory_runs"][1] if memory else arm; target[key] = value
                    with self.subTest(variant=variant, key=key, memory=memory), self.assertRaises(ValueError):
                        assessment.assess(data, "source.fixture")

    def test_exact_result_replay_latency_recall_and_kernel_readback_remain_required(self):
        data = self.matrix(); data["workloads"][0]["candidate"]["answers"][0][0]["citation"] = {"sourceArtifactId": "foreign"}
        with self.assertRaises(ValueError): assessment.assess(data, "source.fixture")

    def test_foreign_matching_citations_wrong_runtime_and_zero_job_readbacks_refuse(self):
        data = self.matrix()
        for variant in ("baseline", "candidate"):
            data["workloads"][0][variant]["answers"][0][0]["citation"]["sourceArtifactId"] = "foreign"
        data["workloads"][0]["quality"] = trained.compare(data["workloads"][0]["baseline"], data["workloads"][0]["candidate"])
        with self.assertRaises(ValueError): assessment.assess(data, "source.fixture")

    def test_schedule_corpus_and_vram_contradictions_are_refused(self):
        for defect in ("prepare", "attempts", "corpus", "cuda-zero", "reserved", "cpu-vram", "floors"):
            data = self.matrix()
            if defect == "prepare": data["attempts"] = [data["attempts"][0]] * 4
            elif defect == "attempts": data["workloads"][0]["attempts"] = [data["workloads"][0]["attempts"][0]] * 8
            elif defect == "corpus": data["workloads"][-1]["corpus"]["chunks"] = 1000
            elif defect == "cuda-zero": data["workloads"][1]["candidate"].update(peak_vram_bytes=0, peak_reserved_vram_bytes=0)
            elif defect == "reserved": data["workloads"][1]["baseline"].update(peak_vram_bytes=1000, peak_reserved_vram_bytes=1)
            elif defect == "cpu-vram": data["workloads"][0]["candidate"]["peak_reserved_vram_bytes"] = 1
            else: data["workloads"][1]["candidate"].update(runtime_vram_floor_bytes=2, runtime_reserved_floor_bytes=1)
            with self.subTest(defect=defect), self.assertRaises(ValueError): assessment.assess(data, "source.fixture")
        for key in assessment.ENVIRONMENT:
            data = self.matrix(); data["workloads"][0]["candidate"]["environment"][key] = "wrong"
            with self.subTest(key=key), self.assertRaises(ValueError): assessment.assess(data, "source.fixture")
        data = self.matrix(); data["workloads"][2]["candidate"]["memory_runs"][0]["environment"]["memory_profile"]["peak_process_commit_bytes"] = 0
        with self.assertRaises(ValueError): assessment.assess(data, "source.fixture")
        data = self.matrix(); data["workloads"][0]["candidate"]["samples_ms"] = [10.6] * 30
        with self.assertRaises(ValueError): assessment.assess(data, "source.fixture")
        data = self.matrix(); data["workloads"][0]["candidate"]["recall_at_5"] = .8
        with self.assertRaises(ValueError): assessment.assess(data, "source.fixture")
        data = self.matrix(); data["workloads"][2]["candidate"]["memory_runs"][0]["environment"]["memory_profile"]["enforced"] = False
        with self.assertRaises(ValueError): assessment.assess(data, "source.fixture")


if __name__ == "__main__": unittest.main()
