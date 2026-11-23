import assert from "node:assert/strict";
import test from "node:test";
import {createWorkspaceId} from "../../workspace";
import {HEADLESS_CONTRACT_VERSION, isHeadlessHostIncarnationId, readHeadlessModelTaskRequest,
  readHeadlessTrainingTaskRequest, readHeadlessTrainingTaskValue} from "../index";
import {parseHeadlessReadRequest, readHeadlessTrainingTaskReadRequest, readHeadlessTrainingTaskReadResult} from "../index";

const host = "11111111-1111-4111-8111-111111111111", task = "22222222-2222-4222-8222-222222222222";
assert.ok(isHeadlessHostIncarnationId(host));
const workspace = createWorkspaceId("workspace.synthetic-training");
const request = () => ({version: HEADLESS_CONTRACT_VERSION, operation: "models.training-task",
  input: {hostIncarnationId: host, workspaceId: workspace, selection: {kind: "task" as const, taskId: task}}});
const value = () => ({workspaceId: workspace, taskId: task, plan: {fingerprint: "a".repeat(64), step: 1}, state: "running", percent: 50,
  progress: {epoch: 1, totalEpochs: 2, batch: 2, totalBatches: 4}, resultReview: "not-ready", registration: "requires-separate-approval",
  runtimeReadiness: "not-checked", outputQuality: "not-evaluated"});

test("training controls accept closed exact task and plan selectors without widening download controls", () => {
  const source = request(); const parsed = readHeadlessTrainingTaskRequest(source, host); assert.equal(parsed.ok, true);
  source.input.selection.taskId = host; assert.equal(parsed.ok && parsed.request.input.selection.kind === "task" && parsed.request.input.selection.taskId, task);
  assert.equal(readHeadlessModelTaskRequest(request(), host).ok, false);
  assert.equal(readHeadlessTrainingTaskRequest({...request(), operation: "models.task"}, host).ok, false);
  assert.equal(readHeadlessTrainingTaskRequest({...request(), operation: "models.cancel-training"}, host).ok, true);
  assert.equal(readHeadlessTrainingTaskRequest({...request(), input: {...request().input,
    selection: {kind: "plan-step", fingerprint: "a".repeat(64), step: 1}}}, host).ok, true);
});
test("training query denies foreign hosts, incomplete or extended input and executable getters", () => {
  assert.deepEqual(readHeadlessTrainingTaskRequest({...request(), input: {...request().input, hostIncarnationId: task}}, host), {ok: false, code: "headless.host-changed"});
  for (const input of [{...request(), extra: true}, {...request(), input: {...request().input, principalId: "foreign"}},
    {...request(), input: {...request().input, selection: {kind: "task", taskId: task, path: "PRIVATE"}}}, {...request(), version: "wrong"}])
    assert.equal(readHeadlessTrainingTaskRequest(input, host).ok, false);
  let reads = 0; const input = request(); Object.defineProperty(input, "operation", {enumerable: true, get() {reads++; throw Error("PRIVATE");}});
  assert.equal(readHeadlessTrainingTaskRequest(input, host).ok, false); assert.equal(reads, 0);
});
test("training summary permits finite workflow facts and never a quality, readiness, Save or raw-data claim", () => {
  assert.ok(readHeadlessTrainingTaskValue(value()));
  for (const change of [{percent: NaN}, {percent: 101}, {outputQuality: "passed"}, {runtimeReadiness: "ready"}, {registration: "saved"},
    {metrics: {loss: 0.1}}, {localPath: "PRIVATE"}, {logs: ["PRIVATE"]}, {resultReview: "pending"},
    {percent: 25}, {progress: {epoch: 3, totalEpochs: 2, batch: 2, totalBatches: 4}},
    {progress: {epoch: true, totalEpochs: 2, batch: 1, totalBatches: 2}}])
    assert.equal(readHeadlessTrainingTaskValue({...value(), ...change}), undefined);
  assert.ok(readHeadlessTrainingTaskValue({...value(), state: "succeeded", resultReview: "pending"}));
});
test("cancellation summary distinguishes a request from actual terminal task state", () => {
  assert.ok(readHeadlessTrainingTaskValue({...value(), cancellation: "requested-unconfirmed"}, true));
  assert.equal(readHeadlessTrainingTaskValue({...value(), cancellation: "not-needed"}, true), undefined);
  assert.ok(readHeadlessTrainingTaskValue({...value(), state: "cancelled", cancellation: "not-needed"}, true));
  assert.equal(readHeadlessTrainingTaskValue({...value(), cancellation: "stopped"}, true), undefined);
});

