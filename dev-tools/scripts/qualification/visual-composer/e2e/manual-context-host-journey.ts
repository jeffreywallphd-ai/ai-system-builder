import { expect, type Page, type TestInfo } from "@playwright/test";
import { createHash } from "node:crypto";
import { mkdir, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import fixed from "../daily-context-fixture.json";

type Host = "desktop" | "thin";
const MEDIA = "application/vnd.ai-system-builder.markdown-context-pack+zip";
const LIMIT = 16_384;
const invalid = () => new Error("The saved manual Context pack did not match its expected bytes or metadata.");
const digest = (bytes: Uint8Array) => "sha256:" + createHash("sha256").update(bytes).digest("hex");
function record(value: unknown): Record<string, any> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalid();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(descriptors).length > 64 || Reflect.ownKeys(descriptors).some(key => typeof key !== "string" || !("value" in descriptors[key]!))) throw invalid();
  return value as Record<string, any>;
}
function text(value: unknown, limit: number): value is string { return typeof value === "string" && value.trim().length > 0 && value.length <= limit; }
export interface ManualContextSnapshot { workspace: string; artifactId: string; storageKey: string; digest: string; sizeBytes: number; manualDigest: string; }

// Capture every declared catalog field, without depending on display order.
// Immutable scalar copies cannot change underneath a later comparison.
export function captureManualContextCatalog(value: unknown) {
  const listed = record(value);
  if (listed.action !== "browser-list" || !Array.isArray(listed.items) || listed.items.length > 8) throw invalid();
  const ids = new Set<string>(), keys = new Set<string>();
  const items = (listed.items as unknown[]).map((value: unknown) => {
    const item = record(value);
    if (!text(item.artifactId, 1024) || !text(item.storageKey, 4096) || !text(item.name, 512)
        || !text(item.kind, 128) || !text(item.mediaType, 256) || !text(item.digest, 128)
        || !Number.isSafeInteger(item.sizeBytes) || item.sizeBytes < 1
        || (item.createdAt !== undefined && !text(item.createdAt, 64))
        || ids.has(item.artifactId) || keys.has(item.storageKey)) throw invalid();
    ids.add(item.artifactId); keys.add(item.storageKey);
    return Object.freeze({ artifactId: item.artifactId as string, storageKey: item.storageKey as string,
      name: item.name as string, kind: item.kind as string, mediaType: item.mediaType as string,
      digest: item.digest as string, sizeBytes: item.sizeBytes as number, createdAt: item.createdAt as string | undefined });
  });
  return Object.freeze(items.sort((left, right) => left.artifactId < right.artifactId ? -1 : left.artifactId === right.artifactId ? 0 : 1));
}

// A retained original is insufficient to prove discard did not publish another
// artifact. Compare the entire before/after catalog for no-change claims.
export function validateManualContextCatalog(value: unknown, saved: ManualContextSnapshot, state: "retained" | "removed",
  before?: ReturnType<typeof captureManualContextCatalog>) {
  if (state !== "retained" && state !== "removed") throw invalid();
  const items = captureManualContextCatalog(value);
  if (before) {
    const expected = state === "retained" ? before : before.filter(item => item.artifactId !== saved.artifactId);
    if (JSON.stringify(items) !== JSON.stringify(expected)) throw invalid();
  }
  const matches = items.filter(item => item.artifactId === saved.artifactId || item.storageKey === saved.storageKey || item.name === fixed.name);
  if (state === "removed") { if (matches.length !== 0) throw invalid(); return; }
  if (matches.length !== 1) throw invalid();
  const item = matches[0]!;
  if (item.artifactId !== saved.artifactId || item.storageKey !== saved.storageKey || item.name !== fixed.name
      || item.digest !== saved.digest || item.sizeBytes !== saved.sizeBytes) throw invalid();
}

