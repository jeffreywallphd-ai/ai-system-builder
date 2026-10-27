import { expect, test } from "@playwright/test";
import { _electron as electron } from "playwright";
import { buildMeaningfulSystem, meaningfulSystemCases, recordMeaningfulJourney, revisitMeaningfulSystems } from "./meaningful-system-journeys";
import { prepareIsolatedDesktopCase } from "./isolated-desktop-case";
import type { MeaningfulSystemObservation } from "../meaningful-system-oracles";

test("packaged desktop builds multiple useful systems from scratch", async () => {
  test.setTimeout(420_000);
  const isolated = prepareIsolatedDesktopCase("meaningful");
  const app = await electron.launch({ executablePath: process.env.VISUAL_COMPOSER_DESKTOP_EXECUTABLE!, args: [`--user-data-dir=${isolated.dataRoot}`, "--disable-gpu"], env: isolated.env, timeout: 60_000 });
  try {
    const page = await app.firstWindow({ timeout: 60_000 });
    await expect(page.getByRole("heading", { name: "Create a Workspace", exact: true })).toBeVisible({ timeout: 60_000 });
    await page.getByRole("button", { name: "Create new workspace" }).click();
    await page.locator('input[name="workspaceName"]').fill("Desktop meaningful systems");
    await page.getByRole("button", { name: "Create workspace", exact: true }).click();
    await expect(page.getByLabel("Select current workspace")).toHaveValue(/^workspace\./, { timeout: 30_000 });
    await page.getByRole("button", { name: "Systems", exact: true }).click();
    const savedSystems: MeaningfulSystemObservation[] = [];
    for (const scenario of meaningfulSystemCases) {
      const result = await buildMeaningfulSystem(page, scenario, async () => { await page.reload(); await page.getByRole("button", { name: "Systems", exact: true }).click(); await expect(page.getByRole("heading", { name: "Systems", exact: true })).toBeVisible(); }, value => recordMeaningfulJourney(test.info(), scenario.id, value));
      await test.info().attach(`meaningful-${scenario.id}`, { body: JSON.stringify(result), contentType: "application/json" });
      savedSystems.push(result.savedObservation);
    }
    await revisitMeaningfulSystems(page, savedSystems, value => recordMeaningfulJourney(test.info(), "revisit", value));
  } finally { await app.close(); }
});
