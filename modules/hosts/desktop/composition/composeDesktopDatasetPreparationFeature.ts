import {
  CompareDatasetVersionsUseCase,
  ListDatasetVersionsUseCase,
  PrepareTrainingDatasetFromArtifactsUseCase,
  PublishDatasetVersionUseCase,
  ReadDatasetVersionReproductionUseCase,
} from "../../../application/use-cases";
import { createDefaultDatasetQualityPolicyProvider } from "../../../application/services/dataset-preparation";
import { DatasetVersionFinalizationService } from "../../../application/services/dataset-version";
import { createStructuredDatasetVersionRepository } from "../../../adapters/persistence/dataset-version";
import type { StructuredDocumentStore } from "../../../adapters/persistence/shared";
import { createSha256DatasetVersionHasher } from "../../../adapters/storage/dataset-version";
import { TaskType } from "../../../contracts/runtime";
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

export function composeDesktopDatasetPreparationFeature(options: ComposeDesktopDatasetPreparationFeatureOptions): any {
  let disposed = false;
  const datasetVersionHasher = createSha256DatasetVersionHasher();
  const datasetVersionRepository = options.documents
    ? createStructuredDatasetVersionRepository(options.documents)
    : undefined;
  const datasetVersioning = datasetVersionRepository
    ? {
        hasher: datasetVersionHasher,
        finalizer: new DatasetVersionFinalizationService({
          repository: datasetVersionRepository,
          artifacts: options.artifacts.storage,
          hasher: datasetVersionHasher,
        }),
      }
    : undefined;
  const datasetVersionUseCases = datasetVersionRepository
    ? {
        listDatasetVersionsUseCase: new ListDatasetVersionsUseCase({ repository: datasetVersionRepository, workspaceRepository: options.workspaceRepository, workspaceAuthorization: options.workspaceAuthorization }),
        compareDatasetVersionsUseCase: new CompareDatasetVersionsUseCase({ repository: datasetVersionRepository, workspaceRepository: options.workspaceRepository, workspaceAuthorization: options.workspaceAuthorization }),
        readDatasetVersionReproductionUseCase: new ReadDatasetVersionReproductionUseCase({ repository: datasetVersionRepository, artifacts: options.artifacts.storage, hasher: datasetVersionHasher, workspaceRepository: options.workspaceRepository, workspaceAuthorization: options.workspaceAuthorization }),
        publishDatasetVersionUseCase: new PublishDatasetVersionUseCase({
          repository: datasetVersionRepository,
          artifacts: options.artifacts.storage,
          publisher: asyncLazyObject(async () => (await options.getArtifactRemoteFeatures()).huggingFaceArtifactRepoStorage),
          hasher: datasetVersionHasher,
          workspaceRepository: options.workspaceRepository,
          workspaceAuthorization: options.workspaceAuthorization,
          now: options.now,
        }),
      }
    : {};
  return {
    dispose() { disposed = true; },
    get disposed() { return disposed; },
    async canDispose() {
      try {
        const active = await options.runtime.runtimeTaskRegistry.listTasks({ taskTypes: [TaskType.DATASET_PREPARATION], statuses: ["queued", "running", "unknown"] });
        const activeTaskCount = active.tasks.length;
        return activeTaskCount > 0 ? { blockedReason: "active-runtime-tasks", activeTaskCount } : undefined;
      } catch {
        return { blockedReason: "active-task-status-unavailable" };
      }
    },
    prepareTrainingDatasetUseCase: new PrepareTrainingDatasetFromArtifactsUseCase({
      runtimeTaskRegistry: options.runtime.runtimeTaskRegistry,
      storageBindings: options.artifacts.artifactBindings,
      storage: options.artifacts.storage,
      artifactRepoStorage: asyncLazyObject(async () => (await options.getArtifactRemoteFeatures()).artifactRepoStorage),
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
