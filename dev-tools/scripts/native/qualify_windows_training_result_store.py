"""Explicit small synthetic-file qualification; never starts a model or app.

Source preparation tests call --plan/contract functions only. --run requires a
current separately reviewed source Work. Each invocation runs once. Retained
failed fixture trees are never inspected, adopted, moved, deleted or ACL-reset.
"""
from __future__ import annotations
import argparse
from contextlib import contextmanager
import gc
import json
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess
import sys
import time
import uuid

import build_windows_training_result_store as build
import build_windows_model_file_identity as fixed

SCRIPT=Path(__file__).resolve();ROOT=SCRIPT.parents[3]
NAMESPACE=ROOT/'artifacts/tmp/native-training-result-files'
FIXTURE='modules/adapters/runtime/python/tests/windows-training-result-store.native.integration.test.mjs'
PROFILE='windows-native-training-result-container-v1'
CHECKS=['final-permission-container-creation','complete-inventory-sealed','secondary-control-open-denied','path-and-stream-mutation-denied','ordered-bounded-writes','verified-logical-reads','reader-prevents-discard','original-creator-cleanup']
SOURCES=(build.SOURCE.relative_to(ROOT).as_posix(),FIXTURE,SCRIPT.relative_to(ROOT).as_posix(),build.SCRIPT.relative_to(ROOT).as_posix(),build.POLICY.relative_to(ROOT).as_posix())
MAX_RUNS=8


def child_environment(node, *, python=False):
    # Never forward provider keys, loader/preload settings or module-search paths.
    environment={key:os.environ[key] for key in ('SystemRoot','WINDIR','TEMP','TMP') if key in os.environ}
    system=Path(os.environ.get('SystemRoot','C:/Windows'))/'System32'
    environment['PATH']=os.pathsep.join(str(p) for p in (Path(node).parent,system,*([Path(sys.executable).parent] if python else [])))
    environment['NODE_OPTIONS']='--preserve-symlinks --preserve-symlinks-main'
    if python: environment.update(PYTHONUTF8='1',PYTHONDONTWRITEBYTECODE='1',PYTHONNOUSERSITE='1')
    return environment


def lock_byte(descriptor, acquire):
    import msvcrt
    os.lseek(descriptor,0,os.SEEK_SET)
    msvcrt.locking(descriptor,msvcrt.LK_NBLCK if acquire else msvcrt.LK_UNLCK,1)


@contextmanager
def file_lease(name):
    if name not in ('admission.lock','execution.lock'):raise ValueError('Fixed lock name required.')
    fixed.safe(NAMESPACE,'directory');path=NAMESPACE/name;descriptor=None;locked=False
    identity=lambda value:(value.st_dev,value.st_ino,value.st_nlink)
    def observed():
        value=fixed.safe(path,'file').lstat()
        if not stat.S_ISREG(value.st_mode) or value.st_nlink!=1:raise ValueError('Original lock file identity unavailable.')
        return value
    try:
        try:
            before=observed()
        except FileNotFoundError:
            try:descriptor=os.open(path,os.O_RDWR|os.O_CREAT|os.O_EXCL|getattr(os,'O_BINARY',0),0o600)
            except FileExistsError:before=observed()
            else:before=os.fstat(descriptor)
        if descriptor is None:descriptor=os.open(path,os.O_RDWR|getattr(os,'O_BINARY',0))
        opened=os.fstat(descriptor)
        if not stat.S_ISREG(opened.st_mode) or opened.st_nlink!=1 or identity(before)!=identity(opened) or identity(opened)!=identity(observed()):raise ValueError('Original lock file changed.')
        lock_byte(descriptor,True);locked=True
        if identity(os.fstat(descriptor))!=identity(observed()):raise ValueError('Original locked file changed.')
        yield
    finally:
        if descriptor is not None:
            try:
                if locked:lock_byte(descriptor,False)
            finally:os.close(descriptor)


