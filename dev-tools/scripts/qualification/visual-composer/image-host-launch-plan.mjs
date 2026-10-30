import path from "node:path";
import {createHash} from "node:crypto";
import {types} from "node:util";

export const IMAGE_HOSTS=Object.freeze(["packaged-desktop","thin-chrome"]);
export const IMAGE_CASES=Object.freeze(["create-register","task-recovery"]);
export const IMAGE_COMFY_ORIGIN="http://127.0.0.1:8188";
const deny=()=>{throw new Error("The fixed image qualification configuration is invalid.");};
export function imageCheckpointName(value) {
  return typeof value==="string"&&/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}\.safetensors$/.test(value)&&
    !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(value);
}
function root(value) {
  if(typeof value!=="string"||value.length>32768||/[\0\r\n]/.test(value)||!path.isAbsolute(value)||path.resolve(value)!==value||/^(?:\\\\|\/\/)/.test(value))deny();
  return value;
}
function run(value){if(typeof value!=="string"||!/^[a-z0-9-]{20,80}$/.test(value))deny();return value;}
function host(value){if(!IMAGE_HOSTS.includes(value))deny();return value;}
function scenario(value){if(!IMAGE_CASES.includes(value))deny();return value;}
export function imageHostLayout(repoRoot,runId) {
  root(repoRoot);run(runId);
  const key=createHash("sha256").update(runId).digest("hex").slice(0,16);
  const base=path.join(repoRoot,"artifacts/qualification/visual-composer"),data=path.join(base,"d",key);
  const serverRuntimeRoot=path.join(data,"thin-runtime"),providerRoot=path.join(serverRuntimeRoot,"runtime-installs/comfyui");
  return Object.freeze({repoRoot,runId,serverRuntimeRoot,providerRoot,checkpointRoot:path.join(providerRoot,"models/checkpoints"),
    manifestPath:path.join(serverRuntimeRoot,"image-host-inputs.json"),desktopDataRoot:path.join(data,"desktop"),runRoot:path.join(base,"runs",runId)});
}
const privateKey=/(?:^|_)(?:TOKEN|SECRET|PASSWORD|CREDENTIAL|API_KEY|PRIVATE_KEY)(?:_|$)/;
const replacedKey=/^(?:COMFYUI_|PYTHON|HF_|HUGGING|TRANSFORMERS_|TORCH_|TORCHINDUCTOR_|TRITON_|XDG_CACHE_HOME$|PIP_|CUDA_|HIP_|OMP_|MKL_|NODE_OPTIONS$|ELECTRON_RUN_AS_NODE$|VISUAL_COMPOSER_IMAGE_|GIT_|SSH_ASKPASS$|SSH_AUTH_SOCK$|HTTP_PROXY$|HTTPS_PROXY$|ALL_PROXY$)/;
function environmentSnapshot(environment) {
  if(!environment||typeof environment!=="object"||types.isProxy(environment))deny();
  const fields=Object.getOwnPropertyDescriptors(environment),keys=Reflect.ownKeys(fields);
  if(keys.length>512||keys.some(key=>typeof key!=="string"||!/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(key)))deny();
  const captured=Object.create(null),seen=new Set();
  for(const key of keys) {
    const field=fields[key];if(!("value" in field))deny();
    const normalized=key.toUpperCase();
    if(privateKey.test(normalized)||replacedKey.test(normalized)||seen.has(normalized))continue;
    if(typeof field.value!=="string"||Buffer.byteLength(field.value)>32768||field.value.includes("\0"))deny();
    captured[key]=field.value;seen.add(normalized);
  }
  return captured;
}
/** Data-only known-layout environment. No path is opened and no launch is authorized. */
export function createImageHostEnvironment(environment,repoRoot,runId,target) {
  const layout=imageHostLayout(repoRoot,runId);host(target);
  const port=target==="packaged-desktop"?43172:43173;
  const cache=path.join(target==="packaged-desktop"?layout.desktopDataRoot:layout.serverRuntimeRoot,"controlled-model-cache");
  return {...environmentSnapshot(environment),
    VISUAL_COMPOSER_QUALIFICATION_RUN_ID:runId,
    COMFYUI_AUTO_INSTALL:"0",COMFYUI_INSTALL_ROOT:layout.providerRoot,COMFYUI_BASE_URL:IMAGE_COMFY_ORIGIN,
    COMFYUI_PYTHON_ENVIRONMENT_MODE:"managed-venv",COMFYUI_RUNTIME_DEVICE_MODE:"auto",
    COMFYUI_PYTHON_COMMAND:path.join(layout.providerRoot,".venv",process.platform==="win32"?"Scripts/python.exe":"bin/python"),
    PYTHONNOUSERSITE:"1",PYTHON_RUNTIME_COMMAND:process.execPath,
    PYTHON_RUNTIME_ARGS:"dev-tools/scripts/qualification/visual-composer/controlled-conversation-runtime-worker.mjs",
    PYTHON_RUNTIME_WORKER_DIR:repoRoot,PYTHON_RUNTIME_HOST:"127.0.0.1",PYTHON_RUNTIME_PORT:String(port),PYTHON_RUNTIME_QUALIFICATION_SCENARIO:"immediate",
    PYTHON_RUNTIME_BASE_URL:`http://127.0.0.1:${port}`,PYTHON_RUNTIME_STARTUP_TIMEOUT_MS:"15000",
    HF_HUB_OFFLINE:"1",TRANSFORMERS_OFFLINE:"1",HF_DATASETS_OFFLINE:"1",PIP_NO_INDEX:"1",PIP_REQUIRE_HASHES:"1",
    PIP_DISABLE_PIP_VERSION_CHECK:"1",PIP_CONFIG_FILE:process.platform==="win32"?"NUL":"/dev/null",
    OMP_NUM_THREADS:"1",MKL_NUM_THREADS:"1",HF_HUB_CACHE:cache,HF_HOME:path.join(cache,"hf-home"),
    HF_DATASETS_CACHE:path.join(cache,"datasets"),TRANSFORMERS_CACHE:path.join(cache,"transformers"),
    TORCH_HOME:path.join(cache,"torch"),TORCHINDUCTOR_CACHE_DIR:path.join(cache,"torch-inductor"),
    TRITON_CACHE_DIR:path.join(cache,"triton"),XDG_CACHE_HOME:path.join(cache,"xdg"),
    SERVER_RUNTIME_ROOT:layout.serverRuntimeRoot,AI_SYSTEM_BUILDER_DEDICATED_ORGANIZATION_ID:"qualification.local",
  };
}
export function captureImageInspection(input,runId,sourceRevision) {
  run(runId);if(typeof sourceRevision!=="string"||!/^source\.[a-f0-9]{64}$/.test(sourceRevision)||typeof input!=="string"||Buffer.byteLength(input)>4096)deny();
  let value;try{value=JSON.parse(input);}catch{deny();}
  const keys=["schemaVersion","status","runId","sourceRevision","checkpointFileName","checkpointSha256","checkpointBytes","comfyCommitSha","managedSourceConfirmed","runtimeDependenciesQualified","hostLaunched","modelAccuracyExecuted"];
  if(!value||typeof value!=="object"||Array.isArray(value)||Object.keys(value).length!==keys.length||keys.some(key=>!Object.hasOwn(value,key))||
    value.schemaVersion!=="image-host-local-inputs-v1"||value.status!=="input-identity-verified"||value.runId!==runId||value.sourceRevision!==sourceRevision||
    !imageCheckpointName(value.checkpointFileName)||typeof value.checkpointSha256!=="string"||!/^[a-f0-9]{64}$/.test(value.checkpointSha256)||typeof value.comfyCommitSha!=="string"||!/^[a-f0-9]{40}$/.test(value.comfyCommitSha)||
    !Number.isSafeInteger(value.checkpointBytes)||value.checkpointBytes<9||value.checkpointBytes>4*1024**3||
    value.managedSourceConfirmed!==true||value.runtimeDependenciesQualified!==false||value.hostLaunched!==false||value.modelAccuracyExecuted!==false)deny();
  return Object.freeze({...value});
}
export function createImageCaseEnvironment(environment,repoRoot,runId,target,selectedCase,inspection) {
  host(target);scenario(selectedCase);if(target!=="packaged-desktop")deny();
  const captured=createImageHostEnvironment(environment,repoRoot,runId,target);
  if(!inspection||typeof inspection!=="object"||types.isProxy(inspection)||![Object.prototype,null].includes(Object.getPrototypeOf(inspection)))deny();
  const snapshot={},descriptors=Object.getOwnPropertyDescriptors(inspection);
  for(const key of Reflect.ownKeys(descriptors)) {
    const field=descriptors[key];if(typeof key!=="string"||!("value" in field)||!["string","boolean","number"].includes(typeof field.value))deny();
    Object.defineProperty(snapshot,key,{value:field.value,enumerable:true});
  }
  const facts=captureImageInspection(JSON.stringify(snapshot),runId,captured.VISUAL_COMPOSER_QUALIFICATION_SOURCE_REVISION);
  const layout=imageHostLayout(repoRoot,runId),dataRoot=path.join(layout.desktopDataRoot,`image-${selectedCase}`);
  const cache=path.join(dataRoot,"controlled-model-cache"),temp=path.join(dataRoot,"image-temp");
  return {...captured,VISUAL_COMPOSER_DESKTOP_DATA_ROOT:dataRoot,VISUAL_COMPOSER_IMAGE_CASE:selectedCase,
    VISUAL_COMPOSER_IMAGE_INSPECTION:JSON.stringify(facts),COMFYUI_INSTALL_REF:facts.comfyCommitSha,COMFYUI_DEFAULT_CHECKPOINT:facts.checkpointFileName,
    HF_HUB_CACHE:cache,HF_HOME:path.join(cache,"hf-home"),HF_DATASETS_CACHE:path.join(cache,"datasets"),TRANSFORMERS_CACHE:path.join(cache,"transformers"),
    TORCH_HOME:path.join(cache,"torch"),TORCHINDUCTOR_CACHE_DIR:path.join(cache,"torch-inductor"),TRITON_CACHE_DIR:path.join(cache,"triton"),XDG_CACHE_HOME:path.join(cache,"xdg"),TEMP:temp,TMP:temp};
}
export async function createImageHostLaunchPlan({repoRoot,runId,target,environment}) {
  imageHostLayout(repoRoot,runId);host(target);
  // Collection loads only pure bindings. The lifecycle's import.meta is needed
  // only by trusted execution setup, not Playwright's CommonJS case collector.
  const {createVisualComposerHostLaunchPlan}=await import("./visual-composer-host-lifecycle.mjs");
  const plan=createVisualComposerHostLaunchPlan({repoRoot,runId,environment:environmentSnapshot(environment),
    desktopExecutablePath:path.join(repoRoot,"out/ai-system-builder-win32-x64/ai-system-builder.exe"),
    electronNodeExecutablePath:path.join(repoRoot,"node_modules/electron/dist/electron.exe")});
  plan.desktop.env=createImageHostEnvironment(plan.desktop.env,repoRoot,runId,"packaged-desktop");
  plan.desktop.seed.env={...plan.desktop.env,ELECTRON_RUN_AS_NODE:"1"};
  plan.server.env=createImageHostEnvironment(plan.server.env,repoRoot,runId,"thin-chrome");
  plan.server.args[plan.server.args.length-1]=path.join(repoRoot,"dev-tools/scripts/qualification/visual-composer/image-host-server-entry.ts");
  return plan;
}
