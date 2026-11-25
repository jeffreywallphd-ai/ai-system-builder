"""Original local no-new-work proof. Never SDK/worker/Job exit or storage credit.

The future distinct exit-ready protocol must run this on the original executor,
then obtain the existing exact Native worker/Job retirement proof. Default hosts
and settled-v1 are unchanged. No filesystem/Native effects occur in this module.
"""
from threading import RLock,Lock,get_ident
from weakref import WeakKeyDictionary
from types import GetSetDescriptorType

from . import original_training_files as files
from ..native import windows_original_worker_launch as native

_RECORD=files._record
_SNAPSHOT=files._snapshot
_STAMP=files._stamp
_NATIVE_SNAPSHOT=files._retained_native_snapshot
_PREPARED=files._prepared_files
_OWNERS=files._owners
_LEASES=files._leases
_BINDINGS=files._bindings
_LOCKS=files._file_locks
_MODEL_LEASES=native._model_leases
_MODEL_SOURCES=native._verified_model_receivers
_INPUTS=native._sealed_training_inputs
_INPUT_READERS=native._training_input_readers
_OUTPUT_READERS=native._training_output_readers
_OUTPUT_FAMILIES=native._training_output_families
_MODEL_VIEWS=native._model_views
_INPUT_BINDING=native._assert_training_input_read_binding
_FAMILY_IO=native._original_output_family_io
_CLOSED=native._output_family_io_snapshot
_PLAIN=native._assert_plain_output_io_type
_RLOCK=type(RLock())
_LOCK=type(Lock())
_barriers=WeakKeyDictionary()
_tokens=WeakKeyDictionary()


class OriginalTrainingExitUnavailable(ValueError):
    def __init__(self):super().__init__("The original training file exit proof is unavailable.")


class _OriginalTrainingFileExit:
    __slots__=("__weakref__",)


_TOKEN_CLASS=_OriginalTrainingFileExit
_TOKEN_API=tuple((base,name,type.__getattribute__(base,"__dict__").get(name))
    for base in type.__getattribute__(_TOKEN_CLASS,"__mro__") for name in ("__new__","__init__","__getattribute__","__getattr__","__hash__","__eq__"))
_NATIVE_API=tuple((name,getattr(native,name)) for name in (
    "_output_io_current","_output_io_accounting_current","_assert_plain_output_graph_type"))


def _need(value):
    if value is not True:raise OriginalTrainingExitUnavailable()


def _api():
    _need(files._record is _RECORD and files._snapshot is _SNAPSHOT and files._stamp is _STAMP
        and files._retained_native_snapshot is _NATIVE_SNAPSHOT and files._prepared_files is _PREPARED
        and files._owners is _OWNERS and files._leases is _LEASES and files._bindings is _BINDINGS and files._file_locks is _LOCKS
        and native._model_leases is _MODEL_LEASES and native._verified_model_receivers is _MODEL_SOURCES
        and native._sealed_training_inputs is _INPUTS and native._training_input_readers is _INPUT_READERS
        and native._training_output_readers is _OUTPUT_READERS and native._training_output_families is _OUTPUT_FAMILIES
        and native._model_views is _MODEL_VIEWS
        and native._assert_training_input_read_binding is _INPUT_BINDING and native._original_output_family_io is _FAMILY_IO
        and native._output_family_io_snapshot is _CLOSED and native._assert_plain_output_io_type is _PLAIN)
    _need(_OriginalTrainingFileExit is _TOKEN_CLASS and all(type.__getattribute__(base,"__dict__").get(name) is original
        for base,name,original in _TOKEN_API) and all(getattr(native,name) is original for name,original in _NATIVE_API))
    _PLAIN(_TOKEN_CLASS,_TOKEN_CLASS,frozenset())


def _native_matches(original):
    current=_NATIVE_SNAPSHOT(original[0])
    _need(len(current)==len(original) and all(a is b for a,b in zip(current[:8],original[:8]))
        and len(current[8])==len(original[8]))
    for actual,expected in zip(current[8],original[8]):
        _need(actual[0] is expected[0] and actual[1] is expected[1]
            and all(type(a) is type(b) and a==b for a,b in zip(actual[2:],expected[2:])))
    fields=object.__getattribute__(original[0],"__dict__")
    _need(type(fields.get("thread")) is int and fields["thread"]==get_ident())


