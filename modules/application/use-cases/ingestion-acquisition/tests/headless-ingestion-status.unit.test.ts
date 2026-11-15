import assert from "node:assert/strict";
import test from "node:test";
import { createWorkspaceId } from "../../../../contracts/workspace";
import { normalizeIngestionTaskFileId, normalizeIngestionTaskId, type IngestionTaskRecord } from "../../../../contracts/ingestion";
import { HEADLESS_CONTRACT_VERSION, type HeadlessHostIncarnationId } from "../../../../contracts/headless";
import { createContractError, createFailureResult } from "../../../../contracts/shared";
import { ReadHeadlessIngestionStatusUseCase } from "../headless-ingestion-status.use-case";
import type { HeadlessIngestionStatusRequest } from "../../../../contracts/headless";

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
