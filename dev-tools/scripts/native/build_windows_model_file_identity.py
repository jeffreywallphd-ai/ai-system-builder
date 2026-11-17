"""Fixed no-fetch build for the private Windows read-only identity mechanism.

No arbitrary source, compiler, flags or destination arguments. The compiler runs
inside an unnamed, bounded, kill-on-close job owned by a disposable worker.
"""
from __future__ import annotations
import argparse
import ctypes
import gc
import hashlib
import json
import os
from pathlib import Path
import platform
import re
import struct
import subprocess
import sys
import time
import uuid

SCRIPT=Path(__file__).resolve();ROOT=SCRIPT.parents[3]
sys.path.insert(0,str(ROOT/'dev-tools/scripts/qualification'))
import run_trained_context_qualification as owned
from windows_qualification_memory import ExtendedLimits

PROFILE='windows-x64-msvc1442-sdk26100-v1'
MSVC=Path('C:/Program Files (x86)/Microsoft Visual Studio/2022/BuildTools/VC/Tools/MSVC/14.42.34433')
SDK=Path('C:/Program Files (x86)/Windows Kits/10')
SDK_VERSION='10.0.26100.0'
NAMESPACE=ROOT/'artifacts/tmp/native-model-identity'
SOURCE=ROOT/'modules/adapters/model/local/native/windows/model_file_identity.cc'
OUTPUT_NAMES={'model_file_identity.exe','model_file_identity.obj','dependencies.json','build.log','manifest.json','job-observations.json'}


def safe(path,kind=None):
    if not path.is_absolute():raise ValueError('Build input must be absolute.')
    for part in (path,*path.parents):
        value=part.lstat()
        if part.is_symlink() or getattr(value,'st_file_attributes',0)&0x400:raise ValueError('Redirected build input denied.')
    if kind=='file' and not path.is_file() or kind=='directory' and not path.is_dir():raise ValueError('Build input type unavailable.')
    return path


def digest(path):
    before=safe(path,'file').stat();result=hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda:stream.read(1024**2),b''):result.update(block)
        opened=os.fstat(stream.fileno())
    after=safe(path,'file').stat()
    identity=lambda s:(s.st_dev,s.st_ino,s.st_size,s.st_mtime_ns)
    if identity(before)!=identity(opened) or identity(before)!=identity(after):raise ValueError('Build input changed.')
    return result.hexdigest()


def profile():
    if os.name!='nt' or struct.calcsize('P')!=8 or platform.machine().lower() not in ('amd64','x86_64'):raise ValueError('Native build profile unavailable.')
    includes=[MSVC/'include',*(SDK/'Include'/SDK_VERSION/part for part in ('shared','um','ucrt'))]
    libraries=[*(MSVC/'lib/x64'/name for name in ('libcpmt.lib','libcmt.lib','libvcruntime.lib','oldnames.lib')),SDK/'Lib'/SDK_VERSION/'ucrt/x64/libucrt.lib',*(SDK/'Lib'/SDK_VERSION/'um/x64'/name for name in ('kernel32.lib','advapi32.lib','ntdll.lib'))]
    compiler=MSVC/'bin/Hostx64/x64/cl.exe'
    for path in [compiler,compiler.with_name('link.exe'),SOURCE,*libraries]:safe(path,'file')
    for path in includes:safe(path,'directory')
    return compiler,includes,libraries


def inventory(compiler,includes,libraries):
    result={};count=total=0
    roots=[('compiler',compiler.parent),*((f'include-{i}',root) for i,root in enumerate(includes))]
    pending=list(roots)
    while pending:
        label,folder=pending.pop();safe(folder,'directory')
        for path in sorted(folder.iterdir()):
            safe(path)
            if path.is_dir():pending.append((label+'/'+path.name,path))
            elif path.is_file():
                count+=1;total+=path.stat().st_size
                if count>20000 or total>1024**3:raise ValueError('Fixed build inventory exceeds its inspection bound.')
                result[label+'/'+path.name]=digest(path)
            else:raise ValueError('Unsupported build input.')
    for i,path in enumerate(libraries):result[f'library-{i}/{path.name}']=digest(path)
    for path in (SOURCE,SCRIPT,ROOT/'dev-tools/scripts/qualification/run_trained_context_qualification.py',ROOT/'dev-tools/scripts/qualification/windows_qualification_memory.py'):
        result[path.relative_to(ROOT).as_posix()]=digest(path)
    return result


