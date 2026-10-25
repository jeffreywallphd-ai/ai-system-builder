"""Closed model-free native qualification and private reviewed host composition.

Public CLI: --native-selftest only. Internal child roles are fixed. No command,
PID, cwd, shell or caller JSON execution interface exists. Cooperative reviewed
Python composition may issue only fixed package/UI forms for synthetic dataset
delivery or real Windows OCR with synthetic generation.
"""
from __future__ import annotations
import argparse
import copy
import ctypes as c
from dataclasses import dataclass
import hashlib
import json
import os
from pathlib import Path
import queue
import re
import subprocess
import sys
import threading
import time
from types import MappingProxyType
import uuid

_MODULE=Path(__file__).resolve()
_REPO=_MODULE.parents[3]
_SELFTEST_RUNS=_REPO/".local-codex/native-ui-budget-command-selftests-v3"
_PENDING={}
_LIVE={}
_ISSUED={}
_FIXTURES=frozenset(("stdio","failure","timeout","hold","overflow","natural-expiry","ui-budget"))
_CONSUMER_FILES=("offline-package.mjs","playwright.config.mjs","global-setup.mjs","package-tree.mjs")
_OCR_IMPORT_RUNS=_REPO/".local-codex/native-ocr-runtime-import-v1/runs"
_OCR_IMPORT_PYTHON_SHA="1c4e9fbd9259294528031a567cef76b0a45254b66d612cf58de267928d1defbb"
_OCR_IMPORT_CONFIG_SHA="27821a1b627f7753b1cdb5e70b94e668987fd10499ee0ded9214e3add51b92a5"
_OCR_IMPORT_SCRIPT='''from pathlib import Path
import json, os, re

def fact(name, stage, **values):
    body = {"schema_version": "ocr-runtime-import-fact-v1", "stage": stage,
            "pid": os.getpid(), "parent_pid": os.getppid(), **values}
    data = (json.dumps(body, separators=(",", ":")) + "\\n").encode()
    if len(data) > 1024: raise RuntimeError("diagnostic-fact-bound")
    with Path(name).open("xb") as stream:
        stream.write(data); stream.flush(); os.fsync(stream.fileno())

fact("01-before-import.json", "before-import")
imported = False
stage = "import"
try:
    import torch
    imported = True
    fact("02-import-complete.json", "import-complete")
    stage = "accelerator-check"
    available = bool(torch.cuda.is_available())
except BaseException as error:
    kind = type(error).__name__
    if not re.fullmatch(r"[A-Za-z][A-Za-z0-9_]{0,63}", kind): kind = "UnknownError"
    fact("03-final.json", "finished", imported=imported,
         accelerator_available=None, success=False, failure_stage=stage, error_type=kind)
    raise SystemExit(1) from None
fact("03-final.json", "finished", imported=True,
     accelerator_available=available, success=True, failure_stage=None, error_type=None)
'''


def _retain_pending(owner):
    # Exact live objects/handles stay strongly referenced; no reset/adoption API.
    _PENDING[id(owner)]=owner


def _assert_no_pending():
    if _PENDING:raise NativeFailure("uncertain-owned-state-blocks-successor")


def _register_owner(owner):
    _assert_no_pending()
    need(not _LIVE,"active-owned-state-blocks-successor")
    _LIVE[id(owner)]=owner


def _digest(file):
    result=hashlib.sha256()
    with file.open("rb") as stream:
        for chunk in iter(lambda:stream.read(1024*1024),b""):result.update(chunk)
    return result.hexdigest()


def _implementation_hashes():
    return {"owned_command_job.py":_digest(_MODULE)}


def _regular_directory(path,anchor,create=False):
    need(anchor.resolve()==anchor and path.is_relative_to(anchor),"directory-confinement")
    current=anchor
    for part in path.relative_to(anchor).parts:
        current=current/part
        if not current.exists() and not current.is_symlink():
            need(create,"owned-directory-absent");current.mkdir()
        info=current.lstat()
        need(current.is_dir() and not current.is_symlink() and not (getattr(info,"st_file_attributes",0)&0x400) and current.resolve()==current,"redirected-directory")


@dataclass(frozen=True)
class _Intent:
    phase:str
    argv:tuple[str,...]
    cwd:Path
    environment:object
    seconds:float
    folder:Path
    source_hashes:object
    consumer_hashes:object


def _remember(intent):
    _ISSUED[id(intent)]=intent
    return intent


def _fixture_intent(role,folder):
    need(role in _FIXTURES,"unknown-fixed-fixture-role")
    need(folder.parent.parent==_SELFTEST_RUNS and re.fullmatch(r"[a-f0-9]{32}",folder.parent.name) and folder.name==role,"fixed-fixture-folder")
    _regular_directory(folder,_REPO)
    env={key:os.environ[key] for key in ("SystemRoot","WINDIR") if key in os.environ}
    return _remember(_Intent("fixture:"+role,(str(Path(sys.executable).resolve()),"-I","-S","-B",str(_MODULE),"--fixture",role),_MODULE.parent,MappingProxyType(env),1.5 if role=="timeout" else 8,folder,MappingProxyType(_implementation_hashes()),MappingProxyType({})))


