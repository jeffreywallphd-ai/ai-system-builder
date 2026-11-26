"""Inert ownership/protocol tests. Never import a model or acquire native files."""
from concurrent.futures import Future
from contextlib import contextmanager, nullcontext
from copy import deepcopy
from threading import Event, Thread
import unittest
from unittest.mock import patch
import ctypes
import importlib.util
import io
import json
import os
import subprocess
import tempfile
import sys
from pathlib import Path
from queue import Queue

from modules.adapters.runtime.python.worker import app
from modules.adapters.runtime.python.worker.models import TrainModelTaskRequest, TrainModelTaskResult, StartPythonRuntimeTaskRequest, EnsureModelDownloadRequest
from modules.adapters.runtime.python.worker.tasks import approved_local_training_session as session
from modules.adapters.runtime.python.worker.native import windows_original_worker_launch as model_native

TASK = "11111111-1111-4111-8111-111111111111"
WORKSPACE = "22222222-2222-4222-8222-222222222222"
DIGEST = "sha256:" + "a" * 64
FIXTURE_PATH = Path(__file__).parent / "fixtures" / "approved_training_staged_input.json"


def producer_fixture():
    value = json.loads(FIXTURE_PATH.read_text(encoding="utf8"))
    if value["schema_version"] != "approved-training-staged-input-fixture-v1": raise AssertionError("Unknown synthetic fixture version")
    root = Path(tempfile.gettempdir()).resolve() / "aisb-inert-semantic-paths-no-io"
    def slot(item, key, expected, target):
        if item[key] != expected: raise AssertionError("Unexpected synthetic path slot")
        item[key] = str(target)
    slot(value["approvedRequest"]["baseModel"], "localPath", "@model", root / "model")
    slot(value["staged"]["payload"]["baseModel"], "localPath", "@model", root / "model")
    for index, item in enumerate(value["staged"]["payload"]["datasets"]):
        slot(item, "path", "@input-" + str(index), root / "inputs" / ("input-" + str(index) + ".jsonl"))
    slot(value["staged"]["recipe"], "path", "@recipe", root / "inputs" / "recipe.json")
    slot(value["staged"]["payload"]["output"], "outputDirectory", "@output", root / "output")
    slot(value["staged"], "outputDirectory", "@output", root / "output")
    return value  # Only known path nodes; no files or model are opened.


def definition():
    source = producer_fixture()
    request = source["approvedRequest"]; request["workspaceId"] = WORKSPACE
    return {"requestId": TASK, "workspaceId": WORKSPACE,
            "owner": {"organizationId": "org", "principalId": "actor", "clientId": TASK, "hostIncarnationId": WORKSPACE},
            "modelUpdatedAt": "2026-11-23T00:00:00Z", "dataset": {"datasetId": "data", "versionId": "v1", "versionDigest": DIGEST, "recipeDigest": source["recipeDigest"]},
            "proposalDigest": DIGEST, "inputs": source["inputs"], "recipeSizeBytes": source["recipeSizeBytes"], "request": request}