def argv(compiler,includes,libraries,folder):
    return [str(compiler),'/nologo','/std:c++20','/EHsc','/W4','/WX','/sdl','/GS','/guard:cf','/MT','/O2','/DUNICODE','/D_UNICODE','/D_WIN32_WINNT=0x0A00',
        *(f'/I{path}' for path in includes),f'/Fo{folder/"model_file_identity.obj"}',f'/Fe{folder/"model_file_identity.exe"}',
        '/sourceDependencies',str(folder/'dependencies.json'),str(SOURCE),'/link','/NODEFAULTLIB',*(str(path) for path in libraries),
        '/DYNAMICBASE','/HIGHENTROPYVA','/NXCOMPAT','/INCREMENTAL:NO','/guard:cf','/SUBSYSTEM:CONSOLE']


def create_output_folder():
    """Admit each existing ancestor before creating anything beneath it.

    This denies observed redirects, not hostile check/use substitutions. Output
    roots and components are fixed; only the exclusive leaf identity is random.
    """
    if NAMESPACE!=ROOT/'artifacts/tmp/native-model-identity':raise ValueError('Fixed build output namespace differs.')
    safe(ROOT,'directory')
    for folder in (ROOT/'artifacts',ROOT/'artifacts/tmp',NAMESPACE):
        try:folder.lstat()
        except FileNotFoundError:
            safe(folder.parent,'directory')
            folder.mkdir(exist_ok=False)
        safe(folder,'directory')
    folder=NAMESPACE/uuid.uuid4().hex
    safe(NAMESPACE,'directory')
    folder.mkdir(exist_ok=False)
    return safe(folder,'directory')


