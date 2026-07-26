import type { AssetDefinitionRepositoryPort } from "../../../application/ports/asset";
import type {
  AssetImplementationArtifactPort,
  AssetImplementationBackingResourceRepositoryPort,
  AssetImplementationRepositoryPort,
} from "../../../application/ports/asset-implementation";
import {
  ActivateAssetPackageUseCase,
  AdmitAssetPackageUseCase,
  DisableAssetPackageUseCase,
  InspectAssetPackageUseCase,
  ListAssetPackagesUseCase,
  RollbackAssetPackageUseCase,
} from "../../../application/use-cases/asset-package";
import { createAisbPackageInspector } from "../../../adapters/package/aisb";
import {
  createAssetPackageTrustVerifier,
  type AssetPackageSignatureVerifier,
} from "../../../adapters/package/trust";
import { createStructuredAssetPackageRepository } from "../../../adapters/persistence/asset-package";
import type { StructuredDocumentStore } from "../../../adapters/persistence/shared";

export function composeAssetPackageLifecycle(options: {
  readonly documents: StructuredDocumentStore;
  readonly definitions: AssetDefinitionRepositoryPort;
  readonly implementations: AssetImplementationRepositoryPort;
  readonly backingResources: AssetImplementationBackingResourceRepositoryPort;
  readonly artifacts: AssetImplementationArtifactPort;
  readonly signatureVerifier?: AssetPackageSignatureVerifier;
  readonly nextInspectionId: () => string;
  readonly now: () => string;
}) {
  const repository = createStructuredAssetPackageRepository(options.documents);
  const inspector = createAisbPackageInspector();
  const trust = createAssetPackageTrustVerifier({ signatures: options.signatureVerifier });
  const activate = new ActivateAssetPackageUseCase(repository, options.now);
  return {
    repository,
    useCases: {
      inspect: new InspectAssetPackageUseCase({
        inspector,
        repository,
        artifacts: options.artifacts,
        nextInspectionId: options.nextInspectionId,
        now: options.now,
      }),
      admit: new AdmitAssetPackageUseCase({
        inspector,
        packages: repository,
        artifacts: options.artifacts,
        trust,
        definitions: options.definitions,
        implementations: options.implementations,
        backingResources: options.backingResources,
        now: options.now,
      }),
      list: new ListAssetPackagesUseCase(repository),
      activate,
      disable: new DisableAssetPackageUseCase(repository, options.now),
      rollback: new RollbackAssetPackageUseCase(repository, activate),
    },
  };
}

export type AssetPackageLifecycleComposition = ReturnType<typeof composeAssetPackageLifecycle>;
