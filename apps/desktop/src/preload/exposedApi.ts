import {
  DESKTOP_ARTIFACT_BROWSE_OPERATION,
  DESKTOP_ARTIFACT_BROWSE_REQUEST_CHANNEL,
  DESKTOP_ARTIFACT_BROWSE_RESPONSE_CHANNEL,
  DESKTOP_ARTIFACT_CONTENT_READ_OPERATION,
  DESKTOP_ARTIFACT_CONTENT_READ_REQUEST_CHANNEL,
  DESKTOP_ARTIFACT_CONTENT_READ_RESPONSE_CHANNEL,
  DESKTOP_ARTIFACT_MEDIA_VIEW_OPERATION,
  DESKTOP_ARTIFACT_MEDIA_VIEW_REQUEST_CHANNEL,
  DESKTOP_ARTIFACT_MEDIA_VIEW_RESPONSE_CHANNEL,
  DESKTOP_ARTIFACT_READ_OPERATION,
  DESKTOP_ARTIFACT_READ_REQUEST_CHANNEL,
  DESKTOP_ARTIFACT_READ_RESPONSE_CHANNEL,
  DESKTOP_ARTIFACT_PUBLISH_OPERATION,
  DESKTOP_ARTIFACT_PUBLISH_VERIFY_OPERATION,
  DESKTOP_ARTIFACT_SOURCE_VERIFY_OPERATION,
  DESKTOP_ARTIFACT_PUBLISH_REQUEST_CHANNEL,
  DESKTOP_ARTIFACT_PUBLISH_RESPONSE_CHANNEL,
  DESKTOP_ARTIFACT_PUBLISH_VERIFY_REQUEST_CHANNEL,
  DESKTOP_ARTIFACT_PUBLISH_VERIFY_RESPONSE_CHANNEL,
  DESKTOP_ARTIFACT_SOURCE_VERIFY_REQUEST_CHANNEL,
  DESKTOP_ARTIFACT_SOURCE_VERIFY_RESPONSE_CHANNEL,
  DESKTOP_ARTIFACT_REGISTER_FROM_REPO_OPERATION,
  DESKTOP_ARTIFACT_REGISTER_FROM_REPO_REQUEST_CHANNEL,
  DESKTOP_ARTIFACT_REGISTER_FROM_REPO_RESPONSE_CHANNEL,
  DESKTOP_ARTIFACT_LOCALIZE_FROM_REPO_OPERATION,
  DESKTOP_ARTIFACT_LOCALIZE_FROM_REPO_REQUEST_CHANNEL,
  DESKTOP_ARTIFACT_LOCALIZE_FROM_REPO_RESPONSE_CHANNEL,
  DESKTOP_ARTIFACT_UPLOAD_OPERATION,
  DESKTOP_ARTIFACT_UPLOAD_POLICY_READ_OPERATION,
  DESKTOP_ARTIFACT_UPLOAD_POLICY_READ_REQUEST_CHANNEL,
  DESKTOP_ARTIFACT_UPLOAD_POLICY_READ_RESPONSE_CHANNEL,
  DESKTOP_ARTIFACT_UPLOAD_REQUEST_CHANNEL,
  DESKTOP_ARTIFACT_UPLOAD_RESPONSE_CHANNEL,
  DESKTOP_ARTIFACT_UNREGISTERED_BROWSE_OPERATION,
  DESKTOP_ARTIFACT_UNREGISTERED_BROWSE_REQUEST_CHANNEL,
  DESKTOP_ARTIFACT_UNREGISTERED_BROWSE_RESPONSE_CHANNEL,
  DESKTOP_ARTIFACT_UNREGISTERED_REGISTER_OPERATION,
  DESKTOP_ARTIFACT_UNREGISTERED_REGISTER_REQUEST_CHANNEL,
  DESKTOP_ARTIFACT_UNREGISTERED_REGISTER_RESPONSE_CHANNEL,
  DESKTOP_ARTIFACT_UNREGISTERED_DELETE_OPERATION,
  DESKTOP_ARTIFACT_UNREGISTERED_DELETE_REQUEST_CHANNEL,
  DESKTOP_ARTIFACT_UNREGISTERED_DELETE_RESPONSE_CHANNEL,
  DESKTOP_ARTIFACT_REGISTERED_DELETE_OPERATION,
  DESKTOP_ARTIFACT_REGISTERED_DELETE_REQUEST_CHANNEL,
  DESKTOP_ARTIFACT_REGISTERED_DELETE_RESPONSE_CHANNEL,
  createDesktopArtifactBrowseRequest,
  createDesktopArtifactContentReadRequest,
  createDesktopArtifactMediaViewRequest,
  createDesktopArtifactReadRequest,
  createDesktopArtifactPublishRequest,
  createDesktopArtifactPublishVerifyRequest,
  createDesktopArtifactSourceVerifyRequest,
  createDesktopArtifactRegisterFromRepoRequest,
  createDesktopArtifactLocalizeFromRepoRequest,
  createDesktopArtifactUploadRequest,
  createDesktopArtifactUploadPolicyReadRequest,
  createDesktopArtifactUnregisteredBrowseRequest,
  createDesktopArtifactUnregisteredRegisterRequest,
  createDesktopArtifactUnregisteredDeleteRequest,
  createDesktopArtifactRegisteredDeleteRequest,
  type DesktopArtifactBrowseRequest,
  type DesktopArtifactBrowseResponse,
  type DesktopArtifactContentReadRequest,
  type DesktopArtifactContentReadResponse,
  type DesktopArtifactMediaViewRequest,
  type DesktopArtifactMediaViewResponse,
  type DesktopArtifactReadRequest,
  type DesktopArtifactReadResponse,
  type DesktopArtifactPublishRequest,
  type DesktopArtifactPublishResponse,
  type DesktopArtifactPublishVerifyRequest,
  type DesktopArtifactPublishVerifyResponse,
  type DesktopArtifactSourceVerifyRequest,
  type DesktopArtifactSourceVerifyResponse,
  type DesktopArtifactRegisterFromRepoRequest,
  type DesktopArtifactRegisterFromRepoResponse,
  type DesktopArtifactLocalizeFromRepoRequest,
  type DesktopArtifactLocalizeFromRepoResponse,
  type DesktopArtifactUploadRequest,
  type DesktopArtifactUploadResponse,
  type DesktopArtifactUploadPolicyReadResponse,
  type DesktopArtifactUnregisteredBrowseResponse,
  type DesktopArtifactUnregisteredRegisterResponse,
  type DesktopArtifactUnregisteredDeleteResponse,
  type DesktopArtifactRegisteredDeleteResponse,
  DESKTOP_HUGGING_FACE_TOKEN_GET_OPERATION,
  DESKTOP_HUGGING_FACE_TOKEN_GET_REQUEST_CHANNEL,
  DESKTOP_HUGGING_FACE_TOKEN_GET_RESPONSE_CHANNEL,
  DESKTOP_HUGGING_FACE_TOKEN_SET_OPERATION,
  DESKTOP_HUGGING_FACE_TOKEN_SET_REQUEST_CHANNEL,
  DESKTOP_HUGGING_FACE_TOKEN_SET_RESPONSE_CHANNEL,
  DESKTOP_HUGGING_FACE_TOKEN_CLEAR_OPERATION,
  DESKTOP_HUGGING_FACE_TOKEN_CLEAR_REQUEST_CHANNEL,
  DESKTOP_HUGGING_FACE_TOKEN_CLEAR_RESPONSE_CHANNEL,
  createDesktopHuggingFaceTokenGetRequest,
  createDesktopHuggingFaceTokenSetRequest,
  createDesktopHuggingFaceTokenClearRequest,
  type DesktopHuggingFaceTokenGetResponse,
  type DesktopHuggingFaceTokenSetResponse,
  type DesktopHuggingFaceTokenClearResponse,
  DESKTOP_HUGGING_FACE_NAMESPACE_DATASETS_BROWSE_OPERATION,
  DESKTOP_HUGGING_FACE_NAMESPACE_DATASETS_BROWSE_REQUEST_CHANNEL,
  DESKTOP_HUGGING_FACE_NAMESPACE_DATASETS_BROWSE_RESPONSE_CHANNEL,
  DESKTOP_HUGGING_FACE_DATASET_PARQUET_FILES_BROWSE_OPERATION,
  DESKTOP_HUGGING_FACE_DATASET_PARQUET_FILES_BROWSE_REQUEST_CHANNEL,
  DESKTOP_HUGGING_FACE_DATASET_PARQUET_FILES_BROWSE_RESPONSE_CHANNEL,
  createDesktopHuggingFaceNamespaceDatasetsBrowseRequest,
  createDesktopHuggingFaceDatasetParquetFilesBrowseRequest,
  type DesktopHuggingFaceNamespaceDatasetsBrowseResponse,
  type DesktopHuggingFaceDatasetParquetFilesBrowseResponse,
  DESKTOP_INGEST_WEBSITE_PAGE_OPERATION,
  DESKTOP_INGEST_WEBSITE_PAGE_REQUEST_CHANNEL,
  DESKTOP_INGEST_WEBSITE_PAGE_RESPONSE_CHANNEL,
  DESKTOP_INGEST_WEBSITE_PAGES_BATCH_OPERATION,
  DESKTOP_INGEST_WEBSITE_PAGES_BATCH_REQUEST_CHANNEL,
  DESKTOP_INGEST_WEBSITE_PAGES_BATCH_RESPONSE_CHANNEL,
  createDesktopIngestWebsitePageRequest,
  createDesktopIngestWebsitePagesBatchRequest,
  type DesktopIngestWebsitePageRequest,
  type DesktopIngestWebsitePageResponse,
  type DesktopIngestWebsitePagesBatchRequest,
  type DesktopIngestWebsitePagesBatchResponse,
  DESKTOP_DATASET_PREPARE_TRAINING_START_OPERATION,
  DESKTOP_DATASET_PREPARE_TRAINING_START_REQUEST_CHANNEL,
  DESKTOP_DATASET_PREPARE_TRAINING_START_RESPONSE_CHANNEL,
  DESKTOP_DATASET_PREPARE_TRAINING_TASK_READ_OPERATION,
  DESKTOP_DATASET_PREPARE_TRAINING_TASK_READ_REQUEST_CHANNEL,
  DESKTOP_DATASET_PREPARE_TRAINING_TASK_READ_RESPONSE_CHANNEL,
  DESKTOP_PYTHON_RUNTIME_CONTROL_OPERATION,
  DESKTOP_PYTHON_RUNTIME_CONTROL_REQUEST_CHANNEL,
  DESKTOP_PYTHON_RUNTIME_CONTROL_RESPONSE_CHANNEL,
  DESKTOP_PYTHON_RUNTIME_STATUS_READ_OPERATION,
  DESKTOP_PYTHON_RUNTIME_STATUS_READ_REQUEST_CHANNEL,
  DESKTOP_PYTHON_RUNTIME_STATUS_READ_RESPONSE_CHANNEL,
  DESKTOP_IMAGE_GENERATION_START_OPERATION,
  DESKTOP_IMAGE_GENERATION_START_REQUEST_CHANNEL,
  DESKTOP_IMAGE_GENERATION_START_RESPONSE_CHANNEL,
  DESKTOP_IMAGE_GENERATION_READ_OPERATION,
  DESKTOP_IMAGE_GENERATION_READ_REQUEST_CHANNEL,
  DESKTOP_IMAGE_GENERATION_READ_RESPONSE_CHANNEL,
  DESKTOP_IMAGE_GENERATION_CANCEL_OPERATION,
  DESKTOP_IMAGE_GENERATION_CANCEL_REQUEST_CHANNEL,
  DESKTOP_IMAGE_GENERATION_CANCEL_RESPONSE_CHANNEL,
  DESKTOP_IMAGE_GENERATION_FINALIZE_OPERATION,
  DESKTOP_IMAGE_GENERATION_FINALIZE_REQUEST_CHANNEL,
  DESKTOP_IMAGE_GENERATION_FINALIZE_RESPONSE_CHANNEL,
  DESKTOP_COMFYUI_INSTALL_STATUS_READ_OPERATION,
  DESKTOP_COMFYUI_INSTALL_STATUS_READ_REQUEST_CHANNEL,
  DESKTOP_COMFYUI_INSTALL_STATUS_READ_RESPONSE_CHANNEL,
  DESKTOP_COMFYUI_INSTALL_REPAIR_OPERATION,
  DESKTOP_COMFYUI_INSTALL_REPAIR_REQUEST_CHANNEL,
  DESKTOP_COMFYUI_INSTALL_REPAIR_RESPONSE_CHANNEL,
  createDesktopComfyUiInstallStatusRequest,
  createDesktopComfyUiRepairInstallRequest,
  createDesktopPrepareTrainingDatasetStartRequest,
  createDesktopPrepareTrainingDatasetTaskReadRequest,
  createDesktopPythonRuntimeControlRequest,
  createDesktopPythonRuntimeStatusReadRequest,
  createDesktopImageGenerationStartRequest,
  createDesktopImageGenerationReadRequest,
  createDesktopImageGenerationCancelRequest,
  createDesktopImageGenerationFinalizeRequest,
  type DesktopPrepareTrainingDatasetStartRequest,
  type DesktopPrepareTrainingDatasetStartResponse,
  type DesktopPrepareTrainingDatasetTaskReadRequest,
  type DesktopPrepareTrainingDatasetTaskReadResponse,
  type DesktopPythonRuntimeControlResponse,
  type DesktopPythonRuntimeStatusReadResponse,
  type DesktopImageGenerationStartRequest,
  type DesktopImageGenerationStartResponse,
  type DesktopImageGenerationReadRequest,
  type DesktopImageGenerationReadResponse,
  type DesktopImageGenerationCancelRequest,
  type DesktopImageGenerationCancelResponse,
  type DesktopImageGenerationFinalizeRequest,
  type DesktopImageGenerationFinalizeResponse,
  DESKTOP_APPLICATION_SETTINGS_LIST_DEFINITIONS_OPERATION,
  DESKTOP_APPLICATION_SETTINGS_LIST_DEFINITIONS_REQUEST_CHANNEL,
  DESKTOP_APPLICATION_SETTINGS_LIST_DEFINITIONS_RESPONSE_CHANNEL,
  DESKTOP_APPLICATION_SETTINGS_READ_OPERATION,
  DESKTOP_APPLICATION_SETTINGS_READ_REQUEST_CHANNEL,
  DESKTOP_APPLICATION_SETTINGS_READ_RESPONSE_CHANNEL,
  DESKTOP_APPLICATION_SETTINGS_UPDATE_OPERATION,
  DESKTOP_APPLICATION_SETTINGS_UPDATE_REQUEST_CHANNEL,
  DESKTOP_APPLICATION_SETTINGS_UPDATE_RESPONSE_CHANNEL,
  DESKTOP_APPLICATION_SETTINGS_CLEAR_OPERATION,
  DESKTOP_APPLICATION_SETTINGS_CLEAR_REQUEST_CHANNEL,
  DESKTOP_APPLICATION_SETTINGS_CLEAR_RESPONSE_CHANNEL,
  DESKTOP_APPLICATION_SETTINGS_RESOLVE_MODEL_DEFAULT_OPERATION,
  DESKTOP_APPLICATION_SETTINGS_RESOLVE_MODEL_DEFAULT_REQUEST_CHANNEL,
  DESKTOP_APPLICATION_SETTINGS_RESOLVE_MODEL_DEFAULT_RESPONSE_CHANNEL,
  createDesktopApplicationSettingsListDefinitionsRequest,
  createDesktopApplicationSettingsReadRequest,
  createDesktopApplicationSettingsUpdateRequest,
  createDesktopApplicationSettingsClearRequest,
  createDesktopApplicationSettingsResolveModelDefaultRequest,
  type DesktopApplicationSettingsListDefinitionsResponse,
  type DesktopApplicationSettingsReadResponse,
  type DesktopApplicationSettingsUpdateResponse,
  type DesktopApplicationSettingsClearResponse,
  type DesktopApplicationSettingsResolveModelDefaultResponse,
  DESKTOP_MODEL_BROWSE_OPERATION,
  DESKTOP_MODEL_BROWSE_REQUEST_CHANNEL,
  DESKTOP_MODEL_BROWSE_RESPONSE_CHANNEL,
  DESKTOP_MODEL_DETAILS_READ_OPERATION,
  DESKTOP_MODEL_DETAILS_READ_REQUEST_CHANNEL,
  DESKTOP_MODEL_DETAILS_READ_RESPONSE_CHANNEL,
  DESKTOP_MODEL_LIST_OPERATION,
  DESKTOP_MODEL_LIST_REQUEST_CHANNEL,
  DESKTOP_MODEL_LIST_RESPONSE_CHANNEL,
  DESKTOP_MODEL_REFERENCE_SAVE_OPERATION,
  DESKTOP_MODEL_REFERENCE_SAVE_REQUEST_CHANNEL,
  DESKTOP_MODEL_REFERENCE_SAVE_RESPONSE_CHANNEL,
  DESKTOP_MODEL_DOWNLOAD_OPERATION,
  DESKTOP_MODEL_DOWNLOAD_REQUEST_CHANNEL,
  DESKTOP_MODEL_DOWNLOAD_RESPONSE_CHANNEL,
  DESKTOP_MODEL_RECORD_UPDATE_OPERATION,
  DESKTOP_MODEL_RECORD_UPDATE_REQUEST_CHANNEL,
  DESKTOP_MODEL_RECORD_UPDATE_RESPONSE_CHANNEL,
  DESKTOP_MODEL_RECORD_DELETE_OPERATION,
  DESKTOP_MODEL_RECORD_DELETE_REQUEST_CHANNEL,
  DESKTOP_MODEL_RECORD_DELETE_RESPONSE_CHANNEL,
  createDesktopModelBrowseRequest,
  createDesktopModelDetailsReadRequest,
  createDesktopModelListRequest,
  createDesktopModelReferenceSaveRequest,
  createDesktopModelDownloadRequest,
  createDesktopModelRecordUpdateRequest,
  createDesktopModelRecordDeleteRequest,
  createDesktopModelTrainRequest,
  createDesktopModelTrainStatusRequest,
  createDesktopModelValidateRequest,
  createDesktopModelPublishRequest,
  type DesktopModelBrowseResponse,
  type DesktopModelDetailsReadResponse,
  type DesktopModelListResponse,
  type DesktopModelReferenceSaveResponse,
  type DesktopModelDownloadResponse,
  type DesktopModelRecordUpdateResponse,
  type DesktopModelRecordDeleteResponse,
  type DesktopModelTrainResponse,
  type DesktopModelTrainStatusResponse,
  type DesktopModelValidateResponse,
  type DesktopModelPublishResponse,
  DESKTOP_MODEL_TRAIN_OPERATION,
  DESKTOP_MODEL_TRAIN_REQUEST_CHANNEL,
  DESKTOP_MODEL_TRAIN_RESPONSE_CHANNEL,
  DESKTOP_MODEL_TRAIN_STATUS_OPERATION,
  DESKTOP_MODEL_TRAIN_STATUS_REQUEST_CHANNEL,
  DESKTOP_MODEL_TRAIN_STATUS_RESPONSE_CHANNEL,
  DESKTOP_MODEL_VALIDATE_OPERATION,
  DESKTOP_MODEL_VALIDATE_REQUEST_CHANNEL,
  DESKTOP_MODEL_VALIDATE_RESPONSE_CHANNEL,
  DESKTOP_MODEL_PUBLISH_OPERATION,
  DESKTOP_MODEL_PUBLISH_REQUEST_CHANNEL,
  DESKTOP_MODEL_PUBLISH_RESPONSE_CHANNEL,
} from "../../../../modules/contracts/ipc";
import type { ArtifactFamily } from "../../../../modules/domain/artifact";
import type {
  ListApplicationSettingDefinitionsRequest,
  ReadApplicationSettingsRequest,
  ResolveModelDefaultRequest,
  UpdateApplicationSettingRequest,
} from "../../../../modules/contracts/settings";

