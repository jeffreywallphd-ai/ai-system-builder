"""Authenticated ASGI + real disposable-file task custody; no provider or Model load."""
from concurrent.futures import ThreadPoolExecutor
from contextlib import ExitStack, redirect_stdout
import io
import json
import os
from pathlib import Path
import tempfile
import time
from threading import Event, Thread
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient
from modules.adapters.runtime.python.worker import app as worker
from modules.adapters.runtime.python.worker.models import StartPythonRuntimeTaskRequest
from modules.adapters.runtime.python.worker.tasks import model_source_task as source
from modules.adapters.runtime.python.worker.tasks import model_source_handoff as handoff
from modules.adapters.runtime.python.worker.tasks import model_source_staging as staging

TASK = "11111111-1111-4111-8111-111111111111"
ACQUISITION = "44444444-4444-4444-8444-444444444444"
HANDOFF = "22222222-2222-4222-8222-222222222222"
WORKSPACE = "33333333-3333-4333-8333-333333333333"
AUTH = "synthetic-model-source-runtime"


class ModelSourceTaskTests(unittest.TestCase):
    def setUp(self):
        from modules.adapters.runtime.python.worker.tests.test_model_source_staging import ModelSourceStagingTests
        self.fixture = ModelSourceStagingTests("test_actual_selected_bytes_are_verified_under_private_root_then_only_owned_tree_is_removed")
        # Retain the long native spelling for this owned test tree's cleanup.
        with patch.object(tempfile, "tempdir", str(source._private_io_path(Path(tempfile.gettempdir())))):
            self.fixture.setUp()
        self.stack = ExitStack()
        self.executor = ThreadPoolExecutor(max_workers=1)
        self.cache = self.fixture.root / "cache"; self.cache.mkdir()
        self.root = self.cache / source.NAMESPACE / ACQUISITION; self.root.mkdir(parents=True)
        self.sender, self.receiver = self.root / "source", self.root / "receiver"
        self.sender.mkdir(); self.receiver.mkdir()
        def identity(path):
            facts = path.lstat(); return {"device": str(facts.st_dev), "inode": str(facts.st_ino)}
        self.payload = {"provider": "transformers", "modelId": "fixture/model",
            "revision": self.fixture.manifest.source.revision, "sourceManifest": self.fixture.manifest.model_dump(mode="json"),
            "sourceTransfer": {"version": "model-source-transfer-v1", "acquisitionId": ACQUISITION, "handoffId": HANDOFF,
                "roots": {"acquisition": identity(self.root), "source": identity(self.sender), "receiver": identity(self.receiver)},
                "maximumDurationSeconds": 10, "allowedOrigins": ["https://huggingface.co"]}}
        configured_cache = str(self.cache)
        if configured_cache.startswith("\\\\?\\UNC\\"):
            configured_cache = "\\\\" + configured_cache[8:]
        elif configured_cache.startswith("\\\\?\\"):
            configured_cache = configured_cache[4:]
        # Production receives the ordinary configured spelling and must handle
        # its own private extended-length IO boundary.
        self.stack.enter_context(patch.object(source, "_resolve_huggingface_cache_root", return_value=Path(configured_cache)))
        self.stack.enter_context(patch.object(worker, "RUNTIME_AUTH_TOKEN", AUTH))
        self.stack.enter_context(patch.object(worker, "TASK_REGISTRY", {}))
        self.stack.enter_context(patch.object(worker, "TASK_EXECUTOR", self.executor))
        self.stack.enter_context(patch.object(worker, "MODEL_UNLOAD_IN_PROGRESS", False))
        self.client = TestClient(worker.app, headers={"Authorization": "Bearer " + AUTH})
        self.client.__enter__()
        self.addCleanup(self.close_fixture)

    def close_fixture(self):
        self.executor.shutdown(wait=True, cancel_futures=True)
        for record in tuple(worker.TASK_REGISTRY.values()):
            owner = record.get("_modelSourceOwner")
            if isinstance(owner, source.ModelSourceTaskOwner):
                try: owner._finish_context()
                except Exception: pass
        self.client.__exit__(None, None, None)
        self.stack.close(); self.fixture.doCleanups()

    @property
    def snapshot(self):
        return self.receiver / HANDOFF / "models--fixture--model" / "snapshots" / self.fixture.manifest.source.revision

    def start(self, payload=None):
        return self.client.post("/tasks/start", json={"requestId": TASK, "taskType": "ensure-model-download",
            "payload": self.payload if payload is None else payload, "metadata": {"workspaceId": WORKSPACE}})

    def finished(self):
        worker.TASK_REGISTRY[TASK]["future"].result(timeout=4)
        return self.client.get("/tasks/" + TASK).json()

    def private_status(self):
        return self.client.get("/tasks/" + TASK + "/model-source").json()

    def ack_body(self, phase="receiver-observed"):
        receipt = self.private_status()["receipt"]
        return {"phase": phase, "acquisitionId": ACQUISITION, "handoffId": HANDOFF,
            "receiptDigest": receipt["receipt_digest"], "recipientWitness": receipt["recipient_witness"]}

    def acknowledge(self, body=None):
        return self.client.post("/tasks/" + TASK + "/model-source/acknowledgement",
            json=self.ack_body() if body is None else body)

    def owner(self):
        return worker.TASK_REGISTRY[TASK]["_modelSourceOwner"]

    def complete(self):
        self.assertEqual(self.acknowledge().json()["phase"], "acknowledged")
        self.assertEqual(self.acknowledge(self.ack_body("receiver-settled")).json()["phase"], "released")

    def test_real_async_transfer_ack_and_receiver_settlement_keep_distinct_custody(self):
        with patch.object(worker, "ensure_generation_model_downloaded") as ordinary:
            started = self.start()
            self.assertEqual(started.status_code, 200); self.assertTrue(started.json()["accepted"])
            done = self.finished()
        ordinary.assert_not_called(); self.assertEqual(done["status"], "succeeded")
        encoded = json.dumps(done)
        for private in [str(self.fixture.root), ACQUISITION, HANDOFF, "_modelSourceOwner", "receipt_digest"]:
            self.assertNotIn(private, encoded)
        self.assertEqual(done["data"]["kind"], "model-source-staged")
        self.assertNotIn("modelHandle", done["data"]); self.assertTrue(staging._STAGING_SLOT.locked())
        self.assertEqual({p.name: p.read_bytes() for p in self.snapshot.iterdir()}, self.fixture.data)
        self.assertTrue(all(p.stat().st_nlink == 2 for p in self.snapshot.iterdir()))
        self.assertEqual(worker._active_task_count(), 1)
        self.assertEqual(self.acknowledge().json()["phase"], "acknowledged")
        self.assertFalse(staging._STAGING_SLOT.locked()); self.assertEqual(list(self.sender.iterdir()), [])
        self.assertTrue(all(p.stat().st_nlink == 1 for p in self.snapshot.iterdir()))
        self.assertEqual(worker._active_task_count(), 1)  # Protect ACK outcome until receiver finishes.
        self.assertEqual(self.acknowledge(self.ack_body("receiver-settled")).json()["phase"], "released")
        self.assertEqual(worker._active_task_count(), 0)

    def test_launch_authentication_denies_private_routes_without_body_disclosure(self):
        for path in ["/tasks/" + TASK + "/model-source", "/tasks/" + TASK + "/model-source/acknowledgement"]:
            self.assertEqual(self.client.request("POST" if path.endswith("acknowledgement") else "GET",
                path, headers={"Authorization": "Bearer wrong"}, content=b"private-marker").status_code, 401)
        with patch.object(worker, "RUNTIME_AUTH_TOKEN", ""):
            self.assertEqual(self.client.get("/tasks/" + TASK + "/model-source").status_code, 503)
        self.assertEqual(worker.TASK_REGISTRY, {}); self.assertEqual(self.fixture.requests, [])

    def test_null_malformed_and_unknown_transfer_fields_deny_before_queue_or_sync_effects(self):
        for value in [None, {"private": "protected-marker"}, {**self.payload["sourceTransfer"], "unexpected": "protected-marker"}]:
            bad = {**self.payload, "sourceTransfer": value}
            with patch.object(worker, "ensure_generation_model_downloaded") as ordinary:
                start = self.start(bad)
                sync = self.client.post("/models/ensure-downloaded", json=bad)
            self.assertIn(start.status_code, {400, 422}); self.assertIn(sync.status_code, {409, 422})
            self.assertNotIn("protected-marker", start.text + sync.text)
            ordinary.assert_not_called(); self.assertEqual(worker.TASK_REGISTRY, {})
        self.assertEqual(self.fixture.requests, [])
        self.assertEqual(list(self.sender.iterdir()), []); self.assertEqual(list(self.receiver.iterdir()), [])

    def test_valid_private_selection_cannot_fall_back_to_synchronous_download(self):
        with patch.object(worker, "ensure_generation_model_downloaded") as ordinary:
            result = self.client.post("/models/ensure-downloaded", json=self.payload)
        self.assertEqual(result.status_code, 409); ordinary.assert_not_called()
        self.assertEqual(self.fixture.requests, []); self.assertFalse(staging._STAGING_SLOT.locked())

    def test_wrong_namespace_identity_refuses_before_bytes_with_safe_phase_diagnostic(self):
        bad = json.loads(json.dumps(self.payload)); bad["sourceTransfer"]["roots"]["source"]["inode"] = "1"
        output = io.StringIO()
        with redirect_stdout(output):
            self.assertEqual(self.start(bad).status_code, 200); result = self.finished()
        self.assertEqual(result["status"], "failed")
        self.assertEqual(result["error"]["code"], "model_source_task_namespace_unconfirmed")
        self.assertEqual(self.private_status()["phase"], "failed")
        self.assertFalse(self.owner().retains_record); self.assertEqual(self.fixture.requests, [])
        self.assertNotIn(str(self.fixture.root), output.getvalue() + json.dumps(result))
        self.assertEqual(list(self.sender.iterdir()), []); self.assertEqual(list(self.receiver.iterdir()), [])

    def test_replaced_source_between_initial_guard_and_capture_cannot_create_or_download(self):
        real_stage = source.stage_model_source
        def replace(*args, **kwargs):
            os.rename(self.sender, self.root / "old-source"); self.sender.mkdir()
            return real_stage(*args, **kwargs)
        with patch.object(source, "stage_model_source", side_effect=replace):
            self.assertEqual(self.start().status_code, 200); result = self.finished()
        self.assertEqual(result["status"], "failed"); self.assertEqual(self.fixture.requests, [])
        self.assertEqual(list(self.sender.iterdir()), []); self.assertTrue((self.root / "old-source").exists())
        self.assertFalse(staging._STAGING_SLOT.locked())

    def test_prequeue_capture_preserves_original_selection_and_workspace_across_wait(self):
        entered, released = Event(), Event()
        blocker = self.executor.submit(lambda: (entered.set(), released.wait(3)))
        self.assertTrue(entered.wait(1))
        request = StartPythonRuntimeTaskRequest(requestId=TASK, taskType="ensure-model-download",
            payload=self.payload, metadata={"workspaceId": WORKSPACE})
        try:
            accepted = worker._start_async_task(request)
            self.assertTrue(accepted.accepted)
            request.payload["sourceTransfer"]["acquisitionId"] = "55555555-5555-4555-8555-555555555555"
            request.payload["modelId"] = "fixture/other"
            request.metadata["workspaceId"] = "66666666-6666-4666-8666-666666666666"
        finally:
            released.set(); blocker.result(timeout=3)
        result = self.finished()
        self.assertEqual(result["status"], "succeeded"); self.assertEqual(result["data"]["modelId"], "fixture/model")
        self.assertEqual(result["metadata"]["workspaceId"], WORKSPACE)
        self.complete()

    def test_queued_cancellation_retires_unacquired_owner_without_claiming_cleanup(self):
        entered, released = Event(), Event()
        blocker = self.executor.submit(lambda: (entered.set(), released.wait(3)))
        self.assertTrue(entered.wait(1))
        try:
            self.assertEqual(self.start().status_code, 200)
            result = self.client.post("/tasks/" + TASK + "/cancel").json()
            self.assertTrue(result["cancelled"])
        finally:
            released.set(); blocker.result(timeout=3)
        self.assertEqual(self.private_status()["phase"], "cancelled")
        self.assertFalse(self.owner().retains_record); self.assertIsNone(self.owner()._custodian)
        self.assertEqual(self.fixture.requests, []); self.assertEqual(list(self.sender.iterdir()), [])

    def test_pending_and_acknowledged_records_cannot_be_pruned_replaced_or_unloaded(self):
        self.start(); self.finished()
        for phase in ["awaiting-receiver", "acknowledged"]:
            self.assertEqual(self.private_status()["phase"], phase)
            with patch.object(worker, "TASK_MAX_RETAINED", 0):
                with worker.TASK_REGISTRY_LOCK: worker._prune_terminal_tasks_locked()
            self.assertIn(TASK, worker.TASK_REGISTRY)
            with patch.object(worker, "TASK_MAX_ACTIVE", 1):
                with self.assertRaises(RuntimeError):
                    worker._start_async_task(StartPythonRuntimeTaskRequest(requestId="other", taskType="ensure-model-download",
                        payload={"provider": "transformers", "modelId": "fixture/other"}))
            with self.assertRaises(RuntimeError):
                worker._start_async_task(StartPythonRuntimeTaskRequest(requestId=TASK, taskType="ensure-model-download", payload=self.payload))
            with patch.object(worker, "unload_generation_models") as unload:
                response = self.client.post("/models/unload")
            self.assertEqual(response.status_code, 409); unload.assert_not_called()
            if phase == "awaiting-receiver": self.assertEqual(self.acknowledge().json()["phase"], "acknowledged")
        self.acknowledge(self.ack_body("receiver-settled"))
        with patch.object(worker, "TASK_MAX_RETAINED", 0):
            with worker.TASK_REGISTRY_LOCK: worker._prune_terminal_tasks_locked()
        self.assertNotIn(TASK, worker.TASK_REGISTRY)

    def test_bad_unknown_duplicate_and_oversized_ack_bodies_never_enter_receiver_observer(self):
        self.start(); self.finished(); body = self.ack_body()
        target = "/tasks/" + TASK + "/model-source/acknowledgement"
        with patch.object(self.owner()._handoff, "acknowledge", wraps=self.owner()._handoff.acknowledge) as observe:
            bad = self.client.post(target, json={**body, "extra": "protected-marker"})
            self.assertEqual(bad.status_code, 400); self.assertNotIn("protected-marker", bad.text)
            duplicate = json.dumps(body)[:-1] + ',"phase":"receiver-settled"}'
            self.assertEqual(self.client.post(target, content=duplicate).status_code, 400)
            self.assertEqual(self.client.post(target, content=iter([b" " * 4096, b"x"])).status_code, 400)
            self.assertEqual(self.client.post(target, json={**body, "receiptDigest": "sha256:" + "f" * 64}).status_code, 409)
            observe.assert_not_called()
        self.assertTrue(staging._STAGING_SLOT.locked()); self.complete()

    def test_lost_ack_reply_replays_saved_outcome_without_unlink_or_context_exit_again(self):
        self.start(); self.finished(); owner = self.owner(); body = self.ack_body()
        real = owner.acknowledge; dropped = False
        def lose_reply(value):
            nonlocal dropped
            result = real(value)
            if not dropped:
                dropped = True; raise source.ModelSourceTaskError()
            return result
        with patch.object(owner, "acknowledge", side_effect=lose_reply), \
                patch.object(owner._handoff, "acknowledge", wraps=owner._handoff.acknowledge) as observe:
            self.assertEqual(self.acknowledge(body).status_code, 409)
            self.assertEqual(self.acknowledge(body).json()["phase"], "acknowledged")
            self.assertEqual(observe.call_count, 1)
        self.assertFalse(staging._STAGING_SLOT.locked())
        self.acknowledge(self.ack_body("receiver-settled"))

    def test_ambiguous_unlink_retains_record_and_never_retries_on_same_ack(self):
        self.start(); self.finished(); body = self.ack_body(); real_unlink = os.unlink; count = 0
        def uncertain(path, *args, **kwargs):
            nonlocal count
            count += 1; real_unlink(path, *args, **kwargs); raise OSError("protected-native-marker")
        with patch.object(handoff.os, "unlink", side_effect=uncertain):
            first = self.acknowledge(body)
            second = self.acknowledge(body)
        self.assertEqual(first.json()["phase"], "uncertain"); self.assertEqual(second.json()["phase"], "uncertain")
        self.assertEqual(count, 1); self.assertNotIn("protected-native-marker", first.text + second.text)
        self.assertTrue(self.owner().retains_record); self.assertTrue(staging._STAGING_SLOT.locked())
        self.assertEqual({p.name: p.read_bytes() for p in self.snapshot.iterdir()}, self.fixture.data)

    def test_running_model_cancel_stays_truthfully_unsupported_while_owned_handoff_remains(self):
        self.start(); self.finished()
        # Generic succeeded does not imply cleanup or storage completion.
        result = self.client.post("/tasks/" + TASK + "/cancel").json()
        self.assertFalse(result["cancelled"]); self.assertTrue(self.owner().retains_record)
        self.complete()

    def test_legacy_id_only_updates_cannot_modify_a_private_source_record(self):
        self.start(); self.finished(); record = worker.TASK_REGISTRY[TASK]
        previous = dict(record)
        worker._update_task(TASK, status="failed", future="foreign", data={"foreign": True})
        self.assertEqual(record, previous); self.complete()

    def test_stale_owner_status_and_ack_cannot_disclose_a_replacement_record(self):
        self.start(); self.finished(); owner = self.owner(); body = self.ack_body()
        original = worker.TASK_REGISTRY[TASK]
        replacement = worker._create_task_record(TASK, "ensure-model-download")
        worker.TASK_REGISTRY[TASK] = replacement
        try:
            with self.assertRaises(source.ModelSourceTaskError): owner.status()
            from modules.adapters.runtime.python.worker.models import ModelSourceAcknowledgement
            with self.assertRaises(source.ModelSourceTaskError): owner.acknowledge(ModelSourceAcknowledgement.model_validate(body))
            self.assertIs(worker.TASK_REGISTRY[TASK], replacement)
            self.assertEqual(replacement["status"], "queued"); self.assertIsNone(replacement["data"])
        finally:
            worker.TASK_REGISTRY[TASK] = original
        self.complete()

    def test_late_submit_reply_cannot_install_old_future_or_return_a_reused_record(self):
        submitted, released = Event(), Event(); replies = []; errors = []
        executor = self.executor
        class HeldSubmit:
            def submit(_self, callback):
                future = executor.submit(callback)
                future.result(timeout=3); submitted.set(); released.wait(4)
                return future
        def start():
            try: replies.append(self.start())
            except Exception as error: errors.append(error)
        with patch.object(worker, "TASK_EXECUTOR", HeldSubmit()):
            caller = Thread(target=start); caller.start()
            try:
                self.assertTrue(submitted.wait(2))
                self.complete()
                with patch.object(worker, "TASK_MAX_RETAINED", 0):
                    with worker.TASK_REGISTRY_LOCK: worker._prune_terminal_tasks_locked()
                self.assertNotIn(TASK, worker.TASK_REGISTRY)
                successor = worker._create_task_record(TASK, "ensure-model-download")
                sentinel = object(); successor["future"] = sentinel
                worker.TASK_REGISTRY[TASK] = successor
                saved = dict(successor)
            finally:
                released.set(); caller.join(4)
        self.assertFalse(caller.is_alive()); self.assertEqual(errors, [])
        self.assertEqual(len(replies), 1); self.assertEqual(replies[0].status_code, 400)
        self.assertEqual(successor, saved); self.assertIs(successor["future"], sentinel)
        self.assertIsNone(successor["data"]); self.assertEqual(successor["status"], "queued")

    def test_unknown_submit_before_queue_retains_original_record_without_claiming_start_or_cleanup(self):
        calls = []
        class FailedSubmit:
            def submit(_self, callback):
                calls.append(callback)
                raise RuntimeError("synthetic submit failure")
        with patch.object(worker, "TASK_EXECUTOR", FailedSubmit()):
            self.assertEqual(self.start().status_code, 400)
            original = worker.TASK_REGISTRY[TASK]
            status = self.private_status()
            self.assertEqual(status["phase"], "prepared")
            self.assertTrue(status["startAcknowledgementUnconfirmed"])
            self.assertFalse(status["cleanupPending"])
            self.assertTrue(self.owner().retains_record)
            with self.assertRaisesRegex(RuntimeError, "already active"):
                worker._start_async_task(StartPythonRuntimeTaskRequest(requestId=TASK,
                    taskType="ensure-model-download", payload=self.payload))
        self.assertEqual(len(calls), 1); self.assertIs(worker.TASK_REGISTRY[TASK], original)
        self.assertEqual(worker._active_task_count(), 1); self.assertIsNone(original["future"])
        self.assertEqual(self.fixture.requests, []); self.assertFalse(staging._STAGING_SLOT.locked())
        self.assertEqual(list(self.sender.iterdir()), []); self.assertEqual(list(self.receiver.iterdir()), [])

    def test_submit_effect_then_throw_preserves_the_original_job_and_its_receiver_outcome(self):
        futures = []; executor = self.executor
        class UnconfirmedSubmit:
            def submit(_self, callback):
                futures.append(executor.submit(callback))
                raise RuntimeError("synthetic lost submit acknowledgement")
        with patch.object(worker, "TASK_EXECUTOR", UnconfirmedSubmit()):
            self.assertEqual(self.start().status_code, 400)
        futures[0].result(timeout=4)
        self.assertEqual(len(futures), 1)
        self.assertEqual(self.client.get("/tasks/" + TASK).json()["status"], "succeeded")
        status = self.private_status()
        self.assertEqual(status["phase"], "awaiting-receiver")
        self.assertTrue(status["startAcknowledgementUnconfirmed"])
        self.assertTrue(staging._STAGING_SLOT.locked()); self.assertTrue(self.owner().retains_record)
        self.assertEqual({p.name: p.read_bytes() for p in self.snapshot.iterdir()}, self.fixture.data)
        self.complete()
        self.assertFalse(staging._STAGING_SLOT.locked()); self.assertEqual(worker._active_task_count(), 0)

    def test_late_task_result_cannot_publish_status_or_data_into_a_successor(self):
        produced, released = Event(), Event(); real = source.ModelSourceTaskOwner.execute
        def held(owner):
            value = real(owner); produced.set(); released.wait(4); return value
        with patch.object(source.ModelSourceTaskOwner, "execute", held):
            self.assertEqual(self.start().status_code, 200); self.assertTrue(produced.wait(2))
            original = worker.TASK_REGISTRY[TASK]; future = original["future"]
            self.complete()
            successor = worker._create_task_record(TASK, "ensure-model-download")
            sentinel = object(); successor["future"] = sentinel
            worker.TASK_REGISTRY[TASK] = successor; saved = dict(successor)
            released.set(); future.result(timeout=4)
        self.assertEqual(successor, saved); self.assertIsNone(successor["data"])
        self.assertIs(successor["future"], sentinel)

    def test_replay_and_settlement_recheck_original_row_after_waiting_for_control(self):
        from modules.adapters.runtime.python.worker.models import ModelSourceAcknowledgement
        self.start(); self.finished(); self.acknowledge()
        owner = self.owner(); original = worker.TASK_REGISTRY[TASK]
        for phase in ["receiver-observed", "receiver-settled"]:
            with self.subTest(phase=phase):
                body = ModelSourceAcknowledgement.model_validate(self.ack_body(phase))
                entered = Event(); errors = []; results = []; first = True; real = owner._record_current
                def current():
                    nonlocal first
                    allowed = real()
                    if first: first = False; entered.set()
                    return allowed
                def run():
                    try: results.append(owner.acknowledge(body))
                    except Exception as error: errors.append(error)
                owner._control.acquire()
                with patch.object(owner, "_record_current", current), patch.object(handoff.os, "unlink", wraps=os.unlink) as unlink:
                    caller = Thread(target=run); caller.start()
                    try:
                        self.assertTrue(entered.wait(1))
                        successor = worker._create_task_record(TASK, "ensure-model-download")
                        worker.TASK_REGISTRY[TASK] = successor; saved = dict(successor)
                    finally:
                        owner._control.release(); caller.join(3)
                    self.assertFalse(caller.is_alive()); self.assertEqual(results, [])
                    self.assertEqual(len(errors), 1); self.assertIsInstance(errors[0], source.ModelSourceTaskError)
                    unlink.assert_not_called(); self.assertEqual(successor, saved)
                worker.TASK_REGISTRY[TASK] = original

    def test_old_running_cancel_cannot_set_flags_on_replacement_source_record(self):
        entered, released = Event(), Event(); replies = []; errors = []
        class HeldRecord(dict):
            held = False
            def get(record, key, default=None):
                if key == "taskType" and not record.held:
                    record.held = True; entered.set(); released.wait(4)
                return super().get(key, default)
        old = HeldRecord(worker._create_task_record(TASK, "train-model")); old["status"] = "running"
        worker.TASK_REGISTRY[TASK] = old
        def cancel():
            try: replies.append(worker.cancel_task(TASK))
            except Exception as error: errors.append(error)
        caller = Thread(target=cancel); caller.start()
        try:
            self.assertTrue(entered.wait(1))
            old["status"] = "failed"
            with patch.object(worker, "TASK_MAX_RETAINED", 0):
                with worker.TASK_REGISTRY_LOCK: worker._prune_terminal_tasks_locked()
            self.assertNotIn(TASK, worker.TASK_REGISTRY)
            self.start(); self.finished()
            current = worker.TASK_REGISTRY[TASK]; saved = dict(current)
        finally:
            released.set(); caller.join(4)
        self.assertFalse(caller.is_alive()); self.assertEqual(errors, [])
        self.assertEqual(len(replies), 1); self.assertFalse(replies[0].cancelled)
        self.assertEqual(current, saved); self.assertIs(current["cancellationRequested"], False)
        self.complete()

    def test_held_ack_allows_status_and_read_only_replay_without_lock_inversion(self):
        self.start(); self.finished(); owner = self.owner(); body = self.ack_body()
        entered, released = Event(), Event(); replies = []; errors = []; held = False
        real_check = owner._handoff._check_pairs
        def slow_check():
            nonlocal held
            real_check()
            if not held: held = True; entered.set(); released.wait(4)
        def acknowledge():
            try: replies.append(self.acknowledge(body))
            except Exception as error: errors.append(error)
        with patch.object(owner._handoff, "_check_pairs", slow_check):
            caller = Thread(target=acknowledge); caller.start()
            try:
                self.assertTrue(entered.wait(1))
                started = time.monotonic()
                self.assertEqual(self.private_status()["phase"], "acknowledging")
                self.assertEqual(self.acknowledge(body).json()["phase"], "acknowledging")
                self.assertLess(time.monotonic() - started, 2)
                self.assertTrue(staging._STAGING_SLOT.locked())
            finally:
                released.set(); caller.join(4)
        self.assertFalse(caller.is_alive()); self.assertEqual(errors, [])
        self.assertEqual(replies[0].json()["phase"], "acknowledged")
        self.acknowledge(self.ack_body("receiver-settled"))

    def test_long_trusted_windows_paths_keep_same_root_identity_and_complete(self):
        old = self.cache
        deep = self.fixture.root / ("trusted-cache-" + "x" * 100); deep.mkdir()
        moved = deep / "cache"
        self.assertTrue(old.is_relative_to(self.fixture.root)); self.assertTrue(moved.is_relative_to(self.fixture.root))
        os.rename(old, moved)
        self.cache = moved; self.root = moved / source.NAMESPACE / ACQUISITION
        self.sender, self.receiver = self.root / "source", self.root / "receiver"
        configured = str(moved)
        if configured.startswith("\\\\?\\UNC\\"): configured = "\\\\" + configured[8:]
        elif configured.startswith("\\\\?\\"): configured = configured[4:]
        with patch.object(source, "_resolve_huggingface_cache_root", return_value=Path(configured)):
            if os.name == "nt": self.assertGreater(len(str(self.snapshot)), 260)
            self.assertEqual(self.start().status_code, 200)
            self.assertEqual(self.finished()["status"], "succeeded"); self.complete()
        self.assertEqual({p.name: p.read_bytes() for p in self.snapshot.iterdir()}, self.fixture.data)


if __name__ == "__main__":
    unittest.main()
