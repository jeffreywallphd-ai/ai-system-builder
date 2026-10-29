import path from "node:path";
import { defineConfig } from "@playwright/test";
const root = path.resolve(__dirname, "../..");
export default defineConfig({
  globalSetup: path.join(root, "dev-tools/scripts/qualification/visual-composer/training-host-global-setup.mjs"),
  testDir: path.join(root, "dev-tools/scripts/qualification/visual-composer/e2e"),
  testMatch: "packaged-desktop-operational-ui.e2e.spec.ts",
  grep: /packaged desktop trains one local adapter, reviews privately, saves and reopens it$/,
  outputDir: path.join(root, "artifacts/qualification/visual-composer/training-playwright"),
  fullyParallel: false, workers: 1, retries: 0, timeout: 10 * 60_000,
  expect: { timeout: 8_000 },
  use: { actionTimeout: 8_000, navigationTimeout: 15_000, screenshot: "off", trace: "off", video: "off" },
  reporter: [["list"], [path.join(root, "dev-tools/scripts/qualification/visual-composer/sanitized-qualification-reporter.mjs")]],
  projects: [{ name: "packaged-desktop" }],
});
