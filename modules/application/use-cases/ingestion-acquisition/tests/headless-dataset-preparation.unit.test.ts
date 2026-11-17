import assert from "node:assert/strict";
import test from "node:test";
import {createHash} from "node:crypto";
import {createInMemoryStructuredDocumentStore} from "../../../../adapters/persistence/shared";
import {createStructuredIngestionAcquisitionRepository} from "../../../../adapters/persistence/ingestion";
import {normalizeIngestionTaskRecord, normalizeIngestionSourceSnapshot, normalizeIngestionTaskId, normalizeIngestionTaskFileId,
  normalizeIngestionSha256Digest} from "../../../../contracts/ingestion";
import {createOrganizationId} from "../../../../contracts/organization";
import {createWorkspaceId} from "../../../../contracts/workspace";
import {HEADLESS_CONTRACT_VERSION, HEADLESS_DATASET_MAX_SOURCE_BYTES, type HeadlessHostIncarnationId,
  type HeadlessDatasetPreparationRequest} from "../../../../contracts/headless";
import {PrepareHeadlessDatasetInputsUseCase} from "../headless-dataset-preparation.use-case";
import {PrepareTrainingDatasetFromArtifactsUseCase} from "../../prepare-training-dataset-from-artifacts.use-case";

const organizationId = createOrganizationId("dataset-source-fixture"), workspaceId = createWorkspaceId("workspace.synthetic");
const hostIncarnationId = "ca353bdd-7793-44c6-8c36-c470be8c537c" as HeadlessHostIncarnationId;
const context = {organizationId, workspaceId, principalId: "principal.synthetic"};
const at = "2026-11-17T00:00:00.000Z";
const bytes = new TextEncoder().encode('question,answer\n"One?","Two."\n');
const digest = normalizeIngestionSha256Digest("sha256:" + createHash("sha256").update(bytes).digest("hex"));
function source(number: number) {
  const taskId = normalizeIngestionTaskId("task.synthetic." + number), fileId = normalizeIngestionTaskFileId("file.synthetic." + number);
  const sourceId = "source.synthetic." + number, snapshotId = "snapshot.synthetic." + number;
  const key = "private/synthetic/" + number + ".csv";
  const task = normalizeIngestionTaskRecord({schemaVersion: "1.0", taskId, organizationId, workspaceId, kind: "file-batch",
    status: "succeeded", revision: 1, cleanupPending: false, createdAt: at, updatedAt: at, completedAt: at,
    files: [{fileId, checkpointId: "checkpoint.synthetic." + number, fileName: "private-source.csv", mediaType: "text/csv",
      totalBytes: bytes.length, status: "finalized", acceptedBytes: bytes.length, nextChunkIndex: 1,
      lastChunk: {index: 0, sizeBytes: bytes.length, digest},
      output: {key, mediaType: "text/csv", sizeBytes: bytes.length, digest, sourceId, sourceSnapshotId: snapshotId}}],
    progress: {completedItems: 1, totalItems: 1, acceptedBytes: bytes.length, totalBytes: bytes.length, percent: 100}});
  const snapshot = normalizeIngestionSourceSnapshot({schemaVersion: "1.0", organizationId, workspaceId,
    sourceId: sourceId as never, snapshotId: snapshotId as never, locator: {kind: "file", displayName: "private-source.csv"},
    contentDigest: digest, sizeBytes: bytes.length, mediaType: "text/csv", rawArtifactKey: key, capturedAt: at});
  return {task, snapshot, selected: {taskId, fileId, taskRevision: 1}};
}
const request = (count = 2): HeadlessDatasetPreparationRequest => ({version: HEADLESS_CONTRACT_VERSION,
  operation: "data.preview-dataset-preparation", input: {hostIncarnationId, workspaceId,
    sources: Array.from({length: count}, (_, index) => source(index + 1).selected),
    recipe: {kind: "provided-instruction-rows-v1", inputColumn: "question", outputColumn: "answer"},
    split: {trainRatio: 0.8, validationRatio: 0.1, testRatio: 0.1, seed: 42}, qualityPreset: "recommended"}});
const authority = {hostIncarnationId, context, stillAllowed: async () => true};
async function fixture() {
  const repository = createStructuredIngestionAcquisitionRepository(createInMemoryStructuredDocumentStore().forOrganization(organizationId));
  for (const number of [1, 2]) {const row = source(number); await repository.createTask(row.task); await repository.createSourceSnapshot(row.snapshot);}
  return repository;
}

