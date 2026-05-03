import {
  normalizeModelArtifactForm,
  normalizeModelLifecycleStatus,
  normalizeModelSource,
  normalizeModelTaskTags,
  type ModelArtifactForm,
  type ModelLifecycleStatus,
  type ModelSource,
  type ModelTaskTag,
} from "../../domain/model";
import { type ModelInferenceMode, normalizeModelInferenceMode } from "./model-inference-mode";
import { type ModelBrowseProvider, normalizeModelBrowseProvider } from "./model-browse-provider";
import { normalizeModelInventoryRecord, type ModelInventoryRecord } from "./model-inventory";
import { type ModelValidationStatus, normalizeModelValidationStatus } from "./model-validation";

export const DEFAULT_LIST_MODELS_LIMIT = 50;
export const MAX_LIST_MODELS_LIMIT = 500;

export interface ListModelsRequest {
  source?: ModelSource;
  lifecycleStatus?: ModelLifecycleStatus;
  artifactForm?: ModelArtifactForm;
  provider?: ModelBrowseProvider;
  taskTags?: ModelTaskTag[];
  search?: string;
  limit?: number;
  cursor?: string;
  includeDiscovered?: boolean;
}

export interface ListModelsResult {
  models: ModelInventoryRecord[];
  nextCursor?: string;
}

export interface SaveModelReferenceRequest {
  modelRecordId?: string;
  provider: ModelBrowseProvider;
  modelId: string;
  displayName?: string;
  inferenceMode?: ModelInferenceMode;
  taskTags?: ModelTaskTag[];
  artifactForm?: ModelArtifactForm;
  metadata?: Record<string, unknown>;
}

export interface SaveModelReferenceResult {
  model: ModelInventoryRecord;
}

export interface DownloadModelRequest {
  modelRecordId?: string;
  provider: ModelBrowseProvider;
  modelId: string;
  displayName?: string;
  inferenceMode?: ModelInferenceMode;
  taskTags?: ModelTaskTag[];
  artifactForm?: ModelArtifactForm;
  metadata?: Record<string, unknown>;
}

export interface DownloadModelResult {
  model: ModelInventoryRecord;
  download: {
    provider: "transformers";
    modelId: string;
    downloaded: boolean;
    fromCache: boolean;
    localPath: string;
  };
}

export interface RegisterDownloadedModelRequest {
  modelRecordId?: string;
  displayName: string;
  source: Extract<ModelSource, "local" | "huggingface">;
  provider: ModelBrowseProvider;
  modelId?: string;
  localPath?: string;
  backingArtifactIds?: string[];
  primaryArtifactId?: string;
  artifactForm: ModelArtifactForm;
  inferenceMode?: ModelInferenceMode;
  taskTags?: ModelTaskTag[];
  baseModelId?: string;
  adapterOfModelId?: string;
  serializationFormat?: string;
  sizeBytes?: number;
  validationStatus?: ModelValidationStatus;
  validationReportPath?: string;
  metadata?: Record<string, unknown>;
}

export interface RegisterDownloadedModelResult {
  model: ModelInventoryRecord;
}

export interface RegisterGeneratedModelRequest {
  modelRecordId?: string;
  displayName: string;
  provider?: ModelBrowseProvider;
  modelId?: string;
  localPath?: string;
  backingArtifactIds?: string[];
  primaryArtifactId?: string;
  artifactForm: Extract<ModelArtifactForm, "adapter" | "merged-model" | "full-model" | "checkpoint">;
  inferenceMode?: ModelInferenceMode;
  taskTags?: ModelTaskTag[];
  baseModelId?: string;
  adapterOfModelId?: string;
  generatedFromRunId?: string;
  serializationFormat?: string;
  sizeBytes?: number;
  validationStatus?: ModelValidationStatus;
  validationReportPath?: string;
  metadata?: Record<string, unknown>;
}

export interface RegisterGeneratedModelResult {
  model: ModelInventoryRecord;
}

