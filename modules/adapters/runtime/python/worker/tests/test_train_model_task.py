from __future__ import annotations

import importlib
import hashlib
import gc
import json
import struct
import sys
from contextlib import contextmanager
from enum import Enum
from types import ModuleType, SimpleNamespace
from pathlib import Path, PureWindowsPath

import pytest

from modules.adapters.runtime.python.worker.models import TrainModelTaskRequest

train_model_module = importlib.import_module("modules.adapters.runtime.python.worker.tasks.train_model")
multimodal_module = importlib.import_module("modules.adapters.runtime.python.worker.tasks.train_model_multimodal")


def _settings_argument_spy(monkeypatch):
    calls=[]
    class Arguments:
        def __init__(self,**options):
            calls.append(options)
            self.options={"seed":42,"lr_scheduler_type":"linear","eval_strategy":"no",**options}
    monkeypatch.setitem(sys.modules,"transformers",SimpleNamespace(TrainingArguments=Arguments))
    monkeypatch.setitem(sys.modules,"torch",SimpleNamespace(cuda=SimpleNamespace(is_available=lambda:False)))
    return calls


@pytest.mark.parametrize("seed",[0,19])
def test_text_training_applies_selected_seed_scheduler_and_evaluation_interval(monkeypatch,tmp_path,seed):
    calls=_settings_argument_spy(monkeypatch); payload=_request(tmp_path)
    payload.commonParameters["seed"]=seed
    payload.advancedParameters={"schedulerType":"cosine","evalIntervalSteps":3}
    validation=payload.datasets[0].model_copy(deep=True);validation.splitRole="validation"
    payload.datasets.append(validation)
    result=train_model_module._build_training_args(payload,tmp_path)
    assert len(calls)==1
    assert {k:result.options[k] for k in ("seed","lr_scheduler_type","eval_strategy","eval_steps")}=={
        "seed":seed,"lr_scheduler_type":"cosine","eval_strategy":"steps","eval_steps":3}


def test_text_training_defaults_do_not_enable_evaluation(monkeypatch,tmp_path):
    _settings_argument_spy(monkeypatch);payload=_request(tmp_path)
    result=train_model_module._build_training_args(payload,tmp_path)
    assert result.options["seed"]==42 and result.options["lr_scheduler_type"]=="linear"
    assert result.options["eval_strategy"]=="no" and result.options["eval_steps"] is None


@pytest.mark.parametrize("seed",[0,19])
def test_explicit_training_seed_runs_before_tokenizer_and_model_initialization(monkeypatch,seed):
    calls=_inert_transformers(monkeypatch)
    sys.modules["transformers"].set_seed=lambda value:calls.append(("seed",value))
    train_model_module._load_transformers_objects("synthetic/base","lora",{},training_seed=seed)
    assert [row[0] for row in calls]==["seed","tokenizer","model"] and calls[0][1]==seed


def test_training_orchestration_forwards_explicit_seed_before_loading(monkeypatch,tmp_path):
    payload=_request(tmp_path);payload.commonParameters["seed"]=19;calls=[]
    monkeypatch.setattr(train_model_module,"_load_dataset",lambda *args,**kwargs:({"train":[1]},None))
    def load(*args,**kwargs):
        calls.append(kwargs);raise train_model_module.TrainingCancellationRequested()
    monkeypatch.setattr(train_model_module,"_load_transformers_objects",load)
    with pytest.raises(train_model_module.TrainingCancellationRequested):train_model_module.train_model(payload)
    assert calls==[{"training_seed":19}]


@pytest.mark.parametrize("section,key,value",[("commonParameters","seed",True),("commonParameters","seed",-1),
    ("commonParameters","seed",2**32),("commonParameters","seed",1.5),("commonParameters","seed","19"),
    ("advancedParameters","schedulerType",True),("advancedParameters","schedulerType",""),
    ("advancedParameters","schedulerType","private/path"),("advancedParameters","evalIntervalSteps",True),
    ("advancedParameters","evalIntervalSteps",-1),("advancedParameters","evalIntervalSteps",1.5),
    ("advancedParameters","evalIntervalSteps",2**53)])
def test_bad_text_training_settings_deny_before_output_or_model_setup(monkeypatch,tmp_path,section,key,value):
    payload=_request(tmp_path)
    if getattr(payload,section) is None:setattr(payload,section,{})
    getattr(payload,section)[key]=value
    monkeypatch.setattr(train_model_module,"Path",lambda *args:pytest.fail("Invalid settings reached output setup"))
    monkeypatch.setattr(train_model_module,"_load_dataset",lambda *args,**kwargs:pytest.fail("Invalid settings reached dataset loading"))
    with pytest.raises(ValueError) as raised:train_model_module.train_model(payload)
    assert "private/path" not in str(raised.value)


def test_interval_evaluation_without_validation_denies_before_arguments(monkeypatch,tmp_path):
    calls=_settings_argument_spy(monkeypatch);payload=_request(tmp_path);payload.advancedParameters={"evalIntervalSteps":3}
    with pytest.raises(ValueError,match="Select a validation dataset"):
        train_model_module._build_training_args(payload,tmp_path)
    assert calls==[]


@pytest.mark.parametrize("mismatch",[False,True])
def test_private_seed_matches_original_and_rechecks_authority_before_loading(monkeypatch,mismatch):
    from modules.adapters.runtime.python.worker.tests.test_native_training_model_graph import SourceLaunchExchangeTests
    original=SourceLaunchExchangeTests.bound_bootstrap
    def initial_seed(self,definition=None,*args,**kwargs):
        if definition is not None:definition["request"].setdefault("commonParameters",{})["seed"]=7
        return original(self,definition,*args,**kwargs)
    # Set the controlled input before real fixture capture/digest/Native binding.
    # The product admission/resolver and original request proof are not patched.
    missing=object(); original_torch=sys.modules.get("torch",missing)
    with monkeypatch.context() as input_patch:
        input_patch.setattr(SourceLaunchExchangeTests,"bound_bootstrap",initial_seed)
        with _protected_tensor_selection_fixture(input_patch) as facts:
            actual,use,model,_,_,control,_,_=facts
            assert use.payload.commonParameters["seed"]==7
            # Undo the nested SDK replacement before the fixture's patch.dict
            # restores its original module table. Reversed cleanup leaks Torch.
            with monkeypatch.context() as sdk_patch:
                calls=_inert_transformers(sdk_patch)
                def seed(value):calls.append(("seed",value));control.current=False
                sys.modules["transformers"].set_seed=seed
                paths=[];sdk_patch.setattr(train_model_module,"_local_training_model_reference",lambda value:paths.append(value) or value)
                with pytest.raises((ValueError,actual.LaunchUnavailable)):
                    train_model_module._load_transformers_objects(use.model_reference,use.payload.method,{},
                        local_files_only=True,_protected_use=use,training_seed=8 if mismatch else 7)
                assert calls==([] if mismatch else [("seed",7)])
                if mismatch:assert paths==[]
    assert sys.modules.get("torch",missing) is original_torch


@contextmanager
def _checkpoint_schedule_fixture(monkeypatch,*,maximum=1,interval=50,retention=2,outputs=2,family=True,method="lora"):
    from modules.adapters.runtime.python.worker.tests.test_native_training_model_graph import SourceLaunchExchangeTests
    original=SourceLaunchExchangeTests.bound_bootstrap
    def settings(self,definition=None,*args,**kwargs):
        if definition is not None:
            definition["request"].setdefault("commonParameters",{})["maxSteps"]=maximum
            definition["request"].setdefault("advancedParameters",{}).update(
                checkpointIntervalSteps=interval,saveTotalLimit=retention)
        return original(self,definition,*args,**kwargs)
    with monkeypatch.context() as input_patch:
        input_patch.setattr(SourceLaunchExchangeTests,"bound_bootstrap",settings)
        with _protected_training_metadata_fixture(input_patch,method,capture_weights=False) as (facts,tokenizer,_,_):
            actual,use,model,_,_,_,Tensor,_=facts
            kernel,configuration,_,_,control=model.test_output
            group=None
            if family:
                configurations=[{**configuration,"freshName":f"snapshot-{i}"} for i in range(outputs-1)]+[configuration]
                group=actual.OriginalTrainingOutputFamily(use.view,use.payload.model_dump(mode="json"),
                    {"maximumCopyBytes":128*1024*outputs,"outputs":configurations},control,control)
            yield actual,use,model,tokenizer,group,control,kernel,Tensor


def _checkpoint_arguments_spy(monkeypatch,*,during=None):
    constructed=[];disk=[]
    class Arguments:
        @property
        def should_save(self):return True
        def __init__(self,**options):
            self.__dict__.update(options);constructed.append(options)
            if during is not None:during(self)
            if self.should_save:disk.append("ordinary-sdk-directory")
    monkeypatch.setitem(sys.modules,"transformers",SimpleNamespace(TrainingArguments=Arguments))
    monkeypatch.setitem(sys.modules,"torch",SimpleNamespace(cuda=SimpleNamespace(is_available=lambda:False)))
    return constructed,disk


@pytest.mark.parametrize("maximum,interval,retention,expected",[(1,50,2,(1,)),(6,3,2,(3,6)),
    (7,3,3,(3,6,7)),(15,1,15,tuple(range(1,16)))])
def test_checkpoint_schedule_binds_actual_family_and_blocks_sdk_path_saving(monkeypatch,tmp_path,maximum,interval,retention,expected):
    with _checkpoint_schedule_fixture(monkeypatch,maximum=maximum,interval=interval,retention=retention,
            outputs=len(expected)+1) as (actual,use,_,_,family,control,kernel,Tensor):
        before=len(kernel.calls)
        assert train_model_module._bind_protected_checkpoint_schedule(use)==expected
        record=actual._output_family_snapshot(family)
        assert record["training_owner"][0] is use and record["training_owner"][1] is use._checkpoint_slot
        with monkeypatch.context() as sdk_patch:
            constructed,disk=_checkpoint_arguments_spy(sdk_patch)
            args=train_model_module._build_training_args(use.payload,tmp_path,_protected_use=use)
            assert args.should_save is False and args.save_only_model is True and args.save_strategy=="steps"
            assert (args.max_steps,args.save_steps,args.save_total_limit)==(maximum,interval,retention)
            assert len(constructed)==1 and disk==[]
            with pytest.raises(ValueError):train_model_module._build_training_args(use.payload,tmp_path,_protected_use=use)
            assert len(constructed)==1 and family.phase=="bound"
        assert control.charges==[] and Tensor.copies==[]
        assert not any(name in ("NtCreateFile","WriteFile","NtSetSecurityObject","CreateProcessW") for name,_ in kernel.calls[before:])


@pytest.mark.parametrize("changes",[{"maximum":None},{"maximum":True},{"maximum":0},{"maximum":1.5},
    {"maximum":2**31},{"interval":True},{"interval":0},{"interval":1.5},{"retention":False},
    {"retention":0},{"maximum":16,"interval":1,"retention":16},
    {"maximum":7,"interval":3,"retention":2,"outputs":4},{"outputs":3}])
def test_checkpoint_schedule_denies_unsupported_or_unbounded_settings_before_sdk(monkeypatch,changes):
    with _checkpoint_schedule_fixture(monkeypatch,**changes) as (_,use,_,_,family,control,_,Tensor):
        with pytest.raises(ValueError,match="private checkpoint schedule"):
            train_model_module._bind_protected_checkpoint_schedule(use)
        assert use._checkpoint_slot["stage"]=="failed" and family.phase=="failed"
        assert control.charges==[] and Tensor.copies==[]


def test_checkpoint_schedule_requires_original_family_and_does_not_poison_another_owner(monkeypatch):
    with _checkpoint_schedule_fixture(monkeypatch,family=False) as (_,use,*_):
        with pytest.raises(ValueError):train_model_module._bind_protected_checkpoint_schedule(use)
    with _checkpoint_schedule_fixture(monkeypatch) as (_,use,_,_,family,control,_,Tensor):
        train_model_module._bind_protected_checkpoint_schedule(use)
        other=train_model_module._ProtectedTrainingUse(use.payload,use.view)
        with pytest.raises(ValueError):train_model_module._bind_protected_checkpoint_schedule(other)
        assert family.phase=="bound" and use._checkpoint_slot["stage"]=="ready"
        train_model_module._check_protected_use(use)
        assert control.charges==[] and Tensor.copies==[]


@pytest.mark.parametrize("failure",["permission","settings","helper","slot","caught-reentry"])
def test_checkpoint_arguments_fail_closed_if_sdk_callback_loses_original_binding(monkeypatch,tmp_path,failure):
    with _checkpoint_schedule_fixture(monkeypatch) as (_,use,_,_,family,control,_,Tensor):
        train_model_module._bind_protected_checkpoint_schedule(use);original_slot=use._checkpoint_slot
        def during(args):
            if failure=="permission":control.current=False
            elif failure=="settings":use.payload.commonParameters["maxSteps"]=999
            elif failure=="helper":use._checkpoint_family_claim=lambda *a:pytest.fail("Replacement helper")
            elif failure=="slot":use._checkpoint_slot=None
            else:
                try:train_model_module._build_training_args(use.payload,tmp_path,_protected_use=use)
                except ValueError:pass
        with monkeypatch.context() as sdk_patch:
            constructed,disk=_checkpoint_arguments_spy(sdk_patch,during=during)
            with pytest.raises(ValueError):train_model_module._build_training_args(use.payload,tmp_path,_protected_use=use)
            assert len(constructed)==1 and disk==[]
        assert original_slot["stage"]=="failed" and family.phase=="failed"
        assert control.charges==[] and Tensor.copies==[]


@pytest.mark.parametrize("lost_slot",[False,True])
def test_bound_checkpoint_schedule_requires_sdk_and_original_binding(monkeypatch,tmp_path,lost_slot):
    with _checkpoint_schedule_fixture(monkeypatch) as (_,use,model,tokenizer,family,control,_,Tensor):
        train_model_module._bind_protected_checkpoint_schedule(use)
        with monkeypatch.context() as sdk_patch:
            _checkpoint_arguments_spy(sdk_patch)
            args=train_model_module._build_training_args(use.payload,tmp_path,_protected_use=use)
            if lost_slot:use._checkpoint_slot=None
            with pytest.raises(ValueError,match="checkpoint handler" if lost_slot else "training attempt"):
                train_model_module._run_trainer(model,tokenizer,{"train":[{}]},None,args,_protected_use=use)
        assert (use._training_slot is None if lost_slot else use._training_slot["stage"]=="failed")
        assert family.phase=="failed"
        assert control.charges==[] and Tensor.copies==[]


def _install_checkpoint_trainer(monkeypatch,steps,*,during=None,catch=False):
    calls=[];objects=[];disk=[]
    class Trainer:
        def __init__(self,**options):
            self.__dict__.update(options);self.state=type("State",(),{})()
            self.state.global_step=0;self.state.log_history=[];self.test_steps=[];objects.append(self);calls.append("construct")
            if self.args.should_save:disk.append("constructor-directory")
        def train(self):
            calls.append("train")
            for step in steps:
                self.test_steps.append(step)
                self.state.global_step=step
                for tensor in self.model.state.values():
                    tensor._storage[:]=struct.pack("<4f",*[float(step)]*4);tensor._counter[0]+=1
                if during is not None:during(self,step)
                try:self._save_checkpoint(self.model,None)
                except ValueError:
                    if not catch:raise
                self.state.log_history.append({"step":step,"loss":0.25})
            return SimpleNamespace(metrics={"train_loss":0.25})
        def _save_checkpoint(self,*args):disk.append("ordinary-sdk-checkpoint")
        def save_model(self,*args,**kwargs):disk.append("ordinary-sdk-save")
    module=ModuleType("transformers");module.Trainer=Trainer
    module.TrainerCallback=type("TrainerCallback",(),{})
    module.DataCollatorForLanguageModeling=lambda **options:SimpleNamespace(**options)
    monkeypatch.setitem(sys.modules,"transformers",module)
    return calls,objects,disk


@contextmanager
def _protected_pipeline_fixture(monkeypatch,*,method="full-finetune",family=True,during=None):
    # Load the real in-memory Dataset SDK before the inert Torch fixture.
    import datasets
    with _checkpoint_schedule_fixture(monkeypatch,method=method,family=family) as facts:
        actual,original,model,tokenizer,group,control,kernel,Tensor=facts
        use=train_model_module._ProtectedTrainingUse(original.payload,original.view)
        sdk=sys.modules["torch"]
        calls,objects,disk=_install_checkpoint_trainer(monkeypatch,(1,),during=during)
        transformers=sys.modules["transformers"]
        original_train=transformers.Trainer.train
        def training_with_progress(receiver):
            result=original_train(receiver)
            receiver.state.epoch=0
            for callback in receiver.callbacks:
                callback.on_step_end(receiver.args,receiver.state,SimpleNamespace())
            return result
        transformers.Trainer.train=training_with_progress
        with monkeypatch.context() as args_patch:
            _checkpoint_arguments_spy(args_patch)
            argument_type=sys.modules["transformers"].TrainingArguments
        transformers.TrainingArguments=argument_type
        # Actual fixed loading helpers and original Use remain in place; these
        # installed-supplier boundaries return synthetic objects, never a model.
        def tokenizer_factory(reference,**options):
            calls.append("tokenizer")
            assert reference==use.model_reference and options=={
                "use_fast":True,"local_files_only":True,"trust_remote_code":False,"token":False}
            return tokenizer
        def model_factory(reference,**options):
            calls.append("model")
            assert reference==use.model_reference and options["use_safetensors"] is True and options["weights_only"] is True
            assert options["local_files_only"] is True and options["trust_remote_code"] is False and options["token"] is False
            return model
        transformers.AutoTokenizer=SimpleNamespace(from_pretrained=tokenizer_factory)
        transformers.AutoModelForCausalLM=SimpleNamespace(from_pretrained=model_factory)
        tokenizer.pad_token="<pad>";tokenizer.eos_token="<eos>"
        def tokenize(self,texts,**options):
            calls.append(("tokenize",tuple(texts)))
            return {"input_ids":[[1,2,3] for _ in texts],"attention_mask":[[1,1,1] for _ in texts]}
        monkeypatch.setattr(type(tokenizer),"__call__",tokenize,raising=False)
        sdk.cuda=SimpleNamespace(is_available=lambda:method=="qlora")
        if method=="qlora":
            monkeypatch.setitem(sys.modules,"bitsandbytes",ModuleType("bitsandbytes"))
            transformers.BitsAndBytesConfig=lambda **options:SimpleNamespace(**options)
        peft=sys.modules["peft"];peft.TaskType=SimpleNamespace(CAUSAL_LM="CAUSAL_LM")
        def adapter(selected,configuration):
            calls.append("adapter");assert selected is model
            model.peft_config["default"]=configuration;return model
        peft.get_peft_model=adapter
        monkeypatch.setattr(train_model_module,"_local_training_model_reference",lambda value:value)
        yield actual,use,model,tokenizer,group,control,kernel,calls,objects,disk


@pytest.mark.parametrize("method",["full-finetune","lora","qlora"])
def test_private_pipeline_connects_original_bytes_to_protected_checkpoint_and_final_output(monkeypatch,method):
    with _protected_pipeline_fixture(monkeypatch,method=method) as (actual,use,model,tokenizer,family,control,kernel,calls,objects,disk):
        progress=[]
        def forbidden(*a,**k):pytest.fail("Private pipeline invoked ordinary filesystem/output behavior")
        with monkeypatch.context() as no_ordinary_io:
            no_ordinary_io.setattr(Path,"mkdir",forbidden)
            no_ordinary_io.setattr(train_model_module.tempfile,"mkdtemp",forbidden)
            for name in ("save_adapter_pretrained","save_full_model_pretrained","validate_model_output",
                    "write_serialization_manifest","_write_run_metadata"):
                no_ordinary_io.setattr(train_model_module,name,forbidden)
            graph=train_model_module._run_protected_training_pipeline(use,on_progress=progress.append)
        assert type(graph) is train_model_module._ProtectedTrainingOutputGraph and graph.phase=="sealed"
        assert use._pipeline_slot["stage"]=="complete" and use._pipeline_slot["graph"] is graph
        assert use._final_result_slot["graph"] is graph and family.phase=="sealed"
        assert len(actual._output_family_snapshot(family)["members"])==2 and disk==[] and control.retained==[]
        assert [entry for entry in calls if type(entry) is str]==(["tokenizer","model","construct","train"] if method=="full-finetune" else
            ["tokenizer","model","adapter","construct","train"])
        assert objects[0].train_dataset.to_list()==[{"input_ids":[1,2,3],"attention_mask":[1,1,1],"labels":[1,2,3]}]
        stages=[row["stage"] for row in progress]
        assert stages[:4]==["dataset-loading","model-loading","sequence-length","tokenization"]
        tail=stages[stages.index("training-arguments"):]
        assert tail[0]=="training-arguments" and tail[-1]=="staged" and set(tail[1:-1])=={"training"}
        assert any(row.get("batch")==1 and row["stage"]=="training" for row in progress)
        run=json.loads(bytes(kernel.nodes[graph.physical_path+"\\training-run.json"]["data"]))
        assert run["runId"]==use._run_identity[0] and run["status"]=="training-complete" and run["candidateValidation"]=="pending"
        assert use._dataset_slot["stage"]=="complete" and objects[0].args.should_save is False
        before=len(kernel.calls)
        with pytest.raises(ValueError):train_model_module._run_protected_training_pipeline(use)
        assert len(kernel.calls)==before and family.phase=="sealed"


def test_private_pipeline_requires_original_output_family_before_dataset_or_model_reads(monkeypatch):
    with _protected_pipeline_fixture(monkeypatch,family=False) as (_,use,_,_,_,control,kernel,calls,_,disk):
        reads=sum(name=="ReadFile" for name,_ in kernel.calls)
        with pytest.raises(ValueError):train_model_module._run_protected_training_pipeline(use)
        assert calls==[] and disk==[] and control.charges==[]
        assert sum(name=="ReadFile" for name,_ in kernel.calls)==reads and use._pipeline_slot["stage"]=="failed"


@pytest.mark.parametrize("method",["full-finetune","lora","qlora"])
def test_original_result_binding_checks_every_pipeline_output_without_ordinary_io(monkeypatch,method):
    with _protected_pipeline_fixture(monkeypatch,method=method) as (native,use,_,_,family,control,kernel,_,_,disk):
        final=train_model_module._run_protected_training_pipeline(use)
        members=tuple(native._output_family_snapshot(family)["members"])
        charges=tuple(control.charges);writes=sum(name=="WriteFile" for name,_ in kernel.calls)
        def forbidden(*a,**k):pytest.fail("Result binding invoked ordinary IO or model execution")
        with monkeypatch.context() as guard:
            for name in ("open","read_bytes","write_bytes","mkdir"):guard.setattr(Path,name,forbidden)
            for name in ("validate_model_output","save_adapter_pretrained","save_full_model_pretrained",
                    "_load_dataset","_load_transformers_objects"):
                # Captured pipeline helpers must stay installed; replacing them
                # is separately denied. Their SDK boundaries are already inert.
                if name not in ("_load_dataset","_load_transformers_objects"):guard.setattr(train_model_module,name,forbidden)
            facts=train_model_module._validate_protected_training_results(use)
        assert tuple(row[0] for row in facts)==("checkpoint","candidate") and facts[0][1]==1 and facts[1][1] is None
        assert type(facts) is tuple and all(type(row) is tuple and row[-1]>0 for row in facts)
        assert all(row[4]==("safetensors" if method=="full-finetune" else "adapter-safetensors") for row in facts)
        assert use._result_validation_slot=={"stage":"complete","facts":facts}
        assert all(native._training_output_readers[row["graph"]]["read_state"]=="complete" for row in members)
        assert len(repr(facts))<8192 and members[-1]["graph"] is final and final.retired is False
        assert sum(name=="WriteFile" for name,_ in kernel.calls)==writes and tuple(control.charges)==charges
        assert disk==[] and control.retained==[] and family.phase=="sealed"
        before=len(kernel.calls)
        with pytest.raises(ValueError):train_model_module._validate_protected_training_results(use)
        assert len(kernel.calls)==before and family.phase=="sealed" and use._result_validation_slot["stage"]=="complete"


def test_original_result_binding_foreign_thread_cannot_consume_the_owner_attempt(monkeypatch):
    from threading import Thread
    with _protected_pipeline_fixture(monkeypatch) as (_,use,_,_,family,_,kernel,_,_,_):
        train_model_module._run_protected_training_pipeline(use)
        errors=[];before=len(kernel.calls)
        def foreign():
            try:train_model_module._validate_protected_training_results(use)
            except BaseException as error:errors.append(type(error))
        thread=Thread(target=foreign);thread.start();thread.join(2)
        assert not thread.is_alive() and errors==[ValueError] and use._result_validation_slot is None
        assert len(kernel.calls)==before and family.phase=="sealed"
        assert len(train_model_module._validate_protected_training_results(use))==2


@pytest.mark.parametrize("change",["reader","parser","history","graph","permission","reentry",
    "business-method","resource-method","admission-owner","reservation-owner"])
def test_original_result_binding_owned_failures_preserve_outputs_and_deny_retry(monkeypatch,change):
    with _protected_pipeline_fixture(monkeypatch) as (native,use,_,_,family,control,kernel,_,_,disk):
        train_model_module._run_protected_training_pipeline(use)
        graphs=tuple(row["graph"] for row in native._output_family_snapshot(family)["members"])
        charges=tuple(control.charges);writes=sum(name=="WriteFile" for name,_ in kernel.calls)
        injected=[]
        if change in ("reader","parser"):
            def replacement(*a,**k):injected.append(True);pytest.fail("Replacement helper executed")
            monkeypatch.setattr(train_model_module,"_NATIVE_TRAINING_OUTPUT_READER" if change=="reader"
                else "validate_protected_training_output_chunks",replacement)
        elif change=="history":use._training_slot["files"]=tuple(list(use._training_slot["files"]))
        elif change=="graph":use._pipeline_slot["graph"]=object()
        elif change=="permission":control.current=False
        elif change in ("business-method","resource-method"):
            def replacement():injected.append(True);return True
            native._output_family_snapshot(family)["methods"][change.split("-")[0]]=replacement
        elif change in ("admission-owner","reservation-owner"):
            native._output_family_snapshot(family)[change.split("-")[0]]=object()
        else:
            def current(obj):
                if obj is control and not injected and use._result_validation_slot is not None:
                    injected.append(True)
                    with pytest.raises(ValueError):train_model_module._validate_protected_training_results(use)
                return obj.__dict__["current"]
            monkeypatch.setattr(type(control),"current",property(current,
                lambda obj,value:obj.__dict__.__setitem__("current",value)),raising=False)
        with pytest.raises((ValueError,train_model_module.LaunchUnavailable)) as error:
            train_model_module._validate_protected_training_results(use)
        assert "Replacement helper" not in str(error.value)
        assert injected==([True] if change=="reentry" else [])
        assert use._result_validation_slot["stage"]=="failed" and family.phase=="failed"
        assert all(graph.retired is False and graph.guards for graph in graphs)
        assert tuple(control.charges)==charges and sum(name=="WriteFile" for name,_ in kernel.calls)==writes
        assert control.retained==[] and disk==[]
        before=len(kernel.calls)
        with pytest.raises(ValueError):train_model_module._validate_protected_training_results(use)
        assert len(kernel.calls)==before


@pytest.mark.parametrize("change",[None,"profile","files","run-id","started-at","method","task","record-hash",
    "format","empty-shapes","step","boolean-step"])
