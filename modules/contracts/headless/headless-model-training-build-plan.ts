import type {HeadlessModelTrainingPlanRequest, HeadlessModelTrainingSavePlanRequest} from "./headless-model-training-plan";

/** Internal projection of an already decoded training request. This is proposal
 * data, never approval, runtime admission, input-byte proof or task authority. */
export function projectHeadlessModelTrainingBuildPlanStep({operation,
  input: {hostIncarnationId: _host, workspaceId: _workspace, ...input}}: HeadlessModelTrainingPlanRequest) {
  return {operation, input, effect: "train-local-model" as const,
    externalProviderCalls: 0 as const, modelCalls: "required" as const,
    loadsModel: true as const, writesModelRegistry: false as const,
    explicitSaveRequired: true as const, runtimeReadiness: "not-checked" as const,
    resourceAdmission: "not-checked" as const};
}

/** A separate Save proposal. No current-file, copy or commit proof is supplied. */
export function projectHeadlessModelTrainingSaveBuildPlanStep({operation,
  input: {hostIncarnationId: _host, workspaceId: _workspace, ...input}}: HeadlessModelTrainingSavePlanRequest) {
  return {operation, input, effect: "save-reviewed-trained-model" as const,
    externalProviderCalls: 0 as const, modelCalls: 0 as const,
    loadsModel: false as const, writesModelRegistry: true as const,
    storageAuthority: "bounded-local-copy" as const, runtimeReadiness: "not-checked" as const,
    exactReviewRequired: true as const};
}
