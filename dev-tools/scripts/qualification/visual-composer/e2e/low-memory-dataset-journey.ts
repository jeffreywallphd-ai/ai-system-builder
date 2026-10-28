import { expect, type Page, type TestInfo } from "@playwright/test";
import { mkdir, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { qualifyCriticalSurfaceAccessibility } from "./critical-surface-accessibility";

// Real UI, host transport, authorization, staging, review and persistence.
// The finite worker produces synthetic rows; it cannot qualify model quality.
export async function qualifyLowMemoryDatasetJourney(page: Page, info: TestInfo, host: "desktop" | "thin") {
  const configure = async (reopened = false) => {
  await page.getByRole("tab", { name: "Dataset Preparation", exact: true }).click();
  await page.getByLabel("low-memory-source.txt", { exact: false }).check();
  const model = page.getByRole("textbox", { name: host === "desktop" ? /^Model ID/ : /^Local generation model/ });
  if (host === "desktop" && !await model.isVisible()) {
    const generation = page.getByRole("button", { name: /Generation prompt/ });
    if (!await generation.isVisible()) await page.getByRole("button", { name: "Advanced settings", exact: true }).click();
    await generation.click();
  }
  if (reopened) {
    await expect(model).toHaveValue("Qwen/Qwen2.5-1.5B-Instruct");
    await expect(page.getByRole("combobox", { name: /^Model device/ })).toHaveValue("cpu");
    await expect(page.getByRole("combobox", { name: /^Torch dtype/ })).toHaveValue("bfloat16");
    await expect(page.getByLabel("Model memory mode", { exact: false })).toHaveValue("offload-v1");
  }
  await model.fill("Qwen/Qwen2.5-1.5B-Instruct");
  if (host === "desktop") await page.getByRole("combobox", { name: /^Inference mode/ }).selectOption("chat");
  await page.getByRole("combobox", { name: /^Model device/ }).selectOption("cpu");
  await page.getByRole("combobox", { name: /^Torch dtype/ }).selectOption("bfloat16");
  const mode = page.getByLabel("Model memory mode", { exact: false });
  // Playwright's enabled assertion does not reflect an <option>'s native
  // disabled property. Never programmatically select an unavailable profile.
  await expect.poll(() => mode.locator('option[value="offload-v1"]').evaluate((option: HTMLOptionElement) => option.disabled), { timeout: 20000 }).toBe(false);
  await mode.selectOption("offload-v1");
  if (host === "desktop") {
    // The output controls are in a separately expandable section.
    const output = page.getByRole("combobox", { name: "Output format", exact: true });
    if (!await output.isVisible()) await page.getByRole("button", { name: /Output file/ }).click();
    await output.selectOption("jsonl");
    await page.getByRole("button", { name: "Save training settings", exact: true }).click();
  } else {
    const output = page.getByLabel("Saved file format", { exact: false });
    if (!await output.isVisible()) await output.locator("xpath=ancestor::details[1]").locator("summary").click();
    await output.selectOption("jsonl");
  }
  };
  await configure();
  await qualifyCriticalSurfaceAccessibility(page, info, "dataset-preparation");
  const model = page.getByRole("textbox", { name: host === "desktop" ? /^Model ID/ : /^Local generation model/ });
  const mode = page.getByLabel("Model memory mode", { exact: false });
  const run = page.getByRole("button", { name: "Run checks and prepare", exact: true });
  await expect.poll(() => mode.locator('option[value="offload-v1"]').evaluate((option: HTMLOptionElement) => option.disabled), { timeout: 15000 }).toBe(false);
  if (host === "desktop") {
    const readiness = await page.evaluate(async () => {
      const response = await (window as any).desktopApi.readPythonRuntimeStatus();
      return { ok: response.ok, healthy: response.value?.healthy, runtimeStatus: response.value?.runtimeStatus, generationCapacity: response.value?.generationCapacity, browserNow: Date.now(), renderedOptionalDisabled: document.querySelector<HTMLOptionElement>('option[value="offload-v1"]')?.disabled };
    });
    await info.attach("desktop-generation-readiness", { body: JSON.stringify(readiness), contentType: "application/json" });
  }
  await run.click();
  // Wait for the first task to settle before inspecting the center. Admission
  // opens it asynchronously; clicking the bell during admission can close it.
  await expect(run).toBeEnabled({ timeout: 30000 });
  // The center owns memory errors. A toast is another view of that same
  // record, so count records in the center rather than counting visible text.
  const bell = page.getByRole("button", { name: /^Notifications(?:,|$)/ });
  await expect(bell).toBeVisible({ timeout: 30000 });
  // Task admission opens the center itself. Toggling an already-open bell
  // would close the very view this journey needs to inspect.
  if (await bell.getAttribute("aria-expanded") !== "true") await bell.click();
  const center = page.getByRole("dialog", { name: "Notifications", exact: true });
  const memoryRecord = center.locator(".ui-notification__item").filter({ hasText: "Free at least 243 MiB of RAM" });
  await expect(memoryRecord).toHaveCount(1, { timeout: 30000 });
  await expect(memoryRecord).toContainText("available memory can change");
  await expect(center).not.toContainText("Synthetic resource denial");
  await expect(page.locator(".dataset-preparation__status").filter({ hasText: /memory|243 MiB/i })).toHaveCount(0);
  await expect(page.locator(".ui-status--error, .dataset-preparation__status").filter({ hasText: /Free at least 243 MiB|Synthetic resource denial/ })).toHaveCount(0);
  await expect(page.getByText(/Synthetic resource denial/)).toHaveCount(0);
  await center.getByRole("button", { name: "Close notifications", exact: true }).click();
  await expect(mode).toHaveValue("offload-v1");
  await expect(model).toHaveValue("Qwen/Qwen2.5-1.5B-Instruct");
  await run.click();
  const stop = page.getByRole("button", { name: host === "desktop" ? "Stop training" : "Stop preparation", exact: true });
  const statusText = (message: string) => host === "desktop" ? page.locator(".dataset-preparation__status").filter({ hasText: message }) : page.getByText(message, { exact: true });
  await expect(statusText("Synthetic dataset execution is running.")).toBeVisible({ timeout: 15000 });
  await expect(stop).toBeVisible();
  await stop.click();
  await expect(statusText("Cancellation is not confirmed. Dataset preparation is still being observed.")).toBeVisible();
  await expect(run).toBeHidden();
  await expect(page.getByRole("button", { name: "Approve and save dataset", exact: true })).toBeVisible({ timeout: 30000 });
  await expect(page.getByText("Open ready examples", { exact: true })).toBeVisible();
  await page.getByText("Open ready examples", { exact: true }).click();
  const review = page.getByRole("dialog", { name: /Review/ });
  await expect(review.getByText("Safe local dataset preparation.", { exact: false })).toBeVisible();
  await review.getByRole("button", { name: /Close/ }).click();
  await page.getByLabel("Dataset save name (optional)", { exact: false }).fill("optional-qualified-dataset");
  await page.getByRole("button", { name: "Approve and save dataset", exact: true }).click();
  await expect(page.getByRole("tab", { name: "Artifact Browser", exact: true })).toHaveAttribute("aria-selected", "true", { timeout: 30000 });
  if (host === "thin") {
    const artifact = page.getByRole("button", { name: "optional-qualified-dataset.jsonl", exact: true });
    await expect(artifact).toHaveCount(1); await artifact.click();
    await expect(page.getByRole("heading", { name: "JSON Lines preview for optional-qualified-dataset.jsonl", exact: true })).toBeVisible();
    await expect(page.getByText("Safe local dataset preparation.", { exact: false })).toBeVisible();
  } else {
    const artifact = page.getByRole("article").filter({ has: page.getByRole("heading", { name: "optional-qualified-dataset.jsonl", exact: true }) });
    await expect(artifact).toHaveCount(1);
    // Approval opens the saved artifact's existing detail dialog automatically.
    const detail = page.getByRole("dialog", { name: "Detail & preview", exact: true });
    await expect(detail).toBeVisible();
    await expect(detail.getByRole("heading", { name: "JSON Lines preview for optional-qualified-dataset.jsonl", exact: true })).toBeVisible();
    await expect(detail.getByText("Safe local dataset preparation.", { exact: false })).toBeVisible();
    await detail.getByRole("button", { name: "Close detail and preview", exact: true }).click();
  }
  await configure(true);
  await run.click();
  await expect(stop).toBeVisible(); await stop.click();
  await expect(statusText(host === "desktop" ? "Training stopped." : "Dataset preparation stopped.")).toBeVisible({ timeout: 15000 });
  await expect(mode).toHaveValue("offload-v1");
  await run.click();
  await expect(page.getByRole("button", { name: "Approve and save dataset", exact: true })).toBeVisible({ timeout: 30000 });
  await page.getByRole("button", { name: "Discard dataset", exact: true }).click();
  await expect(run).toBeEnabled();
  const report = { schemaVersion: "low-memory-dataset-host-journey-v1", status: "passed", host, sourceRevision: process.env.VISUAL_COMPOSER_QUALIFICATION_SOURCE_REVISION, resourceDenial: true, notificationCenter: true, notificationRecordCount: 1, measuredRamShortfallMiB: 243, inlineMemoryDuplicate: false, rawWorkerMessageExposed: false, sameSettingsRetry: true, runningCancellationNotClaimed: true, readyRowsReviewed: true, approvedArtifactVisible: true, queuedCancellationAndRetry: true, evidence: "real host plumbing with synthetic worker; model qualification separate" };
  const runId = process.env.VISUAL_COMPOSER_QUALIFICATION_RUN_ID!;
  expect(runId).toMatch(/^[a-z0-9-]{20,80}$/); expect(report.sourceRevision).toMatch(/^source\.[a-f0-9]{64}$/);
  const folder = path.resolve("artifacts/qualification/visual-composer/runs", runId, "low-memory-dataset");
  await mkdir(folder, { recursive: true }); expect(await realpath(folder)).toBe(folder);
  const body = JSON.stringify(report, null, 2) + "\n";
  expect(Buffer.byteLength(body)).toBeLessThanOrEqual(4096);
  await writeFile(path.join(folder, `${host}.json`), body, { flag: "wx" });
  await info.attach("low-memory-dataset-host-journey", { body, contentType: "application/json" });
}

export async function uploadLowMemorySource(page: Page, host: "desktop" | "thin" = "desktop") {
  if (host === "thin") {
    // The newer task-ingestion API is deliberately denied pending its own
    // security work. Seed through the existing write-authorized upload route.
    await expect(page.getByLabel("Select current workspace")).toHaveValue(/^workspace\./);
    const workspaceId = await page.getByLabel("Select current workspace").inputValue();
    const result = await page.evaluate(async workspaceId => {
      const response = await fetch("/api/artifact/upload", { method: "POST", headers: { authorization: `Bearer ${localStorage.getItem("ai-system-builder.paired-device-token")}`, "content-type": "application/json" }, body: JSON.stringify({ fileName: "low-memory-source.txt", mediaType: "text/plain", bytes: Array.from(new TextEncoder().encode("This synthetic source explains safe local dataset preparation and reviewing ready examples before saving a dataset.\n")), source: "qualification.synthetic-dataset", workspaceId }) });
      const body = await response.json();
      return { status: response.status, ok: body.ok, code: body.error?.code, message: body.error?.message };
    }, workspaceId);
    expect(result).toEqual({ status: 200, ok: true, code: undefined, message: undefined });
    return;
  }
  // Seed through the matching existing upload use case over trusted IPC.
  // Desktop Add data uses the distinct resumable ingestion feature, whose
  // missing source binding is a separately retained product finding.
  const workspaceId = await page.getByLabel("Select current workspace").inputValue();
  const result = await page.evaluate(async workspaceId => {
    const response = await (window as any).desktopApi.uploadArtifact({ workspaceId, fileName: "low-memory-source.txt", mediaType: "text/plain", bytes: new TextEncoder().encode("This synthetic source explains safe local dataset preparation and reviewing ready examples before saving a dataset.\n") });
    return { ok: response.ok, code: response.error?.code };
  }, workspaceId);
  expect(result).toEqual({ ok: true, code: undefined });
}
