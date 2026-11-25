"""Private HTTP delivery with finite Native fixtures; no real model/producer."""
from contextlib import contextmanager
from copy import deepcopy
import base64
import hashlib
import json
from threading import Event, Thread
from time import monotonic, sleep
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from modules.adapters.runtime.python.worker import app
from modules.adapters.runtime.python.worker.models import TrainModelTaskRequest, TrainModelTaskResult
from modules.adapters.runtime.python.worker.tasks import approved_local_training_session as session
from modules.adapters.runtime.python.worker.tasks import original_training_output_delivery as delivery
from modules.adapters.runtime.python.worker.tests import test_approved_local_training_session as old
from modules.adapters.runtime.python.worker.tests import test_native_training_model_graph as finite


class Resources(old.Resources):
    def __init__(self, queue, payload):
        super().__init__();self.queue=queue;self.payload=payload;self.retained_before_callback=False
    def output_delivery(self):
        record=next(iter(app.TASK_REGISTRY.values()))
        self.retained_before_callback=record["_originalTrainingOwner"].native is self
        return self.queue
    def seal_inputs(self,value):
        self.calls.append("seal")
        return TrainModelTaskRequest.model_validate(deepcopy(self.payload))


@contextmanager
def native_fixture():
    case=finite.CombinedTrainingInputViewTests()
    try:
        native,source,lease,inputs,request,staged,control,kernel=case.fixture()
        definition=deepcopy(native._verified_model_receivers[source]["definition"])
        task=native._verified_model_receivers[source]["task_id"]
        queue=delivery.OriginalTrainingOutputDelivery(task,maximum_files=64,
            maximum_payload_bytes=256*1024,deadline=monotonic()+15)
        yield native,lease,request,staged,control,kernel,definition,queue
    finally:case.doCleanups()


@contextmanager
def http_fixture(definition,staged,queue,payload,*,resource_type=Resources):
    resources=resource_type(queue,payload);producer=old.Producer(resources);executor=old.QueuedExecutor()
    token="synthetic-private-output-channel-token"
    with patch.object(app,"TASK_REGISTRY",{}),patch.object(app,"TASK_EXECUTOR",executor), \
            patch.object(app,"_ORIGINAL_TRAINING_PRODUCER",None),patch.object(app,"_ORIGINAL_TRAINING_PROFILE",None), \
            patch.object(app,"RUNTIME_AUTH_TOKEN",token),TestClient(app.app) as client:
        app.configure_original_training(producer)
        headers={"authorization":"Bearer "+token}
        response=client.post("/training/original/prepare",json={"identity":app._training_identity(),"definition":definition},headers=headers)
        assert response.status_code==200 and response.json()["phase"]=="ready"
        binding=response.json()["binding"];task=definition["requestId"]
        def call(action,**extra):
            return client.post(f"/training/original/{task}/{action}",json={"binding":binding,**extra},headers=headers)
        sealed=call("seal",input=staged)
        assert sealed.status_code==200 and sealed.json()["phase"]=="ready"
        owner=app.TASK_REGISTRY[task]["_originalTrainingOwner"]
        try:yield client,call,binding,headers,owner,resources,executor
        finally:
            try:owner.cancel()
            finally:session._output_sessions.pop(owner,None)


def prepare_family(facts,view):
    native,_,request,_,control,kernel,_,queue=facts
    kernel.node("X:\\output-channel",True)
    configs=[{"freshParent":"X:\\output-channel","freshName":name,"maximumCopyBytes":128*1024,
        "bufferBytes":4096,"preparationMs":30000} for name in ("checkpoint","candidate")]
    family=native.OriginalTrainingOutputFamily(view,request,{"maximumCopyBytes":256*1024,"outputs":configs},control,control)
    delivery.bind_original_output_delivery(queue,family,view,request)
    contents={"tokenizer.json":b'{"synthetic":true}',"adapter_config.json":b'{}',"adapter_model.safetensors":b"synthetic-container"}
    declared=[{"name":name,"sizeBytes":len(raw)} for name,raw in contents.items()]
    graphs=[]
    for config in configs:
        graph=native.OriginalTrainingOutputGraph(view,request,config,declared,control,control,_family=family)
        graph.prepare({name:(raw,) for name,raw in contents.items()});graphs.append(graph)
    inventories=tuple(tuple((row["name"],row["sizeBytes"],row["sha256"]) for row in graph.records) for graph in graphs)
    return family,graphs,inventories,contents


