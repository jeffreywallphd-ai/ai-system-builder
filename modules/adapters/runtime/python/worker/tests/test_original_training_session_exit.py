"""Genuine finite session/file readiness; inert kernel/loader, no model or OS."""
from concurrent.futures import Future, ThreadPoolExecutor
from contextlib import contextmanager
from copy import deepcopy
from threading import Event, get_ident
import unittest
from unittest.mock import patch

from modules.adapters.runtime.python.worker.models import TrainModelTaskResult
from modules.adapters.runtime.python.worker import app
from modules.adapters.runtime.python.worker.tasks import approved_local_training_session as session
from modules.adapters.runtime.python.worker.tasks import original_training_session_exit as exit_ready
from modules.adapters.runtime.python.worker.tasks import original_training_files as files
from modules.adapters.runtime.python.worker.tasks import original_training_exit_barrier as barrier
from modules.adapters.runtime.python.worker.tests import test_original_training_files as fixture


class OriginalTrainingSessionExitTests(unittest.TestCase):
    def fixture(self, method="lora", *, before_run=None, resource_type=None, original_files_hook=None,
                bootstrap_on_main=False, fixed_file_resources=False):
        executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="original-training-inert")
        self.addCleanup(executor.shutdown, wait=True)
        case = fixture.OriginalTrainingFilesTests(); self.addCleanup(case.doCleanups)
        if bootstrap_on_main:
            row=case.fixture(method=method,bind=False)
            _,_,lease,_,inputs,outputs,control,*_=row
            file_owner=executor.submit(files.OriginalTrainingFiles,lease,inputs,outputs,control,control).result(timeout=10)
            case.addCleanup(lambda:files._owners.pop(file_owner,None))
            case.addCleanup(lambda:files._bindings.pop(file_owner,None))
            row=(file_owner,*row[1:])
        else:
            row = executor.submit(case.fixture, method=method).result(timeout=10)
        file_owner, source, lease, staged, _, _, control, kernel, _, _ = row
        defined = deepcopy(files._owners[file_owner]["definition"])
        threads = []

        class Resources(session.NativeTrainingResources):
            def prepare(self): threads.append(get_ident()); return "ready"
            def seal_inputs(self, value): threads.append(get_ident()); return file_owner.prepare(value)
            @contextmanager
            def borrow(self):
                threads.append(get_ident())
                if before_run: before_run()
                with file_owner.borrow() as view: yield view
            def request_cancel(self): file_owner.request_cancel()
            def settle(self): raise AssertionError("Local readiness must not call global settle")
            def original_files(self):
                if original_files_hook: original_files_hook()
                return file_owner

        resource = (executor.submit(session.OriginalTrainingFileResources, file_owner).result(timeout=10)
                    if fixed_file_resources else (resource_type or Resources)())

        class Producer(session.NativeTrainingProducer):
            @property
            def profile(self): return session.NativeTrainingProfile("synthetic-software-only", "sha256:"+"e"*64, 30)
            def capture(self, value): assert value == defined; return resource

        producer = (executor.submit(session.OriginalTrainingFileProducer, resource,
                    session.NativeTrainingProfile("synthetic-software-only", "sha256:"+"e"*64, 30)).result(timeout=10)
                    if fixed_file_resources else Producer())

        updates = []; current = [True]
        owner = session.OriginalTrainingSession(defined, producer, lambda: current[0],
            lambda **value: updates.append(value), lambda actual: executor.submit(actual.run),
            retirement_protocol=exit_ready.PROTOCOL)
        self.addCleanup(lambda: exit_ready._books.pop(owner, None))
        self.addCleanup(lambda: barrier._barriers.pop(file_owner, None))
        return owner, executor, row, updates, current, threads, resource

    def ready(self, **options):
        value = self.fixture(**options); owner, executor, row, *_ = value
        self.assertEqual(executor.submit(owner.prepare).result(timeout=10), "prepared")
        self.assertEqual(executor.submit(owner.seal, row[3]).result(timeout=10), "ready")
        return value

    def finish_training(self, owner):
        with patch.object(owner, "loader", return_value=TrainModelTaskResult(runId="inert", status="succeeded")):
            self.assertEqual(owner.start()["kind"], "accepted")
            owner.future.result(timeout=10)

    def test_fixed_file_resources_use_the_same_executor_files_and_local_exit_proof(self):
        owner, executor, row, updates, _, _, resource = self.ready(fixed_file_resources=True)
        self.assertIs(type(owner.producer), session.OriginalTrainingFileProducer)
        file_owner = row[0]
        self.assertIs(resource.original_files(), file_owner)
        self.assertIsNone(resource.output_delivery())
        self.finish_training(owner)
        self.assertEqual(updates[-1]["status"], "succeeded")
        self.assertTrue(files._owners[file_owner]["output_closed"])
        self.assertEqual(owner.begin_exit_ready(), "queued")
        before = len(row[7].calls)
        self.assertEqual(executor.submit(owner.finish_exit_ready).result(timeout=10), "ready")
        self.assertEqual(len(row[7].calls), before)
        self.assertFalse(resource.settle())
        self.assertFalse(owner.settle())
        self.assertTrue(owner.blocks_recovery)
        self.assertTrue(all(not handle.closed for handle in row[1].guards))

    def test_fixed_producer_keeps_main_thread_bootstrap_and_original_executor(self):
        owner, executor, row, _, _, _, resource = self.ready(bootstrap_on_main=True, fixed_file_resources=True)
        self.assertIs(type(owner.producer), session.OriginalTrainingFileProducer)
        self.assertIs(resource.original_files(), row[0])
        self.finish_training(owner)
        self.assertEqual(owner.begin_exit_ready(), "queued")
        self.assertEqual(executor.submit(owner.finish_exit_ready).result(timeout=10), "ready")
        self.assertFalse(owner.settle())
        self.assertTrue(owner.blocks_recovery)
        self.assertTrue(all(not handle.closed for handle in row[1].guards))

    def test_fixed_file_resources_cancel_after_permission_withdrawal_without_loader_or_credit(self):
        owner, executor, row, _, current, _, resource = self.ready(fixed_file_resources=True)
        current[0] = False
        row[6].current = False
        before = len(row[7].calls)
        charged = list(row[6].charges)
        with patch.object(owner, "loader", side_effect=AssertionError("Cancelled loader ran")):
            self.assertTrue(owner.cancel())
            self.assertIsNone(resource.request_cancel())
            self.assertEqual(owner.begin_exit_ready(), "queued")
            self.assertEqual(executor.submit(owner.finish_exit_ready).result(timeout=10), "ready")
        self.assertEqual(len(row[7].calls), before)
        self.assertEqual(row[6].charges, charged)
        self.assertFalse(resource.settle())
        self.assertFalse(owner.run_entered)

    def test_cancelled_before_dispatch_can_fence_prepared_files_without_running_loader(self):
        owner, executor, row, _, current, *_ = self.ready()
        with patch.object(owner, "loader", side_effect=AssertionError("Cancelled loader ran")):
            self.assertTrue(owner.cancel()); current[0] = False
            before = len(row[7].calls); charged = list(row[6].charges)
            self.assertEqual(owner.begin_exit_ready(), "queued")
            self.assertEqual(executor.submit(owner.finish_exit_ready).result(timeout=10), "ready")
        self.assertFalse(owner.run_entered); self.assertFalse(owner.run_returned)
        self.assertEqual(len(row[7].calls), before); self.assertEqual(row[6].charges, charged)
        self.assertTrue(all(not handle.closed for handle in row[1].guards))
        self.assertFalse(owner.settle()); self.assertTrue(owner.blocks_recovery)
        with self.assertRaises(session.TrainingSessionError): owner.start()

    def test_cancelled_original_queued_future_proves_no_loader_entry(self):
        owner, executor, row, updates, _, *_ = self.ready()
        entered, release = Event(), Event()
        def hold(): entered.set(); self.assertTrue(release.wait(10))
        blocker = executor.submit(hold)
        try:
            self.assertTrue(entered.wait(5))
            with patch.object(owner, "loader", side_effect=AssertionError("Cancelled loader ran")):
                self.assertEqual(owner.start()["kind"], "accepted"); original = owner.future
                self.assertTrue(owner.cancel()); self.assertTrue(original.cancelled())
                self.assertEqual(owner.begin_exit_ready(), "queued")
                release.set(); blocker.result(timeout=10)
                before = len(row[7].calls)
                self.assertEqual(executor.submit(owner.finish_exit_ready).result(timeout=10), "ready")
            self.assertIs(owner.future, original); self.assertFalse(owner.run_entered)
            self.assertEqual(updates[-1]["status"], "cancelled")
            self.assertEqual(len(row[7].calls), before); self.assertFalse(owner.settled)
        finally: release.set()

    def test_public_nonstart_flags_cannot_substitute_for_original_cancellation(self):
        owner, _, row, *_ = self.ready()
        owner.cancelled=True; owner.cancel_result=True; owner.known_not_run=True
        before=len(row[7].calls)
        self.assertEqual(owner.begin_exit_ready(),"pending")
        self.assertFalse(exit_ready._books[owner]["attempted"])
        self.assertEqual(len(row[7].calls),before)

    def test_lost_submit_is_not_known_no_dispatch_after_cancellation(self):
        owner, _, row, *_ = self.ready()
        def lost(actual): raise RuntimeError("Synthetic lost submit acknowledgement")
        owner.submit=lost
        self.assertEqual(owner.start()["kind"],"unconfirmed")
        self.assertTrue(owner.cancel()); owner.known_not_run=True
        before=len(row[7].calls)
        self.assertEqual(owner.begin_exit_ready(),"pending")
        self.assertFalse(exit_ready._books[owner]["attempted"])
        self.assertEqual(len(row[7].calls),before)

    def test_failed_cancel_acknowledgement_cannot_admit_unstarted_readiness(self):
        owner, _, row, *_ = self.ready()
        def lost(): raise RuntimeError("Synthetic lost cancellation acknowledgement")
        owner.native_cancel=lost
        self.assertFalse(owner.cancel()); owner.cancel_result=True
        self.assertEqual(owner.begin_exit_ready(),"pending")
        self.assertFalse(exit_ready._books[owner]["attempted"])

    def test_cancel_callback_cannot_forge_positive_acknowledgement_or_return_pending_work(self):
        for mode in ("throw","pending","false"):
            with self.subTest(mode=mode):
                owner, _, row, *_ = self.ready(); calls=[]; pending=Future()
                original_cancel=owner.native_cancel
                def cancel():
                    calls.append("cancel"); original_cancel(); owner.cancel_result=True
                    if mode=="throw": raise RuntimeError("Synthetic lost cancellation reply")
                    return pending if mode=="pending" else False
                owner.native_cancel=cancel
                self.assertFalse(owner.cancel()); self.assertFalse(owner.cancel_result)
                self.assertFalse(exit_ready._books[owner]["cancel_acknowledged"])
                owner.cancel_result=True  # Public state still cannot supply the private ACK.
                before=len(row[7].calls)
                self.assertEqual(owner.begin_exit_ready(),"pending")
                self.assertEqual(len(row[7].calls),before);self.assertEqual(calls,["cancel"])
                self.assertFalse(pending.done())  # No waiting/cancelling unknown returned work.

    def test_unstarted_main_thread_bootstrap_keeps_original_native_thread_and_uses_file_executor(self):
        owner,executor,row,*_=self.ready(bootstrap_on_main=True)
        source_owner=row[1].owner;initial=source_owner.thread
        self.assertEqual(initial,get_ident());self.assertNotEqual(initial,files._owners[row[0]]["thread"])
        self.assertTrue(owner.cancel());before=len(row[7].calls)
        self.assertEqual(owner.begin_exit_ready(),"queued")
        self.assertEqual(executor.submit(owner.finish_exit_ready).result(timeout=10),"ready")
        self.assertEqual(source_owner.thread,initial);self.assertEqual(len(row[7].calls),before)
        self.assertFalse(owner.settled);self.assertTrue(owner.blocks_recovery)

    def test_returned_main_thread_bootstrap_uses_actual_borrow_thread_for_exit_proof(self):
        owner,executor,row,*_=self.ready(bootstrap_on_main=True)
        initial=row[1].owner.thread;self.finish_training(owner)
        self.assertNotEqual(row[1].owner.thread,initial)
        self.assertEqual(owner.begin_exit_ready(),"queued")
        self.assertEqual(executor.submit(owner.finish_exit_ready).result(timeout=10),"ready")

    def test_changed_unstarted_native_thread_is_not_adopted_or_healed(self):
        owner,executor,row,*_=self.ready(bootstrap_on_main=True)
        original=row[1].owner.thread;self.assertTrue(owner.cancel())
        row[1].owner.thread=files._owners[row[0]]["thread"]
        self.assertEqual(owner.begin_exit_ready(),"queued")
        self.assertEqual(executor.submit(owner.finish_exit_ready).result(timeout=10),"unconfirmed")
        row[1].owner.thread=original
        self.assertEqual(executor.submit(owner.finish_exit_ready).result(timeout=10),"unconfirmed")

    def test_same_original_executor_and_genuine_file_proof_are_not_global_settlement(self):
        for method in ("full-finetune", "lora", "qlora"):
            with self.subTest(method=method):
                owner, executor, row, updates, current, threads, _ = self.ready(method=method)
                self.finish_training(owner)
                self.assertEqual(updates[-1]["status"], "succeeded")
                native_before = len(row[7].calls); charged = list(row[6].charges)
                current[0] = False  # Already-owned cleanup needs no renewed business grant.
                self.assertEqual(owner.begin_exit_ready(), "queued")
                self.assertEqual(executor.submit(owner.finish_exit_ready).result(timeout=10), "ready")
                self.assertEqual(len(set(threads)), 1); self.assertNotEqual(threads[0], get_ident())
                self.assertEqual(len(row[7].calls), native_before); self.assertEqual(row[6].charges, charged)
                self.assertTrue(all(not handle.closed for handle in row[1].guards))
                self.assertFalse(owner.settle()); self.assertFalse(owner.settled); self.assertTrue(owner.blocks_recovery)
                self.assertEqual(owner.begin_exit_ready(), "unconfirmed")
                self.assertEqual(executor.submit(owner.finish_exit_ready).result(timeout=10), "unconfirmed")
                with self.assertRaises(session.TrainingSessionError): owner.start()
                with self.assertRaises(session.TrainingSessionError): executor.submit(owner.seal, row[3]).result(timeout=10)

    def test_file_capture_callback_cancellation_or_withdrawal_cannot_publish_prepared(self):
        for mode in ("cancel", "withdraw"):
            with self.subTest(mode=mode):
                target = []
                def hook():
                    if mode == "cancel": target[0].cancel()
                    else: target[1][0] = False
                owner, executor, _, _, current, *_ = self.fixture(original_files_hook=hook)
                target.extend((owner, current))
                self.assertEqual(executor.submit(owner.prepare).result(timeout=10), "unconfirmed")
                self.assertTrue(exit_ready._books[owner]["unknown"])

    def test_active_original_run_is_nonconsuming_pending_then_can_finish(self):
        entered, release = Event(), Event()
        def hold(): entered.set(); self.assertTrue(release.wait(10))
        owner, executor, *_ = self.ready(before_run=hold)
        try:
            with patch.object(owner, "loader", return_value=TrainModelTaskResult(runId="inert", status="succeeded")):
                self.assertEqual(owner.start()["kind"], "accepted"); self.assertTrue(entered.wait(5))
                self.assertEqual(owner.begin_exit_ready(), "pending")
                self.assertFalse(exit_ready._books[owner]["attempted"])
                release.set(); owner.future.result(timeout=10)
            self.assertEqual(owner.begin_exit_ready(), "queued")
            self.assertEqual(executor.submit(owner.finish_exit_ready).result(timeout=10), "ready")
        finally: release.set()

    def test_wrong_thread_cannot_mint_or_revive_readiness(self):
        owner, executor, row, *_ = self.ready(); self.finish_training(owner)
        before = len(row[7].calls); self.assertEqual(owner.begin_exit_ready(), "queued")
        self.assertEqual(owner.finish_exit_ready(), "unconfirmed")
        self.assertEqual(executor.submit(owner.finish_exit_ready).result(timeout=10), "unconfirmed")
        self.assertEqual(len(row[7].calls), before); self.assertFalse(owner.settle())

    def test_lost_dispatch_cannot_be_retried_or_healed_by_late_completion(self):
        owner, executor, row, *_ = self.ready(); self.finish_training(owner)
        self.assertEqual(owner.begin_exit_ready(), "queued"); owner.mark_exit_ready_lost()
        self.assertEqual(executor.submit(owner.finish_exit_ready).result(timeout=10), "unconfirmed")
        self.assertEqual(owner.begin_exit_ready(), "unconfirmed")
        self.assertNotEqual(files._owners[row[0]]["phase"], "exit-ready")

    def test_same_shaped_session_is_denied_before_its_hash_or_fields(self):
        calls = []
        class Fake:
            def __hash__(self): calls.append("hash"); return 0
            def __getattr__(self, name): calls.append("field"); raise AssertionError(name)
        with self.assertRaises(session.TrainingSessionError): exit_ready.begin(Fake())
        self.assertEqual(calls, [])

    def test_virtual_session_fields_are_denied_before_lookup(self):
        owner, *_ = self.ready(); calls = []
        def hash_value(actual): calls.append("hash"); return object.__hash__(actual)
        with patch.object(session.OriginalTrainingSession, "__hash__", hash_value):
            with self.assertRaises(session.TrainingSessionError): owner.begin_exit_ready()
        self.assertEqual(calls, [])

    def test_replaced_session_lock_is_denied_without_running_its_context_methods(self):
        owner, *_ = self.ready(); self.finish_training(owner); calls = []
        class FakeLock:
            def __enter__(self): calls.append("enter")
            def __exit__(self, *args): calls.append("exit")
        original = owner.lock
        try:
            owner.lock = FakeLock()
            with self.assertRaises(session.TrainingSessionError): owner.begin_exit_ready()
            self.assertEqual(calls, [])
        finally: owner.lock = original

    def test_replaced_sealed_scope_cannot_request_readiness(self):
        owner, *_ = self.ready(); self.finish_training(owner)
        owner._sealed_definition["request"]["method"] = "full-finetune"
        with self.assertRaises(session.TrainingSessionError): owner.begin_exit_ready()

    def test_pending_native_io_preserves_all_original_guards_and_accounting(self):
        owner, executor, row, *_ = self.ready(); self.finish_training(owner)
        native_owner = files._prepared_files[row[0]][11][0]
        native_owner.pending.append({"returned": False})
        self.assertEqual(owner.begin_exit_ready(), "queued")
        self.assertEqual(executor.submit(owner.finish_exit_ready).result(timeout=10), "unconfirmed")
        native_owner.pending.clear()  # Fixture-only mutation does not revive proof.
        self.assertEqual(owner.begin_exit_ready(), "unconfirmed"); self.assertFalse(owner.settle())
        self.assertTrue(all(not handle.closed for handle in row[1].guards))

    def test_resource_getters_and_async_file_factories_are_rejected_before_preparation(self):
        from modules.adapters.runtime.python.worker.tests.test_approved_local_training_session import Resources
        calls = []
        def getter(resource): calls.append("getter"); raise AssertionError("Getter must not run")
        async def asynchronous(resource): calls.append("async"); return None
        for field, method in (("prepare", property(getter)), ("original_files", property(getter)),
                              ("original_files", asynchronous)):
            with self.subTest(field=field, method=type(method).__name__):
                resource_type = type("RejectedResource", (Resources,), {field: method})
                owner, executor, _, _, _, _, resource = self.fixture(resource_type=resource_type)
                self.assertEqual(executor.submit(owner.prepare).result(timeout=10), "unconfirmed")
                self.assertEqual(resource.calls, []); self.assertTrue(exit_ready._books[owner]["unknown"])
        self.assertEqual(calls, [])