def test_checked_result_summary_requires_original_lineage_and_exact_final_record_hashes(change):
    files=(("training-run.json",12,"a"*64),("serialization_manifest.json",15,"b"*64))
    identity=("11111111-1111-4111-8111-111111111111","2026-01-01T00:00:00+00:00")
    role="checkpoint" if change in ("step","boolean-step") else "candidate"
    run={"runId":identity[0],"startedAt":identity[1],"method":"full-finetune","trainingTask":"llm-instruction","checkpointStep":1}
    result={"profile":role,"files":files,"metadata":{"training-run.json":run},
        "tensorShapeSummary":{"layer":[2]},"serializationFormat":"safetensors"}
    if change=="profile":result["profile"]="checkpoint"
    elif change=="files":result["files"]=tuple(list(files))
    elif change=="run-id":run["runId"]="22222222-2222-4222-8222-222222222222"
    elif change=="started-at":run["startedAt"]="2026-01-02T00:00:00+00:00"
    elif change=="method":run["method"]="lora"
    elif change=="task":run["trainingTask"]="llm-extraction"
    elif change=="format":result["serializationFormat"]="adapter-safetensors"
    elif change=="empty-shapes":result["tensorShapeSummary"]={}
    elif change=="step":run["checkpointStep"]=2
    elif change=="boolean-step":run["checkpointStep"]=True
    expected=files if change!="record-hash" else (("training-run.json",12,"c"*64),files[1])
    def invoke():return train_model_module._training_result_summary(result,files,role=role,
        step=1 if role=="checkpoint" else None,name="synthetic-result",identity=identity,
        method="full-finetune",training_task="llm-instruction",original_records=expected)
    if change is None:
        assert invoke()==("candidate",None,"synthetic-result",files,"safetensors",1)
    else:
        with pytest.raises(ValueError):invoke()


def test_original_result_binding_refuses_unknown_previous_stage_without_equality_hooks():
    from threading import get_ident
    callbacks=[]
    class Stage:
        def __eq__(self,other):callbacks.append(other);return True
    # An incomplete private object is denial-only test data, not a Native Use.
    use=object.__new__(train_model_module._ProtectedTrainingUse)
    use._thread=get_ident();use._result_validation_slot={"stage":Stage()};use._checkpoint_slot=None
    with pytest.raises(ValueError):train_model_module._validate_protected_training_results(use)
    assert callbacks==[] and use._result_validation_slot["stage"]=="failed"


@pytest.mark.parametrize("driver_present",[False,True])
def test_partial_private_use_without_result_helpers_refuses_with_controlled_error(tmp_path,driver_present):
    use=object.__new__(train_model_module._ProtectedTrainingUse)
    use.payload=_request(tmp_path)
    use._completion_helpers=train_model_module._PROTECTED_COMPLETION_HELPERS
    if driver_present:use._result_validation_driver=train_model_module._validate_protected_training_results
    with pytest.raises(ValueError,match="result validation helpers"):
        train_model_module._ProtectedTrainingUse.assert_snapshot(use)


@pytest.mark.parametrize("change",["permission","stage-hook"])
def test_original_result_binding_final_resource_observer_cannot_publish_after_permission_changes(monkeypatch,change):
    with _protected_pipeline_fixture(monkeypatch) as (_,use,_,_,family,control,_,_,_,_):
        train_model_module._run_protected_training_pipeline(use)
        injected=[];equality=[]
        class Stage:
            def __eq__(self,other):equality.append(other);return True
        def current(obj):
            frame=sys._getframe(1);resource=False;final=False
            while frame:
                if (frame.f_code.co_name=="_guard_output_family_training" and frame.f_locals.get("key")=="resource"
                        or frame.f_code.co_name=="current" and frame.f_locals.get("kind")=="resource"):resource=True
                if frame.f_code.co_name=="_validate_protected_training_results" and type(frame.f_locals.get("facts")) is tuple:final=True
                frame=frame.f_back
            if obj is control and resource and final and not injected:
                injected.append(True)
                if change=="permission":obj.__dict__["current"]=False
                else:use._result_validation_slot["stage"]=Stage()
                return True  # This resource observation itself succeeds.
            return obj.__dict__["current"]
        monkeypatch.setattr(type(control),"current",property(current,
            lambda obj,value:obj.__dict__.__setitem__("current",value)),raising=False)
        with pytest.raises((ValueError,train_model_module.LaunchUnavailable)):
            train_model_module._validate_protected_training_results(use)
        assert injected==[True] and equality==[]
        assert use._result_validation_slot["stage"]=="failed" and use._result_validation_slot["facts"] is None
        assert family.phase=="failed" and control.retained==[]


def test_private_pipeline_foreign_thread_refuses_without_poisoning_original_attempt(monkeypatch):
    from threading import Thread
    with _protected_pipeline_fixture(monkeypatch) as (_,use,_,_,family,control,kernel,calls,_,_):
        errors=[];before=len(kernel.calls)
        def foreign():
            try:train_model_module._run_protected_training_pipeline(use)
            except ValueError:errors.append("refused")
        worker=Thread(target=foreign);worker.start();worker.join(5)
        assert not worker.is_alive() and errors==["refused"] and len(kernel.calls)==before
        assert use._pipeline_slot is None and calls==[] and control.charges==[] and family.phase=="bound"


@pytest.mark.parametrize("change",["permission","cancel","error","reentry","slot"])
def test_private_pipeline_progress_loss_denies_without_model_work_or_retry(monkeypatch,change):
    with _protected_pipeline_fixture(monkeypatch) as (actual,use,_,_,family,control,kernel,calls,_,disk):
        def progress(value):
            if value["stage"]!="dataset-loading":return
            if change=="permission":
                actual._model_leases.get(actual._model_views.get(use.view)[0])["view_lost"]=True
            elif change=="cancel":raise train_model_module.TrainingCancellationRequested()
            elif change=="error":raise RuntimeError("synthetic-private-pipeline-details")
            elif change=="reentry":
                with pytest.raises(ValueError):train_model_module._run_protected_training_pipeline(use)
            else:use._pipeline_slot={"stage":"binding"}
        with pytest.raises((ValueError,train_model_module.LaunchUnavailable,train_model_module.TrainingCancellationRequested)) as error:
            train_model_module._run_protected_training_pipeline(use,on_progress=progress)
        assert "synthetic-private-pipeline-details" not in str(error.value) and calls==[] and disk==[]
        assert control.charges==[] and control.retained==[] and family.phase=="failed"
        before=len(kernel.calls)
        with pytest.raises(ValueError):train_model_module._run_protected_training_pipeline(use)
        assert len(kernel.calls)==before


@pytest.mark.parametrize("helper",["_load_dataset","_load_transformers_objects","_run_trainer"])
def test_private_pipeline_replaced_helpers_cannot_receive_original_use(monkeypatch,helper):
    with _protected_pipeline_fixture(monkeypatch) as (_,use,_,_,_,control,kernel,calls,_,_):
        replacements=[];before=len(kernel.calls)
        monkeypatch.setattr(train_model_module,helper,lambda *a,**k:replacements.append(True))
        with pytest.raises(ValueError):train_model_module._run_protected_training_pipeline(use)
        assert replacements==[] and calls==[] and control.charges==[] and len(kernel.calls)==before


def test_private_pipeline_passive_stage_checks_never_invoke_virtual_equality(monkeypatch):
    class Stage(str):
        callbacks=[]
        def __eq__(self,other):self.callbacks.append(other);return str.__eq__(self,other)
    with _protected_pipeline_fixture(monkeypatch) as (_,use,_,_,family,control,_,calls,_,_):
        def progress(value):
            if value["stage"]=="dataset-loading":use._pipeline_slot["stage"]=Stage("dataset-loading")
        with pytest.raises(ValueError):train_model_module._run_protected_training_pipeline(use,on_progress=progress)
        assert Stage.callbacks==[] and calls==[] and control.charges==[] and family.phase=="failed"


@pytest.mark.parametrize("target",["data","trainer"])
def test_private_pipeline_rejects_changed_dataset_before_training(monkeypatch,target):
    from datasets import Dataset
    replacement=Dataset.from_dict({"input_ids":[[99]],"attention_mask":[[1]],"labels":[[99]]})
    captured=[];initial=Dataset.__init__
    def dataset_init(self,*a,**k):initial(self,*a,**k);captured.append(self)
    with _protected_pipeline_fixture(monkeypatch) as (_,use,_,_,family,control,_,calls,objects,disk):
        monkeypatch.setattr(Dataset,"__init__",dataset_init)
        if target=="trainer":
            trainer=sys.modules["transformers"].Trainer;construct=trainer.__init__
            def init(receiver,**options):
                construct(receiver,**options);receiver.train_dataset=replacement
            monkeypatch.setattr(trainer,"__init__",init)
        def progress(value):
            if target=="data" and value["stage"]=="training":
                result=next(split for split in reversed(captured) if "input_ids" in split.column_names)
                object.__getattribute__(result,"__dict__")["_data"]=replacement.data
        with pytest.raises(ValueError):train_model_module._run_protected_training_pipeline(use,on_progress=progress)
        assert "train" not in calls and disk==[] and family.phase=="failed" and control.charges==[]


@pytest.mark.parametrize("export_kind",["checkpoint","final"])
def test_private_pipeline_data_proof_fences_last_native_callback_before_output_write(monkeypatch,export_kind):
    from datasets import Dataset
    replacement=Dataset.from_dict({"input_ids":[[99]],"attention_mask":[[1]],"labels":[[99]]})
    with _protected_pipeline_fixture(monkeypatch) as (actual,use,_,_,family,control,kernel,_,objects,disk):
        changed=[]
        def after(name):
            if changed:return
            if export_kind=="checkpoint":
                training=use._training_slot
                execution=training.get("checkpoint_execution") if type(training) is dict else None
                child=execution.get("active") if type(execution) is dict else None
            else:
                final=use._final_result_slot
                child=final.get("export") if type(final) is dict else None
            output=child._output_slot if child is not None else None
            graph=output.get("graph") if type(output) is dict else None
            if graph is None or output["stage"]!="writing":return
            native=flat=chunk=False;frame=sys._getframe(1)
            while frame:
                if frame.f_locals.get("self") is graph:
                    native |= frame.f_code is actual.OriginalTrainingOutputGraph.guard.__code__
                    flat |= frame.f_code is actual._OriginalProtectedFlatCopy.guard.__code__
                    if frame.f_code is actual.OriginalTrainingOutputGraph.prepare.__code__:
                        chunk |= type(frame.f_locals.get("chunk")) is bytes and frame.f_locals.get("copied")==0
                frame=frame.f_back
            if native and not flat and chunk:
                changed.append(len(kernel.calls))
                object.__getattribute__(objects[0].train_dataset,"__dict__")["_data"]=replacement.data
        kernel.after=after
        with pytest.raises((ValueError,actual.LaunchUnavailable)):
            train_model_module._run_protected_training_pipeline(use)
        assert len(changed)==1 and not any(name=="WriteFile" for name,_ in kernel.calls[changed[0]:])
        assert disk==[] and control.retained==[] and family.phase=="failed" and use._pipeline_slot["stage"]=="failed"


@pytest.mark.parametrize("method",["lora","qlora","full-finetune"])
def test_checkpoint_handler_seals_each_updated_snapshot_without_sdk_path_io(monkeypatch,tmp_path,method):
    from modules.adapters.runtime.python.worker.tests.test_native_training_model_graph import TrainingTensorStreamTests
    with _checkpoint_schedule_fixture(monkeypatch,maximum=3,interval=2,retention=2,outputs=3,method=method) as (actual,use,model,tokenizer,family,control,kernel,Tensor):
        assert use._run_identity[0]=="11111111-1111-4111-8111-111111111111"
        assert train_model_module._bind_protected_checkpoint_schedule(use)==(2,3)
        with monkeypatch.context() as args_patch:
            _checkpoint_arguments_spy(args_patch)
            args=train_model_module._build_training_args(use.payload,tmp_path,_protected_use=use)
        def foreign_thread(trainer,step):
            if method!="lora" or step!=2:return
            from concurrent.futures import ThreadPoolExecutor
            before=len(kernel.calls)
            with ThreadPoolExecutor(max_workers=1) as pool:
                with pytest.raises(ValueError):pool.submit(trainer._save_checkpoint,model,None).result(timeout=5)
                with pytest.raises(ValueError):pool.submit(trainer.save_model,"forbidden").result(timeout=5)
            assert family.phase=="bound" and len(kernel.calls)==before
            assert use._training_slot["checkpoint_execution"]["stage"]=="training"
        calls,objects,disk=_install_checkpoint_trainer(monkeypatch,(2,3),during=foreign_thread)
        result=train_model_module._run_trainer(model,tokenizer,{"train":[{}]},None,args,_protected_use=use)
        assert result[0]=={"train_loss":0.25} and calls==["construct","train"] and disk==[]
        execution=use._training_slot["checkpoint_execution"]
        assert execution["stage"]=="complete" and [row[0] for row in execution["saved"]]==[2,3]
        assert family.phase=="sealed" and len(actual._output_family_snapshot(family)["members"])==3
        for step,name,graph in execution["saved"]:
            assert graph.phase=="sealed" and name==f"snapshot-{0 if step==2 else 1}"
            weight="model.safetensors" if method=="full-finetune" else "adapter_model.safetensors"
            raw=bytes(kernel.nodes[graph.physical_path+"\\"+weight]["data"])
            header,body=TrainingTensorStreamTests().decode(raw)
            assert body==struct.pack("<4f",*[float(step)]*4)*len(header)
            run=json.loads(bytes(kernel.nodes[graph.physical_path+"\\training-run.json"]["data"]))
            assert run["runId"]==use._run_identity[0] and run["checkpointStep"]==step
            assert run["status"]=="checkpoint-snapshot" and run["trainingStatus"]=="running"
            assert run["candidateValidation"]=="pending" and "metrics" not in run
        final=use._final_result_slot
        assert final["stage"]=="sealed" and final["graph"].phase=="sealed"
        weight="model.safetensors" if method=="full-finetune" else "adapter_model.safetensors"
        raw=bytes(kernel.nodes[final["graph"].physical_path+"\\"+weight]["data"])
        header,body=TrainingTensorStreamTests().decode(raw)
        assert body==struct.pack("<4f",*[3.0]*4)*len(header)
        final_run=json.loads(bytes(kernel.nodes[final["graph"].physical_path+"\\training-run.json"]["data"]))
        assert final_run["status"]=="training-complete" and final_run["candidateValidation"]=="pending"
        assert final_run["checkpointFilesVerified"] is True
        assert [row["step"] for row in final_run["checkpointSnapshots"]]==[2,3]
        for row,(_,_,graph) in zip(final_run["checkpointSnapshots"],execution["saved"]):
            for file in row["files"]:
                raw=bytes(kernel.nodes[graph.physical_path+"\\"+file["name"]]["data"])
                assert len(raw)==file["sizeBytes"] and hashlib.sha256(raw).hexdigest()==file["sha256"]
        assert control.charges==[128*1024]*3 and len(execution["exports"])==2
        before=len(kernel.calls)
        with pytest.raises(ValueError):train_model_module._finalize_protected_training_result(use)
        assert len(kernel.calls)==before and family.phase=="sealed"
        other=train_model_module._ProtectedTrainingUse(use.payload,use.view)
        other._checkpoint_slot=use._checkpoint_slot;other._training_slot=use._training_slot
        before=len(kernel.calls)
        with pytest.raises(ValueError):train_model_module._finalize_protected_training_result(other)
        assert len(kernel.calls)==before and family.phase=="sealed" and other._final_result_slot is None
        before=len(kernel.calls)
        with pytest.raises(ValueError):objects[0]._save_checkpoint(model,None)
        assert len(kernel.calls)==before and family.phase=="failed" and disk==[]


def test_final_training_result_requires_original_completed_history_and_thread(monkeypatch,tmp_path):
    from concurrent.futures import ThreadPoolExecutor
    with _checkpoint_schedule_fixture(monkeypatch) as (_,use,model,tokenizer,family,control,kernel,Tensor):
        train_model_module._bind_protected_checkpoint_schedule(use)
        before=len(kernel.calls)
        with pytest.raises(ValueError):train_model_module._finalize_protected_training_result(use)
        with ThreadPoolExecutor(max_workers=1) as pool:
            with pytest.raises(ValueError):
                pool.submit(train_model_module._finalize_protected_training_result,use).result(timeout=5)
        assert len(kernel.calls)==before and use._final_result_slot is None and family.phase=="bound"
        assert control.charges==[] and Tensor.copies==[]


@pytest.mark.parametrize("failure",["finalizer","checkpoint-hash","replaced-facts","seal-reader"])
def test_training_completion_cannot_adopt_post_sdk_replacements(monkeypatch,tmp_path,failure):
    with _checkpoint_schedule_fixture(monkeypatch) as (actual,use,model,tokenizer,family,control,kernel,Tensor):
        train_model_module._bind_protected_checkpoint_schedule(use)
        with monkeypatch.context() as args_patch:
            _checkpoint_arguments_spy(args_patch)
            args=train_model_module._build_training_args(use.payload,tmp_path,_protected_use=use)
        _install_checkpoint_trainer(monkeypatch,(1,));Trainer=sys.modules["transformers"].Trainer
        original=Trainer.train;changed=[];replacement_calls=[]
        class Report:
            @property
            def metrics(self):
                execution=use._training_slot["checkpoint_execution"]
                assert execution["stage"]=="complete"
                changed.append(True)
                if failure=="finalizer":
                    monkeypatch.setattr(train_model_module,"_finalize_protected_training_result",
                        lambda owner:replacement_calls.append(owner))
                elif failure=="seal-reader":
                    original_reader=train_model_module._protected_output_seal_facts
                    def replaced(graph):
                        replacement_calls.append(True)
                        return tuple((name,size,"0"*64) for name,size,_ in original_reader(graph))
                    monkeypatch.setattr(train_model_module,"_protected_output_seal_facts",replaced)
                else:
                    graph=execution["saved"][0][2]
                    graph.records[0]["sha256"]="0"*64
                    if failure=="replaced-facts":
                        # Replacing both exposed mutable state and its displayed
                        # tuple cannot replace the closure-owned original proof.
                        child=execution["exports"][0]
                        child._output_slot["seal_facts"]=train_model_module._protected_output_seal_facts(graph)
                return {"train_loss":0.25}
        def train(self):original(self);return Report()
        monkeypatch.setattr(Trainer,"train",train)
        with pytest.raises((ValueError,actual.LaunchUnavailable)):
            train_model_module._run_trainer(model,tokenizer,{"train":[{}]},None,args,_protected_use=use)
        assert changed==[True] and replacement_calls==[]
        assert use._training_slot["stage"]=="failed" and use._final_result_slot is None and family.phase=="failed"
        assert control.charges==[128*1024]


@pytest.mark.parametrize("failure",["permission","history","checkpoint","final-slot","model","helper",
    "child-proof","reentry","write-error","checkpoint-hash"])
def test_final_training_result_refuses_drift_and_retains_failed_attempt(monkeypatch,tmp_path,failure):
    with _checkpoint_schedule_fixture(monkeypatch) as (actual,use,model,tokenizer,family,control,kernel,Tensor):
        train_model_module._bind_protected_checkpoint_schedule(use)
        with monkeypatch.context() as args_patch:
            _checkpoint_arguments_spy(args_patch)
            args=train_model_module._build_training_args(use.payload,tmp_path,_protected_use=use)
        _install_checkpoint_trainer(monkeypatch,(1,));changed=[]
        def after_state():
            slot=use._final_result_slot
            if slot is None or changed:return
            changed.append((slot,use._training_slot,len(kernel.calls)))
            if failure=="permission":control.current=False
            elif failure=="history":use._training_slot["files"]=None
            elif failure=="checkpoint":use._checkpoint_slot=None
            elif failure=="final-slot":use._final_result_slot=None
            elif failure=="model":use._embedding_model=object()
            elif failure=="helper":
                monkeypatch.setattr(train_model_module,"_capture_protected_training_metadata",
                    lambda *a,**k:pytest.fail("Replacement metadata supplier ran"))
            elif failure=="child-proof":slot["export"]._checkpoint_export_binding=None
            elif failure=="reentry":
                with pytest.raises(ValueError):train_model_module._finalize_protected_training_result(use)
            elif failure=="write-error":kernel.fail="WriteFile"
            else:use._training_slot["checkpoint_execution"]["saved"][0][2].records[0]["sha256"]="0"*64
        model.after_state=after_state
        with pytest.raises((ValueError,actual.LaunchUnavailable)):
            train_model_module._run_trainer(model,tokenizer,{"train":[{}]},None,args,_protected_use=use)
        assert len(changed)==1 and changed[0][0]["stage"]=="failed" and changed[0][1]["stage"]=="failed"
        assert family.phase=="failed"
        assert control.charges==[128*1024]*(2 if failure=="write-error" else 1)
        # Failed families deliberately expose no usable output inventory.
        with pytest.raises(actual.LaunchUnavailable):actual._output_family_snapshot(family)
        first=changed[0][1]["checkpoint_execution"]["saved"][0][2]
        assert first.physical_path+"\\training-run.json" in kernel.nodes
        if failure!="write-error":
            assert not any(name=="WriteFile" for name,_ in kernel.calls[changed[0][2]:])
        before=len(kernel.calls);charges=list(control.charges)
        with pytest.raises(ValueError):train_model_module._finalize_protected_training_result(use)
        assert len(kernel.calls)==before and control.charges==charges


def test_final_training_result_rechecks_after_last_native_proof_before_write(monkeypatch,tmp_path):
    with _checkpoint_schedule_fixture(monkeypatch) as (actual,use,model,tokenizer,family,control,kernel,Tensor):
        train_model_module._bind_protected_checkpoint_schedule(use)
        with monkeypatch.context() as args_patch:
            _checkpoint_arguments_spy(args_patch)
            args=train_model_module._build_training_args(use.payload,tmp_path,_protected_use=use)
        _install_checkpoint_trainer(monkeypatch,(1,));changed=[]
        def after(name):
            slot=use._final_result_slot
            if changed or type(slot) is not dict or slot["stage"]!="writing":return
            child=slot["export"];output=child._output_slot
            graph=output.get("graph") if type(output) is dict else None
            if graph is None or output["stage"]!="writing":return
            native=flat=chunk=False;frame=sys._getframe(1)
            while frame:
                if frame.f_locals.get("self") is graph:
                    native|=frame.f_code is actual.OriginalTrainingOutputGraph.guard.__code__
                    flat|=frame.f_code is actual._OriginalProtectedFlatCopy.guard.__code__
                    if frame.f_code is actual.OriginalTrainingOutputGraph.prepare.__code__:
                        chunk|=type(frame.f_locals.get("chunk")) is bytes and frame.f_locals.get("copied")==0
                frame=frame.f_back
            if native and not flat and chunk:
                changed.append((slot,use._training_slot,len(kernel.calls)))
                use._checkpoint_slot=None
        kernel.after=after
        with pytest.raises((ValueError,actual.LaunchUnavailable)):
            train_model_module._run_trainer(model,tokenizer,{"train":[{}]},None,args,_protected_use=use)
        assert len(changed)==1 and not any(name=="WriteFile" for name,_ in kernel.calls[changed[0][2]:])
        assert family.phase=="failed" and changed[0][0]["stage"]=="failed" and changed[0][1]["stage"]=="failed"
        assert control.charges==[128*1024]*2


@pytest.mark.parametrize("failure",["missing-save","out-of-order","duplicate","wrong-model","foreign-receiver",
    "path-writer","revoked","erased-binding","reentry","write-error","caught-write-error","replaced-dispatch","erased-export-guard"])
def test_checkpoint_handler_refuses_failed_or_missing_snapshots_without_retry(monkeypatch,tmp_path,failure):
    with _checkpoint_schedule_fixture(monkeypatch,maximum=3,interval=2,retention=2,outputs=3) as (actual,use,model,tokenizer,family,control,kernel,Tensor):
        train_model_module._bind_protected_checkpoint_schedule(use)
        with monkeypatch.context() as args_patch:
            _checkpoint_arguments_spy(args_patch)
            args=train_model_module._build_training_args(use.payload,tmp_path,_protected_use=use)
        def during(trainer,step):
            if failure=="wrong-model":trainer.model=object()
            elif failure=="foreign-receiver":
                with pytest.raises(ValueError):type(trainer)._save_checkpoint(object(),model,None)
                assert family.phase=="bound"
                trainer.state.global_step=99
            elif failure=="path-writer":trainer.save_model("forbidden")
            elif failure=="revoked":control.current=False
            elif failure=="erased-binding":use._checkpoint_slot=None
            elif failure in ("write-error","caught-write-error"):kernel.fail="WriteFile"
            elif failure=="replaced-dispatch":trainer._save_checkpoint=lambda *args:pytest.fail("Replaced dispatch called")
            elif failure in ("reentry","erased-export-guard"):
                def after():
                    if failure=="reentry":
                        with pytest.raises(ValueError):trainer._save_checkpoint(model,None)
                    else:use._training_slot["checkpoint_execution"]["active"]._checkpoint_export_guard=None
                model.after_state=after
        steps=() if failure=="missing-save" else (3,) if failure=="out-of-order" else (2,2) if failure=="duplicate" else (2,3)
        calls,objects,disk=_install_checkpoint_trainer(monkeypatch,steps,during=during,catch=failure=="caught-write-error")
        if failure=="replaced-dispatch":
            # Catch the replacement before the fake SDK tries dispatch, just as
            # the real task's progress/currentness fence does at each handoff.
            model.after_state=lambda:pytest.fail("No state supplier should run")
            original=objects
            def progress(_):
                if original:original[0]._save_checkpoint=lambda *args:pytest.fail("Replaced dispatch called")
            options={"on_progress":progress}
        else:options={}
        with pytest.raises((ValueError,actual.LaunchUnavailable)):
            train_model_module._run_trainer(model,tokenizer,{"train":[{}]},None,args,_protected_use=use,**options)
        assert family.phase=="failed" and use._training_slot["stage"]=="failed" and disk==[]
        execution=use._training_slot["checkpoint_execution"]
        assert len(execution["exports"])==(1 if failure in ("duplicate","reentry","write-error","caught-write-error","erased-export-guard") else 0)
        assert control.charges==([128*1024] if failure in ("duplicate","write-error","caught-write-error") else [])
        assert objects[0].test_steps==([] if failure in ("missing-save","replaced-dispatch") else [2,2] if failure=="duplicate" else [3] if failure=="out-of-order" else [2,3] if failure=="caught-write-error" else [2])
        before=len(kernel.calls);charges=list(control.charges)
        with pytest.raises(ValueError):train_model_module._run_trainer(model,tokenizer,{"train":[{}]},None,args,_protected_use=use)
        assert len(kernel.calls)==before and control.charges==charges
        assert calls==(["construct"] if failure=="replaced-dispatch" else ["construct","train"])


def test_checkpoint_handler_rechecks_parent_passively_after_final_native_proof(monkeypatch,tmp_path):
    with _checkpoint_schedule_fixture(monkeypatch) as (actual,use,model,tokenizer,family,control,kernel,Tensor):
        train_model_module._bind_protected_checkpoint_schedule(use)
        with monkeypatch.context() as args_patch:
            _checkpoint_arguments_spy(args_patch)
            args=train_model_module._build_training_args(use.payload,tmp_path,_protected_use=use)
        _install_checkpoint_trainer(monkeypatch,(1,));changed=[]
        def after(name):
            training=use._training_slot
            execution=training.get("checkpoint_execution") if type(training) is dict else None
            child=execution.get("active") if type(execution) is dict else None
            output=child._output_slot if child is not None else None
            graph=output.get("graph") if type(output) is dict else None
            if changed or graph is None or output["stage"]!="writing":return
            native=flat=chunk=False;frame=sys._getframe(1)
            while frame:
                if frame.f_locals.get("self") is graph:
                    native|=frame.f_code is actual.OriginalTrainingOutputGraph.guard.__code__
                    flat|=frame.f_code is actual._OriginalProtectedFlatCopy.guard.__code__
                    if frame.f_code is actual.OriginalTrainingOutputGraph.prepare.__code__:
                        chunk|=type(frame.f_locals.get("chunk")) is bytes and frame.f_locals.get("copied")==0
                frame=frame.f_back
            if native and not flat and chunk:
                changed.append((name,len(kernel.calls),training))
                use._checkpoint_slot=None
        kernel.after=after
        with pytest.raises((ValueError,actual.LaunchUnavailable)):
            train_model_module._run_trainer(model,tokenizer,{"train":[{}]},None,args,_protected_use=use)
        assert len(changed)==1
        assert not any(name=="WriteFile" for name,_ in kernel.calls[changed[0][1]:])
        assert family.phase=="failed" and changed[0][2]["stage"]=="failed" and control.charges==[128*1024]


