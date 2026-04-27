import {
  normalizeStorageZoneKind,
  type StorageZoneKind,
} from "./storage-zone-kind";

export const STORAGE_INSTANCE_KINDS = ["filesystem", "object-storage", "memory"] as const;

export type StorageInstanceKind = (typeof STORAGE_INSTANCE_KINDS)[number];

export interface StorageInstanceReference {
  /** Zone is intrinsic to the storage instance, not per-artifact placement. */
  id: string;
  kind: StorageInstanceKind;
  zone?: StorageZoneKind;
}

function normalizeRequiredText(value: string, label: string): string {
  const normalized = value.trim();

  if (normalized.length < 1) {
    throw new Error(`${label} must be a non-empty string. Received "${value}".`);
  }

  return normalized;
}

export function isStorageInstanceKind(value: string): value is StorageInstanceKind {
  return STORAGE_INSTANCE_KINDS.includes(value as StorageInstanceKind);
}

export function normalizeStorageInstanceKind(value: string): StorageInstanceKind {
  const normalized = value.trim().toLowerCase();

  if (!isStorageInstanceKind(normalized)) {
    throw new Error(
      `Storage instance kind must be one of ${STORAGE_INSTANCE_KINDS.join(", ")}. Received "${value}".`,
    );
  }

  return normalized;
}

export function normalizeStorageInstanceReference(
  reference: StorageInstanceReference,
): StorageInstanceReference {
  return {
    ...reference,
    id: normalizeRequiredText(reference.id, "Storage instance id"),
    kind: normalizeStorageInstanceKind(reference.kind),
    zone:
      typeof reference.zone === "string"
        ? normalizeStorageZoneKind(reference.zone)
        : undefined,
  };
}
