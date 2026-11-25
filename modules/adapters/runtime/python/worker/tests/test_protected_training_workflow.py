"""Protected task integration: synthetic SDK data and real finite ABI code only."""
from contextlib import contextmanager
from copy import deepcopy
from pathlib import Path
from threading import Thread

import pytest

from modules.adapters.runtime.python.worker.tests import test_train_model_task as sdk
from modules.adapters.runtime.python.worker.tests import test_native_training_model_graph as native_fixture

training=sdk.train_model_module


def forbidden(*args,**kwargs):
    pytest.fail("Protected workflow entered ordinary filesystem/serializer/quality behavior")


@contextmanager
def family_fixture(resource=None,business=None):
    case=native_fixture.TrainingOutputFamilyTests()
    try:
        facts,ordinary_business,configuration=case.fixture()
        native,_,lease,_,request,_,kernel,_,contents,files,ordinary_resource=facts
        resource=ordinary_resource if resource is None else resource
        business=ordinary_business if business is None else business
        with lease.borrow(request) as view:
            family=native.OriginalTrainingOutputFamily(view,request,configuration,resource,business)
            yield native,view,request,family,resource,business,kernel,contents,files,configuration
    finally:case.doCleanups()


def prepare_members(facts,count=2):
    native,view,request,family,resource,business,kernel,contents,files,configuration=facts
    graphs=[]
    for config in configuration["outputs"][:count]:
        graph=native.OriginalTrainingOutputGraph(view,request,config,files,resource,business,_family=family)
        graph.prepare({name:(raw,) for name,raw in contents.items()});graphs.append(graph)
    return graphs


@pytest.mark.parametrize("method",["full-finetune","lora","qlora"])
def test_private_loader_runs_checked_pipeline_and_retires_outputs_without_ordinary_io(monkeypatch,method):
    with sdk._protected_pipeline_fixture(monkeypatch,method=method) as (native,use,_,_,family,control,kernel,calls,_,disk):
        stages=[]
        with monkeypatch.context() as guard:
            for name in ("mkdir","write_bytes","write_text"):guard.setattr(Path,name,forbidden)
            for name in ("save_adapter_pretrained","save_full_model_pretrained","write_serialization_manifest","validate_model_output"):
                guard.setattr(training,name,forbidden)
            guard.setattr(training.tempfile,"mkdtemp",forbidden);guard.setattr(training,"rmtree",forbidden)
            result=training.train_model_from_local_files(use.payload,_model_view=use.view,
                on_progress=lambda value:stages.append(value["stage"]))
        assert result.status=="succeeded" and result.runId==use._run_identity[0]
        assert result.metrics=={"train_loss":0.25} and len(result.checkpoints)==1
        assert result.generatedModelCandidate["metadata"]["validation"]["scope"]=="structural"
        assert result.generatedModelCandidate["metadata"]["modelQuality"]=="not-measured"
        assert result.generatedModelCandidate["metadata"]["modelReadiness"]=="not-qualified"
        assert result.generatedModelCandidate["artifactForm"]==("full-model" if method=="full-finetune" else "adapter")
        book=native._training_output_families[family]
        actual_use=book["training_owner"][0]
        assert actual_use._workflow_slot["stage"]=="complete" and actual_use._workflow_slot["cleanup"] is True
        assert family.phase=="retired" and book["io"]["stage"]=="complete"
        assert all(member["graph"].retired for member in book["members"])
        assert all(handle.closed for member in book["members"] for handle in member["graph"].owned_handles)
        assert stages[-2:]==["closing-output","completed"] and disk==[] and calls.count("train")==1
        assert control.charges==[128*1024]*2 and control.retained==[128*1024]*2
        before=len(kernel.calls)
        with pytest.raises(ValueError):training._run_protected_training_workflow(actual_use)
        assert len(kernel.calls)==before


@pytest.mark.parametrize("stage",["model-loading","training"])
def test_cancelled_private_workflow_closes_owned_family_without_scores_or_result(monkeypatch,stage):
    with sdk._protected_pipeline_fixture(monkeypatch) as (native,use,_,_,family,control,kernel,_,_,disk):
        def progress(value):
            if value["stage"]==stage:raise training.TrainingCancellationRequested()
        with pytest.raises(training.TrainingCancellationRequested):
            training._run_protected_training_workflow(use,on_progress=progress)
        assert use._workflow_slot["stage"]=="failed" and use._workflow_slot["cleanup"] is True
        assert family.phase=="retired" and control.charges==control.retained==[] and disk==[]


