import { expect, type Page, type TestInfo } from "@playwright/test";
import { createHash } from "node:crypto";
import { mkdir, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import fixed from "../daily-source-context-fixture.json";
import { captureManualContextCatalog, readManualContextValue } from "./manual-context-host-journey";
import { readArtifact, readImportedSource, type SourceIdentity } from "./provided-dataset-version-journey";

type Host = "desktop" | "thin";
type Kind = "rag-database" | "markdown-context-pack";
const INPUT = Buffer.from(fixed.source_markdown, "utf8"), LIMIT = 65_536;
const hash = (bytes: Uint8Array | string) => "sha256:" + createHash("sha256").update(bytes).digest("hex");
const invalid = () => new Error("The fixed source Context journey could not verify its saved data or history.");
function record(value: unknown): Record<string, any> {
  if (!value || typeof value !== "object" || Array.isArray(value)
      || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw invalid();
  const fields = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(fields).length > 32 || Reflect.ownKeys(fields).some(key => typeof key !== "string" || !("value" in fields[key]!))) throw invalid();
  return value as Record<string, any>;
}
function list(value: unknown, maximum: number): unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > maximum) throw invalid();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(descriptors).length !== value.length + 1) throw invalid();
  const copied: unknown[] = [];
  for (let index = 0; index < value.length; index++) {
    const entry = descriptors[String(index)]; if (!entry || !("value" in entry)) throw invalid(); copied.push(entry.value);
  }
  return copied;
}
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical((value as Record<string, unknown>)[key])]));
  return value;
}
function text(value: unknown, max = 4096): value is string { return typeof value === "string" && value.trim().length > 0 && value.length <= max; }
const media = (kind: Kind) => kind === "rag-database" ? "application/vnd.ai-system-builder.rag-database+lancedb+zip" : "application/vnd.ai-system-builder.markdown-context-pack+zip";
const name = (kind: Kind) => kind === "rag-database" ? fixed.rag_name : fixed.pack_name;
// Captured from actual model-free production generation of the versioned
// fixture. These literals are review oracles, not a second chunking algorithm.
const REVIEW = {
  "rag-database": [
    { title: "Chunk 1", blocks: ["# Harbor Transit\n\n## Route\n\nLine A connects Harbor Station and the Museum. It leaves Harbor Station at 08:00. A day pass covers"], chunkIndex: 0 },
    { title: "Chunk 2", blocks: ["both stops.\n\n## Museum\n\nThe Museum opens at 09:00 and closes at 17:00. Museum tickets do not include a transit pass."], chunkIndex: 1 },
  ],
  "markdown-context-pack": [{ title: "Museum Harbor Transit", blocks: ["Harbor Transit", "Route",
    "Line A connects Harbor Station and the Museum. It leaves Harbor Station at 08:00. A day pass covers both stops.", "Museum",
    "The Museum opens at 09:00 and closes at 17:00. Museum tickets do not include a transit pass."], chunkIndex: 0 }],
} as const;
export interface SourceContextReviewObservation { position: number; total: number; title: string; blocks: string[]; citation: string; previousDisabled: boolean; nextDisabled: boolean; decision: string; }
export function validateSourceContextReview(kind: Kind, index: number, sourceKey: string, observation: SourceContextReviewObservation, decision: "Not reviewed" | "Approved") {
  const expected = REVIEW[kind]?.[index], actual = record(observation);
  const blocks = list(actual.blocks, 5);
  if (!expected || !text(sourceKey) || actual.position !== index + 1 || actual.total !== REVIEW[kind].length
      || actual.title !== expected.title || actual.citation !== `${sourceKey} · chunk ${expected.chunkIndex + 1}`
      || actual.previousDisabled !== (index === 0) || actual.nextDisabled !== (index === REVIEW[kind].length - 1)
      || actual.decision !== decision || blocks.some(value => typeof value !== "string")
      || JSON.stringify(blocks) !== JSON.stringify(expected.blocks)) throw invalid();
}
export interface SourceContextRecord { workspace: string; artifactId: string; storageKey: string; kind: Kind; name: string; digest: string; sizeBytes: number; createdAt?: string; chunkCount: number; sourceKey: string; sourceDigest: string; manifestFingerprint: string; }
export interface SourceContextSnapshot { workspace: string; originalWorkspace: string; source: SourceIdentity; records: readonly SourceContextRecord[]; }

