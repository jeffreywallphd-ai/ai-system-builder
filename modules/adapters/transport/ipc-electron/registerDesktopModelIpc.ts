import { registerModelManagementIpc, type RegisterModelManagementIpcDependencies } from "./model/registerModelManagementIpc";
import type { IpcMainHandlePort } from "./ipcMainHandlePort";
import { lazyProvidedObject, type AsyncFeatureProvider } from "./lazyFeatureProvider";

export type DesktopModelIpcFeature = Omit<RegisterModelManagementIpcDependencies, "ipcMain">;

export interface RegisterDesktopModelIpcDependencies {
  ipcMain: IpcMainHandlePort;
  getModelFeature: AsyncFeatureProvider<DesktopModelIpcFeature>;
  reportOperationFailure?: (
    operation: string,
    error: unknown,
  ) => void | Promise<void>;
}

export function registerDesktopModelIpc(dependencies: RegisterDesktopModelIpcDependencies): void {
  registerModelManagementIpc({
    ipcMain: dependencies.ipcMain,
    reportOperationFailure: dependencies.reportOperationFailure,
    browseModelsUseCase: lazyProvidedObject(dependencies.getModelFeature, (feature) => feature.browseModelsUseCase),
    getModelDetailsUseCase: lazyProvidedObject(dependencies.getModelFeature, (feature) => feature.getModelDetailsUseCase),
    listModelsUseCase: lazyProvidedObject(dependencies.getModelFeature, (feature) => feature.listModelsUseCase),
    saveModelReferenceUseCase: lazyProvidedObject(dependencies.getModelFeature, (feature) => feature.saveModelReferenceUseCase),
    downloadModelUseCase: lazyProvidedObject(dependencies.getModelFeature, (feature) => feature.downloadModelUseCase),
    modelDownloadTasksUseCase: lazyProvidedObject(dependencies.getModelFeature, (feature) => feature.modelDownloadTasksUseCase!),
    updateModelRecordUseCase: lazyProvidedObject(dependencies.getModelFeature, (feature) => feature.updateModelRecordUseCase),
    deleteModelRecordUseCase: lazyProvidedObject(dependencies.getModelFeature, (feature) => feature.deleteModelRecordUseCase),
    revealModelInFolderUseCase: lazyProvidedObject(dependencies.getModelFeature, (feature) => feature.revealModelInFolderUseCase),
    trainModelUseCase: lazyProvidedObject(dependencies.getModelFeature, (feature) => feature.trainModelUseCase),
    validateModelUseCase: lazyProvidedObject(dependencies.getModelFeature, (feature) => feature.validateModelUseCase),
    publishModelUseCase: lazyProvidedObject(dependencies.getModelFeature, (feature) => feature.publishModelUseCase),
  });
}
