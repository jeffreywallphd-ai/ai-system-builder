import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import test from "node:test";
import {createOrganizationId} from "../../../../contracts/organization";
import {createWorkspaceId} from "../../../../contracts/workspace";
import {isHeadlessHostIncarnationId, type HeadlessDatasetTaskStatusRequest} from "../../../../contracts/headless";
import {ReadHeadlessDatasetTaskStatusUseCase} from "../headless-dataset-task-status.use-case";

test("passive progress requires an accepted owned task, exact result and current authority after each boundary", async () => {
  const host = randomUUID(); assert.ok(isHeadlessHostIncarnationId(host));
  const taskId = randomUUID(), clientId = randomUUID(), context = {organizationId: createOrganizationId("org.synthetic"),
    principalId: "principal.synthetic", workspaceId: createWorkspaceId("workspace.synthetic")};
  const request: HeadlessDatasetTaskStatusRequest = {version: "aisb-headless-v1", operation: "data.dataset-task-status",
    input: {hostIncarnationId: host, workspaceId: context.workspaceId, selection: {kind: "task", taskId}}};
  let owned = true, current = true, revokeAfterOwned = false, revokeAfterStatus = false, reads = 0;
  let result: unknown = {taskId, state: "running"};
  const app = new ReadHeadlessDatasetTaskStatusUseCase(async (actual, actor, client) => {
    assert.deepEqual(actual, request); assert.deepEqual(actor, context); assert.equal(client, clientId);
    if (revokeAfterOwned) current = false;
    return owned ? taskId : undefined;
  }, async id => {reads++; assert.equal(id, taskId); if (revokeAfterStatus) current = false; return result;});
  const authority = {context, clientId, stillAllowed: async () => current};
  assert.equal((await app.execute(request, authority)).ok, true); assert.equal(reads, 1);
  owned = false; assert.equal((await app.execute(request, authority)).ok, false); assert.equal(reads, 1);
  owned = true; revokeAfterOwned = true;
  assert.equal((await app.execute(request, authority)).ok, false); assert.equal(reads, 1);
  current = true; revokeAfterOwned = false; revokeAfterStatus = true;
  assert.equal((await app.execute(request, authority)).ok, false); assert.equal(reads, 2);
  current = true; revokeAfterStatus = false; result = {taskId: randomUUID(), state: "running"};
  assert.deepEqual(await app.execute(request, authority), {ok: false, code: "headless.unavailable"});
  result = {taskId, state: "running", outputPath: "private"};
  assert.deepEqual(await app.execute(request, authority), {ok: false, code: "headless.unavailable"});
});
