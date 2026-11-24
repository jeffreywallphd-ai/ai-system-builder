"""Real bounded local storage/CLI; synthetic counters, no model or host calls."""
from __future__ import annotations

import copy
import json
import subprocess
import sys
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

HELPERS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HELPERS))
from control_plane import usage
from control_plane.contracts import ControlError
from control_plane.projection import project, encode_review_projection, REVIEW_MAX_BYTES

AT = "2026-11-24T12:00:00Z"


class UsageTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="token-usage-")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)

    @property
    def path(self):
        return self.root / usage.BASE / "state.json"

    def enable(self, **retention):
        return usage.enable(self.root, {**usage.DEFAULT_RETENTION, **retention})

    def event(self, **changes):
        value = {"producer": "synthetic-host", "run_id": "synthetic-run", "agent_id": "synthetic-parent",
                 "parent_agent_id": None, "counter_epoch": "first", "sequence": 0, "counter_mode": "delta",
                 "from_zero": False, "started_at": AT, "ended_at": AT, "scope": "own", "purpose": "implementation",
                 "purpose_basis": "declared", "provenance": "host-reported", "model": "synthetic-model",
                 "outcome": "succeeded", "counts": {metric: {"value": count, "status": "measured"}
                 for metric, count in zip(usage.METRICS, (100, 20, 10, 5))}}
        return {**value, **changes}

    def call(self, *events, at=AT):
        return usage.import_observations(self.root, {"schema_version": usage.IMPORT_SCHEMA, "events": list(events)}, at=at)

    def measured(self):
        return usage.summary(self.root)["known_own_subtotal"]["measured"]

    def test_disabled_read_does_not_create_storage_and_projection_remains_usable(self):
        self.assertEqual(usage.summary(self.root)["status"], "disabled")
        self.assertFalse((self.root / ".local-codex").exists())
        value = project(self.root)
        self.assertEqual(value["token_usage"]["coverage"], "unavailable")
        self.assertEqual(value["schema_version"], "development-review-v1")
        with self.assertRaisesRegex(ControlError, "Enable optional"):
            self.call(self.event())

    def test_delta_retry_failure_and_import_replay_count_consumption_once(self):
        self.enable()
        first = self.event(outcome="failed")
        self.assertEqual(self.call(first)["accepted"], 1)
        before = self.path.read_bytes()
        self.assertEqual(self.call(first)["duplicates"], 1)
        self.assertEqual(self.path.read_bytes(), before)
        self.call(self.event(sequence=1, outcome="cancelled"))
        self.assertEqual(self.measured()["input_tokens"], 200)
        before = self.path.read_bytes()
        self.assertEqual(self.call(first)["older_sequences_not_recounted"], 1)
        self.assertEqual(self.path.read_bytes(), before)
        conflict = self.event(sequence=1, purpose="tests")
        with self.assertRaisesRegex(ControlError, "different counters"):
            self.call(conflict)
        self.assertEqual(self.path.read_bytes(), before)
        with self.assertRaisesRegex(ControlError, "contiguous"):
            self.call(self.event(sequence=3))
        self.assertEqual(self.path.read_bytes(), before)

    def test_cumulative_baseline_fork_history_reset_and_subset_deltas(self):
        self.enable()
        first = self.event(counter_mode="cumulative")
        self.call(first)
        self.assertIsNone(self.measured()["input_tokens"])
        larger = copy.deepcopy(first); larger.update(sequence=2)
        for metric, value in zip(usage.METRICS, (150, 30, 20, 8)):
            larger["counts"][metric]["value"] = value
        result = self.call(larger)
        self.assertIn("cumulative-observation-gaps", result["warnings"])
        self.assertEqual(self.measured(), dict(zip(usage.METRICS, (50, 10, 10, 3))))
        before = self.path.read_bytes()
        lower = copy.deepcopy(larger); lower.update(sequence=3)
        lower["counts"]["input_tokens"]["value"] = 149
        with self.assertRaisesRegex(ControlError, "decreased"):
            self.call(lower)
        self.assertEqual(self.path.read_bytes(), before)
        self.call(self.event(counter_mode="cumulative", counter_epoch="reset", from_zero=True))
        self.assertEqual(self.measured()["input_tokens"], 150)
        bad = self.event(counter_mode="cumulative", counter_epoch="reset", sequence=1)
        bad["counts"]["cached_input_tokens"]["value"] = 20
        with self.assertRaisesRegex(ControlError, "subset semantics"):
            self.call(bad)

    def test_missing_fields_changed_assurance_zero_and_purpose_are_explicit(self):
        self.enable()
        event = self.event(counter_mode="cumulative", from_zero=True, purpose="review", purpose_basis="inferred")
        event["counts"]["output_tokens"] = {"value": 0, "status": "estimated"}
        event["counts"]["reasoning_output_tokens"] = {"value": None, "status": "unavailable"}
        self.call(event)
        value = usage.summary(self.root)["known_own_subtotal"]
        self.assertEqual(value["estimated"]["output_tokens"], 0)
        self.assertIsNone(value["measured"]["output_tokens"])
        self.assertEqual(value["unavailable_fields"]["reasoning_output_tokens"], 1)
        self.assertEqual(value["purpose_attribution"]["inferred"], 1)
        later = copy.deepcopy(event); later.update(sequence=1, from_zero=False, provenance="operator-declared")
        later["counts"]["input_tokens"]["value"] = 200
        self.assertIn("initial-or-changed-counter-baseline-unavailable", self.call(later)["warnings"])
        self.assertEqual(self.measured()["input_tokens"], 100)

    def test_missing_snapshot_then_known_cumulative_field_counts_one_difference(self):
        self.enable()
        first = self.event(counter_mode="cumulative", from_zero=True)
        self.call(first)
        missing = copy.deepcopy(first); missing.update(sequence=1, from_zero=False)
        missing["counts"]["input_tokens"] = {"value": None, "status": "unavailable"}
        self.call(missing)
        last = copy.deepcopy(first); last.update(sequence=2, from_zero=False)
        last["counts"]["input_tokens"]["value"] = 170
        self.call(last)
        self.assertEqual(self.measured()["input_tokens"], 170)
        self.assertEqual(usage.summary(self.root)["known_own_subtotal"]["unavailable_fields"]["input_tokens"], 1)

    def test_parent_child_inclusive_unknown_and_cycles_never_invent_tree_totals(self):
        self.enable()
        self.call(self.event(agent_id="child", parent_agent_id="synthetic-parent", purpose="tests"))
        self.assertEqual(usage.summary(self.root)["missing_reported_parents"], 1)
        self.call(self.event())
        self.call(self.event(counter_epoch="rollup", scope="includes-descendants"))
        self.call(self.event(agent_id="unclear", scope="unknown"))
        value = usage.summary(self.root)
        self.assertEqual(value["known_own_subtotal"]["measured"]["input_tokens"], 200)
        self.assertEqual(value["unaggregated_scopes"]["includes-descendants"]["measured"]["input_tokens"], 100)
        self.assertEqual(value["missing_reported_parents"], 0)
        self.assertEqual(value["coverage"], "partial-or-unavailable")
        before = self.path.read_bytes()
        with self.assertRaisesRegex(ControlError, "parentage changed"):
            self.call(self.event(sequence=1, parent_agent_id="child"))
        self.assertEqual(self.path.read_bytes(), before)
        with self.assertRaisesRegex(ControlError, "cycle"):
            self.call(self.event(agent_id="a", parent_agent_id="b"), self.event(agent_id="b", parent_agent_id="a"))
        self.assertEqual(self.path.read_bytes(), before)

    def test_utc_day_iso_week_quarter_retirement_and_lifetime_are_not_lost(self):
        self.enable(daily=90, weekly=13, quarterly=4)
        dates = ["2001-01-01", "2025-12-31", "2026-01-01", "2026-04-01", "2026-07-01", "2026-11-24"]
        self.call(*[self.event(sequence=index, started_at=stamp+"T00:00:00Z", ended_at=stamp+"T00:00:00Z")
                    for index, stamp in enumerate(dates)])
        value = usage.summary(self.root)
        self.assertEqual(self.measured()["input_tokens"], 600)
        self.assertEqual(value["older_quarters"]["measured"]["input_tokens"], 200)
        self.assertEqual([row["period"] for row in value["trends"]["quarterly"]], ["2026-Q1", "2026-Q2", "2026-Q3", "2026-Q4"])
        self.assertEqual([row["period"] for row in value["trends"]["daily"]], ["2026-11-24"])
        self.assertEqual(value["trends"]["weekly"][0]["period"], "2026-11-23")
        before = self.path.read_bytes()
        self.assertEqual(usage.summary(self.root, period="quarterly", limit=80)["storage"]["retention"]["quarterly"], 4)
        self.assertEqual(self.path.read_bytes(), before)
        self.assertEqual(usage._periods(usage._time("2027-01-01T00:00:00Z"))["weekly"], "2026-12-28")

    def test_rotation_preserves_totals_cursors_and_older_replay_protection(self):
        self.enable()
        for start in range(0, 300, 60):
            self.call(*[self.event(sequence=index) for index in range(start, start+60)])
        value = usage.summary(self.root)
        self.assertEqual(value["storage"]["recent_detail"], 128)
        self.assertEqual(value["storage"]["recent_detail_compacted"], 172)
        self.assertEqual(self.measured()["input_tokens"], 30000)
        before = self.path.read_bytes()
        self.assertEqual(self.call(self.event())["older_sequences_not_recounted"], 1)
        self.assertEqual(self.path.read_bytes(), before)
        self.assertLess(self.path.stat().st_size, usage.MAX_BYTES)
        self.assertEqual({p.name for p in self.path.parent.iterdir()}, {"state.json", "writer.lock"})
        self.assertEqual((self.path.parent/"writer.lock").stat().st_size, 1)

    def test_quotas_and_arithmetic_overflow_preserve_existing_totals(self):
        self.enable()
        self.call(self.event())
        before = self.path.read_bytes()
        with patch.object(usage, "MAX_BYTES", len(before)+1), self.assertRaisesRegex(ControlError, "4 MiB"):
            self.call(self.event(sequence=1))
        self.assertEqual(self.path.read_bytes(), before)
        with patch.object(usage, "MAX_STREAMS", 1), self.assertRaisesRegex(ControlError, "cursor capacity"):
            self.call(self.event(agent_id="other"))
        self.assertEqual(self.path.read_bytes(), before)
        with patch.object(usage, "MAX_INPUT_BYTES", 1), self.assertRaises(ControlError):
            self.call(self.event(sequence=1))
        self.assertEqual(self.path.read_bytes(), before)
        huge = self.event(sequence=1); huge["counts"]["input_tokens"]["value"] = usage.MAX_NUMBER
        with self.assertRaises(ControlError): self.call(huge)
        self.assertEqual(self.path.read_bytes(), before)
        huge["purpose"] = "tests"
        with self.assertRaises(ControlError): self.call(huge)
        self.assertEqual(self.path.read_bytes(), before)

    def test_batch_failure_and_partial_publication_preserve_authoritative_bytes(self):
        self.enable()
        self.call(self.event(counter_mode="cumulative", from_zero=True))
        before = self.path.read_bytes()
        good = self.event(counter_mode="cumulative", sequence=1)
        good["counts"]["input_tokens"]["value"] = 150
        bad = copy.deepcopy(good); bad.update(sequence=2); bad["counts"]["input_tokens"]["value"] = 149
        with self.assertRaises(ControlError): self.call(good, bad)
        self.assertEqual(self.path.read_bytes(), before)
        with patch.object(usage, "atomic_write", side_effect=OSError("synthetic private error")), self.assertRaises(OSError):
            self.call(good)
        self.assertEqual(self.path.read_bytes(), before)
        with patch("control_plane.storage.os.replace", side_effect=OSError("synthetic replacement failure")), self.assertRaises(OSError):
            self.call(good)
        self.assertEqual(self.path.read_bytes(), before)
        self.assertEqual({p.name for p in self.path.parent.iterdir()}, {"state.json", "writer.lock"})
        abandoned = self.path.parent/".state.json.synthetic.tmp"; abandoned.write_text("private unpublished bytes")
        value = usage.summary(self.root)
        self.assertEqual(value["status"], "enabled")
        self.assertIn("unpublished-usage-file-preserved-imports-paused", value["warnings"])
        self.assertNotIn("private unpublished", json.dumps(value))
        with self.assertRaisesRegex(ControlError, "recovery"): self.call(good)
        self.assertEqual(self.path.read_bytes(), before)
        self.assertTrue(abandoned.exists())

    def test_concurrent_replay_and_storage_reparse_refusal(self):
        self.enable()
        event = self.event()
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(lambda _: self.call(event), range(2)))
        self.assertEqual(sum(result["accepted"] for result in results), 1)
        self.assertEqual(sum(result["duplicates"] for result in results), 1)
        self.assertEqual(self.measured()["input_tokens"], 100)
        original = Path.lstat
        def reparse(path, *args, **kwargs):
            result = original(path, *args, **kwargs)
            if path == self.path:
                return SimpleNamespace(st_mode=result.st_mode, st_file_attributes=0x400)
            return result
        before = self.path.read_bytes()
        with patch.object(Path, "lstat", reparse):
            self.assertEqual(usage.summary(self.root)["status"], "unavailable")
            with self.assertRaisesRegex(ControlError, "links"): self.call(self.event(sequence=1))
        self.assertEqual(self.path.read_bytes(), before)

    def test_invalid_private_nonfinite_boolean_float_future_and_subset_fields_refuse(self):
        self.enable(); before = self.path.read_bytes()
        invalid = [self.event(prompt="synthetic-private-prompt"), self.event(agent_id="C:/private/path"),
                   self.event(ended_at="2099-01-01T00:00:00Z"), self.event(started_at="2026-02-30T00:00:00Z"),
                   self.event(purpose="arbitrary-private-label"), self.event(sequence=True)]
        for value in (-1, True, 1.5, float("inf"), float("nan"), None):
            event = self.event(); event["counts"]["input_tokens"]["value"] = value; invalid.append(event)
        subset = self.event(); subset["counts"]["cached_input_tokens"]["value"] = 101; invalid.append(subset)
        for event in invalid:
            with self.subTest(event=list(event)), self.assertRaises((ControlError, ValueError)):
                self.call(event)
            self.assertEqual(self.path.read_bytes(), before)

    def test_redaction_corrupt_store_and_projection_failure_are_nonblocking(self):
        self.enable(); self.call(self.event())
        public = json.dumps(usage.summary(self.root))
        stored = self.path.read_text()
        for private in ("synthetic-host", "synthetic-run", "synthetic-parent", "synthetic-model"):
            self.assertNotIn(private, public); self.assertNotIn(private, stored)
        self.path.write_text('{"private":"synthetic-private-bytes"}')
        before = self.path.read_bytes()
        value = project(self.root)
        self.assertEqual(value["token_usage"]["status"], "unavailable")
        self.assertNotIn("synthetic-private", json.dumps(value))
        self.assertEqual(self.path.read_bytes(), before)

    def test_overlap_and_cross_epoch_overlap_refuse_and_retention_is_bounded(self):
        self.enable()
        self.call(self.event(started_at="2026-11-24T10:00:00Z"))
        before = self.path.read_bytes()
        for event in (self.event(sequence=1, started_at="2026-11-24T11:00:00Z"),
                      self.event(counter_epoch="overlap", started_at="2026-11-24T11:00:00Z")):
            with self.assertRaisesRegex(ControlError, "overlap"): self.call(event)
            self.assertEqual(self.path.read_bytes(), before)
        with self.assertRaises(ControlError): self.enable(quarterly=3)
        with self.assertRaises(ControlError): self.enable(quarterly=81)
        with self.assertRaisesRegex(ControlError, "cannot be changed"): self.enable(quarterly=8)
        self.assertEqual(self.path.read_bytes(), before)

    def test_retired_epoch_cannot_resume_over_or_after_delta_or_cumulative_reset(self):
        for mode in ("delta", "cumulative"):
            with self.subTest(reset_mode=mode), tempfile.TemporaryDirectory() as directory:
                original_root = self.root; self.root = Path(directory)
                try:
                    self.enable()
                    first = self.event(started_at="2026-11-24T10:00:00Z", ended_at="2026-11-24T10:05:00Z")
                    self.call(first)
                    self.call(self.event(counter_epoch="reset", counter_mode=mode, from_zero=mode == "cumulative",
                                         started_at="2026-11-24T10:05:00Z", ended_at="2026-11-24T10:10:00Z"))
                    before = self.path.read_bytes()
                    for start, end in (("10:05:00", "10:10:00"), ("10:10:00", "10:15:00")):
                        with self.assertRaisesRegex(ControlError, "retired counter epoch"):
                            self.call(self.event(sequence=1, started_at="2026-11-24T"+start+"Z", ended_at="2026-11-24T"+end+"Z"))
                        self.assertEqual(self.path.read_bytes(), before)
                        self.assertEqual(self.measured()["input_tokens"], 200)
                    self.assertEqual(self.call(first)["duplicates"], 1)
                    changed = copy.deepcopy(first); changed["counts"]["input_tokens"]["value"] = 101
                    with self.assertRaisesRegex(ControlError, "different counters"): self.call(changed)
                    self.assertEqual(self.path.read_bytes(), before)
                finally:
                    self.root = original_root

    def test_equal_time_retirement_and_independent_scope_families(self):
        self.enable(); self.call(self.event())
        self.call(self.event(counter_epoch="reset"))
        before = self.path.read_bytes()
        with self.assertRaisesRegex(ControlError, "retired counter epoch"):
            self.call(self.event(sequence=1))
        self.assertEqual(self.path.read_bytes(), before)
        self.call(self.event(counter_epoch="inclusive", scope="includes-descendants", started_at="2026-11-24T10:00:00Z"))
        self.call(self.event(counter_epoch="reset", sequence=1))
        self.assertEqual(self.measured()["input_tokens"], 300)
        self.assertEqual(usage.summary(self.root)["unaggregated_scopes"]["includes-descendants"]["measured"]["input_tokens"], 100)

    def test_missing_active_index_is_derived_only_when_unambiguous(self):
        self.enable(); self.call(self.event())
        def remove_index():
            value = json.loads(self.path.read_bytes()); del value['active_epochs']; value.pop('state_digest')
            value['state_digest'] = usage.digest(value); self.path.write_bytes(usage._encoded(value))
        remove_index(); before = self.path.read_bytes()
        self.assertEqual(usage.summary(self.root)["status"], "enabled")
        self.assertEqual(self.path.read_bytes(), before)
        self.call(self.event(counter_epoch="reset"))
        remove_index(); before = self.path.read_bytes()
        self.assertEqual(usage.summary(self.root)["status"], "unavailable")
        with self.assertRaisesRegex(ControlError, "ambiguous historical epochs"):
            self.call(self.event(counter_epoch="reset", sequence=1))
        self.assertEqual(self.path.read_bytes(), before)

    def test_public_cli_opt_in_import_summary_and_private_schema_refusal(self):
        def run(*args):
            result = subprocess.run([sys.executable, "-B", str(HELPERS/"development_control_plane.py"), "--repo", str(self.root), "usage", *args],
                                    capture_output=True, text=True, timeout=15)
            return result.returncode, json.loads(result.stdout)
        code, result = run("summary"); self.assertEqual(code, 0); self.assertEqual(result["data"]["status"], "disabled")
        self.assertEqual(run("enable")[0], 0)
        path = self.root/".local-codex/export.json"
        event = self.event()
        for count in event["counts"].values(): count.update(value=None, status="unavailable")
        event.update(provenance="unavailable", outcome="unavailable")
        path.write_text(json.dumps({"schema_version": usage.IMPORT_SCHEMA, "events": [event]}))
        code, result = run("import", "--from", ".local-codex/export.json")
        self.assertEqual(code, 0); self.assertEqual(result["data"]["accepted"], 1)
        self.assertIsNone(result["data"]["summary"]["known_own_subtotal"]["measured"]["input_tokens"])
        path.write_text('{"prompt":"synthetic-private-prompt"}')
        code, result = run("import", "--from", ".local-codex/export.json")
        self.assertEqual(code, 2); self.assertNotIn("synthetic-private-prompt", json.dumps(result))
        self.assertEqual(run("summary", "--period", "quarterly", "--limit", "40")[0], 0)

    def test_dashboard_observed_relationship_roles_use_all_reported_links_and_stay_bounded(self):
        self.enable()
        self.call(self.event(), self.event(agent_id="bridge", parent_agent_id="synthetic-parent"),
                  self.event(agent_id="leaf", parent_agent_id="bridge"), self.event(agent_id="unclassified"))
        value = usage.summary(self.root)
        self.assertCountEqual([row["role"] for row in value["agents"]], ["parent", "parent-and-child", "child", "unclassified"])
        self.assertTrue(all(row["role_basis"] == "reported-parent-links" for row in value["agents"]))
        self.call(*[self.event(agent_id=f"bounded-{index}", parent_agent_id="synthetic-parent") for index in range(24)])
        value = usage.summary(self.root)
        self.assertEqual(value["agents_observed"], 28)
        self.assertEqual(value["agents_shown"], 16)
        self.assertEqual(len(value["agents"]), 16)
        self.assertEqual(value["coverage"], "partial-or-unavailable")
        for private in ("synthetic-parent", "bounded-", "bridge", "leaf"):
            self.assertNotIn(private, json.dumps(value))

    def test_dashboard_global_summary_survives_compact_paging_and_wire_without_filling_unknowns(self):
        self.enable()
        event = self.event()
        event['counts']['output_tokens'] = {'value': 0, 'status': 'estimated'}
        event['counts']['reasoning_output_tokens'] = {'value': None, 'status': 'unavailable'}
        self.call(event)
        expected = usage.summary(self.root)
        before = self.path.read_bytes()
        for compact in (False, True):
            value = project(self.root, compact_work_items=compact, page={'view':'work_items','page':1})
            encoded = encode_review_projection(value)
            self.assertLess(len(encoded), REVIEW_MAX_BYTES)
            self.assertEqual(json.loads(encoded)['token_usage'], expected)
            self.assertEqual(value['pagination']['view'], 'work_items')
            self.assertEqual(set(value['totals']), {'roadmaps','work_items','evaluations','feedback'})
            row = value['token_usage']['known_own_subtotal']
            self.assertEqual(row['measured']['input_tokens'], 100)
            self.assertEqual(row['measured']['cached_input_tokens'], 10)
            self.assertEqual(row['estimated']['output_tokens'], 0)
            self.assertIsNone(row['measured']['output_tokens'])
            self.assertIsNone(row['measured']['reasoning_output_tokens'])
            self.assertEqual(row['unavailable_fields']['reasoning_output_tokens'], 1)
        self.assertEqual(self.path.read_bytes(), before)


if __name__ == "__main__":
    unittest.main()