def test_private_queue_capture_precedes_prepare_and_default_binding_is_not_wire_authority():
    with native_fixture() as facts:
        _,_,request,staged,_,_,definition,queue=facts
        with http_fixture(definition,staged,queue,request) as (_,call,_,_,owner,resources,_):
            assert resources.retained_before_callback is True and resources.calls==["prepare","seal"]
            result=call("output-read")
            assert result.status_code==200 and result.json()["output"]=={"phase":"unbound","acknowledged":0,"frame":None}
            assert call("output-ack",sequence=1).status_code==409
            assert owner.settle() is False


def test_real_native_bytes_cross_authenticated_private_read_ack_without_new_executor():
    with native_fixture() as facts:
        native,lease,request,staged,control,kernel,definition,queue=facts
        with http_fixture(definition,staged,queue,request) as (_,call,binding,_,owner,_,executor):
            with lease.borrow(request) as view:
                _,graphs,inventories,contents=prepare_family(facts,view)
                frames=[];errors=[];stop=Event()
                def receive():
                    previous=0
                    try:
                        while not stop.is_set():
                            reply=call("output-read");assert reply.status_code==200
                            envelope=reply.json();assert envelope["binding"]==binding
                            assert len(json.dumps(envelope).encode())<=session.MAX_BODY_BYTES
                            result=envelope["output"];frame=result["frame"]
                            if result["phase"] in ("complete","failed"):return
                            if frame is not None and frame["sequence"]!=previous:
                                assert call("output-read").json()["output"]==result
                                frames.append(frame);previous=frame["sequence"]
                                acknowledged=call("output-ack",sequence=previous)
                                assert acknowledged.status_code==200 and acknowledged.json()["acknowledged"] is True
                                assert call("output-ack",sequence=previous).json()["acknowledged"] is True
                                assert call("output-read").json()["output"]["acknowledged"]==previous
                            sleep(.001)
                    except BaseException as error:errors.append(error);queue.abort()
                thread=Thread(target=receive);thread.start()
                try:
                    delivery.begin_original_output_delivery(queue,tuple(graphs),inventories,(1,),lambda:None)
                    for group,graph in enumerate(graphs):
                        events=list(delivery.tee_original_output_delivery(queue,native.read_original_training_output_chunks(graph,view,request),group))
                        assert len([event for event in events if not event[2]])==3
                    delivery.finish_original_output_delivery(queue)
                    assert owner.read_output()["phase"]=="complete"
                finally:stop.set();thread.join(3)
                assert not thread.is_alive() and errors==[] and executor.calls==0
                assert frames[0]["kind"]=="manifest" and frames[-1]["kind"]=="streams-complete"
                for row in frames[0]["files"]:
                    raw=b"".join(base64.b64decode(frame["data"]) for frame in frames
                        if frame["kind"]=="data" and frame["fileIndex"]==row["fileIndex"])
                    assert raw==contents[row["name"]] and "sha256:"+hashlib.sha256(raw).hexdigest()==row["sha256"]
                assert all(native._training_output_readers[graph]["read_state"]=="complete" for graph in graphs)
                assert all(not handle.closed for graph in graphs for handle in graph.guards)
            assert owner.read_output()["phase"]=="complete"  # Recorded lineage survives live-view exit.


def test_authentication_exact_binding_runtime_and_schema_deny_without_source_effects():
    with native_fixture() as facts:
        _,_,request,staged,_,kernel,definition,queue=facts
        with http_fixture(definition,staged,queue,request) as (client,call,binding,headers,_,_,_):
            task=definition["requestId"];url=f"/training/original/{task}/output-read";before=len(kernel.calls)
            assert client.post(url,json={"binding":binding}).status_code==401
            wrong={**binding,"sessionId":"0"*64}
            assert client.post(url,json={"binding":wrong},headers=headers).status_code==409
            assert client.post("/training/original/00000000-0000-4000-8000-000000000001/output-read",
                json={"binding":binding},headers=headers).status_code==409
            assert call("output-read",input={}).status_code==409
            for value in (True,False,0,-1,1.5,"1",2**53):
                assert call("output-ack",sequence=value).status_code==409
            with patch.object(app,"WORKER_STARTED_AT","replaced"):
                assert call("output-read").status_code==409
            assert client.get(f"/tasks/{task}",headers=headers).status_code==409
            oversized=client.post(url,content=b"x"*(session.MAX_BODY_BYTES+1),headers=headers)
            assert oversized.status_code==409 and oversized.json()=={"error":"original_training_unavailable"}
            assert len(kernel.calls)==before and queue.read()["phase"]=="unbound"


