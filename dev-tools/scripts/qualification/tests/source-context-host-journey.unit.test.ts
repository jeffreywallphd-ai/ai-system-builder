import { afterEach, describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import type { Page } from "@playwright/test";
import fixed from "../visual-composer/daily-source-context-fixture.json";
import { validateSourceContextRecord, validateSourceContextCatalog, validateSourceContextReview, type SourceContextReviewObservation } from "../visual-composer/e2e/source-context-host-journey";
import { readImportedSource } from "../visual-composer/e2e/provided-dataset-version-journey";

const workspace = "workspace.transit", source = { artifactId: "artifact.source", storageKey: "uploads/transit.md", digest: "sha256:" + fixed.source_sha256 };
const hash = (bytes: Uint8Array) => "sha256:" + createHash("sha256").update(bytes).digest("hex");
function valid(rag = true) {
  // Oracle unit data are explicitly synthetic marked bytes. Actual ZIP/Lance
  // generation/inspection/search are covered by the model-free Python tests.
  const bytes = Buffer.from("synthetic marked " + (rag ? "rag" : "pack") + " bytes");
  const kind = rag ? "rag-database" : "markdown-context-pack";
  const mediaType = rag ? "application/vnd.ai-system-builder.rag-database+lancedb+zip" : "application/vnd.ai-system-builder.markdown-context-pack+zip";
  const name = rag ? fixed.rag_name : fixed.pack_name;
  const item = { artifactId: "artifact." + (rag ? "rag" : "pack"), storageKey: "generated/" + (rag ? "rag" : "pack") + ".zip", kind, name, mediaType,
    digest: hash(bytes), sizeBytes: bytes.byteLength, createdAt: "2026-10-27T00:00:00Z" };
  const manifest: Record<string, any> = { schemaVersion: "1", kind, name, mediaType, createdAt: item.createdAt,
    sources: [{ artifactId: source.storageKey, digest: source.digest, mediaType: "text/markdown", originalName: fixed.source_name,
      sizeBytes: Buffer.byteLength(fixed.source_markdown), chunkCount: rag ? 2 : 1, chunkingMode: "extracted" }], manualEntries: [],
    chunking: rag ? { strategy: "fixed-length", chunkCharacters: 128, overlapCharacters: 0, maximumChunks: 10000 }
      : { strategy: "topic-aware", chunkCharacters: 1200, overlapCharacters: 0, maximumTokensPerChunk: 320, topicBoundarySensitivity: 0.22, maximumChunks: 10000 },
    ...(rag ? { embedding: { provider: "transformers", modelId: fixed.embedding_model, dimensions: 384 }, sourceChecks: {
      preset: "recommended", allowedLanguages: ["en"], requireLicenseMetadata: false, requireConsentMetadata: false, includeSourceAttribution: true } }
      : { contextPack: { inputMode: "source-materials", method: "none", cleaningPreset: "standard" } }) };
  const detail = { item: { ...item }, manifest, chunkCount: rag ? 2 : 1,
    packageEntries: rag ? [] : ["README.md", "manifest.json", "sources.md", "topics.md"] };
  return { bytes, item, detail };
}
const capture = (v: ReturnType<typeof valid>, previous?: ReturnType<typeof validateSourceContextRecord>) => validateSourceContextRecord(workspace, source, v.item, v.detail, v.bytes, previous);
const denied = (operation: () => unknown) => assert.throws(operation, /could not verify/);
const globals = new Map<string, PropertyDescriptor | undefined>();
function replace(key: string, value: unknown) {
  if (!globals.has(key)) globals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}
afterEach(() => { for (const [key, value] of globals) { if (value) Object.defineProperty(globalThis, key, value); else Reflect.deleteProperty(globalThis, key); } globals.clear(); });

describe("complete fixed source Context review sequence", () => {
  function chunk(index = 0): SourceContextReviewObservation {
    return { position: index + 1, total: 2, title: `Chunk ${index + 1}`, blocks: [index === 0
      ? "# Harbor Transit\n\n## Route\n\nLine A connects Harbor Station and the Museum. It leaves Harbor Station at 08:00. A day pass covers"
      : "both stops.\n\n## Museum\n\nThe Museum opens at 09:00 and closes at 17:00. Museum tickets do not include a transit pass."],
    citation: `${source.storageKey} · chunk ${index + 1}`, previousDisabled: index === 0, nextDisabled: index === 1, decision: "Not reviewed" };
  }
  it("requires both distinct ordered cited chunks and each approved state", () => {
    for (const index of [0, 1]) {
      const observed = chunk(index); validateSourceContextReview("rag-database", index, source.storageKey, observed, "Not reviewed");
      validateSourceContextReview("rag-database", index, source.storageKey, { ...observed, decision: "Approved" }, "Approved");
    }
    denied(() => validateSourceContextReview("rag-database", 1, source.storageKey, chunk(0), "Not reviewed"));
    denied(() => validateSourceContextReview("rag-database", 0, source.storageKey, chunk(1), "Not reviewed"));
  });
  for (const [field, value] of Object.entries({ position: 2, total: 3, title: "Chunk 2", blocks: ["wrong second chunk"],
    citation: "uploads/foreign.md · chunk 1", previousDisabled: false, nextDisabled: true, decision: "Approved" }))
    it(`refuses changed review ${field}`, () => denied(() => validateSourceContextReview("rag-database", 0, source.storageKey, { ...chunk(), [field]: value }, "Not reviewed")));
  it("requires one exact rendered source-pack topic with its source citation", () => {
    const observed = { position: 1, total: 1, title: "Museum Harbor Transit", blocks: ["Harbor Transit", "Route",
      "Line A connects Harbor Station and the Museum. It leaves Harbor Station at 08:00. A day pass covers both stops.", "Museum",
      "The Museum opens at 09:00 and closes at 17:00. Museum tickets do not include a transit pass."], citation: source.storageKey + " · chunk 1",
      previousDisabled: true, nextDisabled: true, decision: "Not reviewed" };
    validateSourceContextReview("markdown-context-pack", 0, source.storageKey, observed, "Not reviewed");
    for (const changed of [{ blocks: observed.blocks.slice(0, 4) }, { title: "other topic" }, { total: 2 }, { citation: source.storageKey + " · chunk 2" }])
      denied(() => validateSourceContextReview("markdown-context-pack", 0, source.storageKey, { ...observed, ...changed }, "Not reviewed"));
  });
  it("refuses object or getter content before serialization", () => {
    let reads = 0; const observed = chunk();
    observed.blocks = [{ toJSON() { reads++; return observed.blocks[0]; } }] as unknown as string[];
    denied(() => validateSourceContextReview("rag-database", 0, source.storageKey, observed, "Not reviewed")); assert.equal(reads, 0);
  });
});

describe("fixed source Context saved package oracles", () => {
  for (const rag of [false, true]) {
    it(`retains complete byte/manifest identity on reopen for ${rag ? "RAG" : "source pack"}`, () => {
      const v = valid(rag), saved = capture(v); assert.deepEqual(capture(structuredClone(v), saved), saved); assert.equal(Object.isFrozen(saved), true);
      const original = saved.digest; v.item.digest = "sha256:" + "0".repeat(64); assert.equal(saved.digest, original); denied(() => capture(v, saved));
    });
    const changes = {
      digest: (v: ReturnType<typeof valid>) => { v.item.digest = "sha256:" + "0".repeat(64); },
      bytes: (v: ReturnType<typeof valid>) => { v.bytes = Buffer.from("different"); },
      size: (v: ReturnType<typeof valid>) => { v.item.sizeBytes++; },
      detailIdentity: (v: ReturnType<typeof valid>) => { v.detail.item.artifactId = "artifact.other"; },
      name: (v: ReturnType<typeof valid>) => { v.item.name = "other"; },
      media: (v: ReturnType<typeof valid>) => { v.item.mediaType = "application/zip"; },
      sourceId: (v: ReturnType<typeof valid>) => { v.detail.manifest.sources[0].artifactId = "uploads/foreign.md"; },
      sourceDigest: (v: ReturnType<typeof valid>) => { v.detail.manifest.sources[0].digest = "sha256:" + "0".repeat(64); },
      sourceName: (v: ReturnType<typeof valid>) => { v.detail.manifest.sources[0].originalName = "other.md"; },
      sourceSize: (v: ReturnType<typeof valid>) => { v.detail.manifest.sources[0].sizeBytes++; },
      sourceCount: (v: ReturnType<typeof valid>) => { v.detail.manifest.sources.push(v.detail.manifest.sources[0]); },
      manual: (v: ReturnType<typeof valid>) => { v.detail.manifest.manualEntries.push({ id: "other" }); },
      chunkCount: (v: ReturnType<typeof valid>) => { v.detail.chunkCount = 9; },
      chunkSettings: (v: ReturnType<typeof valid>) => { v.detail.manifest.chunking.overlapCharacters = 120; },
      packageMembers: (v: ReturnType<typeof valid>) => { v.detail.packageEntries = ["unexpected"]; },
    };
    for (const [name, change] of Object.entries(changes)) it(`refuses changed ${name} in ${rag ? "RAG" : "source pack"}`, () => { const v = valid(rag); change(v); denied(() => capture(v)); });
  }
  for (const [name, change] of Object.entries({ model: (m: any): void => { m.embedding.modelId = "other/model"; }, dimensions: (m: any): void => { m.embedding.dimensions = 768; },
    modelDevice: (m: any): void => { m.embedding.device = "cuda"; }, language: (m: any): void => { m.sourceChecks.allowedLanguages = ["fr"]; }, attribution: (m: any): void => { m.sourceChecks.includeSourceAttribution = false; } })) {
    it(`refuses a changed RAG ${name}`, () => { const v = valid(); change(v.detail.manifest); denied(() => capture(v)); });
  }
  it("refuses changed source-pack method or cleaning policy", () => {
    for (const changed of [{ method: "local-model" }, { cleaningPreset: "strict" }, { inputMode: "manual" }]) {
      const v = valid(false); Object.assign(v.detail.manifest.contextPack, changed); denied(() => capture(v));
    }
  });
  it("refuses a substituted record, workspace, storage location, timestamp or manifest after restart", () => {
    for (const field of ["artifactId", "storageKey", "createdAt"] as const) {
      const v = valid(), saved = capture(v); v.item[field] += "different"; v.detail.item[field] = v.item[field]; denied(() => capture(v, saved));
    }
    const v = valid(), saved = capture(v); denied(() => validateSourceContextRecord("workspace.other", source, v.item, v.detail, v.bytes, saved));
    v.detail.manifest.createdAt = "2026-10-28T00:00:00Z"; denied(() => capture(v, saved));
  });
  it("rejects accessor-bearing input before evaluating it", () => {
    const v = valid(); let calls = 0;
    Object.defineProperty(v.detail.manifest, "extra", { enumerable: true, get() { calls++; throw new Error("synthetic private diagnostic"); } });
    denied(() => capture(v)); assert.equal(calls, 0);
  });
  it("rejects source-list getters and extra array properties before reading them", () => {
    const v = valid(); let calls = 0;
    Object.defineProperty(v.detail.manifest.sources, "0", { get() { calls++; throw new Error("private"); } });
    denied(() => capture(v)); assert.equal(calls, 0);
    const changed = valid(); changed.detail.manifest.sources.extra = { unsafe: true }; denied(() => capture(changed));
  });
});

describe("fixed source Context full catalog identity", () => {
  function values() { const rag = valid(), pack = valid(false); return { rows: [rag.item, pack.item], saved: [capture(rag), capture(pack)] }; }
  it("compares the whole unordered catalog, including retained unrelated generated records", () => {
    const v = values(); validateSourceContextCatalog({ action: "browser-list", items: [...v.rows].reverse() }, v.saved);
    for (const items of [v.rows.slice(0, 1), [...v.rows, v.rows[0]], [...v.rows, { ...v.rows[0], artifactId: "artifact.extra", storageKey: "generated/extra" }]])
      denied(() => validateSourceContextCatalog({ action: "browser-list", items }, v.saved));
  });
  for (const field of ["artifactId", "storageKey", "name", "mediaType", "digest", "sizeBytes", "createdAt"] as const)
    it(`does not hide a changed ${field} behind a retained original`, () => {
      const v = values(); (v.rows[0] as any)[field] = field === "sizeBytes" ? 10 : "different";
      denied(() => validateSourceContextCatalog({ action: "browser-list", items: v.rows }, v.saved));
    });
  it("requires exactly the expected catalog after a selected removal", () => {
    const v = values(); validateSourceContextCatalog({ action: "browser-list", items: [v.rows[1]] }, [v.saved[1]!]);
    denied(() => validateSourceContextCatalog({ action: "browser-list", items: v.rows }, [v.saved[1]!]));
  });
});

describe("fixed Markdown source public-read admission", () => {
  it("refuses other bytes before reading any host API", async () => {
    const evaluate = mock.fn(() => { throw new Error("No host read expected."); });
    await assert.rejects(readImportedSource({ evaluate } as unknown as Page, "desktop", workspace,
      { name: fixed.source_name, content: Buffer.from("changed") }), /fixed imported source is invalid/);
    assert.equal(evaluate.mock.callCount(), 0);
  });
  for (const host of ["desktop", "thin"] as const) it(`${host} verifies exact imported source identity and bytes using bounded read-only facades`, async () => {
    const bytes = Buffer.from(fixed.source_markdown), calls: unknown[] = [];
    const listed = { ok: true, value: { items: [{ artifactId: source.artifactId, storageKey: source.storageKey, originalName: fixed.source_name }] } };
    replace("window", { desktopApi: { browseArtifacts: async (request: unknown) => { calls.push(request); return listed; },
      readArtifactViewerMedia: async (request: unknown, context: unknown) => { calls.push({ request, context }); return { ok: true, value: { bytes } }; } } });
    replace("localStorage", { getItem: () => "synthetic-test-token" });
    replace("fetch", mock.fn(async (url: string, options: RequestInit) => {
      calls.push({ url, method: options.method });
      return url === "/api/artifact/browse" ? new Response(JSON.stringify(listed), { headers: { "content-type": "application/json" } })
        : new Response(fixed.source_markdown, { headers: { "content-type": "text/markdown" } });
    }));
    const page = { evaluate: async (operation: (input: any) => unknown, input: unknown) => operation(input) } as unknown as Page;
    assert.deepEqual(await readImportedSource(page, host, workspace, { name: fixed.source_name, content: bytes }), source);
    assert.equal(calls.length, 2);
    if (host === "desktop") assert.deepEqual(calls, [{ workspaceId: workspace }, { request: { storageKey: source.storageKey }, context: { workspaceId: workspace, maximumBytes: 65536 } }]);
    else { assert.equal((calls[0] as any).url, "/api/artifact/browse"); assert.match((calls[1] as any).url, /maximumBytes=65536/); }
  });
});
