import { afterEach, describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import type { Page } from "@playwright/test";
import { normalizeDatasetVersionRecord } from "../../../../modules/contracts/dataset";
import fixed from "../visual-composer/daily-row-review-fixture.json";
import { readSavedRowPage, validateSavedRowPage, validateSavedRowHistory, type RowEvidence } from "../visual-composer/e2e/saved-row-review-host-journey";

const hash = (value: string | Uint8Array) => "sha256:" + createHash("sha256").update(value).digest("hex");
function canonical(value: unknown): string {
  const ordered = (value: any): any => value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map(key => [key, ordered(value[key])])) : value;
  return JSON.stringify(ordered(value));
}
const source = { artifactId: "artifact.fixed", storageKey: "sources/fixed.csv", digest: hash("fixed source bytes") };
const workspace = "workspace.synthetic";
function valid(): RowEvidence[] {
  // This oracle unit deliberately uses marked synthetic binary bytes. Real
  // Parquet writing/reading is checked by the separate production-codec tests.
  const evidence: RowEvidence[] = [];
  for (let index = 0; index < 3; index++) {
    const parent = evidence[index - 1], versionId = `saved-review:${index}`;
    const old = parent?.rows.rows.map(row => row.values as Record<string, unknown> & { text: string });
    const replacement = old ? { ...old[0]!, text: old[0]!.text + fixed.edit_suffix } : undefined;
    const values = index === 0 ? fixed.rows.map((row, sourceRowIndex) => ({ ...row, sourceArtifactId: source.artifactId, sourceRowIndex, split: "train",
      sourceAttribution: { sourceArtifactId: source.artifactId, sourceName: fixed.source_name } }))
      : index === 1 ? [replacement!, ...old!.slice(1)] : old!.filter((_, i) => i !== 1);
    const rowIndex = index === 1 ? 0 : 1;
    const originalRowFingerprint = parent?.rows.rows[rowIndex]!.rowFingerprint;
    const replacementFingerprint = index === 1 ? hash(JSON.stringify(replacement)) : undefined;
    const recipeValue = index === 0 ? { recipe: { task: { textInputMode: "provided" } }, output: { format: "parquet" } }
      : { operation: index === 1 ? "dataset-row-edit" : "dataset-row-review", parentVersionId: parent!.version.versionId,
        rowIndex, originalRowFingerprint, ...(replacementFingerprint ? { replacementFingerprint } : {}) };
    const binary = Buffer.from(`PAR1synthetic oracle bytes ${index}PAR1`), recipe = Buffer.from(JSON.stringify(recipeValue));
    const key = `datasets/${index}.parquet`, recipeKey = `recipes/${index}.json`;
    const report = index === 0 ? hash("root report") : hash(JSON.stringify({ operation: index === 1 ? "edit-row" : "reject-row",
      parentVersionId: parent!.version.versionId, rowIndex, rowFingerprint: originalRowFingerprint,
      ...(replacementFingerprint ? { replacementFingerprint } : {}) }));
    const version = { schemaVersion: "1.0", versionId, datasetId: "saved-review", workspaceId: workspace, versionDigest: hash(`version${index}`),
      artifacts: [{ role: "dataset", artifactKey: key, digest: hash(binary), sizeBytes: binary.length, rowCount: values.length, mediaType: "application/vnd.apache.parquet" },
        { role: "recipe", artifactKey: recipeKey, digest: hash(recipe), sizeBytes: recipe.length, mediaType: "application/json" }],
      lineage: { sources: [{ sourceArtifactId: source.artifactId, artifactKey: source.storageKey, digest: source.digest, mediaType: "text/csv" }],
        recipe: { artifactKey: recipeKey, digest: hash(recipe), implementationId: index === 0 ? "builtin.preparation" : index === 1 ? "builtin.dataset-row-edit" : "builtin.dataset-row-review", implementationVersion: "1.0.0" },
        quality: { policyId: "standard", policyVersion: "1", policyFingerprint: hash("policy"), reportFingerprint: report },
        ...(parent ? { parentVersionId: parent.version.versionId } : {}) },
      documentation: { name: fixed.dataset_name, summary: "Synthetic", intendedUses: ["testing"], limitations: ["synthetic"] },
      totalRows: values.length, createdAt: "2026-10-26T00:00:00.000Z", createdBy: "qualification" };
    const rows = { artifactKey: key, versionId, page: 0, pageSize: 10, totalRows: values.length,
      rows: values.map((value, rowIndex) => ({ rowIndex, rowFingerprint: hash(canonical(value)), values: value, editable: true })) };
    const normalized = normalizeDatasetVersionRecord(version as unknown as Parameters<typeof normalizeDatasetVersionRecord>[0]);
    evidence.push({ version: normalized, rows: rows as unknown as RowEvidence["rows"], bytes: { [key]: binary, [recipeKey]: recipe } });
  }
  return evidence;
}
const reject = (action: () => unknown) => assert.throws(action, /^Error: The saved row review did not match its expected data or history\.$/);
describe("saved-row exact history oracle", () => {
  it("accepts the original, edited and rejected chain and its immutable restart snapshot", () => {
    const all = valid(); for (const count of [1, 2, 3]) assert.doesNotThrow(() => validateSavedRowHistory(workspace, source, all.slice(0, count)));
    assert.doesNotThrow(() => validateSavedRowHistory(workspace, source, valid(), all));
  });
  const changes: Record<string, (all: RowEvidence[]) => void> = {
    "wrong workspace": all => { (all[1]!.version as any).workspaceId = "workspace.other"; },
    "wrong dataset": all => { (all[1]!.version as any).datasetId = "different"; },
    "missing parent": all => { delete (all[1]!.version.lineage as any).parentVersionId; },
    "skipped parent": all => { (all[2]!.version.lineage as any).parentVersionId = all[0]!.version.versionId; },
    "duplicate version": all => { (all[1]!.version as any).versionId = all[0]!.version.versionId; },
    "changed source id": all => { (all[1]!.version.lineage.sources[0] as any).sourceArtifactId = "artifact.other"; },
    "changed source key": all => { (all[0]!.version.lineage.sources[0] as any).artifactKey = "other.csv"; },
    "changed source digest": all => { (all[2]!.version.lineage.sources[0] as any).digest = hash("other"); },
    "changed source media": all => { (all[2]!.version.lineage.sources[0] as any).mediaType = "text/plain"; },
    "changed row count": all => { (all[1]!.version as any).totalRows = 7; },
    "changed artifact row count": all => { (all[2]!.version.artifacts[0] as any).rowCount = 8; },
    "changed artifact size": all => { (all[1]!.version.artifacts[0] as any).sizeBytes += 1; },
    "changed bytes": all => { all[0]!.bytes["datasets/0.parquet"] = Buffer.from("PAR1otherPAR1"); },
    "extra bytes": all => { all[1]!.bytes.extra = Buffer.from("extra"); },
    "missing recipe": all => { delete all[1]!.bytes["recipes/1.json"]; },
    "changed recipe binding": all => { (all[1]!.version.lineage.recipe as any).digest = hash("other"); },
    "changed implementation": all => { (all[1]!.version.lineage.recipe as any).implementationId = "builtin.other"; },
    "changed quality policy": all => { (all[1]!.version.lineage.quality as any).policyFingerprint = hash("other"); },
    "changed review report": all => { (all[2]!.version.lineage.quality as any).reportFingerprint = hash("other"); },
    "changed row identity": all => { (all[1]!.rows.rows[0] as any).rowFingerprint = hash("other"); },
    "swapped row order": all => { (all[2]!.rows.rows as any).reverse(); },
    "unrequested replacement": all => { (all[1]!.rows.rows[0]!.values as any).label = "other"; },
    "changed source row index": all => { (all[0]!.rows.rows[0]!.values as any).sourceRowIndex = 10; },
    "unexpected column": all => { (all[0]!.rows.rows[0]!.values as any).extra = "unexpected"; },
    "changed nested attribution": all => { (all[0]!.rows.rows[0]!.values as any).sourceAttribution.sourceArtifactId = "artifact.other"; },
    "invalid split": all => { (all[0]!.rows.rows[0]!.values as any).split = "other"; },
  };
  for (const [name, change] of Object.entries(changes)) it(`rejects ${name}`, () => { const all = valid(); change(all); reject(() => validateSavedRowHistory(workspace, source, all)); });
  it("rejects a well-hashed but wrong stored recipe operation", () => {
    const all = valid(), entry = all[1]!, recipe = entry.version.artifacts[1]!;
    entry.bytes[recipe.artifactKey] = Buffer.from(JSON.stringify({ ...JSON.parse(entry.bytes[recipe.artifactKey]!.toString()), rowIndex: 1 }));
    (recipe as any).digest = (entry.version.lineage.recipe as any).digest = hash(entry.bytes[recipe.artifactKey]!); (recipe as any).sizeBytes = entry.bytes[recipe.artifactKey]!.length;
    reject(() => validateSavedRowHistory(workspace, source, all));
  });
  it("matches the codec fingerprint when nested attribution keys arrive in a different order", () => {
    const value = valid()[0]!.rows, row = value.rows[0]!;
    (row.values as any).sourceAttribution = { sourceName: fixed.source_name, sourceArtifactId: source.artifactId };
    assert.doesNotThrow(() => validateSavedRowPage(value, value.artifactKey, value.versionId!, 8));
  });
  it("rejects a later record metadata change even when the chain still agrees", () => {
    const previous = valid(), current = valid(); (current[0]!.version as any).createdBy = "unexpected";
    reject(() => validateSavedRowHistory(workspace, source, current, previous));
  });
  it("refuses empty, excess and missing restart versions", () => {
    for (const all of [[], [...valid(), valid()[0]!]]) reject(() => validateSavedRowHistory(workspace, source, all));
    reject(() => validateSavedRowHistory(workspace, source, valid().slice(0, 2), valid()));
  });
  it("does not invoke row or value accessors", () => {
    for (const target of ["row", "values"]) {
      const page = valid()[0]!.rows; let calls = 0;
      Object.defineProperty(target === "row" ? page.rows[0] : page.rows[0]!.values, "hidden", { enumerable: true, get() { calls++; throw new Error("private payload"); } });
      reject(() => validateSavedRowPage(page, page.artifactKey, page.versionId!, 8)); assert.equal(calls, 0);
    }
  });
});