def _reviewed_host_intent(phase,*,candidate,node_executable,node_sha256,run,folder,reviewed_file_hashes,environment,environment_sha256,review_digest):
    """Private trusted-source composition; never routed from command JSON/CLI.

    The owning reviewed consumer supplies immutable source/environment witnesses.
    This validates their exact bytes and constructs only two literal argv forms;
    these local attestations coordinate cooperative code, not hostile-user auth.
    """
    need(phase in ("package","ui"),"unknown-fixed-host-role")
    need(candidate.is_absolute() and candidate.resolve()==candidate and re.fullmatch(r"\.local-codex/q/[a-f0-9]{8}/c",candidate.relative_to(_REPO).as_posix()),"fixed-candidate")
    helpers=candidate/".local-codex/native-fixed-host-operator/v1"
    need(run.parent==candidate/".local-codex/native-fixed-host-operator/runs" and re.fullmatch(r"[a-f0-9]{32}",run.name) and folder==run/phase,"fixed-host-run")
    need(node_executable.is_absolute() and node_executable.name.lower() in ("node","node.exe") and re.fullmatch(r"[a-f0-9]{64}",node_sha256) and _digest(node_executable)==node_sha256,"reviewed-node-identity")
    need(type(reviewed_file_hashes) is dict and set(reviewed_file_hashes)==set(_CONSUMER_FILES) and re.fullmatch(r"[a-f0-9]{64}",review_digest),"reviewed-consumer-witness")
    bindings={}
    for name,value in reviewed_file_hashes.items():
        need(re.fullmatch(r"[a-f0-9]{64}",value) and _digest(helpers/name)==value,"consumer-source-drift")
        bindings[str(helpers/name)]=value
    env=dict(environment)
    need(all(type(key) is str and type(value) is str and "\0" not in key+value for key,value in env.items()) and len({key.upper() for key in env})==len(env) and sum(len(key)+len(value)+2 for key,value in env.items())<32760,"bounded-environment")
    forbidden=("PYTHONPATH","PYTHONSTARTUP","PYTHONINSPECT","PYTHONOPTIMIZE","LD_PRELOAD","DYLD_INSERT_LIBRARIES")
    need(not any(key in env for key in forbidden) and env.get("NODE_OPTIONS")=="" and env.get("PYTHON_RUNTIME_QUALIFICATION_SCENARIO") in ("dataset-profile", "ocr-documents") and env.get("AISB_LOCAL_DESKTOP_UI_RUN")==str(run) and env.get("HF_HUB_OFFLINE")=="1" and env.get("TRANSFORMERS_OFFLINE")=="1" and env.get("PIP_NO_INDEX")=="1" and env.get("PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD")=="1","fixed-controlled-environment")
    need(env.get("TEMP")==env.get("TMP")==str(candidate.parent/"t") and env.get("HOME")==env.get("USERPROFILE")==str(candidate.parent/"h"),"short-owned-temp-home")
    need(_digest_bytes(json.dumps(env,sort_keys=True,separators=(",",":")).encode())==environment_sha256,"reviewed-environment-drift")
    _regular_directory(folder,_REPO);_regular_directory(candidate.parent/"t",_REPO);_regular_directory(candidate.parent/"h",_REPO)
    argv=(str(node_executable),str(helpers/"offline-package.mjs")) if phase=="package" else (str(node_executable),str(candidate/"node_modules/@playwright/test/cli.js"),"test","--config",str(helpers/"playwright.config.mjs"),"--project=thin-chrome","--project=packaged-desktop")
    bindings[str(node_executable)]=node_sha256
    return _remember(_Intent(phase,argv,candidate,MappingProxyType(env),420,folder,MappingProxyType(_implementation_hashes()),MappingProxyType(bindings)))


def _reviewed_ocr_runtime_import_intent(*,run,folder,review_digest):
    """One closed diagnostic, not the production dependency preparer or a model run.

    No command, script, executable, environment, cwd or quota is caller-selected.
    Only the reviewed existing isolated runtime is permitted. Raw supplier output
    is discarded by this exact role; three bounded child facts carry results.
    """
    need(run.parent==_OCR_IMPORT_RUNS and re.fullmatch(r"[a-f0-9]{32}",run.name) and folder==run/"runtime-import","fixed-ocr-import-run")
    need(re.fullmatch(r"[a-f0-9]{64}",review_digest),"reviewed-ocr-import-witness")
    runtime=_REPO/".local-codex/ocr-cached-runtime-v1/venv"
    python=runtime/"Scripts/python.exe";config=runtime/"pyvenv.cfg"
    for file,expected in ((python,_OCR_IMPORT_PYTHON_SHA),(config,_OCR_IMPORT_CONFIG_SHA)):
        need(file.is_file() and file.stat().st_size<=1024**2 and file.resolve()==file and not file.is_symlink() and not(getattr(file.lstat(),"st_file_attributes",0)&0x400) and _digest(file)==expected,"fixed-ocr-import-runtime")
    _regular_directory(folder,_REPO)
    for name in ("t","h"):_regular_directory(folder/name,_REPO)
    for name in ("stdout.log","stderr.log","01-before-import.json","02-import-complete.json","03-final.json"):
        need(not (folder/name).exists() and not (folder/name).is_symlink(),"fresh-ocr-import-output")
    env={key:os.environ[key] for key in ("SystemRoot","WINDIR") if key in os.environ}
    need("SystemRoot" in env and Path(env["SystemRoot"]).is_absolute(),"fixed-ocr-import-Windows-environment")
    env.update({"PATH":os.pathsep.join((str(python.parent),str(Path(env["SystemRoot"])/"System32"))),
                "HOME":str(folder/"h"),"USERPROFILE":str(folder/"h"),"TEMP":str(folder/"t"),"TMP":str(folder/"t"),
                "PYTHONDONTWRITEBYTECODE":"1","PYTHONNOUSERSITE":"1","PIP_NO_INDEX":"1","PIP_CONFIG_FILE":os.devnull,
                "HF_HUB_OFFLINE":"1","TRANSFORMERS_OFFLINE":"1"})
    bindings={str(python):_OCR_IMPORT_PYTHON_SHA,str(config):_OCR_IMPORT_CONFIG_SHA}
    return _remember(_Intent("ocr-runtime-import",(str(python),"-c",_OCR_IMPORT_SCRIPT),folder,MappingProxyType(env),20,folder,MappingProxyType(_implementation_hashes()),MappingProxyType(bindings)))


def _digest_bytes(value):return hashlib.sha256(value).hexdigest()


def _validate_intent(intent,folder):
    _assert_no_pending()
    need(type(intent) is _Intent and _ISSUED.get(id(intent)) is intent and folder==intent.folder,"external-intent-denied")
    need(_implementation_hashes()==dict(intent.source_hashes),"launcher-source-drift")
    need(all(_digest(Path(name))==value for name,value in intent.consumer_hashes.items()),"reviewed-consumer-drift")
    _regular_directory(folder,_REPO)


def _job_memory_limit(intent):
    # A caller value, environment setting or lookalike role cannot select a
    # quota. Only an exact already-issued immutable intent reaches readback.
    need(type(intent) is _Intent and _ISSUED.get(id(intent)) is intent,"external-budget-intent-denied")
    phase=intent.phase
    need(type(phase) is str and (phase in ("package","ui","ocr-runtime-import") or (phase.startswith("fixture:") and phase[8:] in _FIXTURES)),"unknown-fixed-budget-role")
    return UI_JOB_BYTES if phase in ("ui","fixture:ui-budget") else JOB_BYTES


