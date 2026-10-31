"""Fixed private IO child. No ordinary CLI, model, framework or stdio role."""
import ctypes as C
import hashlib
from pathlib import Path
import re
import struct
import sys
from threading import RLock, get_ident
import time

from . import windows_offload_execution as x
from . import windows_offload_core as w
from .local_model_offload import OffloadAdmissionError

_BOOTSTRAP = None
_CHILD = None
_RESERVED_MS = 5000


class _Timer:
    def __init__(self, child, request):
        x._need(type(self) is _Timer and not hasattr(self,'_Timer__origin')
                and type(child) is _Child and _CHILD is child)
        child.origin()
        x._message(request,child.nonce,child.source_digest)
        x._need(child.current is request and child.timer is None and not child.uncertain
                and child.job_observed and child.dispatched and child.thread==get_ident())
        x._need(x._remaining(request['deadline_ns'])>_RESERVED_MS)
        self.__origin=self;self.child=child;self.request=request
        self.slot=x._PTR();self.callback=None;self.event=None
        self.original_slot=self.slot;self.number=None
        self.terminal_park=child._terminal_park;x._need(callable(self.terminal_park))
        self.phase='pending';self.delete_started=self.retired=False
        self.lock=RLock()
        child.timers.append(self);child.timer=self
        child.live()
        self.event=child.api.acquire('timer-completion',child.api.k.CreateEventW,None,1,0,None)
        self._origin();child.live()
        remaining=x._remaining(request['deadline_ns']);x._need(remaining>_RESERVED_MS)
        self.due=x._U32(remaining-_RESERVED_MS)
        self.expires=time.monotonic_ns()+self.due.value*1_000_000
        self.callback=child.api.timer_callback(self._expired)
        child.buffers.extend((self,self.callback,self.slot,self.due,self.event))
        child.api.call(child.api.k.CreateTimerQueueTimer,C.byref(self.slot),None,self.callback,None,self.due.value,0,8,
                       keep=(self,self.slot,self.callback,self.due,self.event))
        self._origin();x._need(type(self.slot.value) is int and 0<self.slot.value<C.c_void_p(-1).value
                              and self.phase=='pending' and not child.uncertain)
        self.number=self.slot.value

    def _origin(self):
        c=self.child;c.origin()
        x._need(type(self) is _Timer and getattr(self,'_Timer__origin',None) is self
                and c.timer is self and c.current is self.request
                and any(t is self for t in c.timers)
                and self.slot is self.original_slot and type(self.slot) is x._PTR
                and (self.number is None or type(self.number) is int and self.slot.value==self.number))

    def _expired(self,parameter,fired):
        # Copies and foreign receivers have no callback authority and cannot
        # poison the canonical child while failing their origin checks.
        if type(self) is not _Timer or getattr(self,'_Timer__origin',None) is not self:return
        c=self.child
        if type(c) is not _Child or _CHILD is not c:return
        try:
            c.origin()
            x._need(parameter is None and type(fired) is int and fired==1)
            with self.lock:
                if self.phase!='pending':return
                self._origin();x._need(time.monotonic_ns()>=self.expires)
                self.phase='expired';c.uncertain=True
            c._exit(2)
        except BaseException:
            # Never unwind across the foreign threadpool callback boundary.
            try:self.child.uncertain=True
            finally:self.terminal_park()

    def complete(self):
        self._origin();c=self.child
        with self.lock:
            x._need(self.phase=='pending' and not c.uncertain and not self.delete_started)
            x._need(type(self.number) is int and self.number>0)
            x._remaining(self.request['deadline_ns'])
            x._need(time.monotonic_ns()<self.expires)
            self.phase='completion-won';self.delete_started=True
        c.api.call(c.api.k.DeleteTimerQueueTimer,None,self.slot.value,self.event.value,
                   valid=lambda n:type(n) is int and (n!=0 or C.get_last_error()==997),
                   keep=(self,self.slot,self.callback,self.event),terminal=True)
        x._need(c.api.wait((self.event,),self.request['deadline_ns'])==0)
        self._origin();x._need(self.phase=='completion-won' and not c.uncertain)
        c.api.close(self.event)
        self.retired=True
        # The timer API retired the timer. Never CloseHandle(timer).


class _Port(w._NativeExecutionPort):
    def __init__(self,child):
        self.__origin=self;self.child=child;self.core=None;self.busy=False;self.thread=get_ident()
        child.buffers.append(self)
    def assert_bound(self,core):
        c=self.child;c.live()
        x._need(type(self) is _Port and getattr(self,'_Port__origin',None) is self
                and c.port is self and self.core is core and type(core) is w.WindowsOffloadCore
                and core is c.core and core._factory is c.factory and get_ident()==self.thread==c.thread
                and c.current['op'] in ('bind-read','retire-unused-read'))
        c._runtime_binding()
        values,hashes,digest=x._sources()
        x._need(hashes==c.hashes and digest==c.source_digest)
        c.live()
    def execute(self,core,operation):
        self.assert_bound(core)
        x._need(not self.busy and callable(operation));self.busy=True
        value=operation()
        self.assert_bound(core);self.busy=False
        return value  # Exact same-process value, never a serialized Core result.


