import { applyOwnedDesktopNativeZoom } from "./native-desktop-zoom";
import { expect, test } from "@playwright/test";
import { _electron as electron, type ElectronApplication } from "playwright";
import { mkdir, realpath } from "node:fs/promises";
import path from "node:path";
import { closeDesktopAndQualifyOwnedWorkers } from "./desktop-task-cleanup";
import { completeBrowseAuthoringJourney, qualifyCanvasLayoutKeyboard, qualifyCanvasPageLayouts } from "./browse-authoring-journey";
import { collectNative400Frame } from "./technical-accessibility";
import { prepareIsolatedDesktopCase } from "./isolated-desktop-case";
import { completeAssetAuthoringJourney, readDesktopPublishedDefinition } from "./asset-authoring-journey";
import { AUTHORING_PHASE_BUDGET_MS, runOwnedRestartPhase } from "../asset-authoring-oracles";
import { assetApplicationLifetime } from "../asset-experience-oracles";

test.use({trace: "off", screenshot: "off", video: "off"});

test("packaged desktop changes Canvas layouts with the keyboard at native 400 percent zoom", async () => {
  test.setTimeout(150_000);
  if (test.info().project.name !== "packaged-desktop") throw new Error("Unsupported Desktop layout qualification host.");
  const isolated = prepareIsolatedDesktopCase("browse-layout-native400");
  const lifetime = assetApplicationLifetime<ElectronApplication>();
  const app = await lifetime.launch(() => electron.launch({
    executablePath: process.env.VISUAL_COMPOSER_DESKTOP_EXECUTABLE!,
    args: [`--user-data-dir=${isolated.dataRoot}`, "--disable-gpu"],
    env: isolated.env,
    timeout: 60_000,
  }));
  await runOwnedRestartPhase(async () => {
    const page = await app.firstWindow({timeout: 60_000});
    await expect(page.getByRole("heading", {name: "Create a Workspace", exact: true})).toBeVisible({timeout: 60_000});
    await page.getByRole("button", {name: "Create new workspace"}).click();
    await page.locator('input[name="workspaceName"]').fill("Desktop layout fixture");
    await page.getByRole("button", {name: "Create workspace", exact: true}).click();
    const workspace = page.getByLabel("Select current workspace");
    await expect(workspace).toHaveValue(/^workspace\./);
    const workspaceId = await workspace.inputValue();
    await applyOwnedDesktopNativeZoom(app, page);
    const openSystems = async (initial = false) => {
      const trigger = page.locator('summary[aria-label="Open navigation menu"]');
      const navigation = page.getByRole("menu", {name: "Application navigation", exact: true, includeHidden: true});
      await expect(trigger).toBeVisible();
      if (initial) await trigger.press("ArrowDown");
      else if (!(await navigation.isVisible())) await trigger.click();
      await expect(navigation).toBeVisible();
      await navigation.getByRole("menuitem", {name: "Systems", exact: true}).press("Enter");
      await expect(navigation).toBeHidden();
      await expect(page.getByRole("heading", {name: "Systems", level: 1, exact: true})).toBeVisible();
      await expect.poll(async () => (await collectNative400Frame(page)).status).toBe("passed");
    };
    await openSystems(true);
    const result = await qualifyCanvasLayoutKeyboard(page, "Desktop layout selection", async () => {
      await page.reload();
      await expect(workspace).toHaveValue(workspaceId);
      await openSystems();
    });
    await test.info().attach("native-layout-keyboard", {
      body: JSON.stringify({...result, zoom: 400, sourceRevision: process.env.VISUAL_COMPOSER_QUALIFICATION_SOURCE_REVISION}),
      contentType: "application/json",
    });
    const pages = await qualifyCanvasPageLayouts(page, "Desktop page layout fixture", async () => {
      await page.reload();
      await expect(workspace).toHaveValue(workspaceId);
      await openSystems();
    });
    await test.info().attach("native-page-layouts", {
      body: JSON.stringify({...pages, zoom: 400, sourceRevision: process.env.VISUAL_COMPOSER_QUALIFICATION_SOURCE_REVISION}),
      contentType: "application/json",
    });
  }, () => lifetime.retire());
});

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


