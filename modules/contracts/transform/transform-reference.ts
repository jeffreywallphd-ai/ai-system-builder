/**
 * `definitionId` identifies the transform definition/specification.
 * `executionId` identifies a specific execution record when available.
 */
export interface TransformReference {
  definitionId: string;
  executionId?: string;
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

export function normalizeTransformReference(
  reference: TransformReference,
): TransformReference {
  return {
    definitionId: normalizeRequiredText(
      reference.definitionId,
      "Transform definition id",
    ),
    executionId: normalizeOptionalText(reference.executionId),
  };
}
