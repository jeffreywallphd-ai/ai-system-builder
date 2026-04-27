export interface UnregisteredArtifactBrowseItem {
  storageKey: string;
  relativePath: string;
  fileName: string;
  mediaType?: string;
  sizeBytes?: number;
}

export interface UnregisteredArtifactBrowseSuccessValue {
  items: UnregisteredArtifactBrowseItem[];
}

export interface RegisterUnregisteredArtifactSuccessValue {
  storageKey: string;
}

function normalizeOptionalText(value: string | undefined): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function normalizeRequiredText(value: string, fieldName: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new Error(`${fieldName} must be a non-empty, trimmed string.`);
  }

  return normalized;
}

export function normalizeUnregisteredArtifactBrowseSuccessValue(
  value: UnregisteredArtifactBrowseSuccessValue,
): UnregisteredArtifactBrowseSuccessValue {
  return {
    items: value.items.map((item) => ({
      storageKey: normalizeRequiredText(item.storageKey, "storageKey"),
      relativePath: normalizeRequiredText(item.relativePath, "relativePath"),
      fileName: normalizeRequiredText(item.fileName, "fileName"),
      mediaType: normalizeOptionalText(item.mediaType),
      sizeBytes: typeof item.sizeBytes === "number" ? item.sizeBytes : undefined,
    })),
  };
}