test("training progress broker admits only the read specialization, with detached exact selection", () => {
  const source = request();
  const parsed = readHeadlessTrainingTaskReadRequest(source, host);
  assert.ok(parsed.ok);
  source.input.selection.taskId = host;
  assert.equal(parsed.request.input.selection.kind === "task" && parsed.request.input.selection.taskId, task);
  assert.ok(parseHeadlessReadRequest(request(), host).ok);
  assert.equal(readHeadlessTrainingTaskReadRequest({...request(), operation: "models.cancel-training"}, host).ok, false);
  assert.equal(parseHeadlessReadRequest({...request(), operation: "models.cancel-training"}, host).ok, false);
});

test("training progress broker correlates task or plan and workspace independently", () => {
  const reply = {ok: true, operation: "models.training-task", value: value()};
  const expected = request().input;
  assert.deepEqual(readHeadlessTrainingTaskReadResult(reply, expected), reply);
  const byPlan = {...expected, selection: {kind: "plan-step" as const, ...value().plan}};
  assert.deepEqual(readHeadlessTrainingTaskReadResult(reply, byPlan), reply);
  for (const target of [{...expected, workspaceId: createWorkspaceId("workspace.foreign")},
    {...expected, selection: {kind: "task" as const, taskId: host}},
    {...byPlan, selection: {...byPlan.selection, step: 2}},
    {...byPlan, selection: {...byPlan.selection, fingerprint: "b".repeat(64)}}])
    assert.deepEqual(readHeadlessTrainingTaskReadResult(reply, target), {ok: false, code: "headless.unavailable"});
});

test("training progress broker copies a closed summary and rejects private, active or mismatched replies", () => {
  const reply = {ok: true, operation: "models.training-task", value: value()};
  const copied = readHeadlessTrainingTaskReadResult(reply, request().input);
  reply.value.progress.batch = 3;
  assert.ok(copied.ok); assert.equal(copied.value.progress.batch, 2);
  for (const raw of [{...reply, operation: "models.task"}, {...reply, extra: true},
    {...reply, value: {...value(), logs: ["PRIVATE"]}}, {...reply, value: {...value(), metrics: {loss: 0.1}}},
    {...reply, value: {...value(), localPath: "PRIVATE"}}, {...reply, value: {...value(), percent: 25}},
    {...reply, value: {...value(), outputQuality: "passed"}}, {ok: false, code: "PRIVATE"},
    {ok: false, code: "headless.forbidden", detail: "PRIVATE"}])
    assert.deepEqual(readHeadlessTrainingTaskReadResult(raw, request().input), {ok: false, code: "headless.unavailable"});
  let getters = 0;
  const active = Object.defineProperty({}, "ok", {enumerable: true, get() {getters++; throw Error("PRIVATE");}});
  assert.deepEqual(readHeadlessTrainingTaskReadResult(active, request().input), {ok: false, code: "headless.unavailable"});
  assert.equal(getters, 0);
  for (const code of ["headless.forbidden", "headless.unavailable", "headless.unsupported-operation"])
    assert.deepEqual(readHeadlessTrainingTaskReadResult({ok: false, code}, request().input), {ok: false, code});
});
