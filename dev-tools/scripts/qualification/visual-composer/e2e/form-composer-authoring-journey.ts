import { mkdir, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, type Locator, type Page, type TestInfo } from "@playwright/test";

const editor = (page: Page) => page.getByRole("region", { name: "Form Composer", exact: true });
const key = async (control: Locator) => {
  await expect(control).toBeEnabled();
  await control.focus();
  await expect(control).toBeFocused();
  await control.press("Enter");
};
const fillAndLeave = async (control: Locator, text: string) => { await control.fill(text); await control.press("Tab"); };

export async function createFormWorkspace(page: Page, name = "Form qualification workspace") {
  const selection = page.getByLabel("Select current workspace");
  await key(page.getByRole("button", { name: "Create new workspace", exact: true }));
  await page.locator('input[name="workspaceName"]').fill(name);
  await key(page.getByRole("button", { name: "Create workspace", exact: true }));
  await expect(selection).toHaveValue(/^workspace\./, { timeout: 30_000 });
  await expect(page.locator(".workspace-create-form")).toHaveCount(0);
  return selection.inputValue();
}

async function createFormSystem(page: Page, name: string) {
  await key(page.getByRole("tab", { name: "Compose", exact: true }));
  await page.getByPlaceholder("Customer portal", { exact: true }).fill(name);
  await key(page.getByRole("button", { name: "Create form system", exact: true }));
  const form = editor(page);
  await expect(form.getByRole("heading", { name, exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(form.getByRole("tab", { name: "Page 1", exact: true })).toHaveAttribute("aria-selected", "true");
  return form;
}

export async function reopenFormSystem(page: Page, name: string) {
  await key(page.getByRole("tab", { name: "Manage", exact: true }));
  const row = page.getByRole("row").filter({ has: page.getByText(name, { exact: true }) });
  await expect(row).toHaveCount(1);
  await key(row.getByRole("button", { name: "Open in Compose", exact: true }));
  await expect(page.getByRole("tab", { name: "Compose", exact: true })).toHaveAttribute("aria-selected", "true");
  const draft = page.getByRole("group", { name: "System draft editor", exact: true });
  await expect(draft).toHaveAttribute("aria-busy", "false");
  await expect(draft).not.toHaveAttribute("disabled");
  await expect(editor(page).getByRole("heading", { name, exact: true })).toBeVisible({ timeout: 30_000 });
  return editor(page);
}

async function addField(form: Locator, kind: string, label: string) {
  await form.getByRole("combobox", { name: "Field type", exact: true }).selectOption({ label: kind });
  await key(form.getByRole("button", { name: "Add field", exact: true }));
  await expect(form.locator('.system-form-composer__element-heading button[aria-expanded="true"]')).toBeFocused();
  const appearance = form.getByRole("region", { name: "Element appearance" });
  await fillAndLeave(appearance.getByLabel("Field label", { exact: true }), label);
  const trigger = form.getByRole("button", { name: label, exact: true });
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  const panel = await trigger.getAttribute("aria-controls");
  expect(await trigger.evaluate((node, id) => Boolean(id && document.getElementById(id)?.closest("li")?.contains(node)), panel)).toBe(true);
}

async function newPage(form: Locator, title: string) {
  await key(form.getByRole("button", { name: "New Form Page +", exact: true }));
  await fillAndLeave(form.getByLabel("Form page name", { exact: true }), title);
  await expect(form.getByRole("tab", { name: title, exact: true })).toHaveAttribute("aria-selected", "true");
}

async function save(page: Page) {
  await key(page.getByRole("button", { name: "Save and validate revision", exact: true }));
  await expect(page.getByText("Revision saved and validated.", { exact: true })).toBeVisible({ timeout: 30_000 });
}

export async function exerciseFormAuthoring(page: Page) {
  const intake = await createFormSystem(page, "Equipment request");
  // The initial empty draft is already saved. Opening it from Manage must not
  // require a field, a manual save, or a global Form tab.
  await reopenFormSystem(page, "Equipment request");
  await expect(intake.getByRole("button", { name: "Remove form page", exact: true })).toHaveCount(0);
  await addField(intake, "Short text", "Request reason");
  await intake.getByRole("complementary", { name: "Properties" }).getByLabel("Required answer").check();
  await addField(intake, "Number", "Quantity");
  await fillAndLeave(intake.getByLabel("Minimum value"), "1");
  await fillAndLeave(intake.getByLabel("Maximum value"), "10");
  await addField(intake, "Checkbox", "I confirm the request");
  await key(intake.getByRole("button", { name: "Remove field: I confirm the request" }));
  const removal = page.getByRole("dialog", { name: "Remove field?" });
  await expect(removal).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(intake.getByRole("button", { name: "Remove field: I confirm the request" })).toBeFocused();
  await key(intake.getByRole("button", { name: "Preview form" }));
  const preview = page.getByRole("dialog");
  await key(preview.getByRole("button", { name: "Finish preview" }));
  const reason = preview.getByRole("textbox", { name: /Request reason/ });
  await expect(reason).toBeFocused();
  await expect(reason).toHaveAttribute("aria-invalid", "true");
  await reason.fill("Synthetic equipment request");
  const quantity = preview.getByRole("spinbutton", { name: "Quantity" });
  await quantity.fill("11");
  await key(preview.getByRole("button", { name: "Finish preview" }));
  await expect(quantity).toHaveAttribute("aria-invalid", "true");
  await quantity.fill("3");
  await key(preview.getByRole("button", { name: "Finish preview" }));
  await expect(preview.getByText(/Answers included: Request reason, Quantity/)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(intake.getByRole("button", { name: "Preview form" })).toBeFocused();
  await save(page);
  await reopenFormSystem(page, "Equipment request");
  await expect(intake.getByRole("button", { name: "Request reason", exact: true })).toBeVisible();
  await key(intake.getByRole("button", { name: "Back to Canvas" }));
  await expect(editor(page)).toBeHidden();
  await key(page.getByRole("button", { name: "Edit Form: Equipment request", exact: true }).first());
  await expect(intake.getByRole("button", { name: "Request reason", exact: true })).toBeVisible();

  const questionnaire = await createFormSystem(page, "Support questionnaire");
  await addField(questionnaire, "Checkbox", "Already resolved");
  await newPage(questionnaire, "Support details");
  await addField(questionnaire, "Long text", "Describe the issue");
  await questionnaire.getByLabel("Required answer").check();
  await questionnaire.getByRole("tab", { name: "Support details", exact: true }).focus();
  await page.keyboard.press("Home");
  await expect(questionnaire.getByRole("tab", { name: "Page 1", exact: true })).toBeFocused();
  await expect(questionnaire.getByRole("tab", { name: "Page 1", exact: true })).toHaveAttribute("aria-selected", "true");
  await questionnaire.getByRole("combobox", { name: "Answer field", exact: true }).selectOption({ label: "Already resolved" });
  await questionnaire.getByRole("combobox", { name: "Compare with", exact: true }).selectOption({ label: "Selected" });
  await questionnaire.getByRole("combobox", { name: "Go to form page", exact: true }).selectOption({ label: "Finish form" });
  await key(questionnaire.getByRole("button", { name: "Add route rule", exact: true }));
  await key(questionnaire.getByRole("button", { name: "Preview form", exact: true }));
  await key(preview.getByRole("button", { name: "Next page", exact: true }));
  await preview.getByRole("textbox", { name: /Describe the issue/ }).fill("Synthetic detail to exclude");
  await key(preview.getByRole("button", { name: "Back", exact: true }));
  await preview.getByRole("checkbox", { name: "Already resolved", exact: true }).press("Space");
  await key(preview.getByRole("button", { name: "Finish preview", exact: true }));
  await expect(preview.getByText(/Answers included: Already resolved/)).toBeVisible();
  await expect(preview.getByText(/Answers included:.*Describe the issue/)).toHaveCount(0);
  await page.keyboard.press("Escape");
  await save(page);
  await reopenFormSystem(page, "Support questionnaire");
  await expect(questionnaire.getByText(/Already resolved.*selected.*Finish form/)).toBeVisible();
  const firstPage = questionnaire.getByRole("tab", { name: "Page 1", exact: true });
  const detailPage = questionnaire.getByRole("tab", { name: "Support details", exact: true });
  await expect(firstPage).toBeEnabled();
  await firstPage.press("End");
  await expect(detailPage).toHaveAttribute("aria-selected", "true");
  await expect(detailPage).toBeFocused();
  await key(questionnaire.getByRole("button", { name: "Remove form page", exact: true }));
  const pageRemoval = page.getByRole("dialog", { name: "Remove form page?" });
  await expect(pageRemoval.getByText(/All child fields and controls will also be removed/)).toBeVisible();
  await key(pageRemoval.getByRole("button", { name: "Remove form page", exact: true }));
  await expect(questionnaire.getByRole("tab", { name: "Support details", exact: true })).toHaveCount(0);
  await key(questionnaire.getByRole("button", { name: "Undo", exact: true }));
  await expect(questionnaire.getByRole("tab", { name: "Support details", exact: true })).toBeVisible();
}

// Calibrated for one owned host, one test worker, local data, and 8 pages with
// 32 authored fields. These are feature budgets, not an app startup target.
const largeForm = Object.freeze({ pages: 8, fieldsPerPage: 4, samples: 5, limitsMs: { page: 1500, edit: 1500, validation: 1500 } });
const paint = (page: Page) => page.evaluate(() => new Promise<void>(resolve => {
  requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
}));

export async function exerciseLargerForm(page: Page) {
  const form = await createFormSystem(page, "Larger synthetic form");
  for (let n = 1; n <= largeForm.pages; n++) {
    if (n > 1) await newPage(form, `Part ${n}`);
    for (let m = 1; m <= largeForm.fieldsPerPage; m++) await addField(form, "Short text", `Question ${n}.${m}`);
    if (n === 1) await form.getByLabel("Required answer", { exact: true }).check();
  }
  const rows: { check: keyof typeof largeForm.limitsMs; milliseconds: number }[] = [];
  async function measure(check: keyof typeof largeForm.limitsMs, action: () => Promise<void>) {
    const begin = performance.now();
    await action(); await paint(page);
    rows.push({ check, milliseconds: Math.round(performance.now() - begin) });
  }
  for (let sample = 0; sample < largeForm.samples; sample++) {
    const tabs = form.getByRole("tablist", { name: "Form pages", exact: true });
    const first = tabs.getByRole("tab", { name: "Page 1", exact: true });
    const last = tabs.getByRole("tab", { name: "Part 8", exact: true });
    await key(last);
    await expect(last).toHaveAttribute("aria-selected", "true");
    await measure("page", async () => {
      await page.keyboard.press("Home");
      await expect(first).toHaveAttribute("aria-selected", "true");
      await expect(form.getByRole("button", { name: "Question 1.4", exact: true })).toBeVisible();
    });
    await key(form.getByRole("button", { name: "Question 1.4", exact: true }));
    const help = form.getByRole("textbox", { name: "Help text", exact: true });
    const helpText = `Synthetic instruction ${sample + 1}`;
    await measure("edit", async () => {
      await fillAndLeave(help, helpText);
      await expect(help).toHaveValue(helpText);
    });
    await key(last);
    await key(first);
    await key(form.getByRole("button", { name: "Question 1.4", exact: true }));
    await expect(form.getByRole("textbox", { name: "Help text", exact: true })).toHaveValue(helpText);
    await key(form.getByRole("button", { name: "Preview form", exact: true }));
    const preview = page.getByRole("dialog");
    await measure("validation", async () => {
      await key(preview.getByRole("button", { name: "Next page", exact: true }));
      const missing = preview.getByRole("textbox", { name: /Question 1\.4/ });
      await expect(missing).toHaveAttribute("aria-invalid", "true");
      await expect(missing).toBeFocused();
    });
    await page.keyboard.press("Escape");
  }
  // Preserve all samples and compare the observed maximum at this small sample
  // size rather than attaching an implied production p95.
  return { plan: largeForm, rows, passed: rows.every(row => row.milliseconds <= largeForm.limitsMs[row.check]) };
}

export async function recordFormAuthoringTimings(info: TestInfo, value: Awaited<ReturnType<typeof exerciseLargerForm>>) {
  await recordFormHostObservation(info, "authoring-timings", value);
}

/** Only pass fixed synthetic test counts, timings and result facts, never answer data. */
export async function recordFormHostObservation(info: TestInfo, kind: "authoring-timings" | "publication" | "native-zoom", value: object) {
  const run = process.env.VISUAL_COMPOSER_QUALIFICATION_RUN_ID;
  const source = process.env.VISUAL_COMPOSER_QUALIFICATION_SOURCE_REVISION;
  if (!run || !/^[a-z0-9-]{20,80}$/.test(run) || !source || !/^source\.[a-f0-9]{64}$/.test(source) ||
      !["packaged-desktop", "managed-thin-chrome"].includes(info.project.name)) throw new Error("Form test identity is unavailable.");
  const body = JSON.stringify({ schemaVersion: "form-host-observation-v1", run, source, host: info.project.name, kind, value }) + "\n";
  if (Buffer.byteLength(body) > 4096) throw new Error("Form timing report exceeds its bound.");
  const parent = path.resolve("artifacts", "qualification", "visual-composer", "runs");
  await mkdir(parent, { recursive: true });
  if (await realpath(parent) !== parent) throw new Error("Form timing report directory is redirected.");
  const directory = path.join(parent, run);
  await mkdir(directory, { recursive: true });
  if (await realpath(directory) !== directory) throw new Error("Form timing report run is redirected.");
  await writeFile(path.join(directory, `form-${kind}.json`), body, { flag: "wx" });
  await info.attach(`form-${kind}`, { body, contentType: "application/json" });
}

export async function checkNarrowFormEditor(page: Page) {
  const original = page.viewportSize() ?? { width: 1440, height: 1000 };
  try {
    await page.setViewportSize({ width: 320, height: 900 });
    const form = editor(page);
    const addPage = form.getByRole("button", { name: "New Form Page +", exact: true });
    await expect(addPage).toBeEnabled();
    await addPage.focus();
    await expect(addPage).toBeFocused();
    await expect(form.getByRole("complementary", { name: "Properties", exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    const frame = await addPage.boundingBox();
    expect(Boolean(frame && frame.x >= -1 && frame.x + frame.width <= 321)).toBe(true);
  } finally {
    await page.setViewportSize(original);
  }
}
