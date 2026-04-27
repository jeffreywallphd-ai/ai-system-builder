import {
  normalizeLineageEdgeKind,
  type LineageEdgeKind,
} from "./lineage-edge-kind";
import {
  normalizeLineageReference,
  type LineageReference,
} from "./lineage-reference";

export type LineageMetadata = Readonly<Record<string, unknown>>;

export interface LineageEdgeRecord<
  TMetadata extends LineageMetadata = LineageMetadata,
> {
  kind: LineageEdgeKind;
  from: LineageReference;
  to: LineageReference;
  recordedAt?: string;
  metadata?: TMetadata;
}

function normalizeOptionalText(value: string | undefined): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

export function normalizeLineageEdgeRecord<
  TMetadata extends LineageMetadata = LineageMetadata,
>(
  edge: LineageEdgeRecord<TMetadata>,
): LineageEdgeRecord<TMetadata> {
  return {
    ...edge,
    kind: normalizeLineageEdgeKind(edge.kind),
    from: normalizeLineageReference(edge.from),
    to: normalizeLineageReference(edge.to),
    recordedAt: normalizeOptionalText(edge.recordedAt),
  };
}
