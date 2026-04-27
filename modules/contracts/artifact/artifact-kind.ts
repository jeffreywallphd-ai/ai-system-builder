/**
 * ArtifactKind captures lifecycle/derivation state only.
 *
 * - raw-staged: inbound staged artifact as received through ingestion.
 * - transformed: artifact produced by transform execution.
 * - materialized: artifact persisted as a dataset/output materialization.
 */
export const ARTIFACT_KINDS = [
  "raw-staged",
  "transformed",
  "materialized",
] as const;

export type ArtifactKind = (typeof ARTIFACT_KINDS)[number];

export function isArtifactKind(value: string): value is ArtifactKind {
  return ARTIFACT_KINDS.includes(value as ArtifactKind);
}

export function normalizeArtifactKind(value: string): ArtifactKind {
  const normalized = value.trim().toLowerCase();

  if (!isArtifactKind(normalized)) {
    throw new Error(
      `Artifact kind must be one of ${ARTIFACT_KINDS.join(", ")}. Received "${value}".`,
    );
  }

  return normalized;
}
