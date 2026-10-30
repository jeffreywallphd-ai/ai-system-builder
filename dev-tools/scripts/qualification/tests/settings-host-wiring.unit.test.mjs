import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import path from "node:path";
const V=path.resolve("dev-tools/scripts/qualification/visual-composer");
test("Settings definitions bind the actual host UI and only inject one failed readonly response",async()=>{
  const body=await readFile(path.join(V,"e2e/settings-host-journey.ts"),"utf8");
  for(const value of ['name:"Save"','name:"Clear"','name:"Refresh settings"','await page.reload()','input[type=password]','toHaveText(configured?','await expectModel(builtin)','SETTINGS_PASSIVE_MODEL','r.request().method()==="POST"','failed-read-denies-write','page.unroute(readUrl,fault)'])assert.ok(body.includes(value),value);
  assert.match(body,/status:503/);assert.doesNotMatch(body,/status:200|status:201|\.request\.post|sessionStorage\.setItem|window\.api|sitecustomize/);
  assert.match(body,/name:"Save model default",exact:true/);assert.match(body,/toHaveValue\(workspaceId!?\)/);
  assert.match(body,/page\.route\(readUrl,fault\)/);assert.equal((body.match(/page\.route\(/g)??[]).length,1);
  for(const host of ["packaged-desktop","thin-client"]){const spec=await readFile(path.join(V,`e2e/${host}-operational-ui.e2e.spec.ts`),"utf8");assert.match(spec,/\["public-values","secret-defaults"\]/);assert.match(spec,/qualifySettingsHostJourney/);assert.match(spec,/VISUAL_COMPOSER_SETTINGS_READY/);}
});
test("dedicated one-worker selectors have exact two cases and no automatic model/runtime acquisition",async()=>{
  for(const host of ["desktop","thin"]){const text=await readFile(path.resolve(`dev-tools/config/playwright.settings-host-${host}.config.ts`),"utf8");
    assert.match(text,/workers:1,retries:0/);assert.match(text,/public-values\|secret-defaults/);assert.match(text,/settings-host-global-setup/);assert.match(text,/screenshot:"off",trace:"off",video:"off"/);}
});
test("actual known-child drain precedes forced fallback and canonical persistence closure remains fenced",async()=>{
  const setup=await readFile(path.join(V,"settings-host-global-setup.mjs"),"utf8"),entry=await readFile(path.join(V,"settings-host-server-entry.ts"),"utf8"),isolated=await readFile(path.join(V,"e2e/isolated-desktop-case.ts"),"utf8");
  assert.ok(setup.indexOf("await observer.stop()")<setup.indexOf("await lifecycle.stop()"));assert.match(setup,/observeOwnedHostShutdown\("settings",child,runId,source\)/);
  assert.match(setup,/prepareThinClientQualificationIdentity\(plan,"settings"\)/);assert.match(setup,/await assertFreshSettingsHostRoots/);assert.match(setup,/stdio:\["pipe","pipe","pipe"\]/);
  assert.match(entry,/shutdownServerResources/);assert.match(entry,/shutdownBackgroundTasks:async/);assert.match(entry,/closePersistence:async/);assert.match(entry,/forOrganization\(createOrganizationId\("qualification\.local"\)\)/);
  assert.doesNotMatch(entry,/\.ensureInstalled\(|\.repairInstall\(|setSecret\(|setToken\(/);assert.match(isolated,/createSettingsHostEnvironment\(process\.env/);assert.match(isolated,/env: \{ \.\.\.environment/);
});
