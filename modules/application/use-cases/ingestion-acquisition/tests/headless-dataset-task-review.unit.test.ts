import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import test from "node:test";
import {HEADLESS_CONTRACT_VERSION} from "../../../../contracts/headless";
import {ReadHeadlessDatasetTaskReviewUseCase} from "../headless-dataset-task-review.use-case";

test("dataset review proves accepted association before resolving its owner and rechecks current authority before release", async () => {
  const taskId = randomUUID(), hostIncarnationId = randomUUID();
  const context = {organizationId: "org.synthetic", principalId: "synthetic", workspaceId: "workspace.synthetic"};
  const request = {version: HEADLESS_CONTRACT_VERSION, operation: "data.dataset-task-review" as const,
    input: {hostIncarnationId, workspaceId: context.workspaceId, selection: {kind: "plan-step" as const, fingerprint: "a".repeat(64), step: 1}}};
  let permitted = true, accepted = false, ownerReads = 0;
  let afterLookup = () => {}, afterRead = () => {};
  let raw: unknown = {taskId, state: "running", review: null};
  const read = new ReadHeadlessDatasetTaskReviewUseCase(async (actual, actor, client) => {
    assert.equal(actual, request); assert.equal(actor, context); assert.equal(client, "client.synthetic");
    afterLookup(); return accepted ? taskId : undefined;
  }, async id => {ownerReads++; assert.equal(id, taskId); afterRead(); return raw;});
  const authority = {context, clientId: "client.synthetic", stillAllowed: async () => permitted};
  const denied = {ok: false, code: "headless.forbidden"};
  assert.deepEqual(await read.execute(request, authority), denied); assert.equal(ownerReads, 0);
  accepted = true;
  assert.deepEqual(await read.execute(request, authority), {ok: true, operation: request.operation, value: raw});
  afterLookup = () => {permitted = false;};
  assert.deepEqual(await read.execute(request, authority), denied); assert.equal(ownerReads, 1);
  permitted = true; afterLookup = () => {}; afterRead = () => {permitted = false;};
  assert.deepEqual(await read.execute(request, authority), denied);
  permitted = true; afterRead = () => {}; raw = {taskId: randomUUID(), state: "running", review: null};
  assert.deepEqual(await read.execute(request, authority), {ok: false, code: "headless.unavailable"});
  raw = {taskId, state: "running", review: null, rows: ["private"]};
  assert.deepEqual(await read.execute(request, authority), {ok: false, code: "headless.unavailable"});
});
