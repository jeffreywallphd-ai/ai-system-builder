import { expect, type Page, type TestInfo } from "@playwright/test";
import { captureTrainingHostFixture, trainingHostReport, trainingPublicId, TRAINING_HOST_PHASES, TRAINING_HOST_PHASE_TIMEOUT_MS, TRAINING_WORKSPACE_NAME } from "../model-training-oracles";

/** Serialized into the owned renderer. Return only admitted IDs, never paths or metadata. */
export async function readTrainingHostInventory(input: { workspaceId: string; baseModelRecordId: string; baseName: string; displayName: string; requestId: string }) {
  try {
    const invalid = () => new Error("The training registry read could not be confirmed.");
    const data = (object: unknown, key: string): unknown => {
      if (!object || typeof object !== "object" || Array.isArray(object)) throw invalid();
      const field = Object.getOwnPropertyDescriptor(object, key);
      if (!field || !("value" in field)) throw invalid();
      return field.value;
    };
    const id = (value: unknown): string => {
      if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{3,191}$/.test(value)) throw invalid();
      return value;
    };
    if (typeof input.workspaceId !== "string" || !/^workspace\.training-host\.[a-f0-9]{16}$/.test(input.workspaceId) ||
        input.baseName !== "Qualified Qwen 0.5B input" || input.displayName !== "Training host support adapter" ||
        typeof input.requestId !== "string" || input.requestId !== "" && id(input.requestId) !== input.requestId) throw invalid();
    id(input.baseModelRecordId);
    const api = (window as unknown as { desktopApi?: { listModels(request: { workspaceId: string }): Promise<unknown> } }).desktopApi;
    if (!api || typeof api.listModels !== "function") throw invalid();
    const response: unknown = await api.listModels({ workspaceId: input.workspaceId });
    if (data(response, "ok") !== true) throw invalid();
    const models = data(data(response, "value"), "models");
    if (!Array.isArray(models) || models.length < 1 || models.length > 2 || Reflect.ownKeys(models).length !== models.length + 1) throw invalid();
    let base = "";
    const generated: string[] = [];
    for (let i = 0; i < models.length; i++) {
      const slot = Object.getOwnPropertyDescriptor(models, String(i));
      if (!slot || !("value" in slot)) throw invalid();
      const row: unknown = slot.value, record = id(data(row, "modelRecordId"));
      const local = data(row, "localPath");
      if (data(row, "workspaceId") !== input.workspaceId || data(row, "serializationFormat") !== "safetensors" ||
          typeof local !== "string" || !local.trim() || local.length > 32768 || /[\0\r\n]/.test(local)) throw invalid();
      if (record === input.baseModelRecordId) {
        if (base || data(row, "displayName") !== input.baseName || data(row, "source") !== "local" ||
            data(row, "lifecycleStatus") !== "downloaded" || data(row, "artifactForm") !== "full-model") throw invalid();
        base = record;
      } else {
        if (generated.length || !input.requestId || data(row, "displayName") !== input.displayName ||
            data(row, "source") !== "generated" || data(row, "lifecycleStatus") !== "generated" ||
            data(row, "artifactForm") !== "adapter" || data(row, "generatedFromRunId") !== input.requestId) throw invalid();
        generated.push(record);
      }
    }
    if (!base) throw invalid();
    return { baseModelRecordId: base, generatedRecordIds: generated };
  } catch { throw new Error("The training registry read could not be confirmed."); }
}

