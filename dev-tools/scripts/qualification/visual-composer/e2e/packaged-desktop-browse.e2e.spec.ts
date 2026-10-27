import { expect, test } from "@playwright/test";
import { _electron as electron } from "playwright";
import { mkdir, realpath } from "node:fs/promises";
import path from "node:path";
import { closeDesktopAndQualifyOwnedWorkers } from "./desktop-task-cleanup";
import { completeBrowseAuthoringJourney } from "./browse-authoring-journey";
import { prepareIsolatedDesktopCase } from "./isolated-desktop-case";
import { completeAssetAuthoringJourney, readDesktopPublishedDefinition } from "./asset-authoring-journey";
import { AUTHORING_PHASE_BUDGET_MS, runOwnedRestartPhase } from "../asset-authoring-oracles";

test("packaged desktop preserves the complete browse authoring journey", async () => {
  // Existing browse/Assets budget plus150s for the additional owned restart/checks.
  test.setTimeout(150_000 + AUTHORING_PHASE_BUDGET_MS + 150_000);
  const isolated = prepareIsolatedDesktopCase("browse");
  let verifyReplacement: Awaited<ReturnType<typeof completeAssetAuthoringJourney>> | undefined;
  let originalPid: number | undefined;
  let originalPage: import("@playwright/test").Page | undefined;
  for (const phase of ["before-restart", "after-restart"] as const) {
    // Worker identities are exclusive to each app; retained records are never deleted.
    const cache = path.join(isolated.dataRoot, `authoring-cache-${phase}`);
    await mkdir(cache, {recursive: false}); expect(await realpath(cache)).toBe(cache);
    const app = await electron.launch({executablePath: process.env.VISUAL_COMPOSER_DESKTOP_EXECUTABLE!, args: [`--user-data-dir=${isolated.dataRoot}`, "--disable-gpu"], env: {...isolated.env, HF_HUB_CACHE: cache}, timeout: 60_000});
    await runOwnedRestartPhase(async () => {
      const page = await app.firstWindow({timeout: 60_000});
      const pid = app.process().pid;
      expect(Number.isSafeInteger(pid) && pid! > 0).toBe(true);
      if (phase === "after-restart") {
        if (!verifyReplacement || !originalPage || originalPid === undefined) throw new Error("The first app session did not qualify.");
        expect(pid).not.toBe(originalPid); expect(page).not.toBe(originalPage);
        await expect(page.getByLabel("Select current workspace")).toHaveValue(/^workspace\./, {timeout: 30_000});
        await page.setViewportSize({width: 1440, height: 1000});
        await page.getByRole("button", {name: "Assets", exact: true}).click();
        await verifyReplacement(page);
      } else {
        originalPid = pid; originalPage = page;
        await expect(page.getByRole("heading", {name: "Create a Workspace", exact: true})).toBeVisible({timeout: 60_000});
        await page.getByRole("button", {name: "Create new workspace"}).click();
        await page.locator('input[name="workspaceName"]').fill("Desktop browse fixture");
        await page.getByRole("button", {name: "Create workspace", exact: true}).click();
        await expect(page.getByLabel("Select current workspace")).toHaveValue(/^workspace\./, {timeout: 30_000});
        await page.getByRole("button", {name: "Systems", exact: true}).click();
        const result = await completeBrowseAuthoringJourney(page, "Desktop browse fixture", async () => {
          await page.reload(); await page.getByRole("button", {name: "Systems", exact: true}).click();
          await expect(page.getByRole("heading", {name: "Systems", exact: true})).toBeVisible();
        }, test.info());
        await test.info().attach("browse-journey", {body: JSON.stringify({...result, sourceRevision: process.env.VISUAL_COMPOSER_QUALIFICATION_SOURCE_REVISION, qualification: "local-packaged-fixture"}), contentType: "application/json"});
        await page.setViewportSize({width: 1440, height: 1000});
        await page.getByRole("button", {name: "Assets", exact: true}).click();
        await expect(page.getByRole("heading", {name: "Assets", exact: true})).toBeVisible();
        verifyReplacement = await completeAssetAuthoringJourney(page, "packaged-desktop", {kind: "document-reload", reload: async () => {
          await page.reload(); await page.getByRole("button", {name: "Assets", exact: true}).click();
        }}, async (input, currentPage) => currentPage.evaluate(readDesktopPublishedDefinition, input), test.info());
      }
    }, () => closeDesktopAndQualifyOwnedWorkers(app, cache, test.info(), phase));
  }
});
