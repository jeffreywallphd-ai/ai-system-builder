"""Negative integrity/grade cases; these fixtures are not physical measurements."""
import copy
import hashlib
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import check_headless_context_evidence as check


def fixture():
    corpus = list(check.rows(1000))
    digest = hashlib.sha256(b"".join((json.dumps(row, separators=(",", ":")) + "\n").encode() for row in corpus)).hexdigest()
    answers = [[{"id": f"artifact.fixture:row:{index}", "excerpt": corpus[index]["text"], "score": .5,
                 "citation": {"sourceArtifactId": "artifact.fixture", "sourceDigest": "sha256:" + digest,
                              "chunkIndex": index, "rowIndex": index, "field": "text"}}
                for index in range(((5 + sample) % 8) * 5, ((5 + sample) % 8) * 5 + 5)] for sample in range(8)]
    result = {"query_protocol": "host-approved-local-model", "production_embedding_unchanged": True,
              "negative_probes": [{"case": name, "denied": True, "embedding_forward_calls": 0, "cleanup_passed": True}
                                  for name in ("wrong-original-model", "wrong-artifact-digest")],
              "query_recalls": [1.] * 8, "recall_at_5": 1., "samples_ms": [250.] * 8, "cold_ms": 3000.,
              "peak_rss_bytes": 1_000_000_000, "peak_vram_bytes": 0, "actual_tensor_devices": ["cpu"],
              "baseline_rss_bytes": 500_000_000, "incremental_peak_rss_bytes": 500_000_000,
              "physical_exit_code": 0, "cleanup_passed": True, "answers": answers,
              "remaining_vram_bytes": 0, "runtime_vram_floor_bytes": 0,
              "remaining_reserved_bytes": 0, "runtime_reserved_floor_bytes": 0,
              "peak_reserved_vram_bytes": 0,
              "environment": {"memory_profile": {"profile": "physical-reference"}}}
    generation = {"physical_exit_code": 0, "corpus_sha256": digest, "source_digest": "sha256:" + digest,
                  "chunks": 1000, "dimensions": 384, "actual_tensor_devices": ["cpu"]}
    attempts = [{"label": "cpu-generation", "device": "cpu", "profile": "reference", "status": "observed", "result": generation}]
    for label in check.LABELS:
        value = copy.deepcopy(result)
        device = "cuda" if label.startswith("cuda") else "cpu"
        profile = "constrained-2gib" if label == "cpu-constrained" else "reference"
        if device == "cuda":
            value.update(actual_tensor_devices=["cuda:0"], peak_vram_bytes=100_000_000, peak_reserved_vram_bytes=110_000_000)
        if profile == "constrained-2gib":
            value["environment"]["memory_profile"] = {"profile": "windows-owned-job-2gib", "enforced": True,
                "process_commit_limit_bytes": 2 * 1024 ** 3, "job_commit_limit_bytes": 2 * 1024 ** 3,
                "peak_process_commit_bytes": 1_800_000_000, "peak_job_commit_bytes": 1_800_000_000}
        attempts.append({"label": label, "device": device, "profile": profile, "status": "observed", "result": value, "targets_met": True})
    results = {entry["label"]: entry["result"] for entry in attempts}
    baseline = {"report_digest": check.qualification.APPROVED_QUERY_BASELINE, "cpu": 1., "cuda": 1.}
    return {"schema_version": "approved-context-query-qualification-v1", "status": "worker-targets-met",
        "qualification_complete": False, "source_revision": "source.fixture", "source_stable": True, "model_stable": True,
        "model": check.qualification.MODEL, "revision": check.qualification.REVISION, "model_files": check.qualification.FILES,
        "chunks": 1000, "warmups": 5, "samples": 8, "seed": 17, "cpu_threads": 4,
        "thresholds": check.THRESHOLDS, "recorded_ordinary_baseline": baseline,
        "helper_sha256": check.qualification.sha256_file(check.qualification.SCRIPT),
        "fixture_sha256": check.qualification.sha256_file(check.qualification.SCRIPT.parent / "trained_context_fixture.py"),
        "heldout_sha256": hashlib.sha256(json.dumps(check.TOPICS).encode()).hexdigest(), "attempts": attempts,
        "comparisons": [{"left": left, "right": right, "status": "passed", **check.qualification.compare(results[left], results[right])} for left, right in check.PAIRS]}