def test_missing_original_family_denies_before_dataset_model_or_ordinary_output(monkeypatch):
    with sdk._protected_pipeline_fixture(monkeypatch,family=False) as (_,use,_,_,_,control,kernel,calls,_,disk):
        before=len(kernel.calls)
        with monkeypatch.context() as guard:
            guard.setattr(Path,"mkdir",forbidden);guard.setattr(training.tempfile,"mkdtemp",forbidden)
            with pytest.raises(ValueError):training._run_protected_training_workflow(use)
        assert calls==disk==[] and control.charges==control.retained==[]
        assert not any(name in ("WriteFile","NtCreateFile") for name,_ in kernel.calls[before:])
        assert use._workflow_slot["claim"] is None and use._workflow_slot["cleanup"] is None


@pytest.mark.parametrize("change",["permission","result","reentry"])
def test_last_progress_change_denies_publication_after_known_output_closure(monkeypatch,change):
    with sdk._protected_pipeline_fixture(monkeypatch) as (native,use,_,_,family,control,kernel,_,_,_):
        changed=[]
        def progress(value):
            if value["stage"]!="completed":return
            changed.append(True)
            if change=="permission":control.current=False
            elif change=="result":use._workflow_slot["result"].generatedModelCandidate["metadata"]["modelQuality"]="invented"
            else:
                with pytest.raises(ValueError):training._run_protected_training_workflow(use)
        with pytest.raises(ValueError):training._run_protected_training_workflow(use,on_progress=progress)
        assert changed==[True] and use._workflow_slot["stage"]=="failed"
        assert use._workflow_slot["cleanup"] is True and family.phase=="retired"
        assert control.retained==[128*1024]*2


@pytest.mark.parametrize("count",[0,1,2])
def test_finite_family_closes_original_outputs_once_and_permanently_denies_new_members(count):
    with family_fixture() as facts:
        native,view,request,family,resource,business,kernel,contents,files,configuration=facts
        graphs=prepare_members(facts,count);before=len(kernel.calls)
        assert native.retire_original_training_output_family(family) is True
        after=len(kernel.calls)
        assert native.retire_original_training_output_family(family) is True and len(kernel.calls)==after
        assert family.phase=="retired" and resource.retained==[128*1024]*count
        assert all(handle.closed for graph in graphs for handle in graph.owned_handles)
        assert all(name=="CloseHandle" for name,_ in kernel.calls[before:])
        with pytest.raises(native.LaunchUnavailable):
            native.OriginalTrainingOutputGraph(view,request,configuration["outputs"][-1],files,resource,business,_family=family)
        assert len(kernel.calls)==after


def test_wrong_thread_foreign_family_and_busy_io_do_not_consume_family_attempt():
    with family_fixture() as facts:
        native,_,_,family,resource,_,kernel,_,_,_=facts
        graph=prepare_members(facts,1)[0];before=len(kernel.calls)
        assert native.retire_original_training_output_family(object()) is False
        results=[];thread=Thread(target=lambda:results.append(native.retire_original_training_output_family(family)))
        thread.start();thread.join(3)
        assert not thread.is_alive() and results==[False]
        graph._operation_lock.acquire()
        try:assert native.retire_original_training_output_family(family) is False
        finally:graph._operation_lock.release()
        assert family.phase=="bound" and len(kernel.calls)==before and resource.retained==[]
        assert native.retire_original_training_output_family(family) is True


def test_family_unknown_close_never_retries_or_returns_credit():
    with family_fixture() as facts:
        native,_,_,family,resource,_,kernel,_,_,_=facts
        graphs=prepare_members(facts);kernel.error_after_return="CloseHandle";before=len(kernel.calls)
        assert native.retire_original_training_output_family(family) is False
        assert len(kernel.calls)==before+1 and family.phase=="failed" and resource.retained==[]
        assert any(not h.closed for h in graphs[1].owned_handles)
        assert native.retire_original_training_output_family(family) is False and len(kernel.calls)==before+1


def test_final_family_admission_is_original_resource_then_business_and_one_use():
    trace=[]
    class Current(native_fixture.Control):
        def __init__(self,label):super().__init__();self.label=label
        def assert_current(self):trace.append(self.label);return self.current
    with family_fixture(Current("resource"),Current("business")) as facts:
        native,_,_,family,resource,business,kernel,_,_,_=facts
        owner=object();binding={};snapshot=lambda:None
        native._claim_output_family_training(family,owner,binding,snapshot)
        prepare_members(facts)
        assert native.retire_original_training_output_family(family) is True
        trace.clear()
        with pytest.raises(native.LaunchUnavailable):native.admit_retired_training_output_family(family,object(),binding)
        assert trace==[]
        assert native.admit_retired_training_output_family(family,owner,binding) is True
        assert trace==["resource","business"]
        with pytest.raises(native.LaunchUnavailable):native.admit_retired_training_output_family(family,owner,binding)
        assert trace==["resource","business"]


