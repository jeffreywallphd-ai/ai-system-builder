import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { HeadlessOperationStorePort, SystemBuilderRepositoryPort } from "../../../../application/ports/system-builder";
import type { HeadlessPlanReviewListTarget, HeadlessPlanReviewTarget } from "../../../../application/ports/system-builder/headless-build-plan-review.port";
import { HeadlessBuildPlanReviewUseCase } from "../../../../application/use-cases/system-builder/headless-build-plan-review.use-case";
import { isHeadlessHostIncarnationId, parseHeadlessBuildPlanProposal, serializeHeadlessMutationInput } from "../../../../contracts/headless";
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
import { createStructuredHeadlessPlanReviewRepository, listStructuredHeadlessPlanReviews } from "../createStructuredHeadlessPlanReviewRepository";
import { prepareStructuredHeadlessPlanStep } from "../createStructuredHeadlessPlanStepOperationStore";
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

const reviewHost = "41a96fc3-d2b8-4414-bd29-00059badc72d";
if (!isHeadlessHostIncarnationId(reviewHost)) throw new Error("Invalid fixture plan host.");
const reviewProposal = {
  hostIncarnationId: reviewHost, workspaceId: scope.workspaceId,
  steps: [
    { operation: "systems.create", name: "First fixture proposal", idempotencyKey: key(21), templateId: "reference.secured-data-review@1.0.0" },
    { operation: "systems.create", name: "Second fixture proposal", idempotencyKey: key(22), templateId: "reference.secured-data-review@1.0.0" },
  ],
};
const reviewPlan = parseHeadlessBuildPlanProposal(reviewProposal, reviewHost);
if (!reviewPlan.ok) throw new Error("Invalid fixture plan.");
const reviewFingerprint = createHash("sha256").update(JSON.stringify(reviewPlan.preview), "utf8").digest("hex");
const reviewTarget = { hostIncarnationId: reviewHost, scope, fingerprint: reviewFingerprint };
const reviewQuery = { target: reviewTarget, isCurrent: () => true };
const approval = (revision: number, step: number) => ({
  fingerprint: reviewFingerprint, expectedRevision: revision,
  decision: { kind: "approve", mode: "each-change", step },
});

