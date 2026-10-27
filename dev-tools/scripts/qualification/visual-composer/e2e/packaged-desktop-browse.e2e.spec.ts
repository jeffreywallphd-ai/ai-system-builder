import { expect, test } from "@playwright/test";
import { _electron as electron } from "playwright";
import { completeBrowseAuthoringJourney } from "./browse-authoring-journey";
import { prepareIsolatedDesktopCase } from "./isolated-desktop-case";
import { completeAssetAuthoringJourney, readDesktopPublishedDefinition } from "./asset-authoring-journey";
import { AUTHORING_PHASE_BUDGET_MS } from "../asset-authoring-oracles";

test("packaged desktop preserves the complete browse authoring journey", async () => {
  // Existing startup/browse150s plus five bounded Assets60s phases; one host at a time.
  test.setTimeout(150_000 + AUTHORING_PHASE_BUDGET_MS);
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
    await page.setViewportSize({width: 1440, height: 1000});
    await page.getByRole("button", {name: "Assets", exact: true}).click();
    await expect(page.getByRole("heading", {name: "Assets", exact: true})).toBeVisible();
    await completeAssetAuthoringJourney(page, "packaged-desktop", {kind: "document-reload", reload: async () => {
      await page.reload(); await page.getByRole("button", {name: "Assets", exact: true}).click();
    }}, async input => page.evaluate(readDesktopPublishedDefinition, input), test.info());
  } finally {await app.close();}
});