class CompilerJob:
    def __init__(self):
        self.kernel=ctypes.WinDLL('kernel32',use_last_error=True);k=self.kernel
        signatures={'CreateJobObjectW':([ctypes.c_void_p,ctypes.c_wchar_p],ctypes.c_void_p),'SetInformationJobObject':([ctypes.c_void_p,ctypes.c_int,ctypes.c_void_p,ctypes.c_ulong],ctypes.c_int),'AssignProcessToJobObject':([ctypes.c_void_p,ctypes.c_void_p],ctypes.c_int),'QueryInformationJobObject':([ctypes.c_void_p,ctypes.c_int,ctypes.c_void_p,ctypes.c_ulong,ctypes.c_void_p],ctypes.c_int),'GetCurrentProcess':([],ctypes.c_void_p),'CloseHandle':([ctypes.c_void_p],ctypes.c_int)}
        for name,(args,result) in signatures.items():getattr(k,name).argtypes=args;getattr(k,name).restype=result
        for name,args,result in (
            ('OpenProcess',[ctypes.c_ulong,ctypes.c_int,ctypes.c_ulong],ctypes.c_void_p),
            ('IsProcessInJob',[ctypes.c_void_p,ctypes.c_void_p,ctypes.POINTER(ctypes.c_int)],ctypes.c_int),
            ('TerminateProcess',[ctypes.c_void_p,ctypes.c_uint],ctypes.c_int),
            ('WaitForSingleObject',[ctypes.c_void_p,ctypes.c_ulong],ctypes.c_ulong),
            ('GetExitCodeProcess',[ctypes.c_void_p,ctypes.POINTER(ctypes.c_ulong)],ctypes.c_int),
            ('QueryFullProcessImageNameW',[ctypes.c_void_p,ctypes.c_ulong,ctypes.c_wchar_p,ctypes.POINTER(ctypes.c_ulong)],ctypes.c_int)):
            getattr(k,name).argtypes=args;getattr(k,name).restype=result
        self.handle=k.CreateJobObjectW(None,None)
        if not self.handle:raise ValueError('Compiler job unavailable.')
        limits=ExtendedLimits();limits.basic.flags=0x2000|0x100|0x200|0x8;limits.basic.active_process_limit=8
        limits.process_memory_limit=limits.job_memory_limit=2*1024**3
        if not k.SetInformationJobObject(self.handle,9,ctypes.byref(limits),ctypes.sizeof(limits)) or not k.AssignProcessToJobObject(self.handle,k.GetCurrentProcess()):
            k.CloseHandle(self.handle);self.handle=None;raise ValueError('Compiler job admission denied.')
        # Keep this non-inheritable job handle live through worker exit. Closing
        # it kills only this assigned worker and its future compiler descendants.

    def evidence(self):
        limits=ExtendedLimits()
        class Accounting(ctypes.Structure):
            _fields_=[('user',ctypes.c_longlong),('kernel',ctypes.c_longlong),('period_user',ctypes.c_longlong),('period_kernel',ctypes.c_longlong),('faults',ctypes.c_ulong),('total',ctypes.c_ulong),('active',ctypes.c_ulong),('terminated',ctypes.c_ulong)]
        accounting=Accounting();k=self.kernel
        if not k.QueryInformationJobObject(self.handle,9,ctypes.byref(limits),ctypes.sizeof(limits),None) or not k.QueryInformationJobObject(self.handle,1,ctypes.byref(accounting),ctypes.sizeof(accounting),None):raise ValueError('Compiler job readback unavailable.')
        if limits.basic.flags&0x2308!=0x2308 or limits.basic.active_process_limit!=8 or limits.job_memory_limit!=2*1024**3 or limits.process_memory_limit!=2*1024**3:raise ValueError('Compiler job policy differs.')
        class Members(ctypes.Structure):
            _fields_=[('assigned',ctypes.c_ulong),('count',ctypes.c_ulong),('pids',ctypes.c_size_t*8)]
        members=Members()
        if not k.QueryInformationJobObject(self.handle,3,ctypes.byref(members),ctypes.sizeof(members),None) or members.count>8:raise ValueError('Compiler job membership unavailable.')
        return {'profile':'owned-compiler-job-v1','enforced':True,'active_processes':accounting.active,'member_pids':list(members.pids[:members.count]),'process_commit_limit_bytes':limits.process_memory_limit,'job_commit_limit_bytes':limits.job_memory_limit,'peak_job_commit_bytes':limits.peak_job_memory,'kill_on_last_handle_close':True}

    def stop_remaining_children(self):
        """After cl exited, release only pinned members of this private job.

        No PID supplied by a caller, image-name match or system-wide termination.
        Membership is checked on the exact opened handle before any effect.
        """
        stopped=[];deadline=time.monotonic()+5;k=self.kernel
        while True:
            members=self.evidence()
            if members['active_processes']==1 and members['member_pids']==[os.getpid()]:return stopped
            if time.monotonic()>=deadline or len(stopped)>=32:raise ValueError('Compiler cleanup remains pending.')
            for pid in members['member_pids']:
                if pid==os.getpid():continue
                handle=k.OpenProcess(0x00100000|0x1000|0x0001,False,pid)
                if not handle:
                    # A disappearing member may already have exited; only the
                    # next exact job readback can establish group completion.
                    continue
                try:
                    assigned=ctypes.c_int()
                    if not k.IsProcessInJob(handle,self.handle,ctypes.byref(assigned)) or not assigned.value:raise ValueError('Compiler child ownership denied.')
                    name=ctypes.create_unicode_buffer(32768);length=ctypes.c_ulong(len(name))
                    image='compiler-child'
                    if k.QueryFullProcessImageNameW(handle,0,name,ctypes.byref(length)):
                        candidate=Path(name.value).name
                        if re.fullmatch('[A-Za-z0-9._-]{1,128}',candidate):image=candidate
                    requested=k.WaitForSingleObject(handle,0)==258
                    if requested and not k.TerminateProcess(handle,9) and k.WaitForSingleObject(handle,0)!=0:raise ValueError('Compiler child shutdown unavailable.')
                    remaining=max(0,min(2000,int((deadline-time.monotonic())*1000)))
                    code=ctypes.c_ulong()
                    if k.WaitForSingleObject(handle,remaining)!=0 or not k.GetExitCodeProcess(handle,ctypes.byref(code)):raise ValueError('Compiler child exit unconfirmed.')
                    stopped.append({'pid':pid,'image_basename':image,'membership_checked_on_handle':True,'termination_requested':requested,'native_exit_code':code.value})
                finally:
                    if not k.CloseHandle(handle):raise ValueError('Compiler child handle release unconfirmed.')
            time.sleep(.02)