test("exact immutable local sources map privately to the existing review-required provided-row pipeline", async () => {
  const owner = new PrepareHeadlessDatasetInputsUseCase(await fixture());
  const result = await owner.execute(request(), authority);
  assert.ok(result.ok && "prepared" in result);
  const {preview, command} = result.prepared;
  assert.equal(preview.totalBytes, bytes.length * 2);
  assert.equal(preview.sources.length, 2);
  assert.equal(preview.sources[0].licenseStatus, "unknown");
  assert.equal(preview.maximumRowsPerSource, 1_000);
  assert.equal(preview.modelCalls, 0);
  assert.ok(!/private|ArtifactKey|fileName|principalId|organizationId/.test(JSON.stringify(preview)));
  assert.deepEqual(command.sourceArtifactIds, [source(1).snapshot.rawArtifactKey, source(2).snapshot.rawArtifactKey]);
  assert.deepEqual(command.quality, {policy: {preset: "recommended", maxRowsPerSource: 1_000}, reviewRequired: true});
  assert.deepEqual(command.output, {format: "jsonl", destinations: {local: {enabled: true}}});
  let readiness = 0;
  const pipeline = new PrepareTrainingDatasetFromArtifactsUseCase({runtimeCapabilityGuard: {async requireCapabilityReady() {
    readiness++; throw Object.assign(new Error("Synthetic readiness denial"), {code: "unavailable"});
  }}} as never);
  const observed = await pipeline.startPrepareTrainingDataset(command, context);
  assert.equal(observed.ok, false);
  assert.ok(!observed.ok && observed.error.code === "unavailable", "The canonical validator must accept the command before readiness denies it.");
  assert.equal(readiness, 1);
});

test("admission stops between exact reads after permission withdrawal and rejects malformed authority before I/O", async () => {
  const repository = await fixture();
  let taskReads = 0, snapshotReads = 0, allowed = true;
  const owner = new PrepareHeadlessDatasetInputsUseCase({
    async readTask(...args) {taskReads++; const result = await repository.readTask(...args); allowed = false; return result;},
    async readSourceSnapshot(...args) {snapshotReads++; return repository.readSourceSnapshot(...args);},
  });
  assert.deepEqual(await owner.execute(request(), {...authority, stillAllowed: async () => allowed}), {ok: false, code: "headless.forbidden"});
  assert.equal(taskReads, 1); assert.equal(snapshotReads, 0);
  assert.equal((await owner.execute({...request(), input: {...request().input, runtime: {}}}, authority)).ok, false);
  assert.equal((await owner.execute(request(), {...authority, context: {...context, organizationId: undefined}})).ok, false);
  assert.equal((await owner.execute(request(), {...authority, context: {...context, workspaceId: "foreign"}})).ok, false);
  assert.equal(taskReads, 1);
});

test("stale, foreign, unfinished, oversized, unsupported or mismatched source evidence produces no command", async () => {
  const repository = await fixture(), row = source(1);
  const badTasks = [
    {...row.task, revision: 4}, {...row.task, workspaceId: createWorkspaceId("foreign")},
    {...row.task, status: "transferring" as const, completedAt: undefined},
    {...row.task, files: [{...row.task.files[0], fileName: "source.pdf", mediaType: "application/pdf"}]},
    {...row.task, files: [{...row.task.files[0], totalBytes: HEADLESS_DATASET_MAX_SOURCE_BYTES + 1,
      acceptedBytes: HEADLESS_DATASET_MAX_SOURCE_BYTES + 1, output: {...row.task.files[0].output!, sizeBytes: HEADLESS_DATASET_MAX_SOURCE_BYTES + 1}}]},
  ];
  for (const task of badTasks) {
    const owner = new PrepareHeadlessDatasetInputsUseCase({...repository, async readTask() {return task;}});
    assert.equal((await owner.execute(request(1), authority)).ok, false);
  }
  for (const snapshot of [
    {...row.snapshot, sourceId: "foreign" as never}, {...row.snapshot, rawArtifactKey: "private/foreign.csv"},
    {...row.snapshot, contentDigest: normalizeIngestionSha256Digest("sha256:" + "a".repeat(64))},
    {...row.snapshot, organizationId: createOrganizationId("foreign")},
  ]) {
    const owner = new PrepareHeadlessDatasetInputsUseCase({...repository, async readSourceSnapshot() {return snapshot;}});
    assert.equal((await owner.execute(request(1), authority)).ok, false);
  }
  const owner = new PrepareHeadlessDatasetInputsUseCase({...repository, async readTask() {throw new Error("Synthetic private detail");}});
  assert.deepEqual(await owner.execute(request(1), authority), {ok: false, code: "headless.unavailable"});
});
