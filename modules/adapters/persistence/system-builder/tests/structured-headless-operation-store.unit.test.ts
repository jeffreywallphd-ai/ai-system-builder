import assert from "node:assert/strict";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { HeadlessOperationStorePort, SystemBuilderRepositoryPort } from "../../../../application/ports/system-builder";
import { createOrganizationId } from "../../../../contracts/organization";
import {
  normalizeSystemBuilderRevisionId, normalizeSystemBuilderSystemId, systemBuilderFailure, systemBuilderSuccess,
  type SystemBuilderRecord, type SystemBuilderRevision,
} from "../../../../contracts/system-builder";
import { normalizeAssetId } from "../../../../contracts/asset";
import { createWorkspaceId } from "../../../../contracts/workspace";
import { createInMemoryStructuredDocumentStore, type StructuredDocumentStore } from "../../shared";
import { openLocalSqliteDatabase, resolveLocalSqliteDatabasePolicy } from "../../sqlite";
import { createStructuredSystemBuilderRepository } from "../createStructuredSystemBuilderRepository";
import {
  createStructuredHeadlessOperationStore, HEADLESS_RECEIPT_TTL_MS, HEADLESS_RETAINED_SYSTEM_CHANGES, HEADLESS_SYSTEM_CHANGE_PAGE_SIZE,
} from "../createStructuredHeadlessOperationStore";

const scope = {
  organizationId: createOrganizationId("fixture-org"),
  workspaceId: createWorkspaceId("fixture-workspace"),
  principalId: "fixture-principal",
  registeredClientId: "41a96fc3-d2b8-4414-bd29-00059badc72d",
};
const timestamp = "2026-11-13T12:00:00.000Z";
const digest = "a".repeat(64);
const key = (index: number) => `a6f56324-2051-462c-b45b-${index.toString(16).padStart(12, "0")}`;
const system = (index: number, workspaceId = scope.workspaceId) => {
  const systemId = normalizeSystemBuilderSystemId(`fixture-system-${index}`);
  const revisionId = normalizeSystemBuilderRevisionId(`${systemId}.r1`);
  const composition = {
    compositionId: normalizeAssetId(`${systemId}.composition`),
    compositionType: "system", displayName: "Fixture", version: "0.1.0", lifecycleStatus: "draft",
    rootInstanceRefs: [], instanceRefs: [], bindingRefs: [], provenance: { sourceKind: "human-authored" },
  } as const;
  const record: SystemBuilderRecord = {
    systemId, targetWorkspaceId: workspaceId, name: "Fixture", status: "draft", revision: 1, currentRevisionId: revisionId,
    composition, createdAt: timestamp, updatedAt: timestamp, createdBy: "fixture-actor", updatedBy: "fixture-actor",
  };
  const revision: SystemBuilderRevision = {
    systemId, targetWorkspaceId: workspaceId, revisionId, revisionNumber: 1, composition, instances: [], bindings: [],
    validationIssues: [], createdAt: timestamp, createdBy: "fixture-actor",
  };
  return { record, revision, reference: { systemId, revisionId, recordRevision: 1 } };
};
const writeSystem = async (repository: SystemBuilderRepositoryPort, index: number, workspaceId = scope.workspaceId) => {
  const { record, revision, reference } = system(index, workspaceId);
  await repository.createRecordAndRevision(record, revision);
  return systemBuilderSuccess(reference);
};
const request = (index: number, changes: Partial<Parameters<HeadlessOperationStorePort["run"]>[0]> = {}) => ({
  scope, key: key(index), fingerprint: digest, operation: "systems.create" as const,
  isCurrent: () => true, mutate: (repository: SystemBuilderRepositoryPort) => writeSystem(repository, index), ...changes,
});

