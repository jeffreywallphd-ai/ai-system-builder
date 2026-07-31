import type { AssetMetadata } from "./asset-metadata";
import type { AssetReference } from "./asset-reference";

export const ASSET_PROVENANCE_SOURCE_KINDS = [
  "human-authored",
  "ai-generated",
  "imported",
  "runtime-generated",
  "system-generated",
] as const;

export type AssetProvenanceSourceKind =
  (typeof ASSET_PROVENANCE_SOURCE_KINDS)[number];

export interface AssetProvenance {
  readonly createdAt?: string;
  readonly updatedAt?: string;
  readonly createdBy?: string;
  readonly updatedBy?: string;
  readonly sourceKind: AssetProvenanceSourceKind;
  readonly sourceAssetRefs?: readonly AssetReference[];
  readonly sourceResourceRefs?: readonly AssetReference[];
  readonly derivedFromRefs?: readonly AssetReference[];
  readonly authorship?: "human-authored" | "ai-generated" | "mixed" | "unknown";
  readonly generationContextRefs?: readonly AssetReference[];
  readonly redactedGenerationSummary?: string;
  readonly metadata?: AssetMetadata;
}

export function isAssetProvenanceSourceKind(
  value: string,
): value is AssetProvenanceSourceKind {
  return ASSET_PROVENANCE_SOURCE_KINDS.includes(
    value as AssetProvenanceSourceKind,
  );
}

export function normalizeAssetProvenanceSourceKind(
  value: string,
): AssetProvenanceSourceKind {
  const normalized = value.trim().toLowerCase();

  if (!isAssetProvenanceSourceKind(normalized)) {
    throw new Error(
      `Asset provenance source kind must be one of ${ASSET_PROVENANCE_SOURCE_KINDS.join(", ")}. Received "${value}".`,
    );
  }

  return normalized;
}
