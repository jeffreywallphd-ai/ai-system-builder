"""Original-model records and an unused private read-only source owner.

The inventory binding is inert. The separate explicit owner requires an original
finite producer, which production does not yet provide. Neither component grants
a borrower, staging, worker or readiness authority. Actual Windows qualification,
discovery isolation and producer composition remain pending.
"""
import hashlib
import json
import ctypes as C
from abc import ABC, abstractmethod
from dataclasses import dataclass
import os
from pathlib import Path
import re
import struct
from threading import RLock, get_ident

from . import windows_offload_core as w
from . import windows_offload_execution as execution

from . import local_model_offload as model

_FIELDS = frozenset(('root', '_config_bytes', 'tensors', 'bindings',
                     'source_digest', 'directory_names'))
_TENSOR_FIELDS = frozenset(('name', 'shard', 'dtype', 'shape', 'elements'))
_TOKENIZERS = frozenset(('tokenizer.json', 'tokenizer_config.json', 'vocab.json',
                         'merges.txt', 'special_tokens_map.json', 'added_tokens.json',
                         'generation_config.json', 'chat_template.jinja'))
_NAME = re.compile(r'[A-Za-z0-9][A-Za-z0-9._-]{0,254}')
_HASH = re.compile(r'[a-f0-9]{64}')


def _need(value):
    if not value:
        raise model.OffloadAdmissionError()


def _name(value):
    _need(type(value) is str and 1 <= len(value) <= 255
          and _NAME.fullmatch(value) is not None
          and not value.endswith(('.', ' ')))
    return value


def _fields(inventory):
    _need(type(inventory) is model.LocalModelInventory)
    fields = vars(inventory)
    _need(type(fields) is dict and len(fields) == len(_FIELDS)
          and all(type(key) is str for key in fields)
          and fields.keys() == _FIELDS)
    return tuple(fields[name] for name in ('root', '_config_bytes', 'tensors',
                 'bindings', 'source_digest', 'directory_names'))


