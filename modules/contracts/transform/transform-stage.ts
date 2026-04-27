export const TRANSFORM_STAGES = [
  "ingestion",
  "staging",
  "derivation",
  "materialization",
] as const;

export type TransformStage = (typeof TRANSFORM_STAGES)[number];

export function isTransformStage(value: string): value is TransformStage {
  return TRANSFORM_STAGES.includes(value as TransformStage);
}

export function normalizeTransformStage(value: string): TransformStage {
  const normalized = value.trim().toLowerCase();

  if (!isTransformStage(normalized)) {
    throw new Error(
      `Transform stage must be one of ${TRANSFORM_STAGES.join(", ")}. Received "${value}".`,
    );
  }

  return normalized;
}
