import {finalizeQualificationEvidence,type QualificationEvidenceReport} from "../qualification-reporting";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, type Locator, type Page, type TestInfo } from "@playwright/test";
import { canonicalMeaningfulSystem, assertMeaningfulSystemPreserved, assertMeaningfulSystemSet,
  type CanvasPropertyObservation, type MeaningfulSystemObservation } from "../meaningful-system-oracles";

interface ElementSpec { key: string; definition: string; parent: string; slot: string; properties?: Record<string, string | boolean>; }
export interface MeaningfulSystemCase { id: string; name: string; purpose: string; elements: readonly ElementSpec[]; }
const page: ElementSpec = { key: "page", definition: "builtin.shell.page", parent: "main-page", slot: "content" };
const card: ElementSpec = { key: "card", definition: "builtin.ui.card", parent: "page", slot: "content" };

/** These are compositions constructed by UI actions, not saved template fixtures. */
export const meaningfulSystemCases: readonly MeaningfulSystemCase[] = [
  {
    id: "request-intake", name: "Request intake", purpose: "Collect a required request, quantity and consent with native validation and a submit action.", elements: [page, card,
      { key: "form", definition: "builtin.form.form", parent: "card", slot: "content" },
      { key: "request", definition: "builtin.form.text-field", parent: "form", slot: "fields", properties: { label: "Request description", required: true } },
      { key: "quantity", definition: "builtin.form.number-field", parent: "form", slot: "fields", properties: { label: "Requested quantity" } },
      { key: "consent", definition: "builtin.form.checkbox-field", parent: "form", slot: "fields", properties: { label: "Confirm request", required: true } },
      { key: "submit", definition: "builtin.form.submit-action", parent: "form", slot: "actions", properties: { label: "Submit request" } },
    ]
  },
  {
    id: "operations-dashboard", name: "Operations dashboard", purpose: "Review tabular work, progress and status, and expand a detail region without losing layout or configuration.", elements: [page, card,
      { key: "table", definition: "builtin.display.table", parent: "card", slot: "content" },
      { key: "status", definition: "builtin.display.status-badge", parent: "card", slot: "content", properties: { label: "Queue status" } },
      { key: "progress", definition: "builtin.display.progress-indicator", parent: "card", slot: "content" },
      { key: "details", definition: "builtin.ui.collapsible-section", parent: "card", slot: "content", properties: { title: "Queue details" } },
      { key: "summary", definition: "builtin.display.key-value-summary", parent: "details", slot: "content" },
    ]
  },
  {
    id: "conversation-interface", name: "Conversation interface", purpose: "Compose a message input, submit control, transcript and response surface; distinguish editable preview behavior from unqualified inference.", elements: [page, card,
      { key: "history", definition: "conversation.message-history-display", parent: "card", slot: "content" },
      { key: "composer", definition: "conversation.message-composer", parent: "card", slot: "content" },
      { key: "message", definition: "builtin.form.text-area", parent: "composer", slot: "input", properties: { label: "Your question", required: true } },
      { key: "send", definition: "builtin.form.submit-action", parent: "composer", slot: "actions", properties: { label: "Send question" } },
      { key: "response", definition: "conversation.assistant-response-panel", parent: "card", slot: "content" },
      { key: "error", definition: "builtin.state.error-state", parent: "card", slot: "content" },
    ]
  },
];

/** Preserve progress per run as Playwright clears its transient output next run. */
export async function recordMeaningfulJourney(info: TestInfo, id: string, value: Record<string, unknown>) {
  const runId = process.env.VISUAL_COMPOSER_QUALIFICATION_RUN_ID;
  if (!runId || !/^[a-z0-9-]{20,80}$/.test(runId) || !["thin-chrome", "packaged-desktop"].includes(info.project.name) ||
    !(id === "revisit" || meaningfulSystemCases.some(scenario => scenario.id === id))) throw new Error("Invalid Canvas measurement identity.");
  const bytes = JSON.stringify(value, null, 2) + "\n";
  if (Buffer.byteLength(bytes) > 1024 * 1024) throw new Error("Canvas measurements exceed their bounded output size.");
  const folder = path.resolve(__dirname, "../../../../../artifacts/qualification/visual-composer/runs", runId, "canvas-journeys", info.project.name);
  await mkdir(folder, { recursive: true });
  await writeFile(path.join(folder, `${id}.json`), bytes);
  await writeFile(info.outputPath(`meaningful-${id}.json`), bytes);
}

