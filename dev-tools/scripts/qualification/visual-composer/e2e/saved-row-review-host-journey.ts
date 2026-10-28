import { qualifyCriticalSurfaceAccessibility } from "./critical-surface-accessibility";
import { expect, type Page, type TestInfo } from "@playwright/test";
import { createHash } from "node:crypto";
import { mkdir, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import fixed from "../daily-row-review-fixture.json";
import { normalizeDatasetVersionId, type DatasetReviewPage, type DatasetVersionRecord } from "../../../../../modules/contracts/dataset";
import { normalizeStorageArtifactKey } from "../../../../../modules/contracts/storage";
import { readArtifact, readImportedSource, readVersions, selectProvidedOutput, type SourceIdentity } from "./provided-dataset-version-journey";

type Host = "desktop" | "thin";
type Values = Record<string, unknown> & { text: string; label: string };
const LIMIT = 65_536;
const INPUT = Buffer.from("text,label\n" + fixed.rows.map(row => `${row.text},${row.label}`).join("\n") + "\n");
const invalid = () => new Error("The saved row review did not match its expected data or history.");
const hash = (bytes: Uint8Array | string) => "sha256:" + createHash("sha256").update(bytes).digest("hex");
function record(value: unknown): Record<string, any> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalid();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(descriptors).length > 32 || Reflect.ownKeys(descriptors).some(key => typeof key !== "string" || !("value" in descriptors[key]!))) throw invalid();
  return value as Record<string, any>;
}
function text(value: unknown, limit = 4096): value is string { return typeof value === "string" && value.length > 0 && value.length <= limit; }
function canonical(value: unknown): unknown {
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical((value as Record<string, unknown>)[key])]));
  return value;
}
function fingerprint(values: Values) { return hash(JSON.stringify(canonical(values))); }

export function validateSavedRowPage(value: unknown, artifactKey: string, versionId: string, count: number): DatasetReviewPage {
  const page = record(value);
  if (page.artifactKey !== artifactKey || page.versionId !== versionId || page.page !== 0 || page.pageSize !== 10
      || page.totalRows !== count || !Array.isArray(page.rows) || page.rows.length !== count || ![7, 8].includes(count)) throw invalid();
  const rows = page.rows.map((value: unknown, index: number) => {
    const row = record(value), values = record(row.values);
    if (row.rowIndex !== index || row.editable !== true || !/^sha256:[a-f0-9]{64}$/.test(row.rowFingerprint)
        || Object.keys(values).some(key => !["text", "label", "sourceArtifactId", "sourceRowIndex", "sourceAttribution", "split"].includes(key))
        || !text(values.text, 1024) || !text(values.label, 64) || !text(values.sourceArtifactId, 1024)
        || !Number.isInteger(values.sourceRowIndex) || values.sourceRowIndex < 0 || values.sourceRowIndex >= 8
        || !["train", "validation", "test"].includes(values.split)) throw invalid();
    if (values.sourceAttribution !== undefined) {
      const attribution = record(values.sourceAttribution);
      if (Object.keys(attribution).sort().join(",") !== "sourceArtifactId,sourceName"
          || attribution.sourceArtifactId !== values.sourceArtifactId || attribution.sourceName !== fixed.source_name) throw invalid();
    }
    if (fingerprint(values as Values) !== row.rowFingerprint) throw invalid();
    return { rowIndex: index, rowFingerprint: row.rowFingerprint, values: Object.freeze({ ...values }), editable: true };
  });
  if (new Set(rows.map(row => row.rowFingerprint)).size !== count) throw invalid();
  return Object.freeze({ artifactKey: normalizeStorageArtifactKey(artifactKey), versionId: normalizeDatasetVersionId(versionId), page: 0, pageSize: 10, totalRows: count, rows });
}

