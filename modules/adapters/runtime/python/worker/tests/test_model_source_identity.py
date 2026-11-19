"""Real ASGI/Task/Handoff/file metadata with a synthetic owned proof, no model."""
from contextlib import ExitStack
import hashlib
import hmac
import json
import os
import shutil
import subprocess
import sys
import time
import re
from threading import Lock, Event, Thread
import unittest
from unittest.mock import patch

from modules.adapters.runtime.python.worker import app as worker
from modules.adapters.runtime.python.worker.tasks import model_source_identity as identity
from modules.adapters.runtime.python.worker.tasks.model_source_handoff import _digest
from modules.adapters.runtime.python.worker.tasks.model_source_staging import _identity

TASK = "11111111-1111-4111-8111-111111111111"
ACQUISITION = "44444444-4444-4444-8444-444444444444"
HANDOFF = "22222222-2222-4222-8222-222222222222"


class ModelSourceIdentityTests(unittest.TestCase):
    def setUp(self):
        from modules.adapters.runtime.python.worker.tests.test_model_source_task import ModelSourceTaskTests
        self.base = ModelSourceTaskTests("test_real_async_transfer_ack_and_receiver_settlement_keep_distinct_custody")
        self.base.setUp()
        self.addCleanup(self.base.doCleanups)
        self.stack = ExitStack(); self.addCleanup(self.stack.close)
        self.stack.enter_context(patch.object(identity, "_resolve_huggingface_cache_root", return_value=self.base.cache))
        self.stack.enter_context(patch.object(identity, "_PROBE_SLOT", Lock()))
        self.stack.enter_context(patch.object(identity, "_RETAINED_PROBE", None))
        self.secret = b"p" * 32
        assert len(self.secret) == 32
        self.proof_path = self.base.root.parent / (ACQUISITION + ".proof")
        self.proof_path.write_bytes(self.secret)
        self.input = {"phase": "roots", "taskId": TASK, "acquisitionId": ACQUISITION, "handoffId": HANDOFF,
            "challenge": "d" * 64, "runtimeId": worker.RUNTIME_ID, "workerStartedAt": worker.WORKER_STARTED_AT}

    def probe(self, **changes):
        return self.base.client.post("/models/source-identity", json={**self.input, **changes})

    def check_mac(self, result):
        self.assertEqual(result.status_code, 200)
        value = result.json(); proof = value["proof"]
        expected = hmac.new(self.secret, identity.DOMAIN + json.dumps(proof, sort_keys=True,
            separators=(",", ":"), ensure_ascii=True).encode("ascii"), hashlib.sha256).hexdigest()
        self.assertEqual(value["mac"], expected)
        self.assertNotIn(self.secret.decode(), result.text)
        self.assertNotIn(str(self.base.fixture.root), result.text)
        return proof

    def test_empty_root_binding_preserves_all_five_native_facts_without_effect_authority(self):
        with patch.object(worker, "ensure_generation_model_downloaded") as ordinary:
            proof = self.check_mac(self.probe())
        ordinary.assert_not_called()
        self.assertEqual(proof["roots"]["receiver"], [str(part) for part in _identity(self.base.receiver.lstat())])
        self.assertEqual(proof["files"], []); self.assertIsNone(proof["manifestDigest"])
        self.assertEqual(list(self.base.sender.iterdir()), []); self.assertEqual(list(self.base.receiver.iterdir()), [])
        self.assertEqual(self.base.fixture.requests, [])
        self.assertEqual(self.proof_path.read_bytes(), self.secret)

    def test_snapshot_binding_matches_the_actual_handoff_producer_and_sender_transition(self):
        self.assertEqual(self.base.start().status_code, 200); self.base.finished()
        receipt = self.base.private_status()["receipt"]
        proof = self.check_mac(self.probe(phase="snapshot"))
        witness = _digest({"task": TASK, "handoff": HANDOFF, "root": proof["roots"]["receiver"]})
        self.assertEqual(witness, receipt["recipient_witness"])
        files = [{"path": item["path"], "device": item["identity"][0], "inode": item["identity"][1], "size": item["sizeBytes"]}
            for item in proof["files"]]
        self.assertEqual(_digest({"task": TASK, "handoff": HANDOFF, "manifest": proof["manifestDigest"], "recipient": witness,
            "files": files}), receipt["receipt_digest"])
        self.assertTrue(all(item["nlink"] == 2 for item in proof["files"]))
        self.assertEqual(self.base.acknowledge().json()["phase"], "acknowledged")
        after = self.check_mac(self.probe(phase="snapshot", challenge="e" * 64))
        self.assertTrue(all(item["nlink"] == 1 for item in after["files"]))
        self.assertEqual([item["identity"] for item in proof["files"]], [item["identity"] for item in after["files"]])
        self.base.complete()
        self.assertEqual(self.probe(phase="snapshot").status_code, 409)

    def test_actual_node_created_proof_with_delayed_write_keeps_per_api_ctime_baselines(self):
        self.proof_path.unlink()
        script = """const f=await import('node:fs/promises');
const h=await f.open(process.argv[1],'wx',0o600);
await new Promise(r=>setTimeout(r,30));
await h.write(Buffer.alloc(32,112),0,32,0); await h.sync(); await h.close();"""
        node = shutil.which("node")
        self.assertIsNotNone(node)
        result = subprocess.run([node, "--input-type=module", "-e", script, str(self.proof_path)],
            stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=10)
        self.assertEqual(result.returncode, 0)
        self.check_mac(self.probe())
        self.assertEqual(self.proof_path.read_bytes(), self.secret)

    def test_actual_node_receiver_producer_journey_is_mandatory_and_does_not_skip(self):
        name = "actual owned Python Task and Handoff producer interoperate through full distinct identities and MAC"
        node = shutil.which("node"); self.assertIsNotNone(node)
        env = dict(os.environ, PYTHON=sys.executable, AISB_RUN_MODEL_SOURCE_INTEROP="1")
        env.pop("NODE_TEST_CONTEXT", None)
        flags = subprocess.CREATE_NO_WINDOW | subprocess.CREATE_NEW_PROCESS_GROUP if os.name == "nt" else 0
        child = subprocess.Popen([node, "--import", "tsx", "--test", "--test-reporter=tap", "--test-name-pattern", "^" + name + "$",
            "modules/adapters/runtime/python/tests/model-source-recipient.unit.test.ts"],
            env=env, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            creationflags=flags, start_new_session=os.name != "nt")
        exceeded = Event(); outputs = {"stdout": bytearray(), "stderr": bytearray()}
        def drain(stream, key):
            try:
                while chunk := stream.read(8192):
                    if len(chunk) > 128 * 1024 - len(outputs[key]):
                        exceeded.set()
                    elif not exceeded.is_set():
                        outputs[key].extend(chunk)
            finally:
                stream.close()
        readers = [Thread(target=drain, args=(child.stdout, "stdout"), daemon=True),
            Thread(target=drain, args=(child.stderr, "stderr"), daemon=True)]
        for reader in readers:
            reader.start()
        deadline = time.monotonic() + 45
        timed_out = False
        try:
            while child.poll() is None:
                if exceeded.is_set() or time.monotonic() >= deadline:
                    timed_out = True
                    if os.name == "nt":
                        subprocess.run(["taskkill", "/PID", str(child.pid), "/T", "/F"], stdout=subprocess.DEVNULL,
                            stderr=subprocess.DEVNULL, timeout=3, creationflags=subprocess.CREATE_NO_WINDOW)
                    else:
                        import signal
                        os.killpg(child.pid, signal.SIGKILL)
                    break
                exceeded.wait(0.02)
        finally:
            if child.poll() is None:
                child.kill()
            child.wait(timeout=3)
            for reader in readers:
                reader.join(2)
        self.assertFalse(timed_out, "The exact controlled producer child did not settle within its bound.")
        self.assertFalse(exceeded.is_set(), "The exact controlled producer output exceeded its bound.")
        self.assertFalse(any(reader.is_alive() for reader in readers), "Owned producer output settlement is unconfirmed.")
        self.assertEqual(child.returncode, 0, "The exact controlled producer child failed.")
        output = bytes(outputs["stdout"]).decode("utf-8", errors="strict")
        named = re.findall(r"^(?:not )?ok [0-9]+ - " + re.escape(name) + r"(?:\s+#.*)?$", output, re.MULTILINE)
        self.assertEqual(len(named), 1, "The exact producer test must report one named outcome.")
        self.assertTrue(named[0].startswith("ok "), "The selected producer test did not pass.")
        self.assertNotRegex(named[0], r"(?i)#\s*(?:SKIP|TODO)")
        self.assertNotRegex(output, r"(?m)^(?:not ok |Bail out!)")
        self.assertRegex(output, r"(?m)^# fail 0\s*$")
        skipped = re.findall(r"(?m)^# skipped ([0-9]+)\s*$", output)
        self.assertEqual(len(skipped), 1)
        print(json.dumps({"event": "qualification.model_source_actual_producer", "selectedPassed": 1,
            "selectedSkipped": 0, "otherSkipped": int(skipped[0])}))

    def test_authentication_worker_incarnation_and_unknown_snapshot_deny_before_file_open(self):
        with patch.object(identity.os, "open", wraps=os.open) as opening:
            self.assertEqual(self.base.client.post("/models/source-identity", json=self.input,
                headers={"Authorization": "Bearer wrong"}).status_code, 401)
            with patch.object(worker, "RUNTIME_AUTH_TOKEN", ""):
                self.assertEqual(self.probe().status_code, 503)
            self.assertEqual(self.probe(workerStartedAt="2020-01-01T00:00:00+00:00").status_code, 409)
            self.assertEqual(self.probe(runtimeId="different-worker").status_code, 409)
            self.assertEqual(self.probe(phase="snapshot").status_code, 404)
        opening.assert_not_called()

    def test_duplicate_unknown_and_actual_streamed_oversize_deny_without_reflection_or_io(self):
        encoded = json.dumps(self.input).encode()
        bodies = [encoded[:-1] + b',"phase":"snapshot"}', json.dumps({**self.input, "path": "synthetic-private-marker"}).encode(),
            b" " * 4097]
        with patch.object(identity.os, "open", wraps=os.open) as opening:
            for body in bodies:
                response = self.base.client.post("/models/source-identity", content=body, headers={"content-type": "application/json"})
                self.assertEqual(response.status_code, 400); self.assertNotIn("synthetic-private-marker", response.text)
            response = self.base.client.post("/models/source-identity", content=iter([b" " * 3000, b" " * 1097]),
                headers={"content-type": "application/json"})
            self.assertEqual(response.status_code, 400)
        opening.assert_not_called()

    def test_busy_probe_denies_without_queueing_another_native_handle(self):
        identity._PROBE_SLOT.acquire()
        try:
            with patch.object(identity.os, "open", wraps=os.open) as opening:
                self.assertEqual(self.probe().status_code, 409)
            opening.assert_not_called()
        finally:
            identity._PROBE_SLOT.release()

    def test_unknown_proof_close_retains_the_only_probe_slot_without_handle_retry(self):
        close = os.close
        def lost(fd):
            close(fd)
            raise OSError("synthetic lost close reply")
        with patch.object(identity.os, "close", side_effect=lost) as closing:
            self.assertEqual(self.probe().status_code, 409)
            self.assertEqual(self.probe().status_code, 409)
            self.assertEqual(closing.call_count, 1)
        self.assertIsNotNone(identity._RETAINED_PROBE); self.assertTrue(identity._PROBE_SLOT.locked())
        self.assertEqual(self.proof_path.read_bytes(), self.secret)

    def test_replaced_role_during_secret_read_cannot_receive_a_binding(self):
        read = os.read; replaced = False; expected = self.proof_path.lstat(); observations = []
        def changed(fd, count):
            nonlocal replaced
            observations.append(("read", count))
            result = read(fd, count)
            opened = os.fstat(fd)
            if not replaced and count == 32 and (opened.st_dev, opened.st_ino) == (expected.st_dev, expected.st_ino):
                try:
                    os.rename(self.base.sender, self.base.root / "old-source"); self.base.sender.mkdir()
                except OSError as error:
                    observations.append(("rename-error", type(error).__name__, error.errno, getattr(error, "winerror", None)))
                    raise
                replaced = True
            return result
        with patch.object(identity.os, "read", side_effect=changed):
            response = self.probe()
        self.assertEqual(response.status_code, 409); self.assertNotIn("mac", response.json())
        self.assertTrue(replaced, observations)
        self.assertTrue((self.base.root / "old-source").is_dir())
        self.assertFalse(identity._PROBE_SLOT.locked())

    def test_nonempty_initial_roles_bad_marker_size_and_marker_hardlink_deny(self):
        marker = self.base.sender / "foreign"; marker.write_bytes(b"synthetic")
        self.assertEqual(self.probe().status_code, 409); marker.unlink()
        self.proof_path.write_bytes(b"short")
        self.assertEqual(self.probe().status_code, 409)
        self.proof_path.write_bytes(self.secret)
        linked = self.base.root.parent / "extra-proof-link"; os.link(self.proof_path, linked)
        self.assertEqual(self.probe().status_code, 409)
        self.assertTrue(linked.exists()); self.assertEqual(self.proof_path.read_bytes(), self.secret)

    def test_replaced_original_task_record_cannot_supply_snapshot_metadata(self):
        self.base.start(); self.base.finished(); original = worker.TASK_REGISTRY[TASK]
        with patch.object(identity._Probe, "read_secret", wraps=None) as reading:
            worker.TASK_REGISTRY[TASK] = worker._create_task_record(TASK, "ensure-model-download")
            try:
                self.assertEqual(self.probe(phase="snapshot").status_code, 404)
            finally:
                worker.TASK_REGISTRY[TASK] = original
        reading.assert_not_called(); self.base.complete()

    def test_original_task_replaced_during_secret_read_cannot_receive_a_late_snapshot_binding(self):
        self.base.start(); self.base.finished(); original = worker.TASK_REGISTRY[TASK]
        expected = self.proof_path.lstat(); read = os.read; replaced = False
        def swap(fd, count):
            nonlocal replaced
            value = read(fd, count); opened = os.fstat(fd)
            if not replaced and count == 32 and (opened.st_dev, opened.st_ino) == (expected.st_dev, expected.st_ino):
                worker.TASK_REGISTRY[TASK] = worker._create_task_record(TASK, "ensure-model-download")
                replaced = True
            return value
        try:
            with patch.object(identity.os, "read", side_effect=swap):
                response = self.probe(phase="snapshot")
            self.assertTrue(replaced); self.assertEqual(response.status_code, 409); self.assertNotIn("mac", response.json())
            self.assertIsNone(worker.TASK_REGISTRY[TASK]["data"])
        finally:
            worker.TASK_REGISTRY[TASK] = original
        self.base.complete()

    def test_held_probe_keeps_slot_until_actual_settlement_and_rejects_worker_change(self):
        entered, released = Event(), Event(); replies = []; errors = []
        expected = self.proof_path.lstat(); read = os.read; held = False
        def waiting(fd, count):
            nonlocal held
            result = read(fd, count); opened = os.fstat(fd)
            if not held and count == 32 and (opened.st_dev, opened.st_ino) == (expected.st_dev, expected.st_ino):
                held = True; entered.set(); released.wait(4)
            return result
        def caller():
            try: replies.append(self.probe())
            except Exception as error: errors.append(type(error).__name__)
        with patch.object(identity.os, "read", side_effect=waiting):
            thread = Thread(target=caller); thread.start()
            try:
                self.assertTrue(entered.wait(2)); self.assertTrue(identity._PROBE_SLOT.locked())
                self.assertEqual(self.probe(challenge="e" * 64).status_code, 409)
                with patch.object(worker, "WORKER_STARTED_AT", "2020-01-01T00:00:00+00:00"):
                    released.set(); thread.join(3)
            finally:
                released.set(); thread.join(3)
        self.assertFalse(thread.is_alive()); self.assertEqual(errors, []); self.assertEqual(len(replies), 1)
        self.assertEqual(replies[0].status_code, 409); self.assertNotIn("mac", replies[0].json())
        self.assertFalse(identity._PROBE_SLOT.locked()); self.assertEqual(self.proof_path.read_bytes(), self.secret)


if __name__ == "__main__":
    unittest.main()
