import { registerArtifactUploadIpc, type StoreArtifactUploadUseCasePort } from "./artifact-upload/registerArtifactUploadIpc";
import { registerArtifactBrowserIpc, type RegisterArtifactBrowserIpcDependencies } from "./artifact-browser/registerArtifactBrowserIpc";
import type {
  IpcMainHandlePort,
  IpcSenderTrustPolicy,
} from "./ipcMainHandlePort";
import { lazyProvidedObject, type AsyncFeatureProvider, type LazyProvidedObjectOptions } from "./lazyFeatureProvider";

type HuggingFaceTokenStatus = { configured: boolean; maskedToken?: string };
export interface DesktopArtifactIpcFeature {
  storeArtifactUploadUseCase: StoreArtifactUploadUseCasePort;
  browseArtifactsUseCase: RegisterArtifactBrowserIpcDependencies["browseArtifactsUseCase"];
  browseUnregisteredArtifactsUseCase: RegisterArtifactBrowserIpcDependencies["browseUnregisteredArtifactsUseCase"];
  registerUnregisteredArtifactUseCase: RegisterArtifactBrowserIpcDependencies["registerUnregisteredArtifactUseCase"];
  deleteUnregisteredArtifactUseCase: RegisterArtifactBrowserIpcDependencies["deleteUnregisteredArtifactUseCase"];
  deleteRegisteredArtifactUseCase: RegisterArtifactBrowserIpcDependencies["deleteRegisteredArtifactUseCase"];
  readArtifactDetailUseCase: RegisterArtifactBrowserIpcDependencies["readArtifactDetailUseCase"];
  readArtifactContentUseCase: RegisterArtifactBrowserIpcDependencies["readArtifactContentUseCase"];
  artifactMediaViewRetrieval: RegisterArtifactBrowserIpcDependencies["artifactMediaViewRetrieval"];
}

export interface DesktopArtifactRemoteIpcFeature {
  publishArtifactToRepoUseCase: RegisterArtifactBrowserIpcDependencies["publishArtifactToRepoUseCase"];
  browseHuggingFaceNamespaceDatasetsUseCase: RegisterArtifactBrowserIpcDependencies["browseHuggingFaceNamespaceDatasetsUseCase"];
  browseHuggingFaceDatasetParquetFilesUseCase: RegisterArtifactBrowserIpcDependencies["browseHuggingFaceDatasetParquetFilesUseCase"];
  importHuggingFaceFilesUseCase: RegisterArtifactBrowserIpcDependencies["importHuggingFaceFilesUseCase"];
  verifyPublishedArtifactBackingUseCase: RegisterArtifactBrowserIpcDependencies["verifyPublishedArtifactBackingUseCase"];
  verifyImportedArtifactSourceBackingUseCase: RegisterArtifactBrowserIpcDependencies["verifyImportedArtifactSourceBackingUseCase"];
  registerArtifactFromRepoUseCase: RegisterArtifactBrowserIpcDependencies["registerArtifactFromRepoUseCase"];
  localizeArtifactFromRepoUseCase: RegisterArtifactBrowserIpcDependencies["localizeArtifactFromRepoUseCase"];
}

export interface RegisterDesktopArtifactIpcDependencies {
  ipcMain: IpcMainHandlePort;
  senderTrust: IpcSenderTrustPolicy;
  getArtifactFeature: AsyncFeatureProvider<DesktopArtifactIpcFeature>;
  getArtifactRemoteFeature: AsyncFeatureProvider<DesktopArtifactRemoteIpcFeature>;
  remoteLifecycle?: LazyProvidedObjectOptions;
  tokens: {
    getHuggingFaceTokenStatus: () => HuggingFaceTokenStatus;
    setHuggingFaceToken: (token: string) => HuggingFaceTokenStatus;
    clearHuggingFaceToken: () => HuggingFaceTokenStatus;
  };
}

