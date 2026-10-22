import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { createSqliteStructuredDocumentStore, migrateLocalSqliteDatabase } from "../../sqlite/sqlite-database";
import { createInMemoryStructuredDocumentStore } from "../../shared";
import { createStructuredImageResourceIdentityAdapter } from "../createStructuredImageResourceIdentityAdapter";

const workspace = "workspace-a" as never;
const kind = "image";
const raw = "private/source/identifier.png";
const key = createHash("sha256").update(JSON.stringify([workspace, kind, raw])).digest("hex");
function setup() {
  const root = createInMemoryStructuredDocumentStore();
  const store = root.forOrganization("organization-a" as never);
  return { root, store, adapter: createStructuredImageResourceIdentityAdapter(store) };
}

describe("structured private image identities", () => {
  it("publishes consistently under concurrent production SQLite calls without opening nested transactions", async () => {
    const database = new DatabaseSync(":memory:");
    try {
      migrateLocalSqliteDatabase(database);
      const store = createSqliteStructuredDocumentStore(database).forOrganization("organization-a" as never);
      const ids = await Promise.all(Array.from({ length: 20 }, () => createStructuredImageResourceIdentityAdapter(store).getOrCreateIdentity(workspace, kind, raw)));
      assert.equal(new Set(ids).size, 1);
      const mappings = await Promise.all(ids.map((id) => createStructuredImageResourceIdentityAdapter(store).resolveIdentity(workspace, id)));
      assert.ok(mappings.every((mapping) => mapping?.sourceId === raw));
    } finally { database.close(); }
  });
  it("persists random public aliases across adapter reconstruction with exact bounded lookups", async () => {
    const { store, adapter } = setup();
    store.listDocuments = async () => { throw new Error("Unexpected collection traversal."); };
    const id = await adapter.getOrCreateIdentity(workspace, kind, raw);
    assert.match(id, /^image-resource\.v1\.[a-f0-9-]{36}$/);
    assert.equal(id.includes(raw), false);
    assert.equal(id.includes(key), false);
    const next = createStructuredImageResourceIdentityAdapter(store);
    assert.equal(await next.getOrCreateIdentity(workspace, kind, raw), id);
    assert.deepEqual(await next.resolveIdentity(workspace, id), { workspaceId: workspace, kind, sourceId: raw, publicId: id });
    const other = await next.getOrCreateIdentity(workspace, kind, `${raw}other`);
    assert.notEqual(other, id);
  });

  it("isolates identical sources by organization, workspace and source kind", async () => {
    const { root, adapter } = setup();
    const a = await adapter.getOrCreateIdentity(workspace, kind, raw);
    const b = await adapter.getOrCreateIdentity("workspace-b" as never, kind, raw);
    const c = await adapter.getOrCreateIdentity(workspace, "generated-output", raw);
    const otherOwner = createStructuredImageResourceIdentityAdapter(root.forOrganization("organization-b" as never));
    const d = await otherOwner.getOrCreateIdentity(workspace, kind, raw);
    assert.equal(new Set([a, b, c, d]).size, 4);
    assert.equal(await otherOwner.resolveIdentity(workspace, a), undefined);
    assert.equal(await adapter.resolveIdentity("workspace-b" as never, a), undefined);
    await assert.rejects(createStructuredImageResourceIdentityAdapter(root).getOrCreateIdentity(workspace, kind, raw), { message: "Private image resource identity is unavailable." });
  });

  it("serializes concurrent creation to one stable paired identity", async () => {
    const { store, adapter } = setup();
    const ids = await Promise.all(Array.from({ length: 20 }, () => createStructuredImageResourceIdentityAdapter(store).getOrCreateIdentity(workspace, kind, raw)));
    assert.equal(new Set(ids).size, 1);
    assert.equal((await adapter.resolveIdentity(workspace, ids[0]!))?.sourceId, raw);
  });

  it("denies partial or substituted pairs rather than rewriting them", async () => {
    const { store, adapter } = setup();
    const id = await adapter.getOrCreateIdentity(workspace, kind, raw);
    const original = await store.readDocument("private-image-identities-v1-source", key);
    assert.ok(original);
    await store.deleteDocument("private-image-identities-v1-public", `${workspace}:${id}`);
    await assert.rejects(adapter.resolveIdentity(workspace, id).then(async (value) => {
      // Missing public lookup is an unknown ID; source reuse must still deny the broken pair.
      assert.equal(value, undefined);
      await adapter.getOrCreateIdentity(workspace, kind, raw);
    }));
    assert.deepEqual((await store.readDocument("private-image-identities-v1-source", key))?.value, original.value);
    const { publication: _publication, ...identity } = original.value as Record<string, unknown>;
    await store.writeDocument("private-image-identities-v1-public", `${workspace}:${id}`, { ...identity, workspaceId: "workspace-b" });
    await assert.rejects(adapter.resolveIdentity(workspace, id), { message: "Private image resource identity is unavailable." });
  });

  it("keeps interrupted publication private and recovers the same reserved ID on healthy authorized retry", async () => {
    const { store, adapter } = setup();
    const failingStore: typeof store = { ...store,
      forOrganization: () => failingStore,
      writeDocument: async (namespace, key, value, options) => {
        if (namespace === "private-image-identities-v1-public") throw new Error("Synthetic private failure.");
        return store.writeDocument(namespace, key, value, options);
      },
      runInTransaction: async () => { throw new Error("Unexpected connection transaction."); },
    };
    await assert.rejects(createStructuredImageResourceIdentityAdapter(failingStore).getOrCreateIdentity(workspace, kind, raw), { message: "Private image resource identity is unavailable." });
    const reservation = await store.readDocument<{ publicId: string; publication: string }>("private-image-identities-v1-source", key);
    assert.equal(reservation?.value.publication, "reserved");
    assert.equal(await adapter.resolveIdentity(workspace, reservation!.value.publicId), undefined);
    const id = await adapter.getOrCreateIdentity(workspace, kind, raw);
    assert.equal(id, reservation!.value.publicId);
    assert.equal((await adapter.resolveIdentity(workspace, id))?.sourceId, raw);
  });

  it("rejects malformed inputs and legacy IDs without collection scans", async () => {
    const { adapter } = setup();
    for (const bad of ["", "x".repeat(8193), "😀".repeat(3000)]) await assert.rejects(adapter.getOrCreateIdentity(workspace, kind, bad));
    await assert.rejects(adapter.getOrCreateIdentity("../other" as never, kind, raw));
    await assert.rejects(adapter.getOrCreateIdentity(workspace, "unknown" as never, raw));
    assert.equal(await adapter.resolveIdentity(workspace, "asset-view.image.internal.source"), undefined);
    assert.equal(await adapter.resolveIdentity(workspace, "image-resource.v1.not-a-uuid"), undefined);
  });
});
