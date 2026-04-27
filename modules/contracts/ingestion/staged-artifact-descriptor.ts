import { type StorageObjectDescriptor } from "../storage";
import {
  normalizeIngestionSourceKind,
  type IngestionSourceKind,
} from "./ingestion-source-kind";
import {
  normalizeStagedArtifactStorageReference,
  type StagedArtifactStorageReference,
  type StagedArtifactStorageReferenceInput,
} from "./staged-artifact-storage-reference";

export type StagedArtifactMetadata = Readonly<Record<string, unknown>>;

/**
 * Canonical ingestion/staging contract for inbound artifacts; narrower than the general artifact contract.
 */
export interface StagedArtifactDescriptor<
  TMetadata extends StagedArtifactMetadata = StagedArtifactMetadata,
> {
  id?: string;
  sourceKind: IngestionSourceKind;
  originalName?: string;
  createdAt?: string;
  metadata?: TMetadata;
  storage: StagedArtifactStorageReference;
}

export interface StagedArtifactDescriptorInput<
  TMetadata extends StagedArtifactMetadata = StagedArtifactMetadata,
> {
  id?: string;
  sourceKind?: IngestionSourceKind | string;
  originalName?: string;
  createdAt?: string;
  metadata?: TMetadata;
  storage?: StagedArtifactStorageReferenceInput;
}

function normalizeOptionalText(value: string | undefined): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

export function normalizeStagedArtifactDescriptor<
  TMetadata extends StagedArtifactMetadata = StagedArtifactMetadata,
>(
  descriptor: StagedArtifactDescriptor<TMetadata>,
): StagedArtifactDescriptor<TMetadata> {
  return {
    ...descriptor,
    id: normalizeOptionalText(descriptor.id),
    sourceKind: normalizeIngestionSourceKind(descriptor.sourceKind),
    originalName: normalizeOptionalText(descriptor.originalName),
    createdAt: normalizeOptionalText(descriptor.createdAt),
    storage: normalizeStagedArtifactStorageReference(descriptor.storage),
  };
}

export function normalizeStagedArtifactDescriptorInput<
  TMetadata extends StagedArtifactMetadata = StagedArtifactMetadata,
>(
  descriptor?: StagedArtifactDescriptorInput<TMetadata>,
): StagedArtifactDescriptorInput<TMetadata> {
  if (!descriptor) {
    return {};
  }

  let normalizedStorage: StagedArtifactStorageReferenceInput | undefined;
  if (descriptor.storage) {
    normalizedStorage = {
      ...descriptor.storage,
      key:
        typeof descriptor.storage.key === "string"
          ? normalizeStagedArtifactStorageReference({
              key: descriptor.storage.key,
              mediaType: descriptor.storage.mediaType,
              sizeBytes: descriptor.storage.sizeBytes,
              checksum: descriptor.storage.checksum,
            }).key
          : undefined,
    };
  }

  return {
    ...descriptor,
    id: normalizeOptionalText(descriptor.id),
    sourceKind:
      typeof descriptor.sourceKind === "string"
        ? normalizeIngestionSourceKind(descriptor.sourceKind)
        : undefined,
    originalName: normalizeOptionalText(descriptor.originalName),
    createdAt: normalizeOptionalText(descriptor.createdAt),
    storage: normalizedStorage,
  };
}

export function createStagedArtifactDescriptorFromStorageObjectDescriptor<
  TMetadata extends StagedArtifactMetadata = StagedArtifactMetadata,
>(
  descriptor: StorageObjectDescriptor<TMetadata>,
  options: {
    sourceKind: IngestionSourceKind;
    originalName?: string;
    id?: string;
    createdAt?: string;
  },
): StagedArtifactDescriptor<TMetadata> {
  return normalizeStagedArtifactDescriptor({
    id: options.id,
    sourceKind: options.sourceKind,
    originalName: options.originalName,
    createdAt: options.createdAt,
    metadata: descriptor.metadata,
    storage: {
      key: descriptor.key,
      mediaType: descriptor.mediaType,
      sizeBytes: descriptor.sizeBytes,
      checksum: descriptor.checksum,
    },
  });
}
