import { expect, test, type Page } from "@playwright/test";
import { checkNarrowFormEditor, createFormWorkspace, exerciseFormAuthoring, exerciseLargerForm, recordFormAuthoringTimings, recordFormHostObservation, reopenFormSystem } from "./form-composer-authoring-journey";
import { buildRecordForm, formPublicationFixture, publishRecordForm, submitAndCheckRecord } from "./form-composer-publication-journey";
import { observeNativeFormControls } from "./form-composer-native-observation";
import { launchOwnedNativeZoomContext } from "../native-browser-zoom.mjs";

process.env.PLAYWRIGHT_NO_COPY_PROMPT = "1";
test.use({ trace: "off", screenshot: "off", video: "off" });

async function openManagedFormWorkspace(page: Page, name: string) {
  page.setDefaultTimeout(12_000);
  const origin = new URL(process.env.VISUAL_COMPOSER_THIN_CLIENT_ORIGIN ?? "");
  if (origin.protocol !== "http:" || origin.username || origin.password ||
      !["127.0.0.1", "localhost", "[::1]"].includes(origin.hostname)) throw new Error("An owned loopback managed host is required.");
  const token = process.env.VISUAL_COMPOSER_THIN_CLIENT_BEARER_TOKEN;
  if (!token) throw new Error("An owned managed session is required.");
  await page.addInitScript(({ value, expectedOrigin }) => { if (location.origin === expectedOrigin) localStorage.setItem("ai-system-builder.paired-device-token", value); }, { value: token, expectedOrigin: origin.origin });
  await page.goto(new URL("/", origin).href);
  await expect(page.getByLabel("Select current workspace")).toBeVisible({ timeout: 30_000 });
  const workspace = await createFormWorkspace(page, name);
  await page.goto(new URL("/systems", origin).href);
  await expect(page.getByLabel("Select current workspace")).toHaveValue(workspace, { timeout: 30_000 });
  return { workspace, origin };
}

test("managed browser authors and reopens an intake and a branching form", async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  const { workspace } = await openManagedFormWorkspace(page, "Form authoring qualification");
  await test.step("Author and reopen both forms", () => exerciseFormAuthoring(page));
  await test.step("Check the 320 CSS pixel viewport", () => checkNarrowFormEditor(page));
  const measurements = await test.step("Measure the larger form", () => exerciseLargerForm(page));
  await recordFormAuthoringTimings(test.info(), measurements);
  expect(measurements.passed).toBe(true);
  await page.reload();
  await expect(page.getByLabel("Select current workspace")).toHaveValue(workspace, { timeout: 30_000 });
  const intake = await reopenFormSystem(page, "Equipment request");
  await expect(intake.getByRole("button", { name: "Request reason", exact: true })).toBeVisible();
  const questionnaire = await reopenFormSystem(page, "Support questionnaire");
  await expect(questionnaire.getByRole("tab", { name: "Support details", exact: true })).toBeVisible();
});

for (const variant of ["intake", "questionnaire"] as const) {
  test(`managed browser publishes and submits the ${variant} into its released records`, async ({ page }) => {
    test.setTimeout(300_000);
    const { origin, workspace: workspaceId } = await openManagedFormWorkspace(page, `Form publication ${variant}`);
    const branching = variant === "questionnaire";
    const { entity, name } = await buildRecordForm(page, branching ? "Support questionnaire publication" : "Equipment request publication", branching, true);
    const { open, releaseId } = await publishRecordForm(page, name);
    const recordFacts = () => page.evaluate(async ({ expectedOrigin, workspaceId, releaseId, entityType, branching }) => {
      if (location.origin !== expectedOrigin) throw new Error("The fixture origin changed.");
      const token = localStorage.getItem("ai-system-builder.paired-device-token");
      if (!token) throw new Error("The fixture browser session is unavailable.");
      const query = new URLSearchParams({ workspaceId, releaseId, entityType, limit: "2" });
      const response = await fetch(`/api/systems/data/records?${query}`, {
        headers: { Authorization: `Bearer ${token}` }, redirect: "error",
      });
      if (!response.ok) return { ok: false, status: response.status };
      const result = await response.json() as { ok?: boolean; value?: { total: number; items: { values: Record<string, unknown> }[] } };
      const record = result.value?.items?.[0]?.values;
      return { ok: result.ok === true, total: result.value?.total,
        exact: record?.title === (branching ? "Synthetic support request" : "Synthetic equipment request") &&
          record.amount === 125 && record.status === "submitted" && record.dueDate === "2026-11-30",
        noExtraValues: record !== undefined && Object.keys(record).length === 4 };
    }, { expectedOrigin: origin.origin, workspaceId, releaseId, entityType: entity, branching });
    expect(await recordFacts()).toMatchObject({ ok: true, total: 0 });
    const milliseconds = await submitAndCheckRecord(page, open, branching, async outcome => {
      const facts = await recordFacts();
      if (outcome === "empty") expect(facts).toMatchObject({ ok: true, total: 0 });
      else expect(facts).toEqual({ ok: true, total: 1, exact: true, noExtraValues: true });
    });
    if (!branching) {
      await recordFormHostObservation(test.info(), "publication", { ...formPublicationFixture, milliseconds, exactRecords: 1 });
      expect(milliseconds).toBeLessThanOrEqual(formPublicationFixture.submitLimitMs);
    }
  });
}

test("managed browser Form Composer and preview reflow at actual 400 percent zoom", async () => {
  test.setTimeout(240_000);
  const owned = await launchOwnedNativeZoomContext(4);
  try {
    const page = owned.context.pages()[0];
    if (!page) throw new Error("The owned native browser page is unavailable.");
    await openManagedFormWorkspace(page, "Form native zoom qualification");
    await exerciseFormAuthoring(page);
    await reopenFormSystem(page, "Equipment request");
    await recordFormHostObservation(test.info(), "native-zoom", await observeNativeFormControls(page));
  } finally { await owned.close(); }
});
