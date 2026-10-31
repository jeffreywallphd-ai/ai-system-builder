"""Private, persistent, model-free Windows IO ownership.

Construction is inert. This read-only prerequisite does not select the guarded
production backend, create staging, authorize a model writer or release charge.
Native admission/GIL/OS scheduling are not hard real-time guarantees. Unknown
outcomes retain the original session and deny replacement.
"""
import ctypes as C
import hashlib
import json
import os
from pathlib import Path, PureWindowsPath
import re
import stat
import struct
import subprocess
import sys
import sysconfig
from threading import RLock, get_ident
import time
import types
import uuid

from .local_model_offload import OffloadAdmissionError

_BUDGET_NS = 120 * 10**9
_FRAME_BYTES = 4096
_MEMORY_BYTES = 512 * 1024**2  # Only the model-free child, not its parent.
_MAX_CALLS, _TERMINAL_CALLS = 16384, 64
_OWNERS, _LOCK = {}, RLock()
_PTR, _U32, _I32 = C.c_void_p, C.c_uint32, C.c_int32
_SOURCE_NAMES = ('local_model_offload.py', 'offload_recovery.py', 'windows_offload_core.py',
                 'windows_offload_backend.py', 'windows_offload_execution.py',
                 'windows_offload_execution_child.py')
_OPERATIONS = {0: 'initialize', 1: 'bind-read', 2: 'retire-unused-read', 3: 'finish'}
_STATES = {0: 'initialized', 1: 'read-bound', 2: 'read-retired', 3: 'finished'}


def _need(value):
    if not value: raise OffloadAdmissionError()


