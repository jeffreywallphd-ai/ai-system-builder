"""Stable story intent and audited task ownership never manufacture evidence."""
import copy
from contextlib import nullcontext
from argparse import Namespace
import json
import sys
from types import ModuleType
import unittest
from unittest import mock

import test_roadmap as fixtures

roadmap = fixtures.roadmap


class StoryTaskTrackingTests(unittest.TestCase):
    def setUp(self):
        self.engine = fixtures.RoadmapEngineTest()
        self.engine.setUp()
        self.addCleanup(self.engine.tearDown)
        definition = fixtures.increment_definition("increment-1", 1)
        definition["workPackages"].append({"id": "second-story", "title": "Second outcome", "outcome": "A separate approved result."})
        self.engine.define_and_approve([definition])
        self.engine.apply({"type": "increment-started", "incrementId": "increment-1"})
        self.engine.apply({"type": "increment-research-recorded", "summary": "Review exact ownership and failure paths.", "sources": [], "risks": []})
        plan = fixtures.implementation_plan(1)
        plan["chunks"].append({**copy.deepcopy(plan["chunks"][0]), "id": "second-task", "title": "Second task"})
        self.engine.apply({"type": "increment-plan-recorded", "plan": plan})

    def adoption(self):
        increment = self.engine.state["increments"][0]
        old = roadmap.current_story_tracking(self.engine.state, increment["id"])
        return {"type": "story-tasks-assigned", "incrementId": increment["id"],
                "expectedPlanDigest": roadmap.fingerprint(increment["plan"]),
                "expectedTrackingDigest": roadmap.fingerprint(old) if old else None,
                "assignments": [{"taskId": "chunk-1", "storyId": "work-1"},
                                {"taskId": "second-task", "storyId": "second-story"}],
                "authorityRef": "approved-story-tracking", "reason": "Expose existing approved outcomes without changing scope."}

    def refine(self):
        increment = self.engine.state["increments"][0]
        previous = roadmap.current_story_tracking(self.engine.state, increment["id"])
        plan = {key: copy.deepcopy(value) for key, value in increment["plan"].items()
                if key not in {"recordedAt", "fingerprint", "outlineOnly"}}
        plan["chunks"].append({**copy.deepcopy(plan["chunks"][-1]), "id": "third-task"})
        return {"type": "work-chunks-reconfigured", "incrementId": increment["id"],
                "expectedPlanDigest": roadmap.fingerprint(increment["plan"]), "plan": plan,
                "expectedTrackingDigest": roadmap.fingerprint(previous),
                "storyAssignments": self.adoption()["assignments"] + [{"taskId": "third-task", "storyId": "second-story"}],
                "authorityRef": "approved-story-tracking", "reason": "Decompose the unfinished second story into coherent tasks."}

    def refused(self, event):
        before = copy.deepcopy(self.engine.state)
        with self.assertRaises(roadmap.RoadmapError):
            roadmap.apply_event(self.engine.state, event)
        self.assertEqual(self.engine.state, before)

    def test_adoption_preserves_approved_scope_original_plan_and_every_evidence_fact(self):
        before = copy.deepcopy(self.engine.state)
        self.engine.apply(self.adoption())
        current = self.engine.state
        for key in ("increments", "roadmapApproval", "chunks", "evidence", "blockers", "decisions", "completion"):
            self.assertEqual(current[key], before[key])
        self.assertEqual(roadmap.roadmap_fingerprint(current), roadmap.roadmap_fingerprint(before))
        self.assertEqual([s["tasksPlanned"] for s in roadmap.story_progress(current, current["increments"][0])], [1, 1])
        self.assertEqual(current["history"][:-1], before["history"])
        roadmap.validate_state_shape(self.engine.repo, current)

    def test_missing_duplicate_unknown_foreign_or_stale_ownership_refuses_without_mutation(self):
        event = self.adoption()
        variants = []
        for key in ("expectedPlanDigest", "expectedTrackingDigest", "authorityRef", "reason"):
            changed = copy.deepcopy(event); changed.pop(key); variants.append(changed)
        for rows in (event["assignments"][:1], [event["assignments"][0]] * 2,
                     [{"taskId": "foreign", "storyId": "work-1"}, event["assignments"][1]],
                     [{"taskId": "chunk-1", "storyId": "foreign"}, event["assignments"][1]]):
            variants.append({**event, "assignments": rows})
        variants.append({**event, "expectedPlanDigest": "0" * 64})
        for value in variants:
            with self.subTest(value=value): self.refused(value)

    def test_task_growth_retains_story_boundaries_approval_and_complete_audit_chain(self):
        self.engine.apply(self.adoption())
        before = copy.deepcopy(self.engine.state)
        self.engine.apply(self.refine())
        current = self.engine.state
        self.assertEqual(current["roadmapApproval"], before["roadmapApproval"])
        self.assertEqual(current["increments"][0]["workPackages"], before["increments"][0]["workPackages"])
        self.assertEqual([s["tasksPlanned"] for s in roadmap.story_progress(current, current["increments"][0])], [1, 2])
        self.assertEqual(len(current["storyTaskTracking"]["revisions"]), 2)
        roadmap.validate_state_shape(self.engine.repo, current)

    def test_refinement_requires_atomic_complete_ownership_and_cannot_reparent_tasks(self):
        self.engine.apply(self.adoption())
        event = self.refine()
        for key in ("storyAssignments", "expectedTrackingDigest"):
            changed = copy.deepcopy(event); changed.pop(key); self.refused(changed)
        changed = copy.deepcopy(event); changed["storyAssignments"][0]["storyId"] = "second-story"; self.refused(changed)
        self.refused(self.adoption())  # No-op adoption cannot generate progress.

    def test_retired_task_cannot_be_reintroduced_under_any_story(self):
        self.engine.apply(self.adoption())
        event = self.refine()
        event["plan"]["chunks"] = event["plan"]["chunks"][1:2]
        event["storyAssignments"] = [{"taskId": "second-task", "storyId": "second-story"}]
        self.engine.apply(event)
        for story in ("work-1", "second-story"):
            changed = self.refine()
            changed["plan"]["chunks"][-1]["id"] = "chunk-1"
            changed["storyAssignments"] = [{"taskId": "second-task", "storyId": "second-story"},
                                           {"taskId": "chunk-1", "storyId": story}]
            with self.subTest(story=story): self.refused(changed)

    def test_completed_task_owner_definition_and_order_remain_exact(self):
        self.engine.apply({"type": "chunk-recorded", "chunkId": "chunk-1", "summary": "Real fixture implementation.", "areas": ["Fixture"], "tests": ["Focused fixture check"], "documentation": []})
        self.engine.apply(self.adoption())
        old = copy.deepcopy(self.engine.state)
        self.engine.apply(self.refine())
        self.assertEqual(self.engine.state["chunks"], old["chunks"])
        self.assertEqual(self.engine.state["increments"][0]["completedChunks"], ["chunk-1"])
        self.assertEqual(roadmap.story_progress(self.engine.state, self.engine.state["increments"][0])[0]["tasksComplete"], 1)
        self.assertFalse(self.engine.state["evidence"])

    def test_corrupt_or_detached_history_definition_and_mapping_fail_read_validation(self):
        self.engine.apply(self.adoption())
        mutations = [lambda s: s.pop("storyTaskTracking"),
                     lambda s: s["history"][-1].pop("storyTaskRevisionDigest"),
                     lambda s: s["history"][-1].update(type="evidence-recorded"),
                     lambda s: s["history"][-1].update(sequence=1),
                     lambda s: s["storyTaskTracking"]["revisions"][0].update(priorDigest="0" * 64),
                     lambda s: s["increments"][0]["plan"]["chunks"][0].update(title="Changed"),
                     lambda s: s["increments"][0]["workPackages"][0].update(outcome="Broader scope")]
        for mutate in mutations:
            state = copy.deepcopy(self.engine.state); mutate(state)
            with self.subTest(mutate=mutate), self.assertRaises(roadmap.RoadmapError):
                roadmap.validate_state_shape(self.engine.repo, state)

    def test_refinement_history_cannot_detach_from_its_exact_plan_archive(self):
        self.engine.apply(self.adoption()); self.engine.apply(self.refine())
        for mutate in (lambda s: s["history"][-1].update(type="story-tasks-assigned"),
                       lambda s: s["history"][-1].pop("chunkPlanRevisionDigest")):
            changed = copy.deepcopy(self.engine.state); mutate(changed)
            with self.assertRaises(roadmap.RoadmapError): roadmap.validate_state_shape(self.engine.repo, changed)

    def test_pending_outline_blocked_and_unapproved_targets_cannot_adopt(self):
        event = self.adoption()
        for mutate in (lambda s: s.update(roadmapApproval=None),
                       lambda s: s["increments"][0]["plan"].update(outlineOnly=True),
                       lambda s: s["increments"][0].update(status="pending")):
            state = copy.deepcopy(self.engine.state); mutate(state)
            with self.assertRaises(roadmap.RoadmapError): roadmap.apply_event(state, event)

    def test_unadopted_legacy_state_and_rendering_remain_unchanged(self):
        before = copy.deepcopy(self.engine.state)
        self.assertIn("### Work packages", roadmap.render_roadmap(before))
        roadmap.validate_state_shape(self.engine.repo, before)
        self.assertEqual(before, self.engine.state)
        self.engine.apply(self.adoption())
        self.assertIn("### Stories", roadmap.render_roadmap(self.engine.state))

    def test_new_story_definitions_are_bounded_unique_and_nonempty(self):
        original = fixtures.increment_definition("bounded", 1)
        for stories in ([], [original["workPackages"][0]] * 2,
                        [{**original["workPackages"][0], "id": f"story-{n}"} for n in range(41)]):
            with self.subTest(count=len(stories)), self.assertRaises(roadmap.RoadmapError):
                roadmap.validate_increment({**original, "workPackages": stories}, "fixture")
        accepted = [{**original["workPackages"][0], "id": f"story-{n}"} for n in range(40)]
        self.assertEqual(len(roadmap.validate_increment({**original, "workPackages": accepted}, "fixture")["workPackages"]), 40)

    def test_cli_live_claim_refusal_preserves_files_and_dry_run_remains_pure(self):
        state = self.engine.state
        roadmap.write_project_files(self.engine.repo, state)
        adapter = self.engine.repo / "dev-tools/helpers/control_plane/records.py"
        adapter.parent.mkdir(parents=True); adapter.write_text("# fixture marker\n", encoding="utf8")
        event = self.engine.repo / "event.json"; event.write_text(json.dumps(self.adoption()), encoding="utf8")
        module = ModuleType("control_plane.records")
        module.Records = lambda root: Namespace(lock=self.engine.repo / ".local-codex/fixture.lock",
                           journal=self.engine.repo / ".local-codex/transaction.json", _bootstrap_guard=lambda: None,
                                              load=lambda: {"work_items": {"active": {"claim": {"claim_id": "owned"}}}})
        storage = ModuleType("control_plane.storage")
        storage.exclusive_lock = lambda path: nullcontext()
        args = Namespace(repo=str(self.engine.repo), state=state["paths"]["state"], event_file=str(event), dry_run=False)
        paths = [self.engine.repo / name for name in state["paths"].values()]
        before = [path.read_bytes() for path in paths]
        with mock.patch.dict(sys.modules, {"control_plane.records": module, "control_plane.storage": storage}):
            with self.assertRaisesRegex(roadmap.RoadmapError, "release source claims"):
                roadmap.command_apply(args)
            args.dry_run = True
            self.assertTrue(roadmap.command_apply(args)["dryRun"])
        self.assertEqual([path.read_bytes() for path in paths], before)

    def test_headless_52_refinements_adopt_and_refine_without_rewriting_restriction(self):
        fixture = fixtures.HeadlessWorkflowRestrictionTest()
        fixture.setUp(); self.addCleanup(fixture.doCleanups)
        state = fixture.approved_restriction()
        for n in range(52):
            state = roadmap.apply_event(state, fixture.refinement(state, f"training-detail-{n}"))
        target = roadmap.find_increment(state, "models-training-and-generation")
        before = copy.deepcopy(state)
        first_story = target["workPackages"][0]["id"]
        training_story = target["workPackages"][1]["id"]
        output_story = target["workPackages"][2]["id"]
        download_ids = {"inspect-installed-models", "review-pinned-model-source", "execute-approved-model-download",
                        "monitor-and-cancel-model-download", "review-and-save-downloaded-model"}
        output_ids = {"generate-and-import-model-output", "qualify-model-workflows-on-hosts"}
        owners = [{"taskId": task["id"], "storyId": first_story if task["id"] in download_ids else
                   output_story if task["id"] in output_ids else training_story} for task in target["plan"]["chunks"]]
        event = {"type": "story-tasks-assigned", "incrementId": target["id"],
                 "expectedPlanDigest": roadmap.fingerprint(target["plan"]), "expectedTrackingDigest": None,
                 "assignments": owners, "authorityRef": "approved-story-tracking", "reason": "Adopt fixture ownership; retain every original technical requirement."}
        state = roadmap.apply_event(state, event)
        roadmap.validate_state_shape(fixture.repo, state)
        for key in ("increments", "technicalAcceptanceRevisions", "workChunkPlanRevisions", "chunks", "evidence", "roadmapApproval"):
            self.assertEqual(state[key], before[key])
        event = fixture.refinement(state, "training-detail-next")
        previous = roadmap.current_story_tracking(state, target["id"])
        event.update(expectedTrackingDigest=roadmap.fingerprint(previous),
                     storyAssignments=owners + [{"taskId": "training-detail-next", "storyId": training_story}])
        state = roadmap.apply_event(state, event)
        roadmap.validate_state_shape(fixture.repo, state)
        self.assertEqual(state["technicalAcceptanceRevisions"], before["technicalAcceptanceRevisions"])
        self.assertEqual(state["workChunkPlanRevisions"][:-1], before["workChunkPlanRevisions"])
        self.assertEqual(state["increments"][6]["completedChunks"], before["increments"][6]["completedChunks"])
        self.assertEqual(state["evidence"], before["evidence"])
        # Exercise actual complete publication and interrupted recovery with the
        # existing one-MiB physical limit, not only an in-memory shape check.
        roadmap.write_project_files(fixture.repo, before)
        journal = fixture.repo / ".local-codex/story-publication.json"
        content = roadmap.publication_journal_content(roadmap.fingerprint(before), state, before["paths"]["report"])
        self.assertLessEqual(len(content.encode("utf8")), roadmap.MAX_JSON_BYTES)
        roadmap.atomic_write(journal, content)
        roadmap.recover_publication(fixture.repo, journal, state["paths"]["state"])
        self.assertFalse(journal.exists())
        path, loaded = roadmap.load_state(fixture.repo, state["paths"]["state"])
        self.assertEqual(loaded, state)
        self.assertLessEqual(path.stat().st_size, roadmap.MAX_JSON_BYTES)
        self.assertEqual(loaded["technicalAcceptanceRevisions"], before["technicalAcceptanceRevisions"])

    def test_legacy_offline_scope_keeps_immutable_task_mapping_and_no_pass(self):
        engine = fixtures.RoadmapEngineTest(); engine.setUp(); self.addCleanup(engine.tearDown)
        engine.define_and_approve([fixtures.increment_definition("increment-1", 1, qualification="controlled-environment", allow_pending=True)])
        engine.apply({"type": "increment-started", "incrementId": "increment-1"})
        engine.apply({"type": "increment-research-recorded", "summary": "Review fixture scope.", "sources": [], "risks": []})
        engine.apply({"type": "increment-plan-recorded", "plan": fixtures.implementation_plan(1)})
        increment = engine.state["increments"][0]
        engine.apply({"type": "story-tasks-assigned", "incrementId": "increment-1",
                      "expectedPlanDigest": roadmap.fingerprint(increment["plan"]), "expectedTrackingDigest": None,
                      "assignments": [{"taskId": "chunk-1", "storyId": "work-1"}],
                      "authorityRef": "approved-story-tracking", "reason": "Adopt unchanged fixture story."})
        engine.apply({"type": "chunk-recorded", "chunkId": "chunk-1", "summary": "Fixture implementation.", "areas": ["Fixture"]})
        for identity, outcome in (("criterion-1", "pending"), ("security-impact-reviewed", "passed")):
            engine.apply({"type": "evidence-recorded", "incrementId": "increment-1", "criterionId": identity,
                          "kind": "review", "outcome": outcome, "summary": "Synthetic scope fixture; no human test is passed."})
        engine.apply({"type": "increment-completed", "summary": "Fixture implemented with human acceptance pending."})
        before = copy.deepcopy(engine.state)
        engine.apply({"type": "legacy-acceptance-scope-revised", "incrementId": "increment-1",
                      "approvedFingerprint": engine.state["roadmapApproval"]["fingerprint"],
                      "authorityRef": "fixture-explicit-offline-acceptance", "onlyHumanScope": True,
                      "summary": "Human acceptance stays offline; no technical result changes.",
                      "removeCriterionIds": ["criterion-1"], "replaceCriteria": []})
        roadmap.validate_state_shape(engine.repo, engine.state)
        self.assertEqual(engine.state["storyTaskTracking"], before["storyTaskTracking"])
        for key in ("chunks", "evidence"):
            self.assertEqual(engine.state[key], before[key])
        self.assertEqual(engine.state["increments"][0]["plan"], before["increments"][0]["plan"])
        self.assertEqual(engine.state["increments"][0]["status"], "implemented-pending-qualification")
        self.assertIsNone(engine.state["roadmapApproval"])


if __name__ == "__main__":
    unittest.main()
