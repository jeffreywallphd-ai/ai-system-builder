import { expect, test, type Page } from "@playwright/test";
import { qualifyOperationalUiJourney } from "./operational-ui-journey";
import { OPERATIONAL_HOST_TIMEOUT_MS, operationalStatusUrl } from "../operational-ui-oracles";
import { launchOwnedNativeZoomContext } from "../native-browser-zoom.mjs";

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