export interface UpdateModelRecordRequest {
  modelRecordId: string;
  patch: Partial<Omit<ModelInventoryRecord, "modelRecordId" | "createdAt">>;
}

export interface UpdateModelRecordResult {
  model: ModelInventoryRecord;
}

export interface DeleteModelRecordRequest {
  modelRecordId: string;
  deleteLocalFiles?: boolean;
  deleteBackingArtifacts?: boolean;
}

export interface DeleteModelRecordResult {
  deletedModelRecordId: string;
  deletedRegistryRecord: boolean;
  deletedLocalFiles: boolean;
  deletedBackingArtifactIds: string[];
}

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

function normalizeOptionalStringList(value: readonly string[] | undefined): string[] | undefined {
  if (!value) {
    return undefined;
  }

  const normalized = value.map((entry) => entry.trim()).filter((entry) => entry.length > 0);
  return normalized.length > 0 ? normalized : undefined;
}

function normalizeListLimit(limit: number | undefined): number {
  if (typeof limit !== "number" || !Number.isFinite(limit) || !Number.isInteger(limit) || limit <= 0) {
    return DEFAULT_LIST_MODELS_LIMIT;
  }

  return Math.min(limit, MAX_LIST_MODELS_LIMIT);
}

export function normalizeListModelsRequest(request: ListModelsRequest): ListModelsRequest {
  return {
    source: typeof request.source === "string" ? normalizeModelSource(request.source) : undefined,
    lifecycleStatus:
      typeof request.lifecycleStatus === "string"
        ? normalizeModelLifecycleStatus(request.lifecycleStatus)
        : undefined,
    artifactForm:
      typeof request.artifactForm === "string" ? normalizeModelArtifactForm(request.artifactForm) : undefined,
    provider: typeof request.provider === "string" ? normalizeModelBrowseProvider(request.provider) : undefined,
    taskTags: normalizeModelTaskTags(request.taskTags),
    search: normalizeOptionalText(request.search),
    limit: normalizeListLimit(request.limit),
    cursor: normalizeOptionalText(request.cursor),
    includeDiscovered: request.includeDiscovered === false ? false : undefined,
  };
}

export function normalizeListModelsResult(result: ListModelsResult): ListModelsResult {
  return {
    models: result.models.map((model) => normalizeModelInventoryRecord(model)),
    nextCursor: normalizeOptionalText(result.nextCursor),
  };
}

export function normalizeSaveModelReferenceRequest(request: SaveModelReferenceRequest): SaveModelReferenceRequest {
  return {
    modelRecordId: normalizeOptionalText(request.modelRecordId),
    provider: normalizeModelBrowseProvider(request.provider),
    modelId: normalizeRequiredText(request.modelId, "modelId"),
    displayName: normalizeOptionalText(request.displayName),
    inferenceMode: typeof request.inferenceMode === "string" ? normalizeModelInferenceMode(request.inferenceMode) : undefined,
    taskTags: normalizeModelTaskTags(request.taskTags),
    artifactForm: typeof request.artifactForm === "string" ? normalizeModelArtifactForm(request.artifactForm) : undefined,
    metadata: request.metadata,
  };
}

export function normalizeDownloadModelRequest(request: DownloadModelRequest): DownloadModelRequest {
  return {
    modelRecordId: normalizeOptionalText(request.modelRecordId),
    provider: normalizeModelBrowseProvider(request.provider),
    modelId: normalizeRequiredText(request.modelId, "modelId"),
    displayName: normalizeOptionalText(request.displayName),
    inferenceMode: typeof request.inferenceMode === "string" ? normalizeModelInferenceMode(request.inferenceMode) : undefined,
    taskTags: normalizeModelTaskTags(request.taskTags),
    artifactForm: typeof request.artifactForm === "string" ? normalizeModelArtifactForm(request.artifactForm) : undefined,
    metadata: request.metadata,
  };
}

