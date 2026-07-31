export const DATASET_PREPARATION_STARTED_EVENT =
  "dataset-preparation-training-started";

export interface DatasetPreparationStartedEventDetail {
  readonly requestId: string;
  readonly workspaceId: string;
}

export function announceDatasetPreparationStarted(
  detail: DatasetPreparationStartedEventDetail,
): void {
  if (
    typeof detail.requestId !== "string" ||
    !detail.requestId.trim() ||
    typeof detail.workspaceId !== "string" ||
    !detail.workspaceId.trim()
  ) {
    return;
  }
  window.dispatchEvent(
    new CustomEvent<DatasetPreparationStartedEventDetail>(
      DATASET_PREPARATION_STARTED_EVENT,
      { detail },
    ),
  );
}
