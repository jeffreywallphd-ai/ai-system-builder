export const MODEL_TRAINING_STARTED_EVENT = "model-training-started";

export interface ModelTrainingStartedEventDetail {
  readonly runId: string;
  readonly workspaceId: string;
}

export function announceModelTrainingStarted(
  detail: ModelTrainingStartedEventDetail,
): void {
  if (
    typeof detail.runId !== "string"
    || !detail.runId.trim()
    || typeof detail.workspaceId !== "string"
    || !detail.workspaceId.trim()
  ) {
    return;
  }
  window.dispatchEvent(
    new CustomEvent<ModelTrainingStartedEventDetail>(
      MODEL_TRAINING_STARTED_EVENT,
      { detail },
    ),
  );
}
