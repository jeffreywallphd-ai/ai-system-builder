"""Backend delivery only: finite Native fixtures and inert SDK, no OS/model."""
from contextlib import contextmanager
from copy import deepcopy
import base64
import hashlib
import sys
from threading import Event,Thread
from time import monotonic,sleep

import pytest

from modules.adapters.runtime.python.worker.tasks import original_training_output_delivery as delivery
from modules.adapters.runtime.python.worker.tests import test_protected_training_workflow as workflow


@contextmanager
def bound_fixture(*,seconds=10,maximum_files=256,maximum_bytes=2**20):
    with workflow.family_fixture() as facts:
        native,view,request,family,*_=facts
        task=native.resolve_original_training_task_id(view,request)
        queue=delivery.OriginalTrainingOutputDelivery(task,maximum_files=maximum_files,
            maximum_payload_bytes=maximum_bytes,deadline=monotonic()+seconds)
        delivery.bind_original_output_delivery(queue,family,view,request)
        try:yield queue,facts
        finally:
            queue.abort()
            delivery._families.pop(family,None);delivery._records.pop(queue,None)


@contextmanager
def consumer(queue,*,ack=True,on_frame=None):
    stop=Event();frames=[];errors=[]
    def run():
        try:
            previous=0
            while not stop.is_set():
                reply=queue.read();frame=reply["frame"]
                if reply["phase"] in ("complete","failed"):return
                if frame is not None and frame["sequence"]!=previous:
                    previous=frame["sequence"];frames.append(frame)
                    if on_frame is not None:on_frame(frame)
                    if ack:assert queue.acknowledge(frame["sequence"]) is True
                sleep(0.001)
        except BaseException as error:errors.append(error);queue.abort()
    thread=Thread(target=run);thread.start()
    try:yield frames,errors
    finally:
        stop.set();queue.abort();thread.join(3)
        assert not thread.is_alive()
        assert errors==[]


def sealed_files(graph):
    return tuple((row["name"],row["sizeBytes"],row["sha256"]) for row in graph.records)


def begin(queue,facts,current=lambda:None):
    native,_,_,_,_,_,_,_,_,_=facts
    graphs=workflow.prepare_members(facts)
    files=tuple(sealed_files(graph) for graph in graphs)
    delivery.begin_original_output_delivery(queue,tuple(graphs),files,(1,),current)
    return graphs,files


def test_queue_binds_only_actual_family_view_task_without_new_io():
    with bound_fixture() as (queue,facts):
        native,view,request,family,_,_,kernel,*_=facts
        before=len(kernel.calls)
        assert delivery.capture_original_output_delivery(view,request) is queue
        assert queue.read()=={"phase":"bound","acknowledged":0,"frame":None}
        foreign=delivery.OriginalTrainingOutputDelivery("00000000-0000-4000-8000-000000000001",
            maximum_files=2,maximum_payload_bytes=100,deadline=monotonic()+10)
        with pytest.raises(delivery.OutputDeliveryUnavailable):delivery.bind_original_output_delivery(foreign,family,view,request)
        assert delivery.capture_original_output_delivery(view,request) is queue
        assert len(kernel.calls)==before


def test_real_native_stream_is_forwarded_once_with_exact_events_eof_and_final_exhaustion():
    with bound_fixture() as (queue,facts),consumer(queue) as (frames,_):
        native,view,request,_,_,_,_,contents,*_=facts
        graphs,files=begin(queue,facts)
        expected=[]
        for group,graph in enumerate(graphs):
            stream=native.read_original_training_output_chunks(graph,view,request)
            events=list(delivery.tee_original_output_delivery(queue,stream,group))
            assert native._training_output_readers[graph]["read_state"]=="complete"
            assert len([row for row in events if row[2]==b""])==len(files[group])
            for name,size,_ in files[group]:
                assert b"".join(raw for actual,_,raw in events if actual==name)==contents[name]
                expected.append((name,size))
            with pytest.raises(native.LaunchUnavailable):native.read_original_training_output_chunks(graph,view,request)
        delivery.finish_original_output_delivery(queue)
        assert frames[0]["kind"]=="manifest" and len(frames[0]["files"])==len(expected)
        assert frames[-1]["kind"]=="streams-complete" and frames[-1]["provisional"] is True
        assert [frame["sequence"] for frame in frames]==list(range(1,len(frames)+1))
        assert sum(len(base64.b64decode(frame["data"])) for frame in frames if frame["kind"]=="data")==sum(size for _,size in expected)
        assert queue.read()["phase"]=="complete"


