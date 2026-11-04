"""Model-free private session/ABI regressions; no Windows qualification."""
import copy
import ctypes as C
import gc
import json
import hashlib
import pickle
from pathlib import Path
import struct
import sys
from io import BytesIO
from threading import Event, Thread, get_ident
from types import SimpleNamespace
import unittest
import weakref
from unittest.mock import Mock, patch

from modules.adapters.runtime.python.worker.tasks import windows_offload_execution as x
from modules.adapters.runtime.python.worker.tasks import windows_offload_execution_child as child_module


class LaunchKernel:
    """Synthetic ABI only. No process, Windows thread, Job or pipe is created."""
    def __init__(self,owner):
        self.owner=owner;self.next=100;self.flags={};self.events={};self.updates=[];self.creations=[]
        self.error=0;self.resumes=[];self.closed=[];self.delete_attributes=0;self.late=False;self.lost=False
        self.runtime=Path('C:/Python/python.exe');self.image=b'synthetic runtime image'
        for name in('CreateProcessW','CreatePipe','GetHandleInformation','SetInformationJobObject',
                    'IsProcessInJob','QueryInformationJobObject','QueryFullProcessImageNameW',
                    'InitializeProcThreadAttributeList','UpdateProcThreadAttribute',
                    'DeleteProcThreadAttributeList','GetWindowsDirectoryW','GetProcessId','ResumeThread'):
            setattr(self,name,getattr(self,name))
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


class RetirementKernel(LaunchKernel):
    """Owned test threads and synthetic handles; no native process or file IO."""
    def __init__(self,owner):
        super().__init__(owner)
        self.effects=[];self.errors={};self.threads={};self.codes={};self.tids={}
        self.process_finished=False;self.fail_close=None;self.begin_failure=None
        self.bad_active=self.bad_total=False;self.controller_code=9
        self.force_reaper_timeout=False;self.body_returned=Event();self.reaper_exit=Event();self.reaper_exit.set()
        self.io_ready=Event();self.io_release=Event();self.cancel_not_found=False
        self.release_on_cancel=self.release_on_kill=True
        self.controller_mode=None;self.return_io_success=False;self.force_controller_timeout=False
        self.block_close=None;self.close_entered=Event();self.close_release=Event();self.close_release.set()
        self.caller_wait_started=Event();self.signal_pending_at_close=False
        # ctypes DLL functions are cached objects. Preserve that identity in
        # this synthetic ABI rather than manufacturing fresh bound methods.
        for name in ('CreateEventW','WaitForMultipleObjects','WaitForSingleObject','SetEvent','GetCurrentThreadId',
                     'CancelSynchronousIo','TerminateJobObject','GetExitCodeThread','GetExitCodeProcess',
                     'QueryInformationJobObject','CloseHandle','ReadFile','WriteFile'):
            setattr(self,name,getattr(self,name))

    def begin(self,sa,size,callback,arg,flags,out):
        self.effects.append('begin')
        if self.begin_failure=='zero':return 0
        number=self.handle();out._obj.value=42
        def run():
            self.tids[get_ident()]=42
            try:self.codes[number]=callback(arg)
            finally:self.body_returned.set();self.reaper_exit.wait(2)
        thread=Thread(target=run,daemon=True);self.threads[number]=thread;thread.start()
        if self.begin_failure=='interrupt':raise KeyboardInterrupt()
        return number

    def WaitForMultipleObjects(self,count,handles,all_,timeout):
        numbers=tuple(handles[:count]);owner=self.owner
        if count==2 and owner.terminal is None:
            if self.controller_mode:
                request=owner.active
                if self.controller_mode=='idle':
                    request.started=request.returned=request.published=request.signal_ack=True
                    request.result='initialized'
                self.start_original_controller(request)
                if not self.io_ready.wait(1):return 258
                return 0 if self.controller_mode=='idle' else 258
            return 258
        number=numbers[0]
        if number in self.threads:
            if number==owner.controller._number and self.force_controller_timeout:return 258
            reaper=getattr(owner.terminal,'reaper',None)
            if reaper is not None and number==reaper._number:self.caller_wait_started.set()
            if self.force_reaper_timeout:self.body_returned.wait(1);return 258
            self.threads[number].join(min(timeout/1000,1))
            return 258 if self.threads[number].is_alive() else 0
        if owner.controller is not None and number==owner.controller._number:return 0 if self.process_finished else 258
        if owner.process is not None and number==owner.process._number:return 0 if self.process_finished else 258
        if owner.channels.get('ready') is not None and number==owner.channels['ready']._number:return 0
        return 0 if self.events[number].wait(min(timeout/1000,1)) else 258

    def WaitForSingleObject(self,number,timeout):
        self.io_ready.set()
        return 0 if self.events[number].wait(1) else 258

    def SetEvent(self,number):
        if self.owner.terminal is not None:self.effects.append(('signal',number))
        result=super().SetEvent(number)
        if (self.owner.terminal is not None and number==self.owner.terminal.start._number
                and self.block_close is not None):self.close_entered.wait(1)
        return result

    def start_original_controller(self,request):
        owner=self.owner;number=owner.controller._number
        def run():
            owner.controller_ident=get_ident();self.tids[get_ident()]=17
            try:
                if self.controller_mode=='idle':owner.api.idle_wait(request)
                else:
                    h=owner.channels['response-read'];data=C.create_string_buffer(1);count=x._U32()
                    owner.buffers.extend((data,count))
                    owner.api.call(self.ReadFile,h.value,C.byref(data),1,C.byref(count),None,keep=(h,data,count))
                owner._live(request)  # A late return cannot resume source work.
            except BaseException:pass
            finally:self.codes[number]=9
        thread=Thread(target=run,daemon=True);self.threads[number]=thread;thread.start()

    def GetCurrentThreadId(self):return self.tids.get(get_ident(),17)

    def CancelSynchronousIo(self,number):
        self.effects.append(('cancel',number))
        if self.release_on_cancel:self.io_release.set()
        self.errors[get_ident()]=1168 if self.cancel_not_found else 0
        return 0 if self.cancel_not_found else 1

    def TerminateJobObject(self,number,code):
        self.effects.append(('terminate',number,code));self.process_finished=True
        if self.release_on_kill:self.io_release.set()
        return 1

    def GetExitCodeThread(self,number,out):
        out._obj.value=self.codes.get(number,self.controller_code if self.process_finished else 259);return 1

    def GetExitCodeProcess(self,number,out):out._obj.value=9 if self.process_finished else 259;return 1

    def QueryInformationJobObject(self,job,kind,out,size,returned):
        if kind==9:return super().QueryInformationJobObject(job,kind,out,size,returned)
        out._obj.active=1 if self.bad_active or not self.process_finished else 0
        out._obj.total=2 if self.bad_total else 1
        return 1

    def CloseHandle(self,number):
        if self.owner.terminal is not None:self.effects.append(('close',number))
        if self.owner.terminal is not None and number==self.block_close:
            self.signal_pending_at_close=not self.owner.terminal.used['signal-start'].returned
            self.close_entered.set();self.close_release.wait(2)
        if number==self.fail_close:return 0
        return super().CloseHandle(number)

    def ReadFile(self,handle,buffer,size,count,overlapped):
        self.io_ready.set();self.io_release.wait(2)
        if self.return_io_success:
            C.memmove(buffer,b'x',1);count._obj.value=1;self.errors[get_ident()]=0;return 1
        count._obj.value=0;self.errors[get_ident()]=995;return 0

    def WriteFile(self,*args):return self.ReadFile(*args)

    def finish_test_threads(self):
        self.io_release.set();self.reaper_exit.set()
        self.close_release.set()
        for event in self.events.values():event.set()
        for thread in self.threads.values():thread.join(2)


