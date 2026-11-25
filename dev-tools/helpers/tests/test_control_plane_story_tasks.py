"""Real Work/receipt/review journeys for compatible planned-task bindings."""
import argparse
import copy
import json
import threading
import unittest
from pathlib import Path
from unittest import mock

from test_control_plane_delivery import Fixture, HELPERS
from test_control_plane_roadmap import fixtures, roadmap
from control_plane.candidate import roadmap_authority
from control_plane.common import digest
from control_plane.contracts import ControlError
from control_plane.deterministic_support import run
from control_plane.work import validate_spec
from control_plane import catalog
from control_plane import work as work_module

REPO = HELPERS.parents[1]


class StoryTaskWorkTests(Fixture):
    def setUp(self):
        super().setUp()
        self.repository(start=False)
        self.put("skills/manage-implementation-roadmaps/scripts/roadmap.py", (REPO / "skills/manage-implementation-roadmaps/scripts/roadmap.py").read_text(encoding="utf8"))
        self.put("dev-tools/helpers/control_plane/work.py", "# Fixture adapter marker; real imported Work owns evidence.\n")
        self.put("dev-tools/helpers/control_plane/records.py", "# Fixture marker; real Records owns claims.\n")
        self.put("dev-tools/helpers/development_control_plane.py", "# Governed fixture adapter\n")
        self.engine = fixtures.RoadmapEngineTest()
        self.engine.repo = self.root
        self.engine.state = roadmap.initial_state(self.root, {"name": "Task fixture", "slug": "task-fixture", "objective": "Preserve exact scoped task evidence"})
        self.engine.define_and_approve([fixtures.increment_definition("increment-1", 1,
                                      qualification="controlled-environment", allow_pending=True)])
        self.engine.apply({"type": "increment-started", "incrementId": "increment-1"})
        self.engine.apply({"type": "increment-research-recorded", "summary": "Inspect exact task authority and negative paths.", "sources": [], "risks": []})
        plan = fixtures.implementation_plan(1)
        plan["chunks"].append({**copy.deepcopy(plan["chunks"][0]), "id": "second-task", "title": "Second independently tracked outcome"})
        self.engine.apply({"type": "increment-plan-recorded", "plan": plan})
        increment = self.engine.state["increments"][0]
        self.engine.apply({"type": "story-tasks-assigned", "incrementId": increment["id"],
                           "expectedPlanDigest": roadmap.fingerprint(increment["plan"]), "expectedTrackingDigest": None,
                           "assignments": [{"taskId": task["id"], "storyId": "work-1"} for task in increment["plan"]["chunks"]],
                           "authorityRef": "fixture-approved-story-tracking", "reason": "Retain the fixture's fixed story."})
        self.save()
        increment = self.engine.state["increments"][0]
        tracking = roadmap.current_story_tracking(self.engine.state, increment["id"])
        self.spec.update(schema_version="development-work-v2", kind="roadmap",
                         roadmap={"state_path": self.engine.state["paths"]["state"], "increment_id": increment["id"]},
                         task_targets=[{"task_id": task["id"], "story_id": "work-1",
                                        "task_definition_digest": roadmap.fingerprint(task),
                                        "tracking_digest": roadmap.fingerprint(tracking),
                                        "work_criteria": [criterion["id"] for criterion in increment["acceptanceCriteria"]],
                                        "coverage": "task-outcome", "scope": "Complete the exact fixture task outcome.",
                                        "limitations": ["No parent increment or controlled-environment qualification is asserted."]}
                                       for task in increment["plan"]["chunks"]],
                         acceptance=[{"id": criterion["id"], "description": criterion["description"], "check_ids": ["documentation"]}
                                     for criterion in increment["acceptanceCriteria"]])

    def save(self):
        roadmap.write_project_files(self.root, self.engine.state)

    def finish(self, spec=None):
        spec = copy.deepcopy(spec or self.spec)
        claim = self.work.start(spec, "author-run")["claim"]["claim_id"]
        self.put("docs/result.md", "completed exact task fixture\n")
        receipt = self.work.verify(spec["work_id"], "author-run", claim)
        self.assertEqual(receipt["qualification"], "passed")
        review = self.work.review({"schema_version": "technical-review-v1", "work_id": spec["work_id"],
                                   "invocation_id": "independent-review", "assurance": "operator-attested",
                                   "disposition": "accepted", "receipt_digest": receipt["receipt_digest"],
                                   "findings": [], "closures": [], "reviewed_criteria": [criterion["id"] for criterion in spec["acceptance"]]})
        self.work.complete(spec["work_id"], "author-run", claim)
        return {"workId": spec["work_id"], "receiptDigest": receipt["receipt_digest"], "reviewDigest": review["review_digest"]}

    def record(self, identity, proof):
        event = {"type": "chunk-recorded", "chunkId": identity, "summary": "Exact local fixture outcome is checked and reviewed.",
                 "areas": ["Fixture implementation"], "tests": ["Actual fixed fixture check passed"], "workProof": proof}
        path = self.put(".local-codex/task-event.json", json.dumps(event))
        result = roadmap.command_apply(argparse.Namespace(repo=str(self.root), state=self.engine.state["paths"]["state"],
                                                          event_file=str(path), dry_run=False))
        _, self.engine.state = roadmap.load_state(self.root, self.engine.state["paths"]["state"])
        return result

    def unadopted_metadata(self, *, scopes=None, source_before=False, work_id="metadata-owner"):
        if "storyTaskTracking" in self.engine.state:
            self.engine.state.pop("storyTaskTracking")
            self.assertEqual(self.engine.state["history"][-1]["type"], "story-tasks-assigned")
            self.engine.state["history"].pop()
            self.save()
        self.put("docs/result.md", "completed baseline fixture\n")
        if source_before:
            source = copy.deepcopy(self.spec); source.update(work_id="released-source", schema_version="development-work-v1")
            source.pop("task_targets")
            old = self.work.start(source, "source-author")["claim"]["claim_id"]
            self.work.claim(source["work_id"], "source-author", old, action="release")
        spec = copy.deepcopy(self.spec)
        spec.update(work_id=work_id, schema_version="development-work-v1", kind="lightweight",
                    write_scope=scopes or [self.engine.state["paths"]["state"], self.engine.state["paths"]["roadmap"]])
        spec.pop("task_targets"); spec.pop("roadmap")
        claim = self.work.start(spec, "metadata-author")["claim"]["claim_id"]
        target = self.engine.state["increments"][0]
        event = {"type": "story-tasks-assigned", "incrementId": target["id"],
                 "expectedPlanDigest": roadmap.fingerprint(target["plan"]), "expectedTrackingDigest": None,
                 "assignments": [{"taskId": task["id"], "storyId": "work-1"} for task in target["plan"]["chunks"]],
                 "authorityRef": "fixture-approved-metadata-adoption", "reason": "Adopt fixed story owners within the exact metadata Work.",
                 "metadataWork": {"workId": spec["work_id"], "invocationId": "metadata-author", "claimId": claim}}
        return spec, claim, event

    def apply_metadata(self, event):
        path = self.put(".local-codex/metadata-event.json", json.dumps(event))
        return roadmap.command_apply(argparse.Namespace(repo=str(self.root), state=self.engine.state["paths"]["state"],
                                                        event_file=str(path), dry_run=False))

    def test_one_real_work_can_complete_two_exact_tasks_without_parent_qualification(self):
        proof = self.finish()
        self.record("chunk-1", proof)
        self.record("second-task", proof)
        state = self.engine.state
        self.assertEqual(state["increments"][0]["completedChunks"], ["chunk-1", "second-task"])
        self.assertEqual([record["workProof"] for record in state["chunks"]], [proof, proof])
        self.assertFalse(state["evidence"])
        self.assertEqual(state["increments"][0]["status"], "verifying")
        self.assertEqual(len(self.work.records.load()["work_items"]), 1)

    def test_v1_binding_digest_is_unchanged_and_cannot_gain_task_fields(self):
        legacy = copy.deepcopy(self.spec); legacy["schema_version"] = "development-work-v1"; legacy.pop("task_targets")
        self.assertEqual(roadmap_authority(self.root, legacy["roadmap"]), self.engine.state["roadmapApproval"]["fingerprint"])
        validate_spec(legacy)
        with self.assertRaises(ControlError): validate_spec({**legacy, "task_targets": self.spec["task_targets"]})

    def test_scoped_local_acceptance_can_complete_tasks_with_controlled_parent_evidence_pending(self):
        spec = copy.deepcopy(self.spec)
        spec["acceptance"] = [{"id": "local-task-behavior", "description": "Exact local fixture task behavior passes.",
                               "check_ids": ["documentation"]}]
        for target in spec["task_targets"]: target["work_criteria"] = ["local-task-behavior"]
        proof = self.finish(spec)
        self.record("chunk-1", proof)
        self.record("second-task", proof)
        increment = self.engine.state["increments"][0]
        self.assertEqual(increment["acceptanceCriteria"][0]["qualification"], "controlled-environment")
        self.assertFalse(self.engine.state["evidence"])
        with self.assertRaises(roadmap.RoadmapError): roadmap.require_control_completion(self.root, self.engine.state)

    def test_partial_support_can_finish_work_but_cannot_complete_a_task(self):
        spec = copy.deepcopy(self.spec)
        for target in spec["task_targets"]: target["coverage"] = "partial-support"
        proof = self.finish(spec)
        with self.assertRaises(roadmap.RoadmapError): self.record("chunk-1", proof)
        self.assertFalse(self.engine.state["chunks"])
        self.assertEqual(self.work.records.load()["work_items"][spec["work_id"]]["status"], "complete")

    def test_task_bound_work_never_supplies_whole_increment_qualification(self):
        proof = self.finish()
        self.record("chunk-1", proof)
        self.record("second-task", proof)
        for criterion in self.engine.state["increments"][0]["acceptanceCriteria"]:
            self.engine.apply({"type": "evidence-recorded", "incrementId": "increment-1", "criterionId": criterion["id"],
                               "kind": "test", "outcome": "passed", "summary": "Fixture criterion checked separately."})
        self.save()
        with self.assertRaisesRegex(roadmap.RoadmapError, "every increment criterion"):
            roadmap.require_control_completion(self.root, self.engine.state)

    def test_task_proof_preserves_the_existing_eighty_character_work_identity_contract(self):
        spec = copy.deepcopy(self.spec); spec["work_id"] = "Scoped_Work_" + "x" * 68
        self.assertEqual(len(spec["work_id"]), 80)
        proof = self.finish(spec)
        self.record("chunk-1", proof)
        self.assertEqual(self.engine.state["chunks"][0]["workProof"]["workId"], spec["work_id"])

    def test_missing_foreign_stale_duplicate_and_undercovered_targets_refuse_before_claim(self):
        variants = []
        for field, value in (("task_id", "foreign-task"), ("story_id", "foreign-story"),
                             ("task_definition_digest", "0" * 64), ("tracking_digest", "0" * 64)):
            changed = copy.deepcopy(self.spec); changed["task_targets"][0][field] = value; variants.append(changed)
        changed = copy.deepcopy(self.spec); changed["task_targets"] = []; variants.append(changed)
        changed = copy.deepcopy(self.spec); changed["task_targets"] *= 33; variants.append(changed)
        changed = copy.deepcopy(self.spec); changed["task_targets"] = [changed["task_targets"][0]] * 2; variants.append(changed)
        changed = copy.deepcopy(self.spec); changed["acceptance"] = changed["acceptance"][:1]; variants.append(changed)
        for field, value in (("work_criteria", []), ("work_criteria", ["foreign-criterion"]),
                             ("coverage", "parent-pass"), ("scope", ""), ("limitations", [])):
            changed = copy.deepcopy(self.spec); changed["task_targets"][0][field] = value; variants.append(changed)
        changed = copy.deepcopy(self.spec); changed["task_targets"][0].pop("coverage"); variants.append(changed)
        for value in variants:
            with self.subTest(value=value), self.assertRaises(ControlError): self.work.start(value, "author-run")
        self.assertFalse(self.work.records.load()["work_items"])

    def test_task_refinement_invalidates_exact_bound_work_without_changing_approval(self):
        claim = self.work.start(self.spec, "author-run")["claim"]["claim_id"]
        old_approval = copy.deepcopy(self.engine.state["roadmapApproval"])
        target = self.engine.state["increments"][0]
        tracking = roadmap.current_story_tracking(self.engine.state, target["id"])
        plan = {key: copy.deepcopy(value) for key, value in target["plan"].items() if key not in {"recordedAt", "fingerprint", "outlineOnly"}}
        plan["chunks"].append({**copy.deepcopy(plan["chunks"][-1]), "id": "third-task"})
        # An external mutation is deliberately simulated through the pure engine;
        # the real CLI separately refuses live-claim ownership publication.
        self.engine.apply({"type": "work-chunks-reconfigured", "incrementId": target["id"],
                           "expectedPlanDigest": roadmap.fingerprint(target["plan"]), "plan": plan,
                           "expectedTrackingDigest": roadmap.fingerprint(tracking),
                           "storyAssignments": [{"taskId": task["id"], "storyId": "work-1"} for task in plan["chunks"]],
                           "authorityRef": "fixture-external-drift", "reason": "Exercise exact task currentness refusal."})
        self.save()
        self.assertEqual(self.engine.state["roadmapApproval"], old_approval)
        with self.assertRaises(ControlError): self.work.verify(self.spec["work_id"], "author-run", claim)
        self.assertFalse(self.work.records.load()["work_items"][self.spec["work_id"]]["receipts"])

    def test_task_start_revalidates_authority_after_a_real_refinement_before_records_lock(self):
        original = work_module.snapshot
        def snapshot_then_refine(root):
            baseline = original(root)
            target = self.engine.state["increments"][0]
            plan = {key: copy.deepcopy(value) for key, value in target["plan"].items()
                    if key not in {"recordedAt", "fingerprint", "outlineOnly"}}
            plan["chunks"].append({**copy.deepcopy(plan["chunks"][-1]), "id": "racing-third-task"})
            event = {"type": "work-chunks-reconfigured", "incrementId": target["id"],
                     "expectedPlanDigest": roadmap.fingerprint(target["plan"]), "plan": plan,
                     "expectedTrackingDigest": roadmap.fingerprint(roadmap.current_story_tracking(self.engine.state, target["id"])),
                     "storyAssignments": [{"taskId": task["id"], "storyId": "work-1"} for task in plan["chunks"]],
                     "authorityRef": "fixture-approved-race", "reason": "Exercise the publication between initial read and Records admission."}
            self.apply_metadata(event)
            return baseline
        with mock.patch.object(work_module, "snapshot", side_effect=snapshot_then_refine):
            with self.assertRaises(ControlError): self.work.start(self.spec, "author-run")
        self.assertFalse(self.work.records.load()["work_items"])
        _, state = roadmap.load_state(self.root, self.engine.state["paths"]["state"])
        self.assertEqual(len(state["increments"][0]["plan"]["chunks"]), 3)

    def test_wrong_receipt_legacy_work_and_new_completed_task_start_refuse(self):
        proof = self.finish()
        before = copy.deepcopy(self.engine.state)
        with self.assertRaises(roadmap.RoadmapError): self.record("chunk-1", {**proof, "receiptDigest": "0" * 64})
        self.assertEqual(self.engine.state, before)
        self.record("chunk-1", proof)
        successor = copy.deepcopy(self.spec); successor["work_id"] = "cannot-reuse-completed-task"
        with self.assertRaises(ControlError): self.work.start(successor, "author-run")
        legacy = copy.deepcopy(self.spec); legacy.update(work_id="legacy-component", schema_version="development-work-v1"); legacy.pop("task_targets")
        legacy_proof = self.finish(legacy)
        with self.assertRaises(roadmap.RoadmapError): self.record("second-task", legacy_proof)
        self.assertEqual(self.engine.state["increments"][0]["completedChunks"], ["chunk-1"])

    def test_recorded_proof_or_history_tampering_fails_canonical_read(self):
        self.record("chunk-1", self.finish())
        for mutate in (lambda state: state["chunks"][0]["workProof"].update(reviewDigest="0" * 64),
                       lambda state: state["history"][-1].pop("taskCompletionDigest"),
                       lambda state: state["chunks"][0].pop("workProof")):
            changed = copy.deepcopy(self.engine.state); mutate(changed)
            with self.assertRaises(roadmap.RoadmapError): roadmap.validate_state_shape(self.root, changed)

    def test_changed_source_cannot_consume_an_old_task_receipt(self):
        proof = self.finish()
        before = copy.deepcopy(self.engine.state)
        self.put("docs/result.md", "completed different candidate after review\n")
        with self.assertRaises(roadmap.RoadmapError): self.record("chunk-1", proof)
        self.assertEqual(self.engine.state, before)

    def test_rehashed_contributor_review_cannot_supply_independent_task_completion(self):
        proof = self.finish()
        def replace_review(state):
            work = state["work_items"][proof["workId"]]
            review = work["reviews"][-1]
            review["invocation_id"] = "author-run"
            review["review_digest"] = digest({key: value for key, value in review.items() if key != "review_digest"})
            work["completion"]["review_digest"] = review["review_digest"]
        self.work.records.mutate(replace_review)
        changed = self.work.records.load()["work_items"][proof["workId"]]["reviews"][-1]["review_digest"]
        with self.assertRaises(roadmap.RoadmapError): self.record("chunk-1", {**proof, "reviewDigest": changed})
        self.assertFalse(self.engine.state["chunks"])

    def test_support_refinement_preview_is_data_only_and_requires_explicit_owners(self):
        self.work.start(self.spec, "author-run")
        target = self.engine.state["increments"][0]
        plan = {key: copy.deepcopy(value) for key, value in target["plan"].items() if key not in {"recordedAt", "fingerprint", "outlineOnly"}}
        plan["chunks"].append({**copy.deepcopy(plan["chunks"][-1]), "id": "third-task"})
        request = {"schema_version": "contributor-support-request-v1", "work_id": self.spec["work_id"], "packet_id": "story-preview",
                   "events": [{"type": "work-chunks-reconfigured", "incrementId": target["id"], "plan": plan,
                               "authorityRef": "fixture-preview", "reason": "Preview only; no task implementation asserted."}]}
        before = (self.root / self.engine.state["paths"]["state"]).read_bytes()
        self.assertEqual(run(self.root, "progress", request)["status"], "needs-input")
        request["events"][0]["storyAssignments"] = [{"taskId": task["id"], "storyId": "work-1"} for task in plan["chunks"]]
        result = run(self.root, "progress", request)
        packet = json.loads((self.root / result["path"]).read_bytes())
        self.assertFalse(packet["data"]["live_state_mutated"])
        self.assertEqual(packet["data"]["preview"]["stories"][0]["tasksPlanned"], 3)
        self.assertEqual((self.root / self.engine.state["paths"]["state"]).read_bytes(), before)

    def test_exact_active_metadata_writer_can_adopt_then_verify_and_review(self):
        registry = "docs/operations/roadmap-supporting-work.json"
        spec, claim, event = self.unadopted_metadata(scopes=[self.engine.state["paths"]["state"], self.engine.state["paths"]["roadmap"], registry])
        self.put(registry, json.dumps({"schema_version": "roadmap-supporting-work-v1", "agent_only_roadmaps": [],
                                       "criterion_labels": [], "successors": [], "links": []}))
        before = copy.deepcopy(self.engine.state)
        self.apply_metadata(event)
        _, state = roadmap.load_state(self.root, before["paths"]["state"])
        self.assertEqual(state["roadmapApproval"], before["roadmapApproval"])
        self.assertFalse(state["chunks"])
        self.assertEqual(self.work.records.load()["work_items"][spec["work_id"]]["claim"]["claim_id"], claim)
        receipt = self.work.verify(spec["work_id"], "metadata-author", claim)
        self.assertEqual(receipt["qualification"], "passed")
        self.work.review({"schema_version": "technical-review-v1", "work_id": spec["work_id"],
                          "invocation_id": "metadata-independent-review", "assurance": "operator-attested", "disposition": "accepted",
                          "receipt_digest": receipt["receipt_digest"], "findings": [], "closures": [],
                          "reviewed_criteria": [criterion["id"] for criterion in spec["acceptance"]]})
        self.work.complete(spec["work_id"], "metadata-author", claim)

    def test_metadata_reference_must_own_the_current_claim_and_precede_checks(self):
        spec, claim, event = self.unadopted_metadata()
        before = (self.root / self.engine.state["paths"]["state"]).read_bytes()
        missing = copy.deepcopy(event); missing.pop("metadataWork")
        variants = [missing]
        for key in ("workId", "invocationId", "claimId"):
            changed = copy.deepcopy(event); changed["metadataWork"][key] = "foreign"; variants.append(changed)
        for value in variants:
            with self.subTest(value=value), self.assertRaises(roadmap.RoadmapError): self.apply_metadata(value)
            self.assertEqual((self.root / self.engine.state["paths"]["state"]).read_bytes(), before)
        self.assertEqual(self.work.verify(spec["work_id"], "metadata-author", claim)["qualification"], "passed")
        with self.assertRaises(roadmap.RoadmapError): self.apply_metadata(event)
        self.assertEqual((self.root / self.engine.state["paths"]["state"]).read_bytes(), before)

    def test_exact_metadata_writer_can_include_the_fixed_task_description_companion(self):
        companion = "docs/operations/roadmap-user-task-descriptions.json"
        spec, claim, event = self.unadopted_metadata(scopes=[self.engine.state["paths"]["state"],
                                                          self.engine.state["paths"]["roadmap"], companion])
        self.put(companion, json.dumps({"schema_version": "roadmap-user-task-descriptions-v1", "records": []}))
        approval = copy.deepcopy(self.engine.state["roadmapApproval"])
        self.apply_metadata(event)
        _, state = roadmap.load_state(self.root, self.engine.state["paths"]["state"])
        self.assertEqual(state["roadmapApproval"], approval)
        self.assertEqual(len(state["storyTaskTracking"]["revisions"]), 1)
        self.assertEqual(self.work.records.load()["work_items"][spec["work_id"]]["claim"]["claim_id"], claim)

    def test_pending_records_journal_refuses_before_metadata_claim_inspection(self):
        spec, claim, event = self.unadopted_metadata()
        with self.assertRaises(OSError):
            self.work.records.mutate(lambda state: state["work_items"][spec["work_id"]].update(status="verifying"),
                                     fault_after="journal")
        paths = [self.root / self.engine.state["paths"]["state"], self.work.records.path, self.work.records.journal]
        before = [path.read_bytes() for path in paths]
        with self.assertRaises(roadmap.RoadmapError): self.apply_metadata(event)
        self.assertEqual([path.read_bytes() for path in paths], before)
        self.work.records.recover()
        self.assertFalse(self.work.records.journal.exists())
        self.assertEqual(self.work.records.load()["work_items"][spec["work_id"]]["status"], "verifying")
        with self.assertRaises(roadmap.RoadmapError): self.apply_metadata(event)

    def test_explicit_records_bootstrap_recovery_owner_blocks_metadata_publication(self):
        spec, claim, event = self.unadopted_metadata()
        self.put(".local-codex/control-plane/bootstrap-recovery.lock", json.dumps({
            "schema_version": "control-plane-bootstrap-owner-v1", "plan_sha256": "a" * 64}))
        before = (self.root / self.engine.state["paths"]["state"]).read_bytes()
        with self.assertRaises(roadmap.RoadmapError): self.apply_metadata(event)
        self.assertEqual((self.root / self.engine.state["paths"]["state"]).read_bytes(), before)

    def test_source_or_directory_scoped_claim_cannot_use_metadata_allowance(self):
        state_path, roadmap_path = self.engine.state["paths"]["state"], self.engine.state["paths"]["roadmap"]
        for index, scopes in enumerate((["docs/result.md"], [state_path, roadmap_path, "docs/result.md"], ["docs", ".implementation-roadmaps"])):
            spec, claim, event = self.unadopted_metadata(scopes=scopes, work_id=f"metadata-owner-{index}")
            with self.subTest(scopes=scopes), self.assertRaises(roadmap.RoadmapError): self.apply_metadata(event)
            self.work.claim(spec["work_id"], "metadata-author", claim, action="release")

    def test_another_claim_never_inherits_the_metadata_allowance(self):
        spec, claim, event = self.unadopted_metadata()
        self.work.records.mutate(lambda state: state["work_items"].update({"foreign-claim": {"claim": {}}}))
        before = (self.root / self.engine.state["paths"]["state"]).read_bytes()
        with self.assertRaises(roadmap.RoadmapError): self.apply_metadata(event)
        self.assertEqual((self.root / self.engine.state["paths"]["state"]).read_bytes(), before)

    def test_expired_claim_or_unrelated_source_drift_cannot_publish_ownership(self):
        spec, claim, event = self.unadopted_metadata()
        original = copy.deepcopy(self.work.records.load()["work_items"][spec["work_id"]]["claim"])
        self.work.records.mutate(lambda state: state["work_items"][spec["work_id"]]["claim"].update(expires_at="2000-01-01T00:00:00Z"))
        with self.assertRaises(roadmap.RoadmapError): self.apply_metadata(event)
        self.work.records.mutate(lambda state: state["work_items"][spec["work_id"]].update(claim=original))
        self.put("docs/result.md", "completed unrelated source drift\n")
        with self.assertRaises(roadmap.RoadmapError): self.apply_metadata(event)

    def test_guarded_interrupted_adoption_recovers_under_its_same_metadata_claim(self):
        spec, claim, event = self.unadopted_metadata()
        before = (self.root / self.engine.state["paths"]["state"]).read_bytes()
        with mock.patch.object(roadmap, "write_project_files", side_effect=roadmap.RoadmapError("fixture interruption")):
            with self.assertRaises(roadmap.RoadmapError): self.apply_metadata(event)
        journals = list((self.root / ".local-codex/roadmap-publication").glob("*.json"))
        self.assertEqual(len(journals), 1)
        self.assertEqual((self.root / self.engine.state["paths"]["state"]).read_bytes(), before)
        roadmap.command_render(argparse.Namespace(repo=str(self.root), state=self.engine.state["paths"]["state"], dry_run=False))
        self.assertFalse(journals[0].exists())
        _, state = roadmap.load_state(self.root, self.engine.state["paths"]["state"])
        self.assertEqual(len(state["storyTaskTracking"]["revisions"]), 1)
        self.assertEqual(self.work.records.load()["work_items"][spec["work_id"]]["claim"]["claim_id"], claim)

    def test_recovery_refuses_unrelated_source_claim_and_accepts_explicit_fresh_metadata_claim(self):
        spec, claim, event = self.unadopted_metadata()
        with mock.patch.object(roadmap, "write_project_files", side_effect=roadmap.RoadmapError("fixture interruption")):
            with self.assertRaises(roadmap.RoadmapError): self.apply_metadata(event)
        self.work.claim(spec["work_id"], "metadata-author", claim, action="release")
        source = copy.deepcopy(self.spec); source.update(work_id="source-during-recovery", schema_version="development-work-v1"); source.pop("task_targets")
        source_claim = self.work.start(source, "source-author")["claim"]["claim_id"]
        args = argparse.Namespace(repo=str(self.root), state=self.engine.state["paths"]["state"], dry_run=False)
        before = (self.root / self.engine.state["paths"]["state"]).read_bytes()
        with self.assertRaises(roadmap.RoadmapError): roadmap.command_render(args)
        self.assertEqual((self.root / self.engine.state["paths"]["state"]).read_bytes(), before)
        self.work.claim(source["work_id"], "source-author", source_claim, action="release")
        fresh = self.work.claim(spec["work_id"], "recovery-author", action="recover")["claim"]["claim_id"]
        reference = self.put(".local-codex/recovery-work.json", json.dumps({"workId": spec["work_id"], "invocationId": "recovery-author", "claimId": fresh}))
        args.metadata_work = str(reference)
        roadmap.command_render(args)
        _, state = roadmap.load_state(self.root, self.engine.state["paths"]["state"])
        self.assertEqual(len(state["storyTaskTracking"]["revisions"]), 1)

    def test_publication_lock_order_allows_claim_state_read_but_blocks_claim_mutation(self):
        self._claim_race(recover=False)

    def test_publication_lock_order_also_blocks_source_claim_recovery_without_deadlock(self):
        self._claim_race(recover=True)

    def _claim_race(self, *, recover):
        spec, claim, event = self.unadopted_metadata(source_before=recover)
        observed_read, finished = threading.Event(), threading.Event()
        results = []
        original_authority, original_write = work_module.roadmap_authority, roadmap.write_project_files
        def authority(*args, **kwargs):
            result = original_authority(*args, **kwargs)
            if threading.current_thread() is worker: observed_read.set()
            return result
        def attempt():
            try:
                if recover:
                    observed_read.set()
                    self.work.claim("released-source", "recovering-source", action="recover")
                else:
                    source = copy.deepcopy(self.spec); source.update(work_id="racing-source", schema_version="development-work-v1"); source.pop("task_targets")
                    self.work.start(source, "source-author")
                results.append("unexpected-claim")
            except ControlError:
                results.append("refused")
            except Exception as error:
                results.append(type(error).__name__)
            finally:
                finished.set()
        worker = threading.Thread(target=attempt, daemon=True)
        def write(*args, **kwargs):
            worker.start()
            self.assertTrue(observed_read.wait(3), "Claim state reads must not need the publication lock")
            self.assertFalse(finished.wait(0.15), "The Records mutation lock must remain held through publication")
            return original_write(*args, **kwargs)
        try:
            with mock.patch.object(work_module, "roadmap_authority", side_effect=authority), mock.patch.object(roadmap, "write_project_files", side_effect=write):
                self.apply_metadata(event)
        finally:
            if worker.ident is not None: worker.join(timeout=8)
        self.assertFalse(worker.is_alive())
        self.assertEqual(results, ["refused"])
        saved = self.work.records.load()
        self.assertEqual({identity for identity, work in saved["work_items"].items() if work.get("claim")}, {spec["work_id"]})


