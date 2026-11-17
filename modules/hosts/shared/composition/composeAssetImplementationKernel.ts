import { types } from "node:util";
import { captureAssetPackFingerprintInput } from "../../../application/services/asset-packs/asset-pack-fingerprint-input";
import type { AssetDefinitionRepositoryPort } from "../../../application/ports/asset";
import {
  readSystemFoundationBackingResourceBundle,
  SYSTEM_FOUNDATION_FUNCTIONAL_DEFAULTS,
  SYSTEM_FOUNDATION_V2_FUNCTIONAL_DEFAULTS,
  SYSTEM_FOUNDATION_V3_FUNCTIONAL_DEFAULTS,
} from "../../../application/services/asset-packs";
import type {
  AssetImplementationArtifactPort,
  AssetImplementationBuilderPort,
} from "../../../application/ports/asset-implementation";
import type { AssetPackageRepositoryPort } from "../../../application/ports/asset-package";
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
  type AssetImplementationBackingResourceRecord,
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

/** Exact, closed implementation bindings for the immutable 1.0.0 release. */
export const SYSTEM_FOUNDATION_TRUSTED_IMPLEMENTATION_SEEDS: readonly TrustedBuiltInImplementationSeed[] =
  createFoundationTrustedImplementationSeeds(
    SYSTEM_FOUNDATION_FUNCTIONAL_DEFAULTS,
    "1",
  );

/** Exact, independently addressable implementation bindings for 2.0.0. */
export const SYSTEM_FOUNDATION_V2_TRUSTED_IMPLEMENTATION_SEEDS: readonly TrustedBuiltInImplementationSeed[] =
  createFoundationTrustedImplementationSeeds(
    SYSTEM_FOUNDATION_V2_FUNCTIONAL_DEFAULTS,
    "2",
  );

/** Exact, independently addressable implementation bindings for 3.0.0. */
export const SYSTEM_FOUNDATION_V3_TRUSTED_IMPLEMENTATION_SEEDS: readonly TrustedBuiltInImplementationSeed[] =
  createFoundationTrustedImplementationSeeds(
    SYSTEM_FOUNDATION_V3_FUNCTIONAL_DEFAULTS,
    "3",
  );

export const DEFAULT_TRUSTED_ASSET_IMPLEMENTATION_SEEDS: readonly TrustedBuiltInImplementationSeed[] =
  [
    ...SYSTEM_FOUNDATION_TRUSTED_IMPLEMENTATION_SEEDS,
    ...SYSTEM_FOUNDATION_V2_TRUSTED_IMPLEMENTATION_SEEDS,
    ...SYSTEM_FOUNDATION_V3_TRUSTED_IMPLEMENTATION_SEEDS,
  ];

function createFoundationTrustedImplementationSeeds(
  descriptors: typeof SYSTEM_FOUNDATION_FUNCTIONAL_DEFAULTS,
  releaseGeneration: string,
): readonly TrustedBuiltInImplementationSeed[] {
  return descriptors.map((descriptor) => {
    const identity = descriptor.definitionId.replace(/[^a-zA-Z0-9._:-]/g, "-");
    return {
      definitionRef: {
        kind: "asset-definition-version",
        id: normalizeAssetId(descriptor.definitionId),
        version: descriptor.definitionVersion,
      },
      releaseId: normalizeAssetImplementationReleaseId(
        `implementation-release.${identity}.${releaseGeneration}`,
      ),
      bindingId: normalizeAssetImplementationBindingId(
        `implementation-binding.${identity}.${releaseGeneration}`,
      ),
      version: descriptor.definitionVersion,
      entryKey: descriptor.entryKey,
      facetKind: descriptor.facetKind,
      runtimeKind: descriptor.runtimeKind,
      deploymentProfiles: descriptor.deploymentProfiles,
      packageDigest: DEFAULT_PACKAGE_DIGEST,
    };
  });
}

