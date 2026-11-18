import assert from "node:assert/strict";
import test from "node:test";
import {readHeadlessContextTaskRequest, readHeadlessContextTaskValue} from "../headless-context-task";
import {HEADLESS_CONTRACT_VERSION as version, type HeadlessHostIncarnationId} from "../headless-protocol";
import {createWorkspaceId} from "../../workspace";
import {parseHeadlessReadRequest} from "../headless-read-request";

const host = "ca353bdd-7793-44c6-8c36-c470be8c537c" as HeadlessHostIncarnationId;
const workspaceId = createWorkspaceId("workspace.context-task"), selection = {kind: "task", taskId: host} as const;
const wire = {version, operation: "context.task", input: {hostIncarnationId: host, workspaceId, selection}};
const review = {kind: "markdown-context-pack", reportFingerprint: "a".repeat(64), sourceCount: 2, chunkCount: 5,
  sizeBytes: 500, requiresExplicitSave: true};

test("Context task queries select only one exact task or accepted plan step, never a namespace scan", () => {
  assert.deepEqual(readHeadlessContextTaskRequest(wire, host), {ok: true, request: wire});
  assert.deepEqual(parseHeadlessReadRequest(wire, host), {ok: true, request: wire});
  for (const step of [1, 8]) assert.equal(readHeadlessContextTaskRequest({...wire,
    input: {...wire.input, selection: {kind: "plan-step", fingerprint: "b".repeat(64), step}}}, host).ok, true);
  for (const input of [{...wire.input, taskId: host}, {...wire.input, all: true},
    {...wire.input, selection: {...selection, sourcePath: "private"}},
    {...wire.input, selection: {kind: "plan-step", fingerprint: "b".repeat(64), step: 9}},
    {...wire.input, selection: {kind: "task", taskId: "not-an-owned-id"}},
  ]) assert.equal(readHeadlessContextTaskRequest({...wire, input}, host).ok, false);
  assert.equal(readHeadlessContextTaskRequest({...wire, operation: "data.dataset-task-status"}, host).ok, false);
});

test("Context task results disclose finite counters and explicit result-review policy, never raw processor data", () => {
  const value = {taskId: host, state: "review-required", review};
  assert.deepEqual(readHeadlessContextTaskValue(value, selection), value);
  const rag = {...value, review: {...review, kind: "rag-database"}};
  assert.deepEqual(readHeadlessContextTaskValue(rag, selection), rag);
  for (const state of ["queued", "running", "saved", "discarded", "cancelled", "failed"])
    assert.deepEqual(readHeadlessContextTaskValue({taskId: host, state, review: null}, selection), {taskId: host, state, review: null});
  for (const changed of [{...value, path: "private/output.zip"}, {...value, preview: {items: [{text: "private source"}]}},
    {...value, taskId: "ab353bdd-7793-44c6-8c36-c470be8c537c"}, {...value, review: null},
    {...value, state: "running"}, {...value, review: {...review, modelId: "supplier/model"}},
    {...value, review: {...review, kind: "unknown-kind"}}, {...value, review: {...review, sourceCount: 0}},
    {...rag, review: {...rag.review, embedding: [0.1, 0.2]}}, {...rag, review: {...rag.review, localModelReference: "private/model"}},
    {...value, review: {...review, sourceCount: 5}}, {...value, review: {...review, chunkCount: 0}}, {...value, review: {...review, chunkCount: 1001}},
    {...value, review: {...review, sizeBytes: 64 * 1024 * 1024 + 1}},
    {...value, review: {...review, reportFingerprint: "private report"}}, {...value, review: {...review, requiresExplicitSave: false}},
  ]) assert.equal(readHeadlessContextTaskValue(changed, selection), undefined);
  let getters = 0; const accessor = {...value};
  Object.defineProperty(accessor, "review", {enumerable: true, get() {getters++; return review;}});
  assert.equal(readHeadlessContextTaskValue(accessor, selection), undefined); assert.equal(getters, 0);
});
