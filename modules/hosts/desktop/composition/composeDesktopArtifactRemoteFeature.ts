import type { LoggingPort } from "../../../application/ports/logging";
import type { WorkspaceOperationAuthorizationPort } from "../../../application/ports/security";
import { SystemArtifactIdFactory } from "../../../domain/artifact";
import {
  BrowseHuggingFaceDatasetParquetFilesUseCase,
  BrowseHuggingFaceNamespaceDatasetsUseCase,
  ImportHuggingFaceFilesUseCase,
  LocalizeArtifactFromRepoUseCase,
  PublishArtifactToRepoUseCase,
  RegisterArtifactFromRepoUseCase,
  VerifyImportedArtifactSourceBackingUseCase,
  VerifyPublishedArtifactBackingUseCase,
} from "../../../application/use-cases";
import { createArtifactRepoStorageAdapter } from "../../../adapters/storage/artifact-repo";
import { createHuggingFaceArtifactRepoStorageAdapter, type HuggingFaceFetchImplementation } from "../../../adapters/storage/huggingface";

export interface ComposeDesktopArtifactRemoteFeatureOptions {
  artifacts: any;
  workspaceShell: any;
  workspaceAuthorization?: WorkspaceOperationAuthorizationPort;
  loggingPort: LoggingPort;
  now?: () => string;
  tokenProvider: () => string | undefined;
  huggingFaceFetchImplementation?: HuggingFaceFetchImplementation;
}

export function composeDesktopArtifactRemoteFeature(options: ComposeDesktopArtifactRemoteFeatureOptions): any {
  let disposed = false;
  const huggingFaceArtifactRepoStorage = createHuggingFaceArtifactRepoStorageAdapter({
    accessTokenProvider: options.tokenProvider,
    fetchImplementation: options.huggingFaceFetchImplementation,
  });
  const artifactRepoStorage = createArtifactRepoStorageAdapter({ providers: [{ provider: "huggingface", adapter: huggingFaceArtifactRepoStorage }] });
  const foundation = options.artifacts;
  const browseHuggingFaceDatasetParquetFilesUseCase = new BrowseHuggingFaceDatasetParquetFilesUseCase({ repoBrowser: huggingFaceArtifactRepoStorage, logging: options.loggingPort, now: options.now });
  const registerArtifactFromRepoUseCase = new RegisterArtifactFromRepoUseCase({ artifactRepoStorage, artifactBindingStorage: foundation.artifactBindings, artifactCatalogAppend: foundation.artifactCatalog, logging: options.loggingPort, now: options.now, artifactIdFactory: new SystemArtifactIdFactory() });
  return {
    dispose() { disposed = true; },
    get disposed() { return disposed; },
    huggingFaceArtifactRepoStorage,
    artifactRepoStorage,
    publishArtifactToRepoUseCase: new PublishArtifactToRepoUseCase({ artifactStorage: foundation.storage, artifactCatalogRead: foundation.artifactCatalog, artifactRepoStorage, artifactBindingStorage: foundation.artifactBindings, workspaceRepository: options.workspaceShell.workspaceRepository, workspaceAuthorization: options.workspaceAuthorization, now: options.now }),
    browseHuggingFaceNamespaceDatasetsUseCase: new BrowseHuggingFaceNamespaceDatasetsUseCase({ repoBrowser: huggingFaceArtifactRepoStorage, logging: options.loggingPort, now: options.now }),
    browseHuggingFaceDatasetParquetFilesUseCase,
    importHuggingFaceFilesUseCase: new ImportHuggingFaceFilesUseCase({ browseFiles: browseHuggingFaceDatasetParquetFilesUseCase, registerArtifact: registerArtifactFromRepoUseCase, logging: options.loggingPort, now: options.now }),
    verifyPublishedArtifactBackingUseCase: new VerifyPublishedArtifactBackingUseCase({ artifactRepoStorage, artifactBindingStorage: foundation.artifactBindings, now: options.now }),
    verifyImportedArtifactSourceBackingUseCase: new VerifyImportedArtifactSourceBackingUseCase({ artifactRepoStorage, artifactBindingStorage: foundation.artifactBindings, now: options.now }),
    registerArtifactFromRepoUseCase,
    localizeArtifactFromRepoUseCase: new LocalizeArtifactFromRepoUseCase({ artifactRepoStorage, artifactBindingStorage: foundation.artifactBindings, artifactStorage: foundation.storage, now: options.now }),
  };
}
