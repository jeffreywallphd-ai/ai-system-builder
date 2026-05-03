import type { ModelInferenceMode, ModelTrainingStatus } from "../model";

export interface TrainModelRuntimeCheckpoint {
  path: string;
  step?: number;
  metric?: string;
  value?: number;
}

export interface TrainModelGeneratedModelCandidate {
  displayName: string;
  provider?: string;
  modelId?: string;
  localPath?: string;
  artifactForm?: "adapter" | "merged-model" | "full-model" | "checkpoint";
  inferenceMode?: ModelInferenceMode;
  taskTags?: string[];
  baseModelId?: string;
  adapterOfModelId?: string;
  generatedFromRunId?: string;
  serializationFormat?: string;
  sizeBytes?: number;
  metadata?: Record<string, unknown>;
}

export interface TrainModelTaskResult {
  runId: string;
  status: ModelTrainingStatus;
  outputDirectory?: string;
  outputModelName?: string;
  checkpoints?: TrainModelRuntimeCheckpoint[];
  metrics?: Record<string, number>;
  logs?: string[];
  warnings?: string[];
  validationReportPath?: string;
  generatedModelCandidate?: TrainModelGeneratedModelCandidate;
  error?: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}