// This is an oracle over actual public read results, not a seeded response.
// The real runtime inspector must validate the member digest before returning
// this manifest. Actual stored-byte SHA is checked independently below.
export function validateManualContextSnapshot(workspace: string, itemValue: unknown, detailValue: unknown,
  bytes: Uint8Array, previous?: ManualContextSnapshot): ManualContextSnapshot {
  const item = record(itemValue), detail = record(detailValue), inspected = record(detail.item), manifest = record(detail.manifest);
  const settings = record(manifest.contextPack);
  if (!/^workspace\.[A-Za-z0-9._-]{1,128}$/.test(workspace) || !text(item.artifactId, 1024) || !text(item.storageKey, 4096)
      || item.name !== fixed.name || item.kind !== "markdown-context-pack" || item.mediaType !== MEDIA
      || !Number.isSafeInteger(item.sizeBytes) || item.sizeBytes < 1 || item.sizeBytes > LIMIT
      || !(bytes instanceof Uint8Array) || bytes.byteLength !== item.sizeBytes || digest(bytes) !== item.digest
      || ["artifactId", "storageKey", "name", "kind", "mediaType", "sizeBytes", "digest"].some(key => inspected[key] !== item[key])
      || manifest.schemaVersion !== "1" || manifest.kind !== item.kind || manifest.name !== fixed.name || manifest.mediaType !== MEDIA
      || settings.inputMode !== "manual" || settings.method !== "none" || settings.modelId !== undefined
      || !Array.isArray(manifest.sources) || manifest.sources.length !== 0
      || !Array.isArray(manifest.manualEntries) || manifest.manualEntries.length !== 1
      || detail.chunkCount !== 1 || !Array.isArray(detail.packageEntries) || detail.packageEntries.length !== 3
      || !detail.packageEntries.every((entry: unknown) => typeof entry === "string")
      || JSON.stringify([...detail.packageEntries].sort()) !== JSON.stringify(["README.md", "context.md", "manifest.json"])) throw invalid();
  const entry = record(manifest.manualEntries[0]), manualDigest = digest(Buffer.from(fixed.markdown, "utf8"));
  if (entry.id !== "manual-entry-1" || entry.title !== fixed.name || entry.digest !== manualDigest) throw invalid();
  const snapshot = { workspace, artifactId: item.artifactId, storageKey: item.storageKey, digest: item.digest, sizeBytes: item.sizeBytes, manualDigest };
  if (previous && Object.keys(snapshot).some(key => snapshot[key as keyof ManualContextSnapshot] !== previous[key as keyof ManualContextSnapshot])) throw invalid();
  return snapshot;
}

export async function readManualContextValue(page: Page, host: Host, workspace: string, command: { action: "browser-list" } | { action: "browser-detail"; artifactId: string }) {
  if (!/^workspace\.[A-Za-z0-9._-]{1,128}$/.test(workspace) || !["browser-list", "browser-detail"].includes(command.action)
      || (command.action === "browser-detail" && !text(command.artifactId, 1024))) throw invalid();
  const response = await page.evaluate(async ({ host, workspace, command }) => {
    try {
      let envelope: any;
      if (host === "desktop") envelope = await (window as any).desktopApi.executeContextManagement({ workspaceId: workspace, command });
      else {
        const token = localStorage.getItem("ai-system-builder.paired-device-token"); if (!token) return { ok: false };
        const response = await fetch("/api/context-management/read", { method: "POST", redirect: "error", signal: AbortSignal.timeout(30_000),
          headers: { "content-type": "application/json", "x-client-source": "thin-client", authorization: `Bearer ${token}` },
          body: JSON.stringify({ workspaceId: workspace, command }) });
        if (!response.ok || !response.body || !/^application\/json(?:\s*;|$)/i.test(response.headers.get("content-type") ?? "")) { await response.body?.cancel(); return { ok: false }; }
        const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
        try { while (true) { const next = await reader.read(); if (next.done) break; size += next.value.byteLength;
          if (size > 65_536) return { ok: false }; chunks.push(next.value); }
        } finally { try { await reader.cancel(); } finally { reader.releaseLock(); } }
        const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
        envelope = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
      }
      if (envelope?.ok !== true || envelope.value?.action !== command.action || new TextEncoder().encode(JSON.stringify(envelope.value)).byteLength > 65_536) return { ok: false };
      return { ok: true, value: envelope.value };
    } catch { return { ok: false }; }
  }, { host, workspace, command }).catch(() => ({ ok: false }));
  if (!response.ok || !("value" in response)) throw new Error("The saved Context read could not be verified.");
  return response.value;
}

