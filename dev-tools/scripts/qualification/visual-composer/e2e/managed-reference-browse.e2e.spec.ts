import { expect, test } from "@playwright/test";
import { completeBrowseAuthoringJourney } from "./browse-authoring-journey";

test("managed PostgreSQL/OIDC thin client preserves complete browse authoring", async ({page}) => {
  const origin = process.env.VISUAL_COMPOSER_THIN_CLIENT_ORIGIN!;
  const token = process.env.VISUAL_COMPOSER_THIN_CLIENT_BEARER_TOKEN!;
  await page.addInitScript(value => localStorage.setItem("ai-system-builder.paired-device-token", value), token);
  await page.goto(new URL("/systems", origin).href);
  if(!await page.locator('input[name="workspaceName"]').isVisible()) {
    await page.getByRole("button",{name:"Home",exact:true}).click();
    await page.getByRole("button",{name:"Create new workspace",exact:true}).click();
  }
  await page.locator('input[name="workspaceName"]').fill("Managed reference workspace");
  await page.getByRole("button", {name: "Create workspace", exact: true}).click();
  await expect(page.getByRole("combobox", {name: "Select current workspace"}).locator("option:checked")).toHaveText("Managed reference workspace");
  await page.getByRole("navigation", {name: "Application areas"}).getByRole("button", {name: "Systems", exact: true}).click();
  await expect(page.getByRole("heading", {name: "Systems", level: 1, exact: true})).toBeVisible();
  await expect(page.getByLabel("New system name")).toBeVisible();
  const result = await completeBrowseAuthoringJourney(page, "Managed reference system", async () => {
    await page.reload(); await expect(page.getByRole("heading", {name: "Systems", level: 1, exact: true})).toBeVisible();
  }, test.info());
  await test.info().attach("managed-browse-journey", {body: JSON.stringify({...result, sourceRevision: process.env.VISUAL_COMPOSER_QUALIFICATION_SOURCE_REVISION, qualification: "controlled-managed-postgres-oidc"}), contentType: "application/json"});
});
