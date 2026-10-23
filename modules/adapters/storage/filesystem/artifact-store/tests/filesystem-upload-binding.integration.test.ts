import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createFilesystemArtifactObjectStorageAdapter } from "..";
import { createLocalArtifactCatalogPersistenceAdapter, createLocalArtifactStorageBindingAdapter } from "../../artifact-catalog";
import { createStoreArtifactRequest } from "../../../../../contracts/storage";
import { createContractError, createFailureResult } from "../../../../../contracts/shared";
import { createWorkspaceId } from "../../../../../contracts/workspace";
import { createInMemoryStructuredDocumentStore } from "../../../../persistence/shared";

const documentStores = new Map<string, ReturnType<typeof createInMemoryStructuredDocumentStore>>();
function persistence(rootDirectory: string) {
  let documents = documentStores.get(rootDirectory);
  if (!documents) { documents = createInMemoryStructuredDocumentStore(); documentStores.set(rootDirectory, documents); }
  return { rootDirectory, documents };
}

const workspaceId = createWorkspaceId("workspace.upload-binding");
const context = { workspaceId };
const bytes = new TextEncoder().encode("Owned synthetic upload content.");
const request = () => createStoreArtifactRequest(bytes, { descriptor: { mediaType: "text/plain", metadata: { originalFileName: "source.txt" } } });

for (const streamed of [false, true]) test(`fresh ${streamed ? "streamed" : "buffered"} upload persists a workspace-owned binding before catalog success`, async () => {
  const rootDirectory = await mkdtemp(path.join(os.tmpdir(), "upload-binding-"));
  try {
    const bindings = createLocalArtifactStorageBindingAdapter(persistence(rootDirectory));
    const adapter = createFilesystemArtifactObjectStorageAdapter({ rootDirectory, artifactBindingWrite: bindings, artifactCatalogAppend: createLocalArtifactCatalogPersistenceAdapter(persistence(rootDirectory)) });
    const result = streamed ? await adapter.storeArtifactStream({ descriptor: request().descriptor, content: (async function* () { yield bytes; })(), maximumBytes: bytes.length, expectedSizeBytes: bytes.length }, context) : await adapter.storeArtifact(request(), context);
    assert.equal(result.ok, true);
    if (!result.ok) throw new Error("Expected owned upload success");
    const own = await bindings.readArtifactStorageBindings({ workspaceId, artifactId: result.value.key });
    assert.equal(own.ok, true);
    if (!own.ok) throw new Error("Expected owned binding");
    assert.equal(own.value.bindings.length, 1);
    assert.deepEqual(own.value.bindings[0]?.backing, { kind: "artifact-object", provider: "local-filesystem", locator: result.value.key, revision: undefined });
    assert.equal(own.value.bindings[0]?.role, "primary");
    const other = await bindings.readArtifactStorageBindings({ workspaceId: createWorkspaceId("workspace.other"), artifactId: result.value.key });
    assert.ok(other.ok && other.value.bindings.length === 0);
    assert.deepEqual(await readFile(path.join(rootDirectory, result.value.key)), Buffer.from(bytes));
  } finally { await rm(rootDirectory, { recursive: true, force: true }); }
});

test("binding-enabled fresh uploads deny missing workspace/catalog before creating bytes", async () => {
  const rootDirectory = await mkdtemp(path.join(os.tmpdir(), "upload-binding-"));
  try {
    const bindings = createLocalArtifactStorageBindingAdapter(persistence(rootDirectory));
    for (const options of [{ artifactBindingWrite: bindings }, { artifactBindingWrite: bindings, artifactCatalogAppend: createLocalArtifactCatalogPersistenceAdapter(persistence(rootDirectory)) }]) {
      const result = await createFilesystemArtifactObjectStorageAdapter({ rootDirectory, ...options }).storeArtifact(request());
      assert.equal(result.ok, false); assert.deepEqual(await readdir(rootDirectory), []);
    }
  } finally { await rm(rootDirectory, { recursive: true, force: true }); }
});

