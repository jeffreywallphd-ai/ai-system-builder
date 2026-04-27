import {
  normalizeIngestionSourceKind,
  type IngestionSourceKind,
} from "../ingestion";
import {
  type StorageObjectChecksum,
  type StorageObjectMetadata,
} from "../storage";
import {
  normalizeArtifactBrowserLocator,
  type ArtifactBrowserLocator,
} from "./artifact-browser-locator";
import {
  type ArtifactFamily,
  normalizeArtifactFamily,
} from "../../domain/artifact";

export interface ArtifactDetailReadModel<
  TMetadata extends StorageObjectMetadata = StorageObjectMetadata,
> {
  locator: ArtifactBrowserLocator;
  artifactFamily: ArtifactFamily;
  mediaType?: string;
  sizeBytes?: number;
  checksum?: StorageObjectChecksum;
  sourceKind?: IngestionSourceKind;
  originalName?: string;
  createdAt?: string;
  metadata?: TMetadata;
}

export interface ArtifactReadSuccessValue<
  TMetadata extends StorageObjectMetadata = StorageObjectMetadata,
> {
  artifact: ArtifactDetailReadModel<TMetadata>;
}

function normalizeOptionalText(value: string | undefined): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

export function normalizeArtifactDetailReadModel<
  TMetadata extends StorageObjectMetadata = StorageObjectMetadata,
>(
  model: ArtifactDetailReadModel<TMetadata>,
): ArtifactDetailReadModel<TMetadata> {
  return {
    ...model,
    locator: normalizeArtifactBrowserLocator(model.locator),
    artifactFamily: normalizeArtifactFamily(model.artifactFamily),
    mediaType: normalizeOptionalText(model.mediaType),
    sourceKind:
      typeof model.sourceKind === "string"
        ? normalizeIngestionSourceKind(model.sourceKind)
        : undefined,
    originalName: normalizeOptionalText(model.originalName),
    createdAt: normalizeOptionalText(model.createdAt),
  };
}

export function normalizeArtifactReadSuccessValue<
  TMetadata extends StorageObjectMetadata = StorageObjectMetadata,
>(
  value: ArtifactReadSuccessValue<TMetadata>,
): ArtifactReadSuccessValue<TMetadata> {
  return {
    artifact: normalizeArtifactDetailReadModel(value.artifact),
  };
}