def test_manifest_ack_backpressure_prevents_source_reads_and_deadline_fences_delivery():
    with bound_fixture(seconds=0.15) as (queue,facts):
        native,_,_,_,_,_,kernel,*_=facts
        graphs=workflow.prepare_members(facts)
        files=tuple(sealed_files(graph) for graph in graphs)
        before=len(kernel.calls)
        with pytest.raises(delivery.OutputDeliveryUnavailable):
            delivery.begin_original_output_delivery(queue,tuple(graphs),files,(1,),lambda:None)
        assert queue.read()["phase"]=="failed" and queue.read()["frame"] is None
        assert len(kernel.calls)==before
        assert all(native._training_output_readers[graph]["read_state"]=="unread" for graph in graphs)


def test_foreign_acknowledgements_and_replayed_ack_never_advance_another_frame():
    with bound_fixture() as (queue,facts):
        native,_,_,_,_,_,_,_,_,_=facts
        graphs=workflow.prepare_members(facts);files=tuple(sealed_files(g) for g in graphs)
        observed=[];errors=[];stop=Event()
        def acknowledge():
            try:
                while queue.read()["frame"] is None:
                    if stop.is_set():return
                    sleep(.001)
                first=queue.read()["frame"];observed.append(first)
                for value in (True,0,-1,2,1.5,"1"):
                    with pytest.raises(delivery.OutputDeliveryUnavailable):queue.acknowledge(value)
                assert queue.read()["frame"]==first
                assert queue.acknowledge(1) is True
                assert queue.acknowledge(1) is True
            except BaseException as error:errors.append(error);queue.abort()
        thread=Thread(target=acknowledge);thread.start()
        try:delivery.begin_original_output_delivery(queue,tuple(graphs),files,(1,),lambda:None)
        finally:stop.set();thread.join(3)
        assert not thread.is_alive() and len(observed)==1 and errors==[]
        assert queue.read()["acknowledged"]==1 and queue.read()["frame"] is None


def test_read_frames_are_detached_and_cannot_change_pending_manifest_or_accounting():
    with bound_fixture() as (queue,facts):
        seen=[]
        def inspect(frame):
            snapshot=queue.read();snapshot["frame"]["sequence"]=999
            snapshot["frame"]["files"][0]["name"]="foreign"
            seen.append(queue.read())
        with consumer(queue,on_frame=inspect):begin(queue,facts)
        assert seen[0]["frame"]["sequence"]==1
        assert seen[0]["frame"]["files"][0]["name"]!="foreign"


def test_invalid_configuration_is_refused_without_a_family_or_callback():
    task="00000000-0000-4000-8000-000000000001"
    for patch in ({"task_id":"invalid"},{"maximum_files":0},{"maximum_files":257},
            {"maximum_payload_bytes":0},{"maximum_payload_bytes":True},{"deadline":float("nan")},{"deadline":True}):
        values={"task_id":task,"maximum_files":2,"maximum_payload_bytes":100,"deadline":monotonic()+10,**patch}
        with pytest.raises(delivery.OutputDeliveryUnavailable):delivery.OriginalTrainingOutputDelivery(**values)


def test_changed_class_method_is_refused_before_any_unselected_getter(monkeypatch):
    with bound_fixture() as (queue,_):
        calls=[]
        monkeypatch.setattr(delivery.OriginalTrainingOutputDelivery,"__hash__",lambda self:calls.append("hash") or 1)
        with pytest.raises(delivery.OutputDeliveryUnavailable):queue.read()
        assert calls==[]
        monkeypatch.undo()


