import {
  registerArtifactUploadApiRoute,
  type RegisterArtifactUploadApiRouteDependencies,
} from "./artifact-upload/registerArtifactUploadApiRoute";
import {
  registerArtifactBrowserApiRoutes,
  type RegisterArtifactBrowserApiRoutesDependencies,
} from "./artifact-browser/registerArtifactBrowserApiRoutes";
import {
  registerArtifactRepoApiRoutes,
  type RegisterArtifactRepoApiRoutesDependencies,
} from "./artifact-repo/registerArtifactRepoApiRoutes";
import {
  registerWebsiteIngestionApiRoutes,
  type RegisterWebsiteIngestionApiRoutesDependencies,
} from "./website-ingestion/registerWebsiteIngestionApiRoutes";
import {
  registerIngestionTaskApiRoute,
  type RegisterIngestionTaskApiRouteDependencies,
} from "./ingestion-task/registerIngestionTaskApiRoute";
import {
  registerImageGenerationApiRoutes,
  type RegisterImageGenerationApiRoutesDependencies,
} from "./image-generation/registerImageGenerationApiRoutes";
import {
  registerModelManagementApiRoutes,
  type RegisterModelManagementApiRoutesDependencies,
} from "./model/registerModelManagementApiRoutes";
import {
  registerApplicationSettingsApiRoutes,
  type RegisterApplicationSettingsApiRoutesDependencies,
} from "./settings/registerApplicationSettingsApiRoutes";
import {
  registerServerControlApiRoutes,
  type RegisterServerControlApiRoutesDependencies,
} from "./server-control/registerServerControlApiRoutes";
import {
  registerRuntimeReadinessApiRoutes,
  type RegisterRuntimeReadinessApiRoutesDependencies,
} from "./runtime-readiness/registerRuntimeReadinessApiRoutes";
import {
  registerDatasetPreparationApiRoutes,
  type RegisterDatasetPreparationApiRoutesDependencies,
} from "./dataset-preparation/registerDatasetPreparationApiRoutes";
import {
  registerDatasetVersionApiRoutes,
  type RegisterDatasetVersionApiRoutesDependencies,
} from "./dataset-version/registerDatasetVersionApiRoutes";
import {
  registerAssetRegistryApiRoutes,
  type RegisterAssetRegistryApiRoutesDependencies,
} from "./asset-registry/registerAssetRegistryApiRoutes";
import {
  registerAssetMutationApiRoutes,
  type RegisterAssetMutationApiRoutesDependencies,
} from "./asset-registry/registerAssetMutationApiRoutes";
import {
  registerWorkspaceApiRoutes,
  type RegisterWorkspaceApiRoutesDependencies,
} from "./workspace/registerWorkspaceApiRoutes";
import {
  registerUserLibraryApiRoutes,
  type RegisterUserLibraryApiRoutesDependencies,
} from "./user-library/registerUserLibraryApiRoutes";
import {
  registerAssetAuthoringApiRoutes,
  type RegisterAssetAuthoringApiRoutesDependencies,
} from "./asset-authoring/registerAssetAuthoringApiRoutes";
import {
  registerEffectiveAssetProjectionApiRoutes,
  type RegisterEffectiveAssetProjectionApiRoutesDependencies,
} from "./effective-asset-projections/registerEffectiveAssetProjectionApiRoutes";
import {
  registerAssetCompositionApiRoutes,
  type RegisterAssetCompositionApiRoutesDependencies,
} from "./asset-composition/registerAssetCompositionApiRoutes";
import {
  registerExecutionPlanApiRoutes,
  type RegisterExecutionPlanApiRoutesDependencies,
} from "./execution-plans/registerExecutionPlanApiRoutes";
import {
  registerConversationExecutionApiRoutes,
  type RegisterConversationExecutionApiRoutesDependencies,
} from "./conversations/registerConversationExecutionApiRoutes";
import {
  registerAssetImplementationApiRoutes,
  type RegisterAssetImplementationApiRoutesDependencies,
} from "./asset-implementation/registerAssetImplementationApiRoutes";
import {
  registerAssetPackageApiRoutes,
  type RegisterAssetPackageApiRoutesDependencies,
} from "./asset-package/registerAssetPackageApiRoutes";
import {
  registerAssetStudioApiRoutes,
  type RegisterAssetStudioApiRoutesDependencies,
} from "./asset-studio/registerAssetStudioApiRoutes";
import {
  registerSystemBuilderApiRoutes,
  type RegisterSystemBuilderApiRoutesDependencies,
} from "./system-builder/registerSystemBuilderApiRoutes";
import {
  registerSystemBuildApiRoutes,
  type RegisterSystemBuildApiRoutesDependencies,
} from "./system-build/registerSystemBuildApiRoutes";
import {
  registerSystemDataApiRoutes,
  type RegisterSystemDataApiRoutesDependencies,
} from "./system-data/registerSystemDataApiRoutes";
import {
  registerSystemReviewApiRoutes,
  type RegisterSystemReviewApiRoutesDependencies,
} from "./system-review/registerSystemReviewApiRoutes";
import {
  registerSystemDeploymentApiRoutes,
  type RegisterSystemDeploymentApiRoutesDependencies,
} from "./system-deployment/registerSystemDeploymentApiRoutes";
import {
  registerSystemRunWorkflowApiRoutes,
  type RegisterSystemRunWorkflowApiRoutesDependencies,
} from "./system-run-workflow/registerSystemRunWorkflowApiRoutes";

