import {expect, test} from "@playwright/test";
import {completeAssetExperienceJourney, qualifyAssetSurfaces} from "./asset-experience-journey";
import {launchOwnedNativeZoomContext} from "../native-browser-zoom.mjs";
import {assetQualificationIdentity, runAssetQualificationCase, type AssetQualificationIdentity} from "../asset-experience-oracles";

process.env.PLAYWRIGHT_NO_COPY_PROMPT = "1";
test.use({trace: "off", screenshot: "off", video: "off"});
async function openAssets(page: import("@playwright/test").Page, identity: AssetQualificationIdentity) {
  page.setDefaultTimeout(10000); page.setDefaultNavigationTimeout(30000);
  await page.addInitScript(token => localStorage.setItem("ai-system-builder.paired-device-token", token), process.env.VISUAL_COMPOSER_THIN_CLIENT_BEARER_TOKEN!);
  await page.goto(new URL("/", process.env.VISUAL_COMPOSER_THIN_CLIENT_ORIGIN!).href);
  const selected = page.getByLabel("Select current workspace"); await expect(selected).toBeVisible();
  const previous = await selected.inputValue();
  await page.getByRole("button", {name: "Create new workspace", exact: true}).click();
  const workspaceName = identity.nativeZoom ? "Assets browser zoom" : "Assets browser qualification";
  await page.locator('input[name="workspaceName"]').fill(workspaceName);
  await page.getByRole("button", {name: "Create workspace", exact: true}).click();
  await expect(page.locator(".workspace-create-form")).toHaveCount(0);
  await expect(selected).toHaveValue(/^workspace\./); await expect(selected).not.toHaveValue(previous);
  const workspaceId = await selected.inputValue();
  await expect(page.getByRole("heading", {name: workspaceName, exact: true})).toBeVisible();
  await page.goto(new URL("/assets", process.env.VISUAL_COMPOSER_THIN_CLIENT_ORIGIN!).href);
  await expect(selected).toHaveValue(workspaceId);
  await expect(page.getByRole("heading", {name: "Assets", exact: true})).toBeVisible({timeout: 30000});
  return workspaceId;
}
test("managed thin client builds, customizes, reviews, publishes and reopens real assets", async ({page}) => {
  test.setTimeout(480000); const info = test.info();
  const identity = assetQualificationIdentity(process.env.VISUAL_COMPOSER_QUALIFICATION_SOURCE_REVISION, process.env.VISUAL_COMPOSER_QUALIFICATION_RUN_ID, info.project.name, false, info.title);
  await runAssetQualificationCase(async () => {
    const workspaceId = await openAssets(page, identity);
    await completeAssetExperienceJourney(page, async () => {
      await page.reload(); await expect(page.getByLabel("Select current workspace")).toHaveValue(workspaceId);
      await expect(page.getByRole("heading", {name: "Assets", exact: true})).toBeVisible(); return page;
    }, info, identity);
    await qualifyAssetSurfaces(page, info, identity);
  }, async () => undefined);
});
test("managed thin client Assets reflows at actual native 400 percent browser zoom", async () => {
  test.setTimeout(480000); const info = test.info();
  const identity = assetQualificationIdentity(process.env.VISUAL_COMPOSER_QUALIFICATION_SOURCE_REVISION, process.env.VISUAL_COMPOSER_QUALIFICATION_RUN_ID, info.project.name, true, info.title);
  let owned: Awaited<ReturnType<typeof launchOwnedNativeZoomContext>> | undefined;
  await runAssetQualificationCase(async () => {
    owned = await launchOwnedNativeZoomContext(4);
    const page = owned.context.pages()[0]; if (!page) throw new Error("The owned Assets page is unavailable.");
    const workspaceId = await openAssets(page, identity);
    await completeAssetExperienceJourney(page, async () => {
      await page.reload(); await expect(page.getByLabel("Select current workspace")).toHaveValue(workspaceId);
      await expect(page.getByRole("heading", {name: "Assets", exact: true})).toBeVisible(); return page;
    }, info, identity);
    await qualifyAssetSurfaces(page, info, identity);
  }, async () => {const retiring = owned; owned = undefined; if (retiring) await retiring.close();});
});