def staged():
    value = producer_fixture()["staged"]; value["payload"]["workspaceId"] = WORKSPACE
    return value


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
    def setUp(self):
        # Every ordinary test loader is explicitly inert, including valid data.
        item = patch.object(session, "train_model_from_local_files", return_value=TrainModelTaskResult(runId="inert", status="succeeded"))
        self.loader_stub = item.start(); self.addCleanup(item.stop)
        # These control-flow units isolate the Native neighbor. Separate ABI
        # cases and the real-view composition below execute its actual proof.
        native=patch.object(session,"resolve_original_model_view",return_value="inert-protected-model")
        self.native_view_stub=native.start(); self.addCleanup(native.stop); self.native_view_patch=native

    def test_missing_native_view_fails_before_the_fixed_loader(self):
        self.native_view_patch.stop()
        owner=self.ready(); owner.start(); self.executor.run()
        self.loader_stub.assert_not_called(); self.assertEqual(self.publications[-1]["status"],"failed")
        self.assertEqual(self.publications[-1]["error"]["code"],"private_training_failed")

    @unittest.skipUnless(sys.platform=="win32","Original native session composition uses the declared Windows profile")
    def test_actual_native_view_is_passed_to_fixed_loader_with_unchanged_sealed_request(self):
        from modules.adapters.runtime.python.worker.tests.test_native_training_model_graph import borrowed_model_view
        self.native_view_patch.stop()
        defined=definition(); defined["request"]["baseModel"]["localPath"]="X:\\models\\selected"
        owner=self.owner(defined=defined); value=staged(); value["payload"]["baseModel"]["localPath"]="X:\\models\\selected"
        payload=TrainModelTaskRequest.model_validate(value["payload"])
        @contextmanager
        def borrow():
            self.resources.calls.append("borrow")
            with borrowed_model_view(defined,payload.model_dump(mode="json"),model_native) as (view,physical):
                self.physical=physical; yield view
        self.resources.borrow=borrow
        def fixed_loader(request,**options):
            self.assertEqual(request.baseModel.localPath,"X:\\models\\selected")
            self.assertFalse(options["compare_validation_baseline"])
            self.assertEqual(model_native.resolve_original_model_view(options["_model_view"],request.model_dump(mode="json")),self.physical)
            return TrainModelTaskResult(runId="inert",status="succeeded")
        owner.loader=fixed_loader  # Explicit inert supplier; no engine or model is imported.
        self.assertEqual(owner.prepare(),"prepared"); self.assertEqual(owner.seal(value),"ready")
        before=owner.payload.model_dump(mode="json"); owner.start(); self.executor.run()
        self.assertEqual(self.publications[-1]["status"],"succeeded"); self.assertEqual(owner.payload.model_dump(mode="json"),before)
    def test_only_positive_no_effect_capture_disarms_worker_exit_requirement(self):
        producer = Producer(); producer.capture = lambda _: None
        owner = session.OriginalTrainingSession(definition(), producer, lambda: True, lambda **_: True, lambda _: None)
        self.assertEqual(owner.prepare(), "unavailable"); self.assertTrue(owner.settled)
        self.assertFalse(owner.blocks_recovery)

    @unittest.skipUnless(sys.platform=="win32","Original native input composition uses the declared Windows profile")
    def test_session_passes_actual_joint_view_and_keeps_the_approved_payload(self):
        from modules.adapters.runtime.python.worker.tests.test_native_training_model_graph import TrainingInputCopyTests
        self.native_view_patch.stop(); case=TrainingInputCopyTests()
        source,lease,value,config,control,kernel,*_=case.fixture(count=2,native_module=model_native)
        self.addCleanup(case.doCleanups)
        owner=self.owner(defined=deepcopy(source.definition)); graphs=[]; calls=[]
        def seal(raw):
            # Controlled resource neighbor: actual Model/input proof, but no
            # output/resource/full-producer readiness or real ML qualification.
            graph=model_native.OriginalTrainingInputGraph(lease,raw,config,control,control)
            graphs.append(graph); graph.prepare()
            return TrainModelTaskRequest.model_validate(raw["payload"])
        self.resources.seal_inputs=seal
        self.resources.borrow=lambda: lease.borrow(owner.payload.model_dump(mode="json"))
        self.resources.closed=False  # This fixture cannot prove whole-worker retirement.
        def fixed_loader(payload,**options):
            request=payload.model_dump(mode="json")
            calls.append(model_native.resolve_original_training_references(options["_model_view"],request))
            self.assertEqual(request,owner.payload.model_dump(mode="json")); self.assertFalse(options["compare_validation_baseline"])
            return TrainModelTaskResult(runId="controlled",status="succeeded")
        owner.loader=fixed_loader
        self.assertEqual(owner.prepare(),"prepared"); self.assertEqual(owner.seal(value),"ready")
        before=owner.payload.model_dump(mode="json"); self.assertEqual(owner.start()["kind"],"accepted")
        runner=Thread(target=self.executor.run); runner.start(); runner.join(3)
        self.assertFalse(runner.is_alive()); self.assertEqual(self.publications[-1]["status"],"succeeded")
        graph=graphs[0]
        self.assertEqual(calls,[(source.physical_path,tuple(graph.physical_path+"\\"+row["name"] for row in graph.records[:-1]))])
        self.assertEqual(owner.payload.model_dump(mode="json"),before)
        self.assertFalse(owner.settle()); self.assertTrue(owner.blocks_recovery); self.assertEqual(control.retained,[])
    def test_unknown_capture_keeps_the_original_worker_fenced(self):
        producer = Producer()
        def unknown(_): raise RuntimeError("inert binding outcome unknown")
        producer.capture = unknown
        owner = session.OriginalTrainingSession(definition(), producer, lambda: True, lambda **_: True, lambda _: None)
        self.assertEqual(owner.prepare(), "unconfirmed"); self.assertTrue(owner.blocks_recovery)
    def owner(self, submit=None, defined=None):
        self.resources = Resources(); self.producer = Producer(self.resources); self.executor = QueuedExecutor(); self.publications = []
        self.current = True
        self.instance = session.OriginalTrainingSession(defined or definition(), self.producer, lambda: self.current,
            lambda **value: self.publications.append(value), submit or (lambda owner: self.executor.submit(owner.run)))
        return self.instance
    def ready(self, submit=None):
        owner = self.owner(submit); self.assertEqual(owner.prepare(), "prepared"); self.assertEqual(owner.seal(staged()), "ready"); return owner
    def test_legacy_session_never_looks_up_the_optional_original_file_owner(self):
        calls = []
        def getter(resource): calls.append("getter"); raise AssertionError("Optional v2 method must not run")
        with patch.object(Resources, "original_files", property(getter)):
            owner = self.ready(); owner.start(); self.executor.run(); self.assertTrue(owner.settle())
        self.assertEqual(calls, [])
    def test_native_preparation_cancellation_cannot_publish_prepared(self):
        owner = self.owner(); original = self.resources.prepare
        def cancelling():
            result = original(); owner.cancel(); return result
        self.resources.prepare = cancelling
        self.assertEqual(owner.prepare(), "unconfirmed"); self.assertTrue(owner.cancelled)
    def test_configured_original_loader_and_permanent_retirement(self):
        owner = self.owner()
        with patch.object(session, "train_model_from_local_files", return_value=TrainModelTaskResult(runId="inert", status="succeeded")) as loader:
            # The fixed loader must be captured at construction, before producer IO.
            owner = self.owner(); owner.prepare(); owner.seal(staged()); self.assertEqual(owner.start()["kind"], "accepted")
            self.executor.run(); self.assertTrue(owner.settle()); self.assertTrue(owner.settle())
            self.assertEqual(loader.call_args.kwargs["compare_validation_baseline"], False)
            self.assertEqual(self.resources.calls, ["prepare", "seal", "borrow", "settle"])
            self.assertEqual(self.publications[-1]["data"]["runId"], TASK)
            self.assertTrue(owner.blocks_recovery); self.assertTrue(owner.retains_record)
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

    def test_changed_host_staging_is_denied_before_native_seal(self):
        cases = {
            "model-id": lambda v: v["payload"]["baseModel"].update(modelRecordId="other"),
            "model-path": lambda v: v["payload"]["baseModel"].update(localPath=v["outputDirectory"]),
            "workspace": lambda v: v["payload"].update(workspaceId="other"),
            "task": lambda v: v["payload"].update(trainingTask="causal-lm"),
            "method": lambda v: v["payload"].update(method="full-finetune"),
            "parameters": lambda v: v["payload"]["commonParameters"].update(maxSteps=99),
            "boolean-number": lambda v: v["payload"]["commonParameters"].update(maxSteps=True),
            "float-integer": lambda v: v["payload"]["commonParameters"].update(maxSteps=1.0),
            "unknown-parameter": lambda v: v["payload"].update(advancedParameters={"new": 1}),
            "unknown-outer": lambda v: v["payload"].update(ignoredByPydantic=True),
            "unknown-model": lambda v: v["payload"]["baseModel"].update(ignoredByPydantic=True),
            "unknown-dataset": lambda v: v["payload"]["datasets"][0].update(metadata={}),
            "input-id": lambda v: v["payload"]["datasets"][0].update(artifactId="other"),
            "input-role": lambda v: v["payload"]["datasets"][0].update(splitRole="validation"),
            "format": lambda v: v["payload"]["datasets"][0].update(format="csv"),
            "input-locator": lambda v: v["payload"]["datasets"][0].update(path="https://invalid.test/data"),
            "input-control": lambda v: v["payload"]["datasets"][0].update(path="\x00private"),
            "output-alias": lambda v: v["payload"]["output"].update(outputDirectory=v["recipe"]["path"]),
            "output-name": lambda v: v["payload"]["output"].update(outputModelName="Changed"),
            "output-destination": lambda v: v["payload"]["output"]["destination"]["local"].update(enabled=True),
            "validation": lambda v: v["payload"]["validation"].update(enabled=True),
            "recipe-digest": lambda v: v["recipe"].update(digest=DIGEST),
            "recipe-size": lambda v: v["recipe"].update(sizeBytes=True),
            "recipe-float": lambda v: v["recipe"].update(sizeBytes=float(v["recipe"]["sizeBytes"])),
            "recipe-fields": lambda v: v["recipe"].update(ignored=True),
            "missing-model-path": lambda v: v["payload"]["baseModel"].pop("localPath"),
        }
        for name, mutate in cases.items():
            with self.subTest(name=name):
                owner = self.owner(); owner.prepare(); value = staged(); mutate(value)
                try: result = owner.seal(value)
                except session.TrainingSessionError: result = "denied"
                self.assertIn(result, ("unconfirmed", "denied"))
                self.assertNotIn("seal", self.resources.calls); self.assertEqual(self.executor.calls, 0)
                self.loader_stub.assert_not_called(); self.assertTrue(owner.blocks_recovery)

    def test_changed_native_result_never_reaches_ready_or_loader(self):
        for name in ("method", "parameter", "boolean-number", "model-path", "role", "metadata", "destination", "constructed", "dump-override", "input-mutation"):
            with self.subTest(name=name):
                owner = self.owner()
                def seal(value):
                    self.resources.calls.append("seal")
                    if name == "input-mutation": value["payload"]["commonParameters"]["maxSteps"] = 8
                    payload = TrainModelTaskRequest.model_validate(value["payload"])
                    if name == "method": payload.method = "full-finetune"
                    if name == "parameter": payload.commonParameters["maxSteps"] = 8
                    if name == "boolean-number": payload.commonParameters["maxSteps"] = True
                    if name == "model-path": payload.baseModel.localPath = value["outputDirectory"]
                    if name == "role": payload.datasets[0].splitRole = "validation"
                    if name == "metadata": payload.datasets[0].metadata = {"unapproved": True}
                    if name == "destination": payload.output["destination"]["local"]["enabled"] = True
                    if name == "constructed": payload = TrainModelTaskRequest.model_construct(method="lora")
                    if name == "dump-override":
                        payload.commonParameters["maxSteps"] = 8
                        object.__setattr__(payload, "model_dump", lambda **_: value["payload"])
                    return payload
                self.resources.seal_inputs = seal; owner.prepare()
                self.assertEqual(owner.seal(staged()), "unconfirmed")
                with self.assertRaises(session.TrainingSessionError): owner.start()
                with self.assertRaises(session.TrainingSessionError): owner.seal(staged())
                self.assertEqual(self.resources.calls.count("seal"), 1)
                self.assertEqual(self.executor.calls, 0); self.loader_stub.assert_not_called()
                self.assertTrue(owner.blocks_recovery)

    def test_documented_formats_and_native_private_aliases_preserve_semantics(self):
        formats = {"application/x-ndjson": "jsonl", "application/jsonl": "jsonl", "application/json": "json", "text/json": "json",
                   "text/csv": "csv", "application/csv": "csv", "application/x-parquet": "parquet", "application/vnd.apache.parquet": "parquet"}
        for media, fmt in formats.items():
            for original_format in (False, True):
                with self.subTest(media=media, original_format=original_format):
                    defined, value = definition(), staged(); defined["inputs"][0]["mediaType"] = media
                    if original_format: defined["request"]["datasets"][0]["format"] = fmt
                    else: defined["request"]["datasets"][0].pop("format", None)
                    value["payload"] = deepcopy(defined["request"])
                    value["payload"]["datasets"][0].update(format=fmt, path=staged()["payload"]["datasets"][0]["path"])
                    value["payload"]["output"]["outputDirectory"] = value["outputDirectory"]
                    owner = self.owner(defined=defined)
                    def seal(data):
                        self.resources.calls.append("seal"); result = TrainModelTaskRequest.model_validate(data["payload"])
                        result.datasets[0].path += ".native-alias"; result.output["outputDirectory"] += "-native-alias"
                        return result
                    self.resources.seal_inputs = seal; owner.prepare()
                    self.assertEqual(owner.seal(value), "ready"); self.assertEqual(owner.payload.baseModel.localPath, defined["request"]["baseModel"]["localPath"])
                    self.loader_stub.assert_not_called()

    def test_ordered_inputs_and_opaque_null_false_and_arrays_stay_exact(self):
        for name in ("reorder", "drop-null", "false-number", "array-order", "unknown-media"):
            with self.subTest(name=name):
                defined, value = definition(), staged()
                defined["request"]["commonParameters"].update(nullable=None, flag=False, targetModules=["one", "two"])
                defined["inputs"].append({**defined["inputs"][0], "artifactId": "input-1", "role": "validation"})
                defined["request"]["datasets"].append({"artifactId": "input-1", "splitRole": "validation", "format": "jsonl"})
                value["payload"] = deepcopy(defined["request"])
                for index, row in enumerate(value["payload"]["datasets"]): row["path"] = staged()["payload"]["datasets"][0]["path"] + str(index)
                value["payload"]["output"]["outputDirectory"] = value["outputDirectory"]
                if name == "reorder": value["payload"]["datasets"].reverse()
                if name == "drop-null": value["payload"]["commonParameters"].pop("nullable")
                if name == "false-number": value["payload"]["commonParameters"]["flag"] = 0
                if name == "array-order": value["payload"]["commonParameters"]["targetModules"].reverse()
                if name == "unknown-media": defined["inputs"][0]["mediaType"] = "unsupported/example"
                owner = self.owner(defined=defined); owner.prepare()
                self.assertEqual(owner.seal(value), "unconfirmed"); self.assertNotIn("seal", self.resources.calls)
                self.assertEqual(self.executor.calls, 0); self.loader_stub.assert_not_called()

    def test_schema_operations_are_captured_before_native_result_callback(self):
        owner = self.owner(); reply = TrainModelTaskRequest.model_validate(staged()["payload"])
        self.resources.seal_inputs = lambda _: reply; owner.prepare()
        with patch.object(TrainModelTaskRequest, "__pydantic_validator__", None), patch.object(TrainModelTaskRequest, "__pydantic_serializer__", None):
            self.assertEqual(owner.seal(staged()), "ready")
        self.loader_stub.assert_not_called()

    def test_currentness_or_cancellation_lost_during_native_seal_cannot_publish_ready(self):
        for mode in ("current", "cancel"):
            with self.subTest(mode=mode):
                owner = self.owner()
                def seal(value):
                    result = TrainModelTaskRequest.model_validate(value["payload"])
                    if mode == "current": self.current = False
                    else: owner.cancel()
                    return result
                self.resources.seal_inputs = seal; owner.prepare()
                self.assertEqual(owner.seal(staged()), "unconfirmed")
                with self.assertRaises(session.TrainingSessionError): owner.start()
                self.assertEqual(self.executor.calls, 0); self.loader_stub.assert_not_called()


class OriginalRoutesTests(unittest.TestCase):
    def setUp(self):
        self.registry = app.TASK_REGISTRY
        self.executor = QueuedExecutor(); self.resources = Resources(); self.producer = Producer(self.resources)
        self.patches = [patch.object(app, "TASK_REGISTRY", {}), patch.object(app, "TASK_EXECUTOR", self.executor),
                        patch.object(session, "train_model_from_local_files", return_value=TrainModelTaskResult(runId="inert", status="succeeded")),
                        # Route control-flow tests isolate the Native-view neighbor;
                        # the actual registered view is exercised separately above.
                        patch.object(session, "resolve_original_model_view", return_value="inert/protected/model"),
                        patch.object(app, "_ORIGINAL_TRAINING_PRODUCER", None), patch.object(app, "_ORIGINAL_TRAINING_PROFILE", None)]
        for item in self.patches: item.start()
        self.addCleanup(lambda: [item.stop() for item in reversed(self.patches)])
    def prepare(self):
        app.configure_original_training(self.producer)
        self.reply = app._prepare_original_training({"identity": app._training_identity(), "definition": definition()})
        return self.reply
    def action(self, name, **extra): return app._operate_original_training(TASK, name, {"binding": self.reply["binding"], **extra})
    def retire_training(self):
        self.prepare(); self.action("cancel"); self.assertTrue(self.action("settle")["settled"])
    def test_legacy_protocol_does_not_advertise_or_dispatch_local_exit_readiness(self):
        self.prepare()
        self.assertIn(session.CAPABILITY, app.capabilities().capabilities)
        self.assertNotIn("train-model.original-exit-ready-v1", app.capabilities().capabilities)
        with self.assertRaises(session.TrainingSessionError): self.action("exit-ready")
    def test_remote_retirement_keeps_worker_admission_fenced(self):
        self.retire_training()
        self.assertTrue(app.TASK_REGISTRY[TASK]["_originalTrainingOwner"].blocks_recovery)
    def test_remote_retirement_cannot_admit_another_original_session(self):
        self.retire_training(); other = definition(); other["requestId"] = WORKSPACE
        with self.assertRaises(session.TrainingSessionError):
            app._prepare_original_training({"identity": app._training_identity(), "definition": other})
        self.assertEqual(self.producer.calls, 1)
    def test_remote_retirement_cannot_admit_a_generic_task(self):
        self.retire_training()
        with self.assertRaises(RuntimeError):
            app._start_async_task(StartPythonRuntimeTaskRequest(requestId=WORKSPACE, taskType="train-model", payload={}))
        self.assertEqual(self.executor.calls, 0)
    def test_remote_retirement_denies_model_unload(self):
        self.retire_training()
        with patch.object(app, "unload_generation_models", return_value=[]) as unload:
            result = app.unload_models(); self.assertEqual(result.status_code, 409); unload.assert_not_called()
    def test_remote_retirement_denies_model_download(self):
        self.retire_training()
        with patch.object(app, "_ensure_model_download_data", side_effect=RuntimeError("inert provider must not run")) as download:
            result = app.ensure_model_download(EnsureModelDownloadRequest(provider="transformers", modelId="inert/model"))
            self.assertEqual(result.status_code, 409); download.assert_not_called()
    def test_positive_no_effect_capture_does_not_close_ordinary_worker_admission(self):
        self.producer.capture = lambda _: None
        self.assertEqual(self.prepare()["phase"], "unavailable")
        self.assertEqual(app._active_task_count(), 0)
        with patch.object(app, "unload_generation_models", return_value=[]) as unload:
            self.assertEqual(app.unload_models().activeTaskCount, 0); unload.assert_called_once()
    def test_existing_direct_download_reserves_admission_before_native_capture(self):
        app.configure_original_training(self.producer)
        entered, finish = Event(), Event(); results = []
        def downloading(_):
            entered.set(); finish.wait(3)
            return {"provider": "transformers", "modelId": "inert/model", "downloaded": True, "fromCache": True}
        with patch.object(app, "_ensure_model_download_data", side_effect=downloading):
            thread = Thread(target=lambda: results.append(app.ensure_model_download(EnsureModelDownloadRequest(provider="transformers", modelId="inert/model"))))
            thread.start()
            try:
                self.assertTrue(entered.wait(3))
                with self.assertRaises(session.TrainingSessionError):
                    app._prepare_original_training({"identity": app._training_identity(), "definition": definition()})
                self.assertEqual(self.producer.calls, 0)
            finally: finish.set(); thread.join(3)
        self.assertFalse(thread.is_alive()); self.assertEqual(app.MODEL_DOWNLOAD_OPERATIONS, 0); self.assertEqual(len(results), 1)
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
        self.assertEqual(app._active_task_count(), 1)
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


