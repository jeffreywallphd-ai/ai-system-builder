"""Original file-owner integration with real finite Native code, no OS/model."""
from copy import deepcopy
from enum import Enum
from pathlib import Path
import sys
from threading import Event,Thread,get_ident
from types import ModuleType,SimpleNamespace
import unittest
from unittest.mock import patch

from modules.adapters.runtime.python.worker.native import windows_original_worker_launch as native
from modules.adapters.runtime.python.worker.tasks import original_training_files as files
from modules.adapters.runtime.python.worker.tests import test_native_training_model_graph as fixture


class Current(fixture.Control):
    def __init__(self):super().__init__();self.hook=None
    def assert_current(self):
        if self.hook is not None:self.hook()
        return self.current


class OriginalTrainingFilesTests(unittest.TestCase):
    def fixture(self,*,control=None,method="lora",bind=True,delivery=None):
        case=fixture.TrainingInputCopyTests();self.addCleanup(case.doCleanups)
        source,lease,staged,configuration,ordinary,kernel,content,recipe=case.fixture(count=2,native_module=native,method=method)
        kernel.node("X:\\outputs",True)
        output={"maximumCopyBytes":256*1024,"outputs":[
            {"freshParent":"X:\\outputs","freshName":name,"maximumCopyBytes":128*1024,
             "bufferBytes":4096,"preparationMs":30000} for name in ("checkpoint-1","candidate")]}
        control=ordinary if control is None else control
        owner=files.OriginalTrainingFiles(lease,configuration,output,control,control,delivery=delivery) if bind else None
        if owner is not None:
            self.addCleanup(lambda:files._owners.pop(owner,None))
            self.addCleanup(lambda:files._bindings.pop(owner,None))
        self.addCleanup(lambda:files._leases.pop(lease,None))
        return owner,source,lease,staged,configuration,output,control,kernel,content,recipe

    def test_replaced_owner_slot_is_rejected_before_any_getter(self):
        for kind,cls in (("resource",files._Resource),("admission",files._Admission)):
            with self.subTest(kind=kind):
                owner,*_=self.fixture();control=files._owners[owner][kind]
                original=object.__getattribute__(control,"owner");calls=[]
                def getter(instance):calls.append("getter");return original
                with patch.object(cls,"owner",property(getter)):
                    with self.assertRaises(ValueError):control.assert_current()
                self.assertEqual(calls,[])

    def test_optional_delivery_binds_exact_family_before_loader_and_retains_local_guards(self):
        from time import monotonic
        from modules.adapters.runtime.python.worker.tasks import original_training_output_delivery as delivery
        _,source,lease,staged,configuration,output,control,_,_,_=self.fixture(bind=False)
        queue=delivery.OriginalTrainingOutputDelivery(native._verified_model_receivers[source]["task_id"],
            maximum_files=64,maximum_payload_bytes=256*1024,deadline=monotonic()+30)
        owner=files.OriginalTrainingFiles(lease,configuration,output,control,control,delivery=queue)
        self.addCleanup(lambda:files._owners.pop(owner,None));self.addCleanup(lambda:files._bindings.pop(owner,None))
        payload=owner.prepare(staged)
        with owner.borrow() as view:
            self.assertIs(delivery.capture_original_output_delivery(view,payload.model_dump(mode="json")),queue)
            self.assertTrue(delivery.original_output_delivery_matches(queue,view))
            self.assertEqual(queue.read()["phase"],"bound")
        self.assertEqual(owner.local_status()["guardCustody"],"retained")
        self.assertEqual(owner.local_status()["globalRetirement"],"not-qualified")
        self.assertEqual(queue.read()["phase"],"bound")  # No transfer or settlement was claimed.

    def test_replacing_optional_delivery_is_denied_before_any_input_io(self):
        owner,_,_,staged,_,_,_,kernel,_,_=self.fixture();before=len(kernel.calls)
        files._owners[owner]["delivery"]=object()
        with self.assertRaises(ValueError):owner.prepare(staged)
        self.assertEqual(len(kernel.calls),before)

    def test_concurrent_constructor_cannot_replace_original_lease_owner(self):
        _,_,lease,_,configuration,output,control,kernel,_,_=self.fixture(bind=False)
        entered,released=Event(),Event();result=[];original=files._method
        main_thread=get_ident();paused=False
        def method(actor,name):
            nonlocal paused
            if get_ident()!=main_thread and not paused:
                paused=True;entered.set()
                if not released.wait(5):raise AssertionError("Fixture release was not received.")
            return original(actor,name)
        def construct():
            try:result.append(files.OriginalTrainingFiles(lease,configuration,output,control,control))
            except BaseException as error:result.append(error)
        before=len(kernel.calls)
        with patch.object(files,"_method",side_effect=method):
            thread=Thread(target=construct);thread.start()
            try:
                self.assertTrue(entered.wait(3))
                with self.assertRaises(ValueError):files.OriginalTrainingFiles(lease,configuration,output,control,control)
            finally:released.set();thread.join(5)
        self.assertFalse(thread.is_alive());self.assertEqual(len(result),1)
        self.assertIs(type(result[0]),files.OriginalTrainingFiles)
        self.assertIs(files._leases[lease],result[0]);self.assertEqual(len(kernel.calls),before)
        files._owners.pop(result[0],None);files._bindings.pop(result[0],None)

    def test_real_input_copy_one_joint_borrow_and_retained_guards(self):
        owner,source,lease,staged,config,_,control,kernel,content,recipe=self.fixture()
        before=deepcopy(staged);payload=owner.prepare(staged)
        self.assertEqual(staged,before)
        graph=native._model_leases[lease]["input_copy_owner"]
        self.assertIs(type(graph),native.OriginalTrainingInputGraph)
        self.assertEqual(control.charges,[config["maximumCopyBytes"]])
        self.assertEqual([bytes(kernel.nodes[graph.physical_path+"\\"+row["name"]]["data"]) for row in graph.records],
            [content,content,recipe])
        with owner.borrow() as view:
            model,inputs=native.resolve_original_training_references(view,payload.model_dump(mode="json"))
            self.assertEqual(len(inputs),2)
            self.assertTrue(all(value.startswith(graph.physical_path+"\\") for value in inputs))
            family=native._resolve_output_family_for_training(view,payload.model_dump(mode="json"))
            self.assertIs(type(family),native.OriginalTrainingOutputFamily)
            self.assertEqual(family.phase,"bound")
        self.assertEqual(source.phase,"spent")
        self.assertEqual(owner.local_status(),{"phase":"local-output-closed","outputIoClosed":True,
            "guardCustody":"retained","globalRetirement":"not-qualified"})
        self.assertFalse(graph.retired);self.assertTrue(all(not handle.closed for handle in graph.guards))
        self.assertEqual(control.retained,[])
        before=len(kernel.calls)
        with self.assertRaises(ValueError):
            with owner.borrow():self.fail("Second borrow entered")
        self.assertEqual(len(kernel.calls),before)

    def test_foreign_or_duplicate_owner_cannot_claim_another_lease(self):
        owner,_,lease,_,configuration,output,control,kernel,_,_=self.fixture()
        before=len(kernel.calls)
        for supplied in (object(),lease):
            with self.assertRaises(ValueError):files.OriginalTrainingFiles(supplied,configuration,output,control,control)
        self.assertEqual(len(kernel.calls),before)
        self.assertIs(files._leases[lease],owner)

    def test_wrong_thread_does_not_consume_original_preparation(self):
        owner,_,_,staged,_,_,_,kernel,_,_=self.fixture();denied=[];before=len(kernel.calls)
        def other():
            try:owner.prepare(staged)
            except ValueError:denied.append(True)
        thread=Thread(target=other);thread.start();thread.join(3)
        self.assertFalse(thread.is_alive());self.assertEqual(denied,[True]);self.assertEqual(len(kernel.calls),before)
        self.assertEqual(owner.local_status()["phase"],"bound")
        owner.prepare(staged)

    def test_changed_input_identity_refuses_before_effect_without_consuming_owner(self):
        owner,_,_,staged,_,_,control,kernel,_,_=self.fixture();before=len(kernel.calls)
        wrong=deepcopy(staged);wrong["recipe"]["digest"]="sha256:"+"f"*64
        with self.assertRaises(native.LaunchUnavailable):owner.prepare(wrong)
        self.assertEqual(len(kernel.calls),before);self.assertEqual(control.charges,[])
        self.assertEqual(owner.local_status()["phase"],"bound")
        owner.prepare(staged)

    def test_cancel_before_copy_has_no_native_effect_or_global_claim(self):
        owner,_,_,staged,_,_,control,kernel,_,_=self.fixture();before=len(kernel.calls)
        owner.request_cancel();owner.request_cancel()
        with self.assertRaises(ValueError):owner.prepare(staged)
        self.assertEqual(len(kernel.calls),before);self.assertEqual(control.charges,[])
        self.assertFalse(owner.local_status()["outputIoClosed"])
        self.assertEqual(owner.local_status()["globalRetirement"],"not-qualified")

    def test_lost_permission_and_owned_reentry_stop_before_copy(self):
        for change in ("permission","reentry","cancel"):
            with self.subTest(change=change):
                control=Current()
                owner,_,_,staged,_,_,_,kernel,_,_=self.fixture(control=control)
                before=len(kernel.calls)
                def hook():
                    control.hook=None
                    if change=="permission":control.current=False
                    elif change=="cancel":owner.request_cancel()
                    else:
                        with self.assertRaises(ValueError):owner.prepare(staged)
                control.hook=hook
                with self.assertRaises(ValueError):owner.prepare(staged)
                self.assertEqual(len(kernel.calls),before);self.assertEqual(control.charges,[])
                self.assertEqual(owner.local_status()["phase"],"unconfirmed")

    def test_unknown_copy_retains_custody_and_cannot_repeat_or_enter_training(self):
        owner,_,_,staged,_,_,control,kernel,_,_=self.fixture();kernel.short_write=True
        with self.assertRaises(ValueError):owner.prepare(staged)
        self.assertEqual(control.charges,[128*1024])
        before=len(kernel.calls)
        for action in (lambda:owner.prepare(staged),lambda:owner.run()):
            with self.assertRaises(ValueError):action()
        self.assertEqual(len(kernel.calls),before)
        self.assertEqual(owner.local_status()["guardCustody"],"retained")
        self.assertEqual(owner.local_status()["phase"],"unconfirmed")

    def test_callback_errors_do_not_expose_supplied_details(self):
        control=Current();owner,_,_,staged,_,_,_,kernel,_,_=self.fixture(control=control)
        before=len(kernel.calls)
        def hook():raise RuntimeError("synthetic-secret-detail")
        control.hook=hook
        with self.assertRaisesRegex(ValueError,"^The original training files are unavailable[.]$"):
            owner.prepare(staged)
        self.assertEqual(len(kernel.calls),before)

    def test_getter_control_is_refused_without_invoking_it(self):
        case=fixture.TrainingInputCopyTests();self.addCleanup(case.doCleanups)
        _,lease,_,configuration,control,kernel,_,_=case.fixture(native_module=native)
        seen=[]
        class Getter:
            @property
            def assert_current(self):seen.append(True);raise AssertionError("Getter ran")
        output={"maximumCopyBytes":128*1024,"outputs":[{**configuration,"freshName":"candidate"}]}
        before=len(kernel.calls)
        with self.assertRaises(ValueError):files.OriginalTrainingFiles(lease,configuration,output,control,Getter())
        self.assertEqual(seen,[]);self.assertEqual(len(kernel.calls),before)

    def test_changed_helper_refuses_before_invoking_replacement(self):
        owner,_,_,staged,_,_,_,kernel,_,_=self.fixture();before=len(kernel.calls);seen=[]
        def replacement(*args,**kwargs):seen.append(True);raise AssertionError("Replacement ran")
        with patch.object(native.OriginalTrainingInputGraph,"prepare",replacement):
            with self.assertRaises(ValueError):owner.prepare(staged)
        self.assertEqual(seen,[]);self.assertEqual(len(kernel.calls),before)

    def test_detached_payload_and_configuration_edits_cannot_change_the_original_run(self):
        owner,_,_,staged,configuration,output,_,_,_,_=self.fixture()
        payload=owner.prepare(staged);expected=deepcopy(files._owners[owner]["payload"])
        payload.commonParameters["maxSteps"]=999;staged["payload"]["method"]="other"
        configuration["freshName"]="replacement";output["outputs"][-1]["freshName"]="replacement"
        with owner.borrow() as view:
            native.resolve_original_training_references(view,expected)
            family=native._resolve_output_family_for_training(view,expected)
            self.assertEqual(native._output_family_snapshot(family)["outputs"][-1]["freshName"],"candidate")

    def test_cancellation_after_copy_denies_borrow_without_releasing_input_guards(self):
        owner,_,lease,staged,_,_,control,kernel,_,_=self.fixture();owner.prepare(staged)
        graph=native._model_leases[lease]["input_copy_owner"];owner.request_cancel();before=len(kernel.calls)
        with self.assertRaises(ValueError):
            with owner.borrow():self.fail("Cancelled borrow entered")
        self.assertEqual(len(kernel.calls),before);self.assertEqual(control.charges,[128*1024])
        self.assertTrue(all(not handle.closed for handle in graph.guards));self.assertFalse(graph.retired)

    def test_failed_body_closes_only_local_output_and_keeps_unknown_work_visible(self):
        owner,source,lease,staged,_,_,_,_,_,_=self.fixture();owner.prepare(staged)
        with self.assertRaisesRegex(ValueError,"^The original training files are unavailable[.]$"):
            with owner.borrow():raise RuntimeError("synthetic-private-body-detail")
        self.assertEqual(source.phase,"spent");self.assertTrue(owner.local_status()["outputIoClosed"])
        self.assertEqual(owner.local_status()["phase"],"unconfirmed")
        self.assertFalse(native._model_leases[lease]["input_copy_owner"].retired)

    def test_lost_output_accounting_reply_cannot_exit_as_success_or_repeat_effects(self):
        owner,_,_,staged,_,_,control,kernel,_,_=self.fixture();payload=owner.prepare(staged)
        with self.assertRaises(ValueError):
            with owner.borrow() as view:
                request=payload.model_dump(mode="json")
                family=native._resolve_output_family_for_training(view,request)
                content={"tokenizer.json":b"{}","adapter_model.safetensors":b"synthetic","adapter_config.json":b"{}"}
                graph=native.OriginalTrainingOutputGraph(view,request,family.next_configuration,
                    [{"name":name,"sizeBytes":len(raw)} for name,raw in content.items()],
                    files._owners[owner]["resource"],files._owners[owner]["admission"],_family=family)
                graph.prepare({name:(raw,) for name,raw in content.items()})
                control.retain_ok=False
        self.assertEqual(owner.local_status()["phase"],"unconfirmed")
        self.assertFalse(owner.local_status()["outputIoClosed"])
        self.assertEqual(control.charges,[128*1024]*2);self.assertEqual(control.retained,[128*1024])
        before=len(kernel.calls)
        with self.assertRaises(ValueError):owner.run()
        self.assertEqual(len(kernel.calls),before);self.assertEqual(control.retained,[128*1024])

    def test_control_owner_substitution_and_virtual_weak_reference_never_execute(self):
        owner,_,_,_,_,_,_,kernel,_,_=self.fixture()
        other,_,_,_,_,_,_,_,_,_=self.fixture()
        from weakref import ref
        wrapper=files._owners[owner]["resource"];seen=[];before=len(kernel.calls)
        with patch.object(wrapper,"owner",ref(other)):
            with self.assertRaises(ValueError):wrapper.assert_current()
        def observer():seen.append(True);return owner
        with patch.object(wrapper,"owner",observer):
            with self.assertRaises(ValueError):wrapper.assert_current()
        self.assertEqual(seen,[]);self.assertEqual(len(kernel.calls),before)

    def test_internal_virtual_or_rewritten_configuration_is_not_adopted(self):
        for change in ("maximum","definition","destination"):
            with self.subTest(change=change):
                owner,_,_,staged,_,_,_,kernel,_,_=self.fixture();seen=[];before=len(kernel.calls)
                class Virtual:
                    def __eq__(self,other):seen.append(True);return True
                    def __bool__(self):seen.append(True);return True
                record=files._owners[owner]
                if change=="maximum":record["maximum"]=Virtual()
                elif change=="definition":record["definition"]=Virtual()
                else:record["output_configuration"]["outputs"][-1]["freshName"]="replacement"
                with self.assertRaises((ValueError,native.LaunchUnavailable)):owner.prepare(staged)
                self.assertEqual(seen,[]);self.assertEqual(len(kernel.calls),before)

    def test_fixed_private_pipeline_runs_all_three_methods_through_this_actual_owner(self):
        # Load installed in-memory data before replacing the inert Torch edge.
        # Reuse the existing tensor, metadata and Trainer software fixtures.
        import datasets
        import pytest
        from modules.adapters.runtime.python.worker.tests import test_train_model_task as sdk
        original_boot=fixture.SourceLaunchExchangeTests.bound_bootstrap
        def settings(case,definition=None,*args,**kwargs):
            if definition is not None:
                definition["request"].setdefault("commonParameters",{})["maxSteps"]=1
                definition["request"].setdefault("advancedParameters",{}).update(checkpointIntervalSteps=50,saveTotalLimit=2)
            return original_boot(case,definition,*args,**kwargs)
        for method in ("full-finetune","lora","qlora"):
            with self.subTest(method=method),pytest.MonkeyPatch.context() as setup:
                setup.setattr(fixture.SourceLaunchExchangeTests,"bound_bootstrap",settings)
                owner,source,lease,staged,_,_,control,kernel,_,_=self.fixture(method=method)
                owner.prepare(staged)
                tensor_case=fixture.DenseTensorByteAdapterTests()
                try:
                    _,torch,Tensor,Device=tensor_case.fixture(sdk_only=True)
                    with pytest.MonkeyPatch.context() as mp:
                        transformers=ModuleType("transformers");mp.setitem(sys.modules,"transformers",transformers)
                        class PeftType(Enum):LORA="LORA"
                        class LoraConfig:
                            def __init__(self,**options):
                                self.target_modules=set(options.get("target_modules",("q_proj",)))
                                self.peft_type=PeftType.LORA;self.bias=options.get("bias","none")
                                self.use_dora=False;self.modules_to_save=None;self.trainable_token_indices=None
                        class Model:
                            def __init__(self):
                                self.vocab=10;self.peft_config={"default":LoraConfig()}
                                self.state={name:tensor_case.tensor(Tensor,torch,Device,tag=name)[0] for name in
                                    ("base.weight","layer.lora_A.default.weight","embed_tokens.weight")}
                            def state_dict(self):return self.state
                            def get_input_embeddings(self):return SimpleNamespace(num_embeddings=self.vocab)
                            def resize_token_embeddings(self,size):self.vocab=size
                        model=Model();peft=ModuleType("peft")
                        def select(original,*,state_dict,adapter_name,unwrap_compiled,save_embedding_layers):
                            self.assertIs(original,model);self.assertEqual(adapter_name,"default")
                            selected={name.replace(".default",""):value for name,value in state_dict.items() if "lora_" in name}
                            if save_embedding_layers:selected["embed_tokens.weight"]=state_dict["embed_tokens.weight"]
                            return selected
                        select.__module__="peft.utils.save_and_load"
                        peft.get_peft_model_state_dict=select;peft.LoraConfig=LoraConfig;peft.PeftType=PeftType
                        peft.TaskType=SimpleNamespace(CAUSAL_LM="CAUSAL_LM")
                        def adapter(original,configuration):
                            self.assertIs(original,model);model.peft_config["default"]=configuration;return model
                        peft.get_peft_model=adapter;mp.setitem(sys.modules,"peft",peft)
                        tokenizer,_=sdk._install_protected_training_metadata_objects(mp,model,method)
                        tokenizer.pad_token="<pad>";tokenizer.eos_token="<eos>"
                        def tokenize(receiver,texts,**options):
                            return {"input_ids":[[1,2,3] for _ in texts],"attention_mask":[[1,1,1] for _ in texts]}
                        mp.setattr(type(tokenizer),"__call__",tokenize,raising=False)
                        with mp.context() as arguments:
                            sdk._checkpoint_arguments_spy(arguments)
                            argument_type=sys.modules["transformers"].TrainingArguments
                        calls,_,disk=sdk._install_checkpoint_trainer(mp,(1,))
                        transformers=sys.modules["transformers"]
                        transformers.TrainingArguments=argument_type
                        original_train=transformers.Trainer.train
                        def train(receiver):
                            result=original_train(receiver);receiver.state.epoch=0
                            for callback in receiver.callbacks:callback.on_step_end(receiver.args,receiver.state,SimpleNamespace())
                            return result
                        transformers.Trainer.train=train
                        transformers.AutoTokenizer=SimpleNamespace(from_pretrained=lambda *a,**k:tokenizer)
                        transformers.AutoModelForCausalLM=SimpleNamespace(from_pretrained=lambda *a,**k:model)
                        torch.cuda=SimpleNamespace(is_available=lambda:method=="qlora")
                        if method=="qlora":
                            mp.setitem(sys.modules,"bitsandbytes",ModuleType("bitsandbytes"))
                            transformers.BitsAndBytesConfig=lambda **options:SimpleNamespace(**options)
                        mp.setattr(sdk.train_model_module,"_local_training_model_reference",lambda value:value)
                        def forbidden(*args,**kwargs):self.fail("Ordinary writer or model-quality path ran")
                        with mp.context() as guard:
                            for name in ("mkdir","write_bytes","write_text"):guard.setattr(Path,name,forbidden)
                            for name in ("save_adapter_pretrained","save_full_model_pretrained","write_serialization_manifest","validate_model_output","rmtree"):
                                guard.setattr(sdk.train_model_module,name,forbidden)
                            guard.setattr(sdk.train_model_module.tempfile,"mkdtemp",forbidden)
                            result=owner.run()
                        self.assertEqual(result.status,"succeeded");self.assertEqual(calls.count("train"),1)
                        self.assertEqual(disk,[]);self.assertEqual(source.phase,"spent")
                        self.assertEqual(control.charges,[128*1024]*3)
                        self.assertEqual(control.retained,[128*1024]*2)
                        self.assertTrue(owner.local_status()["outputIoClosed"])
                        self.assertEqual(owner.local_status()["globalRetirement"],"not-qualified")
                        graph=native._model_leases[lease]["input_copy_owner"]
                        self.assertFalse(graph.retired);self.assertTrue(all(not handle.closed for handle in graph.guards))
                finally:tensor_case.doCleanups()


if __name__=="__main__":unittest.main()