// Public reads supply evidence. Every mutation below uses a visible control.
export async function readSavedRowPage(page: Page, host: Host, workspace: string, artifactKey: string, versionId: string, count: number) {
  if (!/^workspace\.[A-Za-z0-9._-]{1,128}$/.test(workspace) || !text(artifactKey) || !text(versionId, 256) || ![7, 8].includes(count)) throw invalid();
  const response = await page.evaluate(async ({ host, workspace, artifactKey, versionId, limit }) => {
    try {
      const input = { workspaceId: workspace, artifactKey, versionId, page: 0, pageSize: 10 };
      let envelope: any;
      if (host === "desktop") envelope = await (window as any).desktopApi.readDatasetReviewPage(input);
      else {
        const token = localStorage.getItem("ai-system-builder.paired-device-token"); if (!token) return { ok: false };
        const query = new URLSearchParams(Object.entries(input).map(([key, value]) => [key, String(value)]));
        const response = await fetch(`/api/dataset-reviews/page?${query}`, { method: "GET", redirect: "error", signal: AbortSignal.timeout(30_000),
          headers: { "x-client-source": "thin-client", authorization: `Bearer ${token}` } });
        if (!response.ok || !response.body || !/^application\/json(?:\s*;|$)/i.test(response.headers.get("content-type") ?? "")) { await response.body?.cancel(); return { ok: false }; }
        const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
        try { while (true) { const next = await reader.read(); if (next.done) break; size += next.value.byteLength;
          if (size > limit) return { ok: false }; chunks.push(next.value); }
        } finally { try { await reader.cancel(); } finally { reader.releaseLock(); } }
        const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
        envelope = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
      }
      if (envelope?.ok !== true || new TextEncoder().encode(JSON.stringify(envelope.value)).byteLength > limit) return { ok: false };
      return { ok: true, value: envelope.value?.page };
    } catch { return { ok: false }; }
  }, { host, workspace, artifactKey, versionId, limit: LIMIT }).catch(() => ({ ok: false }));
  if (!response.ok || !("value" in response)) throw invalid();
  return validateSavedRowPage(response.value, artifactKey, versionId, count);
}

