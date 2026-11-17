import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { createInMemoryStructuredDocumentStore } from "../../../../adapters/persistence/shared";
import { createStructuredIngestionAcquisitionRepository } from "../../../../adapters/persistence/ingestion";
import { GovernedIngestionTaskUseCases } from "../governed-ingestion-tasks.use-case";
import { createWorkspaceId } from "../../../../contracts/workspace";
import { normalizeIngestionTaskFileId, normalizeIngestionTaskId, type IngestionTaskRecord } from "../../../../contracts/ingestion";
import { HEADLESS_CONTRACT_VERSION, type HeadlessHostIncarnationId } from "../../../../contracts/headless";
import { createContractError, createFailureResult } from "../../../../contracts/shared";
import { ReadHeadlessIngestionStatusUseCase } from "../headless-ingestion-status.use-case";
import type { HeadlessIngestionStatusRequest, HeadlessLocalFileImportRequest } from "../../../../contracts/headless";

const workspaceId = createWorkspaceId("workspace.data-fixture");
const taskId = normalizeIngestionTaskId("intake.fixture");
const context = { workspaceId };
const input: HeadlessIngestionStatusRequest = {
  version:HEADLESS_CONTRACT_VERSION,
  operation:"data.ingestion-status",
  input: { workspaceId, taskId, hostIncarnationId: "54133645-536c-43d2-8309-30701194add7" as HeadlessHostIncarnationId },
};
const task: IngestionTaskRecord = {
  schemaVersion:"1.0", workspaceId, taskId, kind:"file-batch", status:"queued", revision:1,
  files:[{fileId:normalizeIngestionTaskFileId("file.queued"),checkpointId:"checkpoint.queued",
    fileName:"synthetic-source.txt",mediaType:"text/plain",totalBytes:4,status:"pending",acceptedBytes:0,nextChunkIndex:0}],
  cleanupPending:false, createdAt:"2025-01-01T00:00:00Z", updatedAt:"2025-01-01T00:00:00Z",
  progress:{completedItems:0,totalItems:1,acceptedBytes:0,totalBytes:4,percent:0},
};

test("a read uses the exact trusted workspace and retires its result after permission changes", async () => {
  let remaining = 1;
  let admittedReads = 0;
  const sut = new ReadHeadlessIngestionStatusUseCase({
    async executeCommand(command, current) {
      assert.deepEqual(command, {action:"read",taskId});
      assert.equal(current, context);
      admittedReads++;
      return {ok:true,value:{kind:"task",task}};
    },
  });
  const authority = {context,stillAllowed:async()=>remaining-- > 0};
  assert.deepEqual(await sut.execute(input,authority), {ok:false,code:"headless.forbidden"});
  assert.equal(admittedReads,1);
  assert.deepEqual(await sut.execute(input,authority), {ok:false,code:"headless.forbidden"});
  assert.equal(admittedReads,1);

  remaining = 2;
  const result = await sut.execute(input,authority);
  assert.equal(result.ok,true);
  assert.equal(admittedReads,2);
});

test("wrong workspace or task absence cannot reveal ingestion state", async () => {
  let attempted = 0;
  const sut = new ReadHeadlessIngestionStatusUseCase({
    async executeCommand() {
      attempted++;
      return createFailureResult(createContractError("not-found","Fixture internal context"));
    },
  });
  const authorized = {context,stillAllowed:async()=>true};
  assert.deepEqual(await sut.execute(input,{...authorized,context:{workspaceId:createWorkspaceId("workspace.foreign")}}),
    {ok:false,code:"headless.forbidden"});
  assert.equal(attempted,0);
  assert.deepEqual(await sut.execute(input,authorized), {ok:false,code:"headless.forbidden"});
  assert.equal(attempted,1);
});

