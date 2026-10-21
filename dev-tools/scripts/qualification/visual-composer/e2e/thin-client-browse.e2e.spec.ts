import { expect, test } from "@playwright/test";
import { completeBrowseAuthoringJourney } from "./browse-authoring-journey";

test("thin client preserves the complete browse authoring journey", async ({page}) => {
  test.setTimeout(120_000);
  const origin = process.env.VISUAL_COMPOSER_THIN_CLIENT_ORIGIN!;
  const token = process.env.VISUAL_COMPOSER_THIN_CLIENT_BEARER_TOKEN!;
  await page.addInitScript(value => localStorage.setItem("ai-system-builder.paired-device-token", value), token);
  await page.goto(new URL("/systems", origin).href);
  await page.locator('input[name="workspaceName"]').fill("Browse journey fixture");
  await page.getByRole("button", {name: "Create workspace", exact: true}).click();
  await expect(page.getByRole("heading", {name: "Systems", exact: true})).toBeVisible();
  const result = await completeBrowseAuthoringJourney(page, "Browser browse fixture", async () => {
    await page.reload(); await expect(page.getByRole("heading", {name: "Systems", exact: true})).toBeVisible();
  });
  await test.info().attach("browse-journey", {body: JSON.stringify({...result, sourceRevision: process.env.VISUAL_COMPOSER_QUALIFICATION_SOURCE_REVISION, qualification: "local-browser-fixture"}), contentType: "application/json"});
});