class _Child:
    def __init__(self,nonce,handles,deadline,hashes,runtime):
        self.__origin=self;self.nonce=nonce;self.hashes=hashes
        self.api=None;self.buffers=[];self.calls=[];self.handles=[];self.uncertain=False;self.ledger=x._Ledger(self)
        self.channels={};self.timers=[];self.timer=None;self.current=None;self.state='new'
        self.root=None;self.core=None;self.core_retired=False;self.api_constructing=None
        self.port=self.factory=None;self.thread=get_ident();self.job_observed=False
        self.exit_function=self.park_function=None;self.exit_started=False;self.exit_lock=RLock()
        self.runtime=runtime
        values,current_hashes,self.source_digest=x._sources();self.buffers.extend((values,current_hashes))
        x._need(current_hashes==hashes)
        x._Native(self)
        self._runtime_binding()
        for name,number in zip(('request','response','ready','dispatch'),handles):
            h=x._Handle(self,name);h.slot.value=number;self.handles.append(h);self.channels[name]=h
            h.acknowledge()
            flags=x._U32();self.buffers.append(flags)
            self.api.call(self.api.k.GetHandleInformation,h.value,C.byref(flags),keep=(h,flags))
            x._need(flags.value&1)
            if name in ('request','response'):x._need(self.api.call(self.api.k.GetFileType,h.value,keep=(h,))==3)
        inside=x._I32();self.buffers.append(inside)
        process=self.api.call(self.api.k.GetCurrentProcess)
        self.api.call(self.api.k.IsProcessInJob,process,None,C.byref(inside),keep=(inside,))
        x._need(inside.value==1);self.job_observed=True
        self.api.call(self.api.k.SetEvent,self.channels['ready'].value,keep=(self.channels['ready'],))
        x._need(self.api.wait((self.channels['dispatch'],),deadline)==0)
        self.dispatched=True

    def origin(self):
        x._need(type(self) is _Child and getattr(self,'_Child__origin',None) is self and _CHILD is self)

    def live(self):
        self.origin()
        x._need(not self.uncertain and self.job_observed and self.dispatched
                and self.current is not None and self.timer is not None
                and self.timer.request is self.current and self.timer.phase=='pending'
                and self.thread==get_ident())
        x._remaining(self.current['deadline_ns'])

    def _runtime_binding(self):
        self.origin()
        x._need(type(self.runtime) is tuple and len(self.runtime)==2)
        text=C.create_unicode_buffer(32768);self.buffers.append(text)
        length=self.api.call(self.api.k.GetModuleFileNameW,None,text,len(text),
                             valid=lambda n:type(n) is int and 0<n<len(text),keep=(text,))
        path=x._root(text.value)
        x._need(length==len(text.value) and path.casefold()==self.runtime[0].casefold()
                and path.casefold()==x._root(sys.executable).casefold()
                and hashlib.sha256(x._read_source(Path(path),64*1024**2)).hexdigest()==self.runtime[1])

    def _read(self,size):
        x._need(type(size) is int and 0<size<=x._FRAME_BYTES)
        data=C.create_string_buffer(size);self.buffers.append(data);offset=0
        while offset<size:
            count=x._U32();self.buffers.append(count)
            self.api.call(self.api.k.ReadFile,self.channels['request'].value,C.byref(data,offset),size-offset,C.byref(count),None,
                          keep=(self.channels['request'],data,count))
            x._need(0<count.value<=size-offset);offset+=count.value
        return bytes(data.raw)

    def _write(self,raw):
        x._need(type(raw) is bytes and 0<len(raw)<=x._FRAME_BYTES+4)
        data=C.create_string_buffer(raw);self.buffers.append(data);offset=0
        while offset<len(raw):
            x._remaining(self.current['deadline_ns']);count=x._U32();self.buffers.append(count)
            self.api.call(self.api.k.WriteFile,self.channels['response'].value,C.byref(data,offset),len(raw)-offset,C.byref(count),None,
                          keep=(self.channels['response'],data,count))
            x._need(0<count.value<=len(raw)-offset);offset+=count.value

    def _bind(self):
        self.live();x._need(self.core is None and self.root is not None)
        self.port=_Port(self)
        child=self
        class PinnedApi(w._WindowsApi):
            def __new__(cls,core):
                x._need(cls is child.factory and core is child.core and child.api_constructing is None)
                value=object.__new__(cls);child.api_constructing=value;return value
            def call(self,*args,**kwargs):
                child.live()
                x._need(self is child.api_constructing and self.owner is child.core)
                return w._WindowsApi.call(self,*args,**kwargs)
        self.factory=PinnedApi
        self.core=object.__new__(w.WindowsOffloadCore);self.buffers.append(self.core);self.port.core=self.core
        w.WindowsOffloadCore.__init__(self.core,Path(self.root),_api_factory=self.factory,_execution=self.port)
        x._need(self.core.prepare_fresh_binding() is None and self.core._api is self.api_constructing
                and not self.core._uncertain)

    def execute(self,request):
        self.origin();x._need(self.current is None and self.timer is None and not self.uncertain)
        x._message(request,self.nonce,self.source_digest)
        next_state=x._edge(self.state,request['seq']);self.current=request
        timer=object.__new__(_Timer);self.buffers.append(timer)
        _Timer.__init__(timer,self,request)
        self.live()
        if request['seq']==0:
            x._need(self.root is None);self.root=x._root(request['body']['cache_root'])
        elif request['seq']==1:self._bind()
        elif request['seq']==2:
            x._need(type(self.core) is w.WindowsOffloadCore and not self.core_retired)
            x._need(self.core._retire_unused_read_binding() is None)
            x._need(self.core._retired and not self.core._uncertain and self.core._read_retirement.released
                    and self.core._retirement_kind=='read-binding' and id(self.core) not in w._CUSTODY
                    and id(self.core) not in w._READ_RETIREMENTS)
            self.core_retired=True
        else:x._need(self.core is None or self.core_retired)
        self.live();timer.complete()
        x._need(timer.retired and not self.uncertain)
        self.state=next_state
        return {**request,'body':{'state':next_state}}

    def run(self):
        while True:
            # Idle pipe reads have no cached-session lifetime timer. The parent
            # dispatcher retains its own outstanding native read/write custody.
            size=struct.unpack('<I',self._read(4))[0];x._need(0<size<=x._FRAME_BYTES)
            request=x._message(x._decode(self._read(size)),self.nonce,self.source_digest)
            reply=self.execute(request)
            self._write(x._frame(reply))
            x._need(self.timer.retired)
            self.current=None;self.timer=None
            self.timers[:]=[t for t in self.timers if not t.retired]
            self.calls[:]=[r for r in self.calls if not r.acknowledged]
            if self.state=='finished':
                for h in self.channels.values():self.api.close(h)
                self._exit(0)

    def _exit(self,code):
        _entry_environment()
        x._need(type(self) is _Child and _CHILD is self)
        try:
            self.origin()
            with self.exit_lock:
                x._need(not self.exit_started and type(code) is int and code in (0,2,9))
                self.exit_started=True
            self.api.call(self.exit_function,code,valid=lambda v:v is None,terminal=True)
        except BaseException:
            self.uncertain=True
        # No retry or Python teardown with unknown native/callback custody.
        self.uncertain=True
        self._park()

    def _park(self):
        _entry_environment()
        x._need(type(self) is _Child and _CHILD is self)
        self._terminal_park()


