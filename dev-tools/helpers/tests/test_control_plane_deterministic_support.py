"""Single-pass optional support against real disposable Work/Records/Git fixtures."""
from __future__ import annotations

import base64
import copy
import hashlib
import importlib.util
import json
import os
import subprocess
import sys
from pathlib import Path
from unittest.mock import patch

from test_control_plane_delivery import Fixture, HELPERS
from control_plane import deterministic_support as support
from control_plane.common import digest
from control_plane.contracts import ControlError


class SupportTests(Fixture):
    def setUp(self):
        super().setUp()
        self.put(".gitignore", ".local-codex/\ndocs/tmp/\n.implementation-roadmaps/\n")
        self.repository()

    def request(self, **values):
        return {"schema_version": support.REQUEST, "work_id": "fixture-work", **values}

    def packet(self, result):
        return json.loads((self.root / result["path"]).read_bytes())

    def ref(self, result):
        return {k: result[k] for k in ("packet_id", "packet_digest")}

    def call(self, operation, **values):
        return support.run(self.root, operation, self.request(**values))

    def completed(self):
        receipt = self.verify()
        self.review(receipt)
        self.work.complete("fixture-work", "author-run", self.claim)
        return receipt

    def command(self, *args):
        result = subprocess.run(["git", *args], cwd=self.root, capture_output=True, check=True)
        return result.stdout

    def test_prepare_captures_selected_preimage_once_and_packets_are_immutable(self):
        before = digest(self.work.records.load())
        original = (self.root / "docs/result.md").read_bytes()
        with patch.object(support, "git", wraps=support.git) as commands:
            result = self.call("prepare", packet_id="before", paths=["docs/result.md"], include_preimages=True)
        data = self.packet(result)["data"]
        self.assertEqual(base64.b64decode(data["preimages_base64"]["docs/result.md"]), original)
        self.assertEqual(data["owned"]["docs/result.md"]["sha256"], hashlib.sha256(original).hexdigest())
        self.assertEqual(digest(self.work.records.load()), before)
        self.assertTrue(all(call.args[1] not in {"add", "commit", "merge", "reset", "checkout"} for call in commands.call_args_list))
        raw = (self.root / result["path"]).read_bytes()
        with self.assertRaises(ControlError) as error:
            self.call("prepare", packet_id="before")
        self.assertEqual(error.exception.code, "support.exists")
        self.assertEqual((self.root / result["path"]).read_bytes(), raw)

    def test_freeze_then_export_preserves_real_receipt_and_does_not_create_review(self):
        before = self.call("prepare", packet_id="before")
        self.verify()
        frozen = self.call("freeze", packet_id="frozen", before=self.ref(before))
        exported = self.call("export", packet_id="exported", before=self.ref(before))
        data = self.packet(exported)["data"]
        self.assertEqual(data["receipt"], self.work.records.load()["work_items"]["fixture-work"]["receipts"][-1])
        self.assertNotIn("review", data)
        self.assertTrue(data["advisories"])
        self.assertFalse(exported["independent_review_created"])
        self.assertEqual(self.packet(frozen)["data"]["check_plan"], data["receipt"]["plan"])

    def test_missing_description_is_optional_and_missing_identity_is_actionable(self):
        result = support.run(self.root, "prepare", {"schema_version": support.REQUEST})
        self.assertEqual(result["status"], "needs-input")
        self.assertEqual(result["needed"], ["work_id", "packet_id"])
        self.assertEqual(self.call("handoff")["status"], "advisory")
        self.assertFalse(self.call("handoff")["work_executed"])

    def test_escape_unknown_commands_and_wrong_types_refuse_without_writes(self):
        cases = [self.request(packet_id="../escape"), self.request(packet_id="safe", paths=["../outside"]),
                 self.request(packet_id="safe", paths=["AGENTS.md"]), self.request(packet_id="safe", include_preimages="yes"),
                 self.request(packet_id="safe", command="anything")]
        for request in cases:
            with self.subTest(request=request), self.assertRaises(ControlError):
                support.run(self.root, "prepare", request)
        self.assertFalse((self.root / support.DIRECTORY).exists())

    def test_references_require_exact_pins_and_are_never_embedded(self):
        raw = b"synthetic private artifact bytes"
        self.put(".local-codex/evidence.log", raw.decode())
        pin = {"path": ".local-codex/evidence.log", "sha256": hashlib.sha256(raw).hexdigest()}
        result = self.call("prepare", packet_id="refs", references=[pin])
        packet = self.packet(result)
        self.assertNotIn(raw.decode(), json.dumps(packet))
        self.assertEqual(packet["data"]["references"][pin["path"]]["sha256"], pin["sha256"])
        self.put(pin["path"], "changed")
        with self.assertRaises(ControlError):
            self.call("freeze", packet_id="changed", before=self.ref(result))

    def test_reader_bounds_duplicate_json_and_within_call_drift(self):
        reader = support.Files(self.root)
        reader.read("docs/result.md")
        self.put("docs/result.md", "changed-size")
        with self.assertRaises(ControlError):
            reader.read("docs/result.md")
        with self.assertRaises(ControlError), patch.object(support, "MAX_TOTAL", 1):
            support.Files(self.root).read("AGENTS.md")
        with self.assertRaises(ControlError):
            support._json(b'{"schema_version":1,"schema_version":2}')
        self.put(".local-codex/request.json", "{}")
        with self.assertRaises(ControlError):
            support.run_from(self.root, "prepare", "AGENTS.md")

    def test_linked_reference_is_refused(self):
        original = self.put(".local-codex/original.json", "{}")
        linked = self.root / ".local-codex/linked.json"
        os.link(original, linked)
        with self.assertRaises(ControlError) as error:
            support.Files(self.root).read(".local-codex/linked.json")
        self.assertEqual(error.exception.code, "support.file-type")

    def test_symlinked_output_parent_is_refused(self):
        target = self.root / ".local-codex/redirect"
        target.mkdir(parents=True)
        parent = self.root / ".local-codex/control-plane/support"
        try:
            parent.symlink_to(target, target_is_directory=True)
        except OSError:
            self.skipTest("Symlink creation needs OS privilege; hardlink denial runs separately")
        with self.assertRaises(ControlError):
            self.call("prepare", packet_id="linked")
        self.assertFalse(list(target.iterdir()))

    def test_export_rejects_stale_failed_and_missing_receipts(self):
        with self.assertRaises(ControlError):
            self.call("export", packet_id="missing")
        self.verify(content="still incomplete\n")
        with self.assertRaises(ControlError):
            self.call("export", packet_id="failed")
        self.verify()
        self.put("docs/result.md", "completed changed after verification\n")
        with self.assertRaises(ControlError) as error:
            self.call("export", packet_id="stale")
        self.assertEqual(error.exception.code, "support.receipt-stale")

    def test_actual_review_and_completion_transitions_are_proven_without_mutation(self):
        receipt = self.verify()
        pre_review = self.call("transition-before", packet_id="pre-review", transition="review")
        self.review(receipt)
        records = digest(self.work.records.load())
        proof = self.call("transition-after", packet_id="review-proof", before=self.ref(pre_review))
        self.assertEqual(self.packet(proof)["data"]["proof"], "exact-transition-observed")
        self.assertEqual(digest(self.work.records.load()), records)
        pre_complete = self.call("transition-before", packet_id="pre-complete", transition="complete")
        self.work.complete("fixture-work", "author-run", self.claim)
        proof = self.call("transition-after", packet_id="completion-proof", before=self.ref(pre_complete))
        self.assertEqual(self.packet(proof)["data"]["transition"], "complete")
        self.assertFalse(proof["parent_qualified"])

    def test_transition_refuses_foreign_record_delta_and_tampered_packet(self):
        receipt = self.verify()
        before = self.call("transition-before", packet_id="before", transition="review")
        self.review(receipt)
        self.work.records.mutate(lambda s: s["feedback"].update({"unrelated": {}}))
        with self.assertRaises(ControlError):
            self.call("transition-after", packet_id="bad", before=self.ref(before))
        packet_path = self.root / before["path"]
        packet = self.packet(before)
        packet["data"]["revision"] += 1
        packet_path.write_text(json.dumps(packet))
        with self.assertRaises(ControlError):
            self.call("transition-after", packet_id="forged", before=self.ref(before))

    def test_checkpoint_is_data_only_and_validates_staged_bytes(self):
        self.completed()
        head = self.command("rev-parse", "HEAD")
        result = self.call("checkpoint", packet_id="checkpoint")
        self.assertFalse(self.packet(result)["data"]["git_mutations_executed"])
        self.assertEqual(self.command("rev-parse", "HEAD"), head)
        self.assertEqual(self.command("diff", "--cached", "--name-only"), b"")
        self.command("add", "--", "docs/result.md")
        self.call("checkpoint", packet_id="staged")
        self.put("docs/result.md", "completed after staging\n")
        with self.assertRaises(ControlError):
            self.call("checkpoint", packet_id="wrong-staged")

    def test_checkpoint_refuses_live_claim_and_unowned_untracked_file(self):
        receipt = self.verify()
        self.review(receipt)
        with self.assertRaises(ControlError):
            self.call("checkpoint", packet_id="claimed")
        self.work.complete("fixture-work", "author-run", self.claim)
        self.put("docs/foreign.md", "unrelated\n")
        with self.assertRaises(ControlError):
            self.call("checkpoint", packet_id="foreign")

    def test_checkpoint_denies_owned_bytes_changed_after_candidate_capture(self):
        self.completed()
        original = support.Work.context

        def drift(controller, work):
            captured = original(controller, work)
            (controller.root / "docs/result.md").write_text("unverified replacement after candidate capture\n", encoding="utf-8")
            return captured

        with patch.object(support.Work, "context", drift), self.assertRaises(ControlError) as error:
            self.call("checkpoint", packet_id="owned-drift")
        self.assertEqual(error.exception.code, "support.source-drift")
        self.assertFalse((self.root / support._packet_path("owned-drift")).exists())

    def test_checkpoint_counts_new_untracked_owned_path(self):
        self.work.claim("fixture-work", "author-run", self.claim, action="release")
        spec = copy.deepcopy(self.spec)
        spec.update(work_id="new-file-work", write_scope=["docs/result.md", "docs/new.md"])
        claim = self.work.start(spec, "new-author")["claim"]["claim_id"]
        self.put("docs/new.md", "new owned bytes\n")
        self.put("docs/result.md", "completed\n")
        receipt = self.work.verify("new-file-work", "new-author", claim)
        self.work.review({"schema_version": "technical-review-v1", "work_id": "new-file-work", "invocation_id": "actual-reviewer",
                          "assurance": "operator-attested", "disposition": "accepted", "receipt_digest": receipt["receipt_digest"],
                          "reviewed_criteria": ["result"], "findings": [], "closures": []})
        self.work.complete("new-file-work", "new-author", claim)
        request = self.request(work_id="new-file-work", packet_id="new-owned")
        result = support.run(self.root, "checkpoint", request)
        self.assertEqual(self.packet(result)["data"]["untracked_paths"], ["docs/new.md"])

    def test_handoff_reports_failed_receipt_and_open_finding_without_private_prose(self):
        receipt = self.verify()
        self.review(receipt, disposition="changes-requested", findings=[{"id": "real-finding", "criterion_id": "result", "description": "synthetic private review prose", "blocking": True, "kind": "substantive"}])
        result = self.call("handoff")
        self.assertEqual(result["data"]["open_findings"][0]["id"], "real-finding")
        self.assertNotIn("synthetic private review prose", json.dumps(result))
        self.assertNotIn(self.claim, json.dumps(result))
        self.verify(content="failure\n")
        self.assertEqual(self.call("handoff")["data"]["receipt"]["qualification"], "failed")

    def test_cli_family_has_only_fixed_optional_support_actions(self):
        spec = importlib.util.spec_from_file_location("support_cli", HELPERS / "development_control_plane.py")
        cli = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(cli)
        args = cli.parser().parse_args(["support", "handoff", "--from", ".local-codex/request.json"])
        self.assertEqual((args.command, args.operation), ("support", "handoff"))
        request = self.request()
        self.put(".local-codex/request.json", json.dumps(request))
        self.assertEqual(support.run_from(self.root, "handoff", ".local-codex/request.json")["status"], "advisory")

    def test_progress_missing_plan_input_advises_without_state_mutation(self):
        before = digest(self.work.records.load())
        self.assertEqual(self.call("progress", packet_id="progress")["status"], "needs-input")
        self.assertEqual(digest(self.work.records.load()), before)

    def test_progress_uses_canonical_loader_whole_plan_digest_and_pure_engine(self):
        # Use the actual portable engine and its own maintained fixture builders.
        fixture_path = HELPERS.parents[1] / "skills/manage-implementation-roadmaps/tests/test_roadmap.py"
        spec = importlib.util.spec_from_file_location("support_roadmap_fixtures", fixture_path)
        fixtures = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(fixtures)
        engine = fixtures.roadmap
        config = {"name": "Fixture", "slug": "fixture", "objective": "Test tracking", "statePath": ".implementation-roadmaps/fixture/state.json", "roadmapPath": "docs/fixture-implementation-roadmap.md", "reportPath": "docs/tmp/fixture-report.md"}
        state = engine.initial_state(self.root, config)
        for event in [{"type": "discovery-recorded", "summary": "Synthetic source", "sources": [], "constraints": [], "securityImpact": fixtures.security_impact(), "decisionRequired": False},
                      {"type": "roadmap-defined", "increments": [fixtures.increment_definition("slice", 1)]},
                      {"type": "roadmap-approved", "note": "Explicit synthetic fixture approval"},
                      {"type": "increment-started", "incrementId": "slice"},
                      {"type": "increment-research-recorded", "summary": "Synthetic research", "sources": [], "risks": []},
                      {"type": "increment-plan-recorded", "plan": fixtures.implementation_plan(1)}]:
            state = engine.apply_event(state, event)
        self.put(config["statePath"], json.dumps(state))
        current_plan = state["increments"][0]["plan"]
        replacement = {k: copy.deepcopy(v) for k, v in current_plan.items() if k not in {"recordedAt", "fingerprint", "outlineOnly"}}
        replacement["chunks"].append({"id": "new-tracking", "title": "New coherent fixture component", "outcome": "Explicit fixture outcome", "criteriaIds": replacement["chunks"][0]["criteriaIds"]})
        event = {"type": "work-chunks-reconfigured", "incrementId": "slice", "plan": replacement, "authorityRef": "fixture-tracking-authority", "reason": "Synthetic authorized tracking refinement"}
        work = copy.deepcopy(self.work.records.load()["work_items"]["fixture-work"])
        work["spec"]["roadmap"] = {"state_path": config["statePath"], "increment_id": "slice"}
        raw_before = (self.root / config["statePath"]).read_bytes()
        with patch.object(support, "_engine", return_value=engine), patch.object(engine, "load_state", wraps=engine.load_state) as loader:
            result = support._progress(self.request(events=[event]), work, support.Files(self.root))
        self.assertEqual(loader.call_count, 1)
        self.assertEqual(result["events"][0]["expectedPlanDigest"], engine.fingerprint(current_plan))
        self.assertFalse(result["live_state_mutated"])
        self.assertEqual((self.root / config["statePath"]).read_bytes(), raw_before)
        candidate, plan = self.work.context(self.work.records.load()["work_items"]["fixture-work"])
        with patch.object(support, "_engine", return_value=engine), patch.object(engine, "load_state", wraps=engine.load_state) as loader:
            handoff = support._handoff(work, self.work.records.load(), candidate, plan, support.Files(self.root), self.request())
        self.assertEqual(loader.call_count, 1)
        self.assertEqual(handoff["roadmap"]["increment_id"], "slice")
        event["expectedPlanDigest"] = current_plan["fingerprint"]
        with patch.object(support, "_engine", return_value=engine), self.assertRaises(ControlError):
            support._progress(self.request(events=[event]), work, support.Files(self.root))

    def test_fixed_engine_loader_uses_the_real_repository_engine(self):
        engine = support._engine(HELPERS.parents[1])
        self.assertTrue(callable(engine.load_state))
        self.assertTrue(callable(engine.apply_event))
