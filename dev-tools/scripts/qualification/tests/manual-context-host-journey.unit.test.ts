import { afterEach, describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fixed from "../visual-composer/daily-context-fixture.json";
import type { Page } from "@playwright/test";
import { readManualContextValue, validateManualContextSnapshot } from "../visual-composer/e2e/manual-context-host-journey";

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
