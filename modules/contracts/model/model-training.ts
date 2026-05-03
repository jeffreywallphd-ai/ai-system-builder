import { type ModelTaskTag, normalizeModelTaskTags } from "../../domain/model";
import { type ModelBrowseProvider, normalizeModelBrowseProvider } from "./model-browse-provider";
import { type ModelInferenceMode, normalizeModelInferenceMode } from "./model-inference-mode";
import { type ModelInventoryRecord, normalizeModelInventoryRecord } from "./model-inventory";

export const MODEL_TRAINING_METHODS = ["lora", "qlora", "full-finetune"] as const;
export type ModelTrainingMethod = (typeof MODEL_TRAINING_METHODS)[number];

export const MODEL_TRAINING_STATUSES = ["queued", "running", "succeeded", "failed", "cancelled"] as const;
export type ModelTrainingStatus = (typeof MODEL_TRAINING_STATUSES)[number];

export type ModelTrainingDatasetSplitRole = "train" | "validation" | "test";

export interface ModelTrainingDatasetInput {
  artifactId: string;
  splitRole?: ModelTrainingDatasetSplitRole;
  format?: string;
  path?: string;
}

export interface ModelTrainingBaseModel {
  modelRecordId?: string;
  provider?: ModelBrowseProvider;
  modelId?: string;
  localPath?: string;
  inferenceMode?: ModelInferenceMode;
}

export interface ModelTrainingOutputRegistrationMetadata {
  displayName?: string;
  artifactForm?: "adapter" | "merged-model" | "full-model" | "checkpoint";
  inferenceMode?: ModelInferenceMode;
  taskTags?: ModelTaskTag[];
  baseModelId?: string;
  adapterOfModelId?: string;
  metadata?: Record<string, unknown>;
}

export interface ModelTrainingOutputConfig {
  outputModelName: string;
  localOutputDirectory?: string;
  maxShardSize?: string;
  destination: {
    local: {
      enabled: boolean;
    };
    huggingFace?: {
      enabled?: boolean;
      provider?: "huggingface";
      repository?: string;
      revision?: string;
      pathPrefix?: string;
      private?: boolean;
    };
  };
  registration?: ModelTrainingOutputRegistrationMetadata;
}

export interface ModelTrainingCommonParameters {
  numEpochs?: number;
  maxSteps?: number;
  batchSize?: number;
  learningRate?: number;
  weightDecay?: number;
  maxSequenceLength?: number;
  seed?: number;
}

export interface ModelTrainingLoRAParameters {
  rank?: number;
  alpha?: number;
  dropout?: number;
  targetModules?: string[];
}

export interface ModelTrainingQuantizationParameters {
  loadIn4Bit?: boolean;
  loadIn8Bit?: boolean;
  bnb4BitQuantType?: string;
  bnb4BitComputeDtype?: string;
}

export interface ModelTrainingAdvancedParameters {
  gradientAccumulationSteps?: number;
  warmupSteps?: number;
  warmupRatio?: number;
  schedulerType?: string;
  evalIntervalSteps?: number;
  checkpointIntervalSteps?: number;
  saveTotalLimit?: number;
  mixedPrecision?: "no" | "fp16" | "bf16";
  gradientCheckpointing?: boolean;
  lora?: ModelTrainingLoRAParameters;
  quantization?: ModelTrainingQuantizationParameters;
}

export interface ModelTrainingValidationConfig {
  enabled?: boolean;
  expectedLoRA?: boolean;
  expectedRecurrentAdditions?: boolean;
  taskTags?: ModelTaskTag[];
}

export interface ModelTrainingRequest {
  baseModel: ModelTrainingBaseModel;
  datasets: ModelTrainingDatasetInput[];
  method: ModelTrainingMethod;
  commonParameters: ModelTrainingCommonParameters;
  advancedParameters?: ModelTrainingAdvancedParameters;
  output: ModelTrainingOutputConfig;
  validation?: ModelTrainingValidationConfig;
  runtimeMetadata?: Record<string, unknown>;
}

export interface ModelTrainingStatusRequest {
  runId: string;
}

