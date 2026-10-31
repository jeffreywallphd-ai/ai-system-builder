"""Real private child/port/Core flow with synthetic ABI replies, never a host pass."""
import copy
import ctypes as C
from contextlib import contextmanager
import hashlib
import linecache
from pathlib import Path
import struct
import sys
from threading import RLock, get_ident
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from modules.adapters.runtime.python.worker.tasks import windows_offload_execution as x
from modules.adapters.runtime.python.worker.tasks import windows_offload_execution_child as y
from modules.adapters.runtime.python.worker.tasks import windows_offload_core as w


class Kernel:
    """Models only the narrow ABI; the real child and Core keep their custody."""
    def __init__(self):
        self.next=100;self.events={};self.created=[];self.deleted=[];self.closed=[]
        self.error=0;self.delete_mode='true';self.wait_result=0;self.timer_fault=None;self.exits=[]
    def CreateEventW(self,*_):
        self.next+=1;self.events[self.next]=False;return self.next
    def CreateTimerQueueTimer(self,out,queue,callback,parameter,due,period,flags):
        self.next+=1;out._obj.value=self.next
        self.created.append((out._obj,queue,callback,parameter,due,period,flags))
        if self.timer_fault:raise self.timer_fault
        return 1
    def DeleteTimerQueueTimer(self,queue,timer,event):
        self.deleted.append((queue,timer,event))
        if self.delete_mode=='interrupt':raise KeyboardInterrupt()
        if self.delete_mode=='false':self.error=5;return 0
        self.events[event]=True
        if self.delete_mode=='pending':self.error=997;return 0
        return 1
    def WaitForMultipleObjects(self,count,handles,all_,timeout):
        return self.wait_result
    def CloseHandle(self,handle):self.closed.append(handle);return 1
    def ExitProcess(self,code):self.exits.append(code);return None
    def GetModuleFileNameW(self,module,text,size):text.value=sys.executable;return len(text.value)