test("checks approved plan order in the mutation transaction and reconciles the exact result after SQLite reopen", async () => {
  const directory = await realpath(await mkdtemp(path.join(await realpath(tmpdir()), "headless-approved-step-")));
  const policy = resolveLocalSqliteDatabasePolicy({ dataRootDirectory: directory });
  let db: Awaited<ReturnType<typeof openLocalSqliteDatabase>> | undefined;
  let now = 1_000;
  let current = true;
  const clock = () => now;
  const isCurrent = () => current;
  const authorized = async (_owner: StructuredDocumentStore, actor: typeof scope) =>
    current && actor.organizationId === scope.organizationId && actor.workspaceId === scope.workspaceId &&
    actor.principalId === scope.principalId && actor.registeredClientId === scope.registeredClientId;
  const effectDigest = (request: Parameters<typeof serializeHeadlessMutationInput>[0]) =>
    createHash("sha256").update(serializeHeadlessMutationInput(request), "utf8").digest("hex");
  const stepRequest = (step: number, record: number) => {
    const approved = reviewPlan.requests[step - 1];
    assert.ok(approved?.operation === "systems.create");
    return request(record, { key: approved.input.idempotencyKey, fingerprint: effectDigest(approved) });
  };
  const prepare = (step: number, approvalRevision: number) =>
    prepareStructuredHeadlessPlanStep(db!.documents, { ...reviewQuery, isCurrent, approvalRevision, step }, authorized, clock);
  try {
    db = await openLocalSqliteDatabase({ policy });
    const root = db.documents;
    const reviews = createStructuredHeadlessPlanReviewRepository(root,
      (owner, target) => authorized(owner, target.scope), clock);
    const app = new HeadlessBuildPlanReviewUseCase(reviews, clock);
    const actor = { organizationId: scope.organizationId, principalId: scope.principalId,
      channel: "app-popup" as const, isCurrent, canDecide: async () => current };
    const staged = await reviews.propose({ ...reviewQuery, proposal: reviewProposal });
    assert.ok(staged.ok);
    assert.equal(await prepare(1, 1), undefined);
    assert.ok((await app.decide(approval(1, 1), reviewHost, scope, actor)).ok);
    const firstOnly = await prepare(1, 2);
    assert.ok(firstOnly);
    assert.equal(await prepare(2, 2), undefined);
    assert.ok((await app.decide(approval(2, 2), reviewHost, scope, actor)).ok);
    assert.deepEqual(await firstOnly.operations.run(stepRequest(1, 101)), { kind: "denied" });

    // A preexisting matching operation outside the approved plan must never
    // unlock the next step or satisfy exact replay for this plan.
    const baseline = createStructuredHeadlessOperationStore(root, clock);
    assert.equal((await baseline.run(stepRequest(1, 100))).kind, "committed");
    assert.equal(await prepare(2, 3), undefined);
    const first = await prepare(1, 3);
    assert.ok(first);
    assert.deepEqual(first.request, reviewPlan.requests[0]);
    const changed = stepRequest(1, 101);
    assert.deepEqual(await first.operations.run({ ...changed, fingerprint: "fe".repeat(32) }), { kind: "denied" });
    assert.deepEqual(await first.operations.run({ ...changed, scope: { ...scope, principalId: "other-fixture" } }), { kind: "denied" });
    assert.deepEqual(await first.operations.run(changed), { kind: "committed", reference: system(101).reference });
    await db.close();
    db = await openLocalSqliteDatabase({ policy });
    const reopenedFirst = await prepare(1, 3);
    assert.ok(reopenedFirst);
    assert.deepEqual(await reopenedFirst.operations.run(stepRequest(1, 102)), {
      kind: "replayed", reference: system(101).reference,
    });
    const second = await prepare(2, 3);
    assert.ok(second);
    assert.deepEqual(second.request, reviewPlan.requests[1]);
    current = false;
    assert.deepEqual(await second.operations.run(stepRequest(2, 103)), { kind: "denied" });
    current = true;
    assert.deepEqual(await second.operations.run(stepRequest(2, 103)), {
      kind: "committed", reference: system(103).reference,
    });

    const liveReviews = createStructuredHeadlessPlanReviewRepository(db.documents,
      (owner, target) => authorized(owner, target.scope), clock);
    const liveApp = new HeadlessBuildPlanReviewUseCase(liveReviews, clock);
    assert.ok((await liveApp.decide({ fingerprint: reviewFingerprint, expectedRevision: 3, decision: { kind: "revoke" }},
      reviewHost, scope, actor)).ok);
    assert.deepEqual(await second.operations.run(stepRequest(2, 103)), { kind: "denied" });
    assert.equal(await prepare(2, 4), undefined);
    const final = createStructuredHeadlessOperationStore(db.documents, clock);
    assert.deepEqual(await final.readChanges(scope, 0), {
      kind: "changes", events: [
        { ...system(100).reference, sequence: 1 }, { ...system(101).reference, sequence: 2 },
        { ...system(103).reference, sequence: 3 },
      ], watermark: 3,
    });
  } finally {
    await db?.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("rolls back an approved plan step when its deadline passes before commit", async () => {
  const documents = createInMemoryStructuredDocumentStore();
  let now = 1_000;
  const clock = () => now;
  const reviews = createStructuredHeadlessPlanReviewRepository(documents, async () => true, clock);
  const staged = await reviews.propose({ ...reviewQuery, proposal: reviewProposal });
  assert.ok(staged.ok);
  const app = new HeadlessBuildPlanReviewUseCase(reviews, clock);
  const actor = { organizationId: scope.organizationId, principalId: scope.principalId,
    channel: "authenticated-chat" as const, isCurrent: () => true, canDecide: async () => true };
  assert.ok((await app.decide(approval(1, 1), reviewHost, scope, actor)).ok);
  const prepared = await prepareStructuredHeadlessPlanStep(documents, {
    ...reviewQuery, step: 1, approvalRevision: 2,
  }, async () => true, clock);
  assert.ok(prepared);
  const fingerprint = createHash("sha256").update(serializeHeadlessMutationInput(prepared.request), "utf8").digest("hex");
  const response = await prepared.operations.run(request(104, {
    key: prepared.request.input.idempotencyKey, fingerprint, async mutate(repository) {
      const result = await writeSystem(repository, 104);
      now = staged.snapshot.state.expiresAt;
      return result;
    },
  }));
  assert.deepEqual(response, { kind: "denied" });
  assert.equal(await createStructuredHeadlessOperationStore(documents, clock).watermark(scope), 0);
  const systems = createStructuredSystemBuilderRepository(documents.forOrganization(scope.organizationId));
  assert.equal(await systems.readRecord(scope.workspaceId, system(104).record.systemId), undefined);
});

test("persists exact plan approval and responds to competing verified decisions with one commit", async () => {
  const directory = await realpath(await mkdtemp(path.join(await realpath(tmpdir()), "headless-plan-review-")));
  const policy = resolveLocalSqliteDatabasePolicy({ dataRootDirectory: directory });
  let db: Awaited<ReturnType<typeof openLocalSqliteDatabase>> | undefined;
  try {
    db = await openLocalSqliteDatabase({ policy });
    let now = 1_000;
    let permitted = true;
    const authorize = async (_owner: StructuredDocumentStore, target: HeadlessPlanReviewTarget) =>
      permitted && target.hostIncarnationId === reviewHost &&
      target.scope.workspaceId === scope.workspaceId && target.scope.organizationId === scope.organizationId &&
      target.scope.principalId === scope.principalId && target.scope.registeredClientId === scope.registeredClientId;
    let store = createStructuredHeadlessPlanReviewRepository(db.documents, authorize, () => now);
    const fresh = await store.propose({ ...reviewQuery, proposal: reviewProposal });
    assert.ok(fresh.ok);
    assert.equal(fresh.snapshot.state.status, "pending");
    assert.equal(fresh.snapshot.state.expiresAt, now + 15 * 60 * 1_000);
    assert.deepEqual(fresh.snapshot.preview, reviewPlan.preview);
    now += 100;
    assert.deepEqual(await store.propose({ ...reviewQuery, proposal: reviewProposal }), fresh);
    const app = new HeadlessBuildPlanReviewUseCase(store, () => now);
    const actor = ({ organizationId: scope.organizationId, principalId: scope.principalId, channel: "app-popup" as const,
      canDecide: async () => permitted, isCurrent: () => permitted });
    const paired = await Promise.all([
      app.decide(approval(1, 1), reviewHost, scope, actor),
      app.decide(approval(1, 1), reviewHost, scope, { ...actor, channel: "authenticated-chat" }),
    ]);
    assert.equal(paired.filter(item => item.ok).length, 1);
    assert.ok(paired.some(item => !item.ok && item.code === "stale"));
    const afterDecision = await store.read(reviewQuery);
    assert.ok(afterDecision.ok);
    assert.equal(afterDecision.snapshot.state.revision, 2);
    assert.equal(afterDecision.snapshot.state.approvedSteps, 1);
    assert.deepEqual(await store.read({ ...reviewQuery, target: { ...reviewTarget, scope: { ...scope,
      workspaceId: createWorkspaceId("other-fixture-workspace"),
    } } }), { ok: false, code: "forbidden" });
    assert.deepEqual(await store.read({ ...reviewQuery, target: { ...reviewTarget, fingerprint: "ab".repeat(32) } }),
      { ok: false, code: "forbidden" });
    permitted = false;
    assert.deepEqual(await store.read(reviewQuery), { ok: false, code: "forbidden" });
    permitted = true;
    await db.close();
    db = undefined;
    db = await openLocalSqliteDatabase({ policy });
    store = createStructuredHeadlessPlanReviewRepository(db.documents, authorize, () => now);
    assert.deepEqual(await store.read(reviewQuery), afterDecision);
    assert.deepEqual(await store.propose({ ...reviewQuery, proposal: reviewProposal }), afterDecision);
    assert.deepEqual(await listStructuredHeadlessPlanReviews(db.documents, { target: reviewTarget, isCurrent: () => true },
      async (_owner, target) => target.scope.principalId === scope.principalId && target.scope.workspaceId === scope.workspaceId,
      () => now), { ok: true, requests: [{ fingerprint: reviewFingerprint,
        registeredClientId: scope.registeredClientId, expiresAt: fresh.snapshot.state.expiresAt }] });
    const partition = db.documents.forOrganization(scope.organizationId);
    assert.equal((await partition.listDocuments("headless/system-builder/plan-reviews")).length, 1);
    assert.equal((await createStructuredSystemBuilderRepository(partition).listRecords(scope.workspaceId)).length, 0);
    now = fresh.snapshot.state.expiresAt;
    assert.deepEqual(await store.read(reviewQuery), { ok: false, code: "expired" });
    assert.deepEqual(await store.propose({ ...reviewQuery, proposal: reviewProposal }), { ok: false, code: "expired" });
    assert.equal((await partition.listDocuments("headless/system-builder/plan-reviews")).length, 1);
  } finally {
    try { await db?.close(); }
    finally { await rm(directory, { recursive: true, force: true }); }
  }
});

test("rolls back a plan decision at the owned commit fence and refuses a changed stored proposal", async () => {
  const documents = createInMemoryStructuredDocumentStore();
  const partition = documents.forOrganization(scope.organizationId);
  let now = 2_000;
  let atCommit: () => void = () => {};
  const wrapped: StructuredDocumentStore = {
    ...documents, runInOwnedTransaction(work, beforeCommit) {
      return documents.runInOwnedTransaction!(work, () => { atCommit(); beforeCommit(); });
    },
  };
  const store = createStructuredHeadlessPlanReviewRepository(wrapped, async () => true, () => now);
  const fresh = await store.propose({ ...reviewQuery, proposal: reviewProposal });
  assert.ok(fresh.ok);
  assert.deepEqual(await store.propose({ ...reviewQuery, proposal: { ...reviewProposal,
    steps: [{ ...reviewProposal.steps[0], name: "Changed plan" }],
  } }), { ok: false, code: "invalid" });

  const useCase = new HeadlessBuildPlanReviewUseCase(store, () => now);
  const actor = { organizationId: scope.organizationId, principalId: scope.principalId, channel: "app-popup" as const,
    canDecide: async () => true, isCurrent: () => true };
  atCommit = () => { now = fresh.snapshot.state.expiresAt; };
  const refused = await useCase.decide(approval(1, 1), reviewHost, scope, actor);
  assert.deepEqual(refused, { ok: false, code: "expired" });
  now = 2_000;
  let actorCurrent = true;
  atCommit = () => { actorCurrent = false; };
  assert.deepEqual(await useCase.decide(approval(1, 1), reviewHost, scope, {
    ...actor, isCurrent: () => actorCurrent,
  }), { ok: false, code: "forbidden" });
  const [before] = await partition.listDocuments<Record<string, unknown>>("headless/system-builder/plan-reviews");
  assert.equal(before.revision, 1);
  assert.deepEqual(before.value.state, fresh.snapshot.state);

  atCommit = () => {};
  await partition.writeDocument(before.namespace, before.key, { ...before.value,
    proposal: { ...reviewProposal, steps: [{ ...reviewProposal.steps[0], name: "Changed persisted plan" }] },
  }, { expectedRevision: before.revision });
  assert.deepEqual(await store.read(reviewQuery), { ok: false, code: "unconfirmed" });
});

test("lists exact live approvals for the owning scope and rolls back list changes with their review", async () => {
  const documents = createInMemoryStructuredDocumentStore();
  let now = 3_000;
  let actorCurrent = true;
  let atCommit: () => void = () => {};
  const wrapped: StructuredDocumentStore = {
    ...documents, runInOwnedTransaction(work, beforeCommit) {
      return documents.runInOwnedTransaction!(work, () => { atCommit(); beforeCommit(); });
    },
  };
  const store = createStructuredHeadlessPlanReviewRepository(wrapped, async () => true, () => now);
  const isCurrent = () => actorCurrent;
  const listTarget = { hostIncarnationId: reviewHost, scope: {
    organizationId: scope.organizationId, workspaceId: scope.workspaceId, principalId: scope.principalId,
  } };
  const allowedScope = async (_owner: StructuredDocumentStore, actual: HeadlessPlanReviewListTarget) =>
    actual.hostIncarnationId === reviewHost && actual.scope.organizationId === scope.organizationId &&
    actual.scope.principalId === scope.principalId && actual.scope.workspaceId === scope.workspaceId;
  const list = (target: HeadlessPlanReviewListTarget = listTarget) =>
    listStructuredHeadlessPlanReviews(wrapped, { target, isCurrent }, allowedScope, () => now);
  const proposal = { ...reviewQuery, isCurrent, proposal: reviewProposal };
  atCommit = () => { actorCurrent = false; };
  assert.deepEqual(await store.propose(proposal), { ok: false, code: "forbidden" });
  assert.deepEqual(await list(), { ok: false, code: "forbidden" });
  atCommit = () => {};
  actorCurrent = true;
  assert.deepEqual(await list(), { ok: true, requests: [] });
  assert.deepEqual(await store.read(reviewQuery), { ok: false, code: "forbidden" });
  const staged = await store.propose(proposal);
  assert.ok(staged.ok);
  assert.deepEqual(await store.propose(proposal), staged);
  const expected = { ok: true, requests: [{ registeredClientId: scope.registeredClientId, fingerprint: reviewFingerprint,
    expiresAt: staged.snapshot.state.expiresAt }] };
  assert.deepEqual(await list(), expected);
  assert.deepEqual(await list({ ...listTarget, scope: { ...listTarget.scope, principalId: "foreign-fixture-principal" } }),
    { ok: false, code: "forbidden" });
  const useCase = new HeadlessBuildPlanReviewUseCase(store, () => now);
  const actor = { organizationId: scope.organizationId, principalId: scope.principalId, channel: "app-popup" as const,
    canDecide: async () => true, isCurrent };
  const select = (revision: number, decision: object) =>
    useCase.decide({ fingerprint: reviewFingerprint, expectedRevision: revision, decision }, reviewHost, scope, actor);
  assert.ok((await select(1, { kind: "approve", mode: "whole-plan" })).ok);
  assert.deepEqual(await list(), expected);
  atCommit = () => { actorCurrent = false; };
  assert.deepEqual(await select(2, { kind: "revoke" }), { ok: false, code: "forbidden" });
  atCommit = () => {};
  actorCurrent = true;
  assert.deepEqual(await list(), expected);
  const retained = await store.read(reviewQuery);
  assert.ok(retained.ok && retained.snapshot.state.status === "approved" && retained.snapshot.state.revision === 2);
  assert.ok((await select(2, { kind: "revoke" })).ok);
  assert.deepEqual(await list(), { ok: true, requests: [] });
  const revoked = await store.read(reviewQuery);
  assert.ok(revoked.ok && revoked.snapshot.state.status === "revoked");

  for (let index = 1; index <= 33; index++) {
    const raw = { ...reviewProposal, steps: [{ ...reviewProposal.steps[0], name: "Fixture proposal " + index }] };
    const parsed = parseHeadlessBuildPlanProposal(raw, reviewHost);
    assert.ok(parsed.ok);
    const digest = createHash("sha256").update(JSON.stringify(parsed.preview), "utf8").digest("hex");
    const result = await store.propose({ target: { ...reviewTarget, fingerprint: digest }, isCurrent, proposal: raw });
    if (index <= 32) assert.ok(result.ok);
    else assert.deepEqual(result, { ok: false, code: "capacity" });
  }
  const full = await list();
  assert.ok(full.ok && full.requests.length === 32);
  now = staged.snapshot.state.expiresAt;
  assert.deepEqual(await list(), { ok: true, requests: [] });
  assert.equal((await documents.forOrganization(scope.organizationId).listDocuments("headless/system-builder/plan-reviews")).length, 33);
});
