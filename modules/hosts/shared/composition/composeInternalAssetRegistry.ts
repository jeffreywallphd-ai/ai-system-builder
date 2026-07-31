import { AssetRegistryReadFacade } from "../../../application/services/asset/asset-registry-read-facade.service";
import { WorkspaceAssetRegistryReadFacade } from "../../../application/services/asset/workspace-asset-registry-read-facade.service";
import { createAssetResourceBackedViewAggregateProvider } from "../../../application/services/asset/asset-resource-backed-view-aggregate-provider.service";
import { InstallSystemAssetPackService, InstallSystemFoundationPackService } from "../../../application/services/asset-packs";
import { CreateWorkspaceUseCase, ListWorkspaceSystemPackActivationsUseCase } from "../../../application/use-cases/workspace";
import { createLocalWorkspaceRepository, createLocalWorkspaceSelectionRepository, createLocalWorkspaceSystemPackActivationRepository } from "../../../adapters/persistence/workspace";
import type { AssetResourceBackedViewProvider } from "../../../application/ports/asset";
import { composeLocalAssetKernel, type LocalAssetKernelComposition } from "./composeLocalAssetKernel";
import type { StructuredDocumentStore } from "../../../adapters/persistence/shared";

export interface ComposeInternalAssetRegistryOptions {
  readonly rootDirectory: string;
  readonly now?: () => string;
  readonly documents?: StructuredDocumentStore;
  readonly definitionDocuments?: StructuredDocumentStore;
  readonly resourceBackedViewProvider?: AssetResourceBackedViewProvider;
  readonly resourceBackedViewProviders?: readonly AssetResourceBackedViewProvider[];
}

export interface InternalAssetRegistryComposition {
  readonly assetKernel: LocalAssetKernelComposition;
  readonly readFacade: AssetRegistryReadFacade;
  readonly workspaceReadFacade: WorkspaceAssetRegistryReadFacade;
  readonly assetPackInstaller: InstallSystemAssetPackService;
  readonly installSystemFoundationPack: InstallSystemFoundationPackService;
  readonly workspaceRepositories: {
    readonly workspaceRepository: ReturnType<typeof createLocalWorkspaceRepository>;
    readonly workspaceSelectionRepository: ReturnType<typeof createLocalWorkspaceSelectionRepository>;
    readonly systemPackActivationRepository: ReturnType<typeof createLocalWorkspaceSystemPackActivationRepository>;
  };
  readonly workspaceUseCases: {
    readonly createWorkspace: CreateWorkspaceUseCase;
    readonly listWorkspaceSystemPackActivations: ListWorkspaceSystemPackActivationsUseCase;
  };
  readonly resourceBackedViewProvider?: AssetResourceBackedViewProvider;
  readonly diagnostics: {
    readonly storeKind: LocalAssetKernelComposition["diagnostics"]["storeKind"];
    readonly schemaVersion: LocalAssetKernelComposition["diagnostics"]["schemaVersion"];
    readonly registryFacadeComposed: true;
    readonly resourceBackedViewsEnabled: boolean;
  };
}

export function composeInternalAssetRegistry(options: ComposeInternalAssetRegistryOptions): InternalAssetRegistryComposition {
  const assetKernel = composeLocalAssetKernel({
    rootDirectory: options.rootDirectory,
    now: options.now,
    documents: options.documents,
    definitionDocuments: options.definitionDocuments,
  });
  const resourceBackedViewProvider = composeResourceBackedViewProvider(options);
  const workspaceRepository = createLocalWorkspaceRepository({ rootDirectory: options.rootDirectory, documents: options.documents });
  const workspaceSelectionRepository = createLocalWorkspaceSelectionRepository({ rootDirectory: options.rootDirectory, documents: options.documents });
  const systemPackActivationRepository = createLocalWorkspaceSystemPackActivationRepository({ rootDirectory: options.rootDirectory, documents: options.documents });
  const installerDependencies = {
    definitionRepository: assetKernel.repositories.definitionRepository,
    registerAssetDefinition: assetKernel.useCases.registerAssetDefinition,
  };
  const createWorkspace = new CreateWorkspaceUseCase({ workspaceRepository, workspaceSelectionRepository, systemPackActivationRepository });
  const listWorkspaceSystemPackActivations = new ListWorkspaceSystemPackActivationsUseCase({ systemPackActivationRepository });
  const readFacade = new AssetRegistryReadFacade({
    definitionRepository: assetKernel.repositories.definitionRepository,
    instanceRepository: assetKernel.repositories.instanceRepository,
    compositionRepository: assetKernel.repositories.compositionRepository,
    bindingRepository: assetKernel.repositories.bindingRepository,
    resourceBackedViewProvider,
  });

  const workspaceReadFacade = new WorkspaceAssetRegistryReadFacade({
    assetRegistryRead: readFacade,
    listWorkspaceSystemPackActivations,
    workspaceRepository,
  });

  return {
    assetKernel,
    readFacade,
    workspaceReadFacade,
    assetPackInstaller: new InstallSystemAssetPackService(installerDependencies),
    installSystemFoundationPack: new InstallSystemFoundationPackService(installerDependencies),
    workspaceRepositories: { workspaceRepository, workspaceSelectionRepository, systemPackActivationRepository },
    workspaceUseCases: { createWorkspace, listWorkspaceSystemPackActivations },
    ...(resourceBackedViewProvider ? { resourceBackedViewProvider } : {}),
    diagnostics: {
      storeKind: assetKernel.diagnostics.storeKind,
      schemaVersion: assetKernel.diagnostics.schemaVersion,
      registryFacadeComposed: true,
      resourceBackedViewsEnabled: Boolean(resourceBackedViewProvider),
    },
  };
}

function composeResourceBackedViewProvider(options: ComposeInternalAssetRegistryOptions): AssetResourceBackedViewProvider | undefined {
  if (options.resourceBackedViewProviders?.length) {
    return createAssetResourceBackedViewAggregateProvider(options.resourceBackedViewProviders);
  }
  return options.resourceBackedViewProvider;
}