// These are oracles over actual public reads. The production worker separately
// validates package members and the Lance table; this does not substitute a ZIP.
export function validateSourceContextRecord(workspace: string, source: SourceIdentity, itemValue: unknown,
  detailValue: unknown, bytes: Uint8Array, previous?: SourceContextRecord): SourceContextRecord {
  const item = record(itemValue), detail = record(detailValue), inspected = record(detail.item), manifest = record(detail.manifest);
  const rag = item.kind === "rag-database", kind: Kind = rag ? "rag-database" : "markdown-context-pack";
  const sources = list(manifest.sources, 1), manual = list(manifest.manualEntries, 0), entries = list(detail.packageEntries, 4);
  if (!/^workspace\.[A-Za-z0-9._-]{1,128}$/.test(workspace) || !text(source.storageKey) || source.digest !== hash(INPUT)
      || !text(source.artifactId, 1024) || !text(item.artifactId, 1024) || !text(item.storageKey)
      || item.kind !== kind || item.name !== name(kind) || item.mediaType !== media(kind)
      || !Number.isSafeInteger(item.sizeBytes) || item.sizeBytes < 1 || item.sizeBytes > LIMIT
      || !(bytes instanceof Uint8Array) || bytes.byteLength !== item.sizeBytes || hash(bytes) !== item.digest
      || (item.createdAt !== undefined && !text(item.createdAt, 64))
      || ["artifactId", "storageKey", "kind", "name", "mediaType", "sizeBytes", "digest", "createdAt"].some(key => inspected[key] !== item[key])
      || manifest.schemaVersion !== "1" || manifest.kind !== kind || manifest.name !== name(kind) || manifest.mediaType !== media(kind)
      || !text(manifest.createdAt, 80) || sources.length !== 1 || manual.length !== 0
      || !Number.isSafeInteger(detail.chunkCount) || detail.chunkCount < 1 || detail.chunkCount > 8) throw invalid();
  const keys = ["schemaVersion", "kind", "name", "mediaType", "createdAt", "sources", "manualEntries", "chunking",
    ...(rag ? ["embedding", "sourceChecks"] : ["contextPack"])];
  if (Object.keys(manifest).sort().join() !== keys.sort().join()) throw invalid();
  const entry = record(sources[0]), chunking = record(manifest.chunking);
  if (Object.keys(entry).sort().join() !== ["artifactId", "digest", "mediaType", "originalName", "sizeBytes", "chunkCount", "chunkingMode"].sort().join()
      || entry.artifactId !== source.storageKey || entry.digest !== source.digest || entry.mediaType !== "text/markdown"
      || entry.originalName !== fixed.source_name || entry.sizeBytes !== INPUT.byteLength
      || entry.chunkCount !== detail.chunkCount || entry.chunkingMode !== "extracted") throw invalid();
  const expectedChunking = rag ? { strategy: "fixed-length", chunkCharacters: 128, overlapCharacters: 0, maximumChunks: 10000 }
    : { strategy: "topic-aware", chunkCharacters: 1200, overlapCharacters: 0, maximumTokensPerChunk: 320, topicBoundarySensitivity: 0.22, maximumChunks: 10000 };
  const same = (actual: Record<string, unknown>, expected: Record<string, unknown>) => Object.keys(actual).sort().join() === Object.keys(expected).sort().join()
    && Object.keys(expected).every(key => actual[key] === expected[key]);
  const normalizedChunking = { ...chunking }; if (normalizedChunking.textFields !== undefined && list(normalizedChunking.textFields, 0).length === 0) delete normalizedChunking.textFields;
  if (!same(normalizedChunking, expectedChunking)) throw invalid();
  if (rag) {
    if (!same(record(manifest.embedding), { provider: "transformers", modelId: fixed.embedding_model, dimensions: 384 })) throw invalid();
    const checks = record(manifest.sourceChecks);
    const languages = list(checks.allowedLanguages, 1);
    if (languages.length !== 1 || languages[0] !== "en"
        || !same({ ...checks, allowedLanguages: "en" }, { preset: "recommended", allowedLanguages: "en", requireLicenseMetadata: false,
          requireConsentMetadata: false, includeSourceAttribution: true }) || detail.chunkCount !== 2
        || entries.length !== 0) throw invalid();
  } else {
    if (!same(record(manifest.contextPack), { inputMode: "source-materials", method: "none", cleaningPreset: "standard" })
        || entries.length !== 4 || !entries.every(entry => typeof entry === "string")
        || [...entries].sort().join() !== ["README.md", "manifest.json", "sources.md", "topics.md"].join()) throw invalid();
  }
  // Every nested manifest object has been admitted above before serialization.
  const manifestFingerprint = hash(JSON.stringify(canonical(manifest)));
  const saved = Object.freeze({ workspace, artifactId: item.artifactId as string, storageKey: item.storageKey as string, kind,
    name: name(kind), digest: item.digest as string, sizeBytes: item.sizeBytes as number, createdAt: item.createdAt as string | undefined, chunkCount: detail.chunkCount as number,
    sourceKey: source.storageKey, sourceDigest: source.digest, manifestFingerprint });
  if (previous && Object.keys(saved).some(key => saved[key as keyof SourceContextRecord] !== previous[key as keyof SourceContextRecord])) throw invalid();
  return saved;
}