def test_checkpoint_export_registration_does_not_retain_a_retired_cycle():
    from weakref import ref
    def owned_cycle():
        child=object.__new__(train_model_module._ProtectedTrainingUse)
        proof=train_model_module._CheckpointExport(lambda:child,lambda:child)
        child._checkpoint_export_binding=proof;child._checkpoint_export_guard=proof.current
        train_model_module._CHECKPOINT_EXPORTS[child]=ref(proof)
        with pytest.raises(ValueError,match="immutable"):proof.current=lambda:None
        return ref(child),ref(proof)
    child,proof=owned_cycle();gc.collect()
    assert child() is None and proof() is None


def test_checkpoint_export_cannot_replace_native_authority_with_an_unregistered_guard(monkeypatch):
    with _checkpoint_schedule_fixture(monkeypatch) as (_,use,_,_,family,control,kernel,Tensor):
        use._checkpoint_export_guard=lambda:pytest.fail("Unregistered guard ran")
        before=len(kernel.calls)
        with pytest.raises(ValueError,match="checkpoint export"):
            train_model_module._check_protected_use(use)
        assert len(kernel.calls)==before and control.charges==[] and Tensor.copies==[] and family.phase=="bound"


@pytest.mark.parametrize("failure",["interval","maximum","retention","snapshot"])
def test_checkpoint_schedule_drift_denies_before_sdk_argument_construction(monkeypatch,tmp_path,failure):
    with _checkpoint_schedule_fixture(monkeypatch) as (_,use,_,_,_,control,_,Tensor):
        train_model_module._bind_protected_checkpoint_schedule(use)
        slot=use._checkpoint_slot
        slot[{"interval":"interval","maximum":"maximum_steps","retention":"retention","snapshot":"snapshot"}[failure]]=(
            (lambda:None) if failure=="snapshot" else 999)
        with monkeypatch.context() as sdk_patch:
            constructed,disk=_checkpoint_arguments_spy(sdk_patch)
            with pytest.raises(ValueError):train_model_module._build_training_args(use.payload,tmp_path,_protected_use=use)
            assert constructed==[] and disk==[]
        assert control.charges==[] and Tensor.copies==[]


def test_forged_ready_checkpoint_record_cannot_construct_sdk_arguments(monkeypatch,tmp_path):
    with _checkpoint_schedule_fixture(monkeypatch,family=False) as (_,use,*_):
        use._checkpoint_slot={"stage":"ready","family":None,"snapshot":lambda:None}
        with monkeypatch.context() as sdk_patch:
            constructed,disk=_checkpoint_arguments_spy(sdk_patch)
            with pytest.raises(ValueError):train_model_module._build_training_args(use.payload,tmp_path,_protected_use=use)
            assert constructed==[] and disk==[]


def test_erased_checkpoint_record_before_arguments_cannot_restore_ordinary_sdk_saving(monkeypatch,tmp_path):
    with _checkpoint_schedule_fixture(monkeypatch) as (_,use,_,_,family,control,_,Tensor):
        train_model_module._bind_protected_checkpoint_schedule(use)
        original=use._checkpoint_slot;use._checkpoint_slot=None
        with monkeypatch.context() as sdk_patch:
            constructed,disk=_checkpoint_arguments_spy(sdk_patch)
            with pytest.raises(ValueError):train_model_module._build_training_args(use.payload,tmp_path,_protected_use=use)
            assert constructed==[] and disk==[]
        assert original["stage"]=="failed" and family.phase=="failed"
        assert control.charges==[] and Tensor.copies==[]


def test_checkpoint_preconstructor_failure_cannot_leave_a_native_member_available(monkeypatch,tmp_path):
    with _checkpoint_schedule_fixture(monkeypatch) as (actual,use,model,_,family,control,kernel,Tensor):
        train_model_module._bind_protected_checkpoint_schedule(use)
        first=family.next_configuration
        def cuda_probe():
            use._checkpoint_family_claim=lambda *a:pytest.fail("Replacement helper")
            return False
        with monkeypatch.context() as sdk_patch:
            constructed,disk=_checkpoint_arguments_spy(sdk_patch)
            sys.modules["torch"].cuda.is_available=cuda_probe
            with pytest.raises(ValueError):train_model_module._build_training_args(use.payload,tmp_path,_protected_use=use)
            assert constructed==[] and disk==[]
        assert use._checkpoint_slot["stage"]=="failed" and family.phase=="failed"
        before=len(kernel.calls)
        with pytest.raises(actual.LaunchUnavailable):
            actual.OriginalTrainingOutputGraph(use.view,use.payload.model_dump(mode="json"),first,
                model.test_output[3],control,control,_family=family)
        assert not any(name in ("NtCreateFile","WriteFile","NtSetSecurityObject") for name,_ in kernel.calls[before:])
        assert control.charges==[] and Tensor.copies==[]


@pytest.mark.parametrize("failure",["replaced-ready-record","changed-save-property"])
def test_checkpoint_duplicate_precondition_does_not_accept_forged_ready_proof(monkeypatch,tmp_path,failure):
    with _checkpoint_schedule_fixture(monkeypatch) as (actual,use,_,_,family,control,_,Tensor):
        train_model_module._bind_protected_checkpoint_schedule(use);original=use._checkpoint_slot
        with monkeypatch.context() as sdk_patch:
            constructed,disk=_checkpoint_arguments_spy(sdk_patch)
            args=train_model_module._build_training_args(use.payload,tmp_path,_protected_use=use)
            if failure=="replaced-ready-record":use._checkpoint_slot=dict(original)
            else:type(args).should_save=property(lambda _:True)
            with pytest.raises((ValueError,actual.LaunchUnavailable)):
                train_model_module._build_training_args(use.payload,tmp_path,_protected_use=use)
            assert len(constructed)==1 and disk==[]
        assert original["stage"]=="failed" and family.phase=="failed"
        assert control.charges==[] and Tensor.copies==[]


def test_foreign_use_cannot_fail_another_owners_shared_checkpoint_binding(monkeypatch,tmp_path):
    with _checkpoint_schedule_fixture(monkeypatch) as (actual,use,_,_,family,control,_,Tensor):
        train_model_module._bind_protected_checkpoint_schedule(use);original=use._checkpoint_slot
        other=train_model_module._ProtectedTrainingUse(use.payload,use.view)
        other._checkpoint_slot=original  # A real record is not another use's authority.
        with monkeypatch.context() as sdk_patch:
            constructed,disk=_checkpoint_arguments_spy(sdk_patch)
            with pytest.raises((ValueError,actual.LaunchUnavailable)):
                train_model_module._build_training_args(use.payload,tmp_path,_protected_use=other)
            assert constructed==[] and disk==[]
            assert original["stage"]=="ready" and family.phase=="bound"
            args=train_model_module._build_training_args(use.payload,tmp_path,_protected_use=use)
            assert args.should_save is False and len(constructed)==1 and disk==[]
        assert control.charges==[] and Tensor.copies==[]


def test_foreign_reentry_cannot_fail_the_original_argument_constructor(monkeypatch,tmp_path):
    with _checkpoint_schedule_fixture(monkeypatch) as (_,use,_,_,family,control,_,Tensor):
        train_model_module._bind_protected_checkpoint_schedule(use);original=use._checkpoint_slot
        other=train_model_module._ProtectedTrainingUse(use.payload,use.view)
        other._checkpoint_slot=original
        def during(_):
            with pytest.raises(ValueError):train_model_module._bind_protected_checkpoint_schedule(other)
            assert original["stage"]=="arguments-constructing" and family.phase=="bound"
        with monkeypatch.context() as sdk_patch:
            constructed,disk=_checkpoint_arguments_spy(sdk_patch,during=during)
            args=train_model_module._build_training_args(use.payload,tmp_path,_protected_use=use)
            assert args.should_save is False and len(constructed)==1 and disk==[]
        assert original["stage"]=="arguments-ready" and family.phase=="bound"
        assert control.charges==[] and Tensor.copies==[]


def test_unbound_ordinary_training_arguments_preserve_sdk_saving_behavior(monkeypatch,tmp_path):
    constructed,disk=_checkpoint_arguments_spy(monkeypatch)
    args=train_model_module._build_training_args(_request(tmp_path),tmp_path)
    assert args.should_save is True and disk==["ordinary-sdk-directory"] and len(constructed)==1
    assert "save_only_model" not in constructed[0] and "save_strategy" not in constructed[0]


@contextmanager
def _protected_tensor_selection_fixture(monkeypatch,method="lora",targets=("q_proj",),output=None):
    from modules.adapters.runtime.python.worker.tests.test_native_training_model_graph import (
        DenseTensorByteAdapterTests,CombinedTrainingInputViewTests,TrainingOutputCustodyTests,TrainingTensorStreamTests)
    sdk_case=DenseTensorByteAdapterTests()
    custody_fixture=TrainingOutputCustodyTests.fixture
    combined_fixture=CombinedTrainingInputViewTests.fixture
    def selected_custody(case,method=method):
        return custody_fixture(case,method=method)
    def selected_inputs(case,prepare=True,method=method,output=None):
        return combined_fixture(case,prepare=prepare,method=method,output=selected_output)
    selected_output=output
    # Prepare the selected method/output through the original fixture once.
    # Previously full/quantized/custom-output cases first prepared and retained
    # an unused LoRA graph, then constructed a second complete native graph.
    with monkeypatch.context() as setup:
        setup.setattr(TrainingOutputCustodyTests,"fixture",selected_custody)
        setup.setattr(CombinedTrainingInputViewTests,"fixture",selected_inputs)
        facts,sdk,Tensor,Device=sdk_case.fixture()
    owned=[facts[:4]]
    actual,_,lease,_,request,control,*_=facts
    assert request["method"]==method
    payload=TrainModelTaskRequest.model_validate(request); calls=[]
    class PeftType(Enum): LORA="LORA"
    class LoraConfig:
        def __init__(self,**options):
            self.target_modules=set(options.get("target_modules",targets))
            self.peft_type=PeftType.LORA; self.bias=options.get("bias","none"); self.use_dora=False
            self.modules_to_save=None; self.trainable_token_indices=None
    class Model:
        def __init__(self):
            self.vocab=10; self.peft_config={"default":LoraConfig()}; self.after_state=None
            base,_=sdk_case.tensor(Tensor,sdk,Device,tag="base")
            adapter,_=sdk_case.tensor(Tensor,sdk,Device,tag="adapter")
            embedding,_=sdk_case.tensor(Tensor,sdk,Device,tag="embedding")
            self.state={"base.weight":base,"layer.lora_A.default.weight":adapter,"embed_tokens.weight":embedding}
        def state_dict(self):
            calls.append("model-state")
            if self.after_state: self.after_state()
            return self.state
        def get_input_embeddings(self): return SimpleNamespace(num_embeddings=self.vocab)
        def resize_token_embeddings(self,size): calls.append(("resize",size)); self.vocab=size
    model=Model(); module=ModuleType("peft")
    model.test_output=facts[6:]
    def get_peft_model_state_dict(original,*,state_dict,adapter_name,unwrap_compiled,save_embedding_layers):
        assert original is model and adapter_name=="default" and unwrap_compiled is False
        assert type(save_embedding_layers) is bool  # Never the SDK's provider-discovering 'auto'.
        calls.append(("adapter-state",save_embedding_layers))
        selected={name.replace(".default",""):tensor for name,tensor in state_dict.items() if "lora_" in name}
        if save_embedding_layers: selected["embed_tokens.weight"]=state_dict["embed_tokens.weight"]
        return selected
    get_peft_model_state_dict.__module__="peft.utils.save_and_load"
    module.get_peft_model_state_dict=get_peft_model_state_dict; module.LoraConfig=LoraConfig; module.PeftType=PeftType
    monkeypatch.setitem(sys.modules,"peft",module)
    try:
        with lease.borrow(request) as view:
            use=train_model_module._ProtectedTrainingUse(payload,view)
            yield actual,use,model,module,calls,control,Tensor,TrainingTensorStreamTests()
    finally:
        sdk_case.doCleanups()
        # Only these in-memory fixture owners are released, after all ordinary
        # retirement assertions. Production deliberately retains unknown custody
        # until its worker exits; a shared pytest process must not accumulate the
        # fake registries' self-referencing guards and large ABI argument buffers.
        for native,source,original_lease,inputs in owned:
            assert not any(type(binding) is tuple and binding[0] is original_lease for binding in native._model_views.values())
            native._sealed_training_inputs.pop(inputs,None)
            native._model_leases.pop(original_lease,None)
            native._verified_model_receivers.pop(source,None)
            for family,record in list(native._training_output_families.items()):
                if record["lease"] is original_lease:
                    native._training_output_families.pop(family,None)  # This inert fixture only; no real custody is released.
        gc.collect()


@pytest.mark.parametrize("method,resized,targeted",[("full-finetune",False,False),("lora",False,False),
    ("lora",True,False),("lora",False,True),("qlora",False,False)])
def test_protected_tensor_selection_preserves_full_adapter_and_embedding_weights(monkeypatch,method,resized,targeted):
    with _protected_tensor_selection_fixture(monkeypatch,method,targets=("model.embed_tokens",) if targeted else ("q_proj",)) as facts:
        actual,use,model,module,calls,control,Tensor,oracle=facts
        class Tokenizer:
            def __len__(self): return 12 if resized and model.vocab==10 else model.vocab
        train_model_module._synchronize_model_token_embeddings(model,Tokenizer(),_protected_use=use)
        if resized:
            assert use._embedding_status=="resized"
            train_model_module._synchronize_model_token_embeddings(model,Tokenizer(),_protected_use=use)
            assert use._embedding_status=="resized"  # A later no-op cannot erase actual resizing.
        else: assert use._embedding_status=="unchanged"
        assert Tensor.copies==[]
        stream=train_model_module._capture_protected_training_tensor_stream(model,use,maximum_bytes=65536,chunk_bytes=4096)
        assert Tensor.copies==[]
        raw=b"".join(stream); header,body=oracle.decode(raw)
        if method=="full-finetune":
            assert set(header)==set(model.state) and not any(isinstance(row,tuple) and row[0]=="adapter-state" for row in calls)
        else:
            expected={"layer.lora_A.weight"}|({"embed_tokens.weight"} if resized or targeted else set())
            assert set(header)==expected and ("adapter-state",resized or targeted) in calls
            assert "base.weight" not in header
        assert stream.phase=="complete" and len(raw)==stream.size_bytes
        assert use._tensor_selection_slot["stage"]=="captured"
        before=list(calls)
        with pytest.raises(ValueError,match="private trained tensor export"):
            train_model_module._capture_protected_training_tensor_stream(model,use,maximum_bytes=65536,chunk_bytes=4096)
        assert calls==before


@pytest.mark.parametrize("mode",["unknown-embedding","missing-peft","unknown-getter","extra-adapter","unknown-targets","empty-state","wide-state","state-error","getter-error","empty-selected","wide-selected","foreign-selected"])
def test_protected_tensor_selection_refuses_unknown_state_without_transfer_or_retry(monkeypatch,mode):
    with _protected_tensor_selection_fixture(monkeypatch) as facts:
        actual,use,model,module,calls,control,Tensor,oracle=facts
        class Tokenizer:
            def __len__(self): return 10
        if mode!="unknown-embedding": train_model_module._synchronize_model_token_embeddings(model,Tokenizer(),_protected_use=use)
        if mode=="missing-peft": monkeypatch.delitem(sys.modules,"peft")
        elif mode=="unknown-getter": module.get_peft_model_state_dict=lambda *a,**k: pytest.fail("Unknown exporter selected")
        elif mode=="extra-adapter": model.peft_config["foreign"]=model.peft_config["default"]
        elif mode=="unknown-targets": model.peft_config["default"].target_modules="provider-selected-regex"
        elif mode=="empty-state": model.state={}
        elif mode=="wide-state": model.state={str(i):None for i in range(4097)}
        elif mode=="state-error": model.after_state=lambda: (_ for _ in ()).throw(RuntimeError("private supplier details"))
        elif mode in ("getter-error","empty-selected","wide-selected","foreign-selected"):
            def bad_getter(*args,**options):
                assert type(options["save_embedding_layers"]) is bool
                if mode=="getter-error": raise RuntimeError("private supplier details")
                if mode=="empty-selected": return {}
                if mode=="wide-selected": return {str(i):None for i in range(4097)}
                class Foreign(dict): pass
                return Foreign()
            bad_getter.__module__="peft.utils.save_and_load"; module.get_peft_model_state_dict=bad_getter
        with pytest.raises(ValueError) as caught:
            train_model_module._capture_protected_training_tensor_stream(model,use,maximum_bytes=65536,chunk_bytes=4096)
        assert "private supplier" not in str(caught.value) and Tensor.copies==[]
        assert use._tensor_selection_slot["stage"]=="failed"
        before=list(calls)
        with pytest.raises(ValueError): train_model_module._capture_protected_training_tensor_stream(model,use,maximum_bytes=65536,chunk_bytes=4096)
        assert calls==before


@pytest.mark.parametrize("mode",["withdraw","settings","replace-getter","embedding-observation","model-binding","target-settings"])
def test_protected_tensor_selection_rechecks_callbacks_and_captures_original_getter(monkeypatch,mode):
    with _protected_tensor_selection_fixture(monkeypatch) as facts:
        actual,use,model,module,calls,control,Tensor,oracle=facts
        class Tokenizer:
            def __len__(self): return 10
        train_model_module._synchronize_model_token_embeddings(model,Tokenizer(),_protected_use=use)
        def after_state():
            if mode=="withdraw": control.current=False
            elif mode=="settings": use.payload.commonParameters["maxSteps"]=999
            elif mode=="embedding-observation":
                class GrownTokenizer:
                    def __len__(self): return 12
                train_model_module._synchronize_model_token_embeddings(model,GrownTokenizer(),_protected_use=use)
            elif mode=="model-binding": use._embedding_model=object()
            elif mode=="target-settings": model.peft_config["default"].target_modules.add("embed_tokens")
            else: module.get_peft_model_state_dict=lambda *a,**kw: pytest.fail("Replaced getter selected")
        model.after_state=after_state
        if mode=="replace-getter":
            stream=train_model_module._capture_protected_training_tensor_stream(model,use,maximum_bytes=65536,chunk_bytes=4096)
            assert ("adapter-state",False) in calls and "layer.lora_A.weight" in oracle.decode(b"".join(stream))[0]
        else:
            with pytest.raises(ValueError): train_model_module._capture_protected_training_tensor_stream(model,use,maximum_bytes=65536,chunk_bytes=4096)
            assert calls==(["model-state",("resize",12)] if mode=="embedding-observation" else ["model-state"]) and Tensor.copies==[]


def test_protected_embedding_observation_follows_only_the_fixed_lora_wrapper(monkeypatch):
    with _protected_tensor_selection_fixture(monkeypatch) as facts:
        actual,use,base,module,calls,control,Tensor,oracle=facts
        class Tokenizer:
            def __len__(self): return 12
        train_model_module._synchronize_model_token_embeddings(base,Tokenizer(),_protected_use=use)
        assert use._embedding_model is base and use._embedding_status=="resized"
        class Wrapper:
            def __init__(self,configuration): self.peft_config={"default":configuration}
            def state_dict(self): calls.append("wrapped-state"); return base.state
        module.TaskType=SimpleNamespace(CAUSAL_LM="causal")
        module.get_peft_model=lambda original,configuration: Wrapper(configuration)
        wrapped=train_model_module._apply_lora(base,use.payload,_protected_use=use)
        assert use._embedding_model is wrapped and use._embedding_status=="resized"
        def export(original,*,state_dict,adapter_name,unwrap_compiled,save_embedding_layers):
            assert original is wrapped and save_embedding_layers is True
            return {"layer.lora_A.weight":state_dict["layer.lora_A.default.weight"],"embed_tokens.weight":state_dict["embed_tokens.weight"]}
        export.__module__="peft.utils.save_and_load"; module.get_peft_model_state_dict=export
        stream=train_model_module._capture_protected_training_tensor_stream(wrapped,use,maximum_bytes=65536,chunk_bytes=4096)
        assert set(oracle.decode(b"".join(stream))[0])=={"layer.lora_A.weight","embed_tokens.weight"}


@pytest.mark.parametrize("initial_status",["unchanged","resized"])
@pytest.mark.parametrize("failure",["resize","length","get-embeddings"])
def test_protected_embedding_observation_cannot_reuse_uncertain_supplier_result(monkeypatch,initial_status,failure):
    with _protected_tensor_selection_fixture(monkeypatch) as facts:
        actual,use,model,module,calls,control,Tensor,oracle=facts
        class Tokenizer:
            def __len__(self): return 12 if initial_status=="resized" and model.vocab==10 else model.vocab
        train_model_module._synchronize_model_token_embeddings(model,Tokenizer(),_protected_use=use)
        assert use._embedding_status==initial_status
        def fail(*args):
            model.vocab=14
            raise RuntimeError("inert supplier changed model then lost its reply")
        class GrownTokenizer:
            def __len__(self):
                if failure=="length": return fail()
                return 14
        with monkeypatch.context() as changed:
            if failure=="resize": changed.setattr(model,"resize_token_embeddings",fail)
            elif failure=="get-embeddings": changed.setattr(model,"get_input_embeddings",fail)
            if failure=="length":
                train_model_module._synchronize_model_token_embeddings(model,GrownTokenizer(),_protected_use=use)
            else:
                with pytest.raises(RuntimeError):
                    train_model_module._synchronize_model_token_embeddings(model,GrownTokenizer(),_protected_use=use)
        assert use._embedding_status=="unknown" and use._embedding_observation_lost
        # Restoring supplier methods or matching the new vocabulary is no proof
        # about the uncertain mutation. Neither a no-op nor export may recover it.
        with pytest.raises(ValueError):
            train_model_module._synchronize_model_token_embeddings(model,Tokenizer(),_protected_use=use)
        with pytest.raises(ValueError):
            train_model_module._capture_protected_training_tensor_stream(model,use,maximum_bytes=65536,chunk_bytes=4096)
        assert Tensor.copies==[] and not any(isinstance(row,tuple) and row[0]=="adapter-state" for row in calls)


@pytest.mark.parametrize("field,value",[("bias","all"),("use_dora",True),("peft_type","ADALORA"),
    ("modules_to_save",["lm_head"]),("trainable_token_indices",[1])])
@pytest.mark.parametrize("during_state",[False,True])
def test_protected_tensor_selection_keeps_fixed_adapter_policy(monkeypatch,field,value,during_state):
    with _protected_tensor_selection_fixture(monkeypatch) as facts:
        actual,use,model,module,calls,control,Tensor,oracle=facts
        class Tokenizer:
            def __len__(self): return 10
        train_model_module._synchronize_model_token_embeddings(model,Tokenizer(),_protected_use=use)
        config=model.peft_config["default"]
        if during_state: model.after_state=lambda: setattr(config,field,value)
        else: setattr(config,field,value)
        with pytest.raises(ValueError):
            train_model_module._capture_protected_training_tensor_stream(model,use,maximum_bytes=65536,chunk_bytes=4096)
        assert calls==(["model-state"] if during_state else []) and Tensor.copies==[]


@pytest.mark.parametrize("replacement",["mapping","default"])
def test_protected_tensor_selection_rechecks_actual_config_after_last_view_observer(monkeypatch,replacement):
    with _protected_tensor_selection_fixture(monkeypatch) as facts:
        actual,use,model,module,calls,control,Tensor,oracle=facts
        class Tokenizer:
            def __len__(self): return 10
        train_model_module._synchronize_model_token_embeddings(model,Tokenizer(),_protected_use=use)
        original=model.peft_config; foreign=module.LoraConfig(); foreign.bias="all"; changed=[]
        def current(obj):
            slot=use._tensor_selection_slot
            if obj is control and not changed and slot is not None and slot["stream"] is not None:
                changed.append(True)
                if replacement=="mapping": model.peft_config={"default":foreign}
                else: original["default"]=foreign
            return obj.__dict__["current"]
        monkeypatch.setattr(type(control),"current",property(current,lambda obj,value: obj.__dict__.__setitem__("current",value)),raising=False)
        with pytest.raises(ValueError):
            train_model_module._capture_protected_training_tensor_stream(model,use,maximum_bytes=65536,chunk_bytes=4096)
        assert changed==[True] and Tensor.copies==[] and use._tensor_selection_slot["stage"]=="failed"


@pytest.mark.parametrize("mode",["different-model","foreign-method","free-function"])
def test_protected_selection_cannot_borrow_another_model_or_method_receiver(monkeypatch,mode):
    with _protected_tensor_selection_fixture(monkeypatch) as facts:
        actual,use,model,module,calls,control,Tensor,oracle=facts
        class Tokenizer:
            def __len__(self): return 10
        train_model_module._synchronize_model_token_embeddings(model,Tokenizer(),_protected_use=use)
        other=type(model)()
        if mode=="different-model": selected=other
        else:
            selected=model
            model.state_dict=other.state_dict if mode=="foreign-method" else lambda: pytest.fail("Free state callback selected")
        with pytest.raises(ValueError): train_model_module._capture_protected_training_tensor_stream(selected,use,maximum_bytes=65536,chunk_bytes=4096)
        assert calls==[] and Tensor.copies==[] and use._tensor_selection_slot["stage"]=="failed"


