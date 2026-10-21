import {
  CompareDatasetVersionsUseCase,
  ListDatasetVersionsUseCase,
  ListDatasetReviewTargetsUseCase,
  ReadDatasetReviewPageUseCase,
  RejectDatasetReviewRowUseCase,
  EditDatasetReviewRowUseCase,
  PrepareTrainingDatasetFromArtifactsUseCase,
  PublishDatasetVersionUseCase,
  ReadDatasetVersionReproductionUseCase,
} from "../../../application/use-cases";
import { createDefaultDatasetQualityPolicyProvider } from "../../../application/services/dataset-preparation";
import { DatasetVersionFinalizationService } from "../../../application/services/dataset-version";
import { createStructuredDatasetVersionRepository } from "../../../adapters/persistence/dataset-version";
import type { StructuredDocumentStore } from "../../../adapters/persistence/shared";
import { createSha256DatasetVersionHasher } from "../../../adapters/storage/dataset-version";
import { createPythonParquetDatasetReviewAdapter } from "../../../adapters/runtime/python";
import { asyncLazyObject } from "./lazyProxy";

export interface ComposeDesktopDatasetPreparationFeatureOptions {
  artifacts: any;
  runtime: any;
  getArtifactRemoteFeatures: () => Promise<any>;
  documents?: StructuredDocumentStore;
  workspaceRepository?: any;
  workspaceAuthorization?: any;
  now?: () => string;
}

export function composeDesktopDatasetPreparationFeature(
  options: ComposeDesktopDatasetPreparationFeatureOptions,
): any {
  const datasetVersionHasher = createSha256DatasetVersionHasher();
  const datasetVersionRepository = options.documents
    ? createStructuredDatasetVersionRepository(options.documents)
    : undefined;
  const datasetVersionFinalizer = datasetVersionRepository
    ? new DatasetVersionFinalizationService({
        repository: datasetVersionRepository,
        artifacts: options.artifacts.storage,
        hasher: datasetVersionHasher,
      })
    : undefined;
  const datasetVersioning = datasetVersionRepository
    ? {
        hasher: datasetVersionHasher,
        finalizer: datasetVersionFinalizer!,
      }
    : undefined;
  const datasetVersionUseCases = datasetVersionRepository
    ? {
        listDatasetVersionsUseCase: new ListDatasetVersionsUseCase({
          repository: datasetVersionRepository,
          workspaceRepository: options.workspaceRepository,
          workspaceAuthorization: options.workspaceAuthorization,
        }),
        compareDatasetVersionsUseCase: new CompareDatasetVersionsUseCase({
          repository: datasetVersionRepository,
          workspaceRepository: options.workspaceRepository,
          workspaceAuthorization: options.workspaceAuthorization,
        }),
        readDatasetVersionReproductionUseCase:
          new ReadDatasetVersionReproductionUseCase({
            repository: datasetVersionRepository,
            artifacts: options.artifacts.storage,
            hasher: datasetVersionHasher,
            workspaceRepository: options.workspaceRepository,
            workspaceAuthorization: options.workspaceAuthorization,
          }),
        publishDatasetVersionUseCase: new PublishDatasetVersionUseCase({
          repository: datasetVersionRepository,
          artifacts: options.artifacts.storage,
          publisher: asyncLazyObject(
            async () =>
              (await options.getArtifactRemoteFeatures())
                .huggingFaceArtifactRepoStorage,
          ),
          hasher: datasetVersionHasher,
          workspaceRepository: options.workspaceRepository,
          workspaceAuthorization: options.workspaceAuthorization,
          now: options.now,
        }),
        listDatasetReviewTargetsUseCase: new ListDatasetReviewTargetsUseCase({
          repository: datasetVersionRepository,
          catalog: options.artifacts.artifactCatalog,
          artifacts: options.artifacts.storage,
          parquet: createPythonParquetDatasetReviewAdapter(
            options.runtime.runtimeTaskRegistry,
          ),
          finalizer: datasetVersionFinalizer!,
          hasher: datasetVersionHasher,
          workspaceRepository: options.workspaceRepository,
          workspaceAuthorization: options.workspaceAuthorization,
          now: options.now,
        }),
        readDatasetReviewPageUseCase: new ReadDatasetReviewPageUseCase({
          repository: datasetVersionRepository,
          catalog: options.artifacts.artifactCatalog,
          artifacts: options.artifacts.storage,
          parquet: createPythonParquetDatasetReviewAdapter(
            options.runtime.runtimeTaskRegistry,
          ),
          finalizer: datasetVersionFinalizer!,
          hasher: datasetVersionHasher,
          workspaceRepository: options.workspaceRepository,
          workspaceAuthorization: options.workspaceAuthorization,
          now: options.now,
        }),
        rejectDatasetReviewRowUseCase: new RejectDatasetReviewRowUseCase({
          repository: datasetVersionRepository,
          catalog: options.artifacts.artifactCatalog,
          artifacts: options.artifacts.storage,
          parquet: createPythonParquetDatasetReviewAdapter(
            options.runtime.runtimeTaskRegistry,
          ),
          finalizer: datasetVersionFinalizer!,
          hasher: datasetVersionHasher,
          workspaceRepository: options.workspaceRepository,
          workspaceAuthorization: options.workspaceAuthorization,
          now: options.now,
        }),
        editDatasetReviewRowUseCase: new EditDatasetReviewRowUseCase({
          repository: datasetVersionRepository,
          catalog: options.artifacts.artifactCatalog,
          artifacts: options.artifacts.storage,
          parquet: createPythonParquetDatasetReviewAdapter(
            options.runtime.runtimeTaskRegistry,
          ),
          finalizer: datasetVersionFinalizer!,
          hasher: datasetVersionHasher,
          workspaceRepository: options.workspaceRepository,
          workspaceAuthorization: options.workspaceAuthorization,
          now: options.now,
        }),
      }
    : {};
  return {
    prepareTrainingDatasetUseCase:
      new PrepareTrainingDatasetFromArtifactsUseCase({
        runtimeTaskRegistry: options.runtime.runtimeTaskRegistry,
        taskReconciler: options.runtime.taskReconciler,
        storageBindings: options.artifacts.artifactBindings,
        storage: options.artifacts.storage,
        artifactRepoStorage: asyncLazyObject(
          async () =>
            (await options.getArtifactRemoteFeatures()).artifactRepoStorage,
        ),
        artifactCatalog: options.artifacts.artifactCatalog,
        now: options.now,
        taskPowerLifecycle: options.runtime.taskPowerLifecycle,
        runtimeCapabilityGuard: options.runtime.runtimeCapabilityGuard,
        datasetQualityPolicyProvider:
          createDefaultDatasetQualityPolicyProvider(),
        datasetVersioning,
      }),
    ...datasetVersionUseCases,
  };
}
