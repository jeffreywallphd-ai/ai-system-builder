"""Lossless completed history, bounded storage and conflict-safe recovery.

All writes use new synthetic repositories. No live history or model is used.
"""
import copy
import json
import multiprocessing
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from control_plane.common import digest, read_json
from control_plane.contracts import ControlError
from control_plane.records import Records, ARCHIVE_SCHEMA, STORAGE_SCHEMA
from control_plane.storage import atomic_write, canonical_bytes, exclusive_lock
from test_control_plane_delivery import Fixture


def completed(identity, text="retained synthetic evidence"):
    # Deliberately retain a failed historical attempt as well as the final one.
    return {"spec": {"work_id": identity}, "status": "complete", "claim": None,
            "receipts": [{"qualification": "failed", "evidence": text}, {"qualification": "passed", "evidence": text}],
            "reviews": [{"retained": text}], "completion": {"retained": True}, "events": [{"at": "2026-01-01T00:00:00Z", "code": "retained"}]}


def archive_request(records, ids):
    value = records.load()
    return {"schema_version": "completed-work-archive-request-v1", "work_ids": ids,
            "expected_revision": value["revision"], "expected_state_digest": digest(value), "authority_ref": "synthetic-archive-request"}


def archive_race(directory, request, queue):
    try:
        Records(Path(directory)).archive_completed(request)
        queue.put("passed")
    except ControlError:
        queue.put("refused")


class CompletedArchiveTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory(prefix="cp-archive-")
        self.addCleanup(self.folder.cleanup)
        self.root = Path(self.folder.name)
        self.records = Records(self.root)
        self.records.mutate(lambda s: s["work_items"].update({"work-a": completed("work-a"), "work-b": completed("work-b")}))

    def archive(self, ids=None, **kwargs):
        return self.records._archive_completed(archive_request(self.records, ids or ["work-a"]), **kwargs)

    def wire(self):
        return read_json(self.records.path)

    def archive_file(self, identity="work-a"):
        ref = self.wire()["state"]["work_items"][identity]
        return self.records._archive_path(ref["archive_digest"])

    def test_full_logical_objects_and_all_history_survive_a_smaller_physical_index(self):
        before = self.records.load()
        result = self.archive()
        after = self.records.load(); wire = self.wire()
        self.assertEqual(after["work_items"], before["work_items"])
        self.assertEqual(after["revision"], before["revision"] + 1)
        self.assertEqual(wire["schema_version"], STORAGE_SCHEMA)
        self.assertEqual(wire["state"]["work_items"]["work-a"]["schema_version"], ARCHIVE_SCHEMA)
        self.assertEqual(wire["state"]["work_items"]["work-b"], before["work_items"]["work-b"])
        self.assertEqual(self.archive_file().read_bytes(), canonical_bytes(before["work_items"]["work-a"]))
        self.assertEqual(after["state_digest"], digest({k: v for k, v in after.items() if k != "state_digest"}))
        self.assertEqual(read_json(self.records.index)["state_digest"], digest(after))
        self.assertFalse(result["history_removed"])
        self.assertFalse(result["bootstrap_exception"])
        self.assertEqual(after["storage_archive_events"][0]["work_ids"], ["work-a"])

    def test_archived_object_is_immutable_but_other_records_remain_mutable(self):
        self.archive(); blob = self.archive_file().read_bytes()
        self.records.mutate(lambda s: s["work_items"]["work-b"]["events"].append({"code": "new synthetic event"}))
        original = self.records.path.read_bytes()
        with self.assertRaises(ControlError):
            self.records.mutate(lambda s: s["work_items"]["work-a"]["receipts"].clear())
        self.assertEqual(self.records.path.read_bytes(), original)
        self.assertEqual(self.archive_file().read_bytes(), blob)
        self.assertEqual(self.records.load()["work_items"]["work-b"]["events"][-1]["code"], "new synthetic event")

    def test_active_claimed_missing_duplicate_and_unknown_requests_fail_without_publication(self):
        self.records.mutate(lambda s: s["work_items"].update({
            "active-work": {**completed("active-work"), "status": "verifying"},
            "claimed-work": {**completed("claimed-work"), "claim": {"claim_id": "synthetic"}}}))
        request = archive_request(self.records, ["work-a"])
        variants = [{**request, "work_ids": ids} for ids in (["active-work"], ["claimed-work"], ["missing"], ["work-a", "work-a"], [], ["../foreign"])]
        variants += [{**request, "command": "never-executed"}, {**request, "expected_revision": True}, {**request, "expected_state_digest": "0" * 64},
                     {**request, "bootstrap_manifest": "0" * 64}, {**request, "work_ids": [f"work-{i}" for i in range(129)]}]
        before = self.records.path.read_bytes()
        for value in variants:
            with self.subTest(value=value), self.assertRaises(ControlError): self.records.archive_completed(value)
        self.assertEqual(self.records.path.read_bytes(), before)
        self.assertFalse(self.records.journal.exists())
        self.assertFalse((self.records.path.parent / "archives").exists())

    def test_request_requires_the_exact_existing_revision_and_index(self):
        request = archive_request(self.records, ["work-a"])
        self.records.mutate(lambda s: s["feedback"].update({"later": {}}))
        before = self.records.path.read_bytes()
        with self.assertRaises(ControlError): self.records.archive_completed(request)
        index = read_json(self.records.index); index["state_digest"] = "0" * 64
        atomic_write(self.records.index, canonical_bytes(index))
        with self.assertRaises(ControlError): self.archive()
        self.assertEqual(self.records.path.read_bytes(), before)
        self.assertFalse((self.records.path.parent / "archives").exists())

    def test_missing_changed_and_noncanonical_objects_do_not_become_partial_history(self):
        self.archive(); file = self.archive_file(); original = file.read_bytes()
        for payload in (None, b'{"replacement":true}\n', original.rstrip(b"\n"), b"not JSON"):
            if payload is None: file.unlink()
            else: file.write_bytes(payload)
            with self.subTest(payload=payload), self.assertRaises((ControlError, OSError)): self.records.load()
            self.assertFalse(self.records.journal.exists())
        file.write_bytes(original)
        self.assertEqual(self.records.load()["work_items"]["work-a"], completed("work-a"))

    def test_reference_shape_identity_traversal_envelope_and_logical_integrity_are_independent(self):
        self.archive(); original = self.wire()
        mutations = [lambda v: v.update(storage_digest="0" * 64),
                     lambda v: v["state"]["work_items"]["work-a"].update(work_id="work-b"),
                     lambda v: v["state"]["work_items"]["work-a"].update(archive_digest="../foreign"),
                     lambda v: v["state"]["work_items"]["work-a"].update(extra=True),
                     lambda v: v["state"].update(state_digest="0" * 64)]
        for index, mutate in enumerate(mutations):
            value = copy.deepcopy(original); mutate(value)
            if index: value["storage_digest"] = digest({k: v for k, v in value.items() if k != "storage_digest"})
            atomic_write(self.records.path, canonical_bytes(value))
            with self.subTest(index=index), self.assertRaises(ControlError): self.records.load()
        raw = copy.deepcopy(original["state"])
        raw["state_digest"] = digest({k: v for k, v in raw.items() if k != "state_digest"})
        atomic_write(self.records.path, canonical_bytes(raw))
        with self.assertRaises(ControlError): self.records.load()
        atomic_write(self.records.path, canonical_bytes(original))

    def test_archive_count_aggregate_and_audit_limits_are_not_caller_overrides(self):
        self.archive(); before = self.records.path.read_bytes()
        with patch("control_plane.records.MAX_ARCHIVES", 1), self.assertRaises(ControlError): self.archive(["work-b"])
        one = len(canonical_bytes(completed("work-a"))); two = len(canonical_bytes(completed("work-b")))
        with patch("control_plane.records.MAX_JSON", one + two - 1), self.assertRaises(ControlError): self.archive(["work-b"])
        with patch("control_plane.records.MAX_ARCHIVE_EVENTS", 1), self.assertRaises(ControlError): self.archive(["work-b"])
        self.assertEqual(self.records.path.read_bytes(), before)
        self.assertEqual(len(list((self.records.path.parent / "archives").glob("*.json"))), 1)

    def test_full_load_checks_aggregate_archive_input_before_hydration(self):
        self.archive(["work-a", "work-b"])
        total = sum(p.stat().st_size for p in (self.records.path.parent / "archives").glob("*.json"))
        with patch("control_plane.records.MAX_JSON", total - 1), patch.object(self.records, "_read_archive", side_effect=AssertionError("No hydration before aggregate admission")):
            with self.assertRaises(ControlError): self.records.load()

    def test_linked_archive_and_excess_reference_count_fail_before_history_is_returned(self):
        self.archive(); path = self.archive_file(); link = self.root / "owned-test-archive-alias.json"
        os.link(path, link)
        with self.assertRaises(ControlError): self.records.load()
        link.unlink()
        with patch("control_plane.records.MAX_ARCHIVES", 0), patch.object(self.records, "_read_archive", side_effect=AssertionError("No hydration before count admission")):
            with self.assertRaises(ControlError): self.records.load()
        self.assertEqual(self.records.load()["work_items"]["work-a"], completed("work-a"))

    def test_terminal_marker_and_inner_identity_are_checked_in_the_archive_object(self):
        for change in ({"status": "verifying"}, {"claim": {"claim_id": "synthetic"}}, {"spec": {"work_id": "work-b"}}):
            value = {**completed("work-a"), **change}; identity = digest(value)
            atomic_write(self.records._archive_path(identity), canonical_bytes(value))
            reference = {"schema_version": ARCHIVE_SCHEMA, "work_id": "work-a", "archive_digest": identity}
            with self.subTest(change=change), self.assertRaises(ControlError): self.records._read_archive(reference, "work-a")

    def test_archive_audit_shape_and_bounds_are_validated_on_full_load(self):
        self.archive(); original = self.records.load()
        mutations = [lambda s: s.update(storage_archive_events=s["storage_archive_events"] * 65),
                     lambda s: s["storage_archive_events"][0].update(work_ids=["work-a", "work-a"]),
                     lambda s: s["storage_archive_events"][0].update(authority_ref="../private"),
                     lambda s: s["storage_archive_events"][0].update(before_state_digest="bad"),
                     lambda s: s["storage_archive_events"][0].update(extra=True)]
        for mutate in mutations:
            value = copy.deepcopy(original); mutate(value)
            value["state_digest"] = digest({k: v for k, v in value.items() if k != "state_digest"})
            with self.subTest(mutate=mutate), self.assertRaises(ControlError): self.records.validate(value)

    def test_capacity_preflight_occurs_before_archive_or_journal_publication(self):
        before = self.records.path.read_bytes()
        with patch("control_plane.records.state_bytes", side_effect=ControlError("state.capacity", "synthetic fixed capacity")):
            with self.assertRaises(ControlError): self.archive()
        self.assertEqual(self.records.path.read_bytes(), before)
        self.assertFalse(self.records.journal.exists())
        self.assertFalse((self.records.path.parent / "archives").exists())

    def test_interruption_after_archive_publication_retains_unreferenced_bytes(self):
        before = self.records.path.read_bytes()
        with self.assertRaises(OSError): self.archive(fault_after="archives")
        self.assertEqual(self.records.path.read_bytes(), before)
        self.assertFalse(self.records.journal.exists())
        files = list((self.records.path.parent / "archives").glob("*.json")); self.assertEqual(len(files), 1)
        orphan = files[0].read_bytes()
        self.assertFalse(self.records.recover())
        # A separately authorized request can reuse the exact immutable object;
        # interruption never deletes it or manufactures a completed migration.
        self.archive(); self.assertEqual(files[0].read_bytes(), orphan)

    def test_v2_journal_and_state_interruption_recover_idempotently_with_same_inner_digests(self):
        for phase in ("journal", "state"):
            with self.subTest(phase=phase), tempfile.TemporaryDirectory(prefix="cp-archive-recover-") as folder:
                records = Records(Path(folder)); records.mutate(lambda s: s["work_items"].update({"work-a": completed("work-a")}))
                before = records.load()
                with self.assertRaises(OSError): records._archive_completed(archive_request(records, ["work-a"]), fault_after=phase)
                self.assertEqual(read_json(records.journal)["schema_version"], "development-transaction-v2")
                self.assertTrue(records.recover()); self.assertFalse(records.recover())
                after = records.load(); self.assertEqual(after["work_items"], before["work_items"])
                self.assertEqual(read_json(records.index)["state_digest"], digest(after))
                self.assertLessEqual(records.path.stat().st_size, 8 * 1024**2)

    def test_physical_predecessor_cannot_change_even_when_logical_history_is_equal(self):
        before = self.records.load()
        with self.assertRaises(OSError): self.archive(fault_after="journal")
        journal = read_json(self.records.journal)
        ref = journal["successor"]["state"]["work_items"]["work-a"]
        alternate = self.records._encode_storage(before, {"work-a": ref})
        atomic_write(self.records.path, canonical_bytes(alternate))
        self.assertEqual(self.records.load(), before)
        retained = self.records.journal.read_bytes()
        with self.assertRaises(ControlError): self.records.recover()
        self.assertEqual(self.records.journal.read_bytes(), retained)
        self.assertEqual(self.records.path.read_bytes(), canonical_bytes(alternate))

    def test_failed_index_proof_never_clears_the_v2_journal(self):
        with self.assertRaises(OSError): self.archive(fault_after="journal")
        original = self.records.index.read_bytes(); retained = self.records.journal.read_bytes()
        index = read_json(self.records.index); index["revision"] = 999
        atomic_write(self.records.index, canonical_bytes(index))
        with self.assertRaises(ControlError): self.records.recover()
        self.assertEqual(self.records.journal.read_bytes(), retained)
        self.records.index.write_bytes(original); self.assertTrue(self.records.recover())

    def test_archive_write_failure_preserves_prior_state_and_index(self):
        before = self.records.path.read_bytes(); index = self.records.index.read_bytes()
        real_write = atomic_write
        def fail_archive(path, payload):
            if path.parent.name == "archives": raise OSError("synthetic archive write failure")
            return real_write(path, payload)
        with patch("control_plane.records.atomic_write", side_effect=fail_archive), self.assertRaises(OSError): self.archive()
        self.assertEqual(self.records.path.read_bytes(), before); self.assertEqual(self.records.index.read_bytes(), index)
        self.assertFalse(self.records.journal.exists())

    def test_legacy_inline_baseline_is_not_rewritten_inside_immutable_history(self):
        state = self.records.load()
        baseline = {"schema_version": "source-snapshot-v1", "head": "a" * 40, "files": {}, "source_digest": digest({})}
        state["work_items"]["work-a"]["baseline"] = baseline
        state["state_digest"] = digest({k: v for k, v in state.items() if k != "state_digest"})
        atomic_write(self.records.path, canonical_bytes(state))
        atomic_write(self.records.index, canonical_bytes({"schema_version": "development-index-v1", "revision": state["revision"], "state_digest": digest(state)}))
        self.archive(); before = self.archive_file().read_bytes()
        self.records.mutate(lambda s: s["feedback"].update({"new": {}}))
        self.assertEqual(self.archive_file().read_bytes(), before)
        self.assertEqual(self.records.baseline(self.records.load()["work_items"]["work-a"]), baseline)

    def test_bootstrap_owner_fences_ordinary_writers_and_public_archive_requests(self):
        marker = self.records.path.parent / "bootstrap-recovery.lock"
        marker.write_text(json.dumps({"schema_version": "control-plane-bootstrap-owner-v1", "plan_sha256": "a" * 64}))
        before = self.records.path.read_bytes()
        with self.assertRaises(ControlError): self.records.mutate(lambda s: None)
        with self.assertRaises(ControlError): self.archive()
        with self.assertRaises(ControlError): self.archive(bootstrap_manifest="b" * 64)
        self.assertEqual(self.records.path.read_bytes(), before)
        # This private call is only a synthetic fixture. Live bootstrap needs
        # separate source/effect review and a one-use trusted driver.
        self.archive(bootstrap_manifest="a" * 64)
        self.assertEqual(self.records.load()["work_items"]["work-a"], completed("work-a"))

    def test_two_archive_requests_cannot_commit_the_same_predecessor(self):
        request = archive_request(self.records, ["work-a"])
        context = multiprocessing.get_context("spawn"); queue = context.Queue()
        workers = [context.Process(target=archive_race, args=(str(self.root), request, queue)) for _ in range(2)]
        try:
            for process in workers: process.start()
            for process in workers: process.join(15)
            self.assertTrue(all(process.exitcode == 0 for process in workers))
            self.assertEqual(sorted(queue.get(timeout=2) for _ in workers), ["passed", "refused"])
        finally:
            for process in workers:
                if process.is_alive(): process.terminate(); process.join(5)
            queue.close()

    def test_in_repository_reparse_ancestor_cannot_redirect_archive_publication(self):
        target = self.root / "unrelated-owned-test-target"; target.mkdir()
        untouched = target / "untouched.txt"; untouched.write_bytes(b"preserve unrelated fixture")
        junction = self.records.path.parent / "archives"
        self.assertTrue(target.resolve().is_relative_to(self.root.resolve()))
        if os.name == "nt":
            import _winapi
            _winapi.CreateJunction(str(target), str(junction))
        else:
            junction.symlink_to(target, target_is_directory=True)
        before = self.records.path.read_bytes(); index = self.records.index.read_bytes()
        try:
            with self.assertRaises(ControlError): self.archive()
            self.assertEqual(self.records.path.read_bytes(), before)
            self.assertEqual(self.records.index.read_bytes(), index)
            self.assertEqual(list(target.iterdir()), [untouched])
        finally:
            # Remove only this newly created link, never its target tree.
            self.assertTrue(target.resolve().is_relative_to(self.root.resolve()))
            if os.name == "nt": junction.rmdir()
            else: junction.unlink()

    def test_link_and_reparse_state_are_rechecked_after_reading_an_open_archive(self):
        self.archive(); path = self.archive_file(); reference = self.wire()["state"]["work_items"]["work-a"]
        with path.open("rb") as stream: actual = os.fstat(stream.fileno())
        values = {name: getattr(actual, name) for name in ("st_dev", "st_ino", "st_size", "st_mtime_ns", "st_mode", "st_nlink")}
        values["st_file_attributes"] = getattr(actual, "st_file_attributes", 0)
        for change in ({"st_nlink": 2}, {"st_file_attributes": values["st_file_attributes"] | 0x400}):
            altered = SimpleNamespace(**{**values, **change})
            with self.subTest(change=change), patch("control_plane.records.os.fstat", side_effect=[actual, altered]):
                with self.assertRaises(ControlError): self.records._read_archive(reference, "work-a")

    def test_public_recovery_is_fenced_by_the_bootstrap_owner(self):
        marker = self.records.path.parent / "bootstrap-recovery.lock"
        marker.write_text(json.dumps({"schema_version": "control-plane-bootstrap-owner-v1", "plan_sha256": "a" * 64}))
        with self.assertRaises(OSError): self.archive(bootstrap_manifest="a" * 64, fault_after="journal")
        before = self.records.path.read_bytes(); index = self.records.index.read_bytes(); journal = self.records.journal.read_bytes()
        with self.assertRaises(ControlError): self.records.recover()
        self.assertEqual(self.records.path.read_bytes(), before); self.assertEqual(self.records.index.read_bytes(), index)
        self.assertEqual(self.records.journal.read_bytes(), journal)
        # A reviewed owning composition can resume only the exact issued journal.
        with exclusive_lock(self.records.lock):
            self.records._bootstrap_guard("a" * 64)
            self.assertTrue(self.records._recover())

    def test_normal_v2_mutation_checks_index_before_transition_or_publication(self):
        self.archive(); value = read_json(self.records.index); value["state_digest"] = "0" * 64
        atomic_write(self.records.index, canonical_bytes(value))
        before = self.records.path.read_bytes(); index = self.records.index.read_bytes(); calls = []
        with self.assertRaises(ControlError): self.records.mutate(lambda s: calls.append(True) or s["feedback"].update({"unreviewed": {}}))
        self.assertEqual(calls, [])
        self.assertEqual(self.records.path.read_bytes(), before); self.assertEqual(self.records.index.read_bytes(), index)
        self.assertFalse(self.records.journal.exists())

    def test_dangling_archive_leaf_is_preserved_without_any_publication(self):
        identity = digest(self.records.load()["work_items"]["work-a"])
        leaf = self.records.path.parent / "archives" / f"{identity}.json"; leaf.parent.mkdir()
        target = self.root / "owned-missing-leaf-target"; target.mkdir()
        if os.name == "nt":
            import _winapi
            _winapi.CreateJunction(str(target), str(leaf))
        else:
            leaf.symlink_to(target, target_is_directory=True)
        target.rmdir()
        self.assertFalse(leaf.exists()); link_identity = leaf.lstat()
        before = self.records.path.read_bytes(); index = self.records.index.read_bytes()
        try:
            with patch("control_plane.records.atomic_write", side_effect=AssertionError("A dangling archive leaf must be refused before publication")):
                with self.assertRaises(ControlError): self.archive()
            self.assertEqual(leaf.lstat().st_ino, link_identity.st_ino)
            self.assertEqual(self.records.path.read_bytes(), before); self.assertEqual(self.records.index.read_bytes(), index)
            self.assertFalse(self.records.journal.exists())
        finally:
            # This is only the newly allocated dangling unit link.
            if os.name == "nt": leaf.rmdir()
            else: leaf.unlink()

    def test_final_archive_link_is_refused_without_following_its_target_for_size(self):
        self.archive(); leaf = self.archive_file(); leaf.unlink()
        target = self.root / "owned-archive-link-target"; target.mkdir()
        if os.name == "nt":
            import _winapi
            _winapi.CreateJunction(str(target), str(leaf))
        else:
            leaf.symlink_to(target, target_is_directory=True)
        original_stat = Path.stat
        def refuse_follow(path, *args, **kwargs):
            if path == leaf and kwargs.get("follow_symlinks", True):
                raise AssertionError("Archive admission must not follow a final link")
            return original_stat(path, *args, **kwargs)
        try:
            with patch.object(Path, "stat", refuse_follow):
                with self.assertRaises(ControlError): self.records.load()
        finally:
            if os.name == "nt": leaf.rmdir()
            else: leaf.unlink()


