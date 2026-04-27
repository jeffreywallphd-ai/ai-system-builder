export const STORAGE_KINDS = ["artifact-object", "artifact-repo"] as const;

export type StorageKind = (typeof STORAGE_KINDS)[number];

export function isStorageKind(value: string): value is StorageKind {
  return STORAGE_KINDS.includes(value as StorageKind);
}

export function normalizeStorageKind(value: string): StorageKind {
  const normalized = value.trim().toLowerCase();

  if (!isStorageKind(normalized)) {
    throw new Error(
      `Storage kind must be one of ${STORAGE_KINDS.join(", ")}. Received "${value}".`,
    );
  }

  return normalized;
}