@contextmanager
def _protected_training_metadata_fixture(monkeypatch,method="lora",output=None,only_one_weight=False,*,capture_weights=True):
    with _protected_tensor_selection_fixture(monkeypatch,method,output=output) as facts:
        actual,use,model,peft,calls,control,Tensor,oracle=facts
        module=ModuleType("tokenizers"); metadata_calls=[]
        class AddedToken:
            def __init__(self,content): self.content=content
            def __getstate__(self):
                metadata_calls.append("token-state")
                return {"content":self.content,"single_word":False,"lstrip":True,"rstrip":False,"normalized":False,"special":True}
        class Backend:
            def __init__(self): self.raw='{"version":"1.0","added_tokens":[{"id":10,"content":"<pad>","special":true}],"model":{"type":"WordLevel","vocab":{"sample":0,"<pad>":10}}}'; self.after_export=None
            def to_str(self,*,pretty):
                assert pretty is False; metadata_calls.append("backend-json")
                result=self.raw
                if self.after_export: self.after_export()
                return result
        module.Tokenizer=Backend;module.AddedToken=AddedToken
        monkeypatch.setitem(sys.modules,"tokenizers",module)
        class Config:
            def __init__(self,values): self.values=values;self.after_export=None
            def to_dict(self):
                metadata_calls.append("config-dict"); result=dict(self.values)
                if self.after_export: self.after_export()
                return result
        class SyntheticTokenizerFast:
            def __init__(self):
                self.backend_tokenizer=Backend(); self.model_max_length=10**30; self.clean_up_tokenization_spaces=False
                self.padding_side="left"; self.chat_template={"default":"{{ messages }}","alternate":"{{ tools }}"}
                self.pad=AddedToken("<pad>"); self.special_tokens_map={"pad_token":"<pad>"}
                self.special_tokens_map_extended={"pad_token":self.pad}; self.extra_special_tokens={"image_token":"<image>"}
                self.added_tokens_decoder={10:self.pad}; self.init_inputs=("synthetic",)
                self.init_kwargs={"padding_side":"right","pad_token":self.pad,"custom_token":self.pad,"name_or_path":"X:\\private\\stage",
                    "tokenizer_file":"X:\\private\\stage\\tokenizer.json","nested":{"_name_or_path":"X:\\private\\stage"}}
                self.vocab_files_names={"vocab_file":"vocab.json","merges_file":"merges.txt","tokenizer_file":"tokenizer.json"}
                self._auto_class=None; self._auto_map=None; self._processor_class=None
            def __len__(self): return 12
            def save_pretrained(self,*args,**kwargs): pytest.fail("Metadata export invoked a path writer")
        tokenizer=SyntheticTokenizerFast()
        model.config=Config({"model_type":"synthetic","vocab_size":12,"_name_or_path":"X:\\private\\stage","nested":{"_name_or_path":"X:\\private\\stage","retained":True}})
        model.generation_config=Config({"max_new_tokens":8,"_name_or_path":"X:\\private\\stage"})
        if method!="full-finetune":
            configuration=model.peft_config["default"]
            def to_dict(obj): return {**vars(obj),"base_model_name_or_path":"X:\\private\\stage","inference_mode":False}
            monkeypatch.setattr(type(configuration),"to_dict",to_dict,raising=False)
        train_model_module._synchronize_model_token_embeddings(model,tokenizer,_protected_use=use)
        if only_one_weight: model.state={"base.weight":model.state["base.weight"]}
        stream=(train_model_module._capture_protected_training_tensor_stream(model,use,maximum_bytes=65536,chunk_bytes=4096)
            if capture_weights else None)
        yield facts,tokenizer,metadata_calls,stream


@pytest.mark.parametrize("helper",["_protected_output_seal_facts","_sealed_training_checkpoint_facts",
    "_finalize_protected_training_result"])
def test_original_training_use_pins_completion_helpers_before_sdk_suppliers(monkeypatch,helper):
    with _protected_training_metadata_fixture(monkeypatch,capture_weights=False) as (facts,tokenizer,_,_):
        _,use,model,_,_,control,Tensor,_=facts
        kernel=model.test_output[0];called=[]
        def replaced(*args,**kwargs):called.append(True);return ()
        model.after_state=lambda:monkeypatch.setattr(train_model_module,helper,replaced)
        before=len(kernel.calls);charges=list(control.charges);copies=list(Tensor.copies)
        with pytest.raises(ValueError):
            train_model_module._capture_protected_training_tensor_stream(model,use,maximum_bytes=65536,chunk_bytes=4096)
        assert called==[] and control.charges==charges and Tensor.copies==copies
        assert not any(name in ("NtCreateFile","WriteFile") for name,_ in kernel.calls[before:])


def test_completion_helper_guard_never_calls_virtual_equality(monkeypatch,tmp_path):
    use=object.__new__(train_model_module._ProtectedTrainingUse)
    use.payload=_request(tmp_path)
    use._completion_helpers=train_model_module._PROTECTED_COMPLETION_HELPERS
    use._serialize=train_model_module._NATIVE_REQUEST_SERIALIZER
    use._request_stamp=json.dumps(use._serialize(use.payload,mode="json"),sort_keys=True,allow_nan=False,separators=(",",":"))
    callbacks=[]
    class Replacement:
        def __eq__(self,other):callbacks.append("equality");return True
        def __call__(self,*args):callbacks.append("call");return ()
    monkeypatch.setattr(train_model_module,"_sealed_training_checkpoint_facts",Replacement())
    with pytest.raises(ValueError,match="completion helpers"):
        train_model_module._ProtectedTrainingUse.assert_snapshot(use)
    assert callbacks==[]


@pytest.mark.parametrize("method",["full-finetune","lora","qlora"])
def test_protected_training_metadata_preserves_reload_fields_without_path_writes(monkeypatch,method):
    with _protected_training_metadata_fixture(monkeypatch,method) as (facts,tokenizer,metadata_calls,stream):
        actual,use,model,peft,calls,control,Tensor,oracle=facts
        files=train_model_module._capture_protected_training_metadata(model,tokenizer,use,maximum_bytes=65536)
        assert type(files) is tuple and all(type(data) is bytes for _,data in files) and Tensor.copies==[]
        decoded={name:json.loads(data) for name,data in files}
        expected={"tokenizer.json","tokenizer_config.json","special_tokens_map.json"}
        if method=="full-finetune":
            expected|={"config.json","generation_config.json"}
            assert decoded["config.json"]["nested"]=={"retained":True} and decoded["generation_config.json"]=={"max_new_tokens":8}
        else:
            expected.add("adapter_config.json")
            assert decoded["adapter_config.json"]["base_model_name_or_path"]==use.payload.baseModel.modelId
            assert decoded["adapter_config.json"]["inference_mode"] is True
            assert decoded["adapter_config.json"]["target_modules"]==["q_proj"]
        assert set(decoded)==expected and all(b"private" not in data for _,data in files)
        config=decoded["tokenizer_config.json"]
        assert config["padding_side"]=="left" and config["model_max_length"]==10**30
        assert config["extra_special_tokens"]=={"image_token":"<image>"} and config["image_token"]=="<image>"
        assert config["chat_template"]==[{"name":"default","template":"{{ messages }}"},{"name":"alternate","template":"{{ tools }}"}]
        assert config["added_tokens_decoder"]["10"]["lstrip"] is True and config["added_tokens_decoder"]["10"]["special"] is True
        assert config["custom_token"]["__type"]=="AddedToken" and config["custom_token"]["normalized"] is False
        assert config["tokenizer_class"]==type(tokenizer).__name__ and config["init_inputs"]==["synthetic"]
        assert decoded["special_tokens_map.json"]["pad_token"]["content"]=="<pad>"
        assert "special" not in decoded["special_tokens_map.json"]["pad_token"]
        assert decoded["tokenizer.json"]["model"]["vocab"]["<pad>"]==10
        assert metadata_calls.count("backend-json")==2 and use._metadata_slot["stage"]=="captured"
        before=list(metadata_calls)
        with pytest.raises(ValueError): train_model_module._capture_protected_training_metadata(model,tokenizer,use,maximum_bytes=65536)
        assert metadata_calls==before


def test_protected_training_metadata_and_weights_feed_actual_guarded_output_writer(monkeypatch):
    with _protected_training_metadata_fixture(monkeypatch) as (facts,tokenizer,metadata_calls,stream):
        actual,use,model,peft,calls,control,Tensor,oracle=facts
        kernel,configuration,_,_,output_control=model.test_output
        metadata=train_model_module._capture_protected_training_metadata(model,tokenizer,use,maximum_bytes=65536)
        files=[{"name":name,"sizeBytes":len(raw)} for name,raw in metadata]
        files.append({"name":"adapter_model.safetensors","sizeBytes":stream.size_bytes})
        streams={name:(raw,) for name,raw in metadata}; streams["adapter_model.safetensors"]=stream
        request=use.payload.model_dump(mode="json")
        graph=actual.OriginalTrainingOutputGraph(use.view,request,configuration,files,output_control,output_control)
        graph.prepare(streams); graph.assert_sealed()
        assert graph.phase=="sealed" and stream.phase=="complete"
        for row in graph.records:
            node=kernel.nodes[graph.physical_path+"\\"+row["name"]]; raw=bytes(node["data"])
            assert row["sizeBytes"]==len(raw) and row["sha256"]==hashlib.sha256(raw).hexdigest()
            if row["name"]=="adapter_model.safetensors":
                assert set(oracle.decode(raw)[0])=={"layer.lora_A.weight","embed_tokens.weight"}
            else: assert raw==dict(metadata)[row["name"]]
        assert output_control.retained==[] and output_control.charges==[128*1024]
        assert use.payload.model_dump(mode="json")==request


@pytest.mark.parametrize("method,shard_size,only_one_weight",[("lora",None,False),("qlora",None,False),
    ("full-finetune",None,False),("full-finetune","0.048KB",False),("full-finetune","0.001KB",True)])
def test_protected_training_output_driver_seals_exact_original_candidate(monkeypatch,method,shard_size,only_one_weight):
    output={"maxShardSize":shard_size} if shard_size is not None else None
    with _protected_training_metadata_fixture(monkeypatch,method,output,only_one_weight) as (facts,tokenizer,metadata_calls,stream):
        actual,use,model,peft,calls,control,Tensor,oracle=facts
        metadata=train_model_module._capture_protected_training_metadata(model,tokenizer,use,maximum_bytes=65536)
        kernel,configuration,_,_,output_control=model.test_output; request=use.payload.model_dump(mode="json")
        graph=train_model_module._write_protected_training_output(use,configuration=configuration,reservation=output_control,admission=output_control)
        assert type(graph) is use._output_graph_type and graph.phase=="sealed" and stream.phase=="complete"
        assert use._output_slot["stage"]=="sealed" and use._output_slot["graph"] is graph
        weight_name="model.safetensors" if method=="full-finetune" else "adapter_model.safetensors"
        expected={name:raw for name,raw in metadata}
        assert set(row["name"] for row in graph.records)==set(expected)|{weight_name}
        for row in graph.records:
            raw=bytes(kernel.nodes[graph.physical_path+"\\"+row["name"]]["data"])
            assert row["sha256"]==hashlib.sha256(raw).hexdigest() and row["sizeBytes"]==len(raw)
            if row["name"]==weight_name:
                header,body=oracle.decode(raw)
                assert len(body)==stream.tensor_bytes and sum(size for _,size in stream.tensor_sizes)==len(body)
                if only_one_weight: assert set(header)=={"base.weight"} and len(body)>1
            else: assert raw==expected[row["name"]]
        assert use.payload.model_dump(mode="json")==request and output_control.charges==[128*1024]
        assert output_control.retained==[]  # No release/refund/discard is invented.
        before=len(kernel.calls)
        with pytest.raises(ValueError): train_model_module._write_protected_training_output(use,configuration=configuration,reservation=output_control,admission=output_control)
        assert len(kernel.calls)==before


def _install_inert_history_trainer(monkeypatch, *, metrics=None, history=None, during_train=None, failure=None):
    calls=[]; objects=[]
    class Trainer:
        def __init__(self,**options):
            calls.append("construct"); objects.append(self)
            self.options=options
            self.state=SimpleNamespace(log_history=history if history is not None else [{"step":1,"loss":0.25,"ignored":"private fixture"}])
        def train(self):
            calls.append("train")
            if during_train is not None: during_train()
            if failure is not None: raise failure
            return SimpleNamespace(metrics=metrics if metrics is not None else {"train_loss":0.25,"train_runtime":1.0})
        def evaluate(self,*,eval_dataset,metric_key_prefix):
            calls.append(metric_key_prefix)
            return {metric_key_prefix+"_loss":2.0 if metric_key_prefix=="baseline_validation" else 1.25}
    module=ModuleType("transformers"); module.Trainer=Trainer
    module.TrainerCallback=type("TrainerCallback",(),{})
    module.DataCollatorForLanguageModeling=lambda **options: SimpleNamespace(**options)
    monkeypatch.setitem(sys.modules,"transformers",module)
    return calls,objects


@pytest.mark.parametrize("method",["lora","qlora","full-finetune"])
def test_actual_private_trainer_history_is_in_exact_protected_candidate(monkeypatch,method):
    with _protected_training_metadata_fixture(monkeypatch,method,capture_weights=False) as (facts,tokenizer,_,_):
        actual,use,model,_,_,_,_,_=facts
        calls,objects=_install_inert_history_trainer(monkeypatch)
        before=use.payload.model_dump(mode="json")
        args=SimpleNamespace(output_dir="ignored-supplier-path")
        metrics,checkpoints=train_model_module._run_trainer(model,tokenizer,{"train":[1]},None,args,_protected_use=use)
        assert calls==["construct","train"] and use._training_slot["trainer"] is objects[0]
        assert use._training_slot["args"] is args and use._training_slot["stage"]=="complete"
        expected=json.loads(dict(use._training_slot["files"])["training-run.json"])
        assert expected["metrics"]=={"train_loss":0.25,"train_runtime":1.0}
        assert expected["history"]==[{"step":1,"loss":0.25}]
        assert expected["checkpointFilesVerified"] is False and expected["candidateValidation"]=="pending"
        assert expected["status"]=="training-complete" and expected["runId"]==use._run_identity[0]
        assert expected["baseModel"]==before["baseModel"] and expected["datasets"]==before["datasets"]
        # Caller-visible dictionaries cannot rewrite retained observed history.
        metrics["train_loss"]=999; checkpoints[0]["value"]=999
        stream=train_model_module._capture_protected_training_tensor_stream(model,use,maximum_bytes=65536,chunk_bytes=4096)
        package=train_model_module._capture_protected_training_metadata(model,tokenizer,use,maximum_bytes=65536)
        manifest=json.loads(dict(package)["serialization_manifest.json"])
        assert manifest["validation"]["status"]=="unknown" and manifest["validation"]["validationReportPath"] is None
        assert manifest["serialization"]["serializationFormat"]==("safetensors" if method=="full-finetune" else "adapter-safetensors")
        assert json.loads(dict(package)["training-run.json"])==expected
        kernel,configuration,_,_,control=model.test_output
        graph=train_model_module._write_protected_training_output(use,configuration=configuration,reservation=control,admission=control)
        assert graph.phase=="sealed" and stream.phase=="complete"
        for name in ("training-run.json","serialization_manifest.json"):
            raw=bytes(kernel.nodes[graph.physical_path+"\\"+name]["data"])
            assert raw==dict(package)[name]
            record=next(r for r in graph.records if r["name"]==name)
            assert record["sha256"]==hashlib.sha256(raw).hexdigest() and record["sizeBytes"]==len(raw)
        assert use.payload.model_dump(mode="json")==before and control.charges==[128*1024]
        with pytest.raises(ValueError):train_model_module._run_trainer(model,tokenizer,{"train":[1]},None,args,_protected_use=use)
        assert calls==["construct","train"] and use._training_slot["stage"]=="complete"


@pytest.mark.parametrize("method",["lora","qlora","full-finetune"])
def test_fixed_serializer_consumes_original_family_after_a_sealed_checkpoint(monkeypatch,method):
    with _protected_training_metadata_fixture(monkeypatch,method) as (facts,tokenizer,_,stream):
        actual,use,model,_,_,_,_,oracle=facts
        metadata=train_model_module._capture_protected_training_metadata(model,tokenizer,use,maximum_bytes=65536)
        kernel,configuration,_,_,control=model.test_output; request=use.payload.model_dump(mode="json")
        family=actual.OriginalTrainingOutputFamily(use.view,request,{"maximumCopyBytes":256*1024,
            "outputs":[{**configuration,"freshName":"checkpoint-1"},configuration]},control,control)
        # Inert valid container for the already-qualified Native checkpoint slot;
        # actual SDK checkpoint capture/execution is a separate pending workflow.
        weight="model.safetensors" if method=="full-finetune" else "adapter_model.safetensors"
        header=json.dumps({"fixture.weight":{"dtype":"F32","shape":[1],"data_offsets":[0,4]}}).encode();header+=b" "*(-len(header)%8)
        checkpoint={**dict(metadata),weight:len(header).to_bytes(8,"little")+header+b"\0"*4}
        first=actual.OriginalTrainingOutputGraph(use.view,request,family.next_configuration,
            [{"name":name,"sizeBytes":len(raw)} for name,raw in checkpoint.items()],control,control,_family=family)
        first.prepare({name:iter((raw,)) for name,raw in checkpoint.items()})
        graph=train_model_module._write_protected_training_output(use,configuration=family.next_configuration,
            reservation=control,admission=control,_family=family)
        assert family.phase=="sealed" and graph.phase=="sealed" and stream.phase=="complete"
        assert use._output_slot["family"] is family and graph is not first and graph.physical_path != first.physical_path
        assert control.charges==[128*1024]*2 and control.retained==[]
        raw=bytes(kernel.nodes[graph.physical_path+"\\"+weight]["data"]); _,body=oracle.decode(raw)
        assert len(body)==stream.tensor_bytes
        for row in graph.records:
            data=bytes(kernel.nodes[graph.physical_path+"\\"+row["name"]]["data"])
            assert row["sha256"]==hashlib.sha256(data).hexdigest() and row["sizeBytes"]==len(data)
        with pytest.raises(ValueError):train_model_module._write_protected_training_output(use,configuration=configuration,
            reservation=control,admission=control,_family=family)
        assert family.phase=="sealed" and control.charges==[128*1024]*2


@pytest.mark.parametrize("method",["full-finetune","lora","qlora"])
def test_fixed_family_output_opens_in_installed_safe_readers(monkeypatch,tmp_path,method):
    # Real format consumers, not the fixture's decoder. No model is loaded.
    from safetensors import SafetensorError, safe_open
    from tokenizers import AddedToken, Tokenizer, models
    backend=Tokenizer(models.WordLevel(
        vocab={"<unk>":0,**{f"word-{i}":i for i in range(1,10)},"<pad>":10,"<image>":11},
        unk_token="<unk>"))
    backend.add_special_tokens([AddedToken("<pad>",normalized=False,special=True)])
    backend_json=backend.to_str()
    missing=object(); original_torch=sys.modules.get("torch",missing)
    original_tokenizers=sys.modules["tokenizers"]
    with monkeypatch.context() as fixture_patch:
        with _protected_training_metadata_fixture(fixture_patch,method) as (facts,tokenizer,_,stream):
            actual,use,model,_,_,_,Tensor,_=facts
            # The synthetic producer supplies genuine SDK-generated backend JSON.
            # Ownership, metadata export and all actual Native writer code stay real.
            tokenizer.backend_tokenizer.raw=backend_json
            train_model_module._capture_protected_training_metadata(model,tokenizer,use,maximum_bytes=65536)
            kernel,configuration,_,_,control=model.test_output
            family=actual.OriginalTrainingOutputFamily(use.view,use.payload.model_dump(mode="json"),
                {"maximumCopyBytes":128*1024,"outputs":[configuration]},control,control)
            graph=train_model_module._write_protected_training_output(use,configuration=configuration,
                reservation=control,admission=control,_family=family)
            assert graph.phase=="sealed" and family.phase=="sealed" and control.charges==[128*1024]
            emitted={row["name"]:bytes(kernel.nodes[graph.physical_path+"\\"+row["name"]]["data"])
                for row in graph.records}
            assert sum(len(raw) for raw in emitted.values())<=128*1024
            assert stream.phase=="complete" and Tensor.copies
    # Restore all inert modules before the installed readers import dependencies.
    assert sys.modules.get("torch",missing) is original_torch
    assert sys.modules["tokenizers"] is original_tokenizers
    for name,raw in emitted.items():
        assert "/" not in name and "\\" not in name
        (tmp_path/name).write_bytes(raw)  # Only this disposable pytest directory.
    weight="model.safetensors" if method=="full-finetune" else "adapter_model.safetensors"
    expected=({"base.weight","layer.lora_A.default.weight","embed_tokens.weight"}
        if method=="full-finetune" else {"layer.lora_A.weight","embed_tokens.weight"})
    with safe_open(str(tmp_path/weight),framework="np") as result:
        assert set(result.keys())==expected
        for key in expected:
            tensor=result.get_tensor(key)
            assert tensor.shape==(4,) and tensor.dtype.name=="float32"
            assert tensor.tolist()==[0.0,1.0,2.0,3.0]
    restored=Tokenizer.from_file(str(tmp_path/"tokenizer.json"))
    assert restored.get_vocab_size(with_added_tokens=True)==12
    assert restored.token_to_id("<pad>")==10 and restored.token_to_id("<image>")==11
    assert restored.encode("word-1").ids==[1]
    config=json.loads(emitted["tokenizer_config.json"])
    assert config["padding_side"]=="left" and config["model_max_length"]==10**30
    assert config["extra_special_tokens"]=={"image_token":"<image>"}
    assert all(b"X:\\private" not in raw for name,raw in emitted.items() if name.endswith(".json"))
    # The official parser must reject truncated output; no tolerant fallback.
    truncated=tmp_path/"truncated.safetensors"
    truncated.write_bytes(emitted[weight][:-1])
    with pytest.raises(SafetensorError):
        with safe_open(str(truncated),framework="np"):pass


@pytest.mark.parametrize("field,values",[("id2label",{0:"negative",1:"positive"}),("pruned_heads",{0:[1],2:[3]}),
    ("id2label",{"0":"negative",1:"positive"}),("id2label",{2**53-1:"bounded"})])
def test_protected_metadata_keeps_standard_model_integer_index_maps(monkeypatch,field,values):
    with _protected_training_metadata_fixture(monkeypatch,"full-finetune") as (facts,tokenizer,_,_):
        _,use,model,*_=facts
        model.config.values[field]=values
        files=train_model_module._capture_protected_training_metadata(model,tokenizer,use,maximum_bytes=65536)
        configuration=json.loads(dict(files)["config.json"])
        assert configuration[field]=={str(key):value for key,value in values.items()}


@pytest.mark.parametrize("failure",["boolean","float","negative","oversized","collision","custom-key","unknown-map","generation-map"])
def test_protected_metadata_denies_ambiguous_or_unknown_integer_maps(monkeypatch,failure):
    with _protected_training_metadata_fixture(monkeypatch,"full-finetune") as (facts,tokenizer,_,_):
        _,use,model,_,_,_,Tensor,_=facts
        class CustomKey:
            def __str__(self):pytest.fail("Metadata keys must not use arbitrary string conversion")
        keys={"boolean":True,"float":0.5,"negative":-1,"oversized":2**53,"custom-key":CustomKey()}
        if failure=="collision":model.config.values["id2label"]={0:"first","0":"second"}
        elif failure=="unknown-map":model.config.values["custom_map"]={0:"unsupported"}
        elif failure=="generation-map":model.generation_config.values["sequence_bias"]={(1,2):1.0}
        else:model.config.values["id2label"]={keys[failure]:"unsupported"}
        with pytest.raises(ValueError,match="private trained metadata export"):
            train_model_module._capture_protected_training_metadata(model,tokenizer,use,maximum_bytes=65536)
        assert use._metadata_slot["stage"]=="failed" and Tensor.copies==[]


@pytest.mark.parametrize("failure",["forged","wrong-namespace","wrong-controls","missing-metadata","native-write","helper-changed","late-helper"])
def test_fixed_family_serializer_failure_keeps_ownership_and_freezes_new_outputs(monkeypatch,failure):
    with _protected_training_metadata_fixture(monkeypatch) as (facts,tokenizer,_,stream):
        actual,use,model,_,_,_,Tensor,_=facts
        if failure!="missing-metadata":train_model_module._capture_protected_training_metadata(model,tokenizer,use,maximum_bytes=65536)
        kernel,configuration,_,_,control=model.test_output
        family=actual.OriginalTrainingOutputFamily(use.view,use.payload.model_dump(mode="json"),
            {"maximumCopyBytes":256*1024,"outputs":[configuration,{**configuration,"freshName":"later"}]},control,control)
        selected=family; supplied=dict(configuration); reservation=control
        if failure=="forged":selected=object.__new__(actual.OriginalTrainingOutputFamily)
        elif failure=="wrong-namespace":supplied["freshName"]="unplanned"
        elif failure=="wrong-controls":reservation=type(control)()
        elif failure=="native-write":kernel.fail="WriteFile"
        elif failure=="helper-changed":use._output_family_fail=lambda _:pytest.fail("Caller-selected invalidator")
        elif failure=="late-helper":
            changed=[]
            def during(obj):
                if obj is control and use._output_slot is not None and not changed:
                    changed.append(True);use._output_family_snapshot=lambda _:pytest.fail("Caller-selected family reader")
                return obj.__dict__["current"]
            monkeypatch.setattr(type(control),"current",property(during,lambda obj,value:obj.__dict__.__setitem__("current",value)),raising=False)
        with pytest.raises(ValueError):train_model_module._write_protected_training_output(use,
            configuration=supplied,reservation=reservation,admission=control,_family=selected)
        assert use._output_slot["stage"]=="failed"
        if failure=="late-helper":assert changed==[True]
        if failure!="forged":
            assert family.phase=="failed"
            with pytest.raises(actual.LaunchUnavailable):unused=family.next_configuration
        else:assert family.phase=="bound"  # A forged value cannot choose a real family's failure state.
        charges=list(control.charges); before=len(kernel.calls)
        with pytest.raises(ValueError):train_model_module._write_protected_training_output(use,
            configuration=configuration,reservation=control,admission=control,_family=family)
        assert control.charges==charges and len(kernel.calls)==before
        if failure=="native-write":assert charges==[128*1024]
        else:assert charges==[] and Tensor.copies==[]


def test_fixed_serializer_cannot_freeze_a_different_genuine_family(monkeypatch):
    with _protected_training_metadata_fixture(monkeypatch) as (outer,tokenizer,_,_):
        actual,use,model,_,_,_,Tensor,_=outer
        train_model_module._capture_protected_training_metadata(model,tokenizer,use,maximum_bytes=65536)
        with pytest.MonkeyPatch.context() as inner_patch:
            with _protected_training_metadata_fixture(inner_patch) as (inner,_,_,_):
                _,foreign_use,foreign_model,*_=inner
                _,configuration,_,_,control=foreign_model.test_output
                family=actual.OriginalTrainingOutputFamily(foreign_use.view,foreign_use.payload.model_dump(mode="json"),
                    {"maximumCopyBytes":128*1024,"outputs":[configuration]},control,control)
                with pytest.raises(ValueError):train_model_module._write_protected_training_output(use,
                    configuration=configuration,reservation=control,admission=control,_family=family)
                assert use._output_slot["stage"]=="failed" and family.phase=="bound" and control.charges==[] and Tensor.copies==[]


@pytest.mark.parametrize("failure",["sdk-error","nonfinite-metric","boolean-metric","non-numeric-metric","bad-key","too-many-metrics",
    "boolean-step","nonfinite-loss","descending-steps","too-many-history","changed-settings","changed-binding","caught-reentry"])
def test_private_training_history_denies_bad_or_uncertain_observations_without_retry(monkeypatch,failure):
    with _protected_training_metadata_fixture(monkeypatch,capture_weights=False) as (facts,tokenizer,_,_):
        actual,use,model,_,_,control,Tensor,_=facts
        metrics={"train_loss":0.25}; history=[{"step":1,"loss":0.25}]; during=None; error=None
        args=SimpleNamespace(output_dir="ignored")
        if failure=="sdk-error":error=RuntimeError("private supplier content X:\\private\\test")
        elif failure=="nonfinite-metric":metrics["train_loss"]=float("nan")
        elif failure=="boolean-metric":metrics["train_loss"]=True
        elif failure=="non-numeric-metric":metrics["train_loss"]="private supplier content"
        elif failure=="bad-key":metrics["X:\\private\\test"]=1
        elif failure=="too-many-metrics":metrics={"metric"+str(i):1 for i in range(257)}
        elif failure=="boolean-step":history[0]["step"]=True
        elif failure=="nonfinite-loss":history[0]["loss"]=float("inf")
        elif failure=="descending-steps":history=[{"step":2,"loss":1},{"step":1,"loss":1}]
        elif failure=="too-many-history":history=[{}]*4097
        elif failure=="changed-settings":during=lambda:use.payload.commonParameters.update(maxSteps=2)
        elif failure=="changed-binding":during=lambda:setattr(use,"_embedding_tokenizer",object())
        elif failure=="caught-reentry":
            def during():
                with pytest.raises(ValueError):train_model_module._run_trainer(model,tokenizer,{"train":[1]},None,args,_protected_use=use)
        calls,objects=_install_inert_history_trainer(monkeypatch,metrics=metrics,history=history,during_train=during,failure=error)
        with pytest.raises((ValueError,actual.LaunchUnavailable)) as raised:
            train_model_module._run_trainer(model,tokenizer,{"train":[1]},None,args,_protected_use=use)
        assert "private supplier content" not in str(raised.value) and "X:" not in str(raised.value)
        assert calls==["construct","train"] and use._training_slot["stage"]=="failed"
        assert use._training_slot["files"] is None and Tensor.copies==[]
        with pytest.raises(ValueError):train_model_module._run_trainer(model,tokenizer,{"train":[1]},None,args,_protected_use=use)
        assert calls==["construct","train"]