_native_path = Path(__file__).resolve().parents[1] / "native" / "windows_original_worker_launch.py"
_native_spec = importlib.util.spec_from_file_location("_aisb_inert_native_launch", _native_path)
native_launch = importlib.util.module_from_spec(_native_spec)
_native_spec.loader.exec_module(native_launch)  # ABI declarations only; no Native API construction.


def native_boot():
    profile = {"schema": "windows-original-worker-job-v1", "profileId": "inert-no-native", "processMemoryBytes": 64 * 1024**2,
               "jobMemoryBytes": 128 * 1024**2, "maximumActiveProcesses": 1, "maximumDurationMs": 30000, "observationMs": 30}
    return {"schema": "windows-original-worker-launch-v1", "nonce": "c" * 64, "profile": profile,
            "profileDigest": native_launch.profile_digest(profile),
            "environment": {"PYTHON_RUNTIME_HOST": "127.0.0.1", "PYTHON_RUNTIME_PORT": "43111",
                            "PYTHON_RUNTIME_AUTH_TOKEN": "inert-".ljust(40, "x"), "PYTHON_RUNTIME_STARTUP_PROOF": "a" * 64}}


class InertLaunchKernel:
    """In-memory ABI outputs only. Never loads a DLL or starts a process."""
    def __init__(self):
        self.calls = []; self.next_handle = 101; self.limits = None; self.attributes = {}; self.active = 1
        self.create_unknown = False; self.foreign_image = False; self.close_failure = None; self.closed = set(); self.after_wait = None; self.error_after_return = None
    def handle(self):
        value = self.next_handle; self.next_handle += 1; return value
    def invoke(self, name, args, record):
        value, error = self.result(name, args)
        record.update(value=value, value_returned=True)
        if self.error_after_return == name: raise RuntimeError("inert error-reader acknowledgement lost")
        return value, error
    def result(self, name, args):
        self.calls.append((name, args))
        if name in ("CreateJobObjectW", "CreateFileW"): return self.handle(), 0
        if name == "GetHandleInformation": args[1]._obj.value = 0; return 1, 0
        if name == "SetInformationJobObject": self.limits = ctypes.string_at(args[2], args[3]); return 1, 0
        if name == "QueryInformationJobObject":
            if args[1] == 9: ctypes.memmove(args[2], self.limits, len(self.limits))
            else: args[2]._obj.active = self.active; args[2]._obj.total = 1
            return 1, 0
        if name == "CreatePipe": args[0]._obj.value = self.handle(); args[1]._obj.value = self.handle(); return 1, 0
        if name == "SetHandleInformation": return 1, 0
        if name == "InitializeProcThreadAttributeList":
            if args[0] is None: args[3]._obj.value = 128; return 0, 122
            return 1, 0
        if name == "UpdateProcThreadAttribute": self.attributes[args[2]] = tuple(args[3]); return 1, 0
        if name == "CreateProcessW":
            info = args[9]._obj; info.process, info.thread, info.pid, info.tid = self.handle(), self.handle(), 4321, 5432
            if self.create_unknown: raise RuntimeError("inert lost CreateProcess result")
            return 1, 0
        if name == "IsProcessInJob": args[2]._obj.value = 1; return 1, 0
        if name == "GetCurrentProcess": return -1, 0
        if name == "QueryFullProcessImageNameW":
            text = "X:/inert/other.exe" if self.foreign_image and args[0] != -1 else "X:/inert/python.exe"
            args[2].value = text; args[3]._obj.value = len(text); return 1, 0
        if name == "GetProcessTimes": args[1]._obj.low = 1; return 1, 0
        if name == "ResumeThread": return 1, 0
        if name == "ReadFile": args[3]._obj.value = 0; return 0, 109
        if name == "TerminateJobObject": self.active = 0; return 1, 0
        if name == "WaitForSingleObject":
            if self.after_wait: self.after_wait()
            return (0 if self.active == 0 else 258), 0
        if name == "DeleteProcThreadAttributeList": return None, 0
        if name == "CloseHandle":
            if args[0] == self.close_failure: return 0, 6
            if args[0] in self.closed: raise AssertionError("duplicate native close")
            self.closed.add(args[0]); return 1, 0
        raise AssertionError("Unexpected Native function: " + name)