def test_foreign_second_use_cannot_close_another_claimed_training_family(monkeypatch):
    with sdk._protected_pipeline_fixture(monkeypatch) as (native,use,_,_,family,control,kernel,_,_,_):
        training._bind_protected_checkpoint_schedule(use)
        foreign=training._ProtectedTrainingUse(use.payload,use.view);before=len(kernel.calls)
        with pytest.raises(ValueError):training._run_protected_training_workflow(foreign)
        assert family.phase=="bound" and native._output_family_training_binding(family)[0] is use
        assert foreign._workflow_slot["claim"] is None and foreign._workflow_slot["cleanup"] is None
        assert control.charges==control.retained==[]
        assert not any(name=="CloseHandle" for name,_ in kernel.calls[before:])


def test_wrong_thread_leaves_original_workflow_available(monkeypatch):
    with sdk._protected_pipeline_fixture(monkeypatch) as (_,use,_,_,_,control,kernel,_,_,_):
        denied=[];before=len(kernel.calls)
        def other():
            try:training._run_protected_training_workflow(use)
            except ValueError:denied.append(True)
        thread=Thread(target=other);thread.start();thread.join(3)
        assert not thread.is_alive() and denied==[True] and use._workflow_slot is None
        assert len(kernel.calls)==before and control.charges==[]
        assert training._run_protected_training_workflow(use).status=="succeeded"


@pytest.mark.parametrize("change",["factory","result-class","checkpoint-owner","cleanup-field","cleanup-before"])
def test_late_helper_or_passive_result_change_denies_without_running_replacements(monkeypatch,change):
    with sdk._protected_pipeline_fixture(monkeypatch) as (_,use,_,_,family,control,kernel,_,_,_):
        invoked=[]
        def observer(*args,**kwargs):invoked.append(True);raise AssertionError("Replacement ran")
        def progress(value):
            if change=="factory" and value["stage"]=="staged":monkeypatch.setattr(training,"_RESULT_FACTORY",observer)
            if change=="cleanup-before" and value["stage"]=="staged":use._workflow_slot["cleanup"]=True
            if change not in ("factory","cleanup-before") and value["stage"]=="completed":
                if change=="result-class":monkeypatch.setattr(training._RESULT_CLASS,"model_dump",property(observer))
                elif change=="checkpoint-owner":use._checkpoint_slot={}
                else:use._workflow_slot["cleanup"]=object()
        with pytest.raises(ValueError):training._run_protected_training_workflow(use,on_progress=progress)
        assert invoked==[] and family.phase=="retired"
        assert control.retained==[128*1024]*2 and use._workflow_slot["stage"]=="failed"


def test_private_quality_comparison_is_refused_without_starting_training(monkeypatch):
    with sdk._protected_pipeline_fixture(monkeypatch) as (_,use,_,_,family,control,kernel,calls,_,disk):
        with pytest.raises(ValueError):
            training.train_model_from_local_files(use.payload,_model_view=use.view,compare_validation_baseline=True)
        assert calls==disk==[] and family.phase=="bound" and control.charges==[]


@pytest.mark.parametrize("name",["__pydantic_extra__","__pydantic_private__"])
def test_final_business_slot_replacement_denies_before_invoking_getter(monkeypatch,name):
    original_current=native_fixture.Control.assert_current
    def current(receiver):
        hook=receiver.__dict__.get("on_current")
        if hook is not None:hook()
        return original_current(receiver)
    monkeypatch.setattr(native_fixture.Control,"assert_current",current)
    with sdk._protected_pipeline_fixture(monkeypatch) as (_,use,_,_,family,control,_,_,_,_):
        observed=[];admissions=[]
        def getter(*args):observed.append(True);raise AssertionError("Late result getter ran")
        def last_admission():
            admissions.append(True)
            if len(admissions)==2:
                monkeypatch.setattr(training._RESULT_CLASS,name,property(getter))
        def progress(value):
            if value["stage"]=="completed":control.on_current=last_admission
        with pytest.raises(ValueError):training._run_protected_training_workflow(use,on_progress=progress)
        assert admissions==[True,True] and observed==[]
        assert family.phase=="retired" and control.retained==[128*1024]*2
        assert use._workflow_slot["stage"]=="failed" and use._workflow_slot["cleanup"] is True


