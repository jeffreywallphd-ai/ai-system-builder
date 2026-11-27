import assert from "node:assert/strict";
import type {ModelTrainingResult} from "../../../../modules/contracts/model/model-training";
import type {ApprovedLocalTrainingCandidateReview} from "../../../../modules/application/ports/model/approved-local-model-training.port";
import {PRIVATE_TRAINING_FAILURE_STAGES, PRIVATE_TRAINING_FAILURE_TYPES} from "../../../../modules/application/use-cases/model/train-model.use-case";

export type TrainingObservationStage = "configured" | "approved-start" | "training" | "terminal-status" |
  "current-candidate" | "candidate-readiness" | "candidate-request" | "candidate-history" | "checkpoint-inventory" |
  "candidate-execution" | "candidate-pipeline" | "candidate-duration" | "candidate-device" | "approval-replay" | "input-integrity" | "complete";
export function trainingObservation() {
  return {terminalStatus: "not-observed", runtimeErrorCode: null as string | null,
    runtimeFailureStage: null as string | null, runtimeFailureType: null as string | null,
    candidateReady: null as boolean | null, candidateRequestMatches: null as boolean | null,
    candidateHistoryMatches: null as boolean | null, executionRecorded: null as boolean | null,
    executionPipelineMatches: null as boolean | null, executionDurationValid: null as boolean | null,
    executionCpuRecorded: null as boolean | null,
    observations: 0, progressObservations: 0, checkpoints: 0, outputFiles: 0,
    applicationCleanupConfirmed: false, newRootRemoved: false};
}
export type TrainingObservation = ReturnType<typeof trainingObservation>;
export async function completeTrainingCleanup(facts: TrainingObservation, applicationCleanup: (() => Promise<void>) | undefined,
  removeOriginalRoot: () => Promise<void>) {
  if (applicationCleanup) {await applicationCleanup(); facts.applicationCleanupConfirmed = true;}
  await removeOriginalRoot(); facts.newRootRemoved = true;
}
export function observeTrainingResult(facts: TrainingObservation, result: ModelTrainingResult) {
  // Never copy raw errors, messages, paths, metadata or progress text.
  facts.terminalStatus = ["queued", "running", "succeeded", "failed", "cancelled"].includes(result.status) ? result.status : "unclassified";
  facts.runtimeErrorCode = result.error ? result.error.code === "private_training_failed" ? "private_training_failed" : "unclassified" : null;
  const details = result.error?.details;
  facts.runtimeFailureStage = !result.error ? null : PRIVATE_TRAINING_FAILURE_STAGES.some(stage => stage === details?.stage) ? details!.stage as string : "unclassified";
  facts.runtimeFailureType = !result.error ? null : PRIVATE_TRAINING_FAILURE_TYPES.some(type => type === details?.errorType) ? details!.errorType as string : "OtherError";
  facts.observations++;
  if (result.progress && (typeof result.progress.stage === "string" && result.progress.stage.length > 0 ||
    typeof result.progress.batch === "number" || typeof result.progress.epoch === "number")) facts.progressObservations++;
  assert.ok(facts.observations <= 10000);
}
export function requireTrainingCandidate(result: ModelTrainingResult, candidate: ApprovedLocalTrainingCandidateReview,
  requestId: string, facts: TrainingObservation, stage: (value: TrainingObservationStage) => void) {
  stage("candidate-readiness"); facts.candidateReady = candidate.kind === "ready";
  assert.equal(candidate.kind, "ready");
  if (candidate.kind !== "ready") throw Error("Current candidate unavailable.");
  stage("candidate-request"); facts.candidateRequestMatches = candidate.requestId === requestId;
  assert.equal(facts.candidateRequestMatches, true);
  stage("candidate-history"); facts.candidateHistoryMatches = candidate.history.requestId === requestId;
  assert.equal(facts.candidateHistoryMatches, true);
  stage("checkpoint-inventory");
  facts.outputFiles = candidate.retainedFiles.files.length;
  assert.ok(facts.outputFiles <= 256, "Current candidate inventory exceeds the private contract bound.");
  facts.checkpoints = candidate.retainedFiles.files.filter(row => row.role === "checkpoint").length;
  assert.ok(facts.outputFiles > 0 && facts.outputFiles <= 32);
  assert.ok(facts.checkpoints > 0, "The current verified inventory has no checkpoint.");
  assert.ok(candidate.retainedFiles.files.some(row => row.role === "candidate"));
  stage("candidate-execution"); facts.executionRecorded = candidate.execution !== undefined;
  assert.ok(candidate.execution);
  stage("candidate-pipeline");
  facts.executionPipelineMatches = typeof candidate.execution.runId === "string" && candidate.execution.runId.length > 0 &&
    candidate.execution.runId === result.generatedModelCandidate?.generatedFromRunId;
  assert.equal(facts.executionPipelineMatches, true);
  stage("candidate-duration"); facts.executionDurationValid = Number.isFinite(candidate.execution.durationMs) && candidate.execution.durationMs >= 0;
  assert.equal(facts.executionDurationValid, true);
  stage("candidate-device"); facts.executionCpuRecorded = candidate.execution.hardware.devices.includes("cpu");
  assert.equal(facts.executionCpuRecorded, true);
  return candidate;
}
