"""Model-free private session/ABI regressions; no Windows qualification."""
import copy
import ctypes as C
import json
import hashlib
from pathlib import Path
import struct
from threading import Event, Thread, get_ident
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from modules.adapters.runtime.python.worker.tasks import windows_offload_execution as x


class LaunchKernel:
    """Synthetic ABI only. No process, Windows thread, Job or pipe is created."""
    def __init__(self,owner):
        self.owner=owner;self.next=100;self.flags={};self.events={};self.updates=[];self.creations=[]
        self.error=0;self.resumes=[];self.closed=[];self.delete_attributes=0;self.late=False;self.lost=False
        self.runtime=Path('C:/Python/python.exe');self.image=b'synthetic runtime image'
    def handle(self):self.next+=1;self.flags[self.next]=0;return self.next
    def CreateEventW(self,*_):
        h=self.handle();self.events[h]=Event();return h
    def SetEvent(self,h):self.events[h].set();return 1
    def ResetEvent(self,h):self.events[h].clear();return 1
    def CreatePipe(self,read,write,security,size):
        read._obj.value=self.handle();write._obj.value=self.handle()
        self.flags[read._obj.value]=self.flags[write._obj.value]=1;return 1
    def SetHandleInformation(self,h,mask,flags):self.flags[h]=flags;return 1
    def GetHandleInformation(self,h,out):out._obj.value=self.flags[h];return 1
    def GetFileType(self,h):return 3
    def CreateJobObjectW(self,*_):return self.handle()
    def SetInformationJobObject(self,job,kind,info,size):
        self.limits=bytes(info._obj);return 1
    def QueryInformationJobObject(self,job,kind,out,size,returned):
        C.memmove(out,self.limits,len(self.limits));return 1
    def IsProcessInJob(self,process,job,out):out._obj.value=1;return 1
    def GetProcessId(self,process):return 321
    def QueryFullProcessImageNameW(self,process,flags,text,length):
        text.value=getattr(self,'query_image',str(self.runtime));length._obj.value=len(text.value);return 1
    def InitializeProcThreadAttributeList(self,attrs,count,flags,size):
        size._obj.value=128;self.error=122 if attrs is None else 0;return int(attrs is not None)
    def UpdateProcThreadAttribute(self,attrs,flags,kind,value,size,*_):
        self.updates.append((kind,tuple(value)));return 1
    def DeleteProcThreadAttributeList(self,attrs):self.delete_attributes+=1;return None
    def GetWindowsDirectoryW(self,text,size):text.value='C:\\Windows';return len(text.value)
    def CreateProcessW(self,image,command,sa,ta,inherit,flags,env,cwd,startup,out):
        self.creations.append((image,command.value,inherit,flags,bytes(startup._obj)))
        out._obj.process=self.handle();out._obj.thread=self.handle();out._obj.pid=321;out._obj.tid=654
        if self.late:self.owner.active.expired=True
        if self.lost:raise KeyboardInterrupt()
        return 1
    def ResumeThread(self,h):self.resumes.append(h);return 1
    def WaitForMultipleObjects(self,*_):return 0
    def CloseHandle(self,h):self.closed.append(h);return 1