class NativeLaunchSourceTests(unittest.TestCase):
    def owner(self, kernel=None):
        kernel = kernel or InertLaunchKernel()
        return native_launch.OriginalWorker(native_boot(), kernel=kernel, executable="X:/inert/python.exe",
                                            worker_root=Path(__file__).resolve().parents[1]), kernel
    def test_creation_time_job_and_only_three_stdio_handles_precede_one_resume(self):
        owner, kernel = self.owner(); self.assertEqual(kernel.calls, []); owner.prepare()
        self.assertEqual(owner.phase, "suspended"); self.assertFalse(owner.resume_attempted)
        self.assertEqual(kernel.attributes[native_launch.JOB_LIST], (owner.job.slot.value,))
        self.assertEqual(len(kernel.attributes[native_launch.HANDLE_LIST]), 3)
        self.assertNotIn(owner.job.slot.value, kernel.attributes[native_launch.HANDLE_LIST])
        create = next(args for name, args in kernel.calls if name == "CreateProcessW")
        self.assertEqual(create[5], native_launch.CREATE_FLAGS)
        self.assertIn("main.py", create[1].value); self.assertIn("-I -B -u", create[1].value)
        owner.resume(); self.assertEqual(owner.phase, "running")
        with self.assertRaises(native_launch.LaunchUnavailable): owner.resume()
        self.assertEqual(sum(name == "ResumeThread" for name, _ in kernel.calls), 1)
    def test_original_job_process_readers_and_handles_all_precede_retired(self):
        owner, kernel = self.owner(); owner.prepare(); owner.start_readers(lambda *_: None); owner.resume()
        self.assertFalse(owner.observe_retirement()); owner.request_stop(); owner.request_stop()
        for reader in owner.readers: reader.join(1); self.assertFalse(reader.is_alive())
        self.assertTrue(owner.observe_retirement()); self.assertTrue(owner.observe_retirement())
        self.assertTrue(all(handle.closed for handle in owner.handles)); self.assertFalse(owner.pending)
        self.assertEqual(sum(name == "TerminateJobObject" for name, _ in kernel.calls), 1)
    def test_unknown_creation_retains_original_native_outputs_without_adoption_or_resume(self):
        kernel = InertLaunchKernel(); kernel.create_unknown = True; owner, _ = self.owner(kernel)
        with self.assertRaises(native_launch.LaunchUnavailable): owner.prepare()
        self.assertTrue(owner.create_attempted); self.assertTrue(owner.unknown)
        self.assertFalse(owner.process.known); self.assertFalse(owner.primary_thread.known)
        self.assertTrue(any(row["name"] == "CreateProcessW" for row in owner.pending))
        with self.assertRaises(native_launch.LaunchUnavailable): owner.prepare()
        with self.assertRaises(native_launch.LaunchUnavailable): owner.resume()
        self.assertEqual(sum(name == "CreateProcessW" for name, _ in kernel.calls), 1)
        self.assertFalse(owner.observe_retirement())
    def test_foreign_image_never_resumes_the_suspended_worker(self):
        kernel = InertLaunchKernel(); kernel.foreign_image = True; owner, _ = self.owner(kernel)
        with self.assertRaises(native_launch.LaunchUnavailable): owner.prepare()
        with self.assertRaises(native_launch.LaunchUnavailable): owner.resume()
        self.assertFalse(any(name == "ResumeThread" for name, _ in kernel.calls))
    def test_selected_venv_launcher_can_differ_from_controller_base_image(self):
        class Kernel(InertLaunchKernel):
            def result(self, name, args):
                if name == "QueryFullProcessImageNameW":
                    self.calls.append((name, args))
                    text = "X:/inert/base/python.exe" if args[0] == -1 else "X:/inert/venv/Scripts/python.exe"
                    args[2].value = text; args[3]._obj.value = len(text); return 1, 0
                return super().result(name, args)
        kernel = Kernel()
        owner = native_launch.OriginalWorker(native_boot(), kernel=kernel, executable="X:/inert/venv/Scripts/python.exe",
                                            worker_root=Path(__file__).resolve().parents[1])
        owner.prepare(); self.assertEqual(owner.phase, "suspended"); owner.resume()
        self.assertEqual(sum(name == "ResumeThread" for name, _ in kernel.calls), 1)
    def test_unknown_close_is_retained_and_never_reissued(self):
        owner, kernel = self.owner(); owner.prepare(); handle = owner.primary_thread; kernel.close_failure = handle.slot.value
        with self.assertRaises(native_launch.LaunchUnavailable): owner.close(handle)
        with self.assertRaises(native_launch.LaunchUnavailable): owner.close(handle)
        self.assertTrue(handle.close_attempted); self.assertFalse(handle.closed)
        self.assertEqual(sum(name == "CloseHandle" and args[0] == handle.slot.value for name, args in kernel.calls), 1)
    def test_reader_failure_during_retirement_observation_cannot_be_cleared(self):
        owner, kernel = self.owner(); owner.prepare(); owner.resume(); owner.request_stop()
        kernel.after_wait = lambda: setattr(owner, "unknown", True)
        self.assertFalse(owner.observe_retirement())
        self.assertFalse(owner.job.closed)
    def test_native_returned_handle_survives_a_lost_error_reader_acknowledgement(self):
        kernel = InertLaunchKernel(); kernel.error_after_return = "CreateJobObjectW"; owner, _ = self.owner(kernel)
        with self.assertRaises(native_launch.LaunchUnavailable): owner.prepare()
        row = owner.pending[0]; self.assertEqual(row["name"], "CreateJobObjectW")
        self.assertTrue(row["value_returned"]); self.assertEqual(row["value"], 101)
        self.assertFalse(owner.job.known); self.assertTrue(owner.unknown)
    def test_resume_rechecks_admission_after_native_readbacks(self):
        owner, kernel = self.owner(); owner.prepare(); admissions = iter((True, False))
        with self.assertRaises(native_launch.LaunchUnavailable): owner.resume(lambda: next(admissions))
        self.assertFalse(owner.resume_attempted)
        self.assertFalse(any(name == "ResumeThread" for name, _ in kernel.calls))
    def test_resume_rechecks_deadline_after_native_readbacks(self):
        owner, kernel = self.owner(); owner.prepare(); now = [owner.started_at]
        owner.clock = lambda: now[0]
        def expire(): now[0] += owner.profile["maximumDurationMs"] / 1000 + 1; return True
        admissions = iter((lambda: True, expire))
        with self.assertRaises(native_launch.LaunchUnavailable): owner.resume(lambda: next(admissions)())
        self.assertFalse(owner.resume_attempted)
        self.assertFalse(any(name == "ResumeThread" for name, _ in kernel.calls))
    def test_closed_command_input_never_resumes_a_queued_resume(self):
        boot = native_boot(); owner, kernel = self.owner()
        command = {"schema": "windows-original-worker-command-v1", "nonce": boot["nonce"],
                   "profileDigest": boot["profileDigest"], "action": "resume"}
        source = io.BytesIO((json.dumps(boot) + "\n" + json.dumps(command) + "\n").encode())
        sink = io.BytesIO()
        self.assertEqual(native_launch.serve(source, sink, owner_factory=lambda _: owner), 0)
        frames = [json.loads(line) for line in sink.getvalue().splitlines()]
        self.assertEqual([frame["kind"] for frame in frames], ["suspended", "retired"])
        self.assertFalse(any(name == "ResumeThread" for name, _ in kernel.calls))
        self.assertTrue(all(handle.closed for handle in owner.handles))
    def test_final_worker_output_is_encoded_and_drained_before_retired(self):
        boot = native_boot(); lines = Queue(); lines.put((json.dumps(boot) + "\n").encode())
        frames, owners = [], []
        class Source:
            def readline(self, maximum): return lines.get(timeout=2)
        class Sink:
            def write(self, data):
                frame = json.loads(data); frames.append(frame)
                action = "resume" if frame["kind"] == "suspended" else "stop" if frame["kind"] == "running" else None
                if action:
                    lines.put((json.dumps({"schema": "windows-original-worker-command-v1", "nonce": boot["nonce"],
                                          "profileDigest": boot["profileDigest"], "action": action}) + "\n").encode())
                if frame["kind"] == "retired": lines.put(b"")
                return len(data)
            def flush(self): pass
        class Owner(native_launch.OriginalWorker):
            final_output = False
            def start_readers(self, publish):
                self.publish = publish; super().start_readers(publish)
            def observe_retirement(self):
                if self.stop_attempted and not self.final_output:
                    self.final_output = True
                    self.publish("stdout", b'{"kind":"retired","nonce":"forged-worker-text"}\n')
                return super().observe_retirement()
        def factory(value):
            owner = Owner(value, kernel=InertLaunchKernel(), executable="X:/inert/python.exe",
                          worker_root=Path(__file__).resolve().parents[1]); owners.append(owner); return owner
        self.assertEqual(native_launch.serve(Source(), Sink(), owner_factory=factory), 0)
        self.assertEqual([frame["kind"] for frame in frames], ["suspended", "running", "worker-output", "retired"])
        import base64
        self.assertIn(b"forged-worker-text", base64.b64decode(frames[2]["data"]))
        self.assertTrue(all(handle.closed for handle in owners[0].handles))
    def test_received_stop_prevents_queued_resume_while_input_remains_open(self):
        boot = native_boot(); queued, released = Event(), Event()
        class Source:
            def __init__(self):
                self.lines = [(json.dumps(boot) + "\n").encode()] + [(json.dumps({
                    "schema": "windows-original-worker-command-v1", "nonce": boot["nonce"],
                    "profileDigest": boot["profileDigest"], "action": action}) + "\n").encode() for action in ("resume", "stop")]
            def readline(self, maximum):
                if self.lines: return self.lines.pop(0)
                queued.set(); released.wait(2); return b""
        class Owner:
            def __init__(self):
                from threading import Lock
                self.lock = Lock(); self.profile = boot["profile"]; self.started_at = 0
                self.stop_attempted = self.unknown = False; self.resumes = 0
            def clock(self):
                if not queued.wait(1): raise AssertionError("Reader did not queue both commands")
                return 0
            def prepare(self): pass
            def start_readers(self, publish): pass
            def worker_exited(self): return False
            def request_stop(self): self.stop_attempted = True
            def resume(self, admission): self.resumes += 1
            def observe_retirement(self): return self.stop_attempted
        owner = Owner()
        try:
            self.assertEqual(native_launch.serve(Source(), io.BytesIO(), owner_factory=lambda _: owner), 0)
            self.assertEqual(owner.resumes, 0); self.assertFalse(released.is_set())
        finally: released.set()
    def test_profile_and_boot_reject_supplied_authority_before_api_construction(self):
        for mutate in (lambda b: b["profile"].update(processMemoryBytes=True), lambda b: b["profile"].update(jobMemoryBytes=1),
                       lambda b: b.update(nativeReady=True), lambda b: b["environment"].update(PYTHON_RUNTIME_HOST="0.0.0.0")):
            value = native_boot(); mutate(value)
            with self.assertRaises(native_launch.LaunchUnavailable): native_launch.OriginalWorker(value)
        with self.assertRaises(native_launch.LaunchUnavailable): native_launch.parse_frame(b'{"nonce":"a","nonce":"b"}')


class OriginalTrainingFileResourcesTests(unittest.TestCase):
    def fixture(self, *, control=None, delivery=None):
        from . import test_original_training_files as fixture
        case = fixture.OriginalTrainingFilesTests()
        self.addCleanup(case.doCleanups)
        row = case.fixture(control=control, delivery=delivery)
        resource = session.OriginalTrainingFileResources(row[0])
        return resource, row

    def test_prepare_is_passive_and_seal_rechecks_original_admission_before_any_copy(self):
        from . import test_original_training_files as fixture
        control = fixture.Current()
        resource, row = self.fixture(control=control)
        calls = []
        control.hook = lambda: calls.append("admission")
        before = len(row[7].calls)
        self.assertEqual(resource.prepare(), "ready")
        self.assertEqual(calls, [])
        self.assertEqual(len(row[7].calls), before)
        self.assertEqual(control.charges, [])
        control.current = False
        with self.assertRaises(ValueError): resource.seal_inputs(row[3])
        self.assertEqual(calls, ["admission"])
        self.assertEqual(len(row[7].calls), before)
        self.assertEqual(control.charges, [])
        with self.assertRaises(session.TrainingSessionError): resource.seal_inputs(row[3])
        self.assertFalse(resource.settle())

    def test_only_the_genuine_once_bound_file_owner_is_accepted_without_getters(self):
        resource, row = self.fixture()
        before = len(row[7].calls)
        class Fake:
            @property
            def prepare(self): raise AssertionError("A substitute getter was evaluated")
        for value in (Fake(), {}, object(), row[0]):
            with self.subTest(kind=type(value).__name__):
                with self.assertRaises(session.TrainingSessionError): session.OriginalTrainingFileResources(value)
        self.assertIs(resource.original_files(), row[0])
        self.assertEqual(len(row[7].calls), before)

    def test_wrong_thread_cannot_prepare_or_seal_the_original_file_owner(self):
        resource, row = self.fixture()
        failures = []
        def wrong_thread():
            for action in (resource.prepare, lambda: resource.seal_inputs(row[3])):
                try: action()
                except session.TrainingSessionError: failures.append(True)
        thread = Thread(target=wrong_thread)
        before = len(row[7].calls)
        thread.start(); thread.join(5)
        self.assertFalse(thread.is_alive())
        self.assertEqual(failures, [True, True])
        self.assertEqual(len(row[7].calls), before)
        self.assertEqual(resource.prepare(), "ready")

    def test_single_seal_and_joint_borrow_keep_original_output_and_guards(self):
        from . import test_original_training_files as fixture
        from ..tasks import original_training_files as files
        from ..tasks import original_training_output_delivery as delivery
        from time import monotonic
        case = fixture.OriginalTrainingFilesTests(); self.addCleanup(case.doCleanups)
        row = case.fixture(bind=False)
        queue = delivery.OriginalTrainingOutputDelivery(
            model_native._verified_model_receivers[row[1]]["task_id"],
            maximum_files=64, maximum_payload_bytes=256 * 1024, deadline=monotonic() + 30)
        file_owner = files.OriginalTrainingFiles(row[2], row[4], row[5], row[6], row[6], delivery=queue)
        self.addCleanup(lambda: files._owners.pop(file_owner, None))
        self.addCleanup(lambda: files._bindings.pop(file_owner, None))
        resource = session.OriginalTrainingFileResources(file_owner)
        self.assertIs(resource.output_delivery(), queue)
        with self.assertRaises(session.TrainingSessionError): resource.borrow()
        self.assertEqual(resource.prepare(), "ready")
        with self.assertRaises(session.TrainingSessionError): resource.prepare()
        payload = resource.seal_inputs(row[3])
        with self.assertRaises(session.TrainingSessionError): resource.seal_inputs(row[3])
        with resource.borrow() as view:
            self.assertIs(delivery.capture_original_output_delivery(view, payload.model_dump(mode="json")), queue)
            self.assertIs(resource.original_files(), file_owner)
        self.assertTrue(files._owners[file_owner]["output_closed"])
        self.assertTrue(all(not handle.closed for handle in row[1].guards))
        self.assertIs(resource.output_delivery(), queue)
        with self.assertRaises(session.TrainingSessionError): resource.borrow()
        self.assertFalse(resource.settle())

    def test_failed_copy_retains_original_attempt_and_cannot_retry_or_borrow(self):
        resource, row = self.fixture()
        self.assertEqual(resource.prepare(), "ready")
        row[7].short_write = True
        with self.assertRaises(ValueError): resource.seal_inputs(row[3])
        before = len(row[7].calls)
        self.assertEqual(row[6].charges, [row[4]["maximumCopyBytes"]])
        with self.assertRaises(session.TrainingSessionError): resource.seal_inputs(row[3])
        with self.assertRaises(session.TrainingSessionError): resource.borrow()
        self.assertEqual(len(row[7].calls), before)
        self.assertIs(resource.original_files(), row[0])
        self.assertFalse(resource.settle())

    def test_replaced_original_file_helper_is_refused_before_new_io_or_observer(self):
        from ..tasks import original_training_files as files
        resource, row = self.fixture()
        before = len(row[7].calls)
        with patch.object(files.OriginalTrainingFiles, "prepare", side_effect=AssertionError("Replacement ran")) as changed:
            with self.assertRaises(session.TrainingSessionError): resource.prepare()
            changed.assert_not_called()
        self.assertEqual(len(row[7].calls), before)

    def test_retained_original_file_binding_cannot_be_replaced_by_another_owner(self):
        from ..tasks import original_training_files as files
        resource, row = self.fixture()
        other, foreign = self.fixture()
        before = len(row[7].calls)
        original = files._bindings[row[0]]
        try:
            files._bindings[row[0]] = files._bindings[foreign[0]]
            with self.assertRaises(session.TrainingSessionError): resource.prepare()
        finally: files._bindings[row[0]] = original
        self.assertEqual(len(row[7].calls), before)
        self.assertIs(resource.original_files(), row[0])
        self.assertIs(other.original_files(), foreign[0])

    def test_cancellation_after_borrow_issue_still_stops_the_original_context_before_io(self):
        resource, row = self.fixture()
        self.assertEqual(resource.prepare(), "ready")
        resource.seal_inputs(row[3])
        original_context = resource.borrow()
        before = len(row[7].calls)
        charged = list(row[6].charges)
        row[6].current = False
        self.assertIsNone(resource.request_cancel())
        self.assertIsNone(resource.request_cancel())
        with self.assertRaises(ValueError):
            with original_context: self.fail("A cancelled original borrow entered")
        self.assertEqual(len(row[7].calls), before)
        self.assertEqual(row[6].charges, charged)
        self.assertTrue(all(not handle.closed for handle in row[1].guards))
        self.assertFalse(resource.settle())

    def test_constructor_rejects_replaced_resource_hash_before_any_weak_key_observer(self):
        from . import test_original_training_files as fixture
        case = fixture.OriginalTrainingFilesTests(); self.addCleanup(case.doCleanups)
        row = case.fixture()
        calls = []
        def changed_hash(owner):
            calls.append("hash")
            return object.__hash__(owner)
        before = len(row[7].calls)
        with patch.object(session.OriginalTrainingFileResources, "__hash__", changed_hash):
            with self.assertRaises(session.TrainingSessionError): session.OriginalTrainingFileResources(row[0])
        self.assertEqual(calls, [])
        self.assertEqual(len(row[7].calls), before)

    def test_primitive_or_foreign_book_replacements_are_denied_without_virtual_observers(self):
        from ..tasks import original_training_files as files
        calls = []
        class Virtual:
            def __eq__(self, other): calls.append("equality"); return True
            def __bool__(self): calls.append("truth"); return False
            def __hash__(self): calls.append("hash"); return object.__hash__(self)
        for field in ("phase", "thread", "cancel_attempted", "cancel_acknowledged", "file", "file-thread"):
            with self.subTest(field=field):
                resource, row = self.fixture()
                book = session._file_resources[resource]
                target = files._owners[row[0]] if field == "file-thread" else book
                key = "thread" if field == "file-thread" else field
                original = target[key]
                before = len(row[7].calls)
                try:
                    target[key] = Virtual()
                    with self.assertRaises(session.TrainingSessionError): resource.prepare()
                finally: target[key] = original
                self.assertEqual(calls, [])
                self.assertEqual(len(row[7].calls), before)

    def test_unknown_resource_phase_is_not_local_readiness(self):
        resource, row = self.fixture()
        book = session._file_resources[resource]
        original = book["phase"]
        try:
            book["phase"] = "caller-ready"
            with self.assertRaises(session.TrainingSessionError): resource.prepare()
        finally: book["phase"] = original