KILL_CLOSE = 0x2000
LIMIT_FLAGS = KILL_CLOSE | 0x100 | 0x200 | 0x8
PROCESS_BYTES = 1024**3
JOB_BYTES = 2 * 1024**3
UI_JOB_BYTES = 3 * 1024**3
MEMBERS = 32
LOG_CAP = 8 * 1024**2
FORCED_EXIT = 0xE0000042
READ_PROCESS = 0x100000 | 0x1000
JOB_LIST_ATTRIBUTE = 0x2000D
HANDLE_LIST_ATTRIBUTE = 0x20002
COMPLETION_KEY = 0x51484F53
DETACHED_PROCESS = 0x8
ROOT_CREATION_FLAGS = 0x80000 | 0x4 | 0x400 | DETACHED_PROCESS


class NativeFailure(RuntimeError):
    pass


def need(value, phase):
    if not value:
        raise NativeFailure(phase)


class Basic(c.Structure):
    _fields_ = [("process_time",c.c_int64),("job_time",c.c_int64),("flags",c.c_uint32),("minimum_ws",c.c_size_t),("maximum_ws",c.c_size_t),("active_limit",c.c_uint32),("affinity",c.c_size_t),("priority",c.c_uint32),("scheduling",c.c_uint32)]


class Io(c.Structure):
    _fields_ = [(name,c.c_uint64) for name in ("read_ops","write_ops","other_ops","read_bytes","write_bytes","other_bytes")]


class Limits(c.Structure):
    _fields_ = [("basic",Basic),("io",Io),("process_memory",c.c_size_t),("job_memory",c.c_size_t),("peak_process",c.c_size_t),("peak_job",c.c_size_t)]


class Accounting(c.Structure):
    _fields_ = [(name,c.c_int64) for name in ("user","kernel","period_user","period_kernel")] + [(name,c.c_uint32) for name in ("faults","total","active","terminated")]


class Startup(c.Structure):
    _fields_ = [("cb",c.c_uint32),("reserved",c.c_wchar_p),("desktop",c.c_wchar_p),("title",c.c_wchar_p),*[(name,c.c_uint32) for name in ("x","y","width","height","chars_x","chars_y","fill","flags")],("show",c.c_uint16),("reserved_size",c.c_uint16),("reserved_bytes",c.c_void_p),("stdin",c.c_void_p),("stdout",c.c_void_p),("stderr",c.c_void_p)]


class StartupEx(c.Structure):
    _fields_ = [("startup",Startup),("attributes",c.c_void_p)]


class Process(c.Structure):
    _fields_ = [("process",c.c_void_p),("thread",c.c_void_p),("pid",c.c_uint32),("tid",c.c_uint32)]


class Security(c.Structure):
    _fields_ = [("length",c.c_uint32),("descriptor",c.c_void_p),("inherit",c.c_int)]


class FileTime(c.Structure):
    _fields_ = [("low",c.c_uint32),("high",c.c_uint32)]


class CompletionAssociation(c.Structure):
    _fields_ = [("key",c.c_void_p),("port",c.c_void_p)]


class _Win:
    def __init__(self):
        need(os.name == "nt" and c.sizeof(c.c_void_p) == 8,"platform")
        self.k = c.WinDLL("kernel32",use_last_error=True)
        p,w,b = c.c_void_p,c.c_uint32,c.c_int
        signatures = {
          "CreateJobObjectW":([p,c.c_wchar_p],p),"SetInformationJobObject":([p,c.c_int,p,w],b),"QueryInformationJobObject":([p,c.c_int,p,w,p],b),
          "GetHandleInformation":([p,c.POINTER(w)],b),"SetHandleInformation":([p,w,w],b),"CloseHandle":([p],b),
          "InitializeProcThreadAttributeList":([p,w,w,c.POINTER(c.c_size_t)],b),"UpdateProcThreadAttribute":([p,w,c.c_size_t,p,c.c_size_t,p,p],b),"DeleteProcThreadAttributeList":([p],None),
          "CreateProcessW":([c.c_wchar_p,c.c_wchar_p,p,p,b,w,p,c.c_wchar_p,c.POINTER(StartupEx),c.POINTER(Process)],b),
          "IsProcessInJob":([p,p,c.POINTER(b)],b),"ResumeThread":([p],w),"GetProcessId":([p],w),"GetProcessTimes":([p,*[c.POINTER(FileTime)]*4],b),
          "WaitForSingleObject":([p,w],w),"GetExitCodeProcess":([p,c.POINTER(w)],b),"TerminateJobObject":([p,w],b),
          "CreatePipe":([c.POINTER(p),c.POINTER(p),c.POINTER(Security),w],b),"CreateFileW":([c.c_wchar_p,w,w,c.POINTER(Security),w,w,p],p),
          "ReadFile":([p,p,w,c.POINTER(w),p],b),"PeekNamedPipe":([p,p,w,c.POINTER(w),c.POINTER(w),c.POINTER(w)],b),"GetCurrentProcess":([],p),"DuplicateHandle":([p,p,p,c.POINTER(p),w,b,w],b),
          "CreateIoCompletionPort":([p,p,c.c_size_t,w],p),"GetQueuedCompletionStatus":([p,c.POINTER(w),c.POINTER(c.c_size_t),c.POINTER(p),w],b),
        }
        for name,(arguments,result) in signatures.items():
            function=getattr(self.k,name);function.argtypes=arguments;function.restype=result
        need(c.sizeof(Limits)==144 and c.sizeof(StartupEx)==112 and c.sizeof(Process)==24 and c.sizeof(Accounting)==48,"abi")

    def inheritable(self,handle):
        flags=c.c_uint32();need(self.k.GetHandleInformation(handle,c.byref(flags)),"handle-flags")
        return bool(flags.value & 1)

    def identity(self,handle):
        pid=self.k.GetProcessId(handle);times=[FileTime() for _ in range(4)]
        need(pid and self.k.GetProcessTimes(handle,*[c.byref(item) for item in times]),"handle-identity")
        return {"pid":pid,"creation_ticks":times[0].low | times[0].high << 32}

    def member(self,handle,job):
        value=c.c_int();need(self.k.IsProcessInJob(handle,job,c.byref(value)),"membership-query")
        return bool(value.value)

    def exit_code(self,handle,milliseconds=0):
        value=c.c_uint32();need(self.k.WaitForSingleObject(handle,milliseconds)==0 and self.k.GetExitCodeProcess(handle,c.byref(value)) and value.value!=259,"root-native-exit")
        return value.value

    def duplicate_read(self,source_process,source_handle,retain):
        copied=c.c_void_p()
        ok=self.k.DuplicateHandle(source_process,source_handle,self.k.GetCurrentProcess(),c.byref(copied),READ_PROCESS,False,0)
        if copied.value:retain(copied.value)
        need(ok and copied.value,"read-handle-duplicate")
        return copied.value


