import {
  normalizeIngestionSourceKind,
  type IngestionSourceKind,
} from "../ingestion";
import {
  normalizeStorageArtifactKey,
  type StorageArtifactKey,
} from "../storage";
import type { StorageObjectMetadata } from "../storage";
import {
  normalizeArtifactFamily,
  type ArtifactFamily,
} from "../../domain/artifact";

export interface ArtifactBrowseItem {
  artifactId: string;
  storageKey: StorageArtifactKey;
  artifactFamily: ArtifactFamily;
  mediaType?: string;
  sizeBytes?: number;
  sourceKind?: IngestionSourceKind;
  originalName?: string;
  createdAt?: string;
  metadata?: StorageObjectMetadata;
}

export interface ArtifactBrowseSuccessValue {
  items: ArtifactBrowseItem[];
}

function normalizeOptionalText(value: string | undefined): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

export function normalizeArtifactBrowseItem(item: ArtifactBrowseItem): ArtifactBrowseItem {
  return {
    ...item,
    artifactId: normalizeStorageArtifactKey(item.artifactId),
    storageKey: normalizeStorageArtifactKey(item.storageKey),
    artifactFamily: normalizeArtifactFamily(item.artifactFamily),
    mediaType: normalizeOptionalText(item.mediaType),
    sourceKind:
      typeof item.sourceKind === "string"
        ? normalizeIngestionSourceKind(item.sourceKind)
        : undefined,
    originalName: normalizeOptionalText(item.originalName),
    createdAt: normalizeOptionalText(item.createdAt),
  };
}

export function normalizeArtifactBrowseSuccessValue(
  value: ArtifactBrowseSuccessValue,
): ArtifactBrowseSuccessValue {
  return {
    items: value.items.map((item) => normalizeArtifactBrowseItem(item)),
  };
}
