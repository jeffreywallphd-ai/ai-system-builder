"""One original protected file workflow; never a full Native resource producer.

The caller must already own the real input/output reservation and business
admission. Model/input guards and every byte charge remain retained for original
worker retirement. No method implements NativeTrainingResources.settle(),
releases capacity, saves a Model or configures a public host.
"""
from __future__ import annotations

from contextlib import contextmanager
from importlib import import_module
from json import dumps as _json_dumps
from threading import RLock, get_ident
from types import FunctionType, GetSetDescriptorType, MethodType
from weakref import ReferenceType, WeakKeyDictionary, ref

from ..models import TrainModelTaskRequest
from ..native import windows_original_worker_launch as native
from . import original_training_output_delivery as output_delivery
training = import_module(".train_model",__package__)


_COPY = native._copy_model_json
_LEASE = native._capture_original_training_file_lease
_CONFIG = native._capture_training_copy_configuration
_OUTPUTS = native._capture_training_output_family_configuration
_INPUT_MANIFEST = native._capture_training_input_copy
_EXACT = native.exact
_INPUT_TYPE = native.OriginalTrainingInputGraph
_INPUT_INIT = _INPUT_TYPE.__init__
_INPUT_PREPARE = _INPUT_TYPE.prepare
_INPUT_SEALED = _INPUT_TYPE.assert_sealed
_BORROW = native.OriginalInheritedModelLease.borrow
_FAMILY_TYPE = native.OriginalTrainingOutputFamily
_FAMILY_INIT = _FAMILY_TYPE.__init__
_RETIRE = native.retire_original_training_output_family
_CLOSED = native._output_family_io_snapshot
_FAMILY_IO = native._original_output_family_io
_LOADER = training.train_model_from_local_files
_VALIDATE = TrainModelTaskRequest.__pydantic_validator__.validate_python
_SERIALIZE = TrainModelTaskRequest.__pydantic_serializer__.to_python
_DELIVERY_RECORD = output_delivery._record
_DELIVERY_BIND = output_delivery.bind_original_output_delivery
_owners = WeakKeyDictionary()
_leases = WeakKeyDictionary()
_bindings = WeakKeyDictionary()


def _need(value):
    if value is not True:
        raise ValueError("The original training files are unavailable.")


def _method(owner,name):
    """Capture the original receiver without invoking a supplied getter."""
    _need(type(owner) not in (dict,list,tuple,str,int,bool,type(None)))
    bases=type.__getattribute__(type(owner),"__mro__")
    _need(len(bases)<=8)
    for base in bases:
        dictionary=type.__getattribute__(base,"__dict__")
        descriptor=dictionary.get("__dict__")
        _need(descriptor is None or type(descriptor) is GetSetDescriptorType)
    try:attributes=object.__getattribute__(owner,"__dict__")
    except AttributeError:attributes={}
    _need(type(attributes) is dict)
    if name in attributes:
        method=attributes[name]
        _need(type(method) is MethodType and method.__self__ is owner and type(method.__func__) is FunctionType)
        return method
    for base in bases:
        value=type.__getattribute__(base,"__dict__").get(name)
        if value is not None:
            _need(type(value) is FunctionType)
            return MethodType(value,owner)
    raise ValueError("The original training files are unavailable.")


def _helpers():
    return (native._copy_model_json,native._capture_original_training_file_lease,
        native._capture_training_copy_configuration,native._capture_training_output_family_configuration,
        native._capture_training_input_copy,native.exact,
        native.OriginalTrainingInputGraph,native.OriginalTrainingInputGraph.__init__,
        native.OriginalTrainingInputGraph.prepare,native.OriginalTrainingInputGraph.assert_sealed,
        native.OriginalInheritedModelLease.borrow,native.OriginalTrainingOutputFamily,
        native.OriginalTrainingOutputFamily.__init__,native.retire_original_training_output_family,
        native._output_family_io_snapshot,native._original_output_family_io,training.train_model_from_local_files,
        TrainModelTaskRequest.__pydantic_validator__.validate_python,
        TrainModelTaskRequest.__pydantic_serializer__.to_python,
        output_delivery._record,output_delivery.bind_original_output_delivery)


