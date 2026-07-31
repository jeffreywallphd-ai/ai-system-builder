import { registerAssetRegistryIpc, type RegisterAssetRegistryIpcDependencies } from "./asset-registry/registerAssetRegistryIpc";
import { registerAssetMutationIpc, type RegisterAssetMutationIpcDependencies } from "./asset-registry/registerAssetMutationIpc";
import type { IpcMainHandlePort } from "./ipcMainHandlePort";
import { lazyProvidedObject, type AsyncFeatureProvider } from "./lazyFeatureProvider";

export interface DesktopAssetIpcFeature {
  assetRegistryRead: RegisterAssetRegistryIpcDependencies["assetRegistryRead"];
  assetMutationUseCases: Pick<RegisterAssetMutationIpcDependencies, "registerResourceBackedViewAsAsset" | "finalizeGeneratedOutputAsAsset" | "importExternalRepositoryObjectAsAsset" | "localizeExternalRepositoryObjectAsAsset">;
}

export interface RegisterDesktopAssetIpcDependencies {
  ipcMain: IpcMainHandlePort;
  getAssetFeature: AsyncFeatureProvider<DesktopAssetIpcFeature>;
}

export function registerDesktopAssetIpc(dependencies: RegisterDesktopAssetIpcDependencies): void {
  registerAssetRegistryIpc({ ipcMain: dependencies.ipcMain, assetRegistryRead: lazyProvidedObject(dependencies.getAssetFeature, (feature) => feature.assetRegistryRead) });
  registerAssetMutationIpc({
    ipcMain: dependencies.ipcMain,
    registerResourceBackedViewAsAsset: lazyProvidedObject(dependencies.getAssetFeature, (feature) => feature.assetMutationUseCases.registerResourceBackedViewAsAsset),
    finalizeGeneratedOutputAsAsset: lazyProvidedObject(dependencies.getAssetFeature, (feature) => feature.assetMutationUseCases.finalizeGeneratedOutputAsAsset),
    importExternalRepositoryObjectAsAsset: lazyProvidedObject(dependencies.getAssetFeature, (feature) => feature.assetMutationUseCases.importExternalRepositoryObjectAsAsset),
    localizeExternalRepositoryObjectAsAsset: lazyProvidedObject(dependencies.getAssetFeature, (feature) => feature.assetMutationUseCases.localizeExternalRepositoryObjectAsAsset),
  });
}
