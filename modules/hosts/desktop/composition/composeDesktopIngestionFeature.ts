import type { OrganizationRequestContextProviderPort } from "../../../application/ports/organization";
import type { WorkspaceOperationAuthorizationPort } from "../../../application/ports/security";
import type { ArtifactStoragePort, ArtifactStreamStoragePort } from "../../../application/ports/storage";
import type { WorkspaceRepository } from "../../../application/ports/workspace";
import { createStructuredIngestionAcquisitionRepository, createStructuredIngestionFilePublicationRepository } from "../../../adapters/persistence/ingestion";
import type { StructuredDocumentStore } from "../../../adapters/persistence/shared";
import { createWebsiteHtmlAcquisitionPort, GovernedWebsiteCaptureAdapter } from "../../../adapters/ingestion";
import { createFilesystemIngestionCheckpointStorage } from "../../../adapters/storage/ingestion-checkpoint";
import { createFilesystemIngestionFileByteStorageAdapter, createLocalArtifactCatalogPersistenceAdapter, createLocalArtifactStorageBindingAdapter } from "../../../adapters/storage/filesystem";
import {
  GovernedIngestionTaskUseCases,
  IngestionFilePublicationService,
  GovernedWebsiteIngestionUseCases,
  IngestWebsitePageUseCase,
  IngestWebsitePagesBatchUseCase,
  type RegisterArtifactFromRepoUseCase,
} from "../../../application/use-cases";
import type { ApplicationRequestContext } from "../../../application/ports";
import type { IngestionTaskTransportCommand, IngestionTaskTransportValue } from "../../../contracts/ingestion";
import { createContractError, createFailureResult, type ContractResult } from "../../../contracts/shared";

export interface ComposeDesktopIngestionFeatureOptions {
  readonly artifacts: { readonly storage: ArtifactStoragePort & ArtifactStreamStoragePort };
  readonly remoteArtifacts: { readonly registerArtifactFromRepoUseCase: Pick<RegisterArtifactFromRepoUseCase, "execute"> };
  readonly storageRootDirectory: string;
  readonly documents?: StructuredDocumentStore;
  readonly workspaceRepository: Pick<WorkspaceRepository, "readWorkspace">;
  readonly workspaceAuthorization?: WorkspaceOperationAuthorizationPort;
  readonly organizationContextProvider?: OrganizationRequestContextProviderPort;
  readonly now?: () => string;
}

export interface DesktopIngestionTaskCommands {
  executeCommand(command: IngestionTaskTransportCommand, context?: ApplicationRequestContext): Promise<ContractResult<IngestionTaskTransportValue>>;
}

export interface DesktopIngestionFeature {
  readonly disposed: boolean;
  readonly ingestWebsitePageUseCase: IngestWebsitePageUseCase;
  readonly ingestWebsitePagesBatchUseCase: IngestWebsitePagesBatchUseCase;
  readonly ingestionTasks: DesktopIngestionTaskCommands;
  dispose(): void;
}

export function composeDesktopIngestionFeature(options: ComposeDesktopIngestionFeatureOptions): DesktopIngestionFeature {
  let disposed = false;
  const websiteHtmlAcquisition = createWebsiteHtmlAcquisitionPort();
  const ingestWebsitePageUseCase = new IngestWebsitePageUseCase({ acquisition: websiteHtmlAcquisition, storage: options.artifacts.storage, now: options.now });
  const ingestionTasks: DesktopIngestionTaskCommands = options.documents
    ? (() => {
        const repository = createStructuredIngestionAcquisitionRepository(options.documents!);
        const checkpoints = createFilesystemIngestionCheckpointStorage({
          rootDirectory: options.storageRootDirectory,
          organizationContextProvider: options.organizationContextProvider,
        });
        const filePublication = new IngestionFilePublicationService({
          repository,
          publications: createStructuredIngestionFilePublicationRepository(options.documents!),
          checkpoints,
          // Match desktop's canonical object mapping; checkpoint storage above
          // separately uses the host's organization prefix.
          bytes: createFilesystemIngestionFileByteStorageAdapter({ rootDirectory: options.storageRootDirectory }),
          bindings: createLocalArtifactStorageBindingAdapter({ rootDirectory: options.storageRootDirectory, documents: options.documents }),
          catalog: createLocalArtifactCatalogPersistenceAdapter({ rootDirectory: options.storageRootDirectory, documents: options.documents }),
          now: options.now,
        });
        const website = new GovernedWebsiteIngestionUseCases({
          repository,
          capture: new GovernedWebsiteCaptureAdapter({ now: options.now }),
          streamStorage: options.artifacts.storage,
          artifactCleanup: options.artifacts.storage,
          workspaceRepository: options.workspaceRepository,
          workspaceAuthorization: options.workspaceAuthorization,
          now: options.now,
        });
        return new GovernedIngestionTaskUseCases({
        repository,
        checkpoints,
        filePublication,
        streamStorage: options.artifacts.storage,
        artifactCleanup: options.artifacts.storage,
        registerArtifactFromRepo: options.remoteArtifacts.registerArtifactFromRepoUseCase,
        workspaceRepository: options.workspaceRepository,
        workspaceAuthorization: options.workspaceAuthorization,
        organizationContextProvider: options.organizationContextProvider,
        website,
        now: options.now,
      });
      })()
    : {
        async executeCommand(_command, context = {}) {
          return createFailureResult(
            createContractError("unavailable", "Ingestion task persistence is unavailable."),
            context,
          );
        },
      };
  return {
    dispose() { disposed = true; },
    get disposed() { return disposed; },
    ingestWebsitePageUseCase,
    ingestWebsitePagesBatchUseCase: new IngestWebsitePagesBatchUseCase({ ingestWebsitePage: ingestWebsitePageUseCase }),
    ingestionTasks,
  };
}