def _facts(inventory):
    root, config, tensors, bindings, digest, names = _fields(inventory)
    _need(type(root) is type(Path()) and root.is_absolute()
          and '..' not in root.parts and len(root.parts) <= 128)
    root_text = str(root)
    _need(1 <= len(root_text.encode('utf8')) <= 2048
          and type(root)(root_text).parts == root.parts
          and not any(ord(char) < 32 or ord(char) == 127 for char in root_text)
          and all(not part.endswith(('.', ' ')) for part in root.parts[1:]))
    _need(type(config) is bytes and 0 < len(config) <= model.MAX_CONFIG_BYTES)
    model._validate_config(model._json(config))  # Pure; never invoke inspection.
    _need(type(names) is tuple and 1 <= len(names) <= model.MAX_TENSORS)
    for name in names:
        _name(name)
        _need(not name.casefold().startswith(('adapter_config', 'adapter_model'))
              and not name.lower().endswith(('.bin', '.pt', '.pth', '.pkl', '.pickle')))
    _need(tuple(sorted(names)) == names and len({n.casefold() for n in names}) == len(names))
    name_set = set(names)
    _need(type(bindings) is tuple and 4 <= len(bindings) <= model.MAX_SHARDS + 10)
    rows, total, seen = [], 0, set()
    for row in bindings:
        _need(type(row) is tuple and len(row) == 3)
        name, size, file_digest = row
        _name(name)
        _need(name not in seen and name in name_set
              and type(size) is int and 0 < size <= model.MAX_MODEL_BYTES
              and type(file_digest) is str and _HASH.fullmatch(file_digest) is not None)
        seen.add(name)
        total += size
        _need(total <= model.MAX_MODEL_BYTES)  # Source ceiling, NOT staging credit.
        rows.append((name, size, file_digest))
    weights = sorted(name for name in names if name.endswith('.safetensors'))
    _need(1 <= len(weights) <= model.MAX_SHARDS
          and all(model._SHARD.fullmatch(name) is not None for name in weights))
    weight_set = set(weights)
    indexed = 'model.safetensors.index.json' in names
    _need(indexed or weights == ['model.safetensors'])
    expected = ['config.json'] + (['model.safetensors.index.json'] if indexed else [])
    expected += weights + sorted(_TOKENIZERS.intersection(names))
    _need({'tokenizer.json', 'tokenizer_config.json'}.issubset(names)
          and [row[0] for row in rows] == expected)
    files = {row[0]: row for row in rows}
    _need(files['config.json'][1:] == (len(config), hashlib.sha256(config).hexdigest()))
    for name, size, _ in rows:
        if name in weight_set:
            _need(size > 8)
        elif name == 'model.safetensors.index.json':
            _need(size <= model.MAX_HEADER_BYTES)
        elif name in _TOKENIZERS:
            _need(size <= (32 if name == 'tokenizer.json' else 8) * 1024**2)
    _need(type(digest) is str and _HASH.fullmatch(digest) is not None
          and digest == hashlib.sha256(json.dumps(bindings, separators=(',', ':')).encode()).hexdigest())
    _need(type(tensors) is tuple and 1 <= len(tensors) <= model.MAX_TENSORS)
    tensor_rows, tensor_names, shards = [], set(), set()
    payloads = {name: 0 for name in weights}
    for tensor in tensors:
        _need(type(tensor) is model.TensorInventoryEntry)
        fields = vars(tensor)
        _need(type(fields) is dict and len(fields) == len(_TENSOR_FIELDS)
              and all(type(key) is str for key in fields)
              and fields.keys() == _TENSOR_FIELDS)
        name, shard, dtype, shape, elements = (fields[key] for key in
                    ('name', 'shard', 'dtype', 'shape', 'elements'))
        _need(type(name) is str and 1 <= len(name) <= 512
              and model._NAME.fullmatch(name) is not None and name not in tensor_names
              and type(shard) is str and shard in weight_set
              and type(dtype) is str and dtype in model._DTYPE_BYTES
              and type(shape) is tuple and len(shape) <= 8)
        count = 1
        for dimension in shape:
            _need(type(dimension) is int and 0 <= dimension <= 2**24)
            count *= dimension
            _need(count <= model.MAX_MODEL_BYTES // model._DTYPE_BYTES[dtype])
        _need(type(elements) is int and elements == count)
        payloads[shard] += count * model._DTYPE_BYTES[dtype]
        _need(payloads[shard] <= files[shard][1] - 9)
        tensor_names.add(name)
        shards.add(shard)
        tensor_rows.append((name, shard, dtype, tuple(shape), elements))
    _need(shards == weight_set)
    for shard, payload in payloads.items():
        # Inspection covers the complete contiguous tensor payload. The rest
        # must fit its eight-byte prefix and the existing bounded JSON header.
        _need(1 <= files[shard][1] - 8 - payload <= model.MAX_HEADER_BYTES)
    # All facts are immutable primitives. Tensor objects and mutable Path caches
    # cannot rewrite this independent value snapshot after capture.
    return ((root_text, tuple(root.parts), root.drive, root.root), config,
            tuple(tensor_rows), tuple(rows), digest, tuple(names))


class _OriginalInventoryBinding:
    __slots__ = ('__origin', '__inventory', '__fields', '__facts',
                 '__field_origin', '__fact_origin')

    def __init__(self, inventory, facts):
        self.__origin = self
        self.__inventory = inventory
        self.__fields = _fields(inventory)
        self.__facts = facts
        self.__field_origin = self.__fields
        self.__fact_origin = self.__facts

    def __repr__(self):
        return '<inert original model inventory binding>'

    def __copy__(self):
        raise model.OffloadAdmissionError()

    def __deepcopy__(self, memo):
        raise model.OffloadAdmissionError()

    def __reduce_ex__(self, protocol):
        raise model.OffloadAdmissionError()

    def assert_original(self, inventory):
        try:
            _need(type(self) is _OriginalInventoryBinding and self.__origin is self
                  and inventory is self.__inventory
                  and type(self.__fields) is tuple and len(self.__fields) == 6
                  and type(self.__facts) is tuple and len(self.__facts) == 6
                  and self.__fields is self.__field_origin
                  and self.__facts is self.__fact_origin)
            current = _fields(inventory)
            _need(all(now is before for now, before in zip(current, self.__fields))
                  and _facts(inventory) == self.__facts)
        except Exception:
            raise model.OffloadAdmissionError() from None


def capture_original_model_inventory(inventory):
    """Validate and bind data only; a manually made valid inventory can pass.

    Never call this proof of inspector issuance, file bytes or a Native lease.
    A copied/serialized snapshot cannot authorize any subsequent file operation.
    """
    try:
        binding = _OriginalInventoryBinding(inventory, _facts(inventory))
        binding.assert_original(inventory)
        return binding
    except Exception:
        raise model.OffloadAdmissionError() from None


# These are source-library prerequisites only. No production producer is selected.
_READ_BYTES = 8 * 1024**2
_SOURCE_CUSTODY, _SOURCE_RETIREMENTS = {}, {}
_SOURCE_LOCK = RLock()


@dataclass(frozen=True, repr=False)
class _SourceGraphPlan:
    ancestors: int
    files: int
    reads: int
    source_bytes: int
    handle_slots: int
    prepare_calls: int
    live_check_calls: int
    unused_close_calls: int
    buffer_bytes: int


def _source_graph_plan(inventory, binding):
    _need(type(binding) is _OriginalInventoryBinding)
    binding.assert_original(inventory)
    path = inventory.root
    _need(re.fullmatch(r'[A-Za-z]:\\', path.anchor) is not None)
    for name in path.parts[1:]:w._name(name)
    ancestors, files = len(path.parts), len(inventory.bindings)
    reads = sum((size + _READ_BYTES - 1) // _READ_BYTES for _, size, _ in inventory.bindings)
    # Each file rounds independently. Source guards do not share their events
    # with the single manual-reset read event. DLL bootstrap is also budgeted.
    live = ancestors + 5 * files
    prepare = 3 * ancestors + 2 + 9 * files + 1 + 5 * reads + 2 * live + 2
    close = files + ancestors + 4 * files + 1
    handles = ancestors + 2 * files + 1
    memory = (2 * _READ_BYTES + len(inventory._config_bytes)
              + len(inventory.tensors) * 2048
              + (execution._MAX_CALLS + execution._TERMINAL_CALLS) * 8192)
    _need(execution._MAX_CALLS == 16384 and execution._TERMINAL_CALLS == 64
          and execution._MEMORY_BYTES == 512 * 1024**2
          and execution._BUDGET_NS == 120 * 10**9)
    _need(prepare + live <= execution._MAX_CALLS and close <= execution._TERMINAL_CALLS
          and memory <= execution._MEMORY_BYTES)
    return _SourceGraphPlan(ancestors, files, reads,
        sum(row[1] for row in inventory.bindings), handles, prepare, live, close, memory)


class _SourceExecutionPort(ABC):
    """Trusted original shared producer; NONE is provided by production.

    reserve_initial must reserve the source graph PLUS its own original
    pending-read/callback/process retirement before API construction. The source
    close count is only an unused, completed-read lower bound. Neither the plan,
    an opaque ticket nor local counters prove a real reservation. Missing or
    uncertain capacity denies; no independent/reset normal or terminal pool.

    Native methods invoke the supplied original closure exactly once on the
    current operation's thread under the original finite watchdog. Timeouts and
    requested stops retain actual custody until original completion/exit proof.
    This private contract adds no IPC operation or shared-worker termination.
    """
    @abstractmethod
    def assert_bound(self, owner):raise NotImplementedError
    @abstractmethod
    def reserve_initial(self, owner, plan):raise NotImplementedError
    @abstractmethod
    def assert_reserved(self, owner, reservation, plan):raise NotImplementedError
    @abstractmethod
    def reserve_check(self, owner, reservation, calls):raise NotImplementedError
    @abstractmethod
    def execute(self, owner, kind, invoke):raise NotImplementedError
    @abstractmethod
    def invoke_native(self, owner, reservation, record, invoke):raise NotImplementedError


class _SourceReservation:
    """Private original-producer reply, never independently sufficient authority."""
    __slots__ = ('origin', 'issuer', 'owner', 'plan', 'native', '_original')
    def __init__(self, issuer, owner, plan, native):
        _need(isinstance(issuer, _SourceExecutionPort) and type(plan) is _SourceGraphPlan
              and native is not None
              and type(native) not in (str, bytes, int, float, bool, dict, list, tuple, set, frozenset))
        self.origin = self
        self.issuer, self.owner, self.plan, self.native = issuer, owner, plan, native
        self._original = (issuer, owner, plan, native)
    def assert_original(self, issuer, owner, plan):
        _need(type(self) is _SourceReservation and self.origin is self
              and type(self._original) is tuple and len(self._original) == 4
              and all(a is b for a,b in zip((self.issuer,self.owner,self.plan,self.native),self._original))
              and self.issuer is issuer and self.owner is owner and self.plan is plan)
    def __reduce_ex__(self, protocol):raise model.OffloadAdmissionError()
    def __copy__(self):raise model.OffloadAdmissionError()
    def __deepcopy__(self, memo):raise model.OffloadAdmissionError()
    def __repr__(self):return '<uncomposed original source reservation reply>'


class _SourceHandle:
    def __init__(self, owner):
        self.owner, self.origin = owner, self
        self.slot = C.c_void_p()
        self.original_slot = self.slot
        self.generation = self.original_generation = object()
        self.installed = self.acquire_call = self.close_call = None
        self.close_started = self.closed = False
    def assert_original(self, owner):
        _need(type(self) is _SourceHandle and self.origin is self and self.owner is owner
              and self.slot is self.original_slot and type(self.slot) is C.c_void_p
              and self.generation is self.original_generation
              and type(self.close_started) is bool and type(self.closed) is bool)
        if self.installed is None:
            _need(self is owner._acquiring and not self.closed and not self.close_started)
        else:
            _need(type(self.installed) is int and 0 < self.installed < C.c_void_p(-1).value
                  and self.original_slot.value == self.installed)
        if self.closed:
            call = self.close_call
            _need(self.close_started and type(call) is _SourceNativeCall
                  and call.owner is owner and call.acknowledged and call.returned
                  and type(call.value) is int and call.value != 0
                  and call.args == (self.installed,))
        elif self.close_started:
            _need(self is owner._closing and self.close_call is None)


class _SourceGuard:
    def __init__(self, handle, event):
        self.origin = self
        self.handle, self.event = handle, event
        self.overlapped = w._Overlapped()
        self.overlapped.event = event.installed
        self.incoming = w._OplockIn(1, C.sizeof(w._OplockIn), 1, 1)
        self.outgoing = w._OplockOut()
        self.retirement_started = self.retired = False
        self.original = (handle, event, self.overlapped, self.incoming, self.outgoing)
    def assert_original(self):
        _need(type(self) is _SourceGuard and self.origin is self
              and type(self.original) is tuple and len(self.original) == 5
              and all(a is b for a,b in zip((self.handle,self.event,self.overlapped,self.incoming,self.outgoing),self.original))
              and self.overlapped.event == self.event.installed
              and (self.incoming.version,self.incoming.length,self.incoming.level,self.incoming.flags)
                  == (1,C.sizeof(w._OplockIn),1,1))


class _SourceRead:
    def __init__(self, handle, event, buffer, offset, size):
        self.handle, self.event, self.buffer = handle, event, buffer
        self.offset = C.c_int64(offset)
        self._offset_value = offset
        self.io = w._Io()
        self.io.status = 0x103
        self.io.information = 0
        self.size = size
        self.issued = self.completed = False
        self.original = (handle,event,buffer,self.offset,self.io,size)

    def assert_original(self):
        _need(type(self) is _SourceRead and type(self.original) is tuple
              and len(self.original) == 6
              and all(a is b for a,b in zip((self.handle,self.event,self.buffer,
                  self.offset,self.io,self.size), self.original))
              and self.offset.value == self._offset_value)


class _SourceNativeCall:
    def __init__(self, owner, function, args, valid, keep, terminal, expected_error, false_errors, output):
        self.origin, self.owner = self, owner
        self.function,self.args,self.valid,self.keep = function,args,valid,keep
        self.terminal,self.expected_error,self.false_errors = terminal,expected_error,false_errors
        self.output,self.output_value = output,None
        self.binding = (function,args,valid,keep,terminal,expected_error,false_errors,output)
        self.started = self.returned = self.acknowledged = False
        self.thread = self.value = self.error = None
    def assert_original(self, owner):
        _need(type(self) is _SourceNativeCall and self.origin is self and self.owner is owner
              and type(self.binding) is tuple and len(self.binding) == 8
              and all(a is b for a,b in zip((self.function,self.args,self.valid,self.keep,
                    self.terminal,self.expected_error,self.false_errors,self.output),self.binding)))


class _WindowsSourceApi:
    """Fixed read-only ABI. No inheritance from the staging mutation API.

    Only the original operation's finite dispatcher can construct this object.
    A read IRP is NOT an OVERLAPPED guard IRP. Unknown reads are retained; this
    unused-owner component deliberately provides no read-cancellation shortcut.
    """
    def __init__(self, owner):
        _need(os.name == 'nt' and struct.calcsize('P') == 8 and owner._api is self)
        self.owner = owner
        self.k = owner._native_call(C.WinDLL, ('kernel32.dll',),
            lambda value: value is not None, (), kwargs={'use_last_error': True, 'winmode': 0x800})
        self.n = owner._native_call(C.WinDLL, ('ntdll.dll',),
            lambda value: value is not None, (), kwargs={'use_last_error': True, 'winmode': 0x800})
        p,u,i = C.c_void_p,C.c_uint32,C.c_int32
        signatures = (
            (self.n,'NtCreateFile',(C.POINTER(p),u,C.POINTER(w._Attributes),C.POINTER(w._Io),p,u,u,u,u,p,u),i),
            (self.n,'NtCreateEvent',(C.POINTER(p),u,p,i,C.c_ubyte),i),
            (self.n,'NtReadFile',(p,p,p,p,C.POINTER(w._Io),p,u,C.POINTER(C.c_int64),p),i),
            (self.k,'CloseHandle',(p,),i),
            (self.k,'ResetEvent',(p,),i),
            (self.k,'GetFileInformationByHandleEx',(p,i,p,u),i),
            (self.k,'GetVolumeInformationByHandleW',(p,C.c_wchar_p,u,p,p,C.POINTER(u),C.c_wchar_p,u),i),
            (self.k,'GetDriveTypeW',(C.c_wchar_p,),u),
            (self.k,'DeviceIoControl',(p,u,p,u,p,u,p,C.POINTER(w._Overlapped)),i),
            (self.k,'WaitForSingleObject',(p,u),u),
            (self.k,'CancelIoEx',(p,C.POINTER(w._Overlapped)),i),
            (self.k,'GetOverlappedResult',(p,C.POINTER(w._Overlapped),C.POINTER(u),i),i))
        self._functions = []
        for library,name,args,result in signatures:
            function = getattr(library,name)
            function.argtypes,function.restype = list(args),result
            self._functions.append((library,name,function,args,result))
        self._functions = tuple(self._functions)
        self._origin = (owner,self.k,self.n,self._functions)

    def _assert_original(self):
        _need(type(self) is _WindowsSourceApi and self.owner._api is self
              and type(self._origin) is tuple and len(self._origin) == 4
              and all(a is b for a,b in zip((self.owner,self.k,self.n,self._functions),self._origin)))
        for library,name,function,args,result in self._functions:
            _need(getattr(library,name) is function and tuple(function.argtypes) == args
                  and function.restype is result)

    def _call(self, function, *args, keep=(), valid=lambda value:type(value) is int and value != 0,
              expected_error=None, false_errors=(), output=None):
        self._assert_original()
        _need(any(row[2] is function for row in self._functions))
        return self.owner._native_call(function,args,valid,keep,
            expected_error=expected_error,false_errors=false_errors,output=output)

    def _handle(self):
        owner = self.owner
        _need(owner._acquiring is None and len(owner._handles) < owner._plan.handle_slots)
        custody = owner._retain()
        handle = _SourceHandle(owner)
        custody.handle_origins.append((handle,handle.original_slot,handle.original_generation))
        owner._handles.append(handle)  # Original output slot before acquisition.
        owner._acquiring = handle
        return handle

    def _installed(self, handle):
        owner = self.owner
        handle.assert_original(owner)
        number = handle.original_slot.value
        call = owner._calls[-1]
        _need(type(number) is int and 0 < number < C.c_void_p(-1).value
              and call.output is handle.original_slot and call.output_value == number
              and not any(other is not handle and other.installed == number for other in owner._handles))
        handle.installed,handle.acquire_call = number,owner._calls[-1]
        owner._acquiring = None
        handle.assert_original(owner)
        return handle

    def _number(self, handle):
        _need(any(row is handle for row in self.owner._handles))
        handle.assert_original(self.owner)
        _need(not handle.closed and not handle.close_started)
        return handle.installed

    def open(self, parent, name, directory, *, ancestor=False):
        if parent is None:
            _need(type(name) is str and re.fullmatch(r'\\\?\?\\[A-Za-z]:\\',name) is not None and directory is True)
        else:
            w._name(name)
        _need(type(directory) is bool)
        _need(type(ancestor) is bool and (not ancestor or directory))
        root = None if parent is None else self._number(parent)
        text = C.create_unicode_buffer(name)
        string = w._Unicode(len(name.encode('utf-16-le')),C.sizeof(text),C.cast(text,C.c_void_p))
        attrs = w._Attributes(C.sizeof(w._Attributes),root,C.pointer(string),0x40,None,None)
        io = w._Io()
        handle = self._handle()
        self._call(self.n.NtCreateFile,C.byref(handle.original_slot),0x100081,
            C.byref(attrs),C.byref(io),None,0x80,3 if ancestor else 1,1,0x200000|(1 if directory else 0x40),None,0,
            valid=lambda status:type(status) is int and status == 0,
            keep=(handle,text,string,attrs,io,parent),output=handle.original_slot)
        _need(io.status in (None,0) and io.information == 1)
        self._installed(handle)
        self.kind(handle,directory)
        return handle

    def event(self):
        handle = self._handle()
        self._call(self.n.NtCreateEvent,C.byref(handle.original_slot),0x100002,None,0,0,
            valid=lambda status:type(status) is int and status == 0,keep=(handle,),output=handle.original_slot)
        return self._installed(handle)

    def kind(self, handle, directory):
        value = (C.c_uint32*2)()
        self._call(self.k.GetFileInformationByHandleEx,self._number(handle),9,C.byref(value),C.sizeof(value),keep=(handle,value))
        _need(bool(value[0]&0x10) is directory and not value[0]&(0x400|0x200|0x800|0x4000|0x1000)
              and value[1] == 0)

    def identity(self, handle):
        value = (C.c_ubyte*24)()
        self._call(self.k.GetFileInformationByHandleEx,self._number(handle),18,C.byref(value),C.sizeof(value),keep=(handle,value))
        result = bytes(value)
        _need(any(result[:8]) and any(result[8:]))
        return result

    def chain(self, path):
        self._call(self.k.GetDriveTypeW,path.anchor,valid=lambda kind:type(kind) is int and kind == 3)
        chain = [self.open(None,'\\??\\'+path.anchor,True,ancestor=len(path.parts)>1)]
        filesystem,flags = C.create_unicode_buffer(32),C.c_uint32()
        self._call(self.k.GetVolumeInformationByHandleW,self._number(chain[0]),None,0,None,None,
            C.byref(flags),filesystem,32,keep=(chain[0],filesystem,flags))
        _need(filesystem.value == 'NTFS' and flags.value&8)
        # Only nonterminal ancestors may coexist with unrelated writers.
        # The selected directory and every file retain read-only sharing.
        for index,part in enumerate(path.parts[1:],1):
            chain.append(self.open(chain[-1],part,True,ancestor=index<len(path.parts)-1))
        return tuple((handle,self.identity(handle)) for handle in chain)

    def facts(self, handle):
        self.kind(handle,False)
        facts = w._Standard()
        self._call(self.k.GetFileInformationByHandleEx,self._number(handle),1,C.byref(facts),C.sizeof(facts),keep=(handle,facts))
        _need(0 < facts.size <= model.MAX_MODEL_BYTES and 0 <= facts.allocated <= model.MAX_MODEL_BYTES
              and facts.links == 1 and not facts.directory and not facts.delete_pending)
        data = (C.c_uint64*512)()
        self._call(self.k.GetFileInformationByHandleEx,self._number(handle),7,C.byref(data),C.sizeof(data),keep=(handle,data))
        raw = bytes(data)
        following,length,size,allocated = struct.unpack_from('<IIqq',raw)
        _need(following == 0 and length == 14 and raw[24:38] == '::$DATA'.encode('utf-16-le')
              and size == facts.size and allocated == facts.allocated)
        return self.identity(handle),facts.size,facts.allocated

    def guard(self, handle):
        event = self.event()
        row = _SourceGuard(handle,event)
        self.owner._retain().guard_origins.append(row)
        self.owner._guards.append(row)  # Original request and buffers before IRP.
        self._call(self.k.DeviceIoControl,self._number(handle),0x90240,C.byref(row.incoming),C.sizeof(row.incoming),
            C.byref(row.outgoing),C.sizeof(row.outgoing),None,C.byref(row.overlapped),
            valid=lambda ok:type(ok) is int and ok == 0,expected_error=997,keep=(row,))
        self.check_guard(row)
        return row

    def check_guard(self, row):
        row.assert_original()
        _need(not row.retirement_started and not row.retired)
        self._call(self.k.WaitForSingleObject,self._number(row.event),0,
            valid=lambda state:type(state) is int and state == 258,keep=(row,))

    def hash(self, handle, guard, size):
        owner = self.owner
        digest = hashlib.sha256()
        for offset in range(0,size,_READ_BYTES):
            previous = owner._reads[-1] if owner._reads else None
            _need(previous is None or previous.completed is True)
            request = _SourceRead(handle,owner._read_event,owner._buffer,offset,min(_READ_BYTES,size-offset))
            owner._retain().read_origins.append(request)
            owner._reads.append(request)  # Original IOSB/offset/buffer before reset/dispatch.
            self._call(self.k.ResetEvent,self._number(request.event),keep=(request,))
            self.check_guard(guard)
            request.issued = True
            status = self._call(self.n.NtReadFile,self._number(handle),self._number(request.event),None,None,
                C.byref(request.io),request.buffer,request.size,C.byref(request.offset),None,
                valid=lambda status:type(status) is int and status in (0,0x103),keep=(request,))
            request.assert_original()
            self._call(self.k.WaitForSingleObject,self._number(request.event),w._WAIT_MS,
                valid=lambda state:type(state) is int and state == 0,keep=(request,))
            request.assert_original()
            _need(status in (0,0x103) and request.io.status in (None,0) and request.io.information == request.size)
            request.completed = True
            self.check_guard(guard)
            digest.update(memoryview(request.buffer).cast('B')[:request.size])
        return digest.hexdigest()

    def close(self, handle):
        owner = self.owner
        number = self._number(handle)
        _need(owner._terminal and owner._closing is None)
        owner._closing,handle.close_started = handle,True
        self._call(self.k.CloseHandle,number,keep=(handle,))
        handle.close_call,handle.closed = owner._calls[-1],True
        owner._closing = None
        handle.assert_original(owner)

    def retire_guard(self, row):
        row.assert_original()
        _need(self.owner._terminal and not row.retirement_started and not row.retired)
        row.retirement_started = True
        self._call(self.k.CancelIoEx,self._number(row.handle),C.byref(row.overlapped),
            false_errors=(1168,),keep=(row,))
        self._call(self.k.WaitForSingleObject,self._number(row.event),w._WAIT_MS,
            valid=lambda state:type(state) is int and state == 0,keep=(row,))
        transferred = C.c_uint32()
        self._call(self.k.GetOverlappedResult,self._number(row.handle),C.byref(row.overlapped),C.byref(transferred),0,
            valid=lambda ok:type(ok) is int and ok == 0,expected_error=995,keep=(row,transferred))
        _need(int(row.overlapped.internal)&0xffffffff == 0xc0000120 and transferred.value == 0)
        self.close(row.event)
        row.retired = True


class _SourceCustody:
    """Original references independent of subsequently replaceable owner fields."""
    def __init__(self, owner):
        self.owner = owner
        self.refs = (owner._inventory,owner._binding,owner._execution,owner._factory,
            owner._plan,owner._handles,owner._guards,owner._reads,owner._calls,owner._operations)
        self.api = self.reservation = self.buffer = self.event = None
        self.chain = self.files = None
        self.sealed_handles = self.sealed_guards = None
        self.handle_origins = []
        self.guard_origins,self.read_origins,self.call_origins,self.operation_origins = [],[],[],[]
        self.plan_facts = tuple(vars(owner._plan).items())

    def check(self):
        owner = self.owner
        _need(type(owner) is _OriginalModelSources and owner._origin is owner
              and _SOURCE_CUSTODY.get(id(owner)) is self
              and all(a is b for a,b in zip((owner._inventory,owner._binding,owner._execution,
                owner._factory,owner._plan,owner._handles,owner._guards,owner._reads,
                owner._calls,owner._operations),self.refs)))
        owner._binding.assert_original(owner._inventory)
        _need(tuple(vars(owner._plan).items()) == self.plan_facts)
        for actual,original in ((owner._handles,[row[0] for row in self.handle_origins]),
                (owner._guards,self.guard_origins),(owner._reads,self.read_origins),
                (owner._calls,self.call_origins),(owner._operations,self.operation_origins)):
            _need(len(actual) == len(original) and all(a is b for a,b in zip(actual,original)))
        for handle,slot,generation in self.handle_origins:
            _need(handle.slot is slot and handle.original_slot is slot
                  and handle.generation is generation and handle.original_generation is generation)
            if handle.installed is not None:
                call = handle.acquire_call
                _need(type(call) is _SourceNativeCall and call.output is slot
                      and call.output_value == handle.installed == slot.value
                      and call.acknowledged and call.returned)
        for expected,actual in ((self.api,owner._api),(self.reservation,owner._reservation),
                (self.buffer,owner._buffer),(self.event,owner._read_event),
                (self.chain,owner._chain),(self.files,owner._files)):
            _need(expected is actual)
        if self.sealed_handles is not None:
            _need(len(owner._handles) == len(self.sealed_handles)
                  and all(a is b for a,b in zip(owner._handles,self.sealed_handles))
                  and len(owner._guards) == len(self.sealed_guards)
                  and all(a is b for a,b in zip(owner._guards,self.sealed_guards)))


class _OriginalModelSources:
    """Unused explicit source-only preparation; missing producer fails closed.

    The private injectable factory/port are trusted composition seams, not an
    authentication boundary against arbitrary Python code in this process.
    Production has neither a producer nor a borrower for this owner.
    """
    def __init__(self, inventory, *, _execution=None, _api_factory=_WindowsSourceApi):
        binding = capture_original_model_inventory(inventory)
        _need(_execution is None or isinstance(_execution,_SourceExecutionPort))
        self._origin = self
        self._inventory,self._binding = inventory,binding
        self._execution,self._factory = _execution,_api_factory
        self._plan = _source_graph_plan(inventory,binding)
        self._handles,self._guards,self._reads,self._calls,self._operations = [],[],[],[],[]
        self._api = self._reservation = self._buffer = self._read_event = None
        self._chain = self._files = None
        self._op = self._pending = self._acquiring = self._closing = None
        self._uncertain = self._retired = self._terminal = self._busy = False
        self._lock = RLock()

    def __repr__(self):return '<unused original model source owner>'
    def __copy__(self):raise model.OffloadAdmissionError()
    def __deepcopy__(self,memo):raise model.OffloadAdmissionError()
    def __reduce_ex__(self,protocol):raise model.OffloadAdmissionError()

    def _retain(self):
        _need(type(self) is _OriginalModelSources and self._origin is self)
        with _SOURCE_LOCK:
            row = _SOURCE_CUSTODY.get(id(self))
            if row is None:
                _need(not self._retired and id(self) not in _SOURCE_RETIREMENTS
                      and len(set(_SOURCE_CUSTODY)|set(_SOURCE_RETIREMENTS)) < w._MAX_OWNERS)
                row = _SourceCustody(self)
                _SOURCE_CUSTODY[id(self)] = row
            _need(type(row) is _SourceCustody and row.owner is self)
            row.check()
            return row

    def _reserved(self):
        row = self._retain()
        _need(type(self._reservation) is _SourceReservation)
        self._reservation.assert_original(self._execution,self,self._plan)
        _need(self._execution.assert_bound(self) is None
              and self._execution.assert_reserved(self,self._reservation,self._plan) is None)
        row.check()

    def _native_call(self, function, args, valid, keep, *, expected_error=None, false_errors=(), kwargs=None, output=None):
        self._reserved()
        operation = self._op
        _need(type(operation) is w._ExecutionCall and operation.started and not operation.finished
              and operation.thread == get_ident() and self._pending is None and not self._uncertain)
        row = _SourceNativeCall(self,function,args,valid,keep,self._terminal,expected_error,false_errors,output)
        self._retain().call_origins.append(row)
        self._calls.append(row)
        self._pending = row
        def invoke():
            try:
                self._reserved()
                row.assert_original(self)
                _need(self._op is operation and self._pending is row and not operation.finished
                      and operation.thread == get_ident() and not row.started and not self._uncertain)
                row.started,row.thread = True,get_ident()
                C.set_last_error(0)
                value = function(*args,**(kwargs or {}))
                error = C.get_last_error()  # Before any producer bookkeeping.
                row.output_value = None if row.output is None else row.output.value
                row.value,row.error,row.returned = value,error,True
                return value
            except BaseException:
                self._uncertain = True
                raise
        try:
            value = self._execution.invoke_native(self,self._reservation,row,invoke)
            self._reserved()
            row.assert_original(self)
            _need(row.started and row.returned and row.thread == get_ident() and value is row.value
                  and self._pending is row and not self._uncertain)
            _need((valid(value) or (type(value) is int and value == 0 and row.error in false_errors))
                  and (expected_error is None or row.error == expected_error))
            row.acknowledged = True
            self._pending = None
            return value
        except BaseException:
            self._uncertain = True
            raise

    def _run(self, kind, operation):
        _need(type(self) is _OriginalModelSources and self._origin is self
              and isinstance(self._execution,_SourceExecutionPort) and not self._retired and not self._uncertain)
        custody = self._retain()
        try:
            with self._lock:
                _need(not self._busy and not self._uncertain and not self._retired)
                self._busy = True
            call = w._ExecutionCall()
            custody.operation_origins.append(call)
            self._operations.append(call)
            _need(self._execution.assert_bound(self) is None)
            def invoke():
                try:
                    custody.check()
                    _need(not call.started and self._busy and not self._uncertain and not self._retired)
                    call.started,call.thread,self._op = True,get_ident(),call
                    result = operation()
                    custody.check()
                    _need(not self._uncertain and self._pending is None and self._op is call)
                    call.value,call.finished = result,True
                    return result
                except BaseException:
                    self._uncertain = True
                    raise
            result = self._execution.execute(self,kind,invoke)
            custody.check()
            _need(call.started and call.finished and result is call.value and self._op is call and not self._uncertain)
            self._busy,self._op = False,None
            return result
        except BaseException as error:
            self._uncertain = True
            if isinstance(error,Exception):raise model.OffloadAdmissionError() from None
            raise

    def prepare(self):
        def operation():
            custody = self._retain()
            _need(self._api is None and self._reservation is None)
            reply = self._execution.reserve_initial(self,self._plan)
            _need(type(reply) is _SourceReservation)
            reply.assert_original(self._execution,self,self._plan)
            self._reservation = custody.reservation = reply
            self._reserved()  # Before API allocation or DLL bootstrap.
            _need(self._factory is _WindowsSourceApi)
            api = object.__new__(_WindowsSourceApi)
            self._api = custody.api = api
            _WindowsSourceApi.__init__(api,self)
            self._chain = custody.chain = api.chain(self._inventory.root)
            files = []
            # Capture the original list before the first file acquisition.
            self._files = custody.files = files
            for name,size,digest in self._inventory.bindings:
                handle = api.open(self._chain[-1][0],name,False)
                facts = api.facts(handle)
                _need(facts[1] == size and facts[0][:8] == self._chain[-1][1][:8]
                      and all(other[1][0] != facts[0] for other in files))
                guard = api.guard(handle)
                files.append((handle,facts,guard,name,size,digest))
            self._files = custody.files = tuple(files)
            self._buffer = custody.buffer = C.create_string_buffer(_READ_BYTES)
            self._read_event = custody.event = api.event()
            custody.sealed_handles,custody.sealed_guards = tuple(self._handles),tuple(self._guards)
            self._check_bound()
            for handle,facts,guard,name,size,digest in files:
                _need(api.hash(handle,guard,size) == digest)
            self._check_bound()
        return self._run('prepare',operation)

    def _check_bound(self):
        self._reserved()
        _need(self._chain is not None and self._files is not None)
        self._api._assert_original()
        for handle,identity in self._chain:_need(self._api.identity(handle) == identity)
        _need(len(self._files) == self._plan.files)
        for handle,facts,guard,_,_,_ in self._files:
            _need(self._api.facts(handle) == facts)
            self._api.check_guard(guard)

    def assert_bound(self):
        def operation():
            self._reserved()
            _need(self._execution.reserve_check(self,self._reservation,self._plan.live_check_calls) is None)
            self._check_bound()
        return self._run('check',operation)

    def retire_unused(self):
        def operation():
            custody = self._retain()
            self._reserved()
            _need(self._api is not None and self._chain is not None and self._files is not None
                  and self._acquiring is None and self._closing is None
                  and all(row.completed is True for row in self._reads)
                  and id(self) not in _SOURCE_RETIREMENTS)
            # Original graph is retained independently before any cancellation.
            graph = (custody,self._api,self._reservation,tuple(self._handles),tuple(self._guards),
                     tuple(self._reads),tuple(self._calls),tuple(self._chain),tuple(self._files),
                     self._read_event,self._buffer)
            _SOURCE_RETIREMENTS[id(self)] = graph
            for handle in graph[3]:handle.assert_original(self)
            for guard in graph[4]:guard.assert_original()
            for request in graph[5]:request.assert_original()
            _need(len(graph[3]) == self._plan.handle_slots and len(graph[4]) == self._plan.files)
            self._terminal = True
            for guard in graph[4]:self._api.retire_guard(guard)
            for handle,_,_,_,_,_ in reversed(graph[8]):self._api.close(handle)
            for handle,_ in reversed(graph[7]):self._api.close(handle)
            self._api.close(graph[9])
            custody.check()
            _need(all(handle.closed is True for handle in graph[3])
                  and all(guard.retired is True for guard in graph[4]))
        self._run('retire-unused',operation)
        # The original execute reply must acknowledge all closes first.
        try:
            with _SOURCE_LOCK:
                custody = self._retain()
                _need(not self._uncertain and not self._busy and self._pending is None)
                custody.check()
                self._retired = True
                del _SOURCE_CUSTODY[id(self)]
        except BaseException:
            self._uncertain = True
            raise
        # Keep the original retirement graph. This supplies no disk/worker credit.
