import { expect, test } from "@playwright/test";
import { _electron as electron } from "playwright";
import { prepareIsolatedDesktopCase } from "./isolated-desktop-case";
import { closeDesktopAndQualifyOwnedWorkers } from "./desktop-task-cleanup";
import { qualifyLowMemoryDatasetJourney, uploadLowMemorySource } from "./low-memory-dataset-journey";

test("packaged desktop retains optional profile through resource denial, cancellation observation and approved dataset persistence", async () => {
  test.setTimeout(180000);
  const isolated = prepareIsolatedDesktopCase("dataset");
  const app = await electron.launch({ executablePath: process.env.VISUAL_COMPOSER_DESKTOP_EXECUTABLE!, args: [`--user-data-dir=${isolated.dataRoot}`, "--disable-gpu"], env: { ...isolated.env, PYTHON_RUNTIME_QUALIFICATION_SCENARIO: "dataset-profile" }, timeout: 60000 });
  try {
    const page = await app.firstWindow({ timeout: 60000 });
    await expect(page.getByRole("heading", { name: "Create a Workspace", exact: true })).toBeVisible({ timeout: 60000 });
    await page.getByRole("button", { name: "Create new workspace", exact: true }).click();
    await page.locator('input[name="workspaceName"]').fill("Low memory desktop fixture");
    await page.getByRole("button", { name: "Create workspace", exact: true }).click();
    await expect(page.getByLabel("Select current workspace")).toHaveValue(/^workspace\./);
    await page.getByRole("button", { name: "Data", exact: true }).click();
    await uploadLowMemorySource(page);
    await page.getByRole("tab", { name: "Dataset Preparation", exact: true }).click();
    await page.locator('footer[aria-label="Python runtime controls"]').getByRole("button", { name: "Start", exact: true }).click();
    await expect(page.locator('footer[aria-label="Python runtime controls"]')).toContainText("dataset-preparation.offload-v1", { timeout: 30000 });
    await qualifyLowMemoryDatasetJourney(page, test.info(), "desktop");
  } finally { await closeDesktopAndQualifyOwnedWorkers(app, isolated.env.HF_HUB_CACHE, test.info()); }
});
