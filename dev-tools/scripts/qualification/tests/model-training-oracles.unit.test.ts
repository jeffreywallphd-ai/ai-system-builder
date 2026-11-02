import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter } from "node:events";
import { TrainModelUseCase } from "../../../../modules/application/use-cases/model/train-model.use-case";
import { createDesktopFeatureFailureDetail } from "../../../../modules/hosts/desktop/composition/featureLifecycle";
import { runOwnedRestartPhase } from "../visual-composer/asset-authoring-oracles";
import type { Page, TestInfo } from "@playwright/test";
import { qualifyDesktopTrainingJourney, readTrainingHostInventory } from "../visual-composer/e2e/model-training-journey";
import { captureTrainingHostFixture, trainingHostReport, trainingFailureDetails, trainingPublicId, trainingWorkspaceId, trainingDatasetIds, trainingBaseName, createTrainingRuntimeFailureCollector, withTrainingRuntimeFailureDiagnostics, TRAINING_HOST_PHASES, TRAINING_CONFIGURATION_ACTIONS, TRAINING_OUTPUT_NAME, TRAINING_DISPLAY_NAME } from "../visual-composer/model-training-oracles";
import { trainingReadOnlyArguments } from "../visual-composer/training-host-fixture";
import { readTrainingHostTaskDiagnostic, trainingTaskDiagnostic, failTrainingWithTaskDiagnostic } from "../visual-composer/model-training-oracles";

const diagnosticTaskId = "task.synthetic-diagnostic";
const diagnosticWorkspaceId = "workspace.training-host.0123456789abcdef";
async function withDiagnosticBridge(api: unknown, action: () => Promise<void>) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { configurable: true, value: { desktopApi: api } });
  try { await action(); }
  finally { if (previous) Object.defineProperty(globalThis, "window", previous); else Reflect.deleteProperty(globalThis, "window"); }
}
const taskDiagnosticInput = () => ({ workspaceId: diagnosticWorkspaceId, runId: diagnosticTaskId });
const taskDiagnosticResponse = () => ({ ok: true, value: { runId: diagnosticTaskId, status: "failed", error: { code: "training_failed", details: { stage: "model-loading", errorType: "ValueError" } } } });

test("failed-task observation reads the actual workspace-scoped status once and publishes no IDs or text", async () => {
  const response = taskDiagnosticResponse(); let reads = 0, privateReads = 0;
  Object.defineProperty(response.value.error, "message", { get() { privateReads++; throw new Error("private-synthetic-message"); } });
  Object.assign(response.value.error.details, { path: "C:\\private\\model", prompt: "private-synthetic-prompt" });
  await withDiagnosticBridge({ async readModelTrainingStatus(input: unknown) { reads++; assert.deepEqual(input, taskDiagnosticInput()); return response; } }, async () => {
    const report = trainingTaskDiagnostic(await readTrainingHostTaskDiagnostic(taskDiagnosticInput()));
    assert.deepEqual(report, { schemaVersion: "training-host-task-diagnostic-v1", status: "failed", errorCode: "training_failed", stage: "model-loading", errorType: "ValueError", parentQualificationGranted: false });
    assert(Object.isFrozen(report)); assert(Buffer.byteLength(JSON.stringify(report)) <= 1024);
    for (const value of ["private", diagnosticTaskId, diagnosticWorkspaceId, "message", "prompt", "path"]) assert(!JSON.stringify(report).includes(value));
  });
  assert.equal(reads, 1); assert.equal(privateReads, 0);
});

test("failed-task diagnostics distinguish still-running and completed tasks without granting a UI pass", async () => {
  for (const status of ["queued", "running", "succeeded", "cancelled"]) await withDiagnosticBridge({ async readModelTrainingStatus() {
    return { ok: true, value: { runId: diagnosticTaskId, status, progress: { stage: "training", message: "private-synthetic-progress" }, generatedModelCandidate: { localPath: "C:\\private\\model" } } };
  } }, async () => {
    const report = trainingTaskDiagnostic(await readTrainingHostTaskDiagnostic(taskDiagnosticInput()));
    assert.equal(report.status, status); assert.equal(report.stage, "training"); assert.equal(report.errorCode, "unavailable");
    assert.equal(report.parentQualificationGranted, false); assert(!JSON.stringify(report).includes("private")); assert.equal("passed" in report, false);
  });
});

test("invalid or foreign-shaped task inputs are refused before the status bridge", async () => {
  let calls = 0, getters = 0;
  const accessor = Object.defineProperty({ runId: diagnosticTaskId }, "workspaceId", { enumerable: true, get() { getters++; return diagnosticWorkspaceId; } });
  await withDiagnosticBridge({ async readModelTrainingStatus() { calls++; return taskDiagnosticResponse(); } }, async () => {
    for (const input of [undefined, {}, { workspaceId: "workspace.foreign", runId: diagnosticTaskId }, { ...taskDiagnosticInput(), runId: "private/invalid" }, { ...taskDiagnosticInput(), runId: "x".repeat(193) }, { ...taskDiagnosticInput(), extra: "private" }, accessor]) {
      assert.equal((await readTrainingHostTaskDiagnostic(input as never)).status, "unavailable");
    }
  });
  assert.equal(calls, 0); assert.equal(getters, 0);
});

