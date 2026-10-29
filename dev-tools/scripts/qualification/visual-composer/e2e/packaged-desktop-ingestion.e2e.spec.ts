import {closeImportedFileDesktop,type ImportedFileJourneyStage} from "./desktop-import-cleanup";
import { expect, test } from "@playwright/test";
import { _electron as electron } from "playwright";
import { prepareIsolatedDesktopCase } from "./isolated-desktop-case";
import { qualifyIngestionSourceJourney } from "./ingestion-source-journey";
import { applyOwnedDesktopNativeZoom } from "./native-desktop-zoom";
import { readCriticalAccessibilityMode, type CriticalAccessibilityMode } from "../technical-accessibility-observation";
import { runOwnedRestartPhase } from "../asset-authoring-oracles";

// File import does not start a model worker. Qualify the main process explicitly;
// the enclosing native operator separately observes the complete job tree.
// Model-task tests retain their stronger, positive worker-shutdown assertions.

test.use({ trace: "off", video: "off", screenshot: "off" });
async function runDesktopImport(mode: CriticalAccessibilityMode = "standard") {
  readCriticalAccessibilityMode(mode);
  if (test.info().project.name !== "packaged-desktop") throw new Error("Unsupported native Data host.");
  const isolated = prepareIsolatedDesktopCase(mode === "native400" ? "ingestion-native400" : "ingestion");
  const app = await electron.launch({ executablePath: process.env.VISUAL_COMPOSER_DESKTOP_EXECUTABLE!, args: [`--user-data-dir=${isolated.dataRoot}`, "--disable-gpu"], env: isolated.env, timeout: 60_000 });
  let stage: ImportedFileJourneyStage = "startup";
  await runOwnedRestartPhase(async () => {
    const page = await app.firstWindow({ timeout: 60_000 });
    await expect(page.getByRole("heading", { name: "Create a Workspace", exact: true })).toBeVisible({ timeout: 60_000 });
    stage = "workspace";
    await page.getByRole("button", { name: "Create new workspace", exact: true }).click();
    await page.locator('input[name="workspaceName"]').fill("Synthetic desktop file import");
    await page.getByRole("button", { name: "Create workspace", exact: true }).click();
    await expect(page.getByLabel("Select current workspace")).toHaveValue(/^workspace\./);
    if (mode === "native400") await applyOwnedDesktopNativeZoom(app, page);
    await page.getByRole("button", { name: "Data", exact: true }).click();
    stage = "file-import";
    await qualifyIngestionSourceJourney(page, test.info(), "desktop", mode);
    stage = "complete";
  }, () => closeImportedFileDesktop(app, isolated.dataRoot, test.info(), stage, mode));
}

test("packaged desktop imports distinct multi-chunk files through Add data and retains their source records", async () => {
  test.setTimeout(180_000);
  await runDesktopImport();
});

test("packaged desktop imports files and reviews records at native 400 percent zoom", async () => {
  test.setTimeout(180_000);
  await runDesktopImport("native400");
});
