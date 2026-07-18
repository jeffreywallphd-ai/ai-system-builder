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
  DESKTOP_HUGGING_FACE_FILES_IMPORT_OPERATION,
  DESKTOP_HUGGING_FACE_FILES_IMPORT_REQUEST_CHANNEL,
  DESKTOP_HUGGING_FACE_FILES_IMPORT_RESPONSE_CHANNEL,
  createDesktopHuggingFaceNamespaceDatasetsBrowseRequest,
  createDesktopHuggingFaceDatasetParquetFilesBrowseRequest,
  createDesktopHuggingFaceFilesImportRequest,
  type DesktopHuggingFaceNamespaceDatasetsBrowseResponse,
  type DesktopHuggingFaceDatasetParquetFilesBrowseResponse,
  type DesktopHuggingFaceFilesImportResponse,
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
  DESKTOP_RUNTIME_READINESS_READ_OPERATION,
  DESKTOP_RUNTIME_READINESS_READ_REQUEST_CHANNEL,
  DESKTOP_RUNTIME_READINESS_READ_RESPONSE_CHANNEL,
  DESKTOP_RUNTIME_CAPABILITY_STATUS_READ_OPERATION,
  DESKTOP_RUNTIME_CAPABILITY_STATUS_READ_REQUEST_CHANNEL,
  DESKTOP_RUNTIME_CAPABILITY_STATUS_READ_RESPONSE_CHANNEL,
  DESKTOP_RUNTIME_READINESS_REFRESH_INVENTORY_REQUEST_CHANNEL,
  DESKTOP_RUNTIME_READINESS_LIST_INVENTORY_REQUEST_CHANNEL,
  DESKTOP_RUNTIME_READINESS_READ_INVENTORY_REQUEST_CHANNEL,
  DESKTOP_RUNTIME_READINESS_READ_LATEST_INVENTORY_REQUEST_CHANNEL,
  DESKTOP_RUNTIME_READINESS_SUMMARIZE_INVENTORY_REQUEST_CHANNEL,
  DESKTOP_RUNTIME_READINESS_CREATE_BINDING_REQUEST_CHANNEL,
  DESKTOP_RUNTIME_READINESS_VALIDATE_BINDING_REQUEST_CHANNEL,
  DESKTOP_EXECUTION_PLANS_CREATE_PLAN_REQUEST_CHANNEL,
  DESKTOP_EXECUTION_PLANS_VALIDATE_PLAN_REQUEST_CHANNEL,
  DESKTOP_EXECUTION_PLANS_ARCHIVE_PLAN_REQUEST_CHANNEL,
  DESKTOP_EXECUTION_PLANS_LIST_SUMMARIES_REQUEST_CHANNEL,
  DESKTOP_EXECUTION_PLANS_READ_DETAIL_REQUEST_CHANNEL,
  DESKTOP_EXECUTION_PLANS_LIST_FOR_COMPOSITION_PLAN_REQUEST_CHANNEL,
  DESKTOP_EXECUTION_PLANS_READ_LATEST_FOR_COMPOSITION_PLAN_REQUEST_CHANNEL,
  DESKTOP_EXECUTION_PLANS_LIST_FOR_RUNTIME_READINESS_BINDING_REQUEST_CHANNEL,
  DESKTOP_EXECUTION_PLANS_READ_LATEST_FOR_RUNTIME_READINESS_BINDING_REQUEST_CHANNEL,
  DESKTOP_EXECUTION_PLANS_LIST_NEEDING_ATTENTION_REQUEST_CHANNEL,
  DESKTOP_EXECUTION_PLANS_SUMMARIZE_WORKSPACE_REQUEST_CHANNEL,
  DESKTOP_CONVERSATION_EXECUTION_V2_RETRY_TURN_REQUEST_CHANNEL,
  DESKTOP_CONVERSATION_EXECUTION_V2_CANCEL_TURN_REQUEST_CHANNEL,
  DESKTOP_CONVERSATION_EXECUTION_V2_SUBMIT_TURN_REQUEST_CHANNEL,
  DESKTOP_CONVERSATION_EXECUTION_V2_READ_TURN_ACTIVITY_REQUEST_CHANNEL,
  DESKTOP_CONVERSATION_EXECUTION_V2_READ_TRANSCRIPT_REQUEST_CHANNEL,
  DESKTOP_CONVERSATION_EXECUTION_V2_READ_SESSION_REQUEST_CHANNEL,
  DESKTOP_CONVERSATION_EXECUTION_V2_LIST_SESSIONS_REQUEST_CHANNEL,
  DESKTOP_CONVERSATION_EXECUTION_V2_APPROVE_SESSION_REQUEST_CHANNEL,
  DESKTOP_CONVERSATION_EXECUTION_V2_CREATE_SESSION_REQUEST_CHANNEL,
  type DesktopConversationApproveSessionResponsePayload,
  type DesktopConversationCancelTurnResponsePayload,
  type DesktopConversationCreateSessionResponsePayload,
  type DesktopConversationListSessionsResponsePayload,
  type DesktopConversationReadSessionResponsePayload,
  type DesktopConversationReadTranscriptResponsePayload,
  type DesktopConversationReadTurnActivityResponsePayload,
  type DesktopConversationRetryTurnResponsePayload,
  type DesktopConversationSubmitTurnResponsePayload,
  DESKTOP_WORKSPACE_LIST_OPERATION,
  DESKTOP_WORKSPACE_LIST_REQUEST_CHANNEL,
  DESKTOP_WORKSPACE_LIST_RESPONSE_CHANNEL,
  DESKTOP_WORKSPACE_CREATE_OPERATION,
  DESKTOP_WORKSPACE_CREATE_REQUEST_CHANNEL,
  DESKTOP_WORKSPACE_CREATE_RESPONSE_CHANNEL,
  DESKTOP_WORKSPACE_SELECTION_READ_OPERATION,
  DESKTOP_WORKSPACE_SELECTION_READ_REQUEST_CHANNEL,
  DESKTOP_WORKSPACE_SELECTION_READ_RESPONSE_CHANNEL,
  DESKTOP_WORKSPACE_SELECTION_SAVE_OPERATION,
  DESKTOP_WORKSPACE_SELECTION_SAVE_REQUEST_CHANNEL,
  DESKTOP_WORKSPACE_SELECTION_SAVE_RESPONSE_CHANNEL,
  DESKTOP_WORKSPACE_SELECTION_CLEAR_OPERATION,
  DESKTOP_WORKSPACE_SELECTION_CLEAR_REQUEST_CHANNEL,
  DESKTOP_WORKSPACE_SELECTION_CLEAR_RESPONSE_CHANNEL,
  createDesktopWorkspaceListRequest,
  createDesktopWorkspaceCreateRequest,
  createDesktopWorkspaceSelectionReadRequest,
  createDesktopWorkspaceSelectionSaveRequest,
  createDesktopWorkspaceSelectionClearRequest,
  type DesktopWorkspaceListResponse,
  type DesktopWorkspaceCreateResponse,
  type DesktopWorkspaceSelectionReadResponse,
  type DesktopWorkspaceSelectionSaveResponse,
  type DesktopWorkspaceSelectionClearResponse,
  DESKTOP_ASSET_DEFINITIONS_LIST_OPERATION,
  DESKTOP_ASSET_DEFINITIONS_LIST_REQUEST_CHANNEL,
  DESKTOP_ASSET_DEFINITIONS_LIST_RESPONSE_CHANNEL,
  DESKTOP_ASSET_DEFINITION_READ_OPERATION,
  DESKTOP_ASSET_DEFINITION_READ_REQUEST_CHANNEL,
  DESKTOP_ASSET_DEFINITION_READ_RESPONSE_CHANNEL,
  DESKTOP_ASSET_DEFINITION_VERSION_READ_OPERATION,
  DESKTOP_ASSET_DEFINITION_VERSION_READ_REQUEST_CHANNEL,
  DESKTOP_ASSET_DEFINITION_VERSION_READ_RESPONSE_CHANNEL,
  DESKTOP_ASSET_RESOURCE_BACKED_VIEW_READ_OPERATION,
  DESKTOP_ASSET_RESOURCE_BACKED_VIEW_READ_REQUEST_CHANNEL,
  DESKTOP_ASSET_RESOURCE_BACKED_VIEW_READ_RESPONSE_CHANNEL,
  DESKTOP_ASSET_RESOURCE_BACKED_VIEWS_LIST_OPERATION,
  DESKTOP_ASSET_RESOURCE_BACKED_VIEWS_LIST_REQUEST_CHANNEL,
  DESKTOP_ASSET_RESOURCE_BACKED_VIEWS_LIST_RESPONSE_CHANNEL,
  DESKTOP_ASSET_REGISTER_RESOURCE_BACKED_VIEW_OPERATION,
  DESKTOP_ASSET_REGISTER_RESOURCE_BACKED_VIEW_REQUEST_CHANNEL,
  DESKTOP_ASSET_REGISTER_RESOURCE_BACKED_VIEW_RESPONSE_CHANNEL,
  DESKTOP_ASSET_FINALIZE_GENERATED_OUTPUT_OPERATION,
  DESKTOP_ASSET_FINALIZE_GENERATED_OUTPUT_REQUEST_CHANNEL,
  DESKTOP_ASSET_FINALIZE_GENERATED_OUTPUT_RESPONSE_CHANNEL,
  DESKTOP_ASSET_IMPORT_EXTERNAL_REPOSITORY_OBJECT_OPERATION,
  DESKTOP_ASSET_IMPORT_EXTERNAL_REPOSITORY_OBJECT_REQUEST_CHANNEL,
  DESKTOP_ASSET_IMPORT_EXTERNAL_REPOSITORY_OBJECT_RESPONSE_CHANNEL,
  DESKTOP_ASSET_LOCALIZE_EXTERNAL_REPOSITORY_OBJECT_OPERATION,
  DESKTOP_ASSET_LOCALIZE_EXTERNAL_REPOSITORY_OBJECT_REQUEST_CHANNEL,
  DESKTOP_ASSET_LOCALIZE_EXTERNAL_REPOSITORY_OBJECT_RESPONSE_CHANNEL,
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
  createDesktopRuntimeReadinessReadRequest,
  createDesktopRuntimeCapabilityStatusReadRequest,
  createDesktopAssetDefinitionsListRequest,
  createDesktopAssetDefinitionReadRequest,
  createDesktopAssetDefinitionVersionReadRequest,
  createDesktopAssetResourceBackedViewReadRequest,
  createDesktopAssetResourceBackedViewsListRequest,
  createDesktopAssetRegisterResourceBackedViewRequest,
  createDesktopAssetFinalizeGeneratedOutputRequest,
  createDesktopAssetImportExternalRepositoryObjectRequest,
  createDesktopAssetLocalizeExternalRepositoryObjectRequest,
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
  type DesktopRuntimeReadinessReadResponse,
  type DesktopRuntimeCapabilityStatusReadResponse,
  type DesktopAssetDefinitionsListRequest,
  type DesktopAssetDefinitionsListResponse,
  type DesktopAssetDefinitionReadRequest,
  type DesktopAssetDefinitionReadResponse,
  type DesktopAssetDefinitionVersionReadRequest,
  type DesktopAssetDefinitionVersionReadResponse,
  type DesktopAssetResourceBackedViewReadRequest,
  type DesktopAssetResourceBackedViewReadResponse,
  type DesktopAssetResourceBackedViewsListRequest,
  type DesktopAssetResourceBackedViewsListResponse,
  type DesktopAssetRegisterResourceBackedViewResponse,
  type DesktopAssetFinalizeGeneratedOutputResponse,
  type DesktopAssetImportExternalRepositoryObjectResponse,
  type DesktopAssetLocalizeExternalRepositoryObjectResponse,
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
  DESKTOP_FEATURE_LIFECYCLE_STATE_READ_OPERATION,
  DESKTOP_FEATURE_LIFECYCLE_STATE_READ_REQUEST_CHANNEL,
  DESKTOP_FEATURE_LIFECYCLE_STATE_READ_RESPONSE_CHANNEL,
  DESKTOP_FEATURE_LIFECYCLE_IDLE_DISPOSE_OPERATION,
  DESKTOP_FEATURE_LIFECYCLE_IDLE_DISPOSE_REQUEST_CHANNEL,
  DESKTOP_FEATURE_LIFECYCLE_IDLE_DISPOSE_RESPONSE_CHANNEL,
  createDesktopFeatureLifecycleStateReadRequest,
  createDesktopFeatureLifecycleIdleDisposeRequest,
  type DesktopFeatureLifecycleStateReadResponse,
  type DesktopFeatureLifecycleIdleDisposeResponse,
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
  DESKTOP_APPLICATION_SETTINGS_SELECT_FOLDER_OPERATION,
  DESKTOP_APPLICATION_SETTINGS_SELECT_FOLDER_REQUEST_CHANNEL,
  DESKTOP_APPLICATION_SETTINGS_SELECT_FOLDER_RESPONSE_CHANNEL,
  createDesktopApplicationSettingsListDefinitionsRequest,
  createDesktopApplicationSettingsReadRequest,
  createDesktopApplicationSettingsUpdateRequest,
  createDesktopApplicationSettingsClearRequest,
  createDesktopApplicationSettingsResolveModelDefaultRequest,
  createDesktopApplicationSettingsSelectFolderRequest,
  type DesktopApplicationSettingsListDefinitionsResponse,
  type DesktopApplicationSettingsReadResponse,
  type DesktopApplicationSettingsUpdateResponse,
  type DesktopApplicationSettingsClearResponse,
  type DesktopApplicationSettingsResolveModelDefaultResponse,
  type DesktopApplicationSettingsSelectFolderResponse,
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
  DESKTOP_ASSET_IMPLEMENTATION_RELEASES_LIST_OPERATION,
  DESKTOP_ASSET_IMPLEMENTATION_RELEASES_LIST_REQUEST_CHANNEL,
  DESKTOP_ASSET_IMPLEMENTATION_RELEASES_LIST_RESPONSE_CHANNEL,
  DESKTOP_ASSET_IMPLEMENTATION_RESOLVE_OPERATION,
  DESKTOP_ASSET_IMPLEMENTATION_RESOLVE_REQUEST_CHANNEL,
  DESKTOP_ASSET_IMPLEMENTATION_RESOLVE_RESPONSE_CHANNEL,
  createDesktopAssetImplementationReleasesListRequest,
  createDesktopAssetImplementationResolveRequest,
  type DesktopAssetImplementationReleasesListResponse,
  type DesktopAssetImplementationResolveResponse,
  DESKTOP_ASSET_PACKAGE_OPERATIONS,
  DESKTOP_ASSET_PACKAGE_CHANNELS,
  createDesktopAssetPackageRequest,
  type DesktopAssetPackageInspectResponse,
  type DesktopAssetPackageRecordResponse,
  type DesktopAssetPackageListResponse,
  DESKTOP_ASSET_STUDIO_OPERATIONS,
  DESKTOP_ASSET_STUDIO_CHANNELS,
  createDesktopAssetStudioRequest,
  type DesktopAssetStudioProposalResponse,
  type DesktopAssetStudioWorkflowResponse,
  type DesktopAssetStudioListResponse,
  type DesktopAssetStudioDraftResponse,
  DESKTOP_SYSTEM_BUILDER_OPERATIONS,
  DESKTOP_SYSTEM_BUILDER_CHANNELS,
  createDesktopSystemBuilderRequest,
  type DesktopSystemBuilderRecordResponse,
  type DesktopSystemBuilderListResponse,
  type DesktopSystemBuilderRevisionResponse,
  type DesktopSystemBuilderRevisionListResponse,
  DESKTOP_SYSTEM_BUILD_OPERATIONS,
  DESKTOP_SYSTEM_BUILD_CHANNELS,
  createDesktopSystemBuildRequest,
  DESKTOP_SYSTEM_DATA_OPERATIONS,
  DESKTOP_SYSTEM_DATA_CHANNELS,
  createDesktopSystemDataRequest,
  DESKTOP_SYSTEM_REVIEW_OPERATIONS,
  DESKTOP_SYSTEM_REVIEW_CHANNELS,
  createDesktopSystemReviewRequest,
  DESKTOP_SYSTEM_DEPLOYMENT_OPERATIONS,
  DESKTOP_SYSTEM_DEPLOYMENT_CHANNELS,
  createDesktopSystemDeploymentRequest,
} from "../../../../modules/contracts/ipc";
import type { SystemDeploymentCapabilityPolicy } from "../../../../modules/contracts/system-deployment";
import type {
  ActiveWorkspaceSelection,
  CreateWorkspaceCommand,
} from "../../../../modules/contracts/workspace";
import type { ArtifactFamily } from "../../../../modules/domain/artifact";
import type { RuntimeCapabilityId } from "../../../../modules/contracts/runtime";
import type { AssetImplementationResolutionRequest } from "../../../../modules/contracts/asset-implementation";
import type {
  AdmitAssetPackageCommand,
  SetAssetPackageActivationCommand,
} from "../../../../modules/contracts/asset-package";
import type {
  ProposeAssetStudioChangeCommand,
  ReviewAssetStudioProposalCommand,
  StartAssetStudioCommand,
} from "../../../../modules/contracts/asset-studio";
import type {
  ChangeSystemBuilderArchiveStateCommand,
  CloneSystemBuilderSystemCommand,
  CreateSystemBuilderSystemCommand,
  CreateSystemBuilderFromTemplateCommand,
  RenameSystemBuilderSystemCommand,
  SaveSystemBuilderRevisionCommand,
} from "../../../../modules/contracts/system-builder";
import type {
  CreateAssetDraftCommand,
  CreateAssetOverrideCommand,
  CreateWorkspaceAuthoredAssetCommand,
  DisableAssetOverrideCommand,
  PublishAssetDraftCommand,
  UpdateAssetDraftCommand,
  UpdateAssetOverrideCommand,
  CreateAssetDerivedCustomizationCommand,
  UpdateAssetDerivedCustomizationCommand,
  ReviewAssetDerivedCustomizationCommand,
  ListAssetDerivedCustomizationTargetsQuery,
  ReadAssetDerivedCustomizationTargetQuery,
  ListAssetDerivedCustomizationsQuery,
} from "../../../../modules/contracts/asset-authoring";
import type {
  FinalizeGeneratedOutputCommand,
  ImportExternalRepositoryObjectCommand,
  LocalizeExternalRepositoryObjectCommand,
  RegisterResourceBackedViewCommand,
} from "../../../../modules/contracts/asset";
import type {
  ListApplicationSettingDefinitionsRequest,
  ReadApplicationSettingsRequest,
  ResolveModelDefaultRequest,
  UpdateApplicationSettingRequest,
} from "../../../../modules/contracts/settings";

const DEFAULT_UPLOAD_SOURCE = "desktop.renderer.artifact-upload.form";
const DEFAULT_ARTIFACT_SOURCE = "desktop.renderer.artifact-browser";
const DEFAULT_ASSET_REGISTRY_SOURCE = "desktop.renderer.asset-registry";

export interface IpcRendererInvokePort {
  invoke: (channel: string, request: unknown) => Promise<unknown>;
}

export interface DesktopArtifactUploadBridgeInput {
  workspaceId?: string;
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
  idempotencyKey?: string;
  workspaceId?: string;
  maximumBytes?: number;
}

export type DesktopAssetDefinitionsListBridgeInput = Omit<
  DesktopAssetDefinitionsListRequest["payload"],
  "boundary"
>;
export type DesktopAssetDefinitionReadBridgeInput = Omit<
  DesktopAssetDefinitionReadRequest["payload"],
  "boundary"
>;
export type DesktopAssetDefinitionVersionReadBridgeInput = Omit<
  DesktopAssetDefinitionVersionReadRequest["payload"],
  "boundary"
>;
export type DesktopAssetResourceBackedViewsListBridgeInput = Omit<
  DesktopAssetResourceBackedViewsListRequest["payload"],
  "boundary"
>;
export type DesktopAssetResourceBackedViewReadBridgeInput = Omit<
  DesktopAssetResourceBackedViewReadRequest["payload"],
  "boundary"
>;

export interface DesktopSystemBuildEnvelope {
  readonly operation: string;
  readonly channel: string;
  readonly ok?: boolean;
  readonly value?: unknown;
  readonly error?: unknown;
}
export interface DesktopSystemDataEnvelope {
  readonly operation: string;
  readonly channel: string;
  readonly ok?: boolean;
  readonly value?: unknown;
  readonly error?: unknown;
}
export interface DesktopSystemReviewEnvelope {
  readonly operation: string;
  readonly channel: string;
  readonly ok?: boolean;
  readonly value?: unknown;
  readonly error?: unknown;
}
export interface DesktopSystemDeploymentEnvelope {
  readonly operation: string;
  readonly channel: string;
  readonly ok?: boolean;
  readonly value?: unknown;
  readonly error?: unknown;
}
type DesktopSystemDataContextInput = {
  workspaceId: string;
  releaseId: string;
  entityType: string;
};
type DesktopSystemReviewContextInput = {
  workspaceId: string;
  releaseId: string;
};
type DesktopSystemDeploymentContextInput = {
  workspaceId: string;
  deploymentId: string;
};

