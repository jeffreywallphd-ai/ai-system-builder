import { expect, type Page, type TestInfo } from "@playwright/test";
import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { qualifyCriticalSurfaceAccessibility } from "./critical-surface-accessibility";

const LABELS = ["INVOICE 4826", "ORDER 7259", "TOTAL 3648", "RECEIPT 9152", "REPORT 8374"];
const SCAN = "synthetic-scan.pdf";
const SAVED_BYTES_LIMIT = 65_536;

async function readFixtureSourceId(page: Page, workspace: string, host: "desktop" | "thin") {
  return page.evaluate(async ({ workspace, host, name, limit }) => {
    let envelope;
    if (host === "desktop") {
      envelope = await (window as any).desktopApi.browseArtifacts({ workspaceId: workspace });
    } else {
      const token = localStorage.getItem("ai-system-builder.paired-device-token");
      if (!token) throw new Error("The qualification connection is unavailable.");
      const response = await fetch("/api/artifact/browse", {
        method: "POST", redirect: "error",
        headers: { "content-type": "application/json", "x-client-source": "thin-client", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ workspaceId: workspace, source: "thin-client.artifact-browser" }),
      });
      if (!response.ok || !response.body) throw new Error("The source catalog could not be checked.");
      const reader = response.body.getReader(), chunks: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > limit) throw new Error("The qualification catalog exceeded its limit.");
          chunks.push(value);
        }
      } finally { await reader.cancel(); reader.releaseLock(); }
      const body = new Uint8Array(size); let offset = 0;
      for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
      try {
        envelope = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body));
      } catch {
        // Parser exceptions may quote input. Never forward their message/cause.
        throw new Error("The qualification catalog is not valid JSON.");
      }
    }
    const items = envelope?.ok === true && Array.isArray(envelope.value?.items) ? envelope.value.items : [];
    const selected = items.filter((item: any) => item.originalName === name);
    if (selected.length !== 1 || typeof selected[0].artifactId !== "string" ||
        !selected[0].artifactId || selected[0].artifactId.length > 1024) {
      throw new Error("The imported qualification source is not uniquely identified.");
    }
    return selected[0].artifactId as string;
  }, { workspace, host, name: SCAN, limit: SAVED_BYTES_LIMIT });
}

async function readSavedDataset(page: Page, workspace: string, host: "desktop" | "thin") {
  if (host === "desktop") {
    const ready = page.waitForEvent("download");
    await page.getByRole("dialog", { name: "Detail & preview", exact: true })
      .getByRole("button", { name: "Download artifact", exact: true }).click();
    const download = await ready;
    expect(download.suggestedFilename()).toBe("ocr-qualified-dataset.jsonl");
    const stream = await download.createReadStream();
    if (!stream) throw new Error("The saved qualification file is unavailable.");
    const chunks: Buffer[] = []; let size = 0;
    try {
      for await (const chunk of stream) {
        size += chunk.length;
        if (size > SAVED_BYTES_LIMIT) throw new Error("The saved qualification file exceeded its limit.");
        chunks.push(Buffer.from(chunk));
      }
    } finally { stream.destroy(); }
    expect(await download.failure() === null).toBe(true);
    return Buffer.concat(chunks, size);
  }
  const key = await page.getByText("Selected key", { exact: true })
    .evaluate(node => node.closest("dt")?.nextElementSibling?.textContent?.trim());
  if (!key || key.length > 4096) throw new Error("The saved qualification key is unavailable.");
  const bytes = await page.evaluate(async ({ key, workspace, limit }) => {
    const token = localStorage.getItem("ai-system-builder.paired-device-token");
    if (!token) throw new Error("The qualification connection is unavailable.");
    const query = new URLSearchParams({ storageKey: key, workspaceId: workspace, maximumBytes: String(limit) });
    const response = await fetch(`/api/artifact/media/view?${query}`, {
      method: "GET", redirect: "error",
      headers: { "x-client-source": "thin-client", Authorization: `Bearer ${token}` },
    });
    if (!response.ok || !response.body) throw new Error("The saved qualification file could not be read.");
    const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > limit) throw new Error("The saved qualification file exceeded its limit.");
        chunks.push(value);
      }
    } finally { await reader.cancel(); reader.releaseLock(); }
    const body = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
    return Array.from(body);
  }, { key, workspace, limit: SAVED_BYTES_LIMIT });
  return Buffer.from(bytes);
}

