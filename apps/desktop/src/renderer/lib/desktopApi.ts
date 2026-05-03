import type {
  ArtifactBrowseItem as ArtifactBrowseContractItem,
  ArtifactDetailReadModel as ArtifactDetailContractModel,
} from "../../../../../modules/contracts/artifact-browser";
import type { StagedArtifactDescriptor } from "../../../../../modules/contracts/ingestion";
import type {
  DatasetPreparationSummary,
  DatasetPreparationWarning,
  PrepareTrainingDatasetRequest,
} from "../../../../../modules/contracts/runtime";
import type {
  ApplicationSettingCategory,
  ApplicationSettingDefinition,
  ApplicationSettingValue,
  ListApplicationSettingDefinitionsRequest,
  ReadApplicationSettingsRequest,
  ResolveModelDefaultRequest,
  ResolvedModelDefault,
  UpdateApplicationSettingRequest,
} from "../../../../../modules/contracts/settings";
import type {
  ImageGenerationRequest,
} from "../../../../../modules/contracts/image-generation";
import type {
  BrowseModelsRequest,
  GetModelDetailsRequest,
  ModelBrowseItem,
  ModelDetails,
  ModelInventoryRecord,
  DeleteModelRecordRequest,
  DeleteModelRecordResult,
  DownloadModelRequest,
  DownloadModelResult,
  ListModelsRequest,
  ModelTrainingRequest,
  ModelTrainingResult,
  SaveModelReferenceRequest,
  UpdateModelRecordRequest,
  ValidateModelRequest,
  ValidateModelResult,
  PublishModelRequest,
  PublishModelResult,
} from "../../../../../modules/contracts/model";

export interface DesktopArtifactUploadInput {
  fileName: string;
  mediaType: string;
  bytes: Uint8Array;
}

export interface DesktopArtifactBrowserLocator {
  storageKey: string;
}

export interface DesktopUploadedImageDescriptor {
  key: string;
  mediaType: string;
  sizeBytes: number;
}

export interface DesktopArtifactBrowseItem {
  artifactId: string;
  storageKey: string;
  artifactFamily: ArtifactBrowseContractItem["artifactFamily"];
  mediaType?: string;
  sizeBytes?: number;
  originalName?: string;
  createdAt?: string;
  metadata?: {
    backingState?: {
      hasImportedSourceBacking: boolean;
      hasPublishedBacking: boolean;
      hasLocalObjectAvailable: boolean;
      isLocalized: boolean;
      isRemoteOnly: boolean;
    };
  };
}

export interface DesktopWebsiteCaptureMetadata {
  sourceUrl: string;
  resolvedUrl: string;
  requestedMode: "automatic" | "rendered";
  acquisitionMechanismUsed: "simple-http" | "rendered-browser";
  retrievedAt: string;
  httpStatus?: number;
  contentTypeHeader?: string;
}

export interface DesktopArtifactDetail {
  locator: DesktopArtifactBrowserLocator;
  artifactFamily: ArtifactDetailContractModel["artifactFamily"];
  mediaType?: string;
  sizeBytes?: number;
  sourceKind?: string;
  originalName?: string;
  createdAt?: string;
  metadata?: {
    publishedBacking?: DesktopPublishedBacking;
    importedSourceBacking?: DesktopPublishedBacking;
    websiteCapture?: DesktopWebsiteCaptureMetadata;
  };
}

export type DesktopArtifactFamily = ArtifactBrowseContractItem["artifactFamily"];

export interface DesktopArtifactContentDescriptor {
  locator: DesktopArtifactBrowserLocator;
  mediaType?: string;
  sizeBytes?: number;
  availability: "available" | "unavailable";
  retrieval: "inline" | "deferred";
}

export interface DesktopArtifactMediaView {
  storageKey: string;
  mediaType?: string;
  sizeBytes?: number;
  bytes: Uint8Array;
}

export interface DesktopPublishedBacking {
  target: {
    provider: string;
    repository: string;
    path: string;
    revision?: string;
    locator?: string;
  };
  verification: {
    exists: boolean;
    verifiedAt?: string;
  };
}

