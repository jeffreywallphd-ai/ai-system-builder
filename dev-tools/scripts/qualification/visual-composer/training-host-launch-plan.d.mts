export const TRAINING_PYTHON_RELATIVE: "artifacts/tmp/lancedb-python312-ai-runtime/Scripts/python.exe";
export const TRAINING_WORKER_ARGS: string;
export function trainingAcquisition(input: unknown): string;
export function createTrainingCaseEnvironment(environment: NodeJS.ProcessEnv, repoRoot: string, dataRoot: string, acquisition: unknown): Record<string, string> & { VISUAL_COMPOSER_DESKTOP_DATA_ROOT: string; HF_HUB_CACHE: string };
