import { expect, test } from "@playwright/test";
import { _electron as electron } from "playwright";
import { prepareIsolatedDesktopCase } from "./isolated-desktop-case";
import { closeDesktopAndQualifyOwnedWorkers } from "./desktop-task-cleanup";
import { qualifyOperationalUiJourney } from "./operational-ui-journey";
import { OPERATIONAL_HOST_TIMEOUT_MS } from "../operational-ui-oracles";
import { applyOwnedDesktopNativeZoom } from "./native-desktop-zoom";
import { readCriticalAccessibilityMode, type CriticalAccessibilityMode } from "../technical-accessibility-observation";

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
