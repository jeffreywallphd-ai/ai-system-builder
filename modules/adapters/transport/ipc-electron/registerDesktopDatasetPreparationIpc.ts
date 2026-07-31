import { registerDatasetPreparationIpc, type RegisterDatasetPreparationIpcDependencies } from "./dataset-preparation/registerDatasetPreparationIpc";
import { registerDatasetVersionIpc, type RegisterDatasetVersionIpcDependencies } from "./dataset-version/registerDatasetVersionIpc";
import type { IpcMainHandlePort } from "./ipcMainHandlePort";
import { lazyProvidedObject, type AsyncFeatureProvider, type LazyProvidedObjectOptions } from "./lazyFeatureProvider";

export type DesktopDatasetPreparationIpcFeature = Omit<RegisterDatasetPreparationIpcDependencies, "ipcMain"> & Omit<RegisterDatasetVersionIpcDependencies, "ipcMain">;

export interface RegisterDesktopDatasetPreparationIpcDependencies {
  ipcMain: IpcMainHandlePort;
  getDatasetPreparationFeature: AsyncFeatureProvider<DesktopDatasetPreparationIpcFeature>;
  lifecycle?: LazyProvidedObjectOptions;
}

export function registerDesktopDatasetPreparationIpc(dependencies: RegisterDesktopDatasetPreparationIpcDependencies): void {
  registerDatasetPreparationIpc({
    ipcMain: dependencies.ipcMain,
    prepareTrainingDatasetUseCase: lazyProvidedObject(dependencies.getDatasetPreparationFeature, (feature) => feature.prepareTrainingDatasetUseCase, dependencies.lifecycle),
  });
  registerDatasetVersionIpc({
    ipcMain: dependencies.ipcMain,
    listDatasetVersionsUseCase: lazyProvidedObject(dependencies.getDatasetPreparationFeature, (feature) => feature.listDatasetVersionsUseCase, dependencies.lifecycle),
    compareDatasetVersionsUseCase: lazyProvidedObject(dependencies.getDatasetPreparationFeature, (feature) => feature.compareDatasetVersionsUseCase, dependencies.lifecycle),
    readDatasetVersionReproductionUseCase: lazyProvidedObject(dependencies.getDatasetPreparationFeature, (feature) => feature.readDatasetVersionReproductionUseCase, dependencies.lifecycle),
    publishDatasetVersionUseCase: lazyProvidedObject(dependencies.getDatasetPreparationFeature, (feature) => feature.publishDatasetVersionUseCase, dependencies.lifecycle),
  });
}
