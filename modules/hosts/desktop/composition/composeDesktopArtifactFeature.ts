import type { LoggingPort } from "../../../application/ports/logging";
import type { WorkspaceOperationAuthorizationPort } from "../../../application/ports/security";
import {
  BrowseArtifactsUseCase,
  BrowseUnregisteredArtifactsUseCase,
  DeleteRegisteredArtifactUseCase,
  DeleteUnregisteredArtifactUseCase,
  ReadArtifactContentUseCase,
  ReadArtifactDetailUseCase,
  RegisterUnregisteredArtifactUseCase,
  StoreArtifactUploadUseCase,
} from "../../../application/use-cases";
import {
  createFilesystemArtifactBrowserReadAdapter,
  createFilesystemArtifactContentRetrievalAdapter,
  createFilesystemArtifactObjectStorageAdapter,
  createLocalArtifactCatalogPersistenceAdapter,
  createLocalArtifactStorageBindingAdapter,
} from "../../../adapters/storage/filesystem";
import type { StructuredDocumentStore } from "../../../adapters/persistence/shared";

export interface ComposeDesktopArtifactFeatureOptions {
  storageRootDirectory: string;
  loggingPort: LoggingPort;
  now?: () => string;
  workspaceShell: any;
  workspaceAuthorization?: WorkspaceOperationAuthorizationPort;
  documents?: StructuredDocumentStore;
}

export function composeDesktopArtifactFeature(options: ComposeDesktopArtifactFeatureOptions): any {
  const artifactCatalog = createLocalArtifactCatalogPersistenceAdapter({ rootDirectory: options.storageRootDirectory, documents: options.documents });
  const artifactBindings = createLocalArtifactStorageBindingAdapter({ rootDirectory: options.storageRootDirectory, documents: options.documents });
  const storage = createFilesystemArtifactObjectStorageAdapter({
    rootDirectory: options.storageRootDirectory,
    host: "desktop",
    logging: options.loggingPort,
    now: options.now,
    artifactCatalogAppend: artifactCatalog,
  });
  const artifactBrowserRead = createFilesystemArtifactBrowserReadAdapter({
    rootDirectory: options.storageRootDirectory,
    artifactCatalogRead: artifactCatalog,
    artifactCatalogAppend: artifactCatalog,
    storage,
    artifactBindingRead: artifactBindings,
  });
  const artifactMediaViewRetrieval = createFilesystemArtifactContentRetrievalAdapter({ storage, artifactCatalogRead: artifactCatalog });
  return {
    artifactCatalog,
    artifactBindings,
    storage,
    artifactBrowserRead,
    artifactMediaViewRetrieval,
    storeArtifactUploadUseCase: new StoreArtifactUploadUseCase({ storage, logging: options.loggingPort, now: options.now, workspaceRepository: options.workspaceShell.workspaceRepository, workspaceAuthorization: options.workspaceAuthorization }),
    browseArtifactsUseCase: new BrowseArtifactsUseCase({ artifactBrowserMetadataRead: artifactBrowserRead, workspaceRepository: options.workspaceShell.workspaceRepository, workspaceAuthorization: options.workspaceAuthorization }),
    browseUnregisteredArtifactsUseCase: new BrowseUnregisteredArtifactsUseCase({ artifactBrowserUnregistered: artifactBrowserRead }),
    registerUnregisteredArtifactUseCase: new RegisterUnregisteredArtifactUseCase({ artifactBrowserUnregistered: artifactBrowserRead }),
    deleteUnregisteredArtifactUseCase: new DeleteUnregisteredArtifactUseCase({ artifactBrowserUnregistered: artifactBrowserRead }),
    deleteRegisteredArtifactUseCase: new DeleteRegisteredArtifactUseCase({ artifactCatalogRead: artifactCatalog, artifactCatalogDelete: artifactCatalog, storage, artifactBindingStorage: artifactBindings, workspaceRepository: options.workspaceShell.workspaceRepository, workspaceAuthorization: options.workspaceAuthorization }),
    readArtifactDetailUseCase: new ReadArtifactDetailUseCase({ artifactBrowserMetadataRead: artifactBrowserRead, workspaceRepository: options.workspaceShell.workspaceRepository, workspaceAuthorization: options.workspaceAuthorization }),
    readArtifactContentUseCase: new ReadArtifactContentUseCase({ artifactBrowserContentRead: artifactBrowserRead, workspaceRepository: options.workspaceShell.workspaceRepository, workspaceAuthorization: options.workspaceAuthorization }),
  };
}
