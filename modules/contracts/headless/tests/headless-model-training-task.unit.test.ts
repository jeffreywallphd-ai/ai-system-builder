import assert from "node:assert/strict";
import test from "node:test";
import {createWorkspaceId} from "../../workspace";
import {HEADLESS_CONTRACT_VERSION, isHeadlessHostIncarnationId, readHeadlessModelTaskRequest,
  readHeadlessTrainingTaskRequest, readHeadlessTrainingTaskValue} from "../index";
import {parseHeadlessReadRequest, readHeadlessTrainingTaskReadRequest, readHeadlessTrainingTaskReadResult, readHeadlessTrainingCompletionRequest,
  readHeadlessTrainingCompletionResult, readHeadlessTrainingCompletionValue} from "../index";

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

const completionRequest = () => ({...request(), operation: "models.review-training" as const});
const completionValue = () => ({workspaceId: workspace, taskId: task, plan: {fingerprint: "a".repeat(64), step: 1},
  provenance: {modelRecordId: "model.synthetic", modelUpdatedAt: "2026-11-21T00:00:00.000Z", datasetId: "dataset.synthetic",
    versionId: "version.synthetic", versionDigest: "sha256:" + "a".repeat(64), recipeDigest: "sha256:" + "b".repeat(64),
    proposalDigest: "sha256:" + "c".repeat(64), trainingTask: "llm-instruction", method: "lora", trainingInputCount: 1,
    validationInputCount: 1, inputBytes: 128, recipeBytes: 64},
  candidate: {requestedName: "Small trial", artifactForm: "adapter", serializationFormat: "adapter-safetensors", recordedSizeBytes: 256},
  comparison: {state: "not-recorded"}, verification: {inputs: "recorded-not-rechecked", retainedFiles: "not-checked",
    runtimeReadiness: "not-checked", hardware: "not-recorded", outputQuality: "not-evaluated"}, registration: "requires-separate-approval"});

const currentRequest = () => ({...completionRequest(), input: {...completionRequest().input, mode: "current-files" as const}});
const currentValue = () => ({...completionValue(), currentCandidate: {verification: "sha256-current-local-v1",
  candidateDigest: "sha256:" + "d".repeat(64), manifestDigest: "sha256:" + "e".repeat(64),
  fileCount: 3, candidateFileCount: 3, totalBytes: 9, execution: {state: "not-recorded"}}});

test("current training review is explicit, detached and cannot downgrade to cached history", () => {
  const raw = currentRequest(), parsed = readHeadlessTrainingCompletionRequest(raw, host); assert.ok(parsed.ok);
  assert.equal(parsed.request.input.mode, "current-files");
  raw.input.selection.taskId = host;
  assert.equal(parsed.request.input.selection.kind === "task" && parsed.request.input.selection.taskId, task);
  assert.ok(Object.isFrozen(parsed.request.input));
  assert.equal(parseHeadlessReadRequest(currentRequest(), host).ok, true);
  assert.equal(readHeadlessTrainingTaskReadRequest({...currentRequest(), operation: "models.training-task"}, host).ok, false);
  const reply = {ok: true, operation: "models.review-training", value: currentValue()};
  assert.deepEqual(readHeadlessTrainingCompletionResult(reply, currentRequest().input), reply);
  assert.equal(readHeadlessTrainingCompletionResult(reply, completionRequest().input).ok, false);
  assert.equal(readHeadlessTrainingCompletionResult({...reply, value: completionValue()}, currentRequest().input).ok, false);
  const detached = readHeadlessTrainingCompletionResult(reply, currentRequest().input); assert.ok(detached.ok);
  reply.value.currentCandidate.fileCount = 200;
  assert.equal(detached.value.currentCandidate?.fileCount, 3);
  assert.equal(readHeadlessTrainingCompletionRequest({...currentRequest(), input: {...currentRequest().input, mode: "cached"}}, host).ok, false);
});

for (const variant of ["digest", "file-count", "candidate-count", "bytes", "locator", "verification", "execution", "quality"] as const) {
  test(`current training review rejects ${variant} claims and private fields`, () => {
    const value: any = currentValue(), current = value.currentCandidate;
    if (variant === "digest") current.manifestDigest = "not-a-digest";
    if (variant === "file-count") current.fileCount = 257;
    if (variant === "candidate-count") current.candidateFileCount = 4;
    if (variant === "bytes") current.totalBytes = 2;
    if (variant === "locator") current.files = [{key: "private-locator"}];
    if (variant === "verification") current.verification = "trusted";
    if (variant === "execution") current.execution = {state: "recorded", report: {runId: "missing-rest"}};
    if (variant === "quality") current.outputQuality = "passed";
    assert.equal(readHeadlessTrainingCompletionResult({ok: true, operation: "models.review-training", value}, currentRequest().input).ok, false);
  });
}