export interface ModelTrainingProgress {
  stage?: string;
  message?: string;
  epoch?: number;
  totalEpochs?: number;
  batch?: number;
  totalBatches?: number;
}

export interface ModelTrainingGeneratedModelCandidate {
  displayName: string;
  provider?: ModelBrowseProvider;
  modelId?: string;
  localPath?: string;
  artifactForm?: "adapter" | "merged-model" | "full-model" | "checkpoint";
  inferenceMode?: ModelInferenceMode;
  taskTags?: ModelTaskTag[];
  baseModelId?: string;
  adapterOfModelId?: string;
  generatedFromRunId?: string;
  serializationFormat?: string;
  sizeBytes?: number;
  metadata?: Record<string, unknown>;
}

export interface ModelTrainingCheckpointSummary {
  path: string;
  step?: number;
  metric?: string;
  value?: number;
}

export interface ModelTrainingResult {
  runId: string;
  status: ModelTrainingStatus;
  progress?: ModelTrainingProgress;
  outputDirectory?: string;
  outputModelName?: string;
  outputModel?: ModelInventoryRecord;
  generatedModelCandidate?: ModelTrainingGeneratedModelCandidate;
  metrics?: Record<string, number>;
  checkpoints?: ModelTrainingCheckpointSummary[];
  logs?: string[];
  validationReportPath?: string;
  warnings?: string[];
  error?: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

const MODEL_TRAINING_METHOD_SET = new Set<string>(MODEL_TRAINING_METHODS);
const MODEL_TRAINING_STATUS_SET = new Set<string>(MODEL_TRAINING_STATUSES);
const DATASET_SPLIT_ROLE_SET = new Set<ModelTrainingDatasetSplitRole>(["train", "validation", "test"]);

function normalizeOptionalText(value: string | undefined): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function normalizeRequiredText(value: string, fieldName: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new Error(`${fieldName} must be a non-empty trimmed string.`);
  }

  return normalized;
}

function normalizeOptionalNumber(value: number | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function normalizeOptionalInteger(value: number | undefined): number | undefined {
  return typeof value === "number" && Number.isInteger(value) ? value : undefined;
}

function normalizeOptionalStringList(value: readonly string[] | undefined): string[] | undefined {
  if (!value) {
    return undefined;
  }

  const normalized = value.map((entry) => entry.trim()).filter((entry) => entry.length > 0);
  return normalized.length > 0 ? normalized : undefined;
}

function normalizeTrainingMethod(value: string): ModelTrainingMethod {
  const normalized = value.trim().toLowerCase();
  if (!MODEL_TRAINING_METHOD_SET.has(normalized)) {
    throw new Error(`Training method must be one of: ${MODEL_TRAINING_METHODS.join(", ")}. Received: ${value}`);
  }

  return normalized as ModelTrainingMethod;
}

function normalizeTrainingStatus(value: string): ModelTrainingStatus {
  const normalized = value.trim().toLowerCase();
  if (!MODEL_TRAINING_STATUS_SET.has(normalized)) {
    throw new Error(`Training status must be one of: ${MODEL_TRAINING_STATUSES.join(", ")}. Received: ${value}`);
  }

  return normalized as ModelTrainingStatus;
}

function normalizeDatasetSplitRole(value: string | undefined): ModelTrainingDatasetSplitRole | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim().toLowerCase() as ModelTrainingDatasetSplitRole;
  if (!DATASET_SPLIT_ROLE_SET.has(normalized)) {
    throw new Error(`Dataset splitRole must be one of: train, validation, test. Received: ${value}`);
  }

  return normalized;
}