// Only generation is synthetic. Import, transports, task admission, native
// capture/recognition, curation, review and approval persistence remain real.
export async function qualifyOcrDatasetJourney(page: Page, info: TestInfo, host: "desktop" | "thin") {
  if ((host !== "desktop" && host !== "thin") || info?.project?.name !== (host === "desktop" ? "packaged-desktop" : "thin-chrome")) throw new Error("Unknown OCR host context.");
  async function auditOcrSurface(surface: "ocr-configuration" | "ocr-output-review") {
    await qualifyCriticalSurfaceAccessibility(page, info, surface);
    // Keep the OCR journey's original profile after the shared audit restores its base.
    await page.emulateMedia({ reducedMotion: "reduce", forcedColors: "none" });
    await page.setViewportSize({ width: 1280, height: 900 });
  }
  const runId = process.env.VISUAL_COMPOSER_QUALIFICATION_RUN_ID!;
  expect(runId).toMatch(/^[a-z0-9-]{20,80}$/);
  const folder = path.resolve("artifacts/qualification/visual-composer/runs", runId, "ocr-dataset");
  expect(await realpath(folder)).toBe(folder);
  const source = path.join(folder, SCAN);
  const stat = await lstat(source);
  expect(stat.isSymbolicLink()).toBe(false);
  expect(stat.size).toBeGreaterThan(0); expect(stat.size).toBeLessThanOrEqual(16 * 1024**2);
  const bytes = await readFile(source);
  const fixture = JSON.parse(await readFile(path.join(folder, "fixture.json"), "utf8"));
  expect(bytes.length).toBe(fixture.bytes);
  expect(createHash("sha256").update(bytes).digest("hex")).toBe(fixture.sha256);
  expect(fixture.pages).toBe(5);
  const workspace = await page.getByLabel("Select current workspace").inputValue();
  const started = performance.now();
  await page.getByRole("tab", { name: "Artifact Ingestion", exact: true }).click();
  const ingestion = page.getByRole("list", { name: "Add data workflow", exact: true });
  await expect(ingestion.getByLabel("Choose one or more files", { exact: true })).toHaveAttribute("accept", /application\/pdf/);
  await ingestion.getByLabel("Choose one or more files", { exact: true }).setInputFiles({ name: SCAN, mimeType: "application/pdf", buffer: bytes });
  await ingestion.getByRole("button", { name: "Add data", exact: true }).click();
  const notifications = page.getByRole("dialog", { name: "Notifications", exact: true });
  await expect(notifications.locator(".ui-notification__item").filter({ hasText: "All files are ready." })).toHaveCount(1, { timeout: 60_000 });
  await notifications.getByRole("button", { name: "Close notifications", exact: true }).click();
  const sourceArtifactId = await readFixtureSourceId(page, workspace, host);
  await page.getByRole("tab", { name: "Dataset Preparation", exact: true }).click();
  const sourceBox = () => host === "desktop"
    ? page.locator("label").filter({ has: page.getByText(SCAN, { exact: true }) }).getByRole("checkbox")
    : page.getByRole("checkbox", { name: SCAN, exact: true });
  await sourceBox().check();
  await page.getByRole("combobox", { name: host === "desktop" ? "How should the source material be divided?" : "Preparation method", exact: true }).selectOption("structure-aware");
  const enabled = page.getByRole("checkbox", { name: "Read text from scanned PDF pages", exact: true });
  const language = page.getByRole("textbox", { name: "Text recognition language", exact: true });
  await expect(enabled).not.toBeChecked();
  await enabled.focus(); await expect(enabled).toBeFocused();
  await page.keyboard.press("Space"); await expect(enabled).toBeChecked();
  await page.keyboard.press("Tab"); await expect(language).toBeFocused();
  await expect(language).toHaveValue(""); await expect(language).toHaveAttribute("maxlength", "35");
  await expect(language).toHaveAttribute("aria-describedby", /.+/);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 640, height: 900 });
  await expect(language).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await page.setViewportSize({ width: 1280, height: 900 });
  const model = page.getByRole("textbox", { name: host === "desktop" ? /^Model ID/ : /^Local generation model/ });
  if (host === "desktop" && !await model.isVisible()) {
    if (!await page.getByRole("button", { name: /Generation prompt/ }).isVisible()) await page.getByRole("button", { name: "Advanced settings", exact: true }).click();
    await page.getByRole("button", { name: /Generation prompt/ }).click();
  }
  await model.fill("qualification/synthetic-ocr");
  await page.getByRole("combobox", { name: /^Model device/ }).selectOption("cpu");
  await page.getByRole("combobox", { name: /^Torch dtype/ }).selectOption("float32");
  await page.getByLabel("Model memory mode", { exact: false }).selectOption("standard");
  if (host === "desktop") {
    const policy = page.getByRole("combobox", { name: /^When memory is full/ });
    await policy.selectOption("none"); await expect(policy).toHaveValue("none");
  }
  if (host === "desktop") {
    const output = page.getByRole("combobox", { name: "Output format", exact: true });
    if (!await output.isVisible()) await page.getByRole("button", { name: /Output file/ }).click();
    await output.selectOption("jsonl");
  } else {
    const output = page.getByLabel("Saved file format", { exact: false });
    if (!await output.isVisible()) await output.locator("xpath=ancestor::details[1]").locator("summary").click();
    await output.selectOption("jsonl");
  }
  const run = page.getByRole("button", { name: "Run checks and prepare", exact: true });
  const approve = page.getByRole("button", { name: "Approve and save dataset", exact: true });
  await auditOcrSurface("ocr-configuration");
  await language.fill("zz-ZZ"); await run.click();
  await expect(page.getByText(/Text recognition is unavailable\. Choose an installed Windows recognition language/).first()).toBeVisible({ timeout: 90_000 });
  await expect(approve).toHaveCount(0); await expect(language).toBeEnabled();
  await expect(language).toHaveValue("zz-ZZ");
  await language.fill("en-US"); await run.click();
  await expect(approve).toBeVisible({ timeout: 90_000 });
  const fact = (label: string) => page.getByText(label, { exact: true }).evaluate(node => node.nextElementSibling?.textContent?.trim());
  expect(await fact("Pages read")).toBe("5");
  expect(await fact("PDF files read")).toBe("1");
  expect(await fact("Text lines read")).toBe("5");
  await expect(page.getByText("Text character check", { exact: true })).toBeVisible();
  await expect(page.getByText(/This is not an OCR accuracy score/)).toBeVisible();
  const open = page.getByText("Open ready examples", { exact: true });
  await open.click();
  const review = page.getByRole("dialog", { name: /Review/ });
  await expect(review).toBeVisible();
  await auditOcrSurface("ocr-output-review");
  for (let i = 0; i < LABELS.length; i++) {
    await expect(review).toContainText(LABELS[i]!);
    if (i < LABELS.length - 1) await review.getByRole("button", { name: "Next", exact: true }).click();
  }
  await review.getByRole("button", { name: /Close/ }).click();
  await page.getByLabel("Dataset save name (optional)", { exact: false }).fill("ocr-qualified-dataset");
  await approve.click();
  await expect(page.getByRole("tab", { name: "Artifact Browser", exact: true })).toHaveAttribute("aria-selected", "true", { timeout: 30_000 });
  if (host === "thin") await page.getByRole("button", { name: "ocr-qualified-dataset.jsonl", exact: true }).click();
  const preview = host === "desktop" ? page.getByRole("dialog", { name: "Detail & preview", exact: true }) : page.locator("main");
  await expect(page.getByRole("heading", { name: "JSON Lines preview for ocr-qualified-dataset.jsonl", exact: true })).toBeVisible();
  await expect(preview).toContainText(LABELS[0]!);
  await expect(preview).toContainText("Preview truncated to keep the browser responsive.");
  const savedBytes = await readSavedDataset(page, workspace, host);
  expect(savedBytes.length > 0 && savedBytes.length <= SAVED_BYTES_LIMIT).toBe(true);
  let rows: any[];
  try {
    rows = new TextDecoder("utf-8", { fatal: true }).decode(savedBytes).trim().split(/\r?\n/).map(line => JSON.parse(line));
  } catch {
    throw new Error("The saved qualification file is not valid JSON Lines.");
  }
  expect(rows.length).toBe(5);
  expect(rows.every(row => row !== null && typeof row === "object" && !Array.isArray(row))).toBe(true);
  // Check complete bytes, never all rows in the intentionally capped preview.
  // Boolean assertions keep recognized text and storage identities out of errors.
  for (const [index, label] of LABELS.entries()) {
    const matches = rows.filter(row => row.answer === label);
    expect(matches.length).toBe(1);
    const row = matches[0]!;
    expect(row.sourceArtifactId === sourceArtifactId && row.sourceLineage?.sourceArtifactId === sourceArtifactId).toBe(true);
    expect(row.sourceLineage?.pageNumber === index + 1 && row.sourceLineage?.regionKind === "line").toBe(true);
  }
  if (host === "desktop") await preview.getByRole("button", { name: "Close detail and preview", exact: true }).click();
  await page.reload();
  await expect(page.getByLabel("Select current workspace")).toHaveValue(workspace, { timeout: 60_000 });
  await page.getByRole("button", { name: host === "desktop" ? "Data" : "Artifacts", exact: true }).click();
  await page.getByRole("tab", { name: "Artifact Browser", exact: true }).click();
  await expect(page.getByRole(host === "desktop" ? "heading" : "button", { name: "ocr-qualified-dataset.jsonl", exact: true })).toHaveCount(1);
  await page.getByRole("tab", { name: "Dataset Preparation", exact: true }).click();
  await sourceBox().check();
  await page.getByRole("combobox", { name: host === "desktop" ? "How should the source material be divided?" : "Preparation method", exact: true }).selectOption("structure-aware");
  await enabled.check(); await language.fill("en-US");
  if (host === "desktop" && !await model.isVisible()) {
    if (!await page.getByRole("button", { name: /Generation prompt/ }).isVisible()) await page.getByRole("button", { name: "Advanced settings", exact: true }).click();
    await page.getByRole("button", { name: /Generation prompt/ }).click();
  }
  await model.fill("qualification/synthetic-ocr-cancel");
  await page.getByRole("combobox", { name: /^Model device/ }).selectOption("cpu");
  await page.getByRole("combobox", { name: /^Torch dtype/ }).selectOption("float32");
  await page.getByLabel("Model memory mode", { exact: false }).selectOption("standard");
  if (host === "desktop") {
    const policy = page.getByRole("combobox", { name: /^When memory is full/ });
    await policy.selectOption("none"); await expect(policy).toHaveValue("none");
  }
  await run.click();
  await expect(page.getByText(/^Synthetic cancellation check is running\.(?: \(\d{1,2}\/\d{1,2}\))?$/).first()).toBeVisible({ timeout: 90_000 });
  await page.getByRole("button", { name: host === "desktop" ? "Stop training" : "Stop preparation", exact: true }).click();
  await expect(page.getByText(host === "desktop" ? "Training stopped." : "Dataset preparation stopped.", { exact: true }).first()).toBeVisible({ timeout: 30_000 });
  await expect(approve).toHaveCount(0); await expect(language).toBeEnabled();
  await model.fill("qualification/synthetic-ocr"); await run.click();
  await expect(approve).toBeVisible({ timeout: 90_000 });
  await page.getByRole("button", { name: "Discard dataset", exact: true }).click();
  await expect(run).toBeEnabled();
  await page.getByRole("button", { name: "Home", exact: true }).click();
  await page.getByRole("button", { name: "Create new workspace", exact: true }).click();
  await page.locator('input[name="workspaceName"]').fill(`Empty ${host} OCR workspace`);
  await page.getByRole("button", { name: "Create workspace", exact: true }).click();
  await expect(page.getByLabel("Select current workspace")).not.toHaveValue(workspace);
  await page.getByRole("button", { name: host === "desktop" ? "Data" : "Artifacts", exact: true }).click();
  await page.getByRole("tab", { name: "Dataset Preparation", exact: true }).click();
  await expect(sourceBox()).toHaveCount(0);
  const report = { schemaVersion: "real-ocr-dataset-host-journey-v1", host, status: "passed",
    sourceRevision: process.env.VISUAL_COMPOSER_QUALIFICATION_SOURCE_REVISION,
    fixtureSha256: fixture.sha256, pagesRead: 5, linesRead: 5, reviewedRows: 5,
    unavailableLanguageDenied: true, languageRetrySucceeded: true, keyboardLabelsAndFocus: true,
    savedRowsChecked: 5, originalSourceAndPageLineage: true, previewRemainsTruncated: true,
    savedArtifactBytes: savedBytes.length, savedArtifactSha256: createHash("sha256").update(savedBytes).digest("hex"),
    reducedMotionAnd640pxReflow: true, explicitApprovalAndReload: true,
    observedRunningCancellation: true, retryAndDiscard: true, otherWorkspaceSourceHidden: true,
    elapsedMilliseconds: performance.now() - started, generation: "fixed-synthetic-only",
    scope: "Real deployed task/native reader and host delivery. Synthetic generation does not qualify model accuracy. Native retirement is recorded by the fixed outer operator and actual worker exchange journals; viewport checks do not claim browser zoom qualification. No parent completion." };
  expect(report.sourceRevision).toMatch(/^source\.[a-f0-9]{64}$/);
  await mkdir(folder, { recursive: true });
  const body = JSON.stringify(report, null, 2) + "\n";
  expect(Buffer.byteLength(body)).toBeLessThanOrEqual(8192);
  await writeFile(path.join(folder, `${host}.json`), body, { flag: "wx" });
  await info.attach("real-ocr-dataset-host-journey", { body, contentType: "application/json" });
}