class ChildTests(unittest.TestCase):
    def setUp(self):
        for table in (w._CUSTODY,w._READ_RETIREMENTS,x._OWNERS):
            scope=patch.dict(table,{},clear=True);scope.start();self.addCleanup(scope.stop)
        self.k=Kernel();self.events=[]
        scope=patch.object(C,'get_last_error',side_effect=lambda:self.k.error,create=True);scope.start();self.addCleanup(scope.stop)
        c=object.__new__(y._Child);c._Child__origin=c
        c.nonce='a'*32;c.api=None;c.buffers=[];c.calls=[];c.handles=[];c.ledger=x._Ledger(c)
        c.uncertain=False;c.channels={};c.timers=[];c.timer=None;c.current=None;c.state='new'
        c.root=None;c.core=None;c.core_retired=False;c.api_constructing=None;c.port=c.factory=None
        c.thread=get_ident();c.job_observed=c.dispatched=True
        c.exit_function=self.k.ExitProcess;c.park_function=lambda _:None;c.exit_started=False;c.exit_lock=RLock()
        # A terminal endpoint is observed in these ABI simulations. The real
        # entry-local never-return loop is exercised separately below.
        c._terminal_park=lambda:None
        c.runtime=(x._root(sys.executable),hashlib.sha256(x._read_source(Path(sys.executable))).hexdigest())
        _,c.hashes,c.source_digest=x._sources()
        scope=patch.object(y,'_CHILD',c);scope.start();self.addCleanup(scope.stop)
        a=object.__new__(x._Native);a._Native__origin=a;a.owner=c;a.k=self.k;a.timer_callback=lambda f:f;c.api=a
        self.child=c
        for n in ('request','response','ready','dispatch'):
            h=x._Handle(c,n);h.slot.value=self.k.CreateEventW();c.handles.append(h);h.acknowledge();c.channels[n]=h

    def request(self,seq):
        return {'v':1,'nonce':self.child.nonce,'seq':seq,'op':x._OPERATIONS[seq],
                'body':{'cache_root':str(Path.cwd())} if seq==0 else {},
                'source_digest':self.child.source_digest,'deadline_ns':x.time.monotonic_ns()+x._BUDGET_NS}

    def timer(self):
        self.child.current=self.request(0)
        return y._Timer(self.child,self.child.current)

    @contextmanager
    def independent_process(self):
        # Each fault case has a new explicit synthetic process. Never reset an
        # uncertain producer or replace its original callback/handle custody.
        case=ChildTests('test_imported_entry_cannot_start_native_child')
        case.setUp()
        try:yield case
        finally:case.doCleanups()

    def core_api(self):
        events=self.events
        def init(api,core):
            self.assertIs(self.child.api_constructing,api)
            self.assertIs(self.child.core,core)
            api.owner=core;api.identities={}
            api.k=SimpleNamespace(CloseHandle=lambda number:events.append(('close',number)) or 1)
        def prepare(api,path):
            self.assertEqual(path,Path.cwd());rows=[]
            for number in (500,501,502):
                h=w._Handle();h.slot.value=number;api.owner._handles.append(h)
                identity=b'volume00'+number.to_bytes(16,'little');api.identities[h]=identity
                rows.append((h,identity))
            return tuple(rows)
        def identity(api,h):
            self.assertFalse(h.closed);events.append(('identity',h.value));return api.identities[h]
        for name,function in (('__init__',init),('prepare',prepare),('identity',identity)):
            scope=patch.object(w._WindowsApi,name,function);scope.start();self.addCleanup(scope.stop)

    def test_actual_child_loop_drives_real_core_and_exact_read_retirement(self):
        self.core_api();wire=bytearray(b''.join(x._frame(self.request(seq)) for seq in range(4)));replies=[]
        def read(size):
            self.assertGreaterEqual(len(wire),size);out=bytes(wire[:size]);del wire[:size];return out
        with patch.object(self.child,'_read',side_effect=read),patch.object(self.child,'_write',side_effect=replies.append), \
             patch.object(y,'_entry_environment'),patch.object(self.child,'_park',side_effect=x.OffloadAdmissionError), \
             self.assertRaises(x.OffloadAdmissionError):self.child.run()
        # The synthetic ExitProcess returns. No native exit pass is inferred.
        self.assertEqual(self.k.exits,[0]);self.assertEqual(len(replies),4);self.assertFalse(wire)
        for seq,raw in enumerate(replies):
            reply=x._message(x._decode(raw[4:]),self.child.nonce,self.child.source_digest,response=True)
            self.assertEqual(reply['seq'],seq);self.assertEqual(reply['body']['state'],x._STATES[seq])
        core=self.child.core
        self.assertIs(type(core),w.WindowsOffloadCore);self.assertIs(core._execution,self.child.port)
        self.assertTrue(core._read_retirement.released and self.child.core_retired and core._retired)
        self.assertFalse(core._uncertain);self.assertEqual([n for op,n in self.events if op=='close'],[502,501,500])
        self.assertNotIn(id(core),w._CUSTODY);self.assertNotIn(id(core),w._READ_RETIREMENTS)
        self.assertFalse(core._execution_calls);self.assertIsNone(core._dispatch)
        self.assertEqual(len(self.k.created),4);self.assertEqual(len(self.k.deleted),4)
        self.assertTrue(all(row[1] is None and row[3] is None and row[5:]==(0,8) for row in self.k.created))
        self.assertTrue(all(row[0] is None and row[2] not in (0,C.c_void_p(-1).value) for row in self.k.deleted))
        self.assertTrue(all(row[0].value not in self.k.closed for row in self.k.created))

    def test_timer_true_and_pending_ack_each_require_exact_completion_event(self):
        for mode in ('true','pending'):
            with self.subTest(mode=mode),self.independent_process() as case:
                case.k.delete_mode=mode;t=case.timer();t.complete()
                self.assertTrue(t.retired and t.event.closed);self.assertEqual(t.phase,'completion-won')
                self.assertEqual(case.k.deleted[-1],(None,t.slot.value,t.event._number))
                before=len(case.k.deleted)
                with self.assertRaises(x.OffloadAdmissionError):t.complete()
                self.assertEqual(len(case.k.deleted),before)

    def test_timer_deletion_failure_interrupt_or_unknown_wait_retains_callback(self):
        for mode,wait in (('false',0),('interrupt',0),('true',258),('pending',0xffffffff)):
            with self.subTest(mode=mode,wait=wait),self.independent_process() as case:
                case.k.delete_mode=mode;case.k.wait_result=wait
                t=case.timer();before=len(case.k.deleted)
                with self.assertRaises((x.OffloadAdmissionError,KeyboardInterrupt)):t.complete()
                self.assertFalse(t.retired or t.event.closed);self.assertTrue(t.delete_started)
                self.assertIn(t,case.child.timers);self.assertIn(t.callback,case.child.buffers)
                with self.assertRaises(x.OffloadAdmissionError):t.complete()
                self.assertEqual(len(case.k.deleted),before+1)

    def test_partial_timer_output_and_lost_create_ack_keep_original_graph(self):
        self.k.timer_fault=KeyboardInterrupt()
        with self.assertRaises(KeyboardInterrupt):self.timer()
        t=self.child.timer
        self.assertGreater(t.slot.value,0);self.assertIn(t,self.child.timers)
        self.assertIn(t.callback,self.child.buffers);self.assertTrue(self.child.uncertain)
        self.assertEqual(self.k.deleted,[]);self.assertFalse(t.event.closed)

    def test_stale_completed_callback_cannot_kill_idle_or_next_operation(self):
        old=self.timer();old.complete();self.child.timer=self.child.current=None
        old._expired(None,1)
        fresh=self.timer();old._expired(None,1)
        self.assertFalse(self.child.uncertain);self.assertEqual(fresh.phase,'pending');self.assertEqual(self.k.exits,[])
        copy.copy(fresh)._expired(None,1)
        self.assertFalse(self.child.uncertain);self.assertEqual(fresh.phase,'pending');self.assertEqual(self.k.exits,[])

    def test_expiry_wins_before_completion_and_late_completion_does_not_delete(self):
        t=self.timer()
        with patch.object(y.time,'monotonic_ns',return_value=t.expires),patch.object(y,'_entry_environment'), \
             patch.object(self.child,'_park',side_effect=x.OffloadAdmissionError):t._expired(None,1)
        self.assertTrue(self.child.uncertain);self.assertEqual(self.k.exits,[2])
        with self.assertRaises(x.OffloadAdmissionError):t.complete()
        self.assertEqual(self.k.deleted,[]);self.assertFalse(t.retired)

    def test_delayed_timer_delivery_cannot_turn_expired_work_into_success(self):
        t=self.timer()
        with patch.object(y.time,'monotonic_ns',return_value=t.expires),self.assertRaises(x.OffloadAdmissionError):t.complete()
        self.assertFalse(t.delete_started or t.retired);self.assertEqual(self.k.deleted,[])

    def test_real_port_enforces_original_source_thread_core_and_callback_result(self):
        self.core_api();self.child.current=self.request(1);t=y._Timer(self.child,self.child.current)
        self.child.root=str(Path.cwd());self.child._bind();port=self.child.port;core=self.child.core
        sentinel=object();self.assertIs(port.execute(core,lambda:sentinel),sentinel)
        for target in (copy.copy(core),object()):
            with self.assertRaises(x.OffloadAdmissionError):port.execute(target,lambda:self.fail('No substituted Core dispatch'))
        with self.assertRaises(x.OffloadAdmissionError):copy.copy(port).assert_bound(core)
        port.thread=-1
        with self.assertRaises(x.OffloadAdmissionError):port.assert_bound(core)
        port.thread=get_ident()
        with patch.object(x,'_sources',return_value=({}, {}, '0'*64)),self.assertRaises(x.OffloadAdmissionError):port.assert_bound(core)
        with patch.object(x,'_read_source',return_value=b'changed executable'),self.assertRaises(x.OffloadAdmissionError):port.assert_bound(core)
        self.assertFalse(t.retired)

    def test_committed_core_retirement_survives_later_timer_failure_without_credit(self):
        self.core_api()
        for seq in (0,1):
            self.child.execute(self.request(seq));self.child.current=self.child.timer=None
        self.k.delete_mode='false'
        with self.assertRaises(x.OffloadAdmissionError):self.child.execute(self.request(2))
        core=self.child.core
        self.assertTrue(self.child.core_retired and core._read_retirement.released)
        self.assertFalse(core._uncertain);self.assertNotIn(id(core),w._CUSTODY)
        self.assertNotEqual(self.child.state,'read-retired');self.assertTrue(self.child.uncertain)
        self.assertIsNone(core._reservation);self.assertIsNone(core._stage)

    def test_imported_entry_cannot_start_native_child(self):
        with patch.object(x,'_Native') as native,self.assertRaises(x.OffloadAdmissionError):y._entry()
        native.assert_not_called()

    def test_imported_exit_and_park_cannot_stop_or_park_shared_worker(self):
        for function,args in ((self.child._exit,(9,)),(self.child._park,())):
            with self.subTest(function=function),self.assertRaises(x.OffloadAdmissionError):function(*args)
        self.assertFalse(self.child.exit_started);self.assertEqual(self.k.exits,[])

    def test_unknown_exit_ack_parks_original_child_and_never_retries_exit(self):
        parked=[]
        def park():parked.append(self.child);raise x.OffloadAdmissionError()
        with patch.object(y,'_entry_environment'),patch.object(self.child,'_park',side_effect=park):
            for _ in range(2):
                with self.assertRaises(x.OffloadAdmissionError):self.child._exit(9)
                self.assertTrue(self.child.uncertain)
        self.assertEqual(self.k.exits,[9]);self.assertEqual(parked,[self.child,self.child])
        self.assertTrue(self.child.exit_started and self.child.uncertain)

    def test_changed_timer_output_generation_refuses_native_delete(self):
        for mode in ('slot','value'):
            with self.subTest(mode=mode),self.independent_process() as case:
                t=case.timer();before=len(case.k.deleted)
                if mode=='slot':t.slot=x._PTR(t.number)
                else:t.slot.value=t.number+1
                with self.assertRaises(x.OffloadAdmissionError):t.complete()
                self.assertEqual(len(case.k.deleted),before);self.assertFalse(t.retired or t.delete_started)
                self.assertIn(t.original_slot,case.child.buffers)

    def test_actual_core_keeps_partial_api_before_constructor_failure(self):
        self.child.execute(self.request(0));self.child.current=self.child.timer=None
        def fail(api,core):
            self.assertIs(api,self.child.api_constructing);self.assertIs(core,self.child.core)
            api.owner=core;raise KeyboardInterrupt()
        with patch.object(w._WindowsApi,'__init__',fail),self.assertRaises(KeyboardInterrupt):self.child.execute(self.request(1))
        core=self.child.core
        self.assertIs(self.child.api_constructing.owner,core);self.assertIsNone(core._api)
        self.assertTrue(core._uncertain);self.assertIs(w._CUSTODY[id(core)],core)
        self.assertIn(core,self.child.buffers);self.assertFalse(self.child.timer.retired)

    def test_actual_timer_retains_original_terminal_endpoint_after_validator_failure(self):
        calls=[]
        def terminal():calls.append('original');raise TerminalObserved()
        self.child._terminal_park=terminal;t=self.timer()
        self.child._terminal_park=lambda:self.fail('Do not use a replaced child endpoint')
        with patch.object(y,'_entry_environment',side_effect=MemoryError), \
             patch.object(y.time,'monotonic_ns',return_value=t.expires),self.assertRaises(TerminalObserved):t._expired(None,1)
        self.assertEqual(calls,['original']);self.assertEqual(self.k.exits,[])
        self.assertTrue(self.child.uncertain);self.assertFalse(t.retired)

    def test_timer_admission_rejects_expired_bool_copy_wrong_thread_and_unready_before_effects(self):
        for fault in ('expired','bool','foreign-request','copy','thread','not-ready','not-dispatched','uncertain','reentry'):
            with self.subTest(fault=fault),self.independent_process() as case:
                c=case.child;request=case.request(0);c.current=request;target=c
                if fault=='expired':request['deadline_ns']=x.time.monotonic_ns()-1
                elif fault=='bool':request['deadline_ns']=True
                elif fault=='foreign-request':c.current=dict(request)
                elif fault=='copy':target=copy.copy(c)
                elif fault=='thread':c.thread=-1
                elif fault=='not-ready':c.job_observed=False
                elif fault=='not-dispatched':c.dispatched=False
                elif fault=='uncertain':c.uncertain=True
                else:c.timer=object()
                timer=c.timer;before=list(c.timers);handles=len(c.handles);events=len(case.k.events)
                with self.assertRaises(x.OffloadAdmissionError):y._Timer(target,request)
                self.assertEqual(len(case.k.events),events);self.assertEqual(case.k.created,[])
                self.assertEqual(c.timers,before);self.assertIs(c.timer,timer);self.assertEqual(len(c.handles),handles)

    def test_timer_constructor_reentry_cannot_overwrite_live_generation(self):
        timer=self.timer();slot=timer.slot;callback=timer.callback;events=len(self.k.events)
        with self.assertRaises(x.OffloadAdmissionError):y._Timer.__init__(timer,self.child,self.child.current)
        self.assertIs(timer.slot,slot);self.assertIs(timer.callback,callback)
        self.assertIs(self.child.timer,timer);self.assertEqual(len(self.k.events),events);self.assertEqual(len(self.k.created),1)

    def test_event_acquisition_consuming_deadline_retains_event_and_never_arms_timer(self):
        for remaining in (-1,4_000_000_000):
            with self.subTest(remaining=remaining),self.independent_process() as case:
                c=case.child;request=case.request(0);c.current=request;clock=[x.time.monotonic_ns()]
                original=case.k.CreateEventW
                def slow(*args):
                    value=original(*args);clock[0]=request['deadline_ns']-remaining;return value
                with patch.object(case.k,'CreateEventW',side_effect=slow),patch.object(x.time,'monotonic_ns',side_effect=lambda:clock[0]), \
                     self.assertRaises(x.OffloadAdmissionError):y._Timer(c,request)
                timer=c.timer
                self.assertIs(timer.request,request);self.assertIn(timer,c.timers)
                self.assertGreater(timer.event._number,0);self.assertFalse(timer.event.closed or timer.retired)
                self.assertIsNone(timer.slot.value);self.assertEqual(case.k.created,[]);self.assertEqual(case.k.closed,[])

    def test_idle_longer_than_operation_budget_allows_fresh_requests_and_no_stale_stop(self):
        self.core_api();clock=[x.time.monotonic_ns()];wire=bytearray();sequences=[];replies=[]
        def read(size):
            if not wire:
                seq=len(sequences)
                if seq:
                    clock[0]+=121*10**9
                    for timer in self.k.created:timer[2](None,1)
                    self.assertFalse(self.child.uncertain)
                wire.extend(x._frame(self.request(seq)));sequences.append(seq)
            out=bytes(wire[:size]);del wire[:size];return out
        with patch.object(x.time,'monotonic_ns',side_effect=lambda:clock[0]),patch.object(self.child,'_read',side_effect=read), \
             patch.object(self.child,'_write',side_effect=replies.append),patch.object(y,'_entry_environment'), \
             patch.object(self.child,'_park',side_effect=x.OffloadAdmissionError),self.assertRaises(x.OffloadAdmissionError):self.child.run()
        self.assertEqual(sequences,[0,1,2,3]);self.assertEqual(len(replies),4)
        self.assertEqual(self.k.exits,[0]);self.assertTrue(self.child.core_retired)
        self.assertFalse(self.child.core._uncertain)

    def test_initialized_child_can_finish_without_constructing_a_core(self):
        self.child.execute(self.request(0));self.child.current=self.child.timer=None
        with patch.object(w._WindowsApi,'__init__') as native:
            reply=self.child.execute(self.request(3))
        native.assert_not_called();self.assertEqual(reply['body'],{'state':'finished'})
        self.assertIsNone(self.child.core);self.assertFalse(self.child.core_retired)

    def test_source_check_consuming_deadline_cannot_construct_core_api(self):
        self.child.execute(self.request(0));self.child.current=self.child.timer=None
        clock=[x.time.monotonic_ns()];source=x._sources;reads=[]
        def slow():
            value=source();reads.append(1)
            if len(reads)==2:clock[0]=self.child.current['deadline_ns']+1
            return value
        with patch.object(x,'_sources',side_effect=slow),patch.object(x.time,'monotonic_ns',side_effect=lambda:clock[0]), \
             patch.object(w._WindowsApi,'__init__') as native,self.assertRaises(x.OffloadAdmissionError):self.child.execute(self.request(1))
        native.assert_not_called();self.assertIsNone(self.child.api_constructing)
        self.assertTrue(self.child.core._uncertain);self.assertIs(w._CUSTODY[id(self.child.core)],self.child.core)

    def test_core_operation_consuming_deadline_cannot_issue_a_later_native_call(self):
        self.core_api();self.child.execute(self.request(0));self.child.current=self.child.timer=None
        clock=[x.time.monotonic_ns()];calls=[]
        def slow(api,path):
            clock[0]=self.child.current['deadline_ns']+1
            return api.call(lambda:calls.append('native') or 1)
        with patch.object(w._WindowsApi,'prepare',slow),patch.object(x.time,'monotonic_ns',side_effect=lambda:clock[0]), \
             self.assertRaises(x.OffloadAdmissionError):self.child.execute(self.request(1))
        self.assertEqual(calls,[]);self.assertIsNone(self.child.core._pending)
        self.assertTrue(self.child.core._uncertain)