class ArchiveWorkflowCompatibility(Fixture):
    def test_completed_lineage_and_next_real_workflow_remain_usable(self):
        self.repository(); receipt = self.verify(); self.review(receipt)
        self.work.complete("fixture-work", "author-run", self.claim)
        before = self.work.records.load()["work_items"]["fixture-work"]
        self.work.records.archive_completed(archive_request(self.work.records, ["fixture-work"]))
        retained = self.work.records.load()["work_items"]["fixture-work"]
        self.assertEqual(retained, before)
        self.assertEqual(self.work.current_receipt(retained)["receipt_digest"], receipt["receipt_digest"])
        spec = copy.deepcopy(self.spec); spec["work_id"] = "next-work"
        claim = self.work.start(spec, "next-author")["claim"]["claim_id"]
        self.put("docs/result.md", "completed next result\n")
        next_receipt = self.work.verify("next-work", "next-author", claim)
        self.assertEqual(next_receipt["qualification"], "passed")
        self.work.review({"schema_version": "technical-review-v1", "work_id": "next-work", "invocation_id": "next-reviewer", "assurance": "operator-attested", "disposition": "accepted", "receipt_digest": next_receipt["receipt_digest"], "findings": [], "closures": [], "reviewed_criteria": ["result"]})
        self.work.complete("next-work", "next-author", claim)
        self.assertEqual(self.work.records.load()["work_items"]["fixture-work"], before)

    def test_status_and_support_projection_preserve_history_without_parent_pass(self):
        import test_control_plane_support as support
        from control_plane.projection import project
        helper = support.SupportingTests("test_actual_historical_review_is_separate_from_unqualified_parent")
        helper.setUp(); self.addCleanup(helper.doCleanups)
        before = project(helper.root); source = (helper.root / ".implementation-roadmaps/owner/state.json").read_bytes()
        records = helper.work.records
        records.archive_completed(archive_request(records, ["fixture-work"]))
        after = project(helper.root)
        self.assertEqual(after["roadmaps"], before["roadmaps"])
        self.assertEqual(after["work_items"], before["work_items"])
        self.assertEqual(after["roadmaps"][0]["increments"][0]["criteria"][0]["outcome"], "missing")
        self.assertEqual((helper.root / ".implementation-roadmaps/owner/state.json").read_bytes(), source)

    def test_real_cli_accepts_only_a_bounded_private_archive_request(self):
        self.repository(); receipt = self.verify(); self.review(receipt)
        self.work.complete("fixture-work", "author-run", self.claim)
        request = archive_request(self.work.records, ["fixture-work"])
        path = self.put(".local-codex/archive.json", json.dumps(request))
        script = Path(__file__).resolve().parents[1] / "development_control_plane.py"
        result = subprocess.run([sys.executable, "-B", str(script), "--repo", str(self.root), "archive-completed", "--from", path.relative_to(self.root).as_posix()], capture_output=True, timeout=15)
        self.assertEqual(result.returncode, 0, result.stderr.decode(errors="replace"))
        self.assertFalse(json.loads(result.stdout)["data"]["history_removed"])
        self.assertEqual(self.work.records.load()["work_items"]["fixture-work"]["status"], "complete")


if __name__ == "__main__":
    unittest.main()
