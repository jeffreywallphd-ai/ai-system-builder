import {
  normalizeLineageNodeKind,
  type LineageNodeKind,
} from "./lineage-node-kind";

export interface LineageReference {
  id: string;
  kind: LineageNodeKind;
  label?: string;
}

function normalizeRequiredText(value: string, label: string): string {
  const normalized = value.trim();

  if (normalized.length < 1) {
    throw new Error(`${label} must be a non-empty string. Received "${value}".`);
  }

  return normalized;
}

function normalizeOptionalText(value: string | undefined): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

export function normalizeLineageReference(
  reference: LineageReference,
): LineageReference {
  return {
    ...reference,
    id: normalizeRequiredText(reference.id, "Lineage reference id"),
    kind: normalizeLineageNodeKind(reference.kind),
    label: normalizeOptionalText(reference.label),
  };
}