function canvasNode(page: Page, id: string) { return page.locator(`.system-composer__canvas-node[data-instance-id="${id}"]`); }

/** Bounded protocol outcomes only: never persist headers, URLs or request/response payloads. */
export function observeComposerProtocol(page: Page, info: TestInfo) {
  const paths = new Set(["/api/systems/composer/assets", "/api/systems/composer/asset", "/api/systems/layout-change/preview", "/api/systems/revisions/save"]);
  const codes = new Set(["internal", "unavailable", "validation", "not-found", "conflict", "forbidden", "unauthenticated", "system-builder.composer-cursor-invalid"]);
  const rows: Record<string, string | number | boolean>[] = [];
  const pending: Promise<void>[] = [];
  let dropped = 0;
  const responseListener = (response: import("@playwright/test").Response) => {
    const url = new URL(response.url());
    if (!paths.has(url.pathname) || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || url.origin !== new URL(page.url()).origin) return;
    if (rows.length >= 256) { dropped += 1; return; }
    const row: Record<string, string | number | boolean> = { operation: url.pathname, status: response.status() };
    rows.push(row);
    const request = response.request();
    const post = request.postData();
    if (post && Buffer.byteLength(post) <= 512 * 1024 && request.method() === "POST") {
      try {
        const instances = JSON.parse(post)?.instances;
        if (Array.isArray(instances)) {
          const composers = instances.filter(item => item?.definitionRef?.id === "conversation.message-composer");
          row.modelComposerCount = composers.length;
          row.modelBindingPresent = composers.length > 0 && composers.every(item => Boolean(item?.selectedConfiguration?.modelBinding));
        }
      } catch { row.requestShapeUnavailable = true; }
    }
    // Express supplies a length for these JSON operations. Observe bounded,
    // unencoded bodies only, and project booleans/counts or fixed public codes.
    const headers = response.headers();
    const length = Number(headers["content-length"]);
    if (!Number.isSafeInteger(length) || length < 1 || length > 2 * 1024 * 1024 || headers["content-encoding"]) return;
    pending.push((async () => {
      try {
        const text = await response.text();
        if (Buffer.byteLength(text) > 2 * 1024 * 1024) return;
        const body = JSON.parse(text);
        row.ok = body?.ok === true;
        if (body?.ok === false) row.code = codes.has(body?.error?.code) ? body.error.code : "other";
        const items = body?.value?.items;
        if (Array.isArray(items)) {
          row.itemCount = items.length;
          const search = url.searchParams.get("searchText");
          if (search) row.requestedDefinitionReturned = items.some(item => item?.definitionId === search);
        }
        if (url.pathname === "/api/systems/composer/asset" && body?.ok === true) {
          row.identityMatches = body.value?.definitionId === url.searchParams.get("definitionId") && body.value?.version === url.searchParams.get("version");
        }
      } catch { row.responseShapeUnavailable = true; }
    })());
  };
  page.on("response", responseListener);
  return async () => {
    page.off("response", responseListener);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([Promise.allSettled(pending), new Promise(resolve => { timer = setTimeout(resolve, 3_000); })]);
    } finally { if (timer) clearTimeout(timer); }
    const body = JSON.stringify({ schemaVersion: "composer-protocol-outcomes-v1", rows, dropped });
    await info.attach("composer-protocol-outcomes", { body, contentType: "application/json" });
    await writeFile(info.outputPath("composer-protocol-outcomes.json"), body + "\n");
  };
}

