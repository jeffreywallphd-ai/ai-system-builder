const MINUTE_MS = 60 * 1_000;
const HOUR_MS = 60 * MINUTE_MS;

export const PYTHON_RUNTIME_TASK_TIMEOUTS = Object.freeze({
  short: 2 * MINUTE_MS,
  validation: 2 * HOUR_MS,
  datasetReview: 2 * HOUR_MS,
  datasetPreparation: 8 * HOUR_MS,
  modelDownload: 12 * HOUR_MS,
  modelTraining: 24 * HOUR_MS,
});

export function resolvePythonRuntimeTaskTimeoutMs(
  pythonTaskType: string,
): number {
  switch (pythonTaskType) {
    case "ensure-model-download":
      return PYTHON_RUNTIME_TASK_TIMEOUTS.modelDownload;
    case "train-model":
      return PYTHON_RUNTIME_TASK_TIMEOUTS.modelTraining;
    case "prepare-training-dataset":
      return PYTHON_RUNTIME_TASK_TIMEOUTS.datasetPreparation;
    case "review-dataset":
      return PYTHON_RUNTIME_TASK_TIMEOUTS.datasetReview;
    case "validate-model":
      return PYTHON_RUNTIME_TASK_TIMEOUTS.validation;
    default:
      return PYTHON_RUNTIME_TASK_TIMEOUTS.short;
  }
}
