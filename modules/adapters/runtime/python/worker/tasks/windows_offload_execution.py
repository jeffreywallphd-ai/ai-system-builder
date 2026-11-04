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
_SOURCE_NAMES = ('local_model_offload.py', 'windows_offload_native_session.py', 'offload_recovery.py', 'windows_offload_core.py',
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


from .windows_offload_native_session import (
    _BasicLimits, _IoCounters, _ExtendedLimits, _Security,
    _Startup, _StartupEx, _Process, _Accounting, _NativePrimitives, _SessionMechanics)


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


class _NativeOutputs:
    """Prebound existing IO ABI buffers; copies are facts, never release authority."""
    __slots__=('__origin','__args','__keep','__outputs','__read','__input','__before','__verify',
               '__inout','__inout_before','__inout_after')
    def __init__(self,api,function,args,keep):
        _need(type(self)is _NativeOutputs and not hasattr(self,'_NativeOutputs__origin'))
        self.__origin,self.__args,self.__keep=self,args,keep
        self.__outputs=None;self.__read=lambda:();self.__input=lambda:();self.__verify=lambda:None
        self.__inout=lambda:();self.__inout_after=None
        name=api._output_function_name(function)
        def retained(value):_need(any(item is value for item in keep));return value
        def ref(value,kind):
            _need(type(value)is type(C.byref(_U32()))and type(value._obj)is kind)
            return retained(value._obj)
        def wide(value):
            _need(isinstance(value,C.Array)and type(value)._type_ is C.c_wchar and 1<=len(value)<=32768)
            return retained(value)
        def cell(value,kind):
            output=ref(value,kind);self.__read=lambda:(output.value,)
        if name=='CreateProcessW':
            _need(len(args)==10)
            p=ref(args[9],_Process);startup=ref(args[8],_StartupEx)
            command,environment=wide(args[1]),wide(args[6])
            self.__read=lambda:(p.process,p.thread,p.pid,p.tid)
            self.__input=lambda:(bytes(startup),bytes(environment))
            # CreateProcessW explicitly permits modification of lpCommandLine.
            # Preserve its pre-call input and actual post-call bytes separately.
            self.__inout=lambda:bytes(command)
            attributes=api.owner.attributes
            _need(isinstance(attributes,C.Array)and type(attributes)._type_ is C.c_char
                  and startup.attributes==C.addressof(attributes))
            api._original_ledger()._assert_attribute_input(attributes,api)
            fixed=self.__input
            self.__input=lambda:(fixed(),bytes(attributes))
            process,primary=keep[-2:]
            _need(type(process)is type(primary)is _Handle)
            process_slot,primary_slot=process.slot,primary.slot
            def verify():
                _need(api.owner.process_info is p and api.owner.process is process
                      and api.owner.primary_thread is primary and api.owner.attributes is attributes
                      and process.slot is process._original_slot is process_slot
                      and primary.slot is primary._original_slot is primary_slot)
            self.__verify=verify
        elif name=='CreatePipe':
            _need(len(args)==4 and len(keep)==3 and type(keep[0])is _Handle and type(keep[1])is _Handle)
            first,second=keep[:2];left,right=first.slot,second.slot
            _need(type(left)is type(right)is _PTR and args[0]._obj is left and args[1]._obj is right)
            security=ref(args[2],_Security)
            self.__read=lambda:(left.value,right.value)
            self.__input=lambda:bytes(security)
            def verify():
                _need(first.slot is first._original_slot is left and second.slot is second._original_slot is right
                      and args[0]._obj is left and args[1]._obj is right)
            self.__verify=verify
        elif name=='_beginthreadex':
            _need(len(args)==6);cell(args[5],_U32)
            _need(len(keep)==3 and type(keep[2])is _Handle)
            callback,thread_id,handle=keep
            def verify():
                if handle.name=='controller-thread':
                    _need(api.owner.controller is handle and api.owner.callback is callback
                          and api.owner.thread_id is thread_id)
            self.__verify=verify
        elif name in('GetSystemDirectoryW','GetWindowsDirectoryW','GetModuleFileNameW'):
            at=1 if name=='GetModuleFileNameW'else 0
            _need(len(args)==at+2);text=wide(args[at]);capacity=args[at+1]
            _need(type(capacity)is int and capacity==len(text))
            self.__read=lambda:(bytes(text),)
        elif name=='QueryFullProcessImageNameW':
            _need(len(args)==4);text=wide(args[2]);size=ref(args[3],_U32);capacity=size.value
            _need(0<capacity<=len(text))
            self.__read=lambda:(bytes(text),size.value)
        elif name=='IsProcessInJob':
            _need(len(args)==3);cell(args[2],_I32)
        elif name in('GetHandleInformation','GetExitCodeThread','GetExitCodeProcess'):
            _need(len(args)==2);cell(args[1],_U32)
        elif name=='QueryInformationJobObject':
            _need(len(args)==5 and type(args[1])is int and args[1]in(1,9))
            kind=_Accounting if args[1]==1 else _ExtendedLimits
            output=ref(args[2],kind);_need(args[3]==C.sizeof(output)and args[4]is None)
            self.__read=lambda:(bytes(output),)
        elif name=='SetInformationJobObject':
            _need(len(args)==4 and args[1]==9)
            value=ref(args[2],_ExtendedLimits);_need(args[3]==C.sizeof(value))
            self.__input=lambda:bytes(value)
        elif name=='InitializeProcThreadAttributeList':
            _need(len(args)==4 and args[1:3]==(2,0))
            size=ref(args[3],C.c_size_t);buffer=args[0]
            if buffer is not None:
                _need(isinstance(buffer,C.Array)and type(buffer)._type_ is C.c_char)
                retained(buffer);_need(0<size.value<=C.sizeof(buffer)<=65536)
                self.__inout=lambda:bytes(buffer)
            self.__read=lambda:(size.value,)
            def verify():
                if self.__outputs is not None:
                    _need(0<size.value<=65536 and(buffer is None or size.value<=C.sizeof(buffer)))
            self.__verify=verify
        elif name=='UpdateProcThreadAttribute':
            _need(len(args)==7 and args[1]==0 and args[2]in(131085,131074))
            buffer,values=args[0],args[3]
            _need(isinstance(buffer,C.Array)and type(buffer)._type_ is C.c_char
                  and isinstance(values,C.Array)and type(values)._type_ is _PTR
                  and len(values)==(1 if args[2]==131085 else 4)and args[4]==C.sizeof(values)
                  and args[5]is args[6]is None)
            retained(buffer);retained(values)
            self.__input=lambda:tuple(values)
            api._original_ledger()._assert_attribute_input(buffer,api)
            self.__inout=lambda:bytes(buffer)
        elif name=='DeleteProcThreadAttributeList':
            _need(len(args)==1 and isinstance(args[0],C.Array)and type(args[0])._type_ is C.c_char)
            buffer=retained(args[0]);api._original_ledger()._assert_attribute_input(buffer,api)
            self.__inout=lambda:bytes(buffer)
        elif name in('ReadFile','WriteFile'):
            _need(len(args)==5 and len(keep)==3 and type(keep[0])is _Handle
                  and isinstance(keep[1],C.Array)and type(keep[1])._type_ is C.c_char)
            data=keep[1];count=ref(args[3],_U32)
            _need(type(args[1])is type(C.byref(_U32()))and args[1]._obj is data
                  and type(args[2])is int and 0<args[2]<=_FRAME_BYTES+4 and args[4]is None)
            address=C.cast(args[1],_PTR).value
            _need(C.addressof(data)<=address and address+args[2]<=C.addressof(data)+C.sizeof(data))
            self.__read=(lambda:(bytes(data),count.value))if name=='ReadFile'else(lambda:(count.value,))
            if name=='WriteFile':self.__input=lambda:bytes(data)
        elif name=='CreateTimerQueueTimer':
            _need(len(args)==7 and len(keep)==5 and type(keep[1])is _PTR and args[0]._obj is keep[1])
            timer,slot=keep[:2];self.__read=lambda:(slot.value,)
            def verify():
                module=sys.modules.get(__package__+'.windows_offload_execution_child')
                _need(module is not None and type(timer)is module._Timer and timer.child is api.owner
                      and timer.slot is timer.original_slot is slot and timer.callback is keep[2])
            self.__verify=verify
        elif name=='WaitForMultipleObjects':
            _need(len(args)==4 and type(args[0])is int and 1<=args[0]<=3
                  and type(args[1])is _PTR*args[0]and args[2]==0
                  and type(args[3])is int and 0<args[3]<=120000)
            values=args[1];retained(values);self.__input=lambda:tuple(values)
        self.__before=self.__input()
        self.__inout_before=self.__inout()
    def __repr__(self):return '<original IO typed outputs>'
    def __copy__(self):raise OffloadAdmissionError()
    def __deepcopy__(self,memo):raise OffloadAdmissionError()
    def __reduce_ex__(self,protocol):raise OffloadAdmissionError()
    @property
    def outputs(self):return self.__outputs
    @property
    def inout(self):return self.__inout_after
    def capture(self):
        _need(self.__origin is self and self.__outputs is None)
        self.__outputs=self.__read()  # Pure original-buffer copy before any observer/getter.
        self.__inout_after=self.__inout()
    def verify(self):
        _need(self.__origin is self and self.__input()==self.__before)
        self.__verify()
        if self.__outputs is not None:
            _need(self.__read()==self.__outputs and self.__inout()==self.__inout_after)
        else:_need(self.__inout()==self.__inout_before)


class _NativeReturn:
    """Original scalar-call custody, independent of mutable row observations."""
    __slots__=('__origin','__ledger','__row','__api','__binding','__index','__reader',
               '__started','__value','__error','__value_known','__error_returned',
               '__error_known','__acknowledged','__completion','__outputs')
    def __init__(self,ledger,row,api,binding,index):
        _need(type(self)is _NativeReturn and not hasattr(self,'_NativeReturn__origin'))
        self.__origin=self
        self.__ledger,self.__row,self.__api,self.__binding,self.__index=ledger,row,api,binding,index
        bootstrap=getattr(api,'_Native__bootstrap',None)
        self.__reader=bootstrap.error_reader if bootstrap is not None else getattr(C,'get_last_error',None)
        self.__outputs=_NativeOutputs(api,binding[0],binding[1],binding[3])
        self.__started=self.__value_known=self.__error_returned=False
        self.__error_known=self.__acknowledged=False
        self.__value=self.__error=None
        self.__completion=None

    def __repr__(self):return '<original native return>'
    def __copy__(self):raise OffloadAdmissionError()
    def __deepcopy__(self,memo):raise OffloadAdmissionError()
    def __reduce_ex__(self,protocol):raise OffloadAdmissionError()
    @property
    def value(self):return self.__value
    @property
    def error(self):return self.__error
    @property
    def value_known(self):return self.__value_known
    @property
    def error_returned(self):return self.__error_returned
    @property
    def error_known(self):return self.__error_known
    @property
    def acknowledged(self):return self.__acknowledged
    @property
    def completion(self):return self.__completion
    @property
    def outputs(self):return self.__outputs.outputs
    @property
    def inout(self):return self.__outputs.inout

    def identity(self,ledger):
        _need(type(self)is _NativeReturn and self.__origin is self and self.__ledger is ledger)
        return self.__row,self.__api,self.__binding,self.__index

    def invoke(self):
        _need(not self.__started and callable(self.__reader))
        self.__ledger._assert_return_dispatch(self)
        self.__outputs.verify()
        self.__started=True
        self.__value=self.__binding[0](*self.__binding[1])
        self.__value_known=True  # No reader, observer or type check before this.
        self.__outputs.capture()
        self.__error=self.__reader()
        self.__error_returned=True
        _need(type(self.__error)is int and 0<=self.__error<2**32)
        self.__error_known=True
        self.__outputs.verify()
        return self.__value

    def acknowledge(self,ledger):
        self.identity(ledger)
        _need(self.__started and self.__value_known and self.__error_known
              and self.__completion is not None and not self.__acknowledged)
        self.__outputs.verify()
        self.__acknowledged=True

    def publish_completion(self,ledger,value):
        self.identity(ledger)
        _need(self.__started and self.__value_known and self.__error_known and self.__completion is None
              and type(value)is tuple and len(value)==4 and value[0]is self.__binding
              and value[1]is self.__value and value[2]is self.__error and value[3]==self.__binding[9])
        self.__completion=value


class _BootstrapLibraryCall:
    """One fixed loader entry in an original physical row; no unload authority."""
    __slots__=('__origin','__construction','__slot','__row','__loader','__getter',
               '__target','__kwargs','__started','__value','__handle','__error',
               '__returned','__error_returned','__error_known','__acknowledged')
    def __init__(self,construction,slot,row,loader,getter,target,kwargs):
        _need(type(self)is _BootstrapLibraryCall and not hasattr(self,'_BootstrapLibraryCall__origin'))
        self.__origin,self.__construction,self.__slot,self.__row=self,construction,slot,row
        self.__loader,self.__getter,self.__target,self.__kwargs=loader,getter,target,kwargs
        self.__started=self.__returned=self.__error_returned=self.__error_known=self.__acknowledged=False
        self.__value=self.__handle=self.__error=None
    def __repr__(self):return '<original IO loader outcome>'
    def __copy__(self):raise OffloadAdmissionError()
    def __deepcopy__(self,memo):raise OffloadAdmissionError()
    def __reduce_ex__(self,protocol):raise OffloadAdmissionError()
    @property
    def value(self):return self.__value
    @property
    def returned(self):return self.__returned
    @property
    def acknowledged(self):return self.__acknowledged
    def invoke(self):
        _need(self.__origin is self and not self.__started and callable(self.__loader)and callable(self.__getter))
        self.__construction._assert_loader(self,self.__slot,self.__row)
        self.__started=True
        self.__value=self.__loader(self.__target,**self.__kwargs);self.__returned=True
        _need(type(self.__value)is self.__loader)
        self.__handle=self.__value._handle  # Original actual library before reader/aliases.
        self.__error=self.__getter();self.__error_returned=True
        _need(type(self.__error)is int and type(self.__handle)is int and self.__handle>0)
        self.__error_known=True
        self.__construction._assert_loader(self,self.__slot,self.__row)
        _need(self.__value._handle==self.__handle and self.__value._name==self.__target)
        self.__acknowledged=True
        return self.__value
    def assert_known(self):
        _need(self.__origin is self and self.__returned and self.__error_known and self.__acknowledged
              and self.__value._handle==self.__handle and self.__value._name==self.__target)


class _BootstrapCustody:
    """Concrete constructor producer, consumed by the original IO API only."""
    __slots__=('__origin','__api','__owner','__ledger','__custody','__thread',
               '__loaders','__getters','__rows','__calls','__libraries',
               '__published','__metadata','__next','__busy','__failed','__complete',
               '__request','__deadline','__child_bootstrap')
    def __init__(self,api,ledger):
        _need(type(self)is _BootstrapCustody and not hasattr(self,'_BootstrapCustody__origin')
              and type(api)is _Native and api._Native__bootstrap is None)
        self.__origin,self.__api,self.__owner,self.__ledger=self,api,api.owner,ledger
        self.__custody=self.__owner._Native__custody;self.__thread=get_ident()
        self.__request=self.__child_bootstrap=None
        if type(self.__owner)is _WindowsOffloadIoSession:
            self.__request=self.__owner.active
            _need(type(self.__request)is _Request and self.__request.seq==0)
            self.__request.origin(self.__owner);self.__deadline=self.__request.deadline
        else:
            module=sys.modules.get(__package__+'.windows_offload_execution_child')
            _need(module is not None and module._CHILD is self.__owner)
            boot=module._BOOTSTRAP
            _need(type(boot)is tuple and len(boot)==5 and boot[0]==self.__owner.nonce
                  and boot[3]is self.__owner.hashes and boot[4]is self.__owner.runtime)
            self.__child_bootstrap=boot;self.__deadline=boot[2]
        _remaining(self.__deadline)
        self.__loaders=(getattr(C,'WinDLL',None),C.CDLL)
        self.__getters=(getattr(C,'get_last_error',None),C.get_errno)
        _need(all(callable(v)for v in self.__loaders+self.__getters))
        self.__calls=[None,None];self.__libraries=[None,None];self.__published=[False,False]
        self.__metadata=[];self.__next=0;self.__busy=self.__failed=self.__complete=False
        api._Native__bootstrap=self  # Retain partial reservation before any effect.
        self.__rows=ledger._register_bootstrap(self,api)
    def __repr__(self):return '<original IO bootstrap custody>'
    def __copy__(self):raise OffloadAdmissionError()
    def __deepcopy__(self,memo):raise OffloadAdmissionError()
    def __reduce_ex__(self,protocol):raise OffloadAdmissionError()
    @property
    def error_reader(self):return self.__getters[0]
    def fail(self):self.__failed=True
    def _origin(self):
        a,o=self.__api,self.__owner
        _need(self.__origin is self and type(a)is _Native and a._Native__bootstrap is self
              and a.owner is o and o.api is a and o.ledger is self.__ledger
              and o._Native__custody is self.__custody and self.__custody==(o,a,self.__ledger))
        self.__ledger._original_storage()
    def assert_api(self):
        self._origin();_need(not self.__failed)
        for i,name in enumerate(('k','crt')):
            if self.__published[i]:
                _need(getattr(self.__api,name,None)is self.__libraries[i]);self.__calls[i].assert_known()
        for name,function,arguments,types,result in self.__metadata:
            library=self.__libraries[1]if name=='_beginthreadex'else self.__libraries[0]
            _need(getattr(library,name)is function and function.argtypes is arguments
                  and type(arguments)is list and len(arguments)==len(types)
                  and all(a is b for a,b in zip(arguments,types))
                  and function.restype is result and getattr(function,'errcheck',None)is None)
    def _assert_loader(self,call,slot,row):
        self.assert_api()
        if self.__request is not None:
            _need(self.__request.deadline==self.__deadline);self.__owner._live(self.__request)
        else:
            module=sys.modules.get(__package__+'.windows_offload_execution_child')
            _need(module is not None and module._BOOTSTRAP is self.__child_bootstrap)
            _remaining(self.__deadline)
        _need(get_ident()==self.__thread and not self.__complete and self.__busy
              and type(slot)is int and slot==self.__next and self.__calls[slot]is call
              and self.__rows[slot]is row and self.__ledger._bootstrap_row(self,row)
              and C.WinDLL is self.__loaders[0]and C.CDLL is self.__loaders[1]
              and getattr(C,'get_last_error',None)is self.__getters[0]and C.get_errno is self.__getters[1]
              and getattr(self.__api,('k','crt')[slot],None)is None)
    def load(self,slot,target):
        self.assert_api()
        _need(get_ident()==self.__thread and type(slot)is int and slot in(0,1)
              and slot==self.__next and not self.__busy and not self.__complete)
        if slot==0:_need(target=='kernel32'and not self.__metadata)
        else:
            _need(self.__published[0]and self.__metadata)
            row,binding,value=self.__ledger._scalar_at(2,self.__api)
            _need(binding[0]is self.__libraries[0].GetSystemDirectoryW and row.acknowledged
                  and type(value.outputs)is tuple and len(value.outputs)==1)
            text=binding[3][0];_need(isinstance(text,C.Array)and bytes(text)==value.outputs[0])
            _need(target==str(PureWindowsPath(_root(text.value))/'ucrtbase.dll'))
        call=_BootstrapLibraryCall(self,slot,self.__rows[slot],self.__loaders[slot],self.__getters[slot],
                                   target,{'use_last_error':True}if slot==0 else{'use_errno':True})
        self.__calls[slot]=call;self.__busy=True
        try:
            value=call.invoke();self.__libraries[slot]=value
            self.__next+=1;self.__busy=False
            return value
        except BaseException:self.fail();raise
    def _bind(self,name,function,arguments,result):
        _need(type(arguments)is list and function.argtypes is arguments
              and function.restype is result and getattr(function,'errcheck',None)is None)
        self.__metadata.append((name,function,arguments,tuple(arguments),result))
    def bind_kernel(self,signatures):
        self._origin()
        _need(get_ident()==self.__thread and self.__next==1 and not self.__published[0]
              and self.__api.k is self.__libraries[0]and not self.__metadata)
        self.__published[0]=True
        for name,args,result in signatures:self._bind(name,getattr(self.__libraries[0],name),args,result)
        self.assert_api()
    def bind_crt(self):
        self._origin()
        _need(get_ident()==self.__thread and self.__next==2 and not self.__published[1]
              and self.__api.crt is self.__libraries[1])
        self.__published[1]=True;self.assert_api()
    def complete(self):
        self.assert_api();_need(get_ident()==self.__thread and self.__next==2 and all(self.__published)
                                and not self.__busy and not self.__complete)
        fn=self.__api.begin;_need(fn is self.__libraries[1]._beginthreadex)
        self._bind('_beginthreadex',fn,fn.argtypes,C.c_size_t)
        self.__complete=True;self.assert_api()
    def function_name(self,function):
        self.assert_api()
        found=[name for name,fn,*_ in self.__metadata if fn is function]
        _need(len(found)==1);return found[0]
    def owns(self,row):return any(row is value for value in self.__rows)
    def assert_completed(self,row,api):
        self.assert_api();_need(api is self.__api and self.__complete and self.owns(row))
        for original,call in zip(self.__rows,self.__calls):
            if row is original:call.assert_known();return
        raise OffloadAdmissionError()


class _CoreReadRows:
    """Irrevocable original IO rows for the one closed child Core consumer."""
    __slots__=('__origin','__ledger','__graph','__normal','__tail','__used','__closed','__records')
    def __init__(self,ledger,graph,normal,tail):
        _need(type(self)is _CoreReadRows and not hasattr(self,'_CoreReadRows__origin'))
        self.__origin,self.__ledger,self.__graph=self,ledger,graph
        self.__normal,self.__tail=normal,tail
        self.__used=self.__closed=0
        self.__records=[None]*(len(normal)+len(tail))
    def __repr__(self):return '<original Core read rows>'
    def __copy__(self):raise OffloadAdmissionError()
    def __deepcopy__(self,memo):raise OffloadAdmissionError()
    def __reduce_ex__(self,protocol):raise OffloadAdmissionError()
    def _identity(self,ledger,graph):
        _need(self.__origin is self and self.__ledger is ledger and self.__graph is graph)
        return self.__normal,self.__tail
    def take(self,graph,record,terminal):
        with self.__ledger.lock:
            normal,tail=self._identity(self.__ledger,graph)
            self.__ledger._assert_core_rows(self,graph)
            graph._assert_current_call(record)
            _need(type(terminal)is bool)
            if terminal:
                _need(self.__closed<len(tail));offset=len(normal)+self.__closed
                row=tail[self.__closed];self.__closed+=1
            else:
                _need(self.__used<len(normal));offset=self.__used
                row=normal[self.__used];self.__used+=1
            _need(self.__records[offset]is None)
            self.__records[offset]=record  # Retain partial binding before producer checks.
            record._accept_original_row(self,row,terminal)
            return row
    def assert_record(self,graph,record,row):
        with self.__ledger.lock:
            normal,tail=self._identity(self.__ledger,graph)
            self.__ledger._assert_core_rows(self,graph)
            index=next((i for i,value in enumerate(normal+tail)if value is row),None)
            _need(type(index)is int and self.__records[index]is record)
    def assert_consumed(self,graph):
        with self.__ledger.lock:
            self._identity(self.__ledger,graph)
            self.__ledger._assert_core_rows(self,graph)
            _need(self.__used==len(self.__normal)and self.__closed==len(self.__tail)
                  and all(value is not None for value in self.__records))


class _Ledger:
    """One lifetime allocation; reserve normal and terminal rows before effects."""
    def __init__(self, owner):
        _need(type(self) is _Ledger and not hasattr(self, '_Ledger__origin')
              and getattr(owner, 'ledger', None) is None and getattr(owner, 'api', None) is None)
        self.__origin=self;self.owner=owner
        self.lock = RLock()
        self.normal = [_Call() for _ in range(_MAX_CALLS)]
        self.terminal = [_Call() for _ in range(_TERMINAL_CALLS)]
        self.__normal,self.__terminal=self.normal,self.terminal
        self.used = self.terminal_used = 0
        self.rows=tuple(self.normal)+tuple(self.terminal)
        self.bindings=[None]*len(self.rows)
        self.completions=[None]*len(self.rows)
        for index,row in enumerate(self.rows):row.pool=self;row.index=index
        self.__owner=owner
        self.__rows,self.__bindings,self.__completions=self.rows,self.bindings,self.completions
        self.__locations={id(row):index for index,row in enumerate(self.__rows)}
        self.__intents=[None]*len(self.__rows)
        self.__claims=[None]*len(self.__rows)
        self.__returns=[None]*len(self.__rows)  # Same physical rows, no new pool.
        self.__core_rows=None
        self.__core_owners=[None]*len(self.__rows)
        self.__bootstrap=None

    def _original_storage(self):
        _need(type(self)is _Ledger and self.__origin is self
              and self.owner is self.__owner and self.rows is self.__rows
              and self.normal is self.__normal and self.terminal is self.__terminal
              and self.bindings is self.__bindings and self.completions is self.__completions)

    def _register_bootstrap(self,construction,api):
        with self.lock:
            self._original_storage()
            _need(type(construction)is _BootstrapCustody and type(api)is _Native
                  and api.owner is self.__owner and self.__owner.api is api
                  and api._Native__bootstrap is construction and self.__bootstrap is None
                  and self.used==self.terminal_used==0 and self.__core_rows is None)
            rows=self.__rows[:2]
            for i,row in enumerate(rows):
                self.member(row)
                _need(row.index==i and self.normal[i]is row and self.__intents[i]is None
                      and self.__claims[i]is self.__returns[i]is self.__core_owners[i]is None
                      and not row.committed and not row.started)
            self.__bootstrap=construction;self.used=2
            return rows

    def _bootstrap_row(self,construction,row):
        self._original_storage();self.member(row)
        _need(self.__bootstrap is construction and row.index in(0,1)
              and self.__rows[row.index]is row and self.normal[row.index]is row
              and self.__intents[row.index]is self.__claims[row.index]is self.__returns[row.index]is None
              and self.__core_owners[row.index]is None)
        return True

    def _completed_bootstrap(self,row,api):
        if self.__bootstrap is not None and self.__bootstrap.owns(row):
            self._bootstrap_row(self.__bootstrap,row)
            self.__bootstrap.assert_completed(row,api);return True
        return False

    def _assert_completed_physical(self,row,api):
        self._original_storage();self.member(row)
        if not self._completed_bootstrap(row,api):self.settled(row,api)

    def _scalar_at(self,index,api):
        self._original_storage()
        _need(type(index)is int and 0<=index<len(self.__rows))
        row=self.__rows[index];binding=self.__claims[index]
        _need(type(binding)is tuple and binding[4]is api)
        self.settled(row,api)
        return row,binding,self._retained_return(row,api)

    def _assert_attribute_input(self,buffer,api):
        """Latest original opaque Native output, not a fresh observer snapshot."""
        self._original_storage()
        _need(api.owner is self.__owner and self.__owner.api is api)
        functions=(api.k.InitializeProcThreadAttributeList,api.k.UpdateProcThreadAttribute,
                   api.k.DeleteProcThreadAttributeList)
        for i in range(len(self.__claims)-1,-1,-1):
            binding=self.__claims[i]
            if binding is not None and binding[4]is api and any(binding[0]is fn for fn in functions):
                if binding[1][0]is not buffer:continue
                original=self.__returns[i]
                # The currently constructing call has no return yet; it is
                # not an earlier completed attribute-list transition.
                if original is None:continue
                _need(binding[0]is not api.k.DeleteProcThreadAttributeList)
                self.settled(self.__rows[i],api)
                _need(original.acknowledged and type(original.inout)is bytes and bytes(buffer)==original.inout)
                return
        raise OffloadAdmissionError()

    def _acknowledged_history(self,api,thread=None):
        """Original private scalar chronology; pending other threads are not facts."""
        self._original_storage();_need(api.owner is self.__owner and self.__owner.api is api)
        values=[]
        for i,binding in enumerate(self.__claims):
            if binding is None or(thread is not None and binding[9]!=thread):continue
            value=self.__returns[i]
            if value is None or not value.acknowledged:continue
            values.append(self._scalar_at(i,api))
        return tuple(values)

    def _core_graph_origin(self,graph):
        module=sys.modules.get(__package__+'.windows_offload_execution_child')
        _need(module is not None and type(graph)is module._CoreReadGraph
              and type(self.__owner)is module._Child and module._CHILD is self.__owner
              and self.__owner.core_graph is graph)
        graph._assert_row_owner(self)

    def _carve_core_read(self,graph):
        """Closed first-consumer reservation; never a caller-selected budget."""
        with self.lock:
            self._original_storage();self._core_graph_origin(graph)
            normal,tail,headroom=graph._reservation_shape(self)
            _need(self.__core_rows is None)
            # Validate a contiguous original spent frontier, including rows
            # removed from the child's observation list after acknowledgement.
            spent=[]
            for start,end in((0,_MAX_CALLS),(_MAX_CALLS,len(self.__rows))):
                count=0;gap=False
                for i in range(start,end):
                    row=self.__rows[i];self.member(row)
                    _need(row.index==i and self.__core_owners[i]is None
                          and (self.normal[i]if i<_MAX_CALLS else self.terminal[i-_MAX_CALLS])is row)
                    if self._completed_bootstrap(row,self.__owner.api):
                        _need(not gap);count+=1;continue
                    if self.__intents[i]is None:
                        gap=True
                        _need(self.__claims[i]is self.__returns[i]is None
                              and not row.committed and not row.started)
                    else:
                        _need(not gap and self.__claims[i]is not None)
                        value=self._retained_return(row,self.__owner.api)
                        _need(value.acknowledged and row.acknowledged is True)
                        self.settled(row,self.__owner.api);count+=1
                spent.append(count)
            _need(type(self.used)is int and type(self.terminal_used)is int
                  and self.used==spent[0]and self.terminal_used==spent[1]
                  and spent[0]+normal+headroom<=_MAX_CALLS
                  and spent[1]+tail<=_TERMINAL_CALLS)
            selected=self.__rows[spent[0]:spent[0]+normal]
            terminal=self.__rows[_MAX_CALLS+spent[1]:_MAX_CALLS+spent[1]+tail]
            value=_CoreReadRows(self,graph,selected,terminal)
            self.__core_rows=value  # No rollback/refund if a later assignment fails.
            for row in selected+terminal:
                self.__core_owners[row.index]=value
            self.used=spent[0]+normal;self.terminal_used=spent[1]+tail
            return value

    def _assert_core_rows(self,value,graph):
        self._original_storage();self._core_graph_origin(graph)
        _need(self.__core_rows is value)
        normal,tail=value._identity(self,graph)
        for row in normal+tail:
            self.member(row)
            _need(self.__core_owners[row.index]is value and self.__intents[row.index]is None
                  and self.__claims[row.index]is self.__returns[row.index]is None
                  and (self.normal[row.index]if row.index<_MAX_CALLS else self.terminal[row.index-_MAX_CALLS])is row)

    def _retained_return(self,row,api):
        # Passive facts remain reachable even if an index/payload/table observer
        # changes after the target returned. This grants no execution or credit.
        _need(type(self)is _Ledger and self.__origin is self and type(row)is _Call)
        index=self.__locations.get(id(row))
        _need(type(index)is int and self.__rows[index]is row)
        value=self.__returns[index]
        _need(type(value)is _NativeReturn)
        original,original_api,_,original_index=value.identity(self)
        _need(original is row and original_api is api and original_index==index)
        return value

    def _begin_return(self,row,api,binding):
        with self.lock:
            self._original_storage();self.member(row)
            index=self.__locations.get(id(row))
            _need(type(index)is int and index==row.index and self.__rows[index]is row
                  and self.__claims[index]is self.__bindings[index]is binding
                  and self.__returns[index]is None)
            value=_NativeReturn(self,row,api,binding,index)
            self.__returns[index]=value
            return value

    def _assert_return_dispatch(self,value):
        with self.lock:
            self._original_storage()
            row,api,binding,index=value.identity(self)
            _need(self.__returns[index]is value and self.__rows[index]is row
                  and self.__claims[index]is self.__bindings[index]is binding
                  and self.__completions[index]is None)
            self.member(row)
            _need(type(api)is _Native and api.owner is self.__owner
                  and self.__owner.api is api and self.__owner.ledger is self
                  and type(binding)is tuple and len(binding)==10
                  and binding[4]is api and binding[9]==get_ident()
                  and row.started is True and row.native_thread==binding[9]
                  and row.payload is binding and row.function is binding[0]
                  and row.args is binding[1]and row.valid is binding[2]and row.keep is binding[3]
                  and not row.returned and not row.acknowledged and not row.integrity_lost
                  and row.result is row.error is row.completion is None)
            _Native.origin(api)
            custody=getattr(self.__owner,'_Native__custody',None)
            _need(type(custody)is tuple and len(custody)==3
                  and custody[0]is self.__owner and custody[1]is api and custody[2]is self)

    def _acknowledge_return(self,row,api):
        with self.lock:
            value=self._retained_return(row,api)
            completion=self.settled(row,api)
            _need(completion[1]is value.value and completion[2]is value.error
                  and row.acknowledged is False and api.owner is self.__owner
                  and self.__owner.api is api and self.__owner.ledger is self)
            value.acknowledge(self)
            row.acknowledged=True

    def reserve(self, rows, function, args, valid, keep, terminal):
        with self.lock:
            self._original_storage()
            if self.used < len(self.normal):
                row = self.normal[self.used]; self.used += 1
            else:
                _need(terminal and self.terminal_used < len(self.terminal))
                row = self.terminal[self.terminal_used]; self.terminal_used += 1
            self.member(row)
            index=self.__locations.get(id(row))
            _need(type(index)is int and self.__rows[index]is row and self.__intents[index]is None
                  and self.__core_owners[index]is None
                  and(self.__bootstrap is None or not self.__bootstrap.owns(row)))
            self.__intents[index]=(function,args,valid,keep)
            row.function, row.args, row.valid, row.keep = function, args, valid, keep
            rows.append(row)
            return row

    def member(self,row):
        _need(type(self) is _Ledger and getattr(self,'_Ledger__origin',None) is self
              and type(row) is _Call and row.pool is self and type(row.index) is int
              and 0<=row.index<len(self.rows) and self.rows[row.index] is row)

    def commit(self,row,api,request,kind,wait_deadline=None):
        with self.lock:
            self._original_storage();self.member(row)
            _need(api.owner is self.owner and self.__claims[row.index]is None
                  and self.bindings[row.index] is None and not row.committed and not row.started)
            intent=self.__intents[row.index]
            _need(type(intent)is tuple and len(intent)==4 and row.function is intent[0]
                  and row.args is intent[1]and row.valid is intent[2]and row.keep is intent[3])
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
            self.__claims[row.index]=binding  # Immutable intent before observer exposure.
            self.bindings[row.index]=binding;row.payload=binding;row.committed=True

    def claim(self,row,api):
        with self.lock:
            self._original_storage();self.member(row);binding=self.__claims[row.index]
            _need(type(binding) is tuple and binding[4] is api and api.owner is self.owner
                  and row.committed and not row.started and not row.integrity_lost
                  and len(binding)==10 and binding[9]==get_ident())
            try:
                _need(self.bindings[row.index]is binding and row.payload is binding
                      and not row.returned and not row.acknowledged
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
            value=self._retained_return(row,api)
            _,_,binding,index=value.identity(self)
            _need(value.value_known and value.error_known and result is value.value and error is value.error
                  and(type(result)is int or result is None)and type(error)is int and 0<=error<2**32
                  and self.__completions[index]is None)
            completion=(binding,result,error,binding[9])
            value.publish_completion(self,completion)
            self.__completions[index]=completion  # Original facts before observer validation.
            self._original_storage();self.member(row)
            _need(self.__claims[index]is self.__bindings[index]is binding and api.owner is self.__owner
                  and self.__owner.api is api and self.__owner.ledger is self
                  and row.native_thread==binding[9]==get_ident() and row.started is True
                  and row.completion is None and not row.returned and not row.integrity_lost
                  and row.payload is binding and row.function is binding[0]
                  and row.args is binding[1]and row.valid is binding[2]and row.keep is binding[3]
                  and row.result is row.error is None and row.acknowledged is False)
            row.completion=completion;row.result=result;row.error=error;row.returned=True

    def settled(self,row,api):
        """Known native completion is not a successful request or close ACK."""
        with self.lock:
            self._original_storage()
            self.member(row);binding=self.__claims[row.index]
            try:
                original=self._retained_return(row,api)
                _,_,original_binding,original_index=original.identity(self)
                value=self.completions[row.index]
                _need(type(binding) is tuple and len(binding)==10
                      and self.bindings[row.index]is binding
                      and type(value) is tuple and len(value)==4 and value is row.completion
                      and original.value_known and original.error_known and original.completion is value
                      and original_binding is binding and original_index==row.index
                      and value[1]is original.value and value[2]is original.error
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


class _Native(_NativePrimitives):
    _handle_type = _Handle
    def __new__(cls, owner):
        _native_owner(owner)
        _need(owner.api is None); value = super().__new__(cls); owner.api = value; return value
    def __init__(self, owner):
        _need(type(self)is _Native and not hasattr(self,'_Native__origin'))
        self.__origin=self
        self.__bootstrap=None
        self.owner = owner
        _need(os.name == 'nt' and C.sizeof(_PTR) == 8 and sys.implementation.name == 'cpython'
              and sysconfig.get_platform() == 'win-amd64'
              and (C.sizeof(_BasicLimits),C.sizeof(_ExtendedLimits),C.sizeof(_StartupEx),C.sizeof(_Process)) == (64,144,112,24))
        self._original_ledger()  # Root the original API/ledger before DLL effects.
        construction=_BootstrapCustody(self,self._original_ledger())
        try:self._construct(construction)
        except BaseException:construction.fail();raise

    def _construct(self,construction):
        self.k = construction.load(0,'kernel32')
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
        if type(self.owner) is not _WindowsOffloadIoSession:
            self.owner.exit_function,self.owner.park_function=self.k.ExitProcess,self.k.Sleep
        self.thread_callback = C.WINFUNCTYPE(u32,ptr)
        self.timer_callback = C.WINFUNCTYPE(None,ptr,C.c_ubyte)
        self.k.CreateTimerQueueTimer.argtypes=[C.POINTER(ptr),ptr,self.timer_callback,ptr,u32,u32,u32]
        self.k.CreateTimerQueueTimer.restype=i32
        self.k.DeleteTimerQueueTimer.argtypes=[ptr,ptr,ptr]
        self.k.DeleteTimerQueueTimer.restype=i32
        construction.bind_kernel(signatures+[
            ('CreateTimerQueueTimer',self.k.CreateTimerQueueTimer.argtypes,i32),
            ('DeleteTimerQueueTimer',self.k.DeleteTimerQueueTimer.argtypes,i32)])
        system = self.location(self.k.GetSystemDirectoryW)
        crt_path = str(PureWindowsPath(system)/'ucrtbase.dll')
        self.crt = construction.load(1,crt_path);construction.bind_crt()
        loaded=C.create_unicode_buffer(32768);self.owner.buffers.append(loaded)
        length=self.call(self.k.GetModuleFileNameW,self.crt._handle,loaded,len(loaded),
                         valid=lambda n:type(n) is int and 0<n<len(loaded),keep=(self.crt,loaded))
        _need(length==len(loaded.value) and _root(loaded.value).casefold()==crt_path.casefold())
        _amd64_image(_read_source(Path(loaded.value),64*1024**2))
        self.begin = self.crt._beginthreadex
        self.begin.argtypes = [ptr,u32,self.thread_callback,ptr,u32,C.POINTER(u32)]
        self.begin.restype = C.c_size_t
        construction.complete()

    def location(self, function):
        text=C.create_unicode_buffer(32768);self.owner.buffers.append(text)
        n=self.call(function,text,len(text),valid=lambda n:type(n) is int and 0<n<len(text),keep=(text,))
        _need(n==len(text.value));return _root(text.value)

    def _original_ledger(self):
        self.origin();owner=self.owner
        custody=getattr(owner,'_Native__custody',None)
        if custody is None:
            _need(not hasattr(owner,'_Native__custody'))
            ledger=owner.ledger
            _need(type(ledger)is _Ledger and ledger.owner is owner)
            ledger._original_storage()
            custody=(owner,self,ledger)
            owner._Native__custody=custody  # Existing owner roots even rebound observers.
        _need(type(custody)is tuple and len(custody)==3
              and custody[0]is owner and custody[1]is self and custody[2]is owner.ledger)
        return custody[2]

    def _output_function_name(self,function):
        construction=getattr(self,'_Native__bootstrap',None)
        if construction is not None:return construction.function_name(function)
        # Explicitly synthetic APIs use cached memory-only function objects.
        names=('CreateProcessW','CreatePipe','GetSystemDirectoryW','GetWindowsDirectoryW',
               'GetModuleFileNameW','QueryFullProcessImageNameW','IsProcessInJob',
               'GetHandleInformation','GetExitCodeThread','GetExitCodeProcess',
               'QueryInformationJobObject','SetInformationJobObject',
               'InitializeProcThreadAttributeList','UpdateProcThreadAttribute','DeleteProcThreadAttributeList',
               'ReadFile','WriteFile','CreateTimerQueueTimer','WaitForMultipleObjects')
        kernel=getattr(self,'k',None)
        for name in names:
            observed=getattr(kernel,name,None)
            if function is observed:return name
        if function is getattr(self,'begin',None):return '_beginthreadex'
        return None

    def _call_row(self, function, *args, valid=lambda v:type(v) is int and v!=0, keep=(), terminal=False, _wait_deadline=None):
        self.origin();owner=self.owner;ledger=self._original_ledger()
        if type(owner) is _WindowsOffloadIoSession:
            with owner._state_lock:
                request=owner.active;owner._live(request)
                row=ledger.reserve(owner.calls,function,args,valid,keep,terminal)
                owner._live(request)
                ledger.commit(row,self,request,'operation',_wait_deadline)
        else:
            row=ledger.reserve(owner.calls,function,args,valid,keep,terminal)
            ledger.commit(row,self,None,'child',_wait_deadline)
        return row

    def call(self, function, *args, **kwargs):
        return self._perform(self._call_row(function,*args,**kwargs))

    def _perform(self,row):
        self.origin();owner=self.owner;ledger=self._original_ledger()
        try:binding=ledger.claim(row,self)
        except _IntentChanged:
            if type(owner) is _WindowsOffloadIoSession:owner._fence()
            else:owner.uncertain=True
            raise
        try:
            original=ledger._begin_return(row,self,binding)
            result=original.invoke()
            ledger.returned_native(row,self,result,original.error)
            _need(binding[2](result))
            ledger._acknowledge_return(row,self)
            return result
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


    def origin(self):
        _need(type(self) is _Native and getattr(self,'_Native__origin',None) is self
              and self.owner.api is self and self._handle_type is _Handle)
        _native_owner(self.owner)
        construction=getattr(self,'_Native__bootstrap',None)
        if construction is not None:construction.assert_api()


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


class _IoSessionContract:
    """Fixed trusted IO binding; no constructor or serialized selector."""
    memory_bytes = _MEMORY_BYTES

    @staticmethod
    def sources(): return _sources()

    @staticmethod
    def runtime_image(): return _runtime_image()

    @staticmethod
    def read_source(path, maximum): return _read_source(path, maximum)

    @staticmethod
    def root(value): return _root(value)

    @staticmethod
    def bootstrap(*args): return _bootstrap(*args)


class _KnownStartup:
    """Original Resume-before-ready custody, not a child-ready or exit witness."""
    __slots__=('__origin','__owner','__api','__ledger','__request','__thread','__valid',
               '__handles','__generations','__fields','__process_info','__process_values',
               '__attributes','__runtime','__runtime_hash','__callback','__thread_id',
               '__thread_value','__controller_native','__rows','__ready_rows')
    def __init__(self,owner,request):
        _need(type(self)is _KnownStartup and not hasattr(self,'_KnownStartup__origin')
              and owner._WindowsOffloadIoSession__startup is self)
        self.__origin,self.__owner,self.__api,self.__ledger=self,owner,owner.api,owner.ledger
        self.__valid=False;self.__request=request;self.__thread=get_ident();self.__ready_rows=None
        _need(type(request)is _Request and request.seq==0 and owner.controller_ident==self.__thread
              and len(owner.handles)==len(owner._handle_bindings)==13)
        request.origin(owner)
        self.__handles=tuple(owner.handles)
        self.__generations=tuple(_known_handle(owner,h)for h in self.__handles)
        self.__fields=(owner.start_event,owner.request_event,owner.completion_event,owner.controller,
                       owner.job,owner.process,owner.primary_thread,
                       *(owner.channels[n]for n in('request-read','request-write','response-read','response-write','ready','dispatch')))
        _need(len({id(h)for h in self.__fields})==13 and set(self.__fields)==set(self.__handles))
        self.__process_info,self.__attributes=owner.process_info,owner.attributes
        self.__runtime,self.__runtime_hash=owner.runtime,owner.runtime_hash
        self.__callback,self.__thread_id=owner.callback,owner.thread_id
        self.__thread_value=owner.thread_id.value
        self.__controller_native=owner._WindowsOffloadIoSession__controller_native
        _need(type(self.__controller_native)is tuple and len(self.__controller_native)==3)
        _,thread_binding,thread_value=self.__controller_native
        _need(thread_binding[0]is self.__api.k.GetCurrentThreadId and thread_binding[9]==self.__thread
              and thread_value.acknowledged and thread_value.value==self.__thread_value)
        history=self.__ledger._acknowledged_history(self.__api)
        controller=tuple(v for v in history if v[1][9]==self.__thread)
        _need(len(controller)>=8);tail=controller[-8:];a=self.__api
        _need([b[0]for _,b,_ in tail]==[a.k.IsProcessInJob,a.k.QueryInformationJobObject,a.k.GetProcessId,
              a.k.QueryFullProcessImageNameW,a.k.DeleteProcThreadAttributeList,a.k.CloseHandle,a.k.CloseHandle,a.k.ResumeThread])
        self.__rows=history
        self._readback(tail[:4])
        _need(tail[4][1][1]==(self.__attributes,)and tail[4][2].value is None
              and owner.attribute_started and owner.attribute_retired
              and tail[5][1][3][0]is owner.channels['request-read']
              and tail[6][1][3][0]is owner.channels['response-write']
              and owner.channels['request-read'].closed and owner.channels['response-write'].closed
              and tail[7][1][1]==(owner.primary_thread._number,)and tail[7][2].value==1
              and tail[7][1][3]==(owner.primary_thread,))
        process_rows=[v for v in history if v[1][0]is a.k.CreateProcessW]
        _need(len(process_rows)==1);_,process_binding,process_value=process_rows[0]
        self.__process_values=process_value.outputs
        _need(type(self.__process_values)is tuple and len(self.__process_values)==4
              and process_binding[1][-1]._obj is self.__process_info
              and process_binding[3][-2:] ==(owner.process,owner.primary_thread)
              and process_binding[1][4:6]==(1,524288|4|1024|8)
              and process_binding[1][8]._obj.attributes==C.addressof(self.__attributes))
        # Derive each generation from its original Native return and original
        # pre-call output slot, not the later handle-observation dictionary.
        for h,slot,number in self.__generations:
            born=[]
            for row,binding,value in history:
                fn,keep=binding[0],binding[3];expected=None
                if fn in(a.k.CreateEventW,a.k.CreateJobObjectW)and keep and keep[0]is h:expected=value.value
                elif fn is a.k.CreatePipe and len(keep)==3:
                    if keep[0]is h:expected=value.outputs[0]
                    elif keep[1]is h:expected=value.outputs[1]
                elif fn is a.k.CreateProcessW:
                    if keep[-2]is h:expected=value.outputs[0]
                    elif keep[-1]is h:expected=value.outputs[1]
                elif fn is a.begin and len(keep)==3 and keep[-1]is h:
                    expected=value.value
                    _need(keep[0]is self.__callback and keep[1]is self.__thread_id
                          and value.outputs==(self.__thread_value,))
                if expected is not None:
                    facts=[v for v in binding[8]if v[0]is h]
                    _need(len(facts)==1 and facts[0][1]is slot and facts[0][2]is facts[0][3]is None
                          and expected==number)
                    born.append(row)
            _need(len(born)==1)
        for name,h in owner.channels.items():
            flags=[v for v in history if v[1][0]is a.k.GetHandleInformation and v[1][3][0]is h]
            _need(len(flags)==1 and flags[0][2].outputs[0]&1==int(name in('request-read','response-write','ready','dispatch')))
        self.__valid=True;self.check()
    def __repr__(self):return '<original known child startup>'
    def __copy__(self):raise OffloadAdmissionError()
    def __deepcopy__(self,memo):raise OffloadAdmissionError()
    def __reduce_ex__(self,protocol):raise OffloadAdmissionError()
    def _readback(self,rows):
        o=self.__owner
        _need(rows[0][1][1][:2]==(o.process._number,o.job._number)and rows[0][2].outputs==(1,)
              and rows[1][1][1][:2]==(o.job._number,9)and rows[2][1][1]==(o.process._number,)
              and rows[2][2].value==o.process_info.pid and rows[3][1][1][0]==o.process._number)
        limits=_ExtendedLimits.from_buffer_copy(rows[1][2].outputs[0])
        _need(limits.basic.flags==8968 and limits.basic.active_process_limit==1
              and limits.process_memory_limit==limits.job_memory_limit==_MEMORY_BYTES)
        text=type(rows[3][1][3][1]).from_buffer_copy(rows[3][2].outputs[0]).value
        _need(rows[3][2].outputs[1]==len(text)and _root(text).casefold()==str(self.__runtime).casefold())
    def ready(self):
        self.check();_need(self.__ready_rows is None and get_ident()==self.__thread)
        rows=self.__ledger._acknowledged_history(self.__api,self.__thread)[-6:];a=self.__api;o=self.__owner
        _need(len(rows)==6 and[entry[1][0]for entry in rows]==[a.k.WaitForMultipleObjects,
              a.k.IsProcessInJob,a.k.QueryInformationJobObject,a.k.GetProcessId,a.k.QueryFullProcessImageNameW,a.k.SetEvent]
              and rows[0][1][3][0]==(o.channels['ready'],)and rows[0][2].value==0
              and rows[-1][1][1]==(o.channels['dispatch']._number,))
        self._readback(rows[1:5]);self.__ready_rows=rows
    def check(self):
        o=self.__owner;o.origin()
        _need(self.__origin is self and self.__valid and o._WindowsOffloadIoSession__startup is self
              and o.api is self.__api and o.ledger is self.__ledger and o.controller_ident==self.__thread
              and o.process_info is self.__process_info and o.attributes is self.__attributes
              and o.runtime is self.__runtime and o.runtime_hash==self.__runtime_hash
              and o.callback is self.__callback and o.thread_id is self.__thread_id
              and o.thread_id.value==self.__thread_value
              and o._WindowsOffloadIoSession__controller_native is self.__controller_native)
        _need((o.start_event,o.request_event,o.completion_event,o.controller,o.job,o.process,o.primary_thread,
              *(o.channels[n]for n in('request-read','request-write','response-read','response-write','ready','dispatch')))==self.__fields
              and tuple(o.handles[:13])==self.__handles
              and (o.process_info.process,o.process_info.thread,o.process_info.pid,o.process_info.tid)==self.__process_values)
        for h,slot,number in self.__generations:
            generation=_known_handle(o,h)
            _need(generation[0]is h and generation[1]is slot and generation[2]==number)
        for row,binding,value in self.__rows:
            _need(self.__ledger.settled(row,self.__api)[0]is binding and value.acknowledged)
        if o.launch_complete:_need(self.__ready_rows is not None)


class _WindowsOffloadIoSession(_SessionMechanics):
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
        self.__startup=self.__controller_native=None
        self.runtime=None;self.runtime_hash=None
        self._state_lock=RLock()
        self.initialized=True

    def origin(self):
        _need(type(self) is _WindowsOffloadIoSession
              and getattr(self,'_WindowsOffloadIoSession__origin',None) is self
              and self.initialized is True
              and _OWNERS.get(id(self)) is self)

    def _session_contract(self):
        self.origin()
        return _IoSessionContract

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
        value=self.api.call(function,*args,**kwargs)
        if function is self.api.k.ResumeThread and self.__controller_native is not None:
            _need(self.__startup is None)
            marker=object.__new__(_KnownStartup);self.__startup=marker
            _KnownStartup.__init__(marker,self,request)
        elif(function is self.api.k.SetEvent and self.__startup is not None
             and args==(self.channels['dispatch']._number,)):
            self.__startup.ready()
        return value


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
            self.__controller_native=self.ledger._acknowledged_history(a,get_ident())[-1]
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
          and owner.attribute_started and owner.attribute_retired
          and type(a) is _Native and type(owner.controller_ident) is int
          and len(owner.handles)==13 and len({id(h) for h in owner.handles})==13
          and len(owner._handle_bindings)==13)
    a.origin()
    startup=owner._WindowsOffloadIoSession__startup
    if startup is not None:
        _need(type(startup)is _KnownStartup);startup.check()
    else:
        # Existing explicitly synthetic full-launch fixtures have no production
        # constructor/controller producer. They cannot admit a partial startup.
        _need(owner.launch_complete and getattr(a,'_Native__bootstrap',None)is None
              and owner._WindowsOffloadIoSession__controller_native is None)
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
            if ledger._completed_bootstrap(row,a):continue
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
            elif binding[0]is a.k.WaitForMultipleObjects:
                _need(type(startup)is _KnownStartup and request.seq==0 and not owner.launch_complete
                      and binding[6]=='operation'and len(binding[3])==2)
                handles,values=binding[3]
                _need(type(handles)is tuple and handles==(owner.channels['ready'],)
                      and type(values)is _PTR*1 and tuple(values)==(handles[0]._number,)
                      and binding[1][0]==1 and binding[1][1]is values and binding[1][2]==0
                      and type(binding[1][3])is int and 0<binding[1][3]<=120000)
                kind='ready'
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
        startup=owner._WindowsOffloadIoSession__startup
        if startup is not None:startup.check()
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
                facts=owner.ledger._retained_return(row,self.api).outputs
                _need(type(facts)is tuple and len(facts)==1)
                if output_index==3:
                    _need(type(output) is _Accounting and type(facts[0])is bytes
                          and len(facts[0])==C.sizeof(_Accounting))
                    original=_Accounting.from_buffer_copy(facts[0]);scalars=(original.active,original.total)
                else:
                    _need(type(output) is _U32);scalars=facts
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
            for row in self.original_rows:self.owner.ledger._assert_completed_physical(row,self.api)
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
                for row in self.original_rows:self.owner.ledger._assert_completed_physical(row,self.api)
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
