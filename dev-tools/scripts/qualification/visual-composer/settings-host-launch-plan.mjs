import path from "node:path";
import {createHash} from "node:crypto";
import {types} from "node:util";

const invalid=()=>new Error("The fixed Settings test profile is invalid.");
export const SETTINGS_HOST_CASES=Object.freeze(["public-values","secret-defaults"]);
function identity(repoRoot,runId,sourceRevision){
  if(typeof repoRoot!=="string"||!path.isAbsolute(repoRoot)||path.resolve(repoRoot)!==repoRoot||repoRoot.length>32768||/[\0\r\n]/.test(repoRoot)||/^(?:\\\\|\/\/)/.test(repoRoot)||
    typeof runId!=="string"||!/^[a-z0-9-]{20,80}$/.test(runId)||typeof sourceRevision!=="string"||!/^source\.[a-f0-9]{64}$/.test(sourceRevision))throw invalid();
}
export function settingsHostLayout(repoRoot,runId,sourceRevision){
  identity(repoRoot,runId,sourceRevision);
  const key=createHash("sha256").update(runId).digest("hex").slice(0,16);
  const dataRoot=path.join(repoRoot,"artifacts/qualification/visual-composer/d",key);
  return Object.freeze({dataRoot,desktopDataRoot:path.join(dataRoot,"desktop"),serverStorageRoot:path.join(repoRoot,"artifacts/qualification/visual-composer/runs",runId,"thin-storage"),serverRuntimeRoot:path.join(dataRoot,"thin-runtime")});
}
// Only OS/build-tool plumbing crosses this boundary. No credential, migration,
// provider, plugin, runtime, database, proxy or caller command override is inherited.
const allowed=new Set(["PATH","PATHEXT","SYSTEMROOT","WINDIR","COMSPEC","SYSTEMDRIVE","PROCESSOR_ARCHITECTURE","NUMBER_OF_PROCESSORS","PROGRAMFILES","PROGRAMFILES(X86)","PROGRAMDATA","APPDATA","LOCALAPPDATA","USERPROFILE","TEMP","TMP","NPM_EXECPATH","NPM_NODE_EXECPATH"]);
function osEnvironment(input){
  if(!input||typeof input!=="object"||types.isProxy(input))throw invalid();
  const fields=Object.getOwnPropertyDescriptors(input),keys=Reflect.ownKeys(fields),output=Object.create(null),seen=new Set();
  if(keys.length>512)throw invalid();
  for(const key of keys){
    if(typeof key!=="string"||key.length>128)throw invalid();
    const field=fields[key];if(!("value" in field))throw invalid();
    const normalized=key.toUpperCase();if(!allowed.has(normalized)||seen.has(normalized))continue;
    if(typeof field.value!=="string"||Buffer.byteLength(field.value)>32768||/[\0\r\n]/.test(field.value))throw invalid();
    output[key]=field.value;seen.add(normalized);
  }
  return output;
}
export function createSettingsHostEnvironment(input,repoRoot,runId,sourceRevision,target,caseId){
  const layout=settingsHostLayout(repoRoot,runId,sourceRevision);
  if(!["packaged-desktop","thin-chrome"].includes(target)||caseId!==undefined&&!SETTINGS_HOST_CASES.includes(caseId)||target==="thin-chrome"&&caseId!==undefined)throw invalid();
  const dataRoot=target==="packaged-desktop"?(caseId?path.join(layout.desktopDataRoot,`settings-${caseId}`):layout.desktopDataRoot):layout.serverRuntimeRoot;
  const port=target==="packaged-desktop"?43172:43173,cache=path.join(dataRoot,"controlled-model-cache");
  return {...osEnvironment(input),VISUAL_COMPOSER_QUALIFICATION_RUN_ID:runId,VISUAL_COMPOSER_QUALIFICATION_SOURCE_REVISION:sourceRevision,
    VISUAL_COMPOSER_DESKTOP_DATA_ROOT:dataRoot,PYTHON_RUNTIME_COMMAND:process.execPath,
    PYTHON_RUNTIME_ARGS:"dev-tools/scripts/qualification/visual-composer/controlled-conversation-runtime-worker.mjs",PYTHON_RUNTIME_WORKER_DIR:repoRoot,
    PYTHON_RUNTIME_HOST:"127.0.0.1",PYTHON_RUNTIME_PORT:String(port),PYTHON_RUNTIME_BASE_URL:`http://127.0.0.1:${port}`,
    PYTHON_RUNTIME_QUALIFICATION_SCENARIO:"immediate",PYTHON_RUNTIME_STARTUP_TIMEOUT_MS:"15000",
    COMFYUI_AUTO_INSTALL:"0",HF_HUB_OFFLINE:"1",TRANSFORMERS_OFFLINE:"1",HF_DATASETS_OFFLINE:"1",PIP_NO_INDEX:"1",PIP_REQUIRE_HASHES:"1",PYTHONNOUSERSITE:"1",
    HF_HUB_CACHE:cache,HF_HOME:path.join(cache,"hf-home"),TRANSFORMERS_CACHE:path.join(cache,"transformers"),HF_DATASETS_CACHE:path.join(cache,"datasets"),TORCH_HOME:path.join(cache,"torch"),
    OMP_NUM_THREADS:"1",MKL_NUM_THREADS:"1",SERVER_STORAGE_ROOT:layout.serverStorageRoot,SERVER_RUNTIME_ROOT:layout.serverRuntimeRoot,
    AI_SYSTEM_BUILDER_DEDICATED_ORGANIZATION_ID:"qualification.local"};
}
/** Data-only fixed plan. A declaration does not authorize a launch or qualify a run. */
export async function createSettingsHostLaunchPlan({repoRoot,runId,sourceRevision,target,environment}){
  settingsHostLayout(repoRoot,runId,sourceRevision);
  if(!["packaged-desktop","thin-chrome"].includes(target))throw invalid();
  const {createVisualComposerHostLaunchPlan}=await import("./visual-composer-host-lifecycle.mjs");
  const plan=createVisualComposerHostLaunchPlan({repoRoot,runId,environment:osEnvironment(environment),
    desktopExecutablePath:path.join(repoRoot,"out/ai-system-builder-win32-x64/ai-system-builder.exe"),electronNodeExecutablePath:path.join(repoRoot,"node_modules/electron/dist/electron.exe")});
  // Preserve only fixed lifecycle transport values, then add the isolated values.
  plan.desktop.env=createSettingsHostEnvironment(environment,repoRoot,runId,sourceRevision,"packaged-desktop");
  plan.desktop.seed.env={...plan.desktop.env,ELECTRON_RUN_AS_NODE:"1"};
  const transport=plan.server.env;
  plan.server.env={...createSettingsHostEnvironment(environment,repoRoot,runId,sourceRevision,"thin-chrome"),
    NODE_ENV:transport.NODE_ENV,PORT:transport.PORT,AI_SYSTEM_BUILDER_SECURITY_MODE:transport.AI_SYSTEM_BUILDER_SECURITY_MODE,
    AI_SYSTEM_BUILDER_HTTPS_ENABLED:transport.AI_SYSTEM_BUILDER_HTTPS_ENABLED,AI_SYSTEM_BUILDER_DEV_SECURITY_TOGGLE_ENABLED:transport.AI_SYSTEM_BUILDER_DEV_SECURITY_TOGGLE_ENABLED,
    AI_SYSTEM_BUILDER_TENANT_PLACEMENT_MODE:transport.AI_SYSTEM_BUILDER_TENANT_PLACEMENT_MODE};
  plan.server.args[plan.server.args.length-1]=path.join(repoRoot,"dev-tools/scripts/qualification/visual-composer/settings-host-server-entry.ts");
  return plan;
}
