import { qualifyCriticalSurfaceAccessibility } from "./critical-surface-accessibility";
import { expect, type Page, type TestInfo } from "@playwright/test";
import { createHash } from "node:crypto";
import { mkdir, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import sourceContextFixture from "../daily-source-context-fixture.json";
import { normalizeDatasetVersionRecord, type DatasetVersionRecord } from "../../../../../modules/contracts/dataset";

type Host = "desktop" | "thin";
const NAME = "provided-version-qualification";
const FILE = "synthetic-provided.csv";
const ROWS = [
  ["Please send the invoice for the completed garden fence installation.", "invoice"],
  ["The monthly office cleaning invoice needs the new purchase order reference.", "invoice"],
  ["Send a receipt for the replacement window payment made yesterday.", "receipt"],
  ["Please attach the receipt for the annual library membership renewal.", "receipt"],
  ["The warehouse needs an order for twelve replacement safety helmets.", "order"],
  ["Create an order for the school laboratory measuring equipment.", "order"],
  ["The quarterly maintenance report describes the lift inspection results.", "report"],
  ["Please prepare the report on community swimming pool water checks.", "report"],
];
const MAX_BYTES = 65_536;
const INPUT = Buffer.from("text,label\n" + ROWS.map(row => row.join(",")).join("\n") + "\n");
export type SourceIdentity = { artifactId: string; storageKey: string; digest: string };

// Playwright loads these TypeScript tests through CommonJS after its ESM
// global setup. A native URL import keeps the shared MJS resolver in ESM.
export async function resolveProvidedServerRestartMarker(runId: string, repoRoot = process.cwd()) {
  const coreUrl = pathToFileURL(path.resolve(repoRoot,
    "dev-tools/scripts/qualification/visual-composer/visual-composer-qualification-core.mjs"));
  const { resolveVisualComposerQualificationPaths } = await import(coreUrl.href);
  const roots = resolveVisualComposerQualificationPaths(repoRoot, runId);
  return path.join(roots.thinRuntimeRoot, "provided-server-session-2.json");
}

export async function readImportedSource(page: Page, host: Host, workspace: string,
  expected = { name: FILE, content: INPUT }): Promise<SourceIdentity> {
  if (![FILE, "synthetic-provided-row-review.csv", sourceContextFixture.source_name].includes(expected.name) || !Buffer.isBuffer(expected.content)
      || expected.content.length === 0 || expected.content.length > 16_384) throw new Error("The fixed imported source is invalid.");
  if (expected.name === sourceContextFixture.source_name && !expected.content.equals(Buffer.from(sourceContextFixture.source_markdown, "utf8")))
    throw new Error("The fixed imported source is invalid.");
  const item = await page.evaluate(async ({ host, workspace, name, limit }) => {
    let envelope;
    if (host === "desktop") envelope = await (window as any).desktopApi.browseArtifacts({ workspaceId: workspace });
    else {
      const token = localStorage.getItem("ai-system-builder.paired-device-token");
      if (!token) throw new Error("The qualification connection is unavailable.");
      const response = await fetch("/api/artifact/browse", { method: "POST", redirect: "error",
        headers: { "content-type": "application/json", "x-client-source": "thin-client", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ workspaceId: workspace, source: "thin-client.artifact-browser" }) });
      if (!response.ok || !response.body) throw new Error("Imported source is unavailable.");
      const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
      try { while (true) { const { done, value } = await reader.read(); if (done) break;
        size += value.byteLength; if (size > limit) throw new Error("Source response exceeded its limit."); chunks.push(value); }
      } finally { await reader.cancel(); reader.releaseLock(); }
      const bytes = new Uint8Array(size); let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      try { envelope = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
      catch { throw new Error("Source response is invalid."); }
    }
    const items = envelope?.ok === true && Array.isArray(envelope.value?.items) ? envelope.value.items : [];
    if (items.length > 16 || JSON.stringify(items).length > limit) throw new Error("Source response exceeded its limit.");
    const found = items.filter((item: any) => item.originalName === name);
    if (found.length !== 1 || typeof found[0].artifactId !== "string" || typeof found[0].storageKey !== "string" ||
        !found[0].artifactId || !found[0].storageKey || found[0].artifactId.length > 1024 || found[0].storageKey.length > 4096) throw new Error("Imported source identity is unavailable.");
    return { artifactId: found[0].artifactId, storageKey: found[0].storageKey };
  }, { host, workspace, name: expected.name, limit: MAX_BYTES });
  const actual = await readArtifact(page, host, workspace, item.storageKey);
  expect(actual.equals(expected.content)).toBe(true);
  return { ...item, digest: `sha256:${createHash("sha256").update(expected.content).digest("hex")}` };
}

export async function readVersions(page: Page, host: Host, workspace: string): Promise<DatasetVersionRecord[]> {
  const value = await page.evaluate(async ({ host, workspace, limit }) => {
    let envelope;
    if (host === "desktop") envelope = await (window as any).desktopApi.listDatasetVersions({ workspaceId: workspace });
    else {
      const token = localStorage.getItem("ai-system-builder.paired-device-token");
      if (!token) throw new Error("The qualification connection is unavailable.");
      const response = await fetch(`/api/dataset-versions?workspaceId=${encodeURIComponent(workspace)}`, {
        redirect: "error", headers: { "x-client-source": "thin-client", Authorization: `Bearer ${token}` },
      });
      if (!response.ok || !response.body) throw new Error("Saved versions could not be checked.");
      const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
      try { while (true) { const { done, value } = await reader.read(); if (done) break;
        size += value.byteLength; if (size > limit) throw new Error("Version response exceeded its limit."); chunks.push(value); }
      } finally { await reader.cancel(); reader.releaseLock(); }
      const bytes = new Uint8Array(size); let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      try { envelope = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
      catch { throw new Error("Version response is invalid."); }
    }
    if (envelope?.ok !== true || !Array.isArray(envelope.value?.versions) ||
        envelope.value.versions.length > 4 || JSON.stringify(envelope.value).length > limit) throw new Error("Version response is unavailable.");
    return envelope.value.versions;
  }, { host, workspace, limit: MAX_BYTES });
  const versions: DatasetVersionRecord[] = value.map(normalizeDatasetVersionRecord);
  expect(versions.every(version => version.workspaceId === workspace)).toBe(true);
  expect(new Set(versions.map(version => version.versionId)).size).toBe(versions.length);
  return versions;
}

export async function readArtifact(page: Page, host: Host, workspace: string, key: string): Promise<Buffer> {
  const result = await page.evaluate(async ({ host, workspace, key, limit }) => {
    if (host === "desktop") {
      const response = await (window as any).desktopApi.readArtifactViewerMedia({ storageKey: key }, { workspaceId: workspace, maximumBytes: limit });
      if (response?.ok !== true || !response.value?.bytes || response.value.bytes.length > limit) throw new Error("Saved bytes are unavailable.");
      return Array.from(response.value.bytes) as number[];
    }
    const token = localStorage.getItem("ai-system-builder.paired-device-token");
    if (!token) throw new Error("The qualification connection is unavailable.");
    const query = new URLSearchParams({ storageKey: key, workspaceId: workspace, maximumBytes: String(limit) });
    const response = await fetch(`/api/artifact/media/view?${query}`, {
      redirect: "error", headers: { "x-client-source": "thin-client", Authorization: `Bearer ${token}` },
    });
    if (!response.ok || !response.body) throw new Error("Saved bytes are unavailable.");
    const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
    try { while (true) { const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength; if (size > limit) throw new Error("Saved bytes exceeded their limit."); chunks.push(value); }
    } finally { await reader.cancel(); reader.releaseLock(); }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return Array.from(bytes);
  }, { host, workspace, key, limit: MAX_BYTES });
  return Buffer.from(result);
}

async function checkVersionBytes(page: Page, host: Host, workspace: string, version: DatasetVersionRecord, source: SourceIdentity) {
  expect(version.totalRows).toBe(8);
  expect(version.lineage.sources.length).toBe(1);
  expect(version.lineage.sources[0]!.sourceArtifactId === source.artifactId &&
    version.lineage.sources[0]!.artifactKey === source.storageKey && version.lineage.sources[0]!.digest === source.digest).toBe(true);
  const hashes: Record<string, string> = {};
  for (const role of ["dataset", "recipe", "dataset-card", "croissant"] as const) {
    const artifacts = version.artifacts.filter(artifact => artifact.role === role);
    expect(artifacts.length).toBe(1);
    const artifact = artifacts[0]!;
    expect(artifact.sizeBytes > 0 && artifact.sizeBytes <= MAX_BYTES).toBe(true);
    const bytes = await readArtifact(page, host, workspace, artifact.artifactKey);
    hashes[role] = createHash("sha256").update(bytes).digest("hex");
    expect(bytes.length === artifact.sizeBytes && `sha256:${hashes[role]}` === artifact.digest).toBe(true);
    let text: string;
    try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
    catch { throw new Error("Saved version text is invalid."); }
    if (role === "dataset") {
      let rows: any[];
      try { rows = text.trim().split(/\r?\n/).map(line => JSON.parse(line)); }
      catch { throw new Error("Saved dataset is invalid."); }
      expect(rows.length).toBe(8);
      expect(ROWS.every(([text, label]) => rows.filter(row => row.text === text && row.label === label).length === 1)).toBe(true);
      expect(rows.every(row => row.sourceArtifactId === version.lineage.sources[0]!.sourceArtifactId)).toBe(true);
    } else if (role === "dataset-card") {
      expect(text.includes("---") && text.includes(NAME)).toBe(true);
    } else {
      let parsed: any;
      try { parsed = JSON.parse(text); } catch { throw new Error("Saved version JSON is invalid."); }
      if (role === "croissant") expect(parsed["@context"] && parsed.recordSet).toBeTruthy();
      else expect(parsed.recipe.task.textInputMode === "provided" && !parsed.recipe.generation).toBe(true);
    }
  }
  return hashes;
}

async function openDataset(page: Page, host: Host) {
  await page.getByRole("button", { name: host === "desktop" ? "Data" : "Artifacts", exact: true }).click();
  await page.getByRole("tab", { name: "Artifact Browser", exact: true }).click();
  const name = `${NAME}.jsonl`;
  if (host === "desktop") await page.locator("article").filter({ has: page.getByRole("heading", { name, exact: true }) }).first()
    .getByRole("button", { name: "View Details", exact: true }).click();
  else await page.getByRole("button", { name, exact: true }).first().click();
  const panel = page.getByRole("region", { name: "Saved versions", exact: true });
  await expect(panel.getByRole("combobox", { name: "Version", exact: true })).toBeVisible();
  return panel;
}

export async function prepareProvidedVersions(page: Page, host: Host, info: TestInfo) {
  const workspace = await page.getByLabel("Select current workspace").inputValue();
  await page.getByRole("tab", { name: "Artifact Ingestion", exact: true }).click();
  const ingestion = page.getByRole("list", { name: "Add data workflow", exact: true });
  await ingestion.getByLabel("Choose one or more files", { exact: true }).setInputFiles({ name: FILE,
    mimeType: "text/csv", buffer: INPUT });
  await ingestion.getByRole("button", { name: "Add data", exact: true }).click();
  const notices = page.getByRole("dialog", { name: "Notifications", exact: true });
  await expect(notices.locator(".ui-notification__item").filter({ hasText: "All files are ready." })).toHaveCount(1, { timeout: 60_000 });
  await notices.getByRole("button", { name: "Close notifications", exact: true }).click();
  const sourceIdentity = await readImportedSource(page, host, workspace);
  await page.getByRole("tab", { name: "Dataset Preparation", exact: true }).click();
  const goal = page.getByRole("combobox", { name: host === "desktop" ? /^Training task\b/ : /^Training goal\b/ });
  await goal.selectOption("llm-classification");
  const source = host === "desktop" ? page.locator("label").filter({ has: page.getByText(FILE, { exact: true }) }).getByRole("checkbox")
    : page.getByRole("checkbox", { name: FILE, exact: true });
  await source.check();
  const method = page.getByRole("combobox", { name: host === "desktop" ? "How should the source material be divided?" : "Preparation method", exact: true });
  if (await method.count()) await method.selectOption("validate-and-split");
  const run = () => page.getByRole("button", { name: "Run checks and prepare", exact: true });
  const approve = () => page.getByRole("button", { name: "Approve and save dataset", exact: true });
  await selectProvidedOutput(page, host, "jsonl");
  await qualifyCriticalSurfaceAccessibility(page, info, "dataset-preparation");
  await run().click(); await expect(approve()).toBeVisible({ timeout: 90_000 });
  await page.getByLabel("Dataset save name (optional)", { exact: false }).fill(NAME);
  await approve().click();
  await expect(page.getByRole("tab", { name: "Artifact Browser", exact: true })).toHaveAttribute("aria-selected", "true", { timeout: 30_000 });
  const first = await readVersions(page, host, workspace);
  expect(first.length).toBe(1);
  const original = first[0]!;
  const originalHashes = await checkVersionBytes(page, host, workspace, original, sourceIdentity);
  // Real visible replay switches tabs. No preparation is authorized by replay.
  if (host === "thin") await page.getByRole("button", { name: `${NAME}.jsonl`, exact: true }).click();
  await page.getByRole("button", { name: "Use this setup again", exact: true }).click();
  await expect(page.getByRole("tab", { name: "Dataset Preparation", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(goal).toHaveValue("llm-classification"); await expect(source).toBeChecked();
  await expect(run()).toBeEnabled(); expect((await readVersions(page, host, workspace)).length).toBe(1);
  // The second explicit run is deliberate. Keep the same dataset name, allowing
  // the real comparison UI to prove version history without mutating old bytes.
  await run().click(); await expect(approve()).toBeVisible({ timeout: 90_000 });
  await page.getByLabel("Dataset save name (optional)", { exact: false }).fill(NAME);
  await approve().click();
  await expect(page.getByRole("tab", { name: "Artifact Browser", exact: true })).toHaveAttribute("aria-selected", "true", { timeout: 30_000 });
  const versions = await readVersions(page, host, workspace);
  expect(versions.length).toBe(2);
  expect(versions.every(version => version.datasetId === original.datasetId)).toBe(true);
  expect(JSON.stringify(versions.find(version => version.versionId === original.versionId)) === JSON.stringify(original)).toBe(true);
  expect(JSON.stringify(await checkVersionBytes(page, host, workspace, original, sourceIdentity)) === JSON.stringify(originalHashes)).toBe(true);
  const second = versions.find(version => version.versionId !== original.versionId)!;
  expect((await checkVersionBytes(page, host, workspace, second, sourceIdentity)).dataset === originalHashes.dataset).toBe(true);
  if (host === "thin") await page.getByRole("button", { name: `${NAME}.jsonl`, exact: true }).first().click();
  const panel = page.getByRole("region", { name: "Saved versions", exact: true });
  await panel.getByRole("combobox", { name: "Version", exact: true }).selectOption(second.versionId);
  await expect(panel.getByRole("heading", { name: "What changed", exact: true })).toBeVisible();
  await qualifyCriticalSurfaceAccessibility(page, info, "dataset-versions");
  await panel.getByRole("combobox", { name: "Version", exact: true }).selectOption(original.versionId);
  if (host === "desktop") await page.getByRole("button", { name: "Close detail and preview", exact: true }).click();
  return { workspace, original, originalHashes, versions, sourceIdentity };
}

export async function selectProvidedOutput(page: Page, host: Host, format: "jsonl" | "parquet") {
  const output = page.getByLabel(host === "desktop" ? "Output format" : "Saved file format", { exact: host === "desktop" });
  if (!await output.isVisible()) {
    if (host === "desktop") {
      const outputPanel = page.getByRole("button", { name: /Output file/ });
      if (!await outputPanel.isVisible()) await page.getByRole("button", { name: "Advanced settings", exact: true }).click();
      await outputPanel.click();
    }
    else await output.locator("xpath=ancestor::details[1]").locator("summary").click();
  }
  await output.selectOption(format);
}

export async function verifyProvidedVersionsAfterRestart(page: Page, host: Host,
  saved: Awaited<ReturnType<typeof prepareProvidedVersions>>, info: TestInfo) {
  await expect(page.getByLabel("Select current workspace")).toHaveValue(saved.workspace, { timeout: 60_000 });
  const versions = await readVersions(page, host, saved.workspace);
  expect(JSON.stringify(versions) === JSON.stringify(saved.versions)).toBe(true);
  expect(JSON.stringify(await checkVersionBytes(page, host, saved.workspace, saved.original, saved.sourceIdentity)) === JSON.stringify(saved.originalHashes)).toBe(true);
  const panel = await openDataset(page, host);
  await panel.getByRole("combobox", { name: "Version", exact: true }).selectOption(saved.original.versionId);
  await expect(panel).toContainText("8");
  // Exercise the reopened service/worker as well as reading persisted data. A
  // third explicit preparation is discarded; the two saved versions stay fixed.
  await panel.getByRole("button", { name: "Use this setup again", exact: true }).click();
  await expect(page.getByRole("tab", { name: "Dataset Preparation", exact: true })).toHaveAttribute("aria-selected", "true");
  await page.getByRole("button", { name: "Run checks and prepare", exact: true }).click();
  await expect(page.getByRole("button", { name: "Approve and save dataset", exact: true })).toBeVisible({ timeout: 90_000 });
  await page.getByRole("button", { name: "Discard dataset", exact: true }).click();
  expect(JSON.stringify(await readVersions(page, host, saved.workspace)) === JSON.stringify(saved.versions)).toBe(true);
  const run = process.env.VISUAL_COMPOSER_QUALIFICATION_RUN_ID!;
  expect(run).toMatch(/^[a-z0-9-]{20,80}$/);
  const report = { schemaVersion: "provided-version-host-journey-v1", host, status: "passed",
    sourceRevision: process.env.VISUAL_COMPOSER_QUALIFICATION_SOURCE_REVISION,
    savedVersions: 2, savedRowsPerVersion: 8, immutableBytesAndLineage: true, compareUi: true,
    explicitSupportedSetupReuse: true, restartKind: host === "desktop" ? "new-app-process" : "complete-service-recomposition",
    persistedVersionIdentity: true, restartedPreparationAndDiscard: true,
    datasetSha256: saved.originalHashes.dataset, modelGeneration: false, ocr: false,
    scope: "Real provided-data app support only. Outer native retirement and provider website rendering remain separate. No parent qualification." };
  expect(report.sourceRevision).toMatch(/^source\.[a-f0-9]{64}$/);
  const folder = path.resolve("artifacts/qualification/visual-composer/runs", run, "provided-versions");
  await mkdir(folder, { recursive: true }); expect(await realpath(folder)).toBe(folder);
  const body = JSON.stringify(report, null, 2) + "\n";
  expect(Buffer.byteLength(body)).toBeLessThanOrEqual(8192);
  await writeFile(path.join(folder, `${host}.json`), body, { flag: "wx" });
  await info.attach("provided-version-host-journey", { body, contentType: "application/json" });
}
