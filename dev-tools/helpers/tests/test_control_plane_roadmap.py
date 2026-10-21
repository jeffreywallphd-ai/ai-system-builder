"""Governed roadmap closure checks actual current source, including corrections."""
import argparse
import copy
import importlib.util
import json
from pathlib import Path

from test_control_plane_delivery import Fixture, HELPERS
from control_plane.contracts import ControlError

REPO = HELPERS.parents[1]
spec = importlib.util.spec_from_file_location("roadmap_test_fixtures", REPO / "skills/manage-implementation-roadmaps/tests/test_roadmap.py")
fixtures = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixtures)
roadmap = fixtures.roadmap


class GovernedTests(Fixture):
    def setUp(self):
        super().setUp()
        self.repository(start=False)
        self.put("skills/manage-implementation-roadmaps/scripts/roadmap.py", (REPO / "skills/manage-implementation-roadmaps/scripts/roadmap.py").read_text())
        self.put("dev-tools/helpers/control_plane/work.py", "# Adapter presence; tests use the real imported adapter.\n")
        self.put("dev-tools/helpers/development_control_plane.py", "# Governed adapter present\n")
        self.put("dev-tools/scripts/testing/run-test-suite.mjs", 'import fs from "node:fs"; process.exit(fs.readFileSync("docs/result.md","utf8").startsWith("completed") ? 0 : 1);')
        self.engine = fixtures.RoadmapEngineTest()
        self.engine.repo = self.root
        self.engine.state = roadmap.initial_state(self.root, {"name": "Fixture", "slug": "governed", "objective": "Qualify final candidate"})
        self.engine.define_and_approve([fixtures.increment_definition("increment-1", 1)])
        real_apply = self.engine.apply
        self.engine.apply = lambda event: None if event["type"] == "increment-completed" else real_apply(event)
        self.engine.execute_increment(1)
        self.engine.apply = real_apply
        self.save()
        self.spec.update(kind="roadmap", roadmap={"state_path": self.engine.state["paths"]["state"], "increment_id": "increment-1"})
        self.spec["acceptance"] = [{"id": c["id"], "description": c["description"], "check_ids": ["documentation"]} for c in self.engine.state["increments"][0]["acceptanceCriteria"]]

    def save(self):
        roadmap.write_project_files(self.root, self.engine.state)

    def finish(self, name, *, overall=False):
        spec = copy.deepcopy(self.spec)
        spec["work_id"] = name
        if overall:
            spec["roadmap"]["increment_id"] = "overall"
            spec["acceptance"] = [{"id": "overall-validation", "description": "Final integration", "check_ids": ["completion-standardande2e"]}]
        claim = self.work.start(spec, "author-run")["claim"]["claim_id"]
        self.put("docs/result.md", "completed " + name)
        receipt = self.work.verify(name, "author-run", claim)
        self.work.review({"schema_version": "technical-review-v1", "work_id": name, "invocation_id": "review-run", "assurance": "operator-attested", "disposition": "accepted", "receipt_digest": receipt["receipt_digest"], "findings": [], "closures": [], "reviewed_criteria": [a["id"] for a in spec["acceptance"]]})
        self.work.complete(name, "author-run", claim)

    def test_current_correction_wins_regardless_of_alphabetical_identity(self):
        self.finish("z-original")
        self.finish("a-correction")
        roadmap.require_control_completion(self.root, self.engine.state)

    def overall_spec(self):
        spec = copy.deepcopy(self.spec)
        spec["work_id"] = "overall-implementation-check"
        spec["roadmap"]["increment_id"] = "overall"
        spec["acceptance"] = [{"id": "overall-validation", "description": "Final implementation checks", "check_ids": ["completion-standardande2e"]}]
        return spec

    def test_overall_admits_final_verifying_implementation_but_rejects_early_or_stale(self):
        self.assertTrue(roadmap.implementation_ready_for_overall(self.engine.state))
        claim = self.work.start(self.overall_spec(), "aggregate-review")
        self.assertIn("claim", claim)
        cases = []
        for patch in ({"completedChunks": []}, {"plan": None}, {"status": "implementing"}, {"completedChunks": ["chunk-1", "chunk-1"]}):
            state = copy.deepcopy(self.engine.state)
            state["increments"][0].update(patch)
            cases.append(state)
        for patch in ({"roadmapApproval": None}, {"currentIncrementId": None}, {"blockers": [{"status": "open"}]}):
            state = copy.deepcopy(self.engine.state)
            state.update(patch)
            cases.append(state)
        for state in cases:
            self.assertFalse(roadmap.implementation_ready_for_overall(state))

    def test_overall_does_not_skip_predecessor_implementation_or_change_suite(self):
        state = copy.deepcopy(self.engine.state)
        earlier = copy.deepcopy(state["increments"][0])
        earlier.update(id="earlier", number=0, status="implemented-pending-qualification")
        state["increments"].insert(0, earlier)
        state["roadmapApproval"]["fingerprint"] = roadmap.roadmap_fingerprint(state)
        self.assertTrue(roadmap.implementation_ready_for_overall(state))
        earlier["completedChunks"] = []
        self.assertFalse(roadmap.implementation_ready_for_overall(state))
        earlier["completedChunks"] = ["chunk-1"]
        earlier["status"] = "blocked"
        self.assertFalse(roadmap.implementation_ready_for_overall(state))
        spec = self.overall_spec()
        spec["acceptance"][0]["check_ids"] = ["completion-all"]
        with self.assertRaises(ControlError):
            self.work.start(spec, "aggregate-review")

    def test_pending_controlled_evidence_admits_checks_without_qualifying_closure(self):
        self.engine.state = roadmap.initial_state(self.root, {"name": "Fixture", "slug": "pending-fixture", "objective": "Preserve missing qualification"})
        self.spec["roadmap"]["state_path"] = self.engine.state["paths"]["state"]
        self.engine.define_and_approve([fixtures.increment_definition("increment-1", 1, qualification="controlled-environment", allow_pending=True)])
        real_apply = self.engine.apply
        self.engine.apply = lambda event: None if event["type"] == "increment-completed" else real_apply(event)
        self.engine.execute_increment(1, outcome="pending")
        self.engine.apply = real_apply
        self.save()
        self.assertTrue(roadmap.implementation_ready_for_overall(self.engine.state))
        self.finish("pending-overall-work", overall=True)
        roadmap.handle_increment_completed(self.engine.state, {"type": "increment-completed", "summary": "Implementation only"})
        self.assertEqual(self.engine.state["status"], "implementation-complete-qualification-pending")
        self.assertTrue(roadmap.implementation_ready_for_overall(self.engine.state))
        with self.assertRaisesRegex(roadmap.RoadmapError, "controlled-environment"):
            roadmap.handle_roadmap_completed(self.engine.state, {"type": "roadmap-completed", "summary": "Must be refused"})

    def test_final_public_event_requires_fresh_overall_qualification(self):
        self.finish("increment-work")
        roadmap.require_control_completion(self.root, self.engine.state)
        self.engine.apply({"type": "increment-completed", "summary": "Increment qualified"})
        self.save()
        event = self.put(".local-codex/complete.json", json.dumps({"type": "roadmap-completed", "summary": "Final qualified candidate"}))
        args = argparse.Namespace(repo=str(self.root), state=self.engine.state["paths"]["state"], event_file=str(event), dry_run=False)
        with self.assertRaises(roadmap.RoadmapError): roadmap.command_apply(args)
        self.finish("overall-work", overall=True)
        self.put("docs/result.md", "broken after final checks")
        with self.assertRaises(roadmap.RoadmapError): roadmap.command_apply(args)
        self.finish("overall-correction", overall=True)
        self.assertEqual(roadmap.command_apply(args)["status"], "completed")

    def test_unsupported_configured_path_is_rejected_before_state_creation(self):
        with self.assertRaisesRegex(roadmap.RoadmapError, "requires .implementation-roadmaps"):
            roadmap.initial_state(self.root, {"name": "Invalid", "slug": "invalid", "objective": "Do not create uncompletable state", "statePath": "docs/roadmaps/custom-state.json"})
        self.assertFalse((self.root / "docs/roadmaps/custom-state.json").exists())
