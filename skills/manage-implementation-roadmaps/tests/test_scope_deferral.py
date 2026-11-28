"""Technical work moves to a real pending owner; no completion is invented."""
import copy
import unittest

import test_roadmap as fixtures

roadmap = fixtures.roadmap


class ScopeDeferralTests(unittest.TestCase):
    def setUp(self):
        self.engine = fixtures.RoadmapEngineTest()
        self.engine.setUp()
        self.addCleanup(self.engine.tearDown)
        self.engine.state.update(evidencePolicy="control-plane-v1", completionSuite="standardande2e")
        first = fixtures.increment_definition("increment-1", 1)
        first["acceptanceCriteria"][0]["description"] = "Verify text. Verify images."
        self.engine.define_and_approve([first, fixtures.increment_definition("final", 2, depends_on=["increment-1"])])
        self.engine.apply({"type": "increment-started", "incrementId": "increment-1"})
        self.engine.apply({"type": "increment-research-recorded", "summary": "Review exact supported scope.",
                           "sources": [], "risks": []})
        plan = fixtures.implementation_plan(1)
        plan["chunks"].append({**copy.deepcopy(plan["chunks"][0]), "id": "pending-task",
                                "title": "Generate text and images"})
        self.engine.apply({"type": "increment-plan-recorded", "plan": plan})
        self.engine.apply({"type": "chunk-recorded", "chunkId": "chunk-1", "summary": "Completed fixture support.",
                           "areas": ["Fixture"], "tests": ["Focused fixture checks"], "documentation": []})
        target = self.engine.state["increments"][0]
        self.engine.apply({"type": "story-tasks-assigned", "incrementId": target["id"],
                           "expectedPlanDigest": roadmap.fingerprint(target["plan"]), "expectedTrackingDigest": None,
                           "assignments": [{"taskId": task["id"], "storyId": "work-1"} for task in target["plan"]["chunks"]],
                           "authorityRef": "fixture-adoption", "reason": "Name existing owners."})

    def event(self):
        target = self.engine.state["increments"][0]
        module = roadmap.scope_deferral_module()
        definition = module.definition(target)
        definition["acceptanceCriteria"][0]["description"] = "Verify text."
        definition["workPackages"][0]["outcome"] = "Verify supported text outcomes."
        plan = {k: copy.deepcopy(v) for k, v in target["plan"].items() if k not in {"recordedAt", "fingerprint"}}
        plan["steps"][0] = "Verify text; defer image execution to its late owner."
        plan["chunks"][-1]["title"] = "Generate text"
        recipient = fixtures.increment_definition("images", 2, depends_on=[target["id"]])
        recipient["acceptanceCriteria"][0]["description"] = "Verify real approved image generation and import."
        return {"type": "technical-scope-deferred", "incrementId": target["id"],
                "approvedFingerprint": roadmap.roadmap_fingerprint(self.engine.state),
                "expectedDefinitionDigest": roadmap.fingerprint(module.definition(target)),
                "expectedPlanDigest": roadmap.fingerprint(target["plan"]),
                "expectedTrackingDigest": roadmap.fingerprint(roadmap.current_story_tracking(self.engine.state, target["id"])),
                "replacement": definition, "plan": plan, "recipient": recipient,
                "requirements": [{"sourceCriterionId": "criterion-1", "requirement": "Verify images.",
                                  "recipientCriterionId": "criterion-2"}],
                "authorityRef": "user-defer-images", "reason": "User defers image models; retain every image check later.",
                "storyAssignments": [{"taskId": task["id"], "storyId": "work-1"} for task in plan["chunks"]]}

    def refused(self, event, state=None):
        state = self.engine.state if state is None else state
        original = copy.deepcopy(state)
        with self.assertRaises(roadmap.RoadmapError):
            roadmap.apply_event(state, event)
        self.assertEqual(state, original)

    def test_transfer_archives_scope_preserves_completion_and_requires_reapproval(self):
        before = copy.deepcopy(self.engine.state)
        self.engine.apply(self.event())
        state = self.engine.state
        self.assertFalse(roadmap.approval_is_current(state))
        self.assertEqual(state["status"], "approval-required")
        self.assertEqual(state["currentIncrementId"], "increment-1")
        self.assertEqual([i["id"] for i in state["increments"]], ["increment-1", "images", "final"])
        self.assertEqual(state["increments"][-1]["number"], 3)
        self.assertIn("images", state["increments"][-1]["dependsOn"])
        self.assertEqual(state["increments"][1]["status"], "pending")
        for key in ("chunks", "evidence", "blockers", "completion", "decisions"):
            self.assertEqual(state[key], before[key])
        archive = state["technicalScopeDeferrals"][0]
        self.assertEqual(archive["originalPlan"], before["increments"][0]["plan"])
        self.assertEqual(archive["previousApproval"], before["roadmapApproval"])
        self.assertEqual(state["increments"][0]["completedChunks"], ["chunk-1"])
        self.assertIn("Deferred technical work", roadmap.render_roadmap(state))
        self.assertFalse(roadmap.implementation_ready_for_overall(state))
        self.engine.apply({"type": "roadmap-approved", "note": "Exact user-directed image deferral only."})
        self.assertTrue(roadmap.approval_is_current(self.engine.state))

    def test_stale_unknown_foreign_and_unapproved_inputs_refuse_atomically(self):
        event = self.event()
        for key in ("approvedFingerprint", "expectedDefinitionDigest", "expectedPlanDigest", "expectedTrackingDigest"):
            with self.subTest(key=key): self.refused({**event, key: "0" * 64})
        for override in ({"incrementId": "final"}, {"unexpected": True}, {"requirements": []}):
            self.refused({**event, **override})
        missing = copy.deepcopy(event); missing.pop("expectedTrackingDigest"); self.refused(missing)
        changed = copy.deepcopy(event)
        changed["replacement"]["acceptanceCriteria"][0]["description"] = "Drop the retained text check."
        self.refused(changed)
        for mutate in (lambda s: s.update(roadmapApproval=None),
                       lambda s: s.update(evidencePolicy=None),
                       lambda s: s["increments"][0].update(status="verifying")):
            state = copy.deepcopy(self.engine.state); mutate(state); self.refused(event, state)

    def test_security_criteria_qualification_and_completed_work_cannot_change(self):
        for mutate in (lambda e: e["replacement"]["acceptanceCriteria"][-1].update(description="Skip security."),
                       lambda e: e["replacement"]["acceptanceCriteria"][0].update(qualification="controlled-environment"),
                       lambda e: e["replacement"]["acceptanceCriteria"].pop(),
                       lambda e: e["plan"]["chunks"][0].update(outcome="Different completed work."),
                       lambda e: e["plan"]["chunks"].reverse(),
                       lambda e: e["replacement"].update(rollback="Drop safety.")):
            event = self.event(); mutate(event); self.refused(event)

    def test_real_pending_recipient_and_complete_requirement_mapping_are_required(self):
        for mutate in (lambda e: e["recipient"].update(id="final"),
                       lambda e: e["recipient"].update(number=5),
                       lambda e: e["recipient"].update(dependsOn=[]),
                       lambda e: e["recipient"]["acceptanceCriteria"].pop(),
                       lambda e: e["requirements"][0].update(recipientCriterionId="missing"),
                       lambda e: e["requirements"][0].update(requirement="Not in original criterion.")):
            event = self.event(); mutate(event); self.refused(event)
        state = copy.deepcopy(self.engine.state); state["increments"][-1]["plan"] = {}
        self.refused(self.event(), state)

    def test_story_tracking_can_refine_after_reapproval_without_reattributing_history(self):
        before = copy.deepcopy(self.engine.state["storyTaskTracking"]["revisions"])
        self.engine.apply(self.event())
        self.engine.apply({"type": "roadmap-approved", "note": "Narrow deferral approved."})
        target = self.engine.state["increments"][0]
        plan = {k: copy.deepcopy(v) for k, v in target["plan"].items() if k not in {"recordedAt", "fingerprint"}}
        plan["chunks"].append({**copy.deepcopy(plan["chunks"][-1]), "id": "extra-support"})
        self.engine.apply({"type": "work-chunks-reconfigured", "incrementId": target["id"],
                           "expectedPlanDigest": roadmap.fingerprint(target["plan"]), "plan": plan,
                           "expectedTrackingDigest": roadmap.fingerprint(roadmap.current_story_tracking(self.engine.state, target["id"])),
                           "storyAssignments": [{"taskId": t["id"], "storyId": "work-1"} for t in plan["chunks"]],
                           "authorityRef": "task-refinement", "reason": "Split pending outcome after explicit deferral."})
        self.assertEqual(self.engine.state["storyTaskTracking"]["revisions"][:len(before)], before)
        roadmap.validate_state_shape(self.engine.repo, self.engine.state)

    def test_corrupted_or_detached_history_and_removed_recipient_fail_read_validation(self):
        self.engine.apply(self.event())
        for mutate in (lambda s: s.pop("technicalScopeDeferrals"),
                       lambda s: s["history"][-1].pop("scopeDeferralDigest"),
                       lambda s: s["technicalScopeDeferrals"][0]["originalPlan"]["steps"].append("Drop checks."),
                       lambda s: s["increments"].pop(1),
                       lambda s: s["increments"][1]["acceptanceCriteria"][0].update(description="Skip images."),
                       lambda s: s["increments"][-1]["dependsOn"].remove("images"),
                       lambda s: s["increments"][0]["workPackages"][0].update(outcome="Broader scope.")):
            state = copy.deepcopy(self.engine.state); mutate(state)
            with self.subTest(mutate=mutate), self.assertRaises(roadmap.RoadmapError):
                roadmap.validate_state_shape(self.engine.repo, state)

    def test_restricted_headless_quality_policy_survives_deferral_and_later_task_refinement(self):
        fixture = fixtures.HeadlessWorkflowRestrictionTest()
        state = roadmap.apply_event(fixture.pending(), fixture.event())
        state = roadmap.apply_event(state, {"type": "roadmap-approved", "note": "Existing explicit workflow-only scope."})
        target = roadmap.current_increment(state)
        module = roadmap.scope_deferral_module()
        revised = module.definition(target)
        criterion = next(c for c in revised["acceptanceCriteria"] if c["id"] == "training-and-generation-quality")
        requirement = "Include supported image generation and output import in scoped capability coverage."
        self.assertIn(requirement, criterion["description"])
        criterion["description"] = criterion["description"].replace(requirement, "Verify supported text generation; defer image tasks.")
        plan = {k: copy.deepcopy(v) for k, v in target["plan"].items() if k not in {"recordedAt", "fingerprint"}}
        plan["steps"][-1] = "Verify text now; verify images in their pending increment."
        plan["chunks"][-1]["outcome"] += " Images remain pending in their late increment."
        recipient = fixtures.increment_definition("images", state["increments"][-1]["number"], depends_on=[target["id"]])
        event = {"type": "technical-scope-deferred", "incrementId": target["id"],
                 "approvedFingerprint": roadmap.roadmap_fingerprint(state),
                 "expectedDefinitionDigest": roadmap.fingerprint(module.definition(target)),
                 "expectedPlanDigest": roadmap.fingerprint(target["plan"]), "expectedTrackingDigest": None,
                 "replacement": revised, "plan": plan, "recipient": recipient,
                 "requirements": [{"sourceCriterionId": criterion["id"], "requirement": requirement,
                                   "recipientCriterionId": "criterion-10"}],
                 "authorityRef": "user-defer-images", "reason": "Preserve image obligations in a pending owner."}
        # The fixture's final number is deliberately discovered, not assumed.
        event["requirements"][0]["recipientCriterionId"] = recipient["acceptanceCriteria"][0]["id"]
        state = roadmap.apply_event(state, event)
        roadmap.validate_state_shape(self.engine.repo, state)
        state = roadmap.apply_event(state, {"type": "roadmap-approved", "note": "User-directed image deferral."})
        target = roadmap.current_increment(state)
        plan = {k: copy.deepcopy(v) for k, v in target["plan"].items() if k not in {"recordedAt", "fingerprint"}}
        plan["chunks"].append({**copy.deepcopy(plan["chunks"][-1]), "id": "additional-pending-text-task"})
        state = roadmap.apply_event(state, {"type": "work-chunks-reconfigured", "incrementId": target["id"],
                                           "expectedPlanDigest": roadmap.fingerprint(target["plan"]), "plan": plan,
                                           "authorityRef": "pending-task-refinement", "reason": "Split remaining text work."})
        roadmap.validate_state_shape(self.engine.repo, state)
        self.assertEqual(next(c for c in target["acceptanceCriteria"] if c["id"] == "model-runtime-hosts"),
                         roadmap.HEADLESS_WORKFLOW_CRITERION)


if __name__ == "__main__":
    unittest.main()
