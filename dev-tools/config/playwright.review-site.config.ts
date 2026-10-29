import path from "node:path";
import { defineConfig } from "@playwright/test";
import baseline from "./playwright.visual-composer.config";

// Exact feature selection: importing the baseline does not run its app setup.
export default defineConfig({
  ...baseline,
  globalSetup: undefined,
  testMatch: "thin-client-operational-ui.e2e.spec.ts",
  grep: /review site real browser (?:opens canonical details and linked work without changing qualification|refreshes a controlled current copy and recovers from connection refusal|keeps theme, keyboard and narrow review usable when storage refuses access)$/,
  outputDir: path.resolve(__dirname, "../../artifacts/qualification/review-site-browser"),
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 90_000,
  projects: [{ name: "thin-chrome", use: { browserName: "chromium", channel: "chrome", serviceWorkers: "block", acceptDownloads: false, trace: "off", screenshot: "off", video: "off", storageState: { cookies: [], origins: [] }, extraHTTPHeaders: {} } }],
});
