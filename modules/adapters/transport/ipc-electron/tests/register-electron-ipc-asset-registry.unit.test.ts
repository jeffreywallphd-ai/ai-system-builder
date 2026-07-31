import { describe, expect, it, testDouble } from "../../../../testing/node-test";

import {
  DESKTOP_ASSET_DEFINITIONS_LIST_REQUEST_CHANNEL,
  DESKTOP_ASSET_DEFINITION_READ_REQUEST_CHANNEL,
  DESKTOP_ASSET_DEFINITION_VERSION_READ_REQUEST_CHANNEL,
  DESKTOP_ASSET_REGISTER_RESOURCE_BACKED_VIEW_REQUEST_CHANNEL,
  DESKTOP_RUNTIME_READINESS_READ_REQUEST_CHANNEL,
} from "../../../../contracts/ipc";
import { registerElectronIpc, type RegisterElectronIpcDependencies } from "../registerElectronIpc";

function createDependencies(overrides: Partial<RegisterElectronIpcDependencies> = {}): RegisterElectronIpcDependencies {
  const execute = testDouble.fn(async () => ({ ok: true, value: {} }));
  const readRuntimeStatus = testDouble.fn(async () => ({ supervisorStatus: "stopped", healthy: false, runtimeStatus: "unavailable", capabilities: [], loadedModels: [], activeTaskCount: 0, systemResources: { memoryUsagePercent: 0, cpuUsagePercent: 0, gpuUsagePercent: 0 }, logs: [] }));
  const ipcMain = { handle: testDouble.fn() };
  const getArtifactFeature = testDouble.fn(async () => ({
    storeArtifactUploadUseCase: { execute, getAcceptedUploadPolicy: testDouble.fn(() => ({ acceptedMediaTypes: [], acceptedExtensions: [] })) },
    browseArtifactsUseCase: { execute },
    browseUnregisteredArtifactsUseCase: { execute },
    registerUnregisteredArtifactUseCase: { execute },
    deleteUnregisteredArtifactUseCase: { execute },
    deleteRegisteredArtifactUseCase: { execute },
    readArtifactDetailUseCase: { execute },
    readArtifactContentUseCase: { execute },
    artifactMediaViewRetrieval: { retrieveArtifactViewerMediaByStorageKey: testDouble.fn() },
  }));
  const getArtifactRemoteFeature = testDouble.fn(async () => ({
    publishArtifactToRepoUseCase: { execute },
    browseHuggingFaceNamespaceDatasetsUseCase: { execute },
    browseHuggingFaceDatasetParquetFilesUseCase: { execute },
    importHuggingFaceFilesUseCase: { execute },
    verifyPublishedArtifactBackingUseCase: { execute },
    verifyImportedArtifactSourceBackingUseCase: { execute },
    registerArtifactFromRepoUseCase: { execute },
    localizeArtifactFromRepoUseCase: { execute },
  }));
  const getAssetFeature = testDouble.fn(async () => ({
    assetRegistryRead: {
      listDefinitionCards: testDouble.fn(),
      readDefinitionDetail: testDouble.fn(),
    },
    assetMutationUseCases: {
      registerResourceBackedViewAsAsset: { execute },
      finalizeGeneratedOutputAsAsset: { execute },
      importExternalRepositoryObjectAsAsset: { execute },
      localizeExternalRepositoryObjectAsAsset: { execute },
    },
  }));
  return {
    startup: {
      ipcMain,
      pythonRuntime: {
        startPythonRuntime: testDouble.fn(),
        stopPythonRuntime: testDouble.fn(),
        restartPythonRuntime: testDouble.fn(),
        unloadPythonRuntimeModel: testDouble.fn(),
        clearPythonRuntimeLogs: testDouble.fn(),
        readPythonRuntimeStatus: readRuntimeStatus,
      },
      runtimeReadiness: {
        getReadinessSnapshot: testDouble.fn(async () => ({ checkedAt: new Date(0).toISOString(), overallStatus: "unavailable", capabilities: [] })),
        getCapabilityStatus: testDouble.fn(async () => ({ capability: "image-generation", status: "unavailable", checkedAt: new Date(0).toISOString() })),
      },
      settingsUseCases: {
        listSettingsDefinitionsUseCase: { execute },
        readSettingsUseCase: { execute },
        updateSettingUseCase: { execute },
        clearSettingUseCase: { execute },
        resolveModelDefaultUseCase: { execute },
      },
    },
    artifact: {
      ipcMain,
      tokens: { getHuggingFaceTokenStatus: testDouble.fn(), setHuggingFaceToken: testDouble.fn(), clearHuggingFaceToken: testDouble.fn() },
      getArtifactFeature,
      getArtifactRemoteFeature,
    },
    asset: { ipcMain, getAssetFeature },
    model: { ipcMain, getModelFeature: testDouble.fn(async () => ({ browseModelsUseCase: { execute }, getModelDetailsUseCase: { execute }, listModelsUseCase: { execute }, saveModelReferenceUseCase: { execute }, downloadModelUseCase: { execute }, updateModelRecordUseCase: { execute }, deleteModelRecordUseCase: { execute }, trainModelUseCase: { execute, readStatus: execute }, validateModelUseCase: { execute }, publishModelUseCase: { execute } })) },
    imageGeneration: { ipcMain, getImageGenerationFeature: testDouble.fn(async () => ({ generateImageUseCase: { startImageGeneration: execute, readImageGeneration: execute, cancelImageGeneration: execute }, imageGenerationFinalizationOrchestrator: { finalizeIfCompleted: execute } })) },
    runtime: { ipcMain, getComfyUiFeature: testDouble.fn(async () => ({ installer: { ensureInstalled: testDouble.fn(), getInstallStatus: testDouble.fn(), repairInstall: testDouble.fn() }, installRoot: "/runtime/comfyui" })) },
    ingestion: { ipcMain, getIngestionFeature: testDouble.fn(async () => ({ ingestWebsitePageUseCase: { execute }, ingestWebsitePagesBatchUseCase: { execute } })) },
    datasetPreparation: { ipcMain, getDatasetPreparationFeature: testDouble.fn(async () => ({ prepareTrainingDatasetUseCase: { startPrepareTrainingDataset: execute, readPrepareTrainingDataset: execute, cancelPrepareTrainingDataset: execute } })) },
    ...overrides,
  } as RegisterElectronIpcDependencies;
}

