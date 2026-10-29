import { readCriticalAccessibilityMode, type CriticalAccessibilityMode } from "../technical-accessibility-observation";
import { runOwnedRestartPhase } from "../asset-authoring-oracles";
import { applyOwnedDesktopNativeZoom } from "./native-desktop-zoom";
import { expect, test } from "@playwright/test";
import { _electron as electron } from "playwright";
import { prepareIsolatedDesktopCase } from "./isolated-desktop-case";
import { closeDesktopAndQualifyOwnedWorkers } from "./desktop-task-cleanup";
import { qualifyOcrDatasetJourney } from "./ocr-dataset-journey";
import { mkdir, realpath } from "node:fs/promises";
import path from "node:path";

test.use({ trace: "off", video: "off", screenshot: "off" });
test.skip(process.env.PYTHON_RUNTIME_QUALIFICATION_SCENARIO !== "ocr-documents", "Requires the separately reviewed real Windows OCR fixture.");
async function runDesktopOcr(mode: CriticalAccessibilityMode = "standard") {
  readCriticalAccessibilityMode(mode);
  if (mode === "native400" && test.info().project.name !== "packaged-desktop") throw new Error("Unknown OCR host context.");
  test.setTimeout(300_000);
  const isolated = prepareIsolatedDesktopCase(mode === "native400" ? "ocr-native400" : "ocr");
  // A fresh owned download directory keeps this test out of user Downloads.
  const artifactsDir = path.join(isolated.dataRoot, "ocr-downloads");
  await mkdir(artifactsDir, { recursive: false });
  expect(await realpath(artifactsDir)).toBe(artifactsDir);
  const app = await electron.launch({ executablePath: process.env.VISUAL_COMPOSER_DESKTOP_EXECUTABLE!, args: [`--user-data-dir=${isolated.dataRoot}`, "--disable-gpu"], env: isolated.env, timeout: 60_000, acceptDownloads: true, artifactsDir });
  await runOwnedRestartPhase(async () => {
    const page = await app.firstWindow({ timeout: 60_000 });
    if (mode === "native400") await applyOwnedDesktopNativeZoom(app, page);
    await expect(page.getByRole("heading", { name: "Create a Workspace", exact: true })).toBeVisible({ timeout: 60_000 });
    await page.getByRole("button", { name: "Create new workspace", exact: true }).click();
    await page.locator('input[name="workspaceName"]').fill("Synthetic desktop OCR fixture");
    await page.getByRole("button", { name: "Create workspace", exact: true }).click();
    await expect(page.getByLabel("Select current workspace")).toHaveValue(/^workspace\./);
    await page.getByRole("button", { name: "Data", exact: true }).click();
    await qualifyOcrDatasetJourney(page, test.info(), "desktop", mode);
  }, () => closeDesktopAndQualifyOwnedWorkers(app, isolated.env.HF_HUB_CACHE, test.info()));
}

test("packaged desktop imports scanned pages, denies an absent language and saves reviewed real OCR output", async () => { await runDesktopOcr(); });
test("packaged desktop reviews scanned data at native 400 percent zoom", async () => { await runDesktopOcr("native400"); });
