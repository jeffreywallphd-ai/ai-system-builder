import { expect, type Locator, type Page } from "@playwright/test";
import { composerRegionAdd } from "./technical-accessibility";

const actionName = "Create request (service-request)";
const editor = (page: Page) => page.getByRole("region", { name: "Form Composer", exact: true });
const key = async (control: Locator) => { await control.focus(); await control.press("Enter"); };
const fillAndLeave = async (control: Locator, text: string) => { await control.fill(text); await control.press("Tab"); };
const fixtureFields = [
  { label: "Request title", kind: "Short text", record: "Title" },
  { label: "Estimated amount", kind: "Number", record: "Amount" },
  { label: "Request status", kind: "Choice", record: "Status" },
  { label: "Due date", kind: "Date and time", record: "Due date" },
] as const;
export const formPublicationFixture = Object.freeze({ intakePages: 8, intakeFields: 32, submitLimitMs: 15_000 });

async function addField(form: Locator, kind: string, label: string) {
  await form.getByRole("combobox", { name: "Field type", exact: true }).selectOption({ label: kind });
  await key(form.getByRole("button", { name: "Add field", exact: true }));
  await fillAndLeave(form.getByLabel("Field label", { exact: true }), label);
  await expect(form.getByRole("button", { name: label, exact: true })).toBeVisible();
}

async function addNewFormToGovernedDraft(page: Page, name: string, fixtureOperator: boolean) {
  await key(page.getByRole("tab", { name: "Compose", exact: true }));
  await page.getByLabel("System template", { exact: true }).selectOption({ label: "Secured data-entry application" });
  await page.getByLabel("Template system name", { exact: true }).fill(name);
  await key(page.getByRole("button", { name: "Create from template", exact: true }));
  const draft = page.getByRole("group", { name: "System draft editor" });
  await expect(draft).toHaveAttribute("aria-busy", "false", { timeout: 30_000 });
  if (fixtureOperator) {
    const inspector = page.getByRole("complementary", { name: "Composer details", exact: true });
    for (const policyName of ["Create policy", "List policy"]) {
      await inspector.getByRole("tab", { name: "Layers", exact: true }).click();
      const resource = inspector.getByRole("region", { name: "System resources & logic", exact: true })
        .getByRole("button", { name: policyName, exact: true });
      await resource.click();
      await inspector.getByRole("tab", { name: "Properties", exact: true }).click();
      const allowed = inspector.getByRole("textbox", { name: /^Allowed roles/ });
      await expect(inspector.getByRole("tab", { name: "Design", exact: true })).toBeVisible();
      for (const part of ["Design", "Data", "Events"]) {
        await inspector.getByRole("tab", { name: part, exact: true }).click();
        if (await allowed.isVisible()) break;
      }
      await expect(allowed).toBeVisible();
      const existing = JSON.parse(await allowed.inputValue());
      expect(Array.isArray(existing) && existing.every((role: unknown) => typeof role === "string")).toBe(true);
      await allowed.fill(JSON.stringify([...new Set([...existing, "operator"])]));
      await allowed.locator("..").getByRole("button", { name: "Apply JSON", exact: true }).click();
      await expect(allowed).toHaveValue(/operator/);
    }
  }
  const oldEditor = page.getByRole("button", { name: "Edit Form: Request form", exact: true });
  const node = oldEditor.locator("../..");
  await key(node.locator(":scope > .system-composer__canvas-node-heading > .system-composer__canvas-node-select"));
  await key(node.getByRole("button", { name: "Remove Request form", exact: true }));
  const remove = page.getByRole("dialog", { name: "Remove asset?" });
  await expect(remove.getByText(/All child assets will also be removed/)).toBeVisible();
  await key(remove.getByRole("button", { name: "Remove asset", exact: true }));
  await expect(oldEditor).toHaveCount(0);
  const card = page.locator('.system-composer__canvas-node[data-instance-id$=".form-card"]');
  await expect(card).toHaveCount(1);
  await key(composerRegionAdd(card, "content"));
  const add = page.getByRole("dialog", { name: /^Add an element to / });
  const search = add.getByLabel("Search compatible elements");
  await expect(search).toBeFocused();
  await search.fill("builtin.form.form");
  const result = add.locator(".system-composer__asset-picker-card");
  await expect(result).toHaveCount(1);
  await key(result);
  await expect(add).toBeHidden();
  await key(page.locator('.system-composer__canvas-node[data-selected="true"] > .system-composer__canvas-node-heading')
    .getByRole("button", { name: /^Edit Form:/ }));
  const form = editor(page);
  await expect(form).toBeVisible();
  await key(form.getByRole("button", { name: "New Form Page +", exact: true }));
  await expect(form.getByRole("tab", { name: "Page 1", exact: true })).toHaveAttribute("aria-selected", "true");
  return form;
}