def _entry_environment():
    x._need(__name__=='_aisb_owned_io.windows_offload_execution_child'
            and sys.flags.isolated==sys.flags.no_site==1 and sys.dont_write_bytecode
            and sys.prefix==sys.base_prefix and sys.argv==['-c'])


def _entry():
    global _CHILD
    # Imported/default calls deny before native construction; only the fixed
    # source-buffer bootstrap installs this private tuple.
    _entry_environment()
    x._need(type(_BOOTSTRAP) is tuple and len(_BOOTSTRAP)==5 and _CHILD is None)
    nonce,handles,deadline,hashes,runtime=_BOOTSTRAP
    x._need(type(nonce) is str and re.fullmatch('[0-9a-f]{32}',nonce)
            and type(handles) is tuple and len(handles)==len(set(handles))==4
            and all(type(v) is int and 0<v<C.c_void_p(-1).value for v in handles)
            and type(hashes) is dict and set(hashes)==set(x._SOURCE_NAMES))
    x._remaining(deadline)
    _CHILD=object.__new__(_Child)
    child=_CHILD
    def terminal_park():
        # Created only after the original private entry admission. Preserve this
        # local reference through partial construction and failed validation.
        while True:
            try:
                function=getattr(child,'park_function',None)
                if function is not None:function(0xffffffff)
                else:time.sleep(3600)
            except BaseException:continue
    child._terminal_park=terminal_park
    try:
        _Child.__init__(_CHILD,nonce,handles,deadline,hashes,runtime)
        _CHILD.run()
    except BaseException:
        try:
            _CHILD.uncertain=True
            _CHILD._exit(9)
        except BaseException:terminal_park()
