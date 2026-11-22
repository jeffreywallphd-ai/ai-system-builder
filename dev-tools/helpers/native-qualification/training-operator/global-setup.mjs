// Reviewed deployment and a separate one-use Native effect are still required.
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {readFileSync,lstatSync,realpathSync,openSync,writeSync,fsyncSync,closeSync} from 'node:fs';
import {spawnSync,execFile} from 'node:child_process';
import {createHash} from 'node:crypto';

const FIXED_CONTEXT = null;
const operatorRelative=FIXED_CONTEXT?`.local-codex/native-training-host-operator/v2/${FIXED_CONTEXT.run_id}/${FIXED_CONTEXT.phase}`:'unbound';
const installedPath=fileURLToPath(import.meta.url);
const root=path.resolve(path.dirname(installedPath),'../../../../..');
const python=path.join(root,'artifacts/tmp/lancedb-python312-ai-runtime/Scripts/python.exe');
const fail=()=>{throw new Error('The fixed read-only training prerequisites are unavailable.');};
const probeKinds=new Set(['input-inspection','pip-version','environment','worker','training','torch',
  'context','backend-cpu','backend-cuda','backend-rocm','gpu-nvidia','gpu-rocm']);
const modules=new Set(['torch','transformers','accelerate','safetensors','pydantic','datasets','peft',
  'guidance','lancedb','huggingface_hub','numpy','pandas','pyarrow','PIL','tokenizers','sentence_transformers','einops',
  'docx','fastapi','hf_xet','markdownify','pypdf','uvicorn','jsonschema','outlines','outlines_core','llguidance']);
const errorTypes=new Set(['Error','TypeError','SyntaxError','RangeError','ReferenceError','PythonRuntimeContextDependencyError']);
const osCodes=new Set(['ENOENT','ETIMEDOUT','ENOBUFS','EACCES','EPERM','UNKNOWN']);
const builtinErrors=new Set(['ModuleNotFoundError','ImportError','OSError','MemoryError','RuntimeError','SyntaxError','AttributeError','ValueError']);
let stage='admission',calls=0,totalBytes=0,ledger=null,ledgerBytes=0;
const evidenceErrors=[],completed=[],dependencyOutcomes=[],deniedActions=[];
const bytes=value=>Buffer.isBuffer(value)?value:Buffer.from(typeof value==='string'?value:'','utf8');
const sha=value=>createHash('sha256').update(value).digest('hex');

