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
import type { ImageGenerationRequest } from "../../../../../modules/contracts/image-generation";
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
import type {
  AssetFamily,
  AssetLifecycleStatus,
  FinalizeGeneratedOutputCommand,
  ImportExternalRepositoryObjectCommand,
  LocalizeExternalRepositoryObjectCommand,
  RegisterResourceBackedViewCommand,
  AssetResourceBackedViewKind,
  AssetType,
  AssetMutationResult,
  AssetBinding,
  AssetInstance,
} from "../../../../../modules/contracts/asset";
import type {
  ActiveWorkspaceSelection,
  CreateWorkspaceCommand,
} from "../../../../../modules/contracts/workspace";
import type {
  AdmitAssetPackageCommand,
  SetAssetPackageActivationCommand,
} from "../../../../../modules/contracts/asset-package";
import type {
  CreateAssetStudioAssetDraftCommand,
  ListAssetStudioAssetDraftsQuery,
  ReadAssetStudioAssetDraftQuery,
  TransitionAssetStudioAssetDraftCommand,
  UpdateAssetStudioAssetDraftCommand,
  ProposeAssetStudioChangeCommand,
  ReviewAssetStudioProposalCommand,
  StartAssetStudioCommand,
} from "../../../../../modules/contracts/asset-studio";
import type {
  SystemBuilderComposition,
  SystemBuilderTemplateId,
  ListSystemBuilderComposerAssetsQuery,
  ListSystemBuilderManagementQuery,
  PreviewSystemBuilderLayoutChangeCommand,
  PreviewSystemBuilderFoundationUpgradeCommand,
  UpgradeSystemBuilderFoundationCommand,
} from "../../../../../modules/contracts/system-builder";
import type { SystemDeploymentCapabilityPolicy } from "../../../../../modules/contracts/system-deployment";

export interface DesktopArtifactUploadInput {
  workspaceId: string;
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
  sourceKind?: ArtifactBrowseContractItem["sourceKind"];
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

export type DesktopArtifactFamily =
  ArtifactBrowseContractItem["artifactFamily"];

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
  uploadArtifact: (
    input: DesktopArtifactUploadInput,
  ) => Promise<DesktopArtifactUploadResult>;
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
  idempotencyKey?: string;
  workspaceId?: string;
  maximumBytes?: number;
}

export type DesktopAssetBuiltInFilter = "all" | "built-in" | "custom";
export type DesktopAssetDefinitionExpansion =
  | "aiContext"
  | "configurationSchema"
  | "ports"
  | "requirements"
  | "provenance"
  | "metadata";

export interface DesktopAssetDefinitionsListInput {
  searchText?: string;
  assetTypes?: readonly AssetType[];
  assetFamilies?: readonly AssetFamily[];
  lifecycleStatuses?: readonly AssetLifecycleStatus[];
  builtIn?: DesktopAssetBuiltInFilter;
  limit?: number;
  cursor?: string;
  includeMetadata?: boolean;
  workspaceId?: string;
}

export interface DesktopAssetResourceBackedViewsListInput {
  searchText?: string;
  assetTypes?: readonly AssetType[];
  assetFamilies?: readonly AssetFamily[];
  lifecycleStatuses?: readonly AssetLifecycleStatus[];
  viewKinds?: readonly AssetResourceBackedViewKind[];
  limit?: number;
  cursor?: string;
  includeMetadata?: boolean;
  workspaceId?: string;
}

export interface DesktopAssetDefinitionReadInput {
  definitionId: string;
  version?: string;
  expand?: readonly DesktopAssetDefinitionExpansion[];
  includeValidation?: boolean;
  workspaceId?: string;
}

export type DesktopAssetResourceBackedViewExpansion =
  "metadata" | "resourceBackings" | "validation";

export interface DesktopAssetResourceBackedViewReadInput {
  viewId: string;
  expand?: readonly DesktopAssetResourceBackedViewExpansion[];
  includeValidation?: boolean;
  workspaceId?: string;
}

export type DesktopAssetDefinitionVersionReadInput = Required<
  Pick<DesktopAssetDefinitionReadInput, "definitionId" | "version">