@pytest.mark.parametrize("kind",["resource-deny","business-deny","virtual-state","reentry"])
def test_final_admission_denials_are_one_use_and_never_invoke_virtual_metadata(kind):
    trace=[];virtual=[]
    class Stage:
        def __eq__(self,other):virtual.append(True);return True
    class Current(native_fixture.Control):
        hook=None
        def __init__(self,label):super().__init__();self.label=label
        def assert_current(self):
            trace.append(self.label)
            if self.hook is not None:self.hook()
            return self.current
    resource,business=Current("resource"),Current("business")
    with family_fixture(resource,business) as facts:
        native,_,_,family,_,_,kernel,_,_,_=facts
        owner=object();binding={}
        native._claim_output_family_training(family,owner,binding,lambda:None)
        prepare_members(facts);assert native.retire_original_training_output_family(family) is True
        if kind=="resource-deny":resource.current=False
        elif kind=="business-deny":business.current=False
        elif kind=="virtual-state":business.hook=lambda:native._training_output_families[family]["io"].update(admission=Stage())
        else:
            def again():
                with pytest.raises(native.LaunchUnavailable):native.admit_retired_training_output_family(family,owner,binding)
            business.hook=again
        trace.clear();before=len(kernel.calls)
        with pytest.raises(native.LaunchUnavailable):native.admit_retired_training_output_family(family,owner,binding)
        assert trace==(["resource"] if kind=="resource-deny" else ["resource","business"])
        assert virtual==[] and len(kernel.calls)==before
        trace.clear()
        with pytest.raises(native.LaunchUnavailable):native.admit_retired_training_output_family(family,owner,binding)
        assert trace==[] and len(kernel.calls)==before


def test_active_output_stream_defers_family_cleanup_without_consuming_the_attempt():
    with family_fixture() as facts:
        native,view,request,family,resource,_,kernel,_,_,_=facts
        graph=prepare_members(facts,1)[0]
        stream=native.read_original_training_output_chunks(graph,view,request)
        deferred=[]
        def during(name):
            if name=="ReadFile" and not deferred:deferred.append(native.retire_original_training_output_family(family))
        kernel.after=during
        assert list(stream);kernel.after=None
        assert deferred==[False] and family.phase=="bound" and resource.retained==[]
        assert native.retire_original_training_output_family(family) is True


def test_cancellation_after_a_real_checkpoint_closes_that_original_partial_family(monkeypatch):
    with sdk._protected_pipeline_fixture(monkeypatch) as (native,use,_,_,family,control,_,_,_,disk):
        def progress(value):
            if value.get("batch")==1:raise training.TrainingCancellationRequested()
        with pytest.raises(training.TrainingCancellationRequested):training._run_protected_training_workflow(use,on_progress=progress)
        members=native._training_output_families[family]["members"]
        assert len(members)==1 and members[0]["graph"].retired and family.phase=="retired"
        assert use._workflow_slot["result"] is None and use._workflow_slot["cleanup"] is True
        assert control.charges==control.retained==[128*1024] and disk==[]


def test_existing_original_task_session_consumes_the_real_private_loader_result(monkeypatch):
    from concurrent.futures import Future
    from modules.adapters.runtime.python.worker.tasks import approved_local_training_session as session
    with sdk._protected_pipeline_fixture(monkeypatch) as (native,use,_,_,family,_,_,_,_,_):
        lease=native._model_views[use.view][0]
        state=native._model_leases[lease]
        definition=native._verified_model_receivers[state["source"]]["definition"]
        inputs=state["input_copy_owner"]
        raw=deepcopy(definition["request"])
        raw["output"]["outputDirectory"]=use.payload.output["outputDirectory"]
        for row,selected in zip(raw["datasets"],use.payload.datasets):row.update(path=selected.path,format=selected.format)
        staged={"payload":raw,"outputDirectory":use.payload.output["outputDirectory"],
            "recipe":{"path":inputs.physical_path+"\\approved-recipe.json",
                "digest":definition["dataset"]["recipeDigest"],"sizeBytes":definition["recipeSizeBytes"]}}
        class Resources(session.NativeTrainingResources):
            def prepare(self):return "ready"
            def seal_inputs(self,value):return use.payload.model_copy(deep=True)
            @contextmanager
            def borrow(self):yield use.view
            def request_cancel(self):pass
            def settle(self):return False  # No SDK/input/worker/Job/global qualification in this fixture.
        class Producer(session.NativeTrainingProducer):
            @property
            def profile(self):return session.NativeTrainingProfile("synthetic-software-only","sha256:"+"e"*64,900)
            def capture(self,value):assert value==definition;return Resources()
        updates=[]
        owner=session.OriginalTrainingSession(definition,Producer(),lambda:True,lambda **value:updates.append(value),lambda _:Future())
        assert owner.prepare()=="prepared" and owner.seal(staged)=="ready"
        assert owner.start()["kind"]=="accepted"
        owner.run()
        assert updates[-1]["status"]=="succeeded" and updates[-1]["data"]["runId"]==definition["requestId"]
        assert updates[-1]["data"]["generatedModelCandidate"]["metadata"]["modelQuality"]=="not-measured"
        assert family.phase=="retired" and owner.settle() is False and owner.blocks_recovery
