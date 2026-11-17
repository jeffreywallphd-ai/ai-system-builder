"""Final response bytes preserve canonical detail and truthful recent history."""
import copy
import contextlib
import io
import json
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from control_plane.common import digest
from control_plane.projection import (CHUNK_REFERENCE_FORMAT, REVIEW_MAX_BYTES, bound_review_projection,
    chunk_reference, encode_review_projection, expanded_review_work_items, roadmap_chunk_work_items)


class ReviewWireTests(unittest.TestCase):
    def value(self, padding=0, count=50, historical=20):
        roadmap = {"id": "current", "status": "executing", "increments": [{
            "id": "one", "status": "implemented-pending-qualification", "criteria": [{
                "id": "native", "outcome": "pending", "qualification": "controlled-environment",
                "description": "x" * padding, "supporting_work": [{"status": "record-unavailable",
                    "current_qualification": "not-asserted"}]}],
            "chunks": [{"id": "done", "status": "completed"}, {"id": "next", "status": "planned"}]}],
            "merged_history": [{"id": "legacy", "status": "blocked"}]}
        executions = [{"id": f"work-{n:02}", "source": "execution",
                       "created_at": f"2026-10-29T00:00:{n:02}Z", "outcome": "y" * 1200}
                      for n in reversed(range(count))]
        chunks = [{"id": "current/one/done", "source": "roadmap-chunk", "status": "completed"},
                  {"id": "current/one/next", "source": "roadmap-chunk", "status": "planned"}]
        return {"schema_version": "development-review-v1", "roadmaps": [roadmap],
                "work_items": [chunks[0], *executions[:10], chunks[1], *executions[10:]],
                "inventory": {"execution_records_total": count + historical, "execution_records_shown": count,
                              "execution_records_truncated": historical > 0},
                "diagnostics": [{"code": "projection.other-fact"}, {
                    "code": "projection.execution-records-truncated", "total": count + historical, "shown": count}],
                "generated_at": "2026-10-29T00:00:00Z", "repository_id": "fixture", "source_digest": "stale"}

    def assert_digest(self, value):
        self.assertEqual(value["source_digest"], digest({k: v for k, v in value.items()
            if k not in {"source_digest", "generated_at", "repository_id"}}))

    def test_compact_wire_preserves_text_spaces_unicode_and_json_meaning(self):
        value = {"a b": "Keep spaces and caf\u00e9.", "numbers": [1, 2], "ready": False}
        body = encode_review_projection(value)
        self.assertEqual(json.loads(body), value)
        self.assertIn(b"Keep spaces", body)
        self.assertIn(b"caf\\u00e9", body)
        self.assertNotIn(b'": ', body)
        for invalid in (float("nan"), float("inf"), float("-inf")):
            with self.subTest(invalid=invalid), self.assertRaises(ValueError):
                encode_review_projection({"measurement": invalid})

    def test_fit_preserves_every_row_and_refreshes_the_exact_content_digest(self):
        original = self.value(100, 3)
        before = copy.deepcopy(original)
        result = bound_review_projection(original)
        self.assertEqual(original, before)
        self.assertEqual(result["work_items"], before["work_items"])
        self.assertEqual(result["inventory"], before["inventory"])
        self.assertEqual(result["diagnostics"], before["diagnostics"])
        self.assert_digest(result)

    def test_only_old_execution_rows_trim_with_exact_inventory_and_one_notice(self):
        original = self.value(REVIEW_MAX_BYTES - 40000)
        before = copy.deepcopy(original)
        self.assertGreater(len(encode_review_projection(original)), REVIEW_MAX_BYTES)
        result = bound_review_projection(original)
        self.assertEqual(original, before)
        self.assertLessEqual(len(encode_review_projection(result)), REVIEW_MAX_BYTES)
        self.assertEqual(result["roadmaps"], before["roadmaps"])
        self.assertEqual([r for r in result["work_items"] if r["source"] != "execution"],
                         [r for r in before["work_items"] if r["source"] != "execution"])
        kept = [r["id"] for r in result["work_items"] if r["source"] == "execution"]
        expected = [r["id"] for r in before["work_items"] if r["source"] == "execution"]
        self.assertGreater(len(kept), 0)
        self.assertLess(len(kept), 50)
        self.assertEqual(kept, expected[:len(kept)])
        self.assertEqual(result["inventory"], {"execution_records_total": 70,
            "execution_records_shown": len(kept), "execution_records_truncated": True})
        notices = [r for r in result["diagnostics"] if r["code"] == "projection.execution-records-truncated"]
        self.assertEqual(notices, [{"code": "projection.execution-records-truncated", "total": 70, "shown": len(kept)}])
        self.assertIn({"code": "projection.other-fact"}, result["diagnostics"])
        self.assert_digest(result)
        # The next older row cannot fit with the same exact envelope and notice.
        extra = next(r for r in before["work_items"] if r.get("id") == expected[len(kept)])
        larger = copy.deepcopy(result)
        larger["work_items"].append(extra)
        larger["inventory"]["execution_records_shown"] += 1
        notices = next(r for r in larger["diagnostics"] if r["code"] == "projection.execution-records-truncated")
        notices["shown"] += 1
        self.assertGreater(len(encode_review_projection(larger)), REVIEW_MAX_BYTES)

    def test_equal_dates_keep_original_id_tie_order_and_unknown_dates_last(self):
        value = self.value(REVIEW_MAX_BYTES - 5000, 4, 0)
        rows = [r for r in value["work_items"] if r["source"] == "execution"]
        for row in rows:
            row["created_at"] = "2026-10-29T00:00:00Z"
        rows[0]["created_at"] = None
        # Source order may be mixed; admission still chooses the newest/date+ID subset.
        result = bound_review_projection(value)
        kept = {r["id"] for r in result["work_items"] if r["source"] == "execution"}
        self.assertNotIn(rows[0]["id"], kept)
        expected = sorted(r["id"] for r in rows[1:])
        self.assertEqual(kept, set(expected[:len(kept)]))

    def test_canonical_view_can_fit_with_zero_recent_rows_and_an_honest_notice(self):
        for count in (1, 4):
            with self.subTest(count=count):
                value = self.value(REVIEW_MAX_BYTES - 2000, count)
                result = bound_review_projection(value)
                self.assertEqual(result["roadmaps"], value["roadmaps"])
                self.assertEqual(result["inventory"]["execution_records_shown"], 0)
                self.assertEqual(result["inventory"]["execution_records_total"], count + 20)
                self.assertTrue(result["inventory"]["execution_records_truncated"])
                self.assertTrue(all(row["source"] == "roadmap-chunk" for row in result["work_items"]))
                self.assertLessEqual(len(encode_review_projection(result)), REVIEW_MAX_BYTES)
                self.assert_digest(result)

    def test_encoded_unicode_bytes_not_character_count_govern_admission(self):
        value = self.value(0, 4)
        value["roadmaps"][0]["increments"][0]["criteria"][0]["description"] = "\u00e9" * (REVIEW_MAX_BYTES // 6 - 900)
        self.assertLess(len(json.dumps(value, ensure_ascii=False)), REVIEW_MAX_BYTES)
        result = bound_review_projection(value)
        self.assertLessEqual(len(encode_review_projection(result)), REVIEW_MAX_BYTES)
        self.assertLess(result["inventory"]["execution_records_shown"], 4)
        self.assertEqual(result["roadmaps"], value["roadmaps"])

    def test_irreducible_canonical_overflow_refuses_without_partial_mutation(self):
        for count in (0, 4):
            with self.subTest(count=count):
                value = self.value(REVIEW_MAX_BYTES, count)
                before = copy.deepcopy(value)
                with self.assertRaisesRegex(ValueError, "exceeds its bound"):
                    bound_review_projection(value)
                self.assertEqual(value, before)


class ChunkReferenceTests(unittest.TestCase):
    def value(self):
        chunks = [{"id": key, "chunk_number": number, "title": key, "outcome": "o" * 1300,
                   "created_at": "2026-11-10T00:00:00Z", "status": status,
                   "is_next": status == "planned", "criteria_ids": ["guard"],
                   "completed_at": "", "summary": "s" * 500, "tests": ["check " + "x" * 150] * 6}
                  for number, (key, status) in enumerate((("first", "completed"), ("second", "planned")), 1)]
        roadmaps = [{"id": "owner", "title": "Roadmap", "status": "executing", "current_increment": "one",
                     "evidence_policy": "control-plane-v1", "increments": [{"id": "one", "number": 1,
                     "title": "Increment", "chunks": chunks, "criteria": [{"id": "guard", "outcome": "pending",
                     "qualification": "controlled-environment", "evaluation_mode": "automated-technical-check"}]}]}]
        return {"schema_version": "development-review-v1", "roadmaps": roadmaps,
                "work_items": roadmap_chunk_work_items(roadmaps), "evaluations": [], "feedback": [],
                "diagnostics": [], "local_revision": 4,
                "inventory": {"execution_records_total": 0, "execution_records_shown": 0, "execution_records_truncated": False},
                "repository_id": "fixture", "generated_at": "now", "source_digest": "old"}

    def compact(self, value):
        result = copy.deepcopy(value)
        result["work_items"] = [chunk_reference(row) if row["source"] == "roadmap-chunk" else row
                                for row in result["work_items"]]
        result["work_item_format"] = CHUNK_REFERENCE_FORMAT
        return result

    def test_roundtrip_preserves_all_values_order_links_and_legacy_without_mutation(self):
        original = self.value()
        original["work_items"].insert(1, {"id": "actual-local-work", "source": "execution", "status": "complete",
                                          "metrics": {"elapsed_ms": 61000}})
        compact = self.compact(original)
        saved = copy.deepcopy(compact)
        self.assertEqual(expanded_review_work_items(compact), original["work_items"])
        self.assertEqual(expanded_review_work_items(original), original["work_items"])
        self.assertEqual(compact, saved)
        self.assertEqual(compact["roadmaps"], original["roadmaps"])
        self.assertLess(len(encode_review_projection(compact)), len(encode_review_projection(original)))
        self.assertEqual(expanded_review_work_items(compact)[0]["criteria"][0]["outcome"], "pending")

    def test_references_allow_complete_canonical_growth_without_raising_wire_limit(self):
        full = self.value()
        full["canonical_padding"] = "z" * (REVIEW_MAX_BYTES - len(encode_review_projection(full)) + 512)
        before = copy.deepcopy(full)
        with self.assertRaises(ValueError):
            bound_review_projection(full)
        compact = bound_review_projection(self.compact(full))
        self.assertLessEqual(len(encode_review_projection(compact)), REVIEW_MAX_BYTES)
        self.assertEqual(compact["roadmaps"], before["roadmaps"])
        self.assertEqual(expanded_review_work_items(compact), before["work_items"])
        self.assertEqual(full, before)
        compact["canonical_padding"] += "z" * 20000
        with self.assertRaises(ValueError):
            bound_review_projection(compact)

    def test_malformed_incomplete_ambiguous_or_foreign_joins_fail_closed(self):
        mutations = [
            lambda v: v.update(work_item_format="unknown"),
            lambda v: v.update(work_item_format=None),
            lambda v: v["work_items"].pop(),
            lambda v: v["work_items"].append(copy.deepcopy(v["work_items"][0])),
            lambda v: v["work_items"][0].update(id="foreign/one/first"),
            lambda v: v["work_items"][0].update(roadmap_id="foreign"),
            lambda v: v["work_items"][0].update(increment_number=True),
            lambda v: v["work_items"][0].update(chunk_number=1.0),
            lambda v: v["work_items"][0].update(extra="synthetic-private-note"),
            lambda v: v["work_items"][0].update(source="unknown"),
            lambda v: v["roadmaps"][0]["increments"][0]["chunks"].append(
                copy.deepcopy(v["roadmaps"][0]["increments"][0]["chunks"][0])),
        ]
        for number, mutate in enumerate(mutations):
            with self.subTest(number=number):
                value = self.compact(self.value())
                mutate(value)
                saved = copy.deepcopy(value)
                with patch.object(Path, "read_bytes", side_effect=AssertionError("reference must not read files")):
                    with self.assertRaises(ValueError) as caught:
                        expanded_review_work_items(value)
                self.assertNotIn("synthetic-private-note", str(caught.exception))
                self.assertEqual(value, saved)

    def test_new_canonical_values_are_reconstructed_without_stale_duplicate_fields(self):
        value = self.compact(self.value())
        value["roadmaps"][0]["title"] = "Current user title"
        value["roadmaps"][0]["increments"][0]["chunks"][0]["outcome"] = "Current result"
        value["roadmaps"][0]["increments"][0]["criteria"][0]["outcome"] = "failed"
        rows = expanded_review_work_items(value)
        self.assertEqual(rows[0]["roadmap_title"], "Current user title")
        self.assertEqual(rows[0]["outcome"], "Current result")
        self.assertEqual(rows[0]["criteria"][0]["outcome"], "failed")

    def test_cli_keeps_legacy_review_data_and_expands_status_rows(self):
        import development_control_plane as cli
        value = self.compact(self.value())
        fake_work = SimpleNamespace(records=SimpleNamespace(journal=Path("missing-synthetic-journal")))
        for arguments, expected_compact in ((["review-data"], False), (["review-data", "--compact"], True), (["status"], True)):
            with self.subTest(arguments=arguments):
                output = io.StringIO()
                with patch.object(cli, "Work", return_value=fake_work), patch.object(cli, "project", return_value=value) as project, contextlib.redirect_stdout(output):
                    code = cli.main(arguments)
                self.assertEqual(code, 0)
                self.assertEqual(project.call_args.kwargs, {"compact_work_items": expected_compact})
                result = json.loads(output.getvalue())["data"]
                if arguments == ["status"]:
                    self.assertEqual(result["work_items"], expanded_review_work_items(value))
                    self.assertNotIn("work_item_format", result)
                else:
                    self.assertEqual(result, value)


if __name__ == "__main__":
    unittest.main()
