import path from "node:path";
import {fileURLToPath} from "node:url";
import {spawn,spawnSync} from "node:child_process";
import {rmSync} from "node:fs";
import {createImageHostLaunchPlan,captureImageInspection} from "./image-host-launch-plan.mjs";
import {createVisualComposerQualificationRunId} from "./visual-composer-qualification-core.mjs";
import {startVisualComposerHostLifecycle} from "./visual-composer-host-lifecycle.mjs";
import {buildPackagedDesktopFromCurrentWorktree,preparePackagedDesktopQualificationIdentity,prepareThinClientQualificationIdentity} from "./visual-composer-global-setup.mjs";
import {resolveVisualComposerQualificationEnvironment} from "./visual-composer-qualification-environment.mjs";
import {observeImageHostShutdown} from "./image-host-shutdown.mjs";
import {readAssetSystemSourceIdentity,assertAssetSystemSourceIdentity} from "../asset-system-source-identity.mjs";

/** Dedicated opt-in. Missing verified inputs never trigger a build or app launch. */
export default async function imageHostSetup(config){
  delete process.env.VISUAL_COMPOSER_IMAGE_READY;delete process.env.VISUAL_COMPOSER_IMAGE_INSPECTION;
  if(process.env.VISUAL_COMPOSER_IMAGE_HOST!=="1"||process.platform!=="win32")return async()=>{};
  const target=config.projects[0]?.name;
  if(config.projects.length!==1||!["packaged-desktop","thin-chrome"].includes(target))throw new Error("Image qualification needs exactly one fixed host.");
  const repoRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../../../.."),runId=process.env.VISUAL_COMPOSER_QUALIFICATION_RUN_ID??createVisualComposerQualificationRunId();
  const source=await readAssetSystemSourceIdentity(repoRoot);
  const plan=await createImageHostLaunchPlan({repoRoot,runId,target,environment:{...process.env,VISUAL_COMPOSER_QUALIFICATION_SOURCE_REVISION:source}});
  const result=spawnSync(process.execPath,["--import","tsx",path.join(repoRoot,"dev-tools/scripts/qualification/visual-composer/image-host-fixture.ts"),"--inspect-inputs"],
    {cwd:repoRoot,env:plan.server.env,windowsHide:true,encoding:"utf8",timeout:120_000,maxBuffer:8192});
  await assertAssetSystemSourceIdentity(repoRoot,source);
  let facts;try{if(!result.error&&result.status===0)facts=captureImageInspection(result.stdout.trim(),runId,source);}catch{/* Fixed pending result below. */}
  if(!facts){process.stdout.write("Image host qualification is pending: approved local managed inputs are unavailable. No installation, build or app launch was attempted.\n");return async()=>assertAssetSystemSourceIdentity(repoRoot,source);}
  for(const env of [plan.server.env,plan.desktop.env,plan.desktop.seed.env])Object.assign(env,{COMFYUI_INSTALL_REF:facts.comfyCommitSha,COMFYUI_DEFAULT_CHECKPOINT:facts.checkpointFileName});
  Object.assign(process.env,resolveVisualComposerQualificationEnvironment(plan,source));
  process.env.VISUAL_COMPOSER_IMAGE_INSPECTION=JSON.stringify(facts);
  if(target==="packaged-desktop"){
    buildPackagedDesktopFromCurrentWorktree(plan);preparePackagedDesktopQualificationIdentity(plan);
    process.env.VISUAL_COMPOSER_IMAGE_READY="1";
    return async()=>{delete process.env.VISUAL_COMPOSER_IMAGE_READY;await assertAssetSystemSourceIdentity(repoRoot,source);};
  }
  const identity=prepareThinClientQualificationIdentity(plan,"image-generation");let observer,lifecycle;
  const failures=[];
  async function teardown(){
    delete process.env.VISUAL_COMPOSER_IMAGE_READY;
    if(observer)try{await observer.stop();}catch(error){failures.push(error);}
    if(lifecycle)try{await lifecycle.stop();}catch(error){failures.push(error);}
    try{rmSync(identity.credentialPath);delete process.env.VISUAL_COMPOSER_THIN_CLIENT_BEARER_TOKEN;}catch(error){failures.push(error);}
    try{await assertAssetSystemSourceIdentity(repoRoot,source);}catch(error){failures.push(error);}
    if(failures.length)throw new AggregateError(failures,"Image host setup or owned shutdown remains unqualified.");
  }
  try{
    lifecycle=await startVisualComposerHostLifecycle({launchPlan:plan,spawnProcess:(command,args,options)=>{
      const server=command===plan.server.command&&JSON.stringify(args)===JSON.stringify(plan.server.args);
      const child=spawn(command,args,server?{...options,stdio:["pipe","pipe","pipe"]}:options);
      if(server){if(observer)throw new Error("Only one owned image Server is allowed.");observer=observeImageHostShutdown(child,runId,source);}return child;
    }});
    process.env.VISUAL_COMPOSER_THIN_CLIENT_ORIGIN=lifecycle.thinClientOrigin.origin;
    process.env.VISUAL_COMPOSER_SERVER_ORIGIN=lifecycle.serverOrigin.origin;
    process.env.VISUAL_COMPOSER_THIN_CLIENT_BEARER_TOKEN=identity.bearerToken;
    process.env.VISUAL_COMPOSER_IMAGE_READY="1";
  }catch(error){failures.push(error);await teardown();}
  return teardown;
}