export interface DesktopLocalizedArtifactFromRepo {
  artifactId: string;
  localObject: {
    key: string;
    mediaType?: string;
    sizeBytes: number;
  };
  source: {
    provider: string;
    repository: string;
    path: string;
    revision?: string;
    locator: string;
  };
  localizedAt: string;
}

export type DesktopArtifactUploadResult =
  | {
      ok: true;
      value: {
        descriptor: DesktopUploadedImageDescriptor;
      };
    }
  | {
      ok: false;
      error: {
        code: string;
        message: string;
      };
    };

export interface DesktopArtifactUploadAcceptedTypePolicy {
  acceptedMediaTypes: readonly string[];
  acceptedExtensions: readonly string[];
}

export interface DesktopWebsiteIngestionTarget {
  url: string;
  label?: string;
}

export interface DesktopWebsiteIngestionStagedArtifact {
  sourceKind: string;
  originalName?: string;
  storage: {
    key: string;
    mediaType?: string;
    sizeBytes?: number;
  };
  metadata?: {
    requestedMode?: "automatic" | "rendered";
    acquisitionMechanismUsed?: "simple-http" | "rendered-browser";
  };
}

export interface DesktopWebsitePageIngestionResult {
  target: DesktopWebsiteIngestionTarget;
  resolvedUrl: string;
  acquisitionMechanismUsed: "simple-http" | "rendered-browser";
  stagedArtifact?: DesktopWebsiteIngestionStagedArtifact;
  warnings?: string[];
}

export interface DesktopWebsitePagesBatchSummary {
  attempted: number;
  succeeded: number;
  failed: number;
}

export interface DesktopWebsitePagesBatchItem {
  target: DesktopWebsiteIngestionTarget;
  ok: boolean;
  result?: DesktopWebsitePageIngestionResult;
  error?: {
    code: string;
    message: string;
  };
}

export interface DesktopPrepareTrainingDatasetInput {
  sourceArtifactIds: string[];
  recipe: PrepareTrainingDatasetRequest["recipe"];
  split: PrepareTrainingDatasetRequest["split"];
  output: PrepareTrainingDatasetRequest["output"];
}

export interface DesktopPreparedTrainingDatasetResult {
  outputs: {
    local?: {
      dataset: StagedArtifactDescriptor;
    };
    huggingFace?: {
      dataset: {
        provider: "huggingface";
        repository: string;
        path: string;
        revision?: string;
        exists: boolean;
        verifiedAt: string;
      };
    };
  };
  provenance: {
    sourceArtifactIds: string[];
    recipe: PrepareTrainingDatasetRequest["recipe"];
    split: PrepareTrainingDatasetRequest["split"];
    output: PrepareTrainingDatasetRequest["output"];
    generationModelId: string;
    summary: DatasetPreparationSummary;
  };
  summary: DatasetPreparationSummary;
  warnings?: DatasetPreparationWarning[];
}

export interface DesktopPythonRuntimeLogEntry {
  timestamp: string;
  level: "info" | "warn" | "error";
  message: string;
}

export interface DesktopPythonRuntimeLoadedModel {
  provider: "transformers";
  modelId: string;
  inferenceMode: "text2text" | "causal" | "chat" | "text-to-image";
  device?: "cpu" | "cuda" | "auto";
  torchDtype?: "auto" | "float16" | "bfloat16" | "float32";
  localPath?: string;
}

export interface DesktopPythonRuntimeStatusSnapshot {
  supervisorStatus: "stopped" | "starting" | "ready" | "failed";
  healthy: boolean;
  runtimeStatus: string;
  capabilities: string[];
  logs: DesktopPythonRuntimeLogEntry[];
  loadedModels: DesktopPythonRuntimeLoadedModel[];
  activeTaskCount: number;
  systemResources?: {
    memoryUsagePercent: number;
    cpuUsagePercent: number;
    gpuUsagePercent: number;
  };
}

