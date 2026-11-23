"""Inert ownership/protocol tests. Never import a model or acquire native files."""
from concurrent.futures import Future
from contextlib import nullcontext
from copy import deepcopy
from threading import Event, Thread
import unittest
from unittest.mock import patch

from modules.adapters.runtime.python.worker import app
from modules.adapters.runtime.python.worker.models import TrainModelTaskRequest, TrainModelTaskResult, StartPythonRuntimeTaskRequest
from modules.adapters.runtime.python.worker.tasks import approved_local_training_session as session

TASK = "11111111-1111-4111-8111-111111111111"
WORKSPACE = "22222222-2222-4222-8222-222222222222"
DIGEST = "sha256:" + "a" * 64


def definition():
    return {"requestId": TASK, "workspaceId": WORKSPACE,
            "owner": {"organizationId": "org", "principalId": "actor", "clientId": TASK, "hostIncarnationId": WORKSPACE},
            "modelUpdatedAt": "2026-11-23T00:00:00Z", "dataset": {"datasetId": "data", "versionId": "v1", "versionDigest": DIGEST, "recipeDigest": DIGEST},
            "proposalDigest": DIGEST, "inputs": [{"artifactId": "input-0", "role": "train", "mediaType": "application/jsonl", "digest": DIGEST, "sizeBytes": 4}],
            "recipeSizeBytes": 4,
            "request": {"workspaceId": WORKSPACE, "trainingTask": "llm-instruction", "baseModel": {"modelRecordId": "base"},
                        "datasets": [{"artifactId": "input-0", "splitRole": "train"}], "method": "lora", "output": {"destination": {"local": {"enabled": False}}}}}


def staged():
    payload = deepcopy(definition()["request"])
    payload["baseModel"]["localPath"] = "inert/base"
    payload["datasets"][0]["path"] = "inert/input"
    return {"payload": payload, "recipe": {"path": "inert/recipe", "digest": DIGEST, "sizeBytes": 4}, "outputDirectory": "inert/output"}


class Resources(session.NativeTrainingResources):
    def __init__(self):
        self.calls = []; self.ready = "ready"; self.closed = True; self.cancel_hook = lambda: None
    def prepare(self): self.calls.append("prepare"); return self.ready
    def seal_inputs(self, value): self.calls.append("seal"); return TrainModelTaskRequest.model_validate(value["payload"])
    def borrow(self): self.calls.append("borrow"); return nullcontext()
    def request_cancel(self): self.calls.append("cancel"); self.cancel_hook()
    def settle(self): self.calls.append("settle"); return self.closed


class Producer(session.NativeTrainingProducer):
    def __init__(self, resources=None): self.resources = resources or Resources(); self.calls = 0
    @property
    def profile(self): return session.NativeTrainingProfile("inert-only", DIGEST, 30)
    def capture(self, value): self.calls += 1; return self.resources


class QueuedExecutor:
    def __init__(self): self.calls = 0; self.future = Future(); self.operation = None; self.after_submit = None
    def submit(self, operation):
        self.calls += 1; self.operation = operation
        if self.after_submit: self.after_submit()
        return self.future
    def run(self):
        if self.future.set_running_or_notify_cancel():
            try: self.future.set_result(self.operation())
            except BaseException as error: self.future.set_exception(error); raise


