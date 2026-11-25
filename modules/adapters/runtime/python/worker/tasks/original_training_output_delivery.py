"""One-pass private backend delivery, never parent custody or settlement proof.

Only the original training thread advances Native streams. A private receiver
may read/ack bounded JSON frames from another thread. Production creates no
thread, executor, transport, readiness profile or default resource producer.
"""
from __future__ import annotations

import base64
import json
from math import isfinite
from threading import Condition, RLock, get_ident
from time import monotonic
from types import FunctionType
from uuid import UUID
from weakref import WeakKeyDictionary

from ..native import windows_original_worker_launch as native

SEGMENT_BYTES = 8192
FRAME_BYTES = 64 * 1024
_COPY = native._copy_model_json
_SAME = native._same_model_json
_FAMILY = native.OriginalTrainingOutputFamily
_FAMILY_SNAPSHOT = native._output_family_snapshot
_VIEW = native._OriginalModelView
_STREAM = native._OriginalTrainingOutputStream
_NEXT = _STREAM.__next__
_TASK = native.resolve_original_training_task_id
_records = WeakKeyDictionary()
_families = WeakKeyDictionary()
_streams = WeakKeyDictionary()


class OutputDeliveryUnavailable(RuntimeError):
    def __init__(self):super().__init__("The private training output delivery is unavailable.")


def _need(value):
    if value is not True:raise OutputDeliveryUnavailable()


def _api():
    for cls,name,original,code in _API:
        value=type.__getattribute__(cls,"__dict__").get(name)
        _need(value is original and (code is None or value.__code__ is code))
    _need(native._copy_model_json is _COPY and native._same_model_json is _SAME
        and native.OriginalTrainingOutputFamily is _FAMILY and native._output_family_snapshot is _FAMILY_SNAPSHOT
        and native._OriginalModelView is _VIEW and native._OriginalTrainingOutputStream is _STREAM
        and type.__getattribute__(_STREAM,"__dict__").get("__next__") is _NEXT
        and native.resolve_original_training_task_id is _TASK)


def _record(delivery):
    _need(type(delivery) is OriginalTrainingOutputDelivery);_api()
    record=_records.get(delivery);_need(type(record) is dict)
    return record


def _bound(delivery,record):
    _need(_record(delivery) is record and record["family"] is not None
        and _families.get(record["family"]) is delivery)
    book=_FAMILY_SNAPSHOT(record["family"])
    binding=native._model_views.get(record["view"])
    _need(book is record["book"] and book["view"] is record["view"] and binding is record["binding"]
        and binding[2]==record["thread"] and _SAME(binding[1],record["request"]))
    return book


def capture_original_output_delivery(view,request):
    """Passive original association; JSON alone creates no delivery owner."""
    _api();_need(type(view) is _VIEW)
    binding=native._model_views.get(view);_need(binding is not None and binding[2]==get_ident())
    state=native._model_leases.get(binding[0]);_need(state is not None)
    family=state.get("output_copy_owner")
    if type(family) is not _FAMILY:return None
    delivery=_families.get(family)
    if delivery is None:return None
    record=_record(delivery);_bound(delivery,record)
    _need(record["view"] is view and _SAME(record["request"],_COPY(request)))
    return delivery


def original_output_delivery_matches(delivery,view):
    """Passive identity only. The guarded transfer rechecks the full request.

    The fixed loader calls its passive snapshot frequently, including after the
    family's local IO closes. Do not rerun pre-transfer admission or copy the
    same request at every such comparison.
    """
    binding=native._model_views.get(view)
    if binding is None:return False
    state=native._model_leases.get(binding[0])
    if state is None:return False
    family=state.get("output_copy_owner")
    if type(family) is not _FAMILY:return delivery is None
    original=_families.get(family)
    if delivery is None:return original is None
    record=_record(delivery)
    return original is delivery and record["family"] is family and record["view"] is view and record["binding"] is binding


def bind_original_output_delivery(delivery,family,view,request):
    """Bind before SDK callbacks under the same genuine lease lock."""
    record=_record(delivery);_need(type(family) is _FAMILY and type(view) is _VIEW)
    binding=native._model_views.get(view);_need(binding is not None and binding[2]==get_ident())
    state=native._model_leases.get(binding[0]);_need(state is not None)
    lock=state["lock"];_need(lock.acquire(blocking=False))
    try:
        copied=_COPY(request);book=_FAMILY_SNAPSHOT(family)
        _need(book["view"] is view and state.get("output_copy_owner") is family
            and _SAME(binding[1],copied) and _TASK(view,copied)==record["task_id"])
        with record["condition"]:
            _need(record["phase"]=="unbound" and record["family"] is None and family not in _families)
            record.update(family=family,view=view,request=copied,book=book,binding=binding,
                thread=get_ident(),phase="bound")
            _families[family]=delivery
    finally:lock.release()


def _fail(delivery):
    record=_record(delivery)
    _mark_failed(record)


def _mark_failed(record):
    with record["condition"]:
        record["phase"]="failed";record["condition"].notify_all()


