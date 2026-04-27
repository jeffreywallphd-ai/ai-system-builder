import type { ApplicationRequestContext } from "../../../application/ports";
import type { ArtifactRepoStoragePort } from "../../../application/ports/storage";
import {
  createContractError,
} from "../../../contracts/shared";
import {
  createHasArtifactInRepoFailureResult,
  createRetrieveArtifactFromRepoFailureResult,
  createStoreArtifactInRepoFailureResult,
  normalizeStorageProviderId,
  type HasArtifactInRepoRequest,
  type RetrieveArtifactFromRepoRequest,
  type StoreArtifactInRepoRequest,
  type StorageProviderId,
} from "../../../contracts/storage";

export type ArtifactRepoStorageProviderAdapter = ArtifactRepoStoragePort;

export interface CreateArtifactRepoStorageAdapterOptions {
  providers: ReadonlyArray<{
    provider: StorageProviderId;
    adapter: ArtifactRepoStorageProviderAdapter;
  }>;
}

function createProviderNotConfiguredError(provider: StorageProviderId) {
  return createContractError(
    "unavailable",
    `Artifact-repo storage provider "${provider}" is not configured.`,
  );
}

function resolveProviderAdapter(
  providers: ReadonlyMap<StorageProviderId, ArtifactRepoStorageProviderAdapter>,
  provider: StorageProviderId,
): ArtifactRepoStorageProviderAdapter | undefined {
  return providers.get(normalizeStorageProviderId(provider));
}

export function createArtifactRepoStorageAdapter(
  options: CreateArtifactRepoStorageAdapterOptions,
): ArtifactRepoStoragePort {
  const providers = new Map<StorageProviderId, ArtifactRepoStorageProviderAdapter>();
  for (const providerEntry of options.providers) {
    const provider = normalizeStorageProviderId(providerEntry.provider);
    providers.set(provider, providerEntry.adapter);
  }

  return {
    async storeArtifactInRepo(
      request: StoreArtifactInRepoRequest,
      context: ApplicationRequestContext = {},
    ) {
      const providerAdapter = resolveProviderAdapter(providers, request.target.provider);
      if (!providerAdapter) {
        return createStoreArtifactInRepoFailureResult(
          createProviderNotConfiguredError(request.target.provider),
          context,
        );
      }

      return providerAdapter.storeArtifactInRepo(request, context);
    },

    async retrieveArtifactFromRepo(
      request: RetrieveArtifactFromRepoRequest,
      context: ApplicationRequestContext = {},
    ) {
      const providerAdapter = resolveProviderAdapter(providers, request.target.provider);
      if (!providerAdapter) {
        return createRetrieveArtifactFromRepoFailureResult(
          createProviderNotConfiguredError(request.target.provider),
          context,
        );
      }

      return providerAdapter.retrieveArtifactFromRepo(request, context);
    },

    async hasArtifactInRepo(
      request: HasArtifactInRepoRequest,
      context: ApplicationRequestContext = {},
    ) {
      const providerAdapter = resolveProviderAdapter(providers, request.target.provider);
      if (!providerAdapter) {
        return createHasArtifactInRepoFailureResult(
          createProviderNotConfiguredError(request.target.provider),
          context,
        );
      }

      return providerAdapter.hasArtifactInRepo(request, context);
    },
  };
}