test("stale failed and malformed bridge replies stay unavailable without inspecting private errors", async () => {
  for (const response of [undefined, { ok: false, error: { message: "private" } }, { ok: true, value: { runId: "task.foreign", status: "failed" } }, { ok: true, value: { runId: diagnosticTaskId, status: "private-status" } }]) {
    await withDiagnosticBridge({ async readModelTrainingStatus() { return response; } }, async () => assert.equal((await readTrainingHostTaskDiagnostic(taskDiagnosticInput())).status, "unavailable"));
  }
  await withDiagnosticBridge({ async readModelTrainingStatus() { throw new Error("private-bridge-error"); } }, async () => assert.equal((await readTrainingHostTaskDiagnostic(taskDiagnosticInput())).status, "unavailable"));
  await withDiagnosticBridge(undefined, async () => assert.equal((await readTrainingHostTaskDiagnostic(taskDiagnosticInput())).status, "unavailable"));
});

test("unknown or oversized runtime fields cannot escape the closed task diagnostic", async () => {
  const response = taskDiagnosticResponse(); Object.assign(response.value.error, { code: "private-code".repeat(1000) });
  Object.assign(response.value.error.details, { stage: "private-stage", errorType: "private-type", secret: "private-secret" });
  await withDiagnosticBridge({ async readModelTrainingStatus() { return response; } }, async () => {
    const report = trainingTaskDiagnostic(await readTrainingHostTaskDiagnostic(taskDiagnosticInput()));
    assert.equal(report.errorCode, "other"); assert.equal(report.stage, "unavailable"); assert.equal(report.errorType, "unavailable");
    assert(!JSON.stringify(report).includes("private")); assert(Buffer.byteLength(JSON.stringify(report)) <= 1024);
  });
});

test("a hung task diagnostic read has a fixed two-second window and retires its timer", async () => {
  const beforeSet = globalThis.setTimeout, beforeClear = globalThis.clearTimeout; let clears = 0, calls = 0;
  globalThis.setTimeout = ((callback: () => void, delay: number) => { assert.equal(delay, 2000); queueMicrotask(callback); return 77; }) as never;
  globalThis.clearTimeout = ((handle: unknown) => { assert.equal(handle, 77); clears++; }) as never;
  try { await withDiagnosticBridge({ readModelTrainingStatus() { calls++; return new Promise(() => {}); } }, async () => assert.equal((await readTrainingHostTaskDiagnostic(taskDiagnosticInput())).status, "unavailable")); }
  finally { globalThis.setTimeout = beforeSet; globalThis.clearTimeout = beforeClear; }
  assert.equal(calls, 1); assert.equal(clears, 1);
});

test("task report admission rejects proxies getters extra fields and forged success without invoking getters", () => {
  const valid = { schemaVersion: "training-host-task-diagnostic-v1", status: "failed", errorCode: "training_failed", stage: "model-loading", errorType: "ValueError", parentQualificationGranted: false };
  let reads = 0; const getter = { ...valid }; Object.defineProperty(getter, "stage", { get() { reads++; throw Error("private"); } });
  const proxy = new Proxy(valid, { getPrototypeOf() { reads++; throw Error("private"); }, ownKeys() { reads++; throw Error("private"); } });
  for (const value of [proxy, getter, { ...valid, extra: "private" }, { ...valid, parentQualificationGranted: true }, { ...valid, schemaVersion: "other" }, { ...valid, stage: "private" }, { ...valid, status: "passed" }]) {
    const report = trainingTaskDiagnostic(value); assert.equal(report.status, "unavailable"); assert.equal(report.parentQualificationGranted, false); assert(!JSON.stringify(report).includes("private"));
  }
  assert.equal(reads, 0);
});

test("every fixed worker failure stage survives the independent report admission", () => {
  for (const stage of ["purpose-mapping", "diffusion-delegate", "vision-delegate", "initializing", "base-model-resolution", "dataset-loading", "model-loading", "sequence-length", "tokenization", "adapter-configuration", "training-arguments", "training-loop", "serialization", "validation", "serialization-manifest", "run-metadata", "generated-candidate", "completion-report"]) {
    const report = trainingTaskDiagnostic({ schemaVersion: "training-host-task-diagnostic-v1", status: "failed", errorCode: "training_failed", stage, errorType: "ValueError", parentQualificationGranted: false });
    assert.equal(report.stage, stage); assert.equal(report.status, "failed");
  }
});

