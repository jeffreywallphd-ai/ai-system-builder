import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {assertFixedEnvironment, fixedRegularDigest} from './package-tree.mjs';

const ctx=await assertFixedEnvironment(); // No source-template launch authority.
const here=path.dirname(fileURLToPath(import.meta.url));
// Playwright reloads this module in workers without the parent CLI arguments.
// Keep configuration deterministic; global setup still admits one exact host.
assert.deepEqual(await fixedRegularDigest(ctx.chrome,16*1024**2),ctx.chromePin);
const {devices}=await import('@playwright/test');
export default {
  globalSetup:path.join(here,'global-setup.mjs'),testDir:path.join(ctx.candidate,'dev-tools/scripts/qualification/visual-composer/e2e'),
  testMatch:['**/thin-client-dataset-versions.e2e.spec.ts','**/packaged-desktop-dataset-versions.e2e.spec.ts'],
  fullyParallel:false,workers:1,retries:0,timeout:300000,globalTimeout:360000,
  expect:{timeout:8000},reporter:[[path.join(ctx.candidate,'dev-tools/scripts/qualification/visual-composer/sanitized-qualification-reporter.mjs')]],
  use:{actionTimeout:8000,navigationTimeout:15000,screenshot:'off',trace:'off',video:'off'},
  projects:[
    {name:'thin-chrome',outputDir:path.join(ctx.run,'ui-thin/playwright-output'),testMatch:'**/thin-client-dataset-versions.e2e.spec.ts',use:{...devices['Desktop Chrome'],channel:'chrome',launchOptions:{executablePath:ctx.chrome},screenshot:'off',trace:'off',video:'off'}},
    {name:'packaged-desktop',outputDir:path.join(ctx.run,'ui-desktop/playwright-output'),testMatch:'**/packaged-desktop-dataset-versions.e2e.spec.ts',use:{screenshot:'off',trace:'off',video:'off'}},
  ],
};