def plan():
    build.profile()  # Fixed installed toolchain and pinned cached SDK only.
    node=shutil.which('node')
    if not node: raise ValueError('Node host unavailable.')
    node=fixed.safe(Path(node),'file')
    version=subprocess.run([str(node),'--version'],env=child_environment(node),capture_output=True,text=True,timeout=5,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
    if version.returncode or not re.fullmatch(r'v24\.\d+\.\d+\s*',version.stdout): raise ValueError('Fixed Node24 host unavailable.')
    return {'profile':PROFILE,'node':str(node),'node_version':version.stdout.strip()[1:],'node_sha256':fixed.digest(node),'sources':{name:fixed.digest(ROOT/name) for name in SOURCES},
        'model':False,'automatic_retry':False,'native_file_execution':'explicit --run only','maximum_synthetic_data_bytes':16384,'maximum_metadata_bytes':32768,
        'node_seconds':120,'compiler_job_commit_bytes':2*1024**3,'compiler_process_limit':8,'maximum_retained_runs':MAX_RUNS,
        'limitations':'Controlled component files only. No model, SDK/controller, crash, quota, receiver, Save, host or parent qualification.'}


def reviewed_source():
    # A declaration in request JSON is not a review. Reuse canonical current
    # Work/receipt/review ownership; this helper grants no app execution right.
    sys.path.insert(0,str(ROOT/'dev-tools/helpers'))
    from control_plane.candidate import snapshot
    from control_plane.records import Records
    from control_plane.work import Work
    current=snapshot(ROOT)['source_digest'];controller=Work(ROOT)
    for work in Records(ROOT).load()['work_items'].values():
        if work.get('status')!='complete' or work.get('completion',{}).get('source_digest')!=current: continue
        if not set(SOURCES[:3]) <= set(work['spec']['write_scope']): continue
        receipt=controller.current_receipt(work)
        reviews=[r for r in work['reviews'] if r['receipt_digest']==receipt['receipt_digest'] and r['disposition']=='accepted' and r['invocation_id'] not in work['contributors']]
        if reviews: return {'work_id':work['spec']['work_id'],'source_digest':current,'receipt_digest':receipt['receipt_digest'],'review_digest':reviews[-1]['review_digest']}
    raise ValueError('A current completed source Work with separate review is required before native files.')


def decode_result(raw):
    if not isinstance(raw,str) or len(raw.encode('utf-8'))>16384: raise ValueError('Bounded native result unavailable.')
    value=json.loads(raw)
    if not isinstance(value,dict) or set(value)!={'kind','passed','cleanup_passed','stage','diagnostics','checks'} or value['kind']!='native-file-result': raise ValueError('Native result schema differs.')
    if type(value['passed']) is not bool or type(value['cleanup_passed']) is not bool or type(value['stage']) is not int or not 0<=value['stage']<=14: raise ValueError('Native result types differ.')
    diagnostic=value['diagnostics'];limits={'sealStep':6,'nativeStatus':2**32-1,'permissionBits':15,'permissionControl':0x150c,'grantedAccess':2**32-1}
    if not isinstance(diagnostic,dict) or set(diagnostic)!=set(limits) or any(type(diagnostic[k]) is not int or not 0<=diagnostic[k]<=limit for k,limit in limits.items()):raise ValueError('Private diagnostic schema differs.')
    if diagnostic['permissionControl'] & ~0x150c:raise ValueError('Private permission-control mask differs.')
    if value['passed'] and (not value['cleanup_passed'] or value['stage']!=14 or value['checks']!=CHECKS): raise ValueError('Native result coverage incomplete.')
    if not value['passed'] and (value['cleanup_passed'] or value['checks']!=[]): raise ValueError('Failed native result overclaims closure.')
    return value


def final_inputs_match(current,review):
    return plan()==current and reviewed_source()==review


def create_folder():
    fixed.safe(ROOT,'directory')
    for folder in (ROOT/'artifacts',ROOT/'artifacts/tmp',NAMESPACE):
        try: folder.lstat()
        except FileNotFoundError:
            fixed.safe(folder.parent,'directory');folder.mkdir(exist_ok=False)
        fixed.safe(folder,'directory')
    # Count only this named synthetic-test namespace. Never descend into a
    # retained run, inspect its private files or reuse one of its names.
    with file_lease('admission.lock'):
        count=0;entries=0
        for item in NAMESPACE.iterdir():
            entries+=1
            if entries>MAX_RUNS+2: raise ValueError('Synthetic test evidence storage is full; preserve existing runs.')
            if item.name in ('admission.lock','execution.lock'): continue
            if not re.fullmatch('[a-f0-9]{32}',item.name): raise ValueError('Unexpected synthetic test namespace entry.')
            count+=1
        if count>=MAX_RUNS: raise ValueError('Synthetic test evidence storage is full; preserve existing runs.')
        folder=NAMESPACE/uuid.uuid4().hex;folder.mkdir(exist_ok=False);return fixed.safe(folder,'directory')


def worker(args):
    print(json.dumps({'kind':'identity','pid':os.getpid(),'parent_pid':os.getppid()}),flush=True)
    if sys.stdin.readline().strip()!='observe' or args.model_manifest!=PROFILE or not re.fullmatch('[a-f0-9]{32}',args.run_id or ''): raise ValueError('Owned native observation denied.')
    folder=fixed.safe(NAMESPACE/args.run_id,'directory');expected=json.loads(fixed.safe(folder/'request.json','file').read_text())
    current=plan()
    if expected!={'plan':current,'source_review':reviewed_source()}: raise ValueError('Native source inputs changed.')
    job=fixed.CompilerJob();observations={'before':job.evidence()}
    # The original worker owns the OS lock until its bounded Node child and job
    # retire. Process exit releases the lock; a terminated observer leaves no
    # permanent PID/stale-file lock that can poison future starts.
    with file_lease('execution.lock'):
        return run_locked(args,folder,expected,current,job)


def run_locked(args,folder,expected,current,job):
    observations={'before':job.evidence()}
    print(json.dumps({'kind':'ready','pid':os.getpid(),'parent_pid':os.getppid(),'rss_bytes':fixed.owned.rss(os.getpid())}),flush=True)
    if sys.stdin.readline().strip()!='run': raise ValueError('Owned native run handshake denied.')
    report=None;exit_code=None;process=None;reason=None
    try:
        compiled=subprocess.run([sys.executable,'-B',str(build.SCRIPT)],env=child_environment(current['node'],python=True),capture_output=True,text=True,timeout=180,creationflags=subprocess.CREATE_NO_WINDOW)
        if compiled.returncode or len(compiled.stdout)>1024**2 or len(compiled.stderr)>1024**2: raise ValueError('Fixed native fixture build failed.')
        binary=json.loads(compiled.stdout.strip().splitlines()[-1])
        if binary.get('cleanup_passed') is not True or binary.get('physical_exit_code')!=0 or not re.fullmatch('artifacts/tmp/native-training-result-store/[a-f0-9]{32}',binary.get('build','')): raise ValueError('Native binary closure unavailable.')
        node_request={'profile':PROFILE,'build':binary['build'],'binary_sha256':binary['binary_sha256'],'sources':current['sources'],
            'node':{'path':current['node'],'sha256':current['node_sha256'],'version':current['node_version']}}
        (folder/'node-request.json').write_text(json.dumps(node_request)+'\n')
        started=time.monotonic()
        with (folder/'native.log').open('xb') as log:
            process=subprocess.Popen([current['node'],str(ROOT/FIXTURE),'--native-feature-child',folder.relative_to(ROOT).as_posix()],env=child_environment(current['node']),cwd=ROOT,stdin=subprocess.DEVNULL,stdout=log,stderr=subprocess.STDOUT,creationflags=subprocess.CREATE_NO_WINDOW)
            while process.poll() is None:
                if time.monotonic()-started>120 or (folder/'native.log').stat().st_size>1024**2: raise ValueError('Native fixture exceeded its fixed bounds.')
                time.sleep(.02)
            exit_code=process.returncode
        raw=(folder/'native.log').read_bytes()
        if len(raw)>16384: raise ValueError('Native result output exceeds its bound.')
        report=decode_result(raw.decode('utf-8'))
    except Exception:
        reason='native-feature-check-unavailable'
    finally:
        observations['owned_child_shutdown']=job.stop_remaining_children()
        if process is not None: process.wait(timeout=5)
        process=None;gc.collect();observations['after']=job.evidence()
        (folder/'job-observations.json').write_text(json.dumps(observations,indent=2)+'\n')
    stable=final_inputs_match(current,expected['source_review'])
    observations['final_owned_child_shutdown']=job.stop_remaining_children()
    observations['after_final_input_check']=job.evidence()
    (folder/'job-observations.json').write_text(json.dumps(observations,indent=2)+'\n')
    if observations['after_final_input_check']['active_processes']!=1: raise ValueError('Owned native job closure unavailable.')
    passed=reason is None and exit_code==0 and report is not None and report['passed'] and stable
    result={'kind':'result','qualification':'passed' if passed else 'failed','cleanup_passed':bool(passed and report['cleanup_passed']),
        'stage':report['stage'] if report else 0,'checks':report['checks'] if passed else [],'node_exit_code':exit_code,'source_stable':stable,
        'diagnostics':report['diagnostics'] if report else {'sealStep':0,'nativeStatus':0,'permissionBits':0,'permissionControl':0,'grantedAccess':0},
        'compiler_job':observations['after_final_input_check'],'scope':'synthetic native component files only; no model or parent qualification'}
    (folder/'result.json').write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps(result),flush=True)


def main():
    parser=argparse.ArgumentParser(description=__doc__);modes=parser.add_mutually_exclusive_group();modes.add_argument('--plan',action='store_true');modes.add_argument('--run',action='store_true')
    for name in ('child','run-id','model-manifest','count','variant','device','phase','profile','samples'):parser.add_argument('--'+name)
    args=parser.parse_args()
    if args.child:
        if args.child!='measure':raise ValueError('Unsupported native worker.')
        worker(args);return
    current=plan()
    if not args.run: print(json.dumps(current));return
    review=reviewed_source();folder=create_folder()
    (folder/'request.json').write_text(json.dumps({'plan':current,'source_review':review})+'\n')
    fixed.owned.SCRIPT=SCRIPT
    result=fixed.owned.run_child(argparse.Namespace(samples=1,model_manifest=PROFILE),folder,1,'measure',early_identity=True)
    print(json.dumps(result),flush=True)
    if result.get('qualification')!='passed' or result.get('cleanup_passed') is not True or result.get('physical_exit_code')!=0: raise SystemExit(1)


if __name__=='__main__':main()
