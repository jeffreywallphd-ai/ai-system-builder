import { createLocalModelRegistryAdapter } from "../../../adapters/persistence/model";
import { createHuggingFaceModelBrowseDetailsAdapter, createHuggingFaceModelPublisherAdapter } from "../../../adapters/model/huggingface";
import { createLocalGeneratedModelStorageAdapter, createLocalModelLocationAuthorityAdapter, resolveLocalGeneratedModelStorageRoot } from "../../../adapters/model/local";
import { resolveConfiguredModelCacheRoot } from "../../../adapters/runtime/python";
import type { StructuredDocumentStore } from "../../../adapters/persistence/shared";
import {
  BrowseModelsUseCase,
  DeleteModelRecordUseCase,
  DownloadModelUseCase,
  ModelDownloadTasksUseCase,
  GetModelDetailsUseCase,
  ListModelsUseCase,
  PublishModelUseCase,
  RevealModelInFolderUseCase,
  SaveModelReferenceUseCase,
  TrainModelUseCase,
  UpdateModelRecordUseCase,
  ValidateModelUseCase,
} from "../../../application/use-cases";
import { asyncLazyObject } from "./lazyProxy";

export interface ComposeDesktopModelFeatureOptions {
  taskReconciler?: import("../../../application/services/runtime/owned-task-reconciler.service").OwnedTaskReconcilerService;
  storageRootDirectory: string;
  now: () => string;
  documents?: StructuredDocumentStore;
  tokenProvider: () => string | undefined;
  readSharedModelStorageDirectory?: () => Promise<string | undefined>;
  getArtifacts: () => Promise<any>;
  getRuntimeTaskFeatures: () => Promise<any>;
  getPythonRuntimeFoundation: () => Promise<any>;
  revealModelPath?: (localPath: string) => Promise<void> | void;
}

export function composeDesktopModelFeature(options: ComposeDesktopModelFeatureOptions): any {
  const modelLocations = createLocalModelLocationAuthorityAdapter({
    rootDirectory: options.storageRootDirectory,
    documents: options.documents,
    approvedRoots: [resolveLocalGeneratedModelStorageRoot({ env: process.env }), resolveConfiguredModelCacheRoot(process.env)],
    revealPath: options.revealModelPath,
  });
  const modelRegistry = createLocalModelRegistryAdapter({
    filePath: `${options.storageRootDirectory}/model-registry/models.json`,
    rootDirectory: options.storageRootDirectory,
    documents: options.documents,
    now: options.now,
    discovery: {
      searchRoots: async () => {
        const root = await options.readSharedModelStorageDirectory?.();
        return root ? [root] : [];
      },
    },
  });
  const huggingFaceModelBrowseDetails = createHuggingFaceModelBrowseDetailsAdapter({ accessTokenProvider: options.tokenProvider });
  const modelPublisher = createHuggingFaceModelPublisherAdapter({
    tokenProvider: options.tokenProvider,
    approvedModelRoots: [resolveLocalGeneratedModelStorageRoot({ env: process.env })],
    client: { async uploadFile(params) {
      const hub = await import("@huggingface/hub");
      await hub.uploadFile({ repo: { type: "model", name: params.repo }, file: { path: params.path, content: new Blob([new Uint8Array(params.content)]) }, branch: params.revision, accessToken: params.token });
    } },
  });
  return {
    modelRegistry,
    browseModelsUseCase: new BrowseModelsUseCase({ providers: { huggingface: huggingFaceModelBrowseDetails } }),
    getModelDetailsUseCase: new GetModelDetailsUseCase({ providers: { huggingface: huggingFaceModelBrowseDetails } }),
    listModelsUseCase: new ListModelsUseCase({ modelRegistry }),
    saveModelReferenceUseCase: new SaveModelReferenceUseCase({ modelRegistry }),
    downloadModelUseCase: new DownloadModelUseCase({ modelRegistry, modelDownloader: { ensureModelDownloaded: async (request) => { const foundation = await options.getPythonRuntimeFoundation(); await foundation.supervisor.start(); return foundation.runtimePort.ensureModelDownloaded(request); } } }),
    modelDownloadTasksUseCase: new ModelDownloadTasksUseCase({
      taskReconciler: options.taskReconciler,
      runtimeTaskRegistry: asyncLazyObject(async () => (await options.getRuntimeTaskFeatures()).runtimeTaskRegistry),
      modelDownloadCompletion: asyncLazyObject(async () => (await options.getRuntimeTaskFeatures()).modelDownloadCompletionPort),
      modelRegistry,
      now: options.now,
    }),
    updateModelRecordUseCase: new UpdateModelRecordUseCase({ modelRegistry }),
    deleteModelRecordUseCase: new DeleteModelRecordUseCase({
      modelRegistry,
      artifactCatalogDeletePort: asyncLazyObject(async () => (await options.getArtifacts()).artifactCatalog),
      modelLocalFilesDeletePort: modelLocations,
    }),
    revealModelInFolderUseCase: new RevealModelInFolderUseCase({
      modelRegistry,
      modelLocationRevealer: modelLocations,
    }),
    trainModelUseCase: new TrainModelUseCase({ taskReconciler: options.taskReconciler, runtimeTaskRegistry: asyncLazyObject(async () => (await options.getRuntimeTaskFeatures()).runtimeTaskRegistry), modelRegistry, storageBindings: asyncLazyObject(async () => (await options.getArtifacts()).artifactBindings), storage: asyncLazyObject(async () => (await options.getArtifacts()).storage), generatedModelStorage: asyncLazyObject(async () => createLocalGeneratedModelStorageAdapter({ env: process.env })), modelPublisher, taskPowerLifecycle: asyncLazyObject(async () => (await options.getRuntimeTaskFeatures()).taskPowerLifecycle), runtimeCapabilityGuard: asyncLazyObject(async () => (await options.getRuntimeTaskFeatures()).runtimeCapabilityGuard) }),
    validateModelUseCase: new ValidateModelUseCase({ runtimeTaskRegistry: asyncLazyObject(async () => (await options.getRuntimeTaskFeatures()).runtimeTaskRegistry), modelRegistry, runtimeCapabilityGuard: asyncLazyObject(async () => (await options.getRuntimeTaskFeatures()).runtimeCapabilityGuard) }),
    publishModelUseCase: new PublishModelUseCase({ modelRegistry, runtimeTaskRegistry: asyncLazyObject(async () => (await options.getRuntimeTaskFeatures()).runtimeTaskRegistry), runtimeCapabilityGuard: asyncLazyObject(async () => (await options.getRuntimeTaskFeatures()).runtimeCapabilityGuard) }),
  };
}