test("cached training completion codecs preserve copied history and keep active controls separate", () => {
  const source = completionRequest(), parsed = readHeadlessTrainingCompletionRequest(source, host); assert.ok(parsed.ok);
  source.input.selection.taskId = host;
  assert.equal(parsed.request.input.selection.kind === "task" && parsed.request.input.selection.taskId, task);
  assert.ok(Object.isFrozen(parsed.request) && Object.isFrozen(parsed.request.input) && Object.isFrozen(parsed.request.input.selection));
  assert.equal(parseHeadlessReadRequest(completionRequest(), host).ok, true, "Configured hosts separately advertise this additive read.");
  assert.equal(readHeadlessTrainingTaskReadRequest(completionRequest(), host).ok, false);
  const reply = {ok: true, operation: "models.review-training", value: completionValue()};
  assert.deepEqual(readHeadlessTrainingCompletionResult(reply, completionRequest().input), reply);
  const copied = readHeadlessTrainingCompletionResult(reply, completionRequest().input); assert.ok(copied.ok);
  reply.value.provenance.trainingInputCount = 2; reply.value.candidate.requestedName = "Changed later";
  assert.equal(copied.value.provenance.trainingInputCount, 1); assert.equal(copied.value.candidate.requestedName, "Small trial");
  const byPlan = {...completionRequest().input, selection: {kind: "plan-step" as const, ...completionValue().plan}};
  assert.deepEqual(readHeadlessTrainingCompletionResult(reply, byPlan), reply);
  for (const input of [{...byPlan, selection: {...byPlan.selection, step: 2}},
    {...byPlan, selection: {...byPlan.selection, fingerprint: "d".repeat(64)}},
    {...completionRequest().input, workspaceId: createWorkspaceId("workspace.foreign")},
    {...completionRequest().input, selection: {kind: "task" as const, taskId: host}}])
    assert.deepEqual(readHeadlessTrainingCompletionResult(reply, input), {ok: false, code: "headless.unavailable"});
});
test("cached completion request refuses changed hosts, extras and active values without executing getters", () => {
  assert.deepEqual(readHeadlessTrainingCompletionRequest({...completionRequest(), input: {...completionRequest().input, hostIncarnationId: task}}, host),
    {ok: false, code: "headless.host-changed"});
  for (const raw of [{...completionRequest(), extra: true}, {...completionRequest(), version: "wrong"}, request(),
    {...completionRequest(), input: {...completionRequest().input, path: "PRIVATE"}},
    {...completionRequest(), input: {...completionRequest().input, selection: {kind: "task", taskId: task, approve: true}}}])
    assert.equal(readHeadlessTrainingCompletionRequest(raw, host).ok, false);
  let reads = 0;
  const source = Object.defineProperty(completionRequest(), "input", {enumerable: true, get() {reads++; throw Error("PRIVATE");}});
  assert.equal(readHeadlessTrainingCompletionRequest(source, host).ok, false); assert.equal(reads, 0);
});
test("cached comparison accepts only an existing bounded measurement, never a quality or readiness pass", () => {
  const report = {protocol: "fixed-first-32-validation-loss-v1", maximumRows: 32, sampleCount: 2,
    baselineLoss: 2, trainedLoss: 1.5, lossDelta: -0.5, interpretation: "measurement-only"};
  const value = {...completionValue(), comparison: {state: "recorded", report}};
  assert.ok(readHeadlessTrainingCompletionValue(value));
  for (const change of [{sampleCount: 0}, {sampleCount: 33}, {sampleCount: 1.5}, {baselineLoss: Infinity}, {trainedLoss: -1},
    {lossDelta: 0}, {interpretation: "passed"}, {protocol: "arbitrary"}, {maximumRows: 64}, {accuracy: 1}])
    assert.equal(readHeadlessTrainingCompletionValue({...value, comparison: {state: "recorded", report: {...report, ...change}}}), undefined);
  for (const change of [{runtimeReadiness: "ready"}, {hardware: "qualified"}, {outputQuality: "passed"},
    {retainedFiles: "verified"}, {inputs: "verified"}])
    assert.equal(readHeadlessTrainingCompletionValue({...value, verification: {...value.verification, ...change}}), undefined);
});
test("cached completion rejects malformed, private, huge or credential-bearing metadata and detached failure details", () => {
  const value = completionValue(), reply = {ok: true, operation: "models.review-training", value};
  for (const change of [{registration: "saved"}, {logs: ["PRIVATE"]}, {localPath: "PRIVATE"},
    {provenance: {...value.provenance, trainingInputCount: 17}}, {provenance: {...value.provenance, method: "arbitrary"}},
    {provenance: {...value.provenance, inputBytes: 256 * 1024 ** 2}}, {provenance: {...value.provenance, recipeBytes: 0}},
    {provenance: {...value.provenance, versionDigest: "wrong"}}, {provenance: {...value.provenance, proposalDigest: "wrong"}},
    {provenance: {...value.provenance, modelUpdatedAt: "yesterday"}},
    {candidate: {...value.candidate, requestedName: "hf_" + "A".repeat(24)}},
    {candidate: {...value.candidate, requestedName: "C:\\private\\candidate"}},
    {candidate: {...value.candidate, requestedName: "x".repeat(201)}},
    {candidate: {...value.candidate, recordedSizeBytes: NaN}}, {comparison: {state: "not-recorded", report: {}}}])
    assert.deepEqual(readHeadlessTrainingCompletionResult({...reply, value: {...value, ...change}}, completionRequest().input),
      {ok: false, code: "headless.unavailable"});
  for (const raw of [{...reply, operation: "models.training-task"}, {...reply, extra: true},
    {ok: false, code: "PRIVATE"}, {ok: false, code: "headless.forbidden", detail: "PRIVATE"}, {ok: true, operation: "models.review-training", value: {kind: "not-ready"}}])
    assert.deepEqual(readHeadlessTrainingCompletionResult(raw, completionRequest().input), {ok: false, code: "headless.unavailable"});
  for (const code of ["headless.source-not-ready", "headless.forbidden", "headless.unavailable"])
    assert.deepEqual(readHeadlessTrainingCompletionResult({ok: false, code}, completionRequest().input), {ok: false, code});
  let reads = 0; const active = Object.defineProperty({...value.candidate}, "requestedName", {enumerable: true, get() {reads++; throw Error("PRIVATE");}});
  assert.equal(readHeadlessTrainingCompletionValue({...value, candidate: active}), undefined); assert.equal(reads, 0);
});
