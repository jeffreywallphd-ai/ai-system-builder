import path from "node:path";
import { defineConfig, devices } from "@playwright/test";
const root = path.resolve(__dirname, "../..");
export default defineConfig({
  globalSetup: path.join(root, "dev-tools/scripts/qualification/visual-composer/managed-reference-global-setup.mjs"),
  testDir: path.join(root, "dev-tools/scripts/qualification/visual-composer/e2e"),
  testMatch: process.env.PYTHON_RUNTIME_QUALIFICATION_SCENARIO==="worker-failure-download" ? "managed-reference-owned-failure.e2e.spec.ts" : "managed-reference*.e2e.spec.ts",
  testIgnore: process.env.PYTHON_RUNTIME_QUALIFICATION_SCENARIO==="worker-failure-download" ? [] : ["managed-reference-owned-failure.e2e.spec.ts"],
  outputDir: path.join(root, "artifacts/qualification/visual-composer/managed-playwright"),
  workers: 1, fullyParallel: false, retries: 0, timeout: 150000,
  expect: {timeout: 10000},
  reporter: [["list"], [path.join(root, "dev-tools/scripts/qualification/visual-composer/sanitized-qualification-reporter.mjs")]],
  projects: [{name: "managed-thin-chrome", use: {...devices["Desktop Chrome"], channel: "chrome", trace: "off", screenshot: "only-on-failure", video: "off"}}],
});
