import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import path from "node:path";
const V=path.resolve("dev-tools/scripts/qualification/visual-composer");
test("local artifact drivers use actual task/preview/export/delete controls and preserve workspace tuples",async()=>{
  const body=await readFile(path.join(V,"e2e/artifact-lifecycle-host-journey.ts"),"utf8");
  for(const text of ['getByLabel("Choose one or more files"','All files are ready.','prior+1','name:"Download artifact"','createReadStream()','download.cancel()','name:"Cancel"','fill("delete")','fill("Delete")','mode:"gone"','mode:"isolated"','"second-workspace-retained"'])assert.ok(body.includes(text),text);
  assert.doesNotMatch(body,/\.fulfill\(|\.route\(|saveAs\(|otherKey\)\.not\.toBe\(key\)/);assert.ok(body.indexOf('step("cross-workspace-read-denied"')<body.indexOf('step("second-artifact-imported"'));
  assert.match(body,/name:"View Details",exact:true/);assert.match(body,/name:ARTIFACT_SAMPLE_NAME,exact:true,level:4/);assert.match(body,/name:"Artifact Browser",exact:true/);assert.match(body,/host==="packaged-desktop"&&await detail\(\)\.count\(\)/);assert.match(body,/expect\(selectedKey\(\)\)\.toHaveCount\(0\)/);
  assert.ok(body.includes('else await expect(detail().getByRole("region",{name:"Artifact preview",exact:true})).toHaveCount(0)'));
  const desktop=await readFile(path.join(V,"e2e/packaged-desktop-operational-ui.e2e.spec.ts"),"utf8"),functional=desktop.slice(desktop.indexOf('test("packaged desktop model reference searches'));
  assert.match(functional,/electron\.launch\(\{acceptDownloads:false/);assert.equal((functional.match(/acceptDownloads:true/g)??[]).length,1);assert.match(functional,/functional-artifact-local/);
  for(const host of ["desktop","thin"]){const config=await readFile(path.resolve(`dev-tools/config/playwright.functional-artifact-${host}.config.ts`),"utf8");assert.match(config,/workers:1,retries:0/);assert.match(config,/artifact/);assert.match(config,/screenshot:"off",trace:"off",video:"off"/);assert.match(config,/acceptDownloads:false/);}
});
test("the token-denial case uses a separate read identity, never a nonexistent Thin Publish control or injected403",async()=>{
  const body=await readFile(path.join(V,"e2e/artifact-host-browser-reads.ts"),"utf8"),setup=await readFile(path.join(V,"functional-host-global-setup.mjs"),"utf8");
  assert.match(body,/mode===\"readonly-control\"/);assert.match(body,/statuses\.deny!==403/);assert.match(body,/security\.forbidden/);assert.match(body,/permission:"artifact:write"/);assert.match(body,/\/api\/artifact\/publish/);assert.doesNotMatch(body,/fulfill\(|repositoryCreation|hf_|provider-credential:use/);
  assert.match(setup,/prepareFunctionalArtifactReadIdentity\(plan,identity,source\)/);assert.match(setup,/VISUAL_COMPOSER_FUNCTIONAL_LOCAL_ARTIFACT/);assert.match(setup,/delete process\.env\.VISUAL_COMPOSER_FUNCTIONAL_ARTIFACT_READ_BEARER/);
  const identity=await readFile(path.join(V,"functional-artifact-read-identity.mjs"),"utf8");assert.match(identity,/scopes:\["artifact:read","workspace:read"\]/);assert.match(identity,/timingSafeEqual/);assert.match(identity,/flag:"wx"/);assert.doesNotMatch(identity,/getToken\(|setToken\(|HF_TOKEN|HUGGING_FACE_TOKEN/);
});