def strict_shutdown_codes(codes,count):
    return type(count) is int and count>0 and len(codes)==count and all(type(code) is int and code==0 for code in codes)


class _OwnedJob:
    """Private fixed-intent adapter. No adoption, AssignProcess, PID termination or breakaway."""
    def __init__(self,intent,folder):
        _validate_intent(intent,folder)
        self.intent,self.folder=intent,folder
        self.n=None;self.job=None;self.process=None;self.owned={};self.threads=[];self.log_state={};self.overflow=threading.Event();self.pipe_error=threading.Event();self.first=queue.Queue(maxsize=1)
        self.resume_done=False;self.assigned=False;self.peak_active=0;self.forced=False;self.cleanup_errors=[];self.events=[];self.limit_messages=[];self.limit_notifications=[];self.event_overflow=False
        self.phase="new";self.final_result=None
        _register_owner(self)
        try:self.n=_Win()
        except BaseException:
            _retain_pending(self)
            raise

    def hold(self,name,handle):
        need(handle and handle!=c.c_void_p(-1).value,"handle-create-"+name);self.owned[name]=handle;return handle

    def close(self,name):
        handle=self.owned.get(name)
        if handle:
            try:
                need(self.n.k.CloseHandle(handle),"close-"+name)
            except BaseException as error:
                self.cleanup_errors.append("close-"+name+":"+type(error).__name__)
                _retain_pending(self)
                return False
            del self.owned[name]
        return True

    def limits(self):
        need(self.job is not None and self.owned.get("job")==self.job,"owned-job-ledger-required")
        expected_job_bytes=_job_memory_limit(self.intent)
        value=Limits();need(self.n.k.QueryInformationJobObject(self.job,9,c.byref(value),c.sizeof(value),None),"limits-readback")
        need(value.basic.flags==LIMIT_FLAGS and value.basic.active_limit==MEMBERS and value.process_memory==PROCESS_BYTES and value.job_memory==expected_job_bytes,"limits-drift")
        return value

    def accounting(self):
        need(self.job is not None and self.owned.get("job")==self.job,"owned-job-ledger-required")
        value=Accounting();need(self.n.k.QueryInformationJobObject(self.job,1,c.byref(value),c.sizeof(value),None),"accounting-readback")
        need(value.active<=MEMBERS and value.total>=value.active,"accounting-count")
        self.peak_active=max(self.peak_active,value.active)
        return {"total":value.total,"active":value.active,"terminated":value.terminated}

    def poll_events(self):
        # Notifications are advisory. Their absence never proves no limit hit;
        # native membership/accounting/exit handles independently prove cleanup.
        port=self.owned.get("completion-port")
        if not port:return
        for _ in range(128):
            message=c.c_uint32();key=c.c_size_t();detail=c.c_void_p()
            ok=self.n.k.GetQueuedCompletionStatus(port,c.byref(message),c.byref(key),c.byref(detail),0)
            if not ok:
                need(c.get_last_error()==258 and not detail.value,"completion-readback");break
            need(key.value==COMPLETION_KEY,"completion-key")
            if len(self.events)>=4096:self.event_overflow=True;break
            # A reported numeric PID is never opened or used for mutation.
            self.events.append(message.value)
            if message.value in (3,9,10):
                self.limit_messages.append(message.value)
                # Advisory correlation only: even a valid reported number can
                # be stale/recycled. Never open or act on a process by it.
                reported=detail.value
                pid=reported if message.value in (9,10) and type(reported) is int and 0<reported<=0xffffffff else None
                self.limit_notifications.append({"message":message.value,"reported_pid":pid})

    def _inherited_stdio_handles(self):
        return tuple(self.owned[name] for name in ("stdin","stdout-write","stderr-write"))

    def _pipe(self,name,security):
        read,write=c.c_void_p(),c.c_void_p();ok=self.n.k.CreatePipe(c.byref(read),c.byref(write),c.byref(security),65536)
        if read.value:self.hold(name+"-read",read.value)
        if write.value:self.hold(name+"-write",write.value)
        need(ok and read.value and write.value,"pipe-create")
        need(self.n.k.SetHandleInformation(read,1,0) and not self.n.inheritable(read.value) and self.n.inheritable(write.value),"pipe-inherit")
        return read.value,write.value

    def prepare(self):
        import subprocess
        need(self.phase=="new","prepare-terminal-or-reentry")
        self.phase="preparing"
        _validate_intent(self.intent,self.folder)
        k=self.n.k;self.job=self.hold("job",k.CreateJobObjectW(None,None));need(not self.n.inheritable(self.job),"job-inherit")
        value=Limits();value.basic.flags=LIMIT_FLAGS;value.basic.active_limit=MEMBERS;value.process_memory=PROCESS_BYTES;value.job_memory=_job_memory_limit(self.intent)
        need(k.SetInformationJobObject(self.job,9,c.byref(value),c.sizeof(value)),"limits-set");self.limits()
        port=self.hold("completion-port",k.CreateIoCompletionPort(c.c_void_p(-1).value,None,0,1));need(not self.n.inheritable(port),"completion-port-inherit")
        association=CompletionAssociation(COMPLETION_KEY,port)
        need(k.SetInformationJobObject(self.job,7,c.byref(association),c.sizeof(association)),"completion-association")
        security=Security(c.sizeof(Security),None,True)
        stdout_read,stdout_write=self._pipe("stdout",security);stderr_read,stderr_write=self._pipe("stderr",security)
        nul=self.hold("stdin",k.CreateFileW("NUL",0x80000000,3,c.byref(security),3,0x80,None));need(self.n.inheritable(nul),"stdin-inherit")
        size=c.c_size_t();first=k.InitializeProcThreadAttributeList(None,2,0,c.byref(size));need(not first and c.get_last_error()==122 and 0<size.value<=65536,"attribute-size")
        storage=c.create_string_buffer(size.value);need(k.InitializeProcThreadAttributeList(storage,2,0,c.byref(size)),"attribute-init")
        try:
            jobs=(c.c_void_p*1)(self.job);handles=(c.c_void_p*3)(*self._inherited_stdio_handles())
            need(k.UpdateProcThreadAttribute(storage,0,JOB_LIST_ATTRIBUTE,c.byref(jobs),c.sizeof(jobs),None,None),"attribute-job-list")
            need(k.UpdateProcThreadAttribute(storage,0,HANDLE_LIST_ATTRIBUTE,c.byref(handles),c.sizeof(handles),None,None),"attribute-handle-list")
            startup=StartupEx();startup.startup.cb=c.sizeof(startup);startup.startup.flags=0x100;startup.startup.stdin=nul;startup.startup.stdout=stdout_write;startup.startup.stderr=stderr_write;startup.attributes=c.cast(storage,c.c_void_p)
            environment=c.create_unicode_buffer("\0".join(key+"="+value for key,value in sorted(self.intent.environment.items(),key=lambda item:item[0].upper()))+"\0")
            command=c.create_unicode_buffer(subprocess.list2cmdline(self.intent.argv));process=Process()
            created=k.CreateProcessW(self.intent.argv[0],command,None,None,True,ROOT_CREATION_FLAGS,environment,str(self.intent.cwd),c.byref(startup),c.byref(process))
            if process.process:self.process=process;self.hold("root",process.process)
            if process.thread:self.hold("thread",process.thread)
            need(created and process.process and process.thread,"atomic-process-create")
            need(not self.n.inheritable(process.process) and not self.n.inheritable(process.thread) and self.n.member(process.process,self.job),"atomic-membership")
            self.assigned=True;self.root_identity=self.n.identity(process.process)
        finally:
            k.DeleteProcThreadAttributeList(storage)
        need(self.close("stdout-write") and self.close("stderr-write") and self.close("stdin"),"parent-write-close")
        for name,handle in (("stdout",stdout_read),("stderr",stderr_read)):
            thread=threading.Thread(target=self._drain,args=(name,handle),daemon=True);self.threads.append(thread);thread.start()
        need(self.accounting()["active"]==1,"suspended-root-count")
        self.phase="prepared"

    def resume(self):
        need(self.phase=="prepared","resume-terminal-or-reentry")
        _assert_no_pending()
        need(self.process is not None and self.owned.get("root")==self.process.process and self.owned.get("thread")==self.process.thread,"owned-root-thread-ledger-required")
        need(self.process and self.assigned and not self.resume_done and self.n.member(self.process.process,self.job),"resume-admission")
        self.limits();need(self.n.k.ResumeThread(self.process.thread)==1,"resume")
        self.resume_done=True;self.phase="resumed";need(self.close("thread"),"thread-close")

    def _drain(self,name,handle):
        saved=0;observed=0;digest=hashlib.sha256();first=bytearray();sent=False
        discard=self.intent.phase=="ocr-runtime-import"
        try:
            with (self.folder/(name+".log")).open("xb") as stream:
                buffer=c.create_string_buffer(65536)
                while True:
                    count=c.c_uint32();ok=self.n.k.ReadFile(handle,buffer,len(buffer),c.byref(count),None)
                    if not ok:
                        need(c.get_last_error()==109,"pipe-read");break
                    if count.value==0:break
                    chunk=buffer.raw[:count.value];observed+=len(chunk)
                    keep=b"" if discard else chunk[:max(0,LOG_CAP-saved)]
                    if keep:stream.write(keep);digest.update(keep);saved+=len(keep)
                    if observed>LOG_CAP:self.overflow.set()
                    if not discard and name=="stdout" and not sent:
                        first.extend(chunk[:max(0,4097-len(first))])
                        if b"\n" in first or len(first)>4096:
                            self.first.put_nowait(bytes(first).split(b"\n",1)[0]);sent=True
                stream.flush();os.fsync(stream.fileno())
            self.log_state[name]={"bytes":saved,"observed_bytes":observed,"sha256":digest.hexdigest(),"complete":True,"cap_bytes":LOG_CAP,"path":str(self.folder/(name+".log"))}
            if discard:self.log_state[name]["raw_content_discarded"]=True
        except BaseException as error:
            self.pipe_error.set();self.log_state[name]={"bytes":saved,"observed_bytes":observed,"complete":False,"error_type":type(error).__name__}

    def terminate_owned_job(self):
        need(self.job is not None and self.owned.get("job")==self.job,"owned-job-required")
        self.limits();need(self.n.k.TerminateJobObject(self.job,FORCED_EXIT),"owned-job-terminate");self.forced=True

    def finish(self,reason=None):
        """Observe/retire only this created job; never inspect or adopt other trees."""
        if self.phase=="finished":return copy.deepcopy(self.final_result)
        need(self.phase!="finishing","finish-reentry")
        self.phase="finishing"
        code=None;account=None;peak=None;drained=False;confirmed=False
        root_pid=getattr(self.process,"pid",None) if self.process else None
        if type(root_pid) is not int or not 0<root_pid<=0xffffffff:root_pid=None
        try:
            if self.process:
                need(self.owned.get("root")==self.process.process,"owned-root-ledger-required")
                account=self.accounting()
                if account["active"]:
                    self.terminate_owned_job()
                end=time.monotonic()+10
                while self.accounting()["active"]:
                    need(time.monotonic()<end,"owned-job-exit-timeout");time.sleep(.02)
                account=self.accounting();need(account["active"]==0,"owned-members-remain")
                self.poll_events()
                code=self.n.exit_code(self.process.process,1000)
                value=self.limits();peak={"process_commit_bytes":value.peak_process,"job_commit_bytes":value.peak_job}
                for thread in self.threads:thread.join(timeout=3)
                drained=bool(self.threads) and all(not thread.is_alive() for thread in self.threads) and not self.pipe_error.is_set()
                need(drained,"pipe-drain-unconfirmed")
                need(not self.n.inheritable(self.job),"job-inherit-drift")
                confirmed=True
            else:
                # No CreateProcess succeeded; no owned command could have run.
                confirmed=self.job is None or self.accounting()["active"]==0
        except BaseException as error:
            self.cleanup_errors.append(str(error))
        # No read handle is closed under a still-running ReadFile thread.
        if drained or not self.threads:
            self.close("stdout-read");self.close("stderr-read")
        self.close("stdout-write");self.close("stderr-write");self.close("stdin")
        if confirmed:
            self.close("thread");self.close("root");self.close("job");self.close("completion-port")
        confirmed=confirmed and not self.cleanup_errors and not self.owned and id(self) not in _PENDING
        if not confirmed:_retain_pending(self)
        else:
            _LIVE.pop(id(self),None)
            self.job=None;self.process=None
        self.final_result={"root_exit_code":code,"created_root_pid":root_pid,"job_accounting":account,"peak_active_observed":self.peak_active,"peak_commit":peak,"assigned_at_creation":self.assigned,"resumed_after_membership":self.resume_done,"limits":{"flags":LIMIT_FLAGS,"process_bytes":PROCESS_BYTES,"job_bytes":_job_memory_limit(self.intent),"active_limit":MEMBERS},"observed_limit_messages":self.limit_messages,"observed_limit_notifications":self.limit_notifications,"reported_pids_are_process_identity":False,"completion_message_count":len(self.events),"completion_message_overflow":self.event_overflow,"absence_of_limit_hits_claimed":False,"explicit_inherited_handles":3,"job_handle_inherited":False,"forced_owned_job_termination":self.forced,"cleanup_confirmed":confirmed,"all_owned_handles_close_acknowledged":confirmed,"cleanup_errors":self.cleanup_errors,"logs":self.log_state,"log_overflow":self.overflow.is_set(),"reason":reason,"fence_required":not confirmed,"native_proof_for_old_processes":False}
        self.phase="finished"
        return copy.deepcopy(self.final_result)

    def run(self):
        need(self.phase=="new","run-terminal-or-reentry")
        _assert_no_pending()
        reason=None;normal_root=False
        try:
            self.prepare();self.resume();deadline=time.monotonic()+self.intent.seconds
            while True:
                self.accounting()
                self.poll_events()
                if self.limit_messages:reason="observed-native-limit-hit";break
                if self.event_overflow:reason="completion-message-overflow";break
                if self.overflow.is_set():reason="log-overflow";break
                if self.pipe_error.is_set():reason="pipe-error";break
                wait=self.n.k.WaitForSingleObject(self.process.process,50)
                need(wait in (0,258),"root-wait")
                if wait==0:
                    normal_root=True
                    # An actual command must retire descendants during normal exit.
                    grace=time.monotonic()+5
                    while self.accounting()["active"] and time.monotonic()<grace:time.sleep(.02)
                    if self.accounting()["active"]:reason="owned-descendants-remain-after-root"
                    break
                if time.monotonic()>=deadline:reason="timeout";break
        except BaseException as error:
            reason="native-"+type(error).__name__+":"+str(error)
        result=self.finish(reason)
        result["command_passed"]=normal_root and reason is None and result["root_exit_code"]==0 and result["cleanup_confirmed"] and not result["forced_owned_job_termination"] and not result["log_overflow"] and not result["observed_limit_messages"] and not result["completion_message_overflow"]
        result["reviewed_retry_possible"]=not result["command_passed"] and result["cleanup_confirmed"]
        result["automatic_retry_allowed"]=False
        return result


