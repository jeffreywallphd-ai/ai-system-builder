import {
  registerArtifactUploadIpc,
  type RegisterArtifactUploadIpcDependencies,
} from "./artifact-upload/registerArtifactUploadIpc";
import type { IpcMainHandlePort } from "./ipcMainHandlePort";
import {
  registerArtifactBrowserIpc,
  type RegisterArtifactBrowserIpcDependencies,
} from "./artifact-browser/registerArtifactBrowserIpc";
import {
  registerWebsiteIngestionIpc,
  type RegisterWebsiteIngestionIpcDependencies,
} from "./website-ingestion/registerWebsiteIngestionIpc";
import {
  registerDatasetPreparationIpc,
  type RegisterDatasetPreparationIpcDependencies,
} from "./dataset-preparation/registerDatasetPreparationIpc";
import {
  registerPythonRuntimeIpc,
  type PythonRuntimeControlPort,
} from "./python-runtime/registerPythonRuntimeIpc";
import {
  registerApplicationSettingsIpc,
  type RegisterApplicationSettingsIpcDependencies,
} from "./settings/registerApplicationSettingsIpc";
import {
  registerModelManagementIpc,
  type RegisterModelManagementIpcDependencies,
} from "./model/registerModelManagementIpc";
import { registerImageGenerationIpc, type RegisterImageGenerationIpcDependencies } from "./image-generation/registerImageGenerationIpc";
import { registerComfyUiRuntimeIpc } from "./comfyui-runtime/registerComfyUiRuntimeIpc";
import type { RuntimeInstallerPort } from "../../../application/ports/runtime-installer/runtime-installer.port";