class OriginalSessionTests(unittest.TestCase):
    def owner(self, submit=None):
        self.resources = Resources(); self.producer = Producer(self.resources); self.executor = QueuedExecutor(); self.publications = []
        self.current = True
        self.instance = session.OriginalTrainingSession(definition(), self.producer, lambda: self.current,
            lambda **value: self.publications.append(value), submit or (lambda owner: self.executor.submit(owner.run)))
        return self.instance
    def ready(self, submit=None):
        owner = self.owner(submit); self.assertEqual(owner.prepare(), "prepared"); self.assertEqual(owner.seal(staged()), "ready"); return owner
    def test_configured_original_loader_and_permanent_retirement(self):
        owner = self.owner()
        with patch.object(session, "train_model_from_local_files", return_value=TrainModelTaskResult(runId="inert", status="succeeded")) as loader:
            # The fixed loader must be captured at construction, before producer IO.
            owner = self.owner(); owner.prepare(); owner.seal(staged()); self.assertEqual(owner.start()["kind"], "accepted")
            self.executor.run(); self.assertTrue(owner.settle()); self.assertTrue(owner.settle())
            self.assertEqual(loader.call_args.kwargs["compare_validation_baseline"], False)
            self.assertEqual(self.resources.calls, ["prepare", "seal", "borrow", "settle"])
            self.assertEqual(self.publications[-1]["data"]["runId"], TASK)
            self.assertFalse(owner.blocks_recovery); self.assertTrue(owner.retains_record)
    def test_malformed_future_is_unknown_and_never_reissued(self):
        owner = self.ready(lambda owner: None)
        self.assertEqual(owner.start()["kind"], "unconfirmed")
        with self.assertRaises(session.TrainingSessionError): owner.start()
        self.assertFalse(owner.settle()); self.assertTrue(owner.blocks_recovery)
    def test_fixed_loader_is_captured_before_native_callbacks(self):
        with patch.object(session, "train_model_from_local_files", return_value=TrainModelTaskResult(runId="inert", status="succeeded")) as original:
            owner = self.ready()
        with patch.object(session, "train_model_from_local_files", side_effect=AssertionError("replaced loader")) as replacement:
            owner.start(); self.executor.run()
        original.assert_called_once(); replacement.assert_not_called()
    def test_start_submit_flight_blocks_retirement_until_original_ack(self):
        entered, finish = Event(), Event()
        def submit(owner):
            future = self.executor.submit(owner.run); self.executor.run()
            entered.set(); finish.wait(3); return future
        with patch.object(session, "train_model_from_local_files", return_value=TrainModelTaskResult(runId="inert", status="succeeded")):
            owner = self.ready(submit)
        replies = []; thread = Thread(target=lambda: replies.append(owner.start())); thread.start()
        try:
            self.assertTrue(entered.wait(3)); self.assertTrue(owner.run_returned)
            self.assertFalse(owner.settle()); self.assertTrue(owner.blocks_recovery)
            self.assertNotIn("settle", self.resources.calls)
        finally: finish.set(); thread.join(3)
        self.assertFalse(thread.is_alive()); self.assertEqual(replies[0]["kind"], "accepted")
        self.assertTrue(owner.settle())
    def test_lost_submit_can_still_run_original_once(self):
        owner = self.ready()
        def lost(): raise RuntimeError("synthetic lost acknowledgement")
        self.executor.after_submit = lost
        self.assertEqual(owner.start()["kind"], "unconfirmed")
        with patch.object(session, "train_model_from_local_files", return_value=TrainModelTaskResult(runId="inert", status="succeeded")):
            # Replace only the captured loader test seam below, never production routing.
            owner.loader = session.train_model_from_local_files
            self.executor.run()
        self.assertEqual(self.executor.calls, 1); self.assertTrue(owner.settle())
    def test_cancel_flight_cannot_settle_until_original_return(self):
        owner = self.ready(); entered, finish = Event(), Event()
        self.resources.cancel_hook = lambda: (entered.set(), finish.wait(3))
        worker = Thread(target=owner.cancel); worker.start()
        try:
            self.assertTrue(entered.wait(3)); self.assertFalse(owner.settle())
            self.assertNotIn("settle", self.resources.calls)
        finally: finish.set(); worker.join(3)
        self.assertFalse(worker.is_alive()); self.assertTrue(owner.settle())
    def test_unknown_cancel_is_never_repeated(self):
        owner = self.ready(); self.resources.cancel_hook = lambda: (_ for _ in ()).throw(RuntimeError("private"))
        self.assertFalse(owner.cancel()); self.assertFalse(owner.cancel())
        self.assertEqual(self.resources.calls.count("cancel"), 1)
    def test_native_methods_captured_before_preparation(self):
        owner = self.owner()
        original = self.resources.prepare
        def prepare():
            self.resources.settle = lambda: (_ for _ in ()).throw(AssertionError("replaced"))
            return original()
        self.resources.prepare = prepare
        owner.prepare(); owner.cancel(); self.assertTrue(owner.settle())
    def test_current_loss_prevents_dispatch(self):
        owner = self.ready(); self.current = False
        with self.assertRaises(session.TrainingSessionError): owner.start()
        self.assertEqual(self.executor.calls, 0)
    def test_unknown_close_not_repeated_or_released(self):
        owner = self.ready(); owner.cancel(); self.resources.closed = False
        self.assertFalse(owner.settle()); self.assertFalse(owner.settle())
        self.assertEqual(self.resources.calls.count("settle"), 1); self.assertTrue(owner.blocks_recovery)
    def test_definition_capture_bounds_and_scope(self):
        for mutate in (lambda v: v.update(nativeReady=True), lambda v: v.update(workspaceId="other"),
                       lambda v: v["inputs"][0].update(sizeBytes=True), lambda v: v["inputs"][0].update(role="test")):
            value = definition(); mutate(value)
            with self.assertRaises((session.TrainingSessionError, ValueError)): session.capture_definition(value)