export function literalProbe(source,name) {
  const marker=`const ${name} = `,start=source.indexOf(marker);
  if(start<0||source.indexOf(marker,start+1)>=0)fail();
  const found=source.slice(start+marker.length).match(/^`([\s\S]*?)`\.trim\(\);/);
  if(!found)fail();
  // JavaScript normalizes physical CRLF/CR in template literals before trim().
  // Match the evaluated fixed probe; retain exact allowlisting after that step.
  return found[1].replace(/\r\n?/g,'\n').trim();
}
export function trainingReadOnlyArguments(args,probes) {
  return Array.isArray(args)&&((args.length===3&&args[0]==='-m'&&args[1]==='pip'&&args[2]==='--version')||
    (args.length===2&&args[0]==='-c'&&probes.has(args[1])));
}
export function safeTorchFacts(output) {
  const empty={validJson:false,installed:null,pinnedVersion:false,hasCudaVersion:null,hasHipVersion:null,cudaAvailable:null,importErrorPresent:false,importErrorCategory:null};
  let value;try{value=JSON.parse(bytes(output).toString('utf8'));}catch{return empty;}
  if(!value||typeof value!=='object'||Array.isArray(value))return empty;
  const error=typeof value.importError==='string'?value.importError:'';
  let category=null;
  if(/\[WinError (?:8|1455)\]|not enough memory|paging file is too small|out of memory/i.test(error))category='insufficient-memory';
  else if(/\[WinError 5\]|access is denied|permission denied/i.test(error))category='access-denied';
  else if(/DLL load failed|\[WinError (?:126|1114)\]/i.test(error))category='native-library-unavailable';
  else if(/No module named/i.test(error))category='python-module-unavailable';
  else if(error)category='other-import-failure';
  return {validJson:true,installed:typeof value.installed==='boolean'?value.installed:null,pinnedVersion:value.version==='2.6.0+cu126',
    hasCudaVersion:value.cudaVersion===null?false:typeof value.cudaVersion==='string'?value.cudaVersion.length>0:null,
    hasHipVersion:value.hipVersion===null?false:typeof value.hipVersion==='string'?value.hipVersion.length>0:null,
    cudaAvailable:typeof value.cudaAvailable==='boolean'?value.cudaAvailable:null,importErrorPresent:!!error,importErrorCategory:category};
}
export function safeDependencyOutcome(value) {
  const backend=v=>['cpu','cuda','rocm'].includes(v)?v:null;
  if(!value||!['worker','model-training'].includes(value.operation)||typeof value.success!=='boolean'||!Array.isArray(value.stages)||value.stages.length>32)fail();
  return {operation:value.operation,success:value.success,detectedBackend:backend(value.detectedBackend),selectedBackend:backend(value.selectedBackend),
    verificationSuccess:typeof value.verificationResult?.success==='boolean'?value.verificationResult.success:null,recordedStages:value.stages.length};
}
export function deniedActionKind(command,args,pythonCommand) {
  if(command===pythonCommand&&Array.isArray(args)) {
    if(args[0]==='-m'&&args[1]==='pip'&&args[2]==='install')return 'package-install';
    if(args[0]==='-c'&&typeof args[1]==='string'&&args[1].startsWith('# asb:torch-network-probe\n'))return 'network-probe';
  }
  return 'unknown-command';
}
export function safeProbeFacts(index,kind,result) {
  if(!Number.isInteger(index)||index<1||index>32||!probeKinds.has(kind))fail();
  const out=bytes(result.stdout),err=bytes(result.stderr),text=err.toString('utf8');
  const missing=[];
  for(const match of text.matchAll(/ModuleNotFoundError: No module named ['"]([^'"]+)['"]/g))
    if(modules.has(match[1])&&!missing.includes(match[1]))missing.push(match[1]);
  const found=text.match(/(?:^|\n)([A-Za-z]+Error):/m)?.[1];
  return {probe:index,kind,exitCode:Number.isInteger(result.status)?result.status:null,
    spawnErrorCode:osCodes.has(result.error?.code)?result.error.code:null,
    stderrErrorType:builtinErrors.has(found)?found:null,missingModules:missing,
    stdoutBytes:out.length,stderrBytes:err.length,stdoutSha256:sha(out),stderrSha256:sha(err),
    runtimeFacts:kind==='torch'?safeTorchFacts(out):null};
}
function reserveProbe() {
  if(calls>=32||totalBytes>4*1024**2||evidenceErrors.length)fail();
  return ++calls;
}
function recordProbe(index,kind,result) {
  const facts=safeProbeFacts(index,kind,result);
  totalBytes+=facts.stdoutBytes+facts.stderrBytes;
  const payload=Buffer.from(JSON.stringify(facts)+'\n');
  if(totalBytes>4*1024**2||ledgerBytes+payload.length>65536){evidenceErrors.push('probe-evidence-bound');return;}
  try {
    if(ledger===null||writeSync(ledger,payload)!==payload.length)throw new Error();
    ledgerBytes+=payload.length;
  } catch {evidenceErrors.push('probe-evidence-write');}
}
function regularDirectory(directory) {
  if(!path.isAbsolute(directory)||path.resolve(directory)!==directory)fail();
  const info=lstatSync(directory);
  if(!info.isDirectory()||info.isSymbolicLink()||realpathSync(directory)!==directory)fail();
}
async function inspect(phase = "training-readiness") {
  if(!FIXED_CONTEXT||phase!==FIXED_CONTEXT.phase||process.platform!=='win32'||installedPath!==path.join(root,operatorRelative,'global-setup.mjs'))fail();
  if(process.env.VISUAL_COMPOSER_TRAINING_INPUT_SHA256!==FIXED_CONTEXT.input_manifest_sha256)fail();
  const run=process.env.AISB_LOCAL_TRAINING_UI_RUN;
  const relative=typeof run==='string'?path.relative(root,run).replaceAll('\\','/'):'';
  if(!['training-readiness','training-ui'].includes(phase)||!/^\.local-codex\/native-training-host-v1\/runs\/[a-f0-9]{32}$/.test(relative)||path.resolve(run)!==run||process.cwd()!==path.join(run,phase))fail();
  if(path.basename(run)!==FIXED_CONTEXT.run_id)fail();
  regularDirectory(run);regularDirectory(process.cwd());
  const hex=path.basename(run),uuid=`${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
  const acquisition=`.local-codex/training-inputs/tiny-${uuid}/input.json`;
  if(process.env.VISUAL_COMPOSER_TRAINING_MODEL_ACQUISITION!==acquisition||
     !/^[a-f0-9]{64}$/.test(process.env.VISUAL_COMPOSER_TRAINING_INPUT_SHA256??'')||
     ['HF_HUB_OFFLINE','TRANSFORMERS_OFFLINE','HF_DATASETS_OFFLINE','PIP_NO_INDEX'].some(key=>process.env[key]!=='1')||
     process.env.PYTHON_RUNTIME_QUALIFICATION_SCENARIO!=='training-model-host')fail();
  ledger=openSync(path.join(process.cwd(),'readiness-probes.jsonl'),'wx',0o600);
  stage='actual-input-inspection';
  const inputIndex=reserveProbe();
  const input=spawnSync(python,['-I','-B',path.join(root,'dev-tools/scripts/qualification/visual-composer/training-host-prerequisites.py'),'--inspect'],
    {cwd:process.cwd(),env:process.env,windowsHide:true,encoding:'utf8',timeout:120000,maxBuffer:8192});
  recordProbe(inputIndex,'input-inspection',input);
  if(input.status!==0||input.error||Buffer.byteLength(input.stdout??'')>4096)fail();
  const facts=JSON.parse(input.stdout);
  if(facts.schemaVersion!=='training-local-inputs-v2'||facts.status!=='verified-inputs-only'||facts.accuracyExecuted!==false||facts.launchAuthorized!==false||
     facts.pythonRelative!=='artifacts/tmp/lancedb-python312-ai-runtime/Scripts/python.exe'||facts.modelId!=='aisb-testing/tiny-qwen2-v1'||facts.provider!=='unknown'||
     facts.inputProfile!=='generated-tiny-qwen2-v1'||facts.displayName!=='Generated tiny training input'||facts.modelFiles!==6||
     facts.manifestSha256!==process.env.VISUAL_COMPOSER_TRAINING_INPUT_SHA256||facts.modelRelativeDirectory!==acquisition.slice(0,-'/input.json'.length))fail();
  completed.push('inputs');stage='read-only-adapter-setup';
  const workerFile=path.join(root,'modules/adapters/runtime/python/ensurePythonRuntimeWorkerDependencies.ts');
  const contextFile=path.join(root,'modules/adapters/runtime/python/ensurePythonRuntimeContextDependencies.ts');
  const workerSource=readFileSync(workerFile,'utf8'),contextSource=readFileSync(contextFile,'utf8');
  const probes=new Map();
  for(const [name,kind] of [['ENV_INSPECTION_SCRIPT','environment'],['WORKER_DEPENDENCY_PROBE_SCRIPT','worker'],
    ['MODEL_TRAINING_DEPENDENCY_PROBE_SCRIPT','training'],['TORCH_INSTALL_PROBE_SCRIPT','torch']])probes.set(literalProbe(workerSource,name),kind);
  probes.set(literalProbe(contextSource,'CONTEXT_DEPENDENCY_PROBE_SCRIPT'),'context');
  for(const backend of ['cpu','cuda','rocm'])probes.set(literalProbe(workerSource,'verificationScript').replace('${JSON.stringify(backend)}',JSON.stringify(backend)),`backend-${backend}`);
  const readonlySpawn=(command,args)=>{
    let kind;
    if(command==='nvidia-smi'&&JSON.stringify(args)==='["--query-gpu=name","--format=csv,noheader"]')kind='gpu-nvidia';
    else if(command==='rocminfo'&&Array.isArray(args)&&args.length===0)kind='gpu-rocm';
    else if(command===python&&trainingReadOnlyArguments(args,probes))kind=args[0]==='-m'?'pip-version':probes.get(args[1]);
    else {if(deniedActions.length<32)deniedActions.push(deniedActionKind(command,args,python));fail();} // Never dispatch.
    const index=reserveProbe(),isPython=command===python;
    const result=spawnSync(command,isPython?['-I','-B',...args]:args,{cwd:process.cwd(),env:process.env,windowsHide:true,
      encoding:'utf8',timeout:isPython?60000:15000,maxBuffer:isPython?65536:8192});
    recordProbe(index,kind,result);return result;
  };
  const workerModule=await import(pathToFileURL(workerFile).href),contextModule=await import(pathToFileURL(contextFile).href);
  const worker=workerModule.default??workerModule,context=contextModule.default??contextModule;
  if(typeof worker.ensurePythonRuntimeWorkerDependencies!=='function'||typeof worker.ensurePythonRuntimeModelTrainingDependencies!=='function'||typeof context.ensurePythonRuntimeContextDependencies!=='function')fail();
  const options={command:python,env:process.env,platform:'win32',retryCount:0,installTimeoutMs:60000,spawnSyncImplementation:readonlySpawn,
    onDiagnosticOutcomes:value=>{if(dependencyOutcomes.length>=2)fail();dependencyOutcomes.push(safeDependencyOutcome(value));}};
  stage='real-worker-dependencies';worker.ensurePythonRuntimeWorkerDependencies(options);completed.push('worker');
  stage='real-training-dependencies';worker.ensurePythonRuntimeModelTrainingDependencies(options);completed.push('training');
  stage='real-context-dependencies';
  await context.ensurePythonRuntimeContextDependencies({command:python,env:process.env,platform:'win32',execFileImplementation:(command,args,_options,callback)=>{
    if(command!==python||!trainingReadOnlyArguments(args,probes)){if(deniedActions.length<32)deniedActions.push(deniedActionKind(command,args,python));fail();}
    const index=reserveProbe(),kind=args[0]==='-m'?'pip-version':probes.get(args[1]);
    return execFile(python,['-I','-B',...args],{cwd:process.cwd(),env:process.env,windowsHide:true,encoding:'utf8',timeout:60000,maxBuffer:65536},(error,stdout,stderr)=>{
      recordProbe(index,kind,{status:error?(Number.isInteger(error.code)?error.code:null):0,error,stdout,stderr});
      callback(error,stdout,stderr);
    });
  }});
  completed.push('context');
}
// Fixed private test composition, not a public command or package selector.
const UI_RUN=FIXED_CONTEXT?.run_id;
const UI_INPUT_RELATIVE=FIXED_CONTEXT?`.local-codex/training-inputs/tiny-${UI_RUN.slice(0,8)}-${UI_RUN.slice(8,12)}-${UI_RUN.slice(12,16)}-${UI_RUN.slice(16,20)}-${UI_RUN.slice(20)}/input.json`:null;
const UI_CASE_RUN=FIXED_CONTEXT?`training-ui-${UI_RUN}-01`:null;
const UI_INPUT_SHA=FIXED_CONTEXT?.input_manifest_sha256;
const UI_SOURCE=FIXED_CONTEXT?.source_identity;
const UI_GIT=FIXED_CONTEXT?.git_executable;
const UI_GIT_SHA=FIXED_CONTEXT?.git_sha256;
const UI_TITLE='packaged desktop trains one local adapter, reviews privately, saves and reopens it';
const UI_APP_SHA=FIXED_CONTEXT?.application_sha256;
const UI_WORKER_SHA=FIXED_CONTEXT?.worker_main_sha256;
const TRAINING_FLAGS=Object.freeze([
 'PYTHON_RUNTIME_QUALIFICATION_SCENARIO','VISUAL_COMPOSER_TRAINING_MODEL_ACQUISITION',
 'VISUAL_COMPOSER_TRAINING_INPUT_SHA256','VISUAL_COMPOSER_TRAINING_PACKAGED_ROOT',
 'HF_HUB_OFFLINE','TRANSFORMERS_OFFLINE','HF_DATASETS_OFFLINE','PIP_NO_INDEX',
 'PIP_REQUIRE_HASHES','PIP_DISABLE_PIP_VERSION_CHECK','PIP_CONFIG_FILE',
 'CUDA_VISIBLE_DEVICES','HIP_VISIBLE_DEVICES','OMP_NUM_THREADS','MKL_NUM_THREADS',
]);
export function fixedTrainingUiPaths(repoRoot) {
 if(FIXED_CONTEXT?.phase!=='training-ui')fail();
 if(typeof repoRoot!=='string'||!path.isAbsolute(repoRoot)||path.resolve(repoRoot)!==repoRoot)fail();
 const run=path.join(repoRoot,'.local-codex/native-training-host-v1/runs',UI_RUN);
 const dataId=sha(UI_CASE_RUN).slice(0,16);
 return Object.freeze({repoRoot,run,caseRun:UI_CASE_RUN,phase:path.join(run,'training-ui'),
  packageRoot:path.join(repoRoot,'.local-codex/q',UI_RUN.slice(0,8),'o/ai-system-builder-win32-x64'),
  hostRun:path.join(repoRoot,'artifacts/qualification/visual-composer/runs',UI_CASE_RUN),
  dataParent:path.join(repoRoot,'artifacts/qualification/visual-composer/d',dataId),
  dataRoot:path.join(repoRoot,'artifacts/qualification/visual-composer/d',dataId,'desktop'),
  setup:path.join(repoRoot,operatorRelative,'global-setup.mjs'),
 });
}
export function fixedTrainingUiConfig(repoRoot,setup) {
 const p=fixedTrainingUiPaths(repoRoot);if(setup!==p.setup)fail();
 return {build:{external:['**/*.mjs']},globalSetup:setup,testDir:path.join(repoRoot,'dev-tools/scripts/qualification/visual-composer/e2e'),
  testMatch:'packaged-desktop-operational-ui.e2e.spec.ts',grep:new RegExp(`${UI_TITLE}$`),
  outputDir:path.join(p.phase,'playwright-output'),fullyParallel:false,workers:1,retries:0,timeout:600000,
  expect:{timeout:8000},use:{actionTimeout:8000,navigationTimeout:15000,screenshot:'off',trace:'off',video:'off'},
  reporter:[['json',{outputFile:path.join(p.phase,'playwright-result.json')}]],
  projects:[{name:'packaged-desktop'}]};
}
export function verifiedUiReadiness(result) {
 let facts;try {facts=JSON.parse(result.stdout);}catch {fail();}
 if(result.error||result.status!==0||Buffer.byteLength(result.stdout??'')>8192||
  facts?.schemaVersion!=='training-host-readiness-v1'||facts.status!=='inputs-and-dependencies-verified'||
  facts.accuracyExecuted!==false||facts.probeEvidenceClosed!==true||
  !Number.isInteger(facts.probeCount)||facts.probeCount<1||facts.probeCount>32||
  JSON.stringify(facts.completed)!=='["inputs","worker","training","context"]'||
  !Array.isArray(facts.deniedActions)||facts.deniedActions.length!==0||
  !Array.isArray(facts.dependencyOutcomes)||facts.dependencyOutcomes.length!==2||
  facts.dependencyOutcomes[0]?.operation!=='worker'||facts.dependencyOutcomes[0]?.verificationSuccess!==true||
  facts.dependencyOutcomes[1]?.operation!=='model-training'||facts.dependencyOutcomes[1]?.verificationSuccess!==null||
  facts.dependencyOutcomes.some(v=>v.success!==true))fail();
 return facts;
}
export function assertTrainingUiEnvironment(p,env) {
 const expected=fixedTrainingUiPaths(p.repoRoot);
 if(Object.keys(p).length!==Object.keys(expected).length||Object.entries(expected).some(([k,v])=>p[k]!==v)||
  env.AISB_LOCAL_TRAINING_UI_RUN!==p.run||env.PYTHON_RUNTIME_QUALIFICATION_SCENARIO!=='training-model-host'||
  env.VISUAL_COMPOSER_TRAINING_MODEL_ACQUISITION!==UI_INPUT_RELATIVE||
  env.VISUAL_COMPOSER_TRAINING_INPUT_SHA256!==UI_INPUT_SHA||env.VISUAL_COMPOSER_TRAINING_PACKAGED_ROOT!==p.packageRoot||
  ['HF_HUB_OFFLINE','TRANSFORMERS_OFFLINE','HF_DATASETS_OFFLINE','PIP_NO_INDEX','PIP_REQUIRE_HASHES',
   'PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD','ELECTRON_SKIP_BINARY_DOWNLOAD'].some(k=>env[k]!=='1')||
  env.CUDA_VISIBLE_DEVICES!=='0'||env.HIP_VISIBLE_DEVICES!==''||env.OMP_NUM_THREADS!=='1'||env.MKL_NUM_THREADS!=='1'||
  env.NODE_OPTIONS!==''||typeof env.PATH!=='string'||!env.PATH||
  ['NODE_PATH','NODE_TEST_CONTEXT','TSX_TSCONFIG_PATH','TS_NODE_PROJECT','ELECTRON_RUN_AS_NODE',
   'HF_TOKEN','HUGGING_FACE_HUB_TOKEN','HUGGINGFACEHUB_API_TOKEN','OPENAI_API_KEY','ANTHROPIC_API_KEY',
   'VISUAL_COMPOSER_TRAINING_READY','VISUAL_COMPOSER_QUALIFICATION_RUN_ID',
   'VISUAL_COMPOSER_QUALIFICATION_SOURCE_REVISION','VISUAL_COMPOSER_DESKTOP_DATA_ROOT'].some(k=>Object.hasOwn(env,k)))fail();
}
// Injectable inert ports support definition tests. Production below supplies only fixed real ports.
export async function runFixedTrainingUiSetup(config,p,env,ports) {
 assertTrainingUiEnvironment(p,env);
 if(config?.projects?.length!==1||config.projects[0]?.name!=='packaged-desktop')fail();
 let uiStage='fresh-source-and-package';
 try {
  await ports.admit(p);
  // Public source identity and existing input-only seed scripts invoke installed Git.
  // No executable selector, new tool installation or general PATH inheritance is added.
  env.PATH+=path.delimiter+path.dirname(UI_GIT);
  const source=await ports.source(p.repoRoot);if(source!==UI_SOURCE)fail();
  uiStage='real-read-only-prerequisites';
  verifiedUiReadiness(await ports.readiness(p,env));
  if(await ports.source(p.repoRoot)!==source)fail();
  uiStage='input-only-identity-seed';
  const executable=path.join(p.packageRoot,'ai-system-builder.exe');
  const plan=await ports.plan({repoRoot:p.repoRoot,runId:UI_CASE_RUN,environment:env,
   acquisition:env.VISUAL_COMPOSER_TRAINING_MODEL_ACQUISITION,manifestHash:UI_INPUT_SHA,packagedRoot:p.packageRoot,
   desktopExecutablePath:executable,electronNodeExecutablePath:executable});
  if(plan?.repoRoot!==p.repoRoot||plan.runId!==UI_CASE_RUN||plan.paths?.desktopDataRoot!==p.dataRoot||
   plan.desktop?.executablePath!==executable||plan.desktop?.seed?.command!==executable||
   plan.desktop.seed.env?.ELECTRON_RUN_AS_NODE!=='1'||plan.desktop.env?.ELECTRON_RUN_AS_NODE!==undefined)fail();
  const projection=await ports.project(plan,source);
  if(projection?.VISUAL_COMPOSER_QUALIFICATION_SOURCE_REVISION!==source||
   projection.VISUAL_COMPOSER_QUALIFICATION_RUN_ID!==UI_CASE_RUN||projection.VISUAL_COMPOSER_DESKTOP_DATA_ROOT!==p.dataRoot||
   projection.VISUAL_COMPOSER_DESKTOP_EXECUTABLE!==executable||projection.VISUAL_COMPOSER_ELECTRON_NODE_EXECUTABLE!==executable)fail();
  if(TRAINING_FLAGS.some(k=>typeof plan.desktop.env[k]!=='string'))fail();
  await ports.seed(plan);
  if(await ports.source(p.repoRoot)!==source)fail();
  Object.assign(env,projection);
  for(const k of TRAINING_FLAGS)env[k]=plan.desktop.env[k];
  env.VISUAL_COMPOSER_TRAINING_READY='1';
  return async()=>{if(await ports.source(p.repoRoot)!==source)fail();};
 }catch {
  delete env.VISUAL_COMPOSER_TRAINING_READY;
  throw new Error(`The fixed training UI setup did not complete: ${uiStage}.`);
 }
}
export default async function fixedUiSetup(config) {
 if(process.platform!=='win32'||installedPath!==path.join(root,operatorRelative,'global-setup.mjs')||process.cwd()!==root)fail();
 const p=fixedTrainingUiPaths(root);
 return runFixedTrainingUiSetup(config,p,process.env,{
  admit:async()=>{
   regularDirectory(root);regularDirectory(p.run);regularDirectory(p.phase);regularDirectory(p.packageRoot);
   for(const name of [p.hostRun,p.dataParent,path.join(p.phase,'readiness-probes.jsonl'),path.join(p.phase,'playwright-result.json')])
    if(lstatSync(name,{throwIfNoEntry:false})!==undefined)fail();
   const {verifiedFile}=await import(pathToFileURL(path.join(path.dirname(installedPath),'package-tree.mjs')).href);
   for(const [file,digest]of [[UI_GIT,UI_GIT_SHA],[path.join(p.packageRoot,'ai-system-builder.exe'),UI_APP_SHA],
    [path.join(p.packageRoot,'resources/worker/main.py'),UI_WORKER_SHA]]) {
    const stat=lstatSync(file);
    // Installed supplier Git can have multiple stable links; owned package copies cannot.
    verifiedFile(file,{bytes:stat.size,sha256:digest},256*1024**2,{singleLink:file!==UI_GIT});
   }
  },
  source:async repoRoot=>(await import(pathToFileURL(path.join(repoRoot,'dev-tools/scripts/qualification/asset-system-source-identity.mjs')).href)).readAssetSystemSourceIdentity(repoRoot),
  readiness:(paths,env)=>spawnSync(process.execPath,['--import','tsx',installedPath,'--inspect-ui-prerequisites'],
   {cwd:paths.phase,env,windowsHide:true,encoding:'utf8',timeout:300000,maxBuffer:8192}),
  plan:async options=>(await import(pathToFileURL(path.join(root,'dev-tools/scripts/qualification/visual-composer/training-host-launch-plan.mjs')).href)).createTrainingHostLaunchPlan(options),
  project:async(plan,source)=>(await import(pathToFileURL(path.join(root,'dev-tools/scripts/qualification/visual-composer/visual-composer-qualification-environment.mjs')).href)).resolveVisualComposerQualificationEnvironment(plan,source),
  seed:async plan=>(await import(pathToFileURL(path.join(root,'dev-tools/scripts/qualification/visual-composer/visual-composer-global-setup.mjs')).href)).preparePackagedDesktopQualificationIdentity(plan),
 });
}

async function main() {
  let primary=null;
  try {
    if(process.argv.length!==3||!['--inspect-prerequisites','--inspect-ui-prerequisites'].includes(process.argv[2]))fail();
    await inspect(process.argv[2]==='--inspect-prerequisites'?'training-readiness':'training-ui');
  } catch(error){primary=error;}
  if(ledger!==null){
    try{fsyncSync(ledger);}catch{evidenceErrors.push('probe-evidence-sync');}
    try{closeSync(ledger);ledger=null;}catch{evidenceErrors.push('probe-evidence-close');}
  }
  if(primary||evidenceErrors.length){
    process.stderr.write(JSON.stringify({schemaVersion:'training-host-readiness-v1',status:'unavailable',stage,
      errorType:primary?(errorTypes.has(primary.name)?primary.name:'UnhandledError'):null,
      completed,probeCount:calls,evidenceErrors,dependencyOutcomes,deniedActions,accuracyExecuted:false})+'\n');
    process.exitCode=1;return;
  }
  process.stdout.write(JSON.stringify({schemaVersion:'training-host-readiness-v1',status:'inputs-and-dependencies-verified',
    completed,probeCount:calls,probeEvidenceClosed:true,dependencyOutcomes,deniedActions,accuracyExecuted:false})+'\n');
}
if(process.argv[1]&&path.resolve(process.argv[1])===installedPath)void main();
