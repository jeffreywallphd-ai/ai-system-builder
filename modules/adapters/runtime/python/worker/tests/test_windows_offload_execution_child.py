"""Real private child/port/Core flow with synthetic ABI replies, never a host pass."""
import copy
import ctypes as C
from contextlib import contextmanager
import hashlib
import linecache
from pathlib import Path
import struct
import sys
from threading import RLock, Thread, get_ident
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

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
        c.root=None;c.core=None;c.core_retired=False;c.api_constructing=None;c.port=c.factory=None;c.core_graph=None
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
        case=self;self.core_opened=[];self.core_libraries=[];self.core_functions={}
        def native(name,args):
            if name=='GetSystemDirectoryW':args[0].value='C:\\Windows\\System32';return len(args[0].value)
            if name=='GetModuleFileNameW'and args[0]==8000:
                args[1].value='C:\\Windows\\System32\\ucrtbase.dll';return len(args[1].value)
            if name=='GetDriveTypeW':return 3
            if name=='NtCreateFile':
                number=500+len(case.core_opened);case.core_opened.append(number)
                args[0]._obj.value=number;args[3]._obj.status=None;args[3]._obj.information=1;return 0
            if name=='GetVolumeInformationByHandleW':
                args[5]._obj.value=8;args[6].value='NTFS';return 1
            if name=='GetFileInformationByHandleEx':
                value=args[2]._obj
                if args[1]==9:value[0]=0x10;return 1
                raw=b'volume00'+args[0].to_bytes(16,'little');C.memmove(value,raw,24)
                case.events.append(('identity',args[0]));return 1
            if name=='CloseHandle':case.events.append(('close',args[0]));return 1
            function=getattr(case.k,name,None)
            if function is not None:return function(*args)
            raise AssertionError('Unexpected synthetic Core operation')
        class Function:
            def __init__(self,name):self.name=name;self.calls=[]
            def __call__(self,*args):
                self.calls.append(args);value=native(self.name,args)
                hook=getattr(case,'core_native_hook',None)
                if hook is not None:hook(self.name,args,value)
                return value
        class Library:
            def __init__(self,name,**kwargs):
                case.assertEqual(kwargs,{'use_last_error':True});self.name=self._name=name;self.functions={}
                self._handle=9000+len(case.core_libraries)
                case.core_libraries.append(self)
            def __getattr__(self,name):
                if name not in self.functions:
                    self.functions[name]=Function(name);case.core_functions[(self.name,name)]=self.functions[name]
                return self.functions[name]
        scope=patch.object(C,'WinDLL',Library,create=True);scope.start();self.addCleanup(scope.stop)

    def bind_core(self):
        self.core_api();self.child.execute(self.request(0));self.child.current=self.child.timer=None
        return self.child.execute(self.request(1))

    def test_actual_io_bootstrap_rows_compose_with_core_original_spent_frontier(self):
        self.core_api();c=self.child;c.api=None
        class Function:
            def __call__(self,*args):raise AssertionError('No CRT thread starts in this source test')
        class Crt:
            _handle=8000
            def __init__(self,name,**kwargs):
                self._name=name;self._beginthreadex=Function()
                case.assertEqual(kwargs,{'use_errno':True})
        case=self;original=x._read_source
        image=bytearray(512);image[:2]=b'MZ';struct.pack_into('<I',image,0x3c,128)
        image[128:132]=b'PE\0\0';struct.pack_into('<H',image,132,0x8664);struct.pack_into('<H',image,152,0x20b)
        def read(path,maximum=2*1024**2):
            return bytes(image)if str(path).casefold().endswith('ucrtbase.dll')else original(path,maximum)
        bootstrap=(c.nonce,(10,11,12,13),x.time.monotonic_ns()+x._BUDGET_NS,c.hashes,c.runtime)
        with patch.object(C,'CDLL',Crt),patch.object(x,'_read_source',side_effect=read), \
             patch.object(y,'_BOOTSTRAP',bootstrap):
            a=x._Native(c)
            self.assertEqual(c.ledger.used,4)
            self.assertEqual(len(c.calls),2)
            for row in c.ledger.rows[:2]:c.ledger._assert_completed_physical(row,a)
            self.child.execute(self.request(0));self.child.current=self.child.timer=None
            self.child.execute(self.request(1));self.child.current=self.child.timer=None
            self.child.execute(self.request(2))
        self.assertTrue(c.core_retired);self.assertEqual(len(self.core_libraries),4)

    def graph_rows(self):return self.child.core_graph._CoreReadGraph__records

    def test_core_rows_share_original_pool_and_close_only_in_reserved_tail(self):
        self.bind_core();g=self.child.core_graph;ledger=self.child.ledger;n=len(Path.cwd().parts)
        reserved=g._CoreReadGraph__rows
        normal,tail=reserved._identity(ledger,g)
        self.assertEqual((len(normal),len(tail)),(6*n+5,n))
        self.assertTrue(all(r is ledger.rows[r.index]and r.index<x._MAX_CALLS for r in normal))
        self.assertTrue(all(r is ledger.rows[r.index]and r.index>=x._MAX_CALLS for r in tail))
        self.assertEqual(len(self.graph_rows()),4*n+5)
        self.child.current=self.child.timer=None;self.child.execute(self.request(2))
        self.assertEqual(len(self.graph_rows()),7*n+5)
        self.assertTrue(all(r.acknowledged for r in self.graph_rows()))
        close_rows=[r for r in self.graph_rows()if r._CoreReadCall__terminal]
        self.assertEqual([r._CoreReadCall__row for r in close_rows],list(tail))
        self.assertTrue(all(r._CoreReadCall__row not in self.child.calls for r in self.graph_rows()))
        with self.assertRaises(x.OffloadAdmissionError):reserved.assert_consumed(copy.copy(g))

    def test_core_depth64_consumes_exact_fixed_tail_and65_denies_before_dll(self):
        for n in (64,65):
            with self.subTest(depth=n),self.independent_process() as case:
                case.core_api();request=case.request(0)
                request['body']['cache_root']='C:\\'+'\\'.join('node'+str(i)for i in range(n-1))
                case.child.execute(request);case.child.current=case.child.timer=None
                if n==65:
                    with self.assertRaises(x.OffloadAdmissionError):case.child.execute(case.request(1))
                    self.assertEqual(case.core_libraries,[])
                else:
                    case.child.execute(case.request(1));case.child.current=case.child.timer=None
                    case.child.execute(case.request(2))
                    self.assertEqual(len(case.core_opened),64)
                    self.assertEqual(len([r for r in case.graph_rows()if r._CoreReadCall__terminal]),64)

    def test_original_spent_frontier_and_headroom_exact_boundary(self):
        for excess in (0,1):
            with self.subTest(excess=excess),self.independent_process() as case:
                case.core_api();c=case.child;c.root=str(Path.cwd());c.current=case.request(1);y._Timer(c,c.current)
                count=x._MAX_CALLS-(6*len(Path.cwd().parts)+5)-8908+excess
                while c.ledger.used<count:c.api.call(lambda:1)
                before=c.ledger.used
                if excess:
                    with self.assertRaises(x.OffloadAdmissionError):c._bind()
                    self.assertEqual(case.core_libraries,[]);self.assertEqual(c.ledger.used,before)
                else:
                    c._bind();self.assertEqual(len(case.core_libraries),3)
                    self.assertGreaterEqual(x._MAX_CALLS-c.ledger.used,8908-3)

    def test_public_counter_or_free_row_alias_cannot_refund_core_capacity(self):
        for mode in ('used','terminal_used','index','normal','intent','binding','completion'):
            with self.subTest(mode=mode),self.independent_process() as case:
                case.core_api();c=case.child;c.root=str(Path.cwd());c.current=case.request(1);y._Timer(c,c.current)
                ledger=c.ledger
                if mode=='used':ledger.used=0
                elif mode=='terminal_used':ledger.terminal_used=1
                elif mode=='index':ledger.rows[0].index=1
                elif mode=='normal':ledger.normal=list(reversed(ledger.normal))
                elif mode=='intent':ledger.rows[0].function=lambda:1
                elif mode=='binding':ledger.bindings[0]=None
                else:ledger.completions[0]=None
                with self.assertRaises(x.OffloadAdmissionError):c._bind()
                self.assertEqual(case.core_libraries,[])

    def test_actual_open_output_survives_original_error_reader_interruption(self):
        self.core_api();self.child.execute(self.request(0));self.child.current=self.child.timer=None
        def reader():
            if self.core_opened:raise KeyboardInterrupt()
            return 0
        C.get_last_error.side_effect=reader
        with self.assertRaises(KeyboardInterrupt):self.child.execute(self.request(1))
        row=self.graph_rows()[-1]
        self.assertTrue(row.value_known);self.assertEqual(row.value,0)
        self.assertEqual(row.output,(500,None,1));self.assertFalse(row.error_known or row.acknowledged)
        self.assertIs(row._CoreReadCall__args[0]._obj,self.child.core._handles[0].slot)
        self.assertEqual([n for op,n in self.events if op=='close'],[])
        with self.assertRaises(x.OffloadAdmissionError):row.invoke(*row._CoreReadCall__args)
        self.assertEqual(len(self.core_opened),1)

    def test_native_handle_slot_drift_keeps_original_output_without_ack_or_retry(self):
        self.core_api();self.child.execute(self.request(0));self.child.current=self.child.timer=None
        def hook(name,args,value):
            if name=='NtCreateFile':self.child.core._handles[0].slot=w._PTR(999)
        self.core_native_hook=hook
        with self.assertRaises(x.OffloadAdmissionError):self.child.execute(self.request(1))
        row=self.graph_rows()[-1]
        self.assertEqual(row.output,(500,None,1));self.assertTrue(row.value_known)
        self.assertFalse(row.acknowledged);self.assertEqual(len(self.core_opened),1)
        self.assertIsNot(row._CoreReadCall__args[0]._obj,self.child.core._handles[0].slot)
        self.assertTrue(self.child.core._uncertain)

    def test_recursive_call_wrong_thread_and_copied_graph_have_no_call_authority(self):
        self.bind_core();g=self.child.core_graph;row=self.graph_rows()[-1]
        for value in (g,row,g._CoreReadGraph__rows):
            with self.assertRaises((x.OffloadAdmissionError,TypeError)):copy.copy(value)
            with self.assertRaises((x.OffloadAdmissionError,TypeError)):copy.deepcopy(value)
        with self.assertRaises(x.OffloadAdmissionError):row.invoke(*row._CoreReadCall__args)
        before=len(self.graph_rows())
        with self.assertRaises(x.OffloadAdmissionError):g.call(self.child.core._api,lambda:1,(),lambda n:True,())
        self.assertEqual(len(self.graph_rows()),before)
        results=[]
        def foreign():
            try:g._assert_row_owner(self.child.ledger)
            except x.OffloadAdmissionError:results.append('denied')
        thread=Thread(target=foreign);thread.start();thread.join(2)
        self.assertFalse(thread.is_alive());self.assertEqual(results,['denied'])
        self.assertFalse(self.child.core._uncertain)

    def test_changed_function_after_constructor_denies_before_replacement(self):
        self.bind_core();api=self.child.core._api;replacement=Mock(return_value=1)
        api.k.functions['GetFileInformationByHandleEx']=replacement
        self.child.current=self.child.timer=None
        with self.assertRaises(x.OffloadAdmissionError):self.child.execute(self.request(2))
        replacement.assert_not_called()
        self.assertEqual([n for op,n in self.events if op=='close'],[])

    def test_in_place_native_prototype_drift_denies_before_target(self):
        for mode in('argtypes','argtypes-item','restype','errcheck'):
            with self.subTest(mode=mode),self.independent_process() as case:
                case.bind_core();fn=case.child.core._api.k.GetFileInformationByHandleEx;before=len(fn.calls)
                if mode=='argtypes':fn.argtypes=list(fn.argtypes)
                elif mode=='argtypes-item':fn.argtypes[0]=w._U32
                elif mode=='restype':fn.restype=w._PTR
                else:fn.errcheck=lambda value,*_:value
                case.child.current=case.child.timer=None
                with self.assertRaises(x.OffloadAdmissionError):case.child.execute(case.request(2))
                self.assertEqual(len(fn.calls),before)

    def test_same_call_reentry_denies_without_duplicate_native_dispatch(self):
        self.core_api();seen=[]
        def hook(name,args,value):
            if name=='NtCreateFile':
                row=self.graph_rows()[-1]
                with self.assertRaises(x.OffloadAdmissionError):row.invoke(*row._CoreReadCall__args)
                seen.append(row)
        self.core_native_hook=hook
        self.child.execute(self.request(0));self.child.current=self.child.timer=None
        self.child.execute(self.request(1))
        self.assertEqual(len(seen),len(Path.cwd().parts))
        self.assertTrue(all(row.acknowledged for row in seen))

    def test_invalid_output_fails_core_without_fabricated_retirement(self):
        for kind in('kind','filesystem','identity','iosb'):
            with self.subTest(kind=kind),self.independent_process() as case:
                case.core_api()
                def hook(name,args,value):
                    if name=='GetFileInformationByHandleEx'and args[1]==9 and kind=='kind':args[2]._obj[0]=0x410
                    if name=='GetVolumeInformationByHandleW'and kind=='filesystem':args[6].value='FAT32'
                    if name=='GetFileInformationByHandleEx'and args[1]==18 and kind=='identity':C.memset(args[2],0,24)
                    if name=='NtCreateFile'and kind=='iosb':args[3]._obj.information=2
                case.core_native_hook=hook
                case.child.execute(case.request(0));case.child.current=case.child.timer=None
                with self.assertRaises(x.OffloadAdmissionError):case.child.execute(case.request(1))
                self.assertTrue(case.child.core._uncertain);self.assertFalse(case.child.core_retired)
                self.assertEqual([n for op,n in case.events if op=='close'],[])
                self.assertTrue(case.graph_rows()[-1].value_known)

    def test_partial_dll_constructor_retains_actual_libraries_and_never_retries(self):
        self.core_api();original=C.WinDLL;calls=[]
        class FaultingLibrary(original):
            def __init__(self,name,**kwargs):
                calls.append(name)
                if name=='advapi32':raise KeyboardInterrupt()
                super().__init__(name,**kwargs)
        with patch.object(C,'WinDLL',FaultingLibrary):
            self.child.execute(self.request(0));self.child.current=self.child.timer=None
            with self.assertRaises(KeyboardInterrupt):self.child.execute(self.request(1))
        rows=self.graph_rows()
        self.assertEqual(calls,['kernel32','advapi32']);self.assertEqual(len(rows),2)
        self.assertIs(rows[0].value,self.core_libraries[0]);self.assertTrue(rows[0].acknowledged)
        self.assertFalse(rows[1].value_known or rows[1].acknowledged)
        self.assertTrue(self.child.core._uncertain)

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
        self.assertFalse(core._uncertain);self.assertEqual([n for op,n in self.events if op=='close'],list(reversed(self.core_opened)))
        self.assertEqual(len(self.core_opened),len(Path.cwd().parts))
        self.assertEqual([library.name for library in self.core_libraries],['kernel32','advapi32','ntdll'])
        self.assertNotIn(id(core),w._CUSTODY);self.assertNotIn(id(core),w._READ_RETIREMENTS)
        self.assertFalse(core._execution_calls);self.assertIsNone(core._dispatch)
        self.assertEqual(len(self.k.created),4);self.assertEqual(len(self.k.deleted),4)
        self.assertTrue(all(row[1] is None and row[3] is None and row[5:]==(0,8) for row in self.k.created))
        self.assertTrue(all(row[0] is None and row[2] not in (0,C.c_void_p(-1).value) for row in self.k.deleted))
        self.assertTrue(all(row[0].value not in self.k.closed for row in self.k.created))

    def test_deep_core_read_graph_denies_before_any_core_library_load(self):
        request=self.request(0)
        request['body']['cache_root']='C:\\'+'\\'.join(['node']*127)
        wire=bytearray(x._frame(request)+x._frame(self.request(1)))
        def read(size):
            self.assertGreaterEqual(len(wire),size)
            out=bytes(wire[:size]);del wire[:size];return out
        loader=Mock(side_effect=AssertionError('No Core DLL effect expected'))
        with patch.object(C,'WinDLL',loader,create=True),patch.object(self.child,'_read',side_effect=read), \
             patch.object(self.child,'_write',return_value=None),self.assertRaises(x.OffloadAdmissionError):
            self.child.run()
        loader.assert_not_called()

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
