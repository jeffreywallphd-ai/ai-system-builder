export const LINEAGE_NODE_KINDS = [
  "source",
  "artifact",
  "transform",
  "dataset",
  "storage-instance",
] as const;

export type LineageNodeKind = (typeof LINEAGE_NODE_KINDS)[number];

export function isLineageNodeKind(value: string): value is LineageNodeKind {
  return LINEAGE_NODE_KINDS.includes(value as LineageNodeKind);
}

export function normalizeLineageNodeKind(value: string): LineageNodeKind {
  const normalized = value.trim().toLowerCase();

  if (!isLineageNodeKind(normalized)) {
    throw new Error(
      `Lineage node kind must be one of ${LINEAGE_NODE_KINDS.join(", ")}. Received "${value}".`,
    );
  }

  return normalized;
}