class OriginalRoutesTests(unittest.TestCase):
    def setUp(self):
        self.registry = app.TASK_REGISTRY
        self.executor = QueuedExecutor(); self.resources = Resources(); self.producer = Producer(self.resources)
        self.patches = [patch.object(app, "TASK_REGISTRY", {}), patch.object(app, "TASK_EXECUTOR", self.executor),
                        patch.object(app, "_ORIGINAL_TRAINING_PRODUCER", None), patch.object(app, "_ORIGINAL_TRAINING_PROFILE", None)]
        for item in self.patches: item.start()
        self.addCleanup(lambda: [item.stop() for item in reversed(self.patches)])
    def prepare(self):
        app.configure_original_training(self.producer)
        self.reply = app._prepare_original_training({"identity": app._training_identity(), "definition": definition()})
        return self.reply
    def action(self, name, **extra): return app._operate_original_training(TASK, name, {"binding": self.reply["binding"], **extra})
    def test_default_configuration_denies_without_producer_io(self):
        with self.assertRaises(session.TrainingSessionError): app._prepare_original_training({"identity": {}, "definition": definition()})
        self.assertEqual(self.producer.calls, 0); self.assertFalse(app.TASK_REGISTRY)
    def test_original_record_future_private_routes_and_no_generic_adoption(self):
        self.assertEqual(self.prepare()["phase"], "ready"); record = app.TASK_REGISTRY[TASK]
        self.action("seal", input=staged()); self.assertEqual(self.action("start")["kind"], "accepted")
        self.assertIs(record["future"], self.executor.future)
        for operation in (lambda: app.read_task_status(TASK), lambda: app.cancel_task(TASK),
                          lambda: app._start_async_task(StartPythonRuntimeTaskRequest(requestId=TASK, taskType="train-model", payload={}))):
            with self.assertRaises(Exception): operation()
        self.assertIs(app.TASK_REGISTRY[TASK], record); self.assertEqual(self.executor.calls, 1)
    def test_binding_and_worker_generation_denial(self):
        self.prepare(); wrong = deepcopy(self.reply["binding"]); wrong["workspaceId"] = "other"
        with self.assertRaises(session.TrainingSessionError): app._operate_original_training(TASK, "cancel", {"binding": wrong})
        with patch.object(app, "WORKER_STARTED_AT", "replacement"):
            with self.assertRaises(session.TrainingSessionError): self.action("read")
        self.assertNotIn("cancel", self.resources.calls)
    def test_original_record_reports_running_while_controlled_loader_waits(self):
        entered, finish = Event(), Event()
        def loader(*args, **kwargs):
            entered.set(); finish.wait(3)
            return TrainModelTaskResult(runId="inert", status="succeeded")
        with patch.object(session, "train_model_from_local_files", side_effect=loader):
            self.prepare(); self.action("seal", input=staged()); self.action("start")
        thread = Thread(target=self.executor.run); thread.start()
        try:
            self.assertTrue(entered.wait(3)); self.assertEqual(self.action("read")["record"]["status"], "running")
        finally: finish.set(); thread.join(3)
        self.assertFalse(thread.is_alive()); self.assertEqual(self.action("read")["record"]["status"], "succeeded")
    def test_prepare_ack_cannot_be_repeated_and_retained_history_not_pruned(self):
        self.prepare()
        with self.assertRaises(session.TrainingSessionError): app._prepare_original_training({"identity": app._training_identity(), "definition": definition()})
        self.action("cancel"); self.assertTrue(self.action("settle")["settled"])
        self.assertEqual(app._active_task_count(), 0)
        with app.TASK_REGISTRY_LOCK: app._prune_terminal_tasks_locked()
        self.assertIn(TASK, app.TASK_REGISTRY); self.assertEqual(self.producer.calls, 1)
    def test_no_trusted_producer_is_available_via_json(self):
        with self.assertRaises(session.TrainingSessionError): app.configure_original_training({"nativeReady": True})
    def test_authenticated_http_protocol_and_sanitized_failures(self):
        from fastapi.testclient import TestClient
        token = "synthetic-original-training-test-token"
        with patch.object(app, "RUNTIME_AUTH_TOKEN", token), TestClient(app.app) as client:
            payload = {"identity": {**identity_dict(self.producer.profile)}, "definition": definition()}
            self.assertEqual(client.post("/training/original/prepare", json=payload).status_code, 401)
            headers = {"authorization": "Bearer " + token}
            denied = client.post("/training/original/prepare", json=payload, headers=headers)
            self.assertEqual(denied.status_code, 409); self.assertNotIn("definition", denied.text)
            app.configure_original_training(self.producer)
            response = client.post("/training/original/prepare", json=payload, headers=headers)
            self.assertEqual(response.status_code, 200); self.reply = response.json()
            body = {"binding": self.reply["binding"]}
            self.assertEqual(client.post(f"/training/original/{TASK}/read", json=body, headers=headers).json()["record"]["requestId"], TASK)
            oversized = client.post(f"/training/original/{TASK}/seal", content=b"x" * (session.MAX_BODY_BYTES + 1), headers=headers)
            self.assertEqual(oversized.status_code, 409); self.assertEqual(oversized.json(), {"error": "original_training_unavailable"})
            self.assertEqual(client.get(f"/tasks/{TASK}", headers=headers).status_code, 409)
            self.assertEqual(client.post(f"/tasks/{TASK}/cancel", headers=headers).status_code, 409)
            self.assertEqual(client.post(f"/training/original/{TASK}/cancel", json=body, headers=headers).json()["cancelled"], True)
            self.assertEqual(client.post(f"/training/original/{TASK}/settle", json=body, headers=headers).json()["retirement"], "settled")


def identity_dict(profile):
    return {"runtimeId": app.RUNTIME_ID, "workerStartedAt": app.WORKER_STARTED_AT,
            "profileId": profile.profile_id, "profileFingerprint": profile.fingerprint}


if __name__ == "__main__": unittest.main()