def dump(path,value):
    with path.open("xb") as stream:
        stream.write((json.dumps(value,indent=2)+"\n").encode());stream.flush();os.fsync(stream.fileno())


def bounded_line(stream,seconds,maximum=4096):
    import msvcrt
    native=_Win();handle=msvcrt.get_osfhandle(stream.fileno());deadline=time.monotonic()+seconds;data=bytearray()
    while True:
        available=c.c_uint32()
        ok=native.k.PeekNamedPipe(handle,None,0,None,c.byref(available),None)
        if not ok:
            need(c.get_last_error()!=109,"fixed-protocol-eof")
            raise NativeFailure("fixed-protocol-peek")
        if available.value:
            chunk=os.read(stream.fileno(),min(available.value,maximum+1-len(data)))
            need(chunk,"fixed-protocol-eof");data.extend(chunk)
            need(len(data)<=maximum,"fixed-protocol-size")
            if b"\n" in data:
                need(data.endswith(b"\n") and data.count(b"\n")==1,"fixed-protocol-extra-data")
                return bytes(data)
        need(time.monotonic()<deadline,"fixed-protocol-timeout")
        time.sleep(.01)


def bounded_eof(stream,seconds,maximum):
    """Bound both protocol tail bytes and time; no inferred writer retirement."""
    import msvcrt
    native=_Win();handle=msvcrt.get_osfhandle(stream.fileno());deadline=time.monotonic()+seconds;data=bytearray()
    while True:
        available=c.c_uint32()
        ok=native.k.PeekNamedPipe(handle,None,0,None,c.byref(available),None)
        if not ok:
            need(c.get_last_error()==109,"fixed-tail-peek")
            return bytes(data)
        if available.value:
            chunk=os.read(stream.fileno(),min(available.value,maximum+1-len(data)))
            need(chunk,"fixed-tail-read");data.extend(chunk)
            need(len(data)<=maximum,"fixed-tail-size")
        need(time.monotonic()<deadline,"fixed-tail-timeout")
        time.sleep(.01)



