export const TRANSFORM_KINDS = [
  "normalization",
  "enrichment",
  "parsing",
  "structuring",
  "extraction",
  "packaging",
] as const;

export type TransformKind = (typeof TRANSFORM_KINDS)[number];

export function isTransformKind(value: string): value is TransformKind {
  return TRANSFORM_KINDS.includes(value as TransformKind);
}

export function normalizeTransformKind(value: string): TransformKind {
  const normalized = value.trim().toLowerCase();

  if (!isTransformKind(normalized)) {
    throw new Error(
      `Transform kind must be one of ${TRANSFORM_KINDS.join(", ")}. Received "${value}".`,
    );
  }

  return normalized;
}