@pytest.mark.parametrize("method",["full-finetune","lora","qlora"])
def test_actual_fixed_pipeline_checks_and_delivers_all_outputs_in_same_pass(monkeypatch,method):
    queues=[]
    def factory(native,family,view,request):
        queue=delivery.OriginalTrainingOutputDelivery(native.resolve_original_training_task_id(view,request),
            maximum_files=64,maximum_payload_bytes=256*1024,deadline=monotonic()+30)
        delivery.bind_original_output_delivery(queue,family,view,request);queues.append(queue)
    with workflow.sdk._protected_pipeline_fixture(monkeypatch,method=method,delivery_factory=factory) as facts:
        native,use,_,_,family,_,_,calls,_,disk=facts
        queue=queues[0]
        with consumer(queue) as (frames,_):
            result=workflow.training.train_model_from_local_files(use.payload,_model_view=use.view)
            assert result.status=="succeeded" and result.generatedModelCandidate["metadata"]["modelQuality"]=="not-measured"
            assert queue.read()["phase"]=="complete"
            manifest=frames[0];files=manifest["files"]
            assert {row["role"] for row in files}=={"checkpoint","candidate"}
            assert [row["fileIndex"] for row in files]==list(range(len(files)))
            assert len([frame for frame in frames if frame["kind"]=="file-eof"])==len(files)
            assert frames[-1]["kind"]=="streams-complete" and frames[-1]["totalBytes"]==manifest["totalBytes"]
            for row in files:
                raw=b"".join(base64.b64decode(frame["data"]) for frame in frames
                    if frame["kind"]=="data" and frame["fileIndex"]==row["fileIndex"])
                assert len(raw)==row["sizeBytes"] and "sha256:"+hashlib.sha256(raw).hexdigest()==row["sha256"]
            assert all(native._training_output_readers[row["graph"]]["read_state"]=="complete"
                for row in native._training_output_families[family]["members"])
            assert disk==[] and calls.count("train")==1


@pytest.mark.parametrize("maximum_files,maximum_bytes",[(1,2**20),(256,1)])
def test_insufficient_declared_capacity_refuses_before_native_read(maximum_files,maximum_bytes):
    with bound_fixture(maximum_files=maximum_files,maximum_bytes=maximum_bytes) as (queue,facts):
        native,_,_,_,_,_,kernel,*_=facts
        graphs=workflow.prepare_members(facts);files=tuple(sealed_files(g) for g in graphs);before=len(kernel.calls)
        with pytest.raises(delivery.OutputDeliveryUnavailable):
            delivery.begin_original_output_delivery(queue,tuple(graphs),files,(1,),lambda:None)
        assert len(kernel.calls)==before and queue.read()["phase"]=="bound"


def test_changed_inventory_is_refused_before_any_stream_or_ack():
    with bound_fixture() as (queue,facts):
        native,_,_,_,_,_,kernel,*_=facts
        graphs=workflow.prepare_members(facts);files=tuple(sealed_files(g) for g in graphs)
        changed=((files[0][0][0],files[0][0][1],"0"*64),)+files[0][1:]
        before=len(kernel.calls)
        with pytest.raises(delivery.OutputDeliveryUnavailable):
            delivery.begin_original_output_delivery(queue,tuple(graphs),(changed,files[1]),(1,),lambda:None)
        assert len(kernel.calls)==before and queue.read()["frame"] is None


def test_receiver_abort_fences_next_source_read_and_keeps_existing_handles():
    with bound_fixture() as (queue,facts):
        native,view,request,*_=facts
        def cancel(frame):
            if frame["kind"]=="data":queue.abort()
        with consumer(queue,ack=False,on_frame=lambda frame:cancel(frame) if frame["kind"]=="data" else queue.acknowledge(frame["sequence"])) as (frames,_):
            graphs,_=begin(queue,facts);stream=native.read_original_training_output_chunks(graphs[0],view,request)
            with pytest.raises(delivery.OutputDeliveryUnavailable):list(delivery.tee_original_output_delivery(queue,stream,0))
            before=len(facts[6].calls)
            with pytest.raises(delivery.OutputDeliveryUnavailable):delivery.finish_original_output_delivery(queue)
            assert len(facts[6].calls)==before
            assert not any(frame["kind"]=="streams-complete" for frame in frames)
            assert all(not handle.closed for handle in graphs[0].guards)


def test_last_file_eof_is_not_final_native_exhaustion_or_delivery_completion():
    with bound_fixture() as (queue,facts):
        native,view,request,_,resource,*_=facts
        eof=[]
        def withdraw(frame):
            if frame["kind"]=="file-eof":
                eof.append(frame)
                if len(eof)==6:resource.current=False
        with consumer(queue,on_frame=withdraw) as (frames,_):
            graphs,_=begin(queue,facts)
            list(delivery.tee_original_output_delivery(queue,native.read_original_training_output_chunks(graphs[0],view,request),0))
            with pytest.raises((delivery.OutputDeliveryUnavailable,native.LaunchUnavailable)):
                list(delivery.tee_original_output_delivery(queue,native.read_original_training_output_chunks(graphs[1],view,request),1))
            assert len(eof)==6 and queue.read()["phase"]=="failed"
            assert native._training_output_readers[graphs[1]]["read_state"]!="complete"
            assert not any(frame["kind"]=="streams-complete" for frame in frames)


