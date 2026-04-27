import {
  normalizeStorageArtifactKey,
  type StorageArtifactKey,
  type StorageObjectChecksum,
} from "../storage";

export interface StagedArtifactStorageReference {
  key: StorageArtifactKey;
  mediaType?: string;
  sizeBytes?: number;
  checksum?: StorageObjectChecksum;
}

export interface StagedArtifactStorageReferenceInput {
  key?: string;
  mediaType?: string;
  sizeBytes?: number;
  checksum?: StorageObjectChecksum;
}

export function normalizeStagedArtifactStorageReference(
  reference: StagedArtifactStorageReference,
): StagedArtifactStorageReference {
  return {
    ...reference,
    key: normalizeStorageArtifactKey(reference.key),
  };
}
