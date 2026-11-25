"""Actual finite Native/file-owner exit barriers; no Windows or model effects."""
from copy import deepcopy
from threading import Thread
import unittest
from unittest.mock import patch

from modules.adapters.runtime.python.worker.tasks import original_training_exit_barrier as barrier
from modules.adapters.runtime.python.worker.tasks import original_training_files as files
from modules.adapters.runtime.python.worker.native import windows_original_worker_launch as native
from modules.adapters.runtime.python.worker.tests import test_original_training_files as file_fixture


class OriginalTrainingExitBarrierTests(unittest.TestCase):
    def fixture(self,method="lora",borrow=True):
        case=file_fixture.OriginalTrainingFilesTests();self.addCleanup(case.doCleanups)
        row=case.fixture(method=method)
        owner,source,lease,staged,_,_,control,kernel,_,_=row
        payload=owner.prepare(staged)
        if borrow:
            with owner.borrow():pass
        self.addCleanup(lambda:barrier._barriers.pop(owner,None))
        return row,payload

    def test_exact_original_one_use_barrier_keeps_model_input_guards_and_has_no_native_effect(self):
        for method in ("full-finetune","lora","qlora"):
            with self.subTest(method=method):
                row,_=self.fixture(method);owner,source,lease,_,_,_,control,kernel,_,_=row
                graph=native._model_leases[lease]["input_copy_owner"]
                before=len(kernel.calls);charged=list(control.charges);retained=list(control.retained)
                token=barrier.prepare_original_training_file_exit(owner)
                self.assertIsNotNone(token);self.assertEqual(source.phase,"exit-ready")
                self.assertTrue(all(not handle.closed for handle in graph.guards))
                self.assertTrue(all(not handle.closed for handle in source.guards))
                self.assertEqual(control.charges,charged);self.assertEqual(control.retained,retained)
                self.assertEqual(len(kernel.calls),before)
                proof=barrier.consume_original_training_file_exit(owner,token)
                self.assertEqual(proof["localAdmission"],"permanently-fenced")
                self.assertEqual(proof["workerRetirement"],"not-qualified")
                self.assertEqual(proof["outputCustody"],"not-qualified")
                self.assertIsNone(barrier.prepare_original_training_file_exit(owner))
                with self.assertRaises(barrier.OriginalTrainingExitUnavailable):barrier.consume_original_training_file_exit(owner,token)
                with self.assertRaises(ValueError):
                    with owner.borrow():self.fail("Fenced owner borrowed again")
                self.assertEqual(len(kernel.calls),before)

    def test_active_borrow_and_prepared_only_owner_cannot_claim_closed_output(self):
        row,_=self.fixture(borrow=False);owner,source,_,_,_,_,_,kernel,_,_=row
        before=len(kernel.calls);self.assertIsNone(barrier.prepare_original_training_file_exit(owner))
        self.assertEqual(source.phase,"bound")
        with owner.borrow():self.assertIsNone(barrier.prepare_original_training_file_exit(owner))
        self.assertEqual(source.phase,"spent");self.assertIsNotNone(barrier.prepare_original_training_file_exit(owner))
        self.assertGreaterEqual(len(kernel.calls),before)

    def test_held_original_locks_are_nonconsuming_then_exact_owner_can_proceed(self):
        for index in range(4):
            with self.subTest(lock=index):
                row,_=self.fixture();owner,source,_,_,_,_,_,kernel,_,_=row
                proof=files._prepared_files[owner];locks=(proof[10],proof[9],proof[11][1],proof[12][1]);before=len(kernel.calls)
                locks[index].acquire()
                try:self.assertIsNone(barrier.prepare_original_training_file_exit(owner))
                finally:locks[index].release()
                self.assertEqual(source.phase,"spent");self.assertEqual(len(kernel.calls),before)
                self.assertIsNotNone(barrier.prepare_original_training_file_exit(owner))

    def test_unknown_native_or_pending_call_never_grants_exit_proof(self):
        for which,mode in ((11,"unknown"),(11,"pending"),(12,"unknown"),(12,"pending")):
            with self.subTest(owner=which,mode=mode):
                row,_=self.fixture();owner,source,_,_,_,_,_,kernel,_,_=row
                native_owner=files._prepared_files[owner][which][0];before=len(kernel.calls)
                if mode=="unknown":native_owner.unknown=True
                else:native_owner.pending.append({"returned":False})
                self.assertIsNone(barrier.prepare_original_training_file_exit(owner))
                self.assertEqual(source.phase,"spent");self.assertEqual(len(kernel.calls),before)

    def test_observed_native_uncertainty_cannot_revive_when_a_mutable_flag_is_reset(self):
        row,_=self.fixture();owner=row[0];native_owner=files._prepared_files[owner][11][0]
        native_owner.unknown=True;self.assertIsNone(barrier.prepare_original_training_file_exit(owner))
        native_owner.unknown=False
        self.assertIsNone(barrier.prepare_original_training_file_exit(owner))

    def test_materialized_output_handles_are_closed_but_model_and_inputs_remain_retained(self):
        row,payload=self.fixture(borrow=False);owner,source,lease,_,_,_,control,kernel,_,_=row
        with owner.borrow() as view:
            request=payload.model_dump(mode="json");family=native._resolve_output_family_for_training(view,request)
            content={"tokenizer.json":b"{}","adapter_model.safetensors":b"synthetic","adapter_config.json":b"{}"}
            graph=native.OriginalTrainingOutputGraph(view,request,family.next_configuration,
                [{"name":name,"sizeBytes":len(raw)} for name,raw in content.items()],
                files._owners[owner]["resource"],files._owners[owner]["admission"],_family=family)
            graph.prepare({name:(raw,) for name,raw in content.items()})
        before=len(kernel.calls);retained=list(control.retained)
        self.assertTrue(all(handle.closed for handle in graph.owner.handles))
        token=barrier.prepare_original_training_file_exit(owner);self.assertIsNotNone(token)
        barrier.consume_original_training_file_exit(owner,token)
        self.assertTrue(all(not handle.closed for handle in source.guards))
        self.assertTrue(all(not handle.closed for handle in native._model_leases[lease]["input_copy_owner"].guards))
        self.assertEqual(control.retained,retained);self.assertEqual(len(kernel.calls),before)

    def test_foreign_unregistered_and_copied_tokens_have_no_authority(self):
        row,_=self.fixture();owner=row[0];other=self.fixture()[0][0]
        token=barrier.prepare_original_training_file_exit(owner);self.assertIsNotNone(token)
        for supplied in (object(),{},barrier._OriginalTrainingFileExit(),deepcopy(token)):
            with self.assertRaises(barrier.OriginalTrainingExitUnavailable):barrier.consume_original_training_file_exit(owner,supplied)
        with self.assertRaises(barrier.OriginalTrainingExitUnavailable):barrier.consume_original_training_file_exit(other,token)
        self.assertEqual(barrier.consume_original_training_file_exit(owner,token)["localAdmission"],"permanently-fenced")

    def test_payload_source_and_prepared_record_replacements_cannot_be_adopted(self):
        for change in ("payload","source-definition","task","source-digest","input-reader","sealed-input","lock","native-handles"):
            with self.subTest(change=change):
                row,_=self.fixture();owner,source,lease,_,_,_,_,kernel,_,_=row
                record=files._owners[owner];prepared=files._prepared_files[owner];before=len(kernel.calls)
                if change=="payload":record["payload"]["commonParameters"]["maxSteps"]=123
                elif change=="source-definition":record["source_record"]["definition"]["owner"]["principalId"]="other"
                elif change=="task":record["source_record"]["task_id"]="other"
                elif change=="source-digest":record["source_record"]["definition_digest"]="sha256:"+"0"*64
                elif change=="input-reader":native._training_input_readers[record["input"]]=dict(prepared[5])
                elif change=="sealed-input":native._sealed_training_inputs[record["input"]]=dict(prepared[6])
                elif change=="lock":record["lock"]=type(record["lock"])()
                else:prepared[11][0].handles=list(prepared[11][0].handles)
                self.assertIsNone(barrier.prepare_original_training_file_exit(owner))
                self.assertEqual(source.phase,"spent");self.assertEqual(len(kernel.calls),before)

    def test_pending_input_copy_or_source_read_cannot_be_hidden_by_closed_flags(self):
        for name in ("input_copy_io_active","input_source_read_active"):
            with self.subTest(field=name):
                row,_=self.fixture();owner,source,lease,_,_,_,_,kernel,_,_=row
                state=native._model_leases[lease];state[name]=object();before=len(kernel.calls)
                self.assertIsNone(barrier.prepare_original_training_file_exit(owner))
                self.assertEqual(source.phase,"spent");self.assertEqual(len(kernel.calls),before)

    def test_cleanup_barrier_does_not_call_withdrawn_business_or_resource_admission(self):
        row,_=self.fixture();owner,_,_,_,_,_,control,kernel,_,_=row
        def forbidden():self.fail("Cleanup requested a fresh business or copy grant")
        control.current=False;control.hook=forbidden;before=len(kernel.calls)
        token=barrier.prepare_original_training_file_exit(owner);self.assertIsNotNone(token)
        barrier.consume_original_training_file_exit(owner,token);self.assertEqual(len(kernel.calls),before)

    def test_wrong_thread_is_nonconsuming_and_has_no_effect(self):
        row,_=self.fixture();owner=row[0];results=[];before=len(row[7].calls)
        thread=Thread(target=lambda:results.append(barrier.prepare_original_training_file_exit(owner)));thread.start();thread.join(3)
        self.assertFalse(thread.is_alive());self.assertEqual(results,[None]);self.assertEqual(len(row[7].calls),before)
        self.assertIsNotNone(barrier.prepare_original_training_file_exit(owner))

    def test_retained_guard_close_or_handle_retargeting_cannot_mint_a_witness(self):
        for change in ("model-close","input-close","retarget"):
            with self.subTest(change=change):
                row,_=self.fixture();owner,source,lease,_,_,_,_,kernel,_,_=row
                handle=source.guards[0] if change!="input-close" else native._model_leases[lease]["input_copy_owner"].guards[0]
                before=len(kernel.calls)
                if change=="retarget":handle.slot.value+=1
                else:handle.closed=True
                self.assertIsNone(barrier.prepare_original_training_file_exit(owner));self.assertEqual(len(kernel.calls),before)

    def test_unknown_after_mint_spends_the_token_without_credit_or_revival(self):
        row,_=self.fixture();owner=row[0];token=barrier.prepare_original_training_file_exit(owner)
        self.assertIsNotNone(token);native_owner=files._prepared_files[owner][12][0]
        native_owner.pending.append({"returned":False})
        with self.assertRaises(barrier.OriginalTrainingExitUnavailable):barrier.consume_original_training_file_exit(owner,token)
        native_owner.pending.clear()
        with self.assertRaises(barrier.OriginalTrainingExitUnavailable):barrier.consume_original_training_file_exit(owner,token)

    def test_fake_closed_flags_cannot_hide_held_output_family_io(self):
        row,_=self.fixture();owner=row[0];family=files._owners[owner]["family"]
        book=native._training_output_families[family];book["io"]["lock"].acquire()
        try:self.assertIsNone(barrier.prepare_original_training_file_exit(owner))
        finally:book["io"]["lock"].release()

    def test_replaced_token_constructor_and_virtual_native_fields_never_execute(self):
        row,_=self.fixture();owner=row[0];seen=[]
        def invoked(*args):seen.append(True);raise RuntimeError("virtual data")
        with patch.object(barrier._OriginalTrainingFileExit,"__new__",staticmethod(invoked),create=True):
            self.assertIsNone(barrier.prepare_original_training_file_exit(owner))
        with patch.object(native.OriginalTrainingInputGraph,"owner",property(invoked),create=True):
            self.assertIsNone(barrier.prepare_original_training_file_exit(owner))
        self.assertEqual(seen,[])

    def test_native_and_handle_getters_are_rejected_before_reused_input_helper(self):
        for cls,name in ((native.InheritedModelNativeCalls,"handles"),(native.Handle,"known")):
            with self.subTest(field=name):
                row,_=self.fixture();owner=row[0];seen=[]
                def getter(instance):seen.append(name);return object.__getattribute__(instance,"__dict__")[name]
                with patch.object(cls,name,property(getter),create=True):
                    self.assertIsNone(barrier.prepare_original_training_file_exit(owner))
                self.assertEqual(seen,[])

    def test_native_helper_primitives_are_admitted_before_equality_or_truth_checks(self):
        for name in ("sealed","read_state","thread","phase"):
            with self.subTest(field=name):
                row,_=self.fixture();owner=row[0];seen=[]
                class Virtual:
                    def __eq__(self,other):seen.append("equality");return True
                    def __bool__(self):seen.append("truth");return True
                record=files._owners[owner]
                target=files._prepared_files[owner][5] if name in ("sealed","read_state") else native._training_output_families[record["family"]]
                target[name]=Virtual()
                self.assertIsNone(barrier.prepare_original_training_file_exit(owner));self.assertEqual(seen,[])

    def test_consume_rejects_replaced_owner_hash_before_any_weak_lookup(self):
        row,_=self.fixture();owner=row[0];token=barrier.prepare_original_training_file_exit(owner);seen=[]
        self.assertIsNotNone(token)
        # Retire the no-callback weakrefs whose cached hashes would otherwise
        # mask this ordering bug. Both wrappers still reference the SAME owner.
        from weakref import ref
        for name in ("resource","admission"):
            object.__setattr__(files._owners[owner][name],"owner",ref(owner,lambda reference:None))
        def hashed(instance):seen.append("hash");return object.__hash__(instance)
        with patch.object(files.OriginalTrainingFiles,"__hash__",hashed,create=True):
            with self.assertRaises(barrier.OriginalTrainingExitUnavailable):barrier.consume_original_training_file_exit(owner,token)
        self.assertEqual(seen,[])


if __name__=="__main__":unittest.main()