export interface ComposeAssetImplementationKernelOptions {
  readonly documents: StructuredDocumentStore;
  readonly definitions: AssetDefinitionRepositoryPort;
  readonly artifacts?: AssetImplementationArtifactPort;
  readonly builder?: AssetImplementationBuilderPort;
  readonly trustedSeeds?: readonly TrustedBuiltInImplementationSeed[];
  readonly now?: () => string;
  readonly createRevocationId?: () => string;
  readonly packageRepository?: Pick<AssetPackageRepositoryPort, "listPackages">;
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
    resolve: new ResolveAssetImplementationUseCase(
      repository,
      options.packageRepository,
    ),
    listReleases: new ListAssetImplementationReleasesUseCase(repository),
  };

  const platformOwner = Symbol("platform-owner");
  const trustedInitializations = new Map<string | symbol, Promise<void>>();
  const exactKey = (reference: AssetReference) => JSON.stringify([reference.kind, reference.id, reference.version ?? null]);
  async function initializeTrustedBuiltIns(owner: typeof options.documents.organizationId): Promise<void> {
    const operationDocuments = owner ? options.documents.forOrganization(owner) : options.documents;
    const operationRepository = createStructuredAssetImplementationRepository(operationDocuments);
    const operationBacking = createStructuredAssetImplementationBackingResourceRepository(operationDocuments);
    const assertOwner = () => { if (options.documents.organizationId !== owner) throw new Error("Trusted initialization owner changed."); };
    const seeds = options.trustedSeeds ?? DEFAULT_TRUSTED_ASSET_IMPLEMENTATION_SEEDS;
    const existingReleases = new Map();
    const missing = [];
    for (const seed of seeds) {
      assertOwner();
      const release = await operationRepository.readRelease(seed.releaseId);
      if (release && !matchesTrustedSeedRelease(release, seed)) throw new Error("Trusted built-in implementation release is incompatible.");
      existingReleases.set(seed.releaseId, release);
      if (!release) missing.push(seed);
    }
    // A private exact-version snapshot for this operation only, never a trust cache.
    const snapshot = new Map<string, Awaited<ReturnType<typeof options.definitions.getDefinition>>>();
    for (let offset = 0; offset < missing.length; offset += 250) {
      const refs = missing.slice(offset, offset + 250).map(seed => seed.definitionRef);
      const batch = options.definitions.getDefinitions
        ? await options.definitions.getDefinitions(refs)
        : await (async () => { const values = []; for (const ref of refs) values.push(await options.definitions.getDefinition(ref)); return values; })();
      assertOwner();
      if (types.isProxy(batch) || !Array.isArray(batch) || batch.length !== refs.length) throw new Error("Trusted definition snapshot is unavailable.");
      refs.forEach((ref, index) => {
        const descriptor = Object.getOwnPropertyDescriptor(batch, String(index));
        if (!descriptor || !("value" in descriptor)) throw new Error("Trusted definition snapshot is unavailable.");
        const definition = descriptor.value === undefined ? undefined : captureAssetPackFingerprintInput(descriptor.value) as unknown as Awaited<ReturnType<typeof options.definitions.getDefinition>>;
        if (definition && (definition.definitionId !== ref.id || definition.version !== ref.version)) throw new Error("Trusted definition snapshot is incompatible.");
        snapshot.set(exactKey(ref), definition);
      });
    }
    const operationPublish = new PublishAssetImplementationReleaseUseCase(operationRepository, {
      readExactDefinition: async reference => { assertOwner(); return snapshot.get(exactKey(reference)); },
    }, now);
    const operationBind = new BindAssetImplementationReleaseUseCase(operationRepository, now);
      for (const seed of seeds) {
        assertOwner();
        const existingRelease = existingReleases.get(seed.releaseId);
        if (existingRelease) {
          if (!matchesTrustedSeedRelease(existingRelease, seed)) {
            throw new Error(
              "Trusted built-in implementation release is incompatible.",
            );
          }
        } else {
          const published = await operationPublish.execute({
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

        const release = await operationRepository.readRelease(seed.releaseId);
        if (!release) {
          throw new Error(
            "Trusted built-in implementation release is unavailable.",
          );
        }

        if (options.artifacts) {
          const existingBackingResource = await operationBacking.readByRelease(
            seed.releaseId,
          );
          if (existingBackingResource) {
            if (
              !matchesTrustedSeedBackingResource(existingBackingResource, seed)
            ) {
              throw new Error(
                "Trusted built-in implementation backing resource is incompatible.",
              );
            }
          } else {
            const bundle = readSystemFoundationBackingResourceBundle(
              String(seed.definitionRef.id),
              seed.definitionRef.version,
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
            const releaseGeneration = String(seed.releaseId).split(".").pop();
            if (!releaseGeneration) {
              throw new Error(
                "Trusted built-in implementation release identity is invalid.",
              );
            }
            await operationBacking.save({
              backingResourceId: `implementation-backing.${identity}.${releaseGeneration}`,
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
        }

        const existingBinding = await operationRepository.readBinding(seed.bindingId);
        if (existingBinding) {
          if (!matchesTrustedSeedBinding(existingBinding, seed)) {
            throw new Error(
              "Trusted built-in implementation binding is incompatible.",
            );
          }
        } else {
          const bound = await operationBind.execute({
            bindingId: seed.bindingId,
            definitionRef: seed.definitionRef,
            releaseId: seed.releaseId,
            priority: 1000,
            actorId: "system",
          });
          if (!bound.ok) throw new Error(bound.error.message);
        }
      }
  }

  return {
    repository,
    backingResources,
    useCases,
    async ensureTrustedBuiltIns(): Promise<void> {
      const owner = options.documents.organizationId;
      const key = owner ?? platformOwner;
      const existing = trustedInitializations.get(key);
      if (existing) return existing;
      const attempt = initializeTrustedBuiltIns(owner).finally(() => {
        if (trustedInitializations.get(key) === attempt) trustedInitializations.delete(key);
      });
      trustedInitializations.set(key, attempt);
      return attempt;
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

function matchesTrustedSeedBackingResource(
  record: AssetImplementationBackingResourceRecord,
  seed: TrustedBuiltInImplementationSeed,
): boolean {
  return (
    record.origin === "system-foundation" &&
    record.releaseId === seed.releaseId &&
    record.definitionRef.kind === seed.definitionRef.kind &&
    record.definitionRef.id === seed.definitionRef.id &&
    record.definitionRef.version === seed.definitionRef.version &&
    record.scope === "system" &&
    record.workspaceId === undefined &&
    record.artifactWorkspaceId ===
      SYSTEM_FOUNDATION_BACKING_RESOURCE_WORKSPACE_ID &&
    record.createdBy === "system" &&
    record.files.length > 0 &&
    record.artifact.digest.startsWith("sha256:") &&
    record.files.every(
      (file) =>
        file.path.trim().length > 0 &&
        file.mediaType.trim().length > 0 &&
        Number.isInteger(file.sizeCharacters) &&
        file.sizeCharacters >= 0 &&
        typeof file.editable === "boolean",
    )
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
