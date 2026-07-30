const SAFE_DATASET_VERSION_ID = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/;

export type DatasetId = string & { readonly __datasetIdBrand: unique symbol };
export type DatasetVersionId = string & {
  readonly __datasetVersionIdBrand: unique symbol;
};
export type DatasetVersionPublicationId = string & {
  readonly __datasetVersionPublicationIdBrand: unique symbol;
};

function normalizeId<T extends string>(value: string, label: string): T {
  const normalized = value.trim();
  if (
    !SAFE_DATASET_VERSION_ID.test(normalized) ||
    normalized.includes("..") ||
    /[\\/]/.test(normalized)
  ) {
    const error = new Error(`${label} must be a safe non-path identifier.`);
    error.stack = undefined;
    throw error;
  }
  return normalized as T;
}

export const normalizeDatasetId = (value: string): DatasetId =>
  normalizeId<DatasetId>(value, "Dataset id");
export const normalizeDatasetVersionId = (value: string): DatasetVersionId =>
  normalizeId<DatasetVersionId>(value, "Dataset version id");
export const normalizeDatasetVersionPublicationId = (
  value: string,
): DatasetVersionPublicationId =>
  normalizeId<DatasetVersionPublicationId>(
    value,
    "Dataset version publication id",
  );
