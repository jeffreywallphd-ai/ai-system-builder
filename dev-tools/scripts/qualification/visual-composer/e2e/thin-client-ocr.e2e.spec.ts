import { readCriticalAccessibilityMode, type CriticalAccessibilityMode } from "../technical-accessibility-observation";
import { launchOwnedNativeZoomContext } from "../native-browser-zoom.mjs";
import { operationalStatusUrl } from "../operational-ui-oracles";
import { expect, test } from "@playwright/test";
import { qualifyOcrDatasetJourney } from "./ocr-dataset-journey";

test.use({ trace: "off", video: "off", screenshot: "off" });
test.skip(process.env.PYTHON_RUNTIME_QUALIFICATION_SCENARIO !== "ocr-documents", "Requires the separately reviewed real Windows OCR fixture.");
async function runBrowserOcr(page: import("@playwright/test").Page, mode: CriticalAccessibilityMode = "standard") {
  readCriticalAccessibilityMode(mode);
  test.setTimeout(300_000);
  expect(process.env.PYTHON_RUNTIME_QUALIFICATION_SCENARIO).toBe("ocr-documents");
  await page.addInitScript(token => localStorage.setItem("ai-system-builder.paired-device-token", token), process.env.VISUAL_COMPOSER_THIN_CLIENT_BEARER_TOKEN!);
  await page.goto(new URL("/", process.env.VISUAL_COMPOSER_THIN_CLIENT_ORIGIN!).href);
  await page.getByRole("button", { name: "Create new workspace", exact: true }).click();
  await page.locator('input[name="workspaceName"]').fill("Synthetic browser OCR fixture");
  await page.getByRole("button", { name: "Create workspace", exact: true }).click();
  await expect(page.getByLabel("Select current workspace")).toHaveValue(/^workspace\./);
  await page.getByRole("button", { name: "Artifacts", exact: true }).click();
  await qualifyOcrDatasetJourney(page, test.info(), "thin", mode);
}

test("browser imports scanned pages, denies an absent language and saves reviewed real OCR output", async ({page}) => { await runBrowserOcr(page); });
test("browser reviews scanned data at native 400 percent zoom", async () => {
  test.setTimeout(300_000);
  if (test.info().project.name !== "thin-chrome") throw new Error("Unknown OCR host context.");
  operationalStatusUrl(process.env.VISUAL_COMPOSER_THIN_CLIENT_ORIGIN ?? "");
  if (!process.env.VISUAL_COMPOSER_THIN_CLIENT_BEARER_TOKEN) throw new Error("The isolated thin-client test credential is unavailable.");
  const owned = await launchOwnedNativeZoomContext(4), failures: unknown[] = [];
  try { await runBrowserOcr(owned.context.pages()[0] ?? await owned.context.newPage(), "native400"); } catch (error) { failures.push(error); }
  try { await owned.close(); } catch (error) { failures.push(error); }
  if (failures.length) throw new AggregateError(failures, "Native OCR journey or browser retirement failed.");
});
