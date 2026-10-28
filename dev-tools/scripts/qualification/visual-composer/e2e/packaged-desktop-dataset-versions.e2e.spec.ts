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

test.use({ trace: "off", video: "off", screenshot: "off" });
test.skip(process.env.PYTHON_RUNTIME_QUALIFICATION_SCENARIO !== "dataset-profile" ||
  process.env.PYTHON_RUNTIME_ARGS !== "-I -B ../../../../dev-tools/scripts/qualification/visual-composer/provided-dataset-qualification-worker.py",
  "Requires the separately reviewed real provided-data composition.");
test("packaged desktop saves dataset versions, source RAG and Context packs across complete app restart", async () => {
  test.setTimeout(300_000);
  const isolated = prepareIsolatedDesktopCase("dataset");
  let saved: Awaited<ReturnType<typeof prepareProvidedVersions>> | undefined;
  let savedContext: ManualContextSnapshot | undefined;
  let savedRows: SavedRowSnapshot | undefined;
  let savedSourceContext: SourceContextSnapshot | undefined;
  for (const phase of ["before-restart", "after-restart"] as const) {
    const cache = path.join(isolated.dataRoot, `provided-cache-${phase}`);
    await mkdir(cache, { recursive: false }); expect(await realpath(cache)).toBe(cache);
    const app = await electron.launch({ executablePath: process.env.VISUAL_COMPOSER_DESKTOP_EXECUTABLE!,
      args: [`--user-data-dir=${isolated.dataRoot}`, "--disable-gpu"],
      env: { ...isolated.env, HF_HUB_CACHE: cache }, timeout: 60_000 });
    let journeyError: unknown, cleanupError: unknown;
    try {
      const page = await app.firstWindow({ timeout: 60_000 });
      if (phase === "before-restart") {
        await expect(page.getByRole("heading", { name: "Create a Workspace", exact: true })).toBeVisible({ timeout: 60_000 });
        await page.getByRole("button", { name: "Create new workspace", exact: true }).click();
        await page.locator('input[name="workspaceName"]').fill("Synthetic provided desktop data");
        await page.getByRole("button", { name: "Create workspace", exact: true }).click();
        await expect(page.getByLabel("Select current workspace")).toHaveValue(/^workspace\./);
        await page.getByRole("button", { name: "Data", exact: true }).click();
        saved = await prepareProvidedVersions(page, "desktop", test.info());
        savedRows = await prepareSavedRowReview(page, "desktop", test.info());
        savedSourceContext = await prepareSourceContext(page, "desktop", test.info());
        savedContext = await prepareManualContext(page, "desktop", test.info());
      } else {
        if (!saved || !savedContext || !savedRows || !savedSourceContext) throw new Error("The first app session did not qualify.");
        await verifyProvidedVersionsAfterRestart(page, "desktop", saved, test.info());
        await verifyManualContextAfterRestart(page, "desktop", savedContext, test.info());
        await verifySavedRowReviewAfterRestart(page, "desktop", savedRows, test.info());
        await verifySourceContextAfterRestart(page, "desktop", savedSourceContext, test.info());
      }
    } catch (error) { journeyError = error; }
    try { await closeDesktopAndQualifyOwnedWorkers(app, cache, test.info(), phase); }
    catch (error) { cleanupError = error; }
    if (journeyError || cleanupError) throw new AggregateError([journeyError, cleanupError].filter(Boolean), "Provided dataset journey or owned shutdown failed.");
  }
});
