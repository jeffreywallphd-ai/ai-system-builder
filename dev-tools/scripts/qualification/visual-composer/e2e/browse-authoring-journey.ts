import { readCriticalAccessibilityMode, type CriticalAccessibilityMode } from "../technical-accessibility-observation";
import { expect, type Locator, type Page, type TestInfo } from "@playwright/test";
import { collectNative400Frame, composerRegionAdd, qualifyTechnicalAccessibility } from "./technical-accessibility";
import { qualifyCriticalSurfaceAccessibility } from "./critical-surface-accessibility";

/** Shared real-host journey: no model registration, worker calls or provider traffic. */
export async function completeBrowseAuthoringJourney(
  page: Page, name: string, reopen: () => Promise<void>, info: TestInfo,
  mode: CriticalAccessibilityMode = "standard", scope: "accessibility" | "keyboard-placement" = "accessibility",
) {
  readCriticalAccessibilityMode(mode);
  const verifyPlacement = scope === "keyboard-placement";
  if (verifyPlacement && mode !== "standard") throw new Error("Keyboard placement uses the standard viewport case.");
  if (mode === "native400" && (!info?.project || (info.project.name !== "thin-chrome" && info.project.name !== "packaged-desktop"))) throw new Error("Unsupported native Assets and System host.");
  if (mode === "standard") await page.setViewportSize({width: 1440, height: 1000});
  await page.getByLabel("New system name").fill(name);
  await page.getByRole("button", {name: "Create system", exact: true}).click();
  await expect(page.getByRole("heading", {name: "Canvas", exact: true})).toBeVisible({timeout: 30_000});
  // Audit the settled Canvas. Notification presentation has its own journey.
  if (mode === "native400") {
    await expect(page.locator(".ui-notification__toast")).toHaveCount(0, {timeout: 10_000});
  }

  async function openDetails(panel: "Properties" | "Layers") {
    if (mode === "native400") {
      const button = page.getByRole("group", {name: "Responsive composer panels"})
        .getByRole("button", {name: panel, exact: true});
      if (await button.getAttribute("aria-expanded") !== "true") await button.press("Enter");
      await expect(button).toHaveAttribute("aria-expanded", "true");
    } else {
      const tab = page.getByRole("complementary", {name: "Composer details"})
        .getByRole("tab", {name: panel, exact: true});
      await tab.click();
      await expect(tab).toHaveAttribute("aria-selected", "true");
    }
  }

  let pickerAudited = false;
  async function insert(
    search: "page" | "card",
    trigger: Locator,
  ) {
    await expect(trigger).toBeEnabled({ timeout: 30_000 });
    await trigger.focus(); await trigger.press("Enter");
    const dialog = page.getByRole("dialog", {name: /^Add an element to /});
    const destination = dialog.getByLabel("Destination region");
    if (await destination.count()) await expect(destination).toHaveValue("content");
    const query = dialog.getByLabel("Search compatible elements");
    await expect(query).toBeFocused(); await query.fill(search);
    const expectedLabel = search === "page" ? "Page Shell" : "Card";
    const card = dialog.locator(".system-composer__asset-picker-card").filter({has: page.getByText(expectedLabel, {exact: true})}).first();
    await expect(card).toBeVisible({timeout: 30_000});
    const label = await card.locator("strong").innerText();
    const version = (await card.innerText()).match(/\/ v([0-9.]+)/)?.[1];
    expect(version).toBeTruthy();
    if (!verifyPlacement && !pickerAudited) {
      await qualifyCriticalSurfaceAccessibility(page, info, "system-element-picker", mode);
      pickerAudited = true;
    }
    await card.focus(); await card.press("Enter");
    await expect(dialog).toBeHidden();
    const selected = page.locator('.system-composer__canvas-node[data-selected="true"]');
    await expect(selected).toHaveCount(1);
    const id = await selected.getAttribute("data-instance-id"); expect(id).toBeTruthy();
    const reference = await selected.locator(":scope > .system-composer__canvas-node-heading small").innerText();
    expect(reference.endsWith(`@${version}`)).toBe(true);
    if (mode === "native400") await openDetails("Properties");
    await expect(page.getByRole("complementary", {name: "Composer details"})).toContainText(reference);
    return {id: id!, label, reference};
  }

  const mainContentAdd = page.getByRole("button", {name: /^Add element to Content in Main page$/i});
  const pageShell = await insert("page", mainContentAdd);
  const parent = page.locator(`[data-instance-id="${pageShell.id}"]`);
  const addToPageContent = composerRegionAdd(parent, "content");
  const added = await insert("card", addToPageContent);
  await openDetails("Properties");
  if (!verifyPlacement) await qualifyCriticalSurfaceAccessibility(page, info, "system-properties", mode);
  const node = page.locator(`[data-instance-id="${added.id}"]`);
  await page.getByRole("button", {name: "Undo", exact: true}).press("Enter");
  await expect(node).toHaveCount(0);
  await page.getByRole("button", {name: "Redo", exact: true}).press("Enter");
  await expect(node).toHaveCount(1);
  let nestedCardId: string | undefined;
  if (verifyPlacement) {
    const sibling = await insert("card", addToPageContent);
    await verifyKeyboardPlacement(page, parent, added.id, sibling.id);
    await verifyConfirmedRemoval(page, parent, added.id, sibling.id);
    nestedCardId = sibling.id;
  }
  const preview = page.getByRole("button", {name: "Preview UI", exact: true});
  await preview.click();
  const previewDialog = page.getByRole("dialog", {name: `${name} UI preview`});
  await expect(previewDialog).toBeVisible();
  await expect(previewDialog.locator(`[data-preview-instance="${added.id}"]`)).toBeVisible();
  if (!verifyPlacement) await qualifyCriticalSurfaceAccessibility(page, info, "system-preview", mode);
  await previewDialog.press("Escape"); await expect(previewDialog).toBeHidden(); await expect(preview).toBeFocused();
  await page.getByRole("button", {name: "Save and validate revision"}).click();
  await expect(page.getByText("Revision saved and validated.", {exact: true})).toBeVisible({timeout: 30_000});

  await reopen();
  await page.getByRole("tab", {name: "Compose", exact: true}).click();
  await page.getByRole("combobox", {name: "System", exact: true}).selectOption({label: name});
  await page.getByRole("button", {name: "Edit system", exact: true}).click();
  await expect(node).toHaveCount(1, {timeout: 30_000});
  await expect(node).toContainText(added.reference);
  if (nestedCardId) {
    await expect(node.locator(`[data-slot-id="content"] [data-instance-id="${nestedCardId}"]`)).toHaveCount(1);
  }
  await node.locator(":scope > .system-composer__canvas-node-heading button").first().click();
  await openDetails("Layers");
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
  if (!verifyPlacement) await qualifyCriticalSurfaceAccessibility(page, info, "system-layers", mode);

  if (mode === "standard") await page.setViewportSize({width: 320, height: 1000});
  const nativeFrame = mode === "native400" ? await collectNative400Frame(page) : undefined;
  if (nativeFrame) expect(nativeFrame.status).toBe("passed");
  const fitWidth = nativeFrame?.layoutWidth ?? 320;
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  for (const label of ["Preview UI", "Undo", "Redo", "Save and validate revision"]) {
    const control = page.getByRole("button", {name: label, exact: true});
    await control.scrollIntoViewIfNeeded(); await expect(control).toBeVisible();
    const box = await control.boundingBox(); expect(box).toBeTruthy(); expect(box!.x).toBeGreaterThanOrEqual(-1); expect(box!.x + box!.width).toBeLessThanOrEqual(fitWidth + 1);
  }
  const add = addToPageContent;
  await add.scrollIntoViewIfNeeded(); await add.focus(); await add.press("Enter");
  const dialog = page.getByRole("dialog", {name: /^Add an element to /});
  await expect(dialog.getByLabel("Search compatible elements")).toBeFocused();
  const bounds = await dialog.boundingBox(); expect(bounds).toBeTruthy(); expect(bounds!.width).toBeLessThanOrEqual(fitWidth);
  await dialog.press("Escape"); await expect(add).toBeFocused();
  const accessibility = verifyPlacement ? undefined : mode === "standard" ? await qualifyTechnicalAccessibility(page, info)
    : {mode: "native400", frame: nativeFrame, scope: "Frame fit only; the separate critical-surface reports contain the actual accessibility audits."};
  return {persistedInstanceId: added.id, exactReference: added.reference, viewportWidth: fitWidth, accessibility,
    ...(verifyPlacement ? {keyboardPlacement: {reordered: true, reparented: true, removalConfirmed: true}} : {})};
}

