export interface DatasetReference {
  id: string;
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

export function normalizeDatasetReference(
  reference: DatasetReference,
): DatasetReference {
  return {
    id: normalizeRequiredText(reference.id, "Dataset reference id"),
    label: normalizeOptionalText(reference.label),
  };
}
