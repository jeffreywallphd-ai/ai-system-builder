import { expect, test, type Page } from "@playwright/test";
import { SYSTEM_FOUNDATION_APPLICATION_LAYOUT_IDS } from "../../../../../modules/application/services/asset-packs/system-packs";
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

test("managed thin client changes Canvas layouts with the keyboard at narrow width", async ({page}) => {
  const reopen = await openManagedBrowseWorkspace(page);
  const name = "Managed layout selection";
  await page.setViewportSize({width: 320, height: 900});
  await page.getByLabel("New system name").fill(name);
  await page.getByRole("button", {name: "Create system", exact: true}).press("Enter");
  const canvas = page.getByRole("region", {name: "Canvas", exact: true});
  await expect(canvas).toBeVisible({timeout: 30_000});

  const toggle = page.locator('button[aria-controls="system-composer-layout-bar-content"]');
  await expect(toggle).toHaveAccessibleName("Show layouts");
  await expect(toggle).toBeEnabled();
  await toggle.focus();
  await expect(toggle).toBeFocused();
  await page.keyboard.press("Space");
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  const gallery = page.locator("#system-composer-layout-bar-content").locator("fieldset");
  await expect(gallery).toBeVisible();
  await expect(gallery).toHaveAccessibleName("Layout");
  const choices = gallery.getByRole("radio");
  await expect(choices).toHaveCount(SYSTEM_FOUNDATION_APPLICATION_LAYOUT_IDS.length);
  const layoutFor = (id: string) => gallery.locator(`input[type=radio][value="${id}"]`);
  const first = layoutFor(SYSTEM_FOUNDATION_APPLICATION_LAYOUT_IDS[0]);
  await expect(first).toBeChecked();
  const renderedIds = await choices.evaluateAll((inputs) => inputs.map((input) => (input as HTMLInputElement).value));
  expect([...renderedIds].sort()).toEqual([...SYSTEM_FOUNDATION_APPLICATION_LAYOUT_IDS].sort());
  const initialIndex = renderedIds.indexOf(SYSTEM_FOUNDATION_APPLICATION_LAYOUT_IDS[0]);
  const traversal = [...renderedIds.slice(initialIndex), ...renderedIds.slice(0, initialIndex)];
  await toggle.press("Tab");
  await expect(first).toBeFocused();
  for (const [index, id] of traversal.entries()) {
    const current = layoutFor(id);
    await expect(current).toBeChecked();
    await expect(canvas).toHaveAttribute("data-active-layout", id);
    await expect(current).toBeFocused();
    await expect(canvas.getByRole("button", {name: /^Add element to /}).first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    if (index < traversal.length - 1) await current.press("ArrowRight");
  }
  const last = traversal.at(-1)!;
  await toggle.press("Enter");
  await expect(gallery).toBeHidden();
  await page.getByRole("button", {name: "Save and validate revision", exact: true}).press("Enter");
  await expect(page.getByText("Revision saved and validated.", {exact: true})).toBeVisible({timeout: 30_000});
  await reopen();
  await page.getByRole("tab", {name: "Compose", exact: true}).click();
  await page.getByRole("combobox", {name: "System", exact: true}).selectOption({label: name});
  await page.getByRole("button", {name: "Edit system", exact: true}).press("Enter");
  await expect(canvas).toHaveAttribute("data-active-layout", last, {timeout: 30_000});

  const add = canvas.getByRole("button", {name: /^Add element to /}).first();
  await expect(add).toBeEnabled();
  await add.press("Enter");
  const picker = page.getByRole("dialog", {name: /^Add an element to /});
  await expect(picker.getByLabel("Search compatible elements")).toBeFocused();
  await picker.press("Escape");
  await expect(picker).toBeHidden();
  await expect(add).toBeFocused();
});
