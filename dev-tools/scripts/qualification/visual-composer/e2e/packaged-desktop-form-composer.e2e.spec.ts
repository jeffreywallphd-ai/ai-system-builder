import { expect, test } from "@playwright/test";
import { _electron as electron, type ElectronApplication } from "playwright";
import { assetApplicationLifetime } from "../asset-experience-oracles";
import { checkNarrowFormEditor, createFormWorkspace, exerciseFormAuthoring, exerciseLargerForm, recordFormAuthoringTimings, recordFormHostObservation, reopenFormSystem } from "./form-composer-authoring-journey";
import { prepareFormDesktopProfile } from "./form-composer-desktop-profile";
import { buildRecordForm, formPublicationFixture, publishRecordForm, submitAndCheckRecord } from "./form-composer-publication-journey";
import { observeNativeFormControls } from "./form-composer-native-observation";
import { applyOwnedDesktopNativeZoom } from "./native-desktop-zoom";

process.env.PLAYWRIGHT_NO_COPY_PROMPT = "1";
test.use({ trace: "off", screenshot: "off", video: "off" });

test("packaged Desktop authors and reopens an intake and a branching form", async () => {
  test.setTimeout(360_000);
  const lifetime = assetApplicationLifetime<ElectronApplication>();
  try {
    const isolated = prepareFormDesktopProfile("authoring");
    const launch = () => electron.launch({ executablePath: isolated.executablePath,
      args: [`--user-data-dir=${isolated.dataRoot}`, "--disable-gpu"], env: isolated.env, timeout: 60_000 });
    const firstApp = await lifetime.launch(launch);
    const page = await firstApp.firstWindow({ timeout: 60_000 });
    await expect(page.getByRole("heading", { name: "Create a Workspace", exact: true })).toBeVisible({ timeout: 60_000 });
    const workspace = await createFormWorkspace(page);
    await page.getByRole("button", { name: "Systems", exact: true }).press("Enter");
    await test.step("Author and reopen the two forms", () => exerciseFormAuthoring(page));
    await test.step("Check form controls at 320 CSS pixels", () => checkNarrowFormEditor(page));
    const measurements = await test.step("Measure the larger form", () => exerciseLargerForm(page));
    await recordFormAuthoringTimings(test.info(), measurements);
    expect(measurements.passed).toBe(true);
    await lifetime.retire();
    const nextApp = await lifetime.launch(launch);
    const reopened = await nextApp.firstWindow({ timeout: 60_000 });
    expect(reopened).not.toBe(page);
    await expect(reopened.getByLabel("Select current workspace")).toHaveValue(workspace, { timeout: 30_000 });
    await reopened.getByRole("button", { name: "Systems", exact: true }).press("Enter");
    const intake = await reopenFormSystem(reopened, "Equipment request");
    await expect(intake.getByRole("button", { name: "Request reason", exact: true })).toBeVisible();
    const questionnaire = await reopenFormSystem(reopened, "Support questionnaire");
    await expect(questionnaire.getByRole("tab", { name: "Support details", exact: true })).toBeVisible();
  } finally { await lifetime.retire(); }
});

for (const variant of ["intake", "questionnaire"] as const) {
  test(`packaged Desktop publishes and submits the ${variant} into its released records`, async () => {
    test.setTimeout(300_000);
    const lifetime = assetApplicationLifetime<ElectronApplication>();
    try {
      const owned = prepareFormDesktopProfile(variant);
      const app = await lifetime.launch(() => electron.launch({ executablePath: owned.executablePath,
        args: [`--user-data-dir=${owned.dataRoot}`, "--disable-gpu"], env: owned.env, timeout: 60_000 }));
      const page = await app.firstWindow({ timeout: 60_000 });
      page.setDefaultTimeout(12_000);
      await expect(page.getByRole("heading", { name: "Create a Workspace", exact: true })).toBeVisible({ timeout: 60_000 });
      const workspaceId = await createFormWorkspace(page);
      await page.getByRole("button", { name: "Systems", exact: true }).press("Enter");
      const branching = variant === "questionnaire";
      const { entity, name } = await buildRecordForm(page, branching ? "Support questionnaire publication" : "Equipment request publication", branching);
      const { open, releaseId } = await publishRecordForm(page, name);
      const recordFacts = () => page.evaluate(async ({ workspaceId, releaseId, entityType, branching }) => {
        const bridge = (window as unknown as { desktopApi: { listSystemDataRecords(value: object): Promise<unknown> } }).desktopApi;
        const result = await bridge.listSystemDataRecords({ workspaceId, releaseId, entityType, limit: 2 }) as {
          ok?: boolean; value?: { total: number; items: { values: Record<string, unknown> }[] };
        };
        const record = result.value?.items?.[0]?.values;
        return { ok: result.ok === true, total: result.value?.total,
          exact: record?.title === (branching ? "Synthetic support request" : "Synthetic equipment request") &&
            record.amount === 125 && record.status === "submitted" && record.dueDate === "2026-11-30",
          noExtraValues: record !== undefined && Object.keys(record).length === 4 };
      }, { workspaceId, releaseId, entityType: entity, branching });
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
    } finally { await lifetime.retire(); }
  });
}

test("packaged Desktop Form Composer and preview reflow at actual 400 percent zoom", async () => {
  test.setTimeout(180_000);
  const lifetime = assetApplicationLifetime<ElectronApplication>();
  try {
    const owned = prepareFormDesktopProfile("native");
    const app = await lifetime.launch(() => electron.launch({ executablePath: owned.executablePath,
      args: [`--user-data-dir=${owned.dataRoot}`, "--disable-gpu"], env: owned.env, timeout: 60_000 }));
    const page = await app.firstWindow({ timeout: 60_000 });
    page.setDefaultTimeout(12_000);
    await expect(page.getByRole("heading", { name: "Create a Workspace", exact: true })).toBeVisible({ timeout: 60_000 });
    await createFormWorkspace(page);
    await page.getByRole("button", { name: "Systems", exact: true }).press("Enter");
    await exerciseFormAuthoring(page);
    await reopenFormSystem(page, "Equipment request");
    expect(await applyOwnedDesktopNativeZoom(app, page)).toBe(4);
    await recordFormHostObservation(test.info(), "native-zoom", await observeNativeFormControls(page));
  } finally { await lifetime.retire(); }
});
