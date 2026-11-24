from __future__ import annotations

import importlib
import json
import sys
from contextlib import contextmanager
from enum import Enum
from types import ModuleType, SimpleNamespace
from pathlib import Path, PureWindowsPath

import pytest

from modules.adapters.runtime.python.worker.models import TrainModelTaskRequest

train_model_module = importlib.import_module("modules.adapters.runtime.python.worker.tasks.train_model")
multimodal_module = importlib.import_module("modules.adapters.runtime.python.worker.tasks.train_model_multimodal")


@contextmanager
def _protected_tensor_selection_fixture(monkeypatch,method="lora",targets=("q_proj",)):
    from modules.adapters.runtime.python.worker.tests.test_native_training_model_graph import DenseTensorByteAdapterTests,CombinedTrainingInputViewTests,TrainingTensorStreamTests
    sdk_case=DenseTensorByteAdapterTests(); facts,sdk,Tensor,Device=sdk_case.fixture(); extra=None
    actual,_,lease,_,request,control,*_=facts
    if method != "lora":
        extra=CombinedTrainingInputViewTests(); actual,_,lease,_,request,_,control,_=extra.fixture(method=method)
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
        if extra is not None: extra.doCleanups()
        sdk_case.doCleanups()


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


def test_private_fixed_loader_consumes_actual_live_view_without_rewriting_logical_model(monkeypatch,tmp_path):
    from modules.adapters.runtime.python.worker.native import windows_original_worker_launch as native
    from modules.adapters.runtime.python.worker.tests.test_native_training_model_graph import borrowed_model_view
    payload=_request(tmp_path); payload.baseModel.localPath="X:\\models\\selected"; payload.baseModel.modelRecordId="model.synthetic"
    request=payload.model_dump(mode="json")
    # Native source-only fixture. Whole session validation is tested separately;
    # no Transformers supplier, model, dataset, trainer or quality score runs.
    definition={"modelUpdatedAt":"2026-11-23T00:00:00Z","request":request}
    references=[]
    monkeypatch.setattr(train_model_module,"_local_training_model_reference",lambda value: references.append(value) or value)
    calls=[]
    def execute(actual,**options): calls.append((actual,options)); return "controlled-loader-result"
    monkeypatch.setattr(train_model_module,"_train_model",execute)
    with borrowed_model_view(definition,request,native) as (view,physical):
        assert train_model_module.train_model_from_local_files(payload,_model_view=view)=="controlled-loader-result"
        assert payload.model_dump(mode="json")==request
        assert calls[0][1]["local_model_ref"]==physical and calls[0][1]["compare_validation_baseline"] is False
        assert references==[physical]
    with pytest.raises(native.LaunchUnavailable): train_model_module.train_model_from_local_files(payload,_model_view=view)
    assert len(calls)==1 and references==[physical]


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
    from modules.adapters.runtime.python.worker.native import windows_original_worker_launch as native
    from modules.adapters.runtime.python.worker.tests.test_native_training_model_graph import TrainingInputCopyTests
    case=TrainingInputCopyTests()
    source,lease,staged,config,control,kernel,*_=case.fixture(count=2,native_module=native)
    graph=native.OriginalTrainingInputGraph(lease,staged,config,control,control); effects=[]
    class OutputPath(PureWindowsPath):
        def mkdir(self,*args,**options): effects.append("output-before-callback")
    payload=TrainModelTaskRequest.model_validate(staged["payload"])
    def progress(value):
        if value.get("stage")=="initializing":
            if change=="permission": control.current=False
            else: payload.commonParameters["maxSteps"]=9876
    def dataset(*args,**options):
        effects.append("dataset-IO")
        raise RuntimeError("Controlled stop before any model supplier")
    monkeypatch.setattr(train_model_module,"Path",OutputPath)
    monkeypatch.setattr(train_model_module,"_local_training_model_reference",lambda value:value)
    monkeypatch.setattr(train_model_module,"_load_dataset",dataset)
    monkeypatch.setattr(train_model_module,"_load_transformers_objects",lambda *a,**k: pytest.fail("No model may load"))
    try:
        graph.prepare()
        with lease.borrow(payload.model_dump(mode="json")) as view:
            try: train_model_module.train_model_from_local_files(payload,on_progress=progress,_model_view=view)
            except native.LaunchUnavailable: pass
            assert "dataset-IO" not in effects
    finally: case.doCleanups()


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
    from modules.adapters.runtime.python.worker.native import windows_original_worker_launch as native
    from modules.adapters.runtime.python.worker.tests.test_native_training_model_graph import TrainingInputCopyTests
    case=TrainingInputCopyTests()
    source,lease,staged,config,control,kernel,*_=case.fixture(native_module=native)
    graph=native.OriginalTrainingInputGraph(lease,staged,config,control,control); calls=[]
    class LocalPath(PureWindowsPath):
        def exists(self): return True  # Only this inert SDK boundary; Native facts remain real fixture replies.
    def read(builder,*,data_files): calls.append(data_files); return {"train":[{"text":"synthetic"}]}
    original_import=builtins.__import__
    def importing(name,*args,**options):
        if name=="datasets":
            if withdraw: control.current=False
            return SimpleNamespace(load_dataset=read)
        return original_import(name,*args,**options)
    try:
        graph.prepare(); payload=TrainModelTaskRequest.model_validate(staged["payload"])
        with lease.borrow(payload.model_dump(mode="json")) as view:
            use=train_model_module._ProtectedTrainingUse(payload,view)
            monkeypatch.setattr(train_model_module,"Path",LocalPath)
            monkeypatch.setattr(builtins,"__import__",importing)
            if withdraw:
                with pytest.raises(native.LaunchUnavailable): train_model_module._load_dataset(payload,local_dataset_refs=use.dataset_references,_protected_use=use)
                assert calls==[]
            else:
                result,_=train_model_module._load_dataset(payload,local_dataset_refs=use.dataset_references,_protected_use=use)
                assert result=={"train":[{"text":"synthetic"}]} and len(calls)==1
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
