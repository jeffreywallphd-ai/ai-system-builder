"""Fixed inert-worker job controls; never model, staging or restart authority."""
from __future__ import annotations
import ctypes as C
import importlib.util
import json
import os
from pathlib import Path,PureWindowsPath
import subprocess
import sys

ROOT=Path(__file__).resolve().parents[3]
def _load(name,path):
    spec=importlib.util.spec_from_file_location(name,path);value=importlib.util.module_from_spec(spec);spec.loader.exec_module(value);return value
p=_load('_owned_job_report',Path(__file__).with_name('probe_windows_staging_protection.py'))
m=_load('_owned_job_abi',ROOT/'dev-tools/scripts/qualification/windows_qualification_memory.py')
SCHEMA='windows-owned-job-probe-v1'
CASES=('event-signalled-exit','last-job-handle-close-stops-worker')
MEMORY_BYTES=512*1024**2
FLAGS=0x2000|0x100|0x200|0x8
READY_MS=8000
EXIT_MS=5000
WORKER_TIMEOUT_MS=60000
WORKER_VOLUNTARY_CODES=(23,75,76,77)
FORCED_EXIT=0xe0000062
WORKER=f'''import ctypes as c,os,sys
try:
 if len(sys.argv)!=3:os._exit(75)
 ready,stop=map(int,sys.argv[1:])
 if not (0<ready<2**64 and 0<stop<2**64 and ready!=stop):os._exit(75)
 k=c.WinDLL('kernel32',use_last_error=True)
 k.SetEvent.argtypes=[c.c_void_p];k.SetEvent.restype=c.c_int
 k.WaitForSingleObject.argtypes=[c.c_void_p,c.c_uint32];k.WaitForSingleObject.restype=c.c_uint32
 if not k.SetEvent(ready):os._exit(76)
 os._exit(23 if k.WaitForSingleObject(stop,{WORKER_TIMEOUT_MS})==0 else 75)
except BaseException:os._exit(77)
'''


def plan():
    return {'schema':SCHEMA,'status':'plan-only','cases':list(CASES),'native_effects':False,
            'maximum_active_processes':1,'process_commit_ceiling':MEMORY_BYTES,'job_commit_ceiling':MEMORY_BYTES,
            'ceilings_are_not_upfront_allocations':True,'synthetic_worker_start_attempted':False,'synthetic_worker_start_observed':False,'model_started':False,
            'real_app_worker_started':False,'retained_data_accessed':False,'restart_admitted':False,
            'parent_qualification':False,'actual_guardian_crash_tested':False,'staging_fence_ordering_tested':False,
            'limits':'New inert worker only. Closing a job handle is not an actual guardian-process crash or model/file-fence/offload qualification.'}


def failed_report(stage):
    value=plan();value.update(status='failed',failure_stage=stage,native_effects=True,cases=[],
                            cleanup_confirmed=False,unconfirmed_native_lifetime=True,all_cases_observed=False)
    return value


def encode(value):
    data=json.dumps(value,sort_keys=True)+'\n'
    return data if len(data.encode())<=8192 else json.dumps(failed_report('report-size'),sort_keys=True)+'\n'


class Owner(p.DiagnosticOwner):
    def failure_report(self,stage):return failed_report(stage)
    def encode(self,value):return encode(value)


class Security(C.Structure):
    _fields_=[('length',p.U32),('descriptor',p.PTR),('inherit',p.I32)]


class Startup(C.Structure):
    _fields_=[('cb',p.U32),('reserved',C.c_wchar_p),('desktop',C.c_wchar_p),('title',C.c_wchar_p),
              *[(name,p.U32) for name in ('x','y','width','height','chars_x','chars_y','fill','flags')],
              ('show',p.U16),('reserved_size',p.U16),('reserved_bytes',p.PTR),
              ('stdin',p.PTR),('stdout',p.PTR),('stderr',p.PTR)]


class StartupEx(C.Structure):
    _fields_=[('startup',Startup),('attributes',p.PTR)]


