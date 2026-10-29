"""Final response bytes preserve canonical detail and truthful recent history."""
import copy
import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from control_plane.common import digest
from control_plane.projection import REVIEW_MAX_BYTES, bound_review_projection, encode_review_projection


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


if __name__ == "__main__":
    unittest.main()
