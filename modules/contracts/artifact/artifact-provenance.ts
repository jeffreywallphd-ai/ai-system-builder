import {
  normalizeIngestionSourceKind,
  type IngestionSourceKind,
} from "../ingestion";
import { normalizeArtifactReference, type ArtifactReference } from "./artifact-reference";
import {
  normalizeTransformReference,
  type TransformReference,
} from "../transform/transform-reference";

export interface ArtifactProvenance {
  sourceKind?: IngestionSourceKind;
  sourceId?: string;
  parentArtifacts?: ArtifactReference[];
  transform?: TransformReference;
}

function normalizeOptionalText(value: string | undefined): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

export function normalizeArtifactProvenance(
  provenance?: ArtifactProvenance,
): ArtifactProvenance | undefined {
  if (!provenance) {
    return undefined;
  }

  return {
    sourceKind:
      typeof provenance.sourceKind === "string"
        ? normalizeIngestionSourceKind(provenance.sourceKind)
        : undefined,
    sourceId: normalizeOptionalText(provenance.sourceId),
    parentArtifacts: provenance.parentArtifacts?.map(normalizeArtifactReference),
    transform: provenance.transform
      ? normalizeTransformReference(provenance.transform)
      : undefined,
  };
}