> &
  Omit<DesktopAssetDefinitionReadInput, "definitionId" | "version">;

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
  startImageGeneration?: (
    input: ImageGenerationRequest,
    context?: DesktopBridgeRequestContext,
  ) => Promise<unknown>;
  readImageGeneration?: (
    input: { requestId: string },
    context?: DesktopBridgeRequestContext,
  ) => Promise<unknown>;
  cancelImageGeneration?: (
    input: { requestId: string },
    context?: DesktopBridgeRequestContext,
  ) => Promise<unknown>;
  finalizeImageGenerationIfCompleted?: (
    input: { requestId: string; workspaceId?: string },
    context?: DesktopBridgeRequestContext,
  ) => Promise<unknown>;
  readComfyUiInstallStatus?: (
    input?: { installRoot?: string },
    context?: DesktopBridgeRequestContext,
  ) => Promise<unknown>;
  repairComfyUiInstall?: (
    input?: {
      installRoot?: string;
      allowUpdate?: boolean;
      forceRepair?: boolean;
    },
    context?: DesktopBridgeRequestContext,
  ) => Promise<unknown>;
}

export interface DesktopPythonRuntimeApi {
  readPythonRuntimeStatus: () => Promise<unknown>;
  controlPythonRuntime: (input: {
    action: "start" | "stop" | "restart" | "unload-model" | "clear-logs";
  }) => Promise<unknown>;
}

interface DesktopApiBridge {
  memoryDiagnosticsEnabled?: boolean;
  getHuggingFaceTokenStatus: () => Promise<unknown>;
  setHuggingFaceToken: (input: { token: string }) => Promise<unknown>;
  clearHuggingFaceToken: () => Promise<unknown>;
  browseHuggingFaceNamespaceDatasets: (input: {
    namespace: string;
  }) => Promise<unknown>;
  browseHuggingFaceDatasetParquetFiles: (input: {
    repository: string;
    revision?: string;
  }) => Promise<unknown>;
  importHuggingFaceFiles?: (
    input: {
      repositories?: Array<{ repository: string; revision?: string }>;
      files?: Array<{
        repository: string;
        path: string;
        revision?: string;
        mediaType?: string;
      }>;
    },
    context?: DesktopBridgeRequestContext,
  ) => Promise<unknown>;
  uploadArtifact: (input: DesktopArtifactUploadInput) => Promise<unknown>;
  getArtifactUploadPolicy: () => Promise<unknown>;
  ingestWebsitePage?: (
    input: {
      url: string;
      label?: string;
      mode?: "automatic" | "rendered";
    },
    context?: DesktopBridgeRequestContext,
  ) => Promise<unknown>;
  ingestWebsitePagesBatch?: (
    input: {
      targets: DesktopWebsiteIngestionTarget[];
      mode?: "automatic" | "rendered";
    },
    context?: DesktopBridgeRequestContext,
  ) => Promise<unknown>;
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
  readRuntimeReadiness?: (
    context?: DesktopBridgeRequestContext,
  ) => Promise<unknown>;
  readRuntimeCapabilityStatus?: (
    input: { capabilityId: string },
    context?: DesktopBridgeRequestContext,
  ) => Promise<unknown>;
  readFeatureLifecycleState?: (
    context?: DesktopBridgeRequestContext,
  ) => Promise<unknown>;
  disposeIdleFeatures?: (
    context?: DesktopBridgeRequestContext,
  ) => Promise<unknown>;

