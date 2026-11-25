"""Private local exit readiness. Never worker/SDK/Job settlement or credit.

Imported after the session class exists. The same original executor owns the
file binding and proof; HTTP may only latch a request before bounded dispatch.
"""
from concurrent.futures import Future
from threading import get_ident, RLock
from types import FunctionType, MethodType
from weakref import WeakKeyDictionary

from . import approved_local_training_session as sessions
from . import original_training_files as files
from . import original_training_exit_barrier as barrier

PROTOCOL = "original-exit-ready-v1"
CAPABILITY = "train-model.original-exit-ready-v1"
_SESSION = sessions.OriginalTrainingSession
_RESOURCE = sessions.NativeTrainingResources
_MRO = type.__getattribute__(_SESSION, "__mro__")
_API = tuple((base, name, type.__getattribute__(base, "__dict__").get(name))
    for base in _MRO for name in ("__getattribute__", "__getattr__", "__hash__", "__eq__",
        "prepare", "seal", "start", "run", "cancel", "settle", "begin_exit_ready", "finish_exit_ready", "mark_exit_ready_lost"))
_RECORD = files._record
_PREPARED = files._prepared_files
_STAMP = files._stamp
_FILE_API = files._api
_BARRIER_API = barrier._api
_PREPARE_EXIT = barrier.prepare_original_training_file_exit
_PREPARE_UNSTARTED_EXIT = barrier.prepare_unstarted_original_training_file_exit
_CONSUME_EXIT = barrier.consume_original_training_file_exit
_SCOPE = sessions._scope_digest
_THREAD = get_ident
_FUTURE = Future
_RLOCK = type(RLock())
_books = WeakKeyDictionary()


def _need(value):
    if value is not True:
        raise sessions.TrainingSessionError()


def _api(owner):
    _need(type(owner) is _SESSION and sessions.OriginalTrainingSession is _SESSION)
    current = type.__getattribute__(_SESSION, "__mro__")
    _need(len(current) == len(_MRO) and all(a is b for a, b in zip(current, _MRO)))
    _need(all(type.__getattribute__(base, "__dict__").get(name) is original for base, name, original in _API))


def _file_api():
    _need(files._record is _RECORD and files._prepared_files is _PREPARED and files._stamp is _STAMP
          and files._api is _FILE_API and barrier._api is _BARRIER_API
          and barrier.prepare_original_training_file_exit is _PREPARE_EXIT
          and barrier.prepare_unstarted_original_training_file_exit is _PREPARE_UNSTARTED_EXIT
          and barrier.consume_original_training_file_exit is _CONSUME_EXIT
          and sessions._scope_digest is _SCOPE)
    _FILE_API(); _BARRIER_API()


def _book(owner):
    _api(owner)  # Before any weak-key/virtual lookup.
    return _books.get(owner)


def _fields(owner, book):
    _api(owner)
    value = object.__getattribute__(owner, "__dict__")
    _need(type(value) is dict and _SCOPE(value.get("_sealed_definition")) == book["scope"]
          and type(value.get("task_id")) is str and type(value.get("workspace_id")) is str
          and value["task_id"] == book["task"] and value["workspace_id"] == book["workspace"])
    if book["resource"] is not None:
        _need(value.get("native") is book["resource"])
    if book["lock"] is not None:
        _need(value.get("lock") is book["lock"])
    return value


def initialize(owner, protocol):
    _api(owner)
    _need(type(protocol) is str and protocol in ("settled-v1", PROTOCOL))
    if protocol == "settled-v1":
        return
    value = object.__getattribute__(owner, "__dict__")
    definition = value["_sealed_definition"]
    _need(owner not in _books)
    _books[owner] = {"scope": _SCOPE(definition), "task": definition["requestId"],
        "workspace": definition["workspaceId"], "resource": None, "method": None,
        "resource_api": None, "resource_class": None, "resource_mro": None,
        "thread": None, "lock": None, "file": None, "file_record": None,
        "file_attempted": False, "payload": None, "source_digest": None, "future": None,
        "entered": False, "returned": False, "dispatch_attempted": False,
        "cancel_started": False, "cancel_returned": False, "cancel_acknowledged": False,
        "exit_mode": None, "attempted": False, "unknown": False,
        "phase": "bound"}


def enabled(owner):
    return _book(owner) is not None


def capture_controls(owner):
    book = _book(owner)
    if book is not None:
        value = _fields(owner, book)
        _need(book["lock"] is None and type(value.get("lock")) is _RLOCK)
        book["lock"] = value["lock"]


