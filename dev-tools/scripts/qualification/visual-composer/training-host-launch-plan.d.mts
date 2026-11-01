export const TRAINING_PYTHON_RELATIVE: "artifacts/tmp/lancedb-python312-ai-runtime/Scripts/python.exe";
export const TRAINING_WORKER_ARGS: string;
export function trainingAcquisition(input: unknown): string;
export function trainingInputIdentity(acquisition: unknown, manifestHash?: unknown): Readonly<{ profile: "approved-qwen05" | "generated-tiny-qwen2-v1"; modelId: string; provider: "huggingface" | "unknown"; displayName: string; manifestHash?: string }>;
export type TrainingCaseEnvironment = Record<string, string> & {
  VISUAL_COMPOSER_DESKTOP_DATA_ROOT: string;
  HF_HUB_CACHE: string;
  /** Present only for an explicitly declared generated-input test package. */
  VISUAL_COMPOSER_TRAINING_PACKAGED_ROOT?: string;
};
export function createTrainingCaseEnvironment(environment: NodeJS.ProcessEnv, repoRoot: string, dataRoot: string, acquisition: unknown, manifestHash?: unknown): TrainingCaseEnvironment;
