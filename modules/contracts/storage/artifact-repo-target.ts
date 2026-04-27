import {
  normalizeStorageProviderId,
  type StorageProviderId,
} from "./storage-provider-id";

export interface ArtifactRepoTarget {
  provider: StorageProviderId;
  repository: string;
  revision?: string;
  path?: string;
}

function normalizeOptionalText(value: string | undefined): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

export function normalizeArtifactRepoTarget(
  target: ArtifactRepoTarget,
): ArtifactRepoTarget {
  const repository = target.repository.trim();

  if (repository.length < 1) {
    throw new Error("Artifact repo target repository must be a non-empty string.");
  }

  return {
    provider: normalizeStorageProviderId(target.provider),
    repository,
    revision: normalizeOptionalText(target.revision),
    path: normalizeOptionalText(target.path),
  };
}