def assert_work(owner):
    book = _book(owner)
    if book is not None:
        _fields(owner, book)
        _need(not book["attempted"] and not book["unknown"])
        if book["resource"] is not None: _resource_current(owner, book)


def assert_cancel(owner):
    book = _book(owner)
    if book is not None:
        _fields(owner, book)
        _need(not book["attempted"])  # Existing cleanup may still stop uncertain work.


def assert_wire(owner, action):
    book = _book(owner)
    if book is not None:
        _fields(owner, book)
        _need(not book["attempted"] or action == "exit-ready")


def capture_resource(owner, resource):
    book = _book(owner)
    if book is None:
        return
    _fields(owner, book)
    _need(book["resource"] is None and not book["unknown"] and not book["attempted"])
    bases = type.__getattribute__(type(resource), "__mro__")
    _need(sessions.NativeTrainingResources is _RESOURCE and len(bases) <= 8 and any(base is _RESOURCE for base in bases))
    names = ("prepare", "seal_inputs", "borrow", "request_cancel", "settle", "original_files")
    methods = {}
    for name in names:
        selected = next((type.__getattribute__(base, "__dict__")[name]
            for base in bases if name in type.__getattribute__(base, "__dict__")), None)
        _need(type(selected) is FunctionType and not selected.__code__.co_flags & (0x20 | 0x80 | 0x200))
        methods[name] = selected
    book.update(resource=resource, method=methods["original_files"], thread=_THREAD(),
        resource_class=type(resource), resource_mro=bases,
        resource_api=tuple((base, name, type.__getattribute__(base, "__dict__").get(name))
            for base in bases for name in ("__getattribute__", "__getattr__", "__hash__", "__eq__", *names)))
    return {name: MethodType(method, resource) for name, method in methods.items()}


def assert_thread(owner):
    book = _book(owner)
    if book is not None:
        _fields(owner, book)
        _need(type(book["thread"]) is int and book["thread"] == _THREAD())


def _resource_current(owner, book):
    _fields(owner, book)
    _need(sessions.NativeTrainingResources is _RESOURCE and type(book["resource"]) is book["resource_class"])
    current = type.__getattribute__(book["resource_class"], "__mro__")
    _need(len(current) == len(book["resource_mro"]) and all(a is b for a, b in zip(current, book["resource_mro"])))
    _need(book["resource_api"] is not None and all(
        type.__getattribute__(base, "__dict__").get(name) is original
        for base, name, original in book["resource_api"]))


def capture_files(owner):
    book = _book(owner)
    if book is None:
        return
    assert_thread(owner); _resource_current(owner, book); _file_api()
    _need(not book["file_attempted"] and not book["attempted"] and not book["unknown"])
    book["file_attempted"] = True  # Before the trusted resource callback.
    try:
        selected = book["method"](book["resource"])
        _resource_current(owner, book)
        record = _RECORD(selected)
        _need(type(record.get("thread")) is int and type(record.get("phase")) is str
              and record["thread"] == book["thread"] and record["phase"] in ("bound", "prepared")
              and _SCOPE(record["definition"]) == book["scope"])
        # Native transfer hashes its actual bytes, separately from the sorted
        # semantic session digest. Preserve both representations and bindings.
        digest = record["source_record"]["definition_digest"]
        _need(type(digest) is str and len(digest) == 71 and digest.startswith("sha256:")
              and all(c in "0123456789abcdef" for c in digest[7:]))
        book.update(file=selected, file_record=record, source_digest=digest)
    except BaseException:
        book["unknown"] = True
        raise


def sealed(owner, payload):
    book = _book(owner)
    if book is None:
        return
    assert_thread(owner); _resource_current(owner, book); _file_api()
    _need(not book["attempted"] and not book["unknown"] and book["payload"] is None)
    _need(_RECORD(book["file"]) is book["file_record"])
    prepared = _PREPARED.get(book["file"])
    _need(type(prepared) is tuple and prepared[0] is book["file_record"]
          and prepared[7] == _STAMP(payload) and _SCOPE(book["file_record"]["definition"]) == book["scope"])
    book["payload"] = prepared[7]


def capture_future(owner, future):
    book = _book(owner)
    if book is not None:
        _fields(owner, book)
        _need(type(future) is _FUTURE and book["future"] is None)
        book["future"] = future


