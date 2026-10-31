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
    def acknowledge(self):
        _need(self._number is None and self.slot is self._original_slot
              and type(self.slot.value) is int and 0<self.slot.value<C.c_void_p(-1).value)
        self._number=self.slot.value
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
            binding=(row.function,row.args,row.valid,row.keep,api,request,kind,tick,tuple(facts))
            self.bindings[row.index]=binding;row.payload=binding;row.committed=True

    def claim(self,row,api):
        with self.lock:
            self.member(row);binding=self.bindings[row.index]
            _need(type(binding) is tuple and binding[4] is api and api.owner is self.owner
                  and row.committed and not row.started and not row.integrity_lost)
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
            row.started=True
            return binding


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

    def call(self, function, *args, valid=lambda v:type(v) is int and v!=0, keep=(), terminal=False, _wait_deadline=None):
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
        return self._perform(row)

    def _perform(self,row):
        self.origin();owner=self.owner
        try:binding=owner.ledger.claim(row,self)
        except _IntentChanged:
            if type(owner) is _WindowsOffloadIoSession:owner._fence()
            else:owner.uncertain=True
            raise
        try:
            row.result=binding[0](*binding[1]);row.returned=True
            row.error=C.get_last_error()
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
        self.call(self.k.CloseHandle,value,keep=(h,h.slot),terminal=True)
        h.closed=True

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
        self.api=None;self.buffers=[];self.calls=[];self.handles=[];self.ledger=_Ledger(self)
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
        try:
            _need(not self.uncertain and not self.busy and self.active is None)
            next_state=_edge(self.state,seq)
            _need(len(self.requests)<4)
            request=_Request(self,seq);self.requests.append(request);self.active=request;self.busy=True
        finally:self._state_lock.release()
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
                self._live(request);request.consumed=True;self.state=next_state;self.active=None;self.busy=False
                if seq==3:
                    # Native exit and every original close have already ACKed.
                    # Later bookkeeping interruption cannot invent live work.
                    self.session_retired=True
                    with _LOCK:_need(_OWNERS.pop(id(self)) is self)
                else:
                    # Keep the exact idle dispatcher wait; only completed rows
                    # can be pruned while that known native wait is outstanding.
                    self.calls[:]=[c for c in self.calls if not c.acknowledged]
            return None
        except BaseException as error:
            if not self.session_retired:
                self._fence()
            # No inline blocking terminate/readback/close/join or source reset.
            if isinstance(error,Exception):raise OffloadAdmissionError() from None
            raise

    def prepare(self):return self._call(0)
    def bind_read(self):return self._call(1)
    def retire_unused_read(self):return self._call(2)
    def finish(self):return self._call(3)


def _managed_read_session():
    """Trusted private invocation only. Capturing config performs no IO."""
    return _WindowsOffloadIoSession(_configured_root())
