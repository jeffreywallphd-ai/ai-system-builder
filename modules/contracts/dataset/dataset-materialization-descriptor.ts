import {
  normalizeStorageArtifactKey,
  type StorageArtifactKey,
} from "../storage";

export interface DatasetMaterializationDescriptor {
  artifactKey: StorageArtifactKey;
  format?: string;
  rowCount?: number;
  materializedAt?: string;
}

function normalizeOptionalText(value: string | undefined): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

export function normalizeDatasetMaterializationDescriptor(
  descriptor: DatasetMaterializationDescriptor,
): DatasetMaterializationDescriptor {
  return {
    ...descriptor,
    artifactKey: normalizeStorageArtifactKey(descriptor.artifactKey),
    format: normalizeOptionalText(descriptor.format),
    materializedAt: normalizeOptionalText(descriptor.materializedAt),
  };
}