def dispatch_attempted(owner):
    """Latch before submit: a lost reply can never become known no-dispatch."""
    book = _book(owner)
    if book is not None:
        _fields(owner,book)
        _need(not book["dispatch_attempted"] and not book["attempted"] and not book["unknown"])
        book["dispatch_attempted"] = True


def cancel_started(owner):
    book=_book(owner)
    if book is not None:
        _fields(owner,book)
        _need(not book["attempted"] and not book["cancel_started"])
        book["cancel_started"]=True


def cancel_returned(owner,result):
    book=_book(owner)
    if book is not None:
        _fields(owner,book)
        _need(type(result) is bool and book["cancel_started"] and not book["cancel_returned"])
        book["cancel_returned"]=True
        book["cancel_acknowledged"]=result


def _unstarted(book,value):
    if (book["entered"] or book["returned"] or book["payload"] is None
            or not book["cancel_returned"] or not book["cancel_acknowledged"]
            or value.get("cancelled") is not True or value.get("cancel_result") is not True
            or value.get("known_not_run") is not True or value.get("run_entered") is not False
            or value.get("run_returned") is not False):
        return False
    future=book["future"]
    if not book["dispatch_attempted"]:
        return future is None and value.get("future") is None and value.get("issue_attempted") is False
    if type(future) is not _FUTURE or value.get("future") is not future or value.get("issue_attempted") is not True:
        return False  # Raised/unknown submit has no positive no-start proof.
    fields=object.__getattribute__(future,"__dict__")
    return type(fields.get("_state")) is str and fields["_state"] in ("CANCELLED","CANCELLED_AND_NOTIFIED")


def run_entered(owner):
    book = _book(owner)
    if book is not None:
        assert_thread(owner); assert_work(owner)
        _need(book["payload"] is not None and not book["entered"])
        book["entered"] = True


def run_returned(owner):
    book = _book(owner)
    if book is not None:
        assert_thread(owner)
        _need(book["entered"] and not book["returned"])
        book["returned"] = True


def begin(owner):
    """Pure admission latch on HTTP; no Native/file effect or business grant."""
    book = _book(owner); _need(book is not None)
    value = _fields(owner, book)
    with book["lock"]:
        if book["unknown"] or book["attempted"]:
            return "unconfirmed"
        future = book["future"]
        if value.get("operations") != 0:
            return "pending"
        if _unstarted(book,value):
            book["exit_mode"]="unstarted"
        else:
            # Returned training still needs its original completed run and file
            # proof. Public flags cannot substitute for private entry history.
            if not book["returned"] or value.get("run_returned") is not True:
                return "pending"
            _need(type(future) is _FUTURE and value.get("future") is future)
            future_fields = object.__getattribute__(future, "__dict__")
            if type(future_fields.get("_state")) is not str or future_fields["_state"] != "FINISHED":
                return "pending"
            book["exit_mode"]="returned"
        book["attempted"] = True; book["phase"] = "queued"
        return "queued"


def lost(owner):
    book = _book(owner); _need(book is not None)
    book["unknown"] = True; book["phase"] = "unconfirmed"


def finish(owner):
    """Consume genuine local proof once, on the same original task executor."""
    book = _book(owner); _need(book is not None)
    try:
        assert_thread(owner); _resource_current(owner, book); _file_api()
        value = _fields(owner, book)
        _need(book["attempted"] and book["phase"] == "queued" and not book["unknown"]
              and value["operations"] == 0)
        unstarted=book["exit_mode"]=="unstarted"
        _need(_unstarted(book,value) if unstarted else book["exit_mode"]=="returned" and book["returned"])
        book["phase"] = "checking"  # Before the fixed proof resolver.
        _need(_RECORD(book["file"]) is book["file_record"] and _PREPARED[book["file"]][7] == book["payload"])
        token = (_PREPARE_UNSTARTED_EXIT if unstarted else _PREPARE_EXIT)(book["file"])
        _need(token is not None and not book["unknown"])
        proof = _CONSUME_EXIT(book["file"], token)
        _resource_current(owner, book)
        _need(not book["unknown"] and proof["taskId"] == book["task"]
              and proof["definitionDigest"] == book["source_digest"] and proof["localAdmission"] == "permanently-fenced"
              and proof["workerRetirement"] == "not-qualified" and proof["outputCustody"] == "not-qualified")
        book["phase"] = "ready"
        return "ready"
    except Exception:
        book["unknown"] = True; book["phase"] = "unconfirmed"
        return "unconfirmed"
