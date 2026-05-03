/**
 * Runtime task type identifiers used by the shared Runtime Task Registry.
 * Values are stable and used across runtime contracts and polling APIs.
 */
export enum TaskType {
  DATASET_PREPARATION = "dataset-preparation",
  MODEL_TRAINING = "model-training",
  MODEL_VALIDATION = "model-validation",
  MODEL_PUBLISHING = "model-publishing",
  IMAGE_GENERATION = "image-generation",
}
