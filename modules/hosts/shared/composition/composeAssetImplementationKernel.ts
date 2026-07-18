import type { AssetDefinitionRepositoryPort } from "../../../application/ports/asset";
import {
  SYSTEM_FOUNDATION_BACKING_RESOURCE_BUNDLES,
  SYSTEM_FOUNDATION_FUNCTIONAL_DEFAULTS,
} from "../../../application/services/asset-packs";
import type {
  AssetImplementationArtifactPort,
  AssetImplementationBuilderPort,
} from "../../../application/ports/asset-implementation";
import {
  BindAssetImplementationReleaseUseCase,
  CreateAssetImplementationDraftUseCase,
  DisableAssetImplementationBindingUseCase,
  ListAssetImplementationReleasesUseCase,
  PublishAssetImplementationReleaseUseCase,
  RequestAssetImplementationBuildUseCase,
  ResolveAssetImplementationUseCase,
  RevokeAssetImplementationReleaseUseCase,
  SnapshotAssetImplementationSourceUseCase,
} from "../../../application/use-cases/asset-implementation";
import {
  createStructuredAssetImplementationBackingResourceRepository,
  createStructuredAssetImplementationRepository,
} from "../../../adapters/persistence/asset-implementation";
import type { StructuredDocumentStore } from "../../../adapters/persistence/shared";
import {
  normalizeAssetId,
  type AssetReference,
} from "../../../contracts/asset";
import {
  ASSET_IMPLEMENTATION_BACKING_RESOURCE_MEDIA_TYPE,
  describeAssetImplementationBackingResourceFiles,
  normalizeAssetImplementationBindingId,
  normalizeAssetImplementationFacetId,
  normalizeAssetImplementationReleaseId,
  normalizeAssetSourceSnapshotId,
  type AssetImplementationBinding,
  type AssetImplementationDeploymentProfile,
  type AssetImplementationFacetKind,
  type AssetImplementationRelease,
  type AssetImplementationResolutionRequest,
  type TrustedBuiltInImplementationSeed,
} from "../../../contracts/asset-implementation";
import {
  createWorkspaceId,
  type WorkspaceId,
} from "../../../contracts/workspace";

const DEFAULT_PACKAGE_DIGEST = `sha256:${"c".repeat(64)}`;
export const SYSTEM_FOUNDATION_BACKING_RESOURCE_WORKSPACE_ID =
  createWorkspaceId("system.foundation");

/** Exact, closed implementation bindings for every immutable foundation entry. */
export const SYSTEM_FOUNDATION_TRUSTED_IMPLEMENTATION_SEEDS: readonly TrustedBuiltInImplementationSeed[] =
  SYSTEM_FOUNDATION_FUNCTIONAL_DEFAULTS.map((descriptor) => {
    const identity = descriptor.definitionId.replace(/[^a-zA-Z0-9._:-]/g, "-");
    return {
      definitionRef: {
        kind: "asset-definition-version",
        id: normalizeAssetId(descriptor.definitionId),
        version: descriptor.definitionVersion,
      },
      releaseId: normalizeAssetImplementationReleaseId(
        `implementation-release.${identity}.1`,
      ),
      bindingId: normalizeAssetImplementationBindingId(
        `implementation-binding.${identity}.1`,
      ),
      version: descriptor.definitionVersion,
      entryKey: descriptor.entryKey,
      facetKind: descriptor.facetKind,
      runtimeKind: descriptor.runtimeKind,
      deploymentProfiles: descriptor.deploymentProfiles,
      packageDigest: DEFAULT_PACKAGE_DIGEST,
    };
  });

export const DEFAULT_TRUSTED_ASSET_IMPLEMENTATION_SEEDS: readonly TrustedBuiltInImplementationSeed[] =
  SYSTEM_FOUNDATION_TRUSTED_IMPLEMENTATION_SEEDS;

export interface ComposeAssetImplementationKernelOptions {
  readonly documents: StructuredDocumentStore;
  readonly definitions: AssetDefinitionRepositoryPort;
  readonly artifacts?: AssetImplementationArtifactPort;
  readonly builder?: AssetImplementationBuilderPort;
  readonly trustedSeeds?: readonly TrustedBuiltInImplementationSeed[];
  readonly now?: () => string;
  readonly createRevocationId?: () => string;
}

