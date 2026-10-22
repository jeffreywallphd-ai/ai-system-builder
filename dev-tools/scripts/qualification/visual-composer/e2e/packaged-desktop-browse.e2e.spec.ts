import { expect, test } from "@playwright/test";
import { _electron as electron } from "playwright";
import { completeBrowseAuthoringJourney } from "./browse-authoring-journey";
import { prepareIsolatedDesktopCase } from "./isolated-desktop-case";

test("packaged desktop preserves the complete browse authoring journey", async () => {
  test.setTimeout(150_000);
  const isolated = prepareIsolatedDesktopCase("browse");
  const app = await electron.launch({executablePath: process.env.VISUAL_COMPOSER_DESKTOP_EXECUTABLE!, args: [`--user-data-dir=${isolated.dataRoot}`, "--disable-gpu"], env: isolated.env, timeout: 60_000});
  try {
    const page = await app.firstWindow({timeout: 60_000});
    await expect(page.getByRole("heading", {name: "Create a Workspace", exact: true})).toBeVisible({timeout: 60_000});
    await page.getByRole("button", {name: "Create new workspace"}).click();
    await page.locator('input[name="workspaceName"]').fill("Desktop browse fixture");
    await page.getByRole("button", {name: "Create workspace", exact: true}).click();
    await expect(page.getByLabel("Select current workspace")).toHaveValue(/^workspace\./, {timeout: 30_000});
    await page.getByRole("button", {name: "Systems", exact: true}).click();
    const result = await completeBrowseAuthoringJourney(page, "Desktop browse fixture", async () => {
      await page.reload(); await page.getByRole("button", {name: "Systems", exact: true}).click();
      await expect(page.getByRole("heading", {name: "Systems", exact: true})).toBeVisible();
    }, test.info());
    await test.info().attach("browse-journey", {body: JSON.stringify({...result, sourceRevision: process.env.VISUAL_COMPOSER_QUALIFICATION_SOURCE_REVISION, qualification: "local-packaged-fixture"}), contentType: "application/json"});
  } finally {await app.close();}
});