def test_completed_training_history_cannot_be_replaced_during_metadata_export(monkeypatch):
    with _protected_training_metadata_fixture(monkeypatch,capture_weights=False) as (facts,tokenizer,_,_):
        actual,use,model,_,_,_,Tensor,_=facts
        _install_inert_history_trainer(monkeypatch)
        train_model_module._run_trainer(model,tokenizer,{"train":[1]},None,SimpleNamespace(output_dir="ignored"),_protected_use=use)
        train_model_module._capture_protected_training_tensor_stream(model,use,maximum_bytes=65536,chunk_bytes=4096)
        original=use._training_slot["files"]
        tokenizer.backend_tokenizer.after_export=lambda:use._training_slot.update(files=tuple((name,raw+b" ") for name,raw in original))
        with pytest.raises(ValueError):train_model_module._capture_protected_training_metadata(model,tokenizer,use,maximum_bytes=65536)
        assert use._metadata_slot["stage"]=="failed" and Tensor.copies==[]


@pytest.mark.parametrize("cause",["cancelled","expired","identity-drift"])
def test_private_training_history_retains_cancellation_or_lost_binding(monkeypatch,cause):
    with _protected_training_metadata_fixture(monkeypatch,capture_weights=False) as (facts,tokenizer,_,_):
        actual,use,model,_,_,control,_,_=facts
        args=SimpleNamespace(output_dir="ignored")
        def during():
            if cause=="cancelled":raise train_model_module.TrainingCancellationRequested()
            if cause=="expired":control.current=False
            if cause=="identity-drift":use._run_identity=tuple([*use._run_identity])
        calls,_=_install_inert_history_trainer(monkeypatch,during_train=during)
        expected=train_model_module.TrainingCancellationRequested if cause=="cancelled" else (ValueError,actual.LaunchUnavailable)
        with pytest.raises(expected):train_model_module._run_trainer(model,tokenizer,{"train":[1]},None,args,_protected_use=use)
        assert calls==["construct","train"] and use._training_slot["stage"]=="failed" and use._training_slot["files"] is None


def test_private_training_history_wrong_thread_cannot_poison_original_attempt(monkeypatch):
    from concurrent.futures import ThreadPoolExecutor
    with _protected_training_metadata_fixture(monkeypatch,capture_weights=False) as (facts,tokenizer,_,_):
        actual,use,model,_,_,_,_,_=facts
        calls,_=_install_inert_history_trainer(monkeypatch)
        args=SimpleNamespace(output_dir="ignored")
        with ThreadPoolExecutor(max_workers=1) as pool:
            future=pool.submit(train_model_module._run_trainer,model,tokenizer,{"train":[1]},None,args,_protected_use=use)
            with pytest.raises(ValueError):future.result(timeout=5)
        assert calls==[] and use._training_slot is None
        train_model_module._run_trainer(model,tokenizer,{"train":[1]},None,args,_protected_use=use)
        assert calls==["construct","train"] and use._training_slot["stage"]=="complete"


@pytest.mark.parametrize("replacement",["instance","class"])
def test_private_training_history_calls_original_train_after_progress_replaces_dispatch(monkeypatch,replacement):
    with _protected_training_metadata_fixture(monkeypatch,capture_weights=False) as (facts,tokenizer,_,_):
        actual,use,model,_,_,_,_,_=facts
        calls,objects=_install_inert_history_trainer(monkeypatch); synthetic=[]
        def progress(_):
            target=objects[0] if replacement=="instance" else type(objects[0])
            def substituted(*args,**kwargs):
                synthetic.append(True);return SimpleNamespace(metrics={"train_loss":123.0})
            monkeypatch.setattr(target,"train",substituted)
        metrics,_=train_model_module._run_trainer(model,tokenizer,{"train":[1]},None,
            SimpleNamespace(output_dir="ignored"),on_progress=progress,_protected_use=use)
        assert calls==["construct","train"] and synthetic==[] and metrics["train_loss"]==0.25
        assert use._training_slot["train_operation"].__self__ is objects[0]
        assert json.loads(dict(use._training_slot["files"])["training-run.json"])["metrics"]["train_loss"]==0.25


def test_private_optional_evaluation_software_uses_original_operation_with_controlled_metrics(monkeypatch):
    # Controlled arithmetic only; no model output or real quality measurement.
    with _protected_training_metadata_fixture(monkeypatch,capture_weights=False) as (facts,tokenizer,_,_):
        actual,use,model,_,_,_,_,_=facts
        calls,objects=_install_inert_history_trainer(monkeypatch); synthetic=[]
        class Rows:
            def __len__(self):return 1
            def select(self,indices):assert tuple(indices)==(0,);return self
        def progress(_):
            def substituted(**kwargs):synthetic.append(True);return {kwargs["metric_key_prefix"]+"_loss":99.0}
            monkeypatch.setattr(objects[0],"evaluate",substituted)
        metrics,_=train_model_module._run_trainer(model,tokenizer,{"train":[1]},Rows(),
            SimpleNamespace(output_dir="ignored"),on_progress=progress,compare_validation_baseline=True,_protected_use=use)
        assert calls==["construct","baseline_validation","train","trained_validation"] and synthetic==[]
        assert metrics["baseline_validation_loss"]==2.0 and metrics["trained_validation_loss"]==1.25
        assert metrics["validation_loss_delta"]==-0.75 and use._training_slot["stage"]=="complete"


@pytest.mark.parametrize("failure",["missing-metadata","missing-selection","consumed-stream","unsupported-shards","invalid-shards",
    "buffer-limit","chunk-mismatch","late-backend","callback-reentry","native-write","changed-settings","changed-metadata"])
def test_protected_training_output_driver_retains_denial_without_retry_or_fallback(monkeypatch,failure):
    output={"maxShardSize":"0.001KB" if failure=="unsupported-shards" else "invalid"} if failure in ("unsupported-shards","invalid-shards") else None
    method="full-finetune" if output is not None else "lora"
    with _protected_training_metadata_fixture(monkeypatch,method,output) as (facts,tokenizer,metadata_calls,stream):
        actual,use,model,peft,calls,control,Tensor,oracle=facts
        metadata=train_model_module._capture_protected_training_metadata(model,tokenizer,use,maximum_bytes=65536)
        kernel,configuration,_,_,output_control=model.test_output; changed=[]
        if failure=="missing-metadata": use._metadata_slot=None
        elif failure=="missing-selection": use._tensor_selection_slot=None
        elif failure=="consumed-stream": b"".join(stream)
        elif failure=="buffer-limit": configuration["bufferBytes"]=2048
        elif failure=="chunk-mismatch": stream.chunk_bytes=8192
        elif failure=="changed-settings": use.payload.commonParameters["maxSteps"]=99
        elif failure=="changed-metadata": use._metadata_slot["files"]=(metadata[0],)
        elif failure=="native-write": kernel.fail="WriteFile"
        elif failure in ("late-backend","callback-reentry"):
            def current(obj):
                slot=use._output_slot
                if obj is output_control and not changed and slot is not None and slot["graph"] is not None and slot["stage"]=="writing":
                    changed.append(True)
                    if failure=="late-backend": tokenizer.backend_tokenizer=type(tokenizer.backend_tokenizer)()
                    else:
                        with pytest.raises(actual.LaunchUnavailable): slot["graph"].guard()
                return obj.__dict__["current"]
            monkeypatch.setattr(type(output_control),"current",property(current,lambda obj,value:obj.__dict__.__setitem__("current",value)),raising=False)
        writes=sum(name=="WriteFile" for name,_ in kernel.calls)
        with pytest.raises(ValueError,match="private trained output"):
            train_model_module._write_protected_training_output(use,configuration=configuration,reservation=output_control,admission=output_control)
        slot=use._output_slot
        assert slot["stage"]=="failed" and output_control.retained==[]
        if failure!="native-write": assert sum(name=="WriteFile" for name,_ in kernel.calls)==writes
        if failure in ("late-backend","callback-reentry"): assert changed==[True] and slot["graph"].phase=="failed"
        if failure=="native-write": assert slot["graph"] is not None and output_control.charges==[128*1024]
        before=len(kernel.calls); charges=list(output_control.charges)
        with pytest.raises(ValueError): train_model_module._write_protected_training_output(use,configuration=configuration,reservation=output_control,admission=output_control)
        assert len(kernel.calls)==before and output_control.charges==charges


def test_protected_training_output_driver_checks_resources_after_callback_bearing_sdk_proof(monkeypatch):
    with _protected_training_metadata_fixture(monkeypatch) as (facts,tokenizer,metadata_calls,stream):
        actual,use,model,peft,calls,input_control,Tensor,oracle=facts
        train_model_module._capture_protected_training_metadata(model,tokenizer,use,maximum_bytes=65536)
        kernel,configuration,_,_,output_control=model.test_output; changed=[]; late_writes=[]; invoke=kernel.invoke
        def observed(name,args,row):
            if changed and name=="WriteFile": late_writes.append(name)
            return invoke(name,args,row)
        kernel.invoke=observed
        def current(obj):
            slot=use._output_slot
            if obj is input_control and not changed and slot is not None and slot["graph"] is not None:
                graph=slot["graph"]; frame=sys._getframe(1); sdk=False; ready=False
                while frame:
                    if frame.f_code.co_name=="current" and frame.f_locals.get("slot") is slot: sdk=True
                    if frame.f_code.co_name=="prepare" and frame.f_locals.get("self") is graph and isinstance(frame.f_locals.get("chunk"),bytes): ready=True
                    frame=frame.f_back
                if sdk and ready and graph._sdk_guard_active:
                    changed.append(True); output_control.current=False
            return obj.__dict__["current"]
        monkeypatch.setattr(type(input_control),"current",property(current,lambda obj,value:obj.__dict__.__setitem__("current",value)),raising=False)
        with pytest.raises(ValueError):
            train_model_module._write_protected_training_output(use,configuration=configuration,reservation=output_control,admission=output_control)
        assert changed==[True] and late_writes==[] and use._output_slot["graph"].phase=="failed"


def test_synthetic_training_fixture_releases_only_its_own_registry_entries(monkeypatch):
    with _protected_tensor_selection_fixture(monkeypatch) as outer:
        native,use,*_=outer; outer_lease=native._model_views[use.view][0]
        with monkeypatch.context() as inner_patch:
            with _protected_tensor_selection_fixture(inner_patch) as inner:
                inner_native,inner_use,*_=inner; inner_lease=inner_native._model_views[inner_use.view][0]
                assert inner_lease in inner_native._model_leases and outer_lease in native._model_leases
            assert inner_lease not in inner_native._model_leases
        assert outer_lease in native._model_leases
    assert outer_lease not in native._model_leases


@pytest.mark.parametrize("profile",["direct","fast-tokenizer","peft-config"])
def test_passive_sdk_binding_uses_fixed_fields_without_property_callbacks(monkeypatch,profile):
    expected=object(); calls=[]
    if profile=="direct":
        class Owner: pass
        owner=Owner();owner.config=expected;name="config"
    elif profile=="fast-tokenizer":
        class Owner:
            @property
            def backend_tokenizer(self): calls.append("getter");return self._tokenizer
        owner=Owner();owner._tokenizer=expected;name="backend_tokenizer"
        module=ModuleType("transformers.tokenization_utils_fast");module.PreTrainedTokenizerFast=Owner
        monkeypatch.setitem(sys.modules,module.__name__,module)
    else:
        class Base: pass
        base=Base();base.peft_config=expected
        class Owner:
            @property
            def peft_config(self): calls.append("getter");return self._modules["base_model"].peft_config
        owner=Owner();owner._is_prompt_learning=False;owner._modules={"base_model":base};name="peft_config"
        module=ModuleType("peft.peft_model");module.PeftModel=Owner;monkeypatch.setitem(sys.modules,module.__name__,module)
    reader=train_model_module._capture_passive_sdk_attribute(owner,name,expected)
    assert reader() is expected and calls==[]
    if profile=="direct": owner.config=object()
    elif profile=="fast-tokenizer": owner._tokenizer=object()
    else: owner._modules["base_model"]=Base()
    with pytest.raises(ValueError): reader()
    assert calls==[]


def test_passive_peft_configuration_binds_the_fixed_nonprompt_branch(monkeypatch):
    configuration={"default":object()};calls=[]
    class Base: pass
    base=Base();base.peft_config=configuration
    class PeftModel:
        @property
        def peft_config(self):
            calls.append("getter")
            return self._peft_config if self._is_prompt_learning else self._modules["base_model"].peft_config
    model=PeftModel();model._modules={"base_model":base};model._is_prompt_learning=False;model._peft_config=None
    module=ModuleType("peft.peft_model");module.PeftModel=PeftModel;monkeypatch.setitem(sys.modules,module.__name__,module)
    reader=train_model_module._capture_passive_sdk_attribute(model,"peft_config",configuration)
    assert reader() is configuration and calls==[]
    model._is_prompt_learning=True
    with pytest.raises(ValueError): reader()
    with pytest.raises(ValueError): train_model_module._capture_passive_sdk_attribute(model,"peft_config",configuration)
    assert calls==[]


def test_protected_output_final_snapshot_refuses_new_sdk_property_without_executing_it(monkeypatch):
    with _protected_training_metadata_fixture(monkeypatch) as (facts,tokenizer,metadata_calls,stream):
        actual,use,model,peft,calls,input_control,Tensor,oracle=facts
        train_model_module._capture_protected_training_metadata(model,tokenizer,use,maximum_bytes=65536)
        kernel,configuration,_,_,output_control=model.test_output; changed=[]; getter_calls=[]; late_writes=[];invoke=kernel.invoke
        backend=tokenizer.backend_tokenizer
        def getter(obj):
            getter_calls.append(True);output_control.current=False
            return backend
        def observed(name,args,row):
            if changed and name=="WriteFile": late_writes.append(name)
            return invoke(name,args,row)
        kernel.invoke=observed
        def current(obj):
            slot=use._output_slot
            if obj is output_control and not changed and slot is not None and slot["graph"] is not None:
                graph=slot["graph"];frame=sys._getframe(1);ready=False
                while frame:
                    if frame.f_code.co_name=="prepare" and frame.f_locals.get("self") is graph and isinstance(frame.f_locals.get("chunk"),bytes): ready=True
                    frame=frame.f_back
                if ready and graph._output_guard_active:
                    changed.append(True)
                    monkeypatch.setattr(type(tokenizer),"backend_tokenizer",property(getter),raising=False)
            return obj.__dict__["current"]
        monkeypatch.setattr(type(output_control),"current",property(current,lambda obj,value:obj.__dict__.__setitem__("current",value)),raising=False)
        with pytest.raises(ValueError):
            train_model_module._write_protected_training_output(use,configuration=configuration,reservation=output_control,admission=output_control)
        assert changed==[True] and getter_calls==[] and late_writes==[]


@pytest.mark.parametrize("method,boundary",[("lora","backend"),("full-finetune","backend"),
    ("full-finetune","model-config"),("full-finetune","generation-config")])
def test_protected_training_metadata_rechecks_receivers_after_final_callback(monkeypatch,method,boundary):
    with _protected_training_metadata_fixture(monkeypatch,method) as (facts,tokenizer,metadata_calls,stream):
        actual,use,model,peft,calls,control,Tensor,oracle=facts; changed=[]
        def current(obj):
            slot=use._metadata_slot
            if obj is control and not changed and slot is not None and slot["operations"]:
                last=slot["operations"][-1]
                if last["label"]=="fast-tokenizer-json" and last["returned"] and metadata_calls.count("backend-json")==2:
                    changed.append(True)
                    if boundary=="backend": tokenizer.backend_tokenizer=type(tokenizer.backend_tokenizer)()
                    elif boundary=="model-config": model.config=type(model.config)({"model_type":"foreign"})
                    else: model.generation_config=type(model.generation_config)({"max_new_tokens":99})
            return obj.__dict__["current"]
        monkeypatch.setattr(type(control),"current",property(current,lambda obj,value:obj.__dict__.__setitem__("current",value)),raising=False)
        with pytest.raises(ValueError,match="private trained metadata export"):
            train_model_module._capture_protected_training_metadata(model,tokenizer,use,maximum_bytes=65536)
        assert changed==[True] and Tensor.copies==[] and use._metadata_slot["stage"]=="failed"
        assert use._metadata_slot["bindings"]  # Retain the actual original receivers.


@pytest.mark.parametrize("failure",["wrong-tokenizer","wrong-model","withdraw","settings","missing-sdk","foreign-backend",
    "custom-tokenizer","custom-config","cycles","wide-metadata","nan","duplicate-json","malformed-json","large-json",
    "config-error","backend-error","changed-json","changed-config","changed-backend","bad-decoder"])
def test_protected_training_metadata_denies_incomplete_or_changed_metadata(monkeypatch,failure):
    with _protected_training_metadata_fixture(monkeypatch,"full-finetune") as (facts,tokenizer,metadata_calls,stream):
        actual,use,model,peft,calls,control,Tensor,oracle=facts
        chosen_model,chosen_tokenizer=model,tokenizer
        if failure=="wrong-tokenizer": chosen_tokenizer=object()
        elif failure=="wrong-model": chosen_model=object()
        elif failure=="withdraw": control.current=False
        elif failure=="settings": use.payload.commonParameters["maxSteps"]=999
        elif failure=="missing-sdk": monkeypatch.delitem(sys.modules,"tokenizers")
        elif failure=="foreign-backend": tokenizer.backend_tokenizer=object()
        elif failure=="custom-tokenizer": tokenizer._auto_class="AutoTokenizer"
        elif failure=="custom-config": model.config.values["auto_map"]={"AutoConfig":"custom.Code"}
        elif failure=="cycles": model.config.values["cycle"]=model.config.values
        elif failure=="wide-metadata": model.config.values["large"]="x"*65537
        elif failure=="nan": model.config.values["score"]=float("nan")
        elif failure=="duplicate-json": tokenizer.backend_tokenizer.raw='{"model":{},"model":{}}'
        elif failure=="malformed-json": tokenizer.backend_tokenizer.raw='[true]'
        elif failure=="large-json": tokenizer.backend_tokenizer.raw='x'*65537
        elif failure=="config-error": model.config.after_export=lambda: (_ for _ in ()).throw(RuntimeError("private supplier details"))
        elif failure=="backend-error": tokenizer.backend_tokenizer.after_export=lambda: (_ for _ in ()).throw(RuntimeError("private supplier details"))
        elif failure=="changed-json": tokenizer.backend_tokenizer.after_export=lambda: setattr(tokenizer.backend_tokenizer,"raw",'{"changed":true}')
        elif failure=="changed-config": model.config.after_export=lambda: model.config.values.update(vocab_size=99)
        elif failure=="changed-backend": model.config.after_export=lambda: setattr(tokenizer,"backend_tokenizer",object())
        elif failure=="bad-decoder": tokenizer.added_tokens_decoder={True:tokenizer.pad}
        with pytest.raises(ValueError,match="private trained metadata export") as caught:
            train_model_module._capture_protected_training_metadata(chosen_model,chosen_tokenizer,use,maximum_bytes=65536)
        assert "supplier details" not in str(caught.value) and Tensor.copies==[]
        assert use._metadata_slot["stage"]=="failed"
        before=list(metadata_calls)
        with pytest.raises(ValueError): train_model_module._capture_protected_training_metadata(model,tokenizer,use,maximum_bytes=65536)
        assert metadata_calls==before


def test_private_fixed_loader_consumes_actual_live_view_without_rewriting_logical_model(monkeypatch,tmp_path):
    from modules.adapters.runtime.python.worker.native import windows_original_worker_launch as native
    from modules.adapters.runtime.python.worker.tests.test_native_training_model_graph import borrowed_model_view
    payload=_request(tmp_path); payload.baseModel.localPath="X:\\models\\selected"; payload.baseModel.modelRecordId="model.synthetic"
    request=payload.model_dump(mode="json")
    # Native source-only fixture. Whole session validation is tested separately;
    # no Transformers supplier, model, dataset, trainer or quality score runs.
    definition={"requestId":"11111111-1111-4111-8111-111111111111",
        "modelUpdatedAt":"2026-11-23T00:00:00Z","request":request}
    references=[]
    monkeypatch.setattr(train_model_module,"_local_training_model_reference",lambda value: references.append(value) or value)
    calls=[]
    def execute(actual,**options): calls.append((actual,options)); return "controlled-loader-result"
    monkeypatch.setattr(train_model_module,"_train_model",execute)
    with borrowed_model_view(definition,request,native) as (view,physical):
        assert train_model_module.train_model_from_local_files(payload,_model_view=view)=="controlled-loader-result"
        assert payload.model_dump(mode="json")==request
        assert calls[0][1]["local_model_ref"]==physical and calls[0][1]["compare_validation_baseline"] is False
        assert calls[0][1]["_protected_use"]._run_identity[0]==definition["requestId"]
        assert references==[physical]
    with pytest.raises(native.LaunchUnavailable): train_model_module.train_model_from_local_files(payload,_model_view=view)
    assert len(calls)==1 and references==[physical]


@pytest.mark.parametrize("task_id",[None,True,"not-a-task"])
def test_private_training_needs_original_task_identity_before_model_preflight(monkeypatch,tmp_path,task_id):
    from modules.adapters.runtime.python.worker.native import windows_original_worker_launch as native
    from modules.adapters.runtime.python.worker.tests.test_native_training_model_graph import borrowed_model_view
    payload=_request(tmp_path);payload.baseModel.localPath="X:\\models\\selected";payload.baseModel.modelRecordId="model.synthetic"
    request=payload.model_dump(mode="json")
    definition={"requestId":task_id,"modelUpdatedAt":"2026-11-23T00:00:00Z","request":request}
    calls=[]
    monkeypatch.setattr(train_model_module,"_local_training_model_reference",lambda value:calls.append(value))
    monkeypatch.setattr(train_model_module,"_train_model",lambda *args,**kwargs:pytest.fail("Training must not start"))
    with borrowed_model_view(definition,request,native) as (view,_):
        state=native._model_leases[native._model_views[view][0]];kernel=state["native_owner"].kernel
        before=len(kernel.calls)
        with pytest.raises(native.LaunchUnavailable):train_model_module.train_model_from_local_files(payload,_model_view=view)
        assert len(kernel.calls)==before and calls==[]


@pytest.mark.parametrize("failure",["resolver","source-resolver","serializer","run-id"])
def test_private_training_task_identity_drift_has_no_new_native_effect(monkeypatch,failure):
    with _checkpoint_schedule_fixture(monkeypatch) as (_,use,_,_,family,control,kernel,Tensor):
        calls=[]
        if failure=="resolver":use._resolve_task_id=lambda *args:calls.append(True)
        elif failure=="source-resolver":use._resolve=lambda *args:calls.append(True)
        elif failure=="serializer":use._serialize=lambda *args,**kwargs:calls.append(True)
        else:use._run_identity=("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",use._run_identity[1])
        before=len(kernel.calls)
        with pytest.raises(ValueError):train_model_module._check_protected_use(use)
        assert len(kernel.calls)==before and calls==[] and control.charges==[] and Tensor.copies==[]
        assert family.phase=="bound"


def test_training_task_recheck_does_not_invoke_replacement_after_native_observer(monkeypatch):
    with _checkpoint_schedule_fixture(monkeypatch) as (_,use,_,_,family,control,kernel,Tensor):
        changed=[];called=[]
        def after(name):
            if changed:return
            frame=sys._getframe(1)
            while frame:
                if frame.f_code is train_model_module._ProtectedTrainingUse.assert_current.__code__ and frame.f_locals.get("self") is use:
                    use._resolve_task_id=lambda *args:called.append(True)
                    changed.append((name,len(kernel.calls)));return
                frame=frame.f_back
        kernel.after=after
        with pytest.raises(ValueError):train_model_module._check_protected_use(use)
        assert len(changed)==1 and called==[] and control.charges==[] and Tensor.copies==[]
        assert not any(name in ("WriteFile","NtCreateFile") for name,_ in kernel.calls[changed[0][1]:])
        assert family.phase=="bound"


def test_private_fixed_loader_refuses_forged_view_before_path_or_supplier(monkeypatch,tmp_path):
    from modules.adapters.runtime.python.worker.native import windows_original_worker_launch as native
    payload=_request(tmp_path); calls=[]
    monkeypatch.setattr(train_model_module,"_local_training_model_reference",lambda value: calls.append(value) or value)
    monkeypatch.setattr(train_model_module,"_train_model",lambda *a,**kw: calls.append("unavailable"))
    with pytest.raises(native.LaunchUnavailable): train_model_module.train_model_from_local_files(payload,_model_view=object())
    assert calls==[]


def test_private_fixed_loader_consumes_actual_combined_input_view_without_changing_request(monkeypatch):
    from modules.adapters.runtime.python.worker.native import windows_original_worker_launch as native
    from modules.adapters.runtime.python.worker.tests.test_native_training_model_graph import TrainingInputCopyTests
    case=TrainingInputCopyTests()
    source,lease,staged,config,control,kernel,*_=case.fixture(count=2,native_module=native)
    graph=native.OriginalTrainingInputGraph(lease,staged,config,control,control)
    try:
        graph.prepare(); payload=TrainModelTaskRequest.model_validate(staged["payload"])
        original=payload.model_dump(mode="json"); calls=[]; paths=[]
        monkeypatch.setattr(train_model_module,"_local_training_model_reference",lambda value: paths.append(value) or value)
        monkeypatch.setattr(train_model_module,"_train_model",lambda actual,**options: calls.append((actual,options)) or "controlled-result")
        with lease.borrow(original) as view:
            assert train_model_module.train_model_from_local_files(payload,_model_view=view)=="controlled-result"
            assert payload.model_dump(mode="json")==original
            assert calls[0][0] is payload
            assert calls[0][1]["local_model_ref"]==source.physical_path
            assert calls[0][1]["local_dataset_refs"]==tuple(graph.physical_path+"\\"+row["name"] for row in graph.records[:-1])
            assert calls[0][1]["compare_validation_baseline"] is False
            control.current=False
            with pytest.raises(native.LaunchUnavailable): train_model_module.train_model_from_local_files(payload,_model_view=view)
            assert len(calls)==1 and paths==[source.physical_path]
        with pytest.raises(native.LaunchUnavailable): train_model_module.train_model_from_local_files(payload,_model_view=view)
        assert len(calls)==1 and control.retained==[]  # No SDK/worker settlement or quota credit.
    finally: case.doCleanups()


