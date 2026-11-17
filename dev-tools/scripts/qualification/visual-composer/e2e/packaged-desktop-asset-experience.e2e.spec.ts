import {expect, test} from "@playwright/test";
import {_electron as electron, type ElectronApplication} from "playwright";
import {completeAssetExperienceJourney, qualifyAssetSurfaces} from "./asset-experience-journey";
import {prepareIsolatedDesktopCase} from "./isolated-desktop-case";
import {applyOwnedDesktopNativeZoom} from "./native-desktop-zoom";
import {assetQualificationIdentity, assetApplicationLifetime, runAssetQualificationCase} from "../asset-experience-oracles";

process.env.PLAYWRIGHT_NO_COPY_PROMPT = "1";
test.use({trace: "off", screenshot: "off", video: "off"});
for (const zoom of [false, true]) test(`packaged desktop Assets ${zoom ? "native 400 percent zoom" : "meaningful authoring and persistence"}`, async () => {
  test.setTimeout(480000); const info = test.info();
  const identity = assetQualificationIdentity(process.env.VISUAL_COMPOSER_QUALIFICATION_SOURCE_REVISION, process.env.VISUAL_COMPOSER_QUALIFICATION_RUN_ID, info.project.name, zoom, info.title);
  const lifetime = assetApplicationLifetime<ElectronApplication>();
  await runAssetQualificationCase(async () => {
    const isolated = prepareIsolatedDesktopCase(zoom ? "assets-zoom" : "assets");
    const launch = () => electron.launch({executablePath: process.env.VISUAL_COMPOSER_DESKTOP_EXECUTABLE!, args: [`--user-data-dir=${isolated.dataRoot}`, "--disable-gpu"], env: isolated.env, timeout: 60000});
    let app = await lifetime.launch(launch), page = await app.firstWindow({timeout: 60000});
    await expect(page.getByRole("heading", {name: "Create a Workspace", exact: true})).toBeVisible({timeout: 60000});
    await page.getByRole("button", {name: "Create new workspace"}).click();
    await page.locator('input[name="workspaceName"]').fill(zoom ? "Assets desktop zoom" : "Assets desktop qualification");
    await page.getByRole("button", {name: "Create workspace", exact: true}).click();
    await expect(page.locator(".workspace-create-form")).toHaveCount(0);
    await expect(page.getByLabel("Select current workspace")).toHaveValue(/^workspace\./, {timeout: 30000});
    const workspaceId = await page.getByLabel("Select current workspace").inputValue();
    await page.getByRole("button", {name: "Assets", exact: true}).click();
    await expect(page.getByRole("heading", {name: "Assets", exact: true})).toBeVisible();
    await completeAssetExperienceJourney(page, async () => {
      const retiredPage = page;
      await lifetime.retire(); app = await lifetime.launch(launch);
      page = await app.firstWindow({timeout: 60000});
      if (page === retiredPage) throw new Error("Assets restart reused a retired page.");
      await expect(page.getByLabel("Select current workspace")).toHaveValue(workspaceId, {timeout: 30000});
      await page.getByRole("button", {name: "Assets", exact: true}).click();
      await expect(page.getByRole("heading", {name: "Assets", exact: true})).toBeVisible(); return page;
    }, info, identity);
    if (zoom) expect(await applyOwnedDesktopNativeZoom(app, page)).toBe(4);
    await qualifyAssetSurfaces(page, info, identity);
  }, () => lifetime.retire());
});