export interface DesktopArtifactUploadApi {
  uploadArtifact: (input: DesktopArtifactUploadInput) => Promise<DesktopArtifactUploadResult>;
  getArtifactUploadPolicy: () => Promise<DesktopArtifactUploadAcceptedTypePolicy>;
  ingestWebsitePage: (input: {
    url: string;
    label?: string;
    mode?: "automatic" | "rendered";
  }) => Promise<unknown>;
  ingestWebsitePagesBatch: (input: {
    targets: DesktopWebsiteIngestionTarget[];
    mode?: "automatic" | "rendered";
  }) => Promise<unknown>;
}

export interface DesktopBridgeRequestContext {
  requestId?: string;
  correlationId?: string;
}

export interface DesktopDatasetPreparationApi {
  startPrepareTrainingDataset?: (
    input: DesktopPrepareTrainingDatasetInput,
    context?: DesktopBridgeRequestContext,
  ) => Promise<unknown>;
  readPrepareTrainingDatasetTask?: (
    input: { requestId: string },
    context?: DesktopBridgeRequestContext,
  ) => Promise<unknown>;
  cancelPrepareTrainingDatasetTask?: (
    input: { requestId: string },
    context?: DesktopBridgeRequestContext,
  ) => Promise<unknown>;
}

export interface DesktopImageGenerationApi {
  startImageGeneration?: (input: ImageGenerationRequest, context?: DesktopBridgeRequestContext) => Promise<unknown>;
  readImageGeneration?: (input: { requestId: string }, context?: DesktopBridgeRequestContext) => Promise<unknown>;
  cancelImageGeneration?: (input: { requestId: string }, context?: DesktopBridgeRequestContext) => Promise<unknown>;
  finalizeImageGenerationIfCompleted?: (input: { requestId: string }, context?: DesktopBridgeRequestContext) => Promise<unknown>;
  readComfyUiInstallStatus?: (input?: { installRoot?: string }, context?: DesktopBridgeRequestContext) => Promise<unknown>;
  repairComfyUiInstall?: (input?: { installRoot?: string; allowUpdate?: boolean; forceRepair?: boolean }, context?: DesktopBridgeRequestContext) => Promise<unknown>;
}

export interface DesktopPythonRuntimeApi {
  readPythonRuntimeStatus: () => Promise<unknown>;
  controlPythonRuntime: (input: { action: "start" | "stop" | "restart" | "unload-model" | "clear-logs" }) => Promise<unknown>;
}

