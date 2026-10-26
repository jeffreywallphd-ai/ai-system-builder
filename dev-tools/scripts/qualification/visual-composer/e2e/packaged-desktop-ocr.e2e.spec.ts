import { expect, test } from "@playwright/test";
import { _electron as electron } from "playwright";
import { prepareIsolatedDesktopCase } from "./isolated-desktop-case";
import { closeDesktopAndQualifyOwnedWorkers } from "./desktop-task-cleanup";
import { qualifyOcrDatasetJourney } from "./ocr-dataset-journey";
import { mkdir, realpath } from "node:fs/promises";
import path from "node:path";

test.use({ trace: "off", video: "off", screenshot: "off" });
test.skip(process.env.PYTHON_RUNTIME_QUALIFICATION_SCENARIO !== "ocr-documents", "Requires the separately reviewed real Windows OCR fixture.");
test("packaged desktop imports scanned pages, denies an absent language and saves reviewed real OCR output", async () => {
  test.setTimeout(300_000);
  const isolated = prepareIsolatedDesktopCase("ocr");
  // A fresh owned download directory keeps this test out of user Downloads.
  const artifactsDir = path.join(isolated.dataRoot, "ocr-downloads");
  await mkdir(artifactsDir, { recursive: false });
  expect(await realpath(artifactsDir)).toBe(artifactsDir);
  const app = await electron.launch({ executablePath: process.env.VISUAL_COMPOSER_DESKTOP_EXECUTABLE!, args: [`--user-data-dir=${isolated.dataRoot}`, "--disable-gpu"], env: isolated.env, timeout: 60_000, acceptDownloads: true, artifactsDir });
  let journeyError: unknown, shutdownError: unknown;
  try {
    const page = await app.firstWindow({ timeout: 60_000 });
    await expect(page.getByRole("heading", { name: "Create a Workspace", exact: true })).toBeVisible({ timeout: 60_000 });
    await page.getByRole("button", { name: "Create new workspace", exact: true }).click();
    await page.locator('input[name="workspaceName"]').fill("Synthetic desktop OCR fixture");
    await page.getByRole("button", { name: "Create workspace", exact: true }).click();
    await expect(page.getByLabel("Select current workspace")).toHaveValue(/^workspace\./);
    await page.getByRole("button", { name: "Data", exact: true }).click();
    await qualifyOcrDatasetJourney(page, test.info(), "desktop");
  } catch (error) { journeyError = error; }
  try { await closeDesktopAndQualifyOwnedWorkers(app, isolated.env.HF_HUB_CACHE, test.info()); }
  catch (error) { shutdownError = error; }
  if (journeyError && shutdownError) throw new AggregateError([journeyError, shutdownError], "OCR desktop journey and shutdown failed.");
  if (journeyError) throw journeyError;
  if (shutdownError) throw shutdownError;
});
