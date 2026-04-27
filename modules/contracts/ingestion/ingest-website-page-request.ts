import {
  normalizeOptionalWebsiteIngestionMode,
  type WebsiteIngestionMode,
} from "./website-ingestion-mode";

export interface IngestWebsitePageRequest {
  url: string;
  label?: string;
  mode?: WebsiteIngestionMode;
}

function normalizeOptionalText(value: string | undefined): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

export function createIngestWebsitePageRequest(
  request: IngestWebsitePageRequest,
): IngestWebsitePageRequest {
  const normalizedUrl = request.url.trim();
  if (normalizedUrl.length === 0) {
    throw new Error(`Website ingestion request url must be a non-empty trimmed string. Received "${request.url}".`);
  }

  return {
    url: normalizedUrl,
    label: normalizeOptionalText(request.label),
    mode:
      typeof request.mode === "string"
        ? normalizeOptionalWebsiteIngestionMode(request.mode)
        : undefined,
  };
}