test("failed observation preserves the original safe UI phase and runs owned shutdown once", async () => {
  let reads = 0, publications = 0, shutdowns = 0;
  await assert.rejects(runOwnedRestartPhase(() => failTrainingWithTaskDiagnostic("private-review-pending", async () => { reads++; throw new Error("private-read"); }, async report => { publications++; assert.equal(report.status, "unavailable"); assert(!JSON.stringify(report).includes("private-read")); }), async () => { shutdowns++; }), error => {
    assert(error instanceof AggregateError); assert.equal(error.errors.length, 1);
    assert.equal(error.errors[0].message, "Training host phase did not complete: private-review-pending."); return true;
  });
  assert.equal(reads, 1); assert.equal(publications, 1); assert.equal(shutdowns, 1);
});

test("diagnostic publication failure retains the safe phase and fixed secondary failure", async () => {
  let shutdowns = 0;
  await assert.rejects(runOwnedRestartPhase(() => failTrainingWithTaskDiagnostic("private-review-pending", async () => undefined, async () => { throw new Error("private-publisher-error"); }), async () => { shutdowns++; }), error => {
    assert(error instanceof AggregateError); assert.equal(error.errors.length, 1);
    const diagnosticFailure = error.errors[0]; assert(diagnosticFailure instanceof AggregateError); assert.equal(diagnosticFailure.errors.length, 2);
    assert.equal(diagnosticFailure.errors[0].message, "Training host phase did not complete: private-review-pending.");
    assert.equal(diagnosticFailure.errors[1].message, "The training task diagnostic could not be recorded."); assert(!diagnosticFailure.message.includes("private-publisher")); return true;
  });
  assert.equal(shutdowns, 1);
});

function assertOwnedDiagnosticTimeout(error: unknown) {
  assert(error instanceof AggregateError); assert.equal(error.errors.length, 1);
  const failure = error.errors[0]; assert(failure instanceof AggregateError); assert.equal(failure.errors.length, 2);
  assert.equal(failure.errors[0].message, "Training host phase did not complete: private-review-pending.");
  assert.equal(failure.errors[1].message, "The training task diagnostic timed out.");
  return true;
}

test("a never-settling page read cannot delay owned shutdown or publish after retirement", async () => {
  const beforeSet = globalThis.setTimeout, beforeClear = globalThis.clearTimeout;
  let fire!: () => void, settleRead!: (value: unknown) => void, reads = 0, publications = 0, shutdowns = 0, clears = 0;
  globalThis.setTimeout = ((callback: () => void, delay: number) => { assert.equal(delay, 2000); fire = callback; return 88; }) as never;
  globalThis.clearTimeout = ((handle: unknown) => { assert.equal(handle, 88); clears++; }) as never;
  try {
    const operation = runOwnedRestartPhase(() => failTrainingWithTaskDiagnostic("private-review-pending", () => { reads++; return new Promise(resolve => { settleRead = resolve; }); }, async () => { publications++; }), async () => { shutdowns++; });
    const rejected = assert.rejects(operation, assertOwnedDiagnosticTimeout);
    assert.equal(reads, 1); fire(); await rejected;
    assert.equal(shutdowns, 1); assert.equal(clears, 1); assert.equal(publications, 0);
    settleRead({ schemaVersion: "training-host-task-diagnostic-v1", status: "succeeded", errorCode: "unavailable", stage: "completed", errorType: "unavailable", parentQualificationGranted: false });
    await Promise.resolve(); await Promise.resolve();
    assert.equal(publications, 0); assert.equal(shutdowns, 1); assert.equal(clears, 1);
  } finally { globalThis.setTimeout = beforeSet; globalThis.clearTimeout = beforeClear; }
});

test("a never-settling diagnostic publication cannot delay owned shutdown or revise the failed result", async () => {
  const beforeSet = globalThis.setTimeout, beforeClear = globalThis.clearTimeout;
  let fire!: () => void, settlePublication!: () => void, publications = 0, shutdowns = 0, clears = 0;
  globalThis.setTimeout = ((callback: () => void, delay: number) => { assert.equal(delay, 2000); fire = callback; return 89; }) as never;
  globalThis.clearTimeout = ((handle: unknown) => { assert.equal(handle, 89); clears++; }) as never;
  try {
    const operation = runOwnedRestartPhase(() => failTrainingWithTaskDiagnostic("private-review-pending", async () => undefined, () => { publications++; return new Promise(resolve => { settlePublication = resolve; }); }), async () => { shutdowns++; });
    const rejected = assert.rejects(operation, assertOwnedDiagnosticTimeout);
    await Promise.resolve(); await Promise.resolve(); assert.equal(publications, 1);
    fire(); await rejected; assert.equal(shutdowns, 1); assert.equal(clears, 1);
    settlePublication(); await Promise.resolve(); await Promise.resolve();
    assert.equal(publications, 1); assert.equal(shutdowns, 1); assert.equal(clears, 1);
  } finally { globalThis.setTimeout = beforeSet; globalThis.clearTimeout = beforeClear; }
});

