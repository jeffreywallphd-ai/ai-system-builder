import assert from "node:assert/strict";
import { test } from "node:test";
import { createLocalArtifactCatalogPersistenceAdapter, createLocalArtifactStorageBindingAdapter } from "..";
import { createInMemoryStructuredDocumentStore, readDocumentRecord, writeDocumentRecord } from "../../../../persistence/shared";
import { createWorkspaceId } from "../../../../../contracts/workspace";
import { createOrganizationId } from "../../../../../contracts/organization";

const workspaceId = createWorkspaceId("workspace.conditional");
const context = { workspaceId };
const rootDirectory = process.cwd(); // Document-backed tests perform no filesystem writes.
const record = { workspaceId, storageKey: "new.txt", artifactFamily: "document" as const };
const binding = { workspaceId, artifactId: "new.txt", role: "primary" as const, backing: { kind: "artifact-object" as const, provider: "local-filesystem", locator: "new.txt" } };

test("concurrent conditional catalog and binding creates each have one winner without replacing another origin", async () => {
  const documents = createInMemoryStructuredDocumentStore();
  const catalog = createLocalArtifactCatalogPersistenceAdapter({ rootDirectory, documents });
  const bindings = createLocalArtifactStorageBindingAdapter({ rootDirectory, documents });
  for (const run of [() => Promise.all([catalog.createArtifactCatalogRecordIfAbsent({ record }, context), catalog.createArtifactCatalogRecordIfAbsent({ record: { ...record, originalName: "other" } }, context)]),
    () => Promise.all([bindings.createArtifactStorageBindingIfAbsent({ binding }, context), bindings.createArtifactStorageBindingIfAbsent({ binding: { ...binding, backing: { ...binding.backing, locator: "other.txt" } } }, context)])]) {
    const results = await run();
    assert.equal(results.filter(result => result.ok).length, 1);
    assert.equal(results.filter(result => !result.ok && result.error.code === "conflict").length, 1);
  }
  const stored = await bindings.readArtifactStorageBindings({ workspaceId, artifactId: binding.artifactId });
  assert.ok(stored.ok && stored.value.bindings.length === 1);
});

test("conditional mutations preserve unrelated raw records and reject malformed or tombstoned state unchanged", async () => {
  for (const family of ["catalog", "binding"]) {
    const documents = createInMemoryStructuredDocumentStore();
    const options = { rootDirectory, documents };
    const file = `.catalog/${family === "catalog" ? "artifact-catalog" : "artifact-storage-bindings"}.ndjson`;
    const adapter = family === "catalog" ? createLocalArtifactCatalogPersistenceAdapter(options) : createLocalArtifactStorageBindingAdapter(options);
    const create = () => family === "catalog"
      ? (adapter as ReturnType<typeof createLocalArtifactCatalogPersistenceAdapter>).createArtifactCatalogRecordIfAbsent({ record }, context)
      : (adapter as ReturnType<typeof createLocalArtifactStorageBindingAdapter>).createArtifactStorageBindingIfAbsent({ binding }, context);
    const unrelated = family === "catalog" ? { ...record, storageKey: "unrelated.txt", opaque: { retained: true } } : { ...binding, artifactId: "unrelated.txt", opaque: { retained: true } };
    await writeDocumentRecord(options, file, [unrelated]);
    assert.ok((await create()).ok);
    assert.deepEqual((await readDocumentRecord(options, file, [])).value[0], unrelated);
    for (const raw of [[{ invalid: "unchanged" }], [family === "catalog" ? { workspaceId, storageKey: record.storageKey, deletedAt: "2026-10-22T00:00:00Z" } : { workspaceId, artifactId: binding.artifactId, deletedAt: "2026-10-22T00:00:00Z" }]]) {
      await writeDocumentRecord(options, file, raw);
      assert.equal((await create()).ok, false);
      assert.deepEqual((await readDocumentRecord(options, file, [])).value, raw);
    }
  }
});

test("conditional publication denies absent CAS support and mismatched workspace instead of falling back to append", async () => {
  const catalog = createLocalArtifactCatalogPersistenceAdapter({ rootDirectory });
  const bindings = createLocalArtifactStorageBindingAdapter({ rootDirectory });
  assert.equal((await catalog.createArtifactCatalogRecordIfAbsent({ record }, context)).ok, false);
  assert.equal((await bindings.createArtifactStorageBindingIfAbsent({ binding }, context)).ok, false);
  const documents = createInMemoryStructuredDocumentStore();
  assert.equal((await createLocalArtifactCatalogPersistenceAdapter({ rootDirectory, documents }).createArtifactCatalogRecordIfAbsent({ record }, { workspaceId: createWorkspaceId("workspace.other") })).ok, false);
  assert.equal((await createLocalArtifactStorageBindingAdapter({ rootDirectory, documents }).createArtifactStorageBindingIfAbsent({ binding }, { workspaceId: createWorkspaceId("workspace.other") })).ok, false);
});

test("conditional create pins its organization before awaiting and duplicate conflicts do not change revision", async () => {
  for (const family of ["catalog", "binding"]) {
    const root = createInMemoryStructuredDocumentStore();
    const original = createOrganizationId("organization.original"), other = createOrganizationId("organization.other");
    let current = original;
    const switching = { ...root, get organizationId() { return current; }, forOrganization: root.forOrganization.bind(root) };
    const options = { rootDirectory, documents: switching };
    const create = () => family === "catalog" ? createLocalArtifactCatalogPersistenceAdapter(options).createArtifactCatalogRecordIfAbsent({ record }, { ...context, organizationId: original }) : createLocalArtifactStorageBindingAdapter(options).createArtifactStorageBindingIfAbsent({ binding }, { ...context, organizationId: original });
    const pending = create(); current = other;
    assert.ok((await pending).ok);
    const file = `.catalog/${family === "catalog" ? "artifact-catalog" : "artifact-storage-bindings"}.ndjson`;
    const pinned = { rootDirectory, documents: root.forOrganization(original) };
    const before = await readDocumentRecord(pinned, file, []);
    assert.equal(before.value.length, 1);
    assert.deepEqual((await readDocumentRecord({ rootDirectory, documents: root.forOrganization(other) }, file, [])).value, []);
    current = original; assert.equal((await create()).ok, false);
    assert.deepEqual(await readDocumentRecord(pinned, file, []), before);
    current = other; assert.equal((await create()).ok, false);
  }
});
