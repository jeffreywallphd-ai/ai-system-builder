export const LINEAGE_EDGE_KINDS = [
  "ingested-from",
  "derived-from",
  "transformed-by",
  "produced",
  "materialized-as",
  "stored-in",
] as const;

export type LineageEdgeKind = (typeof LINEAGE_EDGE_KINDS)[number];

export function isLineageEdgeKind(value: string): value is LineageEdgeKind {
  return LINEAGE_EDGE_KINDS.includes(value as LineageEdgeKind);
}

export function normalizeLineageEdgeKind(value: string): LineageEdgeKind {
  const normalized = value.trim().toLowerCase();

  if (!isLineageEdgeKind(normalized)) {
    throw new Error(
      `Lineage edge kind must be one of ${LINEAGE_EDGE_KINDS.join(", ")}. Received "${value}".`,
    );
  }

  return normalized;
}