export function validateSourceContextCatalog(value: unknown, expected: readonly SourceContextRecord[]) {
  let items: ReturnType<typeof captureManualContextCatalog>;
  try { items = captureManualContextCatalog(value); } catch { throw invalid(); }
  if (items.length !== expected.length || new Set(expected.map(item => item.artifactId)).size !== expected.length) throw invalid();
  for (const saved of expected) {
    const found = items.filter(item => item.artifactId === saved.artifactId || item.storageKey === saved.storageKey);
    if (found.length !== 1 || found[0]!.mediaType !== media(saved.kind)
        || ["artifactId", "storageKey", "name", "kind", "digest", "sizeBytes", "createdAt"].some(key => found[0]![key as keyof typeof found[0]] !== saved[key as keyof SourceContextRecord])) throw invalid();
  }
}

async function selectWorkspace(page: Page, workspace: string) {
  if (!/^workspace\.[A-Za-z0-9._-]{1,128}$/.test(workspace)) throw invalid();
  await page.getByLabel("Select current workspace").selectOption(workspace);
  await expect(page.getByLabel("Select current workspace")).toHaveValue(workspace);
}
async function browser(page: Page) {
  await page.getByRole("button", { name: "Context", exact: true }).click();
  await page.getByRole("tab", { name: "Context Browser", exact: true }).click();
}
async function closeNotices(page: Page) {
  const notices = page.getByRole("dialog", { name: "Notifications", exact: true });
  if (await notices.isVisible()) await notices.getByRole("button", { name: "Close notifications", exact: true }).click();
}
async function detail(page: Page, saved: SourceContextRecord) {
  await browser(page);
  const card = page.getByRole("tabpanel", { name: "Context Browser", exact: true }).locator("article").filter({ has: page.getByText(saved.storageKey, { exact: true }) });
  await expect(card).toHaveCount(1); await card.getByRole("button", { name: "View Details", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Detail & preview", exact: true });
  await expect(dialog.getByRole("heading", { name: saved.name, exact: true })).toBeVisible(); return dialog;
}
async function collect(page: Page, host: Host, workspace: string, source: SourceIdentity, kind: Kind, previous?: SourceContextRecord,
  excluded: readonly string[] = []): Promise<SourceContextRecord> {
  if (await page.getByLabel("Select current workspace").inputValue() !== workspace) throw invalid();
  const catalog = captureManualContextCatalog(await readManualContextValue(page, host, workspace, { action: "browser-list" }));
  const matches = catalog.filter(item => previous ? item.artifactId === previous.artifactId : item.kind === kind && item.name === name(kind) && !excluded.includes(item.artifactId));
  if (matches.length !== 1) throw invalid(); const item = matches[0]!;
  const response = await readManualContextValue(page, host, workspace, { action: "browser-detail", artifactId: item.artifactId });
  return validateSourceContextRecord(workspace, source, item, response.detail, await readArtifact(page, host, workspace, item.storageKey), previous);
}
async function prepareCandidate(page: Page, kind: Kind, rebuild = false) {
  const rag = kind === "rag-database";
  const panel = page.getByRole("tabpanel", { name: rag ? "RAG Databases" : "Context Packs", exact: true });
  if (!rebuild) {
    await page.getByRole("tab", { name: rag ? "RAG Databases" : "Context Packs", exact: true }).click();
    if (!rag) await page.getByRole("button", { name: /^Source materials/ }).click();
    const source = panel.locator("label").filter({ has: page.getByText(fixed.source_name, { exact: true }) }).getByRole("checkbox");
    await expect(source).toHaveCount(1); await source.check();
    await panel.getByLabel(rag ? "Save name" : "Pack name", { exact: true }).fill(name(kind));
    if (rag) {
      await panel.getByLabel(/^Chunking method\b/).selectOption("fixed-length");
      await panel.getByText("Advanced chunk settings", { exact: true }).click();
      await panel.getByLabel("Section length (characters)", { exact: true }).fill("128");
      await panel.getByLabel("Section overlap (characters)", { exact: true }).fill("0");
      await panel.getByLabel("Local embedding model", { exact: true }).fill(fixed.embedding_model);
      await panel.getByLabel(/^Embedding device\b/).selectOption("cpu");
    } else {
      await panel.getByLabel(/^Cleaning\b/).selectOption("standard");
      await panel.getByLabel("Summary method", { exact: true }).selectOption("none");
    }
    await page.getByRole("button", { name: rag ? "Prepare RAG database" : "Prepare context pack", exact: true }).click();
  }
  await expect(page.getByRole("button", { name: rag ? "Approve and save RAG database" : "Save context pack", exact: true })).toBeVisible({ timeout: 60_000 });
  await closeNotices(page);
}
async function reviewAndSave(page: Page, kind: Kind, source: SourceIdentity) {
  const rag = kind === "rag-database";
  await page.getByRole("button", { name: rag ? "Review preview chunks" : "Review prepared Markdown", exact: true }).click();
  const review = page.getByRole("dialog", { name: rag ? "Review RAG chunks" : "Review context pack Markdown", exact: true });
  const item = review.locator("article.dataset-review__item"), progress = review.locator(".dataset-review__progress");
  async function observe(index: number, decision: "Not reviewed" | "Approved") {
    await expect(progress.locator("strong")).toHaveText(`${index + 1} of ${REVIEW[kind].length}`);
    await expect(progress.locator("span")).toHaveText(decision);
    const parsed = /^(\d+) of (\d+)$/.exec((await progress.locator("strong").textContent()) ?? ""); if (!parsed) throw invalid();
    const content = item.locator(".dataset-review__item-content"); await expect(content.locator("a,img,iframe,script")).toHaveCount(0);
    validateSourceContextReview(kind, index, source.storageKey, { position: Number(parsed[1]), total: Number(parsed[2]),
      title: (await item.locator("header h3").textContent()) ?? "", citation: (await item.locator("header p").textContent()) ?? "",
      blocks: await content.locator("h1,h2,h3,h4,h5,h6,p,pre,li,table").allTextContents(),
      previousDisabled: await review.getByRole("button", { name: "Previous", exact: true }).isDisabled(),
      nextDisabled: await review.getByRole("button", { name: "Next", exact: true }).isDisabled(), decision: (await progress.locator("span").textContent()) ?? "" }, decision);
  }
  for (let index = 0; index < REVIEW[kind].length; index++) {
    await observe(index, "Not reviewed"); await review.getByRole("button", { name: rag ? "Approve chunk" : "Approve section", exact: true }).click();
  }
  for (let index = REVIEW[kind].length - 1; index >= 0; index--) {
    await observe(index, "Approved"); if (index > 0) await review.getByRole("button", { name: "Previous", exact: true }).click();
  }
  await review.getByRole("button", { name: "Close dialog", exact: true }).click();
  await page.getByRole("button", { name: rag ? "Approve and save RAG database" : "Save context pack", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Detail & preview", exact: true });
  await expect(dialog.getByRole("heading", { name: name(kind), exact: true })).toBeVisible({ timeout: 60_000 });
  await dialog.getByRole("button", { name: "Close context detail and preview", exact: true }).click();
  await closeNotices(page);
}

async function verifyDesktopPackDownload(page: Page, saved: SourceContextRecord) {
  await page.getByRole("button", { name: "Data", exact: true }).click();
  await page.getByRole("tab", { name: "Artifact Browser", exact: true }).click();
  const card = page.getByRole("tabpanel", { name: "Artifact Browser", exact: true }).locator("article").filter({ has: page.getByText(saved.storageKey, { exact: true }) });
  await expect(card).toHaveCount(1); await card.getByRole("button", { name: "View Details", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Detail & preview", exact: true });
  const [download] = await Promise.all([page.waitForEvent("download", { timeout: 30_000 }),
    dialog.getByRole("button", { name: "Download artifact", exact: true }).click()]);
  try {
    if (download.suggestedFilename() !== fixed.pack_name + ".zip") throw invalid();
    const stream = await download.createReadStream(); if (!stream) throw invalid();
    const digest = createHash("sha256"); let size = 0;
    try { for await (const chunk of stream) { size += chunk.byteLength; if (size > LIMIT) throw invalid(); digest.update(chunk); } }
    finally { stream.destroy(); }
    if (size !== saved.sizeBytes || "sha256:" + digest.digest("hex") !== saved.digest || await download.failure()) throw invalid();
  } finally { await download.delete(); }
  await dialog.getByRole("button", { name: "Close detail and preview", exact: true }).click();
}

export async function prepareSourceContext(page: Page, host: Host): Promise<SourceContextSnapshot> {
  const originalWorkspace = await page.getByLabel("Select current workspace").inputValue();
  await page.getByRole("button", { name: "Home", exact: true }).click();
  await page.getByRole("button", { name: "Create new workspace", exact: true }).click();
  await page.locator('input[name="workspaceName"]').fill(`Synthetic ${host} transit Context`);
  await page.getByRole("button", { name: "Create workspace", exact: true }).click();
  await expect(page.getByLabel("Select current workspace")).not.toHaveValue(originalWorkspace);
  const workspace = await page.getByLabel("Select current workspace").inputValue();
  await page.getByRole("button", { name: host === "desktop" ? "Data" : "Artifacts", exact: true }).click();
  await page.getByRole("tab", { name: "Artifact Ingestion", exact: true }).click();
  const ingestion = page.getByRole("list", { name: "Add data workflow", exact: true });
  await ingestion.getByLabel("Choose one or more files", { exact: true }).setInputFiles({ name: fixed.source_name, mimeType: "text/markdown", buffer: INPUT });
  await ingestion.getByRole("button", { name: "Add data", exact: true }).click();
  const notices = page.getByRole("dialog", { name: "Notifications", exact: true });
  await expect(notices.locator(".ui-notification__item").filter({ hasText: "All files are ready." })).toHaveCount(1, { timeout: 60_000 });
  await notices.getByRole("button", { name: "Close notifications", exact: true }).click();
  const source = await readImportedSource(page, host, workspace, { name: fixed.source_name, content: INPUT });
  await page.getByRole("tab", { name: "Artifact Browser", exact: true }).click();
  if (host === "desktop") await page.getByRole("tabpanel", { name: "Artifact Browser", exact: true }).locator("article").filter({ has: page.getByText(source.storageKey, { exact: true }) }).getByRole("button", { name: "View Details", exact: true }).click();
  else await page.getByRole("button", { name: fixed.source_name, exact: true }).click();
  await expect(page.getByRole("button", { name: "Convert to RAG database", exact: true })).toBeEnabled({ timeout: 60_000 });
  await page.getByRole("button", { name: "Convert to RAG database", exact: true }).click();
  await expect(page.getByRole("tabpanel", { name: "RAG Databases", exact: true }).locator("label").filter({ has: page.getByText(fixed.source_name, { exact: true }) }).getByRole("checkbox")).toBeChecked();
  const records: SourceContextRecord[] = [];
  for (const kind of ["rag-database", "markdown-context-pack"] as const) {
    await prepareCandidate(page, kind); await reviewAndSave(page, kind, source);
    records.push(await collect(page, host, workspace, source, kind));
  }
  validateSourceContextCatalog(await readManualContextValue(page, host, workspace, { action: "browser-list" }), records);
  if (!(await readArtifact(page, host, workspace, source.storageKey)).equals(INPUT)) throw invalid();
  await selectWorkspace(page, originalWorkspace); return Object.freeze({ workspace, originalWorkspace, source: Object.freeze({ ...source }), records: Object.freeze(records) });
}

export async function verifySourceContextAfterRestart(page: Page, host: Host, saved: SourceContextSnapshot, info: TestInfo) {
  await selectWorkspace(page, saved.workspace);
  for (const item of saved.records) await collect(page, host, saved.workspace, saved.source, item.kind, item);
  validateSourceContextCatalog(await readManualContextValue(page, host, saved.workspace, { action: "browser-list" }), saved.records);
  if (host === "desktop") await verifyDesktopPackDownload(page, saved.records.find(item => item.kind === "markdown-context-pack")!);
  const originalRag = saved.records.find(item => item.kind === "rag-database")!;
  let dialog = await detail(page, originalRag);
  await dialog.getByLabel("Retrieval embedding device", { exact: true }).selectOption("cpu");
  await dialog.getByLabel("Query", { exact: true }).fill(fixed.query);
  await dialog.getByRole("button", { name: "Run test query", exact: true }).click();
  const first = dialog.locator("ol li").first(); await expect(first).toContainText(fixed.query_answer, { timeout: 60_000 });
  await expect(first).toContainText("Score 1.000"); await expect(first).toContainText(saved.source.storageKey); await expect(first).toContainText("chunk 1");
  await first.getByRole("button", { name: "View source in Data Management", exact: true }).click();
  await expect(page.locator("dd").filter({ hasText: new RegExp("^" + saved.source.storageKey.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$") })).toHaveCount(1);
  if (host === "desktop") await page.getByRole("button", { name: "Close detail and preview", exact: true }).click();
  const retained = [...saved.records];
  for (const original of saved.records) {
    dialog = await detail(page, original); await dialog.getByRole("button", { name: "Rebuild", exact: true }).click();
    await expect(dialog).not.toBeVisible(); await prepareCandidate(page, original.kind, true); await reviewAndSave(page, original.kind, saved.source);
    retained.push(await collect(page, host, saved.workspace, saved.source, original.kind, undefined, retained.map(item => item.artifactId)));
    for (const item of retained) await collect(page, host, saved.workspace, saved.source, item.kind, item);
    validateSourceContextCatalog(await readManualContextValue(page, host, saved.workspace, { action: "browser-list" }), retained);
  }
  await page.getByRole("tab", { name: "Context Packs", exact: true }).click();
  await prepareCandidate(page, "markdown-context-pack");
  await page.getByRole("button", { name: "Discard context pack", exact: true }).click();
  await expect(page.getByRole("button", { name: "Save context pack", exact: true })).not.toBeVisible();
  await closeNotices(page);
  validateSourceContextCatalog(await readManualContextValue(page, host, saved.workspace, { action: "browser-list" }), retained);
  for (const item of retained) await collect(page, host, saved.workspace, saved.source, item.kind, item);
  dialog = await detail(page, originalRag); await dialog.getByRole("button", { name: "Delete", exact: true }).click();
  const confirmation = page.getByRole("dialog", { name: "Delete context artifact", exact: true });
  const confirm = confirmation.getByRole("button", { name: "Confirm delete", exact: true }); await expect(confirm).toBeDisabled();
  await confirmation.getByLabel("Confirmation", { exact: true }).fill("delete"); await expect(confirm).toBeDisabled();
  await confirmation.getByRole("button", { name: "Cancel", exact: true }).click();
  validateSourceContextCatalog(await readManualContextValue(page, host, saved.workspace, { action: "browser-list" }), retained);
  for (const item of retained) await collect(page, host, saved.workspace, saved.source, item.kind, item);
  await dialog.getByRole("button", { name: "Delete", exact: true }).click();
  await confirmation.getByLabel("Confirmation", { exact: true }).fill("Delete"); await confirm.click(); await expect(dialog).not.toBeVisible();
  const remaining = retained.filter(item => item.artifactId !== originalRag.artifactId);
  validateSourceContextCatalog(await readManualContextValue(page, host, saved.workspace, { action: "browser-list" }), remaining);
  await expect(readManualContextValue(page, host, saved.workspace, { action: "browser-detail", artifactId: originalRag.artifactId })).rejects.toThrow();
  await page.reload(); await expect(page.getByLabel("Select current workspace")).toHaveValue(saved.workspace, { timeout: 60_000 });
  for (const item of remaining) await collect(page, host, saved.workspace, saved.source, item.kind, item);
  validateSourceContextCatalog(await readManualContextValue(page, host, saved.workspace, { action: "browser-list" }), remaining);
  if (!(await readArtifact(page, host, saved.workspace, saved.source.storageKey)).equals(INPUT)) throw invalid();
  await selectWorkspace(page, saved.originalWorkspace);
  const run = process.env.VISUAL_COMPOSER_QUALIFICATION_RUN_ID!, revision = process.env.VISUAL_COMPOSER_QUALIFICATION_SOURCE_REVISION!;
  if (!/^[a-z0-9-]{20,80}$/.test(run) || !/^source\.[a-f0-9]{64}$/.test(revision)) throw invalid();
  const folder = path.resolve("artifacts/qualification/visual-composer/runs", run, "source-context"); await mkdir(folder, { recursive: true }); if (await realpath(folder) !== folder) throw invalid();
  const body = JSON.stringify({ schemaVersion: "source-context-host-journey-v1", sourceRevision: revision, host, status: "passed",
    sourcePackAndRagReopened: true, exactSavedBytesAndSourceLineage: true, citedRetrievalAndSourceReturn: true,
    originalPreservingRebuilds: 2, cancelledDeletionRetainedCatalog: true, selectedRemovalSurvivedReload: true,
    discardedCandidateDidNotPublish: true, desktopDownloadVerified: host === "desktop", thinClientDownload: "not-an-existing-UI-control",
    embedding: "closed-finite-vectors", modelGeneration: false, ocr: false,
    scope: "Fixed source Context UI/real processors/storage/restart only. Actual model accuracy, physical backing-file erasure, native retirement and parent/final qualification remain separate." }, null, 2) + "\n";
  if (Buffer.byteLength(body) > 8192) throw invalid(); await writeFile(path.join(folder, `${host}.json`), body, { flag: "wx" });
  await info.attach("source-context-host-journey", { body, contentType: "application/json" });
}
