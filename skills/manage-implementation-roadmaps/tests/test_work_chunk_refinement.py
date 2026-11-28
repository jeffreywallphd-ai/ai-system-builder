"""Chunk sizing changes tracking, never scope, history or execution authority."""
import copy
import json
from argparse import Namespace
import unittest

import test_roadmap as fixtures

roadmap = fixtures.roadmap


class WorkChunkRefinementTests(unittest.TestCase):
    def setUp(self):
        self.engine = fixtures.RoadmapEngineTest()
        self.engine.setUp()
        self.addCleanup(self.engine.tearDown)
        self.engine.define_and_approve([
            fixtures.increment_definition("increment-1", 1),
            fixtures.increment_definition("increment-2", 2, depends_on=["increment-1"]),
        ])
        self.engine.apply({"type": "increment-started", "incrementId": "increment-1"})
        self.engine.apply({"type": "increment-research-recorded", "summary": "Inspect existing behavior.",
                           "sources": [], "risks": []})
        plan = fixtures.implementation_plan(1)
        plan["chunks"] = self.chunks(1)
        self.engine.apply({"type": "increment-plan-recorded", "plan": plan})

    @staticmethod
    def chunks(number):
        return [{"id": f"outcome-{number}-{index}", "title": f"Reviewed outcome {index}",
                 "outcome": f"Outcome {index} has its focused checks and documentation.",
                 "criteriaIds": [f"criterion-{number}", "security-impact-reviewed"]}
                for index in range(1, 4)]

    def event(self, number=1):
        target = self.engine.state["increments"][number - 1]
        old = target["plan"]
        plan = ({key: copy.deepcopy(value) for key, value in old.items()
                 if key not in {"fingerprint", "recordedAt", "outlineOnly"}}
                if old else fixtures.implementation_plan(number))
        plan["chunks"] = self.chunks(number)
        plan["chunks"][-1]["id"] += "-first"
        plan["chunks"].append({**copy.deepcopy(plan["chunks"][-1]), "id": f"outcome-{number}-last"})
        return {"type": "work-chunks-reconfigured", "incrementId": target["id"],
                "expectedPlanDigest": roadmap.fingerprint(old) if old is not None else None,
                "plan": plan, "authorityRef": "user-chunk-sizing", "reason": "Separate independently verified outcomes."}

    def record(self, chunk_id):
        self.engine.apply({"type": "chunk-recorded", "chunkId": chunk_id, "summary": "Tested local fixture outcome.",
                           "areas": ["Fixture"], "tests": ["Focused fixture passed"],
                           "documentation": [], "feedbackAddressed": []})

    def assert_refused(self, state, event):
        original = copy.deepcopy(state)
        with self.assertRaises(roadmap.RoadmapError):
            roadmap.apply_event(state, event)
        self.assertEqual(state, original)

    def finish_first(self):
        for chunk in self.engine.state["increments"][0]["plan"]["chunks"]:
            self.record(chunk["id"])
        for criterion in self.engine.state["increments"][0]["acceptanceCriteria"]:
            self.engine.apply({"type": "evidence-recorded", "incrementId": "increment-1", "criterionId": criterion["id"],
                               "kind": "review", "outcome": "passed", "summary": "Synthetic fixture evidence."})
        self.engine.apply({"type": "increment-completed", "summary": "Synthetic first increment done."})

    def test_active_refinement_archives_exact_plan_and_preserves_authority_history(self):
        self.record("outcome-1-1")
        self.record("outcome-1-2")
        old = copy.deepcopy(self.engine.state)
        event = self.event()
        self.assertNotEqual(event["expectedPlanDigest"], old["increments"][0]["plan"]["fingerprint"])
        self.engine.apply(event)
        current = self.engine.state
        for key in ("roadmapApproval", "currentIncrementId", "status", "chunks", "evidence", "blockers", "completion"):
            self.assertEqual(current[key], old[key])
        before, after = old["increments"][0], current["increments"][0]
        self.assertEqual({k: v for k, v in before.items() if k != "plan"},
                         {k: v for k, v in after.items() if k != "plan"})
        self.assertEqual(after["plan"]["recordedAt"], before["plan"]["recordedAt"])
        self.assertEqual(current["workChunkPlanRevisions"][0]["originalPlan"], before["plan"])
        self.assertEqual(current["workChunkPlanRevisions"][0]["replacementPlan"], after["plan"])
        self.assertTrue(roadmap.approval_is_current(current))
        self.assertFalse(roadmap.implementation_ready_for_overall(current))

    def test_verifying_refinement_returns_pending_work_to_implementation_without_a_pass(self):
        for chunk in self.engine.state["increments"][0]["plan"]["chunks"]:
            self.record(chunk["id"])
        before = copy.deepcopy(self.engine.state)
        self.assertEqual(before["increments"][0]["status"], "verifying")
        event = self.event()
        event["plan"]["chunks"] = copy.deepcopy(before["increments"][0]["plan"]["chunks"])
        event["plan"]["chunks"].append({**copy.deepcopy(event["plan"]["chunks"][-1]), "id": "additional-in-scope-task"})
        self.engine.apply(event)
        current = self.engine.state
        self.assertEqual(current["increments"][0]["status"], "implementing")
        self.assertEqual(current["status"], "executing")
        self.assertEqual(current["increments"][0]["completedChunks"], before["increments"][0]["completedChunks"])
        for key in ("roadmapApproval", "currentIncrementId", "chunks", "evidence", "blockers", "completion"):
            self.assertEqual(current[key], before[key])
        self.assertFalse(roadmap.implementation_ready_for_overall(current))
        self.assert_refused(current, {"type": "increment-completed", "summary": "Pending work is not complete."})
        roadmap.validate_state_shape(self.engine.repo, current)

    def test_verifying_refinement_still_refuses_completed_edits_or_foreign_active_state(self):
        for chunk in self.engine.state["increments"][0]["plan"]["chunks"]:
            self.record(chunk["id"])
        before = copy.deepcopy(self.engine.state)
        for mutation in ("edit", "delete", "reorder", "foreign-current", "no-research"):
            state = copy.deepcopy(before)
            event = self.event()
            event["plan"]["chunks"] = copy.deepcopy(before["increments"][0]["plan"]["chunks"])
            event["plan"]["chunks"].append({**copy.deepcopy(event["plan"]["chunks"][-1]), "id": "additional-in-scope-task"})
            if mutation == "edit": event["plan"]["chunks"][0]["outcome"] = "Changed completed result"
            elif mutation == "delete": event["plan"]["chunks"].pop(0)
            elif mutation == "reorder": event["plan"]["chunks"][:2] = reversed(event["plan"]["chunks"][:2])
            elif mutation == "foreign-current": state["currentIncrementId"] = "increment-2"
            else: state["increments"][0]["research"] = []
            with self.subTest(mutation=mutation): self.assert_refused(state, event)

    def test_pending_outline_cannot_start_or_complete_work_without_normal_gates(self):
        self.engine.apply(self.event(2))
        target = self.engine.state["increments"][1]
        self.assertEqual(target["status"], "pending")
        self.assertIsNone(target["startedAt"])
        self.assertEqual(target["research"], [])
        self.assertTrue(target["plan"]["outlineOnly"])
        self.assertEqual(self.engine.state["currentIncrementId"], "increment-1")
        self.assert_refused(self.engine.state, {"type": "increment-started", "incrementId": "increment-2"})
        self.assert_refused(self.engine.state, {"type": "chunk-recorded", "chunkId": "outcome-2-1",
                                              "summary": "No implementation", "areas": ["Fixture"]})
        self.finish_first()
        self.engine.apply({"type": "increment-started", "incrementId": "increment-2"})
        self.assert_refused(self.engine.state, {"type": "increment-plan-recorded", "plan": fixtures.implementation_plan(2)})
        self.engine.apply({"type": "increment-research-recorded", "summary": "Research actual second increment.",
                           "sources": [], "risks": []})
        self.assert_refused(self.engine.state, {"type": "chunk-recorded", "chunkId": "outcome-2-1",
                                              "summary": "Still only an outline", "areas": ["Fixture"]})
        self.engine.apply({"type": "increment-plan-recorded", "plan": fixtures.implementation_plan(2)})
        self.assertNotIn("outlineOnly", self.engine.state["increments"][1]["plan"])
        self.assertEqual(self.engine.state["increments"][1]["status"], "implementing")
        self.assertFalse(roadmap.implementation_ready_for_overall(self.engine.state))

    def test_outline_stays_non_executable_after_pause_and_resume(self):
        self.engine.apply(self.event(2))
        self.finish_first()
        self.engine.apply({"type": "increment-started", "incrementId": "increment-2"})
        for stage in ("researching", "planning"):
            if stage == "planning":
                self.engine.apply({"type": "increment-research-recorded", "summary": "Research the fixture.",
                                   "sources": [], "risks": []})
            blocker_id = "fixture-" + stage
            self.engine.apply({"type": "blocker-recorded", "id": blocker_id, "kind": "environment",
                               "summary": "Synthetic fixture needs owner confirmation.", "actionOwner": "human",
                               "responsibleRole": "Fixture owner", "requiredAction": "Confirm fixture availability.",
                               "actionLocation": "Synthetic fixture", "completionCondition": "Fixture is available.",
                               "authorityRef": "fixture-request"})
            self.engine.apply({"type": "resumed", "blockerId": blocker_id, "resolution": "Fixture is available.",
                               "reconciliation": "No source or scope change."})
            target = self.engine.state["increments"][1]
            self.assertEqual(target["status"], stage)
            self.assertTrue(target["plan"]["outlineOnly"])
            self.assert_refused(self.engine.state, {"type": "chunk-recorded", "chunkId": "outcome-2-1",
                                                  "summary": "No implementation plan", "areas": ["Fixture"]})
            self.assertIn("pending chunk outline", roadmap.render_report(self.engine.state))
        forged = copy.deepcopy(self.engine.state)
        forged["increments"][1]["status"] = "implementing"
        with self.assertRaises(roadmap.RoadmapError):
            roadmap.validate_state_shape(self.engine.repo, forged)
        self.assertFalse(roadmap.implementation_ready_for_overall(forged))

    def test_completed_chunk_edits_deletion_and_reordering_are_refused(self):
        self.record("outcome-1-1")
        self.record("outcome-1-2")
        for mutation in ("edit", "remove", "reorder"):
            event = self.event()
            if mutation == "edit":
                event["plan"]["chunks"][0]["outcome"] = "Different delivered behavior."
            elif mutation == "remove":
                event["plan"]["chunks"].pop(0)
            else:
                event["plan"]["chunks"][:2] = reversed(event["plan"]["chunks"][:2])
            with self.subTest(mutation=mutation):
                self.assert_refused(self.engine.state, event)

    def test_stale_scope_incomplete_mapping_and_non_chunk_changes_are_refused(self):
        for mutation in ("missing-digest", "stale-digest", "internal-fingerprint", "steps", "tests", "assumptions",
                         "rollback", "unknown-field", "unknown-criterion", "missing-criterion", "duplicate-id", "oversized", "no-op"):
            event = self.event()
            if mutation == "missing-digest": event.pop("expectedPlanDigest")
            elif mutation == "stale-digest": event["expectedPlanDigest"] = "a" * 64
            elif mutation == "internal-fingerprint": event["expectedPlanDigest"] = self.engine.state["increments"][0]["plan"]["fingerprint"]
            elif mutation in {"steps", "assumptions"}: event["plan"][mutation].append("Changed requirement")
            elif mutation == "tests": event["plan"]["focusedTests"] = ["Fewer tests"]
            elif mutation == "rollback": event["plan"]["rollback"] = "Different recovery"
            elif mutation == "unknown-field": event["acceptanceCriteria"] = []
            elif mutation == "unknown-criterion": event["plan"]["chunks"][0]["criteriaIds"].append("foreign")
            elif mutation == "missing-criterion":
                for chunk in event["plan"]["chunks"]: chunk["criteriaIds"] = ["criterion-1"]
            elif mutation == "duplicate-id": event["plan"]["chunks"][-1]["id"] = event["plan"]["chunks"][0]["id"]
            elif mutation == "oversized":
                event["plan"]["chunks"] = [{**event["plan"]["chunks"][0], "id": f"outcome-{index}"} for index in range(101)]
            elif mutation == "no-op": event["plan"]["chunks"] = copy.deepcopy(self.engine.state["increments"][0]["plan"]["chunks"])
            with self.subTest(mutation=mutation):
                self.assert_refused(self.engine.state, event)

    def test_unapproved_human_blocked_and_closed_targets_are_refused(self):
        for mutation in ("approval", "scope", "human", "verifying", "implemented-pending-qualification", "completed", "researching"):
            state = copy.deepcopy(self.engine.state)
            if mutation == "approval": state["roadmapApproval"] = None
            elif mutation == "scope": state["objective"] = "Unapproved different product"
            elif mutation == "human":
                state["blockers"].append({"status": "open", "actionOwner": "human", "responsibleRole": "Owner",
                                          "requiredAction": "Choose a policy", "actionLocation": "Fixture",
                                          "completionCondition": "Choice recorded", "authorityRef": "fixture-choice"})
            else: state["increments"][0]["status"] = mutation
            with self.subTest(mutation=mutation):
                self.assert_refused(state, self.event())

    def test_archives_round_trip_and_detect_corruption_without_current_scope_dependency(self):
        self.record("outcome-1-1")
        self.engine.apply(self.event())
        state = json.loads(json.dumps(self.engine.state))
        roadmap.validate_state_shape(self.engine.repo, state)
        for field in ("originalPlan", "replacementPlan"):
            changed = copy.deepcopy(state)
            changed["workChunkPlanRevisions"][0][field]["chunks"][0]["outcome"] = "Corrupted archive"
            with self.subTest(field=field), self.assertRaises(roadmap.RoadmapError):
                roadmap.validate_state_shape(self.engine.repo, changed)
        changed = copy.deepcopy(state)
        revision = changed["workChunkPlanRevisions"][0]
        revision["replacementPlan"]["chunks"].pop(0)
        revision["replacementPlanDigest"] = roadmap.fingerprint(revision["replacementPlan"])
        with self.assertRaises(roadmap.RoadmapError):
            roadmap.validate_state_shape(self.engine.repo, changed)
        changed = copy.deepcopy(state)
        revision = changed["workChunkPlanRevisions"][0]
        revision["replacementPlan"]["focusedTests"] = ["Changed archived obligations"]
        revision["replacementPlanDigest"] = roadmap.fingerprint(revision["replacementPlan"])
        with self.assertRaises(roadmap.RoadmapError):
            roadmap.validate_state_shape(self.engine.repo, changed)

    def test_status_supplies_exact_whole_plan_digest_and_pending_outline_without_mutation(self):
        self.engine.apply(self.event(2))
        roadmap.write_project_files(self.engine.repo, self.engine.state)
        state_path = self.engine.repo / self.engine.state["paths"]["state"]
        before = state_path.read_bytes()
        result = roadmap.command_status(Namespace(repo=str(self.engine.repo), state=self.engine.state["paths"]["state"]))
        plans = {row["incrementId"]: row for row in result["chunkPlans"]}
        self.assertEqual(plans["increment-1"]["planDigest"], roadmap.fingerprint(self.engine.state["increments"][0]["plan"]))
        self.assertNotEqual(plans["increment-1"]["planDigest"], self.engine.state["increments"][0]["plan"]["fingerprint"])
        self.assertEqual(plans["increment-2"]["planDigest"], roadmap.fingerprint(self.engine.state["increments"][1]["plan"]))
        self.assertTrue(plans["increment-2"]["outlineOnly"])
        self.assertEqual(plans["increment-2"]["completed"], 0)
        self.assertEqual(plans["increment-2"]["planned"], 4)
        self.assertEqual(state_path.read_bytes(), before)

    def test_formal_plan_and_state_validation_share_the_visible_chunk_bound(self):
        plan = fixtures.implementation_plan(1)
        plan["chunks"] = [{**copy.deepcopy(plan["chunks"][0]), "id": f"visible-{index}"} for index in range(100)]
        self.engine.apply({"type": "increment-plan-recorded", "plan": plan})
        self.assertEqual(len(self.engine.state["increments"][0]["plan"]["chunks"]), 100)
        plan["chunks"].append({**copy.deepcopy(plan["chunks"][0]), "id": "invisible-101"})
        self.assert_refused(self.engine.state, {"type": "increment-plan-recorded", "plan": plan})
        changed = copy.deepcopy(self.engine.state)
        changed["increments"][0]["plan"]["chunks"] = plan["chunks"]
        with self.assertRaises(roadmap.RoadmapError):
            roadmap.validate_state_shape(self.engine.repo, changed)


if __name__ == "__main__":
    unittest.main()