async function savedSnapshot(page: Page, host: Host, workspace: string, previous?: ManualContextSnapshot) {
  if (await page.getByLabel("Select current workspace").inputValue() !== workspace) throw invalid();
  const listed = await readManualContextValue(page, host, workspace, { action: "browser-list" });
  if (!Array.isArray(listed.items) || listed.items.length > 8) throw invalid();
  const matching = listed.items.filter((item: any) => item?.name === fixed.name); if (matching.length !== 1) throw invalid();
  const item = record(matching[0]); if (!text(item.artifactId, 1024) || !text(item.storageKey, 4096)) throw invalid();
  const detail = await readManualContextValue(page, host, workspace, { action: "browser-detail", artifactId: item.artifactId });
  const result = await page.evaluate(async ({ host, workspace, key, limit }) => {
    try {
      if (host === "desktop") {
        const result = await (window as any).desktopApi.readArtifactViewerMedia({ storageKey: key }, { workspaceId: workspace, maximumBytes: limit });
        if (result?.ok !== true || !result.value?.bytes || result.value.bytes.length > limit) return null;
        return Array.from(result.value.bytes) as number[];
      }
      const token = localStorage.getItem("ai-system-builder.paired-device-token"); if (!token) return null;
      const query = new URLSearchParams({ storageKey: key, workspaceId: workspace, maximumBytes: String(limit) });
      const response = await fetch(`/api/artifact/media/view?${query}`, { redirect: "error", signal: AbortSignal.timeout(30_000), headers: { "x-client-source": "thin-client", authorization: `Bearer ${token}` } });
      if (!response.ok || !response.body) { await response.body?.cancel(); return null; }
      const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
      try { while (true) { const next = await reader.read(); if (next.done) break; size += next.value.byteLength; if (size > limit) return null; chunks.push(next.value); }
      } finally { try { await reader.cancel(); } finally { reader.releaseLock(); } }
      const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; } return Array.from(bytes);
    } catch { return null; }
  }, { host, workspace, key: item.storageKey, limit: LIMIT }).catch(() => null);
  if (!Array.isArray(result) || result.length > LIMIT || !result.every(value => Number.isInteger(value) && value >= 0 && value <= 255)) throw invalid();
  return validateManualContextSnapshot(workspace, item, detail.detail, Uint8Array.from(result), previous);
}

export async function prepareManualContext(page: Page, host: Host) {
  const workspace = await page.getByLabel("Select current workspace").inputValue();
  await page.getByRole("button", { name: "Context", exact: true }).click();
  await page.getByRole("tab", { name: "Context Packs", exact: true }).click();
  await page.getByRole("button", { name: /^Manual entry/ }).click();
  const prepare = page.getByRole("button", { name: "Prepare context pack", exact: true });
  await page.getByLabel("Pack name", { exact: true }).fill(fixed.name); await expect(prepare).toBeDisabled();
  await page.getByLabel("Pack contents", { exact: true }).fill(fixed.markdown); await expect(prepare).toBeEnabled(); await prepare.click();
  await expect(page.getByRole("button", { name: "Save context pack", exact: true })).toBeVisible({ timeout: 60_000 });
  await page.getByRole("button", { name: "Review prepared Markdown", exact: true }).click();
  const review = page.getByRole("dialog", { name: "Review context pack Markdown", exact: true });
  await expect(review.getByRole("heading", { name: "Local support policy", exact: true })).toBeVisible();
  await expect(review.locator("strong")).toContainText("each result");
  await review.getByRole("button", { name: "Approve section", exact: true }).click();
  await review.getByRole("button", { name: "Close dialog", exact: true }).click();
  await page.getByRole("button", { name: "Save context pack", exact: true }).click();
  await expect(page.getByRole("tab", { name: "Context Browser", exact: true })).toHaveAttribute("aria-selected", "true", { timeout: 60_000 });
  const detail = page.getByRole("dialog", { name: "Detail & preview", exact: true });
  await expect(detail.getByRole("heading", { name: fixed.name, exact: true })).toBeVisible();
  await detail.getByRole("button", { name: "Close context detail and preview", exact: true }).click();
  return savedSnapshot(page, host, workspace);
}

