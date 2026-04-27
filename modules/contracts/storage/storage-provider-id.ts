/**
 * Provider identity for specialized storage families.
 * Examples: local-filesystem, huggingface, github.
 */
export type StorageProviderId = string;

export function normalizeStorageProviderId(value: string): StorageProviderId {
  const normalized = value.trim().toLowerCase();

  if (normalized.length < 1) {
    throw new Error(
      `Storage provider id must be a non-empty string. Received "${value}".`,
    );
  }

  if (!/^[a-z0-9][a-z0-9-]*$/.test(normalized)) {
    throw new Error(
      `Storage provider id must be lowercase alphanumeric with optional dashes. Received "${value}".`,
    );
  }

  return normalized;
}
