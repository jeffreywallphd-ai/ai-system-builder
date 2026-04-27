export const STORAGE_ZONE_KINDS = [
  "ingestion",
  "staging",
  "derived",
  "dataset",
] as const;

export type StorageZoneKind = (typeof STORAGE_ZONE_KINDS)[number];

export function isStorageZoneKind(value: string): value is StorageZoneKind {
  return STORAGE_ZONE_KINDS.includes(value as StorageZoneKind);
}

export function normalizeStorageZoneKind(value: string): StorageZoneKind {
  const normalized = value.trim().toLowerCase();

  if (!isStorageZoneKind(normalized)) {
    throw new Error(
      `Storage zone kind must be one of ${STORAGE_ZONE_KINDS.join(", ")}. Received "${value}".`,
    );
  }

  return normalized;
}
