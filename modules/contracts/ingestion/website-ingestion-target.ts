export interface WebsiteIngestionTarget {
  url: string;
  label?: string;
}

function normalizeOptionalText(value: string | undefined): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

export function normalizeWebsiteIngestionTarget(
  target: WebsiteIngestionTarget,
): WebsiteIngestionTarget {
  const normalizedUrl = target.url.trim();

  if (normalizedUrl.length === 0) {
    throw new Error(
      `Website ingestion target url must be a non-empty trimmed string. Received "${target.url}".`,
    );
  }

  return {
    url: normalizedUrl,
    label: normalizeOptionalText(target.label),
  };
}