class Process(C.Structure):
    _fields_=[('process',p.PTR),('thread',p.PTR),('pid',p.U32),('tid',p.U32)]


class Accounting(C.Structure):
    _fields_=[(name,C.c_int64) for name in ('user','kernel','period_user','period_kernel')]+[(name,p.U32) for name in ('faults','total','active','terminated')]


def accounting_fact(expected_total,phase,value):
    p.require(type(expected_total) is int and expected_total in (0,1) and type(phase) is str and phase in ('suspended','ready','stopped','cleanup'),'accounting-request')
    p.require(type(value) is Accounting,'accounting-shape')
    return {'phase':phase,'expected_total':expected_total,'total':value.total,'active':value.active,'terminated':value.terminated}


def windows_path(value):
    p.require(type(value) is str and 1<=len(value)<32768 and '\0' not in value,'runtime-path')
    path=PureWindowsPath(value)
    p.require(path.is_absolute() and len(path.anchor)==3 and path.anchor[1:]==':\\' and '..' not in path.parts,'runtime-path')
    return path


def isolated_environment(windows):
    path=windows_path(windows)
    return {'SystemRoot':str(path),'WINDIR':str(path),'PATH':str(path/'System32')+';'+str(path)}


def worker_arguments(executable,ready,stop):
    path=windows_path(executable)
    p.require(path.name.lower() in ('python.exe','python3.exe','pythonw.exe'),'runtime-image')
    p.require(all(type(h) is int and 0<h<2**64-1 for h in (ready,stop)) and ready!=stop,'worker-event-handles')
    return [str(path),'-I','-S','-B','-c',WORKER,str(ready),str(stop)]


class Windows:
    def __init__(self):
        p.require(os.name=='nt' and C.sizeof(p.PTR)==8 and sys.implementation.name=='cpython','platform')
        p.require((C.sizeof(m.BasicLimits),C.sizeof(m.ExtendedLimits),C.sizeof(StartupEx),C.sizeof(Process))==(64,144,112,24),'native-layout')
        self.k=C.WinDLL('kernel32',use_last_error=True);self.uncertain=False
        for name,args,result in [
            ('CreateJobObjectW',[p.PTR,C.c_wchar_p],p.PTR),('SetInformationJobObject',[p.PTR,p.I32,p.PTR,p.U32],p.I32),
            ('QueryInformationJobObject',[p.PTR,p.I32,p.PTR,p.U32,p.PTR],p.I32),('CreateEventW',[C.POINTER(Security),p.I32,p.I32,C.c_wchar_p],p.PTR),
            ('SetEvent',[p.PTR],p.I32),('GetHandleInformation',[p.PTR,C.POINTER(p.U32)],p.I32),('CloseHandle',[p.PTR],p.I32),
            ('InitializeProcThreadAttributeList',[p.PTR,p.U32,p.U32,C.POINTER(C.c_size_t)],p.I32),
            ('UpdateProcThreadAttribute',[p.PTR,p.U32,C.c_size_t,p.PTR,C.c_size_t,p.PTR,p.PTR],p.I32),('DeleteProcThreadAttributeList',[p.PTR],None),
            ('CreateProcessW',[C.c_wchar_p,C.c_wchar_p,p.PTR,p.PTR,p.I32,p.U32,p.PTR,C.c_wchar_p,C.POINTER(StartupEx),C.POINTER(Process)],p.I32),
            ('IsProcessInJob',[p.PTR,p.PTR,C.POINTER(p.I32)],p.I32),('ResumeThread',[p.PTR],p.U32),
            ('WaitForSingleObject',[p.PTR,p.U32],p.U32),('GetExitCodeProcess',[p.PTR,C.POINTER(p.U32)],p.I32),('GetProcessId',[p.PTR],p.U32),
            ('TerminateJobObject',[p.PTR,p.U32],p.I32),('TerminateProcess',[p.PTR,p.U32],p.I32),
            ('GetWindowsDirectoryW',[C.c_wchar_p,p.U32],p.U32),('GetModuleFileNameW',[p.PTR,C.c_wchar_p,p.U32],p.U32),
        ]:
            function=getattr(self.k,name);function.argtypes=args;function.restype=result

    close=p.Windows.close

    def location(self,executable):
        buffer=C.create_unicode_buffer(32768)
        count=(self.k.GetModuleFileNameW(None,buffer,len(buffer)) if executable else self.k.GetWindowsDirectoryW(buffer,len(buffer)))
        p.require(0<count<len(buffer),'runtime-location',C.get_last_error())
        windows_path(buffer.value);return buffer.value

    def wait(self,handle,timeout):
        value=self.k.WaitForSingleObject(handle,timeout)
        if type(value) is not int or value not in (0,258):self.uncertain=True;raise p.ProbeError('native-wait',C.get_last_error())
        return value==0

    def inheritable(self,handle):
        flags=p.U32();p.require(self.k.GetHandleInformation(handle,C.byref(flags)),'handle-flags',C.get_last_error())
        p.require(not flags.value & ~3,'handle-flags');return bool(flags.value&1)

    def exit_code(self,handle):
        code=p.U32()
        if not self.k.GetExitCodeProcess(handle,C.byref(code)):self.uncertain=True;raise p.ProbeError('process-exit-code',C.get_last_error())
        return code.value


