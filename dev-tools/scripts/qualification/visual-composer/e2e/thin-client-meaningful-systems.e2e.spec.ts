import { expect, test, type Page } from "@playwright/test";
import { buildMeaningfulSystem, meaningfulSystemCases, observeComposerProtocol, recordMeaningfulJourney, revisitMeaningfulSystems } from "./meaningful-system-journeys";
import type { MeaningfulSystemObservation } from "../meaningful-system-oracles";

const protocol = new WeakMap<Page, () => Promise<void>>();
test.beforeEach(async ({ page }, info) => { protocol.set(page, observeComposerProtocol(page, info)); });
test.afterEach(async ({ page }) => { await protocol.get(page)?.(); });

test("thin client builds and revisits all three useful systems in its own workspace", async ({ page }) => {
    // Preserve the former three 180s cases plus the 120s revisit budget, serially.
    test.setTimeout(3 * 180_000 + 120_000);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.addInitScript(token => localStorage.setItem("ai-system-builder.paired-device-token", token), process.env.VISUAL_COMPOSER_THIN_CLIENT_BEARER_TOKEN!);
    const origin = process.env.VISUAL_COMPOSER_THIN_CLIENT_ORIGIN!;
    await page.goto(new URL("/", origin).href);
    const selectedWorkspace = page.getByLabel("Select current workspace");
    await expect(selectedWorkspace).toBeVisible();
    const createWorkspace = page.getByRole("button", {name: "Create new workspace", exact: true});
    await expect(createWorkspace).toBeVisible();
    const previousWorkspaceId = await selectedWorkspace.inputValue();
    await createWorkspace.click();
    await page.locator('input[name="workspaceName"]').fill("Browser meaningful systems");
    await page.getByRole("button", { name: "Create workspace", exact: true }).click();
    await expect(page.locator(".workspace-create-form")).toHaveCount(0);
    await expect(selectedWorkspace).toHaveValue(/^workspace\./);
    await expect(selectedWorkspace).not.toHaveValue(previousWorkspaceId);
    const createdWorkspaceId = await selectedWorkspace.inputValue();
    await expect(page.getByRole("heading", {name: "Browser meaningful systems", exact: true})).toBeVisible();
    await page.goto(new URL("/systems", origin).href);
    await expect(selectedWorkspace).toHaveValue(createdWorkspaceId);
    await expect(page.getByRole("heading", { name: "Systems", exact: true })).toBeVisible();
    const savedSystems: MeaningfulSystemObservation[] = [];
    for (const scenario of meaningfulSystemCases) {
    const result = await buildMeaningfulSystem(page, scenario, async () => { await page.reload(); await expect(page.getByRole("heading", { name: "Systems", exact: true })).toBeVisible(); }, value => recordMeaningfulJourney(test.info(), scenario.id, value));
    savedSystems.push(result.savedObservation);
    await test.info().attach(`meaningful-${scenario.id}`, { body: JSON.stringify(result), contentType: "application/json" });
    }
    await revisitMeaningfulSystems(page, savedSystems, value => recordMeaningfulJourney(test.info(), "revisit", value));
});