def _current(delivery,record):
    _need(get_ident()==record["thread"])  # A foreign thread cannot poison the owner.
    if record["checking"]:
        _fail(delivery);raise OutputDeliveryUnavailable()
    record["checking"]=True
    try:
        _bound(delivery,record)
        _need(record["phase"]=="active" and monotonic()<record["deadline"])
        current=record["current"];_need(type(current) is FunctionType)
        _need(current() is None)
        _bound(delivery,record)
        _need(record["current"] is current and record["phase"]=="active" and monotonic()<record["deadline"])
    except BaseException:
        _fail(delivery);raise
    finally:record["checking"]=False


def _emit(delivery,kind,**fields):
    record=_record(delivery);_current(delivery,record)
    condition=record["condition"]
    with condition:
        if record["sending"]:
            record["phase"]="failed";condition.notify_all();raise OutputDeliveryUnavailable()
        _need(record["pending"] is None)
        record["sending"]=True;record["sequence"]+=1;sequence=record["sequence"]
        frame={"schema":"original-training-output-delivery-v1","sequence":sequence,"kind":kind,**fields}
        raw=json.dumps(frame,allow_nan=False,separators=(",",":"))
        _need(len(raw.encode("utf8"))<=FRAME_BYTES)
        record["pending"]=_COPY(frame);condition.notify_all()
    try:
        while True:
            _current(delivery,record)
            with condition:
                _need(record["phase"]=="active")
                if record["acknowledged"]==sequence and record["pending"] is None:break
                _need(record["pending"] is not None and record["pending"]["sequence"]==sequence)
                condition.wait(min(0.025,max(0.001,record["deadline"]-monotonic())))
        _current(delivery,record)
    except BaseException:
        _fail(delivery);raise
    finally:
        with condition:record["sending"]=False


class OriginalTrainingOutputDelivery:
    """Finite backend receiver capability; declarations are not real capacity."""
    __slots__=("__weakref__",)

    def __init__(self,task_id,*,maximum_files,maximum_payload_bytes,deadline):
        _need(type(self) is OriginalTrainingOutputDelivery and type(task_id) is str)
        try:_need(str(UUID(task_id))==task_id)
        except (ValueError,AttributeError):raise OutputDeliveryUnavailable() from None
        _need(type(maximum_files) is int and 1<=maximum_files<=256
            and type(maximum_payload_bytes) is int and 1<=maximum_payload_bytes<=2**53-1
            and type(deadline) in (int,float) and isfinite(deadline) and 0<deadline<=2**53-1)
        _records[self]={"task_id":task_id,"maximum_files":maximum_files,"maximum_bytes":maximum_payload_bytes,
            "deadline":deadline,"condition":Condition(RLock()),"phase":"unbound","family":None,"view":None,
            "request":None,"book":None,"binding":None,"thread":None,"current":None,"manifest":None,
            "groups":None,"next_group":0,"group_active":False,"sequence":0,"acknowledged":0,
            "pending":None,"sending":False,"checking":False,"bytes":0,"files":0}

    def read(self):
        record=_record(self)
        with record["condition"]:
            return {"phase":record["phase"],"acknowledged":record["acknowledged"],
                "frame":None if record["phase"]=="failed" or record["pending"] is None else _COPY(record["pending"])}

    def acknowledge(self,sequence):
        record=_record(self)
        _need(type(sequence) is int and sequence>0)
        with record["condition"]:
            _need(record["phase"] in ("active","complete"))
            if sequence==record["acknowledged"]:return True  # Observe the original ACK, never advance another frame.
            _need(record["pending"] is not None and record["pending"]["sequence"]==sequence
                and sequence==record["acknowledged"]+1)
            record["acknowledged"]=sequence;record["pending"]=None;record["condition"].notify_all()
            return True

    def abort(self):_fail(self)


class _OriginalDeliveryStream:
    """Refuse foreign/reentrant next BEFORE advancing the Python generator."""
    __slots__=("__weakref__",)
    def __iter__(self):return self
    def __next__(self):
        _need(type(self) is _OriginalDeliveryStream);_api()
        operation=_streams.get(self);_need(type(operation) is dict)
        record=operation["record"]
        _need(get_ident()==record["thread"])
        if operation["busy"]:
            _mark_failed(record);operation["failed"]=True;raise OutputDeliveryUnavailable()
        _need(not operation["failed"])
        if operation["complete"]:raise StopIteration
        operation["busy"]=True
        try:return next(operation["advance"])
        except StopIteration:operation["complete"]=True;raise
        except BaseException:
            operation["failed"]=True;_mark_failed(record);raise
        finally:operation["busy"]=False