def fixture(role):
    if role=="ui-budget":
        os.write(1,b"fixed-native-ui-budget\n");return 0
    if role=="stdio":
        os.write(1,b"fixed-native-stdout\n");os.write(2,b"fixed-native-stderr\n");return 0
    if role=="failure":return 23
    if role=="natural-expiry":time.sleep(.1);return 97
    if role=="leaf":time.sleep(15);return 97
    if role=="overflow":
        for _ in range(132):os.write(1,b"x"*65536)
        time.sleep(15);return 97
    need(role in ("hold","timeout"),"fixed-fixture-role")
    child=subprocess.Popen([str(Path(sys.executable).resolve()),"-I","-S","-B",str(_MODULE),"--fixture","leaf"],stdin=subprocess.DEVNULL,stdout=sys.stdout,stderr=sys.stderr,close_fds=True,creationflags=DETACHED_PROCESS)
    native=_Win();handle=int(child._handle)
    print(json.dumps({"child_handle":handle,**native.identity(handle)}),flush=True)
    # If the job was not shut down, natural expiry is deliberately nonzero.
    time.sleep(15);return 97


def guardian(mode):
    need(mode in ("before-resume","after-descendant"),"fixed-guardian-role")
    _regular_directory(_SELFTEST_RUNS,_REPO,create=True)
    fresh=_SELFTEST_RUNS/uuid.uuid4().hex;fresh.mkdir()
    folder=fresh/"hold";folder.mkdir()
    owned=_OwnedJob(_fixture_intent("hold",folder),folder)
    extra=None
    try:
        owned.prepare()
        rows=[{"handle":owned.process.process,**owned.n.identity(owned.process.process)}]
        if mode=="after-descendant":
            owned.resume()
            raw=owned.first.get(timeout=10)
            need(len(raw)<=4096,"child-ready-size")
            child=json.loads(raw)
            need(set(child)=={"child_handle","pid","creation_ticks"} and all(type(value) is int and value>0 for value in child.values()),"child-ready-fields")
            original_identity=owned.n.identity(owned.process.process)
            need(owned.n.k.WaitForSingleObject(owned.process.process,0)==258,"root-ready-live")
            extra=owned.n.duplicate_read(owned.process.process,child["child_handle"],lambda value:owned.hold("guardian-child-read",value))
            need(owned.n.identity(owned.process.process)==original_identity and owned.n.member(extra,owned.job) and owned.n.identity(extra)=={key:child[key] for key in ("pid","creation_ticks")} and owned.n.k.WaitForSingleObject(extra,0)==258,"exact-created-child-read-handle")
            rows.append({"handle":extra,**owned.n.identity(extra)})
        count=owned.accounting()["active"]
        need(count==len(rows)==(1 if mode=="before-resume" else 2),"guardian-owned-count")
        print(json.dumps({"role":mode,"rows":rows,"active":count,"assigned_at_creation":owned.assigned,"resumed":owned.resume_done,"job_handle_inherited":owned.n.inheritable(owned.job),"limits":owned.limits().basic.flags,"folder":str(folder)}),flush=True)
        need(bounded_line(sys.stdin.buffer,15,16)==b"crash\n","fixed-crash-request")
        os._exit(71)  # Actual guardian exit, no Python finally/job cleanup path.
    finally:
        owned.close("guardian-child-read")
        result=owned.finish("guardian-did-not-reach-crash")
        dump(folder/"guardian-failure.json",result)


