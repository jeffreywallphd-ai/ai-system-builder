import type { ModelInferenceMode, ModelTrainingMethod } from "../model";

export interface TrainModelRuntimeBaseModelInput {
  modelRecordId?: string;
  provider?: string;
  modelId?: string;
  localPath?: string;
  inferenceMode?: ModelInferenceMode;
}

export interface TrainModelRuntimeDatasetInput {
  artifactId: string;
  splitRole: "train" | "validation" | "test";
  format?: string;
  path?: string;
}

export interface TrainModelRuntimeCommonParameters {
  numEpochs?: number;
  maxSteps?: number;
  batchSize?: number;
  learningRate?: number;
  weightDecay?: number;
  maxSequenceLength?: number;
  seed?: number;
}

export interface TrainModelRuntimeAdvancedParameters {
  gradientAccumulationSteps?: number;
  warmupSteps?: number;
  warmupRatio?: number;
  schedulerType?: string;
  evalIntervalSteps?: number;
  checkpointIntervalSteps?: number;
  saveTotalLimit?: number;
  mixedPrecision?: "no" | "fp16" | "bf16";
  gradientCheckpointing?: boolean;
  lora?: {
    rank?: number;
    alpha?: number;
    dropout?: number;
    targetModules?: string[];
  };
  quantization?: {
    loadIn4Bit?: boolean;
    loadIn8Bit?: boolean;
    bnb4BitQuantType?: string;
    bnb4BitComputeDtype?: string;
  };
}

export interface TrainModelTaskRequest {
  baseModel: TrainModelRuntimeBaseModelInput;
  datasets: TrainModelRuntimeDatasetInput[];
  method: ModelTrainingMethod;
  commonParameters: TrainModelRuntimeCommonParameters;
  advancedParameters?: TrainModelRuntimeAdvancedParameters;
  output: {
    outputModelName: string;
    outputDirectory?: string;
    maxShardSize?: string;
  };
  validation?: {
    enabled?: boolean;
    expectedLoRA?: boolean;
    expectedRecurrentAdditions?: boolean;
  };
  runMetadata?: Record<string, unknown>;
}
