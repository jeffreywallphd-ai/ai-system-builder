export const WEBSITE_INGESTION_MODES = ["automatic", "rendered"] as const;

export type WebsiteIngestionMode = (typeof WEBSITE_INGESTION_MODES)[number];

const WEBSITE_INGESTION_MODE_SET = new Set<string>(WEBSITE_INGESTION_MODES);

export function isWebsiteIngestionMode(value: string): value is WebsiteIngestionMode {
  return WEBSITE_INGESTION_MODE_SET.has(value);
}

export function normalizeWebsiteIngestionMode(value: string): WebsiteIngestionMode {
  const normalized = value.trim().toLowerCase();

  if (!isWebsiteIngestionMode(normalized)) {
    throw new Error(
      `Website ingestion mode must be one of ${WEBSITE_INGESTION_MODES.join(", ")}. Received "${value}".`,
    );
  }

  return normalized;
}

export function normalizeOptionalWebsiteIngestionMode(
  value: string | undefined,
  fallback: WebsiteIngestionMode = "automatic",
): WebsiteIngestionMode {
  if (typeof value !== "string") {
    return fallback;
  }

  return normalizeWebsiteIngestionMode(value);
}