def worker(args):
    print(json.dumps({'kind':'identity','pid':os.getpid(),'parent_pid':os.getppid()}),flush=True)
    if sys.stdin.readline().strip()!='observe':raise ValueError('Native build observation handshake denied.')
    if args.model_manifest!=PROFILE or not re.fullmatch('[a-f0-9]{32}',args.run_id or ''):raise ValueError('Fixed build identity invalid.')
    folder=safe(NAMESPACE/args.run_id,'directory')
    if any(folder.iterdir()):raise ValueError('Native build output must be exclusively empty.')
    compiler,includes,libraries=profile();inputs=inventory(compiler,includes,libraries)
    job=CompilerJob();observations={'before_compile':job.evidence()}
    print(json.dumps({'kind':'ready','pid':os.getpid(),'parent_pid':os.getppid(),'rss_bytes':owned.rss(os.getpid())}),flush=True)
    if sys.stdin.readline().strip()!='run':raise ValueError('Native build run handshake denied.')
    environment={key:os.environ[key] for key in ('SystemRoot','WINDIR','TEMP','TMP') if key in os.environ}
    environment.update(PATH=str(compiler.parent)+';C:/Windows/System32',VSLANG='1033')
    log=folder/'build.log'
    started=time.monotonic()
    with log.open('xb') as output:
        process=subprocess.Popen(argv(compiler,includes,libraries,folder),cwd=folder,env=environment,stdin=subprocess.DEVNULL,stdout=output,stderr=subprocess.STDOUT,creationflags=subprocess.CREATE_NO_WINDOW)
        # The inherited unnamed job bounds all compiler descendants. On failure
        # worker exit closes its sole handle; no foreign PID/tree is targeted.
        while process.poll() is None:
            if time.monotonic()-started>120 or log.stat().st_size>1024**2:raise ValueError('Compiler exceeded fixed bounds.')
            time.sleep(.02)
        if process.returncode!=0:raise ValueError('Native compilation failed.')
        compiler_exit_code=process.returncode
    observations['after_compiler_exit']=job.evidence()
    process=None;gc.collect()
    shutdown_deadline=time.monotonic()+.2
    while job.evidence()['active_processes']!=1 and time.monotonic()<shutdown_deadline:time.sleep(.02)
    observations['owned_child_shutdown']=job.stop_remaining_children()
    evidence=job.evidence()
    observations['after_process_handle_release']=evidence
    (folder/'job-observations.json').write_text(json.dumps(observations,indent=2)+'\n',encoding='utf-8')
    if evidence['active_processes']!=1:raise ValueError('Compiler descendants have not exited.')
    if inventory(compiler,includes,libraries)!=inputs:raise ValueError('Native build inputs changed.')
    if {p.name for p in folder.iterdir()}-OUTPUT_NAMES:raise ValueError('Unexpected native build output.')
    dependencies=json.loads((folder/'dependencies.json').read_text(encoding='utf-8-sig'))
    for include in dependencies['Data']['Includes']:
        path=safe(Path(include),'file')
        if not any(path.is_relative_to(root) for root in includes):raise ValueError('Compiler used an external header.')
    manifest={'schema':'windows-file-identity-build-v1','profile':PROFILE,'source':SOURCE.relative_to(ROOT).as_posix(),'source_sha256':digest(SOURCE),'binary_sha256':digest(folder/'model_file_identity.exe'),'inputs':inputs,'compiler_exit_code':compiler_exit_code,'seconds':time.monotonic()-started,'compiler_job':evidence,'limits':'Cooperative pinned installed build profile; not a production signing/packaging, hostile toolchain or filesystem authority qualification.'}
    with (folder/'manifest.json').open('x',encoding='utf-8') as output:output.write(json.dumps(manifest,indent=2)+'\n')
    print(json.dumps({'kind':'result','build':str(folder.relative_to(ROOT)).replace('\\','/'),'binary_sha256':manifest['binary_sha256'],'cleanup_passed':True,'compiler_job':evidence}),flush=True)


def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--plan',action='store_true');parser.add_argument('--child');parser.add_argument('--run-id');parser.add_argument('--model-manifest');parser.add_argument('--count');parser.add_argument('--variant');parser.add_argument('--device');parser.add_argument('--phase');parser.add_argument('--profile');parser.add_argument('--samples')
    args=parser.parse_args()
    if args.child:
        if args.child!='measure':raise ValueError('Unsupported native build worker.')
        worker(args);return
    compiler,includes,libraries=profile()
    if args.plan:
        print(json.dumps({'profile':PROFILE,'available':True,'fetch':False,'shell':False,'source':SOURCE.relative_to(ROOT).as_posix(),'includes':len(includes),'libraries':len(libraries),'compiler_seconds':120,'compiler_job_commit_bytes':2*1024**3,'compiler_process_limit':8}));return
    folder=create_output_folder()
    owned.SCRIPT=SCRIPT
    result=owned.run_child(argparse.Namespace(samples=1,model_manifest=PROFILE),folder,1,'measure',early_identity=True)
    print(json.dumps(result),flush=True)


if __name__=='__main__':main()