class OriginalTrainingFileProducerTests(unittest.TestCase):
    def fixture(self):
        case = OriginalTrainingFileResourcesTests()
        self.addCleanup(case.doCleanups)
        resource, row = case.fixture()
        definition = deepcopy(session._file_resources[resource]["record"]["definition"])
        profile = session.NativeTrainingProfile("synthetic-software-only", DIGEST, 30)
        producer = session.OriginalTrainingFileProducer(resource, profile)
        return producer, resource, row, definition, profile

    def test_exact_capture_is_passive_and_can_supply_only_the_original_resource_once(self):
        producer, resource, row, definition, _ = self.fixture()
        calls = []
        row[6].hook = lambda: calls.append("admission")
        before = len(row[7].calls)
        self.assertIs(producer.capture(deepcopy(definition)), resource)
        self.assertEqual(calls, [])
        self.assertEqual(len(row[7].calls), before)
        self.assertEqual(row[6].charges, [])
        self.assertEqual(session._file_resources[resource]["phase"], "bound")
        with self.assertRaises(session.TrainingSessionError): producer.capture(definition)
        self.assertIs(resource.original_files(), row[0])
        self.assertFalse(resource.settle())

    def test_profile_is_an_explicit_value_snapshot_and_not_readiness(self):
        producer, resource, _, definition, supplied = self.fixture()
        object.__setattr__(supplied, "maximum_duration_seconds", 900)
        observed = producer.profile
        self.assertEqual(observed.maximum_duration_seconds, 30)
        object.__setattr__(observed, "profile_id", "caller-changed")
        self.assertEqual(producer.profile.profile_id, "synthetic-software-only")
        self.assertIs(producer.capture(definition), resource)
        self.assertFalse(resource.settle())

    def test_wrong_definition_does_not_consume_the_exact_original_capture(self):
        producer, resource, row, definition, _ = self.fixture()
        before = len(row[7].calls)
        for field, value in (("requestId", WORKSPACE), ("proposalDigest", "sha256:" + "f" * 64)):
            wrong = deepcopy(definition)
            wrong[field] = value
            with self.assertRaises(session.TrainingSessionError): producer.capture(wrong)
        self.assertEqual(len(row[7].calls), before)
        self.assertIs(producer.capture(definition), resource)

    def test_foreign_and_duplicate_resource_cannot_create_another_producer(self):
        producer, resource, row, _, profile = self.fixture()
        calls = []
        class Foreign:
            @property
            def prepare(self): calls.append("getter"); raise AssertionError("Foreign getter ran")
        before = len(row[7].calls)
        for supplied in (resource, Foreign(), {}, object()):
            with self.assertRaises(session.TrainingSessionError):
                session.OriginalTrainingFileProducer(supplied, profile)
        self.assertEqual(calls, [])
        self.assertEqual(len(row[7].calls), before)

    def test_wrong_thread_cannot_capture_or_poison_the_original_resource(self):
        producer, resource, row, definition, _ = self.fixture()
        results = []
        def capture():
            try: producer.capture(definition)
            except BaseException as error: results.append(error)
        before = len(row[7].calls)
        thread = Thread(target=capture)
        thread.start(); thread.join(5)
        self.assertFalse(thread.is_alive())
        self.assertEqual(len(results), 1)
        self.assertIs(type(results[0]), session.TrainingSessionError)
        self.assertEqual(len(row[7].calls), before)
        self.assertIs(producer.capture(definition), resource)

    def test_consumed_resource_cannot_be_healed_by_restoring_its_visible_phase(self):
        producer, resource, row, definition, _ = self.fixture()
        self.assertEqual(resource.prepare(), "ready")
        before = len(row[7].calls)
        with self.assertRaises(session.TrainingSessionError): producer.capture(definition)
        session._file_resources[resource]["phase"] = "bound"
        with self.assertRaises(session.TrainingSessionError): producer.capture(definition)
        self.assertEqual(len(row[7].calls), before)

    def test_replaced_producer_hash_is_refused_before_weak_key_effects(self):
        producer, _, row, definition, _ = self.fixture()
        calls = []
        def changed_hash(owner): calls.append("hash"); return 1
        before = len(row[7].calls)
        with patch.object(session.OriginalTrainingFileProducer, "__hash__", changed_hash):
            with self.assertRaises(session.TrainingSessionError): producer.capture(definition)
            with self.assertRaises(session.TrainingSessionError): _ = producer.profile
        self.assertEqual(calls, [])
        self.assertEqual(len(row[7].calls), before)

    def test_replaced_profile_property_is_not_executed(self):
        producer, _, row, definition, _ = self.fixture()
        calls = []
        def getter(owner): calls.append("getter"); return 30
        before = len(row[7].calls)
        with patch.object(session.NativeTrainingProfile, "maximum_duration_seconds", property(getter), create=True):
            with self.assertRaises(session.TrainingSessionError): producer.capture(definition)
            with self.assertRaises(session.TrainingSessionError): _ = producer.profile
        self.assertEqual(calls, [])
        self.assertEqual(len(row[7].calls), before)

    def test_replaced_profile_constructor_is_refused_before_any_callback(self):
        # CPython caches type-allocation slots after __new__ replacement. Keep
        # that deliberate class mutation outside the other fixtures' process.
        probe = '''
import sys
from unittest.mock import patch
sys.path.insert(0, sys.argv[1])
from modules.adapters.runtime.python.worker.tests import test_approved_local_training_session as tests
case = tests.OriginalTrainingFileProducerTests()
try:
    producer, resource, row, definition, profile = case.fixture()
    calls = []
    def changed_new(cls, *args, **kwargs):
        calls.append("new")
        return object.__new__(cls)
    before = len(row[7].calls)
    with patch.object(tests.session.NativeTrainingProfile, "__new__", staticmethod(changed_new)):
        with case.assertRaises(tests.session.TrainingSessionError): _ = producer.profile
        with case.assertRaises(tests.session.TrainingSessionError): producer.capture(definition)
        with case.assertRaises(tests.session.TrainingSessionError):
            tests.session.OriginalTrainingFileProducer(resource, profile)
    case.assertEqual(calls, [])
    case.assertEqual(len(row[7].calls), before)
finally:
    case.doCleanups()
'''
        root = Path(__file__).resolve().parents[6]
        environment = {key: value for key, value in os.environ.items()
                       if key.upper() in {"SYSTEMROOT", "WINDIR", "PATH", "TEMP", "TMP"}}
        environment.update(HF_HUB_OFFLINE="1", TRANSFORMERS_OFFLINE="1", PYTHONUTF8="1")
        result = subprocess.run([sys.executable, "-I", "-B", "-c", probe, str(root)],
                                cwd=root, env=environment, capture_output=True, timeout=20)
        self.assertEqual(result.returncode, 0, result.stderr[-8192:].decode(errors="replace"))