_ORIGINAL_HELPERS = (_COPY,_LEASE,_CONFIG,_OUTPUTS,_INPUT_MANIFEST,_EXACT,_INPUT_TYPE,_INPUT_INIT,_INPUT_PREPARE,_INPUT_SEALED,
    _BORROW,_FAMILY_TYPE,_FAMILY_INIT,_RETIRE,_CLOSED,_FAMILY_IO,_LOADER,_VALIDATE,_SERIALIZE,
    _DELIVERY_RECORD,_DELIVERY_BIND)


def _api():
    _need(all(type.__getattribute__(cls,"__dict__").get(name) is original for cls,name,original in _API))


def _record(owner):
    _need(type(owner) is OriginalTrainingFiles)
    _api()
    value=_owners.get(owner);_need(value is not None)
    return value


def _snapshot(owner,record):
    _need(_record(owner) is record and _leases.get(record["lease"]) is owner)
    frame=_bindings.get(owner);_need(type(frame) is tuple and len(frame)==12)
    _need(record["delivery"] is frame[11])
    _need(all(record[name] is original for name,original in zip(
        ("lease","state","source_record","source","resource","admission"),frame[:6])))
    _need(type(record["methods"]) is dict and len(record["methods"])==len(frame[9])
        and all(record["methods"].get(name) is original for name,original in frame[9]))
    _need(type(record["thread"]) is int and record["thread"]==frame[10])
    # Bound builtin methods are recreated on access. Compare their actual
    # receivers/functions, not the identity of each temporary method object.
    current=_helpers()
    _need(len(current)==len(_ORIGINAL_HELPERS))
    for original,value in zip(_ORIGINAL_HELPERS,current):
        if type(original) is type(_VALIDATE):
            _need(type(value) is type(original) and value.__self__ is original.__self__ and value.__name__==original.__name__)
        else:_need(value is original)
    _need(native._model_leases.get(record["lease"]) is record["state"]
        and native._verified_model_receivers.get(record["source"]) is record["source_record"]
        and record["state"]["source"] is record["source"]
        and type(record["phase"]) is str and type(record["cancelled"]) is bool
        and type(record["closed"]) is bool and type(record["output_closed"]) is bool
        and type(record["poisoned"]) is bool)
    _need(_stamp(record["source_record"]["definition"])==frame[6] and _stamp(record["definition"])==frame[6])
    _CONFIG(record["input_configuration"])
    _need(_stamp(record["input_configuration"])==frame[7])
    maximum,outputs=_OUTPUTS(record["output_configuration"])
    _need(type(record["maximum"]) is int and maximum==record["maximum"]
        and type(record["outputs"]) is tuple and _stamp(list(record["outputs"]))==_stamp(list(outputs))
        and _stamp(record["output_configuration"])==frame[8])


def _stamp(value):
    return _json_dumps(_COPY(value),sort_keys=True,allow_nan=False,separators=(",",":"))


def _admitted(owner,record):
    _snapshot(owner,record)
    _need(not record["cancelled"] and not record["closed"] and not record["poisoned"])
    _need(record["methods"]["resource"]() is True);_snapshot(owner,record)
    _need(not record["cancelled"] and not record["closed"] and not record["poisoned"])
    _need(record["methods"]["business"]() is True);_snapshot(owner,record)
    _need(not record["cancelled"] and not record["closed"] and not record["poisoned"])


def _control_record(control,kind):
    _need(type(control) is (_Resource if kind=="resource" else _Admission))
    _api()  # Check original slot descriptors BEFORE any instance field read.
    reference=object.__getattribute__(control,"owner")
    _need(type(reference) is ReferenceType)
    owner=reference();record=_record(owner)
    _need(record[kind] is control)
    return owner,record


