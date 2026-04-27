import {
  normalizeStorageArtifactKey,
  type StorageArtifactKey,
} from "./storage-artifact-key";

export interface ArtifactObjectStorageLocator {
  storageKey: StorageArtifactKey;
}

export function normalizeArtifactObjectStorageLocator(
  locator: ArtifactObjectStorageLocator,
): ArtifactObjectStorageLocator {
  return {
    storageKey: normalizeStorageArtifactKey(locator.storageKey),
  };
}
