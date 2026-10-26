import { expect, test } from "@playwright/test";
import { qualifyOcrDatasetJourney } from "./ocr-dataset-journey";

test.use({ trace: "off", video: "off", screenshot: "off" });
test.skip(process.env.PYTHON_RUNTIME_QUALIFICATION_SCENARIO !== "ocr-documents", "Requires the separately reviewed real Windows OCR fixture.");
test("browser imports scanned pages, denies an absent language and saves reviewed real OCR output", async ({ page }) => {
  test.setTimeout(300_000);
  expect(process.env.PYTHON_RUNTIME_QUALIFICATION_SCENARIO).toBe("ocr-documents");
  await page.addInitScript(token => localStorage.setItem("ai-system-builder.paired-device-token", token), process.env.VISUAL_COMPOSER_THIN_CLIENT_BEARER_TOKEN!);
  await page.goto(new URL("/", process.env.VISUAL_COMPOSER_THIN_CLIENT_ORIGIN!).href);
  await page.getByRole("button", { name: "Create new workspace", exact: true }).click();
  await page.locator('input[name="workspaceName"]').fill("Synthetic browser OCR fixture");
  await page.getByRole("button", { name: "Create workspace", exact: true }).click();
  await expect(page.getByLabel("Select current workspace")).toHaveValue(/^workspace\./);
  await page.getByRole("button", { name: "Artifacts", exact: true }).click();
  await qualifyOcrDatasetJourney(page, test.info(), "thin");
});
