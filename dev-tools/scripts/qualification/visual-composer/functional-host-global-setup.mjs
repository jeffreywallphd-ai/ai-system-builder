import path from "node:path";
import {fileURLToPath} from "node:url";
import {spawn} from "node:child_process";
import {types} from "node:util";
import {lstat,realpath,rm} from "node:fs/promises";
import {createFunctionalHostLaunchPlan,functionalHostLayout} from "./functional-host-launch-plan.mjs";
import {createVisualComposerQualificationRunId} from "./visual-composer-qualification-core.mjs";
import {startVisualComposerHostLifecycle} from "./visual-composer-host-lifecycle.mjs";
import {buildPackagedDesktopFromCurrentWorktree,preparePackagedDesktopQualificationIdentity,prepareThinClientQualificationIdentity} from "./visual-composer-global-setup.mjs";
import {resolveVisualComposerQualificationEnvironment} from "./visual-composer-qualification-environment.mjs";
import {prepareFunctionalArtifactReadIdentity} from "./functional-artifact-read-identity.mjs";
import {observeOwnedHostShutdown} from "./owned-host-shutdown.mjs";
import {readAssetSystemSourceIdentity,assertAssetSystemSourceIdentity} from "../asset-system-source-identity.mjs";
import {providerFixtureIdentity,providerFixtureReference} from "./functional-provider-plan.mjs";

const setupFailureObservations=new WeakMap();
export const FUNCTIONAL_HOST_SETUP_STAGES=Object.freeze([
  "admission","source-identity","fresh-roots","launch-plan","environment-projection",
  "desktop-package","desktop-identity","desktop-teardown","provider-admission",
  "provider-repository","primary-identity","provider-credential","artifact-read-identity",
  "host-startup","teardown",
]);
const unavailableSetupFailure=Object.freeze({schema_version:"functional-host-setup-failure-v1",
  stage:"unavailable",stage_available:false,error_type:"Unknown",raw_error_recorded:false,qualification_granted:false});
function setupErrorType(error){
  if(!types.isNativeError(error))return "Unknown";
  try{
    const prototype=Object.getPrototypeOf(error);
    for(const [constructor,name] of [[AggregateError,"AggregateError"],[TypeError,"TypeError"],
      [RangeError,"RangeError"],[ReferenceError,"ReferenceError"],[SyntaxError,"SyntaxError"],
      [EvalError,"EvalError"],[URIError,"URIError"]])if(prototype===constructor.prototype)return name;
    return "Error";
  }catch{return "Unknown";}
}
/** Trusted setup bookkeeping only. It performs no action and grants no authority. */
export function createFunctionalHostSetupFailureTracker(){
  let stage="admission";
  return Object.freeze({
    enter(value){
      if(typeof value!=="string"||!FUNCTIONAL_HOST_SETUP_STAGES.includes(value))throw new Error("The functional setup stage is invalid.");
      stage=value;
    },
    remember(error){
      if(error!==null&&(typeof error==="object"||typeof error==="function"))setupFailureObservations.set(error,
        Object.freeze({schema_version:"functional-host-setup-failure-v1",stage,stage_available:true,
          error_type:setupErrorType(error),raw_error_recorded:false,qualification_granted:false}));
      return error;
    },
  });
}
/** Read from the same module instance as setup. Never inspect an error's fields. */
export function readFunctionalHostSetupFailure(error){
  return error!==null&&(typeof error==="object"||typeof error==="function")
    ?setupFailureObservations.get(error)??unavailableSetupFailure:unavailableSetupFailure;
}

/** Explicit public loader API, exercised by an inert MJS proof without ambient hooks. */
export async function loadFunctionalPrivateProviderFixture(){
  const {tsImport}=await import("tsx/esm/api");
  return tsImport("./functional-private-provider-fixture.ts",import.meta.url);
}

