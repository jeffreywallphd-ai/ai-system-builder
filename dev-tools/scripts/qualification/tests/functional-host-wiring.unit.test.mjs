import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import path from "node:path";
const V=path.resolve("dev-tools/scripts/qualification/visual-composer");
test("named host selectors and journeys use real mounted search, Save, details and workspace controls",async()=>{
  const body=await readFile(path.join(V,"e2e/model-reference-host-journey.ts"),"utf8"),common=await readFile(path.join(V,"e2e/functional-host-common.ts"),"utf8");
  for(const value of ['name:"Search Models"','name:"Browse models"','"Save":"Save reference"','name:"Details"','await page.reload()','"isolation-confirmed"','"original-workspace-confirmed"'])assert.ok(body.includes(value),value);
  assert.doesNotMatch(body,/\.route\(|\.fulfill\(|name:\s*"Download"|saveModelReference\(/);assert.match(common,/api\.listModels\(input\)/);assert.match(common,/fetch\("\/api\/model\/list"/);
  assert.match(common,/includeDiscovered:false,includeSharedStorage:false/);assert.match(common,/result\.nextCursor!==undefined/);assert.doesNotMatch(common,/localPath:m\.localPath|console\.|\.setToken\(/);
  for(const host of ["desktop","thin"]){const text=await readFile(path.resolve(`dev-tools/config/playwright.functional-host-${host}.config.ts`),"utf8");assert.match(text,/workers:1,retries:0/);assert.match(text,/model reference searches, saves and survives reload and workspace changes\$/);assert.match(text,/functional-host-global-setup/);assert.match(text,/screenshot:"off",trace:"off",video:"off"/);}
});
test("functional canonical composition drains owned children before persistence with a fixed separate purpose",async()=>{
  const setup=await readFile(path.join(V,"functional-host-global-setup.mjs"),"utf8"),entry=await readFile(path.join(V,"functional-host-server-entry.ts"),"utf8");
  assert.ok(setup.indexOf("await observer.stop()")<setup.indexOf("await lifecycle.stop()"));assert.match(setup,/observeOwnedHostShutdown\("functional-data",child,runId,source\)/);
  assert.match(setup,/prepareThinClientQualificationIdentity\(plan,"functional-data"\)/);assert.match(setup,/await assertFreshFunctionalHostRoots/);assert.match(setup,/VISUAL_COMPOSER_FUNCTIONAL_METADATA!=="1"/);
  assert.match(entry,/installOwnedHostShutdown\("functional-data"/);assert.match(entry,/shutdownServerResources/);assert.match(entry,/shutdownBackgroundTasks:async/);assert.match(entry,/closePersistence:async/);
  assert.doesNotMatch(entry,/\.ensureInstalled\(|\.repairInstall\(|setSecret\(|setToken\(/);
});