test("the no-install delegate admits only exact declared read-only probes and pip version", () => {
  const probes = new Set(["fixed-readonly-probe"]);
  assert.equal(trainingReadOnlyArguments(["-c", "fixed-readonly-probe"], probes), true);
  assert.equal(trainingReadOnlyArguments(["-m", "pip", "--version"], probes), true);
  for (const args of [["-m", "pip", "install", "torch"], ["-m", "pip", "--version", "extra"], ["-c", "fixed-readonly-probe; dangerous()"], ["-c", "fixed-readonly-probe", "path"], ["--inspect"], []]) assert.equal(trainingReadOnlyArguments(args, probes), false);
});

const run = "2026-10-29-training-fixture-0123456789", source = `source.${"a".repeat(64)}`;
const fixture = () => ({ schemaVersion: "training-host-fixture-v1", runId: run, sourceRevision: source,
  workspaceId: trainingWorkspaceId(run), baseModelRecordId: "model.base-fixture",
  datasetArtifactIds: [...trainingDatasetIds(run)], outputName: TRAINING_OUTPUT_NAME, displayName: TRAINING_DISPLAY_NAME });
const encode = (value: unknown) => JSON.stringify(value);

const diagnosticLine = (data: Record<string, unknown> = {}) => JSON.stringify({ event: "desktop.host.model.operation.failed", data: { featureKey: "model-registry", stage: "trainModel.execute", errorName: "Error", errorCode: "MODEL_TRAINING_START_DATASET_RESOLUTION", ...data } }) + "\n";