def _fail(error):
    if isinstance(error,(training.TrainingCancellationRequested,KeyboardInterrupt,SystemExit)):
        raise error
    raise ValueError("The original training files are unavailable.") from None


class _Resource:
    __slots__=("owner",)
    def __init__(self,owner):self.owner=ref(owner)
    def assert_current(self):
        owner,record=_control_record(self,"resource");_snapshot(owner,record)
        _need(not record["closed"] and not record["cancelled"] and not record["poisoned"])
        result=record["methods"]["resource"]();_snapshot(owner,record)
        return result is True and not record["closed"] and not record["cancelled"] and not record["poisoned"]
    def charge_source_copy(self,amount):
        owner,record=_control_record(self,"resource");_snapshot(owner,record)
        _need(type(amount) is int and amount>0 and not record["closed"] and not record["cancelled"] and not record["poisoned"])
        result=record["methods"]["charge"](amount);_snapshot(owner,record)
        return result is True and not record["closed"] and not record["cancelled"] and not record["poisoned"]
    def retain_source_copy(self,amount):
        # Original accounting remains available after withdrawal. This grants no
        # new copy, deletion, retry, capacity credit or global settlement.
        owner,record=_control_record(self,"resource");_snapshot(owner,record)
        _need(type(amount) is int and amount>0)
        result=record["methods"]["retain"](amount);_snapshot(owner,record)
        return result is True


class _Admission:
    __slots__=("owner",)
    def __init__(self,owner):self.owner=ref(owner)
    def assert_current(self):
        owner,record=_control_record(self,"admission");_snapshot(owner,record)
        _need(not record["closed"] and not record["cancelled"] and not record["poisoned"])
        result=record["methods"]["business"]();_snapshot(owner,record)
        return result is True and not record["closed"] and not record["cancelled"] and not record["poisoned"]