def test_private_dataset_reader_uses_protected_references_and_keeps_logical_paths(monkeypatch,tmp_path):
    payload=_request(tmp_path)
    payload.datasets[0].path=str(tmp_path/"missing-logical-staging.jsonl")
    protected=tmp_path/"protected-input.jsonl"; protected.write_text('{"text":"Approved copied row"}\n',encoding="utf8")
    before=payload.model_dump(mode="json"); calls=[]
    def load_local(builder,*,data_files):
        calls.append((builder,data_files))
        return {"train":[json.loads(Path(data_files["train"][0]).read_text(encoding="utf8"))]}
    monkeypatch.setitem(sys.modules,"datasets",SimpleNamespace(load_dataset=load_local))
    monkeypatch.setattr(train_model_module,"_dataset_path",lambda _: pytest.fail("Protected inputs fell back to a logical path"))
    loaded,evaluation=train_model_module._load_dataset(payload,local_dataset_refs=(str(protected),))
    assert loaded=={"train":[{"text":"Approved copied row"}]} and evaluation is None
    assert calls==[("json",{"train":[str(protected)]})] and payload.model_dump(mode="json")==before


@pytest.mark.parametrize("change",["permission","settings"])
def test_live_view_is_rechecked_after_progress_before_actual_dataset_use(monkeypatch,change):
    # Keep the original denial at an actual emitted stage and use the fixed
    # pipeline. A replaced loader or absent family would refuse too early.
    with _protected_pipeline_fixture(monkeypatch) as (_,use,_,_,family,control,kernel,calls,_,disk):
        observed=[];after_callback=[]
        def progress(value):
            if value["stage"]=="dataset-loading":
                observed.append(value["stage"])
                after_callback.append(len(kernel.calls))
                if change=="permission":control.current=False
                else:use.payload.commonParameters["maxSteps"]=9876
        with pytest.raises(ValueError):
            train_model_module.train_model_from_local_files(use.payload,on_progress=progress,_model_view=use.view)
        assert observed==["dataset-loading"] and calls==disk==[]
        assert not any(name in ("ReadFile","WriteFile","NtCreateFile") for name,_ in kernel.calls[after_callback[0]:])
        assert family.phase=="retired" and control.charges==control.retained==[]


@pytest.mark.parametrize("refs",[[],(),("relative.jsonl",),("https://example.invalid/data.jsonl",),("\\\\host\\share\\data.jsonl",),(True,)])
def test_invalid_private_dataset_references_deny_before_output_or_dataset_work(monkeypatch,tmp_path,refs):
    payload=_request(tmp_path)
    monkeypatch.setattr(train_model_module,"_load_dataset",lambda *a,**k: pytest.fail("Invalid references reached dataset IO"))
    monkeypatch.setattr(train_model_module,"_load_transformers_objects",lambda *a,**k: pytest.fail("Invalid references reached model loading"))
    with pytest.raises(ValueError,match="protected training inputs"):
        train_model_module._train_model(payload,local_model_ref="inert-local-only",local_dataset_refs=refs)
    assert not (tmp_path/"out").exists()


@pytest.mark.parametrize("withdraw",[False,True])
def test_live_use_checked_after_dataset_import_before_reader_factory(monkeypatch,withdraw):
    import builtins
    import datasets
    from modules.adapters.runtime.python.worker.native import windows_original_worker_launch as native
    from modules.adapters.runtime.python.worker.tests.test_native_training_model_graph import TrainingInputCopyTests
    case=TrainingInputCopyTests()
    source,lease,staged,config,control,kernel,*_=case.fixture(native_module=native)
    graph=native.OriginalTrainingInputGraph(lease,staged,config,control,control); calls=[]
    original_import=builtins.__import__
    def importing(name,*args,**options):
        if name=="datasets":
            if withdraw: control.current=False
            calls.append("import")
            return datasets
        return original_import(name,*args,**options)
    try:
        graph.prepare(); payload=TrainModelTaskRequest.model_validate(staged["payload"])
        with lease.borrow(payload.model_dump(mode="json")) as view:
            use=train_model_module._ProtectedTrainingUse(payload,view)
            monkeypatch.setattr(train_model_module,"Path",lambda *_: pytest.fail("Private loading reopened a path"))
            monkeypatch.setattr(builtins,"__import__",importing)
            reads=lambda: sum(name=="ReadFile" for name,_ in kernel.calls)
            before=reads()
            if withdraw:
                with pytest.raises(native.LaunchUnavailable): train_model_module._load_dataset(payload,local_dataset_refs=use.dataset_references,_protected_use=use)
                assert reads()==before and calls==["import"]
            else:
                result,_=train_model_module._load_dataset(payload,local_dataset_refs=use.dataset_references,_protected_use=use)
                assert result["train"].to_list()==[{"instruction":"Say yes","output":"yes"}] and reads()>before
    finally: case.doCleanups()


@pytest.mark.parametrize("withdraw",[False,True])
def test_live_use_checked_after_tokenizer_before_model_factory(monkeypatch,withdraw):
    from modules.adapters.runtime.python.worker.native import windows_original_worker_launch as native
    from modules.adapters.runtime.python.worker.tests.test_native_training_model_graph import TrainingInputCopyTests
    case=TrainingInputCopyTests()
    source,lease,staged,config,control,kernel,*_=case.fixture(native_module=native)
    graph=native.OriginalTrainingInputGraph(lease,staged,config,control,control); calls=[]
    class Tokenizer:
        pad_token="pad"; eos_token="end"
        def __len__(self): return 0
    def tokenize(reference,**options):
        calls.append("tokenizer")
        if withdraw: control.current=False
        return Tokenizer()
    def model(reference,**options):
        calls.append("model")
        assert options["local_files_only"] is True and options["trust_remote_code"] is False
        assert options["use_safetensors"] is True and options["weights_only"] is True and options["token"] is False
        return object()
    monkeypatch.setitem(sys.modules,"transformers",SimpleNamespace(AutoTokenizer=SimpleNamespace(from_pretrained=tokenize),AutoModelForCausalLM=SimpleNamespace(from_pretrained=model)))
    monkeypatch.setattr(train_model_module,"_local_training_model_reference",lambda value:value)
    try:
        graph.prepare(); payload=TrainModelTaskRequest.model_validate(staged["payload"])
        with lease.borrow(payload.model_dump(mode="json")) as view:
            use=train_model_module._ProtectedTrainingUse(payload,view)
            if withdraw:
                with pytest.raises(native.LaunchUnavailable): train_model_module._load_transformers_objects(use.model_reference,payload.method,{},local_files_only=True,_protected_use=use)
                assert calls==["tokenizer"]
            else:
                train_model_module._load_transformers_objects(use.model_reference,payload.method,{},local_files_only=True,_protected_use=use)
                assert calls==["tokenizer","model"]
    finally: case.doCleanups()


@contextmanager
def _protected_dataset_loading_fixture(monkeypatch,fmt,contents):
    """Real held-handle reader and Use; only the Native ABI is in memory."""
    from modules.adapters.runtime.python.worker.native import windows_original_worker_launch as native
    from modules.adapters.runtime.python.worker.tests.test_native_training_model_graph import (
        Kernel, SourceLaunchExchangeTests, TrainingInputCopyTests)
    media={"jsonl":"application/x-ndjson","json":"application/json","csv":"text/csv","parquet":"application/vnd.apache.parquet"}[fmt]
    bootstrap,node=SourceLaunchExchangeTests.bound_bootstrap,Kernel.node
    def bind(self,definition=None,native_module=None):
        for row,raw in zip(definition["inputs"],contents):
            row.update(sizeBytes=len(raw),digest="sha256:"+hashlib.sha256(raw).hexdigest())
        return bootstrap(self,definition,native_module)
    def stage(self,path,directory,data=b"",acl=None):
        for index,raw in enumerate(contents):
            if path=="X:\\inputs\\batch\\"+str(index+1).zfill(4)+"-input-"+str(index)+"."+fmt:
                data=raw
        return node(self,path,directory,data,acl)
    case=TrainingInputCopyTests()
    try:
        with monkeypatch.context() as setup:
            setup.setattr(SourceLaunchExchangeTests,"bound_bootstrap",bind)
            setup.setattr(Kernel,"node",stage)
            source,lease,staged,config,control,kernel,*_=case.fixture(media=media,count=len(contents),native_module=native)
        graph=native.OriginalTrainingInputGraph(lease,staged,config,control,control)
        graph.prepare(); payload=TrainModelTaskRequest.model_validate(staged["payload"])
        with lease.borrow(payload.model_dump(mode="json")) as view:
            use=train_model_module._ProtectedTrainingUse(payload,view)
            yield use,control,kernel,graph
    finally: case.doCleanups()


def _memory_dataset_bytes(fmt,rows):
    if fmt=="jsonl":return b"\n".join(json.dumps(row).encode() for row in rows)+b"\n"
    if fmt=="json":return json.dumps(rows).encode()
    if fmt=="csv":
        import csv,io
        stream=io.StringIO(newline=""); writer=csv.DictWriter(stream,fieldnames=list(rows[0]))
        writer.writeheader();writer.writerows(rows);return stream.getvalue().encode()
    import pyarrow as pa,pyarrow.parquet as pq
    stream=pa.BufferOutputStream();pq.write_table(pa.Table.from_pylist(rows),stream)
    return stream.getvalue().to_pybytes()


@pytest.mark.parametrize("fmt",["jsonl","json","csv","parquet"])
def test_private_dataset_loading_uses_installed_memory_parsers_and_original_bytes(monkeypatch,fmt):
    from datasets import Dataset,DatasetDict
    from datasets.table import InMemoryTable
    rows=[{"instruction":"Say, yes","output":"yes","count":2,"enabled":True},
          {"instruction":"Line\nTwo","output":"no","count":3,"enabled":False}]
    raw=_memory_dataset_bytes(fmt,rows)
    with _protected_dataset_loading_fixture(monkeypatch,fmt,(raw,raw)) as (use,control,kernel,graph):
        before=use.payload.model_dump(mode="json")
        opened=len(kernel.opened_names)
        loaded,evaluation=train_model_module._load_dataset(use.payload,local_dataset_refs=use.dataset_references,_protected_use=use)
        assert type(loaded) is DatasetDict and tuple(loaded)==("train","validation")
        assert evaluation is loaded["validation"]
        for name,split in loaded.items():
            assert type(split) is Dataset and type(split.data) is InMemoryTable and not split.cache_files
            assert split.to_list()==rows and split._fingerprint==use._run_identity[0].replace("-","")+"_"+name+"_loaded_v1"
            assert split.features["count"].dtype=="int64" and split.features["enabled"].dtype=="bool"
        assert use.payload.model_dump(mode="json")==before and len(kernel.opened_names)==opened
        assert control.retained==[] and graph.phase=="sealed"
        reads=sum(name=="ReadFile" for name,_ in kernel.calls)
        with pytest.raises(ValueError):train_model_module._load_dataset(use.payload,local_dataset_refs=use.dataset_references,_protected_use=use)
        assert sum(name=="ReadFile" for name,_ in kernel.calls)==reads and use._dataset_slot["stage"]=="complete"


@pytest.mark.parametrize("fmt",["jsonl","json","csv","parquet"])
def test_private_dataset_parser_failure_is_redacted_and_never_publishes_partial_splits(monkeypatch,fmt):
    raw=_memory_dataset_bytes(fmt,[{"text":"approved"}])
    broken=b"synthetic-private-row https://example.invalid/private X:\\private\\source"
    if fmt=="csv":broken=b'text\n"synthetic-private-row'
    with _protected_dataset_loading_fixture(monkeypatch,fmt,(raw,broken)) as (use,control,kernel,graph):
        with pytest.raises(ValueError) as error:
            train_model_module._load_dataset(use.payload,local_dataset_refs=use.dataset_references,_protected_use=use)
        assert str(error.value)=="The private training dataset could not be loaded."
        assert use._dataset_slot["stage"]=="failed" and control.retained==[]
        reads=sum(name=="ReadFile" for name,_ in kernel.calls)
        with pytest.raises(ValueError):train_model_module._load_dataset(use.payload,local_dataset_refs=use.dataset_references,_protected_use=use)
        assert sum(name=="ReadFile" for name,_ in kernel.calls)==reads


@pytest.mark.parametrize("fmt",["json","jsonl"])
def test_private_json_string_arrays_keep_text_column(monkeypatch,fmt):
    with _protected_dataset_loading_fixture(monkeypatch,fmt,(b'["one","two"]',)) as (use,*_):
        loaded,_=train_model_module._load_dataset(use.payload,local_dataset_refs=use.dataset_references,_protected_use=use)
        assert loaded["train"].to_list()==[{"text":"one"},{"text":"two"}]


def test_private_parquet_never_deserializes_registered_extension_metadata(monkeypatch):
    import pyarrow as pa,pyarrow.parquet as pq
    armed=False;effects=[]
    class SyntheticExtension(pa.ExtensionType):
        def __init__(self):super().__init__(pa.int32(),"synthetic.private.training")
        def __arrow_ext_serialize__(self):return b"synthetic"
        @classmethod
        def __arrow_ext_deserialize__(cls,storage_type,serialized):
            if armed:effects.append("extension");raise RuntimeError("synthetic-private-extension")
            return cls()
    extension=SyntheticExtension();pa.register_extension_type(extension)
    try:
        array=pa.ExtensionArray.from_storage(extension,pa.array([1],type=pa.int32()))
        sink=pa.BufferOutputStream();pq.write_table(pa.Table.from_arrays([array],names=["value"]),sink)
        raw=sink.getvalue().to_pybytes()
        with _protected_dataset_loading_fixture(monkeypatch,"parquet",(raw,)) as (use,*_):
            armed=True
            with pytest.raises(ValueError,match="could not be loaded"):
                train_model_module._load_dataset(use.payload,local_dataset_refs=use.dataset_references,_protected_use=use)
            assert effects==[] and use._dataset_slot["stage"]=="failed"
    finally:
        armed=False;pa.unregister_extension_type(extension.extension_name)


def test_private_parquet_feature_paths_remain_literal_data(monkeypatch):
    import pyarrow as pa,pyarrow.parquet as pq
    from datasets import Features,Image
    raw_values=[{"image":{"bytes":None,"path":"https://example.invalid/private-image.png"}}]
    table=pa.Table.from_pylist(raw_values).replace_schema_metadata({b"huggingface":
        json.dumps({"info":{"features":Features({"image":Image()}).to_dict()}}).encode()})
    sink=pa.BufferOutputStream();pq.write_table(table,sink);raw=sink.getvalue().to_pybytes()
    with _protected_dataset_loading_fixture(monkeypatch,"parquet",(raw,)) as (use,*_):
        loaded,_=train_model_module._load_dataset(use.payload,local_dataset_refs=use.dataset_references,_protected_use=use)
        assert loaded["train"].to_list()==raw_values and not isinstance(loaded["train"].features["image"],Image)


def test_private_parquet_external_column_paths_deny_before_data_reader(monkeypatch):
    import io
    import pyarrow as pa,pyarrow.parquet as pq
    table=pa.table({"text":["safe"]});sink=pa.BufferOutputStream();collected=[]
    pq.write_table(table,sink,metadata_collector=collected)
    collected[0].set_file_path("https://example.invalid/unapproved.parquet")
    external=io.BytesIO();pq.write_metadata(table.schema,external,metadata_collector=collected)
    with _protected_dataset_loading_fixture(monkeypatch,"parquet",(external.getvalue(),)) as (use,*_):
        with monkeypatch.context() as forbid:
            forbid.setattr(pq,"ParquetFile",lambda *a,**k:pytest.fail("External column path reached data reader"))
            with pytest.raises(ValueError,match="could not be loaded"):
                train_model_module._load_dataset(use.payload,local_dataset_refs=use.dataset_references,_protected_use=use)


@pytest.mark.parametrize("fmt",["jsonl","json","csv","parquet"])
def test_private_dataset_file_order_and_no_filesystem_network_or_builder(monkeypatch,fmt):
    import builtins,io,socket,requests
    import pyarrow as pa,pyarrow.parquet as pq,pyarrow.json
    from datasets.builder import DatasetBuilder
    from datasets.packaged_modules.csv.csv import CsvConfig
    from datasets.packaged_modules.json.json import pandas_read_json
    import pandas
    chunks=tuple(_memory_dataset_bytes(fmt,[{"text":text}]) for text in ("train","validation first","validation second"))
    with _protected_dataset_loading_fixture(monkeypatch,fmt,chunks) as (use,*_):
        def forbidden(*a,**k):pytest.fail("Private dataset loading attempted filesystem/network/cache/builder work")
        with monkeypatch.context() as sentinel:
            sentinel.setattr(builtins,"open",forbidden);sentinel.setattr(io,"open",forbidden)
            sentinel.setattr(Path,"open",forbidden);sentinel.setattr(Path,"exists",forbidden);sentinel.setattr(Path,"mkdir",forbidden)
            sentinel.setattr(pa,"memory_map",forbidden);sentinel.setattr(socket,"create_connection",forbidden)
            sentinel.setattr(requests.sessions.Session,"request",forbidden);sentinel.setattr(DatasetBuilder,"__init__",forbidden)
            loaded,evaluation=train_model_module._load_dataset(use.payload,local_dataset_refs=use.dataset_references,_protected_use=use)
            assert loaded["train"].to_list()==[{"text":"train"}]
            assert evaluation.to_list()==[{"text":"validation first"},{"text":"validation second"}]


@pytest.mark.parametrize("change",["permission","reader","loader","reentry"])
def test_private_parser_observers_cannot_change_authority_helpers_or_reenter(monkeypatch,change):
    import pandas
    original=pandas.read_csv;effects=[]
    raw=_memory_dataset_bytes("csv",[{"text":"safe"}])
    with _protected_dataset_loading_fixture(monkeypatch,"csv",(raw,)) as (use,control,kernel,_):
        def observe(*a,**k):
            chunks=original(*a,**k);effects.append("parser")
            if change=="permission":control.current=False
            elif change=="reader":use._dataset_reader=lambda *a:pytest.fail("Replaced input reader invoked")
            elif change=="loader":use._dataset_loader=lambda *a:pytest.fail("Replaced loader invoked")
            else:
                with pytest.raises(ValueError):train_model_module._load_dataset(use.payload,local_dataset_refs=use.dataset_references,_protected_use=use)
            return chunks
        monkeypatch.setattr(pandas,"read_csv",observe)
        with pytest.raises((ValueError,train_model_module.LaunchUnavailable)):
            train_model_module._load_dataset(use.payload,local_dataset_refs=use.dataset_references,_protected_use=use)
        assert effects==["parser"] and use._dataset_slot["stage"]=="failed" and control.retained==[]


@pytest.mark.parametrize("change",["reader","loader","parquet-reader"])
def test_private_dataset_helper_replacement_denies_before_original_read(monkeypatch,change):
    raw=b'{"text":"safe"}\n'
    with _protected_dataset_loading_fixture(monkeypatch,"jsonl",(raw,)) as (use,_,kernel,_):
        attribute={"reader":"_dataset_reader","loader":"_dataset_loader","parquet-reader":"_dataset_parquet_reader"}[change]
        setattr(use,attribute,lambda *a:pytest.fail("Replacement helper invoked"))
        reads=sum(name=="ReadFile" for name,_ in kernel.calls)
        with pytest.raises(ValueError):train_model_module._load_dataset(use.payload,local_dataset_refs=use.dataset_references,_protected_use=use)
        assert sum(name=="ReadFile" for name,_ in kernel.calls)==reads and use._dataset_slot is None


@pytest.mark.parametrize("mode",["reserved-duplicate","extension-tag","trailing-envelope","wrong-version"])
def test_private_parquet_ambiguous_metadata_and_unknown_reader_version_deny(monkeypatch,mode):
    import base64
    import pyarrow as pa,pyarrow.parquet as pq
    table=pa.table({"text":["safe"]})
    if mode=="reserved-duplicate":table=table.replace_schema_metadata({b"synthetic":b"ARROW:schema"})
    elif mode=="extension-tag":table=table.rename_columns(["ARROW:extension:name"])
    sink=pa.BufferOutputStream();pq.write_table(table,sink);raw=sink.getvalue().to_pybytes()
    if mode=="trailing-envelope":
        # Change only the synthetic footer's exact Compact-Thrift binary value
        # and lengths. The installed writer drops caller ARROW:schema metadata.
        encoded=pq.read_metadata(pa.BufferReader(raw)).metadata[b"ARROW:schema"]
        replacement=base64.b64encode(base64.b64decode(encoded)+b"trailing")
        def varint(value):
            out=bytearray()
            while value>=128:out.append((value&127)|128);value>>=7
            out.append(value);return bytes(out)
        size=int.from_bytes(raw[-8:-4],"little");footer=raw[-8-size:-8]
        original=varint(len(encoded))+encoded
        assert footer.count(original)==1
        changed=footer.replace(original,varint(len(replacement))+replacement)
        raw=raw[:-8-size]+changed+len(changed).to_bytes(4,"little")+b"PAR1"
    with _protected_dataset_loading_fixture(monkeypatch,"parquet",(raw,)) as (use,*_):
        if mode=="wrong-version":monkeypatch.setattr(pa,"__version__","unqualified")
        with pytest.raises(ValueError,match="could not be loaded"):
            train_model_module._load_dataset(use.payload,local_dataset_refs=use.dataset_references,_protected_use=use)


def test_private_dataset_module_loader_replacement_cannot_bypass_original_use(monkeypatch):
    with _protected_dataset_loading_fixture(monkeypatch,"jsonl",(b'{"text":"safe"}\n',)) as (use,_,kernel,_):
        effects=[];before=len(kernel.calls)
        monkeypatch.setattr(train_model_module,"_load_protected_dataset",lambda *a:effects.append("replacement"))
        with pytest.raises(ValueError):
            train_model_module._load_dataset(use.payload,local_dataset_refs=use.dataset_references,_protected_use=use)
        assert effects==[] and len(kernel.calls)==before and use._dataset_slot is None


@pytest.mark.parametrize("entry",["dispatch","parser"])
def test_foreign_thread_cannot_consume_or_poison_original_dataset_load(monkeypatch,entry):
    from threading import Thread
    with _protected_dataset_loading_fixture(monkeypatch,"jsonl",(b'{"text":"safe"}\n',)) as (use,_,kernel,_):
        errors=[];before=len(kernel.calls)
        def foreign():
            try:
                if entry=="dispatch":
                    train_model_module._load_dataset(use.payload,local_dataset_refs=use.dataset_references,_protected_use=use)
                else:train_model_module._load_protected_dataset(use.payload,use.dataset_references,use)
            except ValueError:errors.append("refused")
        worker=Thread(target=foreign);worker.start();worker.join(5)
        assert not worker.is_alive() and errors==["refused"] and len(kernel.calls)==before and use._dataset_slot is None
        loaded,_=train_model_module._load_dataset(use.payload,local_dataset_refs=use.dataset_references,_protected_use=use)
        assert loaded["train"].to_list()==[{"text":"safe"}]


def _validation_comparison_fixture(monkeypatch, *, baseline=4.0, candidate=3.0, fail_at=None):
    calls = []
    class Dataset:
        def __init__(self, rows): self.rows = list(rows)
        def __len__(self): return len(self.rows)
        def select(self, indices):
            calls.append(("select", tuple(indices)))
            return Dataset(self.rows[index] for index in indices)
    validation = Dataset(range(100))
    class Trainer:
        def __init__(self, **kwargs):
            self.validation = kwargs["eval_dataset"]
            self.state = SimpleNamespace(log_history=[])
            calls.append(("create", self.validation))
        def evaluate(self, *, eval_dataset, metric_key_prefix):
            assert eval_dataset is self.validation
            calls.append((metric_key_prefix, eval_dataset))
            if fail_at == metric_key_prefix: raise ValueError("synthetic-private-evaluation-failure")
            value = baseline if metric_key_prefix == "baseline_validation" else candidate
            return {metric_key_prefix + "_loss": value, "private": "must-not-be-copied"}
        def train(self):
            calls.append(("train",))
            return SimpleNamespace(metrics={"loss": 2.0, "baseline_validation_loss": 999.0})
    monkeypatch.setitem(sys.modules, "transformers", SimpleNamespace(Trainer=Trainer,
        TrainerCallback=type("Callback", (), {}), DataCollatorForLanguageModeling=lambda **_: object()))
    def run(**options):
        return train_model_module._run_trainer(object(), object(), {"train": [1, 2]}, options.pop("validation", validation),
            SimpleNamespace(output_dir="synthetic-checkpoints"), **options)
    return run, calls, validation


def test_validation_baseline_compares_same_bounded_subset_before_and_after_training(monkeypatch):
    run, calls, original = _validation_comparison_fixture(monkeypatch)
    metrics, checkpoints = run(compare_validation_baseline=True)
    assert [row[0] for row in calls] == ["select", "create", "baseline_validation", "train", "trained_validation"]
    assert calls[0][1] == tuple(range(32))
    selected = calls[1][1]
    assert selected is not original and selected.rows == list(range(32))
    assert calls[2][1] is calls[4][1] is selected
    assert metrics == {"loss": 2.0, "baseline_validation_loss": 4.0, "trained_validation_loss": 3.0,
                       "validation_loss_delta": -1.0, "validation_sample_count": 32.0}
    assert checkpoints == [] and "private" not in json.dumps(metrics)


def test_validation_baseline_is_opt_in_and_does_not_change_ordinary_training(monkeypatch):
    run, calls, validation = _validation_comparison_fixture(monkeypatch)
    metrics, _ = run()
    assert calls == [("create", validation), ("train",)]
    assert metrics == {"loss": 2.0, "baseline_validation_loss": 999.0}


@pytest.mark.parametrize("value", [None, 1, "true", {}, []])
def test_validation_baseline_requires_an_explicit_internal_boolean(monkeypatch, value):
    run, calls, _ = _validation_comparison_fixture(monkeypatch)
    with pytest.raises(ValueError): run(compare_validation_baseline=value)
    assert calls == []


@pytest.mark.parametrize("missing", [None, []])
def test_validation_baseline_missing_data_fails_before_trainer_or_training(monkeypatch, missing):
    run, calls, _ = _validation_comparison_fixture(monkeypatch)
    with pytest.raises(ValueError): run(compare_validation_baseline=True, validation=missing)
    assert calls == []


@pytest.mark.parametrize("baseline,candidate", [(True, 1.0), (float("nan"), 1.0), (float("inf"), 1.0), (-1.0, 1.0),
                                               (1.0, False), (1.0, float("nan")), (1.0, float("inf")), (1.0, -1.0), (1.0, "1.0")])
def test_validation_baseline_rejects_invalid_measurements_without_success(monkeypatch, baseline, candidate):
    run, calls, _ = _validation_comparison_fixture(monkeypatch, baseline=baseline, candidate=candidate)
    with pytest.raises(ValueError): run(compare_validation_baseline=True)
    if type(baseline) is not float or not 0 <= baseline < float("inf"):
        assert not any(row[0] == "train" for row in calls)


@pytest.mark.parametrize("stage", ["baseline_validation", "trained_validation"])
def test_validation_baseline_supplier_failure_is_not_retried_or_hidden(monkeypatch, stage):
    run, calls, _ = _validation_comparison_fixture(monkeypatch, fail_at=stage)
    with pytest.raises(ValueError, match="The validation comparison could not be measured.") as failure:
        run(compare_validation_baseline=True)
    assert str(failure.value.__cause__) == "synthetic-private-evaluation-failure"
    assert "private" not in str(failure.value)
    assert sum(row[0] == stage for row in calls) == 1
    assert sum(row[0] == "train" for row in calls) == (0 if stage == "baseline_validation" else 1)


def test_validation_baseline_small_dataset_uses_only_its_available_rows(monkeypatch):
    run, calls, validation = _validation_comparison_fixture(monkeypatch, baseline=0.0, candidate=0.0)
    validation.rows = ["first", "second"]
    metrics, _ = run(compare_validation_baseline=True)
    assert calls[0] == ("select", (0, 1))
    assert metrics["validation_sample_count"] == 2.0 and metrics["validation_loss_delta"] == 0.0


