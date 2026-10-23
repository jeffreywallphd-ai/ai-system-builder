from __future__ import annotations

import argparse
import copy
import importlib.util
import json
import subprocess
import sys
import tempfile
import unittest
from unittest import mock
from pathlib import Path


MODULE_PATH = Path(__file__).resolve().parents[1] / "scripts" / "roadmap.py"
SPEC = importlib.util.spec_from_file_location("roadmap_engine", MODULE_PATH)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError("Unable to load roadmap engine.")
roadmap = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(roadmap)


class PublicationSecurityTest(unittest.TestCase):
    def test_precreated_predictable_entry_is_never_written_or_removed(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / "state.json"
            target.write_text("old", encoding="utf-8")
            predictable = target.with_name(f".{target.name}.{roadmap.os.getpid()}.tmp")
            predictable.write_text("unowned", encoding="utf-8")
            roadmap.atomic_write(target, "new\n")
            self.assertEqual(target.read_text(), "new\n")
            self.assertEqual(predictable.read_text(), "unowned")
            self.assertEqual(set(Path(directory).iterdir()), {target, predictable})

    def test_replace_and_write_failures_preserve_old_target_and_remove_only_owned_temp(self):
        for operation in ("replace", "fsync"):
            with self.subTest(operation=operation), tempfile.TemporaryDirectory() as directory:
                target = Path(directory) / "state.json"
                target.write_text("old", encoding="utf-8")
                with mock.patch.object(roadmap.os, operation, side_effect=OSError("injected")):
                    with self.assertRaises(roadmap.RoadmapError):
                        roadmap.atomic_write(target, "new")
                self.assertEqual(target.read_text(), "old")
                self.assertEqual(list(Path(directory).iterdir()), [target])


def security_impact() -> dict:
    return {
        "disposition": "not-security-relevant",
        "summary": (
            "The test roadmap changes no trust, authority, sensitive-data, "
            "execution, dependency, or public diagnostic boundary."
        ),
        "assets": [],
        "trustBoundaries": [],
        "abuseCases": [],
        "controls": [],
        "verification": [],
        "residualRisks": [],
    }


def increment_definition(
    identifier: str,
    number: int,
    *,
    depends_on: list[str] | None = None,
    qualification: str = "local",
    allow_pending: bool = False,
) -> dict:
    return {
        "id": identifier,
        "number": number,
        "title": f"Increment {number}",
        "objective": f"Deliver verified outcome {number}.",
        "dependsOn": depends_on or [],
        "workPackages": [
            {
                "id": f"work-{number}",
                "title": f"Work {number}",
                "outcome": f"Outcome {number} is implemented.",
            }
        ],
        "deliverables": [f"Deliverable {number}"],
        "acceptanceCriteria": [
            {
                "id": f"criterion-{number}",
                "description": f"Criterion {number} is satisfied.",
                "qualification": qualification,
            },
            {
                "id": "security-impact-reviewed",
                "description": (
                    "The increment security impact disposition is reviewed "
                    "and evidenced."
                ),
                "qualification": "local",
            }
        ],
        "verification": [f"Run verification {number}."],
        "rollback": f"Revert increment {number}.",
        "excluded": ["Unrelated scope"],
        "allowPendingQualification": allow_pending,
    }


def implementation_plan(number: int) -> dict:
    return {
        "summary": f"Implement increment {number} as one coherent testable slice.",
        "steps": [f"Implement outcome {number}.", f"Verify outcome {number}."],
        "chunks": [
            {
                "id": f"chunk-{number}",
                "title": f"Chunk {number}",
                "outcome": f"Outcome {number} works end to end.",
                "criteriaIds": [
                    f"criterion-{number}",
                    "security-impact-reviewed",
                ],
            }
        ],
        "focusedTests": [f"Focused test {number}"],
        "completionTests": ["Increment-relevant checks after every chunk is implemented"],
        "documentation": [f"Documentation {number}"],
        "rollback": f"Remove the increment {number} slice.",
        "assumptions": ["The approved scope remains unchanged."],
    }


class RoadmapEngineTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.repo = Path(self.temporary.name).resolve()
        self.state = roadmap.initial_state(
            self.repo,
            {
                "name": "Portable Roadmap",
                "slug": "portable-roadmap",
                "objective": "Deliver a portable verified roadmap workflow.",
            },
        )

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def apply(self, event: dict) -> None:
        self.state = roadmap.apply_event(self.state, event)
        roadmap.validate_state_shape(self.repo, self.state)

    def define_and_approve(self, increments: list[dict]) -> None:
        self.apply(
            {
                "type": "discovery-recorded",
                "summary": "Repository and primary-source research is complete.",
                "sources": [{"title": "Repository guidance"}],
                "constraints": ["Preserve approved dependency direction."],
                "securityImpact": security_impact(),
                "decisionRequired": False,
            }
        )
        self.apply({"type": "roadmap-defined", "increments": increments})
        self.apply(
            {
                "type": "roadmap-approved",
                "note": "The user explicitly approved this roadmap.",
            }
        )

    def execute_increment(self, number: int, outcome: str = "passed") -> None:
        identifier = f"increment-{number}"
        self.apply({"type": "increment-started", "incrementId": identifier})
        self.apply(
            {
                "type": "increment-research-recorded",
                "summary": f"Increment {number} research is complete.",
                "sources": [{"title": f"Source {number}"}],
                "risks": [f"Risk {number} is covered by a regression test."],
            }
        )
        self.apply(
            {
                "type": "increment-plan-recorded",
                "plan": implementation_plan(number),
            }
        )
        self.apply(
            {
                "type": "chunk-recorded",
                "chunkId": f"chunk-{number}",
                "summary": f"Chunk {number} is implemented.",
                "areas": [f"Area {number}"],
                "tests": [f"Focused test {number} passed."],
                "documentation": [f"Documentation {number} updated."],
                "feedbackAddressed": [],
            }
        )
        self.apply(
            {
                "type": "evidence-recorded",
                "incrementId": identifier,
                "criterionId": f"criterion-{number}",
                "kind": "test" if outcome != "pending" else "external",
                "outcome": outcome,
                "summary": f"Criterion {number} evidence is {outcome}.",
            }
        )
        self.apply(
            {
                "type": "evidence-recorded",
                "incrementId": identifier,
                "criterionId": "security-impact-reviewed",
                "kind": "review",
                "outcome": "passed",
                "summary": (
                    "The not-security-relevant disposition and rationale "
                    "were reviewed."
                ),
            }
        )
        self.apply(
            {
                "type": "increment-completed",
                "summary": f"Increment {number} is accounted for.",
            }
        )

    def pending_human_acceptance(self):
        self.define_and_approve([increment_definition("increment-1", 1, qualification="controlled-environment", allow_pending=True)])
        self.execute_increment(1, "pending")
        return {"type": "human-acceptance-transferred", "incrementId": "increment-1", "criterionIds": ["criterion-1"],
                "approvedFingerprint": roadmap.roadmap_fingerprint(self.state), "authorityRef": "explicit-user-offline-acceptance",
                "onlyHumanAcceptance": True, "summary": "User owns manual acceptance offline; technical evidence remains declarative."}

    def test_human_acceptance_handoff_archives_without_fabricating_passes(self):
        event = self.pending_human_acceptance()
        before = copy.deepcopy(self.state)
        self.apply(event)
        self.assertEqual(self.state["increments"][0]["status"], "completed")
        self.assertEqual(self.state["increments"][0]["pendingCriteria"], [])
        self.assertEqual(self.state["evidence"], before["evidence"])
        self.assertEqual(self.state["chunks"], before["chunks"])
        self.assertEqual(self.state["increments"][0]["plan"], before["increments"][0]["plan"])
        transfer = self.state["humanAcceptanceTransfers"][0]
        self.assertEqual(transfer["criteria"], before["increments"][0]["acceptanceCriteria"][:1])
        self.assertEqual(transfer["originalPlan"], before["increments"][0]["plan"])
        self.assertEqual(transfer["previousApproval"], before["roadmapApproval"])
        self.assertEqual(transfer["status"], "offline-user-owned")
        self.assertFalse(roadmap.approval_is_current(self.state))
        self.assertIn("no test pass asserted", roadmap.render_roadmap(self.state))
        with self.assertRaises(roadmap.RoadmapError):
            self.apply({"type": "roadmap-completed", "summary": "No stale approval allowed"})
        self.apply({"type": "roadmap-approved", "note": "User explicitly directed this narrow human acceptance scope transfer."})
        self.assertEqual(self.state["status"], "roadmap-ready-to-close")
        self.assertNotEqual(self.state["roadmapApproval"]["fingerprint"], before["roadmapApproval"]["fingerprint"])

    def test_human_acceptance_handoff_cannot_bypass_governed_completion_policy(self):
        event = self.pending_human_acceptance()
        self.state["evidencePolicy"] = "control-plane-v1"
        self.state["completionSuite"] = "standardande2e"
        self.state["roadmapApproval"]["fingerprint"] = roadmap.roadmap_fingerprint(self.state)
        event["approvedFingerprint"] = roadmap.roadmap_fingerprint(self.state)
        before = copy.deepcopy(self.state)
        with self.assertRaisesRegex(roadmap.RoadmapError, "governed"):
            self.apply(event)
        self.assertEqual(self.state, before)

    def test_human_acceptance_handoff_denies_unsafe_or_nonsole_blockers(self):
        event = self.pending_human_acceptance()
        original = copy.deepcopy(self.state)
        cases = []
        for patch in [{"approvedFingerprint": "stale"}, {"onlyHumanAcceptance": False}, {"criterionIds": ["unknown"]},
                      {"criterionIds": ["criterion-1", "criterion-1"]}, {"authorityRef": ""}]:
            cases.append((copy.deepcopy(original), {**event, **patch}))
        for status in ["implementing", "pending", "completed"]:
            state = copy.deepcopy(original); state["increments"][0]["status"] = status; cases.append((state, event))
        for outcome in ["failed", "passed", "missing"]:
            state = copy.deepcopy(original)
            if outcome == "missing": state["evidence"] = state["evidence"][1:]
            else: state["evidence"][0]["outcome"] = outcome
            cases.append((state, event))
        state = copy.deepcopy(original); state["increments"][0]["completedChunks"] = []; cases.append((state, event))
        state = copy.deepcopy(original); state["blockers"] = [{"status": "open"}]; cases.append((state, event))
        state = copy.deepcopy(original); state["evidence"][-1]["outcome"] = "failed"; cases.append((state, event))
        state = copy.deepcopy(original); state["increments"][0]["acceptanceCriteria"][0]["qualification"] = "local"
        state["roadmapApproval"]["fingerprint"] = roadmap.roadmap_fingerprint(state)
        cases.append((state, {**event, "approvedFingerprint": roadmap.roadmap_fingerprint(state)}))
        state = copy.deepcopy(original)
        state["increments"][0]["acceptanceCriteria"][1]["qualification"] = "controlled-environment"
        state["evidence"][-1]["outcome"] = "pending"
        state["roadmapApproval"]["fingerprint"] = roadmap.roadmap_fingerprint(state)
        cases.append((state, {**event, "approvedFingerprint": roadmap.roadmap_fingerprint(state)}))
        cases.append((state, {**event, "criterionIds": ["security-impact-reviewed"], "approvedFingerprint": roadmap.roadmap_fingerprint(state)}))
        state = copy.deepcopy(state)
        state["evidence"][0]["outcome"] = "passed"
        # Isolate the security guard: every other criterion already passes.
        cases.append((state, {**event, "criterionIds": ["security-impact-reviewed"], "approvedFingerprint": roadmap.roadmap_fingerprint(state)}))
        for state, request in cases:
            with self.subTest(request=request, status=state["increments"][0]["status"]):
                frozen = copy.deepcopy(state)
                with self.assertRaises(roadmap.RoadmapError): roadmap.apply_event(state, request)
                self.assertEqual(state, frozen)

    def governed_human_scope(self):
        self.pending_human_acceptance()
        self.state.update(evidencePolicy="control-plane-v1", completionSuite="standardande2e")
        increment = self.state["increments"][0]
        increment["acceptanceCriteria"].append({"id": "mixed-check", "description": "Reference performance and manual screen reader", "qualification": "controlled-environment"})
        increment["pendingCriteria"].append("mixed-check")
        self.state["evidence"].append({**self.state["evidence"][0], "id": "evidence-3", "criterionId": "mixed-check"})
        increment["plan"]["chunks"][0]["criteriaIds"].append("mixed-check")
        self.state["roadmapApproval"]["fingerprint"] = roadmap.roadmap_fingerprint(self.state)
        return {"type": "acceptance-scope-revised", "incrementId": "increment-1",
                "approvedFingerprint": roadmap.roadmap_fingerprint(self.state), "authorityRef": "explicit-user-agent-only",
                "onlyHumanScope": True, "summary": "Human acceptance is user-owned offline; retain technical checks.",
                "removeCriterionIds": ["criterion-1"], "replaceCriteria": [{"criterion": {"id": "mixed-check", "description": "Reference performance and automated keyboard/accessibility", "qualification": "controlled-environment"}, "humanScope": "Manual screen-reader acceptance"}]}

    def test_governed_human_scope_preserves_technical_evidence_and_never_closes(self):
        event = self.governed_human_scope()
        self.state["blockers"] = [{"id": "technical-environment", "status": "open"}]
        before = copy.deepcopy(self.state)
        self.apply(event)
        increment = self.state["increments"][0]
        self.assertEqual(increment["status"], before["increments"][0]["status"])
        self.assertEqual(increment["pendingCriteria"], ["mixed-check"])
        for key in ["chunks", "evidence", "blockers", "currentIncrementId", "completionSuite", "evidencePolicy"]:
            self.assertEqual(self.state[key], before[key])
        self.assertEqual(increment["plan"], before["increments"][0]["plan"])
        self.assertEqual(self.state["history"][:-1], before["history"])
        revision = self.state["acceptanceScopeRevisions"][0]
        self.assertEqual(revision["removedCriteria"], before["increments"][0]["acceptanceCriteria"][:1])
        self.assertEqual(revision["replacedCriteria"][0]["original"], before["increments"][0]["acceptanceCriteria"][-1])
        self.assertEqual(revision["previousApproval"], before["roadmapApproval"])
        self.assertFalse(roadmap.approval_is_current(self.state))
        self.assertIn("no test pass asserted", roadmap.render_roadmap(self.state))
        self.apply({"type": "roadmap-approved", "note": "User explicitly approved the narrow agent-only scope."})
        self.assertNotEqual(self.state["roadmapApproval"]["fingerprint"], before["roadmapApproval"]["fingerprint"])
        with self.assertRaises(roadmap.RoadmapError):
            self.apply({"type": "roadmap-completed", "summary": "Pending technical checks cannot close"})

    def test_governed_human_scope_denies_unsafe_changes_without_mutation(self):
        event = self.governed_human_scope()
        original = copy.deepcopy(self.state)
        cases = []
        for patch in [{"approvedFingerprint": "stale"}, {"onlyHumanScope": False}, {"removeCriterionIds": ["unknown"]},
                      {"removeCriterionIds": ["criterion-1", "criterion-1"]}, {"authorityRef": ""},
                      {"removeCriterionIds": [], "replaceCriteria": []}, {"removeCriterionIds": ["mixed-check"]},
                      {"completionSuite": "all"}]:
            cases.append((copy.deepcopy(original), {**event, **patch}))
        for policy in [None, "unknown"]:
            state = copy.deepcopy(original); state["evidencePolicy"] = policy; cases.append((state, event))
        for status in ["pending", "implementing", "completed"]:
            state = copy.deepcopy(original); state["increments"][0]["status"] = status; cases.append((state, event))
        for outcome in ["passed", "failed", "missing"]:
            state = copy.deepcopy(original)
            if outcome == "missing": state["evidence"] = state["evidence"][1:]
            else: state["evidence"][0]["outcome"] = outcome
            cases.append((state, event))
        state = copy.deepcopy(original); state["increments"][0]["completedChunks"] = []; cases.append((state, event))
        for replacement in [{"id": "new-id"}, {"qualification": "local"}, {"description": "Reference performance and manual screen reader"}]:
            request = copy.deepcopy(event); request["replaceCriteria"][0]["criterion"].update(replacement); cases.append((original, request))
        state = copy.deepcopy(original)
        state["increments"][0]["acceptanceCriteria"][0]["qualification"] = "local"
        state["roadmapApproval"]["fingerprint"] = roadmap.roadmap_fingerprint(state)
        cases.append((state, {**event, "approvedFingerprint": roadmap.roadmap_fingerprint(state)}))
        state = copy.deepcopy(original)
        state["increments"][0]["acceptanceCriteria"][1]["qualification"] = "controlled-environment"
        state["evidence"][1]["outcome"] = "pending"
        state["roadmapApproval"]["fingerprint"] = roadmap.roadmap_fingerprint(state)
        cases.append((state, {**event, "removeCriterionIds": ["security-impact-reviewed"], "approvedFingerprint": roadmap.roadmap_fingerprint(state)}))
        for state, request in cases:
            with self.subTest(request=request):
                frozen = copy.deepcopy(state)
                with self.assertRaises(roadmap.RoadmapError): roadmap.apply_event(state, request)
                self.assertEqual(state, frozen)

    def test_governed_scope_archive_rejects_malformed_or_active_retired_requirements(self):
        event = self.governed_human_scope()
        self.apply(event)
        original = copy.deepcopy(self.state)
        patches = [lambda r: r.update(status="passed"), lambda r: r.update(authorityRef=""),
                   lambda r: r.update(removedCriteria=[{"id": "mixed-check", "description": "Active", "qualification": "controlled-environment"}]),
                   lambda r: r["replacedCriteria"][0]["revised"].update(id="different"),
                   lambda r: r["replacedCriteria"][0]["revised"].update(qualification="local"),
                   lambda r: r.update(replacedCriteria=[None]),
                   lambda r: r.update(removedCriteria=[], replacedCriteria=[])]
        for patch in patches:
            state = copy.deepcopy(original)
            patch(state["acceptanceScopeRevisions"][0])
            with self.assertRaises(roadmap.RoadmapError): roadmap.validate_state_shape(self.repo, state)

    def test_explicit_legacy_mixed_scope_archives_humans_without_technical_closure(self):
        event = self.governed_human_scope()
        self.state.pop("evidencePolicy")
        self.state.pop("completionSuite")
        self.state["roadmapApproval"]["fingerprint"] = roadmap.roadmap_fingerprint(self.state)
        event.update(type="legacy-acceptance-scope-revised", approvedFingerprint=roadmap.roadmap_fingerprint(self.state))
        before = copy.deepcopy(self.state)
        self.apply(event)
        self.assertEqual(self.state["legacyAcceptanceScopeRevisions"][0]["originalPlan"], before["increments"][0]["plan"])
        self.assertNotIn("acceptanceScopeRevisions", self.state)
        self.assertNotIn("evidencePolicy", self.state)
        self.assertIsNone(self.state["roadmapApproval"])
        for key in ["evidence", "chunks", "blockers", "currentIncrementId"]:
            self.assertEqual(self.state[key], before[key])
        self.assertEqual(self.state["increments"][0]["status"], before["increments"][0]["status"])
        self.assertEqual(self.state["increments"][0]["pendingCriteria"], ["mixed-check"])
        roadmap.validate_state_shape(self.repo, self.state)
        self.assertIn("No test pass is asserted", roadmap.render_roadmap(self.state))
        self.apply({"type": "roadmap-approved", "note": "User explicitly requested this exact offline scope."})
        with self.assertRaises(roadmap.RoadmapError):
            self.apply({"type": "roadmap-completed", "summary": "Technical qualification is still pending"})
        state = copy.deepcopy(self.state)
        state["evidencePolicy"] = "control-plane-v1"
        with self.assertRaises(roadmap.RoadmapError): roadmap.validate_state_shape(self.repo, state)

    def test_legacy_scope_cannot_bypass_governed_event_or_technical_pending_guards(self):
        event = self.governed_human_scope()
        request = {**event, "type": "legacy-acceptance-scope-revised"}
        original = copy.deepcopy(self.state)
        with self.assertRaises(roadmap.RoadmapError): self.apply(request)
        self.assertEqual(self.state, original)
        for mode in ["failed", "missing", "security", "incomplete", "stale"]:
            state = copy.deepcopy(original)
            state.pop("evidencePolicy")
            if mode == "failed": state["evidence"][0]["outcome"] = "failed"
            if mode == "missing": state["evidence"] = state["evidence"][1:]
            if mode == "security": request = {**request, "removeCriterionIds": ["security-impact-reviewed"]}
            else: request = {**event, "type": "legacy-acceptance-scope-revised"}
            if mode == "incomplete": state["increments"][0]["completedChunks"] = []
            state["roadmapApproval"]["fingerprint"] = roadmap.roadmap_fingerprint(state)
            request["approvedFingerprint"] = "stale" if mode == "stale" else roadmap.roadmap_fingerprint(state)
            frozen = copy.deepcopy(state)
            with self.subTest(mode=mode), self.assertRaises(roadmap.RoadmapError): roadmap.apply_event(state, request)
            self.assertEqual(state, frozen)

    def technical_policy_revision(self):
        self.pending_human_acceptance()
        self.state.update(evidencePolicy="control-plane-v1", completionSuite="all")
        self.state["roadmapApproval"]["fingerprint"] = roadmap.roadmap_fingerprint(self.state)
        return {
            "type": "technical-acceptance-revised", "incrementId": "increment-1",
            "approvedFingerprint": roadmap.roadmap_fingerprint(self.state),
            "authorityRef": "explicit-user-model-quality-policy", "policyRef": "model-quality-contract",
            "policyDigest": "a" * 64,
            "criterion": {"id": "criterion-1", "qualification": "controlled-environment",
                          "description": "Use the approved completed-output quality policy; actual optional resource and cleanup evidence is still required."},
            "supersededRequirements": ["Earlier numeric output-quality threshold"],
            "retainedRequirements": ["Actual optional execution, resource bounds, native authority and confirmed cleanup"],
            "summary": "Apply explicit user technical policy without inventing a measurement or passing optional execution.",
        }

    def test_technical_policy_revision_archives_exact_scope_and_never_qualifies(self):
        event = self.technical_policy_revision()
        self.state["blockers"] = [{"id": "native-proof", "status": "open"}]
        self.state["currentIncrementId"] = "increment-1"
        self.state["increments"][0]["status"] = "blocked"
        self.state["status"] = "blocked"
        before = copy.deepcopy(self.state)
        self.apply(event)
        revision = self.state["technicalAcceptanceRevisions"][0]
        self.assertEqual(revision["originalCriterion"], before["increments"][0]["acceptanceCriteria"][0])
        self.assertEqual(revision["revisedCriterion"], event["criterion"])
        self.assertEqual(revision["originalPlan"], before["increments"][0]["plan"])
        self.assertEqual(revision["previousApproval"], before["roadmapApproval"])
        for key in ["evidence", "chunks", "blockers", "currentIncrementId", "completionSuite", "evidencePolicy", "completion", "finalApproval"]:
            self.assertEqual(self.state[key], before[key])
        self.assertEqual(self.state["history"][:-1], before["history"])
        for key in ["plan", "completedChunks", "pendingCriteria", "status"]:
            self.assertEqual(self.state["increments"][0][key], before["increments"][0][key])
        self.assertFalse(roadmap.approval_is_current(self.state))
        self.assertNotEqual(roadmap.roadmap_fingerprint(self.state), before["roadmapApproval"]["fingerprint"])
        self.assertIn("no test pass or completion is asserted", roadmap.render_roadmap(self.state))
        self.assertIn(before["increments"][0]["acceptanceCriteria"][0]["description"], roadmap.render_roadmap(self.state))
        self.assertNotIn("offline-user-owned", json.dumps(revision))
        self.apply({"type": "roadmap-approved", "note": "User already explicitly authorized this exact narrow policy."})
        self.assertTrue(roadmap.approval_is_current(self.state))
        self.assertEqual(self.state["status"], "blocked")
        self.assertEqual(self.state["increments"][0]["status"], "blocked")
        self.assertEqual(self.state["blockers"], before["blockers"])
        self.assertFalse(roadmap.implementation_ready_for_overall(self.state))
        with self.assertRaises(roadmap.RoadmapError):
            self.apply({"type": "roadmap-completed", "summary": "Policy is not qualification"})

    def test_technical_policy_revision_denies_unsafe_requests_without_mutation(self):
        event = self.technical_policy_revision()
        original = copy.deepcopy(self.state)
        cases = []
        for patch in [{"approvedFingerprint": "stale"}, {"authorityRef": ""}, {"policyRef": "../policy.json"},
                      {"policyDigest": "bad"}, {"policyDigest": 1}, {"retainedRequirements": []},
                      {"supersededRequirements": []}, {"removeCriterionIds": ["criterion-1"]},
                      {"onlyHumanScope": True}, {"completionSuite": "standardande2e"},
                      {"retainedRequirements": ["x"] * 21}]:
            cases.append((copy.deepcopy(original), {**event, **patch}))
        for patch in [{"id": "unknown"}, {"qualification": "local"},
                      {"description": original["increments"][0]["acceptanceCriteria"][0]["description"]}]:
            cases.append((copy.deepcopy(original), {**event, "criterion": {**event["criterion"], **patch}}))
        for policy in [None, "unknown"]:
            state = copy.deepcopy(original)
            state["evidencePolicy"] = policy
            state["roadmapApproval"]["fingerprint"] = roadmap.roadmap_fingerprint(state)
            cases.append((state, {**event, "approvedFingerprint": roadmap.roadmap_fingerprint(state)}))
        for status in ["pending", "implementing", "completed"]:
            state = copy.deepcopy(original)
            state["increments"][0]["status"] = status
            cases.append((state, event))
        for outcome in ["passed", "failed", "missing"]:
            state = copy.deepcopy(original)
            if outcome == "missing":
                state["evidence"] = state["evidence"][1:]
            else:
                state["evidence"][0]["outcome"] = outcome
            cases.append((state, event))
        for chunks in [[], ["chunk-1", "chunk-1"]]:
            state = copy.deepcopy(original)
            state["increments"][0]["completedChunks"] = chunks
            cases.append((state, event))
        state = copy.deepcopy(original)
        state["increments"][0]["plan"]["chunks"] *= 2
        state["increments"][0]["completedChunks"] *= 2
        cases.append((state, event))
        state = copy.deepcopy(original)
        state["increments"][0]["acceptanceCriteria"][1]["qualification"] = "controlled-environment"
        state["evidence"][1]["outcome"] = "pending"
        state["roadmapApproval"]["fingerprint"] = roadmap.roadmap_fingerprint(state)
        cases.append((state, {**event, "approvedFingerprint": roadmap.roadmap_fingerprint(state),
                              "criterion": {**event["criterion"], "id": "security-impact-reviewed"}}))
        for state, request in cases:
            frozen = copy.deepcopy(state)
            with self.subTest(request=request), self.assertRaises(roadmap.RoadmapError):
                roadmap.apply_event(state, request)
            self.assertEqual(state, frozen)

    def test_technical_policy_archive_rejects_malformed_or_reclassified_records(self):
        event = self.technical_policy_revision()
        self.apply(event)
        original = copy.deepcopy(self.state)
        patches = [lambda r: r.update(status="passed"), lambda r: r.update(status="offline-user-owned"),
                   lambda r: r.update(policyDigest="bad"), lambda r: r.update(authorityRef=""),
                   lambda r: r.update(retainedRequirements=[]), lambda r: r.update(originalPlan=None),
                   lambda r: r.update(previousApproval=None), lambda r: r.update(unknown=True),
                   lambda r: r["revisedCriterion"].update(id="other"),
                   lambda r: r["revisedCriterion"].update(qualification="local"),
                   lambda r: r["originalCriterion"].update(qualification="local")]
        for patch in patches:
            state = copy.deepcopy(original)
            patch(state["technicalAcceptanceRevisions"][0])
            with self.assertRaises(roadmap.RoadmapError):
                roadmap.validate_state_shape(self.repo, state)
        state = copy.deepcopy(original)
        state.pop("evidencePolicy")
        with self.assertRaises(roadmap.RoadmapError):
            roadmap.validate_state_shape(self.repo, state)
        state = copy.deepcopy(original)
        state["increments"][0]["acceptanceCriteria"][0]["id"] = "foreign"
        with self.assertRaises(roadmap.RoadmapError):
            roadmap.validate_state_shape(self.repo, state)

    def test_technical_policy_revision_cannot_reuse_prior_approval_or_close_pending_target(self):
        event = self.technical_policy_revision()
        self.apply(event)
        revised = copy.deepcopy(self.state)
        with self.assertRaises(roadmap.RoadmapError):
            self.apply(event)
        self.assertEqual(self.state, revised)
        self.apply({"type": "roadmap-approved", "note": "User approved exact policy; actual checks still pending."})
        self.assertIsNotNone(roadmap.pending_qualification_context(self.state, "increment-1"))
        with self.assertRaisesRegex(roadmap.RoadmapError, "Every target criterion"):
            self.apply({"type": "increment-qualified", "incrementId": "increment-1", "workId": "old-target",
                        "receiptDigest": "0" * 64, "reviewDigest": "0" * 64, "summary": "No invented pass"})

    def test_pending_target_qualification_refuses_legacy_and_unperformed_checks(self) -> None:
        self.define_and_approve([increment_definition("increment-1", 1, qualification="controlled-environment", allow_pending=True)])
        self.execute_increment(1, "pending")
        event = {"type": "increment-qualified", "incrementId": "increment-1", "workId": "target-proof",
                 "receiptDigest": "0" * 64, "reviewDigest": "0" * 64, "summary": "No unperformed check may pass"}
        with self.assertRaises(roadmap.RoadmapError):
            self.apply(event)
        self.state["evidencePolicy"] = "control-plane-v1"
        self.state["roadmapApproval"]["fingerprint"] = roadmap.roadmap_fingerprint(self.state)
        self.assertIsNotNone(roadmap.pending_qualification_context(self.state, "increment-1"))
        with self.assertRaisesRegex(roadmap.RoadmapError, "Every target criterion"):
            self.apply(event)
        increment = self.state["increments"][0]
        increment["plan"]["chunks"] *= 2
        increment["completedChunks"] *= 2
        self.assertIsNone(roadmap.pending_qualification_context(self.state, "increment-1"))

    def test_two_increment_happy_path_renders_durable_artifacts(self) -> None:
        self.define_and_approve(
            [
                increment_definition("increment-1", 1),
                increment_definition(
                    "increment-2", 2, depends_on=["increment-1"]
                ),
            ]
        )
        self.execute_increment(1)
        self.execute_increment(2)
        self.apply(
            {
                "type": "roadmap-completed",
                "summary": "All increments and evidence are complete.",
            }
        )
        roadmap.write_project_files(self.repo, self.state)
        roadmap.ensure_documents_match(self.repo, self.state)

        report = (
            self.repo / self.state["paths"]["report"]
        ).read_text(encoding="utf-8")
        rendered_roadmap = (
            self.repo / self.state["paths"]["roadmap"]
        ).read_text(encoding="utf-8")
        self.assertEqual(self.state["status"], "completed")
        self.assertIn("## Recent progress", report)
        self.assertIn("Chunk 2", report)
        self.assertIn("## Increment 2: Increment 2", rendered_roadmap)
        self.assertIn("2 passed, 0 pending, 0 failed, 0 missing", report)
        self.assertNotIn("## Evidence ledger", report)
        self.assertLess(len(report), 5000)

    def test_cannot_skip_the_next_increment(self) -> None:
        self.define_and_approve(
            [
                increment_definition("increment-1", 1),
                increment_definition(
                    "increment-2", 2, depends_on=["increment-1"]
                ),
            ]
        )
        with self.assertRaisesRegex(roadmap.RoadmapError, "skipping"):
            self.apply(
                {"type": "increment-started", "incrementId": "increment-2"}
            )

    def test_new_increment_refuses_unresolved_blockers_atomically(self) -> None:
        self.define_and_approve([increment_definition("increment-1", 1)])
        approved = copy.deepcopy(self.state)
        kinds = ["environment", "dependency", "decision", "credential", "production-authority", "technical"]
        for kind, status in [(kind, "open") for kind in kinds] + [("technical", "pending"), ("technical", None)]:
            with self.subTest(kind=kind, status=status):
                self.state = copy.deepcopy(approved)
                self.apply({
                    "type": "blocker-recorded", "id": "actual-obstacle", "kind": kind,
                    "summary": "A required technical prerequisite is unavailable.",
                    "requiredAction": "Resolve and reconcile the actual prerequisite before starting.",
                })
                # Only an explicitly resolved record can grant start admission.
                self.state["blockers"][0]["status"] = status
                before = copy.deepcopy(self.state)
                roadmap.write_project_files(self.repo, self.state)
                paths = [self.repo / path for path in self.state["paths"].values()]
                original_files = {path: path.read_bytes() for path in paths}
                event_file = self.repo / "start-event.json"
                event_file.write_text(json.dumps({"type": "increment-started", "incrementId": "increment-1"}), encoding="utf-8")
                with self.assertRaisesRegex(roadmap.RoadmapError, "blocker"):
                    roadmap.command_apply(argparse.Namespace(repo=str(self.repo), state=self.state["paths"]["state"], event_file=str(event_file), dry_run=False))
                self.assertEqual(self.state, before)
                self.assertEqual({path: path.read_bytes() for path in paths}, original_files)
                self.assertEqual(self.state["roadmapApproval"], approved["roadmapApproval"])
                self.assertIsNone(self.state["currentIncrementId"])

    def test_resolving_only_some_blockers_keeps_new_increment_denied(self) -> None:
        self.define_and_approve([increment_definition("increment-1", 1)])
        for identifier in ["first-obstacle", "second-obstacle"]:
            self.apply({"type": "blocker-recorded", "id": identifier, "kind": "technical", "summary": "A required prerequisite is unavailable.", "requiredAction": "Resolve the actual prerequisite."})
        self.apply({"type": "resumed", "blockerId": "first-obstacle", "resolution": "The first prerequisite is available.", "reconciliation": "Verified only the first prerequisite; the other remains unavailable."})
        before = copy.deepcopy(self.state)
        with self.assertRaisesRegex(roadmap.RoadmapError, "blocker"):
            self.apply({"type": "increment-started", "incrementId": "increment-1"})
        self.assertEqual(self.state, before)

    def test_resolved_blocker_allows_start_and_preserves_approval(self) -> None:
        self.define_and_approve([increment_definition("increment-1", 1)])
        approval = copy.deepcopy(self.state["roadmapApproval"])
        self.apply({"type": "blocker-recorded", "id": "runtime-prerequisite", "kind": "environment", "summary": "The required runtime is unavailable.", "requiredAction": "Verify runtime availability."})
        self.apply({"type": "resumed", "blockerId": "runtime-prerequisite", "resolution": "The required runtime is available.", "reconciliation": "Verified the prerequisite before continuing."})
        self.assertEqual(self.state["status"], "ready")
        self.assertTrue(roadmap.approval_is_current(self.state))
        self.apply({"type": "increment-started", "incrementId": "increment-1"})
        self.assertEqual(self.state["status"], "executing")
        self.assertEqual(self.state["currentIncrementId"], "increment-1")
        self.assertEqual(self.state["roadmapApproval"], approval)
        self.assertEqual(self.state["blockers"][0]["status"], "resolved")

    def test_resolved_blocker_does_not_allow_incomplete_dependencies(self) -> None:
        self.define_and_approve([increment_definition("increment-1", 1), increment_definition("increment-2", 2, depends_on=["increment-1"])])
        # A legacy non-active blocked prefix is still an incomplete dependency.
        self.state["increments"][0]["status"] = "blocked"
        self.apply({"type": "blocker-recorded", "id": "environment", "kind": "environment", "summary": "A host prerequisite is unavailable.", "requiredAction": "Verify host availability."})
        self.apply({"type": "resumed", "blockerId": "environment", "resolution": "The host is available.", "reconciliation": "The host recovered; the earlier increment remains incomplete."})
        before = copy.deepcopy(self.state)
        with self.assertRaisesRegex(roadmap.RoadmapError, "dependencies are incomplete"):
            self.apply({"type": "increment-started", "incrementId": "increment-2"})
        self.assertEqual(self.state, before)

    def test_resumed_derives_inactive_status_without_qualifying_work(self) -> None:
        initial = copy.deepcopy(self.state)
        for outcome, future_pending, expected in [
            ("passed", False, "roadmap-ready-to-close"),
            ("pending", False, "implementation-complete-qualification-pending"),
            ("pending", True, "ready"),
        ]:
            with self.subTest(outcome=outcome, future_pending=future_pending):
                self.state = copy.deepcopy(initial)
                increments = [increment_definition("increment-1", 1, qualification="controlled-environment", allow_pending=True)]
                if future_pending:
                    increments.append(increment_definition("increment-2", 2, depends_on=["increment-1"]))
                self.define_and_approve(increments)
                self.execute_increment(1, outcome)
                preserved = copy.deepcopy({key: self.state[key] for key in ["increments", "evidence", "chunks", "roadmapApproval"]})
                self.apply({"type": "blocker-recorded", "id": "host", "kind": "environment", "summary": "A host prerequisite is unavailable.", "requiredAction": "Verify host recovery."})
                self.apply({"type": "resumed", "blockerId": "host", "resolution": "Host prerequisite recovered.", "reconciliation": "Recovery changes no implementation or qualification facts."})
                self.assertEqual(self.state["status"], expected)
                self.assertEqual({key: self.state[key] for key in preserved}, preserved)
                self.assertIsNone(self.state["currentIncrementId"])

    def test_resumed_preserves_active_stage_and_stale_approval_precedence(self) -> None:
        self.define_and_approve([increment_definition("increment-1", 1)])
        approved = copy.deepcopy(self.state)
        for stage in ["researching", "planning", "implementing", "verifying", "stale-approval"]:
            with self.subTest(stage=stage):
                self.state = copy.deepcopy(approved)
                self.apply({"type": "increment-started", "incrementId": "increment-1"})
                if stage != "researching":
                    self.apply({"type": "increment-research-recorded", "summary": "Research complete.", "sources": [{"title": "Current source"}], "risks": ["Preserve actual progress."]})
                if stage in ["implementing", "verifying"]:
                    self.apply({"type": "increment-plan-recorded", "plan": implementation_plan(1)})
                if stage == "verifying":
                    self.apply({"type": "chunk-recorded", "chunkId": "chunk-1", "summary": "Implemented outcome.", "areas": ["Scoped area"], "tests": ["Focused check passed."], "documentation": ["Guidance updated."], "feedbackAddressed": []})
                if stage == "stale-approval":
                    self.apply({"type": "feedback-recorded", "id": "new-choice", "summary": "User requests a changed high-level choice.", "category": "decision", "impact": "high-level", "targetIncrementId": "increment-1", "disposition": "needs-decision", "nextAction": "Obtain actual approval."})
                self.apply({"type": "blocker-recorded", "id": "host", "kind": "environment", "summary": "A required host is unavailable.", "requiredAction": "Verify recovery."})
                self.apply({"type": "resumed", "blockerId": "host", "resolution": "Host recovered.", "reconciliation": "Resume only the prior progress; no qualification change."})
                self.assertEqual(self.state["status"], "approval-required" if stage == "stale-approval" else "executing")
                self.assertEqual(self.state["increments"][0]["status"], "paused-for-approval" if stage == "stale-approval" else stage)

    def test_revision_preserves_completed_work_and_replaces_pending_suffix(self) -> None:
        self.define_and_approve(
            [
                increment_definition("increment-1", 1),
                increment_definition(
                    "increment-2", 2, depends_on=["increment-1"]
                ),
                increment_definition(
                    "increment-3", 3, depends_on=["increment-2"]
                ),
            ]
        )
        self.execute_increment(1)
        preserved = copy.deepcopy(self.state["increments"][0])
        preserved_chunks = copy.deepcopy(self.state["chunks"])
        preserved_evidence = copy.deepcopy(self.state["evidence"])
        self.apply(
            {
                "type": "feedback-recorded",
                "id": "cohesion-feedback",
                "summary": "Pending increments are too fine-grained.",
                "category": "scope",
                "impact": "scope-change",
                "targetIncrementId": "increment-2",
                "disposition": "accepted",
                "nextAction": "Replace the pending suffix with one cohesive increment.",
            }
        )
        replacement = increment_definition(
            "cohesive-increment", 2, depends_on=["increment-1"]
        )
        self.apply(
            {
                "type": "roadmap-revised",
                "reason": "Merge coupled work to reduce fixed roadmap overhead.",
                "increments": [replacement],
            }
        )

        self.assertEqual(
            [item["id"] for item in self.state["increments"]],
            ["increment-1", "cohesive-increment"],
        )
        self.assertEqual(self.state["increments"][0], preserved)
        self.assertEqual(self.state["chunks"], preserved_chunks)
        self.assertEqual(self.state["evidence"], preserved_evidence)
        self.assertIsNone(self.state["roadmapApproval"])
        self.assertEqual(self.state["status"], "roadmap-review")

        self.apply(
            {
                "type": "roadmap-approved",
                "note": "The user approved the consolidated pending roadmap.",
            }
        )
        self.assertEqual(self.state["status"], "ready")
        self.apply(
            {
                "type": "increment-started",
                "incrementId": "cohesive-increment",
            }
        )
        self.assertEqual(
            self.state["currentIncrementId"], "cohesive-increment"
        )

    def test_revision_rejects_an_active_increment_and_invalid_dependencies(self) -> None:
        self.define_and_approve(
            [
                increment_definition("increment-1", 1),
                increment_definition(
                    "increment-2", 2, depends_on=["increment-1"]
                ),
            ]
        )
        self.apply(
            {"type": "increment-started", "incrementId": "increment-1"}
        )
        with self.assertRaisesRegex(roadmap.RoadmapError, "active increment"):
            self.apply(
                {
                    "type": "roadmap-revised",
                    "reason": "This must wait.",
                    "increments": [increment_definition("replacement", 1)],
                }
            )

        self.state["currentIncrementId"] = None
        self.state["increments"][0]["status"] = "completed"
        with self.assertRaisesRegex(roadmap.RoadmapError, "unknown increment"):
            self.apply(
                {
                    "type": "roadmap-revised",
                    "reason": "Reject a dependency on removed pending work.",
                    "increments": [
                        increment_definition(
                            "replacement", 2, depends_on=["increment-2"]
                        )
                    ],
                }
            )

    def test_skill_requires_economically_cohesive_increments(self) -> None:
        skill_root = MODULE_PATH.parent.parent
        skill_text = (skill_root / "SKILL.md").read_text(encoding="utf-8")
        workflow_text = (skill_root / "references" / "workflow.md").read_text(
            encoding="utf-8"
        )
        diagnostics_text = (
            skill_root.parents[1]
            / "docs"
            / "diagnostics"
            / "implementation-roadmap-skill.md"
        ).read_text(encoding="utf-8")
        gitignore_text = (skill_root.parents[1] / ".gitignore").read_text(
            encoding="utf-8"
        )

        self.assertIn("Size increments economically", skill_text)
        self.assertIn("fewest increments", skill_text)
        self.assertIn("shared UI primitive", skill_text)
        self.assertRegex(skill_text, r"combined\s+standard and end-to-end coverage")
        self.assertIn("AI-related", skill_text)
        self.assertIn("while roadmap increments remain", skill_text)
        self.assertIn("adjacent-increment cohesion audit", skill_text)
        self.assertIn("Define economically cohesive increments", workflow_text)
        self.assertIn("roadmap-revised", workflow_text)
        self.assertIn("docs/tmp", skill_text)
        self.assertIn("summary", skill_text.lower())
        self.assertIn("final-approval-recorded", workflow_text)
        self.assertIn("increment-relevant completion tests", workflow_text)
        self.assertRegex(
            workflow_text, r"combined standard and end-to-end coverage"
        )
        self.assertIn("AI-related", workflow_text)
        self.assertIn("temporary", diagnostics_text.lower())
        self.assertIn("docs/tmp/", gitignore_text)

    def test_skill_defaults_to_continuous_approved_execution(self) -> None:
        skill_root = MODULE_PATH.parent.parent
        repository_root = skill_root.parents[1]
        sources = {
            "skill": (skill_root / "SKILL.md").read_text(encoding="utf-8"),
            "workflow": (skill_root / "references" / "workflow.md").read_text(
                encoding="utf-8"
            ),
            "installation": (
                skill_root / "references" / "installation.md"
            ).read_text(encoding="utf-8"),
            "agent": (skill_root / "agents" / "openai.yaml").read_text(
                encoding="utf-8"
            ),
            "diagnostics": (
                repository_root
                / "docs"
                / "diagnostics"
                / "implementation-roadmap-skill.md"
            ).read_text(encoding="utf-8"),
            "routing": (
                repository_root / "docs" / "context" / "prompt-routing.md"
            ).read_text(encoding="utf-8"),
            "agents": (repository_root / "AGENTS.md").read_text(encoding="utf-8"),
        }

        self.assertIn("continuous end-to-end execution", sources["skill"])
        self.assertRegex(
            sources["workflow"],
            r"Routine\s+increment boundaries are not approval gates",
        )
        self.assertIn("through every increment", sources["agent"])
        self.assertIn("continuous execution", sources["installation"])
        self.assertIn("continuous execution", sources["diagnostics"])
        self.assertIn("do not insert routine per-increment approval pauses", sources["routing"])
        self.assertRegex(
            sources["agents"],
            r"without routine\s+per-increment approval pauses",
        )

        for source in sources.values():
            self.assertRegex(source, r"(?i)(?:scope|authority)")
            self.assertRegex(
                source,
                r"(?i)final(?:[-\s]+overall)?[-\s]+approval",
            )

    def test_skill_requires_security_by_design_evidence(self) -> None:
        skill_root = MODULE_PATH.parent.parent
        repository_root = skill_root.parents[1]
        sources = {
            "skill": (skill_root / "SKILL.md").read_text(encoding="utf-8"),
            "workflow": (skill_root / "references" / "workflow.md").read_text(
                encoding="utf-8"
            ),
            "events": (skill_root / "references" / "events.md").read_text(
                encoding="utf-8"
            ),
            "installation": (
                skill_root / "references" / "installation.md"
            ).read_text(encoding="utf-8"),
            "diagnostics": (
                repository_root
                / "docs"
                / "diagnostics"
                / "implementation-roadmap-skill.md"
            ).read_text(encoding="utf-8"),
        }

        self.assertIn(
            "docs/standards/security-by-design-standards.md", sources["skill"]
        )
        self.assertIn("mandatory security impact screen", sources["skill"])
        self.assertIn("not-security-relevant", sources["skill"])
        self.assertIn("security-relevant", sources["skill"])
        self.assertIn("security-impact-reviewed", sources["skill"])
        self.assertIn("Security cannot be excluded as a whole", sources["workflow"])
        self.assertIn("Positive-only testing is insufficient", sources["workflow"])
        self.assertIn("Security evidence convention", sources["events"])
        self.assertIn("synthetic fixtures", sources["events"])
        self.assertIn("security impact disposition", sources["installation"])
        self.assertIn("per-increment security", sources["diagnostics"])

        for source in sources.values():
            self.assertRegex(source, r"(?i)secret")
            self.assertRegex(
                source,
                r"(?i)(?:protected\s+prompts?|private\s+payloads?|sensitive\s+payloads?)",
            )

    def test_reviewed_chunk_checkpoint_guidance_preserves_authority_and_pending_scope(self) -> None:
        skill_root = MODULE_PATH.parent.parent
        repository_root = skill_root.parents[1]
        workflow = (skill_root / "references" / "workflow.md").read_text(encoding="utf-8")
        installation = (skill_root / "references" / "installation.md").read_text(encoding="utf-8")
        standard = (repository_root / "docs/standards/ai-agent-development-standards.md").read_text(encoding="utf-8")
        for text in [workflow, installation, standard]:
            # Keep the portable safety/authority contract, not just a section title.
            self.assertRegex(text, r"(?i)pending parent")
            self.assertRegex(text, r"(?i)unrelated.*(?:index|staged)")
            self.assertRegex(text, r"(?i)release[^.]+(?:source\s+claim|claim)")
            self.assertRegex(text, r"(?i)fresh (?:source )?baseline")
            for authority in [r"push", r"history rewrite", r"main\s+advancement"]:
                self.assertRegex(text, rf"(?i){authority}")
        self.assertIn("parent work need not be complete", workflow)
        self.assertIn("status alone proves neither", workflow)
        self.assertIn("does not execute Git", workflow)
        for relative in ["AGENTS.md", "docs/README.md", "docs/context/prompt-routing.md",
                         "docs/diagnostics/implementation-roadmap-skill.md"]:
            self.assertIn("checkpoint", (repository_root / relative).read_text(encoding="utf-8"))
        scenarios = json.loads((repository_root / "dev-tools/agent-evals/scenarios.json").read_text(encoding="utf-8"))
        scenario = next(row for row in scenarios["scenarios"] if row["id"] == "reviewed-roadmap-chunk-checkpoint")
        self.assertEqual(scenario["decisionExpectation"], "proceed")
        self.assertIn("skills/manage-implementation-roadmaps/references/workflow.md", scenario["requiredSources"])
        self.assertIn("pending", scenario["task"])
        self.assertIn("unrelated", scenario["task"])

    def test_completed_chunk_does_not_complete_pending_technical_parent(self) -> None:
        self.define_and_approve([increment_definition("increment-1", 1,
                                                     qualification="controlled-environment", allow_pending=True)])
        self.execute_increment(1, "pending")
        increment = self.state["increments"][0]
        self.assertEqual(increment["completedChunks"], ["chunk-1"])
        self.assertEqual(increment["status"], "implemented-pending-qualification")
        evidence = roadmap.latest_criterion_evidence(self.state, "increment-1", "criterion-1")
        self.assertEqual(evidence["outcome"], "pending")
        before = copy.deepcopy(self.state)
        with self.assertRaises(roadmap.RoadmapError):
            self.apply({"type": "roadmap-completed", "summary": "A checkpoint cannot qualify hardware."})
        self.assertEqual(self.state, before)

    def test_plan_separates_focused_and_increment_completion_tests(self) -> None:
        self.define_and_approve([increment_definition("increment-1", 1)])
        self.apply({"type": "increment-started", "incrementId": "increment-1"})
        self.apply(
            {
                "type": "increment-research-recorded",
                "summary": "Increment research is complete.",
                "sources": [{"title": "Current implementation"}],
                "risks": ["Verification timing must remain economical."],
            }
        )

        legacy_plan = implementation_plan(1)
        legacy_plan["tests"] = legacy_plan.pop("focusedTests")
        legacy_plan.pop("completionTests")
        with self.assertRaisesRegex(roadmap.RoadmapError, "unsupported field"):
            self.apply({"type": "increment-plan-recorded", "plan": legacy_plan})

        missing_completion = implementation_plan(1)
        missing_completion.pop("completionTests")
        with self.assertRaisesRegex(roadmap.RoadmapError, "completionTests"):
            self.apply(
                {"type": "increment-plan-recorded", "plan": missing_completion}
            )

        self.apply(
            {"type": "increment-plan-recorded", "plan": implementation_plan(1)}
        )
        self.assertEqual(
            self.state["increments"][0]["plan"]["focusedTests"],
            ["Focused test 1"],
        )
        self.assertEqual(
            self.state["increments"][0]["plan"]["completionTests"],
            ["Increment-relevant checks after every chunk is implemented"],
        )

    def test_decision_requires_two_to_three_options_and_one_recommendation(self) -> None:
        self.apply(
            {
                "type": "discovery-recorded",
                "summary": "A high-level choice is required.",
                "sources": [],
                "constraints": [],
                "securityImpact": security_impact(),
                "decisionRequired": True,
            }
        )
        with self.assertRaisesRegex(roadmap.RoadmapError, "at least 2"):
            self.apply(
                {
                    "type": "decision-proposed",
                    "decision": {
                        "id": "boundary",
                        "title": "Boundary",
                        "question": "Which boundary?",
                        "context": "The boundary changes ownership.",
                        "options": [
                            {
                                "id": "one",
                                "label": "One",
                                "summary": "Only option.",
                                "tradeoffs": [],
                                "consequences": [],
                                "recommended": True,
                            }
                        ],
                    },
                }
            )
        with self.assertRaisesRegex(roadmap.RoadmapError, "Exactly one"):
            self.apply(
                {
                    "type": "decision-proposed",
                    "decision": {
                        "id": "boundary",
                        "title": "Boundary",
                        "question": "Which boundary?",
                        "context": "The boundary changes ownership.",
                        "options": [
                            {
                                "id": "one",
                                "label": "One",
                                "summary": "First option.",
                                "tradeoffs": [],
                                "consequences": [],
                                "recommended": True,
                            },
                            {
                                "id": "two",
                                "label": "Two",
                                "summary": "Second option.",
                                "tradeoffs": [],
                                "consequences": [],
                                "recommended": True,
                            },
                        ],
                    },
                }
            )

    def test_high_level_feedback_invalidates_then_renews_approval(self) -> None:
        self.define_and_approve([increment_definition("increment-1", 1)])
        self.apply(
            {"type": "increment-started", "incrementId": "increment-1"}
        )
        self.apply(
            {
                "type": "increment-research-recorded",
                "summary": "Increment research is complete.",
                "sources": [{"title": "Current implementation"}],
                "risks": ["Approval continuity must preserve the plan."],
            }
        )
        self.apply(
            {
                "type": "increment-plan-recorded",
                "plan": implementation_plan(1),
            }
        )
        original_plan = copy.deepcopy(self.state["increments"][0]["plan"])
        self.apply(
            {
                "type": "feedback-recorded",
                "id": "feedback-1",
                "summary": "The user requested a renewed high-level choice.",
                "category": "decision",
                "impact": "high-level",
                "targetIncrementId": "increment-1",
                "disposition": "needs-decision",
                "nextAction": "Present options and obtain approval.",
            }
        )
        self.assertEqual(self.state["status"], "approval-required")
        self.assertIsNone(self.state["roadmapApproval"])
        self.assertEqual(
            self.state["increments"][0]["status"], "paused-for-approval"
        )
        with self.assertRaisesRegex(roadmap.RoadmapError, "Renew roadmap approval"):
            self.apply(
                {
                    "type": "increment-completed",
                    "summary": "This must not bypass stale approval.",
                }
            )
        self.apply(
            {
                "type": "decision-proposed",
                "decision": {
                    "id": "recovery-choice",
                    "title": "Recovery choice",
                    "question": "How should the approved intent continue?",
                    "context": "The user requested a high-level checkpoint.",
                    "options": [
                        {
                            "id": "continue",
                            "label": "Continue",
                            "summary": "Continue within the existing increment.",
                            "tradeoffs": ["No roadmap shape change"],
                            "consequences": ["Resume research"],
                            "recommended": True,
                        },
                        {
                            "id": "successor",
                            "label": "Successor roadmap",
                            "summary": "Stop and define a successor roadmap.",
                            "tradeoffs": ["More planning"],
                            "consequences": ["Current roadmap remains paused"],
                            "recommended": False,
                        },
                    ],
                },
            }
        )
        self.apply(
            {
                "type": "decision-approved",
                "decisionId": "recovery-choice",
                "optionId": "continue",
            }
        )
        self.apply({"type": "roadmap-approved"})
        self.assertEqual(self.state["status"], "executing")
        self.assertEqual(self.state["increments"][0]["status"], "implementing")
        self.assertEqual(self.state["increments"][0]["plan"], original_plan)

    def test_pending_controlled_evidence_promotes_after_later_pass(self) -> None:
        self.define_and_approve(
            [
                increment_definition(
                    "increment-1",
                    1,
                    qualification="controlled-environment",
                    allow_pending=True,
                )
            ]
        )
        self.execute_increment(1, outcome="pending")
        self.assertEqual(
            self.state["increments"][0]["status"],
            "implemented-pending-qualification",
        )
        self.assertEqual(
            self.state["status"],
            "implementation-complete-qualification-pending",
        )
        self.apply(
            {
                "type": "evidence-recorded",
                "incrementId": "increment-1",
                "criterionId": "criterion-1",
                "kind": "external",
                "outcome": "passed",
                "summary": "Controlled-environment qualification passed.",
            }
        )
        self.assertEqual(self.state["increments"][0]["status"], "completed")
        self.assertEqual(self.state["status"], "roadmap-ready-to-close")

    def test_paths_cannot_escape_repository(self) -> None:
        with self.assertRaisesRegex(roadmap.RoadmapError, "inside the repository"):
            roadmap.initial_state(
                self.repo,
                {
                    "name": "Unsafe",
                    "slug": "unsafe",
                    "objective": "Attempt to escape.",
                    "statePath": "../outside.json",
                },
            )
        with self.assertRaisesRegex(roadmap.RoadmapError, "docs/tmp"):
            roadmap.initial_state(
                self.repo,
                {
                    "name": "Tracked report",
                    "slug": "tracked-report",
                    "objective": "Reject a tracked implementation report.",
                    "reportPath": "docs/tracked-implementation-report.md",
                },
            )

    def test_report_defaults_to_temporary_docs_directory(self) -> None:
        self.assertEqual(
            self.state["paths"]["report"],
            "docs/tmp/portable-roadmap-implementation-report.md",
        )

    def test_unknown_fields_and_event_types_are_rejected(self) -> None:
        with self.assertRaisesRegex(roadmap.RoadmapError, "unsupported field"):
            self.apply(
                {
                    "type": "discovery-recorded",
                    "summary": "Discovery.",
                    "sources": [],
                    "constraints": [],
                    "decisionRequired": False,
                    "command": "do-not-run",
                }
            )
        with self.assertRaisesRegex(roadmap.RoadmapError, "Unsupported event type"):
            self.apply({"type": "execute-command", "command": "do-not-run"})

    def test_security_impact_and_increment_security_criterion_are_required(self) -> None:
        with self.assertRaisesRegex(roadmap.RoadmapError, "securityImpact"):
            self.apply(
                {
                    "type": "discovery-recorded",
                    "summary": "Security disposition is missing.",
                    "sources": [],
                    "constraints": [],
                    "decisionRequired": False,
                }
            )

        incomplete_relevant_impact = security_impact()
        incomplete_relevant_impact["disposition"] = "security-relevant"
        with self.assertRaisesRegex(roadmap.RoadmapError, "securityImpact.assets"):
            self.apply(
                {
                    "type": "discovery-recorded",
                    "summary": "Relevant security detail is incomplete.",
                    "sources": [],
                    "constraints": [],
                    "securityImpact": incomplete_relevant_impact,
                    "decisionRequired": False,
                }
            )

        self.apply(
            {
                "type": "discovery-recorded",
                "summary": "The security impact is dispositioned.",
                "sources": [],
                "constraints": [],
                "securityImpact": security_impact(),
                "decisionRequired": False,
            }
        )
        missing_security = increment_definition("increment-1", 1)
        missing_security["acceptanceCriteria"] = [
            criterion
            for criterion in missing_security["acceptanceCriteria"]
            if criterion["id"] != "security-impact-reviewed"
        ]
        with self.assertRaisesRegex(roadmap.RoadmapError, "security-impact-reviewed"):
            self.apply(
                {"type": "roadmap-defined", "increments": [missing_security]}
            )

        specific_security = increment_definition("increment-1", 1)
        specific_security["acceptanceCriteria"][-1]["id"] = (
            "security-authorization-reviewed"
        )
        self.apply({"type": "roadmap-defined", "increments": [specific_security]})
        self.assertEqual(self.state["status"], "roadmap-review")

        tampered = copy.deepcopy(self.state)
        tampered["discovery"]["securityImpact"]["disposition"] = "ignored"
        with self.assertRaisesRegex(roadmap.RoadmapError, "disposition"):
            roadmap.validate_state_shape(self.repo, tampered)

    def test_sources_and_nested_arrays_are_strictly_validated(self) -> None:
        with self.assertRaisesRegex(roadmap.RoadmapError, "array"):
            self.apply(
                {
                    "type": "discovery-recorded",
                    "summary": "Invalid nested array.",
                    "sources": "not-an-array",
                    "constraints": [],
                    "decisionRequired": False,
                }
            )

    def test_repository_sources_render_relative_to_the_roadmap(self) -> None:
        self.apply(
            {
                "type": "discovery-recorded",
                "summary": "Repository source links are recorded from the root.",
                "sources": [
                    {"title": "Agent guide", "url": "AGENTS.md"},
                    {
                        "title": "Architecture",
                        "url": "docs/architecture/README.md",
                    },
                ],
                "constraints": [],
                "securityImpact": security_impact(),
                "decisionRequired": False,
            }
        )

        rendered = roadmap.render_roadmap(self.state)
        self.assertIn("(<../AGENTS.md>)", rendered)
        self.assertIn("(<architecture/README.md>)", rendered)
        with self.assertRaisesRegex(roadmap.RoadmapError, "unsupported link scheme"):
            self.apply(
                {
                    "type": "discovery-recorded",
                    "summary": "Invalid source scheme.",
                    "sources": [
                        {
                            "title": "Unsafe local source",
                            "url": "file:///private/source",
                        }
                    ],
                    "constraints": [],
                    "decisionRequired": False,
                }
            )

    def test_evidence_command_is_never_executed(self) -> None:
        self.define_and_approve([increment_definition("increment-1", 1)])
        self.apply(
            {"type": "increment-started", "incrementId": "increment-1"}
        )
        marker = self.repo / "must-not-exist"
        self.apply(
            {
                "type": "evidence-recorded",
                "incrementId": "increment-1",
                "criterionId": "criterion-1",
                "kind": "manual",
                "outcome": "passed",
                "summary": "A descriptive evidence record.",
                "command": f"create {marker}",
            }
        )
        self.assertFalse(marker.exists())

    def test_validate_detects_drift_and_render_repairs_it(self) -> None:
        roadmap.write_project_files(self.repo, self.state)
        report_path = self.repo / self.state["paths"]["report"]
        report_path.write_text("manual edit\n", encoding="utf-8")
        with self.assertRaisesRegex(roadmap.RoadmapError, "drift"):
            roadmap.ensure_documents_match(self.repo, self.state)

        roadmap.command_render(
            argparse.Namespace(
                repo=str(self.repo),
                state=self.state["paths"]["state"],
                dry_run=False,
            )
        )
        roadmap.ensure_documents_match(self.repo, self.state)

    def test_relocates_a_legacy_generated_report_without_losing_state(self) -> None:
        legacy_report = "docs/legacy-implementation-report.md"
        self.state["paths"]["report"] = legacy_report
        roadmap.validate_state_shape(self.repo, self.state)
        roadmap.write_project_files(self.repo, self.state)
        history_before = copy.deepcopy(self.state["history"])

        updated = roadmap.apply_event(
            self.state,
            {
                "type": "report-relocated",
                "reportPath": "docs/tmp/portable-roadmap-implementation-report.md",
                "reason": "Keep the progress report temporary and ignored.",
            },
        )
        roadmap.validate_state_shape(self.repo, updated)
        roadmap.write_project_files(
            self.repo,
            updated,
            previous_report_path=legacy_report,
        )

        self.assertFalse((self.repo / legacy_report).exists())
        self.assertTrue((self.repo / updated["paths"]["report"]).exists())
        self.assertEqual(updated["history"][:-1], history_before)
        self.assertEqual(updated["history"][-1]["type"], "report-relocated")
        roadmap.ensure_documents_match(self.repo, updated)

    def test_final_approval_removes_only_the_generated_temporary_report(self) -> None:
        with self.assertRaisesRegex(roadmap.RoadmapError, "Complete the roadmap"):
            self.apply(
                {
                    "type": "final-approval-recorded",
                    "note": "The user approved the overall work.",
                }
            )

        self.define_and_approve([increment_definition("increment-1", 1)])
        self.execute_increment(1)
        self.apply(
            {
                "type": "roadmap-completed",
                "summary": "The one-increment roadmap is complete.",
            }
        )
        roadmap.write_project_files(self.repo, self.state)
        report_path = self.repo / self.state["paths"]["report"]
        roadmap_path = self.repo / self.state["paths"]["roadmap"]
        self.assertTrue(report_path.exists())

        self.apply(
            {
                "type": "final-approval-recorded",
                "note": "The user explicitly approved the completed overall work.",
            }
        )
        roadmap.write_project_files(self.repo, self.state)

        self.assertEqual(self.state["status"], "completed")
        self.assertTrue(self.state["finalApproval"])
        self.assertIn("Final approval recorded", roadmap.next_checkpoint(self.state))
        self.assertFalse(report_path.exists())
        self.assertTrue(roadmap_path.exists())
        roadmap.ensure_documents_match(self.repo, self.state)
        with self.assertRaisesRegex(roadmap.RoadmapError, "immutable"):
            self.apply(
                {
                    "type": "feedback-recorded",
                    "id": "late-feedback",
                    "summary": "New work belongs in a successor roadmap.",
                    "category": "scope",
                    "impact": "scope-change",
                    "targetIncrementId": "increment-1",
                    "disposition": "needs-decision",
                    "nextAction": "Create a successor roadmap.",
                }
            )

    def finally_approved_fixture(self) -> dict:
        self.define_and_approve([increment_definition("increment-1", 1)])
        self.execute_increment(1)
        self.apply({"type": "roadmap-completed", "summary": "Actual completed fixture."})
        self.apply({"type": "final-approval-recorded", "note": "Explicit final approval."})
        return copy.deepcopy(self.state)

    def test_legacy_completion_normalization_preserves_all_terminal_facts(self):
        legacy = self.finally_approved_fixture()
        legacy["status"] = "final-approved"
        roadmap.validate_state_shape(self.repo, legacy)
        updated = roadmap.apply_event(legacy, {"type": "completion-status-normalized",
            "authorityRef": "user-single-completion-status", "summary": "Normalize only current completion status."})
        roadmap.validate_state_shape(self.repo, updated)
        self.assertEqual(updated["status"], "completed")
        self.assertEqual(updated["history"][:-1], legacy["history"])
        self.assertEqual(updated["history"][-1]["type"], "completion-status-normalized")
        self.assertEqual(roadmap.roadmap_fingerprint(updated), roadmap.roadmap_fingerprint(legacy))
        for key in legacy.keys() - {"status", "updatedAt", "history"}:
            self.assertEqual(updated[key], legacy[key], key)
        self.assertIn("Final approval recorded", roadmap.next_checkpoint(updated))
        self.assertIn("Final approval recorded", roadmap.next_checkpoint(legacy))
        for event in [{"type": "completion-status-normalized", "authorityRef": "again", "summary": "Again"},
                      {"type": "final-approval-recorded", "note": "Again"},
                      {"type": "report-relocated", "reportPath": "docs/tmp/other.md", "reason": "Again"}]:
            with self.subTest(event=event), self.assertRaisesRegex(roadmap.RoadmapError, "immutable"):
                roadmap.apply_event(updated, event)

    def test_normalization_refuses_incomplete_unapproved_malformed_and_override_inputs(self):
        legacy = self.finally_approved_fixture()
        legacy["status"] = "final-approved"
        event = {"type": "completion-status-normalized", "authorityRef": "user-normalization", "summary": "Normalize"}
        cases = []
        for patch in [{"completion": None}, {"completion": {}}, {"completion": {"summary": "Done"}},
                      {"completion": {"summary": 7, "completedAt": "old"}}, {"finalApproval": None},
                      {"completion": {"summary": "Done", "completedAt": "not-a-date"}},
                      {"completion": {"summary": "Done", "completedAt": "2026-10-22T01:00:00"}},
                      {"finalApproval": {}}, {"finalApproval": {"note": "", "approvedAt": "old"}},
                      {"finalApproval": {"note": "Approved", "approvedAt": "not-a-date"}},
                      {"currentIncrementId": "increment-1"}, {"increments": []},
                      {"blockers": [{"status": "open"}]}, {"status": "completed"}]:
            cases.append({**copy.deepcopy(legacy), **patch})
        incomplete = copy.deepcopy(legacy); incomplete["increments"][0]["status"] = "implemented-pending-qualification"; cases.append(incomplete)
        for state in cases:
            original = copy.deepcopy(state)
            with self.subTest(state=state.get("status")), self.assertRaises(roadmap.RoadmapError):
                roadmap.apply_event(state, event)
            self.assertEqual(state, original)
        for malformed in [{"type": event["type"], "summary": "No authority"}, {**event, "status": "completed"}, {**event, "finalApproval": {}}]:
            with self.subTest(event=malformed), self.assertRaises(roadmap.RoadmapError):
                roadmap.apply_event(legacy, malformed)

    def test_final_approval_validation_requires_real_completed_facts_in_both_statuses(self):
        approved = self.finally_approved_fixture()
        for status in ["completed", "final-approved"]:
            valid = {**copy.deepcopy(approved), "status": status}
            roadmap.validate_state_shape(self.repo, valid)
            for patch in [{"completion": None}, {"completion": {}}, {"currentIncrementId": "increment-1"}, {"status": "executing"}]:
                with self.subTest(status=status, patch=patch), self.assertRaises(roadmap.RoadmapError):
                    roadmap.validate_state_shape(self.repo, {**copy.deepcopy(valid), **patch})
        with self.assertRaises(roadmap.RoadmapError):
            roadmap.validate_state_shape(self.repo, {**approved, "status": "final-approved", "finalApproval": None})

    def test_cli_normalization_serializes_and_never_recreates_final_report(self):
        legacy = self.finally_approved_fixture(); legacy["status"] = "final-approved"
        roadmap.write_project_files(self.repo, legacy)
        event = self.repo / "normalize.json"
        event.write_text(json.dumps({"type": "completion-status-normalized", "authorityRef": "user-normalization", "summary": "One completion status"}), encoding="utf-8")
        args = argparse.Namespace(repo=str(self.repo), state=legacy["paths"]["state"], event_file=str(event), dry_run=True)
        self.assertEqual(roadmap.command_apply(args)["status"], "completed")
        self.assertEqual(json.loads((self.repo / args.state).read_text())["status"], "final-approved")
        args.dry_run = False
        result = roadmap.command_apply(args)
        self.assertEqual(result["status"], "completed")
        self.assertFalse(result["reportAvailable"])
        saved = json.loads((self.repo / args.state).read_text())
        self.assertEqual(saved["history"][:-1], legacy["history"])
        roadmap.command_render(argparse.Namespace(repo=str(self.repo), state=args.state, dry_run=False))
        roadmap.ensure_documents_match(self.repo, saved)
        self.assertFalse((self.repo / legacy["paths"]["report"]).exists())
        with self.assertRaisesRegex(roadmap.RoadmapError, "immutable"):
            roadmap.command_apply(args)

    def test_state_is_written_before_generated_documents(self) -> None:
        writes: list[Path] = []
        original_atomic_write = roadmap.atomic_write
        try:
            roadmap.atomic_write = lambda path, content: writes.append(path)
            roadmap.write_project_files(self.repo, self.state)
        finally:
            roadmap.atomic_write = original_atomic_write
        self.assertEqual(
            writes[0],
            self.repo / self.state["paths"]["state"],
        )
        self.assertEqual(len(writes), 3)

    def test_interrupted_cli_publication_recovers_without_lost_event(self) -> None:
        roadmap.write_project_files(self.repo, self.state)
        event = self.repo / "event.json"
        event.write_text(json.dumps({"type": "discovery-recorded", "summary": "Publication recovery fixture", "sources": [], "constraints": [], "securityImpact": security_impact(), "decisionRequired": False}))
        args = argparse.Namespace(repo=str(self.repo), state=self.state["paths"]["state"], event_file=str(event), dry_run=False)
        original = roadmap.atomic_write
        def interrupted(path, content):
            if path == self.repo / self.state["paths"]["roadmap"]:
                raise OSError("injected projection failure")
            original(path, content)
        try:
            roadmap.atomic_write = interrupted
            with self.assertRaises(OSError):
                roadmap.command_apply(args)
        finally:
            roadmap.atomic_write = original
        roadmap.command_render(args)
        _, recovered = roadmap.load_state(self.repo, args.state)
        self.assertEqual(recovered["discovery"]["summary"], "Publication recovery fixture")
        roadmap.ensure_documents_match(self.repo, recovered)
        self.assertEqual(len(recovered["history"]), 1)

    def test_new_repository_policy_cannot_close_with_declarations_alone(self) -> None:
        helper = self.repo / "dev-tools/helpers/development_control_plane.py"
        helper.parent.mkdir(parents=True)
        helper.write_text("# fixture marker\n")
        new = roadmap.initial_state(self.repo, {"name": "Governed", "slug": "governed", "objective": "Qualified completion"})
        self.assertEqual(new["evidencePolicy"], "control-plane-v1")
        with self.assertRaises(roadmap.RoadmapError):
            roadmap.require_control_completion(self.repo, new)

    def test_empty_and_completed_roadmaps_reject_completion_events(self) -> None:
        with self.assertRaisesRegex(roadmap.RoadmapError, "at least one increment"):
            self.apply(
                {
                    "type": "roadmap-completed",
                    "summary": "An empty roadmap cannot be complete.",
                }
            )
        self.define_and_approve([increment_definition("increment-1", 1)])
        self.execute_increment(1)
        self.apply(
            {
                "type": "roadmap-completed",
                "summary": "The one increment roadmap is complete.",
            }
        )
        with self.assertRaisesRegex(roadmap.RoadmapError, "immutable"):
            self.apply(
                {
                    "type": "feedback-recorded",
                    "id": "late-feedback",
                    "summary": "New scope belongs in a successor roadmap.",
                    "category": "scope",
                    "impact": "scope-change",
                    "targetIncrementId": "increment-1",
                    "disposition": "needs-decision",
                    "nextAction": "Create a successor roadmap.",
                }
            )

    def test_cli_init_apply_validate_and_status(self) -> None:
        cli_repo = self.repo / "cli-repo"
        cli_repo.mkdir()
        config_path = self.repo / "config.json"
        event_path = self.repo / "event.json"
        config_path.write_text(
            json.dumps(
                {
                    "name": "CLI Roadmap",
                    "slug": "cli-roadmap",
                    "objective": "Exercise the public command-line workflow.",
                }
            ),
            encoding="utf-8",
        )

        def run_cli(*arguments: str) -> dict:
            result = subprocess.run(
                [sys.executable, str(MODULE_PATH), *arguments],
                cwd=self.repo,
                capture_output=True,
                check=False,
                encoding="utf-8",
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            return json.loads(result.stdout)

        initialized = run_cli(
            "init",
            "--repo",
            str(cli_repo),
            "--config",
            str(config_path),
        )
        state_relative = ".implementation-roadmaps/cli-roadmap/state.json"
        self.assertEqual(initialized["status"], "discovery")
        self.assertTrue(Path(initialized["reportPath"]).is_absolute())

        event_path.write_text(
            json.dumps(
                {
                    "type": "discovery-recorded",
                    "summary": "CLI discovery is complete.",
                    "sources": [],
                    "constraints": [],
                    "securityImpact": security_impact(),
                    "decisionRequired": False,
                }
            ),
            encoding="utf-8",
        )
        applied = run_cli(
            "apply",
            "--repo",
            str(cli_repo),
            "--state",
            state_relative,
            "--event-file",
            str(event_path),
        )
        self.assertEqual(applied["status"], "roadmap-drafting")
        validated = run_cli(
            "validate",
            "--repo",
            str(cli_repo),
            "--state",
            state_relative,
        )
        self.assertTrue(validated["valid"])
        status = run_cli(
            "status",
            "--repo",
            str(cli_repo),
            "--state",
            state_relative,
        )
        self.assertIn("Define the increments", status["nextCheckpoint"])


if __name__ == "__main__":
    unittest.main()
