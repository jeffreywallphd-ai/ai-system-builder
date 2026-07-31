import type { AssetImplementationArtifactId } from "./asset-implementation-identity";

export const ASSET_IMPLEMENTATION_ARTIFACT_KINDS = [
  "source",
  "package",
  "bundle",
  "sbom",
  "provenance",
  "evidence",
  "log",
] as const;
export type AssetImplementationArtifactKind =
  (typeof ASSET_IMPLEMENTATION_ARTIFACT_KINDS)[number];

export type Sha256Digest = `sha256:${string}`;

export interface AssetImplementationArtifactDescriptor {
  readonly artifactId: AssetImplementationArtifactId;
  readonly kind: AssetImplementationArtifactKind;
  readonly digest: Sha256Digest;
  readonly mediaType: string;
  readonly sizeBytes: number;
}

export function normalizeSha256Digest(value: string): Sha256Digest {
  const normalized = value.trim().toLowerCase();
  if (!/^sha256:[a-f0-9]{64}$/.test(normalized))
    throw new Error("Digest must be a sha256 digest.");
  return normalized as Sha256Digest;
}

export function normalizeAssetImplementationArtifactKind(
  value: string,
): AssetImplementationArtifactKind {
  const normalized = value
    .trim()
    .toLowerCase() as AssetImplementationArtifactKind;
  if (!ASSET_IMPLEMENTATION_ARTIFACT_KINDS.includes(normalized))
    throw new Error(`Artifact kind is unsupported: ${value}.`);
  return normalized;
}