def _plain_object(value,expected):
    _need(type(value) is expected)
    _PLAIN(type(value),expected,frozenset())
    for base in type.__getattribute__(expected,"__mro__"):
        descriptor=type.__getattribute__(base,"__dict__").get("__dict__")
        _need(descriptor is None or type(descriptor) is GetSetDescriptorType)
    try:fields=object.__getattribute__(value,"__dict__")
    except AttributeError:fields={}
    _need(type(fields) is dict)
    _PLAIN(type(value),expected,frozenset(fields))


def _source(owner,record,prepared,*,fenced):
    _api();_SNAPSHOT(owner,record)
    _need(_PREPARED.get(owner) is prepared and type(prepared) is tuple and len(prepared)==14)
    state,source_record,source,graph,reader,sealed=prepared[1:7]
    _plain_object(source,native.OriginalModelBootstrapReceiver)
    _plain_object(graph,native.OriginalTrainingInputGraph)
    _plain_object(record["lease"],native.OriginalInheritedModelLease)
    _need(record is prepared[0] and record["state"] is state and record["source_record"] is source_record
        and record["source"] is source and record["input"] is graph and record["lock"] is prepared[10] is _LOCKS.get(owner)
        and _MODEL_LEASES.get(record["lease"]) is state and state["lock"] is prepared[9]
        and _MODEL_SOURCES.get(source) is source_record and _INPUT_READERS.get(graph) is reader and _INPUTS.get(graph) is sealed
        and _STAMP(record["payload"])==prepared[7] and _STAMP(record["definition"])==prepared[8]
        and type(source_record["task_id"]) is str and source_record["task_id"]==prepared[13][0]
        and type(source_record["definition_digest"]) is str and source_record["definition_digest"]==prepared[13][1]
        and _STAMP(sealed["request"])==prepared[7]
        and sealed["lease_state"] is state and sealed["native_owner"] is graph.owner
        and sealed["active"] is False and sealed["lost"] is False and sealed["checking"] is False
        and state.get("input_copy_owner") is graph and state.get("input_copy_io_active") is None
        and state.get("input_source_read_active") is None and record["poisoned"] is False)
    _need(type(source) is native.OriginalModelBootstrapReceiver)
    _PLAIN(type(source),native.OriginalModelBootstrapReceiver,frozenset(("phase","owner","lock")))
    _need(source.owner is state["native_owner"] and source.lock is prepared[9]
        and type(source.phase) is str and source.phase==("exit-ready" if fenced else "spent")
        and state["entered"] is True and state.get("borrowed_input") is sealed and sealed["active"] is False
        and record["closed"] is True and record["output_closed"] is True
        and record["phase"]==("exit-ready" if fenced else "local-output-closed"))
    # Admit original Native/Handle namespaces BEFORE a reused helper reads
    # their attributes. Passive metadata primitives precede truth/equality too.
    _native_matches(prepared[11]);_native_matches(prepared[12])
    _need(type(reader) is dict and reader.get("sealed") is True and type(reader.get("preparing")) is bool
        and type(reader.get("read_state")) is str and reader["read_state"] in ("unread","complete"))
    _INPUT_BINDING(graph,reader)
    family=record["family"];_need(type(family) is native.OriginalTrainingOutputFamily)
    _plain_object(family,native.OriginalTrainingOutputFamily)
    original_book=_OUTPUT_FAMILIES.get(family)
    _need(type(original_book) is dict and type(original_book.get("thread")) is int
        and type(original_book.get("phase")) is str and type(original_book.get("io")) is dict
        and type(original_book["io"].get("stage")) is str)
    book,io=_FAMILY_IO(family)
    _need(book is original_book and io is original_book["io"])
    _plain_object(book["view"],native._OriginalModelView)
    _need(book["lease"] is record["lease"] and book["lease_state"] is state and book["view"] not in native._model_views
        and _STAMP(book["request"])==prepared[7] and io["stage"]=="complete" and book["phase"]=="retired"
        and type(io.get("closed")) is tuple and len(io["closed"])==2
        and type(io.get("lock")) is _LOCK and not io["lock"].locked())
    rows,expected=io["closed"];_CLOSED(family,book,io,rows,expected)
    for _,graph,_ in rows:
        _plain_object(graph,native.OriginalTrainingOutputGraph)
        output=native._training_output_readers.get(graph)
        _need(output is not None and output["io"]["stage"]=="complete")
        operation,reading=output["io"]["operation_lock"],output.get("read_lock")
        _need(type(operation) is _LOCK and not operation.locked()
            and (reading is None or type(reading) is _LOCK and not reading.locked()))
        fields=object.__getattribute__(output["owner"],"__dict__")
        _need(all(handle.closed is True and handle.close_attempted is True for handle in fields["handles"]))
    return family,book,io,rows,expected