class Session:
    def __init__(self,native):
        self.n=native;self.handles={};self.buffers=[];self.info=Process();self.attributes=None;self.attributes_ready=False;self.accounting_reads=[]
        self.create_started=False;self.create_returned=False;self.create_succeeded=None;self.create_acknowledged=False;self.resumed=False;self.finished=False;self.uncertain=False;self.job_closed=False
        p._RETAINED.append(self)  # Before issue and before caller assignment.
        try:self.prepare()
        except BaseException as error:
            known_no_child=not self.create_started or self.create_returned and self.create_succeeded is False and not any((self.info.process,self.info.thread,self.info.pid,self.info.tid))
            if isinstance(error,p.ProbeError) and not native.uncertain and (self.create_acknowledged or known_no_child):
                try:
                    if not self.cleanup():self.uncertain=True;native.uncertain=True
                except BaseException:self.uncertain=True;native.uncertain=True
            else:self.uncertain=True;native.uncertain=True
            raise

    def hold(self,name,handle):
        p.require(name not in self.handles and handle and handle!=p.PTR(-1).value and handle not in self.handles.values(),'new-handle')
        self.handles[name]=handle;return handle

    def close(self,name):
        handle=self.handles.get(name)
        if handle:
            try:self.n.close(handle);self.handles[name]=None
            except BaseException:self.uncertain=True;self.n.uncertain=True;raise

    def limits(self):
        value=m.ExtendedLimits();self.buffers.append(value)
        p.require(self.n.k.QueryInformationJobObject(self.handles['job'],9,C.byref(value),C.sizeof(value),None),'job-limits-readback',C.get_last_error())
        p.require(value.basic.flags==FLAGS and value.basic.active_process_limit==1 and value.process_memory_limit==MEMORY_BYTES and value.job_memory_limit==MEMORY_BYTES,'job-limits-drift')
        return value

    def accounting(self,expected_total=1,*,phase='suspended'):
        p.require(type(expected_total) is int and expected_total in (0,1) and type(phase) is str and phase in ('suspended','ready','stopped','cleanup') and len(self.accounting_reads)<4,'accounting-request')
        value=Accounting();self.buffers.append(value)
        p.require(self.n.k.QueryInformationJobObject(self.handles['job'],1,C.byref(value),C.sizeof(value),None),'job-accounting',C.get_last_error())
        self.accounting_reads.append(accounting_fact(expected_total,phase,value))
        p.require(value.total==expected_total and value.active<=expected_total,'job-process-count')
        return value

    def prepare(self):
        n=self.n;k=n.k
        job=self.hold('job',k.CreateJobObjectW(None,None));p.require(not n.inheritable(job),'job-inheritance')
        limits=m.ExtendedLimits();limits.basic.flags=FLAGS;limits.basic.active_process_limit=1;limits.process_memory_limit=limits.job_memory_limit=MEMORY_BYTES;self.buffers.append(limits)
        p.require(k.SetInformationJobObject(job,9,C.byref(limits),C.sizeof(limits)),'job-limits-set',C.get_last_error());self.limits()
        security=Security(C.sizeof(Security),None,True);self.buffers.append(security)
        for name in ('ready','stop'):
            handle=self.hold(name,k.CreateEventW(C.byref(security),1,0,None));p.require(n.inheritable(handle),'event-inheritance')
        size=C.c_size_t();self.buffers.append(size)
        p.require(not k.InitializeProcThreadAttributeList(None,2,0,C.byref(size)) and C.get_last_error()==122 and 0<size.value<=65536,'attribute-size')
        self.attributes=C.create_string_buffer(size.value);self.buffers.append(self.attributes)
        p.require(k.InitializeProcThreadAttributeList(self.attributes,2,0,C.byref(size)),'attribute-init',C.get_last_error());self.attributes_ready=True
        jobs=(p.PTR*1)(job);events=(p.PTR*2)(self.handles['ready'],self.handles['stop']);startup=StartupEx();self.buffers.extend([jobs,events,startup])
        p.require(k.UpdateProcThreadAttribute(self.attributes,0,0x2000d,C.byref(jobs),C.sizeof(jobs),None,None),'attribute-job-list',C.get_last_error())
        p.require(k.UpdateProcThreadAttribute(self.attributes,0,0x20002,C.byref(events),C.sizeof(events),None,None),'attribute-event-list',C.get_last_error())
        startup.startup.cb=C.sizeof(startup);startup.attributes=C.cast(self.attributes,p.PTR)
        executable=n.location(True);windows=n.location(False);values=isolated_environment(windows)
        environment=C.create_unicode_buffer('\0'.join(key+'='+value for key,value in sorted(values.items(),key=lambda row:row[0].casefold()))+'\0')
        command=C.create_unicode_buffer(subprocess.list2cmdline(worker_arguments(executable,*[self.handles[name] for name in ('ready','stop')])))
        self.buffers.extend([environment,command,self.info]);self.create_started=True
        created=k.CreateProcessW(executable,command,None,None,True,0x80000|0x4|0x400|0x8,environment,str(windows_path(windows)/'System32'),C.byref(startup),C.byref(self.info))
        self.create_succeeded=bool(created);self.create_returned=True
        p.require(created and self.info.process not in (None,p.PTR(-1).value) and self.info.thread not in (None,p.PTR(-1).value) and self.info.process!=self.info.thread and self.info.pid>0 and self.info.tid>0,'atomic-create',C.get_last_error())
        self.create_acknowledged=True;self.hold('process',self.info.process);self.hold('thread',self.info.thread)
        p.require(not n.inheritable(self.info.process) and not n.inheritable(self.info.thread),'process-inheritance')
        p.require(k.GetProcessId(self.info.process)==self.info.pid,'created-process-identity')
        member=p.I32();self.buffers.append(member)
        p.require(k.IsProcessInJob(self.info.process,job,C.byref(member)) and member.value==1,'atomic-job-membership',C.get_last_error())
        p.require(self.accounting().active==1,'suspended-process-count');self.limits()
        k.DeleteProcThreadAttributeList(self.attributes);self.attributes_ready=False
        p.require(k.ResumeThread(self.info.thread)==1,'thread-resume',C.get_last_error());self.resumed=True
        self.close('thread')

    def observe_ready(self):
        p.require(self.n.wait(self.handles['ready'],READY_MS),'worker-ready-timeout')
        p.require(not self.n.wait(self.handles['process'],0) and self.n.exit_code(self.handles['process'])==259,'worker-not-live')
        self.limits();p.require(self.accounting(phase='ready').active==1,'ready-process-count')

    def cleanup(self):
        if self.finished:return True
        if self.uncertain or self.n.uncertain:return False
        try:
            process=self.handles.get('process')
            if process and not self.n.wait(process,0):
                if self.handles.get('job'):
                    p.require(self.n.k.TerminateJobObject(self.handles['job'],FORCED_EXIT),'owned-job-stop',C.get_last_error())
                    exited=self.n.wait(process,EXIT_MS)
                else:exited=False
                if not exited:p.require(self.create_acknowledged and self.n.k.TerminateProcess(process,FORCED_EXIT),'owned-created-process-stop',C.get_last_error())
                p.require(self.n.wait(process,EXIT_MS),'owned-process-exit-unconfirmed')
            if process:p.require(self.n.exit_code(process)!=259,'owned-process-still-active')
            if self.handles.get('job'):
                p.require(self.accounting(1 if self.create_acknowledged else 0,phase='cleanup').active==0,'owned-job-not-empty')
                if self.create_acknowledged:self.limits()
            if self.attributes_ready:self.n.k.DeleteProcThreadAttributeList(self.attributes);self.attributes_ready=False
            for name in ('thread','process','ready','stop','job'):self.close(name)
            self.finished=True;p.retire_reference(self);return True
        except BaseException:self.uncertain=True;self.n.uncertain=True;raise


