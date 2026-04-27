import {
  normalizeLineageEdgeRecord,
  type LineageEdgeRecord,
  type LineageMetadata,
} from "./lineage-edge-record";
import {
  normalizeLineageReference,
  type LineageReference,
} from "./lineage-reference";

export interface LineageRecord<
  TMetadata extends LineageMetadata = LineageMetadata,
> {
  nodes: LineageReference[];
  edges: LineageEdgeRecord<TMetadata>[];
}

export function normalizeLineageRecord<
  TMetadata extends LineageMetadata = LineageMetadata,
>(
  record: LineageRecord<TMetadata>,
): LineageRecord<TMetadata> {
  return {
    nodes: record.nodes.map(normalizeLineageReference),
    edges: record.edges.map(normalizeLineageEdgeRecord),
  };
}