describe("registerElectronIpc feature-group asset wiring", () => {
  it("registers asset registry and mutation channels through the explicit asset group without resolving the asset provider", () => {
    const channels: string[] = [];
    const dependencies = createDependencies();
    const ipcMain = { handle: testDouble.fn((channel: string) => channels.push(channel)) };
    dependencies.startup.ipcMain = ipcMain;
    dependencies.artifact.ipcMain = ipcMain;
    dependencies.asset.ipcMain = ipcMain;
    dependencies.model.ipcMain = ipcMain;
    dependencies.imageGeneration.ipcMain = ipcMain;
    dependencies.runtime.ipcMain = ipcMain;
    dependencies.ingestion.ipcMain = ipcMain;
    dependencies.datasetPreparation.ipcMain = ipcMain;

    registerElectronIpc(dependencies);

    expect(channels).toContain(DESKTOP_RUNTIME_READINESS_READ_REQUEST_CHANNEL.value);
    expect(channels).toContain(DESKTOP_ASSET_DEFINITIONS_LIST_REQUEST_CHANNEL.value);
    expect(channels).toContain(DESKTOP_ASSET_DEFINITION_READ_REQUEST_CHANNEL.value);
    expect(channels).toContain(DESKTOP_ASSET_DEFINITION_VERSION_READ_REQUEST_CHANNEL.value);
    expect(channels).toContain(DESKTOP_ASSET_REGISTER_RESOURCE_BACKED_VIEW_REQUEST_CHANNEL.value);
    expect(dependencies.asset.getAssetFeature).not.toHaveBeenCalled();
    expect(/asset\.(?:create|update|delete|patch|edit|seed|publish|scan|execute|run)/i.test(channels.join(" "))).toBe(false);
  });

  it("records explicit feature-group registration milestones", () => {
    const milestones: string[] = [];
    registerElectronIpc(createDependencies({ recordMilestone: (milestone) => milestones.push(milestone) }));

    expect(milestones).toEqual([
      "desktop.host.ipc.startup-group.register.before",
      "desktop.host.ipc.startup-group.register.after",
      "desktop.host.ipc.artifact-group.register.before",
      "desktop.host.ipc.artifact-group.register.after",
      "desktop.host.ipc.asset-group.register.before",
      "desktop.host.ipc.asset-group.register.after",
      "desktop.host.ipc.model-group.register.before",
      "desktop.host.ipc.model-group.register.after",
      "desktop.host.ipc.image-generation-group.register.before",
      "desktop.host.ipc.image-generation-group.register.after",
      "desktop.host.ipc.runtime-group.register.before",
      "desktop.host.ipc.runtime-group.register.after",
      "desktop.host.ipc.ingestion-group.register.before",
      "desktop.host.ipc.ingestion-group.register.after",
      "desktop.host.ipc.dataset-preparation-group.register.before",
      "desktop.host.ipc.dataset-preparation-group.register.after",
    ]);
  });
});
