export interface DatasetSchemaField {
  name: string;
  type: string;
  nullable?: boolean;
}

export interface DatasetSchemaSummary {
  fieldCount?: number;
  fields?: DatasetSchemaField[];
}

function normalizeRequiredText(value: string, label: string): string {
  const normalized = value.trim();

  if (normalized.length < 1) {
    throw new Error(`${label} must be a non-empty string. Received "${value}".`);
  }

  return normalized;
}

export function normalizeDatasetSchemaSummary(
  summary?: DatasetSchemaSummary,
): DatasetSchemaSummary | undefined {
  if (!summary) {
    return undefined;
  }

  return {
    fieldCount: summary.fieldCount,
    fields: summary.fields?.map((field) => ({
      ...field,
      name: normalizeRequiredText(field.name, "Dataset schema field name"),
      type: normalizeRequiredText(field.type, "Dataset schema field type"),
    })),
  };
}
