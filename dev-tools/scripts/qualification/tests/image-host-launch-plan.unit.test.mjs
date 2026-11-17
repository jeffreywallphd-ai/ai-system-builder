import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import {imageHostLayout,imageCheckpointName,createImageHostEnvironment,createImageCaseEnvironment,captureImageInspection,createImageHostLaunchPlan} from "../visual-composer/image-host-launch-plan.mjs";
import {resolveVisualComposerQualificationPaths} from "../visual-composer/visual-composer-qualification-core.mjs";
const root=process.cwd(),run="image-host-qualified-run-20261029",source="source."+"a".repeat(64);
const facts=()=>({schemaVersion:"image-host-local-inputs-v1",status:"input-identity-verified",runId:run,sourceRevision:source,checkpointFileName:"image-input.safetensors",checkpointSha256:"b".repeat(64),checkpointBytes:1024,comfyCommitSha:"c".repeat(40),managedSourceConfirmed:true,runtimeDependenciesQualified:false,hostLaunched:false,modelAccuracyExecuted:false});
test("image layout matches the existing host run and canonical Server install root",()=>{
  const layout=imageHostLayout(root,run),prior=resolveVisualComposerQualificationPaths(root,run);
  assert.equal(layout.serverRuntimeRoot,prior.thinRuntimeRoot);assert.equal(layout.desktopDataRoot,prior.desktopDataRoot);
  assert.equal(layout.providerRoot,path.join(prior.thinRuntimeRoot,"runtime-installs/comfyui"));assert.equal(layout.runRoot,prior.runRoot);
  for(const bad of ["../outside","",root+path.sep+"..",null])assert.throws(()=>imageHostLayout(bad,run));
  for(const bad of ["../outside","short","x".repeat(81),false])assert.throws(()=>imageHostLayout(root,bad));
});
test("only bounded nondevice safe-weight basenames are accepted",()=>{
  assert.equal(imageCheckpointName("image-input.fp16.safetensors"),true);
  for(const name of ["../input.safetensors","C:\\private.safetensors","CON.safetensors","aux.safetensors","LPT9.foo.safetensors","file.bin","x".repeat(121)+".safetensors",false,{}])assert.equal(imageCheckpointName(name),false);
});
test("environment captures values once, strips private/ambient controls, and retains guarded startup",()=>{
  const base={Path:"known-path",SystemRoot:"known-system",HF_TOKEN:"private-fixture",API_KEY:"private-fixture",PYTHONPATH:"private-fixture",COMFYUI_AUTO_INSTALL:"1",COMFYUI_SKIP_PYTHON_SETUP:"1",NODE_OPTIONS:"private-fixture",ELECTRON_RUN_AS_NODE:"1",VISUAL_COMPOSER_IMAGE_READY:"1",HTTP_PROXY:"private-fixture"};
  for(const host of ["packaged-desktop","thin-chrome"]){
    const env=createImageHostEnvironment(base,root,run,host);
    assert.equal(env.Path,"known-path");assert.equal(env.COMFYUI_AUTO_INSTALL,"0");assert.equal(env.COMFYUI_PYTHON_ENVIRONMENT_MODE,"managed-venv");
    assert.equal(env.COMFYUI_SKIP_PYTHON_SETUP,undefined);assert.equal(env.VISUAL_COMPOSER_IMAGE_READY,undefined);
    assert.equal(env.ELECTRON_RUN_AS_NODE,undefined);
    assert(!Object.values(env).includes("private-fixture"));assert.equal(env.HF_HUB_OFFLINE,"1");assert.equal(env.PIP_NO_INDEX,"1");
    assert.equal(env.PYTHON_RUNTIME_COMMAND,process.execPath);assert.equal(env.COMFYUI_BASE_URL,"http://127.0.0.1:8188");
  }
  const detached=createImageHostEnvironment(base,root,run,"packaged-desktop");base.Path="changed";assert.equal(detached.Path,"known-path");
});
test("environment proxies/getters/unsafe keys never execute",()=>{
  let effects=0;
  for(const env of [new Proxy({},{ownKeys(){effects++;throw 0;}}),Object.defineProperty({},"Path",{get(){effects++;throw 0;}}),{"bad-key":"x"},{Path:3}])assert.throws(()=>createImageHostEnvironment(env,root,run,"packaged-desktop"));
  assert.equal(effects,0);assert.throws(()=>createImageHostEnvironment({},root,run,"unknown"));
});
test("inspection is detached source-bound data and never grants runtime/model qualification",()=>{
  const value=facts(),captured=captureImageInspection(JSON.stringify(value),run,source);value.checkpointFileName="changed.safetensors";
  assert(Object.isFrozen(captured));assert.equal(captured.checkpointFileName,"image-input.safetensors");assert.equal(captured.runtimeDependenciesQualified,false);
  for(const extra of [{runId:"image-host-another-run-20261029"},{sourceRevision:"source."+"d".repeat(64)},{checkpointFileName:"CON.safetensors"},{checkpointBytes:4*1024**3+1},{comfyCommitSha:"main"},{checkpointSha256:["b".repeat(64)]},{comfyCommitSha:["c".repeat(40)]},{runtimeDependenciesQualified:true},{hostLaunched:true},{modelAccuracyExecuted:true},{extra:true}])assert.throws(()=>captureImageInspection(JSON.stringify({...facts(),...extra}),run,source));
  for(const bad of [null,{},"{","[]"," ".repeat(4097)])assert.throws(()=>captureImageInspection(bad,run,source));
});
test("Desktop cases isolate small caches while sharing only the verified managed input",()=>{
  const env={VISUAL_COMPOSER_QUALIFICATION_SOURCE_REVISION:source};
  const a=createImageCaseEnvironment(env,root,run,"packaged-desktop","create-register",facts()),b=createImageCaseEnvironment(env,root,run,"packaged-desktop","task-recovery",facts());
  assert.notEqual(a.VISUAL_COMPOSER_DESKTOP_DATA_ROOT,b.VISUAL_COMPOSER_DESKTOP_DATA_ROOT);assert.notEqual(a.HF_HUB_CACHE,b.HF_HUB_CACHE);
  assert.equal(a.COMFYUI_INSTALL_ROOT,b.COMFYUI_INSTALL_ROOT);assert.equal(a.COMFYUI_INSTALL_REF,facts().comfyCommitSha);
  assert.equal(a.TEMP,path.join(a.VISUAL_COMPOSER_DESKTOP_DATA_ROOT,"image-temp"));
  for(const name of ["unknown","../outside"])assert.throws(()=>createImageCaseEnvironment({},root,run,"packaged-desktop",name,facts()));
  assert.throws(()=>createImageCaseEnvironment({},root,run,"thin-chrome","create-register",facts()));
  let effects=0;
  for(const candidate of [new Proxy(facts(),{ownKeys(){effects++;throw 0;}}),Object.defineProperty(facts(),"sourceRevision",{get(){effects++;throw 0;}}),{...facts(),checkpointSha256:{toJSON(){effects++;throw 0;}}}])assert.throws(()=>createImageCaseEnvironment(env,root,run,"packaged-desktop","create-register",candidate));
  assert.equal(effects,0);assert.throws(()=>createImageCaseEnvironment({},root,run,"packaged-desktop","create-register",facts()));
});
test("trusted plan selects the dedicated entry without launching or installing",async()=>{
  const plan=await createImageHostLaunchPlan({repoRoot:root,runId:run,target:"thin-chrome",environment:{Path:"known-path"}});
  assert.equal(plan.server.args.at(-1),path.join(root,"dev-tools/scripts/qualification/visual-composer/image-host-server-entry.ts"));
  assert.equal(plan.server.env.COMFYUI_AUTO_INSTALL,"0");assert.equal(plan.desktop.env.COMFYUI_AUTO_INSTALL,"0");
  assert.equal(plan.desktop.seed.env.ELECTRON_RUN_AS_NODE,"1");assert.equal(plan.server.env.SERVER_RUNTIME_ROOT,imageHostLayout(root,run).serverRuntimeRoot);
});