test("training diagnostics keep fragmented UTF8 and interleaved streams separate without private fields", () => {
  const collector = createTrainingRuntimeFailureCollector(), bytes = Buffer.from(diagnosticLine({ message: "private-synthetic-prompt😀", path: "private-synthetic-path" }));
  collector.push("stdout", bytes.subarray(0, 31)); collector.push("stderr", diagnosticLine({ errorCode: "unavailable", errorName: "RuntimeCapabilityUnavailableError" }));
  for (let i = 31; i < bytes.length; i++) collector.push("stdout", bytes.subarray(i, i + 1));
  const report = collector.finish(); assert.equal(report.observations.length, 2); assert.equal(report.malformed, false); assert.equal(report.incompleteLine, false);
  assert.equal(report.observations[0].errorCode, "unavailable"); assert.equal(report.observations[1].errorCode, "MODEL_TRAINING_START_DATASET_RESOLUTION");
  assert(!JSON.stringify(report).includes("private-synthetic")); assert.equal(report.parentQualificationGranted, false);
});
test("training diagnostics allow only closed fields and codes and never pass from unknown log text", () => {
  const collector = createTrainingRuntimeFailureCollector(); collector.push("stdout", "ordinary non-JSON log\n"); collector.push("stdout", diagnosticLine({ featureKey: "private-synthetic-feature", stage: "private-synthetic-stage", errorName: "private-synthetic-error", errorCode: "private-synthetic-code", raw: { payload: "private-synthetic-payload" } }));
  const report = collector.finish(); assert.deepEqual(report.observations, [{ event: "desktop.host.model.operation.failed", featureKey: "other", stage: "other", errorName: "OtherError", errorCode: "other" }]); assert(!JSON.stringify(report).includes("private-synthetic")); assert.equal("status" in report, false);
});
test("training diagnostic collection rejects proxy and getter-like inputs without running their code", () => {
  const collector = createTrainingRuntimeFailureCollector(); let calls = 0;
  const getter = Object.defineProperty({}, "toString", { get() { calls++; throw new Error("private"); } });
  collector.push("stdout", getter); collector.push("stderr", new Proxy(Buffer.from("x"), { get() { calls++; throw new Error("private"); }, getPrototypeOf() { calls++; throw new Error("private"); } }));
  const buffer = Buffer.from("x"); Object.defineProperty(buffer, "length", { get() { calls++; throw new Error("private"); } }); collector.push("stdout", buffer);
  assert.equal(calls, 0); assert.equal(collector.finish().malformed, true); assert.equal(collector.finish().observations.length, 0);
});
test("training diagnostics bound lines, combined bytes and event history without inventing completion", () => {
  const lineBound = createTrainingRuntimeFailureCollector(); lineBound.push("stdout", "x".repeat(8192) + "\n" + diagnosticLine()); assert.equal(lineBound.finish().overflow, true); assert.equal(lineBound.finish().observations.length, 1);
  const byteBound = createTrainingRuntimeFailureCollector(); for (let i = 0; i < 5; i++) byteBound.push("stderr", Buffer.alloc(65_536, 120)); byteBound.push("stdout", diagnosticLine()); assert.equal(byteBound.finish().overflow, true); assert.equal(byteBound.finish().observations.length, 0);
  const history = createTrainingRuntimeFailureCollector(); for (let i = 0; i < 12; i++) history.push("stdout", diagnosticLine()); const report = history.finish(); assert.equal(report.observations.length, 8); assert.equal(report.overflow, true); assert.equal(report.parentQualificationGranted, false);
});
test("astral characters crossing the training diagnostic line cap cannot evade the bound", () => {
  const collector = createTrainingRuntimeFailureCollector(); collector.push("stdout", "x".repeat(4095) + "😀" + "x".repeat(8192) + "\n" + diagnosticLine());
  const report = collector.finish(); assert.equal(report.overflow, true); assert.equal(report.observations.length, 1); assert.equal(report.incompleteLine, false);
});
test("real training producer codes survive the unchanged real host redaction and reach the collector", async () => {
  const unused = Object.freeze({});
  const useCase = new TrainModelUseCase({ runtimeTaskRegistry: unused as never, modelRegistry: unused as never, storageBindings: unused as never, storage: unused as never, taskPowerLifecycle: unused as never });
  let caught: unknown;
  try { await useCase.execute({ baseModel: { modelId: "synthetic" }, datasets: [{ artifactId: "synthetic", splitRole: "train" }], method: "lora", commonParameters: {}, output: { outputModelName: "synthetic", destination: { local: { enabled: true } } } }); } catch (error) { caught = error; }
  const detail = createDesktopFeatureFailureDetail(caught); assert.equal(detail.errorCode, "MODEL_TRAINING_START_REQUEST_VALIDATION");
  const collector = createTrainingRuntimeFailureCollector(); collector.push("stdout", diagnosticLine(detail));
  assert.equal(collector.finish().observations[0].errorCode, "MODEL_TRAINING_START_REQUEST_VALIDATION"); assert.equal(collector.finish().parentQualificationGranted, false);
});
test("training diagnostics retain incomplete and malformed evidence and freeze finalization", () => {
  const collector = createTrainingRuntimeFailureCollector(); collector.push("stderr", '{"event":"desktop.host.model.operation.failed",bad}\n'); collector.push("stdout", diagnosticLine().trimEnd());
  const report = collector.finish(); assert.equal(report.malformed, true); assert.equal(report.incompleteLine, true); assert.equal(report.observations.length, 0); assert(Object.isFrozen(report)); assert(Object.isFrozen(report.observations));
  collector.push("stdout", diagnosticLine()); assert.equal(collector.finish(), report); assert.equal(report.observations.length, 0);
});
test("training failure collection observes before the real action and detaches both streams afterward", async () => {
  const stdout = new EventEmitter(), stderr = new EventEmitter(), failure = new Error("original-failure"); let report: unknown;
  await assert.rejects(withTrainingRuntimeFailureDiagnostics({ stdout, stderr }, async () => { stdout.emit("data", diagnosticLine()); throw failure; }, async value => { report = value; }), error => error === failure);
  assert.equal((report as ReturnType<ReturnType<typeof createTrainingRuntimeFailureCollector>["finish"]>).observations.length, 1); assert.equal(stdout.listenerCount("data"), 0); assert.equal(stderr.listenerCount("data"), 0);
});
test("successful training actions gain no extra diagnostic attachment or success evidence", async () => {
  const stdout = new EventEmitter(), stderr = new EventEmitter(); let publications = 0;
  await withTrainingRuntimeFailureDiagnostics({ stdout, stderr }, async () => { stderr.emit("data", diagnosticLine()); }, async () => { publications++; });
  assert.equal(publications, 0); assert.equal(stdout.listenerCount("data"), 0); assert.equal(stderr.listenerCount("data"), 0);
});
test("training diagnostic storage failure retains the original failure and always detaches listeners", async () => {
  const stdout = new EventEmitter(), stderr = new EventEmitter(), failure = new Error("original-failure"); let caught: unknown;
  try { await withTrainingRuntimeFailureDiagnostics({ stdout, stderr }, async () => { throw failure; }, async () => { throw new Error("private-storage-detail"); }); } catch (error) { caught = error; }
  assert(caught instanceof AggregateError); assert.equal(caught.errors[0], failure); assert.equal(caught.errors[1].message, "Bounded training diagnostics could not be stored."); assert.equal(stdout.listenerCount("data"), 0); assert.equal(stderr.listenerCount("data"), 0);
});
test("training diagnostic listener failure preserves the original error and still removes the other listener", async () => {
  const stdout = new EventEmitter(), stderr = new EventEmitter(), failure = new Error("original-failure"); let caught: unknown;
  const broken = { on: stdout.on.bind(stdout), off(event: "data", listener: (chunk: unknown) => void) { stdout.off(event, listener); throw new Error("private-cleanup-detail"); } };
  try { await withTrainingRuntimeFailureDiagnostics({ stdout: broken, stderr }, async () => { throw failure; }, async () => {}); } catch (error) { caught = error; }
  assert(caught instanceof AggregateError); assert.equal(caught.errors[0], failure); assert.equal(caught.errors[1].message, "Training diagnostic listener cleanup failed."); assert.equal(stdout.listenerCount("data"), 0); assert.equal(stderr.listenerCount("data"), 0);
});
for (const attachThenThrow of [false, true]) test(`training diagnostic registration failure (${attachThenThrow}) still executes owned action and shutdown exactly once`, async () => {
  const stdout = new EventEmitter(), stderr = new EventEmitter(), original = new Error("original-failure"); let journey = 0, shutdown = 0, outDetach = 0, errDetach = 0, published: unknown, caught: unknown;
  const broken = { on(event: "data", listener: (chunk: unknown) => void) { if (attachThenThrow) stdout.on(event, listener); throw new Error("private-registration-detail"); }, off(event: "data", listener: (chunk: unknown) => void) { outDetach++; return stdout.off(event, listener); } };
  const other = { on: stderr.on.bind(stderr), off(event: "data", listener: (chunk: unknown) => void) { errDetach++; return stderr.off(event, listener); } };
  try { await withTrainingRuntimeFailureDiagnostics({ stdout: broken, stderr: other }, () => runOwnedRestartPhase(async () => { journey++; throw original; }, async () => { shutdown++; }), async report => { published = report; }); } catch (error) { caught = error; }
  assert.equal(journey, 1); assert.equal(shutdown, 1); assert.equal(outDetach, 1); assert.equal(errDetach, 1); assert.equal(stdout.listenerCount("data"), 0); assert.equal(stderr.listenerCount("data"), 0);
  assert(caught instanceof AggregateError); assert(caught.errors[0] instanceof AggregateError); assert.equal(caught.errors[0].errors[0], original); assert.equal(caught.errors[1].message, "Training diagnostic listener registration failed.");
  assert.equal((published as { observerFailure: boolean }).observerFailure, true); assert(!JSON.stringify(published).includes("private-registration"));
});
test("captures only the fixed current training declaration and detaches its dataset identities", () => {
  assert.equal(captureTrainingHostFixture(undefined, undefined, undefined), undefined);
  const v = fixture(), result = captureTrainingHostFixture(encode(v), run, source)!;
  assert.deepEqual(result, v); assert(Object.isFrozen(result)); assert(Object.isFrozen(result.datasetArtifactIds));
  v.datasetArtifactIds[0] = "changed"; assert.equal(result.datasetArtifactIds[0], trainingDatasetIds(run)[0]);
});

