import { expect, test } from "@playwright/test";
import { _electron as electron } from "playwright";
import { prepareIsolatedDesktopCase } from "./isolated-desktop-case";
import { closeDesktopAndQualifyOwnedWorkers } from "./desktop-task-cleanup";
import { qualifyOperationalUiJourney } from "./operational-ui-journey";
import { OPERATIONAL_HOST_TIMEOUT_MS } from "../operational-ui-oracles";
import { applyOwnedDesktopNativeZoom } from "./native-desktop-zoom";
import { readCriticalAccessibilityMode, type CriticalAccessibilityMode } from "../technical-accessibility-observation";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { createTrainingCaseEnvironment } from "../training-host-launch-plan.mjs";
import { captureTrainingHostFixture, TRAINING_HOST_TIMEOUT_MS } from "../model-training-oracles";
import { qualifyDesktopTrainingJourney } from "./model-training-journey";
import { runOwnedRestartPhase } from "../asset-authoring-oracles";

test.use({ screenshot: "off", trace: "off", video: "off" });
async function runOperationalDesktop(mode: CriticalAccessibilityMode = "standard") {
  readCriticalAccessibilityMode(mode);
  if (test.info().project.name !== "packaged-desktop") throw new Error("Unsupported operational desktop host.");
  const isolated = prepareIsolatedDesktopCase(mode === "native400" ? "operational-native400" : "operational");
  const app = await electron.launch({ executablePath: process.env.VISUAL_COMPOSER_DESKTOP_EXECUTABLE!, args: [`--user-data-dir=${isolated.dataRoot}`, "--disable-gpu"], env: { ...isolated.env, PYTHON_RUNTIME_QUALIFICATION_SCENARIO: "observed-download" }, timeout: 60_000 });
  try {
    const page = await app.firstWindow({ timeout: 60_000 });
    await expect(page.getByRole("heading", { name: "Create a Workspace", exact: true })).toBeVisible({ timeout: 60_000 });
    await page.getByRole("button", { name: "Create new workspace", exact: true }).click();
    await page.locator('input[name="workspaceName"]').fill("Operational desktop fixture");
    await page.getByRole("button", { name: "Create workspace", exact: true }).click();
    await expect(page.getByLabel("Select current workspace")).toHaveValue(/^workspace\./);
    if (mode === "native400") {
      const factor = await applyOwnedDesktopNativeZoom(app, page);
      await test.info().attach("native-desktop-zoom-setup", {body:JSON.stringify({schemaVersion:"native-desktop-zoom-setup-v1",factor}),contentType:"application/json"});
    }
    await qualifyOperationalUiJourney(page, test.info(), "packaged-desktop", mode);
  } finally { await closeDesktopAndQualifyOwnedWorkers(app, isolated.env.HF_HUB_CACHE, test.info()); }
}

test("packaged desktop preserves operational runtime controls and shell recovery", async () => {
  test.setTimeout(OPERATIONAL_HOST_TIMEOUT_MS);
  await runOperationalDesktop();
});

test("packaged desktop preserves operational controls at native 400 percent zoom", async () => {
  test.setTimeout(OPERATIONAL_HOST_TIMEOUT_MS);
  await runOperationalDesktop("native400");
});

test("packaged desktop trains one local adapter, reviews privately, saves and reopens it", async () => {
  test.setTimeout(TRAINING_HOST_TIMEOUT_MS);
  test.skip(process.env.VISUAL_COMPOSER_TRAINING_READY !== "1" || process.env.PYTHON_RUNTIME_QUALIFICATION_SCENARIO !== "training-model-host", "Pending the dedicated offline training profile and its real local prerequisite checks.");
  if (test.info().project.name !== "packaged-desktop") throw new Error("Training requires its fixed Desktop project.");
  const isolated = prepareIsolatedDesktopCase("training");
  const env = createTrainingCaseEnvironment(isolated.env, process.cwd(), isolated.dataRoot, process.env.VISUAL_COMPOSER_TRAINING_MODEL_ACQUISITION);
  // Seed before the app opens SQLite; no live database edits or fake results.
  // The seed creates its private temporary directories, so do not use the new
  // temporary root until that seed has completed.
  const seed = spawnSync(process.env.VISUAL_COMPOSER_ELECTRON_NODE_EXECUTABLE!, ["--preserve-symlinks", "--preserve-symlinks-main", "--import", "tsx", path.resolve("dev-tools/scripts/qualification/visual-composer/training-host-fixture.ts"), "--seed-inputs"], {
    cwd: process.cwd(), env: { ...env, TEMP: process.env.TEMP, TMP: process.env.TMP, ELECTRON_RUN_AS_NODE: "1" }, encoding: "utf8", windowsHide: true, timeout: 120_000, maxBuffer: 8192,
  });
  const fixture = seed.status === 0 && !seed.error ? captureTrainingHostFixture(seed.stdout.trim(), process.env.VISUAL_COMPOSER_QUALIFICATION_RUN_ID, process.env.VISUAL_COMPOSER_QUALIFICATION_SOURCE_REVISION) : undefined;
  if (!fixture) throw new Error("Training qualification input seed is unavailable.");
  env.VISUAL_COMPOSER_TRAINING_FIXTURE = JSON.stringify(fixture);
  const app = await electron.launch({ executablePath: process.env.VISUAL_COMPOSER_DESKTOP_EXECUTABLE!, args: [`--user-data-dir=${isolated.dataRoot}`, "--disable-gpu"], env, timeout: 60_000 });
  await runOwnedRestartPhase(async () => {
    const page = await app.firstWindow({ timeout: 60_000 });
    await qualifyDesktopTrainingJourney(page, test.info(), JSON.stringify(fixture));
  }, () => closeDesktopAndQualifyOwnedWorkers(app, env.HF_HUB_CACHE, test.info()));
});