class ConfiguredOriginalTrainingFileProducerTests(unittest.TestCase):
    def fixture(self, *, configured=True):
        from . import test_native_training_model_graph as fixture
        case = fixture.TrainingInputCopyTests(); self.addCleanup(case.doCleanups)
        source, lease, staged, _, control, kernel, *_ = case.fixture(
            count=2, native_module=model_native, worker_configuration_data=configured)
        # Only fixture-owned passive bindings are removed after the existing
        # original retirement assertions; this is no production cleanup/credit.
        self.addCleanup(lambda: session._training_files._leases.pop(lease, None))
        profile = session.NativeTrainingProfile("synthetic-software-only", model_native.profile_digest(source.profile), 30)
        return source, lease, staged, control, kernel, profile

    def compose(self, row, **options):
        _, lease, _, control, _, profile = row
        return session.compose_original_training_file_producer(lease, profile, control, control, **options)

    def test_genuine_configuration_composes_passively_and_captures_the_exact_resource_once(self):
        row = self.fixture(); source, lease, _, control, kernel, _ = row
        before = len(kernel.calls); calls = []
        # No resource/admission callback may run at this binding boundary.
        def admitted(actor): calls.append("admission"); return True
        with patch.object(type(control), "assert_current", admitted):
            producer = self.compose(row)
            resource = producer.capture(deepcopy(source.definition))
        self.assertEqual(calls, []); self.assertEqual(len(kernel.calls), before)
        self.assertEqual(control.charges, []); self.assertEqual(control.retained, [])
        self.assertIs(type(resource), session.OriginalTrainingFileResources)
        original = resource.original_files(); book = session._training_files._owners[original]
        received = model_native.read_original_training_worker_configuration(lease)
        self.assertEqual(book["input_configuration"], received["inputCopy"])
        self.assertEqual(book["output_configuration"], received["outputFamily"])
        self.assertIs(book["lease"], lease); self.assertFalse(resource.settle())
        with self.assertRaises(session.TrainingSessionError): producer.capture(source.definition)
        with self.assertRaises(session.TrainingSessionError): self.compose(row)
        self.assertIs(session._training_files._leases[lease], original)
        self.assertEqual(len(kernel.calls), before)

    def test_received_layout_drives_real_finite_file_seal_joint_borrow_and_retained_output(self):
        from time import monotonic
        from ..tasks import original_training_output_delivery as delivery
        row = self.fixture(); source, lease, staged, control, kernel, _ = row
        received = model_native.read_original_training_worker_configuration(lease)
        queue = delivery.OriginalTrainingOutputDelivery(TASK, maximum_files=64,
            maximum_payload_bytes=received["limits"]["worker-output"], deadline=monotonic() + 30)
        producer = self.compose(row, delivery=queue); resource = producer.capture(source.definition)
        self.assertEqual(resource.prepare(), "ready")
        original = deepcopy(staged); payload = resource.seal_inputs(staged)
        self.assertEqual(staged, original)
        expected = received["outputFamily"]["outputs"][-1]
        self.assertEqual(payload.output["outputDirectory"], expected["freshParent"] + "\\" + expected["freshName"])
        self.assertEqual(control.charges, [received["limits"]["inputs"]])
        with resource.borrow() as view:
            model, inputs = model_native.resolve_original_training_references(view, payload.model_dump(mode="json"))
            self.assertEqual(model, source.physical_path); self.assertEqual(len(inputs), 2)
            self.assertTrue(all("\\training-inputs\\" in name for name in inputs))
            self.assertIs(delivery.capture_original_output_delivery(view, payload.model_dump(mode="json")), queue)
        self.assertEqual(source.phase, "spent"); self.assertFalse(resource.settle())
        self.assertEqual(control.retained, [])
        self.assertTrue(all(not handle.closed for handle in source.guards))
        self.assertEqual(resource.original_files().local_status()["globalRetirement"], "not-qualified")

    def test_legacy_foreign_and_consumed_leases_have_no_composition_fallback(self):
        legacy = self.fixture(configured=False)
        before = len(legacy[4].calls)
        with self.assertRaises(session.TrainingSessionError): self.compose(legacy)
        self.assertEqual(len(legacy[4].calls), before)
        row = self.fixture(); source, lease, staged, control, kernel, profile = row
        before = len(kernel.calls)
        for foreign in (object(), {}, object.__new__(model_native.OriginalInheritedModelLease)):
            with self.assertRaises(session.TrainingSessionError):
                session.compose_original_training_file_producer(foreign, profile, control, control)
        self.assertEqual(len(kernel.calls), before)
        with lease.borrow(staged["payload"]): pass
        before = len(kernel.calls)
        with self.assertRaises(session.TrainingSessionError): self.compose(row)
        self.assertEqual(len(kernel.calls), before)
        self.assertNotIn(lease, session._training_files._leases)
        self.assertTrue(all(not handle.closed for handle in source.guards))

    def test_wrong_profile_and_excess_duration_do_not_consume_the_legitimate_binding(self):
        row = self.fixture(); source, lease, _, control, kernel, profile = row
        before = len(kernel.calls)
        for supplied in (session.NativeTrainingProfile("synthetic", DIGEST, 30),
                         session.NativeTrainingProfile("synthetic", profile.fingerprint, 31), {}, object()):
            with self.assertRaises(session.TrainingSessionError):
                session.compose_original_training_file_producer(lease, supplied, control, control)
        self.assertNotIn(lease, session._training_files._leases)
        self.assertEqual(len(kernel.calls), before)
        producer = self.compose(row)
        self.assertIs(type(producer.capture(source.definition)), session.OriginalTrainingFileResources)

    def test_replaced_original_helpers_and_initializers_are_not_invoked(self):
        row = self.fixture(); calls = []; before = len(row[4].calls)
        def replaced(*args, **kwargs): calls.append("replacement"); raise AssertionError("Replacement ran")
        changes = ((model_native, "read_original_training_worker_configuration"),
                   (model_native, "_capture_original_training_file_lease"),
                   (session._training_files.OriginalTrainingFiles, "__init__"),
                   (session.OriginalTrainingFileResources, "__init__"),
                   (session.OriginalTrainingFileProducer, "__init__"))
        for owner, name in changes:
            with self.subTest(name=name), patch.object(owner, name, replaced):
                with self.assertRaises(session.TrainingSessionError): self.compose(row)
        self.assertEqual(calls, []); self.assertEqual(len(row[4].calls), before)
        self.assertNotIn(row[1], session._training_files._leases)
        self.assertIs(type(self.compose(row)), session.OriginalTrainingFileProducer)

    def test_competing_original_lock_holder_refuses_without_waiting_or_claiming_files(self):
        row = self.fixture(); state = model_native._model_leases[row[1]]
        held, released = Event(), Event()
        def hold():
            with state["lock"]:
                held.set(); released.wait(5)
        thread = Thread(target=hold); thread.start()
        try:
            self.assertTrue(held.wait(3)); before = len(row[4].calls)
            with self.assertRaises(session.TrainingSessionError): self.compose(row)
            self.assertEqual(len(row[4].calls), before)
            self.assertNotIn(row[1], session._training_files._leases)
        finally:
            released.set(); thread.join(5)
        self.assertFalse(thread.is_alive())
        self.assertIs(type(self.compose(row)), session.OriginalTrainingFileProducer)

    def test_existing_bootstrap_to_file_executor_handoff_and_later_thread_guard_are_preserved(self):
        from concurrent.futures import ThreadPoolExecutor
        row = self.fixture(); source = row[0]; before = len(row[4].calls)
        with ThreadPoolExecutor(max_workers=1) as executor:
            producer = executor.submit(self.compose, row).result(timeout=10)
            with self.assertRaises(session.TrainingSessionError): producer.capture(source.definition)
            resource = executor.submit(producer.capture, source.definition).result(timeout=10)
            self.assertEqual(executor.submit(resource.prepare).result(timeout=10), "ready")
            self.assertEqual(len(row[4].calls), before)
        self.assertFalse(resource.settle())