async function waitForDraftReady(page: Page) {
  const editor = page.getByRole("group", { name: "System draft editor", exact: true });
  // A fieldset is not an enableable form control in Playwright. Assert its
  // actual readiness state before reading metadata-dependent Canvas structure.
  await expect(editor).toHaveAttribute("aria-busy", "false");
  await expect(editor).not.toHaveAttribute("disabled");
}
type PaintSample = { operation: "input" | "add" | "move" | "undo" | "redo" | "remove"; durationMs: number };
async function property(page: Page, field: string, value: string | boolean, samples: PaintSample[]) {
  const inspector = page.getByRole("complementary", { name: "Composer details" });
  await inspector.getByRole("tab", { name: "Properties", exact: true }).click();
  const control = inspector.locator(`[id="${field}"]`);
  for (const panel of ["Design", "Data", "Events"]) {
    await inspector.getByRole("tab", { name: panel, exact: true }).click();
    if (await control.isVisible()) {
      await measurePaint(page, samples, "input", async () => {
        if (typeof value === "boolean") await control.setChecked(value);
        else await control.fill(value);
      });
      return;
    }
  }
  throw new Error(`The selected component has no editable ${field} property.`);
}
async function insert(page: Page, parentId: string, element: ElementSpec, samples: PaintSample[]) {
  const parent = canvasNode(page, parentId);
  const trigger = parent.locator(":scope > .system-composer__canvas-node-heading").getByRole("button", { name: /^Add an element inside / });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: /^Add an element to / });
  await expect(dialog).toBeVisible();
  const search = dialog.getByLabel("Search compatible elements");
  await expect(search).toBeFocused();
  const destination = dialog.getByLabel("Destination region");
  if (await destination.count()) await destination.selectOption(element.slot);
  await search.fill(element.definition);
  const result = dialog.locator(".system-composer__asset-picker-card");
  // The user-facing cards display a label/type/version, not internal ids.
  // An exact-id query must produce one choice; verify its identity after insert.
  await expect(result).toHaveCount(1, { timeout: 15_000 });
  await expect(result).toBeVisible({ timeout: 15_000 });
  await measurePaint(page, samples, "add", () => result.click());
  await expect(dialog).toBeHidden();
  const selected = page.locator('.system-composer__canvas-node[data-selected="true"]');
  await expect(selected).toHaveCount(1);
  const id = await selected.getAttribute("data-instance-id"); expect(id).toBeTruthy();
  await expect(selected.locator(":scope > .system-composer__canvas-node-heading small")).toContainText(`${element.definition}@3.0.0`);
  for (const [field, value] of Object.entries(element.properties ?? {})) await property(page, field, value, samples);
  return id!;
}