def test_foreign_advancing_thread_is_refused_without_consuming_original_stream():
    with bound_fixture() as (queue,facts),consumer(queue):
        native,view,request,*_=facts
        graphs,_=begin(queue,facts);stream=native.read_original_training_output_chunks(graphs[0],view,request)
        errors=[];before=len(facts[6].calls)
        def foreign():
            try:delivery.tee_original_output_delivery(queue,stream,0)
            except delivery.OutputDeliveryUnavailable:errors.append("denied")
        thread=Thread(target=foreign);thread.start();thread.join(3)
        assert not thread.is_alive() and errors==["denied"] and len(facts[6].calls)==before
        assert queue.read()["phase"]=="active"
        assert list(delivery.tee_original_output_delivery(queue,stream,0))


def test_swallowed_owned_guard_reentry_still_fences_original_attempt():
    with bound_fixture() as (queue,facts):
        native,_,_,_,_,_,kernel,*_=facts
        graphs=workflow.prepare_members(facts);files=tuple(sealed_files(g) for g in graphs)
        before=len(kernel.calls);entered=[]
        def current():
            if not entered:
                entered.append(True)
                try:delivery.finish_original_output_delivery(queue)
                except delivery.OutputDeliveryUnavailable:pass
        with pytest.raises(delivery.OutputDeliveryUnavailable):
            delivery.begin_original_output_delivery(queue,tuple(graphs),files,(1,),current)
        assert entered==[True] and queue.read()["phase"]=="failed"
        assert len(kernel.calls)==before


def test_foreign_next_does_not_consume_the_delivery_iterator():
    with bound_fixture() as (queue,facts),consumer(queue):
        native,view,request,*_=facts
        graphs,_=begin(queue,facts)
        stream=delivery.tee_original_output_delivery(queue,native.read_original_training_output_chunks(graphs[0],view,request),0)
        errors=[];before=len(facts[6].calls)
        def foreign():
            try:next(stream)
            except delivery.OutputDeliveryUnavailable:errors.append("denied")
        thread=Thread(target=foreign);thread.start();thread.join(3)
        assert not thread.is_alive() and errors==["denied"] and len(facts[6].calls)==before
        assert queue.read()["phase"]=="active"
        assert list(stream)


def test_swallowed_actual_iterator_reentry_is_permanently_latched():
    with bound_fixture() as (queue,facts),consumer(queue):
        native,view,request,*_=facts;selected=[];reentered=[]
        def current():
            if selected and not reentered:
                reentered.append(True)
                try:next(selected[0])
                except (ValueError,delivery.OutputDeliveryUnavailable):pass
        graphs,_=begin(queue,facts,current)
        selected.append(delivery.tee_original_output_delivery(queue,native.read_original_training_output_chunks(graphs[0],view,request),0))
        with pytest.raises(delivery.OutputDeliveryUnavailable):next(selected[0])
        assert reentered==[True] and queue.read()["phase"]=="failed"


def test_receiver_abort_between_last_guard_and_completion_stays_failed(monkeypatch):
    with bound_fixture() as (queue,facts),consumer(queue) as (frames,_):
        native,view,request,*_=facts;graphs,_=begin(queue,facts)
        for group,graph in enumerate(graphs):
            list(delivery.tee_original_output_delivery(queue,native.read_original_training_output_chunks(graph,view,request),group))
        original=delivery._current;aborted=[]
        def race(receiver,record):
            original(receiver,record)
            if (sys._getframe(1).f_code.co_name=="finish_original_output_delivery"
                    and frames[-1]["kind"]=="streams-complete"):
                aborted.append(True);receiver.abort()
        monkeypatch.setattr(delivery,"_current",race)
        with pytest.raises(delivery.OutputDeliveryUnavailable):delivery.finish_original_output_delivery(queue)
        assert aborted==[True] and queue.read()["phase"]=="failed"


def test_early_validation_failure_never_invokes_a_replaced_abort_helper(monkeypatch):
    with workflow.sdk._protected_pipeline_fixture(monkeypatch) as (_,use,*_):
        calls=[]
        monkeypatch.setattr(workflow.training,"abort_original_output_delivery",lambda owner:calls.append("replacement"))
        with pytest.raises(ValueError):workflow.training._validate_protected_training_results(use)
        assert calls==[]