class OriginalTrainingExitRoutesTests(unittest.TestCase):
    def setUp(self):
        case = OriginalTrainingSessionExitTests(); self.addCleanup(case.doCleanups)
        unused, self.executor, self.row, _, _, self.threads, self.resource = case.fixture()
        self.definition = deepcopy(files._owners[self.row[0]]["definition"])
        resource = self.resource
        class Producer(session.NativeTrainingProducer):
            @property
            def profile(self): return session.NativeTrainingProfile("synthetic-software-only", "sha256:"+"e"*64, 30)
            def capture(self, value): assert value == self_definition; return resource
        self_definition = self.definition; self.producer = Producer()
        for target, name, value in (
            (app, "TASK_REGISTRY", {}), (app, "TASK_EXECUTOR", self.executor),
            (app, "_ORIGINAL_TRAINING_PRODUCER", None), (app, "_ORIGINAL_TRAINING_PROFILE", None),
            (app, "_ORIGINAL_TRAINING_PROTOCOL", "settled-v1"), (app, "_ORIGINAL_TRAINING_STAGES", {}),
            (session, "train_model_from_local_files", lambda *args, **kwargs: TrainModelTaskResult(runId="inert", status="succeeded")),
        ):
            item = patch.object(target, name, value); item.start(); self.addCleanup(item.stop)
        app.configure_original_training(self.producer, retirement_protocol=exit_ready.PROTOCOL)

    def prepare(self):
        reply = app._prepare_original_training({"identity": app._training_identity(), "definition": self.definition})
        self.assertEqual(reply["phase"], "ready"); self.binding = reply["binding"]
        self.owner = app.TASK_REGISTRY[self.definition["requestId"]]["_originalTrainingOwner"]
        self.addCleanup(lambda: exit_ready._books.pop(self.owner, None))
        return reply

    def action(self, action, **fields):
        return app._operate_original_training(self.definition["requestId"], action, {"binding": self.binding, **fields})

    def terminal(self):
        self.prepare(); self.assertEqual(self.action("seal", input=self.row[3])["phase"], "ready")
        self.assertEqual(self.action("start")["kind"], "accepted"); self.owner.future.result(timeout=10)
        self.assertEqual(self.action("read")["record"]["status"], "succeeded")

    def test_actual_routes_use_one_original_executor_and_distinct_local_readiness(self):
        self.terminal(); before = len(self.row[7].calls)
        reply = self.action("exit-ready")
        self.assertEqual(reply, {"binding": self.binding, "schema": "original-training-exit-ready-v1", "ready": True, "retirement": "ready"})
        self.assertNotIn("settled", reply); self.assertEqual(len(set(self.threads)), 1)
        self.assertNotEqual(self.threads[0], get_ident()); self.assertEqual(len(self.row[7].calls), before)
        self.assertFalse(self.owner.settle()); self.assertFalse(self.owner.settled)
        self.assertTrue(self.owner.blocks_recovery); self.assertEqual(app._active_task_count(), 1)
        self.assertEqual(self.action("exit-ready")["retirement"], "unconfirmed")
        for action in ("read", "seal", "start", "cancel", "settle", "output-read", "output-ack"):
            with self.subTest(action=action), self.assertRaises(session.TrainingSessionError):
                self.action(action, **({"input": self.row[3]} if action == "seal" else {"sequence": 1} if action == "output-ack" else {}))
        self.assertEqual(set(app._ORIGINAL_TRAINING_STAGES[self.definition["requestId"]]["futures"]), {"prepare", "seal", "exit-ready"})

    def test_actual_cancelled_prestart_route_uses_original_executor_without_training(self):
        self.prepare(); self.assertEqual(self.action("seal",input=self.row[3])["phase"],"ready")
        self.assertTrue(self.action("cancel")["cancelled"])
        self.assertEqual(self.action("read")["record"]["status"],"cancelled")
        before=len(self.row[7].calls)
        self.assertTrue(self.action("exit-ready")["ready"])
        self.assertFalse(self.owner.run_entered); self.assertFalse(self.owner.run_returned)
        self.assertEqual(len(self.row[7].calls),before)
        self.assertFalse(self.owner.settled); self.assertTrue(self.owner.blocks_recovery)
        self.assertEqual(set(app._ORIGINAL_TRAINING_STAGES[self.definition["requestId"]]["futures"]),{"prepare","seal","exit-ready"})

    def test_versioned_capability_does_not_advertise_legacy_settlement(self):
        capabilities = app.capabilities().capabilities
        self.assertIn(exit_ready.CAPABILITY, capabilities); self.assertNotIn(session.CAPABILITY, capabilities)
        with self.assertRaises(session.TrainingSessionError):
            app.configure_original_training(self.producer, retirement_protocol="unknown")

    def test_preparation_captures_the_executor_before_later_global_replacement(self):
        self.prepare()
        class Replacement:
            def submit(self, *args): raise AssertionError("Replacement executor must not run")
        with patch.object(app, "TASK_EXECUTOR", Replacement()):
            self.assertEqual(self.action("seal", input=self.row[3])["phase"], "ready")
            self.assertEqual(self.action("start")["kind"], "accepted"); self.owner.future.result(timeout=10)
            self.assertTrue(self.action("exit-ready")["ready"])
        self.assertEqual(len(set(self.threads)), 1)

    def test_captured_readiness_methods_ignore_later_instance_replacement(self):
        self.prepare(); self.owner.begin_exit_ready = lambda: "ready"
        self.assertEqual(self.action("exit-ready")["retirement"], "pending")
        self.assertFalse(self.action("exit-ready")["ready"])

    def test_pending_original_native_io_cannot_be_overridden_by_an_instance_callback(self):
        self.terminal(); native_owner = files._prepared_files[self.row[0]][11][0]
        native_owner.pending.append({"returned": False}); self.addCleanup(native_owner.pending.clear)
        self.owner.finish_exit_ready = lambda: "ready"
        self.assertEqual(self.action("exit-ready")["retirement"], "unconfirmed")
        self.assertFalse(self.owner.settle())

    def test_submission_acknowledgement_lost_after_queueing_never_reissues_exit_proof(self):
        self.terminal(); stages = app._ORIGINAL_TRAINING_STAGES[self.definition["requestId"]]
        original = stages["invoke"]; calls = []
        # The trusted owner already queued/completed the exact operation; lose
        # only its acknowledgement. No second submit or new lease is permitted.
        def lost(action, supplied=None):
            calls.append(action); original(action, supplied); raise RuntimeError("synthetic lost acknowledgement")
        stages["invoke"] = lost
        self.assertEqual(self.action("exit-ready")["retirement"], "unconfirmed")
        self.assertEqual(self.action("exit-ready")["retirement"], "unconfirmed")
        self.assertEqual(calls, ["exit-ready"]); self.assertFalse(self.owner.settle())

    def test_authenticated_readiness_route_denies_forged_scope_and_sanitizes_errors(self):
        from fastapi.testclient import TestClient
        self.terminal(); token = "synthetic-exit-ready-test-token"
        endpoint = f'/training/original/{self.definition["requestId"]}/exit-ready'
        with patch.object(app, "RUNTIME_AUTH_TOKEN", token), TestClient(app.app) as client:
            body = {"binding": self.binding}; headers = {"authorization": "Bearer "+token}
            self.assertEqual(client.post(endpoint, json=body).status_code, 401)
            wrong = {"binding": {**self.binding, "sessionId": "f"*64}}
            denied = client.post(endpoint, json=wrong, headers=headers)
            self.assertEqual(denied.status_code, 409); self.assertEqual(denied.json(), {"error": "original_training_unavailable"})
            reply = client.post(endpoint, json=body, headers=headers)
            self.assertEqual(reply.status_code, 200); self.assertTrue(reply.json()["ready"])
            self.assertNotIn("settled", reply.json()); self.assertNotIn("definition", reply.text)


if __name__ == "__main__": unittest.main()
