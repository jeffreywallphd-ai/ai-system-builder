import { expect, test } from "@playwright/test";
import { _electron as electron } from "playwright";
import { mkdir, realpath } from "node:fs/promises";
import path from "node:path";
import { prepareIsolatedDesktopCase } from "./isolated-desktop-case";
import { closeDesktopAndQualifyOwnedWorkers } from "./desktop-task-cleanup";
import { prepareProvidedVersions, verifyProvidedVersionsAfterRestart } from "./provided-dataset-version-journey";
import { prepareManualContext, verifyManualContextAfterRestart, type ManualContextSnapshot } from "./manual-context-host-journey";
import { prepareSavedRowReview, verifySavedRowReviewAfterRestart, type SavedRowSnapshot } from "./saved-row-review-host-journey";
import { prepareSourceContext, verifySourceContextAfterRestart, type SourceContextSnapshot } from "./source-context-host-journey";
import { applyOwnedDesktopNativeZoom } from "./native-desktop-zoom";
import { readCriticalAccessibilityMode, type CriticalAccessibilityMode } from "../technical-accessibility-observation";
import { runOwnedRestartPhase } from "../asset-authoring-oracles";

test.use({ trace: "off", video: "off", screenshot: "off" });
test.skip(process.env.PYTHON_RUNTIME_QUALIFICATION_SCENARIO !== "dataset-profile" ||
  process.env.PYTHON_RUNTIME_ARGS !== "-I -B ../../../../dev-tools/scripts/qualification/visual-composer/provided-dataset-qualification-worker.py",
  "Requires the separately reviewed real provided-data composition.");
async function runDesktopData(mode: CriticalAccessibilityMode = "standard") {
  readCriticalAccessibilityMode(mode);
  if (test.info().project.name !== "packaged-desktop") throw new Error("Unsupported native Data host.");
  const isolated = prepareIsolatedDesktopCase(mode === "native400" ? "dataset-native400" : "dataset");
  let saved: Awaited<ReturnType<typeof prepareProvidedVersions>> | undefined;
  let savedContext: ManualContextSnapshot | undefined;
  let savedRows: SavedRowSnapshot | undefined;
  let savedSourceContext: SourceContextSnapshot | undefined;
  for (const phase of ["before-restart", "after-restart"] as const) {
    // The standard case keeps its complete two-process restart proof. Native
    // variation observes the creation/review forms in one owned app session.
    if (mode === "native400" && phase === "after-restart") break;
    const cache = path.join(isolated.dataRoot, `provided-cache-${phase}`);
    await mkdir(cache, { recursive: false }); expect(await realpath(cache)).toBe(cache);
    const app = await electron.launch({ executablePath: process.env.VISUAL_COMPOSER_DESKTOP_EXECUTABLE!,
      args: [`--user-data-dir=${isolated.dataRoot}`, "--disable-gpu"],
      env: { ...isolated.env, HF_HUB_CACHE: cache }, timeout: 60_000 });
    await runOwnedRestartPhase(async () => {
      const page = await app.firstWindow({ timeout: 60_000 });
      if (phase === "before-restart") {
        await expect(page.getByRole("heading", { name: "Create a Workspace", exact: true })).toBeVisible({ timeout: 60_000 });
        await page.getByRole("button", { name: "Create new workspace", exact: true }).click();
        await page.locator('input[name="workspaceName"]').fill("Synthetic provided desktop data");
        await page.getByRole("button", { name: "Create workspace", exact: true }).click();
        await expect(page.getByLabel("Select current workspace")).toHaveValue(/^workspace\./);
        if (mode === "native400") await applyOwnedDesktopNativeZoom(app, page);
        await page.getByRole("button", { name: "Data", exact: true }).click();
        saved = await prepareProvidedVersions(page, "desktop", test.info(), mode);
        savedRows = await prepareSavedRowReview(page, "desktop", test.info(), mode);
        savedSourceContext = await prepareSourceContext(page, "desktop", test.info(), mode);
        savedContext = await prepareManualContext(page, "desktop", test.info(), mode);
      } else {
        if (!saved || !savedContext || !savedRows || !savedSourceContext) throw new Error("The first app session did not qualify.");
        await verifyProvidedVersionsAfterRestart(page, "desktop", saved, test.info());
        await verifyManualContextAfterRestart(page, "desktop", savedContext, test.info());
        await verifySavedRowReviewAfterRestart(page, "desktop", savedRows, test.info());
        await verifySourceContextAfterRestart(page, "desktop", savedSourceContext, test.info());
      }
    }, () => closeDesktopAndQualifyOwnedWorkers(app, cache, test.info(), mode === "native400" ? undefined : phase));
  }
}

test("packaged desktop saves dataset versions, source RAG and Context packs across complete app restart", async () => {
  test.setTimeout(300_000);
  await runDesktopData();
});

test("packaged desktop completes Data and Context review forms at native 400 percent zoom", async () => {
  test.setTimeout(300_000);
  await runDesktopData("native400");
});