export function normalizeRegisterDownloadedModelRequest(
  request: RegisterDownloadedModelRequest,
): RegisterDownloadedModelRequest {
  return {
    ...request,
    modelRecordId: normalizeOptionalText(request.modelRecordId),
    displayName: normalizeRequiredText(request.displayName, "displayName"),
    source: normalizeModelSource(request.source) as RegisterDownloadedModelRequest["source"],
    provider: normalizeModelBrowseProvider(request.provider),
    modelId: normalizeOptionalText(request.modelId),
    localPath: normalizeOptionalText(request.localPath),
    backingArtifactIds: normalizeOptionalStringList(request.backingArtifactIds),
    primaryArtifactId: normalizeOptionalText(request.primaryArtifactId),
    artifactForm: normalizeModelArtifactForm(request.artifactForm),
    inferenceMode: typeof request.inferenceMode === "string" ? normalizeModelInferenceMode(request.inferenceMode) : undefined,
    taskTags: normalizeModelTaskTags(request.taskTags),
    baseModelId: normalizeOptionalText(request.baseModelId),
    adapterOfModelId: normalizeOptionalText(request.adapterOfModelId),
    serializationFormat: normalizeOptionalText(request.serializationFormat),
    sizeBytes: typeof request.sizeBytes === "number" && request.sizeBytes >= 0 ? request.sizeBytes : undefined,
    validationStatus:
      typeof request.validationStatus === "string"
        ? normalizeModelValidationStatus(request.validationStatus)
        : undefined,
    validationReportPath: normalizeOptionalText(request.validationReportPath),
    metadata: request.metadata,
  };
}

export function normalizeRegisterGeneratedModelRequest(
  request: RegisterGeneratedModelRequest,
): RegisterGeneratedModelRequest {
  return {
    ...request,
    modelRecordId: normalizeOptionalText(request.modelRecordId),
    displayName: normalizeRequiredText(request.displayName, "displayName"),
    provider: typeof request.provider === "string" ? normalizeModelBrowseProvider(request.provider) : "unknown",
    modelId: normalizeOptionalText(request.modelId),
    localPath: normalizeOptionalText(request.localPath),
    backingArtifactIds: normalizeOptionalStringList(request.backingArtifactIds),
    primaryArtifactId: normalizeOptionalText(request.primaryArtifactId),
    artifactForm: normalizeModelArtifactForm(request.artifactForm) as RegisterGeneratedModelRequest["artifactForm"],
    inferenceMode: typeof request.inferenceMode === "string" ? normalizeModelInferenceMode(request.inferenceMode) : undefined,
    taskTags: normalizeModelTaskTags(request.taskTags),
    baseModelId: normalizeOptionalText(request.baseModelId),
    adapterOfModelId: normalizeOptionalText(request.adapterOfModelId),
    generatedFromRunId: normalizeOptionalText(request.generatedFromRunId),
    serializationFormat: normalizeOptionalText(request.serializationFormat),
    sizeBytes: typeof request.sizeBytes === "number" && request.sizeBytes >= 0 ? request.sizeBytes : undefined,
    validationStatus:
      typeof request.validationStatus === "string"
        ? normalizeModelValidationStatus(request.validationStatus)
        : undefined,
    validationReportPath: normalizeOptionalText(request.validationReportPath),
    metadata: request.metadata,
  };
}

export function normalizeUpdateModelRecordRequest(request: UpdateModelRecordRequest): UpdateModelRecordRequest {
  return {
    modelRecordId: normalizeRequiredText(request.modelRecordId, "modelRecordId"),
    patch: request.patch,
  };
}

export function normalizeDeleteModelRecordRequest(request: DeleteModelRecordRequest): DeleteModelRecordRequest {
  return {
    modelRecordId: normalizeRequiredText(request.modelRecordId, "modelRecordId"),
    deleteLocalFiles: request.deleteLocalFiles === true,
    deleteBackingArtifacts: request.deleteBackingArtifacts === true,
  };
}
