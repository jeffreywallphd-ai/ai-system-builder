import type {HeadlessModelTrainingPlanRequest} from "./headless-model-training-plan";

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
