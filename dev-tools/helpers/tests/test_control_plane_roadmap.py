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

    def test_offline_acceptance_is_separate_from_active_chunk_criteria(self):
        from control_plane.projection import project
        state = copy.deepcopy(self.engine.state)
        state.pop("evidencePolicy")
        state["increments"][0]["plan"]["chunks"][0]["criteriaIds"].extend(["human-review", "unresolved-reference"])
        state["humanAcceptanceTransfers"] = [{"incrementId": "increment-1", "status": "offline-user-owned",
            "criteria": [{"id": "human-review", "description": "Manual acceptance"}],
            "authorityRef": "private-operator-reference", "originalPlan": {"private": "do-not-project"}}]
        self.put(state["paths"]["state"], json.dumps(state))
        data = project(self.root)
        increment = data["roadmaps"][0]["increments"][0]
        self.assertEqual(data["roadmaps"][0]["evidence_policy"], "declarative-legacy")
        self.assertNotIn("human-review", increment["chunks"][0]["criteria_ids"])
        self.assertIn("unresolved-reference", increment["chunks"][0]["criteria_ids"])
        self.assertEqual(increment["offline_acceptance"][0]["status"], "offline-user-owned")
        self.assertNotIn("private-operator-reference", json.dumps(data))
        self.assertNotIn("do-not-project", json.dumps(data))

    def test_governed_scope_change_invalidates_real_completed_receipt(self):
        state = self.engine.state
        criterion = state["increments"][0]["acceptanceCriteria"][0]
        criterion.update(qualification="controlled-environment", description="Performance and manual screen reader")
        state["increments"][0]["allowPendingQualification"] = True
        state["evidence"][0]["outcome"] = "pending"
        state["roadmapApproval"]["fingerprint"] = roadmap.roadmap_fingerprint(state)
        self.save()
        self.finish("before-scope-change")
        roadmap.require_control_completion(self.root, state)
        original_evidence = copy.deepcopy(state["evidence"])
        self.engine.apply({"type": "acceptance-scope-revised", "incrementId": "increment-1",
            "approvedFingerprint": roadmap.roadmap_fingerprint(state), "authorityRef": "explicit-user-agent-only",
            "onlyHumanScope": True, "summary": "Manual screen reader is user-owned; measured performance remains pending",
            "removeCriterionIds": [], "replaceCriteria": [{"criterion": {**criterion, "description": "Performance and automated accessibility"}, "humanScope": "Manual screen reader"}]})
        self.engine.apply({"type": "roadmap-approved", "note": "Actual narrow human scope direction"})
        self.save()
        self.assertEqual(self.engine.state["evidence"], original_evidence)
        with self.assertRaises(roadmap.RoadmapError):
            roadmap.require_control_completion(self.root, self.engine.state)
        self.assertEqual(self.engine.state["increments"][0]["status"], "verifying")
        with self.assertRaises(roadmap.RoadmapError):
            roadmap.handle_roadmap_completed(self.engine.state, {"type": "roadmap-completed", "summary": "No metadata qualification"})

    def test_governed_offline_projection_keeps_mixed_technical_links_private(self):
        from control_plane.projection import project
        state = copy.deepcopy(self.engine.state)
        state["increments"][0]["plan"]["chunks"][0]["criteriaIds"].extend(["human-review", "unknown-reference"])
        state["acceptanceScopeRevisions"] = [{"incrementId": "increment-1", "status": "offline-user-owned",
            "removedCriteria": [{"id": "human-review", "description": "Five participant study"}],
            "replacedCriteria": [{"original": {"id": "criterion-1"}, "revised": {"id": "criterion-1"}, "humanScope": "Manual screen reader"}],
            "authorityRef": "private-scope-reference", "originalPlan": {"private": "private-plan-sentinel"}}]
        self.put(state["paths"]["state"], json.dumps(state))
        data = project(self.root)
        increment = data["roadmaps"][0]["increments"][0]
        self.assertNotIn("human-review", increment["chunks"][0]["criteria_ids"])
        self.assertIn("criterion-1", increment["chunks"][0]["criteria_ids"])
        self.assertIn("unknown-reference", increment["chunks"][0]["criteria_ids"])
        self.assertEqual(len(increment["offline_acceptance"][0]["criteria"]), 2)
        self.assertNotIn("private-scope-reference", json.dumps(data))
        self.assertNotIn("private-plan-sentinel", json.dumps(data))

    def test_governed_evidence_declarations_never_replace_targeted_increment_review(self):
        state = self.engine.state
        state["increments"][0]["acceptanceCriteria"][0]["qualification"] = "controlled-environment"
        state["increments"][0]["allowPendingQualification"] = True
        state["evidence"][0]["outcome"] = "pending"
        state["roadmapApproval"]["fingerprint"] = roadmap.roadmap_fingerprint(state)
        self.engine.apply({"type": "increment-completed", "summary": "Implementation complete; actual technical qualification pending"})
        self.save()
        event = self.put(".local-codex/passed-qualification.json", json.dumps({"type": "evidence-recorded", "incrementId": "increment-1",
            "criterionId": "criterion-1", "kind": "external", "outcome": "passed", "summary": "Synthetic declaration is not targeted current review"}))
        args = argparse.Namespace(repo=str(self.root), state=state["paths"]["state"], event_file=str(event), dry_run=False)
        for authority in ["missing", "overall-reviewed"]:
            if authority == "overall-reviewed": self.finish("scope-overall-current", overall=True)
            roadmap.command_apply(args)
            after = json.loads((self.root / args.state).read_text())
            self.assertEqual(after["evidence"][-1]["outcome"], "passed")
            self.assertEqual(after["increments"][0]["pendingCriteria"], [])
            self.assertEqual(after["increments"][0]["status"], "implemented-pending-qualification")
            self.assertEqual(after["status"], "implementation-complete-qualification-pending")
            with self.assertRaises(roadmap.RoadmapError):
                roadmap.handle_roadmap_completed(after, {"type": "roadmap-completed", "summary": "Overall alone cannot qualify a controlled declaration"})

    def pending_qualification(self):
        state = self.engine.state
        state["increments"][0]["acceptanceCriteria"][0]["qualification"] = "controlled-environment"
        state["increments"][0]["allowPendingQualification"] = True
        state["evidence"][0]["outcome"] = "pending"
        state["roadmapApproval"]["fingerprint"] = roadmap.roadmap_fingerprint(state)
        roadmap.handle_increment_completed(state, {"type": "increment-completed", "summary": "Implementation complete; actual qualification pending"})
        self.save()
        return state

    def qualification_args(self, work_id="target-qualification"):
        completion = self.work.records.load()["work_items"].get(work_id, {}).get("completion", {})
        event = self.put(".local-codex/qualify.json", json.dumps({"type": "increment-qualified",
            "incrementId": "increment-1", "workId": work_id,
            "receiptDigest": completion.get("receipt_digest", "0" * 64), "reviewDigest": completion.get("review_digest", "0" * 64),
            "summary": "Actual target-specific technical qualification passed"}))
        return argparse.Namespace(repo=str(self.root), state=self.engine.state["paths"]["state"], event_file=str(event), dry_run=False)

    def pass_pending_declaration(self):
        self.engine.apply({"type": "evidence-recorded", "incrementId": "increment-1", "criterionId": "criterion-1",
            "kind": "test", "outcome": "passed", "summary": "Actual target assertions executed; independent review still required"})
        self.save()

    def test_target_qualification_closes_only_with_actual_current_exact_review(self):
        state = self.pending_qualification()
        original_evidence = copy.deepcopy(state["evidence"])
        original_chunks = copy.deepcopy(state["increments"][0]["completedChunks"])
        self.pass_pending_declaration()
        args = self.qualification_args()
        before = (self.root / args.state).read_bytes()
        with self.assertRaises(roadmap.RoadmapError):
            roadmap.command_apply(args)
        self.assertEqual((self.root / args.state).read_bytes(), before)
        self.finish("target-qualification")
        args = self.qualification_args()
        self.assertEqual(roadmap.command_apply(args)["status"], "roadmap-ready-to-close")
        after = json.loads((self.root / args.state).read_text())
        self.assertIsNone(after["currentIncrementId"])
        self.assertEqual(after["increments"][0]["status"], "completed")
        self.assertEqual(after["increments"][0]["completedChunks"], original_chunks)
        self.assertEqual(after["evidence"][:len(original_evidence)], original_evidence)
        self.assertTrue(roadmap.approval_is_current(after))
        with self.assertRaises(roadmap.RoadmapError):
            roadmap.command_apply(args)  # terminal qualification cannot be replayed

    def test_target_qualification_rejects_partial_coverage_and_stale_source(self):
        self.pending_qualification()
        partial = copy.deepcopy(self.spec)
        partial["work_id"] = "partial-target"
        partial["acceptance"] = partial["acceptance"][:1]
        with self.assertRaises(ControlError):
            self.work.start(partial, "author-run")
        self.pass_pending_declaration()
        self.finish("target-qualification")
        self.put("docs/result.md", "changed after reviewed qualification")
        args = self.qualification_args()
        before = (self.root / args.state).read_bytes()
        with self.assertRaises(roadmap.RoadmapError):
            roadmap.command_apply(args)
        self.assertEqual((self.root / args.state).read_bytes(), before)

    def test_target_qualification_never_uses_overall_or_pending_declarations(self):
        self.pending_qualification()
        self.finish("target-qualification")
        args = self.qualification_args()
        with self.assertRaises(roadmap.RoadmapError):
            roadmap.command_apply(args)
        self.pass_pending_declaration()
        self.finish("only-overall", overall=True)
        with self.assertRaises(roadmap.RoadmapError):
            roadmap.command_apply(self.qualification_args("only-overall"))

    def test_target_qualification_denies_incomplete_or_blocked_implementation(self):
        state = self.pending_qualification()
        for patch in ({"completedChunks": []}, {"plan": None}, {"status": "completed"}):
            with self.subTest(patch=patch):
                changed = copy.deepcopy(state)
                changed["increments"][0].update(patch)
                self.put(changed["paths"]["state"], json.dumps(changed))
                with self.assertRaises(ControlError):
                    self.work.start(self.spec, "author-run")
        self.save()
        state["blockers"] = [{"id": "qualification-environment", "status": "open", "kind": "environment",
            "summary": "Required technical environment is unavailable", "requiredAction": "Provide actual environment", "recordedAt": "2026-01-01T00:00:00Z"}]
        self.save()
        with self.assertRaises(ControlError):
            self.work.start(self.spec, "author-run")

    def test_target_qualification_binds_plan_evidence_and_report_bytes(self):
        self.pending_qualification()
        self.pass_pending_declaration()
        proof = self.put(".local-codex/qualification-proof.json", '{"result":"passed"}\n')
        self.engine.state["evidence"][-1]["artifact"] = ".local-codex/qualification-proof.json"
        self.save()
        self.finish("target-qualification")
        original = copy.deepcopy(self.engine.state)
        record = self.work.records.load()["work_items"]["target-qualification"]
        for kind in ("plan", "evidence", "artifact"):
            with self.subTest(kind=kind):
                self.engine.state = copy.deepcopy(original)
                proof.write_text('{"result":"passed"}\n')
                if kind == "plan":
                    self.engine.state["increments"][0]["plan"]["chunks"][0]["outcome"] = "Different reviewed mapping"
                elif kind == "evidence":
                    self.engine.state["evidence"][-1]["summary"] = "Different evidence after review"
                else:
                    proof.write_text('{"result":"changed-after-review"}\n')
                self.save()
                with self.assertRaises(ControlError):
                    self.work.current_receipt(record)

    def test_target_qualification_preserves_other_active_verifying_increment(self):
        state = self.pending_qualification()
        final = copy.deepcopy(state["increments"][0])
        final.update(id="increment-2", number=2, status="verifying", dependsOn=["increment-1"])
        state["increments"].append(final)
        state.update(status="executing", currentIncrementId="increment-2")
        state["roadmapApproval"]["fingerprint"] = roadmap.roadmap_fingerprint(state)
        self.save()
        self.pass_pending_declaration()
        self.finish("target-qualification")
        result = roadmap.command_apply(self.qualification_args())
        self.assertEqual(result["status"], "executing")
        self.assertEqual(result["currentIncrementId"], "increment-2")
        after = json.loads((self.root / state["paths"]["state"]).read_text())
        self.assertEqual(after["increments"][1], final)

    def test_target_qualification_requires_exact_consumed_digests(self):
        self.pending_qualification()
        self.pass_pending_declaration()
        self.finish("target-qualification")
        args = self.qualification_args()
        event_path = Path(args.event_file)
        event = json.loads(event_path.read_text())
        for key in ("receiptDigest", "reviewDigest"):
            forged = {**event, key: "0" * 64}
            event_path.write_text(json.dumps(forged))
            with self.assertRaises(roadmap.RoadmapError):
                roadmap.command_apply(args)