test("generated input has an explicit versioned fixture and its report never claims model accuracy", () => {
  const v = { ...fixture(), schemaVersion: "training-host-fixture-v2", inputProfile: "generated-tiny-qwen2-v1" };
  const captured = captureTrainingHostFixture(encode(v), run, source)!;
  assert.deepEqual(captured, v); assert.equal(trainingBaseName(captured), "Generated tiny training input");
  assert.equal(trainingBaseName(captureTrainingHostFixture(encode(fixture()), run, source)!), "Qualified Qwen 0.5B input");
  for (const change of [{ inputProfile: undefined }, { inputProfile: "other" }, { schemaVersion: "training-host-fixture-v1" }, { extra: true }]) assert.throws(() => captureTrainingHostFixture(encode({ ...v, ...change }), run, source));
  const report = trainingHostReport(TRAINING_HOST_PHASES, false, "generated-tiny-qwen2-v1");
  assert.equal(report.status, "passed"); assert.equal(report.inputProfile, "generated-tiny-qwen2-v1"); assert.equal(report.parentQualificationGranted, false);
  assert.match(report.scope, /No accuracy/);
  assert.equal(trainingHostReport(TRAINING_HOST_PHASES, true, "generated-tiny-qwen2-v1").status, "failed");
});
test("rejects stale or foreign source, workspace, base and dataset declarations", () => {
  for (const change of [
    { schemaVersion: "other" }, { runId: "other-run" }, { sourceRevision: `source.${"b".repeat(64)}` },
    { workspaceId: "workspace.foreign" }, { workspaceId: "workspace.training-host.0123456789abcdef" }, { baseModelRecordId: "C:\\private\\model" },
    { datasetArtifactIds: [] }, { datasetArtifactIds: ["artifact.a", "artifact.a"] },
    { datasetArtifactIds: ["artifact.a", "../foreign"] }, { datasetArtifactIds: ["artifact.a", "artifact.b", "artifact.c"] },
    { outputName: "../private-output" }, { displayName: "private-provider-payload" }, { extra: "private" },
  ]) assert.throws(() => captureTrainingHostFixture(encode({ ...fixture(), ...change }), run, source), /unavailable or invalid/);
  for (const value of ["{", " ".repeat(4097), encode(null), encode([]), encode({})]) assert.throws(() => captureTrainingHostFixture(value, run, source));
  assert.throws(() => captureTrainingHostFixture(encode(fixture()), "invalid", source));
  assert.throws(() => captureTrainingHostFixture(encode(fixture()), run, "invalid"));
});
test("closed public identities cannot contain paths, queries or coercion hooks", () => {
  assert.equal(trainingPublicId("train-20261029120000"), "train-20261029120000");
  let calls = 0;
  for (const value of [undefined, null, 0, "", "abc", "../model", "model/token=private", "model?private", { toString() { calls++; return "model.valid"; } }]) assert.throws(() => trainingPublicId(value));
  assert.equal(calls, 0);
});
test("only a dense ordered complete phase list can pass; failure never grants parent qualification", () => {
  for (let count = 0; count < TRAINING_HOST_PHASES.length; count++) assert.equal(trainingHostReport(TRAINING_HOST_PHASES.slice(0, count), false).status, "failed");
  const full = trainingHostReport(TRAINING_HOST_PHASES, false); assert.equal(full.status, "passed"); assert.equal(full.parentQualificationGranted, false);
  assert.equal(trainingHostReport(TRAINING_HOST_PHASES, true).status, "failed");
  let reads = 0;
  const sparse = new Array(TRAINING_HOST_PHASES.length), accessor = [...TRAINING_HOST_PHASES], iterator = [...TRAINING_HOST_PHASES];
  Object.defineProperty(accessor, "0", { get() { reads++; return TRAINING_HOST_PHASES[0]; } });
  Object.defineProperty(iterator, Symbol.iterator, { value: function* () { reads++; yield "private"; } });
  const proxy = new Proxy([...TRAINING_HOST_PHASES], { get() { reads++; throw new Error("private"); } });
  for (const value of [sparse, accessor, iterator, proxy, ["private"], [...TRAINING_HOST_PHASES].reverse()]) assert.throws(() => trainingHostReport(value, false), /unavailable or invalid/);
  assert.equal(reads, 0);
});

