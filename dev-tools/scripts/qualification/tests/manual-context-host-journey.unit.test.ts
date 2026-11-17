import { afterEach, describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fixed from "../visual-composer/daily-context-fixture.json";
import type { Page } from "@playwright/test";
import { readManualContextValue, validateManualContextSnapshot, validateManualContextCatalog, captureManualContextCatalog } from "../visual-composer/e2e/manual-context-host-journey";

const globals = new Map<string, PropertyDescriptor | undefined>();
function replace(name: string, value: unknown) {
  if (!globals.has(name)) globals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
}
afterEach(() => { for (const [name, descriptor] of globals) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); } globals.clear(); });
const page = () => ({ evaluate: mock.fn(async (operation: (input: unknown) => unknown, input: unknown) => operation(input)) }) as unknown as Page;

const media = "application/vnd.ai-system-builder.markdown-context-pack+zip";
const hash = (raw: Uint8Array) => "sha256:" + createHash("sha256").update(raw).digest("hex");
function valid() {
  // The oracle unit checks metadata/byte identity. Real ZIP generation and
  // inspection delegation is tested separately in the fixed Python fixture.
  const bytes = Buffer.from("synthetic bounded package bytes");
  const item = { artifactId: "artifact.synthetic", storageKey: "generated/context/synthetic.zip", name: fixed.name,
    kind: "markdown-context-pack", mediaType: media, sizeBytes: bytes.byteLength, digest: hash(bytes) };
  const detail = { item: { ...item }, chunkCount: 1, packageEntries: ["manifest.json", "README.md", "context.md"],
    manifest: { schemaVersion: "1", kind: item.kind, name: fixed.name, mediaType: media, sources: [],
      manualEntries: [{ id: "manual-entry-1", title: fixed.name, digest: hash(Buffer.from(fixed.markdown)) }],
      contextPack: { inputMode: "manual", method: "none" } } };
  return { bytes, item, detail };
}

describe("manual Context discard and delete catalog oracle", () => {
  function catalog() {
    const { item, detail, bytes } = valid();
    return { page: { action: "browser-list", items: [item] }, item,
      saved: validateManualContextSnapshot("workspace.synthetic", item, detail, bytes) };
  }
  it("requires the exact retained artifact after discard or cancelled deletion", () => {
    const { page, saved } = catalog(); assert.doesNotThrow(() => validateManualContextCatalog(page, saved, "retained"));
  });
  it("rejects an extra distinct publication after discard or cancelled deletion", () => {
    const { page, saved, item } = catalog(); const before = captureManualContextCatalog(page);
    page.items.push({ ...item, artifactId: "artifact.extra", storageKey: "generated/context/extra.zip", name: "Accidental publication" });
    rejected(() => validateManualContextCatalog(page, saved, "retained", before));
  });
  it("compares all original catalog entries and ignores list order", () => {
    const { page, saved, item } = catalog();
    page.items.push({ ...item, artifactId: "artifact.other", storageKey: "generated/context/other.zip", name: "Unrelated Context" });
    const before = captureManualContextCatalog(page); page.items.reverse();
    assert.doesNotThrow(() => validateManualContextCatalog(page, saved, "retained", before));
    page.items.find(item => item.artifactId === "artifact.other")!.name = "Unexpected change";
    rejected(() => validateManualContextCatalog(page, saved, "retained", before));
  });
  it("cannot hide unrelated deletion when the target was removed", () => {
    const { page, saved, item } = catalog(); const other = { ...item, artifactId: "artifact.other", storageKey: "generated/context/other.zip", name: "Unrelated Context" };
    page.items.push(other); const before = captureManualContextCatalog(page);
    assert.doesNotThrow(() => validateManualContextCatalog({ action: "browser-list", items: [other] }, saved, "removed", before));
    rejected(() => validateManualContextCatalog({ action: "browser-list", items: [] }, saved, "removed", before));
  });
  for (const field of ["kind", "mediaType", "createdAt"] as const) {
    it(`rejects a catalog ${field} change after discard`, () => {
      const { page, saved } = catalog(); const before = captureManualContextCatalog(page);
      (page.items[0] as Record<string, unknown>)[field] = "changed";
      rejected(() => validateManualContextCatalog(page, saved, "retained", before));
    });
  }
  it("accepts confirmed removal without requiring unrelated Context artifacts to disappear", () => {
    const { saved, item } = catalog();
    const page = { action: "browser-list", items: [{ ...item, artifactId: "artifact.other", storageKey: "generated/context/other.zip", name: "Other saved Context" }] };
    assert.doesNotThrow(() => validateManualContextCatalog(page, saved, "removed"));
  });
  for (const field of ["artifactId", "storageKey", "digest", "sizeBytes"] as const) {
    it(`refuses a retained artifact with changed ${field}`, () => {
      const { page, saved } = catalog(); const item = page.items[0]! as Record<string, unknown>;
      item[field] = field === "sizeBytes" ? 1 : "substituted"; rejected(() => validateManualContextCatalog(page, saved, "retained"));
    });
  }
  it("does not accept a missing artifact as a successful discard or cancelled deletion", () => {
    const { saved } = catalog(); rejected(() => validateManualContextCatalog({ action: "browser-list", items: [] }, saved, "retained"));
  });
  for (const field of ["artifactId", "storageKey", "name"] as const) {
    it(`refuses removal while the saved ${field} remains`, () => {
      const { saved, item } = catalog(); const lookalike = { ...item, artifactId: "artifact.other", storageKey: "generated/context/other.zip", name: "Other" };
      lookalike[field] = item[field]; rejected(() => validateManualContextCatalog({ action: "browser-list", items: [lookalike] }, saved, "removed"));
    });
  }
  for (const field of ["artifactId", "storageKey"] as const) {
    it(`refuses duplicate catalog ${field} even outside the saved target`, () => {
      const { page, saved, item } = catalog();
      const other = { ...item, artifactId: "artifact.other", storageKey: "generated/context/other.zip", name: "Other" };
      const duplicate = { ...other, artifactId: "artifact.duplicate", storageKey: "generated/context/duplicate.zip" }; duplicate[field] = other[field];
      page.items.push(other, duplicate); rejected(() => validateManualContextCatalog(page, saved, "retained"));
    });
  }
  it("refuses malformed, oversized, wrong-action and unknown-state catalog claims", () => {
    const { saved, item } = catalog();
    for (const value of [null, [], { action: "browser-detail", items: [] }, { action: "browser-list", items: null },
      { action: "browser-list", items: Array(9).fill(item) }, { action: "browser-list", items: [null] }]) {
      rejected(() => validateManualContextCatalog(value, saved, "removed"));
    }
    rejected(() => validateManualContextCatalog({ action: "browser-list", items: [] }, saved, "unknown" as "removed"));
  });
  it("rejects catalog record accessors without invoking supplier code", () => {
    const { page, saved } = catalog(); let reads = 0;
    Object.defineProperty(page.items[0], "diagnostic", { get() { reads++; throw new Error("synthetic-private-diagnostic"); } });
    rejected(() => validateManualContextCatalog(page, saved, "retained")); assert.equal(reads, 0);
  });
});
const rejected = (operation: () => unknown) => assert.throws(operation, error => {
  assert.ok(error instanceof Error); assert.match(error.message, /^The saved manual Context pack did not match/);
  assert.equal(error.message.includes("synthetic-private-diagnostic"), false); return true;
});

