import { registerWebsiteIngestionIpc, type RegisterWebsiteIngestionIpcDependencies } from "./website-ingestion/registerWebsiteIngestionIpc";
import { registerIngestionTaskIpc, type RegisterIngestionTaskIpcDependencies } from "./ingestion-task/registerIngestionTaskIpc";
import type { IpcMainHandlePort, IpcSenderTrustPolicy } from "./ipcMainHandlePort";
import { lazyProvidedObject, type AsyncFeatureProvider, type LazyProvidedObjectOptions } from "./lazyFeatureProvider";

export type DesktopIngestionIpcFeature = Omit<RegisterWebsiteIngestionIpcDependencies, "ipcMain"> & Pick<RegisterIngestionTaskIpcDependencies, "ingestionTasks">;

export interface RegisterDesktopIngestionIpcDependencies {
  ipcMain: IpcMainHandlePort;
  senderTrust: IpcSenderTrustPolicy;
  getIngestionFeature: AsyncFeatureProvider<DesktopIngestionIpcFeature>;
  lifecycle?: LazyProvidedObjectOptions;
}

export function registerDesktopIngestionIpc(dependencies: RegisterDesktopIngestionIpcDependencies): void {
  registerIngestionTaskIpc({
    ipcMain: dependencies.ipcMain,
    senderTrust: dependencies.senderTrust,
    ingestionTasks: lazyProvidedObject(dependencies.getIngestionFeature, (feature) => feature.ingestionTasks, dependencies.lifecycle),
  });
  registerWebsiteIngestionIpc({
    ipcMain: dependencies.ipcMain,
    ingestWebsitePageUseCase: lazyProvidedObject(dependencies.getIngestionFeature, (feature) => feature.ingestWebsitePageUseCase, dependencies.lifecycle),
    ingestWebsitePagesBatchUseCase: lazyProvidedObject(dependencies.getIngestionFeature, (feature) => feature.ingestWebsitePagesBatchUseCase, dependencies.lifecycle),
  });
}