async function verifyConfirmedRemoval(page: Page, parent: Locator, cardId: string, childId: string) {
  const card = page.locator(`[data-instance-id="${cardId}"]`);
  const child = page.locator(`[data-instance-id="${childId}"]`);
  await card.locator(":scope > .system-composer__canvas-node-heading > .system-composer__canvas-node-select").press("Enter");
  const remove = card.locator(":scope > .system-composer__canvas-node-heading").getByRole("button", {name: /^Remove /});
  const dialog = page.getByRole("dialog", {name: "Remove asset?", exact: true});
  const cancel = dialog.getByRole("button", {name: "Cancel", exact: true});
  await remove.press("Enter");
  await expect(cancel).toBeFocused();
  await expect(dialog.getByText(/All child assets will also be removed/)).toBeVisible();
  await cancel.press("Enter");
  await expect(remove).toBeFocused();
  await expect(child).toBeVisible();
  await remove.press("Enter");
  await dialog.getByRole("button", {name: "Remove asset", exact: true}).press("Enter");
  await expect(card).toHaveCount(0);
  await expect(child).toHaveCount(0);
  await expect(parent.locator(":scope > .system-composer__canvas-node-heading > .system-composer__canvas-node-select")).toBeFocused();
  await page.getByRole("button", {name: "Undo", exact: true}).press("Enter");
  await expect(card.locator(`[data-instance-id="${childId}"]`)).toBeVisible();
}