export function normalizeModelTrainingRequest(request: ModelTrainingRequest): ModelTrainingRequest {
  const datasets = request.datasets.map((dataset, index) => ({
    artifactId: normalizeRequiredText(dataset.artifactId, `datasets[${index}].artifactId`),
    splitRole: normalizeDatasetSplitRole(dataset.splitRole),
    format: normalizeOptionalText(dataset.format),
    path: normalizeOptionalText(dataset.path),
  }));

  if (datasets.length === 0) {
    throw new Error("Model training requires at least one dataset input.");
  }

  return {
    baseModel: {
      modelRecordId: normalizeOptionalText(request.baseModel.modelRecordId),
      provider: typeof request.baseModel.provider === "string" ? normalizeModelBrowseProvider(request.baseModel.provider) : undefined,
      modelId: normalizeOptionalText(request.baseModel.modelId),
      localPath: normalizeOptionalText(request.baseModel.localPath),
      inferenceMode:
        typeof request.baseModel.inferenceMode === "string"
          ? normalizeModelInferenceMode(request.baseModel.inferenceMode)
          : undefined,
    },
    datasets,
    method: normalizeTrainingMethod(request.method),
    commonParameters: {
      numEpochs: normalizeOptionalInteger(request.commonParameters.numEpochs),
      maxSteps: normalizeOptionalInteger(request.commonParameters.maxSteps),
      batchSize: normalizeOptionalInteger(request.commonParameters.batchSize),
      learningRate: normalizeOptionalNumber(request.commonParameters.learningRate),
      weightDecay: normalizeOptionalNumber(request.commonParameters.weightDecay),
      maxSequenceLength: normalizeOptionalInteger(request.commonParameters.maxSequenceLength),
      seed: normalizeOptionalInteger(request.commonParameters.seed),
    },
    advancedParameters: request.advancedParameters
      ? {
          gradientAccumulationSteps: normalizeOptionalInteger(request.advancedParameters.gradientAccumulationSteps),
          warmupSteps: normalizeOptionalInteger(request.advancedParameters.warmupSteps),
          warmupRatio: normalizeOptionalNumber(request.advancedParameters.warmupRatio),
          schedulerType: normalizeOptionalText(request.advancedParameters.schedulerType),
          evalIntervalSteps: normalizeOptionalInteger(request.advancedParameters.evalIntervalSteps),
          checkpointIntervalSteps: normalizeOptionalInteger(request.advancedParameters.checkpointIntervalSteps),
          saveTotalLimit: normalizeOptionalInteger(request.advancedParameters.saveTotalLimit),
          mixedPrecision: request.advancedParameters.mixedPrecision,
          gradientCheckpointing: request.advancedParameters.gradientCheckpointing === true,
          lora: request.advancedParameters.lora
            ? {
                rank: normalizeOptionalInteger(request.advancedParameters.lora.rank),
                alpha: normalizeOptionalNumber(request.advancedParameters.lora.alpha),
                dropout: normalizeOptionalNumber(request.advancedParameters.lora.dropout),
                targetModules: normalizeOptionalStringList(request.advancedParameters.lora.targetModules),
              }
            : undefined,
          quantization: request.advancedParameters.quantization
            ? {
                loadIn4Bit: request.advancedParameters.quantization.loadIn4Bit === true,
                loadIn8Bit: request.advancedParameters.quantization.loadIn8Bit === true,
                bnb4BitQuantType: normalizeOptionalText(request.advancedParameters.quantization.bnb4BitQuantType),
                bnb4BitComputeDtype: normalizeOptionalText(request.advancedParameters.quantization.bnb4BitComputeDtype),
              }
            : undefined,
        }
      : undefined,
    output: {
      outputModelName: normalizeRequiredText(request.output.outputModelName, "output.outputModelName"),
      localOutputDirectory: normalizeOptionalText(request.output.localOutputDirectory),
      maxShardSize: normalizeOptionalText(request.output.maxShardSize),
      destination: {
        local: {
          enabled: request.output.destination.local.enabled === true,
        },
        huggingFace: request.output.destination.huggingFace
          ? {
              enabled: request.output.destination.huggingFace.enabled === true,
              provider: request.output.destination.huggingFace.provider,
              repository: normalizeOptionalText(request.output.destination.huggingFace.repository),
              revision: normalizeOptionalText(request.output.destination.huggingFace.revision),
              pathPrefix: normalizeOptionalText(request.output.destination.huggingFace.pathPrefix),
              private: request.output.destination.huggingFace.private === true,
            }
          : undefined,
      },
      registration: request.output.registration
        ? {
            displayName: normalizeOptionalText(request.output.registration.displayName),
            artifactForm: request.output.registration.artifactForm,
            inferenceMode:
              typeof request.output.registration.inferenceMode === "string"
                ? normalizeModelInferenceMode(request.output.registration.inferenceMode)
                : undefined,
            taskTags: normalizeModelTaskTags(request.output.registration.taskTags),
            baseModelId: normalizeOptionalText(request.output.registration.baseModelId),
            adapterOfModelId: normalizeOptionalText(request.output.registration.adapterOfModelId),
            metadata: request.output.registration.metadata,
          }
        : undefined,
    },
    validation: request.validation
      ? {
          enabled: request.validation.enabled === true,
          expectedLoRA: request.validation.expectedLoRA === true,
          expectedRecurrentAdditions: request.validation.expectedRecurrentAdditions === true,
          taskTags: normalizeModelTaskTags(request.validation.taskTags),
        }
      : undefined,
    runtimeMetadata: request.runtimeMetadata,
  };
}

