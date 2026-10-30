import { expect, test, type Page } from "@playwright/test";
import { qualifyOperationalUiJourney } from "./operational-ui-journey";
import { OPERATIONAL_HOST_TIMEOUT_MS, operationalStatusUrl } from "../operational-ui-oracles";
import { launchOwnedNativeZoomContext } from "../native-browser-zoom.mjs";
import { qualifyReviewSiteBrowser } from "./review-site-journey";
import { REVIEW_SITE_BROWSER_TIMEOUT_MS } from "../review-site-oracles";
import {captureImageInspection} from "../image-host-launch-plan.mjs";
import {captureImageHostFixture,imageHostWorkspace,imageHostModelRecord,IMAGE_HOST_TIMEOUT_MS} from "../image-generation-host-oracles";
import {qualifyImageHostJourney} from "./image-generation-host-journey";

test.use({ screenshot: "off", trace: "off", video: "off" });
function operationalBrowserConfiguration() {
  const statusUrl = operationalStatusUrl(process.env.VISUAL_COMPOSER_THIN_CLIENT_ORIGIN ?? "");
  const token = process.env.VISUAL_COMPOSER_THIN_CLIENT_BEARER_TOKEN;
  if (!token) throw new Error("The isolated thin-client test credential is unavailable.");
  return {statusUrl,token};
}
async function prepareOperationalBrowser(page: Page, {statusUrl,token} = operationalBrowserConfiguration()) {
  await page.addInitScript(value => localStorage.setItem("ai-system-builder.paired-device-token", value), token);
  await page.goto(new URL("/systems", statusUrl).href);
  await expect(page.getByRole("heading", { name: "Create a Workspace", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Create new workspace", exact: true }).click();
  await page.locator('input[name="workspaceName"]').fill("Operational browser fixture");
  await page.getByRole("button", { name: "Create workspace", exact: true }).click();
  await expect(page.getByLabel("Select current workspace")).toHaveValue(/^workspace\./);
}

test("thin client preserves Security refresh recovery and shell controls", async ({ page }) => {
  test.setTimeout(OPERATIONAL_HOST_TIMEOUT_MS);
  await prepareOperationalBrowser(page);
  await qualifyOperationalUiJourney(page, test.info(), "thin-chrome");
});

test("thin client preserves operational controls at native 400 percent zoom", async () => {
  test.setTimeout(OPERATIONAL_HOST_TIMEOUT_MS);
  if (test.info().project.name !== "thin-chrome") throw new Error("Unsupported native operational host.");
  const configuration = operationalBrowserConfiguration();
  // This fixed local profile applies browser zoom; no Playwright viewport substitute.
  const owned = await launchOwnedNativeZoomContext(4);
  const failures: unknown[] = [];
  try {
    const page = owned.context.pages()[0] ?? await owned.context.newPage();
    await prepareOperationalBrowser(page, configuration);
    await qualifyOperationalUiJourney(page, test.info(), "thin-chrome", "native400");
  } catch (error) { failures.push(error); }
  try { await owned.close(); } catch (error) { failures.push(error); }
  if (failures.length) throw new AggregateError(failures, "Native operational journey or owned browser retirement failed.");
});

// These read-only review cases do not use the app's token or runtime setup.
test.describe("review site real browser", () => {
  test.use({ serviceWorkers: "block", acceptDownloads: false, storageState: { cookies: [], origins: [] }, extraHTTPHeaders: {} });
  test("opens canonical details and linked work without changing qualification", async ({ page }) => {
    test.setTimeout(REVIEW_SITE_BROWSER_TIMEOUT_MS);
    await qualifyReviewSiteBrowser(page, test.info(), "live");
  });
  test("refreshes a controlled current copy and recovers from connection refusal", async ({ page }) => {
    test.setTimeout(REVIEW_SITE_BROWSER_TIMEOUT_MS);
    await qualifyReviewSiteBrowser(page, test.info(), "refresh-recovery");
  });
  test("keeps theme, keyboard and narrow review usable when storage refuses access", async ({ page }) => {
    test.setTimeout(REVIEW_SITE_BROWSER_TIMEOUT_MS);
    await qualifyReviewSiteBrowser(page, test.info(), "theme-storage");
  });
});

for(const scenario of ["create-register","task-recovery"] as const)test(`thin client image ${scenario} uses real output and saved artifacts`,async({page})=>{
  test.setTimeout(IMAGE_HOST_TIMEOUT_MS);
  test.skip(process.env.VISUAL_COMPOSER_IMAGE_READY!=="1","Pending the dedicated image profile and approved installed local inputs.");
  if(test.info().project.name!=="thin-chrome")throw new Error("Unsupported image host.");
  const run=process.env.VISUAL_COMPOSER_QUALIFICATION_RUN_ID!,source=process.env.VISUAL_COMPOSER_QUALIFICATION_SOURCE_REVISION!;
  const input=captureImageInspection(process.env.VISUAL_COMPOSER_IMAGE_INSPECTION,run,source);
  const declaration=JSON.stringify({schemaVersion:"image-host-fixture-v1",runId:run,sourceRevision:source,host:"thin-chrome",journey:scenario,
    workspaceId:imageHostWorkspace(run,"thin-chrome",scenario),modelRecordId:imageHostModelRecord(run,"thin-chrome",scenario),checkpointFileName:input.checkpointFileName,checkpointSha256:input.checkpointSha256});
  const fixture=captureImageHostFixture(declaration,run,source,"thin-chrome",scenario)!;
  const {statusUrl,token}=operationalBrowserConfiguration();
  await page.addInitScript(value=>localStorage.setItem("ai-system-builder.paired-device-token",value),token);
  await page.goto(new URL("/systems",statusUrl).href);
  const workspace=page.getByLabel("Select current workspace",{exact:true});await expect(workspace).toBeVisible();
  await workspace.selectOption(fixture.workspaceId);await expect(workspace).toHaveValue(fixture.workspaceId);
  await qualifyImageHostJourney(page,test.info(),declaration,scenario);
});