test("replays the same lost response after reopen without repeating the write or event", async () => {
  const documents = createInMemoryStructuredDocumentStore();
  const store = createStructuredHeadlessOperationStore(documents, () => 1);
  const committed = await store.run(request(1));
  assert.deepEqual(committed, { kind: "committed", reference: system(1).reference });
  let attempts = 0;
  const reopened = createStructuredHeadlessOperationStore(documents, () => 2);
  const replayed = await reopened.run(request(1, { mutate: (repository) => { attempts++; return writeSystem(repository, 2); } }));
  assert.deepEqual(replayed, { kind: "replayed", reference: system(1).reference });
  assert.deepEqual(await reopened.run(request(1, { fingerprint: "b".repeat(64) })), { kind: "key-conflict" });
  assert.deepEqual(await reopened.run(request(1, { isCurrent: () => false })), { kind: "denied" });
  assert.equal(attempts, 0);
  assert.deepEqual(await reopened.readChanges(scope, 0), {
    kind: "changes", events: [{ ...system(1).reference, sequence: 1 }], watermark: 1,
  });
  const otherOrg = { ...scope, organizationId: createOrganizationId("fixture-other-org") };
  assert.equal(await reopened.watermark(otherOrg), 0);
  assert.equal((await reopened.run(request(1, { scope: otherOrg }))).kind, "committed");
  assert.equal(await reopened.watermark(scope), 1);
  const otherWorkspace = { ...scope, workspaceId: createWorkspaceId("fixture-other-workspace") };
  assert.deepEqual(await reopened.readChanges(otherWorkspace, 1), { kind: "resync" });
});

test("ordinary and delegated saves share one ordered journal and a stale save adds no event", async () => {
  const documents = createInMemoryStructuredDocumentStore();
  const scoped = documents.forOrganization(scope.organizationId);
  const repository = createStructuredSystemBuilderRepository(scoped, { journalChanges: true });
  const store = createStructuredHeadlessOperationStore(documents);
  const first = system(1);
  await repository.createRecordAndRevision(first.record, first.revision);
  await repository.updateRecord({ ...first.record, name: "Updated", revision: 2 }, 1);
  await assert.rejects(repository.updateRecord({ ...first.record, name: "Stale", revision: 2 }, 1), /conflict/i);
  assert.equal((await store.run(request(2))).kind, "committed");
  assert.equal((await store.run(request(2))).kind, "replayed");
  const changes = await store.readChanges(scope, 0);
  assert.deepEqual(changes, {
    kind: "changes", watermark: 3, events: [
      { ...first.reference, sequence: 1 },
      { ...first.reference, recordRevision: 2, sequence: 2 },
      { ...system(2).reference, sequence: 3 },
    ],
  });
  assert.equal((await scoped.listDocuments("headless/system-builder/receipts")).length, 1);
});

test("the ordinary journal uses the saved record even when its caller changes scope during persistence", async () => {
  const documents = createInMemoryStructuredDocumentStore();
  const scoped = documents.forOrganization(scope.organizationId);
  const { record, revision, reference } = system(1);
  const updated = { ...record, revision: 2 };
  const otherWorkspace = createWorkspaceId("fixture-other-workspace");
  let changedAfterSave = false;
  const wrapped: StructuredDocumentStore = {
    ...scoped,
    runInTransaction: (work) => scoped.runInTransaction((transaction) => work({
      ...transaction,
      async writeDocument(namespace, documentKey, value, options) {
        const saved = await transaction.writeDocument(namespace, documentKey, value, options);
        if (namespace === "system-builder/records" && options?.expectedRevision === 1) {
          changedAfterSave = true;
          updated.targetWorkspaceId = otherWorkspace;
          updated.revision = 99;
        }
        return saved;
      },
    })),
  };
  const repository = createStructuredSystemBuilderRepository(wrapped, { journalChanges: true });
  await repository.createRecordAndRevision(record, revision);
  const saved = await repository.updateRecord(updated, 1);
  assert.equal(changedAfterSave, true);
  assert.equal(saved.targetWorkspaceId, scope.workspaceId);
  assert.equal(saved.revision, 2);
  assert.deepEqual(await repository.readRecord(scope.workspaceId, record.systemId), saved);
  const store = createStructuredHeadlessOperationStore(documents);
  assert.deepEqual(await store.readChanges(scope, 0), {
    kind: "changes", watermark: 2, events: [
      { ...reference, sequence: 1 }, { ...reference, recordRevision: 2, sequence: 2 },
    ],
  });
  assert.deepEqual(await store.readChanges({ ...scope, workspaceId: otherWorkspace }, 0), {
    kind: "changes", watermark: 0, events: [],
  });
});