test("prepare a complete transfer or an empty selection from the ordinary ingestion owner", async () => {
  const now = "2025-01-01T00:00:03Z";
  const bytes = new Uint8Array([1, 2, 3, 4]);
  const sha256 = "sha256:" + createHash("sha256").update(bytes).digest("hex");
  let sequence = 0;
  let appendCount = 0;
  let checksumRejectionArmed = false;
  const repository = createStructuredIngestionAcquisitionRepository(createInMemoryStructuredDocumentStore());
  const owner = new GovernedIngestionTaskUseCases({
    repository,
    checkpoints: {
      async appendChunk(chunk) {
        appendCount++;
        assert.deepEqual(chunk.bytes, bytes);
        assert.equal(chunk.sha256, sha256);
        return { chunkCount: 1, sizeBytes: bytes.length, duplicate: false };
      },
      async *readChunks() { assert.fail("Preview cannot read checkpoint bytes."); },
      async inspectCheckpoint() { assert.fail("Unexpected checkpoint inspection."); },
      async deleteCheckpoint() { assert.fail("Preview cannot delete checkpoints."); },
    },
    streamStorage: {
      async storeArtifactStream() { assert.fail("Preview cannot publish an artifact."); },
    },
    artifactCleanup: {
      async deleteArtifact() { assert.fail("Preview cannot delete an artifact."); },
    },
    filePublication: {
      async publishFile() {
        assert.ok(checksumRejectionArmed, "Preview cannot publish an artifact.");
        checksumRejectionArmed = false;
        return { kind: "content-rejected" };
      },
      async verifyFilePublication() { assert.fail("Preview cannot read publication bytes."); },
    },
    now: () => now,
    createId: () => String(++sequence),
  });
  let allowed = true;
  let withdrawOnRead = false;
  const sut = new ReadHeadlessIngestionStatusUseCase({
    async executeCommand(command, current) {
      assert.equal(command.action, "read");
      assert.equal(current, context);
      const response = await owner.executeCommand(command, current);
      if (withdrawOnRead) allowed = false;
      return response;
    },
  }, () => Date.parse(now));
  const authority = { context, stillAllowed: async () => allowed };
  const requestFor = (record: IngestionTaskRecord): HeadlessLocalFileImportRequest => ({
    version: input.version,
    operation: "data.prepare-local-file",
    input: { ...input.input, taskId: record.taskId, fileId: record.files[0]!.fileId, taskRevision: record.revision },
  });

  const selected = await owner.createTask({ files: [{ fileName: "synthetic.csv", mediaType: "text/csv", sizeBytes: 4 }] }, context);
  assert.ok(selected.ok);
  assert.equal(selected.value.cleanupPending, true);
  assert.deepEqual(await sut.prepareLocalFileImport(requestFor(selected.value), authority),
    { ok: false, code: "headless.source-not-ready" });
  const transferred = await owner.appendChunk({ taskId: selected.value.taskId, fileId: selected.value.files[0]!.fileId,
    chunkIndex: 0, expectedOffset: 0, bytes, sha256 }, context);
  assert.ok(transferred.ok);
  assert.equal(transferred.value.cleanupPending, true);
  const ready = await sut.prepareLocalFileImport(requestFor(transferred.value), authority);
  assert.ok(ready.ok);
  assert.equal(ready.value.fileId, transferred.value.files[0]!.fileId);
  assert.equal(ready.value.taskRevision, transferred.value.revision);
  assert.equal(ready.value.fileBytes, bytes.length);
  assert.deepEqual(await sut.prepareLocalFileImport(requestFor(selected.value), authority),
    { ok: false, code: "headless.stale" });

  const empty = await owner.createTask({ files: [{ fileName: "empty.csv", mediaType: "text/csv", sizeBytes: 0 }] }, context);
  assert.ok(empty.ok);
  assert.equal(empty.value.cleanupPending, true);
  const emptyPreview = await sut.prepareLocalFileImport(requestFor(empty.value), authority);
  assert.ok(emptyPreview.ok);
  assert.equal(emptyPreview.value.fileBytes, 0);

  checksumRejectionArmed = true;
  const rejected = await owner.finalizeFile({ taskId: empty.value.taskId, fileId: empty.value.files[0]!.fileId, sha256 }, context);
  assert.ok(rejected.ok);
  assert.equal(rejected.value.status, "failed");
  assert.equal(checksumRejectionArmed, false);
  const resumed = await owner.resumeTask(rejected.value.taskId, context);
  assert.ok(resumed.ok);
  assert.equal(resumed.value.files[0]!.status, "transferring");
  const resumedPreview = await sut.prepareLocalFileImport(requestFor(resumed.value), authority);
  assert.ok(resumedPreview.ok);
  assert.equal(resumedPreview.value.fileBytes, 0);
  assert.equal(appendCount, 1);

  withdrawOnRead = true;
  assert.deepEqual(await sut.prepareLocalFileImport(requestFor(transferred.value), authority),
    { ok: false, code: "headless.forbidden" });
});
