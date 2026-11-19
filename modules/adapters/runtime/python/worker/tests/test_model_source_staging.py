"""Disposable real files with controlled provider/IO faults; no weights or network."""
from contextlib import ExitStack
import os
from pathlib import Path
from tempfile import TemporaryDirectory
from threading import Event, Lock, Thread
import time
import unittest
from unittest.mock import patch

from modules.adapters.runtime.python.worker.tasks import model_source_staging as staging
from modules.adapters.runtime.python.worker.tasks import model_source_transport as transport
from modules.adapters.runtime.python.worker.tasks import local_text_generation as download
from modules.adapters.runtime.python.worker.tasks.model_download_manifest import ModelDownloadManifestError, capture_manifest, verify_snapshot
from modules.adapters.runtime.python.worker.tests.test_model_download_manifest import fixture_manifest, REVISION
from modules.adapters.runtime.python.worker.tests.test_model_source_transport import Connection, Response


class ModelSourceStagingTests(unittest.TestCase):
    def setUp(self):
        self.stack = ExitStack(); self.addCleanup(self.stack.close)
        self.root = Path(self.stack.enter_context(TemporaryDirectory(prefix="model-stage-"))).resolve()
        self.retained = self.root / "retained-marker"; self.retained.write_bytes(b"do not change")
        self.data = {"config.json": b'{"model_type":"synthetic"}', "tokenizer.json": b'{"version":1}',
                     "model.safetensors": b"synthetic; not model weights"}
        self.manifest = capture_manifest(fixture_manifest(self.data), "fixture/model", REVISION)
        self.requests = []
        self.connections = []
        self.stack.enter_context(patch.object(staging, "_STAGING_SLOT", Lock()))
        self.stack.enter_context(patch.object(staging, "_RETAINED_STAGING", None))
        self.stack.enter_context(patch.object(transport, "_FILE_SLOT", Lock()))
        self.stack.enter_context(patch.object(transport, "_RETAINED_CONNECTION", None))
        self.stack.enter_context(patch.object(transport, "_lookup_public", return_value=("8.8.8.8",)))
        def connect(host, address, deadline):
            owner = self
            class FixtureConnection(Connection):
                def request(self, method, path, headers):
                    owner.requests.append(path)
                    self.response = Response(owner.data[path.rsplit("/", 1)[1]])
                    super().request(method, path, headers)
            connection = FixtureConnection(host, address, deadline, None)
            owner.connections.append(connection)
            return connection
        self.stack.enter_context(patch.object(transport, "_PinnedHttpsConnection", side_effect=connect))

    def stage(self, **options):
        return staging.stage_model_source(self.manifest, prepared_root=options.pop("prepared_root", self.root),
            maximum_payload_bytes=options.pop("maximum_payload_bytes", self.manifest.source.totalBytes),
            maximum_duration_seconds=options.pop("maximum_duration_seconds", 5), **options)

    def unchanged(self):
        self.assertEqual(list(self.root.iterdir()), [self.retained])
        self.assertEqual(self.retained.read_bytes(), b"do not change")
        self.assertFalse(staging._STAGING_SLOT.locked())

    def test_actual_selected_bytes_are_verified_under_private_root_then_only_owned_tree_is_removed(self):
        with patch.object(download, "_resolve_huggingface_cache_root", side_effect=AssertionError("No global root lookup")):
            with self.stage() as result:
                selected = result.snapshot_path
                self.assertEqual(result.manifest_digest, self.manifest.manifestDigest)
                self.assertEqual((result.size_bytes, result.file_count), (self.manifest.source.totalBytes, 3))
                self.assertEqual(selected.relative_to(result.cache_root).parts,
                    ("models--fixture--model", "snapshots", REVISION))
                self.assertEqual({p.name: p.read_bytes() for p in selected.iterdir()}, self.data)
                self.assertTrue(verify_snapshot(self.manifest, str(selected), private_cache_root=result.cache_root))
                self.assertTrue(staging._STAGING_SLOT.locked())
            self.assertFalse(selected.exists())
        self.assertEqual(len(self.requests), 3); self.unchanged()

    def test_invalid_payload_limits_and_unprepared_roots_deny_before_new_files_or_transport(self):
        for limit in [0, True, self.manifest.source.totalBytes - 1, 20 * 1024 ** 3 + 1]:
            with self.assertRaises(staging.ModelSourceStagingError):
                with self.stage(maximum_payload_bytes=limit): self.fail("No yield")
            self.unchanged()
        for root in [self.root / "missing", Path("."), self.retained]:
            with self.assertRaises(staging.ModelSourceStagingError):
                with self.stage(prepared_root=root): self.fail("No yield")
            self.unchanged()
        self.assertEqual(self.requests, [])

    def test_insufficient_declared_capacity_denies_before_staging(self):
        with patch.object(staging.shutil, "disk_usage", return_value=type("Disk", (), {"free": 1})()):
            with self.assertRaises(staging.ModelSourceStagingError):
                with self.stage(): self.fail("No yield")
        self.assertEqual(self.requests, []); self.unchanged()

    def test_held_read_only_consumer_retains_the_single_staging_lease(self):
        entered, released = Event(), Event(); errors = []
        def run():
            try:
                with self.stage(): entered.set(); released.wait(3)
            except Exception as error: errors.append(error)
        owner = Thread(target=run); owner.start()
        try:
            self.assertTrue(entered.wait(2)); before = len(self.requests)
            with self.assertRaises(staging.ModelSourceStagingError):
                with self.stage(): self.fail("No second owner")
            self.assertEqual(len(self.requests), before)
        finally:
            released.set(); owner.join(3)
        self.assertFalse(owner.is_alive()); self.assertEqual(errors, []); self.unchanged()

    def test_policy_withdrawal_while_final_precreation_callback_waits_creates_nothing_late(self):
        entered, released = Event(), Event(); current = True; count = 0; errors = []
        def policy():
            nonlocal count
            count += 1
            if count == 3: entered.set(); released.wait(3)
            return current
        def run():
            try:
                with self.stage(is_current=policy): self.fail("No yield")
            except Exception as error: errors.append(error)
        owner = Thread(target=run); owner.start()
        try:
            self.assertTrue(entered.wait(1)); current = False
        finally:
            released.set(); owner.join(3)
        self.assertFalse(owner.is_alive()); self.assertEqual(len(errors), 1)
        self.assertIsInstance(errors[0], staging.ModelSourceStagingError)
        self.assertEqual(self.requests, []); self.unchanged()

    def test_short_writes_preserve_exact_bytes_and_no_progress_cannot_yield(self):
        real_write = os.write
        with patch.object(staging.os, "write", side_effect=lambda fd, data: real_write(fd, data[:2])):
            with self.stage() as result:
                self.assertEqual({p.name: p.read_bytes() for p in result.snapshot_path.iterdir()}, self.data)
        self.unchanged()
        with patch.object(staging.os, "write", return_value=0):
            with self.assertRaises(staging.ModelSourceStagingError):
                with self.stage(): self.fail("No zero-progress yield")
        self.unchanged()

    def test_retirement_or_expiry_during_final_file_check_prevents_new_write_and_fsync(self):
        real_check = staging._Staging.check_file
        for action, target_count in [("cancel-write", 3), ("deadline-write", 3), ("cancel-fsync", 5)]:
            with self.subTest(action=action):
                calls = 0
                def held_check(owner, record):
                    nonlocal calls
                    real_check(owner, record); calls += 1
                    if calls == target_count:
                        if action == "deadline-write": time.sleep(1.05)
                        else: owner.session.cancel()
                with patch.object(staging._Staging, "check_file", held_check), \
                        patch.object(staging.os, "write", wraps=os.write) as write, \
                        patch.object(staging.os, "fsync", wraps=os.fsync) as sync:
                    with self.assertRaises(staging.ModelSourceStagingError):
                        with self.stage(maximum_duration_seconds=1 if action == "deadline-write" else 5):
                            self.fail("No late effect")
                if action.endswith("write"): write.assert_not_called()
                sync.assert_not_called(); self.unchanged()

    def test_retirement_during_containment_check_prevents_next_creation_or_open(self):
        real_check = staging._Staging.check_directories
        for count in [1, 4]:
            with self.subTest(known_directories=count):
                def retire(owner):
                    real_check(owner)
                    if len(owner.directories) == count: owner.session.cancel()
                with patch.object(staging._Staging, "check_directories", retire), \
                        patch.object(staging.os, "open", wraps=os.open) as opened:
                    with self.assertRaises(staging.ModelSourceStagingError):
                        with self.stage(): self.fail("No late create/open")
                opened.assert_not_called(); self.unchanged()

    def test_fsync_failure_and_consumer_exception_clean_only_settled_owned_entries(self):
        with patch.object(staging.os, "fsync", side_effect=OSError("synthetic private diagnostic")):
            with self.assertRaises(staging.ModelSourceStagingError) as error:
                with self.stage(): self.fail("No unsynced yield")
        self.assertNotIn("private diagnostic", str(error.exception)); self.unchanged()
        with self.assertRaises(staging.ModelSourceStagingError) as error:
            with self.stage(): raise ValueError("synthetic private consumer")
        self.assertNotIn("private consumer", str(error.exception)); self.unchanged()

    def test_uncertain_close_retains_known_stage_and_never_retries_reusable_descriptor(self):
        real_close = os.close; closed = []
        def uncertain_close(fd):
            closed.append(fd); real_close(fd)
            raise OSError("close acknowledgement unavailable")
        with patch.object(staging.os, "close", side_effect=uncertain_close):
            with self.assertRaises(staging.ModelSourceStagingError):
                with self.stage(): self.fail("No uncertain-close yield")
        self.assertEqual(len(closed), 1)
        owner = staging._RETAINED_STAGING
        self.assertIsNotNone(owner); self.assertTrue(owner.files[0].close_uncertain)
        self.assertTrue(owner.files[0].path.exists()); self.assertTrue(staging._STAGING_SLOT.locked())
        with self.assertRaises(staging.ModelSourceStagingError):
            with self.stage(): self.fail("No retry credit")
        self.assertEqual(len(closed), 1); self.assertEqual(self.retained.read_bytes(), b"do not change")

    def test_foreign_consumer_entry_prevents_all_cleanup_and_replacement_is_not_deleted(self):
        with self.assertRaises(staging.ModelSourceStagingError):
            with self.stage() as result:
                foreign = result.snapshot_path / "foreign.safetensors"; foreign.write_bytes(b"retain foreign")
        self.assertEqual(foreign.read_bytes(), b"retain foreign")
        self.assertEqual({p.name: p.read_bytes() for p in result.snapshot_path.iterdir() if p.name in self.data}, self.data)
        self.assertTrue(staging._STAGING_SLOT.locked())

    def test_replaced_file_and_renamed_parent_retain_instead_of_following_or_deleting(self):
        for kind in ["replacement", "renamed-parent"]:
            with self.subTest(kind=kind), patch.object(staging, "_STAGING_SLOT", Lock()):
                with self.assertRaises(staging.ModelSourceStagingError):
                    with self.stage() as result:
                        if kind == "replacement":
                            source = result.snapshot_path / "model.safetensors"
                            replacement = result.snapshot_path / "replacement.tmp"; replacement.write_bytes(b"foreign")
                            os.replace(replacement, source)
                        else:
                            source = result.snapshot_path.with_name("renamed-snapshot")
                            os.rename(result.snapshot_path, source)
                self.assertTrue(source.exists()); self.assertTrue(staging._STAGING_SLOT.locked())
                if kind == "replacement": self.assertEqual(source.read_bytes(), b"foreign")
        self.assertEqual(self.retained.read_bytes(), b"do not change")

    def test_changed_bytes_and_malicious_index_cannot_reach_consumer(self):
        self.data["model.safetensors"] = b"x" * len(self.data["model.safetensors"])
        with self.assertRaises(staging.ModelSourceStagingError):
            with self.stage(): self.fail("No corrupt yield")
        self.unchanged()
        self.data.pop("model.safetensors")
        self.data.update({"model-00001.safetensors": b"synthetic shard",
            "model.safetensors.index.json": b'{"weight_map":{"x":"../foreign.safetensors"}}'})
        self.manifest = capture_manifest(fixture_manifest(self.data), "fixture/model", REVISION)
        with self.assertRaises(staging.ModelSourceStagingError):
            with self.stage(): self.fail("No escaped index yield")
        self.unchanged()

    def test_unconfirmed_transport_settlement_retains_stage_without_cleanup_credit(self):
        with patch.object(transport.ModelSourceTransferSession, "transfer_file",
                          side_effect=transport.ModelSourceTransferError("close_unconfirmed")):
            with self.assertRaises(staging.ModelSourceStagingError):
                with self.stage(): self.fail("No yield")
        owner = staging._RETAINED_STAGING
        self.assertIsNotNone(owner); self.assertTrue(owner.files[0].path.exists())
        self.assertTrue(staging._STAGING_SLOT.locked())

    def test_hard_link_outside_owned_tree_prevents_cleanup_of_linked_file(self):
        with self.assertRaises(staging.ModelSourceStagingError):
            with self.stage() as result:
                original = result.snapshot_path / "model.safetensors"
                linked = self.root / "retained-linked-file"
                os.link(original, linked)
        self.assertEqual(original.read_bytes(), self.data["model.safetensors"])
        self.assertEqual(linked.read_bytes(), self.data["model.safetensors"])
        self.assertTrue(staging._STAGING_SLOT.locked())

    def test_stalled_native_write_keeps_custody_until_actual_settlement_then_safe_cleanup(self):
        real_write = os.write; entered, released = Event(), Event(); errors = []
        def held_write(fd, data):
            entered.set(); released.wait(4)
            return real_write(fd, data)
        def run():
            try:
                with self.stage(maximum_duration_seconds=1): self.fail("No late consumer")
            except Exception as error: errors.append(error)
        with patch.object(staging.os, "write", side_effect=held_write):
            owner = Thread(target=run); owner.start()
            try:
                self.assertTrue(entered.wait(1))
                self.assertTrue(self.connections[-1].aborted.wait(2))
                self.assertTrue(staging._STAGING_SLOT.locked()); self.assertTrue(transport._FILE_SLOT.locked())
                before = len(self.requests)
                with self.assertRaises(staging.ModelSourceStagingError):
                    with self.stage(): self.fail("No second owner")
                self.assertEqual(len(self.requests), before)
                self.assertTrue(any(path.name.startswith(".model-source-") for path in self.root.iterdir()))
            finally:
                released.set(); owner.join(3)
        self.assertFalse(owner.is_alive()); self.assertEqual(len(errors), 1)
        self.assertIsInstance(errors[0], staging.ModelSourceStagingError); self.unchanged()

    def test_shared_integrity_fence_refuses_late_hash_and_preserves_global_root_semantics(self):
        with self.stage() as result:
            calls = 0
            def fence():
                nonlocal calls
                calls += 1
                if calls == 4: raise ValueError("current authority ended")
            with self.assertRaises(ModelDownloadManifestError):
                verify_snapshot(self.manifest, str(result.snapshot_path), private_cache_root=result.cache_root, fence=fence)
            self.assertEqual(calls, 4)
            with patch.object(download, "_resolve_huggingface_cache_root", return_value=result.cache_root) as resolver:
                self.assertTrue(verify_snapshot(self.manifest, str(result.snapshot_path)))
                resolver.assert_called_once_with()
        self.unchanged()

    def test_integrity_fence_rejects_truthy_or_async_acknowledgement_before_file_open(self):
        async def pending(): return None
        with self.stage() as result:
            for fence in [lambda: True, lambda: pending()]:
                with patch.object(os, "open", wraps=os.open) as opened:
                    with self.assertRaises(ModelDownloadManifestError):
                        verify_snapshot(self.manifest, str(result.snapshot_path), private_cache_root=result.cache_root, fence=fence)
                opened.assert_not_called()
        self.unchanged()


if __name__ == "__main__":
    unittest.main()