test("failed binding cannot publish a catalog success or delete another owned file", async () => {
  const rootDirectory = await mkdtemp(path.join(os.tmpdir(), "upload-binding-"));
  try {
    await writeFile(path.join(rootDirectory, "sibling.txt"), "preserve", { flag: "wx" });
    let catalogCalls = 0;
    const catalog = createLocalArtifactCatalogPersistenceAdapter(persistence(rootDirectory));
    const bindings = createLocalArtifactStorageBindingAdapter(persistence(rootDirectory));
    const adapter = createFilesystemArtifactObjectStorageAdapter({ rootDirectory,
      artifactBindingWrite: { ...bindings, async createArtifactStorageBindingIfAbsent() { return createFailureResult(createContractError("unavailable", "Synthetic binding failure")); } },
      artifactCatalogAppend: { ...catalog, async createArtifactCatalogRecordIfAbsent() { catalogCalls++; throw new Error("Must not publish"); } },
    });
    assert.equal((await adapter.storeArtifact(request(), context)).ok, false);
    assert.equal(catalogCalls, 0); assert.equal(await readFile(path.join(rootDirectory, "sibling.txt"), "utf8"), "preserve");
  } finally { await rm(rootDirectory, { recursive: true, force: true }); }
});

test("explicit-key writes and failed no-overwrite collisions never adopt a fresh-upload binding", async () => {
  const rootDirectory = await mkdtemp(path.join(os.tmpdir(), "upload-binding-"));
  try {
    const bindings = createLocalArtifactStorageBindingAdapter(persistence(rootDirectory));
    let bound = 0;
    const adapter = createFilesystemArtifactObjectStorageAdapter({ rootDirectory, now: () => "2026-10-22T00:00:00Z", randomSuffix: () => "fixed",
      artifactBindingWrite: { ...bindings, async createArtifactStorageBindingIfAbsent(input, suppliedContext) { bound++; return bindings.createArtifactStorageBindingIfAbsent(input, suppliedContext); } },
      artifactCatalogAppend: createLocalArtifactCatalogPersistenceAdapter(persistence(rootDirectory)),
    });
    assert.equal((await adapter.storeArtifact(createStoreArtifactRequest(bytes, { descriptor: { key: "existing.txt" } }), context)).ok, true);
    assert.equal(bound, 0);
    assert.equal((await adapter.storeArtifact(request(), context)).ok, true);
    assert.equal((await adapter.storeArtifact(request(), context)).ok, false);
    assert.equal(bound, 1);
  } finally { await rm(rootDirectory, { recursive: true, force: true }); }
});

for (const streamed of [false, true]) test(`fresh ${streamed ? "streamed" : "buffered"} overwrite requests cannot adopt existing uploads`, async () => {
  const rootDirectory = await mkdtemp(path.join(os.tmpdir(), "upload-binding-"));
  try {
    let bound = 0;
    const options = { rootDirectory, now: () => "2026-10-22T00:00:00Z", randomSuffix: () => "legacy" };
    const catalog = createLocalArtifactCatalogPersistenceAdapter(persistence(rootDirectory));
    const legacy = await createFilesystemArtifactObjectStorageAdapter({ ...options, artifactCatalogAppend: catalog }).storeArtifact(request(), context);
    assert.ok(legacy.ok);
    const bindings = createLocalArtifactStorageBindingAdapter(persistence(rootDirectory));
    const adapter = createFilesystemArtifactObjectStorageAdapter({ ...options, artifactCatalogAppend: catalog, artifactBindingWrite: { ...bindings, async createArtifactStorageBindingIfAbsent(input, supplied) { bound++; return bindings.createArtifactStorageBindingIfAbsent(input, supplied); } } });
    const result = streamed ? await adapter.storeArtifactStream({ descriptor: request().descriptor, content: (async function* () { yield bytes; })(), maximumBytes: bytes.length, expectedSizeBytes: bytes.length, overwrite: true }, context) : await adapter.storeArtifact({ ...request(), overwrite: true }, context);
    assert.equal(result.ok, false); assert.equal(bound, 0);
    assert.deepEqual(await readFile(path.join(rootDirectory, legacy.value.key)), Buffer.from(bytes));
  } finally { await rm(rootDirectory, { recursive: true, force: true }); }
});