export interface RegisterElectronIpcDependencies {
  ipcMain: IpcMainHandlePort;
  pythonRuntime: PythonRuntimeControlPort;
  getHuggingFaceTokenStatus: RegisterArtifactBrowserIpcDependencies["getHuggingFaceTokenStatus"];
  setHuggingFaceToken: RegisterArtifactBrowserIpcDependencies["setHuggingFaceToken"];
  clearHuggingFaceToken: RegisterArtifactBrowserIpcDependencies["clearHuggingFaceToken"];
  storeArtifactUploadUseCase: RegisterArtifactUploadIpcDependencies["storeArtifactUploadUseCase"];
  browseArtifactsUseCase: RegisterArtifactBrowserIpcDependencies["browseArtifactsUseCase"];
  browseUnregisteredArtifactsUseCase: RegisterArtifactBrowserIpcDependencies["browseUnregisteredArtifactsUseCase"];
  registerUnregisteredArtifactUseCase: RegisterArtifactBrowserIpcDependencies["registerUnregisteredArtifactUseCase"];
  deleteUnregisteredArtifactUseCase: RegisterArtifactBrowserIpcDependencies["deleteUnregisteredArtifactUseCase"];
  deleteRegisteredArtifactUseCase: RegisterArtifactBrowserIpcDependencies["deleteRegisteredArtifactUseCase"];
  readArtifactDetailUseCase: RegisterArtifactBrowserIpcDependencies["readArtifactDetailUseCase"];
  readArtifactContentUseCase: RegisterArtifactBrowserIpcDependencies["readArtifactContentUseCase"];
  artifactMediaViewRetrieval: RegisterArtifactBrowserIpcDependencies["artifactMediaViewRetrieval"];
  publishArtifactToRepoUseCase: RegisterArtifactBrowserIpcDependencies["publishArtifactToRepoUseCase"];
  browseHuggingFaceNamespaceDatasetsUseCase: RegisterArtifactBrowserIpcDependencies["browseHuggingFaceNamespaceDatasetsUseCase"];
  browseHuggingFaceDatasetParquetFilesUseCase: RegisterArtifactBrowserIpcDependencies["browseHuggingFaceDatasetParquetFilesUseCase"];
  verifyPublishedArtifactBackingUseCase: RegisterArtifactBrowserIpcDependencies["verifyPublishedArtifactBackingUseCase"];
  verifyImportedArtifactSourceBackingUseCase: RegisterArtifactBrowserIpcDependencies["verifyImportedArtifactSourceBackingUseCase"];
  registerArtifactFromRepoUseCase: RegisterArtifactBrowserIpcDependencies["registerArtifactFromRepoUseCase"];
  localizeArtifactFromRepoUseCase: RegisterArtifactBrowserIpcDependencies["localizeArtifactFromRepoUseCase"];
  ingestWebsitePageUseCase: RegisterWebsiteIngestionIpcDependencies["ingestWebsitePageUseCase"];
  ingestWebsitePagesBatchUseCase: RegisterWebsiteIngestionIpcDependencies["ingestWebsitePagesBatchUseCase"];
  prepareTrainingDatasetUseCase: RegisterDatasetPreparationIpcDependencies["prepareTrainingDatasetUseCase"];
  listSettingsDefinitionsUseCase: RegisterApplicationSettingsIpcDependencies["listSettingsDefinitionsUseCase"];
  readSettingsUseCase: RegisterApplicationSettingsIpcDependencies["readSettingsUseCase"];
  updateSettingUseCase: RegisterApplicationSettingsIpcDependencies["updateSettingUseCase"];
  clearSettingUseCase: RegisterApplicationSettingsIpcDependencies["clearSettingUseCase"];
  resolveModelDefaultUseCase: RegisterApplicationSettingsIpcDependencies["resolveModelDefaultUseCase"];
  browseModelsUseCase: RegisterModelManagementIpcDependencies["browseModelsUseCase"];
  getModelDetailsUseCase: RegisterModelManagementIpcDependencies["getModelDetailsUseCase"];
  listModelsUseCase: RegisterModelManagementIpcDependencies["listModelsUseCase"];
  saveModelReferenceUseCase: RegisterModelManagementIpcDependencies["saveModelReferenceUseCase"];
  downloadModelUseCase: RegisterModelManagementIpcDependencies["downloadModelUseCase"];
  updateModelRecordUseCase: RegisterModelManagementIpcDependencies["updateModelRecordUseCase"];
  deleteModelRecordUseCase: RegisterModelManagementIpcDependencies["deleteModelRecordUseCase"];
  trainModelUseCase: RegisterModelManagementIpcDependencies["trainModelUseCase"];
  validateModelUseCase: RegisterModelManagementIpcDependencies["validateModelUseCase"];
  publishModelUseCase: RegisterModelManagementIpcDependencies["publishModelUseCase"];
  generateImageUseCase: RegisterImageGenerationIpcDependencies["generateImageUseCase"];
  imageGenerationFinalizationOrchestrator?: RegisterImageGenerationIpcDependencies["imageGenerationFinalizationOrchestrator"];
  comfyUiInstaller: RuntimeInstallerPort;
  comfyUiInstallRoot: string;
}