/** All task effects use actual public controls; no fabricated training result. */
export async function qualifyDesktopTrainingJourney(page: Page, info: TestInfo, declaration: unknown) {
  const fixture = captureTrainingHostFixture(declaration, process.env.VISUAL_COMPOSER_QUALIFICATION_RUN_ID, process.env.VISUAL_COMPOSER_QUALIFICATION_SOURCE_REVISION);
  if (!fixture || info.project.name !== "packaged-desktop") throw new Error("The Desktop training prerequisites are invalid.");
  const phases: string[] = [];
  let failed = false;
  async function step(phase: typeof TRAINING_HOST_PHASES[number], action: () => Promise<void>) {
    if (TRAINING_HOST_PHASES[phases.length] !== phase) throw new Error("Unexpected training host phase.");
    await action(); phases.push(phase);
  }
  try {
    const switcher = page.getByLabel("Select current workspace", { exact: true });
    const trainTab = page.getByRole("tab", { name: "Train Model", exact: true });
    const manageTab = page.getByRole("tab", { name: "Manage Models", exact: true });
    const workflow = page.getByRole("list", { name: "Model training workflow", exact: true });
    const savedCard = page.getByRole("region", { name: "Managed models", exact: true }).locator("article").filter({ has: page.getByText(fixture.displayName, { exact: true }) });
    let requestId = "", savedId = "";
    const readRegistry = () => page.evaluate(readTrainingHostInventory, { workspaceId: fixture!.workspaceId,
      baseModelRecordId: fixture!.baseModelRecordId, baseName: "Qualified Qwen 0.5B input", displayName: fixture!.displayName, requestId });
    async function dismissNotifications() {
      const center = page.getByRole("dialog", { name: "Notifications", exact: true });
      if (await center.isVisible()) await center.getByRole("button", { name: "Close notifications", exact: true }).click();
    }
    async function refreshInventory() {
      await dismissNotifications(); await manageTab.click();
      const refresh = page.getByRole("button", { name: "Refresh Models", exact: true });
      await expect(refresh).toBeEnabled(); await refresh.click();
      // This only prepares the visible grid. The separate real read-only IPC
      // query below proves registry state; a stale grid cannot supply that proof.
      await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      await expect(refresh).toBeEnabled({ timeout: TRAINING_HOST_PHASE_TIMEOUT_MS });
      await expect(switcher).toHaveValue(fixture!.workspaceId);
      const baseCard = page.getByRole("region", { name: "Managed models", exact: true }).locator("article").filter({ has: page.getByText("Qualified Qwen 0.5B input", { exact: true }) });
      await expect(baseCard).toHaveCount(1);
    }
    await step("workspace-and-inputs-visible", async () => {
      await page.getByRole("button", { name: "Home", exact: true }).click();
      await expect(page.getByRole("heading", { name: TRAINING_WORKSPACE_NAME, exact: true })).toBeVisible({ timeout: TRAINING_HOST_PHASE_TIMEOUT_MS });
      await expect(switcher).toHaveValue(fixture.workspaceId);
      await page.getByRole("button", { name: "Models", exact: true }).click();
      await expect(page.getByRole("heading", { name: "Model Management", exact: true })).toBeVisible();
      await refreshInventory(); expect((await readRegistry()).generatedRecordIds).toEqual([]); await expect(savedCard).toHaveCount(0);
      await trainTab.click();
      for (const id of fixture.datasetArtifactIds) await expect(workflow.locator(`input[name="training-dataset"][value="${id}"]`)).toHaveCount(1);
    });
    await step("configuration-bounded", async () => {
      await workflow.getByRole("combobox", { name: /^Base model\b/ }).selectOption(fixture.baseModelRecordId);
      await expect(workflow.getByRole("combobox", { name: /^Base model\b/ })).toHaveValue(fixture.baseModelRecordId);
      for (const id of fixture.datasetArtifactIds) await workflow.locator(`input[name="training-dataset"][value="${id}"]`).check();
      await workflow.getByRole("combobox", { name: /^Training task\b/ }).selectOption("llm-instruction");
      await workflow.getByRole("combobox", { name: /^Method\b/ }).selectOption("lora");
      for (const [name, value] of [["Epochs", "1"], ["Max steps", "1"], ["Batch size", "1"], ["Sequence length", "64"], ["Seed", "7"]] as const) {
        await workflow.getByRole("textbox", { name: new RegExp(`^${name}\\b`) }).fill(value);
      }
      await workflow.getByRole("button", { name: /^Advanced training settings\b/ }).click();
      for (const [name, value] of [["LoRA rank", "1"], ["LoRA alpha", "2"], ["Grad accumulation", "1"]] as const) {
        await workflow.getByRole("textbox", { name: new RegExp(`^${name}\\b`) }).fill(value);
      }
      await workflow.getByRole("textbox", { name: /^Output model name\b/ }).fill(fixture.outputName);
      await workflow.getByRole("textbox", { name: /^Generated model display name\b/ }).fill(fixture.displayName);
      await workflow.getByRole("checkbox", { name: /^Store locally\b/ }).check();
      await workflow.getByRole("checkbox", { name: /^Publish to Hugging Face\b/ }).uncheck();
      await workflow.getByRole("checkbox", { name: /^Validate after training\b/ }).uncheck();
      await expect(workflow.getByRole("button", { name: "Start Training", exact: true })).toBeEnabled();
    });
    await step("training-accepted", async () => {
      await workflow.getByRole("button", { name: "Start Training", exact: true }).click();
      const key = `ai-system-builder.training-task.v1:${fixture.workspaceId}`;
      // Observe only the app's consumed opaque task identity. Never modify it.
      await expect.poll(async () => {
        const value = await page.evaluate(name => sessionStorage.getItem(name), key);
        try { requestId = trainingPublicId(value); return true; } catch { return false; }
      }, { timeout: TRAINING_HOST_PHASE_TIMEOUT_MS }).toBe(true);
      await dismissNotifications();
    });
    await step("private-review-pending", async () => {
      await expect(workflow.getByRole("button", { name: "Save model", exact: true })).toBeEnabled({ timeout: TRAINING_HOST_PHASE_TIMEOUT_MS });
      await expect(workflow.getByRole("button", { name: "Discard model", exact: true })).toBeEnabled();
      await expect(workflow.getByRole("status").filter({ hasText: "Training completed. Save or discard the trained model." })).toBeVisible();
      await expect(workflow.getByText(/^Generated model record:/)).toHaveCount(0);
    });
    await step("candidate-unregistered", async () => {
      await refreshInventory(); expect((await readRegistry()).generatedRecordIds).toEqual([]); await expect(savedCard).toHaveCount(0);
      await trainTab.click();
      await expect(workflow.getByRole("button", { name: "Save model", exact: true })).toBeEnabled({ timeout: TRAINING_HOST_PHASE_TIMEOUT_MS });
      expect(trainingPublicId(await page.evaluate(name => sessionStorage.getItem(name), `ai-system-builder.training-task.v1:${fixture.workspaceId}`))).toBe(requestId);
    });
    await step("explicit-save-completed", async () => {
      await workflow.getByRole("button", { name: "Save model", exact: true }).click();
      await expect(workflow.getByRole("status").filter({ hasText: /^Trained model saved\./ })).toBeVisible({ timeout: TRAINING_HOST_PHASE_TIMEOUT_MS });
      await expect(workflow.getByRole("button", { name: "Save model", exact: true })).toHaveCount(0);
      const ack = (await workflow.getByText(/^Generated model record:/).innerText()).replace(/\s+/g, " ").trim();
      const match = /^Generated model record: ([A-Za-z0-9][A-Za-z0-9._:-]{3,191}) · Training host support adapter$/.exec(ack);
      if (!match) throw new Error("The saved model acknowledgement is invalid.");
      savedId = trainingPublicId(match[1]);
      expect((await readRegistry()).generatedRecordIds).toEqual([savedId]);
    });
    async function readSavedRecord() {
      await refreshInventory(); await expect(savedCard).toHaveCount(1);
      await expect(savedCard).toContainText("generated | generated | adapter");
      await expect(savedCard).toContainText("Serialization: safetensors | Local files: available");
      await savedCard.getByRole("button", { name: "Details", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Model details", exact: true });
      const record = dialog.locator("dt").filter({ hasText: /^Record$/ }).locator("xpath=following-sibling::dd[1]");
      const value = trainingPublicId(await record.innerText());
      expect(value).toBe(savedId);
      await dialog.getByRole("button", { name: "Close model details", exact: true }).click();
      return value;
    }
    await step("record-reopened", async () => { expect(await readSavedRecord()).toBe(savedId); });
    await step("renderer-reload-preserved-record", async () => {
      await page.reload(); await expect(switcher).toHaveValue(fixture.workspaceId, { timeout: TRAINING_HOST_PHASE_TIMEOUT_MS });
      await page.getByRole("button", { name: "Models", exact: true }).click();
      expect((await readRegistry()).generatedRecordIds).toEqual([savedId]);
      expect(await readSavedRecord()).toBe(savedId);
    });
  } catch { failed = true; }
  const report = trainingHostReport(phases, failed), body = JSON.stringify(report);
  if (Buffer.byteLength(body) > 4096) throw new Error("The training host report exceeded its fixed bound.");
  try { await info.attach("training-host-ui", { body, contentType: "application/json" }); }
  catch { throw new Error(`Training host report unavailable; last phase: ${report.nextPhase}.`); }
  if (report.status !== "passed") throw new Error(`Training host phase did not complete: ${report.nextPhase}.`);
}