class StoryTaskRoutingTests(unittest.TestCase):
    def test_exact_feature_paths_select_actual_related_checks_and_keep_generic_fallback(self):
        paths = ["dev-tools/helpers/control_plane/candidate.py", "dev-tools/helpers/control_plane/work.py",
                 "dev-tools/helpers/tests/test_control_plane_story_tasks.py"]
        selected = {check["id"]: check for check in catalog.plan(REPO, paths, ["documentation"], "fixture")["selected"]}
        self.assertIn("story-task-bindings", selected)
        self.assertNotIn("control-plane", selected)
        command = selected["story-task-bindings"]["argv"]
        for module in ("test_control_plane_story_tasks.", "test_control_plane_roadmap.",
                       "test_control_plane_deterministic_support.", "test_control_plane_delivery."):
            self.assertIn(module, command)
        explicit = {check["id"] for check in catalog.plan(REPO, paths, ["documentation", "control-plane"], "fixture")["selected"]}
        self.assertIn("control-plane", explicit)
        unknown = {check["id"] for check in catalog.plan(REPO, paths + ["dev-tools/helpers/control_plane/unrelated.py"], ["documentation"], "fixture")["selected"]}
        self.assertIn("control-plane", unknown)
        original = catalog._automatic_files_available
        with mock.patch.object(catalog, "_automatic_files_available", side_effect=lambda root, check: False if check is catalog.PUBLISHED_FORM_CHECKS["story-task-bindings"] else original(root, check)):
            missing = {check["id"] for check in catalog.plan(REPO, paths, ["documentation"], "fixture")["selected"]}
        self.assertIn("control-plane", missing)
        self.assertNotIn("story-task-bindings", missing)


if __name__ == "__main__":
    unittest.main()