async function exercisePurpose(dialog: Locator, scenario: MeaningfulSystemCase) {
  if (scenario.id === "request-intake") {
    const form = dialog.locator('[data-foundation-definition="builtin.form.form"]');
    await expect(form).toHaveCount(1);
    expect(await form.evaluate(element => (element as HTMLFormElement).checkValidity())).toBe(false);
    await expect(form.getByRole("textbox", { name: /^Request description \*$/ })).toHaveAttribute("required", "");
    await form.getByRole("textbox", { name: /^Request description \*$/ }).fill("Synthetic equipment request");
    await form.getByRole("spinbutton", { name: "Requested quantity", exact: true }).fill("3");
    // Consent must independently prevent submission after all other fields are valid.
    expect(await form.evaluate(element => (element as HTMLFormElement).checkValidity())).toBe(false);
    await expect(form.getByRole("checkbox", { name: "Confirm request", exact: true })).toHaveAttribute("required", "");
    await form.getByRole("checkbox", { name: "Confirm request", exact: true }).check();
    expect(await form.evaluate(element => (element as HTMLFormElement).checkValidity())).toBe(true);
    await expect(form.getByRole("spinbutton")).toHaveValue("3");
    await form.getByRole("button", { name: "Submit request", exact: true }).click();
    await expect(form.getByRole("textbox")).toHaveValue("Synthetic equipment request");
  } else if (scenario.id === "operations-dashboard") {
    await expect(dialog.getByRole("table")).toHaveCount(1);
    expect(await dialog.getByRole("columnheader").count()).toBeGreaterThan(0);
    await expect(dialog.getByRole("status").filter({ hasText: "Queue status" })).toBeVisible();
    await expect(dialog.getByRole("progressbar")).toBeVisible();
    const details = dialog.locator('[data-foundation-definition="builtin.ui.collapsible-section"]');
    const wasOpen = await details.getAttribute("open") !== null;
    await details.locator(":scope > summary").click();
    expect(await details.getAttribute("open") !== null).toBe(!wasOpen);
    await details.locator(":scope > summary").click();
    expect(await details.getAttribute("open") !== null).toBe(wasOpen);
  } else {
    const message = dialog.getByRole("textbox", { name: /^Your question \*$/ });
    await expect(message).toHaveAttribute("required", "");
    await message.fill("Summarize the synthetic request queue.");
    await expect(message).toHaveValue("Summarize the synthetic request queue.");
    await expect(dialog.locator('[data-foundation-definition="conversation.message-history-display"]')).toBeVisible();
    await expect(dialog.locator('[data-foundation-definition="conversation.assistant-response-panel"]')).toBeVisible();
    await dialog.getByRole("button", { name: "Send question", exact: true }).click();
    // This is a nonexecuting preview. Do not fabricate a model response or
    // treat the absence of a qualified runtime as successful inference.
    await expect(message).toHaveValue("Summarize the synthetic request queue.");
  }
}

