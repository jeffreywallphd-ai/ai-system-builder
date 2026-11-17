import path from "node:path";
import {fileURLToPath} from "node:url";
import {spawn} from "node:child_process";
import {lstat,realpath,rm} from "node:fs/promises";
import {createSettingsHostLaunchPlan,settingsHostLayout} from "./settings-host-launch-plan.mjs";
import {createVisualComposerQualificationRunId} from "./visual-composer-qualification-core.mjs";
import {startVisualComposerHostLifecycle} from "./visual-composer-host-lifecycle.mjs";
import {buildPackagedDesktopFromCurrentWorktree,preparePackagedDesktopQualificationIdentity,prepareThinClientQualificationIdentity} from "./visual-composer-global-setup.mjs";
import {resolveVisualComposerQualificationEnvironment} from "./visual-composer-qualification-environment.mjs";
import {observeOwnedHostShutdown} from "./owned-host-shutdown.mjs";
import {readAssetSystemSourceIdentity,assertAssetSystemSourceIdentity} from "../asset-system-source-identity.mjs";

/** Cooperative fresh-root check. This is not a native retained-tree capability. */
export async function assertFreshSettingsHostRoots(repoRoot,runId,sourceRevision){
  const layout=settingsHostLayout(repoRoot,runId,sourceRevision);
  if(await realpath(repoRoot)!==repoRoot)throw new Error("Settings requires the physical repository root.");
  for(const leaf of [layout.dataRoot,path.dirname(layout.serverStorageRoot)]){
    const relative=path.relative(repoRoot,leaf);let current=repoRoot;
    for(const segment of relative.split(path.sep)){
      current=path.join(current,segment);
      const stat=await lstat(current).catch(error=>{if(error.code==="ENOENT")return undefined;throw error;});
      if(!stat)break;
      if(stat.isSymbolicLink()||!stat.isDirectory()||current===leaf)throw new Error("Settings requires a fresh isolated run. Existing files are retained.");
    }
  }
}

/** Dedicated source-bound opt-in; collection or a stale flag grants no launch. */
export default async function settingsHostSetup(config){
  delete process.env.VISUAL_COMPOSER_SETTINGS_READY;
  if(process.env.VISUAL_COMPOSER_SETTINGS_HOST!=="1"||process.platform!=="win32")return async()=>{};
  const target=config.projects[0]?.name;
  if(config.projects.length!==1||!["packaged-desktop","thin-chrome"].includes(target))throw new Error("Settings qualification needs exactly one fixed host.");
  const repoRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../../../.."),runId=process.env.VISUAL_COMPOSER_QUALIFICATION_RUN_ID??createVisualComposerQualificationRunId();
  const source=await readAssetSystemSourceIdentity(repoRoot);
  await assertFreshSettingsHostRoots(repoRoot,runId,source);
  const plan=await createSettingsHostLaunchPlan({repoRoot,runId,sourceRevision:source,target,environment:process.env});
  Object.assign(process.env,resolveVisualComposerQualificationEnvironment(plan,source));
  if(target==="packaged-desktop"){
    buildPackagedDesktopFromCurrentWorktree(plan);preparePackagedDesktopQualificationIdentity(plan);
    process.env.VISUAL_COMPOSER_SETTINGS_READY="1";
    return async()=>{delete process.env.VISUAL_COMPOSER_SETTINGS_READY;await assertAssetSystemSourceIdentity(repoRoot,source);};
  }
  const identity=prepareThinClientQualificationIdentity(plan,"settings");let observer,lifecycle;
  const failures=[];
  async function teardown(){
    delete process.env.VISUAL_COMPOSER_SETTINGS_READY;
    if(observer)try{await observer.stop();}catch(error){failures.push(error);}
    if(lifecycle)try{await lifecycle.stop();}catch(error){failures.push(error);}
    try{await rm(identity.credentialPath);delete process.env.VISUAL_COMPOSER_THIN_CLIENT_BEARER_TOKEN;}catch(error){failures.push(error);}
    try{await assertAssetSystemSourceIdentity(repoRoot,source);}catch(error){failures.push(error);}
    if(failures.length)throw new AggregateError(failures,"Settings host setup or owned shutdown remains unqualified.");
  }
  try{
    lifecycle=await startVisualComposerHostLifecycle({launchPlan:plan,spawnProcess:(command,args,options)=>{
      const server=command===plan.server.command&&JSON.stringify(args)===JSON.stringify(plan.server.args);
      const child=spawn(command,args,server?{...options,stdio:["pipe","pipe","pipe"]}:options);
      if(server){if(observer)throw new Error("Only one owned Settings Server is allowed.");observer=observeOwnedHostShutdown("settings",child,runId,source);}return child;
    }});
    process.env.VISUAL_COMPOSER_THIN_CLIENT_ORIGIN=lifecycle.thinClientOrigin.origin;
    process.env.VISUAL_COMPOSER_SERVER_ORIGIN=lifecycle.serverOrigin.origin;
    process.env.VISUAL_COMPOSER_THIN_CLIENT_BEARER_TOKEN=identity.bearerToken;
    process.env.VISUAL_COMPOSER_SETTINGS_READY="1";
  }catch(error){failures.push(error);await teardown();}
  return teardown;
}
