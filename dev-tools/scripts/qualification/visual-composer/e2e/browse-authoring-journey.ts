import { expect, type Page, type TestInfo } from "@playwright/test";
import { qualifyTechnicalAccessibility } from "./technical-accessibility";

/** Shared real-host journey: no model registration, worker calls or provider traffic. */
export async function completeBrowseAuthoringJourney(page: Page, name: string, reopen: () => Promise<void>, info: TestInfo) {
  await page.setViewportSize({width: 1440, height: 1000});
  await page.getByLabel("New system name").fill(name);
  await page.getByRole("button", {name: "Create system", exact: true}).click();
  await expect(page.getByRole("heading", {name: "Canvas", exact: true})).toBeVisible({timeout: 30_000});

  async function insert(search: string) {
    const trigger = page.getByRole("button", {name: /^Add an element inside /}).last();
    await expect(trigger).toBeEnabled({ timeout: 30_000 });
    await trigger.focus(); await trigger.press("Enter");
    const dialog = page.getByRole("dialog", {name: /^Add an element to /});
    const query = dialog.getByLabel("Search compatible elements");
    await expect(query).toBeFocused(); await query.fill(search);
    const expectedLabel = search === "page" ? "Page Shell" : "Card";
    const card = dialog.locator(".system-composer__asset-picker-card").filter({has: page.getByText(expectedLabel, {exact: true})}).first();
    await expect(card).toBeVisible({timeout: 30_000});
    const label = await card.locator("strong").innerText();
    const version = (await card.innerText()).match(/\/ v([0-9.]+)/)?.[1];
    expect(version).toBeTruthy();
    await card.focus(); await card.press("Enter");
    await expect(dialog).toBeHidden();
    const selected = page.locator('.system-composer__canvas-node[data-selected="true"]');
    await expect(selected).toHaveCount(1);
    const id = await selected.getAttribute("data-instance-id"); expect(id).toBeTruthy();
    const reference = await selected.locator(":scope > .system-composer__canvas-node-heading small").innerText();
    expect(reference.endsWith(`@${version}`)).toBe(true);
    await expect(page.getByRole("complementary", {name: "Composer details"})).toContainText(reference);
    return {id: id!, label, reference};
  }

  await insert("page");
  const added = await insert("card");
  const node = page.locator(`[data-instance-id="${added.id}"]`);
  await page.getByRole("button", {name: "Undo", exact: true}).press("Enter");
  await expect(node).toHaveCount(0);
  await page.getByRole("button", {name: "Redo", exact: true}).press("Enter");
  await expect(node).toHaveCount(1);
  const preview = page.getByRole("button", {name: "Preview UI", exact: true});
  await preview.click();
  const previewDialog = page.getByRole("dialog", {name: `${name} UI preview`});
  await expect(previewDialog).toBeVisible();
  await expect(previewDialog.locator(`[data-preview-instance="${added.id}"]`)).toBeVisible();
  await previewDialog.press("Escape"); await expect(previewDialog).toBeHidden(); await expect(preview).toBeFocused();
  await page.getByRole("button", {name: "Save and validate revision"}).click();
  await expect(page.getByText("Revision saved and validated.", {exact: true})).toBeVisible({timeout: 30_000});

  await reopen();
  await page.getByRole("tab", {name: "Compose", exact: true}).click();
  await page.getByRole("combobox", {name: "System", exact: true}).selectOption({label: name});
  await page.getByRole("button", {name: "Edit system", exact: true}).click();
  await expect(node).toHaveCount(1, {timeout: 30_000});
  await expect(node).toContainText(added.reference);
  await node.locator(":scope > .system-composer__canvas-node-heading button").first().click();
  await page.getByRole("tab", {name: "Layers", exact: true}).click();
  const tree = page.getByRole("tree", {name: "System asset hierarchy"});
  await expect(tree).toBeVisible();
  const firstItem = tree.getByRole("treeitem").first(); await firstItem.focus(); await firstItem.press("ArrowDown");
  await expect(tree.getByRole("treeitem").nth(1)).toBeFocused();
  const ownLabel = await firstItem.locator(":scope > span").first().innerText();
  await expect(firstItem).toHaveAccessibleName(ownLabel);
  await tree.locator(".system-composer__tree-toggle").first().click();
  await expect(firstItem).toBeFocused();
  await expect(firstItem).toHaveAccessibleName(ownLabel);
  await firstItem.press("ArrowRight");
  await expect(firstItem).toHaveAttribute("aria-expanded", "true");
  await expect(firstItem).toHaveAccessibleName(ownLabel);
  await firstItem.press("ArrowDown");
  await expect(tree.getByRole("treeitem").nth(1)).toBeFocused();

  await page.setViewportSize({width: 320, height: 1000});
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  for (const label of ["Preview UI", "Undo", "Redo", "Save and validate revision"]) {
    const control = page.getByRole("button", {name: label, exact: true});
    await control.scrollIntoViewIfNeeded(); await expect(control).toBeVisible();
    const box = await control.boundingBox(); expect(box).toBeTruthy(); expect(box!.x).toBeGreaterThanOrEqual(-1); expect(box!.x + box!.width).toBeLessThanOrEqual(321);
  }
  const add = page.getByRole("button", {name: /^Add an element inside /}).last();
  await add.scrollIntoViewIfNeeded(); await add.focus(); await add.press("Enter");
  const dialog = page.getByRole("dialog", {name: /^Add an element to /});
  await expect(dialog.getByLabel("Search compatible elements")).toBeFocused();
  const bounds = await dialog.boundingBox(); expect(bounds).toBeTruthy(); expect(bounds!.width).toBeLessThanOrEqual(320);
  await dialog.press("Escape"); await expect(add).toBeFocused();
  const accessibility = await qualifyTechnicalAccessibility(page, info);
  return {persistedInstanceId: added.id, exactReference: added.reference, viewportWidth: 320, accessibility};
}
