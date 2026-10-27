import type { WorkspaceAssetAccessPort } from "../../../application/ports/asset/workspace-asset-access.port";
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
  readonly workspaceAccess: WorkspaceAssetAccessPort;
  readonly documents: StructuredDocumentStore;
  readonly definitions: AssetDefinitionRepositoryPort;
  readonly implementations: AssetImplementationRepositoryPort;
  readonly backingResources: AssetImplementationBackingResourceRepositoryPort;
  readonly artifacts: AssetImplementationArtifactPort;
  readonly signatureVerifier?: AssetPackageSignatureVerifier;
  readonly nextInspectionId: () => string;
  readonly now: () => string;
  readonly repository?: ReturnType<typeof createStructuredAssetPackageRepository>;
}) {
  const repository =
    options.repository ??
    createStructuredAssetPackageRepository(options.documents);
  const inspector = createAisbPackageInspector();
  const trust = createAssetPackageTrustVerifier({ signatures: options.signatureVerifier });
  const activate = new ActivateAssetPackageUseCase(
    repository,
    options.implementations,
    options.now,
    options.workspaceAccess,
  );
  return {
    repository,
    useCases: {
      inspect: new InspectAssetPackageUseCase({
        workspaceAccess: options.workspaceAccess,
        inspector,
        repository,
        artifacts: options.artifacts,
        nextInspectionId: options.nextInspectionId,
        now: options.now,
      }),
      admit: new AdmitAssetPackageUseCase({
        workspaceAccess: options.workspaceAccess,
        inspector,
        packages: repository,
        artifacts: options.artifacts,
        trust,
        definitions: options.definitions,
        implementations: options.implementations,
        backingResources: options.backingResources,
        now: options.now,
      }),
      list: new ListAssetPackagesUseCase(repository, options.workspaceAccess),
      activate,
      disable: new DisableAssetPackageUseCase(
        repository,
        options.implementations,
        options.now,
        options.workspaceAccess,
      ),
      rollback: new RollbackAssetPackageUseCase(repository, activate, options.workspaceAccess),
    },
  };
}

export type AssetPackageLifecycleComposition = ReturnType<typeof composeAssetPackageLifecycle>;
