import {
  normalizeStorageArtifactKey,
  type StorageArtifactKey,
} from "../storage";

export interface ArtifactBrowserLocator {
  storageKey: StorageArtifactKey;
}

export function normalizeArtifactBrowserLocator(
  locator: ArtifactBrowserLocator,
): ArtifactBrowserLocator {
  return {
    storageKey: normalizeStorageArtifactKey(locator.storageKey),
  };
}

export function createArtifactBrowserLocator(storageKey: string): ArtifactBrowserLocator {
  return normalizeArtifactBrowserLocator({ storageKey });
}