const DEFAULT_UPLOAD_SOURCE = "desktop.renderer.artifact-upload.form";
const DEFAULT_ARTIFACT_SOURCE = "desktop.renderer.artifact-browser";

export interface IpcRendererInvokePort {
  invoke: (channel: string, request: unknown) => Promise<unknown>;
}

export interface DesktopArtifactUploadBridgeInput {
  fileName: string;
  mediaType: string;
  bytes: Uint8Array;
}

export interface DesktopArtifactBrowserLocator {
  storageKey: string;
}

export interface DesktopArtifactUploadBridgeContext {
  requestId?: string;
  correlationId?: string;
}

export interface DesktopPreloadApi {
  getHuggingFaceTokenStatus: (
    context?: DesktopArtifactUploadBridgeContext,
  ) => Promise<DesktopHuggingFaceTokenGetResponse>;
  setHuggingFaceToken: (
    input: { token: string },
    context?: DesktopArtifactUploadBridgeContext,
  ) => Promise<DesktopHuggingFaceTokenSetResponse>;
  clearHuggingFaceToken: (
    context?: DesktopArtifactUploadBridgeContext,
  ) => Promise<DesktopHuggingFaceTokenClearResponse>;
  browseHuggingFaceNamespaceDatasets: (
    input: { namespace: string },
    context?: DesktopArtifactUploadBridgeContext,
  ) => Promise<DesktopHuggingFaceNamespaceDatasetsBrowseResponse>;
  browseHuggingFaceDatasetParquetFiles: (
    input: { repository: string; revision?: string },
    context?: DesktopArtifactUploadBridgeContext,
  ) => Promise<DesktopHuggingFaceDatasetParquetFilesBrowseResponse>;
  uploadArtifact: (
    input: DesktopArtifactUploadBridgeInput,
    context?: DesktopArtifactUploadBridgeContext,
  ) => Promise<DesktopArtifactUploadResponse>;
  getArtifactUploadPolicy: (
    context?: DesktopArtifactUploadBridgeContext,
  ) => Promise<DesktopArtifactUploadPolicyReadResponse>;
  ingestWebsitePage: (
    input: {
      url: string;
      label?: string;
      mode?: "automatic" | "rendered";
    },
    context?: DesktopArtifactUploadBridgeContext,
  ) => Promise<DesktopIngestWebsitePageResponse>;
  ingestWebsitePagesBatch: (
    input: {
      targets: Array<{ url: string; label?: string }>;
      mode?: "automatic" | "rendered";
    },
    context?: DesktopArtifactUploadBridgeContext,
  ) => Promise<DesktopIngestWebsitePagesBatchResponse>;
  startPrepareTrainingDataset: (
    input: {
      sourceArtifactIds: string[];
      recipe: DesktopPrepareTrainingDatasetStartRequest["payload"]["command"]["recipe"];
      split: DesktopPrepareTrainingDatasetStartRequest["payload"]["command"]["split"];
      output: DesktopPrepareTrainingDatasetStartRequest["payload"]["command"]["output"];
    },
    context?: DesktopArtifactUploadBridgeContext,
  ) => Promise<DesktopPrepareTrainingDatasetStartResponse>;
  readPrepareTrainingDatasetTask: (
    input: { requestId: string },
    context?: DesktopArtifactUploadBridgeContext,
  ) => Promise<DesktopPrepareTrainingDatasetTaskReadResponse>;
  readPythonRuntimeStatus: (
    context?: DesktopArtifactUploadBridgeContext,
  ) => Promise<DesktopPythonRuntimeStatusReadResponse>;
  controlPythonRuntime: (
    input: { action: "start" | "stop" | "restart" | "unload-model" | "clear-logs" },
    context?: DesktopArtifactUploadBridgeContext,
  ) => Promise<DesktopPythonRuntimeControlResponse>;
  startImageGeneration: (input: DesktopImageGenerationStartRequest["payload"], context?: DesktopArtifactUploadBridgeContext) => Promise<DesktopImageGenerationStartResponse>;
  readImageGeneration: (input: { requestId: string }, context?: DesktopArtifactUploadBridgeContext) => Promise<DesktopImageGenerationReadResponse>;
  cancelImageGeneration: (input: { requestId: string }, context?: DesktopArtifactUploadBridgeContext) => Promise<DesktopImageGenerationCancelResponse>;
  finalizeImageGenerationIfCompleted: (input: { requestId: string }, context?: DesktopArtifactUploadBridgeContext) => Promise<DesktopImageGenerationFinalizeResponse>;
  readComfyUiInstallStatus: (input?: { installRoot?: string }, context?: DesktopArtifactUploadBridgeContext) => Promise<any>;
  repairComfyUiInstall: (input?: { installRoot?: string; allowUpdate?: boolean; forceRepair?: boolean }, context?: DesktopArtifactUploadBridgeContext) => Promise<any>;
  browseArtifacts: (
    input?: { artifactFamily?: ArtifactFamily },
    context?: DesktopArtifactUploadBridgeContext,
  ) => Promise<DesktopArtifactBrowseResponse>;
  browseUnregisteredArtifacts: (
    context?: DesktopArtifactUploadBridgeContext,
  ) => Promise<DesktopArtifactUnregisteredBrowseResponse>;
  registerUnregisteredArtifact: (
    input: { storageKey: string },
    context?: DesktopArtifactUploadBridgeContext,
  ) => Promise<DesktopArtifactUnregisteredRegisterResponse>;
  deleteUnregisteredArtifact: (
    input: { storageKey: string },
    context?: DesktopArtifactUploadBridgeContext,
  ) => Promise<DesktopArtifactUnregisteredDeleteResponse>;
  deleteRegisteredArtifact: (
    input: { storageKey: string },
    context?: DesktopArtifactUploadBridgeContext,
  ) => Promise<DesktopArtifactRegisteredDeleteResponse>;
  readArtifactDetail: (
    locator: DesktopArtifactBrowserLocator,
    context?: DesktopArtifactUploadBridgeContext,
  ) => Promise<DesktopArtifactReadResponse>;
  readArtifactContentDescriptor: (
    locator: DesktopArtifactBrowserLocator,
    context?: DesktopArtifactUploadBridgeContext,
  ) => Promise<DesktopArtifactContentReadResponse>;
  readArtifactViewerMedia: (
    locator: DesktopArtifactBrowserLocator,
    context?: DesktopArtifactUploadBridgeContext,
  ) => Promise<DesktopArtifactMediaViewResponse>;
  publishArtifactToRepo: (
    input: {
      artifactId: string;
      target: {
        provider: string;
        repository: string;
        path: string;
        revision?: string;
      };
      mediaType?: string;
    },
    context?: DesktopArtifactUploadBridgeContext,
  ) => Promise<DesktopArtifactPublishResponse>;
  verifyPublishedArtifactBacking: (
    input: {
      artifactId: string;
    },
    context?: DesktopArtifactUploadBridgeContext,
  ) => Promise<DesktopArtifactPublishVerifyResponse>;
  verifyImportedArtifactSourceBacking: (
    input: {
      artifactId: string;
    },
    context?: DesktopArtifactUploadBridgeContext,
  ) => Promise<DesktopArtifactSourceVerifyResponse>;
  registerArtifactFromRepo: (
    input: {
      target: {
        provider: string;
        repository: string;
        path: string;
        revision?: string;
      };
      artifactFamily?: ArtifactFamily;
      mediaType?: string;
    },
    context?: DesktopArtifactUploadBridgeContext,
  ) => Promise<DesktopArtifactRegisterFromRepoResponse>;
  localizeArtifactFromRepo: (
    input: {
      artifactId: string;
    },
    context?: DesktopArtifactUploadBridgeContext,
  ) => Promise<DesktopArtifactLocalizeFromRepoResponse>;
  listApplicationSettingDefinitions: (
    input?: ListApplicationSettingDefinitionsRequest,
    context?: DesktopArtifactUploadBridgeContext,
  ) => Promise<DesktopApplicationSettingsListDefinitionsResponse>;
  readApplicationSettings: (
    input?: ReadApplicationSettingsRequest,
    context?: DesktopArtifactUploadBridgeContext,
  ) => Promise<DesktopApplicationSettingsReadResponse>;
  updateApplicationSetting: (
    input: UpdateApplicationSettingRequest,
    context?: DesktopArtifactUploadBridgeContext,
  ) => Promise<DesktopApplicationSettingsUpdateResponse>;
  clearApplicationSetting: (
    input: { key: string },
    context?: DesktopArtifactUploadBridgeContext,
  ) => Promise<DesktopApplicationSettingsClearResponse>;
  resolveApplicationModelDefault: (
    input: ResolveModelDefaultRequest,
    context?: DesktopArtifactUploadBridgeContext,
  ) => Promise<DesktopApplicationSettingsResolveModelDefaultResponse>;
  resolveModelDefault: (
    input: ResolveModelDefaultRequest,
    context?: DesktopArtifactUploadBridgeContext,
  ) => Promise<DesktopApplicationSettingsResolveModelDefaultResponse>;
  browseModels: (
    input: Parameters<typeof createDesktopModelBrowseRequest>[0],
    context?: DesktopArtifactUploadBridgeContext,
  ) => Promise<DesktopModelBrowseResponse>;
  getModelDetails: (
    input: Parameters<typeof createDesktopModelDetailsReadRequest>[0],
    context?: DesktopArtifactUploadBridgeContext,
  ) => Promise<DesktopModelDetailsReadResponse>;
  listModels: (
    input?: Parameters<typeof createDesktopModelListRequest>[0],
    context?: DesktopArtifactUploadBridgeContext,
  ) => Promise<DesktopModelListResponse>;
  saveModelReference: (
    input: Parameters<typeof createDesktopModelReferenceSaveRequest>[0],
    context?: DesktopArtifactUploadBridgeContext,
  ) => Promise<DesktopModelReferenceSaveResponse>;
  downloadModel: (
    input: Parameters<typeof createDesktopModelDownloadRequest>[0],
    context?: DesktopArtifactUploadBridgeContext,
  ) => Promise<DesktopModelDownloadResponse>;
  updateModelRecord: (
    input: Parameters<typeof createDesktopModelRecordUpdateRequest>[0],
    context?: DesktopArtifactUploadBridgeContext,
  ) => Promise<DesktopModelRecordUpdateResponse>;
  deleteModelRecord: (
    input: Parameters<typeof createDesktopModelRecordDeleteRequest>[0],
    context?: DesktopArtifactUploadBridgeContext,
  ) => Promise<DesktopModelRecordDeleteResponse>;
  trainModel: (
    input: Parameters<typeof createDesktopModelTrainRequest>[0],
    context?: DesktopArtifactUploadBridgeContext,
  ) => Promise<DesktopModelTrainResponse>;
  readModelTrainingStatus: (
    input: Parameters<typeof createDesktopModelTrainStatusRequest>[0],
    context?: DesktopArtifactUploadBridgeContext,
  ) => Promise<DesktopModelTrainStatusResponse>;
  validateModel: (
    input: Parameters<typeof createDesktopModelValidateRequest>[0],
    context?: DesktopArtifactUploadBridgeContext,
  ) => Promise<DesktopModelValidateResponse>;
  publishModel: (
    input: Parameters<typeof createDesktopModelPublishRequest>[0],
    context?: DesktopArtifactUploadBridgeContext,
  ) => Promise<DesktopModelPublishResponse>;
}