def _cleanup_observer(observer,native):
    """Best effort for each exact resource; exceptions never discard ownership."""
    if observer.get("cleanup_attempted"):return observer.get("cleanup_complete",False)
    observer["cleanup_attempted"]=True
    errors=observer.setdefault("cleanup_errors",[]);process=observer.get("process")
    closed=False
    def attempt(name,operation):
        try:return True,operation()
        except BaseException as error:
            errors.append(name+":"+type(error).__name__)
            return False,None
    try:
        if process is None:
            if observer.get("launch_attempted"):errors.append("launch-outcome-unconfirmed")
        else:
            ok,value=attempt("guardian-poll",process.poll)
            if ok and value is None:
                killed,_=attempt("guardian-retained-handle-kill",process.kill)
                if killed:attempt("guardian-wait",lambda:process.wait(timeout=10))
            for name in ("stdin","stdout","stderr"):
                stream=getattr(process,name,None)
                if stream is not None:
                    attempt("stream-close-"+name,lambda stream=stream:stream.close() if not stream.closed else None)
        remaining=[]
        for handle in observer["copied"]:
            ok,value=attempt("observer-read-close",lambda handle=handle:native.k.CloseHandle(handle))
            if not ok or not value:
                remaining.append(handle)
                if ok:errors.append("observer-read-close:false")
        observer["copied"]=remaining
        if process is not None:
            if process.returncode is None:errors.append("guardian-exit-unconfirmed")
            elif observer.get("guardian_raw") is None:
                ok,value=attempt("guardian-handle-detach",process._handle.Detach)
                if ok:observer["guardian_raw"]=value
            raw=observer.get("guardian_raw")
            if raw is not None:
                ok,value=attempt("guardian-handle-close",lambda:native.k.CloseHandle(raw))
                if ok and value:observer["guardian_raw"]=None
                elif ok:errors.append("guardian-handle-close:false")
        closed=not errors and not observer["copied"] and observer.get("guardian_raw") is None
    except BaseException as error:
        errors.append("observer-cleanup:"+type(error).__name__)
    finally:
        if not closed or id(observer) in _PENDING:_retain_pending(observer);closed=False
        else:_LIVE.pop(id(observer),None)
        observer["cleanup_complete"]=closed
    return closed


def crash_case(mode):
    copied=[];process=None;result=None;native=None
    observer={"process":None,"copied":copied,"guardian_raw":None,"launch_attempted":False}
    _register_owner(observer)
    env={key:os.environ[key] for key in ("SystemRoot","WINDIR") if key in os.environ}
    try:
        native=_Win()
        observer["launch_attempted"]=True
        process=subprocess.Popen([str(Path(sys.executable).resolve()),"-I","-S","-B",str(_MODULE),"--guardian",mode],cwd=_MODULE.parent,env=env,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,close_fds=True,creationflags=DETACHED_PROCESS)
        observer["process"]=process
        wire=bounded_line(process.stdout,15)
        ready=json.loads(wire)
        expected=1 if mode=="before-resume" else 2
        need(ready["role"]==mode and ready["active"]==expected and len(ready["rows"])==expected and ready["assigned_at_creation"] and ready["resumed"] is (mode=="after-descendant") and ready["job_handle_inherited"] is False and ready["limits"]==0x2308,"guardian-native-header")
        guardian_handle=int(process._handle);identity=native.identity(guardian_handle)
        need(identity["pid"]==process.pid and native.k.WaitForSingleObject(guardian_handle,0)==258,"exact-retained-guardian")
        for row in ready["rows"]:
            need(set(row)=={"handle","pid","creation_ticks"} and all(type(row[key]) is int and 0<row[key]<=maximum for key,maximum in (("handle",2**64-1),("pid",2**32-1),("creation_ticks",2**64-1))),"guardian-row")
            need(native.identity(guardian_handle)==identity and native.k.WaitForSingleObject(guardian_handle,0)==258,"guardian-still-exact-and-live")
            handle=native.duplicate_read(guardian_handle,row["handle"],copied.append)
            need(native.identity(handle)=={key:row[key] for key in ("pid","creation_ticks")} and not native.inheritable(handle) and native.k.WaitForSingleObject(handle,0)==258,"observer-read-identity")
        need(len({row["pid"] for row in ready["rows"]})==expected,"distinct-created-processes")
        process.stdin.write(b"crash\n");process.stdin.flush();process.stdin.close()
        process.wait(timeout=10)
        need(process.returncode==71,"actual-guardian-crash-code")
        tail=bounded_eof(process.stdout,3,4096);error=bounded_eof(process.stderr,3,LOG_CAP)
        need(not tail and not error,"guardian-clean-protocol-tail")
        codes=[native.exit_code(handle,5000) for handle in copied]
        need(strict_shutdown_codes(codes,expected),"crash-native-zero-oracle")
        result={"case":"guardian-crash-"+mode,"passed":True,"guardian_exit_code":71,"actual_native_exit_codes":codes,"actual_observed_members":expected,"membership_before_resume":True,"job_handle_not_inherited":True,"source_handle_identity_verified":True,"unknown_process_opened":False,"folder":ready["folder"]}
    finally:
        closed=_cleanup_observer(observer,native)
        need(closed,"observer-or-guardian-close-unconfirmed")
    result["guardian_handle_close_acknowledged"]=True
    result["observer_read_handles_close_acknowledged"]=True
    result["protocol_reader_threads_created"]=0
    return result


