import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import {mkdtemp,readFile,rm,realpath,lstat} from "node:fs/promises";
import {createFunctionalHostEnvironment,createFunctionalHostLaunchPlan,functionalHostLayout} from "../visual-composer/functional-host-launch-plan.mjs";
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