test("packaged desktop completes Assets and System editing at native 400 percent zoom", async () => {
  test.setTimeout(150_000 + AUTHORING_PHASE_BUDGET_MS + 150_000);
  if (test.info().project.name !== "packaged-desktop") throw new Error("Unsupported native Assets and System host.");
  const isolated = prepareIsolatedDesktopCase("browse-native400");
  const cache = path.join(isolated.dataRoot, "authoring-cache-native400");
  await mkdir(cache, {recursive: false}); expect(await realpath(cache)).toBe(cache);
  const lifetime = assetApplicationLifetime<ElectronApplication>();
  const app = await lifetime.launch(() => electron.launch({executablePath: process.env.VISUAL_COMPOSER_DESKTOP_EXECUTABLE!, args: [`--user-data-dir=${isolated.dataRoot}`, "--disable-gpu"], env: {...isolated.env, HF_HUB_CACHE: cache}, timeout: 60_000}));
  await runOwnedRestartPhase(async () => {
    const page = await app.firstWindow({timeout: 60_000});
    const selected = page.getByLabel("Select current workspace");
    async function navigate(target: "Systems" | "Assets", initial = false) {
      const trigger = page.locator('summary[aria-label="Open navigation menu"]');
      const menu = page.getByRole("menu", {name: "Application navigation", exact: true, includeHidden: true});
      await expect(trigger).toBeVisible();
      if (initial) await trigger.press("ArrowDown");
      else if (!(await menu.isVisible())) await trigger.click();
      await expect(menu).toBeVisible();
      await menu.getByRole("menuitem", {name: target, exact: true}).press("Enter");
      await expect(menu).toBeHidden();
      await expect(page.getByRole("heading", {name: target, exact: true, level: 1})).toBeVisible();
    }
    await expect(page.getByRole("heading", {name: "Create a Workspace", exact: true})).toBeVisible({timeout: 60_000});
    await page.getByRole("button", {name: "Create new workspace"}).click();
    await page.locator('input[name="workspaceName"]').fill("Native desktop browse fixture");
    await page.getByRole("button", {name: "Create workspace", exact: true}).click();
    await expect(selected).toHaveValue(/^workspace\./, {timeout: 30_000});
    const workspaceId = await selected.inputValue();
    await applyOwnedDesktopNativeZoom(app, page);
    await expect.poll(() => page.evaluate(() => outerWidth)).toBeGreaterThanOrEqual(1400);
    await expect.poll(() => page.evaluate(() => outerWidth)).toBeLessThanOrEqual(1460);
    await navigate("Systems", true);
    const result = await completeBrowseAuthoringJourney(page, "Native desktop browse fixture", async () => {
      await page.reload();
      await expect(selected).toHaveValue(workspaceId, {timeout: 30_000});
      await applyOwnedDesktopNativeZoom(app, page);
      await navigate("Systems");
      await expect(page.getByRole("tab", {name: "Compose", exact: true})).toBeVisible();
    }, test.info(), "native400");
    await test.info().attach("browse-journey-native400", {body: JSON.stringify({...result, sourceRevision: process.env.VISUAL_COMPOSER_QUALIFICATION_SOURCE_REVISION, qualification: "local-packaged-fixture-native400"}), contentType: "application/json"});
    await navigate("Assets");
    await completeAssetAuthoringJourney(page, "packaged-desktop", {kind: "document-reload", reload: async () => {
      await page.reload();
      await expect(selected).toHaveValue(workspaceId, {timeout: 30_000});
      await applyOwnedDesktopNativeZoom(app, page);
      await navigate("Assets");
    }}, async (input, currentPage) => currentPage.evaluate(readDesktopPublishedDefinition, input), test.info(), "native400");
  // This case launches no model or Python worker. Keep the separate standard
  // journey's native worker admission and exit checks intact.
  }, () => lifetime.retire());
});
