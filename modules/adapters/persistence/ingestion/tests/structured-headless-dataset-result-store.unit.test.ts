import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import test from "node:test";
import {mkdtemp, realpath, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {createInMemoryStructuredDocumentStore, type StructuredDocumentStore} from "../../shared";
import {openLocalSqliteDatabase, resolveLocalSqliteDatabasePolicy} from "../../sqlite";
import {createStructuredDatasetVersionRepository, createStructuredDatasetVersionInOwnedTransaction} from "../../dataset-version";
import {createOrganizationId} from "../../../../contracts/organization";
import {createWorkspaceId} from "../../../../contracts/workspace";
import {normalizeDatasetVersionRecord} from "../../../../contracts/dataset";
import {readHeadlessLocalDatasetPlanRequest, readHeadlessDatasetResultSavePlanRequest} from "../../../../contracts/headless";
import {reserveStructuredDatasetPlanTask, issueStructuredDatasetPlanTask, acceptStructuredDatasetPlanTask} from "../createStructuredHeadlessDatasetPlanTaskStore";
import {reserveStructuredDatasetResultSave, issueStructuredDatasetResultSave, commitStructuredDatasetResultSave,
  inspectStructuredDatasetResultSave, readCommittedStructuredDatasetResult, type DatasetResultSaveEffect} from "../createStructuredHeadlessDatasetResultStore";

async function fixture(root: StructuredDocumentStore = createInMemoryStructuredDocumentStore()) {
  const host = randomUUID();
  const scope = {organizationId: createOrganizationId("org.synthetic"), workspaceId: createWorkspaceId("workspace.synthetic"),
    principalId: "principal.synthetic", registeredClientId: randomUUID()};
  const owner = root.forOrganization(scope.organizationId);
  const transaction = <T>(run: (partition: typeof owner) => Promise<T>, fence = () => {}) =>
    root.runInOwnedTransaction!(part => run(part.forOrganization(scope.organizationId)), fence);
  const start = readHeadlessLocalDatasetPlanRequest({version: "aisb-headless-v1", operation: "data.prepare-local-dataset", input: {
    hostIncarnationId: host, workspaceId: scope.workspaceId, idempotencyKey: randomUUID(),
    sources: [{taskId: "source.task", fileId: "source.file", taskRevision: 3}],
    recipe: {kind: "provided-instruction-rows-v1", inputColumn: "question", outputColumn: "answer"},
    split: {trainRatio: 0.8, validationRatio: 0.1, testRatio: 0.1, seed: 42}, qualityPreset: "recommended"}}, host);
  assert.ok(start.ok);
  const taskEffect = {key: randomUUID(), target: {hostIncarnationId: host, fingerprint: "a".repeat(64), scope},
    approvalRevision: 2, step: 1, request: start.request};
  const reserved = await transaction(part => reserveStructuredDatasetPlanTask(part, taskEffect, "b".repeat(64), 1));
  assert.equal(reserved.kind, "new"); assert.ok("taskId" in reserved);
  await transaction(part => issueStructuredDatasetPlanTask(part, taskEffect, reserved.taskId, "b".repeat(64), 2));
  await transaction(part => acceptStructuredDatasetPlanTask(part, taskEffect, reserved.taskId, 3));
  const parsed = readHeadlessDatasetResultSavePlanRequest({version: "aisb-headless-v1", operation: "data.save-prepared-dataset", input: {
    hostIncarnationId: host, workspaceId: scope.workspaceId, idempotencyKey: randomUUID(), taskId: reserved.taskId,
    reportFingerprint: "c".repeat(64), outputBaseName: "Reviewed answers"}}, host);
  assert.ok(parsed.ok);
  const effect: DatasetResultSaveEffect = {key: randomUUID(), target: {hostIncarnationId: host, fingerprint: "d".repeat(64), scope},
    approvalRevision: 2, step: 1, request: parsed.request};
  const review = {taskId: reserved.taskId, reportFingerprint: "c".repeat(64), policyFingerprint: `sha256:${"e".repeat(64)}` as const,
    status: "ready" as const, counts: {inputRows: 2, acceptedRows: 2, quarantinedRows: 0}, reasonCounts: {},
    splits: {trainRows: 2, validationRows: 0, testRows: 0}, approvalAllowed: true, saveAvailable: true};
  const digest = `sha256:${"f".repeat(64)}` as const;
  const version = normalizeDatasetVersionRecord({schemaVersion: "1.0", workspaceId: scope.workspaceId, organizationId: scope.organizationId,
    versionId: "reviewed-answers:1234", datasetId: "reviewed-answers", versionDigest: digest,
    artifacts: [{role: "dataset", artifactKey: "prepared/answers.jsonl", digest, mediaType: "application/x-ndjson", sizeBytes: 64, rowCount: 2},
      {role: "train", artifactKey: "prepared/train.jsonl", digest, mediaType: "application/x-ndjson", sizeBytes: 64, rowCount: 2},
      {role: "recipe", artifactKey: "prepared/recipe.json", digest, mediaType: "application/json", sizeBytes: 32}],
    lineage: {sources: [{artifactKey: "source.one", digest, mediaType: "text/csv"}],
      recipe: {artifactKey: "prepared/recipe.json", digest, implementationId: "builtin.dataset-preparation", implementationVersion: "1.0.0"},
      quality: {policyId: "recommended", policyVersion: "1", policyFingerprint: review.policyFingerprint,
        reportFingerprint: `sha256:${review.reportFingerprint}`}, split: {strategy: "source-group", seed: 42}},
    documentation: {name: "Reviewed answers", summary: "Synthetic support answers.", intendedUses: ["Tests."], limitations: ["Synthetic only."]},
    totalRows: 2, createdAt: "2026-11-17T00:00:00.000Z", createdBy: scope.principalId});
  const sourceDigest = "9".repeat(64);
  const reserve = (selected = effect) => transaction(part => reserveStructuredDatasetResultSave(part, selected, review, sourceDigest, 4));
  const issue = (saveId: string, selected = effect) => transaction(part => issueStructuredDatasetResultSave(part, selected, saveId, sourceDigest, 5));
  const commit = (saveId: string, v = version, fence = () => {}) => transaction(part =>
    commitStructuredDatasetResultSave(part, effect, saveId, sourceDigest, v, 6), fence);
  return {root, owner, scope, transaction, effect, review, sourceDigest, version, reserve, issue, commit,
    versions: createStructuredDatasetVersionRepository(owner)};
}

test("immutable version metadata and the exact causal save receipt commit once together", async () => {
  const f = await fixture(), reserved = await f.reserve();
  assert.equal(reserved.kind, "new"); assert.ok("saveId" in reserved); assert.notEqual(reserved.saveId, f.effect.key);
  assert.deepEqual(await inspectStructuredDatasetResultSave(f.owner, f.effect), {kind: "unconfirmed"});
  assert.equal(await f.issue(reserved.saveId), true);
  assert.equal((await f.commit(reserved.saveId)).created, true);
  const reference = {workspaceId: f.scope.workspaceId, taskId: f.effect.request.input.taskId,
    datasetId: f.version.datasetId, versionId: f.version.versionId, versionDigest: f.version.versionDigest};
  assert.deepEqual(await readCommittedStructuredDatasetResult(f.owner, f.effect), reference);
  assert.deepEqual(await inspectStructuredDatasetResultSave(f.owner, {...f.effect, approvalRevision: 3}), {kind: "committed", reference});
  assert.equal((await f.commit(reserved.saveId)).created, false);
  assert.equal(await f.issue(reserved.saveId), false);
  assert.deepEqual(await f.versions.listVersions(f.scope.workspaceId), [f.version]);
});

test("a failed final publication fence rolls back both version metadata and receipt", async () => {
  const f = await fixture(), reserved = await f.reserve(); assert.ok("saveId" in reserved);
  assert.equal(await f.issue(reserved.saveId), true);
  await assert.rejects(f.commit(reserved.saveId, f.version, () => {throw new Error("Synthetic authority loss.");}));
  assert.equal(await readCommittedStructuredDatasetResult(f.owner, f.effect), undefined);
  assert.deepEqual(await f.versions.listVersions(f.scope.workspaceId), []);
  assert.deepEqual(await inspectStructuredDatasetResultSave(f.owner, f.effect), {kind: "unconfirmed"});
});

test("a lost commit acknowledgement preserves the receipt, while an ordinary version cannot be adopted", async () => {
  const f = await fixture(), reserved = await f.reserve(); assert.ok("saveId" in reserved);
  await f.issue(reserved.saveId);
  await assert.rejects((async () => {await f.commit(reserved.saveId); throw new Error("Synthetic lost reply.");})());
  assert.equal((await inspectStructuredDatasetResultSave(f.owner, f.effect)).kind, "committed");
  const ordinary = await fixture(), second = await ordinary.reserve(); assert.ok("saveId" in second);
  await ordinary.issue(second.saveId); await ordinary.versions.createVersion(ordinary.version);
  await assert.rejects(ordinary.commit(second.saveId));
  assert.equal(await readCommittedStructuredDatasetResult(ordinary.owner, ordinary.effect), undefined);
  assert.deepEqual(await ordinary.versions.listVersions(ordinary.scope.workspaceId), [ordinary.version]);
});

test("wrong actor, report, name, rows or task identity cannot publish a result", async () => {
  const f = await fixture(), reserved = await f.reserve(); assert.ok("saveId" in reserved); await f.issue(reserved.saveId);
  for (const version of [{...f.version, createdBy: "foreign"}, {...f.version, workspaceId: createWorkspaceId("foreign.workspace")},
    {...f.version, documentation: {...f.version.documentation, name: "Other name"}}, {...f.version, totalRows: 3},
    {...f.version, lineage: {...f.version.lineage, quality: {...f.version.lineage.quality, reportFingerprint: `sha256:${"1".repeat(64)}` as const}}}])
    await assert.rejects(f.commit(reserved.saveId, version));
  await assert.rejects(f.commit(randomUUID()));
  await assert.rejects(inspectStructuredDatasetResultSave(f.owner, {...f.effect, target: {...f.effect.target,
    scope: {...f.scope, registeredClientId: randomUUID()}}}));
  assert.deepEqual(await f.versions.listVersions(f.scope.workspaceId), []);
});

test("only the scoped transaction owner can mutate and only an accepted task can be reserved", async () => {
  const f = await fixture();
  await assert.rejects(reserveStructuredDatasetResultSave(f.owner, f.effect, f.review, f.sourceDigest, 4));
  await assert.rejects(createStructuredDatasetVersionInOwnedTransaction(f.owner, f.version));
  await assert.rejects(f.transaction(part => reserveStructuredDatasetResultSave(part, {...f.effect,
    request: {...f.effect.request, input: {...f.effect.request.input, taskId: randomUUID()}}}, f.review, f.sourceDigest, 4)));
  assert.deepEqual(await inspectStructuredDatasetResultSave(f.owner, f.effect), {kind: "absent"});
});

test("a reserved-only plan does not occupy the task, but only one competing plan can issue a save", async () => {
  const f = await fixture(), first = await f.reserve(); assert.ok("saveId" in first);
  const another = {...f.effect, key: randomUUID(), target: {...f.effect.target, fingerprint: "2".repeat(64)}};
  const second = await f.reserve(another); assert.ok("saveId" in second);
  assert.equal(await f.issue(second.saveId, another), true);
  assert.equal(await f.issue(first.saveId), false);
  assert.deepEqual(await f.versions.listVersions(f.scope.workspaceId), []);
});

test("actual SQLite rolls back the version with its receipt and preserves a confirmed causal receipt across reopen", async () => {
  const directory = await realpath(await mkdtemp(join(await realpath(tmpdir()), "headless-dataset-result-")));
  const policy = resolveLocalSqliteDatabasePolicy({dataRootDirectory: directory});
  let db = await openLocalSqliteDatabase({policy}), closed = false;
  try {
    const f = await fixture(db.documents), reserved = await f.reserve(); assert.ok("saveId" in reserved);
    assert.equal(await f.issue(reserved.saveId), true);
    await assert.rejects(f.commit(reserved.saveId, f.version, () => {throw new Error("Synthetic precommit denial.");}));
    assert.deepEqual(await f.versions.listVersions(f.scope.workspaceId), []);
    assert.equal(await readCommittedStructuredDatasetResult(f.owner, f.effect), undefined);
    const committed = await f.commit(reserved.saveId); assert.equal(committed.created, true);
    const reference = await readCommittedStructuredDatasetResult(f.owner, f.effect); assert.ok(reference);
    await db.close(); closed = true;
    db = await openLocalSqliteDatabase({policy}); closed = false;
    assert.deepEqual(await readCommittedStructuredDatasetResult(db.documents.forOrganization(f.scope.organizationId), f.effect), reference);
    assert.deepEqual(await createStructuredDatasetVersionRepository(db.documents.forOrganization(f.scope.organizationId))
      .listVersions(f.scope.workspaceId), [f.version]);
  } finally {if (!closed) await db.close(); await rm(directory, {recursive: true, force: true});}
});
