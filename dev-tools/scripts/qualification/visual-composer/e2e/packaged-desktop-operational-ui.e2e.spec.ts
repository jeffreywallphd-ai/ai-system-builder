import { expect, test } from "@playwright/test";
import { _electron as electron } from "playwright";
import { prepareIsolatedDesktopCase } from "./isolated-desktop-case";
import { closeDesktopAndQualifyOwnedWorkers } from "./desktop-task-cleanup";
import { qualifyOperationalUiJourney } from "./operational-ui-journey";
import { OPERATIONAL_HOST_TIMEOUT_MS } from "../operational-ui-oracles";

test.use({ screenshot: "off", trace: "off", video: "off" });
test("packaged desktop preserves operational runtime controls and shell recovery", async () => {
  test.setTimeout(OPERATIONAL_HOST_TIMEOUT_MS);
  const isolated = prepareIsolatedDesktopCase("operational");
  const app = await electron.launch({ executablePath: process.env.VISUAL_COMPOSER_DESKTOP_EXECUTABLE!, args: [`--user-data-dir=${isolated.dataRoot}`, "--disable-gpu"], env: { ...isolated.env, PYTHON_RUNTIME_QUALIFICATION_SCENARIO: "observed-download" }, timeout: 60_000 });
  try {
    const page = await app.firstWindow({ timeout: 60_000 });
    await expect(page.getByRole("heading", { name: "Create a Workspace", exact: true })).toBeVisible({ timeout: 60_000 });
    await page.getByRole("button", { name: "Create new workspace", exact: true }).click();
    await page.locator('input[name="workspaceName"]').fill("Operational desktop fixture");
    await page.getByRole("button", { name: "Create workspace", exact: true }).click();
    await expect(page.getByLabel("Select current workspace")).toHaveValue(/^workspace\./);
    await qualifyOperationalUiJourney(page, test.info(), "packaged-desktop");
  } finally { await closeDesktopAndQualifyOwnedWorkers(app, isolated.env.HF_HUB_CACHE, test.info()); }
});