export async function buildMeaningfulSystem(page: Page, scenario: MeaningfulSystemCase, reopen: () => Promise<void>, record: (value: Record<string, unknown>) => Promise<void>) {
  const errors: string[] = [];
  const pageError = () => errors.push("Uncaught browser error");
  let started: number | undefined;
  const paintSamples: PaintSample[] = [];
  let measurements: (Record<string, unknown> & QualificationEvidenceReport) | undefined;
  const failures: unknown[] = [];
  try {
    page.on("pageerror", pageError);
    started = performance.now();
    await startLongTasks(page);
    measurements = { schemaVersion: "meaningful-canvas-journey-v1", scenario: scenario.id, componentKinds: scenario.elements.map(e => e.definition), sourceRevision: process.env.VISUAL_COMPOSER_QUALIFICATION_SOURCE_REVISION, status: "running", phase: "create", addDurationsMs: [], paintSamples };
    await record(measurements);
    await page.getByLabel("New system name").fill(scenario.name);
    await page.getByRole("button", { name: "Create system", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Canvas", exact: true })).toBeVisible({ timeout: 30_000 });
    await waitForDraftReady(page);
    const canvasReadyMs = performance.now() - started;
    Object.assign(measurements, { canvasReadyMs, phase: "compose" });
    await record(measurements);
    const layoutId = await page.locator('.system-composer__canvas-node[data-layout-container="true"]').first().getAttribute("data-instance-id");
    expect(layoutId).toBeTruthy();
    const mainPageId = await page.locator('.system-composer__canvas-node[data-layout-container="true"]').last().getAttribute("data-instance-id");
    expect(mainPageId).toBeTruthy();
    const ids = new Map<string, string>([["layout", layoutId!], ["main-page", mainPageId!]]);
    const initialNodes = await readCanvasStructure(page);
    const addDurationsMs: number[] = [];
    for (const element of scenario.elements) {
      const parentId = ids.get(element.parent); expect(parentId).toBeTruthy();
      const start = performance.now(); ids.set(element.key, await insert(page, parentId!, element, paintSamples));
      addDurationsMs.push(performance.now() - start);
      Object.assign(measurements, { addDurationsMs: [...addDurationsMs] });
      await record(measurements);
    }
    expect(new Set(scenario.elements.map(e => e.definition)).size).toBeGreaterThanOrEqual(6);
    const last = scenario.elements[scenario.elements.length - 1]!;
    const lastNode = canvasNode(page, ids.get(last.key)!);
    const lastEditCount = 1 + Object.keys(last.properties ?? {}).length;
    for (let i = 0; i < lastEditCount; i++) await measurePaint(page, paintSamples, "undo", () => page.getByRole("button", { name: "Undo", exact: true }).click());
    await expect(lastNode).toHaveCount(0);
    for (let i = 0; i < lastEditCount; i++) await measurePaint(page, paintSamples, "redo", () => page.getByRole("button", { name: "Redo", exact: true }).click());
    await expect(lastNode).toHaveCount(1);
    await exerciseEditing(page, scenario, ids, paintSamples);
    await page.getByRole("button", { name: "Preview UI", exact: true }).click();
    let preview = page.getByRole("dialog", { name: `${scenario.name} UI preview` });
    const surface = preview.locator(".system-composition-preview__surface");
    for (const element of scenario.elements) {
      const parent = surface.locator(`[data-preview-instance="${ids.get(element.parent)}"]`).first();
      await expect(parent.locator(`[data-slot="${element.slot}"] [data-preview-instance="${ids.get(element.key)}"]`)).toHaveCount(1);
    }
    await expect(preview.locator(".foundation-preview--unsupported")).toHaveCount(0);
    await exercisePurpose(preview, scenario);
    await preview.press("Escape");
    const intendedNodes = await readCanvasStructure(page);
    for (const element of scenario.elements) {
      const current = intendedNodes.find(node => node.id === ids.get(element.key));
      expect(current).toMatchObject({ parent: ids.get(element.parent), slot: element.slot });
      expect(current!.reference).toBe(`${element.definition}@3.0.0`);
      const preceding = scenario.elements.filter(other => other.parent === element.parent && other.slot === element.slot).findIndex(other => other.key === element.key);
      const existing = initialNodes.filter(node => node.parent === ids.get(element.parent) && node.slot === element.slot).length;
      expect(current!.order).toBe(existing + preceding);
    }
    await page.getByRole("button", { name: "Save and validate revision", exact: true }).click();
    const expectsBlockedConversation = scenario.id === "conversation-interface";
    if (expectsBlockedConversation) {
      await expect(page.getByText(/Revision saved with \d+ blocking validation issues?\./)).toBeVisible({ timeout: 30_000 });
      await expect(page.locator(".system-builder__diagnostics").getByText('Required configuration field "modelBinding" is missing from selected configuration.', { exact: true })).toBeVisible();
    } else {
      await expect(page.getByText("Revision saved and validated.", { exact: true })).toBeVisible({ timeout: 30_000 });
    }
    Object.assign(measurements, { phase: "saved", validation: expectsBlockedConversation ? "blocked-required-model-and-interaction-authoring-unavailable" : "validated" });
    await record(measurements);
    const persistedNodes = await readCanvasStructure(page);
    expect(persistedNodes).toEqual(intendedNodes);
    const savedObservation = await observeMeaningfulSystem(page, scenario, ids);
    await exerciseCheckedBuild(page, scenario);
    measurements.editingLongTasks = await finishLongTasks(page);
    const reopenStarted = performance.now();
    await reopen();
    await startLongTasks(page);
    await page.getByRole("tab", { name: "Compose", exact: true }).click();
    await page.getByRole("combobox", { name: "System", exact: true }).selectOption({ label: scenario.name });
    await page.getByRole("button", { name: "Edit system", exact: true }).click();
    await expect(lastNode).toHaveCount(1, { timeout: 30_000 });
    measurements.freshViewReopenMs = performance.now() - reopenStarted;
    await waitForDraftReady(page);
    const reopenedNodes = await readCanvasStructure(page);
    expect(reopenedNodes).toEqual(persistedNodes);
    assertMeaningfulSystemPreserved(savedObservation, await observeMeaningfulSystem(page, scenario, ids));
    await page.getByRole("button", { name: "Preview UI", exact: true }).click();
    preview = page.getByRole("dialog", { name: `${scenario.name} UI preview` });
    await expect(preview.locator(".foundation-preview--unsupported")).toHaveCount(0);
    await exercisePurpose(preview, scenario);
    await preview.press("Escape");
    expect(errors).toEqual([]);
    measurements.reopenedLongTasks = await finishLongTasks(page);
    Object.assign(measurements, { status: "passed", phase: "reopened", persistedInstanceCount: persistedNodes.length, totalMs: performance.now() - started, behavior: "actual-composed-preview-controls-and-save-reopen", build: scenario.id === "conversation-interface" ? "denied-invalid-composition" : scenario.id === "request-intake" ? "denied-missing-platform-policy" : "checked-build", runtimeQualification: "unavailable-custom-authoring-not-qualified" });
    return { ...measurements, savedObservation };
  } catch (error) { failures.push(error); }
  finally {
    try { await page.evaluate(() => (window as any).__canvasLongTasks?.observer?.disconnect()); }
    catch (error) { failures.push(error); }
    try { page.off("pageerror", pageError); } catch (error) { failures.push(error); }
    const report: Record<string,unknown> & QualificationEvidenceReport = measurements ?? {schemaVersion:"meaningful-canvas-journey-v1", scenario:scenario.id,
      componentKinds:scenario.elements.map(element => element.definition), sourceRevision:process.env.VISUAL_COMPOSER_QUALIFICATION_SOURCE_REVISION,
      status:"failed", phase:"setup", addDurationsMs:[], paintSamples};
    if (failures.length) report.totalMs = started === undefined ? 0 : performance.now() - started;
    await finalizeQualificationEvidence(report, failures, () => record(report), async () => undefined);
  }
  throw new Error("Meaningful system journey did not complete.");
}

async function observeMeaningfulSystem(page: Page, scenario: MeaningfulSystemCase, ids: Map<string, string>) {
  const properties: CanvasPropertyObservation[] = [];
  for (const element of scenario.elements) {
    for (const [field, value] of Object.entries(element.properties ?? {})) {
      const instanceId = ids.get(element.key); expect(instanceId).toBeTruthy();
      await canvasNode(page, instanceId!).locator(":scope > .system-composer__canvas-node-heading button").first().click();
      const inspector = page.getByRole("complementary", { name: "Composer details" });
      await inspector.getByRole("tab", { name: "Properties", exact: true }).click();
      const control = inspector.locator(`[id="${field}"]`);
      for (const panel of ["Design", "Data", "Events"]) {
        await inspector.getByRole("tab", { name: panel, exact: true }).click();
        if (await control.isVisible()) break;
      }
      if (typeof value === "boolean") await expect(control).toBeChecked({ checked: value });
      else await expect(control).toHaveValue(value);
      properties.push({instanceId: instanceId!, field, value: typeof value === "boolean" ? await control.isChecked() : await control.inputValue()});
    }
  }
  return canonicalMeaningfulSystem({schemaVersion: "meaningful-system-snapshot-v1", scenarioId: scenario.id,
    workspaceId: await page.getByLabel("Select current workspace").inputValue(),
    systemId: await page.getByRole("combobox", {name: "System", exact: true}).inputValue(),
    nodes: await readCanvasStructure(page), properties});
}

async function readCanvasStructure(page: Page) {
  return page.locator(".system-composer__canvas-node").evaluateAll(nodes => nodes.map(node => {
    const slot = node.parentElement?.closest(".system-composer__slot");
    return {
      id: node.getAttribute("data-instance-id"), reference: node.querySelector(":scope > .system-composer__canvas-node-heading small")?.textContent,
      parent: slot?.closest(".system-composer__canvas-node")?.getAttribute("data-instance-id") ?? null,
      slot: slot?.getAttribute("data-slot-id") ?? null,
      order: Array.from(node.parentElement?.children ?? []).filter(child => child.classList.contains("system-composer__canvas-node")).indexOf(node),
    };
  }).sort((a, b) => a.id!.localeCompare(b.id!)));
}

async function exerciseEditing(page: Page, scenario: MeaningfulSystemCase, ids: Map<string, string>, samples: PaintSample[]) {
  const before = await readCanvasStructure(page);
  const inspector = page.getByRole("complementary", { name: "Composer details" });
  const movable = scenario.elements.find(element => scenario.elements.filter(other => other.parent === element.parent && other.slot === element.slot).length > 1)!;
  const id = ids.get(movable.key)!;
  await canvasNode(page, id).locator(":scope > .system-composer__canvas-node-heading button").first().click();
  await inspector.getByRole("tab", { name: "Layers", exact: true }).click();
  await measurePaint(page, samples, "move", () => inspector.getByRole("button", { name: "Move down", exact: true }).click());
  const moved = (await readCanvasStructure(page)).find(node => node.id === id)!;
  expect(moved.order).toBe(before.find(node => node.id === id)!.order + 1);
  await measurePaint(page, samples, "undo", () => page.getByRole("button", { name: "Undo", exact: true }).click());
  expect(await readCanvasStructure(page)).toEqual(before);
  // Move to a different supported content region, then restore the original tree.
  await inspector.getByRole("combobox", { name: "Move to region", exact: true }).selectOption(`${ids.get("page")}|content`);
  await measurePaint(page, samples, "move", () => inspector.getByRole("button", { name: "Move selected asset", exact: true }).click());
  expect((await readCanvasStructure(page)).find(node => node.id === id)).toMatchObject({ parent: ids.get("page"), slot: "content" });
  await measurePaint(page, samples, "undo", () => page.getByRole("button", { name: "Undo", exact: true }).click());
  expect(await readCanvasStructure(page)).toEqual(before);
  // Removing a useful container must remove its descendants as one undoable edit.
  await canvasNode(page, ids.get("card")!).locator(":scope > .system-composer__canvas-node-heading button").first().click();
  await measurePaint(page, samples, "remove", () => inspector.getByRole("button", { name: "Remove selected subtree", exact: true }).click());
  for (const element of scenario.elements.filter(e => e.key !== "page")) await expect(canvasNode(page, ids.get(element.key)!)).toHaveCount(0);
  await measurePaint(page, samples, "undo", () => page.getByRole("button", { name: "Undo", exact: true }).click());
  expect(await readCanvasStructure(page)).toEqual(before);
}

async function exerciseCheckedBuild(page: Page, scenario: MeaningfulSystemCase) {
  await page.getByRole("button", { name: "Build & test", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: `Build & test ${scenario.name}`, exact: true });
  await expect(dialog).toBeVisible();
  const action = dialog.getByRole("button", { name: "Build & test", exact: true });
  if (scenario.id === "conversation-interface") {
    await expect(action).toBeDisabled();
    await expect(dialog.getByText("Not yet", { exact: true })).toBeVisible();
    await dialog.press("Escape");
  } else {
    await expect(action).toBeEnabled({ timeout: 30_000 });
    await action.click();
    if (scenario.id === "request-intake") {
      // Save validation alone cannot authorize mutation. Nonvisual policy
      // authoring is not available in this editor; never seed it through API.
      await expect(dialog.getByRole("heading", { name: "Build needs attention", exact: true })).toBeVisible({ timeout: 60_000 });
      await expect(dialog.getByText("A mutating system requires at least one platform-enforced policy asset.", { exact: true })).toBeVisible();
      await expect(dialog.getByText("Nothing was published. Review the messages below before trying again.", { exact: true })).toBeVisible();
    } else {
      await expect(dialog.getByRole("heading", { name: "Build and checks completed", exact: true })).toBeVisible({ timeout: 60_000 });
    }
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
  }
}

async function measurePaint(page: Page, samples: PaintSample[], operation: PaintSample["operation"], action: () => Promise<unknown>) {
  const start = await page.evaluate(() => performance.now());
  await action();
  const end = await page.evaluate(() => new Promise<number>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(performance.now())))));
  if (samples.length >= 1024 || !Number.isFinite(end - start) || end < start) throw new Error("Canvas paint measurement is unavailable or exceeded its bound.");
  samples.push({ operation, durationMs: end - start });
}