export function normalizeModelTrainingResult(result: ModelTrainingResult): ModelTrainingResult {
  return {
    ...result,
    runId: normalizeRequiredText(result.runId, "runId"),
    status: normalizeTrainingStatus(result.status),
    progress: result.progress
      ? {
          stage: normalizeOptionalText(result.progress.stage),
          message: normalizeOptionalText(result.progress.message),
          epoch: normalizeOptionalInteger(result.progress.epoch),
          totalEpochs: normalizeOptionalInteger(result.progress.totalEpochs),
          batch: normalizeOptionalInteger(result.progress.batch),
          totalBatches: normalizeOptionalInteger(result.progress.totalBatches),
        }
      : undefined,
    outputDirectory: normalizeOptionalText(result.outputDirectory),
    outputModelName: normalizeOptionalText(result.outputModelName),
    outputModel: result.outputModel ? normalizeModelInventoryRecord(result.outputModel) : undefined,
    generatedModelCandidate: result.generatedModelCandidate
      ? {
          displayName: normalizeRequiredText(result.generatedModelCandidate.displayName, "generatedModelCandidate.displayName"),
          provider:
            typeof result.generatedModelCandidate.provider === "string"
              ? normalizeModelBrowseProvider(result.generatedModelCandidate.provider)
              : undefined,
          modelId: normalizeOptionalText(result.generatedModelCandidate.modelId),
          localPath: normalizeOptionalText(result.generatedModelCandidate.localPath),
          artifactForm: result.generatedModelCandidate.artifactForm,
          inferenceMode:
            typeof result.generatedModelCandidate.inferenceMode === "string"
              ? normalizeModelInferenceMode(result.generatedModelCandidate.inferenceMode)
              : undefined,
          taskTags: normalizeModelTaskTags(result.generatedModelCandidate.taskTags),
          baseModelId: normalizeOptionalText(result.generatedModelCandidate.baseModelId),
          adapterOfModelId: normalizeOptionalText(result.generatedModelCandidate.adapterOfModelId),
          generatedFromRunId: normalizeOptionalText(result.generatedModelCandidate.generatedFromRunId),
          serializationFormat: normalizeOptionalText(result.generatedModelCandidate.serializationFormat),
          sizeBytes: normalizeOptionalNumber(result.generatedModelCandidate.sizeBytes),
          metadata: result.generatedModelCandidate.metadata,
        }
      : undefined,
    checkpoints: result.checkpoints?.map((checkpoint) => ({
      path: normalizeRequiredText(checkpoint.path, "checkpoint.path"),
      step: normalizeOptionalInteger(checkpoint.step),
      metric: normalizeOptionalText(checkpoint.metric),
      value: normalizeOptionalNumber(checkpoint.value),
    })),
    logs: normalizeOptionalStringList(result.logs),
    warnings: normalizeOptionalStringList(result.warnings),
    validationReportPath: normalizeOptionalText(result.validationReportPath),
    error: result.error
      ? {
          code: normalizeRequiredText(result.error.code, "error.code"),
          message: normalizeRequiredText(result.error.message, "error.message"),
          details: result.error.details,
        }
      : undefined,
  };
}
