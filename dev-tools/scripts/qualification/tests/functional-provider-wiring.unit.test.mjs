import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import path from "node:path";
import {spawnSync} from "node:child_process";
import {createRequire} from "node:module";
import {createFunctionalHostEnvironment} from "../visual-composer/functional-host-launch-plan.mjs";
const V=path.resolve("dev-tools/scripts/qualification/visual-composer"),read=name=>readFile(path.join(V,name),"utf8");
test("private host cases require dedicated explicit inputs and preserve the actual closed loader and retirement path",async()=>{
  const setup=await read("functional-host-global-setup.mjs"),entry=await read("e2e/private-publication-host-journey.ts"),desktop=await read("e2e/packaged-desktop-operational-ui.e2e.spec.ts"),thin=await read("e2e/thin-client-operational-ui.e2e.spec.ts");
  assert.match(setup,/await import\("tsx\/esm\/api"\)/);assert.match(setup,/tsImport\("\.\/functional-private-provider-fixture\.ts",import\.meta\.url\)/);assert.match(setup,/Private provider cases require their dedicated host profile/);
  assert.ok(setup.indexOf('process.env.VISUAL_COMPOSER_FUNCTIONAL_HOST!=="1"')<setup.indexOf('const helper=await loadFunctionalPrivateProviderFixture()'));
  assert.ok(setup.indexOf('await providerCapsule.observePrivateRepository()')<setup.indexOf('const identity=prepareThinClientQualificationIdentity'));
  assert.match(setup,/providerCredential\.bindConsumer\(child\)/);assert.match(setup,/stopAck=await observer\.stop\(\)/);assert.match(setup,/providerCredential\.retireServerAfterStop\(stopAck\)/);
  assert.ok(entry.indexOf('requested!=="1"')<entry.indexOf('openExecutingProviderFixture({'));assert.ok(entry.indexOf('await capsule.observePrivateRepository()')<entry.indexOf('prepareIsolatedDesktopCase(purpose'));
  assert.match(desktop,/credential\.markConsumerLaunch\(\)/);assert.match(desktop,/credential\.bindConsumer\(app\.process\(\)\)/);assert.match(desktop,/credential\.retireDesktopAfterStop\(\)/);assert.match(desktop,/else prepared\.credential\.retireBeforeLaunch\(\)/);
  assert.match(thin,/readProviderFixtureDeclaration\(/);assert.doesNotMatch(thin,/openExecutingProviderFixture\(/);
  for(const body of [setup,entry,desktop.slice(desktop.indexOf('async function runProviderDesktopCase')),thin.slice(thin.indexOf('import {qualifyProviderSourceHostJourney}'))])assert.doesNotMatch(body,/HF_TOKEN|HUGGING_FACE_TOKEN|\.getToken\(|\.setToken\(|token:\s*process\.env/);
});
test("provider registration and publication use real distinct controls, expected tasks and independent source observations",async()=>{
  const source=await read("e2e/provider-source-host-journey.ts"),publication=await read("e2e/private-publication-host-journey.ts");
  for(const text of ['name:"Hugging Face dataset"','name:"User or organization"','name:"Find datasets"','name:"Select datasets"','name:"View files from selected datasets"','name:file.path','All provider files are ready.','if(file.localize)','name:"Localize artifact"','mode:"backing"','mode:"bytes"','mode:"isolated"','"original-reference-retained"'])assert.ok(source.includes(text),text);
  assert.doesNotMatch(source,/name:"Select all|\.fulfill\(|\.route\(|setToken\(|sourceKind:\s*"repo"/);
  for(const text of ['await capsule.admitPublicationPath()','name:"Publish to Hugging Face"','name:"Create the repository if it does not exist"','creation.uncheck()','name:"New repository visibility"','name:"Publish",exact:true','name:"Published Backing"','capsule.observePublishedObject()','capturePrivatePublicationWitness','publicationRun:capsule.identity.runId'])assert.ok(publication.includes(text),text);
  assert.ok(publication.indexOf('await capsule.admitPublicationPath()')<publication.indexOf('getByRole("button",{name:"Publish",exact:true}).click()'));assert.doesNotMatch(publication,/\.fulfill\(|\.route\(|repositoryCreation:\s*\{|visibility:\s*"public"/);
});
test("dedicated case configs collect two Desktop bodies and one Thin body without capture or automatic retries",async()=>{
  for(const host of ["desktop","thin"]){const config=await readFile(path.resolve(`dev-tools/config/playwright.functional-provider-${host}.config.ts`),"utf8");assert.match(config,/workers:1,retries:0/);assert.match(config,/screenshot:"off",trace:"off",video:"off",acceptDownloads:false/);assert.match(config,/provider source registers an exact reference/);if(host==="desktop")assert.match(config,/private artifact publication records local branch and remote commit/);else assert.doesNotMatch(config,/private artifact publication/);}
  const reader=await read("e2e/artifact-host-browser-reads.ts");assert.match(reader,/mode==="backing"\?\["detail","content"\]/);assert.match(reader,/mode==="bytes"\?\["media"\]/);assert.match(reader,/detail\.sizeBytes!==media\.sizeBytes/);assert.doesNotMatch(reader,/token\.json|hugging-face-token\.json/);
});
test("actual Playwright discovery selects exactly the intended three bodies without executing setup",()=>{
  const require=createRequire(import.meta.url),cli=require.resolve("@playwright/test/cli");
  const env=createFunctionalHostEnvironment(process.env,process.cwd(),"provider-discovery-unit-run-0001",`source.${"a".repeat(64)}`,"packaged-desktop");env.VISUAL_COMPOSER_FUNCTIONAL_HOST="0";
  for(const [host,count] of [["desktop",2],["thin",1]]){
    const config=`dev-tools/config/playwright.functional-provider-${host}.config.ts`,result=spawnSync(process.execPath,[cli,"test","--config",config,"--list","--reporter=list"],{cwd:process.cwd(),env,windowsHide:true,timeout:30_000,maxBuffer:65536,encoding:"utf8"});
    assert.equal(result.status,0);assert.equal(result.stderr,"");assert.match(result.stdout,new RegExp(`Total: ${count} test${count===1?"":"s"} in 1 file`));assert.match(result.stdout,/provider source registers an exact reference/);if(host==="desktop")assert.match(result.stdout,/private artifact publication records local branch and remote commit/);else assert.doesNotMatch(result.stdout,/private artifact publication/);
  }
});
