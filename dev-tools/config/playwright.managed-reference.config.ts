import path from "node:path";
import { defineConfig, devices } from "@playwright/test";
const root = path.resolve(__dirname, "../..");
const assetsRestart = process.env.VISUAL_COMPOSER_MANAGED_ASSETS_RESTART === "1";
export default defineConfig({
  globalSetup: assetsRestart ? undefined : path.join(root, "dev-tools/scripts/qualification/visual-composer/managed-reference-global-setup.mjs"),
  testDir: path.join(root, "dev-tools/scripts/qualification/visual-composer/e2e"),
  testMatch: assetsRestart ? "managed-reference-asset-experience.e2e.spec.ts" : process.env.PYTHON_RUNTIME_QUALIFICATION_SCENARIO==="worker-failure-download" ? "managed-reference-owned-failure.e2e.spec.ts" : "managed-reference*.e2e.spec.ts",
  testIgnore: process.env.PYTHON_RUNTIME_QUALIFICATION_SCENARIO==="worker-failure-download" ? [] : ["managed-reference-owned-failure.e2e.spec.ts"],
  grep: assetsRestart ? /managed thin client builds, customizes, reviews, publishes and reopens real assets$/ : undefined,
  outputDir: path.join(root, "artifacts/qualification/visual-composer/managed-playwright"),
  workers: 1, fullyParallel: false, retries: 0, timeout: 150000,
  expect: {timeout: 10000},
  reporter: [["list"], [path.join(root, "dev-tools/scripts/qualification/visual-composer/sanitized-qualification-reporter.mjs")]],
  projects: [{name: "managed-thin-chrome", use: {...devices["Desktop Chrome"], channel: "chrome", trace: "off", screenshot: "only-on-failure", video: "off"}}],
});