export function composeAssetImplementationKernel(
  options: ComposeAssetImplementationKernelOptions,
) {
  const now = options.now ?? (() => new Date().toISOString());
  const repository = createStructuredAssetImplementationRepository(
    options.documents,
  );
  const backingResources =
    createStructuredAssetImplementationBackingResourceRepository(
      options.documents,
    );
  const definitions = {
    readExactDefinition: (reference: AssetReference) =>
      options.definitions.getDefinition(reference),
  };
  const publishRelease = new PublishAssetImplementationReleaseUseCase(
    repository,
    definitions,
    now,
  );
  const bindRelease = new BindAssetImplementationReleaseUseCase(
    repository,
    now,
  );
  const useCases = {
    createDraft: new CreateAssetImplementationDraftUseCase(repository, now),
    ...(options.artifacts
      ? {
          snapshotSource: new SnapshotAssetImplementationSourceUseCase(
            repository,
            options.artifacts,
            now,
          ),
        }
      : {}),
    ...(options.builder
      ? {
          requestBuild: new RequestAssetImplementationBuildUseCase(
            repository,
            options.builder,
            now,
          ),
        }
      : {}),
    publishRelease,
    bindRelease,
    disableBinding: new DisableAssetImplementationBindingUseCase(
      repository,
      now,
    ),
    revokeRelease: new RevokeAssetImplementationReleaseUseCase(
      repository,
      options.createRevocationId ??
        (() => `implementation-revocation.${Date.now()}`),
      now,
    ),
    resolve: new ResolveAssetImplementationUseCase(repository),
    listReleases: new ListAssetImplementationReleasesUseCase(repository),
  };

  return {
    repository,
    backingResources,
    useCases,
    async ensureTrustedBuiltIns(): Promise<void> {
      for (const seed of options.trustedSeeds ??
        DEFAULT_TRUSTED_ASSET_IMPLEMENTATION_SEEDS) {
        const existingRelease = await repository.readRelease(seed.releaseId);
        if (existingRelease) {
          if (!matchesTrustedSeedRelease(existingRelease, seed)) {
            throw new Error(
              "Trusted built-in implementation release is incompatible.",
            );
          }
        } else {
          const published = await publishRelease.execute({
            releaseId: seed.releaseId,
            definitionRef: seed.definitionRef,
            version: seed.version,
            trustLevel: "system-trusted",
            facets: [trustedSeedFacet(seed)],
            packageDigest: seed.packageDigest,
            actorId: "system",
          });
          if (!published.ok) throw new Error(published.error.message);
        }

        const release = await repository.readRelease(seed.releaseId);
        if (!release) {
          throw new Error("Trusted built-in implementation release is unavailable.");
        }

        if (options.artifacts) {
          const bundle = SYSTEM_FOUNDATION_BACKING_RESOURCE_BUNDLES.get(
            String(seed.definitionRef.id),
          );
          if (!bundle) {
            throw new Error(
              "Trusted built-in implementation backing resources are unavailable.",
            );
          }
          const artifact = await options.artifacts.putImmutable({
            workspaceId: SYSTEM_FOUNDATION_BACKING_RESOURCE_WORKSPACE_ID,
            kind: "source",
            content: JSON.stringify(bundle),
            mediaType: ASSET_IMPLEMENTATION_BACKING_RESOURCE_MEDIA_TYPE,
          });
          const identity = String(seed.definitionRef.id).replace(
            /[^a-zA-Z0-9._-]/g,
            "-",
          );
          await backingResources.save({
            backingResourceId: `implementation-backing.${identity}.1`,
            origin: "system-foundation",
            releaseId: seed.releaseId,
            definitionRef: seed.definitionRef,
            scope: "system",
            artifactWorkspaceId:
              SYSTEM_FOUNDATION_BACKING_RESOURCE_WORKSPACE_ID,
            sourceSnapshotId: normalizeAssetSourceSnapshotId(
              `source-snapshot.${identity}.${artifact.digest.slice(-16)}`,
            ),
            artifact,
            files: describeAssetImplementationBackingResourceFiles(bundle),
            createdAt: release.createdAt,
            createdBy: "system",
          });
        }

        const existingBinding = await repository.readBinding(seed.bindingId);
        if (existingBinding) {
          if (!matchesTrustedSeedBinding(existingBinding, seed)) {
            throw new Error(
              "Trusted built-in implementation binding is incompatible.",
            );
          }
        } else {
          const bound = await bindRelease.execute({
            bindingId: seed.bindingId,
            definitionRef: seed.definitionRef,
            releaseId: seed.releaseId,
            priority: 1000,
            actorId: "system",
          });
          if (!bound.ok) throw new Error(bound.error.message);
        }
      }
    },
    resolveTrustedBuiltIn(
      workspaceId: WorkspaceId,
      deploymentProfile: AssetImplementationDeploymentProfile,
      definitionRef: AssetReference,
    ) {
      const request: AssetImplementationResolutionRequest = {
        workspaceId,
        definitionRef,
        requiredFacets: ["ui"],
        deploymentProfile,
        availableCapabilities: [],
        permittedTrustLevels: ["system-trusted"],
        hostApiVersion: "1.0.0",
      };
      return useCases.resolve.execute(request);
    },
    resolveFoundationDefault(
      workspaceId: WorkspaceId,
      deploymentProfile: AssetImplementationDeploymentProfile,
      definitionRef: AssetReference,
      requiredFacet: AssetImplementationFacetKind,
    ) {
      const request: AssetImplementationResolutionRequest = {
        workspaceId,
        definitionRef,
        requiredFacets: [requiredFacet],
        deploymentProfile,
        availableCapabilities: [],
        permittedTrustLevels: ["system-trusted"],
        hostApiVersion: "1.0.0",
      };
      return useCases.resolve.execute(request);
    },
  };
}

