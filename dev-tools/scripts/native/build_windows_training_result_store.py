"""Fixed offline build of the private Node-parent training result custodian.

Uses the existing bounded compiler worker, installed MSVC/SDK and exact cached
official Node headers/import library. Never downloads or changes a runtime.
"""
from __future__ import annotations
import argparse
import gc
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time
import uuid

import build_windows_model_file_identity as fixed

SCRIPT = Path(__file__).resolve()
ROOT = SCRIPT.parents[3]
SOURCE = ROOT / 'modules/adapters/filesystem-security/windowsTrainingResultStore.cc'
POLICY = ROOT / 'dev-tools/config/windows-training-result-sdk.json'
CACHE = ROOT / '.local-codex/native-training-writer-sdk/24.22.1'
NAMESPACE = ROOT / 'artifacts/tmp/native-training-result-store'
PROFILE = 'windows-node24-napi8-training-result-store-v1'
OUTPUT_NAMES = {'training_result_store.node', 'training_result_store.obj', 'training_result_store.lib', 'training_result_store.exp', 'dependencies.json', 'build.log', 'manifest.json', 'job-observations.json'}
safe, digest = fixed.safe, fixed.digest


def profile():
    compiler, includes, libraries = fixed.profile()
    policy = json.loads(safe(POLICY, 'file').read_text(encoding='utf-8'))
    if set(policy) != {'schema','version','architecture','source','headersArchiveSha256','files','licenseReference','napiVersion','runtimeChanged'} or policy['schema'] != 'windows-training-result-sdk-v1' or policy['version'] != '24.22.1' or policy['architecture'] != 'win-x64' or policy['napiVersion'] != 8 or policy['runtimeChanged'] is not False:
        raise ValueError('Fixed Node SDK policy differs.')
    names = {'node_api.h','node_api_types.h','js_native_api.h','js_native_api_types.h','node.lib'}
    if set(policy['files']) != names: raise ValueError('Fixed Node SDK inventory differs.')
    safe(CACHE, 'directory')
    for name in sorted(names):
        item = safe(CACHE/name, 'file'); expected = policy['files'][name]
        if set(expected) != {'sha256','bytes'} or type(expected['bytes']) is not int or item.stat().st_size != expected['bytes'] or digest(item) != expected['sha256']:
            raise ValueError('Fixed Node SDK input differs.')
    safe(SOURCE, 'file')
    includes = [*includes, CACHE]
    libraries = [*libraries, CACHE/'node.lib', fixed.MSVC/'lib/x64/delayimp.lib', fixed.SDK/'Lib'/fixed.SDK_VERSION/'um/x64/bcrypt.lib']
    for library in libraries: safe(library, 'file')
    return compiler, includes, libraries


def inventory(compiler, includes, libraries):
    # The common helper closes over its own source as an additional build input.
    # Do not mutate its globals or add an implicit include/library search path.
    result = fixed.inventory(compiler, includes, libraries)
    for source in (SOURCE, SCRIPT, POLICY): result[source.relative_to(ROOT).as_posix()] = digest(source)
    return result


def argv(compiler, includes, libraries, folder):
    return [str(compiler), '/nologo','/std:c++20','/EHsc','/W4','/WX','/sdl','/GS','/guard:cf','/MT','/O2','/LD','/DUNICODE','/D_UNICODE','/D_WIN32_WINNT=0x0A00',
        *(f'/I{path}' for path in includes), f'/Fo{folder/"training_result_store.obj"}', f'/Fe{folder/"training_result_store.node"}',
        '/sourceDependencies', str(folder/'dependencies.json'), str(SOURCE), '/link','/NODEFAULTLIB', *(str(path) for path in libraries),
        '/DELAYLOAD:node.exe','/DYNAMICBASE','/HIGHENTROPYVA','/NXCOMPAT','/INCREMENTAL:NO','/guard:cf']


def create_output_folder():
    if NAMESPACE != ROOT/'artifacts/tmp/native-training-result-store': raise ValueError('Fixed output namespace differs.')
    safe(ROOT, 'directory')
    for folder in (ROOT/'artifacts', ROOT/'artifacts/tmp', NAMESPACE):
        try: folder.lstat()
        except FileNotFoundError:
            safe(folder.parent, 'directory'); folder.mkdir(exist_ok=False)
        safe(folder, 'directory')
    folder = NAMESPACE/uuid.uuid4().hex
    folder.mkdir(exist_ok=False); return safe(folder, 'directory')


