import { expect, test, type Page } from "@playwright/test";
import { qualifyIngestionSourceJourney } from "./ingestion-source-journey";
import { launchOwnedNativeZoomContext } from "../native-browser-zoom.mjs";
import { operationalStatusUrl } from "../operational-ui-oracles";
import { readCriticalAccessibilityMode, type CriticalAccessibilityMode } from "../technical-accessibility-observation";
import { readWebsiteHostFixture, WEBSITE_HOST_TIMEOUT_MS } from "../website-acquisition-oracles";
import { createWebsiteQualificationWorkspace, qualifyWebsiteAcquisitionJourney } from "./website-acquisition-journey";

test.use({ trace: "off", video: "off", screenshot: "off" });
async function runBrowserImport(page: Page, mode: CriticalAccessibilityMode = "standard") {
  readCriticalAccessibilityMode(mode);
  await page.addInitScript(token => localStorage.setItem("ai-system-builder.paired-device-token", token), process.env.VISUAL_COMPOSER_THIN_CLIENT_BEARER_TOKEN!);
  await page.goto(new URL("/", process.env.VISUAL_COMPOSER_THIN_CLIENT_ORIGIN!).href);
  await page.getByRole("button", { name: "Create new workspace", exact: true }).click();
  await page.locator('input[name="workspaceName"]').fill("Synthetic browser file import");
  await page.getByRole("button", { name: "Create workspace", exact: true }).click();
  await expect(page.getByLabel("Select current workspace")).toHaveValue(/^workspace\./);
  await page.getByRole("button", { name: "Artifacts", exact: true }).click();
  await qualifyIngestionSourceJourney(page, test.info(), "thin", mode);
}

test("browser imports distinct multi-chunk files through Add data and retains their source records", async ({ page }) => {
  test.setTimeout(180_000);
  await runBrowserImport(page);
});

test("browser imports files and reviews source records at native 400 percent zoom", async () => {
  test.setTimeout(180_000);
  if (test.info().project.name !== "thin-chrome") throw new Error("Unsupported native Data host.");
  operationalStatusUrl(process.env.VISUAL_COMPOSER_THIN_CLIENT_ORIGIN ?? "");
  if (!process.env.VISUAL_COMPOSER_THIN_CLIENT_BEARER_TOKEN) throw new Error("The isolated thin-client test credential is unavailable.");
  const owned = await launchOwnedNativeZoomContext(4), failures: unknown[] = [];
  try { await runBrowserImport(owned.context.pages()[0] ?? await owned.context.newPage(), "native400"); }
  catch (error) { failures.push(error); }
  try { await owned.close(); } catch (error) { failures.push(error); }
  if (failures.length) throw new AggregateError(failures, "Native file import or browser retirement failed.");
});

test("browser acquires an authorized website page and reopens isolated raw and readable artifacts", async ({ page }) => {
  test.setTimeout(WEBSITE_HOST_TIMEOUT_MS);
  const fixture = readWebsiteHostFixture(process.env.VISUAL_COMPOSER_WEBSITE_FIXTURE);
  test.skip(!fixture, "An explicitly authorized public synthetic website fixture is required; acquisition qualification remains pending.");
  if (!fixture) return;
  if (test.info().project.name !== "thin-chrome") throw new Error("Unsupported website qualification host.");
  const origin = process.env.VISUAL_COMPOSER_THIN_CLIENT_ORIGIN ?? "";
  operationalStatusUrl(origin);
  const token = process.env.VISUAL_COMPOSER_THIN_CLIENT_BEARER_TOKEN;
  if (!token) throw new Error("The isolated thin-client test credential is unavailable.");
  await page.addInitScript(value => localStorage.setItem("ai-system-builder.paired-device-token", value), token);
  await page.goto(new URL("/", origin).href);
  await createWebsiteQualificationWorkspace(page, "Website acquisition fixture");
  await qualifyWebsiteAcquisitionJourney(page, test.info(), process.env.VISUAL_COMPOSER_WEBSITE_FIXTURE);
});
