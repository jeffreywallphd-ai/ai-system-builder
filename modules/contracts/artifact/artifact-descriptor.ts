import {
  normalizeStorageArtifactKey,
  type StorageObjectChecksum,
  type StorageArtifactKey,
} from "../storage";
import type {
  StagedArtifactDescriptor,
  StagedArtifactMetadata,
} from "../ingestion";
import {
  normalizeArtifactFormatMetadata,
  type ArtifactFormatMetadata,
} from "./artifact-format-metadata";
import { normalizeArtifactKind, type ArtifactKind } from "./artifact-kind";
import {
  normalizeArtifactProvenance,
  type ArtifactProvenance,
} from "./artifact-provenance";

export type ArtifactMetadata = Readonly<Record<string, unknown>>;

/**
 * General cross-family artifact descriptor; broader than ingestion-specific staged artifact descriptors.
 */
export interface ArtifactDescriptor<
  TMetadata extends ArtifactMetadata = ArtifactMetadata,
> {
  key: StorageArtifactKey;
  kind: ArtifactKind;
  id?: string;
  name?: string;
  createdAt?: string;
  updatedAt?: string;
  sizeBytes?: number;
  checksum?: StorageObjectChecksum;
  format?: ArtifactFormatMetadata;
  provenance?: ArtifactProvenance;
  metadata?: TMetadata;
}

function normalizeOptionalText(value: string | undefined): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

export function normalizeArtifactDescriptor<
  TMetadata extends ArtifactMetadata = ArtifactMetadata,
>(
  descriptor: ArtifactDescriptor<TMetadata>,
): ArtifactDescriptor<TMetadata> {
  return {
    ...descriptor,
    key: normalizeStorageArtifactKey(descriptor.key),
    kind: normalizeArtifactKind(descriptor.kind),
    id: normalizeOptionalText(descriptor.id),
    name: normalizeOptionalText(descriptor.name),
    createdAt: normalizeOptionalText(descriptor.createdAt),
    updatedAt: normalizeOptionalText(descriptor.updatedAt),
    format: normalizeArtifactFormatMetadata(descriptor.format),
    provenance: normalizeArtifactProvenance(descriptor.provenance),
  };
}

export function createArtifactDescriptorFromStagedArtifactDescriptor<
  TMetadata extends StagedArtifactMetadata = StagedArtifactMetadata,
>(
  descriptor: StagedArtifactDescriptor<TMetadata>,
): ArtifactDescriptor<TMetadata> {
  return normalizeArtifactDescriptor({
    key: descriptor.storage.key,
    kind: "raw-staged",
    id: descriptor.id,
    name: descriptor.originalName,
    createdAt: descriptor.createdAt,
    sizeBytes: descriptor.storage.sizeBytes,
    checksum: descriptor.storage.checksum,
    format: {
      mediaType: descriptor.storage.mediaType,
    },
    provenance: {
      sourceKind: descriptor.sourceKind,
      sourceId: descriptor.id,
    },
    metadata: descriptor.metadata,
  });
}
