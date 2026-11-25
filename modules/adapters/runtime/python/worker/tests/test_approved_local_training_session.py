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


if __name__ == "__main__": unittest.main()