test("unknown prerequisites cannot enter Page ports or disclose the declaration", async () => {
  let reads = 0;
  const page = { getByLabel() { reads++; throw new Error("private-page"); } } as unknown as Page;
  const info = { project: { name: "packaged-desktop" } } as TestInfo;
  for (const value of [undefined, "{", encode({ ...fixture(), extra: "private" })]) await assert.rejects(qualifyDesktopTrainingJourney(page, info, value), /prerequisites are invalid|input is unavailable or invalid/);
  assert.equal(reads, 0);
});
test("initial Page and attachment failures retain a fixed training phase without raw private errors", async () => {
  const keys = ["VISUAL_COMPOSER_QUALIFICATION_RUN_ID", "VISUAL_COMPOSER_QUALIFICATION_SOURCE_REVISION"] as const;
  const previous = keys.map(key => process.env[key]);
  try {
    process.env[keys[0]] = run; process.env[keys[1]] = source;
    const page = { getByLabel() { throw new Error("private-page-token"); } } as unknown as Page;
    const reports: ReturnType<typeof trainingHostReport>[] = [];
    const info = { project: { name: "packaged-desktop" }, attach: async (_: string, input: { body: string }) => { reports.push(JSON.parse(input.body)); } } as unknown as TestInfo;
    await assert.rejects(qualifyDesktopTrainingJourney(page, info, encode(fixture())), /^Error: Training host phase did not complete: workspace-and-inputs-visible\.$/);
    assert.equal(reports.length, 2); assert.equal(reports[0]!.status, "failed"); assert.deepEqual(reports[0]!.phases, []); assert(!encode(reports).includes("private-page"));
    assert.deepEqual(reports[1], trainingFailureDetails("workspace-and-inputs-visible", "phase", new Error("never serialized")));
    info.attach = async () => { throw null; };
    await assert.rejects(qualifyDesktopTrainingJourney(page, info, encode(fixture())), /^Error: Training host report unavailable; last phase: workspace-and-inputs-visible\.$/);
  } finally {
    keys.forEach((key, index) => { if (previous[index] === undefined) delete process.env[key]; else process.env[key] = previous[index]; });
  }
});

test("training failure details retain closed action identity without reading private errors", () => {
  let reads = 0;
  const error = new Error("private-training-value C:\\private\\model");
  for (const key of ["message", "stack"]) Object.defineProperty(error, key, { get() { reads++; throw new Error("private getter"); } });
  for (const action of TRAINING_CONFIGURATION_ACTIONS) {
    const result = trainingFailureDetails("configuration-bounded", action, error);
    assert.deepEqual(result, { schemaVersion: "training-host-failure-v1", status: "failed", phase: "configuration-bounded", action, errorType: "Error", parentQualificationGranted: false });
    assert(Object.isFrozen(result)); assert(Buffer.byteLength(encode(result)) <= 1024);
    assert(!encode(result).includes("private"));
  }
  const proxy = new Proxy({}, { get() { reads++; throw new Error("private"); }, getPrototypeOf() { reads++; throw new Error("private"); } });
  assert.equal(trainingFailureDetails("configuration-bounded", "epochs", proxy).errorType, "Unknown");
  for (const phase of TRAINING_HOST_PHASES) assert.equal(trainingFailureDetails(phase, "phase", null).status, "failed");
  assert.equal(reads, 0);
});

