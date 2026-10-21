"""Bounded source snapshot storage retains authority and interrupted history."""
import copy
import os
from pathlib import Path
from unittest.mock import patch

from test_control_plane_delivery import Fixture
from control_plane.common import digest
from control_plane.contracts import ControlError
from control_plane.records import Records
from control_plane.storage import atomic_write, canonical_bytes


class SnapshotStorageTests(Fixture):
    def test_work_uses_one_shared_verified_snapshot_without_changing_receipts(self):
        self.repository()
        records = self.work.records
        work = records.load()["work_items"]["fixture-work"]
        self.assertEqual(work["baseline"]["schema_version"], "source-snapshot-reference-v1")
        baseline = records.baseline(work)
        self.assertIn("docs/result.md", baseline["files"])
        self.work.claim("fixture-work", "author-run", self.claim, action="release")
        spec = copy.deepcopy(self.spec); spec["work_id"] = "second-work"
        self.work.start(spec, "next-run")
        self.assertEqual(len(list((records.path.parent / "snapshots").glob("*.json"))), 1)

    def test_inline_legacy_history_migrates_before_size_check_and_survives_recovery(self):
        records = Records(self.root)
        files = {f"modules/fixture/{i}.ts": "a" * 64 for i in range(500)}
        baseline = {"schema_version": "source-snapshot-v1", "head": "b" * 40, "files": files, "source_digest": digest(files)}
        state = records.empty()
        state["work_items"] = {f"work-{i}": {"baseline": baseline, "receipts": [{"retained": i}], "reviews": [], "events": [{"code": "retained"}]} for i in range(20)}
        state["state_digest"] = digest(state)
        atomic_write(records.path, canonical_bytes(state))
        with patch("control_plane.records.MAX_JSON", 100000), self.assertRaises(OSError):
            records.mutate(lambda _s: None, fault_after="journal")
        self.assertTrue(records.recover())
        restored = records.load()
        self.assertLess(len(canonical_bytes(restored)), 100000)
        self.assertEqual(len(restored["work_items"]), 20)
        for i, work in enumerate(restored["work_items"].values()):
            self.assertEqual(records.baseline(work), baseline)
            self.assertEqual(work["events"], [{"code": "retained"}])
        self.assertEqual(len(list((records.path.parent / "snapshots").glob("*.json"))), 1)

    def test_missing_corrupt_and_escaping_snapshot_never_qualify(self):
        self.repository()
        records = self.work.records
        work = records.load()["work_items"]["fixture-work"]
        path = records.path.parent / "snapshots" / (work["baseline"]["snapshot_digest"] + ".json")
        original = path.read_bytes()
        path.unlink()
        with self.assertRaises(ControlError): self.work.plan("fixture-work")
        path.write_text('{"substituted":true}')
        with self.assertRaises(ControlError): self.work.plan("fixture-work")
        self.assertEqual(path.read_text(), '{"substituted":true}')
        path.write_bytes(original)
        work["baseline"]["snapshot_digest"] = "../outside"
        with self.assertRaises(ControlError): records.baseline(work)

    def test_atomic_writer_ignores_predictable_temporary_name_and_preserves_failed_target(self):
        target = self.root / "state.json"
        target.write_bytes(b"old")
        predictable = target.with_name(f".{target.name}.{os.getpid()}.tmp")
        predictable.write_bytes(b"unrelated")
        with patch("control_plane.storage.os.replace", side_effect=OSError("interrupted")), self.assertRaises(OSError):
            atomic_write(target, b"new")
        self.assertEqual(target.read_bytes(), b"old")
        self.assertEqual(predictable.read_bytes(), b"unrelated")
        self.assertEqual(list(self.root.glob(".state.json.*.tmp")), [predictable])
        atomic_write(target, b"new")
        self.assertEqual(target.read_bytes(), b"new")
        self.assertEqual(predictable.read_bytes(), b"unrelated")
