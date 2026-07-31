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
import { createWorkspaceId, type WorkspaceId } from "../workspace";
import { type ModelValidationStatus, normalizeModelValidationStatus } from "./model-validation";

export const DEFAULT_LIST_MODELS_LIMIT = 50;
export const MAX_LIST_MODELS_LIMIT = 500;
export const MAX_LIST_MODEL_FILES = 500;

export interface ListModelsRequest {
  workspaceId?: WorkspaceId;
  source?: ModelSource;
  lifecycleStatus?: ModelLifecycleStatus;
  artifactForm?: ModelArtifactForm;
  provider?: ModelBrowseProvider;
  taskTags?: ModelTaskTag[];
  search?: string;
  limit?: number;
  cursor?: string;
  includeDiscovered?: boolean;
  includeSharedStorage?: boolean;
}

export interface ListModelsResult {
  models: ModelInventoryRecord[];
  nextCursor?: string;
}

export interface SaveModelReferenceRequest {
  workspaceId?: WorkspaceId;
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
  workspaceId?: WorkspaceId;
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
  workspaceId?: WorkspaceId;
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
  workspaceId?: WorkspaceId;
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
  workspaceId?: WorkspaceId;
  modelRecordId: string;
  patch: Partial<Omit<ModelInventoryRecord, "modelRecordId" | "createdAt">>;
}

export interface UpdateModelRecordResult {
  model: ModelInventoryRecord;
}

export interface DeleteModelRecordRequest {
  workspaceId?: WorkspaceId;
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

function normalizeWorkspaceId(value: WorkspaceId | string | undefined): WorkspaceId {
  if (typeof value !== "string") {
    throw new Error("workspaceId must be provided for workspace-scoped model operations.");
  }
  return createWorkspaceId(value);
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
    workspaceId: normalizeWorkspaceId(request.workspaceId),
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
    includeSharedStorage: request.includeSharedStorage === true ? true : undefined,
  };
}

export interface RevealModelInFolderRequest {
  workspaceId?: WorkspaceId;
  modelRecordId: string;
}

export interface RevealModelInFolderResult {
  modelRecordId: string;
  revealed: true;
}

export interface ListModelFilesRequest {
  workspaceId?: WorkspaceId;
  modelRecordId: string;
}

export interface ModelFileListItem {
  relativePath: string;
  sizeBytes: number;
}

export interface ListModelFilesResult {
  modelRecordId: string;
  files: ModelFileListItem[];
  truncated: boolean;
}

export function normalizeListModelsResult(result: ListModelsResult): ListModelsResult {
  return {
    models: result.models.map((model) => normalizeModelInventoryRecord(model)),
    nextCursor: normalizeOptionalText(result.nextCursor),
  };
}

export function normalizeSaveModelReferenceRequest(request: SaveModelReferenceRequest): SaveModelReferenceRequest {
  return {
    workspaceId: normalizeWorkspaceId(request.workspaceId),
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
    workspaceId: normalizeWorkspaceId(request.workspaceId),
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
    workspaceId: normalizeWorkspaceId(request.workspaceId),
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
    workspaceId: normalizeWorkspaceId(request.workspaceId),
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
    workspaceId: normalizeWorkspaceId(request.workspaceId),
    modelRecordId: normalizeRequiredText(request.modelRecordId, "modelRecordId"),
    patch: request.patch,
  };
}

export function normalizeDeleteModelRecordRequest(request: DeleteModelRecordRequest): DeleteModelRecordRequest {
  return {
    workspaceId: normalizeWorkspaceId(request.workspaceId),
    modelRecordId: normalizeRequiredText(request.modelRecordId, "modelRecordId"),
    deleteLocalFiles: request.deleteLocalFiles === true,
    deleteBackingArtifacts: request.deleteBackingArtifacts === true,
  };
}

export function normalizeRevealModelInFolderRequest(
  request: RevealModelInFolderRequest,
): RevealModelInFolderRequest {
  return {
    workspaceId: normalizeWorkspaceId(request.workspaceId),
    modelRecordId: normalizeRequiredText(request.modelRecordId, "modelRecordId"),
  };
}

export function normalizeListModelFilesRequest(
  request: ListModelFilesRequest,
): ListModelFilesRequest {
  return {
    workspaceId: normalizeWorkspaceId(request.workspaceId),
    modelRecordId: normalizeRequiredText(request.modelRecordId, "modelRecordId"),
  };
}

export function normalizeListModelFilesResult(
  result: ListModelFilesResult,
): ListModelFilesResult {
  if (result.files.length > MAX_LIST_MODEL_FILES) {
    throw new Error(`Model file lists cannot contain more than ${MAX_LIST_MODEL_FILES} files.`);
  }

  return {
    modelRecordId: normalizeRequiredText(result.modelRecordId, "modelRecordId"),
    files: result.files.map((file) => {
      const relativePath = file.relativePath.trim().replace(/\\/g, "/");
      const segments = relativePath.split("/");
      if (
        relativePath.length === 0
        || relativePath.length > 1_024
        || relativePath.startsWith("/")
        || /^[A-Za-z]:/.test(relativePath)
        || segments.some((segment) => !segment || segment === "." || segment === ".." || /[\u0000-\u001f\u007f]/.test(segment))
      ) {
        throw new Error("Model file paths must be safe repository-relative paths.");
      }
      if (!Number.isSafeInteger(file.sizeBytes) || file.sizeBytes < 0) {
        throw new Error("Model file sizes must be non-negative safe integers.");
      }
      return { relativePath, sizeBytes: file.sizeBytes };
    }),
    truncated: result.truncated === true,
  };
}