def test_same_task_id_does_not_authorize_a_different_sealed_training_request():
    with native_fixture() as facts:
        _,lease,request,staged,_,kernel,definition,queue=facts
        changed_definition=deepcopy(definition);changed_staged=deepcopy(staged);changed_request=deepcopy(request)
        for value in (changed_definition["request"],changed_staged["payload"],changed_request):
            value.setdefault("commonParameters",{})["maxSteps"]=999
        with http_fixture(changed_definition,changed_staged,queue,changed_request) as (_,call,*_):
            with lease.borrow(request) as view:
                prepare_family(facts,view);before=len(kernel.calls)
                assert call("output-read").status_code==409 and call("output-ack",sequence=1).status_code==409
                assert len(kernel.calls)==before and queue.read()["phase"]=="bound"


def test_cancellation_wakes_blocked_delivery_and_preserves_all_native_guards():
    with native_fixture() as facts:
        native,lease,request,staged,_,kernel,definition,queue=facts
        with http_fixture(definition,staged,queue,request) as (_,call,_,_,owner,resources,_):
            with lease.borrow(request) as view:
                _,graphs,files,_=prepare_family(facts,view);errors=[];before=len(kernel.calls)
                def cancel():
                    try:
                        for _ in range(200):
                            reply=call("output-read");assert reply.status_code==200
                            if reply.json()["output"]["frame"] is not None:break
                            sleep(.001)
                        else:raise AssertionError("No original manifest arrived.")
                        assert call("cancel").json()["cancelled"] is True
                    except BaseException as error:errors.append(error);queue.abort()
                thread=Thread(target=cancel);thread.start()
                try:
                    with pytest.raises(delivery.OutputDeliveryUnavailable):
                        delivery.begin_original_output_delivery(queue,tuple(graphs),files,(1,),lambda:None)
                finally:thread.join(3)
                assert not thread.is_alive() and errors==[] and "cancel" in resources.calls
                assert queue.read()["phase"]=="failed" and owner.blocks_recovery is True
                assert len(kernel.calls)==before and all(not handle.closed for graph in graphs for handle in graph.guards)
                assert all(native._training_output_readers[graph]["read_state"]=="unread" for graph in graphs)
                assert call("output-read").status_code==409


def test_missing_output_capability_stays_unavailable_without_adopting_a_queue():
    class DefaultResources(old.Resources):
        def __init__(self,queue,payload):super().__init__()
    with native_fixture() as facts:
        _,_,request,staged,_,_,definition,queue=facts
        with http_fixture(definition,staged,queue,request,resource_type=DefaultResources) as (_,call,_,_,owner,*_):
            assert call("output-read").status_code==409 and call("output-ack",sequence=1).status_code==409
            assert owner not in session._output_sessions and queue.read()["phase"]=="unbound"


def test_queue_factory_property_and_foreign_values_are_rejected_before_prepare_io():
    calls=[]
    class PropertyResources(old.Resources):
        @property
        def output_delivery(self):calls.append("getter");return None
    for resource in (PropertyResources(),Resources(object(),{})):
        owner=session.OriginalTrainingSession(old.definition(),old.Producer(resource),lambda:True,
            lambda **value:True,lambda _:None)
        assert owner.prepare()=="unconfirmed" and owner.native is resource and resource.calls==[]
        assert owner.known_not_run is False and owner.blocks_recovery is True
        assert owner not in session._output_sessions
    assert calls==[]


def test_original_queue_aborts_even_when_native_cancellation_raises():
    with native_fixture() as facts:
        _,_,request,staged,_,_,definition,queue=facts
        with http_fixture(definition,staged,queue,request) as (_,call,_,_,owner,resources,_):
            def fail():raise RuntimeError("synthetic-private-cancel-detail")
            resources.cancel_hook=fail
            response=call("cancel")
            assert response.status_code==200 and response.json()["cancelled"] is False
            assert "synthetic-private" not in response.text
            assert queue.read()["phase"]=="failed" and owner.blocks_recovery is True
            assert call("output-read").status_code==409
            assert resources.calls.count("cancel")==1


def test_replaced_original_resource_cannot_read_or_ack_the_captured_queue():
    with native_fixture() as facts:
        _,_,request,staged,_,kernel,definition,queue=facts
        with http_fixture(definition,staged,queue,request) as (_,call,_,_,owner,resources,_):
            before=len(kernel.calls);owner.native=object()
            try:
                assert call("output-read").status_code==409 and call("output-ack",sequence=1).status_code==409
                assert queue.read()["phase"]=="unbound" and len(kernel.calls)==before
            finally:owner.native=resources


