"""Real numeric receiver/storage with inert official-protocol fixtures; no host calls."""
from __future__ import annotations

import copy
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from control_plane import usage, usage_capture as capture
from control_plane.contracts import ControlError

T0 = "2026-11-24T10:00:00Z"
T1 = "2026-11-24T10:01:00Z"
T2 = "2026-11-24T10:02:00Z"
T3 = "2026-11-24T10:03:00Z"


class CaptureTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix="numeric-capture-")
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.folder = self.root / capture.PREFIX
        self.folder.mkdir(parents=True)
        self.config = {"schema_version": "codex-token-capture-config-v1", "protocol": capture.PROTOCOL,
                       "source_version": "synthetic-v2-six-fields", "counter_semantics": "cumulative-provider-counters",
                       "session_id": "selected-session", "feed_path": capture.PREFIX + "feed.json",
                       "threads": [self.binding()]}

    def binding(self, identity="parent", parent=None, scope="own", epoch="epoch-one"):
        return {"thread_id": identity, "parent_thread_id": parent, "counter_epoch": epoch,
                "scope": scope, "purpose": "implementation", "purpose_basis": "declared"}

    def frame(self, stamp=T0, counts=(100, 20, 10, 5), identity="parent"):
        inp, out, cached, reasoning = counts
        values = {"totalTokens": inp + out, "inputTokens": inp, "outputTokens": out,
                  "cachedInputTokens": cached, "cacheWriteInputTokens": 0, "reasoningOutputTokens": reasoning}
        return {"observed_at": stamp, "notification": {"jsonrpc": "2.0", "method": "thread/tokenUsage/updated",
                "params": {"threadId": identity, "turnId": "synthetic-turn", "tokenUsage": {
                    "total": values, "last": dict(values), "modelContextWindow": 200000}}}}

    def write(self, *frames):
        (self.folder / "config.json").write_text(json.dumps(self.config), encoding="utf-8")
        self.feed = {"schema_version": "codex-token-feed-v1", "session_id": "selected-session",
                     "source_version": self.config["source_version"], "events": list(frames)}
        (self.folder / "feed.json").write_text(json.dumps(self.feed), encoding="utf-8")

    def call(self, *frames, at=T3):
        self.write(*frames)
        return capture.capture(self.root, session="selected-session", at=at)

    def measured(self):
        return usage.summary(self.root)["known_own_subtotal"]["measured"]

    def state_bytes(self):
        return (self.root / usage.BASE / "state.json").read_bytes()

    def test_missing_bridge_and_environment_session_are_nonblocking_and_create_no_placeholders(self):
        # Replacing the Python mapping avoids changing native Windows empty
        # environment values (including inherited fixture Git config values).
        with patch.object(capture.os, "environ", {"CODEX_THREAD_ID": "selected-session"}):
            result = capture.session_start(self.root, config_path=capture.PREFIX + "explicit-export-only.json", at=T3)
        self.assertEqual(result["reason_code"], "capture.host-bridge-not-configured")
        self.assertTrue(result["adapter_ready"] and result["work_may_continue"])
        self.assertFalse(result["live_capture"])
        self.assertFalse((self.root / usage.BASE).exists())
        with patch.object(capture.os, "environ", {}):
            self.assertEqual(capture.session_start(self.root)["reason_code"], "capture.session-reference-unavailable")

    def test_empty_feed_is_adapter_ready_not_live_and_first_cumulative_sample_is_baseline(self):
        result = self.call()
        self.assertEqual(result["status"]["state"], "adapter-ready")
        self.assertFalse((self.root / usage.BASE).exists())
        result = self.call(self.frame())
        self.assertEqual(result["initial_baselines"], 1)
        self.assertEqual(result["status"]["state"], "baseline-only")
        self.assertFalse(result["status"]["live_capture"])
        self.assertIsNone(self.measured()["input_tokens"])

    def test_cumulative_delta_subsets_and_actual_freshness_use_neither_last_nor_context_window(self):
        self.call(self.frame())
        next_frame = self.frame(T1, (150, 30, 20, 8))
        next_frame["notification"]["params"]["tokenUsage"]["last"]["inputTokens"] = 123456
        result = self.call(next_frame)
        self.assertEqual(self.measured(), dict(zip(usage.METRICS, (50, 10, 10, 3))))
        self.assertEqual(result["status"]["state"], "recent-actual-events")
        self.assertTrue(result["status"]["live_capture"])
        self.assertEqual(result["status"]["last_actual_event_at"], T1)
        self.assertEqual(result["billing_assurance"], "not-attested")

    def test_identical_counters_are_noop_and_cannot_refresh_stale_capture(self):
        self.call(self.frame(), self.frame(T1, (150, 30, 20, 8)))
        before = self.state_bytes()
        result = self.call(self.frame(T2, (150, 30, 20, 8)), at="2026-11-24T11:00:00Z")
        self.assertEqual(result["duplicate_counter_snapshots"], 1)
        self.assertEqual(result["observations_accepted"], 0)
        self.assertEqual(self.state_bytes(), before)
        self.assertEqual(result["status"]["state"], "stale-actual-events")
        self.assertFalse(result["status"]["live_capture"])

    def test_same_batch_replay_current_snapshot_and_safe_old_snapshot_refusal(self):
        self.call(self.frame(), self.frame(T1, (150, 30, 20, 8)))
        before = self.state_bytes()
        self.call(self.frame(T1, (150, 30, 20, 8)))
        self.assertEqual(self.state_bytes(), before)
        with self.assertRaises(ControlError): self.call(self.frame())
        self.assertEqual(self.state_bytes(), before)

    def test_decrease_requires_new_epoch_baseline_and_retired_epoch_never_resumes(self):
        self.call(self.frame(), self.frame(T1, (150, 30, 20, 8)))
        before = self.state_bytes()
        with self.assertRaises(ControlError): self.call(self.frame(T2, (5, 1, 0, 0)))
        self.assertEqual(self.state_bytes(), before)
        self.config["threads"][0]["counter_epoch"] = "epoch-two"
        self.call(self.frame(T2, (5, 1, 0, 0)), self.frame(T3, (10, 3, 1, 1)))
        self.assertEqual(self.measured()["input_tokens"], 55)
        before = self.state_bytes()
        self.config["threads"][0]["counter_epoch"] = "epoch-one"
        with self.assertRaises(ControlError): self.call(self.frame(T3, (160, 40, 25, 10)))
        self.assertEqual(self.state_bytes(), before)

    def test_changed_protocol_source_version_baselines_and_cannot_resume_old_version(self):
        self.call(self.frame(), self.frame(T1, (150, 30, 20, 8)))
        self.config["source_version"] = "synthetic-new-source"
        self.call(self.frame(T2, (160, 40, 25, 10)))
        self.assertEqual(self.measured()["input_tokens"], 50)
        before = self.state_bytes()
        self.config["source_version"] = "synthetic-v2-six-fields"
        with self.assertRaises(ControlError): self.call(self.frame(T3, (170, 50, 30, 11)))
        self.assertEqual(self.state_bytes(), before)

    def test_backwards_time_overlap_and_bad_second_event_preserve_atomic_existing_state(self):
        self.call(self.frame(), self.frame(T2, (150, 30, 20, 8)))
        before = self.state_bytes()
        for frames in [(self.frame(T1, (160, 40, 25, 10)),),
                       (self.frame(T3, (160, 40, 25, 10)), self.frame(T1, (170, 50, 30, 11)))]:
            with self.assertRaises(ControlError): self.call(*frames)
            self.assertEqual(self.state_bytes(), before)
        self.config["threads"][0]["counter_epoch"] = "epoch-overlap"
        with self.assertRaises(ControlError): self.call(self.frame(T1))
        self.assertEqual(self.state_bytes(), before)

    def test_parent_child_own_once_inclusive_and_unknown_are_separate(self):
        self.config["threads"] += [self.binding("child", "parent"), self.binding("inclusive", scope="includes-descendants"),
                                    self.binding("unknown", scope="unknown")]
        frames = []
        for identity in ("parent", "child", "inclusive", "unknown"):
            frames += [self.frame(identity=identity), self.frame(T1, (150, 30, 20, 8), identity)]
        self.call(*frames)
        value = usage.summary(self.root)
        self.assertEqual(value["known_own_subtotal"]["measured"]["input_tokens"], 100)
        self.assertEqual(value["unaggregated_scopes"]["includes-descendants"]["measured"]["input_tokens"], 50)
        self.assertEqual(value["unaggregated_scopes"]["unknown"]["measured"]["input_tokens"], 50)
        self.assertEqual(value["missing_reported_parents"], 0)

    def test_session_binding_unknown_thread_parent_cycle_and_duplicate_identity_refuse(self):
        self.write(self.frame())
        with self.assertRaises(ControlError): capture.capture(self.root, session="other-session", at=T3)
        with self.assertRaises(ControlError): self.call(self.frame(identity="not-selected"))
        self.config["threads"] += [self.binding("parent")]
        with self.assertRaises(ControlError): self.call()
        self.config["threads"] = [self.binding("parent", "child"), self.binding("child", "parent")]
        with self.assertRaises(ControlError): self.call()
        self.assertFalse((self.root / usage.BASE).exists())

    def test_changed_parent_on_duplicate_counters_is_refused(self):
        self.call(self.frame())
        before = self.state_bytes()
        self.config["threads"][0]["parent_thread_id"] = "different-parent"
        with self.assertRaises(ControlError): self.call(self.frame())
        self.assertEqual(self.state_bytes(), before)

    def test_feed_binding_and_unstable_file_refuse_without_echo_or_partial_counts(self):
        self.call(self.frame())
        before = self.state_bytes()
        self.write(self.frame(T1, (150, 30, 20, 8)))
        self.feed['source_version'] = 'wrong-version'
        (self.folder / 'feed.json').write_text(json.dumps(self.feed), encoding='utf-8')
        self.assertEqual(capture.session_start(self.root, session='selected-session', at=T3)['state'], 'unavailable')
        self.assertEqual(self.state_bytes(), before)
        self.write(self.frame(T1, (150, 30, 20, 8)))
        real_read = capture.read_json
        def changed(path, **options):
            value = real_read(path, **options)
            path.write_text(path.read_text(encoding='utf-8') + ' ', encoding='utf-8')
            return value
        with patch.object(capture, 'read_json', side_effect=changed):
            result = capture.session_start(self.root, session='selected-session', at=T3)
        self.assertEqual(result['reason_code'], 'capture.file-changed')
        self.assertFalse(result['live_capture'])
        self.assertEqual(self.state_bytes(), before)

    def test_subset_delta_overflow_and_scope_capacity_refuse_before_publication(self):
        self.call(self.frame())
        before = self.state_bytes()
        # Both cumulative samples are valid, but cached delta cannot exceed input delta.
        with self.assertRaises(ControlError): self.call(self.frame(T1, (110, 30, 30, 8)))
        self.assertEqual(self.state_bytes(), before)
        frame = self.frame(T1, (usage.MAX_NUMBER, 30, 20, 8))
        with self.assertRaises(ControlError): self.call(frame)
        self.assertEqual(self.state_bytes(), before)

    def test_receiver_refuses_changed_sequence_instead_of_retrying_or_double_counting(self):
        self.call(self.frame())
        before = self.state_bytes()
        self.write(self.frame(T1, (150, 30, 20, 8)))
        error = ControlError('usage.conflict', 'Fixed synthetic conflict.', {}, [])
        with patch.object(usage, 'import_observations', side_effect=error) as importer:
            result = capture.session_start(self.root, session='selected-session', at=T3)
        self.assertEqual(importer.call_count, 1)
        self.assertEqual(result['reason_code'], 'usage.conflict')
        self.assertTrue(result['work_may_continue'])
        self.assertFalse(result['live_capture'])
        self.assertEqual(self.state_bytes(), before)

    def test_strict_numeric_protocol_rejects_content_quota_synthetic_context_and_invalid_subsets(self):
        self.call(self.frame())
        before = self.state_bytes()
        for mutate in [lambda f: f.update(prompt="private-do-not-retain"),
                       lambda f: f["notification"]["params"].update(response="private-do-not-retain"),
                       lambda f: f["notification"]["params"]["tokenUsage"]["total"].update(totalTokens=200000, inputTokens=0, outputTokens=0, cachedInputTokens=0, reasoningOutputTokens=0),
                       lambda f: f["notification"]["params"]["tokenUsage"]["total"].update(cachedInputTokens=151),
                       lambda f: f["notification"]["params"]["tokenUsage"]["total"].update(reasoningOutputTokens=31),
                       lambda f: f["notification"]["params"]["tokenUsage"]["total"].update(inputTokens=True),
                       lambda f: f["notification"]["params"]["tokenUsage"]["total"].update(inputTokens=1.5),
                       lambda f: f["notification"]["params"]["tokenUsage"]["total"].update(inputTokens=-1),
                       lambda f: f["notification"].update(method="account/rateLimits/updated")]:
            frame = self.frame(T1, (150, 30, 20, 8)); mutate(frame)
            with self.assertRaises(ControlError): self.call(frame)
            self.assertEqual(self.state_bytes(), before)

    def test_batch_size_file_caps_malformed_and_wrong_version_are_nonblocking_redacted(self):
        self.call(self.frame())
        before = self.state_bytes()
        for frames in [[self.frame()] * 65, []]:
            self.write(*frames)
            if not frames:
                (self.folder / "feed.json").write_text("x" * (usage.MAX_INPUT_BYTES + 1))
            result = capture.session_start(self.root, session="selected-session", at=T3)
            self.assertEqual(result["state"], "unavailable")
            self.assertTrue(result["work_may_continue"])
            self.assertEqual(self.state_bytes(), before)
            self.assertNotIn("selected-session", json.dumps(result))
        self.config["protocol"] = "unsupported"
        self.write()
        self.assertEqual(capture.session_start(self.root, session="selected-session", at=T3)["state"], "unavailable")

    def test_contained_regular_files_only_and_no_external_path_echo(self):
        for name in ["../private.json", ".local-codex/token-capture/../outside.json", "C:/private.json", ".local-codex/token-capture/directory.json"]:
            if name.endswith("directory.json"): (self.folder / "directory.json").mkdir()
            value = capture.session_start(self.root, session="selected-session", config_path=name, at=T3)
            self.assertEqual(value["state"], "unavailable")
            self.assertNotIn(name, json.dumps(value))
        with patch.object(Path, "is_symlink", return_value=True):
            self.assertEqual(capture.session_start(self.root, session="selected-session")["state"], "unavailable")

    def test_numeric_state_cap_and_atomic_failure_do_not_publish_counts_or_claim_live(self):
        self.call(self.frame())
        before = self.state_bytes()
        self.write(self.frame(T1, (150, 30, 20, 8)))
        for target, effect in [("MAX_BYTES", 1), ("os.replace", OSError("private-path-never-echo"))]:
            manager = patch.object(usage, target, effect) if target == "MAX_BYTES" else patch("control_plane.storage.os.replace", side_effect=effect)
            with manager:
                value = capture.session_start(self.root, session="selected-session", at=T3)
            self.assertFalse(value["live_capture"])
            self.assertTrue(value["work_may_continue"])
            self.assertNotIn("private-path", json.dumps(value))
            self.assertEqual(self.state_bytes(), before)

    def test_sanitized_receipts_storage_and_public_cli_startup_do_not_expose_host_ids(self):
        result = self.call(self.frame(), self.frame(T1, (150, 30, 20, 8)))
        public = json.dumps(result) + self.state_bytes().decode()
        for identity in ("selected-session", "synthetic-turn", "synthetic-v2-six-fields"):
            self.assertNotIn(identity, public)
        script = Path(__file__).resolve().parents[1] / "development_control_plane.py"
        command = [sys.executable, "-B", str(script), "--repo", str(self.root), "usage", "session-start", "--session", "selected-session"]
        response = subprocess.run(command, capture_output=True, text=True, timeout=10)
        self.assertEqual(response.returncode, 0, response.stderr)
        self.assertTrue(json.loads(response.stdout)["data"]["work_may_continue"])
        self.assertFalse(json.loads(response.stdout)["data"]["live_capture"])


if __name__ == "__main__":
    unittest.main()
