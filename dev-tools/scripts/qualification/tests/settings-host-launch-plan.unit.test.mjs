import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import {mkdtemp,readFile,realpath,lstat,rm} from "node:fs/promises";
import {createSettingsHostEnvironment,createSettingsHostLaunchPlan,settingsHostLayout} from "../visual-composer/settings-host-launch-plan.mjs";
import settingsHostSetup from "../visual-composer/settings-host-global-setup.mjs";
import {prepareThinClientQualificationIdentity} from "../visual-composer/visual-composer-global-setup.mjs";
const root=path.resolve("."),run="settings-profile-synthetic-20261029",source="source."+"a".repeat(64);
test("Settings environments isolate both hosts and discard provider, migration, runtime and command overrides",()=>{
  for(const target of ["packaged-desktop","thin-chrome"]){
    const env=createSettingsHostEnvironment({Path:"synthetic-path",SystemRoot:"synthetic-os",HF_TOKEN:"synthetic-private-token",HUGGING_FACE_TOKEN:"synthetic-other-token",
      AI_SYSTEM_BUILDER_PROVIDER_CREDENTIAL_MIGRATION_ORGANIZATION_ID:"foreign-org",SERVER_STORAGE_ROOT:"foreign-root",NODE_OPTIONS:"foreign-option",PYTHON_RUNTIME_COMMAND:"foreign-command",COMFYUI_AUTO_INSTALL:"1",DATABASE_URL:"foreign-database",HTTPS_PROXY:"foreign-proxy"},root,run,source,target);
    const layout=settingsHostLayout(root,run,source);
    assert.equal(env.Path,"synthetic-path");assert.equal(env.SystemRoot,"synthetic-os");
    assert.equal(env.HF_TOKEN,undefined);assert.equal(env.HUGGING_FACE_TOKEN,undefined);assert.equal(env.AI_SYSTEM_BUILDER_PROVIDER_CREDENTIAL_MIGRATION_ORGANIZATION_ID,undefined);
    assert.equal(env.NODE_OPTIONS,undefined);assert.equal(env.DATABASE_URL,undefined);assert.equal(env.HTTPS_PROXY,undefined);
    assert.equal(env.SERVER_STORAGE_ROOT,layout.serverStorageRoot);assert.equal(env.SERVER_RUNTIME_ROOT,layout.serverRuntimeRoot);
    assert.equal(env.PYTHON_RUNTIME_COMMAND,process.execPath);assert.equal(env.PYTHON_RUNTIME_QUALIFICATION_SCENARIO,"immediate");assert.equal(env.COMFYUI_AUTO_INSTALL,"0");
    assert.equal(env.HF_HUB_OFFLINE,"1");assert.equal(env.TRANSFORMERS_OFFLINE,"1");assert.equal(env.PIP_NO_INDEX,"1");assert.equal(env.AI_SYSTEM_BUILDER_DEDICATED_ORGANIZATION_ID,"qualification.local");
    assert.doesNotMatch(JSON.stringify(env),/synthetic-private|foreign-/);
  }
});
test("fixed case roots are distinct and do not inherit ambient profile selection",()=>{
  const values=["public-values","secret-defaults"].map(s=>createSettingsHostEnvironment({VISUAL_COMPOSER_DESKTOP_DATA_ROOT:"foreign-root"},root,run,source,"packaged-desktop",s));
  assert.notEqual(values[0].VISUAL_COMPOSER_DESKTOP_DATA_ROOT,values[1].VISUAL_COMPOSER_DESKTOP_DATA_ROOT);
  for(let i=0;i<2;i++){assert.equal(values[i].HF_HUB_CACHE,path.join(values[i].VISUAL_COMPOSER_DESKTOP_DATA_ROOT,"controlled-model-cache"));assert.equal(values[i].ELECTRON_RUN_AS_NODE,undefined);}
  for(const target of ["thin-chrome","unknown"])assert.throws(()=>createSettingsHostEnvironment({},root,run,source,target,"public-values"));
  for(const value of ["../escape","",null,{},"public-values/child"])assert.throws(()=>createSettingsHostEnvironment({},root,run,source,"packaged-desktop",value));
});
test("malformed identity, proxies, getters, oversized OS values and foreign paths fail before a launch",()=>{
  for(const args of [["relative",run,source],[root,"../run",source],[root,run,"worktree"]])assert.throws(()=>settingsHostLayout(...args));
  let reads=0;const env={};Object.defineProperty(env,"HF_TOKEN",{get(){reads++;throw new Error("synthetic-private-getter");}});
  assert.throws(()=>createSettingsHostEnvironment(env,root,run,source,"packaged-desktop"));assert.equal(reads,0);
  assert.throws(()=>createSettingsHostEnvironment(new Proxy({},{ownKeys(){reads++;return [];}}),root,run,source,"packaged-desktop"));assert.equal(reads,0);
  for(const value of ["x".repeat(32769),"x\0y",1])assert.throws(()=>createSettingsHostEnvironment({PATH:value},root,run,source,"packaged-desktop"));
});
test("the Settings launch plan retains fixed canonical transport and source binding without credential inheritance",async()=>{
  const plan=await createSettingsHostLaunchPlan({repoRoot:root,runId:run,sourceRevision:source,target:"thin-chrome",environment:{HF_TOKEN:"synthetic-private",VISUAL_COMPOSER_DESKTOP_EXECUTABLE:"foreign.exe"}});
  const layout=settingsHostLayout(root,run,source);
  assert.equal(plan.desktop.executablePath,path.join(root,"out/ai-system-builder-win32-x64/ai-system-builder.exe"));
  assert.equal(plan.server.env.SERVER_STORAGE_ROOT,plan.paths.thinStorageRoot);assert.equal(plan.paths.desktopDataRoot,layout.desktopDataRoot);
  assert.equal(plan.server.env.SERVER_RUNTIME_ROOT,plan.paths.thinRuntimeRoot);assert.equal(plan.server.env.PORT,"43170");assert.equal(plan.server.env.AI_SYSTEM_BUILDER_TENANT_PLACEMENT_MODE,"dedicated");
  assert.match(plan.server.args.at(-1),/settings-host-server-entry\.ts$/);assert.equal(plan.desktop.seed.env.ELECTRON_RUN_AS_NODE,"1");
  for(const env of [plan.server.env,plan.desktop.env,plan.desktop.seed.env,plan.thinClient.env])assert.equal(env.HF_TOKEN,undefined);
});
test("only the fixed Settings purpose adds Settings and credential management, never credential use or runtime administration",async()=>{
  const parent=await realpath(path.join(root,".local-codex/t")),folder=await mkdtemp(path.join(parent,"settings-auth-"));
  try{
    const standard=["artifact:read","artifact:write","asset:read","asset:write","model:read","model:write","workspace:read","workspace:write"];
    for(const purpose of ["standard","image-generation","settings"]){
      const plan={runId:run,paths:{thinStorageRoot:path.join(folder,purpose)},server:{env:{}}};
      const credential=prepareThinClientQualificationIdentity(plan,purpose),raw=await readFile(credential.credentialPath,"utf8"),records=JSON.parse(raw).records;
      const added=purpose==="settings"?["settings:read","settings:write","provider-credential:read","provider-credential:write"]:purpose==="image-generation"?["image-generation:read","image-generation:write"]:[];
      assert.equal(records.length,1);assert.deepEqual(records[0].scopes,[...added,...standard]);assert.equal(raw.includes(credential.bearerToken),false);
      assert.equal(records[0].scopes.some(scope=>/admin|:use$/.test(scope)),false);
    }
    for(const purpose of ["all",null,{},["settings"],"settings:write","__proto__"])assert.throws(()=>prepareThinClientQualificationIdentity(new Proxy({},{get(){throw new Error("Unexpected plan read.");}}),purpose),/Unsupported qualification credential purpose/);
  }finally{assert.equal(path.dirname(folder),parent);assert.equal(await realpath(folder),folder);assert.equal((await lstat(folder)).isSymbolicLink(),false);await rm(folder,{recursive:true});}
});
test("Settings setup is dormant without explicit opt-in and clears stale readiness",async()=>{
  const keys=["VISUAL_COMPOSER_SETTINGS_HOST","VISUAL_COMPOSER_SETTINGS_READY"],old=keys.map(key=>process.env[key]);
  try{delete process.env.VISUAL_COMPOSER_SETTINGS_HOST;process.env.VISUAL_COMPOSER_SETTINGS_READY="1";await(await settingsHostSetup({projects:[]}))();assert.equal(process.env.VISUAL_COMPOSER_SETTINGS_READY,undefined);
    process.env.VISUAL_COMPOSER_SETTINGS_HOST="1";await assert.rejects(settingsHostSetup({projects:[{name:"packaged-desktop"},{name:"thin-chrome"}]}),/exactly one/);
  }finally{for(let i=0;i<keys.length;i++)if(old[i]===undefined)delete process.env[keys[i]];else process.env[keys[i]]=old[i];}
});