const globals = new Map<string, PropertyDescriptor | undefined>();
function replace(name: string, value: unknown) { if (!globals.has(name)) globals.set(name, Object.getOwnPropertyDescriptor(globalThis, name)); Object.defineProperty(globalThis, name, { configurable: true, writable: true, value }); }
afterEach(() => { for (const [name, descriptor] of globals) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); } globals.clear(); });
const page = () => ({ evaluate: mock.fn(async (operation: (input: unknown) => unknown, input: unknown) => operation(input)) }) as unknown as Page;
describe("saved-row public read bounds and authority", () => {
  for (const host of ["desktop", "thin"] as const) it(`reads only the scoped public ${host} page`, async () => {
    const value = valid()[0]!.rows;
    replace("window", { desktopApi: { readDatasetReviewPage: mock.fn(async (input: unknown) => { assert.deepEqual(input, { workspaceId: workspace, artifactKey: value.artifactKey, versionId: value.versionId, page: 0, pageSize: 10 }); return { ok: true, value: { page: value } }; }) } });
    replace("localStorage", { getItem: () => "synthetic-token" });
    replace("fetch", mock.fn(async (url: string, options: RequestInit & { headers: Record<string, string> }) => { const parsed = new URL(url, "http://synthetic.invalid");
      assert.equal(parsed.pathname, "/api/dataset-reviews/page"); assert.equal(parsed.searchParams.get("workspaceId"), workspace); assert.equal(parsed.searchParams.get("versionId"), value.versionId);
      assert.equal(options.method, "GET"); assert.equal(options.redirect, "error"); assert.equal(options.body, undefined); assert.equal(options.headers.authorization, "Bearer synthetic-token");
      return Response.json({ ok: true, value: { page: value } }); }));
    assert.deepEqual(await readSavedRowPage(page(), host, workspace, value.artifactKey, value.versionId!, 8), value);
  });
  for (const field of ["versionId", "artifactKey", "page", "pageSize", "totalRows", "rows"] as const) it(`rejects a substituted ${field}`, async () => {
    const value = valid()[0]!.rows, changed = { ...value, [field]: field === "rows" ? [] : "wrong" };
    replace("window", { desktopApi: { readDatasetReviewPage: async () => ({ ok: true, value: { page: changed } }) } });
    await assert.rejects(readSavedRowPage(page(), "desktop", workspace, value.artifactKey, value.versionId!, 8), /expected data or history/);
  });
  it("does not make a request without the existing paired token", async () => {
    replace("localStorage", { getItem: () => null }); const fetcher = mock.fn(); replace("fetch", fetcher);
    await assert.rejects(readSavedRowPage(page(), "thin", workspace, "fixed.parquet", "fixed:1", 8)); assert.equal(fetcher.mock.callCount(), 0);
  });
  for (const mode of ["oversize", "invalid-utf8", "malformed-json", "wrong-type", "non-ok", "private-error"] as const) it(`denies ${mode} with fixed public copy and releases reads`, async () => {
    replace("localStorage", { getItem: () => "synthetic-token" }); let cancelled = false, released = false;
    replace("fetch", async () => {
      if (mode === "private-error") throw new Error("private payload");
      const bytes = mode === "oversize" ? new Uint8Array(65_537) : mode === "invalid-utf8" ? Uint8Array.of(255) : Buffer.from("invalid-json");
      let reads = 0;
      return { ok: mode !== "non-ok", headers: new Headers({ "content-type": mode === "wrong-type" ? "text/plain" : "application/json" }),
        body: { cancel: async () => { cancelled = true; }, getReader: () => ({
          read: async () => reads++ === 0 ? { done: false, value: bytes } : { done: true },
          cancel: async () => { cancelled = true; }, releaseLock: () => { released = true; } }) } };
    });
    await assert.rejects(readSavedRowPage(page(), "thin", workspace, "fixed.parquet", "fixed:1", 8), /^Error: The saved row review did not match its expected data or history\.$/);
    if (mode !== "private-error") assert.equal(cancelled, true);
    if (!["private-error", "wrong-type", "non-ok"].includes(mode)) assert.equal(released, true);
  });
  it("rejects invalid input before invoking the browser", async () => {
    const view = page(); await assert.rejects(readSavedRowPage(view, "thin", "other", "fixed.parquet", "fixed:1", 8));
    assert.equal((view.evaluate as any).mock.callCount(), 0);
  });
});
