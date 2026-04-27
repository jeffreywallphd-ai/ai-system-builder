export const ARTIFACT_FAMILIES = [
  "image",
  "document",
  "text",
  "structured-text",
  "tabular",
  "binary",
] as const;

export type ArtifactFamily = (typeof ARTIFACT_FAMILIES)[number];

const ARTIFACT_FAMILY_SET = new Set<string>(ARTIFACT_FAMILIES);

export function normalizeArtifactFamily(value: string): ArtifactFamily {
  const normalized = value.trim().toLowerCase();
  if (ARTIFACT_FAMILY_SET.has(normalized)) {
    return normalized as ArtifactFamily;
  }

  throw new Error(`Artifact family must be one of: ${ARTIFACT_FAMILIES.join(", ")}. Received: ${value}`);
}