async function verifyKeyboardPlacement(page: Page, parent: Locator, firstId: string, secondId: string) {
  const details = page.getByRole("complementary", {name: "Composer details"});
  const properties = details.getByRole("tab", {name: "Properties", exact: true});
  const layers = details.getByRole("tab", {name: "Layers", exact: true});
  await properties.press("End");
  await expect(layers).toBeFocused();
  await expect(layers).toHaveAttribute("aria-selected", "true");
  const second = page.locator(`[data-instance-id="${secondId}"]`);
  const source = parent.locator(":scope > .system-composer__slots > [data-slot-id]").filter({has: second});
  const children = source.locator(":scope > .system-composer__slot-content > .system-composer__canvas-node");
  const order = () => children.evaluateAll(nodes => nodes.map(node => node.getAttribute("data-instance-id")));
  await expect.poll(order).toEqual([firstId, secondId]);
  await details.getByRole("button", {name: "Move up", exact: true}).press("Enter");
  await expect.poll(order).toEqual([secondId, firstId]);
  await details.getByRole("button", {name: "Move down", exact: true}).press("Enter");
  await expect.poll(order).toEqual([firstId, secondId]);

  const destination = details.getByRole("combobox", {name: "Move to region", exact: true});
  const cardContent = `${firstId}|content`;
  const options = await destination.getByRole("option").evaluateAll(items =>
    items.map(item => (item as HTMLOptionElement).value));
  const destinationIndex = options.indexOf(cardContent);
  expect(destinationIndex).toBeGreaterThanOrEqual(0);
  expect(options.length).toBeLessThanOrEqual(64);
  await destination.press("Home");
  for (let index = 0; index < destinationIndex; index++) await destination.press("ArrowDown");
  await expect(destination).toHaveValue(cardContent);
  await details.getByRole("button", {name: "Move selected asset", exact: true}).press("Enter");
  const nestedContent = page.locator(`[data-instance-id="${firstId}"]`)
    .locator(':scope > .system-composer__slots > [data-slot-id="content"]');
  const expand = nestedContent.getByRole("button", {name: /^Expand .* region$/});
  if (await expand.isVisible()) await expand.press("Enter");
  await expect(nestedContent.locator(`[data-instance-id="${secondId}"]`)).toHaveCount(1);
  await expect.poll(order).toEqual([firstId]);
}