class OriginalTrainingFiles:
    """Actual local custody, with no full resource-readiness/settlement claim."""
    __slots__=("__weakref__",)

    def __init__(self,lease,input_configuration,output_configuration,reservation,admission,*,delivery=None):
        _need(type(self) is OriginalTrainingFiles)
        if delivery is not None:_need(_DELIVERY_RECORD(delivery)["phase"]=="unbound")
        try:
            input_configuration=_CONFIG(input_configuration)
            maximum,outputs=_OUTPUTS(output_configuration)
            state,source_record,source,definition=_LEASE(lease)
        except native.LaunchUnavailable:
            _need(False)
        lock=state["lock"];_need(lock.acquire(blocking=False))
        try:
            # The genuine lease lock also guards concurrent InputGraph/borrow
            # admission. A losing constructor cannot replace another owner.
            try:captured=_LEASE(lease)
            except native.LaunchUnavailable:_need(False)
            _need(all(value is expected for value,expected in zip(captured[:3],(state,source_record,source))))
            _need(lease not in _leases)
            methods={key:_method(actor,name) for key,actor,name in (
                ("resource",reservation,"assert_current"),("charge",reservation,"charge_source_copy"),
                ("retain",reservation,"retain_source_copy"),("business",admission,"assert_current"))}
            record={"lease":lease,"state":state,"source_record":source_record,"source":source,"definition":definition,
                "input_configuration":input_configuration,"output_configuration":{"maximumCopyBytes":maximum,"outputs":list(outputs)},
                "maximum":maximum,"outputs":outputs,"methods":methods,"phase":"bound","cancelled":False,
                "closed":False,"output_closed":False,"poisoned":False,"input":None,"family":None,"payload":None,
                "thread":get_ident(),"lock":RLock(),"delivery":delivery}
            _owners[self]=record;_leases[lease]=self
            record["resource"]=_Resource(self);record["admission"]=_Admission(self)
            _bindings[self]=(lease,state,source_record,source,record["resource"],record["admission"],
                _stamp(definition),_stamp(input_configuration),_stamp(record["output_configuration"]),
                tuple(methods.items()),record["thread"],delivery)
            _snapshot(self,record)
        finally:lock.release()

    def prepare(self,staged):
        record=_record(self)
        with record["lock"]:
            _snapshot(self,record)
            _need(get_ident()==record["thread"])
            if record["phase"] in ("preparing","borrowing","running"):record["poisoned"]=True
            _need(record["phase"]=="bound")
            data=_COPY(staged)
            _EXACT(data,("payload","recipe","outputDirectory"))
            final=record["outputs"][-1]
            destination=final["freshParent"]+"\\"+final["freshName"]
            data["outputDirectory"]=destination;data["payload"]["output"]["outputDirectory"]=destination
            # Pure complete correlation before consuming the original attempt.
            _INPUT_MANIFEST(record["definition"],data,record["input_configuration"],
                record["source_record"]["definition_digest"])
            _LEASE(record["lease"])
            record["phase"]="preparing"
        try:
            _admitted(self,record)
            graph=object.__new__(_INPUT_TYPE);record["input"]=graph
            _INPUT_INIT(graph,record["lease"],data,record["input_configuration"],record["resource"],record["admission"])
            _snapshot(self,record);_admitted(self,record)
            _INPUT_PREPARE(graph);_INPUT_SEALED(graph)
            _snapshot(self,record);_admitted(self,record)
            payload=_VALIDATE(data["payload"])
            record["payload"]=_COPY(_SERIALIZE(payload,mode="json"))
            record["phase"]="prepared"
            return _VALIDATE(_COPY(record["payload"]))
        except BaseException as error:
            record["phase"]="unconfirmed";record["closed"]=True
            _fail(error)

    @contextmanager
    def borrow(self):
        record=_record(self)
        with record["lock"]:
            _snapshot(self,record)
            if record["phase"] in ("preparing","borrowing","running"):record["poisoned"]=True
            _need(record["phase"]=="prepared" and not record["cancelled"] and not record["closed"] and not record["poisoned"])
            record["phase"]="borrowing"
        try:
            _admitted(self,record)
            with _BORROW(record["lease"],_COPY(record["payload"])) as view:
                family=object.__new__(_FAMILY_TYPE);record["family"]=family
                _FAMILY_INIT(family,view,_COPY(record["payload"]),record["output_configuration"],
                    record["resource"],record["admission"])
                if record["delivery"] is not None:
                    _DELIVERY_BIND(record["delivery"],family,view,_COPY(record["payload"]))
                _snapshot(self,record);_admitted(self,record)
                record["phase"]="running"
                try:yield view
                finally:
                    # Only original output IO closes here. Input/Model guards
                    # remain retained. Never invoke post-borrow Input retirement.
                    _need(_RETIRE(family) is True)
                    book,io=_FAMILY_IO(family);rows,expected=io["closed"]
                    _CLOSED(family,book,io,rows,expected)
                    record["output_closed"]=True
            record["phase"]="local-output-closed" if record["output_closed"] else "unconfirmed"
        except BaseException as error:
            record["phase"]="unconfirmed"
            _fail(error)
        finally:record["closed"]=True

    def run(self,*,on_progress=None):
        record=_record(self)
        with self.borrow() as view:
            result=_LOADER(_VALIDATE(_COPY(record["payload"])),_model_view=view,
                compare_validation_baseline=False,on_progress=on_progress)
        _snapshot(self,record);_need(record["output_closed"] is True)
        return result

    def request_cancel(self):
        record=_record(self)
        with record["lock"]:
            _snapshot(self,record);record["cancelled"]=True

    def local_status(self):
        record=_record(self)
        with record["lock"]:
            _snapshot(self,record)
            return {"phase":record["phase"],"outputIoClosed":record["output_closed"],
                "guardCustody":"retained","globalRetirement":"not-qualified"}


_API=tuple((cls,name,type.__getattribute__(cls,"__dict__").get(name))
    for cls in (OriginalTrainingFiles,_Resource,_Admission)
    for name in ("__getattribute__","__getattr__","__hash__","__eq__","owner","__init__","prepare","borrow","run",
        "request_cancel","local_status","assert_current","charge_source_copy","retain_source_copy"))
