"""Real same-volume paired files with controlled effects; no task/provider/native pass."""
from dataclasses import asdict
import errno
import json
import os
from pathlib import Path
from threading import Event, Thread
import time
import unittest
from unittest.mock import patch

from modules.adapters.runtime.python.worker.tasks import model_source_handoff as handoff
from modules.adapters.runtime.python.worker.tasks import model_source_staging as staging

TASK = "11111111-1111-4111-8111-111111111111"
NONCE = "22222222-2222-4222-8222-222222222222"


class ModelSourceHandoffTests(unittest.TestCase):
    def setUp(self):
        from modules.adapters.runtime.python.worker.tests.test_model_source_staging import ModelSourceStagingTests
        self.fixture = ModelSourceStagingTests("test_actual_selected_bytes_are_verified_under_private_root_then_only_owned_tree_is_removed")
        self.fixture.setUp(); self.addCleanup(self.fixture.doCleanups)
        self.root = self.fixture.root / "private-receiver"; self.root.mkdir()
        self.current = True; self.observed = []
        self.observe = lambda receipt: self.observed.append(receipt) is None
        self.recipient = handoff.capture_model_source_recipient(self.root, task_id=TASK, handoff_id=NONCE,
            is_current=lambda: self.current, observe_acknowledgement=lambda receipt: self.observe(receipt))

    @property
    def snapshot(self):
        return self.root / NONCE / "models--fixture--model" / "snapshots" / self.fixture.manifest.source.revision

    def assert_bytes(self):
        self.assertEqual({p.name: p.read_bytes() for p in self.snapshot.iterdir()}, self.fixture.data)

    def retained(self, source):
        self.assertTrue(source.exists()); self.assertTrue(staging._STAGING_SLOT.locked())
        self.assertEqual(self.fixture.retained.read_bytes(), b"do not change")

    def test_complete_real_handoff_is_exclusive_same_inode_read_only_then_source_cleanup(self):
        with self.fixture.stage() as staged:
            source = staged.snapshot_path
            transfer = handoff.ModelSourceHandoff(staged, self.recipient)
            self.assertFalse(transfer.acknowledged); self.assertEqual(self.observed, [])
            encoded = json.dumps(asdict(transfer.receipt))
            self.assertNotIn(str(self.fixture.root), encoded); self.assertNotIn("synthetic", encoded)
            self.assertEqual((transfer.receipt.task_id, transfer.receipt.handoff_id), (TASK, NONCE))
            self.assertEqual(transfer.receipt.manifest_digest, staged.manifest_digest)
            for name in self.fixture.data:
                self.assertEqual((source / name).stat().st_ino, (self.snapshot / name).stat().st_ino)
                self.assertEqual((self.snapshot / name).stat().st_nlink, 2)
            self.assert_bytes()
            transfer.acknowledge()
            self.assertTrue(transfer.acknowledged); self.assertEqual(self.observed, [transfer.receipt])
            self.assertTrue(all(not (source / name).exists() for name in self.fixture.data))
            self.assertTrue(all(path.stat().st_nlink == 1 for path in self.snapshot.iterdir()))
        self.assertFalse(staged.cache_root.exists()); self.assertFalse(staging._STAGING_SLOT.locked())
        self.assert_bytes()

    def test_result_without_receiver_ack_retains_both_trees_and_custody(self):
        with self.assertRaises(staging.ModelSourceStagingError):
            with self.fixture.stage() as staged:
                source = staged.snapshot_path
                transfer = handoff.ModelSourceHandoff(staged, self.recipient)
        self.retained(source); self.assert_bytes(); self.assertFalse(transfer.acknowledged)
        with self.assertRaises(handoff.ModelSourceHandoffError): transfer.acknowledge()
        self.assertTrue(all((source / name).exists() for name in self.fixture.data))

    def test_changed_receipt_cannot_be_used_as_an_ack_echo(self):
        with self.assertRaises(staging.ModelSourceStagingError):
            with self.fixture.stage() as staged:
                transfer = handoff.ModelSourceHandoff(staged, self.recipient)
                object.__setattr__(transfer.receipt, "task_id", "33333333-3333-4333-8333-333333333333")
                with self.assertRaises(handoff.ModelSourceHandoffError): transfer.acknowledge()
                source = staged.snapshot_path
        self.assertEqual(self.observed, []); self.retained(source); self.assert_bytes()

    def test_truthy_observer_cannot_grant_receiver_ack(self):
        self.observe = lambda _: 1
        with self.assertRaises(staging.ModelSourceStagingError):
            with self.fixture.stage() as staged:
                transfer = handoff.ModelSourceHandoff(staged, self.recipient)
                with self.assertRaises(handoff.ModelSourceHandoffError): transfer.acknowledge()
        self.retained(staged.snapshot_path); self.assert_bytes()

    def test_async_observer_cannot_grant_receiver_ack(self):
        async def pending(_): return True
        self.observe = pending
        with self.assertRaises(staging.ModelSourceStagingError):
            with self.fixture.stage() as staged:
                transfer = handoff.ModelSourceHandoff(staged, self.recipient)
                with self.assertRaises(handoff.ModelSourceHandoffError): transfer.acknowledge()
        self.retained(staged.snapshot_path); self.assert_bytes()

    def test_receiver_identity_mutation_during_observation_cannot_grant_ack(self):
        def mutate(_):
            object.__setattr__(self.recipient, "handoff_id", "33333333-3333-4333-8333-333333333333")
            return True
        self.observe = mutate
        with self.assertRaises(staging.ModelSourceStagingError):
            with self.fixture.stage() as staged:
                transfer = handoff.ModelSourceHandoff(staged, self.recipient)
                with self.assertRaises(handoff.ModelSourceHandoffError): transfer.acknowledge()
        self.retained(staged.snapshot_path); self.assert_bytes()

    def test_receipt_mutation_inside_observer_cannot_grant_source_unlink(self):
        def mutate(receipt):
            object.__setattr__(receipt, "manifest_digest", "sha256:" + "b" * 64)
            return True
        self.observe = mutate
        with self.assertRaises(staging.ModelSourceStagingError):
            with self.fixture.stage() as staged:
                transfer = handoff.ModelSourceHandoff(staged, self.recipient)
                with patch.object(handoff.os, "unlink", wraps=os.unlink) as unlink:
                    with self.assertRaises(handoff.ModelSourceHandoffError): transfer.acknowledge()
                unlink.assert_not_called()
        self.retained(staged.snapshot_path); self.assert_bytes()

    def test_one_use_reservation_precedes_held_callback_and_competing_recipient_effects(self):
        entered, released = Event(), Event(); hold = False; held = False; transfers = []; errors = []
        def current():
            nonlocal held
            if hold and not held:
                held = True; entered.set(); released.wait(3)
            return True
        recipient = handoff.capture_model_source_recipient(self.root, task_id=TASK, handoff_id=NONCE,
            is_current=current, observe_acknowledgement=lambda value: self.observe(value))
        second_root = self.fixture.root / "second-receiver"; second_root.mkdir()
        second = handoff.capture_model_source_recipient(second_root, task_id=TASK,
            handoff_id="33333333-3333-4333-8333-333333333333", is_current=lambda: True,
            observe_acknowledgement=lambda _: True)
        with self.fixture.stage() as staged:
            def run():
                try: transfers.append(handoff.ModelSourceHandoff(staged, recipient))
                except Exception as error: errors.append(error)
            hold = True
            with patch.object(handoff.os, "mkdir", wraps=os.mkdir) as mkdir, patch.object(handoff.os, "link", wraps=os.link) as linked:
                owner = Thread(target=run); owner.start()
                try:
                    self.assertTrue(entered.wait(1))
                    first_owner = staged._custodian.handoff
                    with self.assertRaises(handoff.ModelSourceHandoffError): handoff.ModelSourceHandoff(staged, second)
                    self.assertIs(staged._custodian.handoff, first_owner)
                    mkdir.assert_not_called(); linked.assert_not_called()
                finally:
                    released.set(); owner.join(3)
                self.assertFalse(owner.is_alive()); self.assertEqual(errors, []); self.assertEqual(len(transfers), 1)
                self.assertEqual(linked.call_count, 3)
                self.assertTrue(all(Path(call.args[0]).is_relative_to(self.root) for call in mkdir.call_args_list))
            transfers[0].acknowledge()
        self.assertEqual(list(second_root.iterdir()), []); self.assertFalse(staging._STAGING_SLOT.locked()); self.assert_bytes()

    def test_retirement_in_ack_callback_prevents_all_source_unlinks(self):
        def retire(_): self.current = False; return True
        self.observe = retire
        with self.assertRaises(staging.ModelSourceStagingError):
            with self.fixture.stage() as staged:
                transfer = handoff.ModelSourceHandoff(staged, self.recipient)
                with patch.object(handoff.os, "unlink", wraps=os.unlink) as unlink:
                    with self.assertRaises(handoff.ModelSourceHandoffError): transfer.acknowledge()
                unlink.assert_not_called()
        self.retained(staged.snapshot_path); self.assert_bytes()

    def test_extra_hardlink_cannot_be_admitted_as_the_paired_receiver(self):
        with self.assertRaises(staging.ModelSourceStagingError):
            with self.fixture.stage() as staged:
                transfer = handoff.ModelSourceHandoff(staged, self.recipient)
                os.link(self.snapshot / "model.safetensors", self.fixture.root / "third-link")
                with self.assertRaises(handoff.ModelSourceHandoffError): transfer.acknowledge()
        self.retained(staged.snapshot_path); self.assert_bytes()

    def test_shared_byte_mutation_is_not_immutable_model_authority(self):
        with self.assertRaises(staging.ModelSourceStagingError):
            with self.fixture.stage() as staged:
                transfer = handoff.ModelSourceHandoff(staged, self.recipient)
                target = self.snapshot / "model.safetensors"; before = target.stat()
                target.write_bytes(b"x" * before.st_size)
                os.utime(target, ns=(before.st_atime_ns, before.st_mtime_ns))
                with self.assertRaises(handoff.ModelSourceHandoffError): transfer.acknowledge()
        self.retained(staged.snapshot_path)
        self.assertEqual(target.read_bytes(), b"x" * before.st_size)

    def test_preexisting_recipient_data_is_never_adopted_or_removed(self):
        foreign = self.root / "foreign"; foreign.write_bytes(b"retain")
        with self.fixture.stage() as staged:
            with patch.object(handoff.os, "link", wraps=os.link) as linked:
                with self.assertRaises(handoff.ModelSourceHandoffError): handoff.ModelSourceHandoff(staged, self.recipient)
            linked.assert_not_called()
        self.assertFalse(staging._STAGING_SLOT.locked()); self.assertEqual(foreign.read_bytes(), b"retain")

    def test_atomic_occupied_file_refusal_never_deletes_or_overwrites_foreign_target(self):
        real_link = os.link
        def collide(source, target, **options):
            Path(target).write_bytes(b"foreign occupied file")
            return real_link(source, target, **options)
        with self.assertRaises(staging.ModelSourceStagingError):
            with self.fixture.stage() as staged:
                with patch.object(handoff.os, "link", side_effect=collide) as linked:
                    with self.assertRaises(handoff.ModelSourceHandoffError): handoff.ModelSourceHandoff(staged, self.recipient)
                self.assertEqual(linked.call_count, 1)
        self.retained(staged.snapshot_path)
        self.assertEqual((self.snapshot / "config.json").read_bytes(), b"foreign occupied file")
        self.assertEqual({p.name: p.read_bytes() for p in staged.snapshot_path.iterdir()}, self.fixture.data)

    def test_cross_volume_error_has_no_copy_or_overwrite_fallback(self):
        with self.assertRaises(staging.ModelSourceStagingError):
            with self.fixture.stage() as staged:
                with patch.object(handoff.os, "link", side_effect=OSError(errno.EXDEV, "controlled cross-device")) as linked:
                    with self.assertRaises(handoff.ModelSourceHandoffError): handoff.ModelSourceHandoff(staged, self.recipient)
                self.assertEqual(linked.call_count, 1)
        self.retained(staged.snapshot_path); self.assertEqual(list(self.snapshot.iterdir()), [])

    def test_link_effect_then_thrown_acknowledgement_retains_without_retry(self):
        real_link = os.link
        def uncertain(source, target, **options):
            real_link(source, target, **options)
            raise OSError("controlled lost link acknowledgement")
        with self.assertRaises(staging.ModelSourceStagingError):
            with self.fixture.stage() as staged:
                with patch.object(handoff.os, "link", side_effect=uncertain) as linked:
                    with self.assertRaises(handoff.ModelSourceHandoffError): handoff.ModelSourceHandoff(staged, self.recipient)
                self.assertEqual(linked.call_count, 1)
        self.retained(staged.snapshot_path)
        self.assertEqual((self.snapshot / "config.json").read_bytes(), self.fixture.data["config.json"])
        self.assertEqual((staged.snapshot_path / "config.json").stat().st_nlink, 2)

    def test_mid_manifest_link_failure_cannot_produce_a_complete_receipt(self):
        real_link = os.link; count = 0
        def partial(source, target, **options):
            nonlocal count
            count += 1
            if count == 2: raise OSError("controlled second file failure")
            return real_link(source, target, **options)
        with self.assertRaises(staging.ModelSourceStagingError):
            with self.fixture.stage() as staged:
                with patch.object(handoff.os, "link", side_effect=partial):
                    with self.assertRaises(handoff.ModelSourceHandoffError): handoff.ModelSourceHandoff(staged, self.recipient)
                self.assertIsNone(staged._custodian.handoff.receipt)
        self.retained(staged.snapshot_path); self.assertEqual(count, 2)
        self.assertEqual(len(list(self.snapshot.iterdir())), 1)

    def test_unlink_effect_then_thrown_acknowledgement_never_retries_or_deletes_receiver(self):
        real_unlink = os.unlink; count = 0
        def uncertain(path, *args, **options):
            nonlocal count
            count += 1; real_unlink(path, *args, **options)
            raise OSError("controlled lost unlink acknowledgement")
        with self.assertRaises(staging.ModelSourceStagingError):
            with self.fixture.stage() as staged:
                transfer = handoff.ModelSourceHandoff(staged, self.recipient)
                with patch.object(handoff.os, "unlink", side_effect=uncertain):
                    with self.assertRaises(handoff.ModelSourceHandoffError): transfer.acknowledge()
                    with self.assertRaises(handoff.ModelSourceHandoffError): transfer.acknowledge()
        self.assertEqual(count, 1); self.assertFalse(transfer.acknowledged)
        self.assert_bytes(); self.retained(staged.snapshot_path)
        self.assertEqual(len(list(staged.snapshot_path.iterdir())), 2)

    def test_unlink_refusal_preserves_all_source_and_recipient_names(self):
        with self.assertRaises(staging.ModelSourceStagingError):
            with self.fixture.stage() as staged:
                transfer = handoff.ModelSourceHandoff(staged, self.recipient)
                with patch.object(handoff.os, "unlink", side_effect=OSError("controlled refusal")) as unlink:
                    with self.assertRaises(handoff.ModelSourceHandoffError): transfer.acknowledge()
                self.assertEqual(unlink.call_count, 1)
        self.retained(staged.snapshot_path); self.assert_bytes()
        self.assertEqual(len(list(staged.snapshot_path.iterdir())), 3)

    def test_retirement_after_final_source_metadata_prevents_any_new_link(self):
        real_check = staging._Staging.check_file; calls = 0
        def retire(owner, record):
            nonlocal calls
            real_check(owner, record); calls += 1
            if calls == 4: owner.session.cancel()
        with self.assertRaises(staging.ModelSourceStagingError):
            with self.fixture.stage() as staged:
                with patch.object(staging._Staging, "check_file", retire), patch.object(handoff.os, "link", wraps=os.link) as linked:
                    with self.assertRaises(handoff.ModelSourceHandoffError): handoff.ModelSourceHandoff(staged, self.recipient)
                linked.assert_not_called()
        self.retained(staged.snapshot_path); self.assertEqual(list(self.snapshot.iterdir()), [])

    def test_retirement_during_final_ack_metadata_prevents_new_source_unlink(self):
        with self.assertRaises(staging.ModelSourceStagingError):
            with self.fixture.stage() as staged:
                transfer = handoff.ModelSourceHandoff(staged, self.recipient)
                real_check = transfer._check_pairs; calls = 0
                def retire():
                    nonlocal calls
                    real_check(); calls += 1
                    if calls == 3: self.current = False
                with patch.object(transfer, "_check_pairs", retire), patch.object(handoff.os, "unlink", wraps=os.unlink) as unlink:
                    with self.assertRaises(handoff.ModelSourceHandoffError): transfer.acknowledge()
                unlink.assert_not_called()
        self.retained(staged.snapshot_path); self.assert_bytes()

    def test_stalled_ack_keeps_custody_then_permits_only_owned_cleanup_after_egress_deadline(self):
        entered, released = Event(), Event(); errors = []
        def observe(_): entered.set(); released.wait(4); return True
        self.observe = observe
        def run():
            try:
                with self.fixture.stage(maximum_duration_seconds=1) as staged:
                    transfer = handoff.ModelSourceHandoff(staged, self.recipient)
                    transfer.acknowledge()
            except Exception as error: errors.append(error)
        owner = Thread(target=run); owner.start()
        try:
            self.assertTrue(entered.wait(1)); time.sleep(1.05)
            self.assertTrue(staging._STAGING_SLOT.locked())
            with self.assertRaises(staging.ModelSourceStagingError):
                with self.fixture.stage(): self.fail("No replacement owner")
            self.assertTrue(all(p.stat().st_nlink == 2 for p in self.snapshot.iterdir()))
        finally:
            released.set(); owner.join(3)
        self.assertFalse(owner.is_alive()); self.assertEqual(errors, [])
        self.assertFalse(staging._STAGING_SLOT.locked()); self.assert_bytes()
        self.assertTrue(all(p.stat().st_nlink == 1 for p in self.snapshot.iterdir()))

    def test_competing_ack_cannot_enter_observer_or_source_unlink_twice(self):
        entered, released = Event(), Event(); observed = []; errors = []
        def observe(receipt):
            observed.append(receipt); entered.set(); released.wait(3); return True
        self.observe = observe
        with self.fixture.stage() as staged:
            transfer = handoff.ModelSourceHandoff(staged, self.recipient)
            def run():
                try: transfer.acknowledge()
                except Exception as error: errors.append(error)
            with patch.object(handoff.os, "unlink", wraps=os.unlink) as unlink:
                owner = Thread(target=run); owner.start()
                try:
                    self.assertTrue(entered.wait(1))
                    with self.assertRaises(handoff.ModelSourceHandoffError): transfer.acknowledge()
                    unlink.assert_not_called(); self.assertEqual(len(observed), 1)
                finally:
                    released.set(); owner.join(3)
                self.assertFalse(owner.is_alive()); self.assertEqual(errors, [])
                self.assertEqual(unlink.call_count, 3)
            self.assertTrue(transfer.acknowledged)
        self.assertFalse(staging._STAGING_SLOT.locked()); self.assert_bytes()

    def test_closing_context_during_final_creation_callback_retains_custody_and_prevents_late_effect(self):
        entered, released = Event(), Event(); holder = []; errors = []; held = False
        def current():
            nonlocal held
            transfer = holder[0]._custodian.handoff if holder else None
            if transfer and len(transfer._directories) == 1 and transfer._directories[0].identity is None and not held:
                held = True; entered.set(); released.wait(3)
            return True
        recipient = handoff.capture_model_source_recipient(self.root, task_id=TASK, handoff_id=NONCE,
            is_current=current, observe_acknowledgement=lambda _: True)
        def run():
            try: handoff.ModelSourceHandoff(holder[0], recipient)
            except Exception as error: errors.append(error)
        owner = None
        with patch.object(handoff.os, "mkdir", wraps=os.mkdir) as mkdir:
            try:
                with self.assertRaises(staging.ModelSourceStagingError):
                    with self.fixture.stage() as staged:
                        holder.append(staged); mkdir.reset_mock()
                        owner = Thread(target=run); owner.start()
                        self.assertTrue(entered.wait(1))
                self.assertTrue(staging._STAGING_SLOT.locked())
                self.assertTrue(staged.snapshot_path.exists())
            finally:
                released.set()
                if owner: owner.join(3)
        self.assertFalse(owner.is_alive()); self.assertEqual(len(errors), 1)
        self.assertIsInstance(errors[0], handoff.ModelSourceHandoffError)
        mkdir.assert_not_called(); self.assertEqual(list(self.root.iterdir()), [])
        self.retained(staged.snapshot_path)

    def test_foreign_source_entry_prevents_source_cleanup_before_any_unlink(self):
        with self.assertRaises(staging.ModelSourceStagingError):
            with self.fixture.stage() as staged:
                transfer = handoff.ModelSourceHandoff(staged, self.recipient)
                foreign = staged.snapshot_path / "foreign.txt"; foreign.write_bytes(b"retain unknown")
                with patch.object(handoff.os, "unlink", wraps=os.unlink) as unlink:
                    with self.assertRaises(handoff.ModelSourceHandoffError): transfer.acknowledge()
                unlink.assert_not_called()
        self.retained(staged.snapshot_path); self.assert_bytes()
        self.assertEqual(foreign.read_bytes(), b"retain unknown")

    def test_renamed_recipient_parent_is_not_followed_or_adopted(self):
        with self.assertRaises(staging.ModelSourceStagingError):
            with self.fixture.stage() as staged:
                transfer = handoff.ModelSourceHandoff(staged, self.recipient)
                moved = self.root.with_name("renamed-private-receiver"); os.rename(self.root, moved)
                with self.assertRaises(handoff.ModelSourceHandoffError): transfer.acknowledge()
        self.retained(staged.snapshot_path); self.assertTrue((moved / NONCE).exists())

    def test_closed_source_context_cannot_start_a_new_handoff(self):
        with self.fixture.stage() as staged: pass
        with patch.object(handoff.os, "link", wraps=os.link) as linked:
            with self.assertRaises(handoff.ModelSourceHandoffError): handoff.ModelSourceHandoff(staged, self.recipient)
        linked.assert_not_called(); self.assertEqual(list(self.root.iterdir()), [])
        self.assertFalse(staging._STAGING_SLOT.locked())

    def test_uncaptured_recipient_data_cannot_become_host_authority(self):
        fake = handoff.ModelSourceRecipient(TASK, NONCE, self.root, (), lambda: True, lambda _: True)
        with self.fixture.stage() as staged:
            with self.assertRaises(handoff.ModelSourceHandoffError): handoff.ModelSourceHandoff(staged, fake)
        self.assertEqual(list(self.root.iterdir()), []); self.assertFalse(staging._STAGING_SLOT.locked())

    def test_duplicate_ack_has_no_new_effect_and_does_not_reopen_the_completed_source(self):
        with self.fixture.stage() as staged:
            transfer = handoff.ModelSourceHandoff(staged, self.recipient); transfer.acknowledge()
            with patch.object(handoff.os, "unlink", wraps=os.unlink) as unlink:
                with self.assertRaises(handoff.ModelSourceHandoffError): transfer.acknowledge()
            unlink.assert_not_called()
        self.assertEqual(len(self.observed), 1); self.assertFalse(staging._STAGING_SLOT.locked()); self.assert_bytes()


if __name__ == "__main__":
    unittest.main()
