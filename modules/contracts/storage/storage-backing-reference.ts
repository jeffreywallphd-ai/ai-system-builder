import {
  normalizeStorageKind,
  type StorageKind,
} from "./storage-kind";
import {
  normalizeStorageProviderId,
  type StorageProviderId,
} from "./storage-provider-id";
import {
  normalizeArtifactRepoTarget,
  type ArtifactRepoTarget,
} from "./artifact-repo-target";

export interface StorageBackingReference {
  kind: StorageKind;
  provider: StorageProviderId;
  locator: string;
  revision?: string;
  target?: ArtifactRepoTarget;
  verification?: {
    exists: boolean;
    verifiedAt?: string;
  };
}

function normalizeOptionalText(value: string | undefined): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

export function normalizeStorageBackingReference(
  reference: StorageBackingReference,
): StorageBackingReference {
  const locator = reference.locator.trim();

  if (locator.length < 1) {
    throw new Error("Storage backing locator must be a non-empty string.");
  }

  const target = reference.target
    ? normalizeArtifactRepoTarget({
      ...reference.target,
      provider: reference.target.provider ?? reference.provider,
    })
    : undefined;
  const verification = reference.verification
    ? {
      exists: reference.verification.exists,
      verifiedAt: normalizeOptionalText(reference.verification.verifiedAt),
    }
    : undefined;

  return {
    kind: normalizeStorageKind(reference.kind),
    provider: normalizeStorageProviderId(reference.provider),
    locator,
    revision: normalizeOptionalText(reference.revision),
    ...(target ? { target } : {}),
    ...(verification ? { verification } : {}),
  };
}
