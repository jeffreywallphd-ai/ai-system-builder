"""Real HTTP and JSON projection evidence; no Markdown source parsing."""
from __future__ import annotations

import http.client
import importlib.util
import json
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch
from pathlib import Path

HELPERS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HELPERS))
from control_plane.common import digest
from control_plane.projection import REVIEW_MAX_BYTES, encode_review_projection, project
from control_plane.records import Records
from control_plane import site
from control_plane.storage import canonical_bytes
from control_plane.work import Work

spec = importlib.util.spec_from_file_location("review_server_test", HELPERS.parent / "review-site/server.py")
server_module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(server_module)


class IncrementActivityTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="cp-activity-")
        self.root = Path(self.temp.name)
        self.addCleanup(self.temp.cleanup)
        for slug in ("first", "second"):
            p = self.root / f".implementation-roadmaps/{slug}/state.json"
            p.parent.mkdir(parents=True)
            p.write_text(json.dumps({"schemaVersion": 1, "slug": slug, "name": slug,
                "objective": "Review work", "status": "executing", "currentIncrementId": "same",
                "increments": [{"id": "same", "number": 1, "title": "Shared label", "objective": "Deliver work",
                    "status": "verifying", "acceptanceCriteria": []}]}))

    def work(self, binding=None, claim=None, status="active", kind="roadmap"):
        return {"spec": {"work_id": "activity-work", "title": "Activity work", "kind": kind,
                "outcome": {}, "roadmap": binding if binding is not None else {
                    "state_path": ".implementation-roadmaps/first/state.json", "increment_id": "same"}},
            "status": status, "claim": claim if claim is not None else {
                "invocation_id": "opaque-private-invocation", "claim_id": "opaque-private-claim",
                "expires_at": "2026-10-31T13:01:00-04:00", "fence": 1},
            "events": [{"at": "2026-10-31T16:00:00Z", "code": "work.started"}], "receipts": [], "reviews": []}

    def projection(self, work, at="2026-10-31T17:00:00Z"):
        state = Records.empty()
        if work is not None: state["work_items"]["activity-work"] = work
        with patch.object(Records, "load", return_value=state), patch("control_plane.projection.now", return_value=at):
            return project(self.root)

    def flags(self, value):
        return {r["id"]: r["increments"][0].get("actively_worked", False) for r in value["roadmaps"]}

    def test_only_exact_current_unexpired_roadmap_claim_marks_advisory_activity(self):
        value = self.projection(self.work())
        self.assertEqual(self.flags(value), {"first": True, "second": False})
        public = json.dumps(value)
        for private in ("opaque-private-claim", "opaque-private-invocation", ".implementation-roadmaps/"):
            self.assertNotIn(private, public)
        expired = self.projection(self.work(), "2026-10-31T17:01:00Z")
        self.assertEqual(self.flags(expired), {"first": False, "second": False})
        self.assertNotEqual(value["source_digest"], expired["source_digest"])

    def test_live_claim_stays_active_during_successful_and_failed_verification_until_release(self):
        service = Work(self.root)
        spec = {"schema_version": "development-work-v1", "work_id": "activity-work",
            "kind": "roadmap", "title": "Verify claimed work", "authority_ref": "fixture-request",
            "outcome": {"problem": "Keep current work visible", "success": "The claimed increment stays open",
                "quality": "Preserve exact ownership", "internal_rationale": "Contributor lifecycle fixture"},
            "roadmap": {"state_path": ".implementation-roadmaps/first/state.json", "increment_id": "same"},
            "write_scope": ["docs/result.md"],
            "acceptance": [{"id": "result", "description": "Claimed work remains visible", "check_ids": ["documentation"]}]}
        baseline = {"schema_version": "source-snapshot-v1", "head": "0" * 40, "files": {}, "source_digest": digest({})}
        plan = {"selected": [{"id": "documentation"}], "changed_paths": [], "plan_digest": digest("fixture-plan")}
        # Stub external authority/check execution; use real Work and persisted Records for lifecycle transitions.
        with patch("control_plane.work.roadmap_authority", return_value=digest("fixture-authority")), \
                patch("control_plane.work.snapshot", return_value=baseline), \
                patch("control_plane.work.catalog.plan", return_value=plan):
            claim = service.start(spec, "lifecycle-fixture-run")["claim"]
            self.assertEqual(self.flags(project(self.root)), {"first": True, "second": False})
            for status, exit_code in (("passed", 0), ("failed", 1)):
                with self.subTest(check_status=status):
                    attempt = {"check_id": "documentation", "status": status, "exit_code": exit_code,
                        "duration_ms": 0.0, "output": {}, "command_digest": digest("fixture-check")}
                    with patch("control_plane.work.execute", return_value=attempt):
                        service.verify("activity-work", "lifecycle-fixture-run", claim["claim_id"])
                    work = service.records.load()["work_items"]["activity-work"]
                    self.assertEqual(work["status"], "verifying")
                    self.assertEqual(work["claim"], claim)
                    self.assertEqual(self.flags(project(self.root)), {"first": True, "second": False})
            service.claim("activity-work", "lifecycle-fixture-run", claim["claim_id"], action="release")
        self.assertEqual(self.flags(project(self.root)), {"first": False, "second": False})
        public = json.dumps(project(self.root))
        self.assertNotIn(claim["claim_id"], public)
        self.assertNotIn("lifecycle-fixture-run", public)

    def test_unknown_or_terminal_status_and_invalid_verifying_claim_stay_closed(self):
        for status in ("complete", "pending", "unknown", None):
            with self.subTest(status=status):
                self.assertEqual(self.flags(self.projection(self.work(status=status))), {"first": False, "second": False})
        work = self.work(status="verifying")
        for claim in (None, {}, {**work["claim"], "expires_at": "2026-10-31T17:00:00Z"},
                {**work["claim"], "expires_at": "invalid"}, {**work["claim"], "fence": False}):
            with self.subTest(claim=claim):
                fixture = {**work, "claim": claim}
                self.assertEqual(self.flags(self.projection(fixture)), {"first": False, "second": False})

    def test_inactive_invalid_foreign_and_overall_claims_cannot_open_an_increment(self):
        valid = self.work()
        fixtures = [None, self.work(status="complete"), self.work(claim={}), self.work(kind="lightweight"),
            self.work(binding={"state_path": ".implementation-roadmaps/second-copy/state.json", "increment_id": "same"}),
            self.work(binding={"state_path": ".implementation-roadmaps/first/state.json", "increment_id": "overall"}),
            self.work(binding={"state_path": ".implementation-roadmaps/first/state.json", "increment_id": "other"}),
            self.work(binding={"state_path": ".implementation-roadmaps/first/state.json", "increment_id": "same", "extra": True})]
        for expires in (None, "invalid", "2026-10-31T17:01:00", "2026-10-31T16:59:00Z"):
            fixtures.append(self.work(claim={**valid["claim"], "expires_at": expires}))
        for invalid in ({"fence": True}, {"fence": 0}, {"claim_id": ""}, {"invocation_id": None}):
            fixtures.append(self.work(claim={**valid["claim"], **invalid}))
        for work in fixtures:
            with self.subTest(work=work):
                self.assertEqual(self.flags(self.projection(work)), {"first": False, "second": False})
        released = self.work();released["claim"] = None
        self.assertEqual(self.flags(self.projection(released)), {"first": False, "second": False})

    def test_completed_ambiguous_or_misbound_targets_never_show_as_active(self):
        path = self.root / ".implementation-roadmaps/first/state.json"
        original = json.loads(path.read_text())
        for field, status in (("roadmap", "completed"), ("increment", "completed"), ("increment", "complete"), ("increment", "final-approved"), ("slug", "different-slug"), ("duplicate", None)):
            state = json.loads(json.dumps(original))
            if field == "roadmap": state["status"] = status
            elif field == "increment": state["increments"][0]["status"] = status
            elif field == "slug": state["slug"] = status
            else: state["increments"].append(dict(state["increments"][0]))
            path.write_text(json.dumps(state))
            value = self.projection(self.work())
            self.assertFalse(any(i["actively_worked"] for r in value["roadmaps"] for i in r["increments"]))
        path.write_text(json.dumps(original))
        state = Records.empty()
        state["work_items"]["first"] = self.work()
        state["work_items"]["second"] = self.work(binding={"state_path": ".implementation-roadmaps/second/state.json", "increment_id": "same"})
        with patch.object(Records, "load", return_value=state), patch("control_plane.projection.now", return_value="2026-10-31T17:00:00Z"):
            self.assertEqual(self.flags(project(self.root)), {"first": False, "second": False})

    def test_all_source_identities_count_before_status_or_display_eligibility(self):
        path = self.root / ".implementation-roadmaps/first/state.json"
        original = json.loads(path.read_text())
        live = original["increments"][0]
        fixtures = []
        for status in ("completed", "complete", "final-approved"):
            closed = {**live, "status": status}
            fixtures.extend((([live, closed], "same"), ([closed, live], "same")))
        fillers = [{**live, "id": f"different-{i}"} for i in range(99)]
        fixtures.append(([live, *fillers, {**live, "status": "completed"}], "same"))
        long_id = "x" * 80
        fixtures.append(([{**live, "id": long_id}, {**live, "id": long_id + "-alias", "status": "completed"}], long_id))
        for rows, target in fixtures:
            with self.subTest(statuses=[row["status"] for row in rows[:2]], count=len(rows), target_length=len(target)):
                state = {**original, "currentIncrementId": target, "increments": rows}
                path.write_text(json.dumps(state))
                work = self.work(binding={"state_path": ".implementation-roadmaps/first/state.json", "increment_id": target})
                value = self.projection(work)
                self.assertFalse(any(i["actively_worked"] for r in value["roadmaps"] for i in r["increments"]))

    def test_reserved_overall_claim_never_targets_an_increment_named_overall(self):
        path = self.root / ".implementation-roadmaps/first/state.json"
        state = json.loads(path.read_text())
        state["currentIncrementId"] = "overall"
        state["increments"][0]["id"] = "overall"
        path.write_text(json.dumps(state))
        work = self.work(binding={"state_path": ".implementation-roadmaps/first/state.json", "increment_id": "overall"})
        self.assertEqual(self.flags(self.projection(work)), {"first": False, "second": False})


class SiteTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="cp-")
        self.root = Path(self.temp.name)
        self.addCleanup(self.temp.cleanup)
        self.server = server_module.Server(("127.0.0.1", 0), self.root)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.addCleanup(self.close)

    def close(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(2)

    def request(self, path="/api/review", method="GET", headers=None):
        c = http.client.HTTPConnection("127.0.0.1", self.server.server_port, timeout=3)
        c.request(method, path, headers=headers or {})
        response = c.getresponse()
        result = response.status, dict(response.getheaders()), response.read()
        c.close()
        return result

    def test_remote_binding_is_refused(self):
        with self.assertRaises(ValueError): server_module.Server(("0.0.0.0", 0), self.root)

    def test_final_wire_boundary_and_head_use_the_same_compact_bytes(self):
        overhead = len(encode_review_projection({"text": ""}))
        payload = {"text": "x" * (REVIEW_MAX_BYTES - overhead)}
        self.server.projection = lambda root: payload
        status, headers, body = self.request()
        self.assertEqual(status, 200)
        self.assertEqual(len(body), REVIEW_MAX_BYTES)
        self.assertEqual(int(headers["Content-Length"]), len(body))
        self.assertEqual(json.loads(body), payload)
        head_status, head_headers, head_body = self.request(method="HEAD")
        self.assertEqual(head_status, 200)
        self.assertEqual(head_headers["Content-Length"], headers["Content-Length"])
        self.assertEqual(head_body, b"")
        payload["text"] += "x"
        for method in ("GET", "HEAD"):
            with self.subTest(method=method):
                status, headers, body = self.request(method=method)
                self.assertEqual(status, 503)
                self.assertLess(int(headers["Content-Length"]), 100)
                self.assertEqual(body, b"" if method == "HEAD" else b'{"error": "review.projection-unavailable"}')

    def test_nonfinite_and_encoded_unicode_overflow_have_only_a_safe_error(self):
        for payload in ({"value": float("nan")}, {"text": "\u00e9" * (REVIEW_MAX_BYTES // 6)}):
            with self.subTest(kind=next(iter(payload))):
                self.server.projection = lambda root: payload
                status, _, body = self.request()
                self.assertEqual(status, 503)
                self.assertEqual(json.loads(body), {"error": "review.projection-unavailable"})

    def test_stale_server_is_distinguished_from_a_foreign_instance_for_shutdown(self):
        port = self.server.server_port
        with patch.object(site, "server_version", return_value="newer-code"):
            self.assertIsNone(site.probe(port, self.root))
            stale = site.probe(port, self.root, require_current=False)
            self.assertEqual(stale["status"], "stale")
            path = self.root / ".local-codex/control-plane/review-server.json"
            path.parent.mkdir(parents=True)
            path.write_bytes(canonical_bytes(stale))
            self.assertEqual(site.status(self.root)["status"], "stale")
            with patch.object(site, "terminate_recorded") as terminate:
                self.assertEqual(site.stop(self.root)["status"], "stop-requested")
                self.assertEqual(terminate.call_args.args[0]["instance_id"], stale["instance_id"])

    def test_shutdown_refuses_changed_process_identity(self):
        from control_plane.contracts import ControlError
        with patch.object(site.os, "kill") as kill:
            with self.assertRaises(ControlError):
                site.terminate_recorded({"pid": 1234, "instance_id": "original"}, {"pid": 1234, "instance_id": "different"})
            kill.assert_not_called()

    def test_host_origin_methods_and_fixed_routes(self):
        for headers in ({"Host": "evil.invalid"}, {"Origin": "https://evil.invalid"}, {"Sec-Fetch-Site": "cross-site"}):
            self.assertEqual(self.request(headers=headers)[0], 403)
        for method in ("POST", "PUT", "DELETE", "OPTIONS"):
            self.assertEqual(self.request(method=method)[0], 405)
        for path in ("/../AGENTS.md", "/api/review?path=private", "/.local-codex/approvals/ledger.json", "/%2e%2e/README.md"):
            self.assertEqual(self.request(path)[0], 404)
        status, headers, body = self.request("/")
        self.assertEqual(status, 200)
        self.assertIn("frame-ancestors 'none'", headers["Content-Security-Policy"])
        self.assertNotIn("Access-Control-Allow-Origin", headers)

    def test_live_full_unapproved_draft_replaces_discovery_shell_without_granting_authority(self):
        path = self.root / ".implementation-roadmaps/draft/state.json"
        path.parent.mkdir(parents=True)
        value = {"schemaVersion": 1, "slug": "draft", "name": "Reviewable draft", "objective": "Deliver a complete user journey",
                 "status": "discovery", "roadmapApproval": None, "increments": []}
        path.write_text(json.dumps(value))
        shell = json.loads(self.request()[2])
        self.assertEqual(shell["roadmaps"][0]["increments"], [])
        value["status"] = "roadmap-review"
        value["increments"] = [{"id": f"increment-{number}", "number": number, "title": f"Outcome {number}",
            "objective": f"Deliver outcome {number}", "status": "pending", "completedChunks": [], "plan": None,
            "dependsOn": [] if number == 1 else ["increment-1"],
            "workPackages": [{"id": f"package-{number}", "title": f"Package {number}", "outcome": f"Usable outcome {number}"}],
            "deliverables": [f"Delivered behavior {number}"],
            "verification": [f"Execute focused verification {number}"],
            "rollback": f"Revert the additive behavior {number} while retaining controls.",
            "excluded": [f"Unrelated scope {number}"],
            "acceptanceCriteria": [{"id": f"works-{number}", "description": f"The complete user task {number} passes.", "qualification": "local"},
                                   {"id": "security-impact-reviewed", "description": "Security controls and denial behavior are reviewed.", "qualification": "local"}]}
            for number in (1, 2)]
        published = json.dumps(value)
        path.write_text(published)
        status, _, body = self.request()
        self.assertEqual(status, 200)
        live = json.loads(body)
        draft = next(row for row in live["roadmaps"] if row["id"] == "draft")
        self.assertEqual(draft["status"], "roadmap-review")
        self.assertEqual(len(draft["increments"]), 2)
        self.assertEqual(sum(len(i["criteria"]) for i in draft["increments"]), 4)
        for number, increment in enumerate(draft["increments"], 1):
            self.assertEqual(increment["objective"], f"Deliver outcome {number}")
            self.assertEqual({c["id"] for c in increment["criteria"]}, {f"works-{number}", "security-impact-reviewed"})
            self.assertTrue(all(c["description"] and c["outcome"] == "missing" for c in increment["criteria"]))
            self.assertTrue(all(c["qualification"] == "local" for c in increment["criteria"]))
            definition = value["increments"][number - 1]
            self.assertEqual(increment["proposal"], {
                "depends_on": definition["dependsOn"],
                "work_packages": definition["workPackages"],
                "deliverables": definition["deliverables"],
                "verification": definition["verification"],
                "rollback": definition["rollback"],
                "excluded": definition["excluded"],
            })
            self.assertTrue(increment["chunk_plan_pending_approval"])
            self.assertEqual(increment["chunks_complete"], 0)
        self.assertNotEqual(live["source_digest"], shell["source_digest"])
        self.assertEqual(path.read_text(), published)
        self.assertIsNone(json.loads(path.read_text())["roadmapApproval"])
        self.assertFalse(any(self.root.rglob("*.md")))

    def test_json_changes_are_dynamic_without_markdown(self):
        p = self.root / ".implementation-roadmaps/example/state.json"
        p.parent.mkdir(parents=True)
        value = {"schemaVersion": 1, "slug": "example", "name": "Example", "objective": "Observe a real outcome", "status": "ready", "increments": []}
        p.write_text(json.dumps(value))
        before = json.loads(self.request()[2])
        value["status"] = "executing"
        p.write_text(json.dumps(value))
        after = json.loads(self.request()[2])
        self.assertEqual(after["roadmaps"][0]["status"], "executing")
        self.assertNotEqual(before["source_digest"], after["source_digest"])
        self.assertFalse(any(self.root.rglob("*.md")))

    def test_theme_is_local_fixed_asset_behavior_without_new_mutation_routes(self):
        status, headers, html = self.request("/")
        self.assertEqual(status, 200)
        self.assertIn(b'data-theme="dark"', html)
        self.assertIn(b'id="theme-toggle" type="button"', html)
        self.assertIn(b'aria-label="Switch to light mode. Current theme: dark."', html)
        self.assertNotIn("unsafe-inline", headers["Content-Security-Policy"])
        status, _, css = self.request("/style.css")
        self.assertEqual(status, 200)
        self.assertIn(b'color-scheme:dark', css)
        self.assertIn(b':root[data-theme="light"]', css)
        self.assertIn("›".encode("utf-8"), css)
        self.assertNotIn("â€º".encode("utf-8"), css)
        self.assertEqual(self.request("/api/theme", method="POST")[0], 405)
        self.assertEqual(self.request("/api/review?theme=light")[0], 404)

    def test_private_notes_and_paths_are_not_projected(self):
        p = self.root / ".implementation-roadmaps/example/state.json"
        p.parent.mkdir(parents=True)
        p.write_text(json.dumps({"schemaVersion": 1, "slug": "example", "name": "password=synthetic-secret", "objective": "Example", "status": "ready", "increments": [], "roadmapApproval": {"note": "synthetic-private-approval"}}))
        value = json.dumps(project(self.root))
        self.assertNotIn("synthetic-secret", value)
        self.assertNotIn("synthetic-private-approval", value)
        self.assertNotIn(str(self.root), value)

    def test_work_items_trace_real_chunks_and_criteria_independently(self):
        path = self.root / ".implementation-roadmaps/trace/state.json"
        path.parent.mkdir(parents=True)
        value = {"schemaVersion": 1, "slug": "trace", "name": "Trace workflow", "objective": "Show meaningful work", "status": "executing", "currentIncrementId": "increment", "chunks": [{"incrementId": "increment", "chunkId": "first", "completedAt": "2026-10-21T00:00:00Z", "summary": "First implementation is complete", "tests": ["recorded check", "password=synthetic-secret"]}], "evidence": [{"incrementId": "increment", "criterionId": "works", "outcome": "passed", "summary": "Criterion has passing evidence"}], "increments": [{"id": "increment", "number": 1, "title": "Deliver outcome", "objective": "Complete the user task", "status": "implementing", "completedChunks": ["first"], "acceptanceCriteria": [{"id": "works", "description": "The task works"}], "plan": {"chunks": [{"id": "first", "title": "First chunk", "outcome": "Initial behavior", "criteriaIds": ["works"]}, {"id": "second", "title": "Second chunk", "outcome": "Remaining behavior", "criteriaIds": ["works"]}]}}]}
        path.write_text(json.dumps(value))
        data = json.loads(self.request()[2])
        self.assertEqual(len(data["work_items"]), 2)
        by_id = {w["chunk_id"]: w for w in data["work_items"]}
        self.assertEqual(by_id["first"]["status"], "completed")
        self.assertEqual(by_id["second"]["status"], "planned")
        self.assertTrue(by_id["second"]["is_next"])
        self.assertEqual(by_id["second"]["criteria"][0]["outcome"], "passed")
        self.assertEqual(by_id["first"]["roadmap_id"], "trace")
        self.assertEqual(by_id["first"]["evidence_policy"], "declarative-legacy")
        self.assertNotIn("receipt_count", by_id["first"])
        self.assertNotIn("synthetic-secret", json.dumps(data))
        value["increments"][0]["completedChunks"].append("second")
        path.write_text(json.dumps(value))
        refreshed = json.loads(self.request()[2])
        self.assertEqual(refreshed["roadmaps"][0]["increments"][0]["chunks_complete"], 2)
        self.assertTrue(all(w["status"] == "completed" for w in refreshed["work_items"]))
        self.assertNotEqual(data["source_digest"], refreshed["source_digest"])

    def test_malformed_record_yields_safe_diagnostic(self):
        p = self.root / ".implementation-roadmaps/example/state.json"
        p.parent.mkdir(parents=True)
        p.write_text("{malformed")
        data = json.loads(self.request()[2])
        self.assertEqual(data["diagnostics"], [{"code": "projection.roadmap-unavailable"}])

    def test_newest_creation_orders_roadmaps_and_work_without_promoting_updates(self):
        def roadmap(slug, created, plan_created=None):
            p = self.root / (".implementation-roadmaps/" + slug + "/state.json")
            p.parent.mkdir(parents=True)
            value = {"schemaVersion": 1, "slug": slug, "name": slug, "objective": "Review work", "status": "executing", "createdAt": created, "updatedAt": "2099-01-01T00:00:00Z", "increments": []}
            if plan_created:
                value["increments"] = [{"id": "increment", "number": 1, "title": "Deliver outcome", "objective": "Complete work", "status": "implementing", "acceptanceCriteria": [], "plan": {"recordedAt": plan_created, "chunks": [{"id": "chunk", "title": "Planned work", "outcome": "Useful outcome", "criteriaIds": []}]}}]
            p.write_text(json.dumps(value))
        roadmap("a-old", "2026-10-20T08:00:00Z", "2026-10-20T09:00:00Z")
        roadmap("z-new", "2026-10-20T05:30:00-04:00", "2026-10-20T12:00:00Z")
        roadmap("undated", "invalid private timestamp")
        def add_work(s):
            for name, at, status in (("active-old", "2026-10-20T10:00:00Z", "active"), ("complete-new", "2026-10-20T13:00:00Z", "complete")):
                s["work_items"][name] = {"spec": {"work_id": name, "title": name, "kind": "lightweight", "outcome": {}}, "status": status, "events": [{"at": at}, {"at": "2099-01-01T00:00:00Z"}], "receipts": [], "reviews": []}
        Records(self.root).mutate(add_work)
        data = json.loads(self.request()[2])
        self.assertEqual([r["id"] for r in data["roadmaps"]], ["z-new", "a-old", "undated"])
        self.assertIsNone(data["roadmaps"][-1]["created_at"])
        self.assertEqual([w["id"] for w in data["work_items"]], ["complete-new", "z-new/increment/chunk", "active-old", "a-old/increment/chunk"])
        self.assertEqual(data["roadmaps"][0]["created_at"], "2026-10-20T09:30:00.000000Z")
        self.assertNotIn("invalid private timestamp", json.dumps(data))

    def test_roadmap_order_keeps_creation_ties_and_undated_stable_across_completion(self):
        fixtures = [
            ("z-undated", "completed", None),
            ("b-tie", "final-approved", "2026-10-20T10:00:00Z"),
            ("a-tie", "executing", "2026-10-20T06:00:00-04:00"),
            ("a-undated", "blocked", "invalid"),
            ("new-completed", "completed", "2026-10-21T10:00:00Z"),
        ]
        for slug, status, created in fixtures:
            p = self.root / (".implementation-roadmaps/" + slug + "/state.json")
            p.parent.mkdir(parents=True)
            p.write_text(json.dumps({"schemaVersion": 1, "slug": slug, "name": slug,
                "objective": "Review original chronology", "status": status, "createdAt": created,
                "updatedAt": "2099-01-01T00:00:00Z", "completion": {"completedAt": "2099-01-01T00:00:00Z"}, "increments": []}))
        before = json.loads(self.request()[2])
        expected = ["new-completed", "a-tie", "b-tie", "a-undated", "z-undated"]
        self.assertEqual([r["id"] for r in before["roadmaps"]], expected)
        p = self.root / ".implementation-roadmaps/a-tie/state.json"
        value = json.loads(p.read_text())
        value["status"] = "completed"
        p.write_text(json.dumps(value))
        after = json.loads(self.request()[2])
        self.assertEqual([r["id"] for r in after["roadmaps"]], expected)
        self.assertEqual([r["created_at"] for r in before["roadmaps"]], [r["created_at"] for r in after["roadmaps"]])
        self.assertEqual(after["roadmaps"][1]["status"], "completed")
        self.assertNotEqual(before["source_digest"], after["source_digest"])


if __name__ == "__main__": unittest.main()
