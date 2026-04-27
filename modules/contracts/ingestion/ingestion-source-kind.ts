export const INGESTION_SOURCE_KINDS = [
  "upload",
  "scrape",
  "generated",
  "api",
  "runtime",
] as const;

export type IngestionSourceKind = (typeof INGESTION_SOURCE_KINDS)[number];

export function isIngestionSourceKind(value: string): value is IngestionSourceKind {
  return INGESTION_SOURCE_KINDS.includes(value as IngestionSourceKind);
}

export function normalizeIngestionSourceKind(value: string): IngestionSourceKind {
  const normalized = value.trim().toLowerCase();

  if (!isIngestionSourceKind(normalized)) {
    throw new Error(
      `Ingestion source kind must be one of ${INGESTION_SOURCE_KINDS.join(", ")}. Received "${value}".`,
    );
  }

  return normalized;
}