export interface DesktopPreloadApi {
  memoryDiagnosticsEnabled: boolean;
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
  importHuggingFaceFiles: (
    input: {
      repositories?: Array<{ repository: string; revision?: string }>;
      files?: Array<{
        repository: string;
        path: string;
        revision?: string;
        mediaType?: string;
      }>;
    },
    context?: DesktopArtifactUploadBridgeContext,
  ) => Promise<DesktopHuggingFaceFilesImportResponse>;
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
  readRuntimeReadiness: (
    context?: DesktopArtifactUploadBridgeContext,
  ) => Promise<DesktopRuntimeReadinessReadResponse>;
  readRuntimeCapabilityStatus: (
    input: { capabilityId: RuntimeCapabilityId },
    context?: DesktopArtifactUploadBridgeContext,
  ) => Promise<DesktopRuntimeCapabilityStatusReadResponse>;
  refreshRuntimeReadinessInventory: (
    input: {
      targetWorkspaceId: string;
      sourceKind?: string;
      sourceId?: string;
    },
    context?: DesktopArtifactUploadBridgeContext,
  ) => Promise<unknown>;
  listRuntimeReadinessInventory: (
    input: { targetWorkspaceId: string; limit?: number; cursor?: string },
    context?: DesktopArtifactUploadBridgeContext,
  ) => Promise<unknown>;
  readRuntimeReadinessInventory: (
    input: { targetWorkspaceId: string; inventorySourceId: string },
    context?: DesktopArtifactUploadBridgeContext,
  ) => Promise<unknown>;
  readLatestRuntimeReadinessInventory: (
    input: {
      targetWorkspaceId: string;
      sourceKind?: string;
      sourceId?: string;
    },
    context?: DesktopArtifactUploadBridgeContext,
  ) => Promise<unknown>;
  summarizeRuntimeReadinessInventory: (
    input: { targetWorkspaceId: string },
    context?: DesktopArtifactUploadBridgeContext,
  ) => Promise<unknown>;
  createRuntimeReadinessBinding: (
    input: { targetWorkspaceId: string; compositionPlanId: string },
    context?: DesktopArtifactUploadBridgeContext,
  ) => Promise<unknown>;
  validateRuntimeReadinessBinding: (
    input: { targetWorkspaceId: string; readinessBindingId: string },
    context?: DesktopArtifactUploadBridgeContext,
  ) => Promise<unknown>;
  createExecutionPlan: (
    input: {
      workspaceId: string;
      runtimeReadinessBindingId: string;
      compositionPlanId?: string;
    },
    context?: DesktopArtifactUploadBridgeContext,
  ) => Promise<unknown>;
  validateExecutionPlan: (
    input: { workspaceId: string; executionPlanId: string },
    context?: DesktopArtifactUploadBridgeContext,
  ) => Promise<unknown>;
  archiveExecutionPlan: (
    input: { workspaceId: string; executionPlanId: string },
    context?: DesktopArtifactUploadBridgeContext,
  ) => Promise<unknown>;
  listExecutionPlanSummaries: (
    input: {
      workspaceId: string;
      includeArchived?: boolean;
      limit?: number;
      cursor?: string;
      status?: string;
    },
    context?: DesktopArtifactUploadBridgeContext,
  ) => Promise<unknown>;
  readExecutionPlanDetail: (
    input: { workspaceId: string; executionPlanId: string },
    context?: DesktopArtifactUploadBridgeContext,
  ) => Promise<unknown>;
  listExecutionPlansForCompositionPlan: (
    input: {
      workspaceId: string;
      compositionPlanId: string;
      includeArchived?: boolean;
    },
    context?: DesktopArtifactUploadBridgeContext,
  ) => Promise<unknown>;
  readLatestExecutionPlanForCompositionPlan: (
    input: {
      workspaceId: string;
      compositionPlanId: string;
      includeArchived?: boolean;
    },
    context?: DesktopArtifactUploadBridgeContext,
  ) => Promise<unknown>;
  listExecutionPlansForRuntimeReadinessBinding: (
    input: {
      workspaceId: string;
      runtimeReadinessBindingId: string;
      includeArchived?: boolean;
    },
    context?: DesktopArtifactUploadBridgeContext,
  ) => Promise<unknown>;
  readLatestExecutionPlanForRuntimeReadinessBinding: (
    input: {
      workspaceId: string;
      runtimeReadinessBindingId: string;
      includeArchived?: boolean;
    },
    context?: DesktopArtifactUploadBridgeContext,
  ) => Promise<unknown>;
  listExecutionPlansNeedingAttention: (
    input: { workspaceId: string },
    context?: DesktopArtifactUploadBridgeContext,
  ) => Promise<unknown>;
  summarizeWorkspaceExecutionPlans: (
    input: { workspaceId: string },
    context?: DesktopArtifactUploadBridgeContext,
  ) => Promise<unknown>;
  createConversationExecutionSessionFromPlan: (
    input: { workspaceId: string; sourceExecutionPlanId: string },
    context?: DesktopArtifactUploadBridgeContext,
  ) => Promise<DesktopConversationCreateSessionResponsePayload>;
  approveConversationSession: (
    input: {
      workspaceId: string;
      conversationSessionId: string;
      executionApprovalId: string;
    },
    context?: DesktopArtifactUploadBridgeContext,
  ) => Promise<DesktopConversationApproveSessionResponsePayload>;
  listConversationSessions: (
    input: {
      workspaceId: string;
      status?: string;
      includeArchived?: boolean;
      sourceExecutionPlanId?: string;
      cursor?: string;
      limit?: number;
    },
    context?: DesktopArtifactUploadBridgeContext,
  ) => Promise<DesktopConversationListSessionsResponsePayload>;
  readConversationSession: (
    input: { workspaceId: string; conversationSessionId: string },
    context?: DesktopArtifactUploadBridgeContext,
  ) => Promise<DesktopConversationReadSessionResponsePayload>;
  readConversationTranscript: (
    input: { workspaceId: string; conversationSessionId: string },
    context?: DesktopArtifactUploadBridgeContext,
  ) => Promise<DesktopConversationReadTranscriptResponsePayload>;
  readConversationTurnActivity: (
    input: {
      workspaceId: string;
      conversationSessionId: string;
      conversationTurnId: string;
    },
    context?: DesktopArtifactUploadBridgeContext,
  ) => Promise<DesktopConversationReadTurnActivityResponsePayload>;
  submitConversationTurn: (
    input: {
      workspaceId: string;
      conversationSessionId: string;
      text: string;
      operationId: string;
    },
    context?: DesktopArtifactUploadBridgeContext,
  ) => Promise<DesktopConversationSubmitTurnResponsePayload>;
  cancelConversationTurn: (
    input: {
      workspaceId: string;
      conversationSessionId: string;
      conversationTurnId: string;
      operationId: string;
    },
    context?: DesktopArtifactUploadBridgeContext,
  ) => Promise<DesktopConversationCancelTurnResponsePayload>;
  retryConversationTurn: (
    input: {
      workspaceId: string;
      conversationSessionId: string;
      conversationTurnId: string;
      operationId: string;
    },
    context?: DesktopArtifactUploadBridgeContext,
  ) => Promise<DesktopConversationRetryTurnResponsePayload>;
  readFeatureLifecycleState: (
    context?: DesktopArtifactUploadBridgeContext,
  ) => Promise<DesktopFeatureLifecycleStateReadResponse>;
  disposeIdleFeatures: (
    context?: DesktopArtifactUploadBridgeContext,
  ) => Promise<DesktopFeatureLifecycleIdleDisposeResponse>;