export async function verifyManualContextAfterRestart(page: Page, host: Host, saved: ManualContextSnapshot, info: TestInfo) {
  await expect(page.getByLabel("Select current workspace")).toHaveValue(saved.workspace, { timeout: 60_000 });
  await page.getByRole("button", { name: "Context", exact: true }).click();
  await page.getByRole("tab", { name: "Context Browser", exact: true }).click();
  const card = page.locator("article").filter({ has: page.getByRole("heading", { name: fixed.name, exact: true }) }); await expect(card).toHaveCount(1);
  await card.getByRole("button", { name: "View Details", exact: true }).click();
  const detail = page.getByRole("dialog", { name: "Detail & preview", exact: true }); await expect(detail.getByRole("heading", { name: fixed.name, exact: true })).toBeVisible();
  await detail.getByRole("button", { name: "Close context detail and preview", exact: true }).click();
  await savedSnapshot(page, host, saved.workspace, saved);
  await verifyManualContextDiscardAndDelete(page, host, saved);
  const run = process.env.VISUAL_COMPOSER_QUALIFICATION_RUN_ID!, source = process.env.VISUAL_COMPOSER_QUALIFICATION_SOURCE_REVISION!;
  if (!/^[a-z0-9-]{20,80}$/.test(run) || !/^source\.[a-f0-9]{64}$/.test(source)) throw new Error("The current Context journey source identity is unavailable.");
  const folder = path.resolve("artifacts/qualification/visual-composer/runs", run, "manual-context"); await mkdir(folder, { recursive: true }); if (await realpath(folder) !== folder) throw new Error("The Context evidence folder is unavailable.");
  const body = JSON.stringify({ schemaVersion: "manual-context-host-journey-v1", sourceRevision: source, host, status: "passed", ...saved,
    modelGeneration: false, ocr: false, discardNoPublication: true, cancelledDeletePreservedBytes: true,
    confirmedCatalogRemoval: true, deletedDetailRefused: true, removalSurvivedRendererReload: true,
    scope: "Actual fixed manual pack UI/storage/restart/discard/catalog-removal support only. Physical backing-file erasure, native retirement and parent qualification remain separate." }, null, 2) + "\n";
  if (Buffer.byteLength(body) > 8192) throw new Error("The Context evidence exceeded its limit.");
  await writeFile(path.join(folder, `${host}.json`), body, { flag: "wx" }); await info.attach("manual-context-host-journey", { body, contentType: "application/json" });
}

async function verifyManualContextDiscardAndDelete(page: Page, host: Host, saved: ManualContextSnapshot) {
  const before = captureManualContextCatalog(await readManualContextValue(page, host, saved.workspace, { action: "browser-list" }));
  await page.getByRole("tab", { name: "Context Packs", exact: true }).click();
  await page.getByRole("button", { name: /^Manual entry/ }).click();
  await page.getByLabel("Pack name", { exact: true }).fill(fixed.name);
  await page.getByLabel("Pack contents", { exact: true }).fill(fixed.markdown);
  await page.getByRole("button", { name: "Prepare context pack", exact: true }).click();
  const discard = page.getByRole("button", { name: "Discard context pack", exact: true });
  await expect(discard).toBeVisible({ timeout: 60_000 }); await discard.click(); await expect(discard).not.toBeVisible();
  validateManualContextCatalog(await readManualContextValue(page, host, saved.workspace, { action: "browser-list" }), saved, "retained", before);
  await savedSnapshot(page, host, saved.workspace, saved);

  await page.getByRole("tab", { name: "Context Browser", exact: true }).click();
  const card = page.locator("article").filter({ has: page.getByRole("heading", { name: fixed.name, exact: true }) });
  await expect(card).toHaveCount(1); await card.getByRole("button", { name: "View Details", exact: true }).click();
  const detail = page.getByRole("dialog", { name: "Detail & preview", exact: true });
  await expect(detail.getByRole("heading", { name: fixed.name, exact: true })).toBeVisible();
  await detail.getByRole("button", { name: "Delete", exact: true }).click();
  const confirmation = page.getByRole("dialog", { name: "Delete context artifact", exact: true });
  const confirm = confirmation.getByRole("button", { name: "Confirm delete", exact: true });
  await expect(confirm).toBeDisabled(); await confirmation.getByLabel("Confirmation", { exact: true }).fill("delete");
  await expect(confirm).toBeDisabled(); await confirmation.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(confirmation).not.toBeVisible();
  validateManualContextCatalog(await readManualContextValue(page, host, saved.workspace, { action: "browser-list" }), saved, "retained", before);
  await savedSnapshot(page, host, saved.workspace, saved);

  await detail.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(confirm).toBeDisabled(); await confirmation.getByLabel("Confirmation", { exact: true }).fill("Delete");
  await expect(confirm).toBeEnabled(); await confirm.click();
  await expect(confirmation).not.toBeVisible(); await expect(detail).not.toBeVisible(); await expect(card).toHaveCount(0);
  validateManualContextCatalog(await readManualContextValue(page, host, saved.workspace, { action: "browser-list" }), saved, "removed", before);
  await expect(readManualContextValue(page, host, saved.workspace, { action: "browser-detail", artifactId: saved.artifactId })).rejects.toThrow("The saved Context read could not be verified.");
  await page.reload(); await expect(page.getByLabel("Select current workspace")).toHaveValue(saved.workspace, { timeout: 60_000 });
  await page.getByRole("button", { name: "Context", exact: true }).click();
  await page.getByRole("tab", { name: "Context Browser", exact: true }).click(); await expect(card).toHaveCount(0);
  validateManualContextCatalog(await readManualContextValue(page, host, saved.workspace, { action: "browser-list" }), saved, "removed", before);
}
