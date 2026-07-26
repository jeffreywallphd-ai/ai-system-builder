import path from "node:path";

import { defineConfig, devices } from "@playwright/test";

const repoRoot = path.resolve(__dirname, "../..");

export default defineConfig({
  globalSetup: path.resolve(
    repoRoot,
    "dev-tools/scripts/qualification/visual-composer/visual-composer-global-setup.mjs",
  ),
  testDir: path.resolve(
    repoRoot,
    "dev-tools/scripts/qualification/visual-composer/e2e",
  ),
  testMatch: "**/*.e2e.spec.ts",
  outputDir: path.resolve(
    repoRoot,
    "artifacts/qualification/visual-composer/playwright",
  ),
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 8_000 },
  reporter: [
    ["list"],
    [
      path.resolve(
        repoRoot,
        "dev-tools/scripts/qualification/visual-composer/sanitized-qualification-reporter.mjs",
      ),
    ],
  ],
  use: {
    actionTimeout: 8_000,
    navigationTimeout: 15_000,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "off",
  },
  projects: [
    {
      name: "thin-chrome",
      testMatch: "**/thin-client*.e2e.spec.ts",
      use: {
        ...devices["Desktop Chrome"],
        channel: process.env.VISUAL_COMPOSER_CHROME_CHANNEL?.trim() || "chrome",
      },
    },
    {
      name: "packaged-desktop",
      testMatch: "**/packaged-desktop*.e2e.spec.ts",
    },
  ],
});