test("ordinary changes include revisionless saved records and ignore unselected historical revisions", async () => {
  const documents = createInMemoryStructuredDocumentStore();
  const scoped = documents.forOrganization(scope.organizationId);
  const repository = createStructuredSystemBuilderRepository(scoped, { journalChanges: true });
  const { record, revision } = system(1);
  const legacy = { ...record, currentRevisionId: undefined };
  await repository.createRecord(legacy);
  await repository.saveRevision(revision);
  await repository.updateRecord({ ...legacy, revision: 2, status: "archived" }, 1);
  const store = createStructuredHeadlessOperationStore(documents);
  assert.deepEqual(await store.readChanges(scope, 0), {
    kind: "changes", watermark: 2, events: [
      { systemId: record.systemId, recordRevision: 1, revisionId: null, sequence: 1 },
      { systemId: record.systemId, recordRevision: 2, revisionId: null, sequence: 2 },
    ],
  });
});

test("persists the same receipt and committed event across an actual local SQLite reopen", async () => {
  const directory = await realpath(await mkdtemp(path.join(await realpath(tmpdir()), "headless-operation-")));
  const policy = resolveLocalSqliteDatabasePolicy({ dataRootDirectory: directory });
  let db: Awaited<ReturnType<typeof openLocalSqliteDatabase>> | undefined;
  try {
    db = await openLocalSqliteDatabase({ policy });
    let store = createStructuredHeadlessOperationStore(db.documents);
    assert.equal((await store.run(request(1))).kind, "committed");
    await db.close();
    db = undefined;
    db = await openLocalSqliteDatabase({ policy });
    store = createStructuredHeadlessOperationStore(db.documents);
    assert.deepEqual(await store.run(request(1, { mutate: async () => assert.fail("Replayed mutation ran twice") })), {
      kind: "replayed", reference: system(1).reference,
    });
    assert.deepEqual(await store.readChanges(scope, 0), {
      kind: "changes", events: [{ ...system(1).reference, sequence: 1 }], watermark: 1,
    });
    const repository = createStructuredSystemBuilderRepository(db.documents.forOrganization(scope.organizationId));
    assert.equal((await repository.listRecords(scope.workspaceId)).length, 1);
    await db.documents.runInTransaction(async (transaction) => {
      const nested = createStructuredHeadlessOperationStore(transaction);
      await assert.rejects(nested.run(request(2)), /saved operation could not be confirmed/i);
    });
    assert.equal(await store.watermark(scope), 1);
    assert.equal(await repository.readRecord(scope.workspaceId, system(2).reference.systemId), undefined);
  } finally {
    await db?.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("rolls back the saved record, revision, and metadata after failure or a closing grant fence", async () => {
  const documents = createInMemoryStructuredDocumentStore();
  const store = createStructuredHeadlessOperationStore(documents);
  let current = true;
  const repository = createStructuredSystemBuilderRepository(documents.forOrganization(scope.organizationId));
  const denied = await store.run(request(1, {
    isCurrent: () => current,
    async mutate(tx) { const result = await writeSystem(tx, 1); current = false; return result; },
  }));
  assert.deepEqual(denied, { kind: "denied" });
  const rejected = await store.run(request(1, {
    async mutate(tx) { await writeSystem(tx, 1); return systemBuilderFailure("fixture.rejected", "Fixture write rejected."); },
  }));
  assert.equal(rejected.kind, "mutation-failed");
  const { systemId, revisionId } = system(1).reference;
  assert.equal(await repository.readRecord(scope.workspaceId, systemId), undefined);
  assert.equal(await repository.readRevision(scope.workspaceId, systemId, revisionId), undefined);
  assert.equal(await store.watermark(scope), 0);
  assert.equal((await store.run(request(1))).kind, "committed");
});

test("rolls back the saved revision and event when the delegated receipt write fails", async () => {
  const documents = createInMemoryStructuredDocumentStore();
  let fault = true;
  function wrap(store: StructuredDocumentStore): StructuredDocumentStore {
    return {
      ...store,
      forOrganization: (id) => wrap(store.forOrganization(id)),
      runInTransaction: (work) => store.runInTransaction((tx) => work(wrap(tx))),
      ...(store.runInOwnedTransaction ? {
        runInOwnedTransaction: (work, beforeCommit) => store.runInOwnedTransaction!((tx) => work(wrap(tx)), beforeCommit),
      } : {}),
      async writeDocument(namespace, identity, value, options) {
        if (fault && namespace === "headless/system-builder/receipts") throw new Error("Fixture receipt failure");
        return store.writeDocument(namespace, identity, value, options);
      },
    };
  }
  const store = createStructuredHeadlessOperationStore(wrap(documents));
  await assert.rejects(store.run(request(1)), /saved operation could not be confirmed/i);
  const repository = createStructuredSystemBuilderRepository(documents.forOrganization(scope.organizationId));
  const { systemId, revisionId } = system(1).reference;
  assert.equal(await repository.readRecord(scope.workspaceId, systemId), undefined);
  assert.equal(await repository.readRevision(scope.workspaceId, systemId, revisionId), undefined);
  assert.equal(await store.watermark(scope), 0);
  fault = false;
  assert.deepEqual(await store.run(request(1)), { kind: "committed", reference: system(1).reference });
});

test("rolls back an ordinary saved record and revision when its journal write fails", async () => {
  const documents = createInMemoryStructuredDocumentStore();
  const scoped = documents.forOrganization(scope.organizationId);
  const wrapped: StructuredDocumentStore = {
    ...scoped,
    runInTransaction: (work) => scoped.runInTransaction((transaction) => work({
      ...transaction,
      async writeDocument(namespace, documentKey, value, options) {
        if (namespace === "headless/system-builder/changes") throw new Error("Fixture journal failure");
        return transaction.writeDocument(namespace, documentKey, value, options);
      },
    })),
  };
  const repository = createStructuredSystemBuilderRepository(wrapped, { journalChanges: true });
  const { record, revision, reference } = system(1);
  await assert.rejects(repository.createRecordAndRevision(record, revision), /fixture journal failure/i);
  assert.equal(await repository.readRecord(scope.workspaceId, reference.systemId), undefined);
  assert.equal(await repository.readRevision(scope.workspaceId, reference.systemId, reference.revisionId), undefined);
  assert.equal(await createStructuredHeadlessOperationStore(documents).watermark(scope), 0);
});

test("the owning transaction rejects revocation at its commit fence", async () => {
  const documents = createInMemoryStructuredDocumentStore();
  let current = true;
  const base = documents.forOrganization(scope.organizationId);
  const wrapped: StructuredDocumentStore = {
    ...base, runInOwnedTransaction(work, beforeCommit) {
      return base.runInOwnedTransaction!(work, () => { current = false; beforeCommit(); });
    },
  };
  const store = createStructuredHeadlessOperationStore({ ...documents, forOrganization: () => wrapped });
  assert.deepEqual(await store.run(request(1, { isCurrent: () => current })), { kind: "denied" });
  assert.equal(await store.watermark(scope), 0);
  assert.equal(await createStructuredSystemBuilderRepository(base).readRecord(scope.workspaceId, system(1).reference.systemId), undefined);
});

test("stores the validated revision snapshot even if the callback's original object changes while saving", async () => {
  const documents = createInMemoryStructuredDocumentStore();
  const store = createStructuredHeadlessOperationStore(documents);
  const fixture = system(1);
  const candidate = { ...fixture.revision };
  const result = await store.run(request(1, { async mutate(tx) {
    const saving = tx.createRecordAndRevision(fixture.record, candidate);
    candidate.targetWorkspaceId = createWorkspaceId("fixture-other-workspace");
    candidate.revisionId = normalizeSystemBuilderRevisionId("unrelated.r1");
    await saving;
    return systemBuilderSuccess(fixture.reference);
  } }));
  assert.equal(result.kind, "committed");
  const repository = createStructuredSystemBuilderRepository(documents.forOrganization(scope.organizationId));
  assert.deepEqual(await repository.readRevision(scope.workspaceId, fixture.reference.systemId, fixture.reference.revisionId), fixture.revision);
});

test("captures workspace scope before awaiting and reevaluates receipt expiry at readback", async () => {
  const documents = createInMemoryStructuredDocumentStore();
  const base = documents.forOrganization(scope.organizationId);
  const other = createWorkspaceId("fixture-other-workspace");
  const mutable = { ...scope };
  let clock = 1;
  let beforeReceipt: () => void = () => {};
  const wrapped: StructuredDocumentStore = {
    ...base, runInOwnedTransaction(work, beforeCommit) {
      function intercept(tx: StructuredDocumentStore): StructuredDocumentStore {
        return {
          ...tx,
          runInTransaction: (nested) => tx.runInTransaction((inner) => nested(intercept(inner))),
          async readDocument<T>(namespace: string, documentKey: string) {
            if (namespace === "headless/system-builder/receipts") beforeReceipt();
            return tx.readDocument<T>(namespace, documentKey);
          },
        };
      }
      return base.runInOwnedTransaction!((tx) => work(intercept(tx)), beforeCommit);
    },
  };
  const store = createStructuredHeadlessOperationStore({ ...documents, forOrganization: () => wrapped }, () => clock);
  assert.equal((await store.run(request(2, { scope: { ...scope, workspaceId: other },
    mutate: (tx) => writeSystem(tx, 2, other) }))).kind, "committed");
  beforeReceipt = () => { mutable.workspaceId = other; };
  assert.equal((await store.run(request(1, { scope: mutable }))).kind, "committed");
  assert.equal(await store.watermark(scope), 1);
  assert.equal(await store.watermark({ ...scope, workspaceId: other }), 1);
  assert.deepEqual(await store.readChanges(scope, 0), {
    kind: "changes", watermark: 1, events: [{ ...system(1).reference, sequence: 1 }],
  });
  clock = HEADLESS_RECEIPT_TTL_MS;
  beforeReceipt = () => { clock++; };
  assert.deepEqual(await store.run(request(1)), { kind: "key-expired" });
});

test("fails closed on extra persisted data or invalid change continuity", async () => {
  const documents = createInMemoryStructuredDocumentStore();
  const base = documents.forOrganization(scope.organizationId);
  const store = createStructuredHeadlessOperationStore(documents);
  assert.equal((await store.run(request(1))).kind, "committed");
  const [receipt] = await base.listDocuments<Record<string, unknown>>("headless/system-builder/receipts");
  await base.writeDocument(receipt.namespace, receipt.key, {
    ...receipt.value, reference: { ...system(1).reference, fixtureUnwantedData: "Fixture" },
  }, { expectedRevision: receipt.revision });
  await assert.rejects(store.run(request(1)), /saved operation could not be confirmed/i);
  const [changes] = await base.listDocuments("headless/system-builder/changes");
  await base.writeDocument(changes.namespace, changes.key, {
    watermark: 2, events: [{ ...system(1).reference, sequence: 2 }],
  }, { expectedRevision: changes.revision });
  await assert.rejects(store.readChanges(scope, 0), /stored change log is invalid/i);
  await assert.rejects(store.run(request(2)), /saved operation could not be confirmed/i);
});

test("refuses writes outside the verified scope or wrong operation, even if a callback catches the denial", async () => {
  const documents = createInMemoryStructuredDocumentStore();
  const store = createStructuredHeadlessOperationStore(documents);
  const otherWorkspace = createWorkspaceId("fixture-other-workspace");
  await assert.rejects(store.run(request(1, { async mutate(tx) {
    const result = await writeSystem(tx, 1);
    await assert.rejects(writeSystem(tx, 2, otherWorkspace));
    return result;
  } })), /saved operation could not be confirmed/i);
  await assert.rejects(store.run(request(1, { operation: "systems.rename" })), /saved operation could not be confirmed/i);
  assert.equal(await store.watermark(scope), 0);
  assert.equal((await store.run(request(1))).kind, "committed");
});

test("never repeats an expired key and requires resync when a retained change cursor is too old", async () => {
  const documents = createInMemoryStructuredDocumentStore();
  let now = 1;
  const store = createStructuredHeadlessOperationStore(documents, () => now);
  const [first, duplicate] = await Promise.all([store.run(request(1)), store.run(request(1))]);
  assert.equal(first.kind, "committed");
  assert.equal(duplicate.kind, "replayed");
  now += HEADLESS_RECEIPT_TTL_MS;
  assert.deepEqual(await store.run(request(1)), { kind: "key-expired" });
  for (let index = 2; index <= HEADLESS_RETAINED_SYSTEM_CHANGES + 1; index++) {
    assert.equal((await store.run(request(index))).kind, "committed");
  }
  assert.deepEqual(await store.readChanges(scope, 0), { kind: "resync" });
  const page = await store.readChanges(scope, 1);
  assert.equal(page.kind, "changes");
  assert.equal(page.events.length, HEADLESS_SYSTEM_CHANGE_PAGE_SIZE);
  assert.equal(page.events[0]?.sequence, 2);
  assert.equal(page.watermark, HEADLESS_RETAINED_SYSTEM_CHANGES + 1);
});
