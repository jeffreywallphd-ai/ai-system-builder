"""Journal formatting cannot make an otherwise bounded successor unreadable."""
from contextlib import ExitStack, contextmanager
import copy
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from control_plane.common import digest, read_json
from control_plane.contracts import ControlError
from control_plane.records import Records
from control_plane.storage import canonical_bytes

STAMP = "2026-10-27T00:00:00Z"


@contextmanager
def bounded_records(limit):
    # Exercise the production writer and recovery reader with the SAME smaller
    # fixed test bound. Production MAX_JSON remains unchanged.
    with ExitStack() as stack:
        stack.enter_context(patch("control_plane.records.MAX_JSON", limit))
        stack.enter_context(patch("control_plane.records.now", return_value=STAMP))
        stack.enter_context(patch("control_plane.records.read_json", side_effect=lambda path: read_json(path, maximum=limit)))
        yield


class JournalCapacityTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory(prefix="journal-capacity-")
        self.addCleanup(self.folder.cleanup)
        self.records = Records(Path(self.folder.name))

    def nested(self):
        return {f"retained-{index}": {"status": "pending", "history": {"first": "original", "second": "preserved"}}
                for index in range(120)}

    def successor(self, feedback):
        state = Records.empty()
        state.update(revision=1, updated_at=STAMP, feedback=copy.deepcopy(feedback))
        state["state_digest"] = digest(state)
        return state

    def test_near_limit_normal_publication_keeps_exact_history(self):
        values = self.nested(); expected = self.successor(values)
        limit = len(canonical_bytes(expected))
        indented = canonical_bytes({"schema_version": "development-transaction-v1", "before": digest(Records.empty()), "successor": expected})
        self.assertGreater(len(indented), limit)
        with bounded_records(limit):
            self.records.mutate(lambda state: state["feedback"].update(values))
            self.assertEqual(self.records.load(), expected)
            self.assertEqual(read_json(self.records.index)["revision"], 1)
            self.assertFalse(self.records.journal.exists())

    def test_near_limit_interrupted_journal_and_state_recover_idempotently(self):
        for phase in ("journal", "state"):
            with self.subTest(phase=phase), tempfile.TemporaryDirectory(prefix="journal-restart-") as directory:
                records = Records(Path(directory)); values = self.nested(); expected = self.successor(values)
                limit = len(canonical_bytes(expected))
                with bounded_records(limit):
                    with self.assertRaises(OSError): records.mutate(lambda state: state["feedback"].update(values), fault_after=phase)
                    raw = records.journal.read_bytes()
                    self.assertLessEqual(len(raw), limit)
                    self.assertEqual(json.loads(raw)["successor"], expected)
                    self.assertTrue(records.recover())
                    self.assertFalse(records.recover())
                    self.assertEqual(records.load(), expected)
                    self.assertEqual(read_json(records.index)["state_digest"], digest(expected))

    def test_journal_capacity_refuses_before_any_state_or_journal_publication(self):
        expected = self.successor({}); limit = len(canonical_bytes(expected))
        compact = (json.dumps({"schema_version": "development-transaction-v1", "before": digest(Records.empty()), "successor": expected},
                              sort_keys=True, separators=(",", ":")) + "\n").encode("utf8")
        self.assertGreater(len(compact), limit)
        with bounded_records(limit), self.assertRaises(ControlError) as refused:
            self.records.mutate(lambda _state: None)
        self.assertEqual(refused.exception.code, "state.capacity")
        self.assertFalse(self.records.path.exists())
        self.assertFalse(self.records.journal.exists())
        self.assertFalse(self.records.index.exists())

    def test_state_capacity_refusal_preserves_existing_state_and_index(self):
        self.records.mutate(lambda state: state["feedback"].update({"existing": {"status": "retained"}}))
        state = self.records.path.read_bytes(); index = self.records.index.read_bytes()
        with bounded_records(len(state) + 256), self.assertRaises(ControlError) as refused:
            self.records.mutate(lambda value: value["feedback"].update({"oversize": "x" * 5000}))
        self.assertEqual(refused.exception.code, "state.capacity")
        self.assertEqual(self.records.path.read_bytes(), state)
        self.assertEqual(self.records.index.read_bytes(), index)
        self.assertFalse(self.records.journal.exists())

    def test_journal_capacity_refusal_preserves_existing_state_and_index(self):
        self.records.mutate(lambda _state: None)
        state = self.records.path.read_bytes(); index = self.records.index.read_bytes()
        expected = self.records.load(); expected.pop("state_digest")
        expected.update(revision=expected["revision"] + 1, updated_at=STAMP)
        expected["state_digest"] = digest(expected)
        limit = len(canonical_bytes(expected))
        with bounded_records(limit), self.assertRaises(ControlError) as refused:
            self.records.mutate(lambda _state: None)
        self.assertEqual(refused.exception.code, "state.capacity")
        self.assertEqual(self.records.path.read_bytes(), state)
        self.assertEqual(self.records.index.read_bytes(), index)
        self.assertFalse(self.records.journal.exists())

    def test_readable_legacy_indented_journal_and_unicode_remain_exact(self):
        values = {"retained": {"text": "Caf\u00e9 \u03bb \\ \" quoted\nline", "history": [1, False, None]}}
        with self.assertRaises(OSError): self.records.mutate(lambda state: state["feedback"].update(values), fault_after="journal")
        original = read_json(self.records.journal)
        self.records.journal.write_bytes(canonical_bytes(original))
        self.assertTrue(self.records.recover())
        self.assertEqual(self.records.load()["feedback"], values)
        self.assertEqual(self.records.load(), original["successor"])

    def test_corrupted_successor_is_preserved_and_never_published(self):
        with self.assertRaises(OSError): self.records.mutate(lambda _state: None, fault_after="journal")
        value = read_json(self.records.journal); value["successor"]["feedback"]["changed"] = {}
        self.records.journal.write_bytes(canonical_bytes(value)); raw = self.records.journal.read_bytes()
        with self.assertRaises(ControlError) as refused: self.records.recover()
        self.assertEqual(refused.exception.code, "state.integrity")
        self.assertEqual(self.records.journal.read_bytes(), raw)
        self.assertFalse(self.records.path.exists())

    def test_oversized_retained_journal_stays_unchanged(self):
        self.records.journal.parent.mkdir(parents=True)
        raw = canonical_bytes({"retained": "x" * 1024}); self.records.journal.write_bytes(raw)
        with bounded_records(256), self.assertRaises(ControlError) as refused: self.records.recover()
        self.assertEqual(refused.exception.code, "input.too-large")
        self.assertEqual(self.records.journal.read_bytes(), raw)
        self.assertFalse(self.records.path.exists())


if __name__ == "__main__": unittest.main()
