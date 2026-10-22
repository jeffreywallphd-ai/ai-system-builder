import { expect, test, type Page } from "@playwright/test";
import { buildMeaningfulSystem, meaningfulSystemCases, observeComposerProtocol, recordMeaningfulJourney, revisitMeaningfulSystems } from "./meaningful-system-journeys";

const protocol = new WeakMap<Page, () => Promise<void>>();
test.beforeEach(async ({ page }, info) => { protocol.set(page, observeComposerProtocol(page, info)); });
test.afterEach(async ({ page }) => { await protocol.get(page)?.(); });

for (const scenario of meaningfulSystemCases) {
  test(`thin client builds ${scenario.name} from scratch and preserves useful controls`, async ({ page }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.addInitScript(token => localStorage.setItem("ai-system-builder.paired-device-token", token), process.env.VISUAL_COMPOSER_THIN_CLIENT_BEARER_TOKEN!);
    await page.goto(new URL("/systems", process.env.VISUAL_COMPOSER_THIN_CLIENT_ORIGIN!).href);
    const selectedWorkspace = page.getByLabel("Select current workspace");
    await expect(selectedWorkspace).toBeVisible();
    if (!(await selectedWorkspace.inputValue())) {
      await page.locator('input[name="workspaceName"]').fill("Browser meaningful systems");
      await page.getByRole("button", { name: "Create workspace", exact: true }).click();
    }
    await expect(page.getByRole("heading", { name: "Systems", exact: true })).toBeVisible();
    const result = await buildMeaningfulSystem(page, scenario, async () => { await page.reload(); await expect(page.getByRole("heading", { name: "Systems", exact: true })).toBeVisible(); }, value => recordMeaningfulJourney(test.info(), scenario.id, value));
    await test.info().attach("meaningful-system", { body: JSON.stringify(result), contentType: "application/json" });
  });
}

test("thin client revisits all useful systems after later systems have been created", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.addInitScript(token => localStorage.setItem("ai-system-builder.paired-device-token", token), process.env.VISUAL_COMPOSER_THIN_CLIENT_BEARER_TOKEN!);
  await page.goto(new URL("/systems", process.env.VISUAL_COMPOSER_THIN_CLIENT_ORIGIN!).href);
  await expect(page.getByLabel("Select current workspace")).toHaveValue(/^workspace\./);
  await revisitMeaningfulSystems(page, value => recordMeaningfulJourney(test.info(), "revisit", value));
});