export type RowEvidence = { version: DatasetVersionRecord; rows: DatasetReviewPage; bytes: Record<string, Buffer> };
export interface SavedRowSnapshot { workspace: string; originalWorkspace: string; source: SourceIdentity; evidence: RowEvidence[]; }
function artifact(version: DatasetVersionRecord, role: string) {
  const found = version.artifacts.filter(value => value.role === role); if (found.length !== 1) throw invalid(); return found[0]!;
}
export function validateSavedRowHistory(workspace: string, source: SourceIdentity, evidence: RowEvidence[], previous?: RowEvidence[]) {
  if (![1, 2, 3].includes(evidence.length) || (previous && evidence.length !== previous.length)) throw invalid();
  const first = evidence[0]!.version, ids = new Set<string>();
  for (let index = 0; index < evidence.length; index++) {
    const entry = evidence[index]!, version = entry.version, parent = evidence[index - 1];
    const count = index === 2 ? 7 : 8;
    if (version.workspaceId !== workspace || version.datasetId !== first.datasetId || ids.has(version.versionId)
        || version.documentation.name !== fixed.dataset_name || version.totalRows !== count
        || version.lineage.parentVersionId !== parent?.version.versionId
        || version.lineage.sources.length !== 1 || version.lineage.sources[0]!.sourceArtifactId !== source.artifactId
        || version.lineage.sources[0]!.artifactKey !== source.storageKey || version.lineage.sources[0]!.digest !== source.digest
        || version.lineage.sources[0]!.mediaType !== "text/csv") throw invalid();
    ids.add(version.versionId);
    const dataset = artifact(version, "dataset"), recipe = artifact(version, "recipe");
    if (dataset.mediaType !== "application/vnd.apache.parquet" || dataset.rowCount !== count
        || version.lineage.recipe.artifactKey !== recipe.artifactKey || version.lineage.recipe.digest !== recipe.digest) throw invalid();
    if (Object.keys(entry.bytes).sort().join(",") !== [...version.artifacts.map(item => item.artifactKey)].sort().join(",")) throw invalid();
    for (const item of version.artifacts) {
      const bytes = entry.bytes[item.artifactKey];
      if (!Buffer.isBuffer(bytes) || bytes.length < 1 || bytes.length > LIMIT || bytes.length !== item.sizeBytes || hash(bytes) !== item.digest) throw invalid();
    }
    const binary = entry.bytes[dataset.artifactKey]!;
    if (binary.length < 8 || binary.subarray(0, 4).toString() !== "PAR1" || binary.subarray(-4).toString() !== "PAR1") throw invalid();
    const page = validateSavedRowPage(entry.rows, dataset.artifactKey, version.versionId, count);
    const values = page.rows.map(row => row.values as Values);
    if (values.some(row => row.sourceArtifactId !== undefined && row.sourceArtifactId !== source.artifactId)) throw invalid();
    if (!parent) {
      if (!fixed.rows.every((expected, index) => values.filter(row => row.text === expected.text && row.label === expected.label && row.sourceRowIndex === index).length === 1)) throw invalid();
      const rootRecipe = JSON.parse(entry.bytes[recipe.artifactKey]!.toString("utf8"));
      if (rootRecipe.recipe?.task?.textInputMode !== "provided" || rootRecipe.recipe?.generation || rootRecipe.output?.format !== "parquet") throw invalid();
    } else {
      const old = parent.rows.rows.map(row => row.values as Values);
      const replacement = { ...old[0]!, text: old[0]!.text + fixed.edit_suffix };
      const expected = index === 1 ? [replacement, ...old.slice(1)] : old.filter((_, i) => i !== 1);
      if (JSON.stringify(values) !== JSON.stringify(expected)) throw invalid();
      const rowIndex = index === 1 ? 0 : 1, originalRowFingerprint = parent.rows.rows[rowIndex]!.rowFingerprint;
      const replacementFingerprint = index === 1 ? hash(JSON.stringify(replacement)) : undefined;
      const operation = index === 1 ? "dataset-row-edit" : "dataset-row-review";
      const expectedRecipe = { operation, parentVersionId: parent.version.versionId, rowIndex, originalRowFingerprint,
        ...(replacementFingerprint ? { replacementFingerprint } : {}) };
      const stored = JSON.parse(entry.bytes[recipe.artifactKey]!.toString("utf8"));
      if (JSON.stringify(Object.keys(stored).sort()) !== JSON.stringify(Object.keys(expectedRecipe).sort())
          || Object.entries(expectedRecipe).some(([key, value]) => stored[key] !== value)
          || version.lineage.recipe.implementationId !== (index === 1 ? "builtin.dataset-row-edit" : "builtin.dataset-row-review")
          || version.lineage.recipe.implementationVersion !== "1.0.0") throw invalid();
      const quality = version.lineage.quality, oldQuality = parent.version.lineage.quality;
      const report = hash(JSON.stringify({ operation: index === 1 ? "edit-row" : "reject-row", parentVersionId: parent.version.versionId,
        rowIndex, rowFingerprint: originalRowFingerprint, ...(replacementFingerprint ? { replacementFingerprint } : {}) }));
      if (quality.policyId !== oldQuality.policyId || quality.policyVersion !== oldQuality.policyVersion
          || quality.policyFingerprint !== oldQuality.policyFingerprint || quality.reportFingerprint !== report) throw invalid();
    }
    if (previous) {
      const old = previous[index]!;
      if (JSON.stringify(version) !== JSON.stringify(old.version) || JSON.stringify(page) !== JSON.stringify(old.rows)
          || Object.keys(entry.bytes).some(key => !entry.bytes[key]!.equals(old.bytes[key]!))) throw invalid();
    }
  }
}