async function startLongTasks(page: Page) {
  await page.evaluate(() => {
    const target = window as any;
    target.__canvasLongTasks?.observer?.disconnect();
    const state = { supported: typeof PerformanceObserver !== "undefined" && PerformanceObserver.supportedEntryTypes.includes("longtask"), durations: [] as number[], dropped: 0, observer: undefined as PerformanceObserver | undefined };
    if (state.supported) {
      state.observer = new PerformanceObserver(list => {
        for (const entry of list.getEntries()) {
          if (state.durations.length < 1024 && Number.isFinite(entry.duration)) state.durations.push(entry.duration);
          else state.dropped += 1;
        }
      });
      state.observer.observe({ type: "longtask", buffered: false });
    }
    target.__canvasLongTasks = state;
  });
}

async function finishLongTasks(page: Page) {
  return page.evaluate(() => {
    const state = (window as any).__canvasLongTasks;
    if (!state?.supported) return { status: "unavailable", count: null, dropped: null, totalMs: null, maximumMs: null };
    for (const entry of state.observer.takeRecords()) {
      if (state.durations.length < 1024 && Number.isFinite(entry.duration)) state.durations.push(entry.duration);
      else state.dropped += 1;
    }
    state.observer.disconnect();
    return { status: "measured", count: state.durations.length, dropped: state.dropped, totalMs: state.durations.reduce((sum: number, duration: number) => sum + duration, 0), maximumMs: Math.max(0, ...state.durations) };
  });
}

