import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import test from "node:test";
import {createInMemoryStructuredDocumentStore} from "../../../../adapters/persistence/shared";
import {createStructuredIngestionAcquisitionRepository} from "../../../../adapters/persistence/ingestion";
import {createStructuredDatasetVersionRepository} from "../../../../adapters/persistence/dataset-version";
import {reserveStructuredDatasetPlanTask, issueStructuredDatasetPlanTask, acceptStructuredDatasetPlanTask,
  type DatasetPlanTaskEffect} from "../../../../adapters/persistence/ingestion/createStructuredHeadlessDatasetPlanTaskStore";
import {normalizeIngestionTaskRecord, normalizeIngestionSourceSnapshot} from "../../../../contracts/ingestion";
import {normalizeDatasetVersionRecord} from "../../../../contracts/dataset";
import {createOrganizationId} from "../../../../contracts/organization";
import {createWorkspaceId} from "../../../../contracts/workspace";
import {readHeadlessLocalDatasetPlanRequest, type UiDataPresentationIntent} from "../../../../contracts/headless";
import {ReadHeadlessDataPresentationUseCase} from "../../../../application/use-cases/ingestion-acquisition/headless-data-presentation.use-case";
import {composeHeadlessDataPresentation} from "../headlessDataPresentation";

const organizationId = createOrganizationId("presentation-org"), workspaceId = createWorkspaceId("presentation-workspace");
const context = {organizationId, workspaceId, principalId: "presentation-principal"};
const at = "2026-11-18T00:00:00.000Z", digest = `sha256:${"a".repeat(64)}` as const;
const sourceIntent = {action: "show-data-source", taskId: "source.task", fileId: "source.file", taskRevision: 1} as const;
const versionIntent = {action: "show-dataset-version", datasetId: "dataset.synthetic", versionId: "version.synthetic", versionDigest: digest} as const;
const source = normalizeIngestionTaskRecord({schemaVersion: "1.0", organizationId, workspaceId,
  taskId: sourceIntent.taskId as never, kind: "file-batch", status: "succeeded", revision: 1, cleanupPending: false,
  createdAt: at, updatedAt: at, completedAt: at, files: [{fileId: sourceIntent.fileId as never, checkpointId: "checkpoint.synthetic",
    fileName: "private-source.csv", mediaType: "text/csv", totalBytes: 20, acceptedBytes: 20, status: "finalized", nextChunkIndex: 1,
    lastChunk: {index: 0, sizeBytes: 20, digest}, output: {key: "private/source.csv", mediaType: "text/csv", sizeBytes: 20,
      digest, sourceId: "source.synthetic", sourceSnapshotId: "snapshot.synthetic"}}],
  progress: {acceptedBytes: 20, totalBytes: 20, totalItems: 1, completedItems: 1, percent: 100}});
const snapshot = normalizeIngestionSourceSnapshot({schemaVersion: "1.0", organizationId, workspaceId,
  snapshotId: "snapshot.synthetic" as never, sourceId: "source.synthetic" as never,
  locator: {kind: "file", displayName: "private-source.csv"}, contentDigest: digest, sizeBytes: 20,
  mediaType: "text/csv", rawArtifactKey: "private/source.csv", capturedAt: at});
const version = normalizeDatasetVersionRecord({schemaVersion: "1.0", organizationId, workspaceId,
  versionId: versionIntent.versionId as never, datasetId: versionIntent.datasetId as never, versionDigest: digest,
  totalRows: 2, createdAt: at, createdBy: context.principalId,
  artifacts: [{role: "dataset", artifactKey: "private/dataset.jsonl" as never, digest, mediaType: "application/jsonl", sizeBytes: 100, rowCount: 2}],
  lineage: {sources: [{artifactKey: "private/source.csv" as never, digest, mediaType: "text/csv"}],
    recipe: {artifactKey: "private/recipe.json" as never, digest, implementationId: "prepare", implementationVersion: "1"},
    quality: {policyId: "recommended", policyVersion: "1", policyFingerprint: digest, reportFingerprint: digest}},
  documentation: {name: "private name", summary: "private summary", intendedUses: [], limitations: []}});
const allowed = async () => true;

test("source and version reveal use exact saved lineage and never project paths, names, rows or recipe contents", async () => {
  const root = createInMemoryStructuredDocumentStore(), partition = root.forOrganization(organizationId);
  const sources = createStructuredIngestionAcquisitionRepository(partition), versions = createStructuredDatasetVersionRepository(partition);
  await sources.createTask(source); await sources.createSourceSnapshot(snapshot); await versions.createVersion(version);
  let warmed = 0;
  const reader = composeHeadlessDataPresentation({documents: root, rootDirectory: ".", hostIncarnationId: randomUUID(),
    async getProcessor() {warmed++; throw new Error("Metadata presentation must not warm a processor.");}})(context)!;
  assert.deepEqual(await reader.execute(sourceIntent, context, allowed), {title: "Saved source data", summary: "Source type: file. 20 bytes. License: not recorded."});
  assert.deepEqual(await reader.execute(versionIntent, context, allowed), {title: "Saved dataset version", summary: "2 rows from 1 sources. Immutable saved version."});
  for (const intent of [{...sourceIntent, taskRevision: 2}, {...sourceIntent, fileId: "another.file"},
    {...versionIntent, versionDigest: `sha256:${"b".repeat(64)}`} as const, {...versionIntent, datasetId: "another.dataset"}])
    assert.equal(await reader.execute(intent, context, allowed), undefined);
  for (const actor of [{...context, organizationId: createOrganizationId("another-org")}, {...context, workspaceId: createWorkspaceId("another-workspace")}])
    for (const intent of [sourceIntent, versionIntent]) assert.equal(await reader.execute(intent, actor, allowed), undefined);
  assert.equal(warmed, 0);
});