class ContextEvidenceTests(unittest.TestCase):
    def setUp(self):
        self.report = fixture()

    def grade(self, value):
        return check.validate_report(value, "source.fixture", self.report["recorded_ordinary_baseline"])

    def test_recomputes_all_five_profiles_and_three_comparisons(self):
        self.assertEqual(self.grade(self.report)["profiles"], 5)
        # Summary flags do not replace computed grades.
        self.report["attempts"][1]["targets_met"] = False
        self.assertEqual(self.grade(self.report)["recall_minimum"], 1.)

    def test_refuses_stale_identity_and_missing_or_unobserved_profiles(self):
        for key, value in (("source_revision", "source.old"), ("source_stable", False), ("model_stable", False),
                           ("helper_sha256", "0" * 64), ("heldout_sha256", "0" * 64), ("samples", 7),
                           ("status", "failed-or-pending"), ("qualification_complete", True), ("attempts", self.report["attempts"][:-1])):
            with self.subTest(key=key):
                value = {**self.report, key: value}
                with self.assertRaises(ValueError): self.grade(value)
        changed = copy.deepcopy(self.report); changed["attempts"][1]["status"] = "failed"
        with self.assertRaises(ValueError): self.grade(changed)

    def test_refuses_forged_recalls_and_citation_excerpt_identity_or_score(self):
        for field, value in (("id", "artifact.foreign:row:25"), ("excerpt", "altered"), ("score", float("nan")),
                             ("citation", {"sourceArtifactId": "foreign", "rowIndex": 25})):
            with self.subTest(field=field):
                changed = copy.deepcopy(self.report)
                changed["attempts"][1]["result"]["answers"][0][0][field] = value
                with self.assertRaises(ValueError): self.grade(changed)
        changed = copy.deepcopy(self.report)
        changed["attempts"][1]["result"]["answers"][0] = copy.deepcopy(changed["attempts"][1]["result"]["answers"][1])
        with self.assertRaises(ValueError): self.grade(changed)

    def test_refuses_resource_cleanup_native_device_and_comparison_failures(self):
        for key, value in (("peak_rss_bytes", 2 * 1024 ** 3 + 1), ("physical_exit_code", True), ("cleanup_passed", False),
                           ("actual_tensor_devices", ["cuda:0"]), ("samples_ms", [0] * 8), ("negative_probes", []),
                           ("remaining_vram_bytes", 1)):
            with self.subTest(key=key):
                changed = copy.deepcopy(self.report); changed["attempts"][1]["result"][key] = value
                with self.assertRaises(ValueError): self.grade(changed)
        changed = copy.deepcopy(self.report)
        changed["attempts"][3]["result"]["environment"]["memory_profile"]["peak_job_commit_bytes"] = 2 * 1024 ** 3 + 1
        with self.assertRaises(ValueError): self.grade(changed)

    def test_installed_version_mismatch_does_not_reuse_old_environment(self):
        with self.assertRaises(ValueError):
            check.validate_report(self.report, "source.fixture", self.report["recorded_ordinary_baseline"], {"python": "other"})
        changed = copy.deepcopy(self.report); changed["comparisons"][0]["maximum_score_delta"] = .5
        with self.assertRaises(ValueError): self.grade(changed)

    def test_contradictory_allocator_and_rss_counters_are_rejected(self):
        for key, value in (("runtime_vram_floor_bytes", 600_000_000), ("runtime_reserved_floor_bytes", 600_000_000),
                           ("peak_reserved_vram_bytes", -1), ("baseline_rss_bytes", 1_000_000_001),
                           ("incremental_peak_rss_bytes", 1)):
            with self.subTest(key=key):
                changed = copy.deepcopy(self.report); changed["attempts"][4]["result"][key] = value
                with self.assertRaises(ValueError): self.grade(changed)

    def test_json_boundary_rejects_traversal_oversize_duplicates_and_nonfinite(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); path = root / "report.json"
            for payload in ('{"a":1,"a":2}', '{"a":NaN}', 'x' * 21):
                path.write_text(payload)
                with self.assertRaises(ValueError): check.bounded_json(root, "report.json", r"report\.json", 20)
            with self.assertRaises(ValueError): check.bounded_json(root, "../report.json", r"report\.json")
            path.write_text('{"a":1}')
            self.assertEqual(check.bounded_json(root, "report.json", r"report\.json")[0], {"a": 1})

    def test_descriptor_read_is_capped_and_rejects_growth_or_replacement(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); path = root / "report.json"
            real_read = check.os.read
            for mode in ("grow", "replace"):
                path.write_text('{"a":1}')
                calls = []
                def changed_read(descriptor, maximum):
                    calls.append(maximum)
                    if len(calls) == 1:
                        if mode == "grow":
                            with path.open('a') as output: output.write(' ' * 100)
                        else:
                            replacement = root / "replacement.json"
                            replacement.write_text('{"a":2}')
                            check.os.replace(replacement, path)
                    return real_read(descriptor, maximum)
                with self.subTest(mode=mode), patch.object(check.os, 'read', side_effect=changed_read):
                    with self.assertRaises((ValueError, OSError)):
                        check.bounded_json(root, "report.json", r"report\.json", 20)
                self.assertTrue(calls)
                self.assertLessEqual(max(calls), 21)

    def test_main_inputs_fail_without_exposing_malformed_content(self):
        for public in (None, [], {"schemaVersion": "wrong"}, {"schemaVersion": "headless-context-increment-qualification-v1", "measurement": []}):
            with self.subTest(public=public), patch.object(check.qualification, 'source_identity', return_value='source.fixture'), \
                    patch.object(check, 'bounded_json', return_value=(public, 'digest')):
                output = io.StringIO()
                with patch('sys.stdout', output): self.assertEqual(check.cli(), 1)
                self.assertEqual(json.loads(output.getvalue()), {"status": "failed", "reason": "Context evidence is missing, changed or does not meet the fixed targets."})
        with patch.object(check.qualification, 'source_identity', return_value='source.fixture'), \
                patch.object(check, 'bounded_json', side_effect=RecursionError('private malformed detail')):
            output = io.StringIO()
            with patch('sys.stdout', output): self.assertEqual(check.cli(), 1)
            self.assertNotIn('private', output.getvalue())


if __name__ == "__main__":
    unittest.main()