interface DesktopApiBridge {
  getHuggingFaceTokenStatus: () => Promise<unknown>;
  setHuggingFaceToken: (input: { token: string }) => Promise<unknown>;
  clearHuggingFaceToken: () => Promise<unknown>;
  browseHuggingFaceNamespaceDatasets: (input: { namespace: string }) => Promise<unknown>;
  browseHuggingFaceDatasetParquetFiles: (input: { repository: string; revision?: string }) => Promise<unknown>;
  uploadArtifact: (input: DesktopArtifactUploadInput) => Promise<unknown>;
  getArtifactUploadPolicy: () => Promise<unknown>;
  ingestWebsitePage?: (input: {
    url: string;
    label?: string;
    mode?: "automatic" | "rendered";
  }) => Promise<unknown>;
  ingestWebsitePagesBatch?: (input: {
    targets: DesktopWebsiteIngestionTarget[];
    mode?: "automatic" | "rendered";
  }) => Promise<unknown>;
  startPrepareTrainingDataset?: (input: DesktopPrepareTrainingDatasetInput, context?: DesktopBridgeRequestContext) => Promise<unknown>;
  readPrepareTrainingDatasetTask?: (input: { requestId: string }, context?: DesktopBridgeRequestContext) => Promise<unknown>;
  cancelPrepareTrainingDatasetTask?: (input: { requestId: string }, context?: DesktopBridgeRequestContext) => Promise<unknown>;
  readPythonRuntimeStatus?: () => Promise<unknown>;
  controlPythonRuntime?: (input: { action: "start" | "stop" | "restart" | "unload-model" | "clear-logs" }) => Promise<unknown>;
  startImageGeneration?: (input: ImageGenerationRequest, context?: DesktopBridgeRequestContext) => Promise<unknown>;
  readImageGeneration?: (input: { requestId: string }, context?: DesktopBridgeRequestContext) => Promise<unknown>;
  cancelImageGeneration?: (input: { requestId: string }, context?: DesktopBridgeRequestContext) => Promise<unknown>;
  finalizeImageGenerationIfCompleted?: (input: { requestId: string }, context?: DesktopBridgeRequestContext) => Promise<unknown>;
  readComfyUiInstallStatus?: (input?: { installRoot?: string }, context?: DesktopBridgeRequestContext) => Promise<unknown>;
  repairComfyUiInstall?: (input?: { installRoot?: string; allowUpdate?: boolean; forceRepair?: boolean }, context?: DesktopBridgeRequestContext) => Promise<unknown>;
  browseArtifacts: (input?: { artifactFamily?: DesktopArtifactFamily }, context?: DesktopBridgeRequestContext) => Promise<unknown>;
  browseUnregisteredArtifacts?: () => Promise<unknown>;
  registerUnregisteredArtifact?: (input: { storageKey: string }) => Promise<unknown>;
  deleteUnregisteredArtifact?: (input: { storageKey: string }) => Promise<unknown>;
  deleteRegisteredArtifact?: (input: { storageKey: string }) => Promise<unknown>;
  readArtifactDetail: (locator: DesktopArtifactBrowserLocator) => Promise<unknown>;
  readArtifactContentDescriptor: (locator: DesktopArtifactBrowserLocator) => Promise<unknown>;
  readArtifactViewerMedia: (locator: DesktopArtifactBrowserLocator) => Promise<unknown>;
  publishArtifactToRepo: (input: {
    artifactId: string;
    target: {
      provider: string;
      repository: string;
      path: string;
      revision?: string;
    };
    mediaType?: string;
  }) => Promise<unknown>;
  verifyPublishedArtifactBacking: (input: {
    artifactId: string;
  }) => Promise<unknown>;
  verifyImportedArtifactSourceBacking?: (input: {
    artifactId: string;
  }) => Promise<unknown>;
  registerArtifactFromRepo: (input: {
    target: {
      provider: string;
      repository: string;
      path: string;
      revision?: string;
    };
    artifactFamily?: DesktopArtifactFamily;
    mediaType?: string;
  }) => Promise<unknown>;
  localizeArtifactFromRepo: (input: {
    artifactId: string;
  }) => Promise<unknown>;

  listApplicationSettingDefinitions?: (input?: ListApplicationSettingDefinitionsRequest) => Promise<unknown>;
  readApplicationSettings?: (input?: ReadApplicationSettingsRequest) => Promise<unknown>;
  updateApplicationSetting?: (input: UpdateApplicationSettingRequest) => Promise<unknown>;
  clearApplicationSetting?: (input: { key: string }) => Promise<unknown>;
  resolveApplicationModelDefault?: (input: ResolveModelDefaultRequest) => Promise<unknown>;
  resolveModelDefault?: (input: ResolveModelDefaultRequest) => Promise<unknown>;
  browseModels?: (input: DesktopModelBrowseRequest, context?: DesktopBridgeRequestContext) => Promise<unknown>;
  getModelDetails?: (input: DesktopModelDetailsRequest, context?: DesktopBridgeRequestContext) => Promise<unknown>;
  listModels?: (input?: DesktopModelListRequest, context?: DesktopBridgeRequestContext) => Promise<unknown>;
  saveModelReference?: (input: DesktopSaveModelReferenceRequest, context?: DesktopBridgeRequestContext) => Promise<unknown>;
  downloadModel?: (input: DesktopDownloadModelRequest, context?: DesktopBridgeRequestContext) => Promise<unknown>;
  updateModelRecord?: (input: DesktopUpdateModelRecordRequest, context?: DesktopBridgeRequestContext) => Promise<unknown>;
  deleteModelRecord?: (input: DesktopDeleteModelRecordRequest, context?: DesktopBridgeRequestContext) => Promise<unknown>;
  trainModel?: (input: DesktopModelTrainingRequest, context?: DesktopBridgeRequestContext) => Promise<unknown>;
  readModelTrainingStatus?: (input: { runId: string }, context?: DesktopBridgeRequestContext) => Promise<unknown>;
  validateModel?: (input: DesktopValidateModelRequest, context?: DesktopBridgeRequestContext) => Promise<unknown>;
  publishModel?: (input: DesktopPublishModelRequest, context?: DesktopBridgeRequestContext) => Promise<unknown>;
}