export async function buildRecordForm(page: Page, name: string, branching: boolean, fixtureOperator = false) {
  const form = await addNewFormToGovernedDraft(page, name, fixtureOperator);
  for (const field of fixtureFields) {
    await addField(form, field.kind, field.label);
    await form.getByLabel("Required answer", { exact: true }).check();
    if (field.kind === "Choice") {
      await form.getByLabel("New option label", { exact: true }).fill("submitted");
      await key(form.getByRole("button", { name: "Add option", exact: true }));
    }
  }
  if (branching) {
    await addField(form, "Checkbox", "No details needed");
    await key(form.getByRole("button", { name: "New Form Page +", exact: true }));
    await fillAndLeave(form.getByLabel("Form page name", { exact: true }), "Optional notes");
    await addField(form, "Long text", "Private notes");
    await key(form.getByRole("tab", { name: "Page 1", exact: true }));
    await form.getByRole("combobox", { name: "Answer field", exact: true }).selectOption({ label: "No details needed" });
    await form.getByRole("combobox", { name: "Compare with", exact: true }).selectOption({ label: "Selected" });
    await form.getByRole("combobox", { name: "Go to form page", exact: true }).selectOption({ label: "Finish form" });
    await key(form.getByRole("button", { name: "Add route rule", exact: true }));
  } else {
    const fieldsPerPage = formPublicationFixture.intakeFields / formPublicationFixture.intakePages;
    for (let pageNumber = 2; pageNumber <= formPublicationFixture.intakePages; pageNumber++) {
      await key(form.getByRole("button", { name: "New Form Page +", exact: true }));
      await fillAndLeave(form.getByLabel("Form page name", { exact: true }), `Request section ${pageNumber}`);
      for (let field = 1; field <= fieldsPerPage; field++) {
        await addField(form, "Short text", `Optional detail ${pageNumber}.${field}`);
      }
    }
  }
  await key(form.getByText("After submission", { exact: true }));
  await form.getByRole("combobox", { name: "Record action", exact: true }).selectOption({ label: actionName });
  for (const field of [...fixtureFields, ...(branching ? [{ label: "Private notes", record: "Confidential notes" }] : [])]) {
    await form.getByRole("combobox", { name: "Form answer to send", exact: true }).selectOption({ label: field.label });
    await form.getByRole("combobox", { name: "Destination record field", exact: true }).selectOption({ label: field.record });
    await key(form.getByRole("button", { name: "Add mapping", exact: true }));
  }
  await key(form.getByRole("button", { name: "Set submission action", exact: true }));
  await key(page.getByRole("button", { name: "Save and validate revision", exact: true }));
  await expect(page.getByText("Revision saved and validated.", { exact: true })).toBeVisible({ timeout: 30_000 });
  return { entity: "service-request", name };
}

