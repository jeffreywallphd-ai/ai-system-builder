import { expect, test, type Page } from "@playwright/test";
import { completeBrowseAuthoringJourney } from "./browse-authoring-journey";

async function openManagedBrowseWorkspace(page: Page) {
  const origin = process.env.VISUAL_COMPOSER_THIN_CLIENT_ORIGIN!;
  const token = process.env.VISUAL_COMPOSER_THIN_CLIENT_BEARER_TOKEN!;
  const workspaceName = "Managed reference workspace";
  page.setDefaultTimeout(10_000);
  page.setDefaultNavigationTimeout(30_000);
  await page.addInitScript(value => localStorage.setItem("ai-system-builder.paired-device-token", value), token);
  await page.goto(new URL("/", origin).href);
  const selected = page.getByLabel("Select current workspace");
  await expect(selected).toBeVisible();
  const previous = await selected.inputValue();
  await page.getByRole("button", {name: "Create new workspace", exact: true}).click();
  await page.locator('input[name="workspaceName"]').fill(workspaceName);
  await page.getByRole("button", {name: "Create workspace", exact: true}).click();
  await expect(page.locator(".workspace-create-form")).toHaveCount(0);
  await expect(selected).toHaveValue(/^workspace\./);
  await expect(selected).not.toHaveValue(previous);
  const workspaceId = await selected.inputValue();
  await expect(page.getByRole("heading", {name: workspaceName, exact: true})).toBeVisible();
  await page.goto(new URL("/systems", origin).href);
  await expect(selected).toHaveValue(workspaceId);
  await expect(page.getByRole("heading", {name: "Systems", level: 1, exact: true})).toBeVisible();
  await expect(page.getByLabel("New system name")).toBeVisible();
  return async () => {
    await page.reload();
    await expect(selected).toHaveValue(workspaceId);
    await expect(page.getByRole("heading", {name: "Systems", level: 1, exact: true})).toBeVisible();
  };
}

test("managed PostgreSQL/OIDC thin client preserves complete browse authoring", async ({page}) => {
  const reopen = await openManagedBrowseWorkspace(page);
  const result = await completeBrowseAuthoringJourney(page, "Managed reference system", reopen, test.info());
  await test.info().attach("managed-browse-journey", {body: JSON.stringify({...result, sourceRevision: process.env.VISUAL_COMPOSER_QUALIFICATION_SOURCE_REVISION, qualification: "controlled-managed-postgres-oidc"}), contentType: "application/json"});
});

test("managed thin client preserves keyboard placement from Canvas regions", async ({page}) => {
  const reopen = await openManagedBrowseWorkspace(page);
  const result = await completeBrowseAuthoringJourney(page, "Managed keyboard placement", reopen, test.info(), "standard", "keyboard-placement");
  await test.info().attach("managed-browse-journey", {body: JSON.stringify({...result, sourceRevision: process.env.VISUAL_COMPOSER_QUALIFICATION_SOURCE_REVISION, qualification: "controlled-managed-postgres-oidc"}), contentType: "application/json"});
});