test("changed permission between reads prevents further lookup and publication; mismatched source lineage fails closed", async () => {
  for (const intent of [sourceIntent, versionIntent]) {
    let live = true, snapshots = 0;
    const reader = new ReadHeadlessDataPresentationUseCase({sources: {
      async readTask() {live = false; return source;}, async readSourceSnapshot() {snapshots++; return snapshot;}},
      versions: {async readVersion() {live = false; return version;}}, async readAcceptedTask() {throw new Error("No task lookup.");}});
    assert.equal(await reader.execute(intent, context, async () => live), undefined); assert.equal(snapshots, 0);
  }
  for (const changed of [{...snapshot, contentDigest: `sha256:${"b".repeat(64)}` as const}, {...snapshot, rawArtifactKey: "private/other.csv"},
    {...snapshot, organizationId: createOrganizationId("another-org")}, {...snapshot, sizeBytes: 19}, {...snapshot, mediaType: "text/plain"}]) {
    const reader = new ReadHeadlessDataPresentationUseCase({sources: {async readTask() {return source;}, async readSourceSnapshot() {return changed;}},
      versions: {async readVersion() {return version;}}, async readAcceptedTask() {throw new Error("No task lookup.");}});
    assert.equal(await reader.execute(sourceIntent, context, allowed), undefined);
  }
});

test("task presentation proves durable acceptance and host/actor ownership before lazy processor access", async () => {
  const documents = createInMemoryStructuredDocumentStore(), partition = documents.forOrganization(organizationId), hostIncarnationId = randomUUID();
  const parsed = readHeadlessLocalDatasetPlanRequest({version: "aisb-headless-v1", operation: "data.prepare-local-dataset", input: {
    hostIncarnationId, workspaceId, idempotencyKey: randomUUID(), sources: [{taskId: sourceIntent.taskId, fileId: sourceIntent.fileId, taskRevision: 3}],
    recipe: {kind: "provided-instruction-rows-v1", inputColumn: "question", outputColumn: "answer"},
    split: {trainRatio: 0.8, validationRatio: 0.1, testRatio: 0.1, seed: 42}, qualityPreset: "recommended"}}, hostIncarnationId);
  assert.ok(parsed.ok);
  const effect: DatasetPlanTaskEffect = {key: randomUUID(), target: {hostIncarnationId: hostIncarnationId as never,
    fingerprint: "c".repeat(64), scope: {...context, registeredClientId: randomUUID()}}, approvalRevision: 2, step: 1, request: parsed.request};
  const transaction = <T>(run: (owner: typeof partition) => Promise<T>) => documents.runInOwnedTransaction!(owner => run(owner.forOrganization(organizationId)), () => {});
  const reserved = await transaction(owner => reserveStructuredDatasetPlanTask(owner, effect, "d".repeat(64), 1));
  assert.ok("taskId" in reserved);
  let warms = 0, statusReads = 0, reviewArrives = false, reviewed = false;
  const review = {taskId: reserved.taskId, reportFingerprint: "e".repeat(64), policyFingerprint: digest,
    status: "ready" as const, counts: {inputRows: 2, acceptedRows: 2, quarantinedRows: 0}, reasonCounts: {},
    splits: {trainRows: 1, validationRows: 0, testRows: 1}, approvalAllowed: true, saveAvailable: true};
  const make = (host = hostIncarnationId) => composeHeadlessDataPresentation({documents, rootDirectory: ".", hostIncarnationId: host,
    async getProcessor() {warms++; return {peekAdmittedLocalDatasetReview() {return reviewed ? review : undefined;}, async readAdmittedLocalDatasetStatus(taskId) {
      statusReads++; if (reviewArrives) {reviewed = true; return {taskId, state: "review-required" as const};}
      return {taskId, state: "succeeded" as const};}};}})(context)!;
  const intent: UiDataPresentationIntent = {action: "show-dataset-task", taskId: reserved.taskId};
  assert.equal(await make().execute({...intent, taskId: randomUUID()}, context, allowed), undefined);
  assert.equal(await make().execute(intent, context, allowed), undefined);
  assert.equal(await transaction(owner => issueStructuredDatasetPlanTask(owner, effect, reserved.taskId, "d".repeat(64), 2)), true);
  assert.equal(await make().execute(intent, context, allowed), undefined);
  assert.equal(warms, 0);
  assert.equal(await transaction(owner => acceptStructuredDatasetPlanTask(owner, effect, reserved.taskId, 3)), true);
  assert.equal(await make(randomUUID()).execute(intent, context, allowed), undefined);
  assert.equal(await make().execute(intent, {...context, principalId: "another-principal"}, allowed), undefined);
  assert.equal(await make().execute(intent, context, async () => false), undefined);
  assert.equal(warms, 0);
  assert.deepEqual(await make().execute(intent, context, allowed), {title: "Dataset preparation", summary: "Task status: succeeded."});
  assert.deepEqual([warms, statusReads], [1, 1]);
  reviewArrives = true;
  assert.deepEqual(await make().execute(intent, context, allowed), {title: "Dataset preparation",
    summary: "Review required: 2 accepted rows, 0 rows set aside. Quality: ready."});
  // Presentation does not alter or remove the execution task's durable receipt.
  assert.ok(await partition.readDocument("headless/data/dataset-plan-task-index", `${workspaceId}/${reserved.taskId}`));
});