export async function publishRecordForm(page: Page, systemName: string) {
  const draft = page.getByRole("group", { name: "1. Edit an existing system", exact: true });
  const selected = draft.getByRole("combobox", { name: "System", exact: true });
  await expect(selected.locator("option:checked")).toHaveText(systemName);
  const systemId = await selected.inputValue();
  const managed = ["http:", "https:"].includes(new URL(page.url()).protocol);
  const prepare = managed ? page.waitForResponse(
    response => new URL(response.url()).pathname === "/api/systems/builds/preparation" && response.request().method() === "GET",
    { timeout: 120_000 },
  ).then(response => response.status(), () => undefined) : undefined;
  await key(page.getByRole("button", { name: "Build & test", exact: true }));
  const buildDialog = page.getByRole("dialog", { name: `Build & test ${systemName}`, exact: true });
  // The managed preparation call is asynchronous. Observe only bounded status and time.
  if (prepare) expect(await prepare).toBe(200);
  const build = buildDialog.getByRole("button", { name: "Build & test", exact: true });
  await expect(build).toBeEnabled({ timeout: 20_000 });
  await key(build);
  await expect(buildDialog.getByRole("heading", { name: "Build and checks completed" })).toBeVisible({ timeout: 60_000 });
  const reference = await buildDialog.locator("dt").filter({ hasText: /^Build reference$/ }).locator("..").locator("dd").textContent();
  expect(reference).toBeTruthy();
  await key(buildDialog.getByRole("button", { name: "Close", exact: true }));
  await key(page.getByRole("tab", { name: "Publish", exact: true }));
  const published = page.getByRole("tabpanel", { name: "Publish", exact: true });
  await published.getByRole("combobox", { name: "System", exact: true }).selectOption(systemId);
  await published.getByRole("combobox", { name: "Build version", exact: true }).selectOption(reference!);
  await key(published.getByRole("button", { name: "Publish build", exact: true }));
  const confirm = page.getByRole("dialog", { name: "Publish this build?", exact: true });
  await expect(confirm).toContainText(systemName);
  await key(confirm.getByRole("button", { name: "Publish", exact: true }));
  const open = published.getByRole("region", { name: "Published builds", exact: true })
    .getByRole("article").getByRole("button", { name: /^Open forms for build/ });
  await expect(open).toHaveCount(1, { timeout: 30_000 });
  const card = published.getByRole("region", { name: "Published builds", exact: true }).getByRole("article");
  await key(card.getByText("Release details", { exact: true }));
  const releaseId = await card.locator("dt").filter({ hasText: /^Release$/ }).locator("..").locator("dd").textContent();
  expect(releaseId).toMatch(/^system-release:[a-f0-9]{64}$/);
  return { open, releaseId: releaseId! };
}

export async function submitAndCheckRecord(page: Page, open: Locator, branching: boolean, verify: (outcome: "empty" | "created") => Promise<void>) {
  await key(open);
  const respond = page.getByRole("dialog", { name: "Published forms", exact: true });
  const reason = respond.getByRole("textbox", { name: /Request title/ });
  await expect(reason).toBeVisible({ timeout: 30_000 });
  const firstContinue = respond.getByRole("button", { name: "Next page", exact: true });
  await key(firstContinue);
  await expect(reason).toHaveAttribute("aria-invalid", "true");
  await expect(reason).toBeFocused();
  await expect(respond.getByRole("alert").first()).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(respond).toBeHidden();
  await expect(open).toBeFocused();
  await verify("empty");
  await key(open);
  await expect(reason).toBeVisible();
  await reason.fill(branching ? "Synthetic support request" : "Synthetic equipment request");
  await respond.getByRole("spinbutton", { name: /Estimated amount/ }).fill("125");
  await respond.getByRole("combobox", { name: /Request status/ }).selectOption({ label: "submitted" });
  await respond.getByLabel(/Due date/).fill("2026-11-30");
  if (branching) {
    await key(firstContinue);
    await respond.getByRole("textbox", { name: "Private notes", exact: true }).fill("Synthetic answer from skipped page");
    await key(respond.getByRole("button", { name: "Back", exact: true }));
    await respond.getByRole("checkbox", { name: "No details needed", exact: true }).press("Space");
    await expect(respond.getByRole("textbox", { name: "Private notes", exact: true })).toHaveCount(0);
  } else {
    for (let pageNumber = 2; pageNumber <= formPublicationFixture.intakePages; pageNumber++) {
      await key(firstContinue);
      await expect(respond.getByRole("textbox", { name: `Optional detail ${pageNumber}.1`, exact: true })).toBeVisible();
    }
  }
  const start = performance.now();
  await key(respond.getByRole("button", { name: "Submit form", exact: true }));
  const complete = respond.getByRole("status").filter({ hasText: "Your form was submitted." });
  await expect(complete).toBeVisible({ timeout: formPublicationFixture.submitLimitMs });
  await expect(complete).toBeFocused();
  const milliseconds = Math.round(performance.now() - start);
  await verify("created");
  await page.keyboard.press("Escape");
  await expect(open).toBeFocused();
  return milliseconds;
}
