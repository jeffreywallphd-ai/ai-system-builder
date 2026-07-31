import type {
  AssetBindingRepositoryPort,
  AssetCompositionRepositoryPort,
  AssetDefinitionRepositoryPort,
  AssetInstanceRepositoryPort,
} from "../../../application/ports/asset";
import {
  CreateAssetCompositionUseCase,
  CreateAssetInstanceUseCase,
  ListAssetCompositionsUseCase,
  ListAssetDefinitionsUseCase,
  ListAssetInstancesUseCase,
  ReadAssetCompositionUseCase,
  ReadAssetDefinitionUseCase,
  ReadAssetInstanceUseCase,
  RegisterAssetDefinitionUseCase,
  UpdateAssetCompositionUseCase,
  UpdateAssetDefinitionUseCase,
  UpdateAssetInstanceUseCase,
  ValidateAssetCompositionUseCase,
  ValidateAssetDefinitionUseCase,
  ValidateAssetInstanceUseCase,
} from "../../../application/use-cases/asset";
import {
  ASSET_KERNEL_LOCAL_SCHEMA_VERSION,
  ASSET_KERNEL_LOCAL_STORE_KIND,
  LocalAssetRecordStore,
  createLocalAssetBindingRepositoryAdapter,
  createLocalAssetCompositionRepositoryAdapter,
  createLocalAssetDefinitionRepositoryAdapter,
  createLocalAssetInstanceRepositoryAdapter,
} from "../../../adapters/persistence/asset";
import type { StructuredDocumentStore } from "../../../adapters/persistence/shared";

export interface ComposeLocalAssetKernelOptions {
  readonly rootDirectory: string;
  readonly now?: () => string;
  readonly documents?: StructuredDocumentStore;
  readonly definitionDocuments?: StructuredDocumentStore;
}

export interface LocalAssetKernelComposition {
  readonly repositories: {
    readonly definitionRepository: AssetDefinitionRepositoryPort;
    readonly instanceRepository: AssetInstanceRepositoryPort;
    readonly compositionRepository: AssetCompositionRepositoryPort;
    readonly bindingRepository: AssetBindingRepositoryPort;
  };
  readonly useCases: {
    readonly registerAssetDefinition: RegisterAssetDefinitionUseCase;
    readonly readAssetDefinition: ReadAssetDefinitionUseCase;
    readonly listAssetDefinitions: ListAssetDefinitionsUseCase;
    readonly updateAssetDefinition: UpdateAssetDefinitionUseCase;
    readonly validateAssetDefinition: ValidateAssetDefinitionUseCase;
    readonly createAssetInstance: CreateAssetInstanceUseCase;
    readonly readAssetInstance: ReadAssetInstanceUseCase;
    readonly listAssetInstances: ListAssetInstancesUseCase;
    readonly updateAssetInstance: UpdateAssetInstanceUseCase;
    readonly validateAssetInstance: ValidateAssetInstanceUseCase;
    readonly createAssetComposition: CreateAssetCompositionUseCase;
    readonly readAssetComposition: ReadAssetCompositionUseCase;
    readonly listAssetCompositions: ListAssetCompositionsUseCase;
    readonly updateAssetComposition: UpdateAssetCompositionUseCase;
    readonly validateAssetComposition: ValidateAssetCompositionUseCase;
  };
  readonly diagnostics: {
    readonly storeKind: typeof ASSET_KERNEL_LOCAL_STORE_KIND;
    readonly schemaVersion: typeof ASSET_KERNEL_LOCAL_SCHEMA_VERSION;
    readonly initialized: true;
  };
}

export function composeLocalAssetKernel(options: ComposeLocalAssetKernelOptions): LocalAssetKernelComposition {
  const storeOptions = { rootDir: options.rootDirectory, now: options.now, documents: options.documents };
  new LocalAssetRecordStore(storeOptions).initializeSync();

  const definitionRepository = createLocalAssetDefinitionRepositoryAdapter({
    ...storeOptions,
    documents: options.definitionDocuments ?? options.documents,
  });
  const instanceRepository = createLocalAssetInstanceRepositoryAdapter(storeOptions);
  const compositionRepository = createLocalAssetCompositionRepositoryAdapter(storeOptions);
  const bindingRepository = createLocalAssetBindingRepositoryAdapter(storeOptions);

  return {
    repositories: {
      definitionRepository,
      instanceRepository,
      compositionRepository,
      bindingRepository,
    },
    useCases: {
      registerAssetDefinition: new RegisterAssetDefinitionUseCase({ definitionRepository }),
      readAssetDefinition: new ReadAssetDefinitionUseCase({ definitionRepository }),
      listAssetDefinitions: new ListAssetDefinitionsUseCase({ definitionRepository }),
      updateAssetDefinition: new UpdateAssetDefinitionUseCase({ definitionRepository }),
      validateAssetDefinition: new ValidateAssetDefinitionUseCase(),
      createAssetInstance: new CreateAssetInstanceUseCase({ definitionRepository, instanceRepository }),
      readAssetInstance: new ReadAssetInstanceUseCase({ instanceRepository }),
      listAssetInstances: new ListAssetInstancesUseCase({ instanceRepository }),
      updateAssetInstance: new UpdateAssetInstanceUseCase({ definitionRepository, instanceRepository }),
      validateAssetInstance: new ValidateAssetInstanceUseCase({ definitionRepository }),
      createAssetComposition: new CreateAssetCompositionUseCase({
        compositionRepository,
        definitionRepository,
        instanceRepository,
        bindingRepository,
      }),
      readAssetComposition: new ReadAssetCompositionUseCase({ compositionRepository }),
      listAssetCompositions: new ListAssetCompositionsUseCase({ compositionRepository }),
      updateAssetComposition: new UpdateAssetCompositionUseCase({
        compositionRepository,
        definitionRepository,
        instanceRepository,
        bindingRepository,
      }),
      validateAssetComposition: new ValidateAssetCompositionUseCase({
        definitionRepository,
        instanceRepository,
        bindingRepository,
      }),
    },
    diagnostics: {
      storeKind: ASSET_KERNEL_LOCAL_STORE_KIND,
      schemaVersion: ASSET_KERNEL_LOCAL_SCHEMA_VERSION,
      initialized: true,
    },
  };
}