def run_case(native,name):
    p.require(name in CASES,'job-case');session=Session(native);facts={'case':name,'atomic_membership_read_back':True,'single_process_limit_read_back':True,'synthetic_worker_resumed':session.resumed}
    try:
        session.observe_ready();facts['ready_and_live_observed']=True
        if name=='event-signalled-exit':p.require(native.k.SetEvent(session.handles['stop']),'stop-event',C.get_last_error())
        else:session.close('job');session.job_closed=True;facts['last_job_handle_closed']=True
        p.require(native.wait(session.handles['process'],EXIT_MS),'worker-exit-timeout')
        code=native.exit_code(session.handles['process'])
        p.require(code==23 if name=='event-signalled-exit' else code not in (259,*WORKER_VOLUNTARY_CODES),'worker-exit-code')
        facts.update(native_process_exit_observed=True,exit_code=code)
        if session.handles.get('job'):
            p.require(session.accounting(phase='stopped').active==0,'job-active-after-exit');limits=session.limits()
            facts.update(job_active_zero_observed=True,peak_process_commit_bytes=limits.peak_process_memory,peak_job_commit_bytes=limits.peak_job_memory)
        facts['status']='observed'
    except p.ProbeError as error:p.record_failure(facts,error,'observation')
    finally:
        try:facts['cleanup_confirmed']=session.cleanup()
        except p.ProbeError as error:facts['cleanup_confirmed']=False;p.record_failure(facts,error,'cleanup')
        facts['job_accounting']=[row.copy() for row in session.accounting_reads]
    return facts