def _acquire(record,prepared):
    acquired=[]
    try:
        locks=(record["lock"],prepared[9],prepared[11][1],prepared[12][1])
        _need(record["lock"] is prepared[10] and prepared[9] is record["state"]["lock"])
        for lock in locks:
            _need(type(lock) in (_RLOCK,_LOCK) and not any(lock is prior for prior in acquired))
            if type(lock) is _RLOCK:_need(not _RLOCK._is_owned(lock))
            _need(lock.acquire(blocking=False));acquired.append(lock)
        return acquired
    except Exception:
        for lock in reversed(acquired):lock.release()
        raise


def prepare_original_training_file_exit(owner):
    """One genuine post-borrow local barrier. Busy/unknown grants no witness.

    This proves no complete process/SDK retirement. Model/input handles and all
    output accounting stay retained; output guards were already locally closed.
    """
    acquired=[];attempt=None
    try:
        _api();record=_RECORD(owner);prepared=_PREPARED.get(owner)
        _need(prepared is not None and get_ident()==record["thread"] and owner not in _barriers)
        _need(record["lock"] is _LOCKS.get(owner) is prepared[10] and prepared[9] is record["state"]["lock"])
        acquired=_acquire(record,prepared)
        _SNAPSHOT(owner,record)
        if record["phase"] in ("bound","prepared","preparing","borrowing","running"):
            return None  # Known unfinished work is a non-consuming observation.
        # Once original terminal evidence is inspected, uncertainty is sticky.
        # Resetting a mutable unknown flag cannot revive this same owner.
        attempt={"record":record,"prepared":prepared,"closed":None,"phase":"checking","token":None}
        _barriers[owner]=attempt
        closed=_source(owner,record,prepared,fenced=False)
        attempt["closed"]=closed;attempt["phase"]="fencing"
        # Pure original fields, no callback, await, file effect or guard close.
        record["closed"]=True;record["cancelled"]=True;record["phase"]="exit-ready"
        object.__getattribute__(record["source"],"__dict__")["phase"]="exit-ready"
        _source(owner,record,prepared,fenced=True)
        token=_OriginalTrainingFileExit();attempt["token"]=token;attempt["phase"]="ready"
        _tokens[token]=(owner,attempt)
        return token
    except Exception:
        if attempt is not None:attempt["phase"]="unconfirmed"
        return None
    finally:
        for lock in reversed(acquired):lock.release()


def consume_original_training_file_exit(owner,token):
    """Fixed one-use resolver; returned correlation data is not wire authority."""
    _api();_need(type(token) is _OriginalTrainingFileExit)
    # No owner weak-key lookup is allowed before its genuine class API is checked.
    try:original_record=_RECORD(owner)
    except Exception:raise OriginalTrainingExitUnavailable() from None
    binding=_tokens.get(token);_need(type(binding) is tuple and len(binding)==2 and binding[0] is owner)
    attempt=binding[1];_need(_barriers.get(owner) is attempt and attempt["token"] is token and attempt["phase"]=="ready")
    record=attempt["record"];_need(record is original_record and get_ident()==record["thread"])
    acquired=_acquire(record,attempt["prepared"])
    try:
        attempt["phase"]="consuming"
        closed=_source(owner,record,attempt["prepared"],fenced=True)
        _need(all(a is b for a,b in zip(closed,attempt["closed"])))
        attempt["phase"]="consumed"
        return {"taskId":record["source_record"]["task_id"],"definitionDigest":record["source_record"]["definition_digest"],
            "localAdmission":"permanently-fenced","workerRetirement":"not-qualified","outputCustody":"not-qualified"}
    except Exception:
        attempt["phase"]="unconfirmed"
        raise OriginalTrainingExitUnavailable() from None
    finally:
        for lock in reversed(acquired):lock.release()