  listWorkspaces: (
    context?: DesktopArtifactUploadBridgeContext,
  ) => Promise<DesktopWorkspaceListResponse>;
  createWorkspace: (
    input: { command: CreateWorkspaceCommand; selectAfterCreate?: boolean },
    context?: DesktopArtifactUploadBridgeContext,
  ) => Promise<DesktopWorkspaceCreateResponse>;
  readActiveWorkspaceSelection: (
    context?: DesktopArtifactUploadBridgeContext,
  ) => Promise<DesktopWorkspaceSelectionReadResponse>;
  saveActiveWorkspaceSelection: (
    selection: ActiveWorkspaceSelection,
    context?: DesktopArtifactUploadBridgeContext,
  ) => Promise<DesktopWorkspaceSelectionSaveResponse>;
  clearActiveWorkspaceSelection: (
    context?: DesktopArtifactUploadBridgeContext,
  ) => Promise<DesktopWorkspaceSelectionClearResponse>;
  promoteWorkspaceAssetToUserLibrary: (
    command: PromoteWorkspaceAssetToUserLibraryCommand,
    context?: DesktopArtifactUploadBridgeContext,
  ) => Promise<DesktopUserLibraryPromoteResponse>;
  linkUserLibraryAssetToWorkspace: (
    command: LinkUserLibraryAssetToWorkspaceCommand,
    context?: DesktopArtifactUploadBridgeContext,
  ) => Promise<DesktopUserLibraryLinkResponse>;
  copyUserLibraryAssetToWorkspace: (
    command: CopyUserLibraryAssetToWorkspaceCommand,
    context?: DesktopArtifactUploadBridgeContext,
  ) => Promise<DesktopUserLibraryCopyResponse>;
  importWorkspaceAssetToWorkspace: (
    command: ImportWorkspaceAssetToWorkspaceCommand,
    context?: DesktopArtifactUploadBridgeContext,
  ) => Promise<DesktopUserLibraryImportResponse>;
  listUserLibraryAssets: (
    input?: DesktopUserLibraryAssetListRequest["payload"],
    context?: DesktopArtifactUploadBridgeContext,
  ) => Promise<DesktopUserLibraryAssetListResponse>;
  readUserLibraryAsset: (
    input: { userLibraryAssetId: string; version?: string },
    context?: DesktopArtifactUploadBridgeContext,
  ) => Promise<DesktopUserLibraryAssetReadResponse>;
  listWorkspaceUserLibraryLinks: (
    input: {
      workspaceId: string;
      status?: string;
      propagationPolicy?: string;
      text?: string;
      limit?: number;
      cursor?: string;
    },
    context?: DesktopArtifactUploadBridgeContext,
  ) => Promise<DesktopWorkspaceUserLibraryLinkListResponse>;
  readWorkspaceUserLibraryLink: (
    input: { workspaceId: string; linkId: string },
    context?: DesktopArtifactUploadBridgeContext,
  ) => Promise<DesktopWorkspaceUserLibraryLinkReadResponse>;
  readWorkspaceEffectiveAssetSources: (
    input: { workspaceId: string; limit?: number; cursor?: string },
    context?: DesktopArtifactUploadBridgeContext,
  ) => Promise<DesktopWorkspaceEffectiveAssetSourceListResponse>;
  listEffectiveAssetProjections: (
    input: {
      workspaceId: string;
      limit?: number;
      cursor?: string;
      status?: string;
      sourceKind?: string;
      policy?: string;
    },
    context?: DesktopArtifactUploadBridgeContext,
  ) => Promise<unknown>;
  readEffectiveAssetProjection: (
    input: { workspaceId: string; projectionId: string },
    context?: DesktopArtifactUploadBridgeContext,
  ) => Promise<unknown>;
  refreshEffectiveAssetProjection: (
    input: { workspaceId: string; projectionId: string },
    context?: DesktopArtifactUploadBridgeContext,
  ) => Promise<unknown>;
  createAssetCompositionPlan: (
    input: { targetWorkspaceId: string; name: string; description?: string },
    context?: DesktopArtifactUploadBridgeContext,
  ) => Promise<unknown>;
  updateAssetCompositionPlan: (
    input: {
      targetWorkspaceId: string;
      planId: string;
      name?: string;
      description?: string;
      status?: string;
    },
    context?: DesktopArtifactUploadBridgeContext,
  ) => Promise<unknown>;
  readAssetCompositionPlan: (
    input: { targetWorkspaceId: string; planId: string },
    context?: DesktopArtifactUploadBridgeContext,
  ) => Promise<unknown>;
  listAssetCompositionPlans: (
    input: {
      targetWorkspaceId: string;
      status?: string;
      text?: string;
      limit?: number;
      cursor?: string;
    },
    context?: DesktopArtifactUploadBridgeContext,
  ) => Promise<unknown>;
  archiveAssetCompositionPlan: (
    input: { targetWorkspaceId: string; planId: string },
    context?: DesktopArtifactUploadBridgeContext,
  ) => Promise<unknown>;
  addProjectionToAssetCompositionPlan: (
    input: { targetWorkspaceId: string; planId: string; projectionId: string },
    context?: DesktopArtifactUploadBridgeContext,
  ) => Promise<unknown>;
  removeProjectionFromAssetCompositionPlan: (
    input: { targetWorkspaceId: string; planId: string; projectionId: string },
    context?: DesktopArtifactUploadBridgeContext,
  ) => Promise<unknown>;
  connectAssetCompositionNodes: (
    input: {
      targetWorkspaceId: string;
      planId: string;
      sourceNodeId: string;
      targetNodeId: string;
      kind: string;
    },
    context?: DesktopArtifactUploadBridgeContext,
  ) => Promise<unknown>;
  disconnectAssetCompositionNodes: (
    input: {
      targetWorkspaceId: string;
      planId: string;
      relationshipId: string;
    },
    context?: DesktopArtifactUploadBridgeContext,
  ) => Promise<unknown>;
  validateAssetCompositionPlan: (
    input: { targetWorkspaceId: string; planId: string },
    context?: DesktopArtifactUploadBridgeContext,
  ) => Promise<unknown>;
  listAssetCompositionPlanSummaries: (
    input: { targetWorkspaceId: string },
    context?: DesktopArtifactUploadBridgeContext,
  ) => Promise<unknown>;
  readAssetCompositionPlanDetail: (
    input: { targetWorkspaceId: string; planId: string },
    context?: DesktopArtifactUploadBridgeContext,
  ) => Promise<unknown>;
  listCompositionPlansForProjection: (
    input: { targetWorkspaceId: string; projectionId: string },
    context?: DesktopArtifactUploadBridgeContext,
  ) => Promise<unknown>;
  listCompositionPlansForEffectiveAsset: (
    input: {
      targetWorkspaceId: string;
      effectiveAssetReference: { kind: string; id: string; version?: string };
    },
    context?: DesktopArtifactUploadBridgeContext,
  ) => Promise<unknown>;
  listCompositionPlansNeedingAttention: (
    input: { targetWorkspaceId: string },
    context?: DesktopArtifactUploadBridgeContext,
  ) => Promise<unknown>;
  listAssetImplementationReleases: (
    workspaceId: string,
    context?: DesktopArtifactUploadBridgeContext,
  ) => Promise<DesktopAssetImplementationReleasesListResponse>;
  resolveAssetImplementation: (
    input: AssetImplementationResolutionRequest,
    context?: DesktopArtifactUploadBridgeContext,
  ) => Promise<DesktopAssetImplementationResolveResponse>;
  inspectAssetPackage: (
    input: { workspaceId: string; bytes: Uint8Array },
    context?: DesktopArtifactUploadBridgeContext,
  ) => Promise<DesktopAssetPackageInspectResponse>;
  admitAssetPackage: (
    input: Omit<AdmitAssetPackageCommand, "actorId">,
    context?: DesktopArtifactUploadBridgeContext,
  ) => Promise<DesktopAssetPackageRecordResponse>;
  listAssetPackages: (
    workspaceId: string,
    context?: DesktopArtifactUploadBridgeContext,
  ) => Promise<DesktopAssetPackageListResponse>;
  activateAssetPackage: (
    input: Omit<SetAssetPackageActivationCommand, "actorId">,
    context?: DesktopArtifactUploadBridgeContext,
  ) => Promise<DesktopAssetPackageRecordResponse>;
  disableAssetPackage: (
    input: Omit<SetAssetPackageActivationCommand, "actorId">,
    context?: DesktopArtifactUploadBridgeContext,
  ) => Promise<DesktopAssetPackageRecordResponse>;
  rollbackAssetPackage: (
    input: Omit<SetAssetPackageActivationCommand, "actorId">,
    context?: DesktopArtifactUploadBridgeContext,
  ) => Promise<DesktopAssetPackageRecordResponse>;
  proposeAssetStudioChange: (
    input: Omit<ProposeAssetStudioChangeCommand, "actorId">,
    context?: DesktopArtifactUploadBridgeContext,
  ) => Promise<DesktopAssetStudioProposalResponse>;
  startAssetStudio: (
    input: Omit<StartAssetStudioCommand, "actorId">,
    context?: DesktopArtifactUploadBridgeContext,
  ) => Promise<DesktopAssetStudioDraftResponse>;
  reviewAssetStudioProposal: (
    input: Omit<ReviewAssetStudioProposalCommand, "actorId">,
    context?: DesktopArtifactUploadBridgeContext,
  ) => Promise<DesktopAssetStudioWorkflowResponse>;
  readAssetStudioProposal: (
    input: { workspaceId: string; workflowId: string },
    context?: DesktopArtifactUploadBridgeContext,
  ) => Promise<DesktopAssetStudioProposalResponse>;
  listAssetStudioWorkflows: (
    workspaceId: string,
    context?: DesktopArtifactUploadBridgeContext,
  ) => Promise<DesktopAssetStudioListResponse>;
  createSystemBuilderSystem: (
    input: Omit<CreateSystemBuilderSystemCommand, "actorId">,
    context?: DesktopArtifactUploadBridgeContext,
  ) => Promise<DesktopSystemBuilderRecordResponse>;
  listSystemBuilderSystems: (
    input: { workspaceId: string; includeArchived?: boolean },
    context?: DesktopArtifactUploadBridgeContext,
  ) => Promise<DesktopSystemBuilderListResponse>;
  listSystemBuilderTemplates: (
    input?: Record<string, never>,
    context?: DesktopArtifactUploadBridgeContext,
  ) => Promise<DesktopSystemDataEnvelope>;
  createSystemBuilderFromTemplate: (
    input: Omit<CreateSystemBuilderFromTemplateCommand, "actorId">,
    context?: DesktopArtifactUploadBridgeContext,
  ) => Promise<DesktopSystemBuilderRecordResponse>;
  readSystemBuilderSystem: (
    input: { workspaceId: string; systemId: string },
    context?: DesktopArtifactUploadBridgeContext,
  ) => Promise<DesktopSystemBuilderRecordResponse>;
  renameSystemBuilderSystem: (
    input: Omit<RenameSystemBuilderSystemCommand, "actorId">,
    context?: DesktopArtifactUploadBridgeContext,
  ) => Promise<DesktopSystemBuilderRecordResponse>;
  archiveSystemBuilderSystem: (
    input: Omit<ChangeSystemBuilderArchiveStateCommand, "actorId">,
    context?: DesktopArtifactUploadBridgeContext,
  ) => Promise<DesktopSystemBuilderRecordResponse>;
  restoreSystemBuilderSystem: (
    input: Omit<ChangeSystemBuilderArchiveStateCommand, "actorId">,
    context?: DesktopArtifactUploadBridgeContext,
  ) => Promise<DesktopSystemBuilderRecordResponse>;
  cloneSystemBuilderSystem: (
    input: Omit<CloneSystemBuilderSystemCommand, "actorId">,
    context?: DesktopArtifactUploadBridgeContext,
  ) => Promise<DesktopSystemBuilderRecordResponse>;
  saveSystemBuilderRevision: (
    input: Omit<SaveSystemBuilderRevisionCommand, "actorId">,
    context?: DesktopArtifactUploadBridgeContext,
  ) => Promise<DesktopSystemBuilderRevisionResponse>;
  readSystemBuilderRevision: (
    input: { workspaceId: string; systemId: string; revisionId?: string },
    context?: DesktopArtifactUploadBridgeContext,
  ) => Promise<DesktopSystemBuilderRevisionResponse>;
  listSystemBuilderRevisions: (
    input: { workspaceId: string; systemId: string },
    context?: DesktopArtifactUploadBridgeContext,
  ) => Promise<DesktopSystemBuilderRevisionListResponse>;
  requestSystemBuild: (
    input: Record<string, unknown>,
    context?: DesktopArtifactUploadBridgeContext,
  ) => Promise<DesktopSystemBuildEnvelope>;
  cancelSystemBuild: (
    input: { workspaceId: string; buildId: string },
    context?: DesktopArtifactUploadBridgeContext,
  ) => Promise<DesktopSystemBuildEnvelope>;
  readSystemBuild: (
    input: { workspaceId: string; buildId: string },
    context?: DesktopArtifactUploadBridgeContext,
  ) => Promise<DesktopSystemBuildEnvelope>;
  listSystemBuilds: (
    input: { workspaceId: string; systemId?: string },
    context?: DesktopArtifactUploadBridgeContext,
  ) => Promise<DesktopSystemBuildEnvelope>;
  approveSystemRelease: (
    input: {
      workspaceId: string;
      buildId: string;
      expectedLockDigest: string;
      releaseId?: string;
    },
    context?: DesktopArtifactUploadBridgeContext,
  ) => Promise<DesktopSystemBuildEnvelope>;
  readSystemRelease: (
    input: { workspaceId: string; releaseId: string },
    context?: DesktopArtifactUploadBridgeContext,
  ) => Promise<DesktopSystemBuildEnvelope>;
  listSystemReleases: (
    input: { workspaceId: string; systemId?: string },
    context?: DesktopArtifactUploadBridgeContext,
  ) => Promise<DesktopSystemBuildEnvelope>;
  compareSystemReleases: (
    input: {
      workspaceId: string;
      leftReleaseId: string;
      rightReleaseId: string;
    },
    context?: DesktopArtifactUploadBridgeContext,
  ) => Promise<DesktopSystemBuildEnvelope>;
  createWorkspaceAuthoredAsset: (
    command: CreateWorkspaceAuthoredAssetCommand,
    context?: DesktopArtifactUploadBridgeContext,
  ) => Promise<DesktopAssetAuthoringCreateWorkspaceAuthoredAssetResponse>;
  createAssetDraft: (
    command: CreateAssetDraftCommand,
    context?: DesktopArtifactUploadBridgeContext,
  ) => Promise<DesktopAssetAuthoringCreateDraftResponse>;
  describeSystemDataForm: (
    input: DesktopSystemDataContextInput,
    context?: DesktopArtifactUploadBridgeContext,
  ) => Promise<DesktopSystemDataEnvelope>;
  createSystemDataRecord: (
    input: DesktopSystemDataContextInput & {
      recordId: string;
      values: Record<string, string | number | boolean | null>;
    },
    context?: DesktopArtifactUploadBridgeContext,
  ) => Promise<DesktopSystemDataEnvelope>;
  readSystemDataRecord: (
    input: DesktopSystemDataContextInput & { recordId: string },
    context?: DesktopArtifactUploadBridgeContext,
  ) => Promise<DesktopSystemDataEnvelope>;
  updateSystemDataRecord: (
    input: DesktopSystemDataContextInput & {
      recordId: string;
      expectedRevision: number;
      values: Record<string, string | number | boolean | null>;
    },
    context?: DesktopArtifactUploadBridgeContext,
  ) => Promise<DesktopSystemDataEnvelope>;
  listSystemDataRecords: (
    input: DesktopSystemDataContextInput & { limit?: number; offset?: number },
    context?: DesktopArtifactUploadBridgeContext,
  ) => Promise<DesktopSystemDataEnvelope>;
  listSystemDataAudit: (
    input: DesktopSystemDataContextInput & { limit?: number },
    context?: DesktopArtifactUploadBridgeContext,
  ) => Promise<DesktopSystemDataEnvelope>;
  describeSystemReview: (
    input: DesktopSystemReviewContextInput,
    context?: DesktopArtifactUploadBridgeContext,
  ) => Promise<DesktopSystemReviewEnvelope>;
  browseSystemReviewArtifacts: (
    input: DesktopSystemReviewContextInput & {
      nameQuery?: string;
      limit?: number;
    },
    context?: DesktopArtifactUploadBridgeContext,
  ) => Promise<DesktopSystemReviewEnvelope>;
  readSystemReviewArtifact: (
    input: DesktopSystemReviewContextInput & { artifactRef: string },
    context?: DesktopArtifactUploadBridgeContext,
  ) => Promise<DesktopSystemReviewEnvelope>;
  previewSystemReviewArtifact: (
    input: DesktopSystemReviewContextInput & { artifactRef: string },
    context?: DesktopArtifactUploadBridgeContext,
  ) => Promise<DesktopSystemReviewEnvelope>;
  listSystemReviewAudit: (
    input: DesktopSystemReviewContextInput & { limit?: number },
    context?: DesktopArtifactUploadBridgeContext,
  ) => Promise<DesktopSystemReviewEnvelope>;
  installSystemDeployment: (
    input: DesktopSystemDeploymentContextInput & {
      releaseId: string;
      deploymentProfile: string;
      policy: SystemDeploymentCapabilityPolicy;
    },
    context?: DesktopArtifactUploadBridgeContext,
  ) => Promise<DesktopSystemDeploymentEnvelope>;
  activateSystemDeployment: (
    input: DesktopSystemDeploymentContextInput,
    context?: DesktopArtifactUploadBridgeContext,
  ) => Promise<DesktopSystemDeploymentEnvelope>;
  reconcileSystemDeploymentHealth: (
    input: DesktopSystemDeploymentContextInput,
    context?: DesktopArtifactUploadBridgeContext,
  ) => Promise<DesktopSystemDeploymentEnvelope>;
  rollbackSystemDeployment: (
    input: DesktopSystemDeploymentContextInput,
    context?: DesktopArtifactUploadBridgeContext,
  ) => Promise<DesktopSystemDeploymentEnvelope>;
  revokeSystemDeployment: (
    input: DesktopSystemDeploymentContextInput,
    context?: DesktopArtifactUploadBridgeContext,
  ) => Promise<DesktopSystemDeploymentEnvelope>;
  readSystemDeployment: (
    input: DesktopSystemDeploymentContextInput,
    context?: DesktopArtifactUploadBridgeContext,
  ) => Promise<DesktopSystemDeploymentEnvelope>;
  listSystemDeployments: (
    input: { workspaceId: string; releaseId?: string },
    context?: DesktopArtifactUploadBridgeContext,
  ) => Promise<DesktopSystemDeploymentEnvelope>;
  startSystemDeploymentRun: (
    input: DesktopSystemDeploymentContextInput & {
      runId: string;
      requestedCapabilities: readonly string[];
      requestedSecretReferences: readonly string[];
      requestedEgressOrigins: readonly string[];
    },
    context?: DesktopArtifactUploadBridgeContext,
  ) => Promise<DesktopSystemDeploymentEnvelope>;
  cancelSystemDeploymentRun: (
    input: { workspaceId: string; runId: string },
    context?: DesktopArtifactUploadBridgeContext,
  ) => Promise<DesktopSystemDeploymentEnvelope>;
  listSystemDeploymentRuns: (
    input: { workspaceId: string; deploymentId?: string; limit?: number },
    context?: DesktopArtifactUploadBridgeContext,
  ) => Promise<DesktopSystemDeploymentEnvelope>;
  listSystemDeploymentAudit: (
    input: DesktopSystemDeploymentContextInput & { limit?: number },
    context?: DesktopArtifactUploadBridgeContext,
  ) => Promise<DesktopSystemDeploymentEnvelope>;
  updateAssetDraft: (
    command: UpdateAssetDraftCommand,
    context?: DesktopArtifactUploadBridgeContext,
  ) => Promise<DesktopAssetAuthoringUpdateDraftResponse>;
  publishAssetDraft: (
    command: PublishAssetDraftCommand,
    context?: DesktopArtifactUploadBridgeContext,
  ) => Promise<DesktopAssetAuthoringPublishDraftResponse>;
  createAssetOverride: (
    command: CreateAssetOverrideCommand,
    context?: DesktopArtifactUploadBridgeContext,
  ) => Promise<DesktopAssetAuthoringCreateOverrideResponse>;
  updateAssetOverride: (
    command: UpdateAssetOverrideCommand,
    context?: DesktopArtifactUploadBridgeContext,
  ) => Promise<DesktopAssetAuthoringUpdateOverrideResponse>;
  disableAssetOverride: (
    command: DisableAssetOverrideCommand,
    context?: DesktopArtifactUploadBridgeContext,
  ) => Promise<DesktopAssetAuthoringDisableOverrideResponse>;
  listAuthoredAssets: (
    input: {
      workspaceId: string;
      status?: string;
      assetKind?: string;
      authoredAssetId?: string;
      text?: string;
      limit?: number;
      cursor?: string;
    },
    context?: DesktopArtifactUploadBridgeContext,
  ) => Promise<DesktopAssetAuthoringListAuthoredAssetsResponse>;
  readAuthoredAsset: (
    input: { workspaceId: string; authoredAssetId: string },
    context?: DesktopArtifactUploadBridgeContext,
  ) => Promise<DesktopAssetAuthoringReadAuthoredAssetResponse>;
  listAssetDrafts: (
    input: {
      targetWorkspaceId: string;
      status?: string;
      assetKind?: string;
      authoredAssetId?: string;
      draftId?: string;
      text?: string;
      limit?: number;
      cursor?: string;
    },
    context?: DesktopArtifactUploadBridgeContext,
  ) => Promise<DesktopAssetAuthoringListDraftsResponse>;
  readAssetDraft: (
    input: { targetWorkspaceId: string; draftId: string },
    context?: DesktopArtifactUploadBridgeContext,
  ) => Promise<DesktopAssetAuthoringReadDraftResponse>;
  listAssetRevisions: (
    input: {
      workspaceId: string;
      status?: string;
      assetKind?: string;
      authoredAssetId?: string;
      revisionId?: string;
      text?: string;
      limit?: number;
      cursor?: string;
    },
    context?: DesktopArtifactUploadBridgeContext,
  ) => Promise<DesktopAssetAuthoringListRevisionsResponse>;
  readAssetRevision: (
    input: { workspaceId: string; revisionId: string },
    context?: DesktopArtifactUploadBridgeContext,
  ) => Promise<DesktopAssetAuthoringReadRevisionResponse>;
  listAssetOverrides: (
    input: {
      targetWorkspaceId: string;
      status?: string;
      conflictStatus?: string;
      assetKind?: string;
      authoredAssetId?: string;
      draftId?: string;
      overrideId?: string;
      sourceKind?: string;
      text?: string;
      limit?: number;
      cursor?: string;
    },
    context?: DesktopArtifactUploadBridgeContext,
  ) => Promise<DesktopAssetAuthoringListOverridesResponse>;
  readAssetOverride: (
    input: { targetWorkspaceId: string; overrideId: string },
    context?: DesktopArtifactUploadBridgeContext,
  ) => Promise<DesktopAssetAuthoringReadOverrideResponse>;
  listAssetAuthoringEffectiveSummaries: (
    input: {
      targetWorkspaceId: string;
      sourceKind?: string;
      conflictStatus?: string;
      assetKind?: string;
      authoredAssetId?: string;
      draftId?: string;
      overrideId?: string;
      text?: string;
      limit?: number;
      cursor?: string;
    },
    context?: DesktopArtifactUploadBridgeContext,
  ) => Promise<DesktopAssetAuthoringListEffectiveSummariesResponse>;
  listAssetDerivedCustomizationTargets: (input: ListAssetDerivedCustomizationTargetsQuery, context?: DesktopArtifactUploadBridgeContext) => Promise<DesktopAssetDerivedCustomizationListTargetsResponse>;
  readAssetDerivedCustomizationTarget: (input: ReadAssetDerivedCustomizationTargetQuery, context?: DesktopArtifactUploadBridgeContext) => Promise<DesktopAssetDerivedCustomizationReadTargetResponse>;
  createAssetDerivedCustomization: (input: Omit<CreateAssetDerivedCustomizationCommand, "actorId">, context?: DesktopArtifactUploadBridgeContext) => Promise<DesktopAssetDerivedCustomizationCreateResponse>;
  updateAssetDerivedCustomization: (input: Omit<UpdateAssetDerivedCustomizationCommand, "actorId">, context?: DesktopArtifactUploadBridgeContext) => Promise<DesktopAssetDerivedCustomizationUpdateResponse>;
  reviewAssetDerivedCustomization: (input: Omit<ReviewAssetDerivedCustomizationCommand, "actorId">, context?: DesktopArtifactUploadBridgeContext) => Promise<DesktopAssetDerivedCustomizationReviewResponse>;
  publishAssetDerivedCustomization: (input: Omit<ReviewAssetDerivedCustomizationCommand, "actorId">, context?: DesktopArtifactUploadBridgeContext) => Promise<DesktopAssetDerivedCustomizationPublishResponse>;
  abandonAssetDerivedCustomization: (input: Omit<ReviewAssetDerivedCustomizationCommand, "actorId">, context?: DesktopArtifactUploadBridgeContext) => Promise<DesktopAssetDerivedCustomizationAbandonResponse>;
  listAssetDerivedCustomizations: (input: ListAssetDerivedCustomizationsQuery, context?: DesktopArtifactUploadBridgeContext) => Promise<DesktopAssetDerivedCustomizationListResponse>;
  readAssetDerivedCustomization: (input: { workspaceId: string; customizationId: string }, context?: DesktopArtifactUploadBridgeContext) => Promise<DesktopAssetDerivedCustomizationReadResponse>;
  listAssetDefinitions: (
    input?: DesktopAssetDefinitionsListBridgeInput,
    context?: DesktopArtifactUploadBridgeContext,
  ) => Promise<DesktopAssetDefinitionsListResponse>;
  readAssetDefinition: (
    input: DesktopAssetDefinitionReadBridgeInput,
    context?: DesktopArtifactUploadBridgeContext,
  ) => Promise<DesktopAssetDefinitionReadResponse>;
  readAssetDefinitionVersion: (
    input: DesktopAssetDefinitionVersionReadBridgeInput,
    context?: DesktopArtifactUploadBridgeContext,
  ) => Promise<DesktopAssetDefinitionVersionReadResponse>;
  listAssetResourceBackedViews: (
    input?: DesktopAssetResourceBackedViewsListBridgeInput,
    context?: DesktopArtifactUploadBridgeContext,
  ) => Promise<DesktopAssetResourceBackedViewsListResponse>;
  readAssetResourceBackedView: (
    input: DesktopAssetResourceBackedViewReadBridgeInput,
    context?: DesktopArtifactUploadBridgeContext,
  ) => Promise<DesktopAssetResourceBackedViewReadResponse>;
  registerResourceBackedViewAsAsset: (
    command: RegisterResourceBackedViewCommand,
    context?: DesktopArtifactUploadBridgeContext,
  ) => Promise<DesktopAssetRegisterResourceBackedViewResponse>;
  finalizeGeneratedOutputAsAsset: (
    command: FinalizeGeneratedOutputCommand,
    context?: DesktopArtifactUploadBridgeContext,
  ) => Promise<DesktopAssetFinalizeGeneratedOutputResponse>;
  importExternalRepositoryObjectAsAsset: (
    command: ImportExternalRepositoryObjectCommand,
    context?: DesktopArtifactUploadBridgeContext,
  ) => Promise<DesktopAssetImportExternalRepositoryObjectResponse>;
  localizeExternalRepositoryObjectAsAsset: (
    command: LocalizeExternalRepositoryObjectCommand,
    context?: DesktopArtifactUploadBridgeContext,
  ) => Promise<DesktopAssetLocalizeExternalRepositoryObjectResponse>;
  readPythonRuntimeStatus: (
    context?: DesktopArtifactUploadBridgeContext,
  ) => Promise<DesktopPythonRuntimeStatusReadResponse>;
  controlPythonRuntime: (
    input: {
      action: "start" | "stop" | "restart" | "unload-model" | "clear-logs";
    },
    context?: DesktopArtifactUploadBridgeContext,
  ) => Promise<DesktopPythonRuntimeControlResponse>;
  startImageGeneration: (
    input: DesktopImageGenerationStartRequest["payload"],
    context?: DesktopArtifactUploadBridgeContext,
  ) => Promise<DesktopImageGenerationStartResponse>;
  readImageGeneration: (
    input: { requestId: string },
    context?: DesktopArtifactUploadBridgeContext,
  ) => Promise<DesktopImageGenerationReadResponse>;
  cancelImageGeneration: (
    input: { requestId: string },
    context?: DesktopArtifactUploadBridgeContext,
  ) => Promise<DesktopImageGenerationCancelResponse>;
  finalizeImageGenerationIfCompleted: (
    input: { requestId: string; workspaceId?: string },
    context?: DesktopArtifactUploadBridgeContext,
  ) => Promise<DesktopImageGenerationFinalizeResponse>;
  readComfyUiInstallStatus: (
    input?: { installRoot?: string },
    context?: DesktopArtifactUploadBridgeContext,
  ) => Promise<any>;
  repairComfyUiInstall: (
    input?: {
      installRoot?: string;
      allowUpdate?: boolean;
      forceRepair?: boolean;
    },
    context?: DesktopArtifactUploadBridgeContext,
  ) => Promise<any>;
  browseArtifacts: (
    input?: { artifactFamily?: ArtifactFamily; workspaceId?: string },
    context?: DesktopArtifactUploadBridgeContext,
  ) => Promise<DesktopArtifactBrowseResponse>;
  browseUnregisteredArtifacts: (
    input?: { workspaceId?: string },
    context?: DesktopArtifactUploadBridgeContext,
  ) => Promise<DesktopArtifactUnregisteredBrowseResponse>;
  registerUnregisteredArtifact: (
    input: { storageKey: string; workspaceId?: string },
    context?: DesktopArtifactUploadBridgeContext,
  ) => Promise<DesktopArtifactUnregisteredRegisterResponse>;
  deleteUnregisteredArtifact: (
    input: { storageKey: string; workspaceId?: string },
    context?: DesktopArtifactUploadBridgeContext,
  ) => Promise<DesktopArtifactUnregisteredDeleteResponse>;
  deleteRegisteredArtifact: (
    input: { storageKey: string; workspaceId?: string },
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
  selectApplicationSettingsFolder: (
    input?: { title?: string; defaultPath?: string },
    context?: DesktopArtifactUploadBridgeContext,
  ) => Promise<DesktopApplicationSettingsSelectFolderResponse>;
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
  memoryDiagnosticsEnabled?: boolean;
}

function assertDesktopEnvelopeResponse<
  TResponse extends { operation: string; channel: string },
>(
  response: unknown,
  options: {
    operation: string;
    channel: string;
    message: string;
  },
): TResponse {
  if (
    typeof response !== "object" ||
    response === null ||
    !("operation" in response) ||
    !("channel" in response) ||
    (response as { operation?: string }).operation !== options.operation ||
    (response as { channel?: string }).channel !== options.channel
  ) {
    throw new Error(options.message);
  }

  return response as TResponse;
}

function withMutationRequestContext<
  TCommand extends {
    context?: {
      requestId?: string;
      correlationId?: string;
      idempotencyKey?: string;
      requestedAt?: string;
    };
  },
>(command: TCommand, context: DesktopArtifactUploadBridgeContext): TCommand {
  return {
    ...command,
    context: {
      ...(command.context ?? {}),
      ...(command.context?.requestId === undefined && context.requestId
        ? { requestId: context.requestId }
        : {}),
      ...(command.context?.correlationId === undefined && context.correlationId
        ? { correlationId: context.correlationId }
        : {}),
      ...(command.context?.idempotencyKey === undefined &&
      context.idempotencyKey
        ? { idempotencyKey: context.idempotencyKey }
        : {}),
    },
  };
}

export function createDesktopPreloadApi(
  dependencies: CreateDesktopPreloadApiDependencies,
): DesktopPreloadApi {
  const uploadSource = dependencies.uploadSource ?? DEFAULT_UPLOAD_SOURCE;
  const artifactSource = dependencies.artifactSource ?? DEFAULT_ARTIFACT_SOURCE;
  const assetRegistrySource = DEFAULT_ASSET_REGISTRY_SOURCE;

  return {
    memoryDiagnosticsEnabled: dependencies.memoryDiagnosticsEnabled === true,

    async getHuggingFaceTokenStatus(context = {}) {
      const request = createDesktopHuggingFaceTokenGetRequest(context);
      const response = await dependencies.ipcRenderer.invoke(
        DESKTOP_HUGGING_FACE_TOKEN_GET_REQUEST_CHANNEL.value,
        request,
      );

      return assertDesktopEnvelopeResponse<DesktopHuggingFaceTokenGetResponse>(
        response,
        {
          operation: DESKTOP_HUGGING_FACE_TOKEN_GET_OPERATION,
          channel: DESKTOP_HUGGING_FACE_TOKEN_GET_RESPONSE_CHANNEL.value,
          message:
            "Received invalid desktop Hugging Face token status IPC response envelope.",
        },
      );
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

      return assertDesktopEnvelopeResponse<DesktopHuggingFaceTokenSetResponse>(
        response,
        {
          operation: DESKTOP_HUGGING_FACE_TOKEN_SET_OPERATION,
          channel: DESKTOP_HUGGING_FACE_TOKEN_SET_RESPONSE_CHANNEL.value,
          message:
            "Received invalid desktop Hugging Face token set IPC response envelope.",
        },
      );
    },

    async clearHuggingFaceToken(context = {}) {
      const request = createDesktopHuggingFaceTokenClearRequest(context);
      const response = await dependencies.ipcRenderer.invoke(
        DESKTOP_HUGGING_FACE_TOKEN_CLEAR_REQUEST_CHANNEL.value,
        request,
      );

      return assertDesktopEnvelopeResponse<DesktopHuggingFaceTokenClearResponse>(
        response,
        {
          operation: DESKTOP_HUGGING_FACE_TOKEN_CLEAR_OPERATION,
          channel: DESKTOP_HUGGING_FACE_TOKEN_CLEAR_RESPONSE_CHANNEL.value,
          message:
            "Received invalid desktop Hugging Face token clear IPC response envelope.",
        },
      );
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

      return assertDesktopEnvelopeResponse<DesktopHuggingFaceNamespaceDatasetsBrowseResponse>(
        response,
        {
          operation: DESKTOP_HUGGING_FACE_NAMESPACE_DATASETS_BROWSE_OPERATION,
          channel:
            DESKTOP_HUGGING_FACE_NAMESPACE_DATASETS_BROWSE_RESPONSE_CHANNEL.value,
          message:
            "Received invalid desktop Hugging Face namespace datasets IPC response envelope.",
        },
      );
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

      return assertDesktopEnvelopeResponse<DesktopHuggingFaceDatasetParquetFilesBrowseResponse>(
        response,
        {
          operation:
            DESKTOP_HUGGING_FACE_DATASET_PARQUET_FILES_BROWSE_OPERATION,
          channel:
            DESKTOP_HUGGING_FACE_DATASET_PARQUET_FILES_BROWSE_RESPONSE_CHANNEL.value,
          message:
            "Received invalid desktop Hugging Face dataset parquet-files IPC response envelope.",
        },
      );
    },

    async importHuggingFaceFiles(input, context = {}) {
      const request = createDesktopHuggingFaceFilesImportRequest(
        {
          repositories: input.repositories,
          files: input.files,
          boundary: {
            host: "desktop",
            source: artifactSource,
          },
        },
        context,
      );
      const response = await dependencies.ipcRenderer.invoke(
        DESKTOP_HUGGING_FACE_FILES_IMPORT_REQUEST_CHANNEL.value,
        request,
      );

      return assertDesktopEnvelopeResponse<DesktopHuggingFaceFilesImportResponse>(
        response,
        {
          operation: DESKTOP_HUGGING_FACE_FILES_IMPORT_OPERATION,
          channel: DESKTOP_HUGGING_FACE_FILES_IMPORT_RESPONSE_CHANNEL.value,
          message:
            "Received invalid desktop Hugging Face files import IPC response envelope.",
        },
      );
    },

    async uploadArtifact(input, context = {}) {
      const request: DesktopArtifactUploadRequest =
        createDesktopArtifactUploadRequest(
          {
            fileName: input.fileName,
            mediaType: input.mediaType,
            bytes: input.bytes,
            workspaceId: input.workspaceId ?? context.workspaceId ?? "",
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

      return assertDesktopEnvelopeResponse<DesktopArtifactUploadResponse>(
        response,
        {
          operation: DESKTOP_ARTIFACT_UPLOAD_OPERATION,
          channel: DESKTOP_ARTIFACT_UPLOAD_RESPONSE_CHANNEL.value,
          message:
            "Received invalid desktop artifact upload IPC response envelope.",
        },
      );
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

      return assertDesktopEnvelopeResponse<DesktopArtifactUploadPolicyReadResponse>(
        response,
        {
          operation: DESKTOP_ARTIFACT_UPLOAD_POLICY_READ_OPERATION,
          channel: DESKTOP_ARTIFACT_UPLOAD_POLICY_READ_RESPONSE_CHANNEL.value,
          message:
            "Received invalid desktop artifact upload policy IPC response envelope.",
        },
      );
    },

    async ingestWebsitePage(input, context = {}) {
      const request: DesktopIngestWebsitePageRequest =
        createDesktopIngestWebsitePageRequest(
          {
            request: {
              url: input.url,
              label: input.label,
              mode: input.mode,
            },
            boundary: {
              host: "desktop",
              source: uploadSource,
              workspaceId: context.workspaceId,
            },
          },
          context,
        );
      const response = await dependencies.ipcRenderer.invoke(
        DESKTOP_INGEST_WEBSITE_PAGE_REQUEST_CHANNEL.value,
        request,
      );

      return assertDesktopEnvelopeResponse<DesktopIngestWebsitePageResponse>(
        response,
        {
          operation: DESKTOP_INGEST_WEBSITE_PAGE_OPERATION,
          channel: DESKTOP_INGEST_WEBSITE_PAGE_RESPONSE_CHANNEL.value,
          message:
            "Received invalid desktop website-page ingestion IPC response envelope.",
        },
      );
    },

    async ingestWebsitePagesBatch(input, context = {}) {
      const request: DesktopIngestWebsitePagesBatchRequest =
        createDesktopIngestWebsitePagesBatchRequest(
          {
            request: {
              targets: input.targets,
              mode: input.mode,
            },
            boundary: {
              host: "desktop",
              source: uploadSource,
              workspaceId: context.workspaceId,
            },
          },
          context,
        );
      const response = await dependencies.ipcRenderer.invoke(
        DESKTOP_INGEST_WEBSITE_PAGES_BATCH_REQUEST_CHANNEL.value,
        request,
      );

      return assertDesktopEnvelopeResponse<DesktopIngestWebsitePagesBatchResponse>(
        response,
        {
          operation: DESKTOP_INGEST_WEBSITE_PAGES_BATCH_OPERATION,
          channel: DESKTOP_INGEST_WEBSITE_PAGES_BATCH_RESPONSE_CHANNEL.value,
          message:
            "Received invalid desktop website-pages batch ingestion IPC response envelope.",
        },
      );
    },

    async startPrepareTrainingDataset(input, context = {}) {
      const request: DesktopPrepareTrainingDatasetStartRequest =
        createDesktopPrepareTrainingDatasetStartRequest(
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

      return assertDesktopEnvelopeResponse<DesktopPrepareTrainingDatasetStartResponse>(
        response,
        {
          operation: DESKTOP_DATASET_PREPARE_TRAINING_START_OPERATION,
          channel:
            DESKTOP_DATASET_PREPARE_TRAINING_START_RESPONSE_CHANNEL.value,
          message:
            "Received invalid desktop dataset preparation start IPC response envelope.",
        },
      );
    },

    async readPrepareTrainingDatasetTask(input, context = {}) {
      const request: DesktopPrepareTrainingDatasetTaskReadRequest =
        createDesktopPrepareTrainingDatasetTaskReadRequest(
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

      return assertDesktopEnvelopeResponse<DesktopPrepareTrainingDatasetTaskReadResponse>(
        response,
        {
          operation: DESKTOP_DATASET_PREPARE_TRAINING_TASK_READ_OPERATION,
          channel:
            DESKTOP_DATASET_PREPARE_TRAINING_TASK_READ_RESPONSE_CHANNEL.value,
          message:
            "Received invalid desktop dataset preparation task-read IPC response envelope.",
        },
      );
    },

    async readRuntimeReadiness(context = {}) {
      const request = createDesktopRuntimeReadinessReadRequest(
        {
          boundary: {
            host: "desktop",
            source: "desktop.renderer.runtime-readiness",
          },
        },
        context,
      );
      const response = await dependencies.ipcRenderer.invoke(
        DESKTOP_RUNTIME_READINESS_READ_REQUEST_CHANNEL.value,
        request,
      );

      return assertDesktopEnvelopeResponse<DesktopRuntimeReadinessReadResponse>(
        response,
        {
          operation: DESKTOP_RUNTIME_READINESS_READ_OPERATION,
          channel: DESKTOP_RUNTIME_READINESS_READ_RESPONSE_CHANNEL.value,
          message:
            "Received invalid desktop runtime readiness IPC response envelope.",
        },
      );
    },

    async readRuntimeCapabilityStatus(input, context = {}) {
      const request = createDesktopRuntimeCapabilityStatusReadRequest(
        {
          capabilityId: input.capabilityId,
          boundary: {
            host: "desktop",
            source: "desktop.renderer.runtime-readiness",
          },
        },
        context,
      );
      const response = await dependencies.ipcRenderer.invoke(
        DESKTOP_RUNTIME_CAPABILITY_STATUS_READ_REQUEST_CHANNEL.value,
        request,
      );

      return assertDesktopEnvelopeResponse<DesktopRuntimeCapabilityStatusReadResponse>(
        response,
        {
          operation: DESKTOP_RUNTIME_CAPABILITY_STATUS_READ_OPERATION,
          channel:
            DESKTOP_RUNTIME_CAPABILITY_STATUS_READ_RESPONSE_CHANNEL.value,
          message:
            "Received invalid desktop runtime capability status IPC response envelope.",
        },
      );
    },

    async refreshRuntimeReadinessInventory(input, context = {}) {
      return dependencies.ipcRenderer.invoke(
        DESKTOP_RUNTIME_READINESS_REFRESH_INVENTORY_REQUEST_CHANNEL.value,
        {
          requestId: context.requestId,
          correlationId: context.correlationId,
          payload: input,
        },
      );
    },
    async listRuntimeReadinessInventory(input, context = {}) {
      return dependencies.ipcRenderer.invoke(
        DESKTOP_RUNTIME_READINESS_LIST_INVENTORY_REQUEST_CHANNEL.value,
        {
          requestId: context.requestId,
          correlationId: context.correlationId,
          payload: input,
        },
      );
    },
    async readRuntimeReadinessInventory(input, context = {}) {
      return dependencies.ipcRenderer.invoke(
        DESKTOP_RUNTIME_READINESS_READ_INVENTORY_REQUEST_CHANNEL.value,
        {
          requestId: context.requestId,
          correlationId: context.correlationId,
          payload: input,
        },
      );
    },
    async readLatestRuntimeReadinessInventory(input, context = {}) {
      return dependencies.ipcRenderer.invoke(
        DESKTOP_RUNTIME_READINESS_READ_LATEST_INVENTORY_REQUEST_CHANNEL.value,
        {
          requestId: context.requestId,
          correlationId: context.correlationId,
          payload: input,
        },
      );
    },
    async summarizeRuntimeReadinessInventory(input, context = {}) {
      return dependencies.ipcRenderer.invoke(
        DESKTOP_RUNTIME_READINESS_SUMMARIZE_INVENTORY_REQUEST_CHANNEL.value,
        {
          requestId: context.requestId,
          correlationId: context.correlationId,
          payload: input,
        },
      );
    },
    async createRuntimeReadinessBinding(input, context = {}) {
      return dependencies.ipcRenderer.invoke(
        DESKTOP_RUNTIME_READINESS_CREATE_BINDING_REQUEST_CHANNEL.value,
        {
          requestId: context.requestId,
          correlationId: context.correlationId,
          payload: input,
        },
      );
    },
    async validateRuntimeReadinessBinding(input, context = {}) {
      return dependencies.ipcRenderer.invoke(
        DESKTOP_RUNTIME_READINESS_VALIDATE_BINDING_REQUEST_CHANNEL.value,
        {
          requestId: context.requestId,
          correlationId: context.correlationId,
          payload: input,
        },
      );
    },

    async createExecutionPlan(input, context = {}) {
      return dependencies.ipcRenderer.invoke(
        DESKTOP_EXECUTION_PLANS_CREATE_PLAN_REQUEST_CHANNEL.value,
        {
          requestId: context.requestId,
          correlationId: context.correlationId,
          payload: input,
        },
      );
    },
    async validateExecutionPlan(input, context = {}) {
      return dependencies.ipcRenderer.invoke(
        DESKTOP_EXECUTION_PLANS_VALIDATE_PLAN_REQUEST_CHANNEL.value,
        {
          requestId: context.requestId,
          correlationId: context.correlationId,
          payload: input,
        },
      );
    },
    async archiveExecutionPlan(input, context = {}) {
      return dependencies.ipcRenderer.invoke(
        DESKTOP_EXECUTION_PLANS_ARCHIVE_PLAN_REQUEST_CHANNEL.value,
        {
          requestId: context.requestId,
          correlationId: context.correlationId,
          payload: input,
        },
      );
    },
    async listExecutionPlanSummaries(input, context = {}) {
      return dependencies.ipcRenderer.invoke(
        DESKTOP_EXECUTION_PLANS_LIST_SUMMARIES_REQUEST_CHANNEL.value,
        {
          requestId: context.requestId,
          correlationId: context.correlationId,
          payload: input,
        },
      );
    },
    async readExecutionPlanDetail(input, context = {}) {
      return dependencies.ipcRenderer.invoke(
        DESKTOP_EXECUTION_PLANS_READ_DETAIL_REQUEST_CHANNEL.value,
        {
          requestId: context.requestId,
          correlationId: context.correlationId,
          payload: input,
        },
      );
    },
    async listExecutionPlansForCompositionPlan(input, context = {}) {
      return dependencies.ipcRenderer.invoke(
        DESKTOP_EXECUTION_PLANS_LIST_FOR_COMPOSITION_PLAN_REQUEST_CHANNEL.value,
        {
          requestId: context.requestId,
          correlationId: context.correlationId,
          payload: input,
        },
      );
    },
    async readLatestExecutionPlanForCompositionPlan(input, context = {}) {
      return dependencies.ipcRenderer.invoke(
        DESKTOP_EXECUTION_PLANS_READ_LATEST_FOR_COMPOSITION_PLAN_REQUEST_CHANNEL.value,
        {
          requestId: context.requestId,
          correlationId: context.correlationId,
          payload: input,
        },
      );
    },
    async listExecutionPlansForRuntimeReadinessBinding(input, context = {}) {
      return dependencies.ipcRenderer.invoke(
        DESKTOP_EXECUTION_PLANS_LIST_FOR_RUNTIME_READINESS_BINDING_REQUEST_CHANNEL.value,
        {
          requestId: context.requestId,
          correlationId: context.correlationId,
          payload: input,
        },
      );
    },
    async readLatestExecutionPlanForRuntimeReadinessBinding(
      input,
      context = {},
    ) {
      return dependencies.ipcRenderer.invoke(
        DESKTOP_EXECUTION_PLANS_READ_LATEST_FOR_RUNTIME_READINESS_BINDING_REQUEST_CHANNEL.value,
        {
          requestId: context.requestId,
          correlationId: context.correlationId,
          payload: input,
        },
      );
    },
    async listExecutionPlansNeedingAttention(input, context = {}) {
      return dependencies.ipcRenderer.invoke(
        DESKTOP_EXECUTION_PLANS_LIST_NEEDING_ATTENTION_REQUEST_CHANNEL.value,
        {
          requestId: context.requestId,
          correlationId: context.correlationId,
          payload: input,
        },
      );
    },
    async summarizeWorkspaceExecutionPlans(input, context = {}) {
      return dependencies.ipcRenderer.invoke(
        DESKTOP_EXECUTION_PLANS_SUMMARIZE_WORKSPACE_REQUEST_CHANNEL.value,
        {
          requestId: context.requestId,
          correlationId: context.correlationId,
          payload: input,
        },
      );
    },
    async createConversationExecutionSessionFromPlan(input, context = {}) {
      return dependencies.ipcRenderer.invoke(
        DESKTOP_CONVERSATION_EXECUTION_V2_CREATE_SESSION_REQUEST_CHANNEL.value,
        {
          requestId: context.requestId,
          correlationId: context.correlationId,
          payload: input,
        },
      ) as Promise<DesktopConversationCreateSessionResponsePayload>;
    },
    async approveConversationSession(input, context = {}) {
      return dependencies.ipcRenderer.invoke(
        DESKTOP_CONVERSATION_EXECUTION_V2_APPROVE_SESSION_REQUEST_CHANNEL.value,
        {
          requestId: context.requestId,
          correlationId: context.correlationId,
          payload: input,
        },
      ) as Promise<DesktopConversationApproveSessionResponsePayload>;
    },
    async listConversationSessions(input, context = {}) {
      return dependencies.ipcRenderer.invoke(
        DESKTOP_CONVERSATION_EXECUTION_V2_LIST_SESSIONS_REQUEST_CHANNEL.value,
        {
          requestId: context.requestId,
          correlationId: context.correlationId,
          payload: input,
        },
      ) as Promise<DesktopConversationListSessionsResponsePayload>;
    },
    async readConversationSession(input, context = {}) {
      return dependencies.ipcRenderer.invoke(
        DESKTOP_CONVERSATION_EXECUTION_V2_READ_SESSION_REQUEST_CHANNEL.value,
        {
          requestId: context.requestId,
          correlationId: context.correlationId,
          payload: input,
        },
      ) as Promise<DesktopConversationReadSessionResponsePayload>;
    },
    async readConversationTranscript(input, context = {}) {
      return dependencies.ipcRenderer.invoke(
        DESKTOP_CONVERSATION_EXECUTION_V2_READ_TRANSCRIPT_REQUEST_CHANNEL.value,
        {
          requestId: context.requestId,
          correlationId: context.correlationId,
          payload: input,
        },
      ) as Promise<DesktopConversationReadTranscriptResponsePayload>;
    },
    async readConversationTurnActivity(input, context = {}) {
      return dependencies.ipcRenderer.invoke(
        DESKTOP_CONVERSATION_EXECUTION_V2_READ_TURN_ACTIVITY_REQUEST_CHANNEL.value,
        {
          requestId: context.requestId,
          correlationId: context.correlationId,
          payload: input,
        },
      ) as Promise<DesktopConversationReadTurnActivityResponsePayload>;
    },
    async submitConversationTurn(input, context = {}) {
      return dependencies.ipcRenderer.invoke(
        DESKTOP_CONVERSATION_EXECUTION_V2_SUBMIT_TURN_REQUEST_CHANNEL.value,
        {
          requestId: context.requestId,
          correlationId: context.correlationId,
          payload: input,
        },
      ) as Promise<DesktopConversationSubmitTurnResponsePayload>;
    },
    async cancelConversationTurn(input, context = {}) {
      return dependencies.ipcRenderer.invoke(
        DESKTOP_CONVERSATION_EXECUTION_V2_CANCEL_TURN_REQUEST_CHANNEL.value,
        {
          requestId: context.requestId,
          correlationId: context.correlationId,
          payload: input,
        },
      ) as Promise<DesktopConversationCancelTurnResponsePayload>;
    },
    async retryConversationTurn(input, context = {}) {
      return dependencies.ipcRenderer.invoke(
        DESKTOP_CONVERSATION_EXECUTION_V2_RETRY_TURN_REQUEST_CHANNEL.value,
        {
          requestId: context.requestId,
          correlationId: context.correlationId,
          payload: input,
        },
      ) as Promise<DesktopConversationRetryTurnResponsePayload>;
    },
    async readFeatureLifecycleState(context = {}) {
      const request = createDesktopFeatureLifecycleStateReadRequest(
        {
          boundary: {
            host: "desktop",
            source: "desktop.renderer.system.lifecycle-diagnostics",
          },
        },
        context,
      );
      const response = await dependencies.ipcRenderer.invoke(
        DESKTOP_FEATURE_LIFECYCLE_STATE_READ_REQUEST_CHANNEL.value,
        request,
      );

      return assertDesktopEnvelopeResponse<DesktopFeatureLifecycleStateReadResponse>(
        response,
        {
          operation: DESKTOP_FEATURE_LIFECYCLE_STATE_READ_OPERATION,
          channel: DESKTOP_FEATURE_LIFECYCLE_STATE_READ_RESPONSE_CHANNEL.value,
          message:
            "Received invalid desktop feature lifecycle state IPC response envelope.",
        },
      );
    },

    async disposeIdleFeatures(context = {}) {
      const request = createDesktopFeatureLifecycleIdleDisposeRequest(
        {
          boundary: {
            host: "desktop",
            source: "desktop.renderer.system.lifecycle-diagnostics",
          },
        },
        context,
      );
      const response = await dependencies.ipcRenderer.invoke(
        DESKTOP_FEATURE_LIFECYCLE_IDLE_DISPOSE_REQUEST_CHANNEL.value,
        request,
      );

      return assertDesktopEnvelopeResponse<DesktopFeatureLifecycleIdleDisposeResponse>(
        response,
        {
          operation: DESKTOP_FEATURE_LIFECYCLE_IDLE_DISPOSE_OPERATION,
          channel:
            DESKTOP_FEATURE_LIFECYCLE_IDLE_DISPOSE_RESPONSE_CHANNEL.value,
          message:
            "Received invalid desktop feature lifecycle idle disposal IPC response envelope.",
        },
      );
    },

    async listWorkspaces(context = {}) {
      const response = await dependencies.ipcRenderer.invoke(
        DESKTOP_WORKSPACE_LIST_REQUEST_CHANNEL.value,
        createDesktopWorkspaceListRequest({}, context),
      );
      return assertDesktopEnvelopeResponse<DesktopWorkspaceListResponse>(
        response,
        {
          operation: DESKTOP_WORKSPACE_LIST_OPERATION,
          channel: DESKTOP_WORKSPACE_LIST_RESPONSE_CHANNEL.value,
          message:
            "Received invalid desktop workspace list IPC response envelope.",
        },
      );
    },

    async createWorkspace(input, context = {}) {
      const response = await dependencies.ipcRenderer.invoke(
        DESKTOP_WORKSPACE_CREATE_REQUEST_CHANNEL.value,
        createDesktopWorkspaceCreateRequest(input, context),
      );
      return assertDesktopEnvelopeResponse<DesktopWorkspaceCreateResponse>(
        response,
        {
          operation: DESKTOP_WORKSPACE_CREATE_OPERATION,
          channel: DESKTOP_WORKSPACE_CREATE_RESPONSE_CHANNEL.value,
          message:
            "Received invalid desktop workspace create IPC response envelope.",
        },
      );
    },

    async readActiveWorkspaceSelection(context = {}) {
      const response = await dependencies.ipcRenderer.invoke(
        DESKTOP_WORKSPACE_SELECTION_READ_REQUEST_CHANNEL.value,
        createDesktopWorkspaceSelectionReadRequest(context),
      );
      return assertDesktopEnvelopeResponse<DesktopWorkspaceSelectionReadResponse>(
        response,
        {
          operation: DESKTOP_WORKSPACE_SELECTION_READ_OPERATION,
          channel: DESKTOP_WORKSPACE_SELECTION_READ_RESPONSE_CHANNEL.value,
          message:
            "Received invalid desktop workspace selection read IPC response envelope.",
        },
      );
    },

    async saveActiveWorkspaceSelection(selection, context = {}) {
      const response = await dependencies.ipcRenderer.invoke(
        DESKTOP_WORKSPACE_SELECTION_SAVE_REQUEST_CHANNEL.value,
        createDesktopWorkspaceSelectionSaveRequest({ selection }, context),
      );
      return assertDesktopEnvelopeResponse<DesktopWorkspaceSelectionSaveResponse>(
        response,
        {
          operation: DESKTOP_WORKSPACE_SELECTION_SAVE_OPERATION,
          channel: DESKTOP_WORKSPACE_SELECTION_SAVE_RESPONSE_CHANNEL.value,
          message:
            "Received invalid desktop workspace selection save IPC response envelope.",
        },
      );
    },

    async clearActiveWorkspaceSelection(context = {}) {
      const response = await dependencies.ipcRenderer.invoke(
        DESKTOP_WORKSPACE_SELECTION_CLEAR_REQUEST_CHANNEL.value,
        createDesktopWorkspaceSelectionClearRequest(context),
      );
      return assertDesktopEnvelopeResponse<DesktopWorkspaceSelectionClearResponse>(
        response,
        {
          operation: DESKTOP_WORKSPACE_SELECTION_CLEAR_OPERATION,
          channel: DESKTOP_WORKSPACE_SELECTION_CLEAR_RESPONSE_CHANNEL.value,
          message:
            "Received invalid desktop workspace selection clear IPC response envelope.",
        },
      );
    },

    async promoteWorkspaceAssetToUserLibrary(command, context = {}) {
      const response = await dependencies.ipcRenderer.invoke(
        DESKTOP_USER_LIBRARY_PROMOTE_REQUEST_CHANNEL.value,
        createDesktopUserLibraryPromoteRequest(command, context),
      );
      return assertDesktopEnvelopeResponse<DesktopUserLibraryPromoteResponse>(
        response,
        {
          operation: DESKTOP_USER_LIBRARY_PROMOTE_OPERATION,
          channel: DESKTOP_USER_LIBRARY_PROMOTE_RESPONSE_CHANNEL.value,
          message:
            "Received invalid desktop user-library promotion IPC response envelope.",
        },
      );
    },

    async linkUserLibraryAssetToWorkspace(command, context = {}) {
      const response = await dependencies.ipcRenderer.invoke(
        DESKTOP_USER_LIBRARY_LINK_REQUEST_CHANNEL.value,
        createDesktopUserLibraryLinkRequest(command, context),
      );
      return assertDesktopEnvelopeResponse<DesktopUserLibraryLinkResponse>(
        response,
        {
          operation: DESKTOP_USER_LIBRARY_LINK_OPERATION,
          channel: DESKTOP_USER_LIBRARY_LINK_RESPONSE_CHANNEL.value,
          message:
            "Received invalid desktop user-library link IPC response envelope.",
        },
      );
    },

    async copyUserLibraryAssetToWorkspace(command, context = {}) {
      const response = await dependencies.ipcRenderer.invoke(
        DESKTOP_USER_LIBRARY_COPY_REQUEST_CHANNEL.value,
        createDesktopUserLibraryCopyRequest(command, context),
      );
      return assertDesktopEnvelopeResponse<DesktopUserLibraryCopyResponse>(
        response,
        {
          operation: DESKTOP_USER_LIBRARY_COPY_OPERATION,
          channel: DESKTOP_USER_LIBRARY_COPY_RESPONSE_CHANNEL.value,
          message:
            "Received invalid desktop user-library copy IPC response envelope.",
        },
      );
    },

    async importWorkspaceAssetToWorkspace(command, context = {}) {
      const response = await dependencies.ipcRenderer.invoke(
        DESKTOP_USER_LIBRARY_IMPORT_REQUEST_CHANNEL.value,
        createDesktopUserLibraryImportRequest(command, context),
      );
      return assertDesktopEnvelopeResponse<DesktopUserLibraryImportResponse>(
        response,
        {
          operation: DESKTOP_USER_LIBRARY_IMPORT_OPERATION,
          channel: DESKTOP_USER_LIBRARY_IMPORT_RESPONSE_CHANNEL.value,
          message:
            "Received invalid desktop workspace import IPC response envelope.",
        },
      );
    },

    async listUserLibraryAssets(input = {}, context = {}) {
      const response = await dependencies.ipcRenderer.invoke(
        DESKTOP_USER_LIBRARY_ASSET_LIST_REQUEST_CHANNEL.value,
        createDesktopUserLibraryAssetListRequest(input, context),
      );
      return assertDesktopEnvelopeResponse<DesktopUserLibraryAssetListResponse>(
        response,
        {
          operation: DESKTOP_USER_LIBRARY_ASSET_LIST_OPERATION,
          channel: DESKTOP_USER_LIBRARY_ASSET_LIST_RESPONSE_CHANNEL.value,
          message:
            "Received invalid desktop user-library asset list IPC response envelope.",
        },
      );
    },

    async readUserLibraryAsset(input, context = {}) {
      const response = await dependencies.ipcRenderer.invoke(
        DESKTOP_USER_LIBRARY_ASSET_READ_REQUEST_CHANNEL.value,
        createDesktopUserLibraryAssetReadRequest(input as never, context),
      );
      return assertDesktopEnvelopeResponse<DesktopUserLibraryAssetReadResponse>(
        response,
        {
          operation: DESKTOP_USER_LIBRARY_ASSET_READ_OPERATION,
          channel: DESKTOP_USER_LIBRARY_ASSET_READ_RESPONSE_CHANNEL.value,
          message:
            "Received invalid desktop user-library asset read IPC response envelope.",
        },
      );
    },

    async listWorkspaceUserLibraryLinks(input, context = {}) {
      const response = await dependencies.ipcRenderer.invoke(
        DESKTOP_USER_LIBRARY_LINK_LIST_REQUEST_CHANNEL.value,
        createDesktopWorkspaceUserLibraryLinkListRequest(
          input as never,
          context,
        ),
      );
      return assertDesktopEnvelopeResponse<DesktopWorkspaceUserLibraryLinkListResponse>(
        response,
        {
          operation: DESKTOP_USER_LIBRARY_LINK_LIST_OPERATION,
          channel: DESKTOP_USER_LIBRARY_LINK_LIST_RESPONSE_CHANNEL.value,
          message:
            "Received invalid desktop workspace user-library link list IPC response envelope.",
        },
      );
    },

    async readWorkspaceUserLibraryLink(input, context = {}) {
      const response = await dependencies.ipcRenderer.invoke(
        DESKTOP_USER_LIBRARY_LINK_READ_REQUEST_CHANNEL.value,
        createDesktopWorkspaceUserLibraryLinkReadRequest(
          input as never,
          context,
        ),
      );
      return assertDesktopEnvelopeResponse<DesktopWorkspaceUserLibraryLinkReadResponse>(
        response,
        {
          operation: DESKTOP_USER_LIBRARY_LINK_READ_OPERATION,
          channel: DESKTOP_USER_LIBRARY_LINK_READ_RESPONSE_CHANNEL.value,
          message:
            "Received invalid desktop workspace user-library link read IPC response envelope.",
        },
      );
    },

    async readWorkspaceEffectiveAssetSources(input, context = {}) {
      const response = await dependencies.ipcRenderer.invoke(
        DESKTOP_WORKSPACE_EFFECTIVE_ASSET_SOURCE_LIST_REQUEST_CHANNEL.value,
        createDesktopWorkspaceEffectiveAssetSourceListRequest(
          input as never,
          context,
        ),
      );
      return assertDesktopEnvelopeResponse<DesktopWorkspaceEffectiveAssetSourceListResponse>(
        response,
        {
          operation: DESKTOP_WORKSPACE_EFFECTIVE_ASSET_SOURCE_LIST_OPERATION,
          channel:
            DESKTOP_WORKSPACE_EFFECTIVE_ASSET_SOURCE_LIST_RESPONSE_CHANNEL.value,
          message:
            "Received invalid desktop effective asset source IPC response envelope.",
        },
      );
    },
    async listEffectiveAssetProjections(input, context = {}) {
      if (!input.workspaceId?.trim())
        throw new Error("workspaceId is required.");
      return dependencies.ipcRenderer.invoke(
        "effective-asset-projections:list",
        {
          payload: {
            targetWorkspaceId: input.workspaceId,
            limit: input.limit,
            cursor: input.cursor,
            status: input.status,
            sourceKind: input.sourceKind,
            policy: input.policy,
          },
          context,
        },
      );
    },
    async readEffectiveAssetProjection(input, context = {}) {
      if (!input.workspaceId?.trim())
        throw new Error("workspaceId is required.");
      if (!input.projectionId?.trim())
        throw new Error("projectionId is required.");
      return dependencies.ipcRenderer.invoke(
        "effective-asset-projections:read",
        {
          payload: {
            targetWorkspaceId: input.workspaceId,
            projectionId: input.projectionId,
          },
          context,
        },
      );
    },
    async refreshEffectiveAssetProjection(_input, _context = {}) {
      return {
        ok: false,
        error: {
          code: "unsupported",
          message: "Refreshing is deferred for Phase 9 desktop UI.",
        },
      };
    },
    async createAssetCompositionPlan(input, context = {}) {
      if (!input.targetWorkspaceId?.trim())
        throw new Error("targetWorkspaceId is required.");
      return dependencies.ipcRenderer.invoke("asset-composition:create-plan", {
        payload: input,
        context,
      });
    },
    async updateAssetCompositionPlan(input, context = {}) {
      if (!input.targetWorkspaceId?.trim())
        throw new Error("targetWorkspaceId is required.");
      if (!input.planId?.trim()) throw new Error("planId is required.");
      return dependencies.ipcRenderer.invoke("asset-composition:update-plan", {
        payload: input,
        context,
      });
    },
    async readAssetCompositionPlan(input, context = {}) {
      if (!input.targetWorkspaceId?.trim())
        throw new Error("targetWorkspaceId is required.");
      if (!input.planId?.trim()) throw new Error("planId is required.");
      return dependencies.ipcRenderer.invoke("asset-composition:read-plan", {
        payload: input,
        context,
      });
    },
    async listAssetCompositionPlans(input, context = {}) {
      if (!input.targetWorkspaceId?.trim())
        throw new Error("targetWorkspaceId is required.");
      return dependencies.ipcRenderer.invoke("asset-composition:list-plans", {
        payload: input,
        context,
      });
    },
    async archiveAssetCompositionPlan(input, context = {}) {
      if (!input.targetWorkspaceId?.trim() || !input.planId?.trim())
        throw new Error("Invalid request.");
      return dependencies.ipcRenderer.invoke("asset-composition:archive-plan", {
        payload: input,
        context,
      });
    },
    async addProjectionToAssetCompositionPlan(input, context = {}) {
      if (!input.targetWorkspaceId?.trim() || !input.planId?.trim())
        throw new Error("Invalid request.");
      return dependencies.ipcRenderer.invoke(
        "asset-composition:add-projection",
        { payload: input, context },
      );
    },
    async removeProjectionFromAssetCompositionPlan(input, context = {}) {
      if (
        !input.targetWorkspaceId?.trim() ||
        !input.planId?.trim() ||
        !input.projectionId?.trim()
      )
        throw new Error("Invalid request.");
      return dependencies.ipcRenderer.invoke(
        "asset-composition:remove-projection",
        { payload: input, context },
      );
    },
    async connectAssetCompositionNodes(input, context = {}) {
      if (!input.targetWorkspaceId?.trim() || !input.planId?.trim())
        throw new Error("Invalid request.");
      return dependencies.ipcRenderer.invoke(
        "asset-composition:connect-nodes",
        { payload: input, context },
      );
    },
    async disconnectAssetCompositionNodes(input, context = {}) {
      if (
        !input.targetWorkspaceId?.trim() ||
        !input.planId?.trim() ||
        !input.relationshipId?.trim()
      )
        throw new Error("Invalid request.");
      return dependencies.ipcRenderer.invoke(
        "asset-composition:disconnect-nodes",
        { payload: input, context },
      );
    },
    async validateAssetCompositionPlan(input, context = {}) {
      if (!input.targetWorkspaceId?.trim() || !input.planId?.trim())
        throw new Error("Invalid request.");
      return dependencies.ipcRenderer.invoke(
        "asset-composition:validate-plan",
        { payload: input, context },
      );
    },
    async listAssetCompositionPlanSummaries(input, context = {}) {
      if (!input.targetWorkspaceId?.trim()) throw new Error("Invalid request.");
      return dependencies.ipcRenderer.invoke(
        "asset-composition:list-plan-summaries",
        { payload: input, context },
      );
    },
    async readAssetCompositionPlanDetail(input, context = {}) {
      if (!input.targetWorkspaceId?.trim() || !input.planId?.trim())
        throw new Error("Invalid request.");
      return dependencies.ipcRenderer.invoke(
        "asset-composition:read-plan-detail",
        { payload: input, context },
      );
    },
    async listCompositionPlansForProjection(input, context = {}) {
      if (!input.targetWorkspaceId?.trim() || !input.projectionId?.trim())
        throw new Error("Invalid request.");
      return dependencies.ipcRenderer.invoke(
        "asset-composition:list-plans-for-projection",
        { payload: input, context },
      );
    },
    async listCompositionPlansForEffectiveAsset(input, context = {}) {
      if (!input.targetWorkspaceId?.trim()) throw new Error("Invalid request.");
      return dependencies.ipcRenderer.invoke(
        "asset-composition:list-plans-for-effective-asset",
        { payload: input, context },
      );
    },
    async listCompositionPlansNeedingAttention(input, context = {}) {
      if (!input.targetWorkspaceId?.trim()) throw new Error("Invalid request.");
      return dependencies.ipcRenderer.invoke(
        "asset-composition:list-plans-needing-attention",
        { payload: input, context },
      );
    },

    async createWorkspaceAuthoredAsset(command, context = {}) {
      const response = await dependencies.ipcRenderer.invoke(
        DESKTOP_ASSET_AUTHORING_CREATE_WORKSPACE_AUTHORED_ASSET_REQUEST_CHANNEL.value,
        {
          payload: command,
          operation:
            DESKTOP_ASSET_AUTHORING_CREATE_WORKSPACE_AUTHORED_ASSET_OPERATION,
          channel:
            DESKTOP_ASSET_AUTHORING_CREATE_WORKSPACE_AUTHORED_ASSET_REQUEST_CHANNEL.value,
          requestId: context.requestId,
          correlationId: context.correlationId,
        },
      );
      return assertDesktopEnvelopeResponse<DesktopAssetAuthoringCreateWorkspaceAuthoredAssetResponse>(
        response,
        {
          operation:
            DESKTOP_ASSET_AUTHORING_CREATE_WORKSPACE_AUTHORED_ASSET_OPERATION,
          channel:
            DESKTOP_ASSET_AUTHORING_CREATE_WORKSPACE_AUTHORED_ASSET_RESPONSE_CHANNEL.value,
          message:
            "Received invalid desktop asset authoring create workspace-authored asset IPC response envelope.",
        },
      );
    },
    async createAssetDraft(command, context = {}) {
      const response = await dependencies.ipcRenderer.invoke(
        DESKTOP_ASSET_AUTHORING_CREATE_DRAFT_REQUEST_CHANNEL.value,
        {
          payload: command,
          operation: DESKTOP_ASSET_AUTHORING_CREATE_DRAFT_OPERATION,
          channel: DESKTOP_ASSET_AUTHORING_CREATE_DRAFT_REQUEST_CHANNEL.value,
          requestId: context.requestId,
          correlationId: context.correlationId,
        },
      );
      return assertDesktopEnvelopeResponse<DesktopAssetAuthoringCreateDraftResponse>(
        response,
        {
          operation: DESKTOP_ASSET_AUTHORING_CREATE_DRAFT_OPERATION,
          channel: DESKTOP_ASSET_AUTHORING_CREATE_DRAFT_RESPONSE_CHANNEL.value,
          message:
            "Received invalid desktop asset authoring create draft IPC response envelope.",
        },
      );
    },
    async updateAssetDraft(command, context = {}) {
      const response = await dependencies.ipcRenderer.invoke(
        DESKTOP_ASSET_AUTHORING_UPDATE_DRAFT_REQUEST_CHANNEL.value,
        {
          payload: command,
          operation: DESKTOP_ASSET_AUTHORING_UPDATE_DRAFT_OPERATION,
          channel: DESKTOP_ASSET_AUTHORING_UPDATE_DRAFT_REQUEST_CHANNEL.value,
          requestId: context.requestId,
          correlationId: context.correlationId,
        },
      );
      return assertDesktopEnvelopeResponse<DesktopAssetAuthoringUpdateDraftResponse>(
        response,
        {
          operation: DESKTOP_ASSET_AUTHORING_UPDATE_DRAFT_OPERATION,
          channel: DESKTOP_ASSET_AUTHORING_UPDATE_DRAFT_RESPONSE_CHANNEL.value,
          message:
            "Received invalid desktop asset authoring update draft IPC response envelope.",
        },
      );
    },
    async publishAssetDraft(command, context = {}) {
      const response = await dependencies.ipcRenderer.invoke(
        DESKTOP_ASSET_AUTHORING_PUBLISH_DRAFT_REQUEST_CHANNEL.value,
        {
          payload: command,
          operation: DESKTOP_ASSET_AUTHORING_PUBLISH_DRAFT_OPERATION,
          channel: DESKTOP_ASSET_AUTHORING_PUBLISH_DRAFT_REQUEST_CHANNEL.value,
          requestId: context.requestId,
          correlationId: context.correlationId,
        },
      );
      return assertDesktopEnvelopeResponse<DesktopAssetAuthoringPublishDraftResponse>(
        response,
        {
          operation: DESKTOP_ASSET_AUTHORING_PUBLISH_DRAFT_OPERATION,
          channel: DESKTOP_ASSET_AUTHORING_PUBLISH_DRAFT_RESPONSE_CHANNEL.value,
          message:
            "Received invalid desktop asset authoring publish draft IPC response envelope.",
        },
      );
    },
    async createAssetOverride(command, context = {}) {
      const response = await dependencies.ipcRenderer.invoke(
        DESKTOP_ASSET_AUTHORING_CREATE_OVERRIDE_REQUEST_CHANNEL.value,
        {
          payload: command,
          operation: DESKTOP_ASSET_AUTHORING_CREATE_OVERRIDE_OPERATION,
          channel:
            DESKTOP_ASSET_AUTHORING_CREATE_OVERRIDE_REQUEST_CHANNEL.value,
          requestId: context.requestId,
          correlationId: context.correlationId,
        },
      );
      return assertDesktopEnvelopeResponse<DesktopAssetAuthoringCreateOverrideResponse>(
        response,
        {
          operation: DESKTOP_ASSET_AUTHORING_CREATE_OVERRIDE_OPERATION,
          channel:
            DESKTOP_ASSET_AUTHORING_CREATE_OVERRIDE_RESPONSE_CHANNEL.value,
          message:
            "Received invalid desktop asset authoring create override IPC response envelope.",
        },
      );
    },
    async updateAssetOverride(command, context = {}) {
      const response = await dependencies.ipcRenderer.invoke(
        DESKTOP_ASSET_AUTHORING_UPDATE_OVERRIDE_REQUEST_CHANNEL.value,
        {
          payload: command,
          operation: DESKTOP_ASSET_AUTHORING_UPDATE_OVERRIDE_OPERATION,
          channel:
            DESKTOP_ASSET_AUTHORING_UPDATE_OVERRIDE_REQUEST_CHANNEL.value,
          requestId: context.requestId,
          correlationId: context.correlationId,
        },
      );
      return assertDesktopEnvelopeResponse<DesktopAssetAuthoringUpdateOverrideResponse>(
        response,
        {
          operation: DESKTOP_ASSET_AUTHORING_UPDATE_OVERRIDE_OPERATION,
          channel:
            DESKTOP_ASSET_AUTHORING_UPDATE_OVERRIDE_RESPONSE_CHANNEL.value,
          message:
            "Received invalid desktop asset authoring update override IPC response envelope.",
        },
      );
    },
    async disableAssetOverride(command, context = {}) {
      const response = await dependencies.ipcRenderer.invoke(
        DESKTOP_ASSET_AUTHORING_DISABLE_OVERRIDE_REQUEST_CHANNEL.value,
        {
          payload: command,
          operation: DESKTOP_ASSET_AUTHORING_DISABLE_OVERRIDE_OPERATION,
          channel:
            DESKTOP_ASSET_AUTHORING_DISABLE_OVERRIDE_REQUEST_CHANNEL.value,
          requestId: context.requestId,
          correlationId: context.correlationId,
        },
      );
      return assertDesktopEnvelopeResponse<DesktopAssetAuthoringDisableOverrideResponse>(
        response,
        {
          operation: DESKTOP_ASSET_AUTHORING_DISABLE_OVERRIDE_OPERATION,
          channel:
            DESKTOP_ASSET_AUTHORING_DISABLE_OVERRIDE_RESPONSE_CHANNEL.value,
          message:
            "Received invalid desktop asset authoring disable override IPC response envelope.",
        },
      );
    },
    async listAuthoredAssets(input, context = {}) {
      const response = await dependencies.ipcRenderer.invoke(
        DESKTOP_ASSET_AUTHORING_LIST_AUTHORED_ASSETS_REQUEST_CHANNEL.value,
        {
          payload: input,
          operation: DESKTOP_ASSET_AUTHORING_LIST_AUTHORED_ASSETS_OPERATION,
          channel:
            DESKTOP_ASSET_AUTHORING_LIST_AUTHORED_ASSETS_REQUEST_CHANNEL.value,
          requestId: context.requestId,
          correlationId: context.correlationId,
        },
      );
      return assertDesktopEnvelopeResponse<DesktopAssetAuthoringListAuthoredAssetsResponse>(
        response,
        {
          operation: DESKTOP_ASSET_AUTHORING_LIST_AUTHORED_ASSETS_OPERATION,
          channel:
            DESKTOP_ASSET_AUTHORING_LIST_AUTHORED_ASSETS_RESPONSE_CHANNEL.value,
          message:
            "Received invalid desktop asset authoring list authored assets IPC response envelope.",
        },
      );
    },
    async readAuthoredAsset(input, context = {}) {
      const response = await dependencies.ipcRenderer.invoke(
        DESKTOP_ASSET_AUTHORING_READ_AUTHORED_ASSET_REQUEST_CHANNEL.value,
        {
          payload: input,
          operation: DESKTOP_ASSET_AUTHORING_READ_AUTHORED_ASSET_OPERATION,
          channel:
            DESKTOP_ASSET_AUTHORING_READ_AUTHORED_ASSET_REQUEST_CHANNEL.value,
          requestId: context.requestId,
          correlationId: context.correlationId,
        },
      );
      return assertDesktopEnvelopeResponse<DesktopAssetAuthoringReadAuthoredAssetResponse>(
        response,
        {
          operation: DESKTOP_ASSET_AUTHORING_READ_AUTHORED_ASSET_OPERATION,
          channel:
            DESKTOP_ASSET_AUTHORING_READ_AUTHORED_ASSET_RESPONSE_CHANNEL.value,
          message:
            "Received invalid desktop asset authoring read authored asset IPC response envelope.",
        },
      );
    },
    async listAssetDrafts(input, context = {}) {
      const response = await dependencies.ipcRenderer.invoke(
        DESKTOP_ASSET_AUTHORING_LIST_DRAFTS_REQUEST_CHANNEL.value,
        {
          payload: input,
          operation: DESKTOP_ASSET_AUTHORING_LIST_DRAFTS_OPERATION,
          channel: DESKTOP_ASSET_AUTHORING_LIST_DRAFTS_REQUEST_CHANNEL.value,
          requestId: context.requestId,
          correlationId: context.correlationId,
        },
      );
      return assertDesktopEnvelopeResponse<DesktopAssetAuthoringListDraftsResponse>(
        response,
        {
          operation: DESKTOP_ASSET_AUTHORING_LIST_DRAFTS_OPERATION,
          channel: DESKTOP_ASSET_AUTHORING_LIST_DRAFTS_RESPONSE_CHANNEL.value,
          message:
            "Received invalid desktop asset authoring list drafts IPC response envelope.",
        },
      );
    },
    async readAssetDraft(input, context = {}) {
      const response = await dependencies.ipcRenderer.invoke(
        DESKTOP_ASSET_AUTHORING_READ_DRAFT_REQUEST_CHANNEL.value,
        {
          payload: input,
          operation: DESKTOP_ASSET_AUTHORING_READ_DRAFT_OPERATION,
          channel: DESKTOP_ASSET_AUTHORING_READ_DRAFT_REQUEST_CHANNEL.value,
          requestId: context.requestId,
          correlationId: context.correlationId,
        },
      );
      return assertDesktopEnvelopeResponse<DesktopAssetAuthoringReadDraftResponse>(
        response,
        {
          operation: DESKTOP_ASSET_AUTHORING_READ_DRAFT_OPERATION,
          channel: DESKTOP_ASSET_AUTHORING_READ_DRAFT_RESPONSE_CHANNEL.value,
          message:
            "Received invalid desktop asset authoring read draft IPC response envelope.",
        },
      );
    },
    async listAssetRevisions(input, context = {}) {
      const response = await dependencies.ipcRenderer.invoke(
        DESKTOP_ASSET_AUTHORING_LIST_REVISIONS_REQUEST_CHANNEL.value,
        {
          payload: input,
          operation: DESKTOP_ASSET_AUTHORING_LIST_REVISIONS_OPERATION,
          channel: DESKTOP_ASSET_AUTHORING_LIST_REVISIONS_REQUEST_CHANNEL.value,
          requestId: context.requestId,
          correlationId: context.correlationId,
        },
      );
      return assertDesktopEnvelopeResponse<DesktopAssetAuthoringListRevisionsResponse>(
        response,
        {
          operation: DESKTOP_ASSET_AUTHORING_LIST_REVISIONS_OPERATION,
          channel:
            DESKTOP_ASSET_AUTHORING_LIST_REVISIONS_RESPONSE_CHANNEL.value,
          message:
            "Received invalid desktop asset authoring list revisions IPC response envelope.",
        },
      );
    },
    async readAssetRevision(input, context = {}) {
      const response = await dependencies.ipcRenderer.invoke(
        DESKTOP_ASSET_AUTHORING_READ_REVISION_REQUEST_CHANNEL.value,
        {
          payload: input,
          operation: DESKTOP_ASSET_AUTHORING_READ_REVISION_OPERATION,
          channel: DESKTOP_ASSET_AUTHORING_READ_REVISION_REQUEST_CHANNEL.value,
          requestId: context.requestId,
          correlationId: context.correlationId,
        },
      );
      return assertDesktopEnvelopeResponse<DesktopAssetAuthoringReadRevisionResponse>(
        response,
        {
          operation: DESKTOP_ASSET_AUTHORING_READ_REVISION_OPERATION,
          channel: DESKTOP_ASSET_AUTHORING_READ_REVISION_RESPONSE_CHANNEL.value,
          message:
            "Received invalid desktop asset authoring read revision IPC response envelope.",
        },
      );
    },
    async listAssetOverrides(input, context = {}) {
      const response = await dependencies.ipcRenderer.invoke(
        DESKTOP_ASSET_AUTHORING_LIST_OVERRIDES_REQUEST_CHANNEL.value,
        {
          payload: input,
          operation: DESKTOP_ASSET_AUTHORING_LIST_OVERRIDES_OPERATION,
          channel: DESKTOP_ASSET_AUTHORING_LIST_OVERRIDES_REQUEST_CHANNEL.value,
          requestId: context.requestId,
          correlationId: context.correlationId,
        },
      );
      return assertDesktopEnvelopeResponse<DesktopAssetAuthoringListOverridesResponse>(
        response,
        {
          operation: DESKTOP_ASSET_AUTHORING_LIST_OVERRIDES_OPERATION,
          channel:
            DESKTOP_ASSET_AUTHORING_LIST_OVERRIDES_RESPONSE_CHANNEL.value,
          message:
            "Received invalid desktop asset authoring list overrides IPC response envelope.",
        },
      );
    },
    async readAssetOverride(input, context = {}) {
      const response = await dependencies.ipcRenderer.invoke(
        DESKTOP_ASSET_AUTHORING_READ_OVERRIDE_REQUEST_CHANNEL.value,
        {
          payload: input,
          operation: DESKTOP_ASSET_AUTHORING_READ_OVERRIDE_OPERATION,
          channel: DESKTOP_ASSET_AUTHORING_READ_OVERRIDE_REQUEST_CHANNEL.value,
          requestId: context.requestId,
          correlationId: context.correlationId,
        },
      );
      return assertDesktopEnvelopeResponse<DesktopAssetAuthoringReadOverrideResponse>(
        response,
        {
          operation: DESKTOP_ASSET_AUTHORING_READ_OVERRIDE_OPERATION,
          channel: DESKTOP_ASSET_AUTHORING_READ_OVERRIDE_RESPONSE_CHANNEL.value,
          message:
            "Received invalid desktop asset authoring read override IPC response envelope.",
        },
      );
    },
    async listAssetAuthoringEffectiveSummaries(input, context = {}) {
      const response = await dependencies.ipcRenderer.invoke(
        DESKTOP_ASSET_AUTHORING_LIST_EFFECTIVE_SUMMARIES_REQUEST_CHANNEL.value,
        {
          payload: input,
          operation: DESKTOP_ASSET_AUTHORING_LIST_EFFECTIVE_SUMMARIES_OPERATION,
          channel:
            DESKTOP_ASSET_AUTHORING_LIST_EFFECTIVE_SUMMARIES_REQUEST_CHANNEL.value,
          requestId: context.requestId,
          correlationId: context.correlationId,
        },
      );
      return assertDesktopEnvelopeResponse<DesktopAssetAuthoringListEffectiveSummariesResponse>(
        response,
        {
          operation: DESKTOP_ASSET_AUTHORING_LIST_EFFECTIVE_SUMMARIES_OPERATION,
          channel:
            DESKTOP_ASSET_AUTHORING_LIST_EFFECTIVE_SUMMARIES_RESPONSE_CHANNEL.value,
          message:
            "Received invalid desktop asset authoring list effective summaries IPC response envelope.",
        },
      );
    },
    async listAssetDerivedCustomizationTargets(input, context = {}) {
      return invokeAssetDerivedCustomization(dependencies, "listTargets", input, context) as Promise<DesktopAssetDerivedCustomizationListTargetsResponse>;
    },
    async readAssetDerivedCustomizationTarget(input, context = {}) {
      return invokeAssetDerivedCustomization(dependencies, "readTarget", input, context) as Promise<DesktopAssetDerivedCustomizationReadTargetResponse>;
    },
    async createAssetDerivedCustomization(input, context = {}) {
      return invokeAssetDerivedCustomization(dependencies, "create", input, context) as Promise<DesktopAssetDerivedCustomizationCreateResponse>;
    },
    async updateAssetDerivedCustomization(input, context = {}) {
      return invokeAssetDerivedCustomization(dependencies, "update", input, context) as Promise<DesktopAssetDerivedCustomizationUpdateResponse>;
    },
    async reviewAssetDerivedCustomization(input, context = {}) {
      return invokeAssetDerivedCustomization(dependencies, "review", input, context) as Promise<DesktopAssetDerivedCustomizationReviewResponse>;
    },
    async publishAssetDerivedCustomization(input, context = {}) {
      return invokeAssetDerivedCustomization(dependencies, "publish", input, context) as Promise<DesktopAssetDerivedCustomizationPublishResponse>;
    },
    async abandonAssetDerivedCustomization(input, context = {}) {
      return invokeAssetDerivedCustomization(dependencies, "abandon", input, context) as Promise<DesktopAssetDerivedCustomizationAbandonResponse>;
    },
    async listAssetDerivedCustomizations(input, context = {}) {
      return invokeAssetDerivedCustomization(dependencies, "list", input, context) as Promise<DesktopAssetDerivedCustomizationListResponse>;
    },
    async readAssetDerivedCustomization(input, context = {}) {
      return invokeAssetDerivedCustomization(dependencies, "read", input, context) as Promise<DesktopAssetDerivedCustomizationReadResponse>;
    },
    async listAssetDefinitions(input = {}, context = {}) {
      const request = createDesktopAssetDefinitionsListRequest(
        {
          ...input,
          boundary: {
            host: "desktop",
            source: assetRegistrySource,
          },
        },
        context,
      );
      const response = await dependencies.ipcRenderer.invoke(
        DESKTOP_ASSET_DEFINITIONS_LIST_REQUEST_CHANNEL.value,
        request,
      );

      return assertDesktopEnvelopeResponse<DesktopAssetDefinitionsListResponse>(
        response,
        {
          operation: DESKTOP_ASSET_DEFINITIONS_LIST_OPERATION,
          channel: DESKTOP_ASSET_DEFINITIONS_LIST_RESPONSE_CHANNEL.value,
          message:
            "Received invalid desktop asset definitions list IPC response envelope.",
        },
      );
    },

    async readAssetDefinition(input, context = {}) {
      const request = createDesktopAssetDefinitionReadRequest(
        {
          ...input,
          boundary: {
            host: "desktop",
            source: assetRegistrySource,
          },
        },
        context,
      );
      const response = await dependencies.ipcRenderer.invoke(
        DESKTOP_ASSET_DEFINITION_READ_REQUEST_CHANNEL.value,
        request,
      );

      return assertDesktopEnvelopeResponse<DesktopAssetDefinitionReadResponse>(
        response,
        {
          operation: DESKTOP_ASSET_DEFINITION_READ_OPERATION,
          channel: DESKTOP_ASSET_DEFINITION_READ_RESPONSE_CHANNEL.value,
          message:
            "Received invalid desktop asset definition read IPC response envelope.",
        },
      );
    },

    async readAssetDefinitionVersion(input, context = {}) {
      const request = createDesktopAssetDefinitionVersionReadRequest(
        {
          ...input,
          boundary: {
            host: "desktop",
            source: assetRegistrySource,
          },
        },
        context,
      );
      const response = await dependencies.ipcRenderer.invoke(
        DESKTOP_ASSET_DEFINITION_VERSION_READ_REQUEST_CHANNEL.value,
        request,
      );

      return assertDesktopEnvelopeResponse<DesktopAssetDefinitionVersionReadResponse>(
        response,
        {
          operation: DESKTOP_ASSET_DEFINITION_VERSION_READ_OPERATION,
          channel: DESKTOP_ASSET_DEFINITION_VERSION_READ_RESPONSE_CHANNEL.value,
          message:
            "Received invalid desktop asset definition version read IPC response envelope.",
        },
      );
    },

    async listAssetResourceBackedViews(input = {}, context = {}) {
      const request = createDesktopAssetResourceBackedViewsListRequest(
        {
          ...input,
          boundary: {
            host: "desktop",
            source: DEFAULT_ASSET_REGISTRY_SOURCE,
          },
        },
        context,
      );
      const response = await dependencies.ipcRenderer.invoke(
        DESKTOP_ASSET_RESOURCE_BACKED_VIEWS_LIST_REQUEST_CHANNEL.value,
        request,
      );

      return assertDesktopEnvelopeResponse<DesktopAssetResourceBackedViewsListResponse>(
        response,
        {
          operation: DESKTOP_ASSET_RESOURCE_BACKED_VIEWS_LIST_OPERATION,
          channel:
            DESKTOP_ASSET_RESOURCE_BACKED_VIEWS_LIST_RESPONSE_CHANNEL.value,
          message:
            "Received invalid desktop asset resource-backed views list IPC response envelope.",
        },
      );
    },

    async readAssetResourceBackedView(input, context = {}) {
      const request = createDesktopAssetResourceBackedViewReadRequest(
        {
          ...input,
          boundary: {
            host: "desktop",
            source: DEFAULT_ASSET_REGISTRY_SOURCE,
          },
        },
        context,
      );
      const response = await dependencies.ipcRenderer.invoke(
        DESKTOP_ASSET_RESOURCE_BACKED_VIEW_READ_REQUEST_CHANNEL.value,
        request,
      );

      return assertDesktopEnvelopeResponse<DesktopAssetResourceBackedViewReadResponse>(
        response,
        {
          operation: DESKTOP_ASSET_RESOURCE_BACKED_VIEW_READ_OPERATION,
          channel:
            DESKTOP_ASSET_RESOURCE_BACKED_VIEW_READ_RESPONSE_CHANNEL.value,
          message:
            "Received invalid desktop asset resource-backed view read IPC response envelope.",
        },
      );
    },

    async registerResourceBackedViewAsAsset(command, context = {}) {
      const request = createDesktopAssetRegisterResourceBackedViewRequest(
        withMutationRequestContext(command, context),
        context,
      );
      const response = await dependencies.ipcRenderer.invoke(
        DESKTOP_ASSET_REGISTER_RESOURCE_BACKED_VIEW_REQUEST_CHANNEL.value,
        request,
      );

      return assertDesktopEnvelopeResponse<DesktopAssetRegisterResourceBackedViewResponse>(
        response,
        {
          operation: DESKTOP_ASSET_REGISTER_RESOURCE_BACKED_VIEW_OPERATION,
          channel:
            DESKTOP_ASSET_REGISTER_RESOURCE_BACKED_VIEW_RESPONSE_CHANNEL.value,
          message:
            "Received invalid desktop asset register resource-backed view IPC response envelope.",
        },
      );
    },

    async finalizeGeneratedOutputAsAsset(command, context = {}) {
      const request = createDesktopAssetFinalizeGeneratedOutputRequest(
        withMutationRequestContext(command, context),
        context,
      );
      const response = await dependencies.ipcRenderer.invoke(
        DESKTOP_ASSET_FINALIZE_GENERATED_OUTPUT_REQUEST_CHANNEL.value,
        request,
      );

      return assertDesktopEnvelopeResponse<DesktopAssetFinalizeGeneratedOutputResponse>(
        response,
        {
          operation: DESKTOP_ASSET_FINALIZE_GENERATED_OUTPUT_OPERATION,
          channel:
            DESKTOP_ASSET_FINALIZE_GENERATED_OUTPUT_RESPONSE_CHANNEL.value,
          message:
            "Received invalid desktop asset finalize generated output IPC response envelope.",
        },
      );
    },

    async importExternalRepositoryObjectAsAsset(command, context = {}) {
      const request = createDesktopAssetImportExternalRepositoryObjectRequest(
        withMutationRequestContext(command, context),
        context,
      );
      const response = await dependencies.ipcRenderer.invoke(
        DESKTOP_ASSET_IMPORT_EXTERNAL_REPOSITORY_OBJECT_REQUEST_CHANNEL.value,
        request,
      );

      return assertDesktopEnvelopeResponse<DesktopAssetImportExternalRepositoryObjectResponse>(
        response,
        {
          operation: DESKTOP_ASSET_IMPORT_EXTERNAL_REPOSITORY_OBJECT_OPERATION,
          channel:
            DESKTOP_ASSET_IMPORT_EXTERNAL_REPOSITORY_OBJECT_RESPONSE_CHANNEL.value,
          message:
            "Received invalid desktop asset import external repository object IPC response envelope.",
        },
      );
    },

    async localizeExternalRepositoryObjectAsAsset(command, context = {}) {
      const request = createDesktopAssetLocalizeExternalRepositoryObjectRequest(
        withMutationRequestContext(command, context),
        context,
      );
      const response = await dependencies.ipcRenderer.invoke(
        DESKTOP_ASSET_LOCALIZE_EXTERNAL_REPOSITORY_OBJECT_REQUEST_CHANNEL.value,
        request,
      );

      return assertDesktopEnvelopeResponse<DesktopAssetLocalizeExternalRepositoryObjectResponse>(
        response,
        {
          operation:
            DESKTOP_ASSET_LOCALIZE_EXTERNAL_REPOSITORY_OBJECT_OPERATION,
          channel:
            DESKTOP_ASSET_LOCALIZE_EXTERNAL_REPOSITORY_OBJECT_RESPONSE_CHANNEL.value,
          message:
            "Received invalid desktop asset localize external repository object IPC response envelope.",
        },
      );
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

      return assertDesktopEnvelopeResponse<DesktopPythonRuntimeStatusReadResponse>(
        response,
        {
          operation: DESKTOP_PYTHON_RUNTIME_STATUS_READ_OPERATION,
          channel: DESKTOP_PYTHON_RUNTIME_STATUS_READ_RESPONSE_CHANNEL.value,
          message:
            "Received invalid desktop python runtime status IPC response envelope.",
        },
      );
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

      return assertDesktopEnvelopeResponse<DesktopPythonRuntimeControlResponse>(
        response,
        {
          operation: DESKTOP_PYTHON_RUNTIME_CONTROL_OPERATION,
          channel: DESKTOP_PYTHON_RUNTIME_CONTROL_RESPONSE_CHANNEL.value,
          message:
            "Received invalid desktop python runtime control IPC response envelope.",
        },
      );
    },
    async startImageGeneration(input, context = {}) {
      const request = createDesktopImageGenerationStartRequest(input, context);
      const response = await dependencies.ipcRenderer.invoke(
        DESKTOP_IMAGE_GENERATION_START_REQUEST_CHANNEL.value,
        request,
      );
      return assertDesktopEnvelopeResponse<DesktopImageGenerationStartResponse>(
        response,
        {
          operation: DESKTOP_IMAGE_GENERATION_START_OPERATION,
          channel: DESKTOP_IMAGE_GENERATION_START_RESPONSE_CHANNEL.value,
          message:
            "Received invalid desktop image generation start IPC response envelope.",
        },
      );
    },
    async readImageGeneration(input, context = {}) {
      const request = createDesktopImageGenerationReadRequest(input, context);
      const response = await dependencies.ipcRenderer.invoke(
        DESKTOP_IMAGE_GENERATION_READ_REQUEST_CHANNEL.value,
        request,
      );
      return assertDesktopEnvelopeResponse<DesktopImageGenerationReadResponse>(
        response,
        {
          operation: DESKTOP_IMAGE_GENERATION_READ_OPERATION,
          channel: DESKTOP_IMAGE_GENERATION_READ_RESPONSE_CHANNEL.value,
          message:
            "Received invalid desktop image generation read IPC response envelope.",
        },
      );
    },
    async cancelImageGeneration(input, context = {}) {
      const request = createDesktopImageGenerationCancelRequest(input, context);
      const response = await dependencies.ipcRenderer.invoke(
        DESKTOP_IMAGE_GENERATION_CANCEL_REQUEST_CHANNEL.value,
        request,
      );
      return assertDesktopEnvelopeResponse<DesktopImageGenerationCancelResponse>(
        response,
        {
          operation: DESKTOP_IMAGE_GENERATION_CANCEL_OPERATION,
          channel: DESKTOP_IMAGE_GENERATION_CANCEL_RESPONSE_CHANNEL.value,
          message:
            "Received invalid desktop image generation cancel IPC response envelope.",
        },
      );
    },
    async finalizeImageGenerationIfCompleted(input, context = {}) {
      const request = createDesktopImageGenerationFinalizeRequest(
        input,
        context,
      );
      const response = await dependencies.ipcRenderer.invoke(
        DESKTOP_IMAGE_GENERATION_FINALIZE_REQUEST_CHANNEL.value,
        request,
      );
      return assertDesktopEnvelopeResponse<DesktopImageGenerationFinalizeResponse>(
        response,
        {
          operation: DESKTOP_IMAGE_GENERATION_FINALIZE_OPERATION,
          channel: DESKTOP_IMAGE_GENERATION_FINALIZE_RESPONSE_CHANNEL.value,
          message:
            "Received invalid desktop image generation finalization IPC response envelope.",
        },
      );
    },
    async readComfyUiInstallStatus(input = {}, context = {}) {
      const request = createDesktopComfyUiInstallStatusRequest(input, context);
      const response = await dependencies.ipcRenderer.invoke(
        DESKTOP_COMFYUI_INSTALL_STATUS_READ_REQUEST_CHANNEL.value,
        request,
      );
      return assertDesktopEnvelopeResponse(response, {
        operation: DESKTOP_COMFYUI_INSTALL_STATUS_READ_OPERATION,
        channel: DESKTOP_COMFYUI_INSTALL_STATUS_READ_RESPONSE_CHANNEL.value,
        message:
          "Received invalid desktop ComfyUI install status IPC response envelope.",
      });
    },
    async repairComfyUiInstall(input = {}, context = {}) {
      const request = createDesktopComfyUiRepairInstallRequest(input, context);
      const response = await dependencies.ipcRenderer.invoke(
        DESKTOP_COMFYUI_INSTALL_REPAIR_REQUEST_CHANNEL.value,
        request,
      );
      return assertDesktopEnvelopeResponse(response, {
        operation: DESKTOP_COMFYUI_INSTALL_REPAIR_OPERATION,
        channel: DESKTOP_COMFYUI_INSTALL_REPAIR_RESPONSE_CHANNEL.value,
        message:
          "Received invalid desktop ComfyUI repair IPC response envelope.",
      });
    },

    async browseArtifacts(input = {}, context = {}) {
      const request: DesktopArtifactBrowseRequest =
        createDesktopArtifactBrowseRequest(
          {
            artifactFamily: input.artifactFamily,
            workspaceId: input.workspaceId ?? context.workspaceId ?? "",
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

      return assertDesktopEnvelopeResponse<DesktopArtifactBrowseResponse>(
        response,
        {
          operation: DESKTOP_ARTIFACT_BROWSE_OPERATION,
          channel: DESKTOP_ARTIFACT_BROWSE_RESPONSE_CHANNEL.value,
          message:
            "Received invalid desktop artifact browse IPC response envelope.",
        },
      );
    },

    async browseUnregisteredArtifacts(input = {}, context = {}) {
      const request = createDesktopArtifactUnregisteredBrowseRequest(
        {
          workspaceId: input.workspaceId ?? context.workspaceId ?? "",
          boundary: { host: "desktop", source: artifactSource },
        },
        context,
      );
      const response = await dependencies.ipcRenderer.invoke(
        DESKTOP_ARTIFACT_UNREGISTERED_BROWSE_REQUEST_CHANNEL.value,
        request,
      );

      return assertDesktopEnvelopeResponse<DesktopArtifactUnregisteredBrowseResponse>(
        response,
        {
          operation: DESKTOP_ARTIFACT_UNREGISTERED_BROWSE_OPERATION,
          channel: DESKTOP_ARTIFACT_UNREGISTERED_BROWSE_RESPONSE_CHANNEL.value,
          message:
            "Received invalid desktop unregistered artifact browse IPC response envelope.",
        },
      );
    },

    async registerUnregisteredArtifact(input, context = {}) {
      const request = createDesktopArtifactUnregisteredRegisterRequest(
        {
          storageKey: input.storageKey,
          workspaceId: input.workspaceId ?? context.workspaceId ?? "",
          boundary: { host: "desktop", source: artifactSource },
        },
        context,
      );
      const response = await dependencies.ipcRenderer.invoke(
        DESKTOP_ARTIFACT_UNREGISTERED_REGISTER_REQUEST_CHANNEL.value,
        request,
      );

      return assertDesktopEnvelopeResponse<DesktopArtifactUnregisteredRegisterResponse>(
        response,
        {
          operation: DESKTOP_ARTIFACT_UNREGISTERED_REGISTER_OPERATION,
          channel:
            DESKTOP_ARTIFACT_UNREGISTERED_REGISTER_RESPONSE_CHANNEL.value,
          message:
            "Received invalid desktop unregistered artifact register IPC response envelope.",
        },
      );
    },

    async deleteUnregisteredArtifact(input, context = {}) {
      const request = createDesktopArtifactUnregisteredDeleteRequest(
        {
          storageKey: input.storageKey,
          workspaceId: input.workspaceId ?? context.workspaceId ?? "",
          boundary: { host: "desktop", source: artifactSource },
        },
        context,
      );
      const response = await dependencies.ipcRenderer.invoke(
        DESKTOP_ARTIFACT_UNREGISTERED_DELETE_REQUEST_CHANNEL.value,
        request,
      );

      return assertDesktopEnvelopeResponse<DesktopArtifactUnregisteredDeleteResponse>(
        response,
        {
          operation: DESKTOP_ARTIFACT_UNREGISTERED_DELETE_OPERATION,
          channel: DESKTOP_ARTIFACT_UNREGISTERED_DELETE_RESPONSE_CHANNEL.value,
          message:
            "Received invalid desktop unregistered artifact delete IPC response envelope.",
        },
      );
    },

    async deleteRegisteredArtifact(input, context = {}) {
      const request = createDesktopArtifactRegisteredDeleteRequest(
        {
          storageKey: input.storageKey,
          workspaceId: input.workspaceId ?? context.workspaceId ?? "",
          boundary: { host: "desktop", source: artifactSource },
        },
        context,
      );
      const response = await dependencies.ipcRenderer.invoke(
        DESKTOP_ARTIFACT_REGISTERED_DELETE_REQUEST_CHANNEL.value,
        request,
      );

      return assertDesktopEnvelopeResponse<DesktopArtifactRegisteredDeleteResponse>(
        response,
        {
          operation: DESKTOP_ARTIFACT_REGISTERED_DELETE_OPERATION,
          channel: DESKTOP_ARTIFACT_REGISTERED_DELETE_RESPONSE_CHANNEL.value,
          message:
            "Received invalid desktop registered artifact delete IPC response envelope.",
        },
      );
    },

    async readArtifactDetail(locator, context = {}) {
      const request: DesktopArtifactReadRequest =
        createDesktopArtifactReadRequest(
          {
            locator,
            workspaceId: context.workspaceId ?? "",
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

      return assertDesktopEnvelopeResponse<DesktopArtifactReadResponse>(
        response,
        {
          operation: DESKTOP_ARTIFACT_READ_OPERATION,
          channel: DESKTOP_ARTIFACT_READ_RESPONSE_CHANNEL.value,
          message:
            "Received invalid desktop artifact read IPC response envelope.",
        },
      );
    },

    async readArtifactContentDescriptor(locator, context = {}) {
      const request: DesktopArtifactContentReadRequest =
        createDesktopArtifactContentReadRequest(
          {
            locator,
            workspaceId: context.workspaceId ?? "",
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

      return assertDesktopEnvelopeResponse<DesktopArtifactContentReadResponse>(
        response,
        {
          operation: DESKTOP_ARTIFACT_CONTENT_READ_OPERATION,
          channel: DESKTOP_ARTIFACT_CONTENT_READ_RESPONSE_CHANNEL.value,
          message:
            "Received invalid desktop artifact content read IPC response envelope.",
        },
      );
    },

    async readArtifactViewerMedia(locator, context = {}) {
      const request: DesktopArtifactMediaViewRequest =
        createDesktopArtifactMediaViewRequest(
          {
            storageKey: locator.storageKey,
            workspaceId: context.workspaceId ?? "",
            maximumBytes: context.maximumBytes,
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

      return assertDesktopEnvelopeResponse<DesktopArtifactMediaViewResponse>(
        response,
        {
          operation: DESKTOP_ARTIFACT_MEDIA_VIEW_OPERATION,
          channel: DESKTOP_ARTIFACT_MEDIA_VIEW_RESPONSE_CHANNEL.value,
          message:
            "Received invalid desktop artifact media-view IPC response envelope.",
        },
      );
    },

    async publishArtifactToRepo(input, context = {}) {
      const request: DesktopArtifactPublishRequest =
        createDesktopArtifactPublishRequest(
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

      return assertDesktopEnvelopeResponse<DesktopArtifactPublishResponse>(
        response,
        {
          operation: DESKTOP_ARTIFACT_PUBLISH_OPERATION,
          channel: DESKTOP_ARTIFACT_PUBLISH_RESPONSE_CHANNEL.value,
          message:
            "Received invalid desktop artifact publish IPC response envelope.",
        },
      );
    },

    async verifyPublishedArtifactBacking(input, context = {}) {
      const request: DesktopArtifactPublishVerifyRequest =
        createDesktopArtifactPublishVerifyRequest(
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

      return assertDesktopEnvelopeResponse<DesktopArtifactPublishVerifyResponse>(
        response,
        {
          operation: DESKTOP_ARTIFACT_PUBLISH_VERIFY_OPERATION,
          channel: DESKTOP_ARTIFACT_PUBLISH_VERIFY_RESPONSE_CHANNEL.value,
          message:
            "Received invalid desktop artifact publish verify IPC response envelope.",
        },
      );
    },

    async verifyImportedArtifactSourceBacking(input, context = {}) {
      const request: DesktopArtifactSourceVerifyRequest =
        createDesktopArtifactSourceVerifyRequest(
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

      return assertDesktopEnvelopeResponse<DesktopArtifactSourceVerifyResponse>(
        response,
        {
          operation: DESKTOP_ARTIFACT_SOURCE_VERIFY_OPERATION,
          channel: DESKTOP_ARTIFACT_SOURCE_VERIFY_RESPONSE_CHANNEL.value,
          message:
            "Received invalid desktop artifact source verify IPC response envelope.",
        },
      );
    },

    async registerArtifactFromRepo(input, context = {}) {
      const request: DesktopArtifactRegisterFromRepoRequest =
        createDesktopArtifactRegisterFromRepoRequest(
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

      return assertDesktopEnvelopeResponse<DesktopArtifactRegisterFromRepoResponse>(
        response,
        {
          operation: DESKTOP_ARTIFACT_REGISTER_FROM_REPO_OPERATION,
          channel: DESKTOP_ARTIFACT_REGISTER_FROM_REPO_RESPONSE_CHANNEL.value,
          message:
            "Received invalid desktop artifact register-from-repo IPC response envelope.",
        },
      );
    },

    async localizeArtifactFromRepo(input, context = {}) {
      const request: DesktopArtifactLocalizeFromRepoRequest =
        createDesktopArtifactLocalizeFromRepoRequest(
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

      return assertDesktopEnvelopeResponse<DesktopArtifactLocalizeFromRepoResponse>(
        response,
        {
          operation: DESKTOP_ARTIFACT_LOCALIZE_FROM_REPO_OPERATION,
          channel: DESKTOP_ARTIFACT_LOCALIZE_FROM_REPO_RESPONSE_CHANNEL.value,
          message:
            "Received invalid desktop artifact localize-from-repo IPC response envelope.",
        },
      );
    },
    async listApplicationSettingDefinitions(input = {}, context = {}) {
      const request = createDesktopApplicationSettingsListDefinitionsRequest(
        input,
        context,
      );
      const response = await dependencies.ipcRenderer.invoke(
        DESKTOP_APPLICATION_SETTINGS_LIST_DEFINITIONS_REQUEST_CHANNEL.value,
        request,
      );

      return assertDesktopEnvelopeResponse<DesktopApplicationSettingsListDefinitionsResponse>(
        response,
        {
          operation: DESKTOP_APPLICATION_SETTINGS_LIST_DEFINITIONS_OPERATION,
          channel:
            DESKTOP_APPLICATION_SETTINGS_LIST_DEFINITIONS_RESPONSE_CHANNEL.value,
          message:
            "Received invalid desktop application settings list-definitions IPC response envelope.",
        },
      );
    },
    async readApplicationSettings(input = {}, context = {}) {
      const request = createDesktopApplicationSettingsReadRequest(
        input,
        context,
      );
      const response = await dependencies.ipcRenderer.invoke(
        DESKTOP_APPLICATION_SETTINGS_READ_REQUEST_CHANNEL.value,
        request,
      );

      return assertDesktopEnvelopeResponse<DesktopApplicationSettingsReadResponse>(
        response,
        {
          operation: DESKTOP_APPLICATION_SETTINGS_READ_OPERATION,
          channel: DESKTOP_APPLICATION_SETTINGS_READ_RESPONSE_CHANNEL.value,
          message:
            "Received invalid desktop application settings read IPC response envelope.",
        },
      );
    },
    async updateApplicationSetting(input, context = {}) {
      const request = createDesktopApplicationSettingsUpdateRequest(
        input,
        context,
      );
      const response = await dependencies.ipcRenderer.invoke(
        DESKTOP_APPLICATION_SETTINGS_UPDATE_REQUEST_CHANNEL.value,
        request,
      );

      return assertDesktopEnvelopeResponse<DesktopApplicationSettingsUpdateResponse>(
        response,
        {
          operation: DESKTOP_APPLICATION_SETTINGS_UPDATE_OPERATION,
          channel: DESKTOP_APPLICATION_SETTINGS_UPDATE_RESPONSE_CHANNEL.value,
          message:
            "Received invalid desktop application settings update IPC response envelope.",
        },
      );
    },
    async clearApplicationSetting(input, context = {}) {
      const request = createDesktopApplicationSettingsClearRequest(
        input,
        context,
      );
      const response = await dependencies.ipcRenderer.invoke(
        DESKTOP_APPLICATION_SETTINGS_CLEAR_REQUEST_CHANNEL.value,
        request,
      );

      return assertDesktopEnvelopeResponse<DesktopApplicationSettingsClearResponse>(
        response,
        {
          operation: DESKTOP_APPLICATION_SETTINGS_CLEAR_OPERATION,
          channel: DESKTOP_APPLICATION_SETTINGS_CLEAR_RESPONSE_CHANNEL.value,
          message:
            "Received invalid desktop application settings clear IPC response envelope.",
        },
      );
    },
    async resolveApplicationModelDefault(input, context = {}) {
      const request =
        createDesktopApplicationSettingsResolveModelDefaultRequest(
          input,
          context,
        );
      const response = await dependencies.ipcRenderer.invoke(
        DESKTOP_APPLICATION_SETTINGS_RESOLVE_MODEL_DEFAULT_REQUEST_CHANNEL.value,
        request,
      );

      return assertDesktopEnvelopeResponse<DesktopApplicationSettingsResolveModelDefaultResponse>(
        response,
        {
          operation:
            DESKTOP_APPLICATION_SETTINGS_RESOLVE_MODEL_DEFAULT_OPERATION,
          channel:
            DESKTOP_APPLICATION_SETTINGS_RESOLVE_MODEL_DEFAULT_RESPONSE_CHANNEL.value,
          message:
            "Received invalid desktop application settings resolve-model-default IPC response envelope.",
        },
      );
    },
    async resolveModelDefault(input, context = {}) {
      return this.resolveApplicationModelDefault(input, context);
    },
    async selectApplicationSettingsFolder(input = {}, context = {}) {
      const request = createDesktopApplicationSettingsSelectFolderRequest(
        input,
        context,
      );
      const response = await dependencies.ipcRenderer.invoke(
        DESKTOP_APPLICATION_SETTINGS_SELECT_FOLDER_REQUEST_CHANNEL.value,
        request,
      );

      return assertDesktopEnvelopeResponse<DesktopApplicationSettingsSelectFolderResponse>(
        response,
        {
          operation: DESKTOP_APPLICATION_SETTINGS_SELECT_FOLDER_OPERATION,
          channel:
            DESKTOP_APPLICATION_SETTINGS_SELECT_FOLDER_RESPONSE_CHANNEL.value,
          message:
            "Received invalid desktop application settings select-folder IPC response envelope.",
        },
      );
    },
    async browseModels(input, context = {}) {
      const request = createDesktopModelBrowseRequest(input, context);
      const response = await dependencies.ipcRenderer.invoke(
        DESKTOP_MODEL_BROWSE_REQUEST_CHANNEL.value,
        request,
      );
      return assertDesktopEnvelopeResponse<DesktopModelBrowseResponse>(
        response,
        {
          operation: DESKTOP_MODEL_BROWSE_OPERATION,
          channel: DESKTOP_MODEL_BROWSE_RESPONSE_CHANNEL.value,
          message:
            "Received invalid desktop model browse IPC response envelope.",
        },
      );
    },
    async getModelDetails(input, context = {}) {
      const request = createDesktopModelDetailsReadRequest(input, context);
      const response = await dependencies.ipcRenderer.invoke(
        DESKTOP_MODEL_DETAILS_READ_REQUEST_CHANNEL.value,
        request,
      );
      return assertDesktopEnvelopeResponse<DesktopModelDetailsReadResponse>(
        response,
        {
          operation: DESKTOP_MODEL_DETAILS_READ_OPERATION,
          channel: DESKTOP_MODEL_DETAILS_READ_RESPONSE_CHANNEL.value,
          message:
            "Received invalid desktop model details IPC response envelope.",
        },
      );
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
      return assertDesktopEnvelopeResponse<DesktopModelReferenceSaveResponse>(
        response,
        {
          operation: DESKTOP_MODEL_REFERENCE_SAVE_OPERATION,
          channel: DESKTOP_MODEL_REFERENCE_SAVE_RESPONSE_CHANNEL.value,
          message:
            "Received invalid desktop model reference-save IPC response envelope.",
        },
      );
    },
    async downloadModel(input, context = {}) {
      const request = createDesktopModelDownloadRequest(input, context);
      const response = await dependencies.ipcRenderer.invoke(
        DESKTOP_MODEL_DOWNLOAD_REQUEST_CHANNEL.value,
        request,
      );
      return assertDesktopEnvelopeResponse<DesktopModelDownloadResponse>(
        response,
        {
          operation: DESKTOP_MODEL_DOWNLOAD_OPERATION,
          channel: DESKTOP_MODEL_DOWNLOAD_RESPONSE_CHANNEL.value,
          message:
            "Received invalid desktop model download IPC response envelope.",
        },
      );
    },
    async updateModelRecord(input, context = {}) {
      const request = createDesktopModelRecordUpdateRequest(input, context);
      const response = await dependencies.ipcRenderer.invoke(
        DESKTOP_MODEL_RECORD_UPDATE_REQUEST_CHANNEL.value,
        request,
      );
      return assertDesktopEnvelopeResponse<DesktopModelRecordUpdateResponse>(
        response,
        {
          operation: DESKTOP_MODEL_RECORD_UPDATE_OPERATION,
          channel: DESKTOP_MODEL_RECORD_UPDATE_RESPONSE_CHANNEL.value,
          message:
            "Received invalid desktop model record-update IPC response envelope.",
        },
      );
    },
    async deleteModelRecord(input, context = {}) {
      const request = createDesktopModelRecordDeleteRequest(input, context);
      const response = await dependencies.ipcRenderer.invoke(
        DESKTOP_MODEL_RECORD_DELETE_REQUEST_CHANNEL.value,
        request,
      );
      return assertDesktopEnvelopeResponse<DesktopModelRecordDeleteResponse>(
        response,
        {
          operation: DESKTOP_MODEL_RECORD_DELETE_OPERATION,
          channel: DESKTOP_MODEL_RECORD_DELETE_RESPONSE_CHANNEL.value,
          message:
            "Received invalid desktop model record-delete IPC response envelope.",
        },
      );
    },
    async trainModel(input, context = {}) {
      const request = createDesktopModelTrainRequest(input, context);
      const response = await dependencies.ipcRenderer.invoke(
        DESKTOP_MODEL_TRAIN_REQUEST_CHANNEL.value,
        request,
      );
      return assertDesktopEnvelopeResponse<DesktopModelTrainResponse>(
        response,
        {
          operation: DESKTOP_MODEL_TRAIN_OPERATION,
          channel: DESKTOP_MODEL_TRAIN_RESPONSE_CHANNEL.value,
          message:
            "Received invalid desktop model train IPC response envelope.",
        },
      );
    },
    async readModelTrainingStatus(input, context = {}) {
      const request = createDesktopModelTrainStatusRequest(input, context);
      const response = await dependencies.ipcRenderer.invoke(
        DESKTOP_MODEL_TRAIN_STATUS_REQUEST_CHANNEL.value,
        request,
      );
      return assertDesktopEnvelopeResponse<DesktopModelTrainStatusResponse>(
        response,
        {
          operation: DESKTOP_MODEL_TRAIN_STATUS_OPERATION,
          channel: DESKTOP_MODEL_TRAIN_STATUS_RESPONSE_CHANNEL.value,
          message:
            "Received invalid desktop model training status IPC response envelope.",
        },
      );
    },
    async validateModel(input, context = {}) {
      const request = createDesktopModelValidateRequest(input, context);
      const response = await dependencies.ipcRenderer.invoke(
        DESKTOP_MODEL_VALIDATE_REQUEST_CHANNEL.value,
        request,
      );
      return assertDesktopEnvelopeResponse<DesktopModelValidateResponse>(
        response,
        {
          operation: DESKTOP_MODEL_VALIDATE_OPERATION,
          channel: DESKTOP_MODEL_VALIDATE_RESPONSE_CHANNEL.value,
          message:
            "Received invalid desktop model validate IPC response envelope.",
        },
      );
    },
    async publishModel(input, context = {}) {
      const request = createDesktopModelPublishRequest(input, context);
      const response = await dependencies.ipcRenderer.invoke(
        DESKTOP_MODEL_PUBLISH_REQUEST_CHANNEL.value,
        request,
      );
      return assertDesktopEnvelopeResponse<DesktopModelPublishResponse>(
        response,
        {
          operation: DESKTOP_MODEL_PUBLISH_OPERATION,
          channel: DESKTOP_MODEL_PUBLISH_RESPONSE_CHANNEL.value,
          message:
            "Received invalid desktop model publish IPC response envelope.",
        },
      );
    },
    async listAssetImplementationReleases(workspaceId, context = {}) {
      const request = createDesktopAssetImplementationReleasesListRequest(
        workspaceId,
        context,
      );
      const response = await dependencies.ipcRenderer.invoke(
        DESKTOP_ASSET_IMPLEMENTATION_RELEASES_LIST_REQUEST_CHANNEL.value,
        request,
      );
      return assertDesktopEnvelopeResponse<DesktopAssetImplementationReleasesListResponse>(
        response,
        {
          operation: DESKTOP_ASSET_IMPLEMENTATION_RELEASES_LIST_OPERATION,
          channel:
            DESKTOP_ASSET_IMPLEMENTATION_RELEASES_LIST_RESPONSE_CHANNEL.value,
          message:
            "Received invalid desktop asset implementation list IPC response envelope.",
        },
      );
    },
    async resolveAssetImplementation(input, context = {}) {
      const request = createDesktopAssetImplementationResolveRequest(
        input,
        context,
      );
      const response = await dependencies.ipcRenderer.invoke(
        DESKTOP_ASSET_IMPLEMENTATION_RESOLVE_REQUEST_CHANNEL.value,
        request,
      );
      return assertDesktopEnvelopeResponse<DesktopAssetImplementationResolveResponse>(
        response,
        {
          operation: DESKTOP_ASSET_IMPLEMENTATION_RESOLVE_OPERATION,
          channel: DESKTOP_ASSET_IMPLEMENTATION_RESOLVE_RESPONSE_CHANNEL.value,
          message:
            "Received invalid desktop asset implementation resolution IPC response envelope.",
        },
      );
    },
    async inspectAssetPackage(input, context = {}) {
      return invokeAssetPackage<DesktopAssetPackageInspectResponse>(
        dependencies,
        "inspect",
        input,
        context,
      );
    },
    async admitAssetPackage(input, context = {}) {
      return invokeAssetPackage<DesktopAssetPackageRecordResponse>(
        dependencies,
        "admit",
        input,
        context,
      );
    },
    async listAssetPackages(workspaceId, context = {}) {
      return invokeAssetPackage<DesktopAssetPackageListResponse>(
        dependencies,
        "list",
        { workspaceId },
        context,
      );
    },
    async activateAssetPackage(input, context = {}) {
      return invokeAssetPackage<DesktopAssetPackageRecordResponse>(
        dependencies,
        "activate",
        input,
        context,
      );
    },
    async disableAssetPackage(input, context = {}) {
      return invokeAssetPackage<DesktopAssetPackageRecordResponse>(
        dependencies,
        "disable",
        input,
        context,
      );
    },
    async rollbackAssetPackage(input, context = {}) {
      return invokeAssetPackage<DesktopAssetPackageRecordResponse>(
        dependencies,
        "rollback",
        input,
        context,
      );
    },
    async proposeAssetStudioChange(input, context = {}) {
      return invokeAssetStudio<DesktopAssetStudioProposalResponse>(
        dependencies,
        "propose",
        input,
        context,
      );
    },
    async startAssetStudio(input, context = {}) {
      return invokeAssetStudio<DesktopAssetStudioDraftResponse>(
        dependencies,
        "start",
        input,
        context,
      );
    },
    async reviewAssetStudioProposal(input, context = {}) {
      return invokeAssetStudio<DesktopAssetStudioWorkflowResponse>(
        dependencies,
        "review",
        input,
        context,
      );
    },
    async readAssetStudioProposal(input, context = {}) {
      return invokeAssetStudio<DesktopAssetStudioProposalResponse>(
        dependencies,
        "read",
        input,
        context,
      );
    },
    async listAssetStudioWorkflows(workspaceId, context = {}) {
      return invokeAssetStudio<DesktopAssetStudioListResponse>(
        dependencies,
        "list",
        { workspaceId },
        context,
      );
    },
    async createSystemBuilderSystem(input, context = {}) {
      return invokeSystemBuilder<DesktopSystemBuilderRecordResponse>(
        dependencies,
        "create",
        input,
        context,
      );
    },
    async listSystemBuilderSystems(input, context = {}) {
      return invokeSystemBuilder<DesktopSystemBuilderListResponse>(
        dependencies,
        "list",
        input,
        context,
      );
    },
    async readSystemBuilderSystem(input, context = {}) {
      return invokeSystemBuilder<DesktopSystemBuilderRecordResponse>(
        dependencies,
        "read",
        input,
        context,
      );
    },
    async renameSystemBuilderSystem(input, context = {}) {
      return invokeSystemBuilder<DesktopSystemBuilderRecordResponse>(
        dependencies,
        "rename",
        input,
        context,
      );
    },
    async listSystemBuilderTemplates(input = {}, context = {}) {
      return invokeSystemBuilder<DesktopSystemDataEnvelope>(
        dependencies,
        "listTemplates",
        input,
        context,
      );
    },
    async createSystemBuilderFromTemplate(input, context = {}) {
      return invokeSystemBuilder<DesktopSystemBuilderRecordResponse>(
        dependencies,
        "createFromTemplate",
        input,
        context,
      );
    },
    async archiveSystemBuilderSystem(input, context = {}) {
      return invokeSystemBuilder<DesktopSystemBuilderRecordResponse>(
        dependencies,
        "archive",
        input,
        context,
      );
    },
    async restoreSystemBuilderSystem(input, context = {}) {
      return invokeSystemBuilder<DesktopSystemBuilderRecordResponse>(
        dependencies,
        "restore",
        input,
        context,
      );
    },
    async cloneSystemBuilderSystem(input, context = {}) {
      return invokeSystemBuilder<DesktopSystemBuilderRecordResponse>(
        dependencies,
        "clone",
        input,
        context,
      );
    },
    async saveSystemBuilderRevision(input, context = {}) {
      return invokeSystemBuilder<DesktopSystemBuilderRevisionResponse>(
        dependencies,
        "saveRevision",
        input,
        context,
      );
    },
    async readSystemBuilderRevision(input, context = {}) {
      return invokeSystemBuilder<DesktopSystemBuilderRevisionResponse>(
        dependencies,
        "readRevision",
        input,
        context,
      );
    },
    async listSystemBuilderRevisions(input, context = {}) {
      return invokeSystemBuilder<DesktopSystemBuilderRevisionListResponse>(
        dependencies,
        "listRevisions",
        input,
        context,
      );
    },
    async requestSystemBuild(input, context = {}) {
      return invokeSystemBuild(dependencies, "request", input, context);
    },
    async cancelSystemBuild(input, context = {}) {
      return invokeSystemBuild(dependencies, "cancel", input, context);
    },
    async readSystemBuild(input, context = {}) {
      return invokeSystemBuild(dependencies, "read", input, context);
    },
    async listSystemBuilds(input, context = {}) {
      return invokeSystemBuild(dependencies, "list", input, context);
    },
    async approveSystemRelease(input, context = {}) {
      return invokeSystemBuild(dependencies, "approve", input, context);
    },
    async readSystemRelease(input, context = {}) {
      return invokeSystemBuild(dependencies, "readRelease", input, context);
    },
    async listSystemReleases(input, context = {}) {
      return invokeSystemBuild(dependencies, "listReleases", input, context);
    },
    async compareSystemReleases(input, context = {}) {
      return invokeSystemBuild(dependencies, "compareReleases", input, context);
    },
    async describeSystemDataForm(input, context = {}) {
      return invokeSystemData(dependencies, "describe", input, context);
    },
    async createSystemDataRecord(input, context = {}) {
      return invokeSystemData(dependencies, "create", input, context);
    },
    async readSystemDataRecord(input, context = {}) {
      return invokeSystemData(dependencies, "read", input, context);
    },
    async updateSystemDataRecord(input, context = {}) {
      return invokeSystemData(dependencies, "update", input, context);
    },
    async listSystemDataRecords(input, context = {}) {
      return invokeSystemData(dependencies, "list", input, context);
    },
    async listSystemDataAudit(input, context = {}) {
      return invokeSystemData(dependencies, "listAudit", input, context);
    },
    async describeSystemReview(input, context = {}) {
      return invokeSystemReview(dependencies, "describe", input, context);
    },
    async browseSystemReviewArtifacts(input, context = {}) {
      return invokeSystemReview(dependencies, "browse", input, context);
    },
    async readSystemReviewArtifact(input, context = {}) {
      return invokeSystemReview(dependencies, "detail", input, context);
    },
    async previewSystemReviewArtifact(input, context = {}) {
      return invokeSystemReview(dependencies, "preview", input, context);
    },
    async listSystemReviewAudit(input, context = {}) {
      return invokeSystemReview(dependencies, "listAudit", input, context);
    },
    async installSystemDeployment(input, context = {}) {
      return invokeSystemDeployment(dependencies, "install", input, context);
    },
    async activateSystemDeployment(input, context = {}) {
      return invokeSystemDeployment(dependencies, "activate", input, context);
    },
    async reconcileSystemDeploymentHealth(input, context = {}) {
      return invokeSystemDeployment(dependencies, "health", input, context);
    },
    async rollbackSystemDeployment(input, context = {}) {
      return invokeSystemDeployment(dependencies, "rollback", input, context);
    },
    async revokeSystemDeployment(input, context = {}) {
      return invokeSystemDeployment(dependencies, "revoke", input, context);
    },
    async readSystemDeployment(input, context = {}) {
      return invokeSystemDeployment(dependencies, "read", input, context);
    },
    async listSystemDeployments(input, context = {}) {
      return invokeSystemDeployment(dependencies, "list", input, context);
    },
    async startSystemDeploymentRun(input, context = {}) {
      return invokeSystemDeployment(dependencies, "startRun", input, context);
    },
    async cancelSystemDeploymentRun(input, context = {}) {
      return invokeSystemDeployment(dependencies, "cancelRun", input, context);
    },
    async listSystemDeploymentRuns(input, context = {}) {
      return invokeSystemDeployment(dependencies, "listRuns", input, context);
    },
    async listSystemDeploymentAudit(input, context = {}) {
      return invokeSystemDeployment(dependencies, "listAudit", input, context);
    },
  };
}

async function invokeAssetPackage<
  TResponse extends { operation: string; channel: string },
>(
  dependencies: CreateDesktopPreloadApiDependencies,
  operation: keyof typeof DESKTOP_ASSET_PACKAGE_OPERATIONS,
  payload: unknown,
  context: DesktopArtifactUploadBridgeContext,
): Promise<TResponse> {
  const request = createDesktopAssetPackageRequest(operation, payload, context);
  const channels = DESKTOP_ASSET_PACKAGE_CHANNELS[operation];
  const response = await dependencies.ipcRenderer.invoke(
    channels.request.value,
    request,
  );
  return assertDesktopEnvelopeResponse<TResponse>(response, {
    operation: DESKTOP_ASSET_PACKAGE_OPERATIONS[operation],
    channel: channels.response.value,
    message: `Received invalid desktop asset package ${operation} IPC response envelope.`,
  });
}

async function invokeAssetStudio<
  TResponse extends { operation: string; channel: string },
>(
  dependencies: CreateDesktopPreloadApiDependencies,
  operation: keyof typeof DESKTOP_ASSET_STUDIO_OPERATIONS,
  payload: unknown,
  context: DesktopArtifactUploadBridgeContext,
): Promise<TResponse> {
  const request = createDesktopAssetStudioRequest(operation, payload, context);
  const channels = DESKTOP_ASSET_STUDIO_CHANNELS[operation];
  const response = await dependencies.ipcRenderer.invoke(
    channels.request.value,
    request,
  );
  return assertDesktopEnvelopeResponse<TResponse>(response, {
    operation: DESKTOP_ASSET_STUDIO_OPERATIONS[operation],
    channel: channels.response.value,
    message: `Received invalid desktop Asset Studio ${operation} IPC response envelope.`,
  });
}

async function invokeSystemBuilder<
  TResponse extends { operation: string; channel: string },
>(
  dependencies: CreateDesktopPreloadApiDependencies,
  operation: keyof typeof DESKTOP_SYSTEM_BUILDER_OPERATIONS,
  payload: unknown,
  context: DesktopArtifactUploadBridgeContext,
): Promise<TResponse> {
  const request = createDesktopSystemBuilderRequest(
    operation,
    payload,
    context,
  );
  const channels = DESKTOP_SYSTEM_BUILDER_CHANNELS[operation];
  const response = await dependencies.ipcRenderer.invoke(
    channels.request.value,
    request,
  );
  return assertDesktopEnvelopeResponse<TResponse>(response, {
    operation: DESKTOP_SYSTEM_BUILDER_OPERATIONS[operation],
    channel: channels.response.value,
    message: `Received invalid desktop System Builder ${operation} IPC response envelope.`,
  });
}

async function invokeSystemBuild(
  dependencies: CreateDesktopPreloadApiDependencies,
  operation: keyof typeof DESKTOP_SYSTEM_BUILD_OPERATIONS,
  payload: unknown,
  context: DesktopArtifactUploadBridgeContext,
): Promise<DesktopSystemBuildEnvelope> {
  const request = createDesktopSystemBuildRequest(operation, payload, context);
  const channels = DESKTOP_SYSTEM_BUILD_CHANNELS[operation];
  const response = await dependencies.ipcRenderer.invoke(
    channels.request.value,
    request,
  );
  return assertDesktopEnvelopeResponse<DesktopSystemBuildEnvelope>(response, {
    operation: DESKTOP_SYSTEM_BUILD_OPERATIONS[operation],
    channel: channels.response.value,
    message: `Received invalid desktop System Build ${operation} IPC response envelope.`,
  });
}
import {
  DESKTOP_USER_LIBRARY_ASSET_LIST_OPERATION,
  DESKTOP_USER_LIBRARY_ASSET_LIST_REQUEST_CHANNEL,
  DESKTOP_USER_LIBRARY_ASSET_LIST_RESPONSE_CHANNEL,
  DESKTOP_USER_LIBRARY_ASSET_READ_OPERATION,
  DESKTOP_USER_LIBRARY_ASSET_READ_REQUEST_CHANNEL,
  DESKTOP_USER_LIBRARY_ASSET_READ_RESPONSE_CHANNEL,
  DESKTOP_USER_LIBRARY_COPY_OPERATION,
  DESKTOP_USER_LIBRARY_COPY_REQUEST_CHANNEL,
  DESKTOP_USER_LIBRARY_COPY_RESPONSE_CHANNEL,
  DESKTOP_USER_LIBRARY_IMPORT_OPERATION,
  DESKTOP_USER_LIBRARY_IMPORT_REQUEST_CHANNEL,
  DESKTOP_USER_LIBRARY_IMPORT_RESPONSE_CHANNEL,
  DESKTOP_USER_LIBRARY_LINK_LIST_OPERATION,
  DESKTOP_USER_LIBRARY_LINK_LIST_REQUEST_CHANNEL,
  DESKTOP_USER_LIBRARY_LINK_LIST_RESPONSE_CHANNEL,
  DESKTOP_USER_LIBRARY_LINK_READ_OPERATION,
  DESKTOP_USER_LIBRARY_LINK_READ_REQUEST_CHANNEL,
  DESKTOP_USER_LIBRARY_LINK_READ_RESPONSE_CHANNEL,
  DESKTOP_USER_LIBRARY_LINK_OPERATION,
  DESKTOP_USER_LIBRARY_LINK_REQUEST_CHANNEL,
  DESKTOP_USER_LIBRARY_LINK_RESPONSE_CHANNEL,
  DESKTOP_USER_LIBRARY_PROMOTE_OPERATION,
  DESKTOP_USER_LIBRARY_PROMOTE_REQUEST_CHANNEL,
  DESKTOP_USER_LIBRARY_PROMOTE_RESPONSE_CHANNEL,
  DESKTOP_WORKSPACE_EFFECTIVE_ASSET_SOURCE_LIST_OPERATION,
  DESKTOP_WORKSPACE_EFFECTIVE_ASSET_SOURCE_LIST_REQUEST_CHANNEL,
  DESKTOP_WORKSPACE_EFFECTIVE_ASSET_SOURCE_LIST_RESPONSE_CHANNEL,
  createDesktopUserLibraryAssetListRequest,
  createDesktopUserLibraryAssetReadRequest,
  createDesktopUserLibraryCopyRequest,
  createDesktopUserLibraryImportRequest,
  createDesktopUserLibraryLinkRequest,
  createDesktopUserLibraryPromoteRequest,
  createDesktopWorkspaceEffectiveAssetSourceListRequest,
  createDesktopWorkspaceUserLibraryLinkListRequest,
  createDesktopWorkspaceUserLibraryLinkReadRequest,
  type DesktopUserLibraryAssetListRequest,
  type DesktopUserLibraryAssetListResponse,
  type DesktopUserLibraryAssetReadResponse,
  type DesktopUserLibraryCopyResponse,
  type DesktopUserLibraryImportResponse,
  type DesktopUserLibraryLinkResponse,
  type DesktopUserLibraryPromoteResponse,
  type DesktopWorkspaceEffectiveAssetSourceListResponse,
  type DesktopWorkspaceUserLibraryLinkListResponse,
  type DesktopWorkspaceUserLibraryLinkReadResponse,
} from "../../../../modules/contracts/ipc";

async function invokeSystemData(
  dependencies: CreateDesktopPreloadApiDependencies,
  operation: keyof typeof DESKTOP_SYSTEM_DATA_OPERATIONS,
  payload: unknown,
  context: DesktopArtifactUploadBridgeContext,
): Promise<DesktopSystemDataEnvelope> {
  const request = createDesktopSystemDataRequest(operation, payload, context);
  const channels = DESKTOP_SYSTEM_DATA_CHANNELS[operation];
  const response = await dependencies.ipcRenderer.invoke(
    channels.request.value,
    request,
  );
  return assertDesktopEnvelopeResponse<DesktopSystemDataEnvelope>(response, {
    operation: DESKTOP_SYSTEM_DATA_OPERATIONS[operation],
    channel: channels.response.value,
    message: `Received invalid desktop System Data ${operation} IPC response envelope.`,
  });
}

async function invokeSystemReview(
  dependencies: CreateDesktopPreloadApiDependencies,
  operation: keyof typeof DESKTOP_SYSTEM_REVIEW_OPERATIONS,
  payload: unknown,
  context: DesktopArtifactUploadBridgeContext,
): Promise<DesktopSystemReviewEnvelope> {
  const request = createDesktopSystemReviewRequest(operation, payload, context);
  const channels = DESKTOP_SYSTEM_REVIEW_CHANNELS[operation];
  const response = await dependencies.ipcRenderer.invoke(
    channels.request.value,
    request,
  );
  return assertDesktopEnvelopeResponse<DesktopSystemReviewEnvelope>(response, {
    operation: DESKTOP_SYSTEM_REVIEW_OPERATIONS[operation],
    channel: channels.response.value,
    message: `Received invalid desktop System Review ${operation} IPC response envelope.`,
  });
}

async function invokeSystemDeployment(
  dependencies: CreateDesktopPreloadApiDependencies,
  operation: keyof typeof DESKTOP_SYSTEM_DEPLOYMENT_OPERATIONS,
  payload: unknown,
  context: DesktopArtifactUploadBridgeContext,
): Promise<DesktopSystemDeploymentEnvelope> {
  const request = createDesktopSystemDeploymentRequest(
    operation,
    payload,
    context,
  );
  const channels = DESKTOP_SYSTEM_DEPLOYMENT_CHANNELS[operation];
  const response = await dependencies.ipcRenderer.invoke(
    channels.request.value,
    request,
  );
  return assertDesktopEnvelopeResponse<DesktopSystemDeploymentEnvelope>(
    response,
    {
      operation: DESKTOP_SYSTEM_DEPLOYMENT_OPERATIONS[operation],
      channel: channels.response.value,
      message: `Received invalid desktop System Deployment ${operation} IPC response envelope.`,
    },
  );
}

async function invokeAssetDerivedCustomization(
  dependencies: CreateDesktopPreloadApiDependencies,
  key: keyof typeof DESKTOP_ASSET_DERIVED_CUSTOMIZATION_CHANNELS,
  payload: unknown,
  context: DesktopArtifactUploadBridgeContext,
): Promise<unknown> {
  if (!payload || typeof payload !== "object" || !("workspaceId" in payload) || typeof payload.workspaceId !== "string" || !payload.workspaceId.trim()) throw new Error("Invalid request.");
  const descriptor = DESKTOP_ASSET_DERIVED_CUSTOMIZATION_CHANNELS[key];
  const response = await dependencies.ipcRenderer.invoke(descriptor.request.value, { payload, operation: descriptor.operation, channel: descriptor.request.value, requestId: context.requestId, correlationId: context.correlationId });
  return assertDesktopEnvelopeResponse(response, { operation: descriptor.operation, channel: descriptor.response.value, message: `Received invalid desktop asset derived customization ${key} IPC response envelope.` });
}
import {
  DESKTOP_ASSET_AUTHORING_CREATE_WORKSPACE_AUTHORED_ASSET_OPERATION,
  DESKTOP_ASSET_AUTHORING_CREATE_WORKSPACE_AUTHORED_ASSET_REQUEST_CHANNEL,
  DESKTOP_ASSET_AUTHORING_CREATE_WORKSPACE_AUTHORED_ASSET_RESPONSE_CHANNEL,
  DESKTOP_ASSET_AUTHORING_CREATE_DRAFT_OPERATION,
  DESKTOP_ASSET_AUTHORING_CREATE_DRAFT_REQUEST_CHANNEL,
  DESKTOP_ASSET_AUTHORING_CREATE_DRAFT_RESPONSE_CHANNEL,
  DESKTOP_ASSET_AUTHORING_UPDATE_DRAFT_OPERATION,
  DESKTOP_ASSET_AUTHORING_UPDATE_DRAFT_REQUEST_CHANNEL,
  DESKTOP_ASSET_AUTHORING_UPDATE_DRAFT_RESPONSE_CHANNEL,
  DESKTOP_ASSET_AUTHORING_PUBLISH_DRAFT_OPERATION,
  DESKTOP_ASSET_AUTHORING_PUBLISH_DRAFT_REQUEST_CHANNEL,
  DESKTOP_ASSET_AUTHORING_PUBLISH_DRAFT_RESPONSE_CHANNEL,
  DESKTOP_ASSET_AUTHORING_CREATE_OVERRIDE_OPERATION,
  DESKTOP_ASSET_AUTHORING_CREATE_OVERRIDE_REQUEST_CHANNEL,
  DESKTOP_ASSET_AUTHORING_CREATE_OVERRIDE_RESPONSE_CHANNEL,
  DESKTOP_ASSET_AUTHORING_UPDATE_OVERRIDE_OPERATION,
  DESKTOP_ASSET_AUTHORING_UPDATE_OVERRIDE_REQUEST_CHANNEL,
  DESKTOP_ASSET_AUTHORING_UPDATE_OVERRIDE_RESPONSE_CHANNEL,
  DESKTOP_ASSET_AUTHORING_DISABLE_OVERRIDE_OPERATION,
  DESKTOP_ASSET_AUTHORING_DISABLE_OVERRIDE_REQUEST_CHANNEL,
  DESKTOP_ASSET_AUTHORING_DISABLE_OVERRIDE_RESPONSE_CHANNEL,
  DESKTOP_ASSET_AUTHORING_LIST_AUTHORED_ASSETS_OPERATION,
  DESKTOP_ASSET_AUTHORING_LIST_AUTHORED_ASSETS_REQUEST_CHANNEL,
  DESKTOP_ASSET_AUTHORING_LIST_AUTHORED_ASSETS_RESPONSE_CHANNEL,
  DESKTOP_ASSET_AUTHORING_READ_AUTHORED_ASSET_OPERATION,
  DESKTOP_ASSET_AUTHORING_READ_AUTHORED_ASSET_REQUEST_CHANNEL,
  DESKTOP_ASSET_AUTHORING_READ_AUTHORED_ASSET_RESPONSE_CHANNEL,
  DESKTOP_ASSET_AUTHORING_LIST_DRAFTS_OPERATION,
  DESKTOP_ASSET_AUTHORING_LIST_DRAFTS_REQUEST_CHANNEL,
  DESKTOP_ASSET_AUTHORING_LIST_DRAFTS_RESPONSE_CHANNEL,
  DESKTOP_ASSET_AUTHORING_READ_DRAFT_OPERATION,
  DESKTOP_ASSET_AUTHORING_READ_DRAFT_REQUEST_CHANNEL,
  DESKTOP_ASSET_AUTHORING_READ_DRAFT_RESPONSE_CHANNEL,
  DESKTOP_ASSET_AUTHORING_LIST_REVISIONS_OPERATION,
  DESKTOP_ASSET_AUTHORING_LIST_REVISIONS_REQUEST_CHANNEL,
  DESKTOP_ASSET_AUTHORING_LIST_REVISIONS_RESPONSE_CHANNEL,
  DESKTOP_ASSET_AUTHORING_READ_REVISION_OPERATION,
  DESKTOP_ASSET_AUTHORING_READ_REVISION_REQUEST_CHANNEL,
  DESKTOP_ASSET_AUTHORING_READ_REVISION_RESPONSE_CHANNEL,
  DESKTOP_ASSET_AUTHORING_LIST_OVERRIDES_OPERATION,
  DESKTOP_ASSET_AUTHORING_LIST_OVERRIDES_REQUEST_CHANNEL,
  DESKTOP_ASSET_AUTHORING_LIST_OVERRIDES_RESPONSE_CHANNEL,
  DESKTOP_ASSET_AUTHORING_READ_OVERRIDE_OPERATION,
  DESKTOP_ASSET_AUTHORING_READ_OVERRIDE_REQUEST_CHANNEL,
  DESKTOP_ASSET_AUTHORING_READ_OVERRIDE_RESPONSE_CHANNEL,
  DESKTOP_ASSET_AUTHORING_LIST_EFFECTIVE_SUMMARIES_OPERATION,
  DESKTOP_ASSET_AUTHORING_LIST_EFFECTIVE_SUMMARIES_REQUEST_CHANNEL,
  DESKTOP_ASSET_AUTHORING_LIST_EFFECTIVE_SUMMARIES_RESPONSE_CHANNEL,
  DESKTOP_ASSET_DERIVED_CUSTOMIZATION_CHANNELS,
  type DesktopAssetAuthoringCreateWorkspaceAuthoredAssetResponse,
  type DesktopAssetAuthoringCreateDraftResponse,
  type DesktopAssetAuthoringUpdateDraftResponse,
  type DesktopAssetAuthoringPublishDraftResponse,
  type DesktopAssetAuthoringCreateOverrideResponse,
  type DesktopAssetAuthoringUpdateOverrideResponse,
  type DesktopAssetAuthoringDisableOverrideResponse,
  type DesktopAssetAuthoringListAuthoredAssetsResponse,
  type DesktopAssetAuthoringReadAuthoredAssetResponse,
  type DesktopAssetAuthoringListDraftsResponse,
  type DesktopAssetAuthoringReadDraftResponse,
  type DesktopAssetAuthoringListRevisionsResponse,
  type DesktopAssetAuthoringReadRevisionResponse,
  type DesktopAssetAuthoringListOverridesResponse,
  type DesktopAssetAuthoringReadOverrideResponse,
  type DesktopAssetAuthoringListEffectiveSummariesResponse,
  type DesktopAssetDerivedCustomizationListTargetsResponse,
  type DesktopAssetDerivedCustomizationReadTargetResponse,
  type DesktopAssetDerivedCustomizationCreateResponse,
  type DesktopAssetDerivedCustomizationUpdateResponse,
  type DesktopAssetDerivedCustomizationReviewResponse,
  type DesktopAssetDerivedCustomizationPublishResponse,
  type DesktopAssetDerivedCustomizationAbandonResponse,
  type DesktopAssetDerivedCustomizationListResponse,
  type DesktopAssetDerivedCustomizationReadResponse,
} from "../../../../modules/contracts/ipc";
import type {
  CopyUserLibraryAssetToWorkspaceCommand,
  ImportWorkspaceAssetToWorkspaceCommand,
  LinkUserLibraryAssetToWorkspaceCommand,
  PromoteWorkspaceAssetToUserLibraryCommand,
} from "../../../../modules/contracts/user-library";