class TerminalObserved(BaseException):pass


class EntryFailureTests(unittest.TestCase):
    def test_entry_validation_or_replaced_park_cannot_escape_terminal_fallback(self):
     for replace in (False,True):
      with self.subTest(replace=replace):
       calls=[];checks=[];iterations=[]
       def environment():
        checks.append(1)
        if len(checks)>1:raise MemoryError()
       def construct(child,*args):
        def sleep(milliseconds):calls.append(milliseconds);raise KeyboardInterrupt()
        child.park_function=sleep
        if replace:
         def broken():raise MemoryError()
         child._park=broken
        raise MemoryError()
       def trace(frame,event,arg):
        if event=='line' and frame.f_code.co_name=='terminal_park' and linecache.getline(frame.f_code.co_filename,frame.f_lineno).strip()=='while True:':
         iterations.append(1)
         if len(iterations)==2:raise TerminalObserved()
        return trace
       bootstrap=('a'*32,(10,11,12,13),x.time.monotonic_ns()+x._BUDGET_NS,{n:'b'*64 for n in x._SOURCE_NAMES},('C:\\Python\\python.exe','c'*64))
       prior=sys.gettrace()
       try:
        with patch.object(y,'_CHILD',None),patch.object(y,'_BOOTSTRAP',bootstrap),patch.object(y,'_entry_environment',side_effect=environment),patch.object(y._Child,'__init__',construct),self.assertRaises(TerminalObserved):
         sys.settrace(trace);y._entry()
       finally:sys.settrace(prior)
       self.assertEqual(calls,[0xffffffff]);self.assertEqual(len(checks),2)



if __name__=='__main__':unittest.main()