export interface RegisterExpressApiDependencies {
  app: RegisterArtifactUploadApiRouteDependencies["app"] &
    RegisterArtifactBrowserApiRoutesDependencies["app"] &
    RegisterArtifactRepoApiRoutesDependencies["app"] &
    RegisterWebsiteIngestionApiRoutesDependencies["app"] &
    RegisterIngestionTaskApiRouteDependencies["app"] &
    RegisterImageGenerationApiRoutesDependencies["app"] &
    RegisterModelManagementApiRoutesDependencies["app"] &
    RegisterApplicationSettingsApiRoutesDependencies["app"] &
    RegisterServerControlApiRoutesDependencies["app"] &
    RegisterRuntimeReadinessApiRoutesDependencies["app"] &
    RegisterDatasetPreparationApiRoutesDependencies["app"] &
    RegisterDatasetVersionApiRoutesDependencies["app"] &
    RegisterAssetRegistryApiRoutesDependencies["app"] &
    RegisterAssetMutationApiRoutesDependencies["app"] &
    RegisterWorkspaceApiRoutesDependencies["app"] &
    RegisterUserLibraryApiRoutesDependencies["app"] &
    RegisterAssetAuthoringApiRoutesDependencies["app"] &
    RegisterEffectiveAssetProjectionApiRoutesDependencies["app"] &
    RegisterAssetCompositionApiRoutesDependencies["app"] &
    RegisterExecutionPlanApiRoutesDependencies["app"] &
    RegisterConversationExecutionApiRoutesDependencies["app"] &
    RegisterSystemDataApiRoutesDependencies["app"] &
    RegisterSystemReviewApiRoutesDependencies["app"] &
    RegisterSystemDeploymentApiRoutesDependencies["app"] &
    RegisterSystemRunWorkflowApiRoutesDependencies["app"];
  getHuggingFaceTokenStatus: RegisterArtifactRepoApiRoutesDependencies["getHuggingFaceTokenStatus"];
  setHuggingFaceToken: RegisterArtifactRepoApiRoutesDependencies["setHuggingFaceToken"];
  clearHuggingFaceToken: RegisterArtifactRepoApiRoutesDependencies["clearHuggingFaceToken"];
  storeArtifactUploadUseCase: RegisterArtifactUploadApiRouteDependencies["storeArtifactUploadUseCase"];
  ingestWebsitePageUseCase?: RegisterWebsiteIngestionApiRoutesDependencies["ingestWebsitePageUseCase"];
  ingestWebsitePagesBatchUseCase?: RegisterWebsiteIngestionApiRoutesDependencies["ingestWebsitePagesBatchUseCase"];
  ingestionTasks: RegisterIngestionTaskApiRouteDependencies["ingestionTasks"];
  browseArtifactsUseCase: RegisterArtifactBrowserApiRoutesDependencies["browseArtifactsUseCase"];
  readArtifactDetailUseCase: RegisterArtifactBrowserApiRoutesDependencies["readArtifactDetailUseCase"];
  readArtifactContentUseCase: RegisterArtifactBrowserApiRoutesDependencies["readArtifactContentUseCase"];
  artifactMediaViewRetrieval: RegisterArtifactBrowserApiRoutesDependencies["artifactMediaViewRetrieval"];
  deleteRegisteredArtifactUseCase: RegisterArtifactBrowserApiRoutesDependencies["deleteRegisteredArtifactUseCase"];
  hasArtifactInRepoUseCase: RegisterArtifactRepoApiRoutesDependencies["hasArtifactInRepoUseCase"];
  browseHuggingFaceNamespaceDatasetsUseCase: RegisterArtifactRepoApiRoutesDependencies["browseHuggingFaceNamespaceDatasetsUseCase"];
  browseHuggingFaceDatasetParquetFilesUseCase: RegisterArtifactRepoApiRoutesDependencies["browseHuggingFaceDatasetParquetFilesUseCase"];
  importHuggingFaceFilesUseCase: RegisterArtifactRepoApiRoutesDependencies["importHuggingFaceFilesUseCase"];
  storeArtifactInRepoUseCase: RegisterArtifactRepoApiRoutesDependencies["storeArtifactInRepoUseCase"];
  publishArtifactToRepoUseCase: RegisterArtifactRepoApiRoutesDependencies["publishArtifactToRepoUseCase"];
  verifyPublishedArtifactBackingUseCase: RegisterArtifactRepoApiRoutesDependencies["verifyPublishedArtifactBackingUseCase"];
  verifyImportedArtifactSourceBackingUseCase: RegisterArtifactRepoApiRoutesDependencies["verifyImportedArtifactSourceBackingUseCase"];
  registerArtifactFromRepoUseCase: RegisterArtifactRepoApiRoutesDependencies["registerArtifactFromRepoUseCase"];
  localizeArtifactFromRepoUseCase: RegisterArtifactRepoApiRoutesDependencies["localizeArtifactFromRepoUseCase"];
  generateImageUseCase: RegisterImageGenerationApiRoutesDependencies["generateImageUseCase"];
  imageGenerationFinalizationOrchestrator?: RegisterImageGenerationApiRoutesDependencies["imageGenerationFinalizationOrchestrator"];
  imageGenerationRuntimeControl?: RegisterImageGenerationApiRoutesDependencies["imageGenerationRuntimeControl"];
  imageGenerationLogger?: RegisterImageGenerationApiRoutesDependencies["logger"];
  browseModelsUseCase: RegisterModelManagementApiRoutesDependencies["browseModelsUseCase"];
  getModelDetailsUseCase: RegisterModelManagementApiRoutesDependencies["getModelDetailsUseCase"];
  listModelsUseCase: RegisterModelManagementApiRoutesDependencies["listModelsUseCase"];
  saveModelReferenceUseCase: RegisterModelManagementApiRoutesDependencies["saveModelReferenceUseCase"];
  downloadModelUseCase: RegisterModelManagementApiRoutesDependencies["downloadModelUseCase"];
  modelDownloadTasksUseCase?: RegisterModelManagementApiRoutesDependencies["modelDownloadTasksUseCase"];
  updateModelRecordUseCase: RegisterModelManagementApiRoutesDependencies["updateModelRecordUseCase"];
  deleteModelRecordUseCase: RegisterModelManagementApiRoutesDependencies["deleteModelRecordUseCase"];
  validateModelUseCase?: RegisterModelManagementApiRoutesDependencies["validateModelUseCase"];
  publishModelUseCase?: RegisterModelManagementApiRoutesDependencies["publishModelUseCase"];
  modelManagementLogger?: RegisterModelManagementApiRoutesDependencies["logger"];
  listSettingsDefinitionsUseCase?: RegisterApplicationSettingsApiRoutesDependencies["listSettingsDefinitionsUseCase"];
  readSettingsUseCase?: RegisterApplicationSettingsApiRoutesDependencies["readSettingsUseCase"];
  updateSettingUseCase?: RegisterApplicationSettingsApiRoutesDependencies["updateSettingUseCase"];
  clearSettingUseCase?: RegisterApplicationSettingsApiRoutesDependencies["clearSettingUseCase"];
  restartServer?: RegisterServerControlApiRoutesDependencies["restartServer"];
  runtimeReadiness?: RegisterRuntimeReadinessApiRoutesDependencies["runtimeReadiness"];
  prepareTrainingDatasetUseCase?: RegisterDatasetPreparationApiRoutesDependencies["prepareTrainingDatasetUseCase"];
  readDatasetPreparationGenerationCapacity?: RegisterDatasetPreparationApiRoutesDependencies["readGenerationCapacity"];
  datasetVersionUseCases?: Omit<RegisterDatasetVersionApiRoutesDependencies, "app">;
  assetRegistryRead?: RegisterAssetRegistryApiRoutesDependencies["assetRegistryRead"];
  assetMutationUseCases?: Omit<
    RegisterAssetMutationApiRoutesDependencies,
    "app"
  >;
  workspaceServices?: Omit<RegisterWorkspaceApiRoutesDependencies, "app">;
  userLibraryServices?: Omit<RegisterUserLibraryApiRoutesDependencies, "app">;
  assetAuthoringServices?: Omit<
    RegisterAssetAuthoringApiRoutesDependencies,
    "app"
  >;
  effectiveAssetProjectionServices?: Omit<
    RegisterEffectiveAssetProjectionApiRoutesDependencies,
    "app"
  >;
  assetCompositionServices?: Omit<
    RegisterAssetCompositionApiRoutesDependencies,
    "app"
  >;
  executionPlanServices?: Omit<
    RegisterExecutionPlanApiRoutesDependencies,
    "app"
  >;
  conversationExecutionServices?: Omit<
    RegisterConversationExecutionApiRoutesDependencies,
    "app"
  >;
  assetImplementationServices?: Omit<
    RegisterAssetImplementationApiRoutesDependencies,
    "app"
  >;
  assetPackageServices?: Omit<RegisterAssetPackageApiRoutesDependencies, "app">;
  assetStudioServices?: Omit<RegisterAssetStudioApiRoutesDependencies, "app">;
  systemBuilderServices?: Omit<
    RegisterSystemBuilderApiRoutesDependencies,
    "app"
  >;
  systemBuildServices?: Omit<RegisterSystemBuildApiRoutesDependencies, "app">;
  systemDataServices?: Omit<RegisterSystemDataApiRoutesDependencies, "app">;
  systemReviewServices?: Omit<RegisterSystemReviewApiRoutesDependencies, "app">;
  systemDeploymentServices?: Omit<
    RegisterSystemDeploymentApiRoutesDependencies,
    "app"
  >;
  systemRunWorkflowServices?: Omit<
    RegisterSystemRunWorkflowApiRoutesDependencies,
    "app"
  >;
}