export async function revisitMeaningfulSystems(page: Page, expected: readonly MeaningfulSystemObservation[], record: (value: Record<string, unknown>) => Promise<void>) {
  const savedSystems = assertMeaningfulSystemSet(expected);
  const observations: Record<string, unknown>[] = [];
  for (let index = 0; index < meaningfulSystemCases.length; index += 1) {
    const scenario = meaningfulSystemCases[index]!;
    const saved = savedSystems.find(value => value.scenarioId === scenario.id)!;
    expect(await page.getByLabel("Select current workspace").inputValue()).toBe(saved.workspaceId);
    await startLongTasks(page);
    const start = performance.now();
    await page.getByRole("combobox", { name: "System", exact: true }).selectOption(saved.systemId);
    await page.getByRole("button", { name: "Edit system", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Canvas", exact: true })).toBeVisible({ timeout: 30_000 });
    await waitForDraftReady(page);
    await expect(page.locator(".system-composer__canvas-node")).toHaveCount(scenario.elements.length + 3);
    const readyMs = performance.now() - start;
    const ids = new Map<string, string>();
    for (const element of scenario.elements) {
      const matches = saved.nodes.filter(node => node.reference === `${element.definition}@3.0.0`);
      expect(matches).toHaveLength(1); ids.set(element.key, matches[0]!.id);
    }
    assertMeaningfulSystemPreserved(saved, await observeMeaningfulSystem(page, scenario, ids));
    await page.getByRole("button", { name: "Preview UI", exact: true }).click();
    const preview = page.getByRole("dialog", { name: `${scenario.name} UI preview`, exact: true });
    await expect(preview.locator(".foundation-preview--unsupported")).toHaveCount(0);
    await exercisePurpose(preview, scenario);
    await preview.press("Escape");
    observations.push({ scenario: scenario.id, mode: index === 0 ? "fresh-view" : "warm-system-switch", exactSavedIdentityStructureAndProperties: true, canvasReadyMs: readyMs, longTasks: await finishLongTasks(page) });
    const report = { schemaVersion: "meaningful-canvas-revisit-v1", status: index === meaningfulSystemCases.length - 1 ? "passed" : "running", sourceRevision: process.env.VISUAL_COMPOSER_QUALIFICATION_SOURCE_REVISION, observations };
    if (report.status === "passed") await finalizeQualificationEvidence(report, [], () => record(report), async () => undefined);
    else await record(report);
  }
}