describe("manual Context public read boundary", () => {
  for (const host of ["desktop", "thin"] as const) for (const action of ["browser-list", "browser-detail"] as const) {
    it(`keeps exact ${host} ${action} routing`, async () => {
      const value = { action, items: [] };
      const invoke = mock.fn(async () => ({ ok: true, value }));
      replace("window", { desktopApi: { executeContextManagement: invoke } });
      replace("localStorage", { getItem: () => "synthetic-pairing-only" });
      const fetch = mock.fn(async () => new Response(JSON.stringify({ ok: true, value }), { headers: { "content-type": "application/json" } })); replace("fetch", fetch);
      const command = action === "browser-list" ? { action } : { action, artifactId: "artifact.synthetic" };
      assert.deepEqual(await readManualContextValue(page(), host, "workspace.synthetic", command), value);
      if (host === "desktop") { assert.equal(fetch.mock.callCount(), 0); assert.deepEqual(invoke.mock.calls[0]!.arguments, [{ workspaceId: "workspace.synthetic", command }]); }
      else { const [url, options] = fetch.mock.calls[0]!.arguments as unknown as [string, RequestInit];
        assert.equal(url, "/api/context-management/read"); assert.equal(options.redirect, "error"); assert.deepEqual(JSON.parse(options.body as string), { workspaceId: "workspace.synthetic", command }); }
    });
  }
  it("never sends a mutation or invalid scope through the read helper", async () => {
    const target = page();
    await assert.rejects(readManualContextValue(target, "thin", "workspace.synthetic", { action: "generation-start" } as never));
    await assert.rejects(readManualContextValue(target, "thin", "", { action: "browser-list" }));
    assert.equal((target.evaluate as unknown as { mock: { callCount(): number } }).mock.callCount(), 0);
  });
  it("does not request data without a pairing credential", async () => {
    replace("window", {}); replace("localStorage", { getItem: () => null }); const fetch = mock.fn(); replace("fetch", fetch);
    await assert.rejects(readManualContextValue(page(), "thin", "workspace.synthetic", { action: "browser-list" }), /saved Context read could not be verified/);
    assert.equal(fetch.mock.callCount(), 0);
  });
  it("cancels an oversized HTTP stream and does not return partial evidence", async () => {
    replace("window", {}); replace("localStorage", { getItem: () => "synthetic-pairing-only" });
    const cancel = mock.fn(); const body = new ReadableStream({ pull(c) { c.enqueue(new Uint8Array(65_537)); }, cancel }, { highWaterMark: 0 });
    replace("fetch", mock.fn(async () => new Response(body, { headers: { "content-type": "application/json" } })));
    await assert.rejects(readManualContextValue(page(), "thin", "workspace.synthetic", { action: "browser-list" }), /saved Context read could not be verified/);
    assert.equal(cancel.mock.callCount(), 1); assert.equal(body.locked, false);
  });
  it("does not publish a foreign IPC action or raw rejection text", async () => {
    for (const invoke of [async () => ({ ok: true, value: { action: "generation-start" } }), async () => { throw new Error("synthetic-private-diagnostic"); }]) {
      replace("window", { desktopApi: { executeContextManagement: invoke } });
      await assert.rejects(readManualContextValue(page(), "desktop", "workspace.synthetic", { action: "browser-list" }), error => {
        assert.ok(error instanceof Error); assert.match(error.message, /saved Context read could not be verified/); assert.equal(error.message.includes("synthetic-private-diagnostic"), false); return true;
      });
    }
  });
});

