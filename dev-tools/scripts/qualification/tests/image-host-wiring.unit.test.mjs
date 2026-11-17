import test from "node:test";
import assert from "node:assert/strict";
import {readFile,mkdtemp,lstat,realpath,rm} from "node:fs/promises";
import path from "node:path";
import imageHostSetup from "../visual-composer/image-host-global-setup.mjs";
import {prepareThinClientQualificationIdentity} from "../visual-composer/visual-composer-global-setup.mjs";
import {createImageHostLaunchPlan} from "../visual-composer/image-host-launch-plan.mjs";
const root=path.resolve("."),run="image-wiring-synthetic-20261029";
test("only the trusted image purpose adds the two required image scopes; defaults and authority stay limited",async()=>{
  const parent=await realpath(path.join(root,".local-codex/t")),folder=await mkdtemp(path.join(parent,"image-credentials-"));
  try{
    const original=["artifact:read","artifact:write","asset:read","asset:write","model:read","model:write","workspace:read","workspace:write"];
    for(const purpose of [undefined,"standard","image-generation"]){
      const plan={runId:run,paths:{thinStorageRoot:path.join(folder,purpose??"default")},server:{env:{}}};
      const result=prepareThinClientQualificationIdentity(plan,purpose),raw=await readFile(result.credentialPath,"utf8"),records=JSON.parse(raw).records;
      assert.equal(records.length,1);assert.deepEqual(records[0].scopes,purpose==="image-generation"?["image-generation:read","image-generation:write",...original]:original);
      assert.equal(raw.includes(result.bearerToken),false);assert.equal(records[0].tokenHashAlgorithm,"sha256");
      assert.equal(records[0].scopes.some(scope=>/admin|credential/.test(scope)),false);
    }
    for(const purpose of ["all",null,{},["image-generation"],"image-generation:write"])assert.throws(()=>prepareThinClientQualificationIdentity(new Proxy({},{get(){throw new Error("Unexpected plan read.");}}),purpose),/Unsupported qualification credential purpose/);
  }finally{assert.equal(path.dirname(folder),parent);assert.equal(await realpath(folder),folder);assert.equal((await lstat(folder)).isSymbolicLink(),false);await rm(folder,{recursive:true});}
});
test("image setup stays dormant without its explicit opt-in and clears stale readiness",async()=>{
  const keys=["VISUAL_COMPOSER_IMAGE_HOST","VISUAL_COMPOSER_IMAGE_READY","VISUAL_COMPOSER_IMAGE_INSPECTION"],saved=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
  try{delete process.env.VISUAL_COMPOSER_IMAGE_HOST;process.env.VISUAL_COMPOSER_IMAGE_READY="1";process.env.VISUAL_COMPOSER_IMAGE_INSPECTION="stale";
    const teardown=await imageHostSetup({projects:[]});assert.equal(process.env.VISUAL_COMPOSER_IMAGE_READY,undefined);assert.equal(process.env.VISUAL_COMPOSER_IMAGE_INSPECTION,undefined);await teardown();
    process.env.VISUAL_COMPOSER_IMAGE_HOST="1";await assert.rejects(imageHostSetup({projects:[{name:"packaged-desktop"},{name:"thin-chrome"}]}),/exactly one/);
  }finally{for(const key of keys)if(saved[key]===undefined)delete process.env[key];else process.env[key]=saved[key];}
});
test("plan rejects ambient executable, Git and provider overrides and keeps fixed child wiring",async()=>{
  const plan=await createImageHostLaunchPlan({repoRoot:root,runId:run,target:"thin-chrome",environment:{VISUAL_COMPOSER_DESKTOP_EXECUTABLE:path.resolve(".local-codex/foreign.exe"),GIT_DIR:"foreign",GIT_WORK_TREE:"foreign",PYTHON_RUNTIME_QUALIFICATION_SCENARIO:"training-model-host",COMFYUI_AUTO_INSTALL:"1",COMFYUI_SKIP_PYTHON_SETUP:"1"}});
  assert.equal(plan.desktop.executablePath,path.join(root,"out/ai-system-builder-win32-x64/ai-system-builder.exe"));assert.equal(plan.server.env.GIT_DIR,undefined);assert.equal(plan.server.env.GIT_WORK_TREE,undefined);
  assert.equal(plan.server.env.COMFYUI_AUTO_INSTALL,"0");assert.equal(plan.server.env.COMFYUI_SKIP_PYTHON_SETUP,undefined);assert.equal(plan.server.env.PYTHON_RUNTIME_QUALIFICATION_SCENARIO,"immediate");
  assert.equal(plan.server.env.HF_HUB_CACHE,path.join(plan.paths.thinRuntimeRoot,"controlled-model-cache"));assert.match(plan.server.args.at(-1),/image-host-server-entry\.ts$/);
});
test("source definitions retain real image actions, managed admission and canonical persistence fencing",async()=>{
  const read=name=>readFile(path.join(root,"dev-tools/scripts/qualification/visual-composer",name),"utf8");
  const entry=await read("image-host-server-entry.ts"),fixture=await read("image-host-fixture.ts"),setup=await read("image-host-global-setup.mjs");
  assert.match(entry,/shutdownServerResources/);assert.match(entry,/shutdownBackgroundTasks:async/);assert.match(entry,/closePersistence:async/);assert.match(entry,/seedImageInputRecords/);
  assert.match(fixture,/requireManagedComfyUiInstall/);assert.match(fixture,/inspectImageHostInputBytes/);assert.match(fixture,/\["diff","--quiet","HEAD","--"\]/);assert.doesNotMatch(fixture,/\.ensureInstalled\(|\.repairInstall\(/);
  assert.match(setup,/observer\.stop\(\)/);assert.ok(setup.indexOf("await observer.stop()")<setup.indexOf("await lifecycle.stop()"));assert.match(setup,/stdio:\["pipe","pipe","pipe"\]/);
  const journey=await read("e2e/image-generation-host-journey.ts");assert.match(journey,/getByRole\("button", \{name:"Generate",exact:true\}\)/);assert.match(journey,/sessionStorage\.getItem/);assert.match(journey,/image\.evaluate\(readRenderedImageBytes\)/);assert.match(journey,/toEqual\(generated\)/);assert.doesNotMatch(journey,/\.route\(|sessionStorage\.setItem|sitecustomize/);
  for(const host of ["packaged-desktop","thin-client"]){const spec=await read(`e2e/${host}-operational-ui.e2e.spec.ts`);assert.match(spec,/\["create-register","task-recovery"\]/);assert.match(spec,/qualifyImageHostJourney/);}
});