export interface CreateDesktopPreloadApiDependencies {
  ipcRenderer: IpcRendererInvokePort;
  uploadSource?: string;
  artifactSource?: string;
}

function assertDesktopEnvelopeResponse<TResponse extends { operation: string; channel: string }>(
  response: unknown,
  options: {
    operation: string;
    channel: string;
    message: string;
  },
): TResponse {
  if (
    typeof response !== "object"
    || response === null
    || !("operation" in response)
    || !("channel" in response)
    || (response as { operation?: string }).operation !== options.operation
    || (response as { channel?: string }).channel !== options.channel
  ) {
    throw new Error(options.message);
  }

  return response as TResponse;
}


export function createDesktopPreloadApi(
  dependencies: CreateDesktopPreloadApiDependencies,
): DesktopPreloadApi {
  const uploadSource = dependencies.uploadSource ?? DEFAULT_UPLOAD_SOURCE;
  const artifactSource = dependencies.artifactSource ?? DEFAULT_ARTIFACT_SOURCE;

  return {
    async getHuggingFaceTokenStatus(context = {}) {
      const request = createDesktopHuggingFaceTokenGetRequest(context);
      const response = await dependencies.ipcRenderer.invoke(
        DESKTOP_HUGGING_FACE_TOKEN_GET_REQUEST_CHANNEL.value,
        request,
      );

      return assertDesktopEnvelopeResponse<DesktopHuggingFaceTokenGetResponse>(response, {
        operation: DESKTOP_HUGGING_FACE_TOKEN_GET_OPERATION,
        channel: DESKTOP_HUGGING_FACE_TOKEN_GET_RESPONSE_CHANNEL.value,
        message: "Received invalid desktop Hugging Face token status IPC response envelope.",
      });
    },

    async setHuggingFaceToken(input, context = {}) {
      const request = createDesktopHuggingFaceTokenSetRequest(
        { token: input.token },
        context,
      );
      const response = await dependencies.ipcRenderer.invoke(
        DESKTOP_HUGGING_FACE_TOKEN_SET_REQUEST_CHANNEL.value,
        request,
      );

      return assertDesktopEnvelopeResponse<DesktopHuggingFaceTokenSetResponse>(response, {
        operation: DESKTOP_HUGGING_FACE_TOKEN_SET_OPERATION,
        channel: DESKTOP_HUGGING_FACE_TOKEN_SET_RESPONSE_CHANNEL.value,
        message: "Received invalid desktop Hugging Face token set IPC response envelope.",
      });
    },

    async clearHuggingFaceToken(context = {}) {
      const request = createDesktopHuggingFaceTokenClearRequest(context);
      const response = await dependencies.ipcRenderer.invoke(
        DESKTOP_HUGGING_FACE_TOKEN_CLEAR_REQUEST_CHANNEL.value,
        request,
      );

      return assertDesktopEnvelopeResponse<DesktopHuggingFaceTokenClearResponse>(response, {
        operation: DESKTOP_HUGGING_FACE_TOKEN_CLEAR_OPERATION,
        channel: DESKTOP_HUGGING_FACE_TOKEN_CLEAR_RESPONSE_CHANNEL.value,
        message: "Received invalid desktop Hugging Face token clear IPC response envelope.",
      });
    },

    async browseHuggingFaceNamespaceDatasets(input, context = {}) {
      const request = createDesktopHuggingFaceNamespaceDatasetsBrowseRequest(
        {
          namespace: input.namespace,
          boundary: {
            host: "desktop",
            source: artifactSource,
          },
        },
        context,
      );
      const response = await dependencies.ipcRenderer.invoke(
        DESKTOP_HUGGING_FACE_NAMESPACE_DATASETS_BROWSE_REQUEST_CHANNEL.value,
        request,
      );

      return assertDesktopEnvelopeResponse<DesktopHuggingFaceNamespaceDatasetsBrowseResponse>(response, {
        operation: DESKTOP_HUGGING_FACE_NAMESPACE_DATASETS_BROWSE_OPERATION,
        channel: DESKTOP_HUGGING_FACE_NAMESPACE_DATASETS_BROWSE_RESPONSE_CHANNEL.value,
        message: "Received invalid desktop Hugging Face namespace datasets IPC response envelope.",
      });
    },

    async browseHuggingFaceDatasetParquetFiles(input, context = {}) {
      const request = createDesktopHuggingFaceDatasetParquetFilesBrowseRequest(
        {
          repository: input.repository,
          revision: input.revision,
          boundary: {
            host: "desktop",
            source: artifactSource,
          },
        },
        context,
      );
      const response = await dependencies.ipcRenderer.invoke(
        DESKTOP_HUGGING_FACE_DATASET_PARQUET_FILES_BROWSE_REQUEST_CHANNEL.value,
        request,
      );

      return assertDesktopEnvelopeResponse<DesktopHuggingFaceDatasetParquetFilesBrowseResponse>(response, {
        operation: DESKTOP_HUGGING_FACE_DATASET_PARQUET_FILES_BROWSE_OPERATION,
        channel: DESKTOP_HUGGING_FACE_DATASET_PARQUET_FILES_BROWSE_RESPONSE_CHANNEL.value,
        message: "Received invalid desktop Hugging Face dataset parquet-files IPC response envelope.",
      });
    },

    async uploadArtifact(input, context = {}) {
      const request: DesktopArtifactUploadRequest = createDesktopArtifactUploadRequest(
        {
          fileName: input.fileName,
          mediaType: input.mediaType,
          bytes: input.bytes,
          boundary: {
            host: "desktop",
            source: uploadSource,
          },
        },
        {
          requestId: context.requestId,
          correlationId: context.correlationId,
        },
      );
      const response = await dependencies.ipcRenderer.invoke(
        DESKTOP_ARTIFACT_UPLOAD_REQUEST_CHANNEL.value,
        request,
      );

      return assertDesktopEnvelopeResponse<DesktopArtifactUploadResponse>(response, {
        operation: DESKTOP_ARTIFACT_UPLOAD_OPERATION,
        channel: DESKTOP_ARTIFACT_UPLOAD_RESPONSE_CHANNEL.value,
        message: "Received invalid desktop artifact upload IPC response envelope.",
      });
    },

    async getArtifactUploadPolicy(context = {}) {
      const request = createDesktopArtifactUploadPolicyReadRequest(
        {
          boundary: {
            host: "desktop",
            source: uploadSource,
          },
        },
        context,
      );
      const response = await dependencies.ipcRenderer.invoke(
        DESKTOP_ARTIFACT_UPLOAD_POLICY_READ_REQUEST_CHANNEL.value,
        request,
      );

      return assertDesktopEnvelopeResponse<DesktopArtifactUploadPolicyReadResponse>(response, {
        operation: DESKTOP_ARTIFACT_UPLOAD_POLICY_READ_OPERATION,
        channel: DESKTOP_ARTIFACT_UPLOAD_POLICY_READ_RESPONSE_CHANNEL.value,
        message: "Received invalid desktop artifact upload policy IPC response envelope.",
      });
    },

    async ingestWebsitePage(input, context = {}) {
      const request: DesktopIngestWebsitePageRequest = createDesktopIngestWebsitePageRequest(
        {
          request: {
            url: input.url,
            label: input.label,
            mode: input.mode,
          },
          boundary: {
            host: "desktop",
            source: uploadSource,
          },
        },
        context,
      );
      const response = await dependencies.ipcRenderer.invoke(
        DESKTOP_INGEST_WEBSITE_PAGE_REQUEST_CHANNEL.value,
        request,
      );

      return assertDesktopEnvelopeResponse<DesktopIngestWebsitePageResponse>(response, {
        operation: DESKTOP_INGEST_WEBSITE_PAGE_OPERATION,
        channel: DESKTOP_INGEST_WEBSITE_PAGE_RESPONSE_CHANNEL.value,
        message: "Received invalid desktop website-page ingestion IPC response envelope.",
      });
    },

    async ingestWebsitePagesBatch(input, context = {}) {
      const request: DesktopIngestWebsitePagesBatchRequest = createDesktopIngestWebsitePagesBatchRequest(
        {
          request: {
            targets: input.targets,
            mode: input.mode,
          },
          boundary: {
            host: "desktop",
            source: uploadSource,
          },
        },
        context,
      );
      const response = await dependencies.ipcRenderer.invoke(
        DESKTOP_INGEST_WEBSITE_PAGES_BATCH_REQUEST_CHANNEL.value,
        request,
      );

      return assertDesktopEnvelopeResponse<DesktopIngestWebsitePagesBatchResponse>(response, {
        operation: DESKTOP_INGEST_WEBSITE_PAGES_BATCH_OPERATION,
        channel: DESKTOP_INGEST_WEBSITE_PAGES_BATCH_RESPONSE_CHANNEL.value,
        message: "Received invalid desktop website-pages batch ingestion IPC response envelope.",
      });
    },

    async startPrepareTrainingDataset(input, context = {}) {
      const request: DesktopPrepareTrainingDatasetStartRequest = createDesktopPrepareTrainingDatasetStartRequest(
        {
          command: {
            sourceArtifactIds: input.sourceArtifactIds,
            recipe: input.recipe,
            split: input.split,
            output: input.output,
          },
          boundary: {
            host: "desktop",
            source: "desktop.renderer.dataset-preparation",
          },
        },
        context,
      );
      const response = await dependencies.ipcRenderer.invoke(
        DESKTOP_DATASET_PREPARE_TRAINING_START_REQUEST_CHANNEL.value,
        request,
      );

      return assertDesktopEnvelopeResponse<DesktopPrepareTrainingDatasetStartResponse>(response, {
        operation: DESKTOP_DATASET_PREPARE_TRAINING_START_OPERATION,
        channel: DESKTOP_DATASET_PREPARE_TRAINING_START_RESPONSE_CHANNEL.value,
        message: "Received invalid desktop dataset preparation start IPC response envelope.",
      });
    },

    async readPrepareTrainingDatasetTask(input, context = {}) {
      const request: DesktopPrepareTrainingDatasetTaskReadRequest = createDesktopPrepareTrainingDatasetTaskReadRequest(
        {
          requestId: input.requestId,
          boundary: {
            host: "desktop",
            source: "desktop.renderer.dataset-preparation",
          },
        },
        context,
      );
      const response = await dependencies.ipcRenderer.invoke(
        DESKTOP_DATASET_PREPARE_TRAINING_TASK_READ_REQUEST_CHANNEL.value,
        request,
      );

      return assertDesktopEnvelopeResponse<DesktopPrepareTrainingDatasetTaskReadResponse>(response, {
        operation: DESKTOP_DATASET_PREPARE_TRAINING_TASK_READ_OPERATION,
        channel: DESKTOP_DATASET_PREPARE_TRAINING_TASK_READ_RESPONSE_CHANNEL.value,
        message: "Received invalid desktop dataset preparation task-read IPC response envelope.",
      });
    },

    async readPythonRuntimeStatus(context = {}) {
      const request = createDesktopPythonRuntimeStatusReadRequest(
        {
          boundary: {
            host: "desktop",
            source: "desktop.renderer.python-runtime-footer",
          },
        },
        context,
      );
      const response = await dependencies.ipcRenderer.invoke(
        DESKTOP_PYTHON_RUNTIME_STATUS_READ_REQUEST_CHANNEL.value,
        request,
      );

      return assertDesktopEnvelopeResponse<DesktopPythonRuntimeStatusReadResponse>(response, {
        operation: DESKTOP_PYTHON_RUNTIME_STATUS_READ_OPERATION,
        channel: DESKTOP_PYTHON_RUNTIME_STATUS_READ_RESPONSE_CHANNEL.value,
        message: "Received invalid desktop python runtime status IPC response envelope.",
      });
    },

    async controlPythonRuntime(input, context = {}) {
      const request = createDesktopPythonRuntimeControlRequest(
        {
          action: input.action,
          boundary: {
            host: "desktop",
            source: "desktop.renderer.python-runtime-footer",
          },
        },
        context,
      );
      const response = await dependencies.ipcRenderer.invoke(
        DESKTOP_PYTHON_RUNTIME_CONTROL_REQUEST_CHANNEL.value,
        request,
      );

      return assertDesktopEnvelopeResponse<DesktopPythonRuntimeControlResponse>(response, {
        operation: DESKTOP_PYTHON_RUNTIME_CONTROL_OPERATION,
        channel: DESKTOP_PYTHON_RUNTIME_CONTROL_RESPONSE_CHANNEL.value,
        message: "Received invalid desktop python runtime control IPC response envelope.",
      });
    },
    async startImageGeneration(input, context = {}) {
      const request = createDesktopImageGenerationStartRequest(input, context);
      const response = await dependencies.ipcRenderer.invoke(DESKTOP_IMAGE_GENERATION_START_REQUEST_CHANNEL.value, request);
      return assertDesktopEnvelopeResponse<DesktopImageGenerationStartResponse>(response, { operation: DESKTOP_IMAGE_GENERATION_START_OPERATION, channel: DESKTOP_IMAGE_GENERATION_START_RESPONSE_CHANNEL.value, message: "Received invalid desktop image generation start IPC response envelope." });
    },
    async readImageGeneration(input, context = {}) {
      const request = createDesktopImageGenerationReadRequest(input, context);
      const response = await dependencies.ipcRenderer.invoke(DESKTOP_IMAGE_GENERATION_READ_REQUEST_CHANNEL.value, request);
      return assertDesktopEnvelopeResponse<DesktopImageGenerationReadResponse>(response, { operation: DESKTOP_IMAGE_GENERATION_READ_OPERATION, channel: DESKTOP_IMAGE_GENERATION_READ_RESPONSE_CHANNEL.value, message: "Received invalid desktop image generation read IPC response envelope." });
    },
    async cancelImageGeneration(input, context = {}) {
      const request = createDesktopImageGenerationCancelRequest(input, context);
      const response = await dependencies.ipcRenderer.invoke(DESKTOP_IMAGE_GENERATION_CANCEL_REQUEST_CHANNEL.value, request);
      return assertDesktopEnvelopeResponse<DesktopImageGenerationCancelResponse>(response, { operation: DESKTOP_IMAGE_GENERATION_CANCEL_OPERATION, channel: DESKTOP_IMAGE_GENERATION_CANCEL_RESPONSE_CHANNEL.value, message: "Received invalid desktop image generation cancel IPC response envelope." });
    },
    async finalizeImageGenerationIfCompleted(input, context = {}) {
      const request = createDesktopImageGenerationFinalizeRequest(input, context);
      const response = await dependencies.ipcRenderer.invoke(DESKTOP_IMAGE_GENERATION_FINALIZE_REQUEST_CHANNEL.value, request);
      return assertDesktopEnvelopeResponse<DesktopImageGenerationFinalizeResponse>(response, { operation: DESKTOP_IMAGE_GENERATION_FINALIZE_OPERATION, channel: DESKTOP_IMAGE_GENERATION_FINALIZE_RESPONSE_CHANNEL.value, message: "Received invalid desktop image generation finalization IPC response envelope." });
    },
    async readComfyUiInstallStatus(input = {}, context = {}) {
      const request = createDesktopComfyUiInstallStatusRequest(input, context);
      const response = await dependencies.ipcRenderer.invoke(DESKTOP_COMFYUI_INSTALL_STATUS_READ_REQUEST_CHANNEL.value, request);
      return assertDesktopEnvelopeResponse(response, { operation: DESKTOP_COMFYUI_INSTALL_STATUS_READ_OPERATION, channel: DESKTOP_COMFYUI_INSTALL_STATUS_READ_RESPONSE_CHANNEL.value, message: "Received invalid desktop ComfyUI install status IPC response envelope." });
    },
    async repairComfyUiInstall(input = {}, context = {}) {
      const request = createDesktopComfyUiRepairInstallRequest(input, context);
      const response = await dependencies.ipcRenderer.invoke(DESKTOP_COMFYUI_INSTALL_REPAIR_REQUEST_CHANNEL.value, request);
      return assertDesktopEnvelopeResponse(response, { operation: DESKTOP_COMFYUI_INSTALL_REPAIR_OPERATION, channel: DESKTOP_COMFYUI_INSTALL_REPAIR_RESPONSE_CHANNEL.value, message: "Received invalid desktop ComfyUI repair IPC response envelope." });
    },

    async browseArtifacts(input = {}, context = {}) {
      const request: DesktopArtifactBrowseRequest = createDesktopArtifactBrowseRequest(
        {
          artifactFamily: input.artifactFamily,
          boundary: {
            host: "desktop",
            source: artifactSource,
          },
        },
        context,
      );
      const response = await dependencies.ipcRenderer.invoke(
        DESKTOP_ARTIFACT_BROWSE_REQUEST_CHANNEL.value,
        request,
      );

      return assertDesktopEnvelopeResponse<DesktopArtifactBrowseResponse>(response, {
        operation: DESKTOP_ARTIFACT_BROWSE_OPERATION,
        channel: DESKTOP_ARTIFACT_BROWSE_RESPONSE_CHANNEL.value,
        message: "Received invalid desktop artifact browse IPC response envelope.",
      });
    },

    async browseUnregisteredArtifacts(context = {}) {
      const request = createDesktopArtifactUnregisteredBrowseRequest({
        boundary: { host: "desktop", source: artifactSource },
      }, context);
      const response = await dependencies.ipcRenderer.invoke(
        DESKTOP_ARTIFACT_UNREGISTERED_BROWSE_REQUEST_CHANNEL.value,
        request,
      );

      return assertDesktopEnvelopeResponse<DesktopArtifactUnregisteredBrowseResponse>(response, {
        operation: DESKTOP_ARTIFACT_UNREGISTERED_BROWSE_OPERATION,
        channel: DESKTOP_ARTIFACT_UNREGISTERED_BROWSE_RESPONSE_CHANNEL.value,
        message: "Received invalid desktop unregistered artifact browse IPC response envelope.",
      });
    },

    async registerUnregisteredArtifact(input, context = {}) {
      const request = createDesktopArtifactUnregisteredRegisterRequest({
        storageKey: input.storageKey,
        boundary: { host: "desktop", source: artifactSource },
      }, context);
      const response = await dependencies.ipcRenderer.invoke(
        DESKTOP_ARTIFACT_UNREGISTERED_REGISTER_REQUEST_CHANNEL.value,
        request,
      );

      return assertDesktopEnvelopeResponse<DesktopArtifactUnregisteredRegisterResponse>(response, {
        operation: DESKTOP_ARTIFACT_UNREGISTERED_REGISTER_OPERATION,
        channel: DESKTOP_ARTIFACT_UNREGISTERED_REGISTER_RESPONSE_CHANNEL.value,
        message: "Received invalid desktop unregistered artifact register IPC response envelope.",
      });
    },

    async deleteUnregisteredArtifact(input, context = {}) {
      const request = createDesktopArtifactUnregisteredDeleteRequest({
        storageKey: input.storageKey,
        boundary: { host: "desktop", source: artifactSource },
      }, context);
      const response = await dependencies.ipcRenderer.invoke(
        DESKTOP_ARTIFACT_UNREGISTERED_DELETE_REQUEST_CHANNEL.value,
        request,
      );

      return assertDesktopEnvelopeResponse<DesktopArtifactUnregisteredDeleteResponse>(response, {
        operation: DESKTOP_ARTIFACT_UNREGISTERED_DELETE_OPERATION,
        channel: DESKTOP_ARTIFACT_UNREGISTERED_DELETE_RESPONSE_CHANNEL.value,
        message: "Received invalid desktop unregistered artifact delete IPC response envelope.",
      });
    },


    async deleteRegisteredArtifact(input, context = {}) {
      const request = createDesktopArtifactRegisteredDeleteRequest({
        storageKey: input.storageKey,
        boundary: { host: "desktop", source: artifactSource },
      }, context);
      const response = await dependencies.ipcRenderer.invoke(
        DESKTOP_ARTIFACT_REGISTERED_DELETE_REQUEST_CHANNEL.value,
        request,
      );

      return assertDesktopEnvelopeResponse<DesktopArtifactRegisteredDeleteResponse>(response, {
        operation: DESKTOP_ARTIFACT_REGISTERED_DELETE_OPERATION,
        channel: DESKTOP_ARTIFACT_REGISTERED_DELETE_RESPONSE_CHANNEL.value,
        message: "Received invalid desktop registered artifact delete IPC response envelope.",
      });
    },

    async readArtifactDetail(locator, context = {}) {
      const request: DesktopArtifactReadRequest = createDesktopArtifactReadRequest(
        {
          locator,
          boundary: {
            host: "desktop",
            source: artifactSource,
          },
        },
        context,
      );
      const response = await dependencies.ipcRenderer.invoke(
        DESKTOP_ARTIFACT_READ_REQUEST_CHANNEL.value,
        request,
      );

      return assertDesktopEnvelopeResponse<DesktopArtifactReadResponse>(response, {
        operation: DESKTOP_ARTIFACT_READ_OPERATION,
        channel: DESKTOP_ARTIFACT_READ_RESPONSE_CHANNEL.value,
        message: "Received invalid desktop artifact read IPC response envelope.",
      });
    },

    async readArtifactContentDescriptor(locator, context = {}) {
      const request: DesktopArtifactContentReadRequest = createDesktopArtifactContentReadRequest(
        {
          locator,
          boundary: {
            host: "desktop",
            source: artifactSource,
          },
        },
        context,
      );
      const response = await dependencies.ipcRenderer.invoke(
        DESKTOP_ARTIFACT_CONTENT_READ_REQUEST_CHANNEL.value,
        request,
      );

      return assertDesktopEnvelopeResponse<DesktopArtifactContentReadResponse>(response, {
        operation: DESKTOP_ARTIFACT_CONTENT_READ_OPERATION,
        channel: DESKTOP_ARTIFACT_CONTENT_READ_RESPONSE_CHANNEL.value,
        message: "Received invalid desktop artifact content read IPC response envelope.",
      });
    },

    async readArtifactViewerMedia(locator, context = {}) {
      const request: DesktopArtifactMediaViewRequest = createDesktopArtifactMediaViewRequest(
        {
          storageKey: locator.storageKey,
          boundary: {
            host: "desktop",
            source: artifactSource,
          },
        },
        context,
      );
      const response = await dependencies.ipcRenderer.invoke(
        DESKTOP_ARTIFACT_MEDIA_VIEW_REQUEST_CHANNEL.value,
        request,
      );

      return assertDesktopEnvelopeResponse<DesktopArtifactMediaViewResponse>(response, {
        operation: DESKTOP_ARTIFACT_MEDIA_VIEW_OPERATION,
        channel: DESKTOP_ARTIFACT_MEDIA_VIEW_RESPONSE_CHANNEL.value,
        message: "Received invalid desktop artifact media-view IPC response envelope.",
      });
    },

    async publishArtifactToRepo(input, context = {}) {
      const request: DesktopArtifactPublishRequest = createDesktopArtifactPublishRequest(
        {
          artifactId: input.artifactId,
          target: {
            provider: input.target.provider,
            repository: input.target.repository,
            path: input.target.path,
            revision: input.target.revision,
          },
          mediaType: input.mediaType,
          verify: true,
          boundary: {
            host: "desktop",
            source: artifactSource,
          },
        },
        context,
      );
      const response = await dependencies.ipcRenderer.invoke(
        DESKTOP_ARTIFACT_PUBLISH_REQUEST_CHANNEL.value,
        request,
      );

      return assertDesktopEnvelopeResponse<DesktopArtifactPublishResponse>(response, {
        operation: DESKTOP_ARTIFACT_PUBLISH_OPERATION,
        channel: DESKTOP_ARTIFACT_PUBLISH_RESPONSE_CHANNEL.value,
        message: "Received invalid desktop artifact publish IPC response envelope.",
      });
    },

    async verifyPublishedArtifactBacking(input, context = {}) {
      const request: DesktopArtifactPublishVerifyRequest = createDesktopArtifactPublishVerifyRequest(
        {
          artifactId: input.artifactId,
          boundary: {
            host: "desktop",
            source: artifactSource,
          },
        },
        context,
      );
      const response = await dependencies.ipcRenderer.invoke(
        DESKTOP_ARTIFACT_PUBLISH_VERIFY_REQUEST_CHANNEL.value,
        request,
      );

      return assertDesktopEnvelopeResponse<DesktopArtifactPublishVerifyResponse>(response, {
        operation: DESKTOP_ARTIFACT_PUBLISH_VERIFY_OPERATION,
        channel: DESKTOP_ARTIFACT_PUBLISH_VERIFY_RESPONSE_CHANNEL.value,
        message: "Received invalid desktop artifact publish verify IPC response envelope.",
      });
    },

    async verifyImportedArtifactSourceBacking(input, context = {}) {
      const request: DesktopArtifactSourceVerifyRequest = createDesktopArtifactSourceVerifyRequest(
        {
          artifactId: input.artifactId,
          boundary: {
            host: "desktop",
            source: artifactSource,
          },
        },
        context,
      );
      const response = await dependencies.ipcRenderer.invoke(
        DESKTOP_ARTIFACT_SOURCE_VERIFY_REQUEST_CHANNEL.value,
        request,
      );

      return assertDesktopEnvelopeResponse<DesktopArtifactSourceVerifyResponse>(response, {
        operation: DESKTOP_ARTIFACT_SOURCE_VERIFY_OPERATION,
        channel: DESKTOP_ARTIFACT_SOURCE_VERIFY_RESPONSE_CHANNEL.value,
        message: "Received invalid desktop artifact source verify IPC response envelope.",
      });
    },


    async registerArtifactFromRepo(input, context = {}) {
      const request: DesktopArtifactRegisterFromRepoRequest = createDesktopArtifactRegisterFromRepoRequest(
        {
          target: input.target,
          artifactFamily: input.artifactFamily,
          mediaType: input.mediaType,
          boundary: {
            host: "desktop",
            source: artifactSource,
          },
        },
        context,
      );
      const response = await dependencies.ipcRenderer.invoke(
        DESKTOP_ARTIFACT_REGISTER_FROM_REPO_REQUEST_CHANNEL.value,
        request,
      );

      return assertDesktopEnvelopeResponse<DesktopArtifactRegisterFromRepoResponse>(response, {
        operation: DESKTOP_ARTIFACT_REGISTER_FROM_REPO_OPERATION,
        channel: DESKTOP_ARTIFACT_REGISTER_FROM_REPO_RESPONSE_CHANNEL.value,
        message: "Received invalid desktop artifact register-from-repo IPC response envelope.",
      });
    },

    async localizeArtifactFromRepo(input, context = {}) {
      const request: DesktopArtifactLocalizeFromRepoRequest = createDesktopArtifactLocalizeFromRepoRequest(
        {
          artifactId: input.artifactId,
          boundary: {
            host: "desktop",
            source: artifactSource,
          },
        },
        context,
      );
      const response = await dependencies.ipcRenderer.invoke(
        DESKTOP_ARTIFACT_LOCALIZE_FROM_REPO_REQUEST_CHANNEL.value,
        request,
      );

      return assertDesktopEnvelopeResponse<DesktopArtifactLocalizeFromRepoResponse>(response, {
        operation: DESKTOP_ARTIFACT_LOCALIZE_FROM_REPO_OPERATION,
        channel: DESKTOP_ARTIFACT_LOCALIZE_FROM_REPO_RESPONSE_CHANNEL.value,
        message: "Received invalid desktop artifact localize-from-repo IPC response envelope.",
      });
    },
    async listApplicationSettingDefinitions(input = {}, context = {}) {
      const request = createDesktopApplicationSettingsListDefinitionsRequest(input, context);
      const response = await dependencies.ipcRenderer.invoke(
        DESKTOP_APPLICATION_SETTINGS_LIST_DEFINITIONS_REQUEST_CHANNEL.value,
        request,
      );

      return assertDesktopEnvelopeResponse<DesktopApplicationSettingsListDefinitionsResponse>(response, {
        operation: DESKTOP_APPLICATION_SETTINGS_LIST_DEFINITIONS_OPERATION,
        channel: DESKTOP_APPLICATION_SETTINGS_LIST_DEFINITIONS_RESPONSE_CHANNEL.value,
        message: "Received invalid desktop application settings list-definitions IPC response envelope.",
      });
    },
    async readApplicationSettings(input = {}, context = {}) {
      const request = createDesktopApplicationSettingsReadRequest(input, context);
      const response = await dependencies.ipcRenderer.invoke(
        DESKTOP_APPLICATION_SETTINGS_READ_REQUEST_CHANNEL.value,
        request,
      );

      return assertDesktopEnvelopeResponse<DesktopApplicationSettingsReadResponse>(response, {
        operation: DESKTOP_APPLICATION_SETTINGS_READ_OPERATION,
        channel: DESKTOP_APPLICATION_SETTINGS_READ_RESPONSE_CHANNEL.value,
        message: "Received invalid desktop application settings read IPC response envelope.",
      });
    },
    async updateApplicationSetting(input, context = {}) {
      const request = createDesktopApplicationSettingsUpdateRequest(input, context);
      const response = await dependencies.ipcRenderer.invoke(
        DESKTOP_APPLICATION_SETTINGS_UPDATE_REQUEST_CHANNEL.value,
        request,
      );

      return assertDesktopEnvelopeResponse<DesktopApplicationSettingsUpdateResponse>(response, {
        operation: DESKTOP_APPLICATION_SETTINGS_UPDATE_OPERATION,
        channel: DESKTOP_APPLICATION_SETTINGS_UPDATE_RESPONSE_CHANNEL.value,
        message: "Received invalid desktop application settings update IPC response envelope.",
      });
    },
    async clearApplicationSetting(input, context = {}) {
      const request = createDesktopApplicationSettingsClearRequest(input, context);
      const response = await dependencies.ipcRenderer.invoke(
        DESKTOP_APPLICATION_SETTINGS_CLEAR_REQUEST_CHANNEL.value,
        request,
      );

      return assertDesktopEnvelopeResponse<DesktopApplicationSettingsClearResponse>(response, {
        operation: DESKTOP_APPLICATION_SETTINGS_CLEAR_OPERATION,
        channel: DESKTOP_APPLICATION_SETTINGS_CLEAR_RESPONSE_CHANNEL.value,
        message: "Received invalid desktop application settings clear IPC response envelope.",
      });
    },
    async resolveApplicationModelDefault(input, context = {}) {
      const request = createDesktopApplicationSettingsResolveModelDefaultRequest(input, context);
      const response = await dependencies.ipcRenderer.invoke(
        DESKTOP_APPLICATION_SETTINGS_RESOLVE_MODEL_DEFAULT_REQUEST_CHANNEL.value,
        request,
      );

      return assertDesktopEnvelopeResponse<DesktopApplicationSettingsResolveModelDefaultResponse>(response, {
        operation: DESKTOP_APPLICATION_SETTINGS_RESOLVE_MODEL_DEFAULT_OPERATION,
        channel: DESKTOP_APPLICATION_SETTINGS_RESOLVE_MODEL_DEFAULT_RESPONSE_CHANNEL.value,
        message: "Received invalid desktop application settings resolve-model-default IPC response envelope.",
      });
    },
    async resolveModelDefault(input, context = {}) {
      return this.resolveApplicationModelDefault(input, context);
    },
    async browseModels(input, context = {}) {
      const request = createDesktopModelBrowseRequest(input, context);
      const response = await dependencies.ipcRenderer.invoke(
        DESKTOP_MODEL_BROWSE_REQUEST_CHANNEL.value,
        request,
      );
      return assertDesktopEnvelopeResponse<DesktopModelBrowseResponse>(response, {
        operation: DESKTOP_MODEL_BROWSE_OPERATION,
        channel: DESKTOP_MODEL_BROWSE_RESPONSE_CHANNEL.value,
        message: "Received invalid desktop model browse IPC response envelope.",
      });
    },
    async getModelDetails(input, context = {}) {
      const request = createDesktopModelDetailsReadRequest(input, context);
      const response = await dependencies.ipcRenderer.invoke(
        DESKTOP_MODEL_DETAILS_READ_REQUEST_CHANNEL.value,
        request,
      );
      return assertDesktopEnvelopeResponse<DesktopModelDetailsReadResponse>(response, {
        operation: DESKTOP_MODEL_DETAILS_READ_OPERATION,
        channel: DESKTOP_MODEL_DETAILS_READ_RESPONSE_CHANNEL.value,
        message: "Received invalid desktop model details IPC response envelope.",
      });
    },
    async listModels(input = {}, context = {}) {
      const request = createDesktopModelListRequest(input, context);
      const response = await dependencies.ipcRenderer.invoke(
        DESKTOP_MODEL_LIST_REQUEST_CHANNEL.value,
        request,
      );
      return assertDesktopEnvelopeResponse<DesktopModelListResponse>(response, {
        operation: DESKTOP_MODEL_LIST_OPERATION,
        channel: DESKTOP_MODEL_LIST_RESPONSE_CHANNEL.value,
        message: "Received invalid desktop model list IPC response envelope.",
      });
    },
    async saveModelReference(input, context = {}) {
      const request = createDesktopModelReferenceSaveRequest(input, context);
      const response = await dependencies.ipcRenderer.invoke(
        DESKTOP_MODEL_REFERENCE_SAVE_REQUEST_CHANNEL.value,
        request,
      );
      return assertDesktopEnvelopeResponse<DesktopModelReferenceSaveResponse>(response, {
        operation: DESKTOP_MODEL_REFERENCE_SAVE_OPERATION,
        channel: DESKTOP_MODEL_REFERENCE_SAVE_RESPONSE_CHANNEL.value,
        message: "Received invalid desktop model reference-save IPC response envelope.",
      });
    },
    async downloadModel(input, context = {}) {
      const request = createDesktopModelDownloadRequest(input, context);
      const response = await dependencies.ipcRenderer.invoke(
        DESKTOP_MODEL_DOWNLOAD_REQUEST_CHANNEL.value,
        request,
      );
      return assertDesktopEnvelopeResponse<DesktopModelDownloadResponse>(response, {
        operation: DESKTOP_MODEL_DOWNLOAD_OPERATION,
        channel: DESKTOP_MODEL_DOWNLOAD_RESPONSE_CHANNEL.value,
        message: "Received invalid desktop model download IPC response envelope.",
      });
    },
    async updateModelRecord(input, context = {}) {
      const request = createDesktopModelRecordUpdateRequest(input, context);
      const response = await dependencies.ipcRenderer.invoke(
        DESKTOP_MODEL_RECORD_UPDATE_REQUEST_CHANNEL.value,
        request,
      );
      return assertDesktopEnvelopeResponse<DesktopModelRecordUpdateResponse>(response, {
        operation: DESKTOP_MODEL_RECORD_UPDATE_OPERATION,
        channel: DESKTOP_MODEL_RECORD_UPDATE_RESPONSE_CHANNEL.value,
        message: "Received invalid desktop model record-update IPC response envelope.",
      });
    },
    async deleteModelRecord(input, context = {}) {
      const request = createDesktopModelRecordDeleteRequest(input, context);
      const response = await dependencies.ipcRenderer.invoke(
        DESKTOP_MODEL_RECORD_DELETE_REQUEST_CHANNEL.value,
        request,
      );
      return assertDesktopEnvelopeResponse<DesktopModelRecordDeleteResponse>(response, {
        operation: DESKTOP_MODEL_RECORD_DELETE_OPERATION,
        channel: DESKTOP_MODEL_RECORD_DELETE_RESPONSE_CHANNEL.value,
        message: "Received invalid desktop model record-delete IPC response envelope.",
      });
    },
    async trainModel(input, context = {}) {
      const request = createDesktopModelTrainRequest(input, context);
      const response = await dependencies.ipcRenderer.invoke(
        DESKTOP_MODEL_TRAIN_REQUEST_CHANNEL.value,
        request,
      );
      return assertDesktopEnvelopeResponse<DesktopModelTrainResponse>(response, {
        operation: DESKTOP_MODEL_TRAIN_OPERATION,
        channel: DESKTOP_MODEL_TRAIN_RESPONSE_CHANNEL.value,
        message: "Received invalid desktop model train IPC response envelope.",
      });
    },
    async readModelTrainingStatus(input, context = {}) {
      const request = createDesktopModelTrainStatusRequest(input, context);
      const response = await dependencies.ipcRenderer.invoke(
        DESKTOP_MODEL_TRAIN_STATUS_REQUEST_CHANNEL.value,
        request,
      );
      return assertDesktopEnvelopeResponse<DesktopModelTrainStatusResponse>(response, {
        operation: DESKTOP_MODEL_TRAIN_STATUS_OPERATION,
        channel: DESKTOP_MODEL_TRAIN_STATUS_RESPONSE_CHANNEL.value,
        message: "Received invalid desktop model training status IPC response envelope.",
      });
    },
    async validateModel(input, context = {}) {
      const request = createDesktopModelValidateRequest(input, context);
      const response = await dependencies.ipcRenderer.invoke(
        DESKTOP_MODEL_VALIDATE_REQUEST_CHANNEL.value,
        request,
      );
      return assertDesktopEnvelopeResponse<DesktopModelValidateResponse>(response, {
        operation: DESKTOP_MODEL_VALIDATE_OPERATION,
        channel: DESKTOP_MODEL_VALIDATE_RESPONSE_CHANNEL.value,
        message: "Received invalid desktop model validate IPC response envelope.",
      });
    },
    async publishModel(input, context = {}) {
      const request = createDesktopModelPublishRequest(input, context);
      const response = await dependencies.ipcRenderer.invoke(
        DESKTOP_MODEL_PUBLISH_REQUEST_CHANNEL.value,
        request,
      );
      return assertDesktopEnvelopeResponse<DesktopModelPublishResponse>(response, {
        operation: DESKTOP_MODEL_PUBLISH_OPERATION,
        channel: DESKTOP_MODEL_PUBLISH_RESPONSE_CHANNEL.value,
        message: "Received invalid desktop model publish IPC response envelope.",
      });
    },
  };
}