def begin_original_output_delivery(delivery,graphs,inventories,steps,current):
    if delivery is None:return
    record=_record(delivery);book=_bound(delivery,record)
    _need(get_ident()==record["thread"] and type(current) is FunctionType
        and type(graphs) is tuple and type(inventories) is tuple and type(steps) is tuple
        and len(graphs)==len(inventories)==len(steps)+1==len(book["members"]))
    groups=[];manifest=[];total=0
    for group,(graph,files) in enumerate(zip(graphs,inventories)):
        reader=native._training_output_readers.get(graph)
        _need(book["members"][group]["graph"] is graph and reader is not None
            and reader["family"] is record["family"] and reader["view"] is record["view"]
            and reader["sealed"] is True and reader["read_state"]=="unread" and type(files) is tuple)
        _need(files==tuple((name,size,sha) for _,_,_,name,size,sha in reader["handles"]))
        rows=[]
        for name,size,sha in files:
            _need(type(name) is str and name in native._TRAINING_OUTPUT_FILES and type(size) is int and size>0
                and type(sha) is str and len(sha)==64 and all(c in "0123456789abcdef" for c in sha))
            row={"fileIndex":len(manifest),"groupIndex":group,"name":name,"sizeBytes":size,"sha256":"sha256:"+sha,
                "role":"candidate" if group==len(graphs)-1 else "checkpoint"}
            manifest.append(row);rows.append((name,size,sha,row["fileIndex"]));total+=size
        groups.append((graph,reader,files,tuple(rows)))
    _need(0<len(manifest)<=record["maximum_files"] and total<=record["maximum_bytes"])
    with record["condition"]:
        _need(record["phase"]=="bound" and record["manifest"] is None)
        record.update(phase="active",current=current,manifest=tuple(manifest),groups=tuple(groups))
    try:_emit(delivery,"manifest",taskId=record["task_id"],files=manifest,totalBytes=total)
    except BaseException:_fail(delivery);raise


def tee_original_output_delivery(delivery,stream,group):
    if delivery is None:return stream
    record=_record(delivery);_current(delivery,record)
    _need(type(group) is int and 0<=group<len(record["groups"]) and group==record["next_group"] and not record["group_active"]
        and type(stream) is _STREAM)
    graph,reader,files,rows=record["groups"][group]
    operation=native._training_output_streams.get(stream)
    _need(operation is not None and operation[0] is reader and reader["stream"] is stream
        and reader["read_state"]=="reading" and native._training_output_readers.get(graph) is reader)
    record["group_active"]=True
    def advance():
        index=offset=0
        try:
            while True:
                _current(delivery,record)
                try:event=_NEXT(stream)
                except StopIteration:
                    _need(index==len(rows) and offset==0 and reader["read_state"]=="complete")
                    _current(delivery,record);record["next_group"]+=1;record["group_active"]=False
                    return
                _need(type(event) is tuple and len(event)==3 and index<len(rows))
                name,position,raw=event;expected,size,_,file_index=rows[index]
                _need(type(name) is str and name==expected and type(position) is int and position==offset
                    and type(raw) is bytes and len(raw)<=size-offset)
                if raw:
                    for at in range(0,len(raw),SEGMENT_BYTES):
                        piece=raw[at:at+SEGMENT_BYTES]
                        _emit(delivery,"data",fileIndex=file_index,offset=offset+at,
                            data=base64.b64encode(piece).decode("ascii"))
                    offset+=len(raw);record["bytes"]+=len(raw)
                else:
                    _need(offset==size)
                    _emit(delivery,"file-eof",fileIndex=file_index,sizeBytes=size)
                    index+=1;offset=0;record["files"]+=1
                _current(delivery,record)
                yield event  # The parser receives the exact original tuple once.
        except BaseException:
            _mark_failed(record);raise
    token=object.__new__(_OriginalDeliveryStream)
    _streams[token]={"record":record,"advance":advance(),"busy":False,"complete":False,"failed":False}
    return token


def finish_original_output_delivery(delivery):
    if delivery is None:return
    record=_record(delivery);_current(delivery,record)
    _need(not record["group_active"] and record["next_group"]==len(record["groups"])
        and record["files"]==len(record["manifest"])
        and record["bytes"]==sum(row["sizeBytes"] for row in record["manifest"]))
    _emit(delivery,"streams-complete",fileCount=record["files"],totalBytes=record["bytes"],provisional=True)
    _current(delivery,record)
    with record["condition"]:
        # Abort uses this same condition. A received final ACK cannot revive a
        # cancellation between the last guard and the completion publication.
        _need(record["phase"]=="active" and record["pending"] is None
            and record["acknowledged"]==record["sequence"] and not record["sending"] and not record["checking"])
        record["phase"]="complete";record["condition"].notify_all()


def abort_original_output_delivery(delivery):
    if delivery is not None:_fail(delivery)


_API=tuple((cls,name,type.__getattribute__(cls,"__dict__").get(name),
    value.__code__ if type(value:=type.__getattribute__(cls,"__dict__").get(name)) is FunctionType else None)
    for cls in (OriginalTrainingOutputDelivery,_OriginalDeliveryStream)
    for name in ("__getattribute__","__getattr__","__hash__","__eq__","__init__","__iter__","__next__","read","acknowledge","abort"))