  listWorkspaces?: (context?: DesktopBridgeRequestContext) => Promise<unknown>;
  createWorkspace?: (
    input: { command: CreateWorkspaceCommand; selectAfterCreate?: boolean },
    context?: DesktopBridgeRequestContext,
  ) => Promise<unknown>;
  readActiveWorkspaceSelection?: (
    context?: DesktopBridgeRequestContext,
  ) => Promise<unknown>;
  saveActiveWorkspaceSelection?: (
    selection: ActiveWorkspaceSelection,
    context?: DesktopBridgeRequestContext,
  ) => Promise<unknown>;
  clearActiveWorkspaceSelection?: (
    context?: DesktopBridgeRequestContext,
  ) => Promise<unknown>;
  listAssetDefinitions?: (
    input?: DesktopAssetDefinitionsListInput,
    context?: DesktopBridgeRequestContext,
  ) => Promise<unknown>;
  createSystemBuilderSystem?: (
    input: { workspaceId: string; name: string; description?: string },
    context?: DesktopBridgeRequestContext,
  ) => Promise<unknown>;
  listSystemBuilderTemplates?: (
    input?: Record<string, never>,
    context?: DesktopBridgeRequestContext,
  ) => Promise<unknown>;
  createSystemBuilderFromTemplate?: (
    input: {
      workspaceId: string;
      templateId: SystemBuilderTemplateId;
      name?: string;
    },
    context?: DesktopBridgeRequestContext,
  ) => Promise<unknown>;
  listSystemBuilderSystems?: (
    input: { workspaceId: string; includeArchived?: boolean },
    context?: DesktopBridgeRequestContext,
  ) => Promise<unknown>;
  listSystemBuilderManagement?: (
    input: ListSystemBuilderManagementQuery,
    context?: DesktopBridgeRequestContext,
  ) => Promise<unknown>;
  readSystemBuilderSystem?: (
    input: { workspaceId: string; systemId: string },
    context?: DesktopBridgeRequestContext,
  ) => Promise<unknown>;
  renameSystemBuilderSystem?: (
    input: {
      workspaceId: string;
      systemId: string;
      expectedRevision: number;
      name: string;
      description?: string;
    },
    context?: DesktopBridgeRequestContext,
  ) => Promise<unknown>;
  archiveSystemBuilderSystem?: (
    input: { workspaceId: string; systemId: string; expectedRevision: number },
    context?: DesktopBridgeRequestContext,
  ) => Promise<unknown>;
  restoreSystemBuilderSystem?: (
    input: { workspaceId: string; systemId: string; expectedRevision: number },
    context?: DesktopBridgeRequestContext,
  ) => Promise<unknown>;
  cloneSystemBuilderSystem?: (
    input: { workspaceId: string; sourceSystemId: string; name: string },
    context?: DesktopBridgeRequestContext,
  ) => Promise<unknown>;
  saveSystemBuilderRevision?: (
    input: {
      workspaceId: string;
      systemId: string;
      expectedRecordRevision: number;
      composition: SystemBuilderComposition;
      instances: readonly AssetInstance[];
      bindings: readonly AssetBinding[];
    },
    context?: DesktopBridgeRequestContext,
  ) => Promise<unknown>;
  readSystemBuilderRevision?: (
    input: { workspaceId: string; systemId: string; revisionId?: string },
    context?: DesktopBridgeRequestContext,
  ) => Promise<unknown>;
  listSystemBuilderRevisions?: (
    input: { workspaceId: string; systemId: string },
    context?: DesktopBridgeRequestContext,
  ) => Promise<unknown>;
  listSystemBuilderComposerAssets?: (
    input: ListSystemBuilderComposerAssetsQuery,
    context?: DesktopBridgeRequestContext,
  ) => Promise<unknown>;
  previewSystemBuilderLayoutChange?: (
    input: Omit<
      PreviewSystemBuilderLayoutChangeCommand,
      "actorId" | "workspaceId" | "systemId"
    > & { readonly workspaceId: string; readonly systemId: string },
    context?: DesktopBridgeRequestContext,
  ) => Promise<unknown>;
  previewSystemBuilderFoundationUpgrade?: (
    input: Omit<
      PreviewSystemBuilderFoundationUpgradeCommand,
      "actorId" | "workspaceId" | "systemId"
    > & { readonly workspaceId: string; readonly systemId: string },
    context?: DesktopBridgeRequestContext,
  ) => Promise<unknown>;
  upgradeSystemBuilderFoundation?: (
    input: Omit<
      UpgradeSystemBuilderFoundationCommand,
      "actorId" | "workspaceId" | "systemId"
    > & { readonly workspaceId: string; readonly systemId: string },
    context?: DesktopBridgeRequestContext,
  ) => Promise<unknown>;
  requestSystemBuild?: (
    input: Record<string, unknown>,
    context?: DesktopBridgeRequestContext,
  ) => Promise<unknown>;
  cancelSystemBuild?: (
    input: { workspaceId: string; buildId: string },
    context?: DesktopBridgeRequestContext,
  ) => Promise<unknown>;
  readSystemBuild?: (
    input: { workspaceId: string; buildId: string },
    context?: DesktopBridgeRequestContext,
  ) => Promise<unknown>;
  listSystemBuilds?: (
    input: { workspaceId: string; systemId?: string },
    context?: DesktopBridgeRequestContext,
  ) => Promise<unknown>;
  approveSystemRelease?: (
    input: {
      workspaceId: string;
      buildId: string;
      expectedLockDigest: string;
      releaseId?: string;
    },
    context?: DesktopBridgeRequestContext,
  ) => Promise<unknown>;
  readSystemRelease?: (
    input: { workspaceId: string; releaseId: string },
    context?: DesktopBridgeRequestContext,
  ) => Promise<unknown>;
  listSystemReleases?: (
    input: { workspaceId: string; systemId?: string },
    context?: DesktopBridgeRequestContext,
  ) => Promise<unknown>;
  compareSystemReleases?: (
    input: {
      workspaceId: string;
      leftReleaseId: string;
      rightReleaseId: string;
    },
    context?: DesktopBridgeRequestContext,
  ) => Promise<unknown>;
  describeSystemDataForm?: (
    input: { workspaceId: string; releaseId: string; entityType: string },
    context?: DesktopBridgeRequestContext,
  ) => Promise<unknown>;
  createSystemDataRecord?: (
    input: {
      workspaceId: string;
      releaseId: string;
      entityType: string;
      recordId: string;
      values: Record<string, string | number | boolean | null>;
    },
    context?: DesktopBridgeRequestContext,
  ) => Promise<unknown>;
  readSystemDataRecord?: (
    input: {
      workspaceId: string;
      releaseId: string;
      entityType: string;
      recordId: string;
    },
    context?: DesktopBridgeRequestContext,
  ) => Promise<unknown>;
  updateSystemDataRecord?: (
    input: {
      workspaceId: string;
      releaseId: string;
      entityType: string;
      recordId: string;
      expectedRevision: number;
      values: Record<string, string | number | boolean | null>;
    },
    context?: DesktopBridgeRequestContext,
  ) => Promise<unknown>;
  listSystemDataRecords?: (
    input: {
      workspaceId: string;
      releaseId: string;
      entityType: string;
      limit?: number;
      offset?: number;
    },
    context?: DesktopBridgeRequestContext,
  ) => Promise<unknown>;
  listSystemDataAudit?: (
    input: {
      workspaceId: string;
      releaseId: string;
      entityType: string;
      limit?: number;
    },
    context?: DesktopBridgeRequestContext,
  ) => Promise<unknown>;
  describeSystemReview?: (
    input: { workspaceId: string; releaseId: string },
    context?: DesktopBridgeRequestContext,
  ) => Promise<unknown>;
  browseSystemReviewArtifacts?: (
    input: {
      workspaceId: string;
      releaseId: string;
      nameQuery?: string;
      limit?: number;
    },
    context?: DesktopBridgeRequestContext,
  ) => Promise<unknown>;
  readSystemReviewArtifact?: (
    input: { workspaceId: string; releaseId: string; artifactRef: string },
    context?: DesktopBridgeRequestContext,
  ) => Promise<unknown>;
  previewSystemReviewArtifact?: (
    input: { workspaceId: string; releaseId: string; artifactRef: string },
    context?: DesktopBridgeRequestContext,
  ) => Promise<unknown>;
  listSystemReviewAudit?: (
    input: { workspaceId: string; releaseId: string; limit?: number },
    context?: DesktopBridgeRequestContext,
  ) => Promise<unknown>;
  installSystemDeployment?: (
    input: {
      workspaceId: string;
      deploymentId: string;
      releaseId: string;
      deploymentProfile: string;
      policy: SystemDeploymentCapabilityPolicy;
    },
    context?: DesktopBridgeRequestContext,
  ) => Promise<unknown>;
  activateSystemDeployment?: (
    input: { workspaceId: string; deploymentId: string },
    context?: DesktopBridgeRequestContext,
  ) => Promise<unknown>;
  reconcileSystemDeploymentHealth?: (
    input: { workspaceId: string; deploymentId: string },
    context?: DesktopBridgeRequestContext,
  ) => Promise<unknown>;
  rollbackSystemDeployment?: (
    input: { workspaceId: string; deploymentId: string },
    context?: DesktopBridgeRequestContext,
  ) => Promise<unknown>;
  revokeSystemDeployment?: (
    input: { workspaceId: string; deploymentId: string },
    context?: DesktopBridgeRequestContext,
  ) => Promise<unknown>;
  readSystemDeployment?: (
    input: { workspaceId: string; deploymentId: string },
    context?: DesktopBridgeRequestContext,
  ) => Promise<unknown>;
  listSystemDeployments?: (
    input: { workspaceId: string; releaseId?: string },
    context?: DesktopBridgeRequestContext,
  ) => Promise<unknown>;
  startSystemDeploymentRun?: (
    input: {
      workspaceId: string;
      deploymentId: string;
      runId: string;
      requestedCapabilities: readonly string[];
      requestedSecretReferences: readonly string[];
      requestedEgressOrigins: readonly string[];
    },
    context?: DesktopBridgeRequestContext,
  ) => Promise<unknown>;
  cancelSystemDeploymentRun?: (
    input: { workspaceId: string; runId: string },
    context?: DesktopBridgeRequestContext,
  ) => Promise<unknown>;
  listSystemDeploymentRuns?: (
    input: { workspaceId: string; deploymentId?: string; limit?: number },
    context?: DesktopBridgeRequestContext,
  ) => Promise<unknown>;
  listSystemDeploymentAudit?: (
    input: { workspaceId: string; deploymentId: string; limit?: number },
    context?: DesktopBridgeRequestContext,
  ) => Promise<unknown>;
  inspectAssetPackage?: (
    input: { workspaceId: string; bytes: Uint8Array },
    context?: DesktopBridgeRequestContext,
  ) => Promise<unknown>;
  admitAssetPackage?: (
    input: Omit<AdmitAssetPackageCommand, "actorId">,
    context?: DesktopBridgeRequestContext,
  ) => Promise<unknown>;
  listAssetPackages?: (
    workspaceId: string,
    context?: DesktopBridgeRequestContext,
  ) => Promise<unknown>;
  activateAssetPackage?: (
    input: Omit<SetAssetPackageActivationCommand, "actorId">,
    context?: DesktopBridgeRequestContext,
  ) => Promise<unknown>;
  disableAssetPackage?: (
    input: Omit<SetAssetPackageActivationCommand, "actorId">,
    context?: DesktopBridgeRequestContext,
  ) => Promise<unknown>;
  rollbackAssetPackage?: (
    input: Omit<SetAssetPackageActivationCommand, "actorId">,
    context?: DesktopBridgeRequestContext,
  ) => Promise<unknown>;
  proposeAssetStudioChange?: (
    input: Omit<ProposeAssetStudioChangeCommand, "actorId">,
    context?: DesktopBridgeRequestContext,
  ) => Promise<unknown>;
  startAssetStudio?: (
    input: Omit<StartAssetStudioCommand, "actorId">,
    context?: DesktopBridgeRequestContext,
  ) => Promise<unknown>;
  reviewAssetStudioProposal?: (
    input: Omit<ReviewAssetStudioProposalCommand, "actorId">,
    context?: DesktopBridgeRequestContext,
  ) => Promise<unknown>;
  readAssetStudioProposal?: (
    input: { workspaceId: string; workflowId: string },
    context?: DesktopBridgeRequestContext,
  ) => Promise<unknown>;
  listAssetStudioWorkflows?: (
    workspaceId: string,
    context?: DesktopBridgeRequestContext,
  ) => Promise<unknown>;
  createAssetStudioAssetDraft?: (
    input: Omit<CreateAssetStudioAssetDraftCommand, "actorId">,
    context?: DesktopBridgeRequestContext,
  ) => Promise<unknown>;
  updateAssetStudioAssetDraft?: (
    input: Omit<UpdateAssetStudioAssetDraftCommand, "actorId">,
    context?: DesktopBridgeRequestContext,
  ) => Promise<unknown>;
  readAssetStudioAssetDraft?: (
    input: ReadAssetStudioAssetDraftQuery,
    context?: DesktopBridgeRequestContext,
  ) => Promise<unknown>;
  listAssetStudioAssetDrafts?: (
    input: ListAssetStudioAssetDraftsQuery,
    context?: DesktopBridgeRequestContext,
  ) => Promise<unknown>;
  reviewAssetStudioAssetDraft?: (
    input: Omit<TransitionAssetStudioAssetDraftCommand, "actorId">,
    context?: DesktopBridgeRequestContext,
  ) => Promise<unknown>;
  publishAssetStudioAssetDraft?: (
    input: Omit<TransitionAssetStudioAssetDraftCommand, "actorId">,
    context?: DesktopBridgeRequestContext,
  ) => Promise<unknown>;
  abandonAssetStudioAssetDraft?: (
    input: Omit<TransitionAssetStudioAssetDraftCommand, "actorId">,
    context?: DesktopBridgeRequestContext,
  ) => Promise<unknown>;
  readAssetDefinition?: (
    input: DesktopAssetDefinitionReadInput,
    context?: DesktopBridgeRequestContext,
  ) => Promise<unknown>;
  readAssetDefinitionVersion?: (
    input: DesktopAssetDefinitionVersionReadInput,
    context?: DesktopBridgeRequestContext,
  ) => Promise<unknown>;
  listAssetResourceBackedViews?: (
    input?: DesktopAssetResourceBackedViewsListInput,
    context?: DesktopBridgeRequestContext,
  ) => Promise<unknown>;
  readAssetResourceBackedView?: (
    input: DesktopAssetResourceBackedViewReadInput,
    context?: DesktopBridgeRequestContext,
  ) => Promise<unknown>;
  registerResourceBackedViewAsAsset?: (
    command: RegisterResourceBackedViewCommand,
    context?: DesktopBridgeRequestContext,
  ) => Promise<AssetMutationResult | unknown>;
  finalizeGeneratedOutputAsAsset?: (
    command: FinalizeGeneratedOutputCommand,
    context?: DesktopBridgeRequestContext,
  ) => Promise<AssetMutationResult | unknown>;
  importExternalRepositoryObjectAsAsset?: (
    command: ImportExternalRepositoryObjectCommand,
    context?: DesktopBridgeRequestContext,
  ) => Promise<AssetMutationResult | unknown>;
  localizeExternalRepositoryObjectAsAsset?: (
    command: LocalizeExternalRepositoryObjectCommand,
    context?: DesktopBridgeRequestContext,
  ) => Promise<AssetMutationResult | unknown>;
  readPythonRuntimeStatus?: () => Promise<unknown>;
  controlPythonRuntime?: (input: {
    action: "start" | "stop" | "restart" | "unload-model" | "clear-logs";
  }) => Promise<unknown>;
  startImageGeneration?: (
    input: ImageGenerationRequest,
    context?: DesktopBridgeRequestContext,
  ) => Promise<unknown>;
  readImageGeneration?: (
    input: { requestId: string },
    context?: DesktopBridgeRequestContext,
  ) => Promise<unknown>;
  cancelImageGeneration?: (
    input: { requestId: string },
    context?: DesktopBridgeRequestContext,
  ) => Promise<unknown>;
  finalizeImageGenerationIfCompleted?: (
    input: { requestId: string; workspaceId?: string },
    context?: DesktopBridgeRequestContext,
  ) => Promise<unknown>;
  readComfyUiInstallStatus?: (
    input?: { installRoot?: string },
    context?: DesktopBridgeRequestContext,
  ) => Promise<unknown>;
  repairComfyUiInstall?: (
    input?: {
      installRoot?: string;
      allowUpdate?: boolean;
      forceRepair?: boolean;
    },
    context?: DesktopBridgeRequestContext,
  ) => Promise<unknown>;
  browseArtifacts: (
    input?: { artifactFamily?: DesktopArtifactFamily; workspaceId?: string },
    context?: DesktopBridgeRequestContext,
  ) => Promise<unknown>;
  browseUnregisteredArtifacts?: (
    input?: { workspaceId?: string },
    context?: DesktopBridgeRequestContext,
  ) => Promise<unknown>;
  registerUnregisteredArtifact?: (
    input: { storageKey: string; workspaceId?: string },
    context?: DesktopBridgeRequestContext,
  ) => Promise<unknown>;
  deleteUnregisteredArtifact?: (
    input: { storageKey: string; workspaceId?: string },
    context?: DesktopBridgeRequestContext,
  ) => Promise<unknown>;
  deleteRegisteredArtifact?: (
    input: { storageKey: string; workspaceId?: string },
    context?: DesktopBridgeRequestContext,
  ) => Promise<unknown>;
  readArtifactDetail: (
    locator: DesktopArtifactBrowserLocator,
    context?: DesktopBridgeRequestContext,
  ) => Promise<unknown>;
  readArtifactContentDescriptor: (
    locator: DesktopArtifactBrowserLocator,
    context?: DesktopBridgeRequestContext,
  ) => Promise<unknown>;
  readArtifactViewerMedia: (
    locator: DesktopArtifactBrowserLocator,
    context?: DesktopBridgeRequestContext,
  ) => Promise<unknown>;
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
  localizeArtifactFromRepo: (input: { artifactId: string }) => Promise<unknown>;

