import assert from "node:assert/strict";
import test from "node:test";
import {completeTrainingCleanup, observeTrainingResult, requireTrainingCandidate, trainingObservation, type TrainingObservationStage} from "./bounded-training-observation";
import {boundedTrainingTempParent, BOUNDED_TRAINING_TEMP_PREFIX, BOUNDED_TRAINING_CPU_ENVIRONMENT} from "./bounded-training-feature-profile";
import type {ModelTrainingResult} from "../../../../modules/contracts/model/model-training";
import type {ApprovedLocalTrainingCandidateReview} from "../../../../modules/application/ports/model/approved-local-model-training.port";

const result = {runId: "task-id", status: "succeeded", reviewPending: true,
  generatedModelCandidate: {generatedFromRunId: "pipeline-id"}} as ModelTrainingResult;
test("CPU qualification is explicit, immutable and overrides ambient accelerator settings without mutating them", () => {
  const before = {...process.env};
  const ambient = {ACCELERATE_USE_CPU: "false", CUDA_VISIBLE_DEVICES: "0", HIP_VISIBLE_DEVICES: "0", OMP_NUM_THREADS: "8"};
  const child = {...ambient, ...BOUNDED_TRAINING_CPU_ENVIRONMENT};
  assert.deepEqual(child, {ACCELERATE_USE_CPU: "true", CUDA_VISIBLE_DEVICES: "-1", HIP_VISIBLE_DEVICES: "-1",
    OMP_NUM_THREADS: "1", MKL_NUM_THREADS: "1"});
  assert.ok(Object.isFrozen(BOUNDED_TRAINING_CPU_ENVIRONMENT));
  assert.equal(ambient.ACCELERATE_USE_CPU, "false");
  assert.deepEqual({...process.env}, before);
});
test("qualification cache uses only a short canonical local Windows temp parent", () => {
  assert.equal(boundedTrainingTempParent("C:\\Users\\example\\AppData\\Local"), "C:\\Users\\example\\AppData\\Local\\Temp");
  const boundary = "C:\\" + "a".repeat(42);
  assert.equal(boundedTrainingTempParent(boundary).length + 1 + BOUNDED_TRAINING_TEMP_PREFIX.length + 6, 60);
  for (const value of [undefined, null, {}, "", "relative", "C:relative", "C:\\bad:stream", "C:/Users/example", "\\\\server\\share",
    "\\\\?\\C:\\Users", "C:\\one\\..\\two", "C:\\bad\u0000", boundary + "a"]) {
    assert.throws(() => boundedTrainingTempParent(value), /short local Windows temporary folder/);
  }
});
function candidate() {
  return {kind: "ready", requestId: "task-id", history: {requestId: "task-id"},
    execution: {runId: "pipeline-id", durationMs: 1, hardware: {devices: ["cpu"]}},
    retainedFiles: {files: [{role: "checkpoint"}, {role: "candidate"}]}} as unknown as Extract<ApprovedLocalTrainingCandidateReview, {kind: "ready"}>;
}
test("redacted fast success uses verified checkpoint inventory and distinct pipeline lineage", () => {
  const facts = trainingObservation(), stages: TrainingObservationStage[] = [];
  observeTrainingResult(facts, result);
  assert.equal(result.checkpoints, undefined); assert.equal(facts.progressObservations, 0);
  requireTrainingCandidate(result, candidate(), "task-id", facts, stage => stages.push(stage));
  assert.equal(facts.checkpoints, 1); assert.equal(facts.outputFiles, 2);
  assert.deepEqual(stages, ["candidate-readiness", "candidate-request", "candidate-history", "checkpoint-inventory",
    "candidate-execution", "candidate-pipeline", "candidate-duration", "candidate-device"]);
  for (const key of ["candidateReady", "candidateRequestMatches", "candidateHistoryMatches", "executionRecorded",
    "executionPipelineMatches", "executionDurationValid", "executionCpuRecorded"] as const) assert.equal(facts[key], true);
  assert.equal(facts.newRootRemoved, false); assert.equal(facts.applicationCleanupConfirmed, false);
});
test("pending/stale or wrong original candidate cannot qualify", () => {
  for (const value of [{kind: "not-ready"}, {...candidate(), requestId: "other"},
    {...candidate(), history: {requestId: "other"}}, {...candidate(), execution: undefined},
    {...candidate(), execution: {...candidate().execution, runId: "task-id"}}]) {
    assert.throws(() => requireTrainingCandidate(result, value as ApprovedLocalTrainingCandidateReview, "task-id", trainingObservation(), () => {}));
  }
});
test("foreign candidate identity fails before recording any private file count", () => {
  const facts = trainingObservation(), stages: TrainingObservationStage[] = [];
  assert.throws(() => requireTrainingCandidate(result, {...candidate(), requestId: "foreign"}, "task-id", facts, value => stages.push(value)));
  assert.deepEqual(stages, ["candidate-readiness", "candidate-request"]);
  assert.equal(facts.candidateRequestMatches, false); assert.equal(facts.outputFiles, 0); assert.equal(facts.checkpoints, 0);
  assert.equal(facts.executionRecorded, null);
});
test("verified file counts survive a missing execution report without claiming a pass", () => {
  const facts = trainingObservation(), stages: TrainingObservationStage[] = [];
  assert.throws(() => requireTrainingCandidate(result, {...candidate(), execution: undefined}, "task-id", facts, value => stages.push(value)));
  assert.equal(stages[stages.length - 1], "candidate-execution"); assert.equal(facts.executionRecorded, false);
  assert.equal(facts.outputFiles, 2); assert.equal(facts.checkpoints, 1); assert.equal(facts.executionPipelineMatches, null);
});
test("pipeline, duration and device refusals have distinct finite facts", () => {
  for (const [patch, finalStage, field] of [
    [{runId: "other"}, "candidate-pipeline", "executionPipelineMatches"],
    [{durationMs: -1}, "candidate-duration", "executionDurationValid"],
    [{hardware: {...candidate().execution!.hardware, devices: ["cuda"]}}, "candidate-device", "executionCpuRecorded"],
  ] as const) {
    const facts = trainingObservation(), stages: TrainingObservationStage[] = [];
    assert.throws(() => requireTrainingCandidate(result, {...candidate(), execution: {...candidate().execution!, ...patch}} as ApprovedLocalTrainingCandidateReview,
      "task-id", facts, value => stages.push(value)));
    assert.equal(stages[stages.length - 1], finalStage); assert.equal(facts[field], false); assert.equal(facts.outputFiles, 2);
  }
});
test("unverified result checkpoint claims cannot replace current checkpoint or candidate files", () => {
  for (const files of [[], [{role: "candidate"}], [{role: "checkpoint"}], Array(33).fill({role: "checkpoint"})]) {
    assert.throws(() => requireTrainingCandidate({...result, checkpoints: [{step: 1}] as ModelTrainingResult["checkpoints"]},
      {...candidate(), retainedFiles: {...candidate().retainedFiles, files}} as ApprovedLocalTrainingCandidateReview, "task-id", trainingObservation(), () => {}));
  }
});
test("diagnostics count progress without copying text or arbitrary error details", () => {
  const facts = trainingObservation();
  observeTrainingResult(facts, {...result, status: "running", progress: {stage: "synthetic private text"}});
  observeTrainingResult(facts, {...result, status: "failed", error: {code: "private_training_failed", message: "synthetic private text"}});
  assert.equal(facts.progressObservations, 1); assert.equal(facts.terminalStatus, "failed");
  assert.equal(facts.runtimeErrorCode, "private_training_failed");
  observeTrainingResult(facts, {...result, error: {code: "private_training_failed", message: "synthetic private text",
    details: {stage: "model-loading", errorType: "ImportError", raw: "synthetic private text"}}});
  assert.equal(facts.runtimeFailureStage, "model-loading"); assert.equal(facts.runtimeFailureType, "ImportError");
  observeTrainingResult(facts, {...result, error: {code: "synthetic private text", message: "synthetic private text"}});
  assert.equal(facts.runtimeErrorCode, "unclassified"); assert.ok(!JSON.stringify(facts).includes("synthetic private text"));
  assert.equal(facts.runtimeFailureStage, "unclassified"); assert.equal(facts.runtimeFailureType, "OtherError");
});
test("cleanup facts become true after original actions, and failures preserve unknown removal", async () => {
  for (const failure of ["none", "application", "root"]) {
    const facts = trainingObservation(), order: string[] = [];
    const action = completeTrainingCleanup(facts, async () => {
      assert.equal(facts.applicationCleanupConfirmed, false); order.push("application");
      if (failure === "application") throw Error("controlled cleanup denial");
    }, async () => {
      assert.equal(facts.applicationCleanupConfirmed, true); assert.equal(facts.newRootRemoved, false); order.push("root");
      if (failure === "root") throw Error("controlled removal denial");
    });
    if (failure === "none") await action; else await assert.rejects(action);
    assert.equal(facts.applicationCleanupConfirmed, failure !== "application");
    assert.equal(facts.newRootRemoved, failure === "none");
    assert.deepEqual(order, failure === "application" ? ["application"] : ["application", "root"]);
  }
});