declare global {
  interface Window {
    desktopApi?: DesktopApiBridge;
  }
}

export function getDesktopApi(): DesktopApiBridge {
  if (!window.desktopApi) {
    throw new Error("Desktop preload API is unavailable.");
  }

  return window.desktopApi;
}

export interface DesktopHuggingFaceTokenStatus {
  configured: boolean;
  maskedToken?: string;
}

export interface DesktopHuggingFaceNamespaceDataset {
  namespace: string;
  repository: string;
}

export interface DesktopHuggingFaceDatasetParquetFile {
  repository: string;
  path: string;
  revision: string;
  sizeBytes?: number;
}


export interface DesktopRegisteredArtifactFromRepo {
  artifactId: string;
  backing: {
    role: "imported-source";
    target: {
      provider: string;
      repository: string;
      path: string;
      revision: string;
      locator?: string;
    };
    verification: {
      exists: true;
      verifiedAt: string;
    };
  };
}

export interface DesktopUnregisteredArtifactBrowseItem {
  storageKey: string;
  relativePath: string;
  fileName: string;
  mediaType?: string;
  sizeBytes?: number;
}


export interface DesktopApplicationSettingsReadResult {
  values: ApplicationSettingValue[];
}

export interface DesktopApplicationSettingsDefinitionsResult {
  definitions: ApplicationSettingDefinition[];
}

export interface DesktopApplicationSettingsFilterInput {
  category?: ApplicationSettingCategory;
  keys?: string[];
}

export interface DesktopApplicationSettingUpdateResult {
  value: ApplicationSettingValue;
}

export interface DesktopResolvedModelDefaultResult {
  resolved: ResolvedModelDefault;
}

export type DesktopModelBrowseRequest = BrowseModelsRequest;
export type DesktopModelBrowseItem = ModelBrowseItem;
export interface DesktopModelBrowseResult {
  models: ModelBrowseItem[];
  nextCursor?: string;
}
export type DesktopModelDetailsRequest = GetModelDetailsRequest;
export interface DesktopModelDetailsResult {
  model: ModelDetails;
}
export type DesktopModelListRequest = ListModelsRequest;
export type DesktopModelInventoryRecord = ModelInventoryRecord;
export interface DesktopModelListResult {
  models: ModelInventoryRecord[];
  nextCursor?: string;
}
export type DesktopSaveModelReferenceRequest = SaveModelReferenceRequest;
export interface DesktopSaveModelReferenceResult {
  model: ModelInventoryRecord;
}
export type DesktopDownloadModelRequest = DownloadModelRequest;
export type DesktopDownloadModelResult = DownloadModelResult;
export type DesktopUpdateModelRecordRequest = UpdateModelRecordRequest;
export interface DesktopUpdateModelRecordResult {
  model: ModelInventoryRecord;
}
export type DesktopDeleteModelRecordRequest = DeleteModelRecordRequest;
export type DesktopDeleteModelRecordResult = DeleteModelRecordResult;


export type DesktopModelTrainingRequest = ModelTrainingRequest;
export type DesktopModelTrainingResult = ModelTrainingResult;
export type DesktopValidateModelRequest = ValidateModelRequest;
export type DesktopValidateModelResult = ValidateModelResult;
export type DesktopPublishModelRequest = PublishModelRequest;
export type DesktopPublishModelResult = PublishModelResult;
