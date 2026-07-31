import {
  registerDatasetPreparationIpc,
  type RegisterDatasetPreparationIpcDependencies,
} from "./dataset-preparation/registerDatasetPreparationIpc";
import {
  registerDatasetVersionIpc,
  type RegisterDatasetVersionIpcDependencies,
} from "./dataset-version/registerDatasetVersionIpc";
import type { IpcMainHandlePort } from "./ipcMainHandlePort";
import type { ApplicationRequestContext } from "../../../application/ports";
import {
  lazyProvidedObject,
  type AsyncFeatureProvider,
  type LazyProvidedObjectOptions,
} from "./lazyFeatureProvider";

export type DesktopDatasetPreparationIpcFeature = Omit<
  RegisterDatasetPreparationIpcDependencies,
  "ipcMain" | "getAuthoritativeRequestContext"
> &
  Omit<
    RegisterDatasetVersionIpcDependencies,
    "ipcMain" | "getAuthoritativeRequestContext"
  >;

export interface RegisterDesktopDatasetPreparationIpcDependencies {
  ipcMain: IpcMainHandlePort;
  getDatasetPreparationFeature: AsyncFeatureProvider<DesktopDatasetPreparationIpcFeature>;
  lifecycle?: LazyProvidedObjectOptions;
  getAuthoritativeRequestContext?: () => Pick<
    ApplicationRequestContext,
    "organizationId" | "principalId"
  >;
}

export function registerDesktopDatasetPreparationIpc(
  dependencies: RegisterDesktopDatasetPreparationIpcDependencies,
): void {
  registerDatasetPreparationIpc({
    ipcMain: dependencies.ipcMain,
    prepareTrainingDatasetUseCase: lazyProvidedObject(
      dependencies.getDatasetPreparationFeature,
      (feature) => feature.prepareTrainingDatasetUseCase,
      dependencies.lifecycle,
    ),
    getAuthoritativeRequestContext: dependencies.getAuthoritativeRequestContext,
  });
  registerDatasetVersionIpc({
    ipcMain: dependencies.ipcMain,
    listDatasetVersionsUseCase: lazyProvidedObject(
      dependencies.getDatasetPreparationFeature,
      (feature) => feature.listDatasetVersionsUseCase,
      dependencies.lifecycle,
    ),
    compareDatasetVersionsUseCase: lazyProvidedObject(
      dependencies.getDatasetPreparationFeature,
      (feature) => feature.compareDatasetVersionsUseCase,
      dependencies.lifecycle,
    ),
    readDatasetVersionReproductionUseCase: lazyProvidedObject(
      dependencies.getDatasetPreparationFeature,
      (feature) => feature.readDatasetVersionReproductionUseCase,
      dependencies.lifecycle,
    ),
    publishDatasetVersionUseCase: lazyProvidedObject(
      dependencies.getDatasetPreparationFeature,
      (feature) => feature.publishDatasetVersionUseCase,
      dependencies.lifecycle,
    ),
    listDatasetReviewTargetsUseCase: lazyProvidedObject(
      dependencies.getDatasetPreparationFeature,
      (feature) => feature.listDatasetReviewTargetsUseCase,
      dependencies.lifecycle,
    ),
    readDatasetReviewPageUseCase: lazyProvidedObject(
      dependencies.getDatasetPreparationFeature,
      (feature) => feature.readDatasetReviewPageUseCase,
      dependencies.lifecycle,
    ),
    rejectDatasetReviewRowUseCase: lazyProvidedObject(
      dependencies.getDatasetPreparationFeature,
      (feature) => feature.rejectDatasetReviewRowUseCase,
      dependencies.lifecycle,
    ),
    editDatasetReviewRowUseCase: lazyProvidedObject(
      dependencies.getDatasetPreparationFeature,
      (feature) => feature.editDatasetReviewRowUseCase,
      dependencies.lifecycle,
    ),
    getAuthoritativeRequestContext: dependencies.getAuthoritativeRequestContext,
  });
}