def _remaining(deadline):
    _need(type(deadline) is int and 0 < deadline < 2**63)
    value = deadline - time.monotonic_ns()
    _need(0 < value <= _BUDGET_NS)
    return max(1, min(120000, (value + 999999) // 1000000))


def _root(value):
    _need(type(value) is str)
    try: size = len(value.encode('utf8'))
    except UnicodeError: raise OffloadAdmissionError() from None
    _need(1 <= size <= 2048 and not any(ord(c) < 32 or ord(c) == 127 for c in value))
    path = PureWindowsPath(value)
    _need(path.is_absolute() and re.fullmatch('[A-Za-z]:\\\\', path.anchor)
          and len(path.parts) <= 128 and not any(p in ('.', '..') for p in value.replace('/', '\\').split('\\'))
          and all(':' not in p and not p.endswith(('.', ' ')) for p in path.parts[1:]))
    return str(path)


def _configured_root():
    # Capture only these explicit host values; no HF/framework discovery.
    for name in ('HF_HUB_CACHE', 'TRANSFORMERS_CACHE', 'HF_HOME'):
        value = os.environ.get(name)
        if value:
            return _root(str(PureWindowsPath(value) / 'hub') if name == 'HF_HOME' else value)
    raise OffloadAdmissionError()


def _decode(raw):
    _need(type(raw) is bytes and 0 < len(raw) <= _FRAME_BYTES)
    def pairs(rows):
        result = {}
        for key, value in rows:
            _need(key not in result); result[key] = value
        return result
    def bad(_): raise OffloadAdmissionError()
    try: value = json.loads(raw.decode('utf8'), object_pairs_hook=pairs, parse_constant=bad)
    except (UnicodeError, ValueError, RecursionError): raise OffloadAdmissionError() from None
    _need(type(value) is dict)
    def depth(item, level):
        _need(level <= 4)
        if type(item) is dict:
            _need(len(item) <= 8)
            for key, value in item.items(): _need(type(key) is str); depth(value, level + 1)
        else: _need(type(item) in (str, int, bool, type(None)))
    depth(value, 0)
    return value


def _message(value, nonce, source, *, response=False):
    _need(type(value) is dict and set(value) == {'v', 'nonce', 'seq', 'op', 'body', 'source_digest', 'deadline_ns'})
    _need(type(value['v']) is int and value['v'] == 1
          and type(nonce) is str and re.fullmatch('[0-9a-f]{32}', nonce)
          and type(value['nonce']) is str and value['nonce'] == nonce
          and type(source) is str and re.fullmatch('[0-9a-f]{64}', source)
          and type(value['source_digest']) is str and value['source_digest'] == source
          and type(value['seq']) is int and value['seq'] in _OPERATIONS
          and type(value['op']) is str and value['op'] == _OPERATIONS[value['seq']]
          and type(value['deadline_ns']) is int and 0 < value['deadline_ns'] < 2**63
          and type(value['body']) is dict)
    body = value['body']
    if response:
        _need(set(body) in ({'state'}, {'error', 'core_retired'}))
        if 'state' in body: _need(type(body['state']) is str and body['state'] == _STATES[value['seq']])
        else: _need(body['error'] == 'offload-io-unavailable' and type(body['error']) is str and type(body['core_retired']) is bool)
    elif value['seq'] == 0:
        _need(set(body) == {'cache_root'} and _root(body['cache_root']) == body['cache_root'])
    else: _need(not body)
    return value


def _frame(value):
    _need(type(value) is dict)
    raw = json.dumps(value, ensure_ascii=False, separators=(',', ':'), allow_nan=False).encode('utf8')
    _need(0 < len(raw) <= _FRAME_BYTES)
    return struct.pack('<I', len(raw)) + raw


def _edge(state, seq):
    _need(type(seq) is int)
    _need((state, seq) in {('new', 0), ('initialized', 1), ('initialized', 3),
                          ('read-bound', 2), ('read-retired', 3)})
    return _STATES[seq]


def _read_source(path, maximum=2 * 1024**2):
    info = path.lstat()
    _need(stat.S_ISREG(info.st_mode) and not path.is_symlink()
          and not getattr(info, 'st_file_attributes', 0) & 0x400 and 0 < info.st_size <= maximum)
    def identity(v): return v.st_dev, v.st_ino, v.st_size, v.st_mtime_ns
    with path.open('rb') as stream:
        _need(identity(os.fstat(stream.fileno())) == identity(info))
        raw = stream.read(maximum + 1)
        _need(identity(os.fstat(stream.fileno())) == identity(info))
    _need(len(raw) == info.st_size and identity(path.lstat()) == identity(info))
    return raw


def _sources():
    folder = Path(__file__).absolute().parent
    values = {name: _read_source(folder / name) for name in _SOURCE_NAMES}
    hashes = {name: hashlib.sha256(raw).hexdigest() for name, raw in values.items()}
    return values, hashes, hashlib.sha256(json.dumps(hashes, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


class _BasicLimits(C.Structure):
    _fields_ = [('process_time', C.c_int64), ('job_time', C.c_int64), ('flags', _U32),
                ('minimum_working_set', C.c_size_t), ('maximum_working_set', C.c_size_t),
                ('active_process_limit', _U32), ('affinity', C.c_size_t), ('priority', _U32), ('scheduling', _U32)]
class _IoCounters(C.Structure):
    _fields_ = [(n, C.c_uint64) for n in ('read_ops','write_ops','other_ops','read_bytes','write_bytes','other_bytes')]
class _ExtendedLimits(C.Structure):
    _fields_ = [('basic', _BasicLimits), ('io', _IoCounters), ('process_memory_limit', C.c_size_t),
                ('job_memory_limit', C.c_size_t), ('peak_process_memory', C.c_size_t), ('peak_job_memory', C.c_size_t)]
class _Security(C.Structure):
    _fields_ = [('length', _U32), ('descriptor', _PTR), ('inherit', _I32)]
class _Startup(C.Structure):
    _fields_ = [('cb', _U32), ('reserved', C.c_wchar_p), ('desktop', C.c_wchar_p), ('title', C.c_wchar_p),
                *[(n, _U32) for n in ('x','y','width','height','chars_x','chars_y','fill','flags')],
                ('show', C.c_uint16), ('reserved_size', C.c_uint16), ('reserved_bytes', _PTR),
                ('stdin', _PTR), ('stdout', _PTR), ('stderr', _PTR)]
class _StartupEx(C.Structure):
    _fields_ = [('startup', _Startup), ('attributes', _PTR)]
class _Process(C.Structure):
    _fields_ = [('process', _PTR), ('thread', _PTR), ('pid', _U32), ('tid', _U32)]
class _Accounting(C.Structure):
    _fields_ = [(n, C.c_int64) for n in ('user','kernel','period_user','period_kernel')] + [
        (n, _U32) for n in ('faults','total','active','terminated')]


class _Handle:
    def __init__(self, owner, name):
        self.__origin=self
        self.owner, self.name, self.slot = owner, name, _PTR()
        self._original_slot=self.slot;self._number=None
        self.close_started = self.closed = False
        self.close_record = None
    def acknowledge(self):
        _need(self._number is None and self.slot is self._original_slot
              and type(self.slot.value) is int and 0<self.slot.value<C.c_void_p(-1).value)
        self._number=self.slot.value
        if type(self.owner) is _WindowsOffloadIoSession:
            _need(id(self) not in self.owner._handle_bindings)
            self.owner._handle_bindings[id(self)] = (self, self.slot, self._number)
    @property
    def value(self):
        _need(type(self) is _Handle and getattr(self,'_Handle__origin',None) is self
              and any(h is self for h in self.owner.handles)
              and not self.closed and not self.close_started
              and self.slot is self._original_slot and type(self.slot) is _PTR
              and type(self._number) is int and self.slot.value==self._number
              and 0 < self.slot.value < C.c_void_p(-1).value)
        return self.slot.value


class _Call:
    def __init__(self):
        self.function = self.args = self.valid = self.keep = None
        self.started = self.returned = self.acknowledged = False
        self.result = self.error = None
        self.pool=self.index=self.payload=None
        self.committed=False
        self.integrity_lost=False
        self.native_thread=self.completion=None


class _IntentChanged(OffloadAdmissionError):pass


class _Ledger:
    """One lifetime allocation; reserve normal and terminal rows before effects."""
    def __init__(self, owner):
        self.__origin=self;self.owner=owner
        self.lock = RLock()
        self.normal = [_Call() for _ in range(_MAX_CALLS)]
        self.terminal = [_Call() for _ in range(_TERMINAL_CALLS)]
        self.used = self.terminal_used = 0
        self.rows=tuple(self.normal)+tuple(self.terminal)
        self.bindings=[None]*len(self.rows)
        self.completions=[None]*len(self.rows)
        for index,row in enumerate(self.rows):row.pool=self;row.index=index

    def reserve(self, rows, function, args, valid, keep, terminal):
        with self.lock:
            if self.used < len(self.normal):
                row = self.normal[self.used]; self.used += 1
            else:
                _need(terminal and self.terminal_used < len(self.terminal))
                row = self.terminal[self.terminal_used]; self.terminal_used += 1
            row.function, row.args, row.valid, row.keep = function, args, valid, keep
            rows.append(row)
            return row

    def member(self,row):
        _need(type(self) is _Ledger and getattr(self,'_Ledger__origin',None) is self
              and type(row) is _Call and row.pool is self and type(row.index) is int
              and 0<=row.index<len(self.rows) and self.rows[row.index] is row)

    def commit(self,row,api,request,kind,wait_deadline=None):
        with self.lock:
            self.member(row)
            _need(api.owner is self.owner and self.bindings[row.index] is None and not row.committed and not row.started)
            facts=[]
            def capture(value,depth=0):
                _need(depth<=3)
                if type(value) is tuple:
                    for item in value:capture(item,depth+1)
                elif type(value) is _Handle:
                    _need(getattr(value,'_Handle__origin',None) is value and value.owner is self.owner
                          and any(h is value for h in self.owner.handles) and value.slot is value._original_slot
                          and type(value.slot) is _PTR and not value.closed
                          and (value._number is None or value.slot.value==value._number))
                    facts.append((value,value.slot,value.slot.value,value._number,value.close_started,value.closed))
            capture(row.keep)
            if wait_deadline is not None:
                _need(type(wait_deadline) is int and len(row.args)==4)
                effective=min(wait_deadline,request.deadline) if request is not None else wait_deadline
                row.args=(*row.args[:-1],_remaining(effective))
            tick=time.monotonic_ns()
            if request is not None and kind!='idle-consumed':_need(0<request.deadline-tick<=_BUDGET_NS)
            binding=(row.function,row.args,row.valid,row.keep,api,request,kind,tick,tuple(facts),get_ident())
            self.bindings[row.index]=binding;row.payload=binding;row.committed=True

    def claim(self,row,api):
        with self.lock:
            self.member(row);binding=self.bindings[row.index]
            _need(type(binding) is tuple and binding[4] is api and api.owner is self.owner
                  and row.committed and not row.started and not row.integrity_lost
                  and len(binding)==10 and binding[9]==get_ident())
            try:
                _need(row.payload is binding and not row.returned and not row.acknowledged
                      and row.function is binding[0] and row.args is binding[1]
                      and row.valid is binding[2] and row.keep is binding[3])
                for h,slot,number,generation,closing,closed in binding[8]:
                    _need(getattr(h,'_Handle__origin',None) is h and h.owner is self.owner
                          and any(v is h for v in self.owner.handles)
                          and h.slot is slot and h._original_slot is slot and slot.value==number
                          and type(h._number) is type(generation) and h._number==generation
                          and h.close_started is closing and h.closed is closed)
            except BaseException:
                row.integrity_lost=True
                raise _IntentChanged() from None
            row.native_thread=get_ident();row.started=True
            return binding

    def returned_native(self,row,api,result,error):
        """Publish a known return, independently of normal success validation."""
        with self.lock:
            self.member(row);binding=self.bindings[row.index]
            _need(type(binding) is tuple and len(binding)==10 and binding[4] is api and row.started
                  and row.native_thread==get_ident() and self.completions[row.index] is None
                  and row.completion is None and not row.returned and not row.integrity_lost
                  and row.payload is binding and row.function is binding[0]
                  and row.args is binding[1] and row.valid is binding[2] and row.keep is binding[3]
                  and type(result) in (int,type(None)) and type(error) is int and 0<=error<2**32)
            completion=(binding,result,error,row.native_thread)
            # An interruption anywhere in publication leaves the exact row
            # retained. Both canonical references and all values must agree.
            self.completions[row.index]=completion
            row.completion=completion;row.result=result;row.error=error;row.returned=True

    def settled(self,row,api):
        """Known native completion is not a successful request or close ACK."""
        with self.lock:
            self.member(row);binding=self.bindings[row.index]
            try:
                value=self.completions[row.index]
                _need(type(binding) is tuple and len(binding)==10
                      and type(value) is tuple and len(value)==4 and value is row.completion
                      and value[0] is binding and binding[4] is api
                      and row.payload is binding and row.function is binding[0]
                      and row.args is binding[1] and row.valid is binding[2] and row.keep is binding[3]
                      and row.started and row.returned and not row.integrity_lost
                      and row.result is value[1] and row.error is value[2]
                      and type(row.native_thread) is int and row.native_thread==value[3]==binding[9])
                return value
            except BaseException:
                row.integrity_lost=True
                raise


class _Native:
    def __new__(cls, owner):
        _native_owner(owner)
        _need(owner.api is None); value = super().__new__(cls); owner.api = value; return value
    def __init__(self, owner):
        self.__origin=self
        self.owner = owner
        _need(os.name == 'nt' and C.sizeof(_PTR) == 8 and sys.implementation.name == 'cpython'
              and sysconfig.get_platform() == 'win-amd64'
              and (C.sizeof(_BasicLimits),C.sizeof(_ExtendedLimits),C.sizeof(_StartupEx),C.sizeof(_Process)) == (64,144,112,24))
        self.k = C.WinDLL('kernel32', use_last_error=True)
        ptr, u32, i32 = _PTR, _U32, _I32
        signatures = [
            ('CreateEventW',[ptr,i32,i32,C.c_wchar_p],ptr),('SetEvent',[ptr],i32),('ResetEvent',[ptr],i32),
            ('CreatePipe',[C.POINTER(ptr),C.POINTER(ptr),C.POINTER(_Security),u32],i32),
            ('ReadFile',[ptr,ptr,u32,C.POINTER(u32),ptr],i32),('WriteFile',[ptr,ptr,u32,C.POINTER(u32),ptr],i32),
            ('GetFileType',[ptr],u32),('GetHandleInformation',[ptr,C.POINTER(u32)],i32),
            ('SetHandleInformation',[ptr,u32,u32],i32),('CloseHandle',[ptr],i32),
            ('WaitForSingleObject',[ptr,u32],u32),('WaitForMultipleObjects',[u32,C.POINTER(ptr),i32,u32],u32),
            ('GetCurrentProcess',[],ptr),('GetCurrentThreadId',[],u32),('GetProcessId',[ptr],u32),
            ('GetExitCodeProcess',[ptr,C.POINTER(u32)],i32),('GetExitCodeThread',[ptr,C.POINTER(u32)],i32),
            ('CancelSynchronousIo',[ptr],i32),
            ('QueryFullProcessImageNameW',[ptr,u32,C.c_wchar_p,C.POINTER(u32)],i32),
            ('CreateJobObjectW',[ptr,C.c_wchar_p],ptr),('SetInformationJobObject',[ptr,i32,ptr,u32],i32),
            ('QueryInformationJobObject',[ptr,i32,ptr,u32,C.POINTER(u32)],i32),('IsProcessInJob',[ptr,ptr,C.POINTER(i32)],i32),
            ('TerminateJobObject',[ptr,u32],i32),('InitializeProcThreadAttributeList',[ptr,u32,u32,C.POINTER(C.c_size_t)],i32),
            ('UpdateProcThreadAttribute',[ptr,u32,C.c_size_t,ptr,C.c_size_t,ptr,ptr],i32),
            ('DeleteProcThreadAttributeList',[ptr],None),('CreateProcessW',[C.c_wchar_p,C.c_wchar_p,ptr,ptr,i32,u32,ptr,C.c_wchar_p,C.POINTER(_StartupEx),C.POINTER(_Process)],i32),
            ('ResumeThread',[ptr],u32),('GetSystemDirectoryW',[C.c_wchar_p,u32],u32),
            ('GetWindowsDirectoryW',[C.c_wchar_p,u32],u32),('GetModuleFileNameW',[ptr,C.c_wchar_p,u32],u32),
            ('ExitProcess',[u32],None),('Sleep',[u32],None)]
        for name,args,result in signatures:
            fn=getattr(self.k,name);fn.argtypes,fn.restype=args,result
        if type(owner) is not _WindowsOffloadIoSession:
            owner.exit_function,owner.park_function=self.k.ExitProcess,self.k.Sleep
        self.thread_callback = C.WINFUNCTYPE(u32,ptr)
        self.timer_callback = C.WINFUNCTYPE(None,ptr,C.c_ubyte)
        self.k.CreateTimerQueueTimer.argtypes=[C.POINTER(ptr),ptr,self.timer_callback,ptr,u32,u32,u32]
        self.k.CreateTimerQueueTimer.restype=i32
        self.k.DeleteTimerQueueTimer.argtypes=[ptr,ptr,ptr]
        self.k.DeleteTimerQueueTimer.restype=i32
        system = self.location(self.k.GetSystemDirectoryW)
        crt_path = str(PureWindowsPath(system)/'ucrtbase.dll')
        self.crt = C.CDLL(crt_path, use_errno=True)
        loaded=C.create_unicode_buffer(32768);owner.buffers.append(loaded)
        length=self.call(self.k.GetModuleFileNameW,self.crt._handle,loaded,len(loaded),
                         valid=lambda n:type(n) is int and 0<n<len(loaded),keep=(self.crt,loaded))
        _need(length==len(loaded.value) and _root(loaded.value).casefold()==crt_path.casefold())
        _amd64_image(_read_source(Path(loaded.value),64*1024**2))
        self.begin = self.crt._beginthreadex
        self.begin.argtypes = [ptr,u32,self.thread_callback,ptr,u32,C.POINTER(u32)]
        self.begin.restype = C.c_size_t

    def location(self, function):
        text=C.create_unicode_buffer(32768);self.owner.buffers.append(text)
        n=self.call(function,text,len(text),valid=lambda n:type(n) is int and 0<n<len(text),keep=(text,))
        _need(n==len(text.value));return _root(text.value)

    def _call_row(self, function, *args, valid=lambda v:type(v) is int and v!=0, keep=(), terminal=False, _wait_deadline=None):
        self.origin();owner=self.owner
        if type(owner) is _WindowsOffloadIoSession:
            with owner._state_lock:
                request=owner.active;owner._live(request)
                row=owner.ledger.reserve(owner.calls,function,args,valid,keep,terminal)
                owner._live(request)
                owner.ledger.commit(row,self,request,'operation',_wait_deadline)
        else:
            row=owner.ledger.reserve(owner.calls,function,args,valid,keep,terminal)
            owner.ledger.commit(row,self,None,'child',_wait_deadline)
        return row

    def call(self, function, *args, **kwargs):
        return self._perform(self._call_row(function,*args,**kwargs))

    def _perform(self,row):
        self.origin();owner=self.owner
        try:binding=owner.ledger.claim(row,self)
        except _IntentChanged:
            if type(owner) is _WindowsOffloadIoSession:owner._fence()
            else:owner.uncertain=True
            raise
        try:
            result=binding[0](*binding[1]);error=C.get_last_error()
            if type(owner) is _WindowsOffloadIoSession:
                owner.ledger.returned_native(row,self,result,error)
            else:
                row.result=result;row.error=error;row.returned=True
            _need(binding[2](row.result));row.acknowledged=True
            return row.result
        except BaseException:
            if type(owner) is _WindowsOffloadIoSession:owner._fence()
            else:owner.uncertain=True
            raise

    def idle_wait(self,request):
        self.origin();owner=self.owner
        _need(type(owner) is _WindowsOffloadIoSession)
        with owner._state_lock:
            request.origin(owner)
            _need(not owner.uncertain and not owner.stop_requested and not request.expired
                  and owner.controller_ident==get_ident()
                  and request.started and request.returned and request.published and request.signal_ack
                  and request.seq!=3 and request.idle_intent is None)
            if not request.consumed:owner._live(request)
            h=owner.request_event
            row=owner.ledger.reserve(owner.calls,self.k.WaitForSingleObject,(h.value,0xffffffff),
                    lambda n:type(n) is int and n==0,(request,h,h.slot),False)
            if not request.consumed:owner._live(request)
            owner.ledger.commit(row,self,request,'idle-consumed' if request.consumed else 'idle-live')
            request.idle_intent=row
        # The exact retained intent predates a later fence. Do not hold either
        # gate over native IO or mistake its return for operation success.
        return self._perform(row)

    def acquire(self, name, function, *args, keep=()):
        self.origin()
        owner=self.owner;h=_Handle(owner,name);owner.handles.append(h)
        value=self.call(function,*args,valid=lambda v:type(v) is int and 0<v<C.c_void_p(-1).value,keep=(h,*keep))
        h.slot.value=value
        h.acknowledge()
        _need(all(old is h or old.closed or old.slot.value!=value for old in owner.handles))
        return h

    def close(self,h):
        self.origin()
        _need(type(h) is _Handle and h.owner is self.owner and not h.close_started and not h.closed)
        value=h.value;h.close_started=True
        row=self._call_row(self.k.CloseHandle,value,keep=(h,h.slot),terminal=True)
        self._perform(row)
        h.close_record=row;h.closed=True

    def wait(self, handles, deadline):
        self.origin()
        _need(type(handles) is tuple and 1<=len(handles)<=3 and len({id(h) for h in handles})==len(handles))
        for h in handles:_need(type(h) is _Handle and h.owner is self.owner and not h.closed and not h.close_started)
        values=(_PTR*len(handles))(*(h.value for h in handles));self.owner.buffers.append(values)
        value=self.call(self.k.WaitForMultipleObjects,len(handles),values,0,0,
                        valid=lambda v:type(v) is int and (0<=v<len(handles) or v==258),keep=(handles,values),
                        terminal=True,_wait_deadline=deadline)
        return value

    def origin(self):
        _need(type(self) is _Native and getattr(self,'_Native__origin',None) is self
              and self.owner.api is self)
        _native_owner(self.owner)


def _native_owner(owner):
    if type(owner) is _WindowsOffloadIoSession:
        owner.origin();return
    module=sys.modules.get(__package__+'.windows_offload_execution_child')
    _need(module is not None and type(owner) is module._Child and module._CHILD is owner)
    owner.origin()


class _Request:
    def __init__(self, owner, seq):
        self.__origin=self
        self.owner,self.seq,self.op=owner,seq,_OPERATIONS[seq]
        self.deadline=time.monotonic_ns()+_BUDGET_NS
        self.started=self.returned=self.published=self.consumed=False
        self.result=None
        self.expired=False
        self.signal_ack=False
        self.idle_intent=None
        self.effect_token=None

    def origin(self,owner):
        _need(type(self) is _Request and getattr(self,'_Request__origin',None) is self
              and self.owner is owner and any(r is self for r in owner.requests))


def _bootstrap(folder, hashes, nonce, handles, startup_deadline, runtime):
    _need(type(folder) is type(Path()) and folder.is_absolute() and set(hashes)==set(_SOURCE_NAMES)
          and all(type(v) is str and re.fullmatch('[a-f0-9]{64}',v) for v in hashes.values())
          and type(nonce) is str and re.fullmatch('[a-f0-9]{32}',nonce)
          and type(handles) is tuple and len(handles)==len(set(handles))==4
          and all(type(v) is int and 0<v<C.c_void_p(-1).value for v in handles)
          and type(runtime) is tuple and len(runtime)==2 and _root(runtime[0])==runtime[0]
          and type(runtime[1]) is str and re.fullmatch('[a-f0-9]{64}',runtime[1]))
    code=("import hashlib,os,sys,types\n"
          "p="+repr(str(folder))+";h="+repr(hashes)+"\n"
          "pkg=types.ModuleType('_aisb_owned_io');pkg.__path__=[p];sys.modules[pkg.__name__]=pkg\n"
          "for n in "+repr(_SOURCE_NAMES)+":\n"
          " with open(os.path.join(p,n),'rb') as f:b=f.read(2097153)\n"
          " if not(0<len(b)<=2097152 and hashlib.sha256(b).hexdigest()==h[n]):raise SystemExit(9)\n"
          " m=types.ModuleType(pkg.__name__+'.'+n[:-3]);m.__file__=os.path.join(p,n);m.__package__=pkg.__name__;sys.modules[m.__name__]=m\n"
          " exec(compile(b,m.__file__,'exec',dont_inherit=True),m.__dict__)\n"
          "m._BOOTSTRAP=("+repr((nonce,handles,startup_deadline,hashes,runtime))+ ")\n"
          "m._entry()\n")
    _need(len(code.encode('utf8'))<=16384)
    return code


def _runtime_image():
    value=getattr(sys,'_base_executable',None) if sys.prefix!=sys.base_prefix else sys.executable
    _need(type(value) is str)
    path=Path(_root(value));_need(path.name.lower() in ('python.exe','python3.exe','pythonw.exe'))
    raw=_read_source(path,64*1024**2)
    _amd64_image(raw)
    return path,hashlib.sha256(raw).hexdigest()


def _amd64_image(raw):
    _need(len(raw)>=256 and raw[:2]==b'MZ')
    offset=struct.unpack_from('<I',raw,0x3c)[0]
    _need(0<offset<len(raw)-26 and raw[offset:offset+4]==b'PE\0\0'
          and struct.unpack_from('<H',raw,offset+4)[0]==0x8664
          and struct.unpack_from('<H',raw,offset+24)[0]==0x20b)


class _WindowsOffloadIoSession:
    """One explicit private host session; no public caller-selected root."""
    def __init__(self, root):
        self.__origin=self
        self.initialized=False
        self.root=_root(root);self.nonce=uuid.uuid4().hex
        _need(_LOCK.acquire(blocking=False))
        try:
            _need(not _OWNERS);_OWNERS[id(self)]=self
        finally:_LOCK.release()
        self.api=None;self.buffers=[];self.calls=[];self.handles=[]
        self._handle_bindings={};self._effect_exits={};self.ledger=_Ledger(self)
        self.state='new';self.uncertain=self.busy=self.stop_requested=False
        self.session_retired=False
        self.acquisition_started=False;self.core_retired=False
        self.active=None;self.controller_ident=None;self.controller_finished=False
        self.requests=[]
        self.callback=None;self.thread_id=_U32();self.controller=None
        self.start_event=self.request_event=self.completion_event=None
        self.process_info=_Process();self.attributes=None;self.attribute_started=self.attribute_retired=False
        self.job=self.process=self.primary_thread=None
        self.channels={};self.source_values=self.source_hashes=self.source_digest=None
        self.launch_complete=False;self.terminal=None;self.terminal_retired=False
        self.runtime=None;self.runtime_hash=None
        self._state_lock=RLock()
        self.initialized=True

    def origin(self):
        _need(type(self) is _WindowsOffloadIoSession
              and getattr(self,'_WindowsOffloadIoSession__origin',None) is self
              and self.initialized is True
              and _OWNERS.get(id(self)) is self)

    def _live(self, request):
        self.origin()
        _need(type(request) is _Request);request.origin(self)
        _need(not self.uncertain and not self.stop_requested and self.active is request
              and request.owner is self and not request.expired)
        _remaining(request.deadline)

    def _fence(self):
        self.origin()
        with self._state_lock:
            if self.session_retired:return
            self.uncertain=self.stop_requested=True
            if self.active is not None and not self.active.consumed:self.active.expired=True

    def _start(self, request):
        self._live(request);_need(self.api is None and not self.acquisition_started)
        self.acquisition_started=True
        _Native(self)
        self._live(request);a=self.api
        self.start_event=a.acquire('controller-start',a.k.CreateEventW,None,1,0,None)
        self.request_event=a.acquire('controller-request',a.k.CreateEventW,None,0,0,None)
        self.completion_event=a.acquire('controller-complete',a.k.CreateEventW,None,1,0,None)
        self.controller=_Handle(self,'controller-thread');self.handles.append(self.controller)
        self.callback=a.thread_callback(self._controller_entry);self.buffers.extend((self.callback,self.thread_id,self.controller))
        value=a.call(a.begin,None,0,self.callback,None,0,C.byref(self.thread_id),
                     valid=lambda n:type(n) is int and 0<n<C.c_void_p(-1).value,
                     keep=(self.callback,self.thread_id,self.controller))
        self.controller.slot.value=value
        self.controller.acknowledge()
        self._live(request);_need(type(self.thread_id.value) is int and self.thread_id.value>0)
        a.call(a.k.SetEvent,self.start_event.value,keep=(self.start_event,))

    def _native_intent(self, request, function, *args, **kwargs):
        self._live(request)
        return self.api.call(function,*args,**kwargs)

    def _channel(self,name):
        a=self.api;security=_Security(C.sizeof(_Security),None,1)
        read=_Handle(self,name+'-read');write=_Handle(self,name+'-write')
        self.handles.extend((read,write));self.buffers.append(security)
        a.call(a.k.CreatePipe,C.byref(read.slot),C.byref(write.slot),C.byref(security),16384,keep=(read,write,security))
        read.acknowledge();write.acknowledge()
        _need(read.value!=write.value)
        self.channels[name+'-read']=read;self.channels[name+'-write']=write

    def _flags(self,h,inherit):
        a=self.api;value=_U32();self.buffers.append(value)
        a.call(a.k.SetHandleInformation,h.value,1,int(inherit),keep=(h,))
        a.call(a.k.GetHandleInformation,h.value,C.byref(value),keep=(h,value))
        _need(value.value&1==int(inherit))

    def _job_readback(self):
        a=self.api;inside=_I32();limits=_ExtendedLimits();self.buffers.extend((inside,limits))
        a.call(a.k.IsProcessInJob,self.process.value,self.job.value,C.byref(inside),keep=(self.process,self.job,inside))
        _need(inside.value==1)
        a.call(a.k.QueryInformationJobObject,self.job.value,9,C.byref(limits),C.sizeof(limits),None,keep=(self.job,limits))
        _need(limits.basic.flags==0x2308 and limits.basic.active_process_limit==1
              and limits.process_memory_limit==limits.job_memory_limit==_MEMORY_BYTES)
        _need(a.call(a.k.GetProcessId,self.process.value,keep=(self.process,))==self.process_info.pid)
        text=C.create_unicode_buffer(32768);length=_U32(len(text));self.buffers.extend((text,length))
        a.call(a.k.QueryFullProcessImageNameW,self.process.value,0,text,C.byref(length),keep=(self.process,text,length))
        _need(0<length.value<len(text) and length.value==len(text.value)
              and _root(text.value).casefold()==str(self.runtime).casefold()
              and hashlib.sha256(_read_source(self.runtime,64*1024**2)).hexdigest()==self.runtime_hash)

    def _launch(self,request):
        self._live(request);a=self.api
        self.source_values,self.source_hashes,self.source_digest=_sources()
        self.runtime,self.runtime_hash=_runtime_image();self.buffers.extend((self.source_values,self.source_hashes,self.runtime))
        self._live(request)
        self._channel('request');self._channel('response')
        self.channels['ready']=a.acquire('child-ready',a.k.CreateEventW,None,1,0,None)
        self.channels['dispatch']=a.acquire('child-dispatch',a.k.CreateEventW,None,1,0,None)
        inherited=tuple(self.channels[n] for n in ('request-read','response-write','ready','dispatch'))
        for name,h in self.channels.items():
            self._live(request);self._flags(h,any(v is h for v in inherited))
            if name not in ('ready','dispatch'):_need(a.call(a.k.GetFileType,h.value,keep=(h,))==3)
        self.job=a.acquire('io-job',a.k.CreateJobObjectW,None,None)
        limits=_ExtendedLimits();limits.basic.flags=0x2308;limits.basic.active_process_limit=1
        limits.process_memory_limit=limits.job_memory_limit=_MEMORY_BYTES;self.buffers.append(limits)
        a.call(a.k.SetInformationJobObject,self.job.value,9,C.byref(limits),C.sizeof(limits),keep=(self.job,limits))
        size=C.c_size_t();self.buffers.append(size)
        a.call(a.k.InitializeProcThreadAttributeList,None,2,0,C.byref(size),valid=lambda n:n==0 and C.get_last_error()==122,keep=(size,))
        _need(0<size.value<=65536)
        self.attributes=C.create_string_buffer(size.value);self.buffers.append(self.attributes)
        a.call(a.k.InitializeProcThreadAttributeList,self.attributes,2,0,C.byref(size),keep=(self.attributes,size))
        self.attribute_started=True
        jobs=(_PTR*1)(self.job.value);handles=(_PTR*4)(*(h.value for h in inherited));self.buffers.extend((jobs,handles))
        a.call(a.k.UpdateProcThreadAttribute,self.attributes,0,0x2000d,jobs,C.sizeof(jobs),None,None,keep=(self.attributes,jobs,self.job))
        a.call(a.k.UpdateProcThreadAttribute,self.attributes,0,0x20002,handles,C.sizeof(handles),None,None,keep=(self.attributes,handles,inherited))
        bootstrap=_bootstrap(Path(__file__).absolute().parent,self.source_hashes,self.nonce,tuple(h.value for h in inherited),
                             request.deadline,(str(self.runtime),self.runtime_hash))
        arguments=[str(self.runtime),'-I','-S','-B','-c',bootstrap]
        command=C.create_unicode_buffer(subprocess.list2cmdline(arguments))
        windows=a.location(a.k.GetWindowsDirectoryW)
        env={'SystemRoot':windows,'WINDIR':windows,'PATH':str(PureWindowsPath(windows)/'System32')+';'+windows}
        environment=C.create_unicode_buffer('\0'.join(k+'='+v for k,v in sorted(env.items()))+'\0\0')
        startup=_StartupEx();startup.startup.cb=C.sizeof(startup);startup.attributes=C.cast(self.attributes,_PTR)
        self.buffers.extend((arguments,bootstrap,command,environment,startup,self.process_info))
        self.process=_Handle(self,'io-process');self.primary_thread=_Handle(self,'io-main-thread');self.handles.extend((self.process,self.primary_thread))
        self._native_intent(request,a.k.CreateProcessW,str(self.runtime),command,None,None,1,0x80000|4|0x400|8,environment,
                            str(Path(__file__).absolute().parent),C.byref(startup),C.byref(self.process_info),
                            keep=(self.runtime,command,environment,startup,self.process_info,self.process,self.primary_thread))
        self.process.slot.value=self.process_info.process;self.primary_thread.slot.value=self.process_info.thread
        self.process.acknowledge();self.primary_thread.acknowledge()
        _need(self.process.value!=self.primary_thread.value)
        self._live(request);self._job_readback()
        a.call(a.k.DeleteProcThreadAttributeList,self.attributes,valid=lambda n:n is None,keep=(self.attributes,jobs,handles))
        self.attribute_retired=True
        for name in ('request-read','response-write'):a.close(self.channels[name])
        self._native_intent(request,a.k.ResumeThread,self.primary_thread.value,valid=lambda n:type(n) is int and n==1,keep=(self.primary_thread,))
        _need(a.wait((self.channels['ready'],),request.deadline)==0)
        self._live(request);self._job_readback()
        self._native_intent(request,a.k.SetEvent,self.channels['dispatch'].value,keep=(self.channels['dispatch'],))
        self._live(request);self.launch_complete=True

    def _write(self,handle,raw,request):
        _need(type(raw) is bytes and 0<len(raw)<=_FRAME_BYTES+4)
        data=C.create_string_buffer(raw);self.buffers.append(data);offset=0
        while offset<len(raw):
            self._live(request);count=_U32();self.buffers.append(count)
            self.api.call(self.api.k.WriteFile,handle.value,C.byref(data,offset),len(raw)-offset,C.byref(count),None,keep=(handle,data,count))
            _need(0<count.value<=len(raw)-offset);offset+=count.value

    def _read_exact(self,handle,size,request):
        _need(type(size) is int and 0<size<=_FRAME_BYTES)
        data=C.create_string_buffer(size);self.buffers.append(data);offset=0
        while offset<size:
            self._live(request);count=_U32();self.buffers.append(count)
            self.api.call(self.api.k.ReadFile,handle.value,C.byref(data,offset),size-offset,C.byref(count),None,keep=(handle,data,count))
            _need(0<count.value<=size-offset);offset+=count.value
        return bytes(data.raw)

    def _exchange(self,request):
        value={'v':1,'nonce':self.nonce,'seq':request.seq,'op':request.op,
               'body':{'cache_root':self.root} if request.seq==0 else {},
               'source_digest':self.source_digest,'deadline_ns':request.deadline}
        _message(value,self.nonce,self.source_digest)
        self._write(self.channels['request-write'],_frame(value),request)
        size=struct.unpack('<I',self._read_exact(self.channels['response-read'],4,request))[0]
        _need(0<size<=_FRAME_BYTES)
        reply=_message(_decode(self._read_exact(self.channels['response-read'],size,request)),self.nonce,self.source_digest,response=True)
        _need(reply['seq']==request.seq and reply['op']==request.op and reply['deadline_ns']==request.deadline)
        if 'error' in reply['body']:
            self.core_retired=reply['body']['core_retired'];raise OffloadAdmissionError()
        if request.seq==2:self.core_retired=True
        return reply['body']['state']

    def _retire_io(self,request):
        self._live(request);a=self.api
        _need(a.wait((self.process,),request.deadline)==0)
        code=_U32();accounting=_Accounting();self.buffers.extend((code,accounting))
        a.call(a.k.GetExitCodeProcess,self.process.value,C.byref(code),keep=(self.process,code));_need(code.value==0)
        a.call(a.k.QueryInformationJobObject,self.job.value,1,C.byref(accounting),C.sizeof(accounting),None,keep=(self.job,accounting))
        _need(accounting.active==0)
        for h in self.handles:
            if h not in (self.controller,self.start_event,self.request_event,self.completion_event) and not h.closed:
                self._live(request);a.close(h)

    def _controller_entry(self,_argument):
        # FFI must never unwind a Python exception across the CRT boundary.
        try:
            self.origin()
            a=self.api;self.controller_ident=get_ident()
            request=self.active
            _need(a.wait((self.start_event,),request.deadline)==0)
            self._live(request)
            _need(a.call(a.k.GetCurrentThreadId)==self.thread_id.value)
            while True:
                request=self.active;self._live(request);request.started=True
                if request.seq==0:self._launch(request)
                result=self._exchange(request)
                if request.seq==3:self._retire_io(request)
                self._live(request);request.result=result;request.returned=True;request.published=True
                a.call(a.k.SetEvent,self.completion_event.value,keep=(self.completion_event,))
                request.signal_ack=True
                _need(not self.uncertain and not self.stop_requested and not request.expired)
                if request.seq==3:
                    self.controller_finished=True;return 0
                # Idle has no operation deadline and no automatic child exit.
                value=a.idle_wait(request)
                _need(value==0)
        except BaseException:
            try:self._fence()
            except BaseException:
                self.uncertain=True;self.stop_requested=True
            return 9

    def _call(self,seq):
        self.origin()
        _need(self._state_lock.acquire(blocking=False))
        admission_started=False
        try:
            _need(not self.uncertain and not self.busy and self.active is None)
            next_state=_edge(self.state,seq)
            _need(len(self.requests)<4 and len(self._effect_exits)<4)
            admission_started=True
            request=_Request(self,seq);request.effect_token=object()
            self.requests.append(request)
            self._effect_exits[id(request)]=(request,request.effect_token,get_ident(),False)
            self.active=request;self.busy=True
        except BaseException as error:
            # Pure precondition denial does not poison a healthy owner. Once
            # metadata admission begins, an incomplete list/map/publication is
            # retained and fenced before any retry or native dispatch.
            if admission_started:self._fence()
            if isinstance(error,Exception):raise OffloadAdmissionError() from None
            raise
        finally:self._state_lock.release()
        exit_attempted=False
        def publish_exit():
            # Called only under the state gate. Retain a failed publication;
            # never retry it or let a second error replace the original one.
            nonlocal exit_attempted
            exit_attempted=True
            try:
                entry=self._effect_exits.get(id(request))
                _need(type(entry) is tuple and len(entry)==4 and entry[0] is request
                      and entry[1] is request.effect_token and entry[2]==get_ident()
                      and entry[3] is False)
                self._effect_exits[id(request)]=(*entry[:3],True)
            except BaseException:
                # Fence before releasing this gate: even the original idle
                # controller must not commit another healthy native intent.
                if not self.session_retired:
                    try:self._fence()
                    except BaseException:pass
                raise
        try:
            if seq==0:self._start(request)
            else:
                self._live(request)
                self.api.call(self.api.k.ResetEvent,self.completion_event.value,keep=(self.completion_event,))
                self.api.call(self.api.k.SetEvent,self.request_event.value,keep=(self.request_event,))
            _need(self.api.wait((self.completion_event,self.controller),request.deadline)==0)
            while not request.signal_ack:
                self._live(request)
                # Completion wakeup is not the dispatcher's native signal ACK.
                until=min(request.deadline,time.monotonic_ns()+50_000_000)
                observed=self.api.wait((self.controller,),until)
                _need(observed==258 or observed==0 and request.seq==3
                      and request.signal_ack and self.controller_finished)
            self._live(request)
            _need(request.started and request.returned and request.published and request.result==next_state)
            if seq==3:
                _need(self.api.wait((self.controller,),request.deadline)==0 and self.controller_finished)
                code=_U32();self.buffers.append(code)
                self.api.call(self.api.k.GetExitCodeThread,self.controller.value,C.byref(code),keep=(self.controller,code));_need(code.value==0)
                for h in (self.controller,self.start_event,self.request_event,self.completion_event):
                    self._live(request);self.api.close(h)
            with self._state_lock:
                self._live(request)
                if seq==3:
                    # Native exit and every original close have already ACKed.
                    # Later bookkeeping interruption cannot invent live work.
                    request.consumed=True;self.state=next_state;self.active=None;self.busy=False
                    self.session_retired=True
                    with _LOCK:_need(_OWNERS.pop(id(self)) is self)
                    publish_exit()
                else:
                    # Publish the effect frontier before allowing another call.
                    # No native work follows it; it does not assert caller exit.
                    publish_exit()
                    # Keep the exact idle dispatcher wait; only completed rows
                    # can be pruned while that known native wait is outstanding.
                    self.calls[:]=[c for c in self.calls if not c.acknowledged]
                    request.consumed=True;self.state=next_state;self.active=None;self.busy=False
            return None
        except BaseException as error:
            try:
                with self._state_lock:
                    if not self.session_retired:self._fence()
                    if not exit_attempted:publish_exit()
            except BaseException:
                # Keep the original failure. An interrupted entry/publication
                # cannot clear the still-active admission or its earlier fence.
                # An actually retired owner must never be fenced or resurrected.
                pass
            # No inline blocking terminate/readback/close/join or source reset.
            if isinstance(error,Exception):raise OffloadAdmissionError() from None
            raise

    def prepare(self):return self._call(0)
    def bind_read(self):return self._call(1)
    def retire_unused_read(self):return self._call(2)
    def finish(self):return self._call(3)

    def retire_failed(self):
        """One explicit owned-IO drain; never retry the failed operation."""
        _need(type(self) is _WindowsOffloadIoSession
              and getattr(self,'_WindowsOffloadIoSession__origin',None) is self)
        value=getattr(self,'terminal',None)
        if type(value) is _TerminalRetirement and value.has_final_proof():
            _need(value.owner is self)
            return value.release_known()
        self.origin()
        _need(self._state_lock.acquire(blocking=False))
        try:
            _need(self.terminal is None)
            frontier=_terminal_frontier(self)
            value=object.__new__(_TerminalRetirement)
            self.terminal=value  # Retain before metadata/startup can fail.
            _TerminalRetirement.__init__(value,self,frontier)
        finally:self._state_lock.release()
        return value.run()


def _known_handle(owner,handle):
    _need(type(handle) is _Handle and getattr(handle,'_Handle__origin',None) is handle
          and handle.owner is owner and handle.slot is handle._original_slot
          and type(handle.slot) is _PTR and type(handle._number) is int
          and 0<handle._number<C.c_void_p(-1).value and handle.slot.value==handle._number)
    generation=owner._handle_bindings.get(id(handle))
    _need(type(generation) is tuple and len(generation)==3 and generation[0] is handle
          and generation[1] is handle.slot and generation[2]==handle._number)
    if handle.closed:
        _need(handle.close_started and type(handle.close_record) is _Call)
        row=handle.close_record;value=owner.ledger.settled(row,owner.api)
        _need(row.acknowledged and value[0][0] is owner.api.k.CloseHandle
              and value[0][1]==(handle._number,) and value[0][3][0] is handle)
    else:_need(not handle.close_started and handle.close_record is None)
    return generation


def _terminal_frontier(owner):
    """Pure preadmission. Unknown construction or late admission stays pinned."""
    owner.origin();a=owner.api
    _need(owner.uncertain and owner.stop_requested and not owner.session_retired
          and owner.launch_complete and owner.attribute_started and owner.attribute_retired
          and type(a) is _Native and type(owner.controller_ident) is int
          and len(owner.handles)==13 and len({id(h) for h in owner.handles})==13
          and len(owner._handle_bindings)==13)
    a.origin()
    generations=tuple(_known_handle(owner,h) for h in owner.handles)
    for h in (owner.controller,owner.process,owner.job,owner.request_event):
        _need(any(h is old for old in owner.handles) and not h.closed)
    _need(owner.process._number==owner.process_info.process
          and owner.primary_thread._number==owner.process_info.thread)
    _need(len(owner._effect_exits)==len(owner.requests) and 1<=len(owner.requests)<=4)
    exits=[]
    for request in owner.requests:
        request.origin(owner);entry=owner._effect_exits.get(id(request))
        _need(type(entry) is tuple and len(entry)==4 and entry[0] is request
              and entry[1] is request.effect_token and entry[1] is not None
              and type(entry[2]) is int and entry[3] is True)
        exits.append(entry)
    pending=[];ledger=owner.ledger
    with ledger.lock:
        _need(0<=ledger.used<=_MAX_CALLS and 0<=ledger.terminal_used<=_TERMINAL_CALLS
              and _MAX_CALLS-ledger.used+_TERMINAL_CALLS-ledger.terminal_used>=48)
        rows=tuple(ledger.normal[:ledger.used])+tuple(ledger.terminal[:ledger.terminal_used])
        for row in rows:
            ledger.member(row);binding=ledger.bindings[row.index]
            _need(row.committed and type(binding) is tuple and len(binding)==10
                  and binding[4] is a and row.payload is binding and not row.integrity_lost
                  and row.function is binding[0] and row.args is binding[1]
                  and row.valid is binding[2] and row.keep is binding[3])
            if row.returned or row.completion is not None or ledger.completions[row.index] is not None:
                ledger.settled(row,a);continue
            _need(not row.acknowledged and row.result is None and row.error is None
                  and binding[9]==owner.controller_ident
                  and (row.native_thread==binding[9] if row.started else row.native_thread is None))
            request=binding[5];request.origin(owner)
            if binding[0] is a.k.WaitForSingleObject:
                h=owner.request_event
                _need(binding[6] in ('idle-live','idle-consumed') and request.idle_intent is row
                      and binding[1]==(h._number,0xffffffff) and binding[3]==(request,h,h.slot))
                kind='idle'
            else:
                _need(binding[6]=='operation' and len(binding[3])==3)
                h=binding[3][0]
                _need((binding[0] is a.k.ReadFile and h is owner.channels['response-read'])
                      or (binding[0] is a.k.WriteFile and h is owner.channels['request-write']))
                _need(binding[1][0]==h._number and not h.closed);kind='io'
            pending.append((row,kind))
        _need(len(pending)<=1)
    return (tuple(owner.handles),generations,rows,tuple(exits),tuple(pending))


class _TerminalRetirement:
    """Closed one-generation retirement of the original private IO session."""
    def __init__(self,owner,frontier):
        self.__origin=self;self.initialized=False;self.owner=owner;self.api=owner.api
        self.original,self.generations,self.original_rows,self.exits,self.pending=frontier
        self.deadline=time.monotonic_ns()+_BUDGET_NS
        self._original_deadline=self.deadline
        self.caller_ident=get_ident();self.reaper_ident=None
        self._caller_ident=self.caller_ident
        self.failed=self.body_done=False;self.proof=self._canonical_proof=None
        self.used={};self.calls=[];self.new_generations={}
        self.closed={id(h) for h in self.original if h.closed}
        self.start=_Handle(owner,'retirement-start');self.reaper=_Handle(owner,'retirement-thread')
        owner.handles.extend((self.start,self.reaper))
        self.thread_id=_U32();self.thread_output=C.byref(self.thread_id)
        self.controller_code=_U32(259);self.process_code=_U32(259);self.reaper_code=_U32(259)
        self.accounting=_Accounting();self.accounting.active=self.accounting.total=0xffffffff
        self.query_outputs=(self.controller_code,self.process_code,self.reaper_code,self.accounting)
        self._canonical_outputs=self.query_outputs
        names=('CreateEventW','WaitForMultipleObjects','WaitForSingleObject','ReadFile','WriteFile',
               'SetEvent','GetCurrentThreadId','CancelSynchronousIo',
               'TerminateJobObject','GetExitCodeThread','GetExitCodeProcess','QueryInformationJobObject','CloseHandle')
        self.native_functions=tuple((name,getattr(self.api.k,name)) for name in names)
        self._canonical_functions=self.native_functions
        self.begin_function=self.api.begin;self.callback_factory=self.api.thread_callback
        self.callback=self.api.thread_callback(self._entry)
        self._canonical_callback=self.callback
        owner.buffers.extend((self,self.thread_id,self.thread_output,self.controller_code,self.process_code,
                              self.reaper_code,self.accounting,self.callback,self.start,self.reaper))
        self.initialized=True

    def origin(self):
        _need(type(self) is _TerminalRetirement and getattr(self,'_TerminalRetirement__origin',None) is self
              and self.initialized and self.owner.terminal is self and self.owner.api is self.api)
        self.owner.origin();self.api.origin()
        _need(self.deadline==self._original_deadline and self.caller_ident==self._caller_ident
              and self.native_functions is self._canonical_functions
              and self.callback is self._canonical_callback and self.api.begin is self.begin_function
              and self.api.thread_callback is self.callback_factory
              and self.query_outputs is self._canonical_outputs
              and self.controller_code is self.query_outputs[0] and self.process_code is self.query_outputs[1]
              and self.reaper_code is self.query_outputs[2] and self.accounting is self.query_outputs[3])
        for name,function in self.native_functions:_need(getattr(self.api.k,name) is function)

    def _snapshot(self):
        owner=self.owner
        _need(tuple(owner.handles)==self.original+(self.start,self.reaper)
              and owner.uncertain and owner.stop_requested and not owner.session_retired)
        for generation in self.generations:
            h,slot,number=generation
            _need(owner._handle_bindings.get(id(h)) is generation and h.slot is slot
                  and h._original_slot is slot and h.slot.value==number and h._number==number
                  and h.closed is (id(h) in self.closed))
            if h.closed:_known_handle(owner,h)
            elif h.close_started:
                # The caller can begin its reaper-exit wait while the reaper
                # owns an original close in flight. Keep that exact intent;
                # never interpret it as a close ACK or reuse this handle.
                candidates=[row for label,row in self.used.items() if label.startswith('close-original-')
                            and row.keep and row.keep[0] is h]
                _need(len(candidates)==1 and h.close_record is None)
                row=candidates[0];owner.ledger.member(row)
                binding=owner.ledger.bindings[row.index]
                _need(row.committed and type(binding) is tuple and row.payload is binding
                      and binding[4] is self.api and binding[5] is self
                      and binding[0] is self.api.k.CloseHandle and binding[1]==(number,)
                      and binding[3][0] is h and not row.integrity_lost)
            else:_need(h.close_record is None)
        expected={id(h) for h in self.original}
        for h in (self.start,self.reaper):
            generation=self.new_generations.get(id(h))
            if generation is None:
                _need(h._number is None and h.slot is h._original_slot and h.slot.value is None
                      and not h.close_started and not h.closed and h.close_record is None)
            else:
                _need(owner._handle_bindings.get(id(h)) is generation)
                _known_handle(owner,h);expected.add(id(h))
        _need(set(owner._handle_bindings)==expected)
        for entry in self.exits:_need(owner._effect_exits.get(id(entry[0])) is entry)

    def _action(self,label):
        a=self.api;owner=self.owner
        boolean=lambda v:type(v) is int and v!=0
        closing=None;wait=False
        if label=='create-start':
            spec=(a.k.CreateEventW,(None,1,0,None),lambda v:type(v) is int and 0<v<C.c_void_p(-1).value,(self.start,))
        elif label=='begin':
            spec=(a.begin,(None,0,self.callback,None,0,self.thread_output),
                  lambda v:type(v) is int and 0<v<C.c_void_p(-1).value,(self.callback,self.thread_id,self.reaper))
        elif label in ('wait-start','wait-controller','wait-process','wait-reaper'):
            h={'wait-start':self.start,'wait-controller':owner.controller,'wait-process':owner.process,'wait-reaper':self.reaper}[label]
            values=(_PTR*1)(h.value);owner.buffers.append(values)
            spec=(a.k.WaitForMultipleObjects,(1,values,0,0),lambda v:type(v) is int and v==0,(h,values));wait=True
        elif label in ('signal-start','wake-idle'):
            h=self.start if label=='signal-start' else owner.request_event
            spec=(a.k.SetEvent,(h.value,),boolean,(h,))
        elif label=='thread-id':
            spec=(a.k.GetCurrentThreadId,(),lambda v:type(v) is int and v==self.thread_id.value,(self.thread_id,))
        elif label=='cancel-io':
            def cancel_result(v):
                return type(v) is int and (v!=0 or self.owner.ledger.settled(self.used[label],a)[2]==1168)
            spec=(a.k.CancelSynchronousIo,(owner.controller.value,),cancel_result,(owner.controller,))
        elif label=='terminate-job':
            spec=(a.k.TerminateJobObject,(owner.job.value,9),boolean,(owner.job,))
        elif label in ('controller-code','process-code','reaper-code'):
            h,code,fn={'controller-code':(owner.controller,self.query_outputs[0],a.k.GetExitCodeThread),
                       'process-code':(owner.process,self.query_outputs[1],a.k.GetExitCodeProcess),
                       'reaper-code':(self.reaper,self.query_outputs[2],a.k.GetExitCodeThread)}[label]
            spec=(fn,(h.value,C.byref(code)),boolean,(h,code))
        elif label=='job-empty':
            accounting=self.query_outputs[3]
            spec=(a.k.QueryInformationJobObject,(owner.job.value,1,C.byref(accounting),C.sizeof(accounting),None),
                  boolean,(owner.job,accounting))
        elif label in ('close-reaper','close-start') or label.startswith('close-original-'):
            if label=='close-reaper':h=self.reaper
            elif label=='close-start':h=self.start
            else:
                suffix=label.removeprefix('close-original-')
                _need(suffix.isascii() and suffix.isdecimal() and str(int(suffix))==suffix and 0<=int(suffix)<len(self.original))
                h=self.original[int(suffix)]
            spec=(a.k.CloseHandle,(h.value,),boolean,(h,h.slot));closing=h
        else:raise OffloadAdmissionError()
        return spec,closing,wait

    def issue(self,label):
        self.origin();owner=self.owner
        with owner._state_lock:
            _need(not self.failed and self.proof is None and type(label) is str
                  and 1<=len(label)<=64 and label not in self.used and len(self.used)<48)
            caller=label in ('create-start','begin','signal-start','wait-reaper','reaper-code','close-reaper','close-start')
            _need(get_ident()==(self.caller_ident if caller else self.reaper_ident))
            self._snapshot();_remaining(self.deadline)
            (function,args,valid,keep),closing,wait=self._action(label)
            output_index={'controller-code':0,'process-code':1,'reaper-code':2,'job-empty':3}.get(label)
            output=None if output_index is None else self.query_outputs[output_index]
            if closing is not None:closing.close_started=True
            row=owner.ledger.reserve(self.calls,function,args,valid,keep,True)
            self.used[label]=row
            owner.ledger.commit(row,self.api,self,'retirement',self.deadline if wait else None)
        # Retain committed exact intent over foreign execution, never a lock.
        result=self.api._perform(row)
        if output is not None:
            with owner._state_lock:
                self.origin()
                _need(output is self.query_outputs[output_index] and any(item is output for item in row.keep)
                      and row.acknowledged)
                owner.ledger.settled(row,self.api)
                if output_index==3:
                    _need(type(output) is _Accounting);scalars=(output.active,output.total)
                else:
                    _need(type(output) is _U32);scalars=(output.value,)
                _need(all(type(value) is int and 0<=value<2**32 for value in scalars))
                # Return observations from the exact native row/output object,
                # never a later reread of replaceable instance attributes.
                return (label,row,output,scalars)
        if closing is not None:
            with owner._state_lock:
                _need(row.acknowledged and closing.slot is closing._original_slot
                      and closing.slot.value==closing._number and not closing.closed and closing.close_started)
                owner.ledger.settled(row,self.api)
                closing.close_record=row;closing.closed=True;self.closed.add(id(closing))
        return result

    def _bind(self,h,number):
        with self.owner._state_lock:
            self.origin();_remaining(self.deadline)
            _need(not self.failed and h in (self.start,self.reaper) and h._number is None)
            h.slot.value=number;h.acknowledge()
            self.new_generations[id(h)]=self.owner._handle_bindings[id(h)]

    def _entry(self,_argument):
        admitted=False
        try:
            self.origin()
            with self.owner._state_lock:
                _need(self.reaper_ident is None and not self.failed and self.proof is None)
                self.reaper_ident=get_ident();admitted=True
            self.issue('wait-start');self.issue('thread-id')
            if self.pending and self.pending[0][1]=='io':self.issue('cancel-io')
            if self.pending and self.pending[0][1]=='idle':self.issue('wake-idle')
            self.issue('terminate-job')
            self.issue('wait-controller');controller=self.issue('controller-code')[3][0]
            _need(controller==9 or controller==0 and self.owner.controller_finished)
            self.issue('wait-process');process=self.issue('process-code')[3][0];_need(process!=259)
            accounting=self.issue('job-empty')[3];_need(accounting==(0,1))
            for row in self.original_rows:self.owner.ledger.settled(row,self.api)
            for i,h in enumerate(self.original):
                if not h.closed:self.issue('close-original-'+str(i))
            _need(all(h.closed for h in self.original))
            self.body_done=True;return 0
        except BaseException:
            # Copied/foreign callbacks cannot poison the canonical attempt.
            try:
                owner=getattr(self,'owner',None)
                if (admitted and type(self) is _TerminalRetirement and getattr(self,'_TerminalRetirement__origin',None) is self
                        and type(owner) is _WindowsOffloadIoSession and getattr(owner,'terminal',None) is self):
                    self.failed=True;owner._fence()
            except BaseException:pass
            return 9

    def has_final_proof(self):
        return (type(self) is _TerminalRetirement and getattr(self,'_TerminalRetirement__origin',None) is self
                and getattr(self,'proof',None) is not None
                and self.proof is getattr(self,'_canonical_proof',None))

    def release_known(self):
        # Pure idempotent bookkeeping only. No old/new Native dispatch or quota
        # reset follows an interruption after the complete final proof.
        _need(self.has_final_proof() and self.owner.terminal is self
              and getattr(self.owner,'_WindowsOffloadIoSession__origin',None) is self.owner
              and self.proof[0] is self and self.proof[1] is self.owner)
        owner=self.owner
        with owner._state_lock:
            owner.terminal_retired=owner.session_retired=True
            owner.state='failed-retired';owner.active=None;owner.busy=False
            owner.uncertain=False;owner.stop_requested=True
            with _LOCK:
                if _OWNERS.get(id(owner)) is owner:_need(_OWNERS.pop(id(owner)) is owner)
        return None

    def run(self):
        self.origin();_need(get_ident()==self.caller_ident)
        try:
            self._bind(self.start,self.issue('create-start'))
            self._bind(self.reaper,self.issue('begin'))
            _need(0<self.thread_id.value<2**32)
            self.issue('signal-start');self.issue('wait-reaper');reaper=self.issue('reaper-code')[3][0]
            _need(self.body_done and not self.failed and reaper==0)
            self.issue('close-reaper');self.issue('close-start')
            with self.owner._state_lock:
                self._snapshot();_remaining(self.deadline)
                _need(all(h.closed for h in self.owner.handles))
                for row in self.original_rows:self.owner.ledger.settled(row,self.api)
                for row in self.calls:
                    self.owner.ledger.settled(row,self.api);_need(row.acknowledged)
                _remaining(self.deadline)
                proof=(self,self.owner,self.original_rows,tuple(self.calls),tuple(self.owner.handles))
                self.proof=proof;self._canonical_proof=proof
            return self.release_known()
        except BaseException as error:
            if not self.has_final_proof():
                self.failed=True
                try:self.owner._fence()
                except BaseException:pass
            if isinstance(error,Exception):raise OffloadAdmissionError() from None
            raise


def _managed_read_session():
    """Trusted private invocation only. Capturing config performs no IO."""
    return _WindowsOffloadIoSession(_configured_root())
