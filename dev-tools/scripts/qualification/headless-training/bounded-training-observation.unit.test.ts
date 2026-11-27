import assert from "node:assert/strict";
import test from "node:test";
import {completeTrainingCleanup, observeTrainingResult, requireTrainingCandidate, trainingObservation, type TrainingObservationStage} from "./bounded-training-observation";
import type {ModelTrainingResult} from "../../../../modules/contracts/model/model-training";
import type {ApprovedLocalTrainingCandidateReview} from "../../../../modules/application/ports/model/approved-local-model-training.port";

const result = {runId: "task-id", status: "succeeded", reviewPending: true,
  generatedModelCandidate: {generatedFromRunId: "pipeline-id"}} as ModelTrainingResult;
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
  assert.deepEqual(stages, ["candidate-lineage", "checkpoint-inventory"]);
  assert.equal(facts.newRootRemoved, false); assert.equal(facts.applicationCleanupConfirmed, false);
});
test("pending/stale or wrong original candidate cannot qualify", () => {
  for (const value of [{kind: "not-ready"}, {...candidate(), requestId: "other"},
    {...candidate(), history: {requestId: "other"}}, {...candidate(), execution: undefined},
    {...candidate(), execution: {...candidate().execution, runId: "task-id"}}]) {
    assert.throws(() => requireTrainingCandidate(result, value as ApprovedLocalTrainingCandidateReview, "task-id", trainingObservation(), () => {}));
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
  observeTrainingResult(facts, {...result, error: {code: "synthetic private text", message: "synthetic private text"}});
  assert.equal(facts.runtimeErrorCode, "unclassified"); assert.ok(!JSON.stringify(facts).includes("synthetic private text"));
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
