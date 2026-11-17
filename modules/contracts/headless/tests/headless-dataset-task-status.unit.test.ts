import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import test from "node:test";
import {createWorkspaceId} from "../../workspace";
import {HEADLESS_CONTRACT_VERSION, isHeadlessHostIncarnationId, parseHeadlessReadRequest,
  readHeadlessDatasetTaskStatusValue} from "..";

test("dataset task status accepts only one exact task or one bounded known plan step", () => {
  const hostIncarnationId = randomUUID(); assert.ok(isHeadlessHostIncarnationId(hostIncarnationId));
  const taskId = randomUUID(), base = {version: HEADLESS_CONTRACT_VERSION, operation: "data.dataset-task-status",
    input: {hostIncarnationId, workspaceId: createWorkspaceId("workspace.synthetic"), selection: {kind: "task", taskId}}};
  assert.ok(parseHeadlessReadRequest(base, hostIncarnationId).ok);
  for (const selection of [{kind: "plan-step", fingerprint: "a".repeat(64), step: 1},
    {kind: "plan-step", fingerprint: "b".repeat(64), step: 8}])
    assert.ok(parseHeadlessReadRequest({...base, input: {...base.input, selection}}, hostIncarnationId).ok);
  for (const selection of [{kind: "task", taskId, command: {}}, {kind: "task", taskId: "guessed-task"},
    {kind: "plan-step", fingerprint: "a".repeat(64), step: 9}, {kind: "plan-step", fingerprint: "bad", step: 1},
    {kind: "plan-step", fingerprint: "a".repeat(64), step: 1, taskId}, {kind: "task", taskId, path: "private/path"}])
    assert.equal(parseHeadlessReadRequest({...base, input: {...base.input, selection}}, hostIncarnationId).ok, false);
  assert.deepEqual(parseHeadlessReadRequest({...base, input: {...base.input, hostIncarnationId: randomUUID()}}, hostIncarnationId),
    {ok: false, code: "headless.host-changed"});
  assert.deepEqual(readHeadlessDatasetTaskStatusValue({taskId, state: "review-required"}, {kind: "task", taskId}),
    {taskId, state: "review-required"});
  for (const raw of [{taskId, state: "succeeded", data: "private"}, {taskId: randomUUID(), state: "running"},
    {taskId, state: "not-found"}, {taskId, state: "unknown"}])
    assert.equal(readHeadlessDatasetTaskStatusValue(raw, {kind: "task", taskId}), undefined);
});