def self_test():
    before=len(p._RETAINED);value=plan();value.update(status='evidence-collected-review-required',cases=[])
    try:
        native=Windows()
        for name in CASES:
            value['native_effects']=True;value['synthetic_worker_start_attempted']=True;row=run_case(native,name);value['cases'].append(row)
            value['synthetic_worker_start_observed']|=row.get('synthetic_worker_resumed') is True
            if not row.get('cleanup_confirmed'):break
    except p.ProbeError as error:value.update(status='failed',failure_stage=error.stage,native_code=error.code)
    except BaseException:value.update(status='failed',failure_stage='job-interrupted-or-internal-error',native_code=0)
    value['unconfirmed_native_lifetime']=len(p._RETAINED)>before
    value['all_cases_observed']=len(value['cases'])==len(CASES) and all(row.get('status')=='observed' and row.get('cleanup_confirmed') is True for row in value['cases'])
    return value


def main(argv=None):
    parser=p.ProbeParser(prog='windows-owned-job-probe',description=__doc__)
    mode=parser.add_mutually_exclusive_group();mode.add_argument('--plan',action='store_true');mode.add_argument('--self-test',action='store_true');args=parser.parse_args(argv)
    if not args.self_test:print(json.dumps(plan(),sort_keys=True));return 0
    owner=Owner()
    try:owner.start();return owner.finish(self_test())
    except BaseException:owner.abort(failed_report('job-interrupted-or-internal-error'))


if __name__=='__main__':raise SystemExit(main())