def test_configured_but_undelivered_outputs_cannot_publish_training_success():
    # The loader boundary is explicitly inert; this tests session publication,
    # never actual training, Native resources or a readiness/quality result.
    with native_fixture() as facts:
        _,_,request,staged,_,_,definition,queue=facts
        with patch.object(session,"resolve_original_model_view",return_value="inert-only"), \
                patch.object(session,"train_model_from_local_files",return_value=TrainModelTaskResult(runId="inert",status="succeeded")) as loader:
            with http_fixture(definition,staged,queue,request) as (_,call,_,_,owner,_,executor):
                assert call("start").json()["kind"]=="accepted"
                executor.run()
                assert loader.call_count==1 and call("read").json()["record"]["status"]=="failed"
                assert queue.read()["phase"]=="failed" and owner.blocks_recovery is True


@pytest.mark.parametrize("kind",["workspace","owner","dataset","proposal","model-revision"])
def test_same_task_and_typed_payload_do_not_authorize_a_different_original_scope(kind):
    with native_fixture() as facts:
        _,lease,request,staged,_,kernel,definition,queue=facts
        changed=deepcopy(definition);inputs=deepcopy(staged)
        if kind=="workspace":
            changed["workspaceId"]="workspace.other"
            changed["request"]["workspaceId"]="workspace.other"
            inputs["payload"]["workspaceId"]="workspace.other"
        elif kind=="owner":changed["owner"]["principalId"]="different-actor"
        elif kind=="dataset":changed["dataset"]["versionId"]="other-version"
        elif kind=="proposal":changed["proposalDigest"]="sha256:"+"f"*64
        else:changed["modelUpdatedAt"]="2026-11-24T00:00:00Z"
        with http_fixture(changed,inputs,queue,request) as (_,call,*_):
            with lease.borrow(request) as view:
                prepare_family(facts,view);before=len(kernel.calls)
                response=call("output-read")
                assert response.status_code==409
                assert response.json()=={"error":"original_training_unavailable"}
                assert len(kernel.calls)==before and queue.read()["phase"]=="bound"


def test_cancel_during_queue_callback_aborts_captured_intent_before_prepare_io():
    queue=delivery.OriginalTrainingOutputDelivery(old.TASK,maximum_files=4,
        maximum_payload_bytes=1024,deadline=monotonic()+10)
    holder={}
    class CancelResources(old.Resources):
        def output_delivery(self):
            assert holder["owner"].native is self
            assert holder["owner"].cancel() is True
            return queue
    resources=CancelResources()
    owner=session.OriginalTrainingSession(old.definition(),old.Producer(resources),lambda:True,
        lambda **value:True,lambda _:None);holder["owner"]=owner
    try:
        assert owner.prepare()=="unconfirmed"
        assert owner.cancelled is True and resources.calls==["cancel"]
        assert queue.read()["phase"]=="failed" and owner.blocks_recovery is True
    finally:queue.abort();session._output_sessions.pop(owner,None)


def test_recorded_native_source_identity_cannot_be_replaced_with_an_equal_copy():
    with native_fixture() as facts:
        native,lease,request,staged,_,kernel,definition,queue=facts
        with http_fixture(definition,staged,queue,request) as (_,call,_,_,owner,*_):
            with lease.borrow(request) as view:
                prepare_family(facts,view)
                assert call("output-read").status_code==200
                witness=session._output_sessions[owner]["scope_owner"];source,original=witness[6:8]
                before=len(kernel.calls);native._verified_model_receivers[source]=dict(original)
                try:
                    assert call("output-read").status_code==409 and call("output-ack",sequence=1).status_code==409
                    assert len(kernel.calls)==before and queue.read()["phase"]=="bound"
                finally:native._verified_model_receivers[source]=original


def test_original_scope_is_rechecked_after_the_read_permission_callback():
    with native_fixture() as facts:
        native,lease,request,staged,_,kernel,definition,queue=facts
        with http_fixture(definition,staged,queue,request) as (_,call,_,_,owner,*_):
            with lease.borrow(request) as view:
                prepare_family(facts,view)
                book=delivery._record(queue)["book"]
                original=native._verified_model_receivers[book["lease_state"]["source"]]
                actor=original["definition"]["owner"]["principalId"];current=owner.current;calls=[]
                def changed():
                    calls.append(True)
                    if len(calls)==2:original["definition"]["owner"]["principalId"]="other-actor"
                    return current()
                owner.current=changed;before=len(kernel.calls)
                try:
                    assert call("output-read").status_code==409 and len(calls)==2
                    assert len(kernel.calls)==before and queue.read()["phase"]=="bound"
                finally:original["definition"]["owner"]["principalId"]=actor;owner.current=current