/** Cooperative fresh-root check. This is not a native retained-tree capability. */
export async function assertFreshFunctionalHostRoots(repoRoot,runId,sourceRevision){
  const layout=functionalHostLayout(repoRoot,runId,sourceRevision);
  if(await realpath(repoRoot)!==repoRoot)throw new Error("Functional requires the physical repository root.");
  for(const leaf of [layout.dataRoot,path.dirname(layout.serverStorageRoot)]){
    const relative=path.relative(repoRoot,leaf);let current=repoRoot;
    for(const segment of relative.split(path.sep)){
      current=path.join(current,segment);
      const stat=await lstat(current).catch(error=>{if(error.code==="ENOENT")return undefined;throw error;});
      if(!stat)break;
      if(stat.isSymbolicLink()||!stat.isDirectory()||current===leaf)throw new Error("Functional requires a fresh isolated run. Existing files are retained.");
    }
  }
}

/** Dedicated source-bound opt-in; collection or a stale flag grants no launch. */
export default async function functionalHostSetup(config){
  const failureTracker=createFunctionalHostSetupFailureTracker();
  try{
  delete process.env.VISUAL_COMPOSER_FUNCTIONAL_READY;delete process.env.VISUAL_COMPOSER_FUNCTIONAL_ARTIFACT_READ_BEARER;
  const providerSource=process.env.VISUAL_COMPOSER_FUNCTIONAL_PROVIDER_SOURCE==="1",providerPublication=process.env.VISUAL_COMPOSER_FUNCTIONAL_PROVIDER_PUBLICATION==="1",providerRequested=providerSource||providerPublication;
  if(process.env.VISUAL_COMPOSER_FUNCTIONAL_HOST!=="1"||(process.env.VISUAL_COMPOSER_FUNCTIONAL_METADATA!=="1"&&process.env.VISUAL_COMPOSER_FUNCTIONAL_LOCAL_ARTIFACT!=="1"&&!providerRequested)||process.platform!=="win32")return async()=>{};
  const target=config.projects[0]?.name;
  if(config.projects.length!==1||!["packaged-desktop","thin-chrome"].includes(target))throw new Error("Functional qualification needs exactly one fixed host.");
  if(providerRequested){
    if(process.env.VISUAL_COMPOSER_FUNCTIONAL_METADATA==="1"||process.env.VISUAL_COMPOSER_FUNCTIONAL_LOCAL_ARTIFACT==="1"||target==="thin-chrome"&&providerPublication)throw new Error("Private provider cases require their dedicated host profile.");
    providerFixtureReference(process.env.VISUAL_COMPOSER_FUNCTIONAL_PROVIDER_CONFIG);
  }
  const repoRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../../../.."),runId=process.env.VISUAL_COMPOSER_QUALIFICATION_RUN_ID??createVisualComposerQualificationRunId();
  failureTracker.enter("source-identity");
  const source=await readAssetSystemSourceIdentity(repoRoot);
  failureTracker.enter("fresh-roots");
  await assertFreshFunctionalHostRoots(repoRoot,runId,source);
  failureTracker.enter("launch-plan");
  const plan=await createFunctionalHostLaunchPlan({repoRoot,runId,sourceRevision:source,target,environment:process.env});
  failureTracker.enter("environment-projection");
  Object.assign(process.env,resolveVisualComposerQualificationEnvironment(plan,source));
  if(target==="packaged-desktop"){
    failureTracker.enter("desktop-package");buildPackagedDesktopFromCurrentWorktree(plan);
    failureTracker.enter("desktop-identity");preparePackagedDesktopQualificationIdentity(plan);
    process.env.VISUAL_COMPOSER_FUNCTIONAL_READY="1";
    return async()=>{failureTracker.enter("desktop-teardown");try{delete process.env.VISUAL_COMPOSER_FUNCTIONAL_READY;delete process.env.VISUAL_COMPOSER_FUNCTIONAL_ARTIFACT_READ_BEARER;await assertAssetSystemSourceIdentity(repoRoot,source);}catch(error){throw failureTracker.remember(error);}};
  }
  let providerCapsule,providerAdmission,providerCredential,providerLaunchAttempted=false;
  if(providerSource){
    failureTracker.enter("provider-admission");
    const helper=await loadFunctionalPrivateProviderFixture(),bound=providerFixtureIdentity(runId,source,target,"provider-source");
    providerAdmission=helper.beginProviderFixtureAdmission(repoRoot,bound);
    providerCapsule=helper.openExecutingProviderFixture({repoRoot,manifestRef:process.env.VISUAL_COMPOSER_FUNCTIONAL_PROVIDER_CONFIG,identity:bound,executing:true});
    failureTracker.enter("provider-repository");
    await providerCapsule.observePrivateRepository();
  }
  failureTracker.enter("primary-identity");
  const identity=prepareThinClientQualificationIdentity(plan,"functional-data");let observer,lifecycle;
  const failures=[];
  async function teardown(){
    const cleanupFailureTracker=createFunctionalHostSetupFailureTracker();cleanupFailureTracker.enter("teardown");
    delete process.env.VISUAL_COMPOSER_FUNCTIONAL_READY;delete process.env.VISUAL_COMPOSER_FUNCTIONAL_ARTIFACT_READ_BEARER;
    let stopAck;
    if(observer)try{stopAck=await observer.stop();}catch(error){failures.push(error);}
    if(lifecycle)try{await lifecycle.stop();}catch(error){failures.push(error);}
    if(providerCredential)try{if(providerLaunchAttempted)providerCredential.retireServerAfterStop(stopAck);else providerCredential.retireBeforeLaunch();}catch(error){failures.push(error);}
    try{await rm(identity.credentialPath);}catch(error){failures.push(error);}
    delete process.env.VISUAL_COMPOSER_THIN_CLIENT_BEARER_TOKEN;delete process.env.VISUAL_COMPOSER_FUNCTIONAL_ARTIFACT_READ_BEARER;
    try{await assertAssetSystemSourceIdentity(repoRoot,source);}catch(error){failures.push(error);}
    if(failures.length)throw cleanupFailureTracker.remember(new AggregateError(failures,"Functional host setup or owned shutdown remains unqualified."));
  }
  try{
    if(providerCapsule){failureTracker.enter("provider-credential");providerCredential=providerCapsule.seedCredential(providerAdmission);}
    if(process.env.VISUAL_COMPOSER_FUNCTIONAL_LOCAL_ARTIFACT==="1"){failureTracker.enter("artifact-read-identity");process.env.VISUAL_COMPOSER_FUNCTIONAL_ARTIFACT_READ_BEARER=prepareFunctionalArtifactReadIdentity(plan,identity,source).bearerToken;}
    failureTracker.enter("host-startup");
    lifecycle=await startVisualComposerHostLifecycle({launchPlan:plan,spawnProcess:(command,args,options)=>{
      const server=command===plan.server.command&&JSON.stringify(args)===JSON.stringify(plan.server.args);
      if(server&&providerCredential){providerLaunchAttempted=true;providerCredential.markConsumerLaunch();}
      const child=spawn(command,args,server?{...options,stdio:["pipe","pipe","pipe"]}:options);
      if(server&&providerCredential)providerCredential.bindConsumer(child);
      if(server){if(observer)throw new Error("Only one owned Functional Server is allowed.");observer=observeOwnedHostShutdown("functional-data",child,runId,source);}return child;
    }});
    process.env.VISUAL_COMPOSER_THIN_CLIENT_ORIGIN=lifecycle.thinClientOrigin.origin;
    process.env.VISUAL_COMPOSER_SERVER_ORIGIN=lifecycle.serverOrigin.origin;
    process.env.VISUAL_COMPOSER_THIN_CLIENT_BEARER_TOKEN=identity.bearerToken;
    process.env.VISUAL_COMPOSER_FUNCTIONAL_READY="1";
  }catch(error){failures.push(error);await teardown();}
  return teardown;
  }catch(error){throw failureTracker.remember(error);}
}