async function collect(page: Page, host: Host, workspace: string, source: SourceIdentity, count: number) {
  const versions = await readVersions(page, host, workspace); if (versions.length !== count) throw invalid();
  const ordered: DatasetVersionRecord[] = []; let parent: string | undefined;
  for (let index = 0; index < count; index++) {
    const children = versions.filter(version => version.lineage.parentVersionId === parent);
    if (children.length !== 1) throw invalid(); ordered.push(children[0]!); parent = children[0]!.versionId;
  }
  const evidence: RowEvidence[] = [];
  for (const version of ordered) {
    if (version.artifacts.length > 12) throw invalid();
    const bytes: Record<string, Buffer> = {};
    for (const item of version.artifacts) bytes[item.artifactKey] = await readArtifact(page, host, workspace, item.artifactKey);
    const dataset = artifact(version, "dataset");
    evidence.push({ version, bytes, rows: await readSavedRowPage(page, host, workspace, dataset.artifactKey, version.versionId, version.totalRows) });
  }
  validateSavedRowHistory(workspace, source, evidence); return evidence;
}
async function selectWorkspace(page: Page, workspace: string) {
  const selector = page.getByLabel("Select current workspace"); await selector.selectOption(workspace);
  await page.locator(".workspace-switcher--header").getByRole("button", { name: "Change", exact: true }).click();
  await expect(selector).toHaveValue(workspace);
}
async function openRows(page: Page, host: Host) {
  await page.getByRole("button", { name: host === "desktop" ? "Data" : "Artifacts", exact: true }).click();
  await page.getByRole("tab", { name: "Dataset Review", exact: true }).click();
  const region = page.locator("section.dataset-review"), card = region.locator("article").filter({ has: page.getByRole("heading", { name: fixed.dataset_name, exact: true }) });
  await expect(card).toHaveCount(1); await card.getByRole("button", { name: "View table", exact: true }).click(); return { region, card };
}
async function visibleRows(page: Page, rows: DatasetReviewPage) {
  const table = page.locator("table.dataset-review__table"), body = table.locator("tbody tr");
  await expect(body).toHaveCount(rows.totalRows);
  const columns = await table.locator("thead th").allTextContents();
  for (const row of rows.rows) {
    await expect(body.nth(row.rowIndex).getByRole("rowheader")).toHaveText(String(row.rowIndex + 1));
    for (const [key, value] of Object.entries(row.values)) {
      const column = columns.indexOf(key); if (column < 1) throw invalid();
      await expect(body.nth(row.rowIndex).locator("td").nth(column - 1).locator("pre")).toHaveText(typeof value === "string" ? value : JSON.stringify(value, null, 2));
    }
  }
}

export async function prepareSavedRowReview(page: Page, host: Host, info: TestInfo): Promise<SavedRowSnapshot> {
  const originalWorkspace = await page.getByLabel("Select current workspace").inputValue();
  await page.getByRole("button", { name: "Home", exact: true }).click();
  await page.getByRole("button", { name: "Create new workspace", exact: true }).click();
  await page.locator('input[name="workspaceName"]').fill(`Synthetic ${host} saved row review`);
  await page.getByRole("button", { name: "Create workspace", exact: true }).click();
  await expect(page.getByLabel("Select current workspace")).not.toHaveValue(originalWorkspace);
  const workspace = await page.getByLabel("Select current workspace").inputValue();
  await page.getByRole("button", { name: host === "desktop" ? "Data" : "Artifacts", exact: true }).click();
  await page.getByRole("tab", { name: "Artifact Ingestion", exact: true }).click();
  const ingestion = page.getByRole("list", { name: "Add data workflow", exact: true });
  await ingestion.getByLabel("Choose one or more files", { exact: true }).setInputFiles({ name: fixed.source_name, mimeType: "text/csv", buffer: INPUT });
  await ingestion.getByRole("button", { name: "Add data", exact: true }).click();
  const notices = page.getByRole("dialog", { name: "Notifications", exact: true });
  await expect(notices.locator(".ui-notification__item").filter({ hasText: "All files are ready." })).toHaveCount(1, { timeout: 60_000 });
  await notices.getByRole("button", { name: "Close notifications", exact: true }).click();
  const source = await readImportedSource(page, host, workspace, { name: fixed.source_name, content: INPUT });
  await page.getByRole("tab", { name: "Dataset Preparation", exact: true }).click();
  await page.getByRole("combobox", { name: host === "desktop" ? /^Training task\b/ : /^Training goal\b/ }).selectOption("llm-classification");
  const checkbox = host === "desktop" ? page.locator("label").filter({ has: page.getByText(fixed.source_name, { exact: true }) }).getByRole("checkbox")
    : page.getByRole("checkbox", { name: fixed.source_name, exact: true });
  await checkbox.check();
  const method = page.getByRole("combobox", { name: host === "desktop" ? "How should the source material be divided?" : "Preparation method", exact: true });
  if (await method.count()) await method.selectOption("validate-and-split");
  await selectProvidedOutput(page, host, "parquet");
  await page.getByRole("button", { name: "Run checks and prepare", exact: true }).click();
  const approve = page.getByRole("button", { name: "Approve and save dataset", exact: true }); await expect(approve).toBeVisible({ timeout: 90_000 });
  await page.getByLabel("Dataset save name (optional)", { exact: false }).fill(fixed.dataset_name); await approve.click();
  await expect(page.getByRole("tab", { name: "Artifact Browser", exact: true })).toHaveAttribute("aria-selected", "true", { timeout: 30_000 });
  const initial = await collect(page, host, workspace, source, 1), { region } = await openRows(page, host);
  await visibleRows(page, initial[0]!.rows);
  await qualifyCriticalSurfaceAccessibility(page, info, "dataset-review");
  await region.locator("tbody tr").first().getByRole("button", { name: "Edit", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: `Review ${fixed.dataset_name}`, exact: true });
  await dialog.getByLabel("text", { exact: true }).fill(String(initial[0]!.rows.rows[0]!.values.text) + fixed.edit_suffix);
  await qualifyCriticalSurfaceAccessibility(page, info, "dataset-row-edit");
  await dialog.getByRole("button", { name: "Approve changes", exact: true }).click();
  await expect(dialog.getByLabel("text", { exact: true })).not.toBeVisible();
  await dialog.getByRole("button", { name: "Close dialog", exact: true }).click();
  const edited = await collect(page, host, workspace, source, 2); await visibleRows(page, edited[1]!.rows);
  await region.locator("tbody tr").nth(1).getByRole("button", { name: "Reject", exact: true }).click();
  await expect(region.locator("tbody tr")).toHaveCount(7, { timeout: 30_000 });
  const evidence = await collect(page, host, workspace, source, 3); await visibleRows(page, evidence[2]!.rows);
  // The source and both earlier immutable versions are read again, rather than
  // assuming that a new version implies their continued integrity.
  if (!(await readArtifact(page, host, workspace, source.storageKey)).equals(INPUT)) throw invalid();
  validateSavedRowHistory(workspace, source, evidence.slice(0, 1), initial);
  validateSavedRowHistory(workspace, source, evidence.slice(0, 2), edited);
  await selectWorkspace(page, originalWorkspace); return { workspace, originalWorkspace, source, evidence };
}

