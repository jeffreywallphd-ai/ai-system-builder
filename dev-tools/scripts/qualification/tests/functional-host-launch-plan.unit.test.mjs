import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import {mkdtemp,readFile,rm,realpath,lstat,rmdir,unlink,writeFile} from "node:fs/promises";
import {resolveConfig} from "vite";
import {createFunctionalHostEnvironment,createFunctionalHostLaunchPlan,functionalHostLayout} from "../visual-composer/functional-host-launch-plan.mjs";
import {createSettingsHostLaunchPlan} from "../visual-composer/settings-host-launch-plan.mjs";
import functionalHostSetup from "../visual-composer/functional-host-global-setup.mjs";
import {prepareThinClientQualificationIdentity} from "../visual-composer/visual-composer-global-setup.mjs";
const root=process.cwd(),run="functional-model-fixture-20261029",source="source."+"a".repeat(64);
test("functional cases reuse closed environments but own an exact distinct case and every cache",()=>{
  const input={PATH:process.env.PATH,HF_TOKEN:"synthetic-private",HUGGING_FACE_TOKEN:"synthetic-private",AI_SYSTEM_BUILDER_PROVIDER_CREDENTIAL_MIGRATION_ORGANIZATION_ID:"foreign",NODE_OPTIONS:"foreign",HTTPS_PROXY:"foreign",DATABASE_URL:"foreign",VISUAL_COMPOSER_DESKTOP_DATA_ROOT:"foreign"};
  const env=createFunctionalHostEnvironment(input,root,run,source,"packaged-desktop","model-reference"),layout=functionalHostLayout(root,run,source);
  assert.equal(env.VISUAL_COMPOSER_DESKTOP_DATA_ROOT,path.join(layout.desktopDataRoot,"functional-model-reference"));
  for(const key of ["HF_HUB_CACHE","HF_HOME","TRANSFORMERS_CACHE","HF_DATASETS_CACHE","TORCH_HOME"])assert.equal(path.relative(env.VISUAL_COMPOSER_DESKTOP_DATA_ROOT,env[key]).startsWith(".."),false);
  for(const key of ["HF_TOKEN","HUGGING_FACE_TOKEN","AI_SYSTEM_BUILDER_PROVIDER_CREDENTIAL_MIGRATION_ORGANIZATION_ID","NODE_OPTIONS","HTTPS_PROXY","DATABASE_URL"])assert.equal(env[key],undefined);
  assert.equal(env.PYTHON_RUNTIME_COMMAND,process.execPath);assert.equal(env.COMFYUI_AUTO_INSTALL,"0");assert.equal(env.HF_HUB_OFFLINE,"1");
  for(const value of [null,"",{},"../model-reference","settings-public-values"])assert.throws(()=>createFunctionalHostEnvironment({},root,run,source,"packaged-desktop",value));
  assert.throws(()=>createFunctionalHostEnvironment({},root,run,source,"thin-chrome","model-reference"));
});
test("functional plans use their truthful Server entry without changing reviewed transport/defaults",async()=>{
  const plan=await createFunctionalHostLaunchPlan({repoRoot:root,runId:run,sourceRevision:source,target:"thin-chrome",environment:{HF_TOKEN:"synthetic-private"}});
  assert.match(plan.server.args.at(-1),/functional-host-server-entry\.ts$/);assert.equal(plan.server.env.HF_TOKEN,undefined);
  assert.equal(plan.server.env.SERVER_STORAGE_ROOT,plan.paths.thinStorageRoot);assert.equal(plan.server.env.SERVER_RUNTIME_ROOT,plan.paths.thinRuntimeRoot);assert.equal(plan.server.env.AI_SYSTEM_BUILDER_TENANT_PLACEMENT_MODE,"dedicated");
  assert.equal(plan.desktop.seed.env.ELECTRON_RUN_AS_NODE,"1");assert.equal(plan.desktop.env.HF_HUB_OFFLINE,"1");
});
test("the two thin test plans ignore operator dotenv and use a run-owned cache in Vite resolution",async()=>{
  const input={repoRoot:root,runId:run,sourceRevision:source,target:"thin-chrome",environment:{VITE_QUALIFICATION_DOTENV_PROBE:"ambient"}};
  const [settings,functional]=await Promise.all([createSettingsHostLaunchPlan(input),createFunctionalHostLaunchPlan(input)]);
  const selected=plan=>{const slot=plan.thinClient.args.indexOf("--config");return slot<0?path.join(plan.thinClient.cwd,"vite.config.ts"):plan.thinClient.args[slot+1];};
  const parent=path.join(await realpath(root),".local-codex","t");
  assert.equal(await realpath(parent),parent,"The dotenv fixture needs the physical repository temp directory.");
  const fixture=await mkdtemp(path.join(parent,"qualification-dotenv-"));
  const owned=await lstat(fixture,{bigint:true});
  const dotEnv=path.join(fixture,".env");
  let written;
  const keys=["NODE_ENV","VITE_QUALIFICATION_DOTENV_PROBE","VISUAL_COMPOSER_QUALIFICATION_RUN_ID","VISUAL_COMPOSER_QUALIFICATION_SOURCE_REVISION",
    "AI_SYSTEM_BUILDER_SECURITY_MODE","AI_SYSTEM_BUILDER_HTTPS_ENABLED","AI_SYSTEM_BUILDER_THIN_CLIENT_HTTPS_ENABLED","AI_SYSTEM_BUILDER_THIN_CLIENT_API_PROXY_TARGET"];
  const previous=keys.map(key=>process.env[key]);
  try{
    assert(owned.isDirectory()&&!owned.isSymbolicLink()&&owned.ino!==0n);
    await writeFile(dotEnv,"VITE_QUALIFICATION_DOTENV_PROBE=synthetic-operator-input\n",{flag:"wx"});
    written=await lstat(dotEnv,{bigint:true});
    keys.forEach(key=>{delete process.env[key];});
    Object.assign(process.env,{NODE_ENV:"development",VISUAL_COMPOSER_QUALIFICATION_RUN_ID:run,VISUAL_COMPOSER_QUALIFICATION_SOURCE_REVISION:source,
      AI_SYSTEM_BUILDER_THIN_CLIENT_HTTPS_ENABLED:"false",AI_SYSTEM_BUILDER_HTTPS_ENABLED:"false",AI_SYSTEM_BUILDER_THIN_CLIENT_API_PROXY_TARGET:settings.serverOrigin.origin});
    assert.equal(selected(settings),selected(functional));
    assert.equal(functional.thinClient.env.VITE_QUALIFICATION_DOTENV_PROBE,undefined);
    const options={root:functional.thinClient.cwd,configFile:selected(functional),configLoader:"runner",envDir:fixture,logLevel:"silent"};
    const config=await resolveConfig(options,"serve","development");
    assert.equal(config.env.VITE_QUALIFICATION_DOTENV_PROBE,undefined);
    assert.equal(config.envDir,false);
    assert.equal(path.normalize(config.cacheDir),path.join(functional.paths.thinRuntimeRoot,"vite-cache"));
    assert.equal(config.server.host,"127.0.0.1");
    assert.equal(config.server.proxy["/api"].target,functional.serverOrigin.origin);
    assert.equal(functional.thinClient.env.VISUAL_COMPOSER_QUALIFICATION_RUN_ID,run);
    assert.equal(functional.thinClient.env.VISUAL_COMPOSER_QUALIFICATION_SOURCE_REVISION,source);
    process.env.AI_SYSTEM_BUILDER_THIN_CLIENT_API_PROXY_TARGET="http://example.invalid:43170";
    await assert.rejects(resolveConfig(options,"serve","development"),/fixed source and loopback API proxy/);
  }finally{
    keys.forEach((key,index)=>{if(previous[index]===undefined)delete process.env[key];else process.env[key]=previous[index];});
    const current=await lstat(fixture,{bigint:true});
    assert.equal(path.dirname(fixture),parent);assert.equal(await realpath(fixture),fixture);
    assert(current.isDirectory()&&!current.isSymbolicLink()&&current.dev===owned.dev&&current.ino===owned.ino&&owned.ino!==0n);
    if(written){
      const currentFile=await lstat(dotEnv,{bigint:true});
      assert(currentFile.isFile()&&!currentFile.isSymbolicLink()&&currentFile.dev===written.dev&&currentFile.ino===written.ino&&written.ino!==0n);
      await unlink(dotEnv);
    }
    await rmdir(fixture);
  }
});
test("the functional managed identity adds only credential use and never secret management/create/admin",async()=>{
  const parent=await realpath(path.join(root,".local-codex/t")),folder=await mkdtemp(path.join(parent,"functional-auth-"));
  try{
    const plan={runId:run,paths:{thinStorageRoot:folder},server:{env:{}}},credential=prepareThinClientQualificationIdentity(plan,"functional-data"),raw=await readFile(credential.credentialPath,"utf8"),records=JSON.parse(raw).records;
    assert.deepEqual(records[0].scopes,["provider-credential:use","artifact:read","artifact:write","asset:read","asset:write","model:read","model:write","workspace:read","workspace:write"]);
    assert.equal(raw.includes(credential.bearerToken),false);assert.equal(records[0].scopes.some(s=>/settings:|provider-repository:|provider-credential:(read|write)|admin/.test(s)),false);
  }finally{assert.equal(path.dirname(folder),parent);assert.equal(await realpath(folder),folder);assert.equal((await lstat(folder)).isSymbolicLink(),false);await rm(folder,{recursive:true});}
});
test("setup clears stale readiness and remains dormant unless both fixed opt-ins exist",async()=>{
  const keys=["VISUAL_COMPOSER_FUNCTIONAL_HOST","VISUAL_COMPOSER_FUNCTIONAL_METADATA","VISUAL_COMPOSER_FUNCTIONAL_READY"],old=keys.map(k=>process.env[k]);
  try{
    for(const pair of [[undefined,undefined],["1",undefined],[undefined,"1"]]){
      keys.slice(0,2).forEach((k,i)=>pair[i]===undefined?delete process.env[k]:process.env[k]=pair[i]);process.env.VISUAL_COMPOSER_FUNCTIONAL_READY="1";
      await(await functionalHostSetup({projects:[]}))();assert.equal(process.env.VISUAL_COMPOSER_FUNCTIONAL_READY,undefined);
    }
  }finally{keys.forEach((k,i)=>old[i]===undefined?delete process.env[k]:process.env[k]=old[i]);}
});
