"""Exact bounded pages, canonical joins and loopback request refusal."""
from __future__ import annotations

import contextlib
import copy
import http.client
import importlib.util
import io
import json
from pathlib import Path
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch

HELPERS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HELPERS))
from control_plane.projection import (CHUNK_REFERENCE_FORMAT, PAGE_SIZES, REVIEW_MAX_BYTES,
    bound_review_projection, chunk_reference, encode_review_projection, expanded_review_work_items,
    project, review_content, review_page, roadmap_chunk_work_items)
from control_plane.records import Records
from control_plane.planning_metrics import strip_anchors
from control_plane.user_presentation import apply_user_descriptions, compact_user_project

spec = importlib.util.spec_from_file_location("review_pagination_server", HELPERS.parent / "review-site/server.py")
server_module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(server_module)


def fixture(count=8):
    roads = []
    for number in range(count):
        chunks = [{"id": f"chunk-{n}", "chunk_number": n + 1, "title": f"Chunk {n}", "outcome": "Preserve details",
            "created_at": f"2026-11-{20-number:02}T00:00:00Z", "status": "planned", "is_next": n == 0,
            "criteria_ids": ["criterion"], "completed_at": "", "summary": "", "tests": []} for n in range(12)]
        roads.append({"id": f"road-{number}", "title": f"Roadmap {number}", "objective": "Keep complete history",
            "status": "completed" if number % 2 == 0 else "executing", "created_at": chunks[0]["created_at"],
            "evidence_policy": "declarative-legacy", "current_increment": "one", "increments": [{"id": "one", "number": 1, "title": "Increment",
                "status": "implementing", "objective": "Preserve evidence", "chunks": chunks,
                "criteria": [{"id": "criterion", "outcome": "pending", "qualification": "controlled-environment",
                    "description": "Complete technical checks", "supporting_work": [{"scope": "Source support",
                    "limitations": ["No parent pass"], "status": "reviewed-local-snapshot"}]}]}],
            "merged_history": [{"id": "history", "title": "Original history", "increments": []}]})
    rows = roadmap_chunk_work_items(roads)
    return {"schema_version": "development-review-v1", "roadmaps": roads,
        "work_items": [chunk_reference(row) for row in rows], "work_item_format": CHUNK_REFERENCE_FORMAT,
        "evaluations": [], "feedback": [], "diagnostics": [], "local_revision": 1,
        "repository_id": "fixture", "generated_at": "now", "source_digest": "old",
        "inventory": {"execution_records_total": 0, "execution_records_shown": 0, "execution_records_truncated": False}}