export type AssetImplementationKernelComposition = ReturnType<
  typeof composeAssetImplementationKernel
>;

function trustedSeedFacet(seed: TrustedBuiltInImplementationSeed) {
  return {
    facetId: normalizeAssetImplementationFacetId(
      `facet.${seed.releaseId}.${seed.facetKind}`,
    ),
    kind: seed.facetKind,
    runtimeKind: seed.runtimeKind,
    entryKey: seed.entryKey,
    requiredCapabilities: [],
    compatibility: {
      definitionVersion: seed.definitionRef.version!,
      hostApiRange: ">=1.0.0 <2.0.0",
      deploymentProfiles: seed.deploymentProfiles,
    },
  };
}

function matchesTrustedSeedRelease(
  release: AssetImplementationRelease,
  seed: TrustedBuiltInImplementationSeed,
): boolean {
  const facet = release.facets[0];
  const expectedFacet = trustedSeedFacet(seed);
  return (
    release.workspaceId === undefined &&
    release.organizationId === undefined &&
    release.definitionRef.kind === seed.definitionRef.kind &&
    release.definitionRef.id === seed.definitionRef.id &&
    release.definitionRef.version === seed.definitionRef.version &&
    release.version === seed.version &&
    release.status === "published" &&
    release.trustLevel === "system-trusted" &&
    release.packageDigest === seed.packageDigest &&
    release.publishedBy === "system" &&
    release.sourceSnapshotId === undefined &&
    release.sourceBuildId === undefined &&
    release.evidenceArtifacts.length === 0 &&
    release.facets.length === 1 &&
    facet?.facetId === expectedFacet.facetId &&
    facet.kind === expectedFacet.kind &&
    facet.runtimeKind === expectedFacet.runtimeKind &&
    facet.entryKey === expectedFacet.entryKey &&
    facet.artifact === undefined &&
    facet.requiredCapabilities.length === 0 &&
    facet.compatibility.definitionVersion ===
      expectedFacet.compatibility.definitionVersion &&
    facet.compatibility.hostApiRange ===
      expectedFacet.compatibility.hostApiRange &&
    facet.compatibility.runtimeAbiRange === undefined &&
    sameStrings(
      facet.compatibility.deploymentProfiles,
      expectedFacet.compatibility.deploymentProfiles,
    )
  );
}

function matchesTrustedSeedBinding(
  binding: AssetImplementationBinding,
  seed: TrustedBuiltInImplementationSeed,
): boolean {
  return (
    binding.workspaceId === undefined &&
    binding.organizationId === undefined &&
    binding.definitionRef.kind === seed.definitionRef.kind &&
    binding.definitionRef.id === seed.definitionRef.id &&
    binding.definitionRef.version === seed.definitionRef.version &&
    binding.releaseId === seed.releaseId &&
    binding.status === "active" &&
    binding.priority === 1000 &&
    binding.revision === 1 &&
    binding.approvedBy === "system"
  );
}

function sameStrings(
  left: readonly string[],
  right: readonly string[],
): boolean {
  if (left.length !== right.length) return false;
  const sortedLeft = [...left].sort();
  const sortedRight = [...right].sort();
  return sortedLeft.every((value, index) => value === sortedRight[index]);
}
