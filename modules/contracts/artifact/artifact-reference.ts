import {
  normalizeStorageArtifactKey,
  type StorageArtifactKey,
} from "../storage";

export interface ArtifactReference {
  key: StorageArtifactKey;
  label?: string;
}

function normalizeOptionalText(value: string | undefined): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

export function normalizeArtifactReference(
  reference: ArtifactReference,
): ArtifactReference {
  return {
    ...reference,
    key: normalizeStorageArtifactKey(reference.key),
    label: normalizeOptionalText(reference.label),
  };
}