class BoundedLocalTrainingWorkerTests(unittest.TestCase):
    """Actual fresh files plus an inert fixed loader. No models or Native effects."""
    def fixture(self, *, deliver_output=False, method=None):
        import hashlib
        temp = tempfile.TemporaryDirectory(prefix="bounded-local-training-")
        self.addCleanup(temp.cleanup); self.root = Path(temp.name).resolve()
        self.model = self.root / "model-copy"; self.model.mkdir()
        self.inputs = self.root / "inputs"; self.inputs.mkdir()
        self.output = self.root / "output"; self.output.mkdir()
        values = {"config.json": b"{}", "tokenizer.json": b"{}", "model.safetensors": b"synthetic-safe-format-placeholder"}
        files = []
        for name, value in values.items():
            (self.model / name).write_bytes(value)
            files.append({"name": name, "sizeBytes": len(value), "sha256": "sha256:" + hashlib.sha256(value).hexdigest()})
        self.defined, self.staged = definition(), staged()
        if method is not None:
            self.defined["request"]["method"] = method; self.staged["payload"]["method"] = method
        data, recipe = b'{"instruction":"hello","response":"world"}\n', b'{"format":"jsonl"}\n'
        data_path, recipe_path = self.inputs / "input-0.jsonl", self.inputs / "recipe.json"
        data_path.write_bytes(data); recipe_path.write_bytes(recipe)
        self.defined["inputs"][0].update(sizeBytes=len(data), digest="sha256:" + hashlib.sha256(data).hexdigest())
        self.defined["recipeSizeBytes"] = len(recipe)
        self.defined["dataset"]["recipeDigest"] = "sha256:" + hashlib.sha256(recipe).hexdigest()
        self.staged["recipe"].update(path=str(recipe_path), sizeBytes=len(recipe), digest=self.defined["dataset"]["recipeDigest"])
        self.staged["payload"]["datasets"][0]["path"] = str(data_path)
        self.staged["outputDirectory"] = str(self.output)
        self.staged["payload"]["output"]["outputDirectory"] = str(self.output)
        self.manifest = {"modelRecordId": self.defined["request"]["baseModel"]["modelRecordId"],
            "modelUpdatedAt": self.defined["modelUpdatedAt"], "directory": str(self.model), "files": files}
        self.profile = session.BoundedLocalTrainingProfile("bounded-local-inert-files", DIGEST, 30, str(self.root), 4096, 4096, 1)
        self.producer = session.BoundedLocalTrainingProducer(self.profile)
        self.executor, self.publications, self.current = QueuedExecutor(), [], True
        loader_patch = patch.object(session, "train_model_from_local_files",
            return_value=TrainModelTaskResult(runId="inert", status="succeeded"))
        self.loader = loader_patch.start(); self.addCleanup(loader_patch.stop)
        native_patch = patch.object(session, "resolve_original_model_view", side_effect=AssertionError("Native view must not be used"))
        self.native = native_patch.start(); self.addCleanup(native_patch.stop)
        self.owner = session.OriginalTrainingSession(self.defined, self.producer, lambda: self.current,
            lambda **value: self.publications.append(value), lambda owner: self.executor.submit(owner.run), self.profile,
            local_model=self.manifest, local_output_delivery=deliver_output)
        return self.owner

    def ready(self, *, deliver_output=False, method=None):
        owner = self.fixture(deliver_output=deliver_output, method=method); self.assertEqual(owner.prepare(), "prepared")
        self.assertEqual(owner.seal(self.staged), "ready"); return owner

    def test_actual_local_bytes_reach_the_fixed_loader_once_without_native_view_or_quality_comparison(self):
        owner = self.ready()
        def load(*_args, **kwargs):
            kwargs["on_progress"]({"stage": "training", "step": 1, "totalSteps": 1})
            return TrainModelTaskResult(runId="inert", status="succeeded")
        self.loader.side_effect = load
        self.assertEqual(owner.start()["kind"], "accepted"); self.executor.run()
        self.assertEqual(self.publications[-1]["status"], "succeeded"); self.loader.assert_called_once()
        self.assertIn({"progress": {"stage": "training", "step": 1, "totalSteps": 1}}, self.publications)
        args, keywords = self.loader.call_args
        self.assertEqual(args[0].baseModel.localPath, str(self.model))
        self.assertEqual(args[0].datasets[0].path, str(self.inputs / "input-0.jsonl"))
        self.assertIs(keywords["compare_validation_baseline"], False); self.assertIsNone(keywords["_model_view"])
        self.native.assert_not_called(); self.assertTrue(owner.settle()); self.assertTrue(owner.blocks_recovery)
        self.assertTrue(self.model.exists()); self.assertTrue((self.inputs / "recipe.json").exists())
        with self.assertRaises(session.TrainingSessionError): owner.start()
        self.assertEqual(self.executor.calls, 1)

    def write_delivery_outputs(self, *, validation_reports=False):
        checkpoint = self.output / "checkpoints" / "checkpoint-1"; checkpoint.mkdir(parents=True)
        adapter = self.defined["request"]["method"] in ("lora", "qlora")
        self.result_config_name = "adapter_config.json" if adapter else "config.json"
        self.result_weight_name = "adapter_model.safetensors" if adapter else "model.safetensors"
        for root in (checkpoint, self.output):
            for name, data in ((self.result_config_name, b"{}"), ("tokenizer.json", b"{}"), (self.result_weight_name, b"synthetic-safe-result")):
                (root / name).write_bytes(data)
            (root / "training_args.bin").write_bytes(b"synthetic-unexported-sdk-state")
        if validation_reports:
            (self.output / "model_validation_diff.json").write_text('{"synthetic":true}', encoding="utf-8")
            (self.output / "model_validation_report.md").write_text("# Synthetic validation report\n", encoding="utf-8")
        return TrainModelTaskResult(runId="inert", status="succeeded")

    @contextmanager
    def consume_local_output(self, owner, on_frame=None, *, expected_refusal=False):
        stopped, frames, errors = Event(), [], []
        def receive():
            try:
                previous = 0
                while not stopped.is_set():
                    row = owner.read_output(); frame = row["frame"]
                    if row["phase"] in ("complete", "failed"): return
                    if frame is not None and frame["sequence"] != previous:
                        previous = frame["sequence"]; frames.append(frame)
                        if on_frame is not None: on_frame(frame)
                        owner.acknowledge_output(frame["sequence"])
                        if frame["kind"] == "streams-complete": return
                    stopped.wait(0.001)
            except BaseException as error: errors.append(error)
        thread = Thread(target=receive); thread.start()
        try: yield frames, errors
        finally:
            stopped.set(); session._local_output_sessions[owner][4](); thread.join(3)
            self.assertFalse(thread.is_alive())
            if not expected_refusal: self.assertEqual(errors, [])

    def test_opt_in_local_results_deliver_real_checkpoint_and_candidate_bytes_before_success(self):
        import base64, hashlib
        owner = self.ready(deliver_output=True)
        self.assertEqual(owner.read_output()["phase"], "bound")
        self.loader.side_effect = lambda *_a, **_k: self.write_delivery_outputs()
        with self.consume_local_output(owner) as (frames, _errors):
            self.assertEqual(owner.start()["kind"], "accepted"); self.executor.run()
            self.assertEqual(self.publications[-1]["status"], "succeeded")
            self.assertEqual(owner.read_output()["phase"], "complete")
            files = frames[0]["files"]; self.assertEqual(len(files), 6)
            self.assertEqual([row["role"] for row in files], ["checkpoint"] * 3 + ["candidate"] * 3)
            self.assertNotIn("training_args.bin", [row["name"] for row in files])
            self.assertEqual(frames[-1]["kind"], "streams-complete")
            for row in files:
                content = b"".join(base64.b64decode(frame["data"]) for frame in frames
                    if frame["kind"] == "data" and frame["fileIndex"] == row["fileIndex"])
                self.assertEqual(len(content), row["sizeBytes"])
                self.assertEqual("sha256:" + hashlib.sha256(content).hexdigest(), row["sha256"])
            self.assertFalse(owner.native.handles); self.assertFalse(owner.native.directory_handles)
            self.assertTrue(owner.settle()); self.assertTrue(owner.blocks_recovery)
        self.assertTrue((self.output / self.result_weight_name).exists())
        self.assertFalse(self.loader.call_args.kwargs["compare_validation_baseline"])

    def test_local_output_binding_refuses_replaced_owner_scope_and_withdrawn_lifetime(self):
        owner = self.ready(deliver_output=True); original = owner.native
        owner.native = object()
        with self.assertRaises(session.TrainingSessionError): owner.read_output()
        owner.native = original; self.current = False
        with self.assertRaises(session.TrainingSessionError): owner.read_output()
        self.current = True; self.assertEqual(owner.read_output()["phase"], "bound")
        with self.assertRaises(session.TrainingSessionError): owner.acknowledge_output(True)

    def test_safe_output_layout_matches_full_lora_and_qlora_methods_with_validation_reports(self):
        for method in ("full-finetune", "lora", "qlora"):
            with self.subTest(method=method):
                owner = self.ready(deliver_output=True, method=method)
                self.loader.side_effect = lambda *_a, **_k: self.write_delivery_outputs(validation_reports=True)
                with self.consume_local_output(owner) as (frames, _errors):
                    owner.start(); self.executor.run()
                    self.assertEqual(self.publications[-1]["status"], "succeeded")
                    names = [row["name"] for row in frames[0]["files"]]
                    self.assertEqual(names.count(self.result_config_name), 2)
                    self.assertEqual(names.count(self.result_weight_name), 2)
                    self.assertNotIn("model_validation_diff.json", names)
                    self.assertNotIn("model_validation_report.md", names)
                    self.assertTrue((self.output / "model_validation_diff.json").is_file())
                    self.assertTrue((self.output / "model_validation_report.md").is_file())
                    self.assertEqual(self.loader.call_args.args[0].method, method)
                    self.assertIs(self.loader.call_args.kwargs["compare_validation_baseline"], False)
                    self.assertTrue(owner.settle())

    def test_wrong_or_mixed_safe_weight_pair_cannot_complete_local_delivery(self):
        for method, mixed in (("full-finetune", False), ("lora", False), ("qlora", False), ("lora", True)):
            with self.subTest(method=method, mixed=mixed):
                owner = self.ready(deliver_output=True, method=method)
                def load(*_a, **_k):
                    result = self.write_delivery_outputs()
                    other_config = "config.json" if method in ("lora", "qlora") else "adapter_config.json"
                    other_weight = "model.safetensors" if method in ("lora", "qlora") else "adapter_model.safetensors"
                    for root in (self.output / "checkpoints" / "checkpoint-1", self.output):
                        if not mixed:
                            (root / self.result_config_name).unlink(); (root / self.result_weight_name).unlink()
                        (root / other_config).write_bytes(b"{}"); (root / other_weight).write_bytes(b"synthetic-wrong-format")
                    return result
                self.loader.side_effect = load
                owner.start(); self.executor.run()
                self.assertEqual(self.publications[-1]["status"], "failed")
                self.assertIsNone(owner.read_output()["frame"]); self.assertTrue(owner.settle())

    def test_changed_local_output_after_manifest_cannot_complete_or_rerun_loader(self):
        owner = self.ready(deliver_output=True)
        self.loader.side_effect = lambda *_a, **_k: self.write_delivery_outputs()
        def change(frame):
            if frame["kind"] == "manifest": (self.output / self.result_weight_name).write_bytes(b"changed-result")
        with self.consume_local_output(owner, change) as (frames, _errors):
            owner.start(); self.executor.run()
            self.assertEqual(self.publications[-1]["status"], "failed")
            self.assertNotIn("streams-complete", [row["kind"] for row in frames])
            self.assertTrue(owner.settle())  # Local IO only; parent must retire the worker/Job.
        self.loader.assert_called_once()
        with self.assertRaises(session.TrainingSessionError): owner.start()

    def test_stop_during_local_result_delivery_stays_cancelled_without_final_ack(self):
        owner = self.ready(deliver_output=True)
        self.loader.side_effect = lambda *_a, **_k: self.write_delivery_outputs()
        def stop(frame):
            if frame["kind"] == "manifest": owner.cancel()
        with self.consume_local_output(owner, stop, expected_refusal=True) as (frames, errors):
            owner.start(); self.executor.run()
            self.assertEqual(self.publications[-1]["status"], "cancelled")
            self.assertNotIn("streams-complete", [row["kind"] for row in frames])
            self.assertTrue(owner.settle())
        self.loader.assert_called_once()

    def test_unsafe_unknown_or_linked_output_never_reaches_local_manifest(self):
        for mode in ("unknown", "hardlink", "missing-tokenizer", "oversized"):
            with self.subTest(mode=mode):
                owner = self.ready(deliver_output=True)
                def load(*_a, **_k):
                    result = self.write_delivery_outputs()
                    if mode == "unknown": (self.output / "execute.py").write_text("synthetic-unexported-input")
                    if mode == "hardlink":
                        (self.output / self.result_weight_name).unlink()
                        os.link(self.model / "model.safetensors", self.output / self.result_weight_name)
                    if mode == "missing-tokenizer": (self.output / "tokenizer.json").unlink()
                    if mode == "oversized": (self.output / self.result_weight_name).write_bytes(b"x" * 4097)
                    return result
                self.loader.side_effect = load
                owner.start(); self.executor.run()
                self.assertEqual(self.publications[-1]["status"], "failed")
                self.assertEqual(owner.read_output()["phase"], "failed")
                self.assertIsNone(owner.read_output()["frame"])
                self.assertTrue(owner.settle())

    def test_manifest_binding_and_unknown_fields_are_rejected_before_file_io(self):
        self.fixture()
        for mode in ("record", "version", "extra", "unsafe-name", "duplicate", "source-path", "outside"):
            with self.subTest(mode=mode):
                manifest = deepcopy(self.manifest)
                if mode == "record": manifest["modelRecordId"] = "other"
                if mode == "version": manifest["modelUpdatedAt"] = "other"
                if mode == "extra": manifest["native"] = True
                if mode == "unsafe-name": manifest["files"][0]["name"] = "../config.json"
                if mode == "duplicate": manifest["files"].append(manifest["files"][0])
                if mode == "source-path": manifest["directory"] = self.defined["request"]["baseModel"]["localPath"]
                if mode == "outside": manifest["directory"] = str(self.root.parent / "outside")
                with patch.object(session.os, "open", side_effect=AssertionError("no IO")):
                    with self.assertRaises(session.TrainingSessionError):
                        session.BoundedLocalTrainingResources(self.defined, manifest, self.profile)
        self.loader.assert_not_called()

    def test_caller_manifest_changes_cannot_replace_the_captured_copy(self):
        owner = self.fixture(); self.manifest["directory"] = str(self.root / "other")
        self.manifest["files"][0]["sha256"] = DIGEST
        self.assertEqual(owner.prepare(), "prepared"); self.assertEqual(owner.seal(self.staged), "ready")
        owner.start(); self.executor.run(); self.assertEqual(self.publications[-1]["status"], "succeeded")

    def test_changed_model_bytes_or_unexpected_model_inventory_never_load(self):
        for mode in ("hash", "inventory", "hardlink"):
            with self.subTest(mode=mode):
                owner = self.fixture()
                if mode == "hash": (self.model / "config.json").write_bytes(b"[]")
                if mode == "inventory": (self.model / "unreviewed.py").write_text("inert", encoding="utf-8")
                if mode == "hardlink": os.link(self.model / "config.json", self.root / "linked.json")
                self.assertEqual(owner.prepare(), "unconfirmed"); self.assertTrue(owner.known_not_run)
                self.assertTrue(owner.settle()); self.loader.assert_not_called()
                self.assertTrue((self.model / "config.json").exists())

    def test_changed_dataset_recipe_or_output_is_refused_before_dispatch(self):
        for mode in ("data", "recipe", "output", "outside"):
            with self.subTest(mode=mode):
                owner = self.fixture(); self.assertEqual(owner.prepare(), "prepared")
                if mode == "data": (self.inputs / "input-0.jsonl").write_bytes(b"changed")
                if mode == "recipe": (self.inputs / "recipe.json").write_bytes(b"changed")
                if mode == "output": (self.output / "foreign.txt").write_text("keep", encoding="utf-8")
                if mode == "outside": self.staged["recipe"]["path"] = str(self.root.parent / "outside.json")
                self.assertEqual(owner.seal(self.staged), "unconfirmed"); self.loader.assert_not_called()
                self.assertTrue(owner.cancel()); self.assertTrue(owner.settle())

    def test_changed_files_between_seal_and_borrow_are_refused(self):
        owner = self.ready(); (self.inputs / "input-0.jsonl").write_bytes(b"changed")
        owner.start(); self.executor.run(); self.loader.assert_not_called()
        self.assertEqual(self.publications[-1]["status"], "failed")
        self.assertNotIn(str(self.root), json.dumps(self.publications[-1])); self.assertTrue(owner.settle())

    def test_missing_disk_headroom_or_duration_denies_before_loader(self):
        for mode in ("disk", "duration"):
            with self.subTest(mode=mode):
                owner = self.ready()
                if mode == "duration": owner.native.started -= 31
                with patch("shutil.disk_usage", return_value=type("Space", (), {"free": 0})()):
                    owner.start(); self.executor.run()
                self.loader.assert_not_called(); self.assertEqual(self.publications[-1]["status"], "failed")

    def test_actual_close_failure_retains_original_descriptor_without_cleanup_or_retry(self):
        owner = self.fixture(); original = os.close
        def close(descriptor):
            original(descriptor); raise OSError("private close acknowledgement lost")
        with patch.object(session.os, "close", side_effect=close): self.assertEqual(owner.prepare(), "unconfirmed")
        self.assertTrue(owner.native.handles); self.assertTrue(owner.native.unknown)
        self.assertFalse(owner.settle()); self.assertEqual(owner.prepare(), "unconfirmed")
        self.loader.assert_not_called(); self.assertTrue((self.model / "config.json").exists())

    def test_output_limit_failure_is_redacted_and_never_publishes_a_candidate(self):
        owner = self.ready()
        def load(*_args, **_kwargs):
            (self.output / "model.safetensors").write_bytes(b"x" * 4097)
            return TrainModelTaskResult(runId="inert", status="succeeded")
        self.loader.side_effect = load; owner.start(); self.executor.run()
        self.assertEqual(self.publications[-1]["status"], "failed")
        self.assertIsNone(self.publications[-1].get("data")); self.assertNotIn(str(self.root), json.dumps(self.publications[-1]))
        self.assertTrue(owner.settle()); self.assertTrue((self.output / "model.safetensors").exists())

    def test_running_sdk_cannot_settle_and_cancel_retains_parent_worker_obligation(self):
        owner = self.ready(); entered, release = Event(), Event()
        def load(*_args, **kwargs):
            entered.set(); self.assertTrue(release.wait(5)); kwargs["on_progress"]({"stage": "training", "step": 1})
            return TrainModelTaskResult(runId="inert", status="succeeded")
        self.loader.side_effect = load; owner.start(); thread = Thread(target=self.executor.run)
        thread.start()
        try:
            self.assertTrue(entered.wait(5)); self.assertFalse(owner.settle()); self.assertTrue(owner.cancel())
        finally: release.set(); thread.join(5)
        self.assertFalse(thread.is_alive()); self.assertEqual(self.publications[-1]["status"], "cancelled")
        self.assertTrue(owner.settle()); self.assertTrue(owner.blocks_recovery)

    def test_cancelled_or_stale_owner_cannot_issue_loader_work(self):
        for mode in ("cancel", "stale"):
            with self.subTest(mode=mode):
                owner = self.ready()
                if mode == "cancel": self.assertTrue(owner.cancel())
                else: self.current = False
                with self.assertRaises(session.TrainingSessionError): owner.start()
                self.loader.assert_not_called(); self.assertEqual(self.executor.calls, 0)

    def test_original_request_and_copy_directory_cannot_be_recaptured(self):
        owner = self.fixture(); self.assertEqual(owner.prepare(), "prepared")
        with self.assertRaises(session.TrainingSessionError): self.producer.capture(self.defined, self.manifest)
        other = deepcopy(self.defined); other["requestId"] = WORKSPACE
        with self.assertRaises(session.TrainingSessionError): self.producer.capture(other, self.manifest)
        self.assertTrue((self.model / "config.json").exists())

    def test_output_hardlink_or_excess_inventory_is_refused_and_retained(self):
        for mode in ("link", "count"):
            with self.subTest(mode=mode):
                owner = self.ready()
                def load(*_args, **_kwargs):
                    if mode == "link": os.link(self.model / "config.json", self.output / "linked.json")
                    else:
                        for index in range(257): (self.output / (str(index) + ".json")).write_bytes(b"{}")
                    return TrainModelTaskResult(runId="inert", status="succeeded")
                self.loader.side_effect = load; owner.start(); self.executor.run()
                self.assertEqual(self.publications[-1]["status"], "failed")
                self.assertTrue(owner.settle()); self.assertTrue(any(self.output.iterdir()))

    @unittest.skipUnless(os.name == "nt", "Windows stream syntax")
    def test_windows_stream_and_alias_paths_are_refused_before_io(self):
        self.fixture()
        for suffix in ("copy:stream", "copy.", "copy "):
            value = deepcopy(self.manifest); value["directory"] = str(self.root / suffix)
            with self.assertRaises(session.TrainingSessionError):
                session.BoundedLocalTrainingResources(self.defined, value, self.profile)

    def test_trusted_local_boot_and_original_routes_keep_strict_native_schema_separate(self):
        self.fixture()
        with patch.object(app, "TASK_REGISTRY", {}), patch.object(app, "TASK_EXECUTOR", self.executor), \
             patch.object(app, "_ORIGINAL_TRAINING_PRODUCER", None), patch.object(app, "_ORIGINAL_TRAINING_PROFILE", None), \
             patch.object(app, "_ORIGINAL_TRAINING_PROTOCOL", "settled-v1"):
            with self.assertRaises(session.TrainingSessionError): app.configure_original_training(self.producer)
            app.configure_bounded_local_training(self.producer)
            identity = app._training_identity()
            with self.assertRaises(session.TrainingSessionError): app._prepare_original_training({"identity": identity, "definition": self.defined})
            reply = app._prepare_original_training({"identity": identity, "definition": self.defined, "localModelCopy": self.manifest})
            self.assertEqual(reply["phase"], "ready")
            def action(name, **extra): return app._operate_original_training(TASK, name, {"binding": reply["binding"], **extra})
            self.assertEqual(action("seal", input=self.staged)["phase"], "ready")
            self.assertEqual(action("start")["kind"], "accepted"); self.executor.run()
            self.assertEqual(action("read")["record"]["status"], "succeeded"); self.assertTrue(action("settle")["settled"])
            self.assertNotIn("train-model.original-exit-ready-v1", app.capabilities().capabilities)
        with patch.object(app, "TASK_REGISTRY", {}), patch.object(app, "_ORIGINAL_TRAINING_PRODUCER", None), \
             patch.object(app, "_ORIGINAL_TRAINING_PROFILE", None):
            app.configure_original_training(Producer())
            with self.assertRaises(session.TrainingSessionError):
                app._prepare_original_training({"identity": app._training_identity(), "definition": self.defined, "localModelCopy": self.manifest})

    def test_local_output_transport_requires_its_exact_private_opt_in(self):
        self.fixture()
        with patch.object(app, "TASK_REGISTRY", {}), patch.object(app, "TASK_EXECUTOR", self.executor), \
             patch.object(app, "_ORIGINAL_TRAINING_PRODUCER", None), patch.object(app, "_ORIGINAL_TRAINING_PROFILE", None), \
             patch.object(app, "_ORIGINAL_TRAINING_PROTOCOL", "settled-v1"):
            app.configure_bounded_local_training(self.producer)
            identity = app._training_identity()
            body = {"identity": identity, "definition": self.defined, "localModelCopy": self.manifest}
            for value in (None, False, True, "native", "bounded-local-v2", {}, 1):
                with self.assertRaises(session.TrainingSessionError):
                    app._prepare_original_training({**body, "outputDelivery": value})
                self.assertEqual(app.TASK_REGISTRY, {})
            hooks = []
            class ActiveValue:
                def __eq__(self, other): hooks.append(other); return True
            with self.assertRaises(session.TrainingSessionError):
                app._prepare_original_training({**body, "outputDelivery": ActiveValue()})
            self.assertEqual(hooks, []); self.assertEqual(app.TASK_REGISTRY, {})
            reply = app._prepare_original_training({**body, "outputDelivery": "bounded-local-v1"})
            owner = app.TASK_REGISTRY[TASK]["_originalTrainingOwner"]
            def action(name, **extra): return app._operate_original_training(TASK, name, {"binding": reply["binding"], **extra})
            self.assertEqual(action("output-read")["output"]["phase"], "bound")
            self.assertEqual(action("seal", input=self.staged)["phase"], "ready")
            self.loader.side_effect = lambda *_a, **_k: self.write_delivery_outputs()
            with self.consume_local_output(owner) as (frames, _errors):
                self.assertEqual(action("start")["kind"], "accepted"); self.executor.run()
                self.assertEqual(action("read")["record"]["status"], "succeeded")
                self.assertEqual(frames[-1]["kind"], "streams-complete")
                self.assertTrue(action("settle")["settled"])


if __name__ == "__main__": unittest.main()