@pytest.mark.parametrize("report", [{}, {"wrong_loss": 1.0}, {"baseline_validation_loss": None}, [], None])
def test_validation_baseline_missing_or_foreign_supplier_keys_do_not_become_zero(report):
    with pytest.raises(ValueError): train_model_module._validation_loss(report, "baseline_validation_loss")


@pytest.mark.parametrize("key,value", [("validation_sample_count", 0.0), ("validation_sample_count", 33.0),
                                      ("validation_sample_count", 1.5), ("validation_loss_delta", 1.0),
                                      ("validation_loss_delta", float("nan")), ("baseline_validation_loss", True)])
def test_validation_baseline_history_requires_consistent_measured_facts(key, value):
    metrics = {"baseline_validation_loss": 4.0, "trained_validation_loss": 3.0,
               "validation_sample_count": 2.0, "validation_loss_delta": -1.0}
    metrics[key] = value
    with pytest.raises(ValueError): train_model_module._validation_comparison_report(metrics)


def test_validation_baseline_wrong_subset_size_cannot_silently_expand_evaluation(monkeypatch):
    run, calls, validation = _validation_comparison_fixture(monkeypatch)
    validation.select = lambda _: validation
    with pytest.raises(ValueError): run(compare_validation_baseline=True)
    assert calls == []


@pytest.mark.parametrize("value", [1, "true", None])
def test_validation_baseline_invalid_private_option_fails_before_model_paths_or_output(monkeypatch, tmp_path, value):
    request = _request(tmp_path)
    monkeypatch.setattr(train_model_module, "_local_training_model_reference", lambda _: pytest.fail("No model path inspection."))
    with pytest.raises(ValueError): train_model_module.train_model_from_local_files(request, compare_validation_baseline=value)
    assert not (tmp_path / "out").exists()


def test_validation_baseline_cannot_select_the_ordinary_download_capable_loader(tmp_path):
    request = _request(tmp_path)
    with pytest.raises(ValueError): train_model_module._train_model(request, compare_validation_baseline=True)
    assert not (tmp_path / "out").exists()


@pytest.mark.parametrize("phase,expected_training", [("baseline-validation", 0), ("training", 0), ("trained-validation", 1), ("comparison-complete", 1)])
def test_validation_baseline_checks_existing_cancellation_at_each_phase(monkeypatch, phase, expected_training):
    run, calls, _ = _validation_comparison_fixture(monkeypatch)
    cancellation = train_model_module.TrainingCancellationRequested("synthetic-cancelled")
    phases = []
    def progress(value):
        phases.append(value)
        if value == phase: raise cancellation
    with pytest.raises(train_model_module.TrainingCancellationRequested) as failure:
        run(compare_validation_baseline=True, on_validation_progress=progress)
    assert failure.value is cancellation and phases[-1] == phase
    assert sum(row[0] == "train" for row in calls) == expected_training


def test_validation_baseline_evaluator_cancellation_keeps_original_identity():
    cancellation = train_model_module.TrainingCancellationRequested("synthetic-cancelled")
    class CancelledTrainer:
        def evaluate(self, **_): raise cancellation
    with pytest.raises(train_model_module.TrainingCancellationRequested) as failure:
        train_model_module._measure_validation_loss(CancelledTrainer(), object(), "baseline_validation")
    assert failure.value is cancellation


def _inert_transformers(monkeypatch, fail_at=None, *, successful_output=False):
    calls = []
    def tokenizer(reference, **kwargs):
        calls.append(("tokenizer", reference, kwargs))
        if fail_at == "tokenizer":
            raise OSError("Synthetic local tokenizer refusal.")
        return _FakeTokenizer() if successful_output else SimpleNamespace(pad_token="<pad>", eos_token="<eos>")
    def model(reference, **kwargs):
        calls.append(("model", reference, kwargs))
        if fail_at == "model":
            raise OSError("Synthetic local model refusal.")
        return _FakeModel() if successful_output else SimpleNamespace()
    monkeypatch.setitem(sys.modules, "transformers", SimpleNamespace(
        AutoTokenizer=SimpleNamespace(from_pretrained=tokenizer),
        AutoModelForCausalLM=SimpleNamespace(from_pretrained=model),
        BitsAndBytesConfig=lambda **kwargs: kwargs,
    ))
    monkeypatch.setitem(sys.modules, "torch", SimpleNamespace(cuda=SimpleNamespace(is_available=lambda: True), float16="float16"))
    monkeypatch.setitem(sys.modules, "bitsandbytes", SimpleNamespace())
    return calls


@pytest.mark.parametrize("method", ["lora", "qlora", "full-finetune"])
def test_private_training_loader_uses_only_local_safe_weights(monkeypatch, tmp_path, method):
    calls = _inert_transformers(monkeypatch)
    train_model_module._load_transformers_objects(str(tmp_path), method, {}, local_files_only=True)
    assert [call[0] for call in calls] == ["tokenizer", "model"]
    assert all(call[1] == str(tmp_path) for call in calls)
    assert calls[0][2] == {"use_fast": True, "local_files_only": True, "trust_remote_code": False, "token": False}
    expected = {"local_files_only": True, "trust_remote_code": False, "token": False, "use_safetensors": True, "weights_only": True}
    if method == "qlora":
        expected.update(device_map="auto", quantization_config={"load_in_4bit": True, "load_in_8bit": False,
            "bnb_4bit_quant_type": "nf4", "bnb_4bit_compute_dtype": "float16"})
    assert calls[1][2] == expected


def test_ordinary_training_loader_keeps_its_existing_defaults(monkeypatch):
    calls = _inert_transformers(monkeypatch)
    train_model_module._load_transformers_objects("synthetic/base", "full-finetune", {})
    assert calls == [("tokenizer", "synthetic/base", {"use_fast": True}), ("model", "synthetic/base", {})]


@pytest.mark.parametrize("value", [None, "", "synthetic/base", "https://example.invalid/model", "missing", "file"])
def test_private_training_requires_a_local_directory_before_output_or_dataset_io(monkeypatch, tmp_path, value):
    payload = _request(tmp_path)
    if value == "missing":
        value = str(tmp_path / "missing-model")
    elif value == "file":
        file = tmp_path / "not-a-model-directory"
        file.write_bytes(b"synthetic")
        value = str(file)
    payload.baseModel.localPath = value
    monkeypatch.setattr(train_model_module, "_load_dataset", lambda *args: pytest.fail("Invalid source reached dataset IO."))
    calls = _inert_transformers(monkeypatch)
    with pytest.raises(ValueError, match="^A local model directory is required for private training\\.$"):
        train_model_module.train_model_from_local_files(payload)
    assert calls == [] and not (tmp_path / "out").exists()


@pytest.mark.parametrize("training_task", sorted(train_model_module.NON_TEXT_TRAINING_TASKS))
def test_private_training_refuses_unqualified_multimodal_loaders_before_effects(monkeypatch, tmp_path, training_task):
    payload = _request(tmp_path, training_task=training_task)
    payload.baseModel.localPath = str(tmp_path)
    monkeypatch.setattr(train_model_module, "_load_dataset", lambda *args: pytest.fail("Unsupported task reached dataset IO."))
    calls = _inert_transformers(monkeypatch)
    with pytest.raises(ValueError, match="^This private training task is unavailable\\.$"):
        train_model_module.train_model_from_local_files(payload)
    assert calls == [] and not (tmp_path / "out").exists()


@pytest.mark.parametrize("training_task", sorted(train_model_module.TEXT_CAUSAL_TRAINING_TASKS))
@pytest.mark.parametrize("fail_at", ["tokenizer", "model"])
def test_private_training_captures_original_directory_and_never_retries_ordinary_loader(monkeypatch, tmp_path, training_task, fail_at):
    payload = _request(tmp_path, training_task=training_task)
    local_model = tmp_path / "original-model"
    local_model.mkdir()
    payload.baseModel.localPath = str(local_model)
    monkeypatch.setattr(train_model_module, "_load_dataset", lambda *args: ({"train": object()}, None))
    calls = _inert_transformers(monkeypatch, fail_at)
    def progress(record):
        if record["stage"] == "initializing":
            payload.baseModel.localPath = None
            payload.baseModel.modelId = "synthetic/changed-provider"
    result = train_model_module.train_model_from_local_files(payload, on_progress=progress)
    assert result.status == "failed" and result.generatedModelCandidate is None
    assert result.error["details"]["stage"] == "model-loading"
    assert len(calls) == (1 if fail_at == "tokenizer" else 2)
    assert all(reference == str(local_model) and kwargs["local_files_only"] is True
               and kwargs["trust_remote_code"] is False and kwargs["token"] is False
               for _, reference, kwargs in calls)
    if fail_at == "model":
        assert calls[1][2]["use_safetensors"] is True and calls[1][2]["weights_only"] is True


def test_private_training_keeps_installed_cuda_requirement(monkeypatch, tmp_path):
    calls = _inert_transformers(monkeypatch)
    monkeypatch.setitem(sys.modules, "torch", SimpleNamespace(cuda=SimpleNamespace(is_available=lambda: False)))
    with pytest.raises(RuntimeError, match="QLoRA requires CUDA"):
        train_model_module._load_transformers_objects(str(tmp_path), "qlora", {}, local_files_only=True)
    assert calls == []


@pytest.mark.parametrize("mode,attributes", [(0o120777, 0), (0o040700, 0x400)])
def test_private_training_refuses_link_or_reparse_root_before_effects(monkeypatch, tmp_path, mode, attributes):
    payload = _request(tmp_path)
    root = tmp_path / "synthetic-model-root"
    root.mkdir()
    payload.baseModel.localPath = str(root)
    original = Path.lstat
    def lstat(path, *args, **kwargs):
        return SimpleNamespace(st_mode=mode, st_file_attributes=attributes) if path == root else original(path, *args, **kwargs)
    monkeypatch.setattr(Path, "lstat", lstat)
    calls = _inert_transformers(monkeypatch)
    with pytest.raises(ValueError, match="^A local model directory is required for private training\\.$"):
        train_model_module.train_model_from_local_files(payload)
    assert calls == [] and not (tmp_path / "out").exists()


@pytest.mark.parametrize("compare", [False, True])
def test_private_local_training_serializes_calls_validation_and_returns_candidate(monkeypatch, tmp_path, compare):
    payload = _request(tmp_path)
    payload.baseModel.localPath = str(tmp_path)
    calls = _inert_transformers(monkeypatch, successful_output=True)
    monkeypatch.setattr(train_model_module, "_load_dataset", lambda payload: ({"train": object()}, None))
    monkeypatch.setattr(train_model_module, "_tokenize_dataset", _tokenize_fixture)
    monkeypatch.setattr(train_model_module, "_apply_lora", lambda model, payload: model)
    monkeypatch.setattr(train_model_module, "_build_training_args", lambda payload, output: SimpleNamespace(output_dir=str(output / "ckpt")))
    measured = {"loss": 0.125, **({"baseline_validation_loss": 4.0, "trained_validation_loss": 3.0,
                    "validation_loss_delta": -1.0, "validation_sample_count": 2.0} if compare else {})}
    observed_progress = []
    def run_trainer(*args, **kwargs):
        assert kwargs.get("compare_validation_baseline", False) is compare
        if compare:
            for phase in ("baseline-validation", "training", "trained-validation", "comparison-complete"):
                kwargs["on_validation_progress"](phase)
        return measured, []
    monkeypatch.setattr(train_model_module, "_run_trainer", run_trainer)
    validated = []
    def validate(output, **kwargs):
        # Test the actual orchestration/serialization handoff, not tensor loading.
        # A fake Torch module must never enter the real native tensor reader.
        assert (output / "adapter_model.safetensors").is_file()
        assert kwargs == {"expected_lora": True, "expected_recurrent_additions": False}
        validated.append(output)
        return {"status": "valid", "warnings": [], "errors": [], "validationReportPath": "synthetic-validation",
                "serializationFormat": "adapter-safetensors"}
    monkeypatch.setattr(train_model_module, "validate_model_output", validate)
    result = train_model_module.train_model_from_local_files(payload, compare_validation_baseline=compare, on_progress=observed_progress.append)
    assert result.status == "succeeded" and result.metrics == measured
    assert result.generatedModelCandidate["artifactForm"] == "adapter"
    assert result.generatedModelCandidate["baseModelId"] == "org/base"
    assert result.generatedModelCandidate["metadata"]["validation"]["validationReportPath"]
    assert (tmp_path / "out" / "adapter_model.safetensors").is_file()
    assert (tmp_path / "out" / "training-run.json").is_file()
    run_history = json.loads((tmp_path / "out" / "training-run.json").read_text(encoding="utf8"))
    if compare:
        expected = {"protocol": "fixed-first-32-validation-loss-v1", "maximumRows": 32, "sampleCount": 2,
                    "baselineLoss": 4.0, "trainedLoss": 3.0, "lossDelta": -1.0, "interpretation": "measurement-only"}
        assert run_history["validationComparison"] == result.generatedModelCandidate["metadata"]["validationComparison"] == expected
        assert "passed" not in json.dumps(expected) and "accuracy" not in json.dumps(expected)
        assert [row["stage"] for row in observed_progress if row.get("stage") in {"baseline-validation", "trained-validation", "comparison-complete"}] == ["baseline-validation", "trained-validation", "comparison-complete"]
    else:
        assert "validationComparison" not in run_history and "validationComparison" not in result.generatedModelCandidate["metadata"]
    assert validated == [tmp_path / "out"]
    assert [call[0] for call in calls] == ["tokenizer", "model"]
    assert calls[1][2]["use_safetensors"] is True


@pytest.mark.parametrize("entry", ["orchestration", "loader"])
@pytest.mark.parametrize("config_kind", ["adapter", "malformed", "directory"])
def test_private_training_refuses_adapter_roots_before_imports_or_output(monkeypatch, tmp_path, entry, config_kind):
    import builtins
    payload = _request(tmp_path)
    payload.baseModel.localPath = str(tmp_path)
    config = tmp_path / "adapter_config.json"
    if config_kind == "directory":
        config.mkdir()
    else:
        config.write_text('{"base_model_name_or_path":"synthetic/unapproved-base"}' if config_kind == "adapter" else "not-json")
    (tmp_path / "adapter_model.bin").write_bytes(b"inert fixture; never deserialized")
    original = builtins.__import__
    def no_engine_import(name, *args, **kwargs):
        if name in {"transformers", "datasets", "torch", "peft"}:
            pytest.fail("An adapter root reached a training supplier import.")
        return original(name, *args, **kwargs)
    monkeypatch.setattr(builtins, "__import__", no_engine_import)
    with pytest.raises(ValueError, match="^Adapter model loading is unavailable for private training\\.$"):
        if entry == "orchestration":
            train_model_module.train_model_from_local_files(payload)
        else:
            train_model_module._load_transformers_objects(str(tmp_path), "lora", {}, local_files_only=True)
    assert not (tmp_path / "out").exists()


def test_private_training_rechecks_adapter_refusal_after_progress_before_dataset_io(monkeypatch, tmp_path):
    payload = _request(tmp_path)
    payload.baseModel.localPath = str(tmp_path)
    dataset_reads = []
    def unexpected_dataset_read(*args):
        dataset_reads.append(True)
        raise RuntimeError("Synthetic unexpected dataset read.")
    monkeypatch.setattr(train_model_module, "_load_dataset", unexpected_dataset_read)
    def progress(record):
        if record["stage"] == "initializing":
            (tmp_path / "adapter_config.json").write_text("{}")
    result = train_model_module.train_model_from_local_files(payload, on_progress=progress)
    assert result.status == "failed" and result.error["details"]["stage"] == "base-model-resolution"
    assert dataset_reads == []


def test_private_training_rechecks_adapter_refusal_after_tokenizer_before_model_factory(monkeypatch, tmp_path):
    calls = _inert_transformers(monkeypatch)
    original = sys.modules["transformers"].AutoTokenizer.from_pretrained
    def tokenizer(reference, **kwargs):
        (tmp_path / "adapter_config.json").write_text("{}")
        return original(reference, **kwargs)
    monkeypatch.setattr(sys.modules["transformers"].AutoTokenizer, "from_pretrained", tokenizer)
    with pytest.raises(ValueError, match="^Adapter model loading is unavailable for private training\\.$"):
        train_model_module._load_transformers_objects(str(tmp_path), "lora", {}, local_files_only=True)
    assert [call[0] for call in calls] == ["tokenizer"]


@pytest.mark.parametrize("entry", ["orchestration", "loader"])
def test_private_training_refuses_unknown_adapter_config_presence(monkeypatch, tmp_path, entry):
    payload = _request(tmp_path)
    payload.baseModel.localPath = str(tmp_path)
    original = Path.lstat
    def lstat(path, *args, **kwargs):
        if path == tmp_path / "adapter_config.json":
            raise PermissionError("Synthetic inaccessible entry.")
        return original(path, *args, **kwargs)
    monkeypatch.setattr(Path, "lstat", lstat)
    calls = _inert_transformers(monkeypatch)
    monkeypatch.setattr(train_model_module, "_load_dataset", lambda *args: ({"train": object()}, None))
    with pytest.raises(ValueError, match="^A local model directory is required for private training\\.$"):
        if entry == "orchestration":
            train_model_module.train_model_from_local_files(payload)
        else:
            train_model_module._load_transformers_objects(str(tmp_path), "lora", {}, local_files_only=True)
    assert calls == [] and not (tmp_path / "out").exists()


def test_ordinary_training_loader_keeps_adapter_loading_policy(monkeypatch, tmp_path):
    (tmp_path / "adapter_config.json").write_text("{}")
    calls = _inert_transformers(monkeypatch)
    train_model_module._load_transformers_objects(str(tmp_path), "lora", {})
    assert calls == [("tokenizer", str(tmp_path), {"use_fast": True}), ("model", str(tmp_path), {})]


def _request(tmp_path: Path, method: str = "lora", training_task: str = "llm-instruction") -> TrainModelTaskRequest:
    dataset_path = tmp_path / "train.jsonl"
    dataset_path.write_text('{"text":"hello"}\n', encoding="utf-8")
    return TrainModelTaskRequest.model_validate(
        {
            "trainingTask": training_task,
            "baseModel": {"modelRecordId": "base-1", "modelId": "org/base"},
            "datasets": [{"artifactId": "dataset-1", "splitRole": "train", "path": str(dataset_path), "format": "jsonl"}],
            "method": method,
            "commonParameters": {"numEpochs": 1},
            "output": {"outputModelName": "demo-adapter", "outputDirectory": str(tmp_path / "out")},
            "validation": {"enabled": True, "expectedLoRA": method in {"lora", "qlora"}},
        }
    )


class _FakeModel:
    def save_pretrained(self, output: str, safe_serialization: bool = True, max_shard_size: str | None = None):
        out = Path(output)
        out.mkdir(parents=True, exist_ok=True)
        header = json.dumps({"test.lora_A.weight": {"dtype": "F32", "shape": [1], "data_offsets": [0, 4]}}).encode()
        header += b" " * (-len(header) % 8)
        (out / "adapter_model.safetensors").write_bytes(len(header).to_bytes(8, "little") + header + b"\x00" * 4)
        (out / "adapter_config.json").write_text("{}", encoding="utf-8")


class _FakeTokenizer:
    pad_token = None
    eos_token = "<eos>"

    def save_pretrained(self, output: str):
        out = Path(output)
        out.mkdir(parents=True, exist_ok=True)
        (out / "tokenizer.json").write_text("{}", encoding="utf-8")


@pytest.mark.parametrize("operation,stage", [
    ("_resolve_training_purpose_paths", "purpose-mapping"),
    ("_resolve_base_model", "base-model-resolution"),
    ("_load_dataset", "dataset-loading"),
    ("_load_transformers_objects", "model-loading"),
    ("_resolve_effective_sequence_length", "sequence-length"),
    ("_tokenize_dataset", "tokenization"),
    ("_apply_lora", "adapter-configuration"),
    ("_build_training_args", "training-arguments"),
    ("_run_trainer", "training-loop"),
    ("save_adapter_pretrained", "serialization"),
    ("validate_model_output", "validation"),
    ("write_serialization_manifest", "serialization-manifest"),
    ("_write_run_metadata", "run-metadata"),
    ("_training_task_tags", "generated-candidate"),
])
def test_caught_training_failures_identify_only_fixed_stage_and_error_type(monkeypatch, tmp_path, operation, stage):
    # Exercise the real orchestration with inert suppliers, never Torch or a model.
    monkeypatch.setattr(train_model_module, "_load_dataset", lambda payload: ({"train": object()}, None))
    monkeypatch.setattr(train_model_module, "_resolve_base_model", lambda payload: "synthetic/base")
    monkeypatch.setattr(train_model_module, "_load_transformers_objects", lambda *args: (_FakeModel(), _FakeTokenizer()))
    monkeypatch.setattr(train_model_module, "_tokenize_dataset", lambda *args, **kwargs: {"train": object()})
    monkeypatch.setattr(train_model_module, "_apply_lora", lambda model, payload: model)
    monkeypatch.setattr(train_model_module, "_build_training_args", lambda *args: object())
    monkeypatch.setattr(train_model_module, "_run_trainer", lambda *args, **kwargs: ({}, []))
    def fail(*args, **kwargs):
        raise ValueError("private-synthetic-message C:\\private\\model")
    monkeypatch.setattr(train_model_module, operation, fail)
    result = train_model_module.train_model(_request(tmp_path))
    assert result.status == "failed" and result.generatedModelCandidate is None
    assert result.error["code"] == "training_failed"
    # Preserve the existing task error semantics; the new details carry no text.
    assert result.error["message"] == "private-synthetic-message C:\\private\\model"
    assert result.error["details"] == {
        "method": "lora", "trainingTask": "llm-instruction",
        "stage": stage, "errorType": "ValueError",
    }
    assert "private" not in json.dumps(result.error["details"])


def test_training_error_type_does_not_read_custom_error_text_or_names():
    class PrivateError(RuntimeError):
        def __str__(self):
            raise AssertionError("Diagnostic type projection must not read error text.")
    assert train_model_module._training_error_type(PrivateError()) == "OtherError"
    for error, expected in [(ValueError(), "ValueError"), (RuntimeError(), "RuntimeError"),
                            (TypeError(), "TypeError"), (MemoryError(), "MemoryError"),
                            (ImportError(), "ImportError"), (ModuleNotFoundError(), "ModuleNotFoundError")]:
        assert train_model_module._training_error_type(error) == expected


def test_resolve_effective_sequence_length_clamps_to_model_context_window() -> None:
    model = SimpleNamespace(config=SimpleNamespace(n_positions=1024))
    tokenizer = SimpleNamespace(model_max_length=2048)

    length, warning = train_model_module._resolve_effective_sequence_length(model, tokenizer, 2048)

    assert length == 1024
    assert warning is not None
    assert "position embedding overflow" in warning


def test_resolve_effective_sequence_length_ignores_transformers_sentinel_tokenizer_limit() -> None:
    model = SimpleNamespace(config=SimpleNamespace())
    tokenizer = SimpleNamespace(model_max_length=1000000000000000019884624838656)

    length, warning = train_model_module._resolve_effective_sequence_length(model, tokenizer, 2048)

    assert length == 2048
    assert warning is None


def test_synchronize_model_token_embeddings_resizes_when_tokenizer_has_added_tokens() -> None:
    class _Embedding:
        num_embeddings = 10

    class _TokenizerWithAddedTokens:
        def __len__(self):
            return 12

    class _ResizableModel:
        resized_to: int | None = None

        def get_input_embeddings(self):
            return _Embedding()

        def resize_token_embeddings(self, size: int) -> None:
            self.resized_to = size

    model = _ResizableModel()

    train_model_module._synchronize_model_token_embeddings(model, _TokenizerWithAddedTokens())

    assert model.resized_to == 12


def test_protected_tokenization_uses_installed_memory_sdk_without_cache_or_pickling(monkeypatch):
    import builtins
    import os
    import socket
    import tempfile
    from datasets import Dataset, DatasetDict, fingerprint
    from datasets.table import InMemoryTable
    datasets = DatasetDict({
        "train": Dataset.from_dict({"text": ["Payment failed", "Need receipt"], "label": ["billing", "records"]}),
        "validation": Dataset.from_dict({"text": ["Payment accepted"], "label": ["billing"]}),
    })
    before = {name: split.to_dict() for name, split in datasets.items()}
    original_hash = fingerprint.Hasher.hash.__func__
    def no_capability_hash(cls, value):
        if callable(value) and getattr(value, "__name__", None) == "tokenize":
            pytest.fail("The SDK tried to fingerprint the protected tokenization closure")
        return original_hash(cls, value)
    seen=[]
    class Tokenizer:
        def __call__(self, texts, **options):
            assert len(texts)==1 and options=={"truncation":True,"padding":"max_length","max_length":8}
            seen.extend(texts)
            return {"input_ids":[[len(texts[0]),2]], "attention_mask":[[1,1]]}
        def __getstate__(self):
            pytest.fail("The SDK tried to serialize the protected tokenizer")
    def no_effect(*args, **kwargs): pytest.fail("In-memory tokenization attempted filesystem/network/process effects")
    with _protected_tensor_selection_fixture(monkeypatch) as facts:
        _,use,*_=facts
        with monkeypatch.context() as effects:
            effects.setattr(fingerprint.Hasher,"hash",classmethod(no_capability_hash))
            effects.setattr(builtins,"open",no_effect)
            effects.setattr(os,"open",no_effect)
            effects.setattr(os,"makedirs",no_effect)
            effects.setattr(tempfile,"NamedTemporaryFile",no_effect)
            effects.setattr(socket,"create_connection",no_effect)
            result=train_model_module._tokenize_dataset(datasets,Tokenizer(),8,_protected_use=use)
        assert seen==["Text:\nPayment failed\nLabel:\nbilling","Text:\nNeed receipt\nLabel:\nrecords",
                      "Text:\nPayment accepted\nLabel:\nbilling"]
        assert type(result) is DatasetDict and list(result)==["train","validation"]
        for name,split in result.items():
            assert type(split._data) is InMemoryTable and split.cache_files==[]
            assert len(split)==len(before[name]["text"])
            rows=split.to_dict()
            assert rows["input_ids"]==rows["labels"]
            expected_texts=seen[:2] if name=="train" else seen[2:]
            assert rows["input_ids"]==[[len(text),2] for text in expected_texts]
            assert rows["attention_mask"]==[[1,1]]*len(split)
            assert split._fingerprint==use._run_identity[0].replace("-","")+"_"+name+"_tokens_v1"
        assert {name:split.to_dict() for name,split in datasets.items()}==before


@pytest.mark.parametrize("mode",["plain-dict","foreign-split","held-out","missing-train","empty","disk-table","indices","custom-format"])
def test_protected_tokenization_rejects_unowned_memory_shapes_before_mapping(monkeypatch,mode):
    from datasets import Dataset, DatasetDict
    source=Dataset.from_dict({"text":["Synthetic input"]})
    datasets=DatasetDict({"train":source})
    if mode=="plain-dict": datasets=dict(datasets)
    elif mode=="foreign-split": datasets["train"]=SimpleNamespace(column_names=["text"])
    elif mode=="held-out": datasets["test"]=source
    elif mode=="missing-train": datasets=DatasetDict({"validation":source})
    elif mode=="empty": datasets["train"]=Dataset.from_dict({"text":[]})
    elif mode=="disk-table": source.__dict__["_data"]=object()
    elif mode=="indices": source.__dict__["_indices"]=object()
    elif mode=="custom-format": source.set_format("custom",transform=lambda value:pytest.fail("Custom formatting ran"))
    def no_map(*args,**kwargs): pytest.fail("An invalid private dataset reached mapping")
    monkeypatch.setattr(Dataset,"map",no_map)
    with _protected_tensor_selection_fixture(monkeypatch) as facts:
        _,use,*_=facts
        with pytest.raises(ValueError,match="private.*dataset"):
            train_model_module._tokenize_dataset(datasets,no_map,8,_protected_use=use)


