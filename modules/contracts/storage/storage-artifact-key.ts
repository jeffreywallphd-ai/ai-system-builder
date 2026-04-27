export const STORAGE_ARTIFACT_KEY_FORMAT_DESCRIPTION =
  "a non-empty, trimmed string key that remains path-agnostic";

export type StorageArtifactKey = string;

function invalidStorageArtifactKeyMessage(key: string): string {
  return `Storage artifact key must be ${STORAGE_ARTIFACT_KEY_FORMAT_DESCRIPTION}. Received "${key}".`;
}

export function isStorageArtifactKey(key: string): key is StorageArtifactKey {
  return key.trim().length > 0;
}

export function normalizeStorageArtifactKey(key: string): StorageArtifactKey {
  const normalizedKey = key.trim();

  if (!isStorageArtifactKey(normalizedKey)) {
    throw new Error(invalidStorageArtifactKeyMessage(key));
  }

  return normalizedKey;
}