class StartupKernel(RetirementKernel):
    """Real parent controller/launch flow, with a child that never signals ready."""
    def __init__(self,owner):
        super().__init__(owner);self.ready_entered=Event();self.ready_release=Event();self.hold_ready=False;self.signal_ready=False
    def WaitForMultipleObjects(self,count,handles,all_,timeout):
        numbers=tuple(handles[:count]);owner=self.owner
        if owner.terminal is None and count==2:
            thread=self.threads.get(owner.controller._number)
            if thread is not None:
                thread.join(1)
                return 1 if not thread.is_alive()else 258
            return 258
        ready=owner.channels.get('ready')
        if ready is not None and count==1 and numbers==(ready._number,):
            self.ready_entered.set()
            if self.hold_ready:self.ready_release.wait(10)
            return 0 if self.signal_ready else 258
        return super().WaitForMultipleObjects(count,handles,all_,timeout)
    def finish_test_threads(self):
        self.ready_release.set();super().finish_test_threads()


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

    def return_case(self,role):
        if role=='parent':
            owner=self.session();return owner,self.api(owner)
        # An explicit new synthetic child origin; no constructor/OS effect.
        owner=object.__new__(child_module._Child);owner._Child__origin=owner
        owner.api=None;owner.calls=[];owner.handles=[];owner.buffers=[];owner.uncertain=False
        owner.ledger=x._Ledger(owner)
        self.enterContext(patch.object(child_module,'_CHILD',owner))
        a=object.__new__(x._Native);a._Native__origin=a;a.owner=owner;owner.api=a
        return owner,a

    def activate(self,owner,seq=0):
        request=x._Request(owner,seq);owner.requests.append(request);owner.active=request;return request

    def handle(self,owner,name,number):
        h=x._Handle(owner,name);owner.handles.append(h);h.slot.value=number;h.acknowledge();return h

    def failed_retirement_session(self,controller_mode=None):
        owner=self.session();a=self.api(owner);owner.requests.clear();owner.active=None
        k=RetirementKernel(owner);a.k=k;a.thread_callback=lambda fn:fn;a.begin=k.begin
        k.controller_mode=controller_mode
        for scope in (patch.object(x,'_runtime_image',return_value=(k.runtime,hashlib.sha256(k.image).hexdigest())),
                      patch.object(x,'_read_source',return_value=k.image),
                      patch.object(C,'get_last_error',side_effect=lambda:k.errors.get(get_ident(),k.error),create=True)):
            scope.start();self.addCleanup(scope.stop)
        self.addCleanup(k.finish_test_threads)
        def start(request):
            owner.controller_ident=17;owner.thread_id.value=17
            for field in ('start_event','request_event','completion_event','controller'):
                setattr(owner,field,a.acquire(field,k.CreateEventW,None,1,0,None))
            # The production launch/handle/Job/attribute implementation runs;
            # only its OS ABI is synthetic. The caller then observes timeout.
            owner._launch(request)
        with patch.object(owner,'_start',side_effect=start):
            if controller_mode=='idle':owner.prepare();owner._fence()
            else:
                with self.assertRaises(x.OffloadAdmissionError):owner.prepare()
        self.assertTrue(owner.launch_complete and owner.uncertain)
        self.assertEqual(len(owner.handles),13)
        return owner,a,k

    def failed_startup_session(self,hold_ready=False,ready=False,owner=None):
        owner=self.session()if owner is None else owner;k=StartupKernel(owner)
        k.hold_ready=hold_ready;k.signal_ready=ready
        self.addCleanup(k.finish_test_threads)
        def construct(api,original):
            api._Native__origin=api;api.owner=original;api.k=k
            api.thread_callback=lambda fn:fn;api.timer_callback=lambda fn:fn;api.begin=k.begin
            api._original_ledger()
        for scope in(patch.object(x._Native,'__init__',construct),
                     patch.object(x,'_runtime_image',return_value=(k.runtime,hashlib.sha256(k.image).hexdigest())),
                     patch.object(x,'_read_source',return_value=k.image),
                     patch.object(C,'get_last_error',side_effect=lambda:k.errors.get(get_ident(),k.error),create=True)):
            self.enterContext(scope)
        if ready:self.enterContext(patch.object(owner,'_exchange',side_effect=x.OffloadAdmissionError))
        with self.assertRaises(x.OffloadAdmissionError):owner.prepare()
        self.assertIs(owner.launch_complete,ready);self.assertTrue(owner.uncertain and owner.stop_requested)
        self.assertEqual(len(owner.handles),13);self.assertTrue(k.ready_entered.is_set())
        return owner,owner.api,k

    def test_real_parent_can_explicitly_retire_known_child_failure_before_ready(self):
        owner,a,k=self.failed_startup_session()
        self.assertFalse(any(isinstance(v,tuple)and v[0]=='terminate'for v in k.effects))
        self.assertIsNone(owner.retire_failed())
        self.assertTrue(owner.session_retired and owner.terminal_retired)
        self.assertEqual(owner.state,'failed-retired');self.assertNotIn(id(owner),x._OWNERS)
        self.assertEqual(k.effects.count(('terminate',owner.job._number,9)),1)
        self.assertFalse(any(isinstance(v,tuple)and v[0]=='cancel'for v in k.effects))
        self.assertEqual(len(owner.handles),15);self.assertTrue(all(h.closed for h in owner.handles))

    def test_original_ready_and_dispatch_proof_preserves_real_full_launch_retirement(self):
        owner,a,k=self.failed_startup_session(ready=True)
        marker=owner._WindowsOffloadIoSession__startup
        self.assertIsNotNone(marker._KnownStartup__ready_rows);self.assertTrue(owner.launch_complete)
        self.assertIsNone(owner.retire_failed());self.assertTrue(owner.session_retired)

    def test_startup_public_flags_missing_resume_or_slot_drift_cannot_admit_cleanup(self):
        for mode in('forged-launch','missing-marker','resume-result','slot-generation','effect-exit'):
            with self.subTest(mode=mode),patch.dict(x._OWNERS,{},clear=True):
                owner,a,k=self.failed_startup_session();before=list(k.effects)
                if mode=='forged-launch':owner.launch_complete=True
                elif mode=='missing-marker':owner._WindowsOffloadIoSession__startup=None;owner.launch_complete=True
                elif mode=='resume-result':next(r for r in owner.calls if r.function is a.k.ResumeThread).result=0
                elif mode=='slot-generation':
                    h=owner.process;h.slot=h._original_slot=x._PTR(h._number)
                    owner._handle_bindings[id(h)]=(h,h.slot,h._number)
                else:
                    request=owner.requests[0];entry=owner._effect_exits[id(request)]
                    owner._effect_exits[id(request)]=(*entry[:3],False)
                with self.assertRaises(x.OffloadAdmissionError):owner.retire_failed()
                self.assertIsNone(owner.terminal);self.assertEqual(k.effects,before)

    def test_pending_ready_wait_is_not_cancelled_or_treated_as_controller_exit(self):
        owner,a,k=self.failed_startup_session(hold_ready=True)
        with self.assertRaises(x.OffloadAdmissionError):owner.retire_failed()
        self.assertFalse(owner.session_retired or owner.terminal.has_final_proof())
        self.assertTrue(any(kind=='ready'for _,kind in owner.terminal.pending))
        self.assertFalse(any(isinstance(v,tuple)and v[0]in('cancel','close')for v in k.effects))
        self.assertEqual(k.effects.count(('terminate',owner.job._number,9)),1)
        self.assertFalse(k.ready_release.is_set())

    def test_retirement_getter_cannot_turn_actual_active_job_into_empty_job(self):
        owner,a,k=self.failed_startup_session();k.bad_active=True;changed=[]
        def reader():
            terminal=owner.terminal
            if terminal is not None and 'job-empty'in terminal.used and not changed:
                row=terminal.used['job-empty']
                if row.started and not row.returned:
                    changed.append(1);terminal.accounting.active=0
            return k.errors.get(get_ident(),k.error)
        C.get_last_error.side_effect=reader
        with self.assertRaises(x.OffloadAdmissionError):owner.retire_failed()
        self.assertEqual(changed,[1]);self.assertFalse(owner.session_retired)
        row=owner.terminal.used['job-empty'];raw=owner.ledger._retained_return(row,a)
        self.assertEqual(x._Accounting.from_buffer_copy(raw.outputs[0]).active,1)
        self.assertFalse(row.acknowledged)
        self.assertFalse(any(isinstance(v,tuple)and v[0]=='close'for v in k.effects))

    def test_retirement_uses_original_output_after_perform_observer_changes_same_buffer(self):
        owner,a,k=self.failed_startup_session();k.bad_active=True;perform=a._perform
        def changed(row):
            value=perform(row)
            if row.function is a.k.QueryInformationJobObject and row.args[1]==1:
                row.keep[-1].active=0
            return value
        with patch.object(a,'_perform',side_effect=changed),self.assertRaises(x.OffloadAdmissionError):owner.retire_failed()
        self.assertFalse(owner.session_retired)
        row=owner.terminal.used['job-empty'];raw=owner.ledger._retained_return(row,a)
        self.assertEqual(x._Accounting.from_buffer_copy(raw.outputs[0]).active,1)
        self.assertFalse(any(isinstance(v,tuple)and v[0]=='close'for v in k.effects))

    def test_terminal_retirement_closes_only_the_original_failed_session(self):
        owner,a,k=self.failed_retirement_session();request=owner.requests[-1]
        self.assertIsNone(owner.retire_failed())
        self.assertEqual(owner.state,'failed-retired')
        self.assertTrue(owner.session_retired and owner.terminal_retired)
        self.assertFalse(owner.core_retired or request.consumed)
        self.assertTrue(request.expired);self.assertNotIn(id(owner),x._OWNERS)
        self.assertEqual(len(owner.handles),15);self.assertTrue(all(h.closed for h in owner.handles))
        self.assertEqual(k.effects.count(('terminate',owner.job._number,9)),1)
        self.assertFalse(any(isinstance(v,tuple) and v[0]=='cancel' for v in k.effects))
        self.assertLessEqual(len(owner.terminal.calls),48)
        self.assertTrue(all(row.acknowledged for row in owner.terminal.calls))
        next_owner=self.session();before=list(k.effects)
        self.assertIsNone(owner.retire_failed())
        self.assertIs(x._OWNERS[id(next_owner)],next_owner);self.assertEqual(k.effects,before)

    def test_missing_effect_exit_or_partial_launch_denies_before_a_terminal_attempt(self):
        owner,a,k=self.failed_retirement_session();request=owner.requests[-1]
        entry=owner._effect_exits[id(request)];owner._effect_exits[id(request)]=(*entry[:3],False)
        with self.assertRaises(x.OffloadAdmissionError):owner.retire_failed()
        self.assertIsNone(owner.terminal);self.assertEqual(k.effects,[])
        owner._effect_exits[id(request)]=entry;owner.launch_complete=False
        with self.assertRaises(x.OffloadAdmissionError):owner.retire_failed()
        self.assertIsNone(owner.terminal);self.assertEqual(k.effects,[])

    def test_lost_original_slot_generation_denies_before_terminal_effects(self):
        owner,a,k=self.failed_retirement_session();owner.job.slot=x._PTR(owner.job._number)
        with self.assertRaises(x.OffloadAdmissionError):owner.retire_failed()
        self.assertIsNone(owner.terminal);self.assertEqual(k.effects,[])

    def test_reaper_start_failure_is_retained_and_never_reissued(self):
        owner,a,k=self.failed_retirement_session();k.begin_failure='zero'
        with self.assertRaises(x.OffloadAdmissionError):owner.retire_failed()
        self.assertIs(x._OWNERS[id(owner)],owner);self.assertFalse(owner.session_retired)
        self.assertEqual(k.effects,['begin']);before=list(k.effects)
        with self.assertRaises(x.OffloadAdmissionError):owner.retire_failed()
        self.assertEqual(k.effects,before)

    def test_actual_reaper_exit_is_required_even_after_its_body_finishes(self):
        owner,a,k=self.failed_retirement_session();k.force_reaper_timeout=True;k.reaper_exit.clear()
        with self.assertRaises(x.OffloadAdmissionError):owner.retire_failed()
        self.assertTrue(owner.terminal.body_done)
        self.assertFalse(owner.terminal.reaper.closed or owner.session_retired)
        self.assertIs(x._OWNERS[id(owner)],owner)

    def test_unconfirmed_original_close_is_never_retried_or_released(self):
        owner,a,k=self.failed_retirement_session();k.fail_close=owner.start_event._number
        with self.assertRaises(x.OffloadAdmissionError):owner.retire_failed()
        self.assertTrue(owner.start_event.close_started);self.assertFalse(owner.start_event.closed)
        self.assertIs(x._OWNERS[id(owner)],owner);before=list(k.effects)
        with self.assertRaises(x.OffloadAdmissionError):owner.retire_failed()
        self.assertEqual(k.effects,before)

    def test_job_active_or_wrong_lifetime_count_prevents_every_original_close(self):
        for field in ('bad_active','bad_total'):
            with self.subTest(field=field),patch.dict(x._OWNERS,{},clear=True):
                owner,a,k=self.failed_retirement_session();setattr(k,field,True)
                with self.assertRaises(x.OffloadAdmissionError):owner.retire_failed()
                self.assertFalse(any(isinstance(v,tuple) and v[0]=='close' for v in k.effects))
                self.assertFalse(owner.session_retired);k.finish_test_threads()

    def test_canceled_io_settles_before_close_without_passing_the_failed_request(self):
        owner,a,k=self.failed_retirement_session('io');request=owner.requests[-1]
        pending=next(row for row in owner.ledger.rows if row.started and not row.returned)
        self.assertIs(pending.function,k.ReadFile)
        self.assertIsNone(owner.retire_failed())
        self.assertEqual(owner.ledger.settled(pending,a)[1:3],(0,995))
        self.assertFalse(pending.acknowledged or request.consumed or owner.core_retired)
        self.assertEqual(k.effects.count(('cancel',owner.controller._number)),1)
        self.assertTrue(owner.terminal_retired and all(h.closed for h in owner.handles))

    def test_not_found_cancel_and_normal_io_return_do_not_invent_an_abort_or_task_pass(self):
        owner,a,k=self.failed_retirement_session('io');k.cancel_not_found=True;k.return_io_success=True
        request=owner.requests[-1];pending=next(row for row in owner.ledger.rows if row.started and not row.returned)
        self.assertIsNone(owner.retire_failed())
        self.assertEqual(owner.ledger.settled(pending,a)[1:3],(1,0));self.assertTrue(pending.acknowledged)
        cancel=owner.terminal.used['cancel-io'];self.assertEqual(owner.ledger.settled(cancel,a)[1:3],(0,1168))
        self.assertFalse(request.consumed);self.assertEqual(owner.state,'failed-retired')

    def test_cancel_and_job_requests_without_original_io_exit_cannot_release_or_close(self):
        owner,a,k=self.failed_retirement_session('io')
        k.release_on_cancel=k.release_on_kill=False;k.force_controller_timeout=True
        with self.assertRaises(x.OffloadAdmissionError):owner.retire_failed()
        self.assertFalse(owner.session_retired)
        self.assertFalse(any(isinstance(v,tuple) and v[0]=='close' for v in k.effects))
        self.assertIs(x._OWNERS[id(owner)],owner);before=list(k.effects)
        with self.assertRaises(x.OffloadAdmissionError):owner.retire_failed()
        self.assertEqual(k.effects,before)

    def test_consumed_idle_wait_gets_one_refusal_wake_and_no_io_cancel(self):
        owner,a,k=self.failed_retirement_session('idle');request=owner.requests[-1]
        self.assertTrue(request.consumed and request.idle_intent.started and not request.idle_intent.returned)
        self.assertIsNone(owner.retire_failed())
        self.assertEqual(k.effects.count(('signal',owner.request_event._number)),1)
        self.assertFalse(any(isinstance(v,tuple) and v[0]=='cancel' for v in k.effects))
        self.assertTrue(request.consumed and owner.terminal_retired)
        self.assertEqual(owner.ledger.settled(request.idle_intent,a)[1],0)

    def test_pruned_active_list_does_not_hide_the_original_lifetime_io_intent(self):
        owner,a,k=self.failed_retirement_session('io')
        pending=next(row for row in owner.ledger.rows if row.started and not row.returned)
        owner.calls.remove(pending)
        self.assertIsNone(owner.retire_failed())
        self.assertIs(owner.terminal.pending[0][0],pending)
        self.assertEqual(k.effects.count(('cancel',owner.controller._number)),1)
        self.assertTrue(pending.returned and owner.terminal_retired)

    def test_late_committed_creation_in_the_lifetime_pool_prevents_job_termination(self):
        owner,a,k=self.failed_retirement_session();owner.controller_ident=get_ident()
        row=owner.ledger.reserve(owner.calls,k.CreateProcessW,(1,),lambda _:True,(),False)
        owner.ledger.commit(row,a,owner.requests[-1],'operation')
        owner.calls.remove(row)  # Active-list pruning cannot erase the intent.
        with self.assertRaises(x.OffloadAdmissionError):owner.retire_failed()
        self.assertIsNone(owner.terminal);self.assertFalse(row.started);self.assertEqual(k.effects,[])

    def test_lost_reaper_start_return_keeps_callback_output_and_every_original_owner(self):
        owner,a,k=self.failed_retirement_session();k.begin_failure='interrupt'
        with self.assertRaises(KeyboardInterrupt):owner.retire_failed()
        attempt=owner.terminal;row=attempt.used['begin']
        self.assertTrue(row.started);self.assertFalse(row.returned)
        self.assertIsNone(attempt.reaper.slot.value)
        self.assertIn(attempt.callback,owner.buffers);self.assertIn(attempt.thread_id,owner.buffers)
        self.assertIs(x._OWNERS[id(owner)],owner)
        self.assertFalse(any(isinstance(v,tuple) and v[0]=='terminate' for v in k.effects))

    def test_expired_terminal_budget_dispatches_nothing_and_cannot_be_renewed(self):
        owner,a,k=self.failed_retirement_session()
        with patch.object(x.time,'monotonic_ns',side_effect=[100,x._BUDGET_NS+101]),self.assertRaises(x.OffloadAdmissionError):
            owner.retire_failed()
        self.assertEqual(owner.terminal.used,{})
        self.assertIsNone(owner.terminal.start.slot.value);self.assertEqual(k.effects,[])
        with self.assertRaises(x.OffloadAdmissionError):owner.retire_failed()
        self.assertEqual(k.effects,[])

    def test_committed_native_return_after_deadline_stays_known_without_fresh_dispatch(self):
        owner,a,k=self.failed_retirement_session();base=x.time.monotonic_ns();clock=[base]
        perform=a._perform
        def delayed(row):
            if owner.terminal is not None and row.function is k.CreateEventW:clock[0]=base+x._BUDGET_NS+1
            return perform(row)
        before=len(k.events)
        with patch.object(x.time,'monotonic_ns',side_effect=lambda:clock[0]),patch.object(a,'_perform',side_effect=delayed),self.assertRaises(x.OffloadAdmissionError):
            owner.retire_failed()
        attempt=owner.terminal;row=attempt.used['create-start']
        self.assertTrue(row.returned and row.acknowledged)
        self.assertGreater(owner.ledger.settled(row,a)[1],0)
        self.assertEqual(len(k.events),before+1);self.assertEqual(set(attempt.used),{'create-start'})
        self.assertIsNone(attempt.start.slot.value);self.assertIs(x._OWNERS[id(owner)],owner)

    def test_reserved_capacity_denial_has_no_new_terminal_metadata_or_effect(self):
        owner,a,k=self.failed_retirement_session();owner.ledger.used=x._MAX_CALLS;owner.ledger.terminal_used=17
        with self.assertRaises(x.OffloadAdmissionError):owner.retire_failed()
        self.assertIsNone(owner.terminal);self.assertEqual(k.effects,[])

    def test_copied_owner_and_callback_replay_do_not_poison_the_original_retirement(self):
        owner,a,k=self.failed_retirement_session();clone=copy.copy(owner)
        with self.assertRaises(x.OffloadAdmissionError):clone.retire_failed()
        self.assertIsNone(owner.terminal);self.assertEqual(k.effects,[])
        owner.retire_failed();attempt=owner.terminal;before=list(k.effects)
        self.assertEqual(copy.copy(attempt)._entry(None),9)
        self.assertEqual(attempt._entry(None),9)
        self.assertFalse(attempt.failed or owner.uncertain)
        with self.assertRaises(x.OffloadAdmissionError):copy.copy(owner).retire_failed()
        self.assertEqual(k.effects,before)

    def test_known_terminal_registry_handoff_interruption_reconciles_without_native_retry(self):
        class InterruptedPop(dict):
            def pop(self,key):super().pop(key);raise KeyboardInterrupt()
        owner,a,k=self.failed_retirement_session()
        with patch.object(x,'_OWNERS',InterruptedPop(x._OWNERS)):
            with self.assertRaises(KeyboardInterrupt):owner.retire_failed()
            self.assertTrue(owner.terminal.has_final_proof() and owner.session_retired)
            next_owner=self.session();before=list(k.effects)
            self.assertIsNone(owner.retire_failed())
            self.assertIs(x._OWNERS[id(next_owner)],next_owner);self.assertEqual(k.effects,before)

    def test_original_core_ack_is_preserved_separately_from_terminal_process_exit(self):
        owner,a,k=self.failed_retirement_session();owner.core_retired=True
        self.assertIsNone(owner.retire_failed());self.assertTrue(owner.core_retired)
        self.assertFalse(owner.requests[-1].consumed)

    def test_wrong_controller_exit_cannot_be_reinterpreted_as_normal_completion(self):
        owner,a,k=self.failed_retirement_session();k.controller_code=0
        with self.assertRaises(x.OffloadAdmissionError):owner.retire_failed()
        self.assertFalse(owner.controller_finished or owner.session_retired)
        self.assertFalse(any(isinstance(v,tuple) and v[0]=='close' for v in k.effects))

    def test_terminal_slot_substitution_after_commit_cannot_dispatch_job_termination(self):
        owner,a,k=self.failed_retirement_session();perform=a._perform
        def substitute(row):
            if owner.terminal is not None and row.function is k.TerminateJobObject:
                owner.job.slot=x._PTR(owner.job._number)
            return perform(row)
        with patch.object(a,'_perform',side_effect=substitute),self.assertRaises(x.OffloadAdmissionError):owner.retire_failed()
        row=owner.terminal.used['terminate-job']
        self.assertFalse(row.started);self.assertTrue(row.integrity_lost)
        self.assertFalse(any(isinstance(v,tuple) and v[0]=='terminate' for v in k.effects))
        self.assertIs(x._OWNERS[id(owner)],owner)

    def test_caller_wait_may_commit_while_reaper_retains_an_exact_original_close(self):
        owner,a,k=self.failed_retirement_session();k.block_close=owner.start_event._number;k.close_release.clear()
        observed=[]
        def release():
            observed.append(k.close_entered.wait(1))
            observed.append(k.caller_wait_started.wait(1))
            k.close_release.set()
        thread=Thread(target=release,daemon=True);thread.start();self.addCleanup(lambda:thread.join(2))
        self.assertIsNone(owner.retire_failed());thread.join(1)
        self.assertEqual(observed,[True,True]);self.assertTrue(k.signal_pending_at_close)
        self.assertTrue(owner.session_retired and all(h.closed for h in owner.handles))

    def test_nonconcurrent_normal_callers_may_use_different_application_threads(self):
        owner=self.session();ready=Event();finish=Event();outcomes=[];errors=[]
        owner.controller=self.handle(owner,'controller',30)
        owner.completion_event=self.handle(owner,'completion',31)
        owner.request_event=self.handle(owner,'request',32)
        def wait(handles,deadline):
            request=owner.active;request.started=request.returned=request.published=request.signal_ack=True
            request.result=x._STATES[request.seq];return 0
        api=SimpleNamespace(wait=wait,call=lambda fn,*a,**k:fn(*a),
                            k=SimpleNamespace(ResetEvent=lambda n:1,SetEvent=lambda n:1))
        def first():
            try:
                with patch.object(owner,'_start',side_effect=lambda request:setattr(owner,'api',api)):owner.prepare()
                outcomes.append('first')
            except BaseException as error:errors.append(type(error).__name__)
            finally:ready.set();finish.wait(2)
        def second():
            try:
                ready.wait(1);owner.bind_read();outcomes.append('second')
            except BaseException as error:errors.append(type(error).__name__)
            finally:finish.set()
        a=Thread(target=first,daemon=True);b=Thread(target=second,daemon=True);a.start();b.start();a.join(2);b.join(2)
        self.assertFalse(a.is_alive() or b.is_alive());self.assertEqual(errors,[]);self.assertEqual(outcomes,['first','second'])
        entries=list(owner._effect_exits.values());self.assertEqual(len(entries),2)
        self.assertNotEqual(entries[0][2],entries[1][2]);self.assertTrue(all(v[3] is True for v in entries))

    def test_substituted_job_query_buffer_cannot_supply_favorable_retirement_facts(self):
        owner,a,k=self.failed_retirement_session();original=k.QueryInformationJobObject
        def substitute(job,kind,out,size,returned):
            result=original(job,kind,out,size,returned)
            if kind==1:
                out._obj.active=1;out._obj.total=2
                favorable=x._Accounting();favorable.active=0;favorable.total=1
                owner.terminal.accounting=favorable
            return result
        k.QueryInformationJobObject=substitute
        with self.assertRaises(x.OffloadAdmissionError):owner.retire_failed()
        self.assertFalse(owner.session_retired)
        self.assertFalse(any(isinstance(v,tuple) and v[0]=='close' for v in k.effects))
        self.assertIs(x._OWNERS[id(owner)],owner)

    def test_substituted_exit_code_buffers_cannot_replace_original_native_outputs(self):
        for kind in ('controller','process','reaper'):
            with self.subTest(kind=kind),patch.dict(x._OWNERS,{},clear=True):
                owner,a,k=self.failed_retirement_session();thread=k.GetExitCodeThread;process=k.GetExitCodeProcess
                def thread_code(number,out):
                    result=thread(number,out);attempt=owner.terminal
                    if kind=='controller' and number==owner.controller._number:
                        out._obj.value=259;attempt.controller_code=x._U32(9)
                    if kind=='reaper' and number==attempt.reaper._number:
                        out._obj.value=259;attempt.reaper_code=x._U32(0)
                    return result
                def process_code(number,out):
                    result=process(number,out)
                    if kind=='process':out._obj.value=259;owner.terminal.process_code=x._U32(9)
                    return result
                k.GetExitCodeThread=thread_code;k.GetExitCodeProcess=process_code
                with self.assertRaises(x.OffloadAdmissionError):owner.retire_failed()
                self.assertFalse(owner.session_retired);self.assertIs(x._OWNERS[id(owner)],owner)
                if kind=='reaper':self.assertFalse(owner.terminal.reaper.closed or owner.terminal.start.closed)
                else:self.assertFalse(any(isinstance(v,tuple) and v[0]=='close' for v in k.effects))
                before=list(k.effects)
                with self.assertRaises(x.OffloadAdmissionError):owner.retire_failed()
                self.assertEqual(k.effects,before);k.finish_test_threads()

    def test_interrupted_request_list_or_exit_map_admission_is_fenced_and_bounded(self):
        for family in ('list','map'):
            for after in (False,True):
                for error in (MemoryError,KeyboardInterrupt):
                    with self.subTest(family=family,after=after,error=error.__name__),patch.dict(x._OWNERS,{},clear=True):
                        owner=self.session()
                        class FaultList(list):
                            def append(self,value):
                                if after:super().append(value)
                                raise error()
                        class FaultMap(dict):
                            def __setitem__(self,key,value):
                                if after:super().__setitem__(key,value)
                                raise error()
                        if family=='list':owner.requests=FaultList()
                        else:owner._effect_exits=FaultMap()
                        with patch.object(owner,'_start') as start:
                            for _ in range(10):
                                try:owner.prepare()
                                except BaseException:pass
                            start.assert_not_called()
                        self.assertTrue(owner.uncertain and owner.stop_requested)
                        self.assertLessEqual(len(owner.requests),1);self.assertLessEqual(len(owner._effect_exits),1)
                        self.assertIs(x._OWNERS[id(owner)],owner)

    def test_interrupted_active_or_busy_publication_cannot_leave_retryable_admission(self):
        for field in ('active','busy'):
            with self.subTest(field=field),patch.dict(x._OWNERS,{},clear=True):
                owner=self.session();setattr_original=object.__setattr__
                def interrupted(value,name,data):
                    setattr_original(value,name,data)
                    if value is owner and name==field and (type(data) is x._Request if field=='active' else data is True):
                        raise KeyboardInterrupt()
                with patch.object(x._WindowsOffloadIoSession,'__setattr__',interrupted),patch.object(owner,'_start') as start:
                    with self.assertRaises(KeyboardInterrupt):owner.prepare()
                    start.assert_not_called()
                self.assertTrue(owner.uncertain and owner.stop_requested)
                before=(len(owner.requests),len(owner._effect_exits))
                with self.assertRaises(x.OffloadAdmissionError):owner.prepare()
                self.assertEqual((len(owner.requests),len(owner._effect_exits)),before)

    def test_pure_replay_or_concurrent_denial_does_not_fence_a_healthy_owner(self):
        owner=self.session()
        with self.assertRaises(x.OffloadAdmissionError):owner.bind_read()
        self.assertFalse(owner.uncertain or owner.stop_requested);self.assertEqual(owner.requests,[])
        owner.busy=True
        with self.assertRaises(x.OffloadAdmissionError):owner.prepare()
        self.assertFalse(owner.uncertain or owner.stop_requested);self.assertEqual(owner._effect_exits,{})

    def test_request_allocation_failure_fences_before_any_native_entry_or_retry(self):
        owner=self.session()
        with patch.object(x,'_Request',side_effect=MemoryError) as allocate,patch.object(owner,'_start') as start:
            for _ in range(10):
                with self.assertRaises(x.OffloadAdmissionError):owner.prepare()
            self.assertEqual(allocate.call_count,1);start.assert_not_called()
        self.assertTrue(owner.uncertain and owner.stop_requested)
        self.assertEqual(owner.requests,[]);self.assertEqual(owner._effect_exits,{})

    def call_fixture(self,finish=False):
        owner=self.session();dispatch=[]
        for i,field in enumerate(('controller','start_event','request_event','completion_event')):
            setattr(owner,field,self.handle(owner,field,30+i))
        def wait(handles,deadline):
            request=owner.active;request.started=request.returned=request.published=request.signal_ack=True
            request.result=x._STATES[request.seq];return 0
        def call(fn,*args,**kwargs):dispatch.append(fn);return fn(*args)
        api=SimpleNamespace(wait=wait,call=call,
                            k=SimpleNamespace(ResetEvent=lambda n:1,SetEvent=lambda n:1,
                                              GetExitCodeThread=lambda n,out:setattr(out._obj,'value',0) or 1),
                            close=lambda h:setattr(h,'closed',True))
        owner.api=api
        if finish:owner.state='read-retired';owner.core_retired=owner.controller_finished=True
        return owner,api,dispatch

    def test_exit_marker_publication_failure_fences_before_any_next_native_dispatch(self):
        for after in (False,True):
            for error in (MemoryError,KeyboardInterrupt):
                with self.subTest(after=after,error=error.__name__),patch.dict(x._OWNERS,{},clear=True):
                    owner,api,dispatch=self.call_fixture();observed=[]
                    class FaultMap(dict):
                        def __setitem__(self,key,value):
                            if value[3] is True:
                                observed.append((owner.busy,owner.active is value[0]))
                                if after:super().__setitem__(key,value)
                                raise error()
                            super().__setitem__(key,value)
                    owner._effect_exits=FaultMap()
                    expected=x.OffloadAdmissionError if error is MemoryError else KeyboardInterrupt
                    with patch.object(owner,'_start'),self.assertRaises(expected):owner.prepare()
                    self.assertTrue(owner.uncertain and owner.stop_requested)
                    self.assertEqual(observed,[(True,True)])
                    before=list(dispatch)
                    with self.assertRaises(x.OffloadAdmissionError):owner.bind_read()
                    self.assertEqual(dispatch,before);self.assertEqual(len(owner.requests),1)

    def test_exit_marker_validation_loss_denies_next_dispatch(self):
        owner,api,dispatch=self.call_fixture()
        class LostEntry(dict):
            def get(self,key):return None
        owner._effect_exits=LostEntry()
        with patch.object(owner,'_start'),self.assertRaises(x.OffloadAdmissionError):owner.prepare()
        self.assertTrue(owner.uncertain and owner.stop_requested)
        before=list(dispatch)
        with self.assertRaises(x.OffloadAdmissionError):owner.bind_read()
        self.assertEqual(dispatch,before)

    def test_exit_marker_failure_is_fenced_before_the_same_state_gate_releases(self):
        owner,api,dispatch=self.call_fixture();lock=owner._state_lock;failed=[False];exits=[]
        class ObservedLock:
            def acquire(self,*args,**kwargs):return lock.acquire(*args,**kwargs)
            def release(self):return lock.release()
            def __enter__(self):lock.acquire();return self
            def __exit__(self,*args):
                if failed[0]:exits.append(owner.uncertain and owner.stop_requested)
                lock.release()
        class FaultMap(dict):
            def __setitem__(self,key,value):
                if value[3] is True:failed[0]=True;raise MemoryError()
                super().__setitem__(key,value)
        owner._state_lock=ObservedLock();owner._effect_exits=FaultMap()
        with patch.object(owner,'_start'),self.assertRaises(x.OffloadAdmissionError):owner.prepare()
        self.assertTrue(exits and all(exits))

    def test_exit_marker_lock_entry_interruption_is_fenced_without_masking_error(self):
        owner,api,dispatch=self.call_fixture();lock=owner._state_lock;armed=[False]
        class InterruptedLock:
            def acquire(self,*args,**kwargs):return lock.acquire(*args,**kwargs)
            def release(self):return lock.release()
            def __enter__(self):
                if armed[0]:armed[0]=False;raise KeyboardInterrupt()
                lock.acquire();return self
            def __exit__(self,*args):lock.release()
        owner._state_lock=InterruptedLock();wait=api.wait
        def arm(*args):value=wait(*args);armed[0]=True;return value
        api.wait=arm
        with patch.object(owner,'_start'),self.assertRaises(KeyboardInterrupt):owner.prepare()
        self.assertTrue(owner.uncertain and owner.stop_requested)
        self.assertTrue(next(iter(owner._effect_exits.values()))[3])
        before=list(dispatch)
        with self.assertRaises(x.OffloadAdmissionError):owner.bind_read()
        self.assertEqual(dispatch,before)

    def test_exit_marker_failure_does_not_replace_the_original_effect_exception(self):
        for original,secondary in ((KeyboardInterrupt,MemoryError),(ValueError,KeyboardInterrupt)):
            with self.subTest(original=original.__name__),patch.dict(x._OWNERS,{},clear=True):
                owner,api,dispatch=self.call_fixture()
                class FaultMap(dict):
                    def __setitem__(self,key,value):
                        if value[3] is True:raise secondary()
                        super().__setitem__(key,value)
                owner._effect_exits=FaultMap()
                expected=KeyboardInterrupt if original is KeyboardInterrupt else x.OffloadAdmissionError
                caught=None
                with patch.object(owner,'_start',side_effect=original):
                    try:owner.prepare()
                    except BaseException as error:caught=error
                self.assertIsInstance(caught,expected)
                self.assertTrue(owner.uncertain and owner.stop_requested)
                self.assertEqual(dispatch,[])

    def test_finish_marker_failure_preserves_retirement_and_a_new_owner(self):
        for after in (False,True):
            with self.subTest(after=after),patch.dict(x._OWNERS,{},clear=True):
                owner,api,dispatch=self.call_fixture(finish=True);new=[]
                class FaultMap(dict):
                    def __setitem__(self,key,value):
                        if value[3] is True:
                            self_outer.assertTrue(owner.session_retired)
                            new.append(self_outer.session())
                            if after:super().__setitem__(key,value)
                            raise KeyboardInterrupt()
                        super().__setitem__(key,value)
                self_outer=self;owner._effect_exits=FaultMap()
                with self.assertRaises(KeyboardInterrupt):owner.finish()
                self.assertTrue(owner.session_retired and owner.core_retired)
                self.assertFalse(owner.uncertain or owner.stop_requested or owner.busy)
                self.assertNotIn(id(owner),x._OWNERS);self.assertIs(x._OWNERS[id(new[0])],new[0])
                self.assertFalse(new[0].uncertain or new[0].stop_requested)
                before=list(dispatch)
                with self.assertRaises(x.OffloadAdmissionError):owner.prepare()
                self.assertEqual(dispatch,before)

    def test_expiry_after_final_settlement_validation_never_supplies_a_timely_pass(self):
        owner,a,k=self.failed_retirement_session();base=x.time.monotonic_ns();clock=[base];armed=[False]
        snapshot=x._TerminalRetirement._snapshot;settled=owner.ledger.settled
        def after_snapshot(attempt):
            snapshot(attempt)
            if all(h.closed for h in owner.handles):armed[0]=True
        def final_settlement(row,api):
            value=settled(row,api)
            if armed[0] and row is owner.terminal.calls[-1]:clock[0]=owner.terminal.deadline+1
            return value
        with patch.object(x.time,'monotonic_ns',side_effect=lambda:clock[0]), \
             patch.object(x._TerminalRetirement,'_snapshot',after_snapshot), \
             patch.object(owner.ledger,'settled',side_effect=final_settlement),self.assertRaises(x.OffloadAdmissionError):
            owner.retire_failed()
        self.assertTrue(all(h.closed for h in owner.handles)) # Known closure is not a timing pass.
        self.assertFalse(owner.terminal.has_final_proof() or owner.session_retired)
        self.assertIs(x._OWNERS[id(owner)],owner)

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

    def test_ledger_reinitialization_preserves_existing_capacity_and_rows(self):
        owner=self.session();ledger=owner.ledger
        row=ledger.reserve(owner.calls,lambda:1,(),lambda n:n==1,(),False)
        original=ledger.rows
        with self.assertRaises(x.OffloadAdmissionError):x._Ledger.__init__(ledger,owner)
        self.assertIs(ledger.rows,original);self.assertIs(ledger.rows[0],row)
        self.assertEqual(ledger.used,1);self.assertEqual(ledger.terminal_used,0)

    def test_an_existing_inert_owner_cannot_receive_a_fresh_ledger(self):
        owner=self.session();original=owner.ledger
        self.assertIsNone(owner.api)
        with self.assertRaises(x.OffloadAdmissionError):x._Ledger(owner)
        self.assertIs(owner.ledger,original)

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

    def test_rebound_shared_handle_factory_is_denied_before_constructor_or_call(self):
        owner=self.session();a=self.api(owner);effects=[]
        class ForeignHandle:
            def __init__(self,*args):effects.append('foreign-constructor')
        a._handle_type=ForeignHandle
        a.call=lambda *args,**kwargs:effects.append('native-call')
        with self.assertRaises(x.OffloadAdmissionError):a.acquire('foreign',lambda:1)
        self.assertEqual(effects,[]);self.assertEqual(owner.handles,[])

    def test_core_reservation_rejects_non_child_owner_and_foreign_graph(self):
        owner=self.session();a=self.api(owner);ledger=owner.ledger
        before=(ledger.used,ledger.terminal_used,tuple(ledger.rows))
        for graph in (object(),SimpleNamespace(),object.__new__(child_module._CoreReadGraph)):
            with self.assertRaises(x.OffloadAdmissionError):ledger._carve_core_read(graph)
            self.assertEqual((ledger.used,ledger.terminal_used,tuple(ledger.rows)),before)
        self.assertEqual(owner.calls,[])

    def test_replaced_normal_or_terminal_table_denies_scalar_effect(self):
        for field in('normal','terminal'):
            with self.subTest(field=field),patch.dict(x._OWNERS,{},clear=True):
                owner=self.session();a=self.api(owner);native=Mock(return_value=1)
                setattr(owner.ledger,field,list(getattr(owner.ledger,field)))
                with self.assertRaises(x.OffloadAdmissionError):a.call(native)
                native.assert_not_called();self.assertEqual(owner.calls,[])

    def test_source_buffer_bootstrap_loads_shared_dependency_before_import(self):
        # Execute the actual fixed bootstrap with safe synthetic dependency
        # bytes and the actual pure shared module. No file or Native API runs.
        prefix='_aisb_owned_io'
        buffers={name:b'# fixed synthetic source\n'for name in x._SOURCE_NAMES}
        buffers['local_model_offload.py']=b'class OffloadAdmissionError(RuntimeError): pass\n'
        buffers['windows_offload_native_session.py']=(Path(x.__file__).parent/'windows_offload_native_session.py').read_bytes()
        buffers['windows_offload_execution_child.py']=b'''def _entry():
    from .windows_offload_native_session import _NativePrimitives
    from .local_model_offload import OffloadAdmissionError
    global _OBSERVED
    try: _NativePrimitives().origin()
    except OffloadAdmissionError: _OBSERVED = True
'''
        hashes={name:hashlib.sha256(raw).hexdigest()for name,raw in buffers.items()}
        code=x._bootstrap(Path.cwd(),hashes,'a'*32,(10,11,12,13),1,
                          ('C:\\Python\\python.exe','b'*64))
        reads=[]
        def fixed_open(path,mode):
            self.assertEqual(mode,'rb');name=Path(path).name
            self.assertIn(name,buffers);reads.append(name);return BytesIO(buffers[name])
        class NoImplicitImport:
            def find_spec(self,fullname,path=None,target=None):
                if fullname.startswith(prefix+'.'):
                    raise AssertionError('A repository dependency was imported before source verification')
        with patch.dict(sys.modules),patch('builtins.open',side_effect=fixed_open), \
             patch.object(sys,'meta_path',[NoImplicitImport(),*sys.meta_path]):
            for name in tuple(sys.modules):
                if name==prefix or name.startswith(prefix+'.'):sys.modules.pop(name)
            exec(compile(code,'<fixed-synthetic-bootstrap>','exec'),{})
            self.assertIs(sys.modules[prefix+'.windows_offload_execution_child']._OBSERVED,True)
        self.assertEqual(reads,list(x._SOURCE_NAMES))

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

    def test_native_error_is_known_settlement_without_success_or_reissued_effect(self):
        owner=self.session();a=self.api(owner);calls=[]
        def aborted():calls.append('read');return 0
        with patch.object(C,'get_last_error',return_value=995),self.assertRaises(x.OffloadAdmissionError):
            a.call(aborted)
        row=owner.calls[-1];value=owner.ledger.settled(row,a)
        self.assertEqual(value[1:3],(0,995))
        self.assertTrue(row.returned);self.assertFalse(row.acknowledged)
        self.assertTrue(owner.uncertain and owner.stop_requested)
        with self.assertRaises(x.OffloadAdmissionError):a.call(aborted)
        self.assertEqual(calls,['read'])
        with self.assertRaises(x.OffloadAdmissionError):owner.ledger.settled(copy.copy(row),a)
        self.assertFalse(row.integrity_lost)
        self.assertIs(owner.ledger.settled(row,a),value)

    def test_original_native_return_survives_error_reader_failure(self):
        owner=self.session();a=self.api(owner);value=object();calls=[]
        row=a._call_row(lambda:calls.append('once')or value,valid=lambda _:True)
        with patch.object(C,'get_last_error',side_effect=RuntimeError('synthetic error reader')):
            with self.assertRaises(RuntimeError):a._perform(row)
        original=owner.ledger._retained_return(row,a)
        self.assertIs(original.value,value)
        self.assertTrue(original.value_known)
        self.assertFalse(original.error_returned or original.error_known)
        self.assertEqual(calls,['once']);self.assertTrue(owner.uncertain)

    def test_validator_cannot_substitute_the_returned_native_value(self):
        owner=self.session();a=self.api(owner);calls=[];row=None
        def validator(value):
            self.assertEqual(value,10)
            row.result=11
            return True
        row=a._call_row(lambda:calls.append('once')or 10,valid=validator)
        with self.assertRaises(x.OffloadAdmissionError):a._perform(row)
        original=owner.ledger._retained_return(row,a)
        self.assertEqual(original.value,10);self.assertFalse(row.acknowledged)
        self.assertEqual(calls,['once']);self.assertTrue(owner.uncertain)

    def test_both_io_roles_keep_unknown_and_malformed_reader_facts(self):
        class Opaque:
            def __repr__(self):raise AssertionError('No formatting')
            def __int__(self):raise AssertionError('No coercion')
        for role in ('parent','child'):
            for reply in (RuntimeError('synthetic reader'),KeyboardInterrupt(),None,True,-1,2**32,Opaque()):
                with self.subTest(role=role,kind=type(reply).__name__),patch.dict(x._OWNERS,{},clear=True):
                    owner,a=self.return_case(role);value=object();native=Mock(return_value=value)
                    validator=Mock(return_value=True);row=a._call_row(native,valid=validator)
                    reader=Mock(side_effect=reply)if isinstance(reply,BaseException)else Mock(return_value=reply)
                    with patch.object(C,'get_last_error',reader):
                        with self.assertRaises(BaseException):a._perform(row)
                    original=owner.ledger._retained_return(row,a)
                    self.assertIs(original.value,value);self.assertTrue(original.value_known)
                    self.assertFalse(original.error_known or original.acknowledged or row.acknowledged)
                    self.assertEqual(original.error_returned,not isinstance(reply,BaseException))
                    if not isinstance(reply,BaseException):self.assertIs(original.error,reply)
                    native.assert_called_once_with();reader.assert_called_once_with();validator.assert_not_called()
                    self.assertTrue(owner.uncertain)

    def test_both_io_roles_retain_returns_after_row_and_table_drift(self):
        for role in ('parent','child'):
            for alias in ('index','pool','payload','function','args','valid','keep','result','completion','rows','bindings','completions'):
                with self.subTest(role=role,alias=alias),patch.dict(x._OWNERS,{},clear=True):
                    owner,a=self.return_case(role);ledger=owner.ledger;value=12345;row=None
                    validator=Mock(return_value=True)
                    def native():
                        setattr(ledger if alias in('rows','bindings','completions')else row,alias,object())
                        return value
                    row=a._call_row(native,valid=validator)
                    with self.assertRaises(x.OffloadAdmissionError):a._perform(row)
                    original=ledger._retained_return(row,a)
                    self.assertIs(original.value,value)
                    self.assertTrue(original.value_known and original.error_known)
                    self.assertFalse(original.acknowledged or row.acknowledged);validator.assert_not_called()

    def test_owner_private_custody_keeps_original_graph_after_combined_alias_loss(self):
        for role in ('parent','child'):
            with self.subTest(role=role),patch.dict(x._OWNERS,{},clear=True):
                owner,a=self.return_case(role);ledger=owner.ledger;value=12345;row=None
                ledger_ref=weakref.ref(ledger);api_ref=weakref.ref(a)
                def native():
                    row.pool=row.payload=None
                    owner.calls=[];owner.api=object();owner.ledger=object()
                    return value
                row=a._call_row(native,valid=lambda _:True)
                with self.assertRaises(x.OffloadAdmissionError):a._perform(row)
                original=ledger._retained_return(row,a)
                self.assertIs(original.value,value);self.assertTrue(original.value_known)
                self.assertIs(owner._Native__custody[1],a);self.assertIs(owner._Native__custody[2],ledger)
                del original,row,a,ledger
                gc.collect()
                self.assertIsNotNone(ledger_ref());self.assertIsNotNone(api_ref())

    def test_original_reader_and_real_none_return_are_preserved_in_both_roles(self):
        for role in ('parent','child'):
            with self.subTest(role=role),patch.dict(x._OWNERS,{},clear=True):
                owner,a=self.return_case(role);first=Mock(return_value=17);foreign=Mock(return_value=18)
                def native():C.get_last_error=foreign;return None
                with patch.object(C,'get_last_error',first):
                    self.assertIsNone(a.call(native,valid=lambda value:value is None))
                row=owner.calls[-1];original=owner.ledger._retained_return(row,a)
                self.assertIsNone(original.value)
                self.assertTrue(original.value_known and original.error_known and original.acknowledged)
                self.assertEqual(original.error,17);first.assert_called_once_with();foreign.assert_not_called()
                self.assertEqual(len(owner.ledger.settled(row,a)),4)

    def test_callable_interruption_keeps_preowned_output_without_invented_return(self):
        for role in ('parent','child'):
            with self.subTest(role=role),patch.dict(x._OWNERS,{},clear=True):
                owner,a=self.return_case(role);output=C.c_void_p();reader=Mock(return_value=0)
                def native():output.value=193;raise KeyboardInterrupt()
                row=a._call_row(native,keep=(output,))
                with patch.object(C,'get_last_error',reader),self.assertRaises(KeyboardInterrupt):a._perform(row)
                original=owner.ledger._retained_return(row,a)
                self.assertFalse(original.value_known or original.error_returned or original.acknowledged)
                self.assertIs(row.keep[0],output);self.assertEqual(output.value,193);reader.assert_not_called()

    def test_missing_reader_and_unregistered_return_deny_before_target(self):
        for role in ('parent','child'):
            with self.subTest(role=role),patch.dict(x._OWNERS,{},clear=True):
                owner,a=self.return_case(role);native=Mock(return_value=1)
                row=a._call_row(native)
                with patch.object(C,'get_last_error',None),self.assertRaises(x.OffloadAdmissionError):a._perform(row)
                native.assert_not_called()
                retained=owner.ledger._retained_return(row,a)
                self.assertFalse(retained.value_known)
                binding=owner.ledger.bindings[row.index]
                forged=x._NativeReturn(owner.ledger,row,a,binding,row.index)
                with self.assertRaises(x.OffloadAdmissionError):forged.invoke()
                native.assert_not_called()

    def test_original_return_cannot_be_reinitialized_copied_or_replayed(self):
        for role in ('parent','child'):
            with self.subTest(role=role),patch.dict(x._OWNERS,{},clear=True):
                owner,a=self.return_case(role);native=Mock(return_value=31)
                self.assertEqual(a.call(native),31)
                row=owner.calls[-1];original=owner.ledger._retained_return(row,a)
                binding=owner.ledger.bindings[row.index]
                with self.assertRaises(x.OffloadAdmissionError):x._NativeReturn.__init__(original,owner.ledger,row,a,binding,row.index)
                for action in (copy.copy,copy.deepcopy,pickle.dumps):
                    with self.assertRaises(x.OffloadAdmissionError):action(original)
                with self.assertRaises(x.OffloadAdmissionError):original.invoke()
                with self.assertRaises(x.OffloadAdmissionError):a._perform(row)
                self.assertEqual(original.value,31);self.assertTrue(original.acknowledged and row.acknowledged)
                self.assertEqual(repr(original),'<original native return>');native.assert_called_once_with()

    def test_failure_hook_does_not_drop_the_original_known_return(self):
        owner,a=self.return_case('parent');value=object()
        row=a._call_row(lambda:value,valid=lambda _:True)
        with patch.object(C,'get_last_error',side_effect=ValueError('synthetic reader')), \
             patch.object(owner,'_fence',side_effect=RuntimeError('synthetic observer')),self.assertRaises(RuntimeError):
            a._perform(row)
        original=owner.ledger._retained_return(row,a)
        self.assertIs(original.value,value);self.assertTrue(original.value_known)

    def test_opaque_scalar_return_is_retained_without_metaclass_callbacks(self):
        class Meta(type):
            def __eq__(self,other):raise AssertionError('No class comparison callback')
            def __hash__(self):raise AssertionError('No class hashing callback')
        class Opaque(metaclass=Meta):
            def __repr__(self):raise AssertionError('No formatting')
        for role in ('parent','child'):
            with self.subTest(role=role),patch.dict(x._OWNERS,{},clear=True):
                owner,a=self.return_case(role);value=Opaque();validator=Mock(return_value=True)
                row=a._call_row(lambda:value,valid=validator)
                with self.assertRaises(x.OffloadAdmissionError):a._perform(row)
                original=owner.ledger._retained_return(row,a)
                self.assertIs(original.value,value);self.assertTrue(original.value_known and original.error_known)
                self.assertFalse(original.acknowledged);validator.assert_not_called()

    def test_preinvoke_identity_drift_denies_before_target_in_both_roles(self):
        invoke=x._NativeReturn.invoke
        for role in ('parent','child'):
            for alias in ('api','ledger','payload','index'):
                with self.subTest(role=role,alias=alias),patch.dict(x._OWNERS,{},clear=True):
                    owner,a=self.return_case(role);native=Mock(return_value=1);row=a._call_row(native)
                    def drift(value):
                        setattr(owner if alias in('api','ledger')else row,alias,object())
                        return invoke(value)
                    with patch.object(x._NativeReturn,'invoke',drift),self.assertRaises(x.OffloadAdmissionError):
                        a._perform(row)
                    native.assert_not_called()

    def test_foreign_invocation_cannot_dispatch_or_poison_the_original(self):
        invoke=x._NativeReturn.invoke
        for role in ('parent','child'):
            with self.subTest(role=role),patch.dict(x._OWNERS,{},clear=True):
                owner,a=self.return_case(role);native=Mock(return_value=1)
                def probe(value):
                    errors=[]
                    def foreign():
                        try:invoke(value)
                        except BaseException as error:errors.append(error)
                    thread=Thread(target=foreign);thread.start();thread.join(timeout=2)
                    self.assertFalse(thread.is_alive());self.assertEqual(len(errors),1)
                    self.assertIs(type(errors[0]),x.OffloadAdmissionError)
                    native.assert_not_called()
                    return invoke(value)
                with patch.object(x._NativeReturn,'invoke',probe):self.assertEqual(a.call(native),1)
                self.assertFalse(owner.uncertain);native.assert_called_once_with()
                self.assertTrue(owner.ledger._retained_return(owner.calls[-1],a).acknowledged)

    def test_validator_owner_binding_drift_cannot_acknowledge_original_call(self):
        for role in ('parent','child'):
            for alias in ('api','ledger'):
                with self.subTest(role=role,alias=alias),patch.dict(x._OWNERS,{},clear=True):
                    owner,a=self.return_case(role);ledger=owner.ledger;native=Mock(return_value=10)
                    def validator(value):
                        self.assertEqual(value,10);setattr(owner,alias,object());return True
                    row=a._call_row(native,valid=validator)
                    with self.assertRaises(x.OffloadAdmissionError):a._perform(row)
                    original=ledger._retained_return(row,a)
                    self.assertEqual(original.value,10);self.assertFalse(original.acknowledged or row.acknowledged)
                    native.assert_called_once_with()

    def test_coherent_observer_replacement_cannot_replace_the_original_committed_intent(self):
        for role in ('parent','child'):
            with self.subTest(role=role),patch.dict(x._OWNERS,{},clear=True):
                owner,a=self.return_case(role);native=Mock(return_value=1);foreign=Mock(return_value=1)
                row=a._call_row(native);old=row.payload
                replacement=(foreign,old[1],old[2],old[3],*old[4:])
                owner.ledger.bindings[row.index]=replacement
                row.function=foreign;row.payload=replacement
                with self.assertRaises(x.OffloadAdmissionError):a._perform(row)
                native.assert_not_called();foreign.assert_not_called()

    def test_reserved_intent_cannot_be_changed_before_commit(self):
        for role in ('parent','child'):
            with self.subTest(role=role),patch.dict(x._OWNERS,{},clear=True):
                owner,a=self.return_case(role);native=Mock(return_value=1);foreign=Mock(return_value=1)
                reserve=owner.ledger.reserve
                def changed(*args):
                    row=reserve(*args);row.function=foreign;return row
                with patch.object(owner.ledger,'reserve',side_effect=changed),self.assertRaises(x.OffloadAdmissionError):
                    a.call(native)
                native.assert_not_called();foreign.assert_not_called()

    def test_uninvoked_observers_cannot_forge_a_native_settlement(self):
        for role in ('parent','child'):
            with self.subTest(role=role),patch.dict(x._OWNERS,{},clear=True):
                owner,a=self.return_case(role);native=Mock(return_value=1);row=a._call_row(native)
                binding=row.payload;forged=(binding,1,0,get_ident())
                owner.ledger.completions[row.index]=row.completion=forged
                row.started=row.returned=True;row.native_thread=get_ident();row.result=1;row.error=0
                with self.assertRaises(x.OffloadAdmissionError):owner.ledger.settled(row,a)
                native.assert_not_called();self.assertFalse(row.acknowledged)

    def test_both_public_completion_aliases_cannot_replace_original_completion(self):
        for role in ('parent','child'):
            with self.subTest(role=role),patch.dict(x._OWNERS,{},clear=True):
                owner,a=self.return_case(role);self.assertEqual(a.call(lambda:1),1)
                row=owner.calls[-1];original=owner.ledger._retained_return(row,a)
                saved=original.completion;replacement=tuple(list(saved))
                owner.ledger.completions[row.index]=row.completion=replacement
                with self.assertRaises(x.OffloadAdmissionError):owner.ledger.settled(row,a)
                self.assertIs(original.completion,saved);self.assertEqual(original.value,1)

    def test_native_completion_identity_loss_is_sticky_without_repeating_the_call(self):
        owner=self.session();a=self.api(owner);calls=[]
        self.assertEqual(a.call(lambda:calls.append('once') or 1),1)
        row=owner.calls[-1];original=row.completion
        row.completion=tuple(list(original))
        with self.assertRaises(x.OffloadAdmissionError):owner.ledger.settled(row,a)
        self.assertTrue(row.integrity_lost)
        row.completion=original
        with self.assertRaises(x.OffloadAdmissionError):owner.ledger.settled(row,a)
        self.assertEqual(calls,['once'])

    def test_failed_call_publishes_only_its_effectful_path_exit_not_native_success(self):
        owner=self.session()
        def start(request):
            owner.controller=owner.completion_event=object()
            owner.api=SimpleNamespace(wait=lambda *_:258)
        with patch.object(owner,'_start',side_effect=start),self.assertRaises(x.OffloadAdmissionError):owner.prepare()
        request=owner.requests[-1];entry=owner._effect_exits[id(request)]
        self.assertIs(entry[0],request);self.assertIs(entry[1],request.effect_token)
        self.assertEqual(entry[2],get_ident());self.assertIs(entry[3],True)
        self.assertFalse(request.returned or request.consumed)
        self.assertTrue(request.expired and owner.uncertain)

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

    def test_original_process_output_cannot_be_changed_by_error_reader_before_adoption(self):
        owner,k=self.launch();self.launch_scopes(owner,k);original=[]
        # Real ctypes functions are cached objects. Preserve that identity here.
        k.CreateProcessW=k.CreateProcessW
        def reader():
            if k.creations and not original:
                p=owner.process_info;original.append((p.process,p.thread,p.pid,p.tid));p.process=99999
            return k.error
        C.get_last_error.side_effect=reader
        with self.assertRaises(x.OffloadAdmissionError):owner._launch(owner.active)
        self.assertEqual(len(original),1);self.assertIsNone(owner.process._number)
        row=next(r for r in owner.calls if r.function is k.CreateProcessW)
        retained=owner.ledger._retained_return(row,owner.api)
        self.assertEqual(retained.outputs,original[0]);self.assertTrue(retained.value_known)
        self.assertFalse(row.acknowledged);self.assertEqual(k.resumes,[])

    def test_create_process_may_modify_command_buffer_during_original_call(self):
        owner,k=self.launch();self.launch_scopes(owner,k);original=k.CreateProcessW
        def create(*args):
            result=original(*args);args[1][0]='X';return result
        k.CreateProcessW=create
        owner._launch(owner.active)
        self.assertTrue(owner.launch_complete);self.assertEqual(len(k.creations),1)

    def test_native_constructor_reinit_denies_before_any_loader(self):
        owner=self.session();a=self.api(owner)
        loader=Mock(side_effect=AssertionError('No loader effect permitted'))
        with patch.object(C,'WinDLL',loader,create=True),self.assertRaises(x.OffloadAdmissionError):
            x._Native.__init__(a,owner)
        loader.assert_not_called();self.assertIs(owner.api,a)

    def bootstrap_fixture(self):
        """Only cached memory ABI objects; the actual constructor/ledger runs."""
        case=self;owner=self.session();self.activate(owner);libraries=[];calls=[]
        class Function:
            def __init__(self,name):self.name=name;self.calls=[]
            def __call__(self,*args):
                self.calls.append(args)
                if self.name=='GetSystemDirectoryW':args[0].value='C:\\Windows\\System32';value=len(args[0].value)
                elif self.name=='GetModuleFileNameW':args[1].value='C:\\Windows\\System32\\ucrtbase.dll';value=len(args[1].value)
                else:value=1
                hook=getattr(case,'bootstrap_call_hook',None)
                if hook is not None:hook(self.name,args,value)
                return value
        class Library:
            def __init__(self,name,**kwargs):
                self._name=name;self._handle=800+len(libraries);self.functions={}
                libraries.append(self);calls.append((name,dict(kwargs)))
                hook=getattr(case,'bootstrap_library_hook',None)
                if hook is not None:hook(name,self)
            def __getattr__(self,name):
                if name not in self.functions:self.functions[name]=Function(name)
                return self.functions[name]
        class KernelLibrary(Library):pass
        class CrtLibrary(Library):pass
        image=bytearray(512);image[:2]=b'MZ';struct.pack_into('<I',image,0x3c,128)
        image[128:132]=b'PE\0\0';struct.pack_into('<H',image,132,0x8664);struct.pack_into('<H',image,152,0x20b)
        self.enterContext(patch.object(C,'WinDLL',KernelLibrary))
        self.enterContext(patch.object(C,'CDLL',CrtLibrary))
        self.enterContext(patch.object(x,'_read_source',return_value=bytes(image)))
        return owner,libraries,calls

    def test_original_bootstrap_two_rows_fixed_loaders_and_no_scalar_tuple_widening(self):
        owner,libraries,calls=self.bootstrap_fixture();a=x._Native(owner)
        self.assertEqual(calls,[('kernel32',{'use_last_error':True}),
                               ('C:\\Windows\\System32\\ucrtbase.dll',{'use_errno':True})])
        self.assertEqual(owner.ledger.used,4);self.assertEqual(len(owner.calls),2)
        for row in owner.ledger.rows[:2]:
            owner.ledger._assert_completed_physical(row,a)
            with self.assertRaises(x.OffloadAdmissionError):owner.ledger.settled(row,a)
        self.assertTrue(all(len(owner.ledger.settled(row,a))==4 for row in owner.calls))
        self.assertIs(a.k,libraries[0]);self.assertIs(a.crt,libraries[1])

    def test_bootstrap_original_library_survives_reader_interruption_without_retry(self):
        owner,libraries,calls=self.bootstrap_fixture()
        C.get_last_error.side_effect=KeyboardInterrupt()
        with self.assertRaises(KeyboardInterrupt):x._Native(owner)
        record=owner.api._Native__bootstrap;outcome=record._BootstrapCustody__calls[0]
        self.assertTrue(outcome.returned);self.assertIs(outcome.value,libraries[0])
        self.assertFalse(outcome.acknowledged);self.assertEqual(owner.ledger.used,2)
        with self.assertRaises(x.OffloadAdmissionError):x._Native.__init__(owner.api,owner)
        self.assertEqual(len(calls),1)

    def test_bootstrap_same_slot_reentry_denies_without_poisoning_original(self):
        owner,libraries,calls=self.bootstrap_fixture();denied=[]
        def hook(name,library):
            if name=='kernel32':
                record=owner.api._Native__bootstrap
                with self.assertRaises(x.OffloadAdmissionError):record.load(0,'kernel32')
                denied.append(1)
        self.bootstrap_library_hook=hook;a=x._Native(owner)
        self.assertEqual(denied,[1]);self.assertEqual(len(calls),2)
        owner.ledger._assert_completed_physical(owner.ledger.rows[0],a)

    def test_bootstrap_locator_consuming_deadline_cannot_start_second_loader(self):
        owner,libraries,calls=self.bootstrap_fixture();clock=[x.time.monotonic_ns()]
        def hook(name,args,value):
            if name=='GetSystemDirectoryW':clock[0]=owner.active.deadline+1
        self.bootstrap_call_hook=hook
        with patch.object(x.time,'monotonic_ns',side_effect=lambda:clock[0]),self.assertRaises(x.OffloadAdmissionError):x._Native(owner)
        self.assertEqual([name for name,_ in calls],['kernel32'])
        self.assertEqual(owner.ledger.used,3)
        raw=owner.ledger._retained_return(owner.calls[-1],owner.api)
        self.assertTrue(raw.value_known);self.assertTrue(owner.calls[-1].acknowledged)

    def test_bootstrap_original_callable_metadata_drift_denies_before_native(self):
        for field in('argtypes','argtypes-item','restype','errcheck'):
            with self.subTest(field=field),patch.dict(x._OWNERS,{},clear=True):
                owner,libraries,calls=self.bootstrap_fixture();a=x._Native(owner);fn=a.k.GetSystemDirectoryW
                before=len(fn.calls);used=owner.ledger.used
                if field=='argtypes':fn.argtypes=list(fn.argtypes)
                elif field=='argtypes-item':fn.argtypes[0]=x._PTR
                elif field=='restype':fn.restype=x._PTR
                else:fn.errcheck=lambda value,*_:value
                with self.assertRaises(x.OffloadAdmissionError):a.location(fn)
                self.assertEqual(len(fn.calls),before);self.assertEqual(owner.ledger.used,used)

    def test_bootstrap_physical_rows_cannot_be_reused_by_public_counter_reset(self):
        owner,libraries,calls=self.bootstrap_fixture();a=x._Native(owner);fn=a.k.GetSystemDirectoryW
        before=len(fn.calls);owner.ledger.used=0
        with self.assertRaises(x.OffloadAdmissionError):a.location(fn)
        self.assertEqual(len(fn.calls),before);self.assertEqual(len(owner.calls),2)

    def test_native_attribute_output_cannot_be_changed_by_getter_before_update(self):
        owner,k=self.launch();self.launch_scopes(owner,k);mutated=[]
        k.InitializeProcThreadAttributeList=k.InitializeProcThreadAttributeList
        k.UpdateProcThreadAttribute=k.UpdateProcThreadAttribute
        def reader():
            if owner.calls:
                row=owner.calls[-1]
                if row.function is k.InitializeProcThreadAttributeList and row.args[0]is not None and not mutated:
                    mutated.append(1);owner.attributes[0]=b'\x7f'
            return k.error
        C.get_last_error.side_effect=reader
        with self.assertRaises(x.OffloadAdmissionError):owner._launch(owner.active)
        self.assertEqual(mutated,[1]);self.assertEqual(k.updates,[]);self.assertEqual(k.creations,[])

    def test_native_attribute_drift_during_readback_denies_before_delete(self):
        owner,k=self.launch();self.launch_scopes(owner,k);mutated=[]
        k.DeleteProcThreadAttributeList=k.DeleteProcThreadAttributeList
        def reader():
            if owner.calls and owner.calls[-1].function is k.GetProcessId and not mutated:
                owner.attributes[0]=b'\x7f';mutated.append(1)
            return k.error
        C.get_last_error.side_effect=reader
        with self.assertRaises(x.OffloadAdmissionError):owner._launch(owner.active)
        self.assertEqual(mutated,[1]);self.assertEqual(k.delete_attributes,0);self.assertEqual(k.resumes,[])

    def test_deleted_attribute_buffer_cannot_be_deleted_or_used_again(self):
        owner,k=self.launch();self.launch_scopes(owner,k);owner._launch(owner.active)
        self.assertEqual(k.delete_attributes,1)
        with self.assertRaises(x.OffloadAdmissionError):
            owner.api.call(k.DeleteProcThreadAttributeList,owner.attributes,valid=lambda value:value is None,
                           keep=(owner.attributes,))
        self.assertEqual(k.delete_attributes,1)

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
            def __init__(self,name,**kwargs):self._name=name;instances[type(self).__name__]=self
            def __getattr__(self,name):value=Function(name);setattr(self,name,value);return value
        class KernelLibrary(Library):pass
        class CrtLibrary(Library):_handle=21
        image=bytearray(512);image[:2]=b'MZ';struct.pack_into('<I',image,0x3c,128)
        image[128:132]=b'PE\0\0';struct.pack_into('<H',image,132,0x8664);struct.pack_into('<H',image,152,0x20b)
        loaded=['C:\\Windows\\System32\\ucrtbase.dll']
        for mismatch in (False,True):
            with patch.dict(x._OWNERS,{},clear=True):
                owner=self.session();self.activate(owner);instances={}
                loaded[0]='C:\\wrong\\ucrtbase.dll' if mismatch else 'C:\\Windows\\System32\\ucrtbase.dll'
                with patch.object(C,'WinDLL',KernelLibrary),patch.object(C,'CDLL',CrtLibrary), \
                     patch.object(x,'_read_source',return_value=bytes(image)):
                    if mismatch:
                        with self.assertRaises(x.OffloadAdmissionError):x._Native(owner)
                        self.assertIs(owner.api.crt,instances['CrtLibrary']);continue
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
