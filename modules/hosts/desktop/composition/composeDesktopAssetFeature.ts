import { randomUUID } from "node:crypto";
import { join } from "node:path";
import {
  FinalizeGeneratedOutputAsAssetUseCase,
  ImportExternalRepositoryObjectAsAssetUseCase,
  LocalizeExternalRepositoryObjectAsAssetUseCase,
  RegisterResourceBackedViewAsAssetInstanceUseCase,
} from "../../../application/use-cases";
import { createLocalImageAssetRegistryAdapter } from "../../../adapters/persistence/image";
import { createLocalModelRegistryAdapter } from "../../../adapters/persistence/model";
import { createLocalAuthoredAssetRepositoryAdapter } from "../../../adapters/persistence/asset-authoring";
import {
  composeInternalAssetRegistry,
  type InternalAssetRegistryComposition,
} from "../../shared/composition/composeInternalAssetRegistry";
import { composeResourceBackedViewProviders } from "../../shared/composition/composeResourceBackedViewProviders";
import type { StructuredDocumentStore } from "../../../adapters/persistence/shared";
import { createAssetImplementationArtifactAdapter } from "../../../adapters/storage/asset-implementation";
import { composeAssetImplementationKernel } from "../../shared/composition/composeAssetImplementationKernel";
import { composeAssetPackageLifecycle } from "../../shared/composition/composeAssetPackageLifecycle";
import { composeAssetStudioWorkflow } from "../../shared/composition/composeAssetStudioWorkflow";
import { composeAssetDerivedCustomization } from "../../shared/composition/composeAssetDerivedCustomization";

export interface ComposeDesktopAssetFeatureOptions {
  storageRootDirectory: string;
  now: () => string;
  readSharedModelStorageDirectory?: () => Promise<string | undefined>;
  artifacts: any;
  documents?: StructuredDocumentStore;
  onInternalAssetRegistry?: (
    registry: InternalAssetRegistryComposition,
  ) => void;
}

export async function composeDesktopAssetFeature(
  options: ComposeDesktopAssetFeatureOptions,
) {
  const modelRegistry = createLocalModelRegistryAdapter({
    filePath: `${options.storageRootDirectory}/model-registry/models.json`,
    rootDirectory: options.storageRootDirectory,
    documents: options.documents,
    now: options.now,
    discovery: {
      searchRoots: async () => {
        const root = await options.readSharedModelStorageDirectory?.();
        return root ? [root] : [];
      },
    },
  });
  const imageAssetRegistry = createLocalImageAssetRegistryAdapter({
    filePath: join(
      options.storageRootDirectory,
      ".catalog",
      "image-assets.json",
    ),
    rootDirectory: options.storageRootDirectory,
    documents: options.documents,
    now: options.now,
  });
  const internalAssetRegistry = composeInternalAssetRegistry({
    rootDirectory: options.storageRootDirectory,
    now: options.now,
    documents: options.documents,
    resourceBackedViewProvider: composeResourceBackedViewProviders({
      artifactBrowserMetadataRead: options.artifacts.artifactBrowserRead,
      imageAssetDescriptorRead: imageAssetRegistry,
      modelRegistry,
      publishedModelRegistry: modelRegistry,
    }),
  });
  options.onInternalAssetRegistry?.(internalAssetRegistry);
  const foundationInstall =
    await internalAssetRegistry.installSystemFoundationPack.install({
      allowSystemDefinitionRefresh: true,
    });
  if (foundationInstall.status === "failed") {
    throw new Error("System foundation assets are unavailable.");
  }
  const implementationArtifacts = createAssetImplementationArtifactAdapter(
    options.artifacts.storage,
  );
  const assetImplementation = options.documents
    ? composeAssetImplementationKernel({
        documents: options.documents,
        definitions:
          internalAssetRegistry.assetKernel.repositories.definitionRepository,
        artifacts: implementationArtifacts,
        now: options.now,
      })
    : undefined;
  await assetImplementation?.ensureTrustedBuiltIns();
  const assetPackages =
    options.documents && assetImplementation
      ? composeAssetPackageLifecycle({
          documents: options.documents,
          definitions:
            internalAssetRegistry.assetKernel.repositories.definitionRepository,
          implementations: assetImplementation.repository,
          backingResources: assetImplementation.backingResources,
          artifacts: implementationArtifacts,
          nextInspectionId: () => `package-inspection.${randomUUID()}`,
          now: options.now,
        })
      : undefined;
  const assetStudio =
    options.documents && assetImplementation
      ? composeAssetStudioWorkflow({
          documents: options.documents,
          implementations: assetImplementation,
          artifacts: implementationArtifacts,
          definitions:
            internalAssetRegistry.assetKernel.repositories.definitionRepository,
          now: options.now,
        })
      : undefined;
  const derivedCustomizations =
    options.documents && assetImplementation
      ? composeAssetDerivedCustomization({
          documents: options.documents,
          definitions:
            internalAssetRegistry.assetKernel.repositories.definitionRepository,
          implementations: assetImplementation,
          artifacts: implementationArtifacts,
          authoredAssets: createLocalAuthoredAssetRepositoryAdapter({
            rootDir: options.storageRootDirectory,
            documents: options.documents,
            now: options.now,
          }),
          now: options.now,
        })
      : undefined;
  const generateInstanceId = () => `asset-instance.${randomUUID()}`;
  const repositories = internalAssetRegistry.assetKernel.repositories;
  return {
    assetRegistryRead: internalAssetRegistry.workspaceReadFacade,
    modelRegistry,
    imageAssetRegistry,
    assetImplementation,
    assetPackages,
    assetStudio,
    derivedCustomizations,
    assetMutationUseCases: {
      registerResourceBackedViewAsAsset:
        new RegisterResourceBackedViewAsAssetInstanceUseCase({
          assetRegistryRead: internalAssetRegistry.readFacade,
          definitionRepository: repositories.definitionRepository,
          instanceRepository: repositories.instanceRepository,
          now: options.now,
          generateInstanceId,
        }),
      finalizeGeneratedOutputAsAsset: new FinalizeGeneratedOutputAsAssetUseCase(
        {
          assetRegistryRead: internalAssetRegistry.readFacade,
          definitionRepository: repositories.definitionRepository,
          instanceRepository: repositories.instanceRepository,
          now: options.now,
          generateInstanceId,
        },
      ),
      importExternalRepositoryObjectAsAsset:
        new ImportExternalRepositoryObjectAsAssetUseCase({
          assetRegistryRead: internalAssetRegistry.readFacade,
          definitionRepository: repositories.definitionRepository,
          instanceRepository: repositories.instanceRepository,
          now: options.now,
          generateInstanceId,
        }),
      localizeExternalRepositoryObjectAsAsset:
        new LocalizeExternalRepositoryObjectAsAssetUseCase({
          assetRegistryRead: internalAssetRegistry.readFacade,
          definitionRepository: repositories.definitionRepository,
          instanceRepository: repositories.instanceRepository,
          now: options.now,
          generateInstanceId,
        }),
    },
  };
}
