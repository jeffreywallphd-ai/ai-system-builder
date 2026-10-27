import { expect, test } from "@playwright/test";
import { _electron as electron } from "playwright";
import { mkdir, realpath } from "node:fs/promises";
import path from "node:path";
import { closeDesktopAndQualifyOwnedWorkers } from "./desktop-task-cleanup";
import { buildMeaningfulSystem, meaningfulSystemCases, recordMeaningfulJourney, revisitMeaningfulSystems } from "./meaningful-system-journeys";
import { prepareIsolatedDesktopCase } from "./isolated-desktop-case";
import { runOwnedRestartPhase } from "../asset-authoring-oracles";
import type { MeaningfulSystemObservation } from "../meaningful-system-oracles";

test("packaged desktop builds multiple useful systems from scratch", async () => {
  test.setTimeout(420_000);
  const isolated = prepareIsolatedDesktopCase("meaningful");
  const savedSystems: MeaningfulSystemObservation[] = [];
  let originalPid: number | undefined;
  let originalPage: import("@playwright/test").Page | undefined;
  for (const phase of ["before-restart", "after-restart"] as const) {
    const cache = path.join(isolated.dataRoot, `authoring-cache-${phase}`);
    await mkdir(cache, {recursive: false}); expect(await realpath(cache)).toBe(cache);
    const app = await electron.launch({ executablePath: process.env.VISUAL_COMPOSER_DESKTOP_EXECUTABLE!, args: [`--user-data-dir=${isolated.dataRoot}`, "--disable-gpu"], env: {...isolated.env, HF_HUB_CACHE: cache}, timeout: 60_000 });
    await runOwnedRestartPhase(async () => {
      const page = await app.firstWindow({ timeout: 60_000 });
      const pid = app.process().pid;
      expect(Number.isSafeInteger(pid) && pid! > 0).toBe(true);
      if (phase === "after-restart") {
        if (!originalPage || originalPid === undefined || savedSystems.length !== meaningfulSystemCases.length) throw new Error("The first app session did not qualify.");
        expect(pid).not.toBe(originalPid); expect(page).not.toBe(originalPage);
        await expect(page.getByLabel("Select current workspace")).toHaveValue(savedSystems[0]!.workspaceId, {timeout: 30_000});
        await page.getByRole("button", {name: "Systems", exact: true}).click();
        let observationIndex = 0;
        await revisitMeaningfulSystems(page, savedSystems, async value => {
          const body = JSON.stringify(value);
          expect(Buffer.byteLength(body)).toBeLessThanOrEqual(1024 * 1024);
          // Keep the original persisted revisit record. These bounded attachments
          // identify each replacement observation without widening recorder IDs.
          await test.info().attach(`meaningful-after-restart-${observationIndex++}`, {body, contentType: "application/json"});
        });
      } else {
        originalPid = pid; originalPage = page;
        await expect(page.getByRole("heading", { name: "Create a Workspace", exact: true })).toBeVisible({ timeout: 60_000 });
        await page.getByRole("button", { name: "Create new workspace" }).click();
        await page.locator('input[name="workspaceName"]').fill("Desktop meaningful systems");
        await page.getByRole("button", { name: "Create workspace", exact: true }).click();
        await expect(page.getByLabel("Select current workspace")).toHaveValue(/^workspace\./, { timeout: 30_000 });
        await page.getByRole("button", { name: "Systems", exact: true }).click();
        for (const scenario of meaningfulSystemCases) {
          const result = await buildMeaningfulSystem(page, scenario, async () => { await page.reload(); await page.getByRole("button", { name: "Systems", exact: true }).click(); await expect(page.getByRole("heading", { name: "Systems", exact: true })).toBeVisible(); }, value => recordMeaningfulJourney(test.info(), scenario.id, value));
          await test.info().attach(`meaningful-${scenario.id}`, { body: JSON.stringify(result), contentType: "application/json" });
          savedSystems.push(result.savedObservation);
      }
      await revisitMeaningfulSystems(page, savedSystems, value => recordMeaningfulJourney(test.info(), "revisit", value));
      }
    }, () => closeDesktopAndQualifyOwnedWorkers(app, cache, test.info(), phase));
  }
});