test("training failure details refuse foreign phase/action data without coercion", () => {
  let reads = 0;
  const privateValue = { toString() { reads++; return "epochs"; }, get value() { reads++; return "epochs"; } };
  const proxy = new Proxy({}, { get() { reads++; throw new Error("private"); }, getPrototypeOf() { reads++; throw new Error("private"); } });
  for (const phase of [undefined, null, 0, "complete", "private-phase", privateValue, proxy]) assert.throws(() => trainingFailureDetails(phase, "phase", null));
  for (const action of [undefined, null, 0, "private-action", "Epochs", privateValue, proxy]) assert.throws(() => trainingFailureDetails("configuration-bounded", action, null));
  for (const phase of TRAINING_HOST_PHASES.filter(value => value !== "configuration-bounded")) assert.throws(() => trainingFailureDetails(phase, "epochs", null));
  assert.equal(reads, 0);
});

const readInput = () => ({ workspaceId: trainingWorkspaceId(run), baseModelRecordId: "model.base-fixture", baseName: "Qualified Qwen 0.5B input", displayName: TRAINING_DISPLAY_NAME, requestId: "train-fixture-current" });
const baseRow = () => ({ workspaceId: trainingWorkspaceId(run), modelRecordId: "model.base-fixture", displayName: "Qualified Qwen 0.5B input", source: "local", lifecycleStatus: "downloaded", artifactForm: "full-model", serializationFormat: "safetensors", localPath: "C:\\private\\original-verified-model" });
const generatedRow = () => ({ ...baseRow(), modelRecordId: "model.generated-fixture", displayName: TRAINING_DISPLAY_NAME, source: "generated", lifecycleStatus: "generated", artifactForm: "adapter", generatedFromRunId: "train-fixture-current", localPath: "C:\\private\\owned-output" });
async function withInventoryPort(port: (input: unknown) => Promise<unknown>, action: () => Promise<void>) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", { configurable: true, value: { desktopApi: { listModels: port } } });
  try { await action(); } finally { if (previous) Object.defineProperty(globalThis, "window", previous); else Reflect.deleteProperty(globalThis, "window"); }
}
test("real read-only inventory projection returns only IDs and exact base/task-owned output facts", async () => {
  const input = readInput(), calls: unknown[] = [];
  for (const models of [[baseRow()], [generatedRow(), baseRow()]]) await withInventoryPort(async args => { calls.push(args); return { ok: true, value: { models } }; }, async () => {
    const result = await readTrainingHostInventory(input);
    assert.deepEqual(result, { baseModelRecordId: input.baseModelRecordId, generatedRecordIds: models.length === 2 ? ["model.generated-fixture"] : [] });
    assert(!encode(result).includes("private")); assert(!encode(result).includes("localPath"));
  });
  assert.deepEqual(calls, [{ workspaceId: input.workspaceId }, { workspaceId: input.workspaceId }]);
});

test("the real inventory projection accepts only the declared generated input label without exposing paths", async () => {
  const input = { ...readInput(), baseName: "Generated tiny training input" }, row = { ...baseRow(), displayName: "Generated tiny training input" };
  await withInventoryPort(async () => ({ ok: true, value: { models: [row] } }), async () => {
    assert.deepEqual(await readTrainingHostInventory(input), { baseModelRecordId: input.baseModelRecordId, generatedRecordIds: [] });
    await assert.rejects(readTrainingHostInventory(readInput()), /could not be confirmed/);
  });
});
test("inventory proof waits for the fresh call and a refused read cannot reuse previous visible rows", async () => {
  let release!: (value: unknown) => void, settled = false;
  const waiting = new Promise(resolve => { release = resolve; });
  await withInventoryPort(async () => waiting, async () => {
    const result = readTrainingHostInventory(readInput()).then(value => { settled = true; return value; });
    await new Promise(resolve => setImmediate(resolve)); assert.equal(settled, false);
    release({ ok: true, value: { models: [baseRow()] } }); await result; assert.equal(settled, true);
  });
  for (const reason of [new Error("private-fresh-read-error"), null, undefined]) await withInventoryPort(async () => { throw reason; }, async () => {
    await assert.rejects(readTrainingHostInventory(readInput()), /^Error: The training registry read could not be confirmed\.$/);
  });
});
test("inventory proof denies malformed, failed, stale, foreign and duplicate rows without reading accessors", async () => {
  const values: unknown[] = [null, {}, { ok: false, error: { message: "private" } }, { ok: true, value: {} },
    ...[[], [baseRow(), generatedRow(), generatedRow()], [baseRow(), baseRow()], [generatedRow()],
      [{ ...baseRow(), workspaceId: "workspace.foreign" }], [{ ...baseRow(), modelRecordId: "../private" }],
      [baseRow(), { ...generatedRow(), generatedFromRunId: "train-foreign" }], [baseRow(), { ...generatedRow(), serializationFormat: "pickle" }],
      [baseRow(), { ...generatedRow(), localPath: "" }]].map(models => ({ ok: true, value: { models } }))];
  let getters = 0; const accessor = baseRow(); Object.defineProperty(accessor, "localPath", { get() { getters++; return "private"; } });
  values.push({ ok: true, value: { models: [accessor] } });
  for (const value of values) await withInventoryPort(async () => value, async () => { await assert.rejects(readTrainingHostInventory(readInput()), /^Error: The training registry read could not be confirmed\.$/); });
  assert.equal(getters, 0);
});
