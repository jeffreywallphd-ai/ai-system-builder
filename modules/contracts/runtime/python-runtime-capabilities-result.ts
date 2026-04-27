export const PYTHON_RUNTIME_CAPABILITY_PREPARE_TRAINING_DATASET = "prepare-training-dataset";
export const PYTHON_RUNTIME_CAPABILITY_ENSURE_MODEL_DOWNLOAD = "ensure-model-download";
export const PYTHON_RUNTIME_CAPABILITY_MODEL_STATUS = "model-status";
export const PYTHON_RUNTIME_CAPABILITY_UNLOAD_MODEL = "unload-model";
export const PYTHON_RUNTIME_CAPABILITY_DATASET_PREPARATION_AUTO_INFERENCE_MODE =
  "dataset-preparation.auto-inference-mode";

export const PYTHON_RUNTIME_DATASET_PREPARATION_REQUIRED_CAPABILITIES = [
  PYTHON_RUNTIME_CAPABILITY_PREPARE_TRAINING_DATASET,
  PYTHON_RUNTIME_CAPABILITY_DATASET_PREPARATION_AUTO_INFERENCE_MODE,
] as const;

export interface PythonRuntimeCapabilitiesResult {
  runtimeId: string;
  capabilities: string[];
}