export function registerElectronIpc(
  dependencies: RegisterElectronIpcDependencies,
): void {
  registerArtifactUploadIpc({
    ipcMain: dependencies.ipcMain,
    storeArtifactUploadUseCase: dependencies.storeArtifactUploadUseCase,
  });

  registerArtifactBrowserIpc({
    ipcMain: dependencies.ipcMain,
    getHuggingFaceTokenStatus: dependencies.getHuggingFaceTokenStatus,
    setHuggingFaceToken: dependencies.setHuggingFaceToken,
    clearHuggingFaceToken: dependencies.clearHuggingFaceToken,
    browseArtifactsUseCase: dependencies.browseArtifactsUseCase,
    browseUnregisteredArtifactsUseCase: dependencies.browseUnregisteredArtifactsUseCase,
    registerUnregisteredArtifactUseCase: dependencies.registerUnregisteredArtifactUseCase,
    deleteUnregisteredArtifactUseCase: dependencies.deleteUnregisteredArtifactUseCase,
    deleteRegisteredArtifactUseCase: dependencies.deleteRegisteredArtifactUseCase,
    readArtifactDetailUseCase: dependencies.readArtifactDetailUseCase,
    readArtifactContentUseCase: dependencies.readArtifactContentUseCase,
    artifactMediaViewRetrieval: dependencies.artifactMediaViewRetrieval,
    publishArtifactToRepoUseCase: dependencies.publishArtifactToRepoUseCase,
    browseHuggingFaceNamespaceDatasetsUseCase: dependencies.browseHuggingFaceNamespaceDatasetsUseCase,
    browseHuggingFaceDatasetParquetFilesUseCase: dependencies.browseHuggingFaceDatasetParquetFilesUseCase,
    verifyPublishedArtifactBackingUseCase: dependencies.verifyPublishedArtifactBackingUseCase,
    verifyImportedArtifactSourceBackingUseCase: dependencies.verifyImportedArtifactSourceBackingUseCase,
    registerArtifactFromRepoUseCase: dependencies.registerArtifactFromRepoUseCase,
    localizeArtifactFromRepoUseCase: dependencies.localizeArtifactFromRepoUseCase,
  });

  registerWebsiteIngestionIpc({
    ipcMain: dependencies.ipcMain,
    ingestWebsitePageUseCase: dependencies.ingestWebsitePageUseCase,
    ingestWebsitePagesBatchUseCase: dependencies.ingestWebsitePagesBatchUseCase,
  });

  registerDatasetPreparationIpc({
    ipcMain: dependencies.ipcMain,
    prepareTrainingDatasetUseCase: dependencies.prepareTrainingDatasetUseCase,
  });

  registerApplicationSettingsIpc({
    ipcMain: dependencies.ipcMain,
    listSettingsDefinitionsUseCase: dependencies.listSettingsDefinitionsUseCase,
    readSettingsUseCase: dependencies.readSettingsUseCase,
    updateSettingUseCase: dependencies.updateSettingUseCase,
    clearSettingUseCase: dependencies.clearSettingUseCase,
    resolveModelDefaultUseCase: dependencies.resolveModelDefaultUseCase,
  });
  registerModelManagementIpc({
    ipcMain: dependencies.ipcMain,
    browseModelsUseCase: dependencies.browseModelsUseCase,
    getModelDetailsUseCase: dependencies.getModelDetailsUseCase,
    listModelsUseCase: dependencies.listModelsUseCase,
    saveModelReferenceUseCase: dependencies.saveModelReferenceUseCase,
    downloadModelUseCase: dependencies.downloadModelUseCase,
    updateModelRecordUseCase: dependencies.updateModelRecordUseCase,
    deleteModelRecordUseCase: dependencies.deleteModelRecordUseCase,
    trainModelUseCase: dependencies.trainModelUseCase,
    validateModelUseCase: dependencies.validateModelUseCase,
    publishModelUseCase: dependencies.publishModelUseCase,
  });

  registerImageGenerationIpc({
    ipcMain: dependencies.ipcMain,
    generateImageUseCase: dependencies.generateImageUseCase,
    imageGenerationFinalizationOrchestrator: dependencies.imageGenerationFinalizationOrchestrator,
  });

  registerComfyUiRuntimeIpc({
    ipcMain: dependencies.ipcMain,
    installer: dependencies.comfyUiInstaller,
    installRoot: dependencies.comfyUiInstallRoot,
  });

  registerPythonRuntimeIpc({
    ipcMain: dependencies.ipcMain,
    startPythonRuntime: dependencies.pythonRuntime.startPythonRuntime,
    stopPythonRuntime: dependencies.pythonRuntime.stopPythonRuntime,
    restartPythonRuntime: dependencies.pythonRuntime.restartPythonRuntime,
    unloadPythonRuntimeModel: dependencies.pythonRuntime.unloadPythonRuntimeModel,
    clearPythonRuntimeLogs: dependencies.pythonRuntime.clearPythonRuntimeLogs,
    readPythonRuntimeStatus: dependencies.pythonRuntime.readPythonRuntimeStatus,
  });
}