def worker(args):
    print(json.dumps({'kind':'identity','pid':os.getpid(),'parent_pid':os.getppid()}), flush=True)
    if sys.stdin.readline().strip() != 'observe': raise ValueError('Build observation handshake denied.')
    if args.model_manifest != PROFILE or not re.fullmatch('[a-f0-9]{32}', args.run_id or ''): raise ValueError('Build identity invalid.')
    folder = safe(NAMESPACE/args.run_id, 'directory')
    if any(folder.iterdir()): raise ValueError('Build output must be exclusively empty.')
    compiler, includes, libraries = profile(); inputs = inventory(compiler, includes, libraries)
    job = fixed.CompilerJob(); observations = {'before_compile':job.evidence()}
    print(json.dumps({'kind':'ready','pid':os.getpid(),'parent_pid':os.getppid(),'rss_bytes':fixed.owned.rss(os.getpid())}), flush=True)
    if sys.stdin.readline().strip() != 'run': raise ValueError('Build run handshake denied.')
    environment = {key:os.environ[key] for key in ('SystemRoot','WINDIR','TEMP','TMP') if key in os.environ}
    environment.update(PATH=str(compiler.parent)+';C:/Windows/System32', VSLANG='1033')
    started = time.monotonic(); log = folder/'build.log'
    with log.open('xb') as output:
        process = subprocess.Popen(argv(compiler,includes,libraries,folder),cwd=folder,env=environment,stdin=subprocess.DEVNULL,stdout=output,stderr=subprocess.STDOUT,creationflags=subprocess.CREATE_NO_WINDOW)
        while process.poll() is None:
            if time.monotonic()-started > 120 or log.stat().st_size > 1024**2: raise ValueError('Compiler exceeded fixed bounds.')
            time.sleep(.02)
        if process.returncode != 0: raise ValueError('Native compilation failed; inspect the retained bounded build.log.')
        compiler_exit_code = process.returncode
    observations['after_compiler_exit'] = job.evidence(); process = None; gc.collect()
    observations['owned_child_shutdown'] = job.stop_remaining_children()
    evidence = job.evidence(); observations['after_process_handle_release'] = evidence
    (folder/'job-observations.json').write_text(json.dumps(observations,indent=2)+'\n',encoding='utf-8')
    if evidence['active_processes'] != 1 or inventory(compiler,includes,libraries) != inputs: raise ValueError('Build closure unavailable.')
    if {p.name for p in folder.iterdir()} - OUTPUT_NAMES: raise ValueError('Unexpected build output.')
    dependencies = json.loads((folder/'dependencies.json').read_text(encoding='utf-8-sig'))
    for include in dependencies['Data']['Includes']:
        path = safe(Path(include),'file')
        if not any(path.is_relative_to(root) for root in includes): raise ValueError('External compiler header denied.')
    binary = folder/'training_result_store.node'
    manifest = {'schema':'windows-training-result-build-v1','profile':PROFILE,'source':SOURCE.relative_to(ROOT).as_posix(),'source_sha256':digest(SOURCE),'binary_sha256':digest(binary),'inputs':inputs,'compiler_exit_code':compiler_exit_code,'seconds':time.monotonic()-started,'compiler_job':evidence,'limitations':'Compilation and private no-effect ABI only. Not native file/crash, receiver, host, packaging or task qualification.'}
    with (folder/'manifest.json').open('x',encoding='utf-8') as output: output.write(json.dumps(manifest,indent=2)+'\n')
    # Only fixed known byproducts of this exclusive successful compiler episode.
    # Keep binary, log, input/dependency and process evidence; never recurse.
    for name in ('training_result_store.obj','training_result_store.lib','training_result_store.exp'):
        candidate=folder/name
        if candidate.exists(): safe(candidate,'file').unlink()
    print(json.dumps({'kind':'result','build':folder.relative_to(ROOT).as_posix(),'binary_sha256':manifest['binary_sha256'],'cleanup_passed':True,'compiler_job':evidence}),flush=True)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--plan',action='store_true')
    for name in ('child','run-id','model-manifest','count','variant','device','phase','profile','samples'): parser.add_argument('--'+name)
    args=parser.parse_args()
    if args.child:
        if args.child!='measure': raise ValueError('Unsupported build worker.')
        worker(args); return
    compiler, includes, libraries = profile()
    if args.plan:
        print(json.dumps({'profile':PROFILE,'available':True,'fetch':False,'shell':False,'source':SOURCE.relative_to(ROOT).as_posix(),'includes':len(includes),'libraries':len(libraries),'compiler_seconds':120,'compiler_job_commit_bytes':2*1024**3,'compiler_process_limit':8,'runtimeChanged':False,'napiVersion':8})); return
    folder=create_output_folder(); fixed.owned.SCRIPT=SCRIPT
    result=fixed.owned.run_child(argparse.Namespace(samples=1,model_manifest=PROFILE),folder,1,'measure',early_identity=True)
    print(json.dumps(result),flush=True)


if __name__=='__main__': main()