export function registerExpressApi(
  dependencies: RegisterExpressApiDependencies,
): void {
  registerArtifactUploadApiRoute({
    app: dependencies.app,
    storeArtifactUploadUseCase: dependencies.storeArtifactUploadUseCase,
  });

  registerArtifactBrowserApiRoutes({
    app: dependencies.app,
    browseArtifactsUseCase: dependencies.browseArtifactsUseCase,
    readArtifactDetailUseCase: dependencies.readArtifactDetailUseCase,
    readArtifactContentUseCase: dependencies.readArtifactContentUseCase,
    artifactMediaViewRetrieval: dependencies.artifactMediaViewRetrieval,
    deleteRegisteredArtifactUseCase:
      dependencies.deleteRegisteredArtifactUseCase,
  });

  registerArtifactRepoApiRoutes({
    app: dependencies.app,
    getHuggingFaceTokenStatus: dependencies.getHuggingFaceTokenStatus,
    setHuggingFaceToken: dependencies.setHuggingFaceToken,
    clearHuggingFaceToken: dependencies.clearHuggingFaceToken,
    hasArtifactInRepoUseCase: dependencies.hasArtifactInRepoUseCase,
    browseHuggingFaceNamespaceDatasetsUseCase:
      dependencies.browseHuggingFaceNamespaceDatasetsUseCase,
    browseHuggingFaceDatasetParquetFilesUseCase:
      dependencies.browseHuggingFaceDatasetParquetFilesUseCase,
    importHuggingFaceFilesUseCase: dependencies.importHuggingFaceFilesUseCase,
    storeArtifactInRepoUseCase: dependencies.storeArtifactInRepoUseCase,
    publishArtifactToRepoUseCase: dependencies.publishArtifactToRepoUseCase,
    verifyPublishedArtifactBackingUseCase:
      dependencies.verifyPublishedArtifactBackingUseCase,
    verifyImportedArtifactSourceBackingUseCase:
      dependencies.verifyImportedArtifactSourceBackingUseCase,
    registerArtifactFromRepoUseCase:
      dependencies.registerArtifactFromRepoUseCase,
    localizeArtifactFromRepoUseCase:
      dependencies.localizeArtifactFromRepoUseCase,
  });

  if (
    dependencies.ingestWebsitePageUseCase &&
    dependencies.ingestWebsitePagesBatchUseCase
  ) {
    registerWebsiteIngestionApiRoutes({
      app: dependencies.app,
      ingestWebsitePageUseCase: dependencies.ingestWebsitePageUseCase,
      ingestWebsitePagesBatchUseCase:
        dependencies.ingestWebsitePagesBatchUseCase,
    });
  }

  registerIngestionTaskApiRoute({
    app: dependencies.app,
    ingestionTasks: dependencies.ingestionTasks,
  });

  registerModelManagementApiRoutes({
    app: dependencies.app,
    browseModelsUseCase: dependencies.browseModelsUseCase,
    getModelDetailsUseCase: dependencies.getModelDetailsUseCase,
    listModelsUseCase: dependencies.listModelsUseCase,
    saveModelReferenceUseCase: dependencies.saveModelReferenceUseCase,
    downloadModelUseCase: dependencies.downloadModelUseCase,
    modelDownloadTasksUseCase: dependencies.modelDownloadTasksUseCase,
    updateModelRecordUseCase: dependencies.updateModelRecordUseCase,
    deleteModelRecordUseCase: dependencies.deleteModelRecordUseCase,
    validateModelUseCase: dependencies.validateModelUseCase,
    publishModelUseCase: dependencies.publishModelUseCase,
    logger: dependencies.modelManagementLogger,
  });

  registerImageGenerationApiRoutes({
    app: dependencies.app,
    generateImageUseCase: dependencies.generateImageUseCase,
    imageGenerationFinalizationOrchestrator:
      dependencies.imageGenerationFinalizationOrchestrator,
    imageGenerationRuntimeControl: dependencies.imageGenerationRuntimeControl,
    logger: dependencies.imageGenerationLogger,
  });

  if (
    dependencies.listSettingsDefinitionsUseCase &&
    dependencies.readSettingsUseCase &&
    dependencies.updateSettingUseCase &&
    dependencies.clearSettingUseCase
  ) {
    registerApplicationSettingsApiRoutes({
      app: dependencies.app,
      listSettingsDefinitionsUseCase:
        dependencies.listSettingsDefinitionsUseCase,
      readSettingsUseCase: dependencies.readSettingsUseCase,
      updateSettingUseCase: dependencies.updateSettingUseCase,
      clearSettingUseCase: dependencies.clearSettingUseCase,
    });
  }

  if (dependencies.workspaceServices) {
    registerWorkspaceApiRoutes({
      app: dependencies.app,
      ...dependencies.workspaceServices,
    });
  }

  if (dependencies.userLibraryServices) {
    registerUserLibraryApiRoutes({
      app: dependencies.app,
      ...dependencies.userLibraryServices,
    });
  }

  if (dependencies.assetAuthoringServices) {
    registerAssetAuthoringApiRoutes({
      app: dependencies.app,
      ...dependencies.assetAuthoringServices,
    });
  }

  if (dependencies.effectiveAssetProjectionServices) {
    registerEffectiveAssetProjectionApiRoutes({
      app: dependencies.app,
      ...dependencies.effectiveAssetProjectionServices,
    });
  }
  if (dependencies.assetCompositionServices) {
    registerAssetCompositionApiRoutes({
      app: dependencies.app,
      ...dependencies.assetCompositionServices,
    });
  }
  if (dependencies.executionPlanServices) {
    registerExecutionPlanApiRoutes({
      app: dependencies.app,
      ...dependencies.executionPlanServices,
    });
  }
  if (dependencies.conversationExecutionServices) {
    registerConversationExecutionApiRoutes({
      app: dependencies.app,
      ...dependencies.conversationExecutionServices,
    });
  }
  if (dependencies.assetImplementationServices) {
    registerAssetImplementationApiRoutes({
      app: dependencies.app,
      ...dependencies.assetImplementationServices,
    });
  }
  if (dependencies.assetPackageServices) {
    registerAssetPackageApiRoutes({
      app: dependencies.app,
      ...dependencies.assetPackageServices,
    });
  }
  if (dependencies.assetStudioServices) {
    registerAssetStudioApiRoutes({
      app: dependencies.app,
      ...dependencies.assetStudioServices,
    });
  }
  if (dependencies.systemBuilderServices) {
    registerSystemBuilderApiRoutes({
      app: dependencies.app,
      ...dependencies.systemBuilderServices,
    });
  }
  if (dependencies.systemBuildServices) {
    registerSystemBuildApiRoutes({
      app: dependencies.app,
      ...dependencies.systemBuildServices,
    });
  }
  if (dependencies.systemDataServices) {
    registerSystemDataApiRoutes({
      app: dependencies.app,
      ...dependencies.systemDataServices,
    });
  }
  if (dependencies.systemReviewServices) {
    registerSystemReviewApiRoutes({
      app: dependencies.app,
      ...dependencies.systemReviewServices,
    });
  }
  if (dependencies.systemDeploymentServices) {
    registerSystemDeploymentApiRoutes({
      app: dependencies.app,
      ...dependencies.systemDeploymentServices,
    });
  }
  if (dependencies.systemRunWorkflowServices) {
    registerSystemRunWorkflowApiRoutes({
      app: dependencies.app,
      ...dependencies.systemRunWorkflowServices,
    });
  }

  if (dependencies.assetRegistryRead) {
    registerAssetRegistryApiRoutes({
      app: dependencies.app,
      assetRegistryRead: dependencies.assetRegistryRead,
    });
  }

  if (dependencies.assetMutationUseCases) {
    registerAssetMutationApiRoutes({
      app: dependencies.app,
      ...dependencies.assetMutationUseCases,
    });
  }

  if (dependencies.runtimeReadiness) {
    registerRuntimeReadinessApiRoutes({
      app: dependencies.app,
      runtimeReadiness: dependencies.runtimeReadiness,
    });
  }

  if (dependencies.prepareTrainingDatasetUseCase) {
    registerDatasetPreparationApiRoutes({
      app: dependencies.app,
      prepareTrainingDatasetUseCase: dependencies.prepareTrainingDatasetUseCase,
      readGenerationCapacity:
        dependencies.readDatasetPreparationGenerationCapacity,
    });
  }

  if (dependencies.datasetVersionUseCases) {
    registerDatasetVersionApiRoutes({
      app: dependencies.app,
      ...dependencies.datasetVersionUseCases,
    });
  }

  registerServerControlApiRoutes({
    app: dependencies.app,
    restartServer: dependencies.restartServer,
  });
}