class SessionTests(unittest.TestCase):
    def setUp(self):
        p=patch.dict(x._OWNERS,{},clear=True);p.start();self.addCleanup(p.stop)
        p=patch.object(C,'get_last_error',return_value=0,create=True);p.start();self.addCleanup(p.stop)

    def session(self):return x._WindowsOffloadIoSession('C:\\synthetic-cache')

    def message(self,seq=0):
        return {'v':1,'nonce':'a'*32,'seq':seq,'op':x._OPERATIONS[seq],
                'body':{'cache_root':'C:\\synthetic-cache'} if seq==0 else {},
                'source_digest':'b'*64,'deadline_ns':x.time.monotonic_ns()+x._BUDGET_NS}

    def api(self,owner):
        if owner.active is None:self.activate(owner)
        value=object.__new__(x._Native);value._Native__origin=value;value.owner=owner;owner.api=value
        return value

    def activate(self,owner,seq=0):
        request=x._Request(owner,seq);owner.requests.append(request);owner.active=request;return request

    def handle(self,owner,name,number):
        h=x._Handle(owner,name);owner.handles.append(h);h.slot.value=number;h.acknowledge();return h

    def test_explicit_configuration_precedence_is_frozen_without_framework_or_files(self):
        with patch.dict(x.os.environ,{'HF_HUB_CACHE':'C:\\first','TRANSFORMERS_CACHE':'C:\\second','HF_HOME':'C:\\third'},clear=True), \
             patch.object(Path,'open',side_effect=AssertionError('No file')):
            owner=x._managed_read_session()
            self.assertEqual(owner.root,'C:\\first')
            x.os.environ['HF_HUB_CACHE']='C:\\changed';self.assertEqual(owner.root,'C:\\first')
        with patch.dict(x._OWNERS,{},clear=True),patch.dict(x.os.environ,{'HF_HOME':'C:\\third'},clear=True):
            self.assertEqual(x._managed_read_session().root,'C:\\third\\hub')
        for env in ({},{'HF_HUB_CACHE':'relative','TRANSFORMERS_CACHE':'C:\\valid'}):
            with self.subTest(env=env),patch.dict(x.os.environ,env,clear=True),self.assertRaises(x.OffloadAdmissionError):x._configured_root()

    def test_unsafe_or_nonlocal_roots_deny_without_namespace_effects(self):
        for value in ('relative','\\\\server\\share','\\\\?\\C:\\cache','C:\\cache\\..\\elsewhere',
                      'C:\\cache\\.\\other','C:\\cache:stream','C:\\cache.','C:\\cache\n','C:\\bad\ud800',True,'C:\\'+'x'*2050):
            with self.subTest(value=value),self.assertRaises(x.OffloadAdmissionError):x._root(value)

    def test_closed_protocol_and_explicit_finish_shortcut(self):
        self.assertEqual(x._edge('initialized',3),'finished')
        for state,seq in (('new',1),('initialized',2),('read-bound',3),('read-retired',1),('finished',3),('new',True)):
            with self.subTest(state=state,seq=seq),self.assertRaises(x.OffloadAdmissionError):x._edge(state,seq)
        value=self.message();wire=x._frame(value)
        self.assertEqual(struct.unpack('<I',wire[:4])[0],len(wire)-4)
        self.assertEqual(x._message(x._decode(wire[4:]),'a'*32,'b'*64),value)

    def test_hostile_frames_and_identity_substitution_do_not_get_to_native_work(self):
        for raw in (b'{}',b'[]',b'{"a":1,"a":2}',b'{"a":NaN}',b'\xff',b'x'*4097,b'{"a":{"b":{"c":{"d":{"e":1}}}}}'):
            with self.subTest(raw=raw[:30]),self.assertRaises(x.OffloadAdmissionError):
                x._message(x._decode(raw),'a'*32,'b'*64)
        for change in ({'nonce':'c'*32},{'source_digest':'c'*64},{'extra':'private'},
                       {'seq':True},{'op':'execute'},{'body':{'cache_root':'C:\\other','command':'private'}},
                       {'deadline_ns':True},{'v':True}):
            with self.subTest(change=change),self.assertRaises(x.OffloadAdmissionError):x._message({**self.message(),**change},'a'*32,'b'*64)

    def test_one_owner_capacity_copy_and_unknown_admission_are_not_reset_by_a_root(self):
        owner=self.session()
        with self.assertRaises(x.OffloadAdmissionError):self.session()
        clone=copy.copy(owner)
        for clone in (clone,):
            with self.assertRaises(x.OffloadAdmissionError):clone.origin()
        with self.assertRaises((TypeError,ValueError)):copy.deepcopy(owner)
        owner.uncertain=True
        with self.assertRaises(x.OffloadAdmissionError):owner.prepare()
        with self.assertRaises(x.OffloadAdmissionError):x._WindowsOffloadIoSession('C:\\another')
        self.assertIs(x._OWNERS[id(owner)],owner)

    def test_api_copy_and_handle_generation_change_deny_before_close(self):
        owner=self.session();a=self.api(owner);calls=[]
        a.k=SimpleNamespace(CloseHandle=lambda n:calls.append(n) or 1)
        h=self.handle(owner,'original',10)
        with self.assertRaises(TypeError):copy.copy(a)
        clone=object.__new__(x._Native);clone.__dict__.update(a.__dict__)
        with self.assertRaises(x.OffloadAdmissionError):clone.close(h)
        self.assertFalse(h.close_started);self.assertEqual(calls,[])
        for target in (copy.copy(h),x._Handle(owner,'forged')):
            target.slot.value=10
            with self.assertRaises(x.OffloadAdmissionError):a.close(target)
        h.slot.value=11
        with self.assertRaises(x.OffloadAdmissionError):a.close(h)
        self.assertEqual(calls,[])

    def test_false_or_lost_close_ack_keeps_exact_slot_and_never_retries(self):
        for fault in ('false','interrupt'):
            with patch.dict(x._OWNERS,{},clear=True):
                owner=self.session();a=self.api(owner);calls=[];h=self.handle(owner,'original',10)
                def close(number):
                    calls.append(number)
                    if fault=='interrupt':raise KeyboardInterrupt()
                    return 0
                a.k=SimpleNamespace(CloseHandle=close)
                with self.subTest(fault=fault),self.assertRaises((x.OffloadAdmissionError,KeyboardInterrupt)):a.close(h)
                self.assertTrue(owner.uncertain and h.close_started);self.assertFalse(h.closed)
                self.assertIs(owner.calls[0].keep[0],h)
                with self.assertRaises(x.OffloadAdmissionError):a.close(h)
                self.assertEqual(calls,[10])

    def test_capacity_is_checked_before_native_callback(self):
        owner=self.session();a=self.api(owner);owner.ledger.used=x._MAX_CALLS
        called=[]
        with self.assertRaises(x.OffloadAdmissionError):a.call(lambda:called.append(True) or 1)
        self.assertFalse(called)

    def test_caller_timeout_retains_controller_and_performs_no_inline_cleanup(self):
        owner=self.session();events=[]
        h=object()
        def start(request):
            owner.controller=owner.completion_event=h
            owner.api=SimpleNamespace(wait=lambda *_:258,
                k=SimpleNamespace(TerminateJobObject=lambda *_:events.append('terminate'),CloseHandle=lambda *_:events.append('close')))
        with patch.object(owner,'_start',side_effect=start),self.assertRaises(x.OffloadAdmissionError):owner.prepare()
        self.assertTrue(owner.uncertain and owner.stop_requested and owner.active.expired)
        self.assertIs(x._OWNERS[id(owner)],owner);self.assertEqual(events,[])

    def test_bootstrap_has_fixed_source_closure_and_exact_four_channels(self):
        hashes={n:'a'*64 for n in x._SOURCE_NAMES}
        text=x._bootstrap(Path.cwd(),hashes,'a'*32,(10,11,12,13),1,('C:\\Python\\python.exe','b'*64))
        self.assertIn("'_aisb_owned_io'",text);self.assertIn('compile(b,m.__file__',text)
        self.assertNotIn('runpy',text);self.assertNotIn('pickle',text)
        for handles in ((10,11,12),(10,11,12,12),(10,11,12,0)):
            with self.assertRaises(x.OffloadAdmissionError):x._bootstrap(Path.cwd(),hashes,'a'*32,handles,1,('C:\\Python\\python.exe','b'*64))

    def launch(self,late=False,lost=False):
        owner=self.session();a=self.api(owner);k=LaunchKernel(owner);a.k=k
        k.late=late;k.lost=lost
        self.activate(owner)
        return owner,k

    def launch_scopes(self,owner,k):
        for scope in (patch.object(x,'_runtime_image',return_value=(k.runtime,hashlib.sha256(k.image).hexdigest())),
                      patch.object(x,'_read_source',return_value=k.image),
                      patch.object(C,'get_last_error',side_effect=lambda:k.error,create=True)):
            scope.start();self.addCleanup(scope.stop)

    def test_actual_launcher_uses_four_creation_time_handles_and_original_job(self):
        owner,k=self.launch();self.launch_scopes(owner,k);owner._launch(owner.active)
        handles=next(v for kind,v in k.updates if kind==0x20002)
        jobs=next(v for kind,v in k.updates if kind==0x2000d)
        self.assertEqual(handles,tuple(owner.channels[n]._number for n in ('request-read','response-write','ready','dispatch')))
        self.assertEqual(jobs,(owner.job.value,));self.assertNotIn(owner.job.value,handles)
        self.assertEqual(len(handles),len(set(handles)));self.assertEqual(len(handles),4)
        image,command,inherit,flags,startup=k.creations[0]
        self.assertEqual(image,str(k.runtime));self.assertIn(' -I -S -B -c ',command)
        self.assertEqual(inherit,1);self.assertEqual(flags,0x80000|4|0x400|8)
        st=x._StartupEx.from_buffer_copy(startup).startup
        self.assertEqual(st.flags,0);self.assertIsNone(st.stdin);self.assertIsNone(st.stdout);self.assertIsNone(st.stderr)
        self.assertEqual(k.resumes,[owner.primary_thread.value]);self.assertTrue(owner.attribute_retired)
        self.assertEqual(k.delete_attributes,1)
        self.assertEqual(k.closed,[owner.channels['request-read']._number,owner.channels['response-write']._number])
        self.assertFalse(owner.uncertain);self.assertTrue(owner.channels['dispatch'].value in k.events)

    def test_late_create_completion_never_issues_resume_or_new_child_dispatch(self):
        owner,k=self.launch(late=True);self.launch_scopes(owner,k)
        with self.assertRaises(x.OffloadAdmissionError):owner._launch(owner.active)
        self.assertEqual(len(k.creations),1);self.assertGreater(owner.process.value,0)
        self.assertTrue(owner.active.expired);self.assertEqual(k.resumes,[]);self.assertEqual(k.closed,[])
        self.assertFalse(k.events[owner.channels['dispatch'].value].is_set())
        self.assertIs(x._OWNERS[id(owner)],owner)

    def test_lost_create_ack_retains_original_process_output_before_handoff(self):
        owner,k=self.launch(lost=True);self.launch_scopes(owner,k)
        with self.assertRaises(KeyboardInterrupt):owner._launch(owner.active)
        self.assertTrue(owner.uncertain);self.assertGreater(owner.process_info.process,0)
        self.assertIsNone(owner.process.slot.value);self.assertIsNone(owner.primary_thread.slot.value)
        pending=owner.calls[-1];self.assertTrue(pending.started);self.assertFalse(pending.returned)
        self.assertTrue(any(v is owner.process_info for v in pending.keep))
        self.assertTrue(any(v is owner.process for v in pending.keep))
        self.assertEqual(k.resumes,[]);self.assertEqual(k.closed,[])

    def test_preallocated_terminal_capacity_is_atomic_and_survives_normal_exhaustion(self):
        owner=self.session();a=self.api(owner);owner.ledger.used=x._MAX_CALLS-1
        ready=Event();go=Event();results=[]
        def run():
            ready.set();go.wait(1)
            try:a.call(lambda:1);results.append('admitted')
            except x.OffloadAdmissionError:results.append('denied')
        threads=[Thread(target=run) for _ in range(2)]
        for t in threads:t.start()
        self.assertTrue(ready.wait(1));go.set()
        for t in threads:t.join(1);self.assertFalse(t.is_alive())
        self.assertCountEqual(results,['admitted','denied'])
        self.assertIs(owner.calls[0],owner.ledger.normal[-1])
        for i in range(x._TERMINAL_CALLS):
            self.assertEqual(a.call(lambda:1,terminal=True),1)
            self.assertIs(owner.calls[-1],owner.ledger.terminal[i])
        called=[]
        with self.assertRaises(x.OffloadAdmissionError):a.call(lambda:called.append(True),terminal=True)
        self.assertEqual(called,[])

    def test_busy_admission_never_waits_for_another_caller_lock(self):
        owner=self.session();held=Event();release=Event()
        def hold():
            with owner._state_lock:held.set();release.wait(1)
        t=Thread(target=hold);t.start();self.assertTrue(held.wait(1))
        try:
            with patch.object(owner,'_start') as start,self.assertRaises(x.OffloadAdmissionError):owner.prepare()
            start.assert_not_called();self.assertFalse(owner.busy);self.assertIsNone(owner.active)
        finally:release.set();t.join(1)

    def test_crt_callback_before_return_cannot_pass_unacknowledged_start_latch(self):
        owner=self.session();a=self.api(owner);k=LaunchKernel(owner);a.k=k;a.thread_callback=lambda f:f
        self.activate(owner);entered=Event();exited=Event();observed=[];threads=[]
        def wait(count,handles,all_,timeout):
            entered.set();return 0 if k.events[handles[0]].wait(1) else 258
        k.WaitForMultipleObjects=wait;k.GetCurrentThreadId=lambda:42
        def begin(sa,size,callback,arg,flags,out):
            def run():
                observed.append(callback(arg));exited.set()
            t=Thread(target=run,daemon=True);threads.append(t);t.start()
            self.assertTrue(entered.wait(1));self.assertIsNone(owner.controller.slot.value)
            self.assertIs(owner.callback,callback);self.assertIs(owner.calls[-2].keep[0],callback)
            out._obj.value=42;return 500
        a.begin=begin
        def launch(request):
            self.assertEqual(owner.controller.value,500);self.assertEqual(owner.thread_id.value,42)
            self.assertTrue(owner.calls[3].acknowledged);raise x.OffloadAdmissionError()
        def install(value,bound):
            value.__dict__.update(a.__dict__);value._Native__origin=value
            self.assertIs(bound,owner);value.owner=bound
        with patch.object(x._Native,'__init__',install):
            # __new__, native-call custody, start latch and controller remain real.
            owner.api=None
            with patch.object(owner,'_launch',side_effect=launch):owner._start(owner.active);self.assertTrue(exited.wait(1))
        for t in threads:t.join(1)
        self.assertEqual(observed,[9]);self.assertTrue(owner.uncertain and owner.stop_requested)
        self.assertIs(x._OWNERS[id(owner)],owner)

    def test_partial_pipe_io_preserves_exact_buffers_and_refuses_zero_progress(self):
        owner=self.session();a=self.api(owner);request=self.activate(owner)
        h=self.handle(owner,'pipe',40);incoming=bytearray(b'abcdef');written=[]
        def read(handle,buffer,size,count,overlapped):
            n=min(size,2);data=bytes(incoming[:n]);del incoming[:n]
            C.memmove(buffer,data,len(data));count._obj.value=len(data);return 1
        def write(handle,buffer,size,count,overlapped):
            count._obj.value=1;written.append(C.string_at(buffer,1));return 1
        a.k=SimpleNamespace(ReadFile=read,WriteFile=write)
        self.assertEqual(owner._read_exact(h,6,request),b'abcdef')
        owner._write(h,b'xyz',request);self.assertEqual(b''.join(written),b'xyz')
        self.assertEqual(len(owner.calls),6)
        self.assertTrue(all(any(v is h for v in row.keep) for row in owner.calls))
        with self.assertRaises(x.OffloadAdmissionError):owner._read_exact(h,1,request)
        self.assertTrue(owner.calls[-1].acknowledged) # Native return is not IO progress.
        before=len(owner.calls)
        for size in (0,4097,True):
            with self.assertRaises(x.OffloadAdmissionError):owner._read_exact(h,size,request)
        self.assertEqual(len(owner.calls),before)

    def test_response_replay_cross_session_and_deadline_substitution_never_publish(self):
        owner=self.session();a=self.api(owner);request=self.activate(owner)
        owner.source_digest='b'*64;owner.channels={'request-write':self.handle(owner,'write',40),
                                                  'response-read':self.handle(owner,'read',41)}
        good={'v':1,'nonce':owner.nonce,'seq':0,'op':'initialize','body':{'state':'initialized'},
              'source_digest':owner.source_digest,'deadline_ns':request.deadline}
        for change in ({'nonce':'c'*32},{'seq':1,'op':'bind-read','body':{'state':'read-bound'}},
                       {'deadline_ns':request.deadline+1},{'source_digest':'c'*64},{'extra':'value'}):
            incoming=bytearray(x._frame({**good,**change}))
            def read(handle,buffer,size,count,overlapped):
                n=min(size,len(incoming));C.memmove(buffer,bytes(incoming[:n]),n);del incoming[:n];count._obj.value=n;return 1
            def write(handle,buffer,size,count,overlapped):count._obj.value=size;return 1
            a.k=SimpleNamespace(ReadFile=read,WriteFile=write)
            with self.subTest(change=change),self.assertRaises(x.OffloadAdmissionError):owner._exchange(request)
            self.assertFalse(request.returned or request.published or owner.core_retired)

    def test_closed_handle_reuse_and_closing_generation_never_get_to_native(self):
        owner=self.session();a=self.api(owner);calls=[];a.k=SimpleNamespace(CloseHandle=lambda n:calls.append(n) or 1)
        h=self.handle(owner,'one',40);a.close(h)
        with self.assertRaises(x.OffloadAdmissionError):h.value
        with self.assertRaises(x.OffloadAdmissionError):a.wait((h,),x.time.monotonic_ns()+x._BUDGET_NS)
        self.assertEqual(calls,[40])
        h2=self.handle(owner,'another',41);h2.close_started=True
        with self.assertRaises(x.OffloadAdmissionError):h2.value

    def test_null_crt_return_keeps_preowned_callback_output_and_no_start_signal(self):
        owner=self.session();template=self.api(owner);k=LaunchKernel(owner);template.k=k
        template.thread_callback=lambda fn:fn;template.begin=lambda *_:0
        self.activate(owner);owner.api=None
        def install(value,bound):
            value.__dict__.update(template.__dict__);value._Native__origin=value
        with patch.object(x._Native,'__init__',install),self.assertRaises(x.OffloadAdmissionError):owner._start(owner.active)
        self.assertTrue(owner.uncertain);self.assertIsNone(owner.controller.slot.value)
        self.assertIn(owner.callback,owner.buffers);self.assertFalse(k.events[owner.start_event._number].is_set())
        self.assertIs(owner.calls[-1].keep[0],owner.callback);self.assertIs(owner.calls[-1].keep[2],owner.controller)

    def test_finish_native_commit_survives_later_registry_handoff_interruption(self):
        class InterruptedPop(dict):
            def pop(self,key):super().pop(key);raise KeyboardInterrupt()
        owner=self.session();a=self.api(owner);k=LaunchKernel(owner);a.k=k
        owner.state='read-retired';owner.core_retired=True;owner.controller_finished=True
        for field in ('controller','start_event','request_event','completion_event'):
            setattr(owner,field,self.handle(owner,field,k.CreateEventW()))
        def wait(handles,deadline):
            request=owner.active;request.started=request.returned=request.published=request.signal_ack=True
            request.result='finished';return 0
        a.wait=wait
        def code(handle,out):out._obj.value=0;return 1
        k.GetExitCodeThread=code
        owner.active.consumed=True;owner.active=None
        with patch.object(x,'_OWNERS',InterruptedPop(x._OWNERS)),self.assertRaises(KeyboardInterrupt):owner.finish()
        self.assertTrue(owner.session_retired and owner.core_retired)
        self.assertFalse(owner.uncertain or owner.stop_requested or owner.active)
        self.assertEqual(owner.state,'finished');self.assertTrue(all(h.closed for h in owner.handles))

    @unittest.skipUnless(x.os.name=='nt','Windows ABI declaration test')
    def test_actual_native_constructor_checks_loaded_crt_and_declares_exact_abi(self):
        class Function:
            def __init__(self,name):self.name=name
            def __call__(self,*args):
                if self.name=='GetSystemDirectoryW':args[0].value='C:\\Windows\\System32';return len(args[0].value)
                if self.name=='GetModuleFileNameW':args[1].value=loaded[0];return len(args[1].value)
                return 1
        class Library:
            _handle=20
            def __getattr__(self,name):value=Function(name);setattr(self,name,value);return value
        image=bytearray(512);image[:2]=b'MZ';struct.pack_into('<I',image,0x3c,128)
        image[128:132]=b'PE\0\0';struct.pack_into('<H',image,132,0x8664);struct.pack_into('<H',image,152,0x20b)
        loaded=['C:\\Windows\\System32\\ucrtbase.dll']
        for mismatch in (False,True):
            with patch.dict(x._OWNERS,{},clear=True):
                owner=self.session();self.activate(owner);kernel=Library();crt=Library()
                loaded[0]='C:\\wrong\\ucrtbase.dll' if mismatch else 'C:\\Windows\\System32\\ucrtbase.dll'
                with patch.object(C,'WinDLL',return_value=kernel),patch.object(C,'CDLL',return_value=crt), \
                     patch.object(x,'_read_source',return_value=bytes(image)):
                    if mismatch:
                        with self.assertRaises(x.OffloadAdmissionError):x._Native(owner)
                        self.assertIs(owner.api.crt,crt);continue
                    a=x._Native(owner)
                self.assertIs(a.begin.restype,C.c_size_t)
                self.assertEqual(a.begin.argtypes,[x._PTR,x._U32,a.thread_callback,x._PTR,x._U32,C.POINTER(x._U32)])
                self.assertIs(a.timer_callback._argtypes_[1],C.c_ubyte)
                self.assertEqual(a.k.DeleteTimerQueueTimer.argtypes,[x._PTR,x._PTR,x._PTR])

    def test_unsupported_architecture_denies_before_loading_a_dll(self):
        owner=self.session()
        with patch.object(x.sysconfig,'get_platform',return_value='win-arm64'), \
             patch.object(C,'WinDLL',create=True) as load,self.assertRaises(x.OffloadAdmissionError):x._Native(owner)
        load.assert_not_called();self.assertIsNotNone(owner.api);self.assertEqual(owner.calls,[])

    def test_copied_controller_cannot_issue_wait_via_original_api(self):
        owner=self.session();self.activate(owner);calls=[]
        owner.api=SimpleNamespace(wait=lambda *args:calls.append(args) or 258)
        clone=copy.copy(owner)
        self.assertEqual(clone._controller_entry(None),9);self.assertEqual(calls,[])
        self.assertFalse(owner.uncertain or owner.stop_requested);self.assertEqual(owner.calls,[])

    def test_constructor_capacity_is_nonblocking_and_precedes_record_allocation(self):
        held=Event();release=Event()
        def hold():
            with x._LOCK:held.set();release.wait(1)
        t=Thread(target=hold);t.start();self.assertTrue(held.wait(1))
        try:
            with patch.object(x,'_Ledger') as pool,self.assertRaises(x.OffloadAdmissionError):self.session()
            pool.assert_not_called();self.assertEqual(x._OWNERS,{})
        finally:release.set();t.join(1)

    def test_partial_constructor_is_retained_without_native_readiness_or_new_allocation(self):
        with patch.object(x,'_Ledger',side_effect=MemoryError),self.assertRaises(MemoryError):self.session()
        owner=next(iter(x._OWNERS.values()))
        self.assertFalse(owner.initialized);self.assertIsNone(owner.api)
        with self.assertRaises(x.OffloadAdmissionError):owner.origin()
        with patch.object(x,'_Ledger') as pool,self.assertRaises(x.OffloadAdmissionError):self.session()
        pool.assert_not_called()

    def test_wrong_owned_child_image_denies_before_resume(self):
        owner,k=self.launch();self.launch_scopes(owner,k);k.query_image='C:\\other\\python.exe'
        with self.assertRaises(x.OffloadAdmissionError):owner._launch(owner.active)
        self.assertGreater(owner.process_info.process,0);self.assertEqual(k.resumes,[])
        self.assertFalse(owner.attribute_retired);self.assertEqual(k.closed,[])

    def test_terminal_completion_never_issues_another_idle_wait(self):
        owner=self.session();a=self.api(owner);self.activate(owner)
        owner.start_event=self.handle(owner,'start',40);owner.completion_event=self.handle(owner,'complete',41)
        owner.request_event=self.handle(owner,'request',42);owner.thread_id.value=7;idle=[]
        def signal(handle):owner.stop_requested=True;return 1
        def wait(*args):idle.append(args);return 0
        a.k=SimpleNamespace(GetCurrentThreadId=lambda:7,SetEvent=signal,WaitForSingleObject=wait)
        a.wait=lambda *_:0
        with patch.object(owner,'_launch'),patch.object(owner,'_exchange',return_value='initialized'):
            self.assertEqual(owner._controller_entry(None),9)
        self.assertEqual(idle,[]);self.assertTrue(owner.active.signal_ack)
        self.assertTrue(owner.uncertain and owner.stop_requested)

    def completed_request(self):
        owner=self.session();a=self.api(owner);request=owner.active
        request.started=request.returned=request.published=request.signal_ack=True
        request.result='initialized';owner.state='initialized';owner.controller_ident=get_ident()
        owner.request_event=self.handle(owner,'request',42)
        calls=[];a.k=SimpleNamespace(WaitForSingleObject=lambda *args:calls.append(args) or 0)
        return owner,a,request,calls

    def test_successful_signal_consuming_deadline_never_commits_an_idle_wait(self):
        owner=self.session();a=self.api(owner);request=owner.active;clock=[x.time.monotonic_ns()];idle=[]
        owner.start_event=self.handle(owner,'start',40);owner.completion_event=self.handle(owner,'complete',41)
        owner.request_event=self.handle(owner,'request',42);owner.thread_id.value=7
        def signal(handle):clock[0]=request.deadline+1;return 1
        a.k=SimpleNamespace(GetCurrentThreadId=lambda:7,SetEvent=signal,WaitForSingleObject=lambda *args:idle.append(args) or 0)
        a.wait=lambda *_:0
        with patch.object(x.time,'monotonic_ns',side_effect=lambda:clock[0]),patch.object(owner,'_launch'), \
             patch.object(owner,'_exchange',return_value='initialized'):
            self.assertEqual(owner._controller_entry(None),9)
        self.assertEqual(idle,[]);self.assertIsNone(request.idle_intent)
        self.assertTrue(owner.uncertain and owner.stop_requested and request.expired)

    def test_terminal_before_intent_blocks_call_but_later_terminal_cannot_erase_committed_intent(self):
        owner,a,request,calls=self.completed_request();perform=a._perform
        def terminal_after_commit(row):
            self.assertTrue(row.committed);self.assertIs(request.idle_intent,row)
            owner._fence()
            self.assertFalse(owner._state_lock._is_owned());self.assertFalse(owner.ledger.lock._is_owned())
            return perform(row)
        with patch.object(a,'_perform',side_effect=terminal_after_commit):self.assertEqual(a.idle_wait(request),0)
        row=request.idle_intent
        self.assertTrue(row.started and row.returned and row.acknowledged and row.committed)
        self.assertEqual(calls,[(42,0xffffffff)]);self.assertTrue(owner.uncertain and request.expired)
        self.assertFalse(request.consumed)
        with self.assertRaises(x.OffloadAdmissionError):a.idle_wait(request)
        self.assertEqual(len(calls),1)

    def test_terminal_winning_gate_before_intent_has_no_native_effect(self):
        owner,a,request,calls=self.completed_request();owner._fence()
        with self.assertRaises(x.OffloadAdmissionError):a.idle_wait(request)
        self.assertEqual(calls,[]);self.assertIsNone(request.idle_intent);self.assertEqual(owner.calls,[])

    def test_consumed_request_supports_idle_beyond_old_deadline_and_preserves_next_request(self):
        owner,a,request,calls=self.completed_request();request.consumed=True;owner.active=None
        with patch.object(x.time,'monotonic_ns',return_value=request.deadline+121*10**9):
            self.assertEqual(a.idle_wait(request),0)
        self.assertEqual(calls,[(42,0xffffffff)]);self.assertEqual(request.idle_intent.payload[6],'idle-consumed')
        self.assertFalse(owner.uncertain);self.assertTrue(request.consumed)
        with self.assertRaises(x.OffloadAdmissionError):a.idle_wait(request)
        with self.assertRaises(x.OffloadAdmissionError):a.idle_wait(copy.copy(request))
        self.assertEqual(len(calls),1);self.assertFalse(owner.uncertain)

    def test_native_intent_payload_copy_replay_and_mutated_handle_deny_without_foreign_effect(self):
        owner=self.session();a=self.api(owner);h=self.handle(owner,'value',40);calls=[]
        def delayed(row):
            with self.assertRaises(x.OffloadAdmissionError):x._Native._perform(a,copy.copy(row))
            self.assertFalse(owner.uncertain)
            return x._Native._perform(a,row)
        with patch.object(a,'_perform',side_effect=delayed):self.assertEqual(a.call(lambda n:calls.append(n) or 1,h.value,keep=(h,h.slot)),1)
        self.assertEqual(calls,[40]);row=owner.calls[0]
        with self.assertRaises(x.OffloadAdmissionError):a._perform(row)
        self.assertEqual(calls,[40]);self.assertFalse(owner.uncertain)

    def test_changed_live_handle_permanently_fences_original_intent_before_dispatch(self):
        owner=self.session();a=self.api(owner);h=self.handle(owner,'value',40);calls=[]
        def changed(row):
            h.slot.value=41
            return x._Native._perform(a,row)
        with patch.object(a,'_perform',side_effect=changed),self.assertRaises(x.OffloadAdmissionError):
            a.call(lambda n:calls.append(n) or 1,h.value,keep=(h,h.slot))
        row=owner.calls[0]
        self.assertTrue(row.committed and row.integrity_lost);self.assertFalse(row.started)
        self.assertTrue(owner.uncertain and owner.stop_requested and owner.active.expired)
        h.slot.value=40
        with self.assertRaises(x.OffloadAdmissionError):a._perform(row)
        self.assertEqual(calls,[]);self.assertIs(x._OWNERS[id(owner)],owner)

    def test_finite_wait_recomputes_remaining_timeout_at_intent_commit(self):
        owner=self.session();a=self.api(owner);request=owner.active;h=self.handle(owner,'wait',40)
        clock=[request.deadline-10_000_000_000];calls=[];reserve=owner.ledger.reserve
        def delayed(*args):
            row=reserve(*args);clock[0]+=6_000_000_000;return row
        a.k=SimpleNamespace(WaitForMultipleObjects=lambda *args:calls.append(args) or 258)
        with patch.object(x.time,'monotonic_ns',side_effect=lambda:clock[0]),patch.object(owner.ledger,'reserve',side_effect=delayed):
            self.assertEqual(a.wait((h,),request.deadline),258)
        self.assertEqual(calls[0][-1],4000)
        self.assertEqual(owner.calls[0].payload[7],clock[0])


if __name__=='__main__':unittest.main()