test("stream callbacks cannot change original explicit-key classification or workspace authority", async () => {
  const rootDirectory = await mkdtemp(path.join(os.tmpdir(), "upload-binding-"));
  try {
    let bound = 0;
    const descriptor: { key?: string; mediaType: string } = { key: `workspaces/${workspaceId}/artifacts/files/uploads/explicit.txt`, mediaType: "text/plain" };
    const supplied = { ...context };
    const adapter = createFilesystemArtifactObjectStorageAdapter({ rootDirectory, artifactCatalogAppend: createLocalArtifactCatalogPersistenceAdapter(persistence(rootDirectory)), artifactBindingWrite: { ...createLocalArtifactStorageBindingAdapter(persistence(rootDirectory)), async createArtifactStorageBindingIfAbsent() { bound++; throw new Error("Explicit key must not be adopted"); } } });
    const result = await adapter.storeArtifactStream({ descriptor, content: (async function* () { descriptor.key = undefined; supplied.workspaceId = createWorkspaceId("workspace.other"); yield bytes; })(), maximumBytes: bytes.length, expectedSizeBytes: bytes.length }, supplied);
    assert.ok(result.ok); assert.equal(bound, 0);
    assert.equal(result.value.key, `workspaces/${workspaceId}/artifacts/files/uploads/explicit.txt`);
  } finally { await rm(rootDirectory, { recursive: true, force: true }); }
});

for (const metadata of ["catalog", "binding", "both"]) test(`fresh uploads refuse existing ${metadata} identity even when its file is absent`, async () => {
  const rootDirectory = await mkdtemp(path.join(os.tmpdir(), "upload-binding-"));
  const key = `workspaces/${workspaceId}/artifacts/files/uploads/20261022000000-legacy.txt`;
  try {
    const catalog = createLocalArtifactCatalogPersistenceAdapter(persistence(rootDirectory));
    const bindings = createLocalArtifactStorageBindingAdapter(persistence(rootDirectory));
    if (metadata !== "binding") assert.ok((await catalog.appendArtifactCatalogRecord({ record: { workspaceId, storageKey: key, artifactFamily: "document", originalName: "legacy.txt" } }, context)).ok);
    if (metadata !== "catalog") assert.ok((await bindings.upsertArtifactStorageBinding({ binding: { workspaceId, artifactId: key, role: "primary", backing: { kind: "artifact-object", provider: "local-filesystem", locator: "legacy/source.txt" } } }, context)).ok);
    const before = await bindings.readArtifactStorageBindings({ workspaceId, artifactId: key });
    const adapter = createFilesystemArtifactObjectStorageAdapter({ rootDirectory, artifactCatalogAppend: catalog, artifactBindingWrite: bindings, now: () => "2026-10-22T00:00:00Z", randomSuffix: () => "legacy" });
    assert.equal((await adapter.storeArtifact(request(), context)).ok, false);
    assert.deepEqual(await bindings.readArtifactStorageBindings({ workspaceId, artifactId: key }), before);
    await assert.rejects(readFile(path.join(rootDirectory, key)), { code: "ENOENT" });
    if (metadata !== "binding") { const retained = await catalog.readArtifactCatalogRecord({ workspaceId, storageKey: key }, context); assert.ok(retained.ok && retained.value.record.originalName === "legacy.txt"); }
  } finally { await rm(rootDirectory, { recursive: true, force: true }); }
});