  listApplicationSettingDefinitions?: (
    input?: ListApplicationSettingDefinitionsRequest,
  ) => Promise<unknown>;
  readApplicationSettings?: (
    input?: ReadApplicationSettingsRequest,
  ) => Promise<unknown>;
  updateApplicationSetting?: (
    input: UpdateApplicationSettingRequest,
  ) => Promise<unknown>;
  clearApplicationSetting?: (input: { key: string }) => Promise<unknown>;
  resolveApplicationModelDefault?: (
    input: ResolveModelDefaultRequest,
  ) => Promise<unknown>;
  resolveModelDefault?: (input: ResolveModelDefaultRequest) => Promise<unknown>;
  selectApplicationSettingsFolder?: (input?: {
    title?: string;
    defaultPath?: string;
  }) => Promise<unknown>;
  browseModels?: (
    input: DesktopModelBrowseRequest,
    context?: DesktopBridgeRequestContext,
  ) => Promise<unknown>;
  getModelDetails?: (
    input: DesktopModelDetailsRequest,
    context?: DesktopBridgeRequestContext,
  ) => Promise<unknown>;
  listModels?: (
    input?: DesktopModelListRequest,
    context?: DesktopBridgeRequestContext,
  ) => Promise<unknown>;
  saveModelReference?: (
    input: DesktopSaveModelReferenceRequest,
    context?: DesktopBridgeRequestContext,
  ) => Promise<unknown>;
  downloadModel?: (
    input: DesktopDownloadModelRequest,
    context?: DesktopBridgeRequestContext,
  ) => Promise<unknown>;
  updateModelRecord?: (
    input: DesktopUpdateModelRecordRequest,
    context?: DesktopBridgeRequestContext,
  ) => Promise<unknown>;
  deleteModelRecord?: (
    input: DesktopDeleteModelRecordRequest,
    context?: DesktopBridgeRequestContext,
  ) => Promise<unknown>;
  trainModel?: (
    input: DesktopModelTrainingRequest,
    context?: DesktopBridgeRequestContext,
  ) => Promise<unknown>;
  readModelTrainingStatus?: (
    input: { runId: string },
    context?: DesktopBridgeRequestContext,
  ) => Promise<unknown>;
  validateModel?: (
    input: DesktopValidateModelRequest,
    context?: DesktopBridgeRequestContext,
  ) => Promise<unknown>;
  publishModel?: (
    input: DesktopPublishModelRequest,
    context?: DesktopBridgeRequestContext,
  ) => Promise<unknown>;
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

export interface DesktopHuggingFaceFilesImportResult {
  repositories: Array<{
    repository: string;
    revision: string;
    status: "succeeded" | "partial" | "failed";
    message?: string;
    code?: "validation" | "not-found" | "unavailable" | "internal";
    files: Array<{
      repository: string;
      path: string;
      revision: string;
      mediaType?: string;
      status: "registered" | "failed";
      artifactId?: string;
      message?: string;
      code?: "validation" | "not-found" | "unavailable" | "internal";
    }>;
  }>;
  summary: {
    attempted: number;
    succeeded: number;
    failed: number;
  };
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
