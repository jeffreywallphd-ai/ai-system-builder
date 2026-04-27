export interface ArtifactFormatMetadata {
  mediaType?: string;
  encoding?: string;
  extension?: string;
}

function normalizeOptionalText(value: string | undefined): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

export function normalizeArtifactFormatMetadata(
  metadata?: ArtifactFormatMetadata,
): ArtifactFormatMetadata | undefined {
  if (!metadata) {
    return undefined;
  }

  return {
    mediaType: normalizeOptionalText(metadata.mediaType),
    encoding: normalizeOptionalText(metadata.encoding),
    extension: normalizeOptionalText(metadata.extension),
  };
}