@pytest.mark.parametrize("mode",["permission-loss","split-replacement","map-failure"])
def test_protected_tokenization_refuses_callback_loss_without_partial_result(monkeypatch,mode):
    from datasets import Dataset, DatasetDict
    datasets=DatasetDict({"train":Dataset.from_dict({"text":["Synthetic train"]}),
                          "validation":Dataset.from_dict({"text":["Synthetic validation"]})})
    replacement=Dataset.from_dict({"text":["Changed"]})
    calls=[]
    with _protected_tensor_selection_fixture(monkeypatch) as facts:
        actual,use,_,_,_,control,*_=facts
        def tokenizer(texts,**options):
            calls.extend(texts)
            if mode=="permission-loss": control.current=False
            elif mode=="split-replacement": datasets["validation"]=replacement
            else: raise RuntimeError("Synthetic mapper failure")
            return {"input_ids":[[1]],"attention_mask":[[1]]}
        with pytest.raises((ValueError,RuntimeError,actual.LaunchUnavailable)):
            train_model_module._tokenize_dataset(datasets,tokenizer,8,_protected_use=use)
        assert calls==["Synthetic train"]


def test_protected_tokenization_keeps_the_original_sdk_mapper_across_callbacks(monkeypatch):
    from datasets import Dataset, DatasetDict
    datasets=DatasetDict({"train":Dataset.from_dict({"text":["Train"]}),
                          "validation":Dataset.from_dict({"text":["Validation"]})})
    calls=[]
    def replacement(*args,**kwargs): pytest.fail("A callback replaced the original SDK mapper")
    with _protected_tensor_selection_fixture(monkeypatch) as facts:
        _,use,*_=facts
        def tokenizer(texts,**options):
            calls.extend(texts)
            monkeypatch.setattr(Dataset,"map",replacement)
            return {"input_ids":[[1]],"attention_mask":[[1]]}
        result=train_model_module._tokenize_dataset(datasets,tokenizer,8,_protected_use=use)
        assert calls==["Train","Validation"]
        assert result["train"].to_dict()=={"input_ids":[[1]],"attention_mask":[[1]],"labels":[[1]]}
        assert result["validation"].to_dict()==result["train"].to_dict()


@pytest.mark.parametrize("mode",["split-replacement","arrow-replacement","format-replacement"])
def test_protected_tokenization_stops_source_drift_before_a_second_row(monkeypatch,mode):
    from datasets import Dataset, DatasetDict
    source=Dataset.from_dict({"text":["Original first","Original second"]})
    replacement=Dataset.from_dict({"text":["Changed first","Changed second"]})
    datasets=DatasetDict({"train":source})
    wrapper=source._data
    calls=[]
    with _protected_tensor_selection_fixture(monkeypatch) as facts:
        _,use,*_=facts
        def tokenizer(texts,**options):
            calls.extend(texts)
            if mode=="split-replacement": datasets["train"]=replacement
            elif mode=="arrow-replacement": wrapper.table=replacement._data.table
            else: source.__dict__["_format_kwargs"]={"changed":True}
            return {"input_ids":[[1]],"attention_mask":[[1]]}
        with pytest.raises(ValueError,match="private.*(dataset|table)"):
            train_model_module._tokenize_dataset(datasets,tokenizer,8,_protected_use=use)
        assert calls==["Original first"]


@pytest.mark.parametrize("nested",[False,True])
def test_protected_tokenization_treats_sdk_feature_paths_as_data(monkeypatch,nested):
    from datasets import Dataset, DatasetDict, Features, Image
    from PIL import Image as PillowImage
    image={"bytes":None,"path":"X:/unapproved/synthetic.png"}
    value={"picture":image} if nested else image
    feature={"picture":Image()} if nested else Image()
    source=Dataset.from_dict({"text":[value]},features=Features({"text":feature}))
    original_table=source._data.table
    original_metadata=dict(original_table.schema.metadata)
    calls=[]; path_reads=[]
    def no_path_read(path,*args,**kwargs):
        path_reads.append(path)
        pytest.fail("SDK feature metadata selected a file or URL decoder")
    with _protected_tensor_selection_fixture(monkeypatch) as facts:
        _,use,*_=facts
        monkeypatch.setattr(PillowImage,"open",no_path_read)
        def tokenizer(texts,**options):
            calls.extend(texts)
            return {"input_ids":[[1]],"attention_mask":[[1]]}
        result=train_model_module._tokenize_dataset(DatasetDict({"train":source}),tokenizer,8,_protected_use=use)
        assert path_reads==[] and len(calls)==1 and json.loads(calls[0])==value
        assert result["train"].to_dict()=={"input_ids":[[1]],"attention_mask":[[1]],"labels":[[1]]}
        assert source._data.table is original_table and dict(source._data.table.schema.metadata)==original_metadata


def test_tokenize_dataset_formats_classification_rows_for_causal_training() -> None:
    class _Split:
        column_names = ["text", "label"]

    class _DatasetDict(dict):
        def __init__(self):
            super().__init__({"train": _Split()})

        def map(self, callback, *, batched: bool, remove_columns: list[str]):
            assert batched is True
            assert remove_columns == ["text", "label"]
            return callback({"text": ["Payment failed"], "label": ["billing"]})

    class _Tokenizer:
        captured_texts: list[str] | None = None

        def __call__(self, texts, **_kwargs):
            self.captured_texts = texts
            return {"input_ids": [[1, 2, 3]]}

    tokenizer = _Tokenizer()

    tokenized = train_model_module._tokenize_dataset(_DatasetDict(), tokenizer, 128)

    assert tokenizer.captured_texts == ["Text:\nPayment failed\nLabel:\nbilling"]
    assert tokenized["labels"] == [[1, 2, 3]]


def test_tokenize_dataset_uses_nested_purpose_paths_for_custom_instruction_fields() -> None:
    class _Split:
        column_names = ["request", "result"]

    class _DatasetDict(dict):
        def __init__(self):
            super().__init__({"train": _Split()})

        def map(self, callback, *, batched: bool, remove_columns: list[str]):
            assert batched is True
            assert remove_columns == ["request", "result"]
            return callback(
                {
                    "request": [
                        {
                            "task": "Answer the input using only the context.",
                            "input": "What does the policy say?",
                            "context": "Policy text",
                        }
                    ],
                    "result": [
                        {
                            "thought": "The policy text directly supports the explanation.",
                            "answer": "The policy explanation",
                        }
                    ],
                }
            )

    class _Tokenizer:
        captured_texts: list[str] | None = None

        def __call__(self, texts, **_kwargs):
            self.captured_texts = texts
            return {"input_ids": [[1, 2, 3]]}

    tokenizer = _Tokenizer()
    train_model_module._tokenize_dataset(
        _DatasetDict(),
        tokenizer,
        128,
        training_task="llm-instruction",
        purpose_paths={
            "instruction": ("request", "task"),
            "input": ("request", "input"),
            "context": ("request", "context"),
            "thought": ("result", "thought"),
            "output": ("result", "answer"),
        },
    )

    assert tokenizer.captured_texts == [
        "Instruction:\nAnswer the input using only the context.\nInput:\nWhat does the policy say?\nContext:\nPolicy text\nThought:\nThe policy text directly supports the explanation.\nResponse:\nThe policy explanation"
    ]


def test_training_cancellation_removes_worker_owned_output(monkeypatch, tmp_path: Path) -> None:
    payload = _request(tmp_path)
    payload.output.pop("outputDirectory", None)
    output_path = tmp_path / "cancelled-output"
    monkeypatch.setattr(
        train_model_module.tempfile,
        "mkdtemp",
        lambda prefix: str(output_path),
    )

    def cancel(_progress) -> None:
        raise train_model_module.TrainingCancellationRequested(
            "Model training cancellation requested."
        )

    try:
        train_model_module.train_model(payload, on_progress=cancel)
    except train_model_module.TrainingCancellationRequested:
        pass
    else:
        raise AssertionError("Expected cooperative training cancellation.")

    assert not output_path.exists()


def test_tokenize_dataset_maps_question_and_answer_instruction_aliases() -> None:
    class _Split:
        column_names = ["instruction", "question", "context", "answer"]

    class _DatasetDict(dict):
        def __init__(self):
            super().__init__({"train": _Split()})

        def map(self, callback, *, batched: bool, remove_columns: list[str]):
            assert batched is True
            assert remove_columns == ["instruction", "question", "context", "answer"]
            return callback(
                {
                    "instruction": ["Answer using only the supplied context."],
                    "question": ["What changed?"],
                    "context": ["The policy changed yesterday."],
                    "answer": ["The policy changed yesterday."],
                }
            )

    class _Tokenizer:
        captured_texts: list[str] | None = None

        def __call__(self, texts, **_kwargs):
            self.captured_texts = texts
            return {"input_ids": [[1, 2, 3]]}

    tokenizer = _Tokenizer()
    train_model_module._tokenize_dataset(
        _DatasetDict(),
        tokenizer,
        128,
        training_task="llm-instruction",
    )

    assert tokenizer.captured_texts == [
        "Instruction:\nAnswer using only the supplied context.\nInput:\nWhat changed?\nContext:\nThe policy changed yesterday.\nResponse:\nThe policy changed yesterday."
    ]


def test_resolve_training_purpose_paths_reads_runtime_artifact_metadata(tmp_path: Path) -> None:
    payload = _request(tmp_path)
    payload.datasets[0].metadata = {
        "artifactMetadata": {
            "runtime": {
                "structuredOutput": {
                    "schemaFingerprint": "a" * 64,
                    "purposePaths": {
                        "instruction": ["question"],
                        "output": ["answer"],
                    },
                }
            }
        }
    }

    assert train_model_module._resolve_training_purpose_paths(payload) == {
        "instruction": ("question",),
        "output": ("answer",),
    }


def test_resolve_training_purpose_paths_requires_matching_dataset_layouts(tmp_path: Path) -> None:
    payload = _request(tmp_path)
    payload.datasets[0].metadata = {
        "artifactMetadata": {
            "structuredOutput": {
                "schemaFingerprint": "a" * 64,
                "purposePaths": {
                    "instruction": ["request"],
                    "output": ["answer"],
                }
            }
        }
    }
    resolved = train_model_module._resolve_training_purpose_paths(payload)
    assert resolved == {
        "instruction": ("request",),
        "output": ("answer",),
    }

    second = payload.datasets[0].model_copy(deep=True)
    second.artifactId = "dataset-2"
    second.metadata = None
    payload.datasets.append(second)
    try:
        train_model_module._resolve_training_purpose_paths(payload)
    except ValueError as error:
        assert "same generated field layout" in str(error)
    else:
        raise AssertionError("Mixed purpose-map metadata should fail closed.")

    payload.datasets = [payload.datasets[0], payload.datasets[0].model_copy(deep=True)]
    payload.datasets[1].artifactId = "dataset-2"
    payload.datasets[1].metadata["artifactMetadata"]["structuredOutput"][
        "schemaFingerprint"
    ] = "b" * 64
    try:
        train_model_module._resolve_training_purpose_paths(payload)
    except ValueError as error:
        assert "same generated field layout" in str(error)
    else:
        raise AssertionError("Mismatched schema fingerprints should fail closed.")


def test_multimodal_label_collectors_use_nested_purpose_paths() -> None:
    purpose_paths = {"label": ("result", "category")}
    classification_rows = [{"result": {"category": "invoice"}}]
    detection_rows = [
        {
            "boundingBoxes": [[1, 2, 3, 4]],
            "boxFormat": "xywh",
            "result": {"category": "invoice"},
        }
    ]

    assert multimodal_module._collect_classification_labels(
        classification_rows, purpose_paths
    ) == ["invoice"]
    assert multimodal_module._collect_detection_labels(
        detection_rows, purpose_paths
    ) == ["invoice"]
    assert multimodal_module._collect_segmentation_labels(
        classification_rows, purpose_paths
    ) == ["invoice"]


@pytest.mark.parametrize("selection", ["empty", "validation-only", "test-only", "unknown-role"])
def test_dataset_split_preflight_runs_before_training_dependency_import(monkeypatch, tmp_path, selection):
    import builtins

    request = _request(tmp_path)
    if selection == "empty":
        request.datasets = []
    else:
        role = {"validation-only": "validation", "test-only": "test", "unknown-role": "not-a-split"}[selection]
        request.datasets = [request.datasets[0].model_copy(update={"splitRole": role})]
    imports = []
    original_import = builtins.__import__

    def guarded_import(name, *args, **kwargs):
        if name == "datasets":
            imports.append(name)
            raise AssertionError("Invalid training selections cannot load a training dependency.")
        return original_import(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", guarded_import)
    expected = "Unsupported training dataset split role" if selection == "unknown-role" else "At least one train split dataset"
    with pytest.raises(ValueError, match=expected):
        train_model_module._load_dataset(request)
    assert imports == []


@pytest.mark.parametrize("test_file_exists", [False, True])
def test_heldout_test_selection_is_not_a_training_or_validation_file(monkeypatch, tmp_path, test_file_exists):
    request = _request(tmp_path)
    heldout = tmp_path / "heldout.jsonl"
    if test_file_exists:
        heldout.write_text('{"text":"Synthetic held-out test row"}\n', encoding="utf-8")
    request.datasets.append(request.datasets[0].model_copy(update={"artifactId": "heldout-test", "splitRole": "test", "path": str(heldout)}))
    original_exists = Path.exists
    checked = []
    loaded = {"train": [{"text": "Synthetic training row"}]}

    def exists(candidate):
        checked.append(candidate)
        if candidate == heldout:
            raise AssertionError("Held-out paths cannot enter training input inspection.")
        return original_exists(candidate)

    def load_local(name, *, data_files):
        assert name == "json"
        assert data_files == {"train": [request.datasets[0].path]}
        return loaded

    monkeypatch.setattr(Path, "exists", exists)
    monkeypatch.setitem(sys.modules, "datasets", SimpleNamespace(load_dataset=load_local))
    actual, evaluation = train_model_module._load_dataset(request)
    assert actual is loaded
    assert evaluation is None
    assert heldout not in checked


def test_train_model_validates_required_inputs(tmp_path: Path) -> None:
    payload = _request(tmp_path)
    payload.datasets = []
    result = train_model_module.train_model(payload)

    assert result.status == "failed"
    assert result.error is not None
    assert "at least one" in result.error["message"].lower()


def test_train_model_rejects_missing_base_model_before_loading(monkeypatch, tmp_path: Path) -> None:
    payload = _request(tmp_path)
    payload.method = "full-finetune"
    payload.baseModel.modelId = None
    payload.baseModel.localPath = None
    def forbidden(*args, **kwargs):
        raise AssertionError("No dataset or model load is permitted before base-model preflight.")
    monkeypatch.setattr(train_model_module, "_load_dataset", forbidden)
    monkeypatch.setattr(train_model_module, "_load_transformers_objects", forbidden)

    result = train_model_module.train_model(payload)
    assert result.status == "failed"
    assert "modelid or localpath" in result.error["message"].lower()


@pytest.mark.parametrize("format_name,builder", [("jsonl", "json"), ("json", "json"), ("csv", "csv"), ("parquet", "parquet")])
@pytest.mark.parametrize("explicit_format", [True, False])
def test_local_dataset_formats_select_only_the_builtin_reader(monkeypatch, tmp_path, format_name, builder, explicit_format):
    request = _request(tmp_path)
    path = tmp_path / ("train." + format_name)
    path.write_text("fixture")
    request.datasets[0].path = str(path)
    request.datasets[0].format = format_name if explicit_format else None
    calls = []
    def load_local(name, *, data_files):
        calls.append((name, data_files))
        assert name in {"json", "csv", "parquet"}
        return {"train": [{"text": "fixture"}]}
    monkeypatch.setitem(sys.modules, "datasets", SimpleNamespace(load_dataset=load_local))
    loaded, evaluation = train_model_module._load_dataset(request)
    assert len(loaded["train"]) == 1
    assert evaluation is None
    assert calls == [(builder, {"train": [str(path)]})]


def test_local_jsonl_reader_keeps_validation_split(monkeypatch, tmp_path):
    request = _request(tmp_path)
    validation = request.datasets[0].model_copy(update={"artifactId": "validation-1", "splitRole": "validation"})
    request.datasets.append(validation)
    expected = {"train": [{"text": "train"}], "validation": [{"text": "validation"}]}
    def load_local(name, *, data_files):
        assert name == "json"
        assert data_files == {"train": [validation.path], "validation": [validation.path]}
        return expected
    monkeypatch.setitem(sys.modules, "datasets", SimpleNamespace(load_dataset=load_local))
    loaded, evaluation = train_model_module._load_dataset(request)
    assert loaded is expected
    assert evaluation is expected["validation"]


def _tokenize_fixture(dataset, tokenizer, max_length, *, training_task, purpose_paths):
    assert training_task in {"llm-instruction", "llm-classification"}
    assert purpose_paths is None
    assert max_length == train_model_module.DEFAULT_SEQUENCE_LENGTH
    return {"train": [{"input_ids": [1], "labels": [1]}]}


def test_train_model_routes_vision_training_task_to_multimodal_trainer(monkeypatch, tmp_path: Path) -> None:
    captured: dict[str, object] = {}

    def fake_train_vision_model(payload, **kwargs):
        captured["payload"] = payload
        captured.update(kwargs)
        return train_model_module.TrainModelTaskResult(runId=kwargs["run_id"], status="succeeded", outputModelName=kwargs["output_model_name"])

    monkeypatch.setattr(multimodal_module, "train_vision_model", fake_train_vision_model)
    payload = _request(tmp_path, method="full-finetune", training_task="vision-detection")

    result = train_model_module.train_model(payload)

    assert result.status == "succeeded"
    assert captured["payload"] is payload
    assert captured["training_task"] == "vision-detection"


def test_train_model_routes_diffusion_training_task_to_multimodal_trainer(monkeypatch, tmp_path: Path) -> None:
    captured: dict[str, object] = {}

    def fake_train_diffusion_lora_model(payload, **kwargs):
        captured["payload"] = payload
        captured.update(kwargs)
        return train_model_module.TrainModelTaskResult(runId=kwargs["run_id"], status="succeeded", outputModelName=kwargs["output_model_name"])

    monkeypatch.setattr(multimodal_module, "train_diffusion_lora_model", fake_train_diffusion_lora_model)
    payload = _request(tmp_path, method="lora", training_task="diffusion-lora")

    result = train_model_module.train_model(payload)

    assert result.status == "succeeded"
    assert captured["payload"] is payload
    assert captured["training_task"] == "diffusion-lora"


def test_train_model_lora_path_returns_real_result_with_mocks(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setattr(train_model_module, "_load_dataset", lambda payload: ({"train": type("T", (), {"column_names": ["text"]})()}, None))
    monkeypatch.setattr(train_model_module, "_resolve_base_model", lambda payload: "org/base")
    monkeypatch.setattr(train_model_module, "_load_transformers_objects", lambda *args, **kwargs: (_FakeModel(), _FakeTokenizer()))
    monkeypatch.setattr(train_model_module, "_tokenize_dataset", _tokenize_fixture)
    monkeypatch.setattr(train_model_module, "_apply_lora", lambda model, payload: model)
    monkeypatch.setattr(train_model_module, "_build_training_args", lambda payload, output: type("Args", (), {"output_dir": str(output / "ckpt")} )())
    monkeypatch.setattr(train_model_module, "_run_trainer", lambda *args, **kwargs: ({"loss": 0.1}, [{"path": "x", "step": 1, "metric": "loss", "value": 0.1}]))

    result = train_model_module.train_model(_request(tmp_path, "lora", "llm-classification"))

    assert result.status == "succeeded"
    assert result.generatedModelCandidate is not None
    assert result.generatedModelCandidate["artifactForm"] == "adapter"
    assert result.generatedModelCandidate["baseModelId"] == "org/base"
    assert result.generatedModelCandidate["adapterOfModelId"] == "org/base"
    assert "provider" not in result.generatedModelCandidate
    assert result.generatedModelCandidate["taskTags"] == ["text-classification"]
    assert result.generatedModelCandidate["metadata"]["trainingTask"] == "llm-classification"
    assert result.generatedModelCandidate["metadata"]["validation"]["validationReportPath"]


def test_train_model_invalid_validation_fails_and_blocks_generated_registration(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setattr(train_model_module, "_load_dataset", lambda payload: ({"train": type("T", (), {"column_names": ["text"]})()}, None))
    monkeypatch.setattr(train_model_module, "_resolve_base_model", lambda payload: "org/base")
    monkeypatch.setattr(train_model_module, "_load_transformers_objects", lambda *args, **kwargs: (_FakeModel(), _FakeTokenizer()))
    monkeypatch.setattr(train_model_module, "_tokenize_dataset", _tokenize_fixture)
    monkeypatch.setattr(train_model_module, "_apply_lora", lambda model, payload: model)
    monkeypatch.setattr(train_model_module, "_build_training_args", lambda payload, output: type("Args", (), {"output_dir": str(output / "ckpt")} )())
    monkeypatch.setattr(train_model_module, "_run_trainer", lambda *args, **kwargs: ({"loss": 0.1}, []))
    monkeypatch.setattr(
        train_model_module,
        "validate_model_output",
        lambda *args, **kwargs: {"status": "invalid", "warnings": [], "errors": ["bad tensors"], "validationReportPath": "/tmp/report.md"},
    )

    result = train_model_module.train_model(_request(tmp_path, "lora"))

    assert result.status == "failed"
    assert result.generatedModelCandidate is None
    assert result.error is not None
    assert result.error["code"] == "validation_failed"


def test_train_model_validation_disabled_marks_unknown(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setattr(train_model_module, "_load_dataset", lambda payload: ({"train": type("T", (), {"column_names": ["text"]})()}, None))
    monkeypatch.setattr(train_model_module, "_resolve_base_model", lambda payload: "org/base")
    monkeypatch.setattr(train_model_module, "_load_transformers_objects", lambda *args, **kwargs: (_FakeModel(), _FakeTokenizer()))
    monkeypatch.setattr(train_model_module, "_tokenize_dataset", _tokenize_fixture)
    monkeypatch.setattr(train_model_module, "_apply_lora", lambda model, payload: model)
    monkeypatch.setattr(train_model_module, "_build_training_args", lambda payload, output: type("Args", (), {"output_dir": str(output / "ckpt")} )())
    monkeypatch.setattr(train_model_module, "_run_trainer", lambda *args, **kwargs: ({"loss": 0.1}, []))
    monkeypatch.setattr(train_model_module, "validate_model_output", lambda *args, **kwargs: (_ for _ in ()).throw(AssertionError("should not run")))

    request = _request(tmp_path, "lora")
    request.validation = {"enabled": False}
    result = train_model_module.train_model(request)

    assert result.status == "succeeded"
    assert result.generatedModelCandidate is not None
    assert result.generatedModelCandidate["metadata"]["validation"]["status"] == "unknown"


def test_train_model_qlora_reports_runtime_limitations(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setattr(train_model_module, "_load_dataset", lambda payload: ({"train": type("T", (), {"column_names": ["text"]})()}, None))
    monkeypatch.setattr(train_model_module, "_resolve_base_model", lambda payload: "org/base")
    monkeypatch.setattr(train_model_module, "_load_transformers_objects", lambda *args, **kwargs: (_ for _ in ()).throw(RuntimeError("QLoRA requires CUDA GPU support")))

    result = train_model_module.train_model(_request(tmp_path, "qlora"))
    assert result.status == "failed"
    assert "qlora requires cuda" in result.error["message"].lower()


def test_apply_lora_lets_peft_infer_target_modules_when_not_configured(monkeypatch, tmp_path: Path) -> None:
    captured: dict[str, object] = {}

    class _FakeLoraConfig:
        def __init__(self, **kwargs):
            captured.update(kwargs)

    def fake_get_peft_model(model, config):
        captured["model"] = model
        captured["config"] = config
        return "peft-model"

    monkeypatch.setitem(
        sys.modules,
        "peft",
        SimpleNamespace(
            LoraConfig=_FakeLoraConfig,
            TaskType=SimpleNamespace(CAUSAL_LM="causal-lm"),
            get_peft_model=fake_get_peft_model,
        ),
    )
    payload = _request(tmp_path, "lora")
    payload.advancedParameters = {"lora": {"targetModules": []}}

    result = train_model_module._apply_lora("base-model", payload)

    assert result == "peft-model"
    assert "target_modules" not in captured
    assert captured["model"] == "base-model"


def test_apply_lora_uses_sanitized_explicit_target_modules(monkeypatch, tmp_path: Path) -> None:
    captured: dict[str, object] = {}

    class _FakeLoraConfig:
        def __init__(self, **kwargs):
            captured.update(kwargs)

    monkeypatch.setitem(
        sys.modules,
        "peft",
        SimpleNamespace(
            LoraConfig=_FakeLoraConfig,
            TaskType=SimpleNamespace(CAUSAL_LM="causal-lm"),
            get_peft_model=lambda model, config: model,
        ),
    )
    payload = _request(tmp_path, "lora")
    payload.advancedParameters = {"lora": {"targetModules": [" q_proj ", "", 42, "v_proj"]}}

    train_model_module._apply_lora("base-model", payload)

    assert captured["target_modules"] == ["q_proj", "v_proj"]


def test_run_trainer_reports_estimated_total_batches_before_training(monkeypatch) -> None:
    class _FakeTrainerCallback:
        pass

    class _FakeDataCollator:
        def __init__(self, **_kwargs):
            pass

    class _FakeTrainer:
        def __init__(self, **kwargs):
            self.args = kwargs["args"]
            self.callbacks = kwargs["callbacks"]
            self.state = SimpleNamespace(log_history=[], global_step=0, epoch=0.0)

        def train(self):
            callback = self.callbacks[0]
            callback.on_substep_end(self.args, self.state, None)
            self.state.global_step = 1
            callback.on_step_end(self.args, self.state, None)
            return SimpleNamespace(metrics={})

    monkeypatch.setitem(
        sys.modules,
        "transformers",
        SimpleNamespace(
            DataCollatorForLanguageModeling=_FakeDataCollator,
            Trainer=_FakeTrainer,
            TrainerCallback=_FakeTrainerCallback,
        ),
    )
    progress_events: list[dict[str, int]] = []

    train_model_module._run_trainer(
        model=object(),
        tokenizer=object(),
        dataset={"train": [object()] * 117},
        eval_dataset=None,
        args=SimpleNamespace(
            output_dir="/tmp/checkpoints",
            max_steps=-1,
            per_device_train_batch_size=2,
            gradient_accumulation_steps=2,
            num_train_epochs=1,
        ),
        on_progress=progress_events.append,
    )

    assert progress_events[:3] == [
        {"epoch": 0, "totalEpochs": 1, "batch": 0, "totalBatches": 59},
        {"epoch": 1, "totalEpochs": 1, "batch": 1, "totalBatches": 59},
        {"epoch": 1, "totalEpochs": 1, "batch": 2, "totalBatches": 59},
    ]


def test_valid_training_selection_retains_explicit_missing_dependency_failure(monkeypatch, tmp_path):
    import builtins

    request = _request(tmp_path)
    imports = []
    original_import = builtins.__import__

    def unavailable(name, *args, **kwargs):
        if name == "datasets":
            imports.append(name)
            raise ModuleNotFoundError("Synthetic missing training dependency")
        return original_import(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", unavailable)
    with pytest.raises(RuntimeError, match="datasets is required for model training dataset loading"):
        train_model_module._load_dataset(request)
    assert imports == ["datasets"]