class PageProjectionTests(unittest.TestCase):
    def test_browser_profile_transfer_keeps_every_other_trigger_and_explicit_generic_coverage(self):
        from control_plane import catalog
        root = HELPERS.parents[1]
        config = json.loads((root / "dev-tools/config/contributor-check-profiles.json").read_bytes())
        paths = ["dev-tools/scripts/qualification/visual-composer/e2e/review-site-journey.ts",
                 "dev-tools/scripts/qualification/visual-composer/review-site-oracles.ts",
                 "dev-tools/scripts/qualification/tests/review-site-oracles.unit.test.ts"]
        with tempfile.TemporaryDirectory(prefix="review-routing-") as directory:
            fixture_root = Path(directory)
            target = fixture_root / "dev-tools/config/contributor-check-profiles.json"
            target.parent.mkdir(parents=True)
            target.write_text(json.dumps(config))
            for source in paths:
                for required in (["documentation"], ["operational-ui"], ["focused-tests"]):
                    ids = {row["id"] for row in catalog.plan(fixture_root, [source], required, "fixture")["selected"]}
                    self.assertIn("review-site", ids)
                    self.assertEqual("operational-ui" in ids, "operational-ui" in required)
                    self.assertEqual("focused-tests" in ids, "focused-tests" in required)
            for source in catalog.QUALIFICATION_PROFILE_PATTERNS["operational-ui"]:
                ids = {row["id"] for row in catalog.plan(fixture_root, [source], ["documentation"], "fixture")["selected"]}
                self.assertIn("operational-ui", ids)
                self.assertNotIn("review-site", ids)
            for source in ("dev-tools/scripts/qualification/visual-composer/unrelated.ts", "dev-tools/review-site/unknown.js"):
                ids = {row["id"] for row in catalog.plan(fixture_root, [paths[0], source], ["documentation"], "fixture")["selected"]}
                self.assertIn("focused-tests" if source.startswith("dev-tools/scripts/") else "control-plane", ids)

    def test_roadmap_pages_keep_open_first_creation_order_complete_details_and_source(self):
        value = fixture()
        before = copy.deepcopy(value)
        rows = []
        for number in range(1, 4):
            page = bound_review_projection(review_page(value, view="roadmaps", page=number))
            rows.extend(page["roadmaps"])
            self.assertEqual(page["pagination"]["total_records"], 8)
            self.assertEqual(page["pagination"]["total_pages"], 3)
            self.assertEqual(page["work_items"], [])
            self.assertEqual(expanded_review_work_items(page), [])
            self.assertLessEqual(len(encode_review_projection(page)), REVIEW_MAX_BYTES)
        self.assertEqual([row["id"] for row in rows], ["road-1", "road-3", "road-5", "road-7", "road-0", "road-2", "road-4", "road-6"])
        for row in rows:
            original = next(r for r in value["roadmaps"] if r["id"] == row["id"])
            self.assertEqual(row["increments"][0]["criteria"], original["increments"][0]["criteria"])
            self.assertEqual(row["increments"][0]["chunks"], original["increments"][0]["chunks"])
            self.assertEqual(row["merged_history"][0]["title"], "Original history")
        self.assertEqual(value, before)

    def test_work_pages_reconstruct_exact_selected_rows_and_full_linked_criteria(self):
        value = fixture()
        full = expanded_review_work_items(value)
        seen = []
        for number in range(1, 5):
            page = review_page(value, view="work_items", page=number)
            self.assertEqual(page["roadmaps"], [])
            expanded = expanded_review_work_items(page)
            self.assertEqual(expanded, full[(number-1)*25:number*25])
            seen.extend(expanded)
            for parent in page["work_item_roadmaps"]:
                self.assertTrue(parent["increments"][0]["criteria"][0]["supporting_work"])
            for mutate in (lambda v: v["work_items"].pop(),
                           lambda v: v["work_items"][0].update(roadmap_id="foreign"),
                           lambda v: v["work_items"][0].update(chunk_number=True),
                           lambda v: v["work_item_roadmaps"].clear()):
                invalid = copy.deepcopy(page)
                mutate(invalid)
                with self.assertRaises(ValueError):
                    expanded_review_work_items(invalid)
        self.assertEqual(seen, full)

    def test_large_collection_is_sliced_before_admission_and_oversized_page_is_not_trimmed(self):
        value = fixture()
        for row in value["roadmaps"]:
            row["objective"] = "x" * 350000
        with self.assertRaises(ValueError):
            bound_review_projection(value)
        page = bound_review_projection(review_page(value, view="roadmaps", page=1))
        self.assertLess(len(encode_review_projection(page)), REVIEW_MAX_BYTES)
        self.assertEqual(len(page["roadmaps"]), 3)
        page["roadmaps"][0]["objective"] = "x" * REVIEW_MAX_BYTES
        page["work_items"].append({"id": "execution", "source": "execution"})
        page["inventory"] = {"execution_records_total": 1, "execution_records_shown": 1}
        before = copy.deepcopy(page)
        with self.assertRaises(ValueError):
            bound_review_projection(page)
        self.assertEqual(page, before)

    def test_empty_out_of_range_filters_and_invalid_selectors(self):
        value = fixture()
        self.assertEqual(review_page(value, view="roadmaps", page=999)["pagination"]["page"], 3)
        empty = review_page(value, view="roadmaps", page=999, roadmap="missing")
        self.assertEqual(empty["pagination"], {"view": "roadmaps", "page": 1, "page_size": 3,
            "total_records": 0, "total_pages": 1, "roadmap": "missing", "increment": "", "work": ""})
        selected = review_page(value, view="work_items", page=1, roadmap="road-7", increment="one")
        self.assertEqual(selected["pagination"]["total_records"], 12)
        self.assertTrue(all(row["roadmap_id"] == "road-7" for row in selected["work_items"]))
        for options in ({"page": 0}, {"page": True}, {"page": 1000001}, {"view": "unknown"},
                        {"roadmap": "../private"}, {"increment": "one"}, {"roadmap": "road-1", "increment": "one"}):
            with self.subTest(options=options), self.assertRaises(ValueError):
                review_page(value, **({"view": "roadmaps", "page": 1} | options))

    def test_ambiguity_outside_selected_page_cannot_inherit_disclosure(self):
        value = fixture()
        original = review_page(value, view="roadmaps", page=2)["disclosure_digest"]
        value["roadmaps"][0]["status"] = "ready"
        self.assertEqual(review_page(value, view="work_items", page=2)["disclosure_digest"], original)
        duplicate = copy.deepcopy(value["roadmaps"][1])
        value["roadmaps"].append(duplicate)
        page = review_page(value, view="roadmaps", page=1)
        self.assertFalse(next(row for row in page["roadmaps"] if row["id"] == "road-1")["increments"][0]["disclosure_unique"])
        self.assertNotEqual(review_page(value, view="roadmaps", page=2)["disclosure_digest"], original)
        value["roadmaps"].pop()
        self.assertEqual(review_page(value, view="roadmaps", page=2)["disclosure_digest"], original)

    def test_exact_off_page_supporting_execution_lookup_and_empty_parent_shadows(self):
        value = fixture()
        row = {"id": "older-support-work", "source": "execution", "title": "Original supporting work"}
        value["work_items"].append(row)
        self.assertNotIn(row, review_page(value, view="work_items", page=1)["work_items"])
        selected = review_page(value, view="work_items", page=1, work=row["id"])
        self.assertEqual(selected["pagination"]["total_records"], 1)
        self.assertEqual(expanded_review_work_items(selected), [row])
        for work in ("../private", "x" * 81):
            with self.assertRaises(ValueError):
                review_page(value, view="work_items", page=1, work=work)
        page = review_page(value, view="work_items", page=1)
        for shadow in ({**page["work_item_roadmaps"][0], "increments": []},
                       {**page["work_item_roadmaps"][0], "increments": [{**page["work_item_roadmaps"][0]["increments"][0], "chunks": []}]}):
            invalid = copy.deepcopy(page)
            invalid["work_item_roadmaps"].insert(0, shadow)
            with self.assertRaises(ValueError):
                expanded_review_work_items(invalid)

    def test_all_201_trial_and_feedback_records_are_reachable_before_page_slicing(self):
        state = Records.empty()
        for n in range(201):
            state["trials"][f"trial-{n}"] = {"trial_id": f"trial-{n}", "task_id": "task", "status": "prepared"}
            state["feedback"][f"feedback-{n}"] = {"id": f"feedback-{n}", "work_id": "work", "summary": "Retain the record", "status": "open"}
        with tempfile.TemporaryDirectory(prefix="review-all-records-") as directory, patch.object(Records, "load", return_value=state):
            root = Path(directory)
            for view, prefix in (("evaluations", "trial"), ("feedback", "feedback")):
                seen = []
                for number in range(1, 10):
                    page = project(root, compact_work_items=True, page={"view": view, "page": number})
                    self.assertEqual(page["pagination"]["total_records"], 201)
                    self.assertEqual(page["totals"][view], 201)
                    seen.extend(row["id"] for row in page[view])
                self.assertEqual(seen, [f"{prefix}-{n}" for n in range(201)])
                self.assertEqual(len(project(root)[view]), 200)

    def test_current_repository_all_pages_preserve_every_criterion_support_and_history(self):
        root = HELPERS.parents[1]
        with patch.object(Records, "load", return_value=Records.empty()):
            source = apply_user_descriptions(root, review_content(root, compact_work_items=True, paginated=True))
            # Ancestry anchors are private calculation inputs, not lost roadmap
            # facts. Compare public history after applying that existing boundary.
            strip_anchors(source)
            count = len(source["roadmaps"])
            seen = {}
            for number in range(1, (count + 2)//3 + 1):
                value = compact_user_project(root, page={"view": "roadmaps", "page": number})
                self.assertLessEqual(len(encode_review_projection(value)), REVIEW_MAX_BYTES)
                self.assertEqual(value["pagination"]["total_records"], count)
                for row in value["roadmaps"]:
                    self.assertNotIn(row["id"], seen)
                    seen[row["id"]] = row
            self.assertEqual(set(seen), {row["id"] for row in source["roadmaps"]})
            for parent in source["roadmaps"]:
                for increment, actual in zip(parent["increments"], seen[parent["id"]]["increments"]):
                    self.assertEqual(increment["criteria"], actual["criteria"])
                    self.assertEqual(increment["chunks"], actual["chunks"])
                self.assertEqual(parent.get("merged_history", []), [
                    {key: val for key, val in history.items() if key not in {"disclosure_unique", "merged_history"}}
                    | {"increments": [{key: val for key, val in inc.items() if key != "disclosure_unique"} for inc in history["increments"]]}
                    for history in seen[parent["id"]].get("merged_history", [])])

    def test_status_remains_available_when_whole_projection_exceeds_wire_bound(self):
        import development_control_plane as cli
        from types import SimpleNamespace
        value = fixture()
        value["roadmaps"][0]["objective"] = "x" * REVIEW_MAX_BYTES
        fake = SimpleNamespace(records=SimpleNamespace(journal=Path("missing-pagination-journal")))
        output = io.StringIO()
        with patch.object(cli, "Work", return_value=fake), patch.object(cli, "review_content", return_value=value), contextlib.redirect_stdout(output):
            self.assertEqual(cli.main(["status"]), 0)
        result = json.loads(output.getvalue())["data"]
        self.assertEqual(len(result["roadmaps"]), 8)
        self.assertEqual(len(result["work_items"]), 96)

    def test_cli_explicit_technical_pages_preserve_legacy_arguments_and_safe_refusal(self):
        import development_control_plane as cli
        from types import SimpleNamespace
        fake = SimpleNamespace(records=SimpleNamespace(journal=Path("missing-pagination-journal")))
        output = io.StringIO()
        with patch.object(cli, "Work", return_value=fake), patch.object(cli, "project", return_value={}) as projected, contextlib.redirect_stdout(output):
            self.assertEqual(cli.main(["review-data", "--compact", "--view", "work_items", "--page", "2"]), 0)
            self.assertEqual(projected.call_args.kwargs, {"compact_work_items": True, "page": {"view": "work_items", "page": 2}})
            projected.reset_mock()
            self.assertEqual(cli.main(["review-data", "--page", "2"]), 2)
            projected.assert_not_called()


class PageHttpTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="review-pages-")
        self.calls = []
        self.value = fixture()
        def paged(root, **options):
            self.calls.append(options)
            value = copy.deepcopy(self.value)
            return bound_review_projection(review_page(value, **options["page"])) if options else value
        self.server = server_module.Server(("127.0.0.1", 0), self.temp.name, projection=paged, compact_projection=paged)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.addCleanup(self.temp.cleanup)
        self.addCleanup(self.server.server_close)
        self.addCleanup(self.server.shutdown)

    def request(self, path="/api/review?view=roadmaps&page=1", headers=None, method="GET"):
        connection = http.client.HTTPConnection("127.0.0.1", self.server.server_port, timeout=5)
        try:
            connection.request(method, path, headers=headers or {})
            response = connection.getresponse()
            return response.status, dict(response.getheaders()), response.read()
        finally:
            connection.close()

    def test_get_head_fixed_pages_and_navigation_filter(self):
        path = "/api/review?view=work_items&page=1&roadmap=road-7&increment=one"
        code, headers, body = self.request(path, {"X-Review-Work-Items": CHUNK_REFERENCE_FORMAT})
        self.assertEqual(code, 200)
        value = json.loads(body)
        self.assertEqual(len(expanded_review_work_items(value)), 12)
        self.assertEqual(int(headers["Content-Length"]), len(body))
        code, head, body = self.request(path, method="HEAD")
        self.assertEqual(code, 200)
        self.assertEqual(int(head["Content-Length"]), int(headers["Content-Length"]))
        self.assertEqual(body, b"")
        self.assertIn("frame-ancestors 'none'", head["Content-Security-Policy"])

    def test_exact_work_id_selects_an_execution_beyond_the_first_page(self):
        self.value["work_items"].append({"id": "older-support-work", "source": "execution", "title": "Original supporting work"})
        code, _, body = self.request("/api/review?view=work_items&page=1&work=older-support-work", {"X-Review-Work-Items": CHUNK_REFERENCE_FORMAT})
        self.assertEqual(code, 200)
        value = json.loads(body)
        self.assertEqual(value["pagination"]["total_records"], 1)
        self.assertEqual(expanded_review_work_items(value)[0]["title"], "Original supporting work")

    def test_unknown_duplicate_malformed_encoded_or_oversized_queries_deny_before_projection(self):
        for query in ("view=roadmaps", "page=1", "view=bad&page=1", "view=roadmaps&page=0", "view=roadmaps&page=01",
                      "view=roadmaps&page=-1", "view=roadmaps&page=1.0", "view=roadmaps&page=1000001",
                      "view=roadmaps&page=1&page=2", "view=roadmaps&page=1&size=1000", "view=roadmaps&page=%31",
                      "view=roadmaps&page=1&roadmap=../private", "view=roadmaps&page=1&increment=one",
                      "view=feedback&page=1&roadmap=road-1", "view=work_items&page=1&roadmap=" + "x"*81,
                      "view=roadmaps&page=1&", "view=roadmaps&page=1&&roadmap=road-1",
                      "view=roadmaps&page=1&work=one", "view=work_items&page=1&work=one&roadmap=road-1",
                      "view=work_items&page=1&work=%31", "view=work_items&page=1&work=one&work=two"):
            with self.subTest(query=query):
                self.assertEqual(self.request("/api/review?" + query)[0], 404)
        self.assertEqual(self.calls, [])
        self.assertEqual(self.request("/api/status?view=roadmaps&page=1")[0], 404)

    def test_origin_fetch_host_readonly_and_oversized_page_stay_closed(self):
        for headers in ({"Origin": "https://foreign.invalid"}, {"Host": "foreign.invalid"}, {"Sec-Fetch-Site": "cross-site"}):
            self.assertEqual(self.request(headers=headers)[0], 403)
        self.assertEqual(self.request(method="POST")[0], 405)
        self.assertEqual(self.calls, [])
        self.server.compact_projection = lambda root, **options: {"padding": "x" * REVIEW_MAX_BYTES}
        code, _, body = self.request(headers={"X-Review-Work-Items": CHUNK_REFERENCE_FORMAT})
        self.assertEqual(code, 503)
        self.assertEqual(json.loads(body), {"error": "review.projection-unavailable"})


if __name__ == "__main__":
    unittest.main()
