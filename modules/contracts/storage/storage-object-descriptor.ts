import { normalizeStorageArtifactKey, type StorageArtifactKey } from "./storage-artifact-key";

export type StorageObjectMetadata = Readonly<Record<string, unknown>>;

export interface StorageObjectChecksum {
  algorithm: string;
  value: string;
}

export interface StorageObjectDescriptor<
  TMetadata extends StorageObjectMetadata = StorageObjectMetadata,
> {
  key: StorageArtifactKey;
  mediaType?: string;
  sizeBytes?: number;
  checksum?: StorageObjectChecksum;
  metadata?: TMetadata;
}

export interface StorageObjectDescriptorInput<
  TMetadata extends StorageObjectMetadata = StorageObjectMetadata,
> {
  key?: string;
  sizeBytes?: number;
  mediaType?: string;
  checksum?: StorageObjectChecksum;
  metadata?: TMetadata;
}

export function normalizeStorageObjectDescriptor<
  TMetadata extends StorageObjectMetadata = StorageObjectMetadata,
>(
  descriptor: StorageObjectDescriptor<TMetadata>,
): StorageObjectDescriptor<TMetadata> {
  return {
    ...descriptor,
    key: normalizeStorageArtifactKey(descriptor.key),
  };
}

export function normalizeStorageObjectDescriptorInput<
  TMetadata extends StorageObjectMetadata = StorageObjectMetadata,
>(
  descriptor?: StorageObjectDescriptorInput<TMetadata>,
): StorageObjectDescriptorInput<TMetadata> {
  if (!descriptor) {
    return {};
  }

  if (typeof descriptor.key !== "string") {
    return descriptor;
  }

  return {
    ...descriptor,
    key: normalizeStorageArtifactKey(descriptor.key),
  };
}