def native_selftest():
    need(os.name=="nt" and c.sizeof(c.c_void_p)==8,"actual-Windows-x64-required")
    _assert_no_pending()
    _regular_directory(_SELFTEST_RUNS,_REPO,create=True)
    need(not (_SELFTEST_RUNS/"FENCED.json").exists(),"native selftest lifecycle remains fenced; no automatic successor")
    source=_implementation_hashes();suite=_SELFTEST_RUNS/uuid.uuid4().hex;suite.mkdir()
    cases=[];all_passed=False;current_case=None
    try:
        for role in ("stdio","failure","natural-expiry","timeout","overflow","ui-budget"):
            current_case=role
            folder=suite/role;folder.mkdir()
            result=_OwnedJob(_fixture_intent(role,folder),folder).run()
            dump(folder/"observation.json",result)
            need(result["cleanup_confirmed"] and result["all_owned_handles_close_acknowledged"] and result["job_accounting"]["active"]==0 and result["assigned_at_creation"] and result["resumed_after_membership"],"selftest-owned-cleanup-required")
            if role=="stdio":
                need(result["command_passed"] and (folder/"stdout.log").read_bytes()==b"fixed-native-stdout\n" and (folder/"stderr.log").read_bytes()==b"fixed-native-stderr\n" and result["job_accounting"]["total"]==1,"native-private-stdio")
            elif role=="failure":
                need(not result["command_passed"] and result["root_exit_code"]==23 and not result["forced_owned_job_termination"] and result["reviewed_retry_possible"] and not result["fence_required"],"failure-never-pass-but-cleanup-observed")
            elif role=="natural-expiry":
                need(result["root_exit_code"]==97 and not result["command_passed"] and not result["forced_owned_job_termination"] and not strict_shutdown_codes([result["root_exit_code"]],1),"actual-natural97-rejected-as-shutdown")
            elif role=="timeout":
                need(result["reason"]=="timeout" and not result["command_passed"] and result["forced_owned_job_termination"] and result["job_accounting"]["total"]==2 and result["peak_active_observed"]==2,"actual-descendant-timeout-retired")
            elif role=="overflow":
                need(result["reason"]=="log-overflow" and not result["command_passed"] and result["log_overflow"] and result["logs"]["stdout"]["bytes"]==LOG_CAP and result["forced_owned_job_termination"],"actual-log-overflow-bounded-retired")
            elif role=="ui-budget":
                need(result["command_passed"] and result["job_accounting"]["total"]==1 and result["limits"]=={"flags":LIMIT_FLAGS,"process_bytes":PROCESS_BYTES,"job_bytes":UI_JOB_BYTES,"active_limit":MEMBERS} and (folder/"stdout.log").read_bytes()==b"fixed-native-ui-budget\n" and (folder/"stderr.log").read_bytes()==b"","actual-fixed-ui-budget-readback")
            cases.append({"case":role,"passed":True,"observation":str(folder/"observation.json"),"sha256":_digest(folder/"observation.json"),"root_exit_code":result["root_exit_code"],"job_total":result["job_accounting"]["total"],"job_active":result["job_accounting"]["active"]})
        for mode in ("before-resume","after-descendant"):
            current_case="guardian-crash-"+mode
            cases.append(crash_case(mode))
        need(_implementation_hashes()==source,"native-source-changed")
        all_passed=len(cases)==8 and all(case["passed"] for case in cases)
    except BaseException as error:
        cases.append({"case":current_case,"passed":False,"error_type":type(error).__name__,"diagnostic":str(error)[:500]})
        raise
    finally:
        report={"schema_version":"actual-fixed-host-native-selftest-v1","passed":all_passed,"cases":cases,"expected_native_cases":8,"portable_pass_claimed":False,"actual_platform":sys.platform,"source_hashes":source,"source_unchanged":_implementation_hashes()==source,"limits":{"process_bytes":PROCESS_BYTES,"job_bytes":JOB_BYTES,"ui_job_bytes":UI_JOB_BYTES,"active_limit":MEMBERS},"old_process_or_fence_adopted":False,"actual_package_or_UI_executed":False,"model_provider_retained_stage_used":False,"qualification_scope":"Actual new fixed-purpose launcher mechanics and fixed UI-budget readback only; no old-process cleanup, native filesystem/offload, model, parent or product qualification."}
        dump(suite/"observation.json",report)
        if not all_passed:
            dump(suite/"FENCED.json",{"reason":"native-selftest-failed-or-unconfirmed","repeat_authority":False,"fixture_retained":True})
            if not (_SELFTEST_RUNS/"FENCED.json").exists():dump(_SELFTEST_RUNS/"FENCED.json",{"suite":str(suite),"reason":"native-selftest-failed-or-unconfirmed","automatic_successor_allowed":False})
        print(json.dumps({"passed":all_passed,"observation":str(suite/"observation.json"),"sha256":_digest(suite/"observation.json")}),flush=True)
    need(all_passed,"actual-native-selftest-failed")
    return {"observation":str(suite/"observation.json"),"sha256":_digest(suite/"observation.json"),**report}


def run_native_selftests():
    """Run actual closed Windows cases; unsupported platforms refuse, never pass."""
    return native_selftest()


def _parser():
    parser=argparse.ArgumentParser(description=__doc__)
    group=parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--native-selftest",action="store_true")
    group.add_argument("--fixture",choices=("stdio","failure","natural-expiry","timeout","hold","overflow","leaf","ui-budget"),help=argparse.SUPPRESS)
    group.add_argument("--guardian",choices=("before-resume","after-descendant"),help=argparse.SUPPRESS)
    return parser


def main():
    args=_parser().parse_args()
    if args.fixture:return fixture(args.fixture)
    if args.guardian:return guardian(args.guardian)
    run_native_selftests();return 0


if __name__=="__main__":raise SystemExit(main())