describe("manual Context real-host evidence oracle", () => {
  it("binds current workspace, exact saved identity, bytes and manual digest", () => {
    const { bytes, item, detail } = valid();
    const snapshot = validateManualContextSnapshot("workspace.synthetic", item, detail, bytes);
    assert.deepEqual(snapshot, { workspace: "workspace.synthetic", artifactId: item.artifactId, storageKey: item.storageKey,
      digest: hash(bytes), sizeBytes: bytes.byteLength, manualDigest: hash(Buffer.from(fixed.markdown)) });
    assert.deepEqual(validateManualContextSnapshot("workspace.synthetic", item, detail, bytes, snapshot), snapshot);
  });
  for (const field of ["artifactId", "storageKey", "name", "kind", "mediaType", "sizeBytes", "digest"]) {
    it(`refuses a mismatched inspected ${field}`, () => {
      const { bytes, item, detail } = valid(); (detail.item as Record<string, unknown>)[field] = "synthetic-private-diagnostic";
      rejected(() => validateManualContextSnapshot("workspace.synthetic", item, detail, bytes));
    });
  }
  it("does not accept replaced bytes under a previous correct descriptor", () => {
    const { bytes, item, detail } = valid(); const changed = Uint8Array.from(bytes); changed[0] ^= 1;
    rejected(() => validateManualContextSnapshot("workspace.synthetic", item, detail, changed));
  });
  it("does not accept a new lookalike artifact after restart", () => {
    const { bytes, item, detail } = valid(); const before = validateManualContextSnapshot("workspace.synthetic", item, detail, bytes);
    item.artifactId = detail.item.artifactId = "artifact.replacement";
    rejected(() => validateManualContextSnapshot("workspace.synthetic", item, detail, bytes, before));
  });
  it("does not accept a different workspace after restart", () => {
    const { bytes, item, detail } = valid(); const before = validateManualContextSnapshot("workspace.synthetic", item, detail, bytes);
    rejected(() => validateManualContextSnapshot("workspace.other", item, detail, bytes, before));
  });
  it("refuses empty and oversized content", () => {
    for (const size of [0, 16385]) {
      const { item, detail } = valid(); const bytes = new Uint8Array(size); item.sizeBytes = detail.item.sizeBytes = size; item.digest = detail.item.digest = hash(bytes);
      rejected(() => validateManualContextSnapshot("workspace.synthetic", item, detail, bytes));
    }
  });
  it("requires a manual-only manifest and the fixed content digest", () => {
    const changes = [
      (d: any) => d.manifest.manualEntries.splice(0),
      (d: any) => d.manifest.manualEntries.push({ ...d.manifest.manualEntries[0], id: "extra" }),
      (d: any) => d.manifest.manualEntries[0].digest = "sha256:" + "0".repeat(64),
      (d: any) => d.manifest.sources.push({ artifactId: "artifact.unexpected" }),
      (d: any) => d.manifest.contextPack.method = "local-model",
      (d: any) => d.manifest.schemaVersion = "unknown",
      (d: any) => d.chunkCount = 0,
      (d: any) => d.packageEntries.push("extra.bin"),
      (d: any) => d.packageEntries = [{ toString: "synthetic-private-diagnostic" }, "context.md", "manifest.json"],
    ];
    for (const change of changes) {
      const { bytes, item, detail } = valid(); change(detail); rejected(() => validateManualContextSnapshot("workspace.synthetic", item, detail, bytes));
    }
  });
  it("refuses malformed records and accessors without evaluating them", () => {
    const { bytes, item, detail } = valid();
    for (const value of [null, [], "synthetic-private-diagnostic"]) rejected(() => validateManualContextSnapshot("workspace.synthetic", value, detail, bytes));
    let reads = 0;
    const hostile = { ...item, get unused() { reads++; throw new Error("synthetic-private-diagnostic"); } };
    rejected(() => validateManualContextSnapshot("workspace.synthetic", hostile, detail, bytes)); assert.equal(reads, 0);
  });
});