for (const streamed of [false, true]) test(`failed catalog acknowledgement retains ${streamed ? "streamed" : "buffered"} owned bytes and binding for recovery`, async () => {
  const rootDirectory = await mkdtemp(path.join(os.tmpdir(), "upload-binding-"));
  const key = `workspaces/${workspaceId}/artifacts/files/uploads/20261022000000-retained.txt`;
  try {
    const catalog = createLocalArtifactCatalogPersistenceAdapter(persistence(rootDirectory));
    const bindings = createLocalArtifactStorageBindingAdapter(persistence(rootDirectory));
    const adapter = createFilesystemArtifactObjectStorageAdapter({ rootDirectory, now: () => "2026-10-22T00:00:00Z", randomSuffix: () => "retained", artifactBindingWrite: bindings,
      artifactCatalogAppend: { ...catalog, async createArtifactCatalogRecordIfAbsent() { return createFailureResult(createContractError("unavailable", "Synthetic catalog failure")); } },
    });
    const result = streamed ? await adapter.storeArtifactStream({ descriptor: request().descriptor, content: (async function* () { yield bytes; })(), maximumBytes: bytes.length, expectedSizeBytes: bytes.length }, context) : await adapter.storeArtifact(request(), context);
    assert.equal(result.ok, false);
    assert.deepEqual(await readFile(path.join(rootDirectory, key)), Buffer.from(bytes));
    const retained = await bindings.readArtifactStorageBindings({ workspaceId, artifactId: key });
    assert.ok(retained.ok && retained.value.bindings.length === 1);
    assert.equal((await catalog.readArtifactCatalogRecord({ workspaceId, storageKey: key }, context)).ok, false);
    assert.equal((await adapter.storeArtifact(request(), context)).ok, false);
  } finally { await rm(rootDirectory, { recursive: true, force: true }); }
});

for (const target of ["binding", "catalog"]) test(`metadata inserted after preflight cannot be adopted by conditional ${target} publication`, async () => {
  const rootDirectory = await mkdtemp(path.join(os.tmpdir(), "upload-binding-"));
  const key = `workspaces/${workspaceId}/artifacts/files/uploads/20261022000000-race.txt`;
  try {
    const catalog = createLocalArtifactCatalogPersistenceAdapter(persistence(rootDirectory));
    const bindings = createLocalArtifactStorageBindingAdapter(persistence(rootDirectory));
    const foreignBinding = { workspaceId, artifactId: key, role: "primary" as const, backing: { kind: "artifact-object" as const, provider: "local-filesystem", locator: "concurrent/source.txt" } };
    const adapter = createFilesystemArtifactObjectStorageAdapter({ rootDirectory, now: () => "2026-10-22T00:00:00Z", randomSuffix: () => "race",
      artifactBindingWrite: { ...bindings, async createArtifactStorageBindingIfAbsent(input, supplied) {
        if (target === "binding") assert.ok((await bindings.upsertArtifactStorageBinding({ binding: foreignBinding }, context)).ok);
        return bindings.createArtifactStorageBindingIfAbsent(input, supplied);
      } },
      artifactCatalogAppend: { ...catalog, async createArtifactCatalogRecordIfAbsent(input, supplied) {
        if (target === "catalog") assert.ok((await catalog.appendArtifactCatalogRecord({ record: { workspaceId, storageKey: key, artifactFamily: "document", originalName: "concurrent.txt" } }, context)).ok);
        return catalog.createArtifactCatalogRecordIfAbsent(input, supplied);
      } },
    });
    assert.equal((await adapter.storeArtifact(request(), context)).ok, false);
    assert.deepEqual(await readFile(path.join(rootDirectory, key)), Buffer.from(bytes));
    const stored = await bindings.readArtifactStorageBindings({ workspaceId, artifactId: key });
    assert.ok(stored.ok && stored.value.bindings.length === 1);
    if (target === "binding") assert.deepEqual(stored.value.bindings[0]?.backing.locator, "concurrent/source.txt");
    else { const retained = await catalog.readArtifactCatalogRecord({ workspaceId, storageKey: key }, context); assert.ok(retained.ok && retained.value.record.originalName === "concurrent.txt"); }
  } finally { await rm(rootDirectory, { recursive: true, force: true }); }
});