export async function verifySavedRowReviewAfterRestart(page: Page, host: Host, saved: SavedRowSnapshot, info: TestInfo) {
  await selectWorkspace(page, saved.workspace);
  const current = await collect(page, host, saved.workspace, saved.source, 3);
  validateSavedRowHistory(saved.workspace, saved.source, current, saved.evidence);
  if (!(await readArtifact(page, host, saved.workspace, saved.source.storageKey)).equals(INPUT)) throw invalid();
  const { card } = await openRows(page, host);
  for (const entry of current) {
    await card.getByRole("combobox", { name: "Version", exact: true }).selectOption(entry.version.versionId);
    await visibleRows(page, entry.rows);
  }
  await selectWorkspace(page, saved.originalWorkspace);
  const run = process.env.VISUAL_COMPOSER_QUALIFICATION_RUN_ID!, source = process.env.VISUAL_COMPOSER_QUALIFICATION_SOURCE_REVISION!;
  if (!/^[a-z0-9-]{20,80}$/.test(run) || !/^source\.[a-f0-9]{64}$/.test(source)) throw invalid();
  const folder = path.resolve("artifacts/qualification/visual-composer/runs", run, "saved-row-review");
  await mkdir(folder, { recursive: true }); if (await realpath(folder) !== folder) throw invalid();
  const body = JSON.stringify({ schemaVersion: "saved-row-review-host-journey-v1", sourceRevision: source, host, status: "passed",
    savedVersions: 3, rowCounts: [8, 8, 7], exactVisibleValues: true, exactParentSourceRecipeLineage: true,
    originalBytesRetained: true, persistedRecordsAndBytesAfterRestart: true, modelGeneration: false, ocr: false,
    datasetDigests: current.map(entry => artifact(entry.version, "dataset").digest),
    scope: "Fixed public UI/storage/restart support only. Native retirement, physical platform and final parent qualification remain separate." }, null, 2) + "\n";
  if (Buffer.byteLength(body) > 8192) throw invalid();
  await writeFile(path.join(folder, `${host}.json`), body, { flag: "wx" }); await info.attach("saved-row-review-host-journey", { body, contentType: "application/json" });
}
