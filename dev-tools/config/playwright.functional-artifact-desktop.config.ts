import path from "node:path";
import {defineConfig,devices} from "@playwright/test";
const root=path.resolve(__dirname,"../..");
export default defineConfig({
  globalSetup:path.join(root,"dev-tools/scripts/qualification/visual-composer/functional-host-global-setup.mjs"),
  testDir:path.join(root,"dev-tools/scripts/qualification/visual-composer/e2e"),testMatch:"packaged-desktop-operational-ui.e2e.spec.ts",
  grep:/packaged desktop artifact local lifecycle preserves actual bytes and scope$/,
  outputDir:path.join(root,"artifacts/qualification/visual-composer/functional-artifact-desktop-playwright"),fullyParallel:false,workers:1,retries:0,timeout:180_000,
  expect:{timeout:8_000},use:{actionTimeout:8_000,navigationTimeout:15_000,screenshot:"off",trace:"off",video:"off",acceptDownloads:false},
  reporter:[["list"],[path.join(root,"dev-tools/scripts/qualification/visual-composer/sanitized-qualification-reporter.mjs")]],projects:[{name:"packaged-desktop"}],
});