export function registerDesktopArtifactIpc(dependencies: RegisterDesktopArtifactIpcDependencies): void {
  registerArtifactUploadIpc({ ipcMain: dependencies.ipcMain, senderTrust: dependencies.senderTrust, storeArtifactUploadUseCase: lazyProvidedObject(dependencies.getArtifactFeature, (feature) => feature.storeArtifactUploadUseCase) });
  registerArtifactBrowserIpc({
    ipcMain: dependencies.ipcMain,
    senderTrust: dependencies.senderTrust,
    getHuggingFaceTokenStatus: dependencies.tokens.getHuggingFaceTokenStatus,
    setHuggingFaceToken: dependencies.tokens.setHuggingFaceToken,
    clearHuggingFaceToken: dependencies.tokens.clearHuggingFaceToken,
    browseArtifactsUseCase: lazyProvidedObject(dependencies.getArtifactFeature, (feature) => feature.browseArtifactsUseCase),
    browseUnregisteredArtifactsUseCase: lazyProvidedObject(dependencies.getArtifactFeature, (feature) => feature.browseUnregisteredArtifactsUseCase),
    registerUnregisteredArtifactUseCase: lazyProvidedObject(dependencies.getArtifactFeature, (feature) => feature.registerUnregisteredArtifactUseCase),
    deleteUnregisteredArtifactUseCase: lazyProvidedObject(dependencies.getArtifactFeature, (feature) => feature.deleteUnregisteredArtifactUseCase),
    deleteRegisteredArtifactUseCase: lazyProvidedObject(dependencies.getArtifactFeature, (feature) => feature.deleteRegisteredArtifactUseCase),
    readArtifactDetailUseCase: lazyProvidedObject(dependencies.getArtifactFeature, (feature) => feature.readArtifactDetailUseCase),
    readArtifactContentUseCase: lazyProvidedObject(dependencies.getArtifactFeature, (feature) => feature.readArtifactContentUseCase),
    artifactMediaViewRetrieval: lazyProvidedObject(dependencies.getArtifactFeature, (feature) => feature.artifactMediaViewRetrieval),
    publishArtifactToRepoUseCase: lazyProvidedObject(dependencies.getArtifactRemoteFeature, (feature) => feature.publishArtifactToRepoUseCase, dependencies.remoteLifecycle),
    browseHuggingFaceNamespaceDatasetsUseCase: lazyProvidedObject(dependencies.getArtifactRemoteFeature, (feature) => feature.browseHuggingFaceNamespaceDatasetsUseCase, dependencies.remoteLifecycle),
    browseHuggingFaceDatasetParquetFilesUseCase: lazyProvidedObject(dependencies.getArtifactRemoteFeature, (feature) => feature.browseHuggingFaceDatasetParquetFilesUseCase, dependencies.remoteLifecycle),
    importHuggingFaceFilesUseCase: lazyProvidedObject(dependencies.getArtifactRemoteFeature, (feature) => feature.importHuggingFaceFilesUseCase, dependencies.remoteLifecycle),
    verifyPublishedArtifactBackingUseCase: lazyProvidedObject(dependencies.getArtifactRemoteFeature, (feature) => feature.verifyPublishedArtifactBackingUseCase, dependencies.remoteLifecycle),
    verifyImportedArtifactSourceBackingUseCase: lazyProvidedObject(dependencies.getArtifactRemoteFeature, (feature) => feature.verifyImportedArtifactSourceBackingUseCase, dependencies.remoteLifecycle),
    registerArtifactFromRepoUseCase: lazyProvidedObject(dependencies.getArtifactRemoteFeature, (feature) => feature.registerArtifactFromRepoUseCase, dependencies.remoteLifecycle),
    localizeArtifactFromRepoUseCase: lazyProvidedObject(dependencies.getArtifactRemoteFeature, (feature) => feature.localizeArtifactFromRepoUseCase, dependencies.remoteLifecycle),
  });
}
