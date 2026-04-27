export const WEBSITE_HTML_ACQUISITION_MECHANISMS = [
  "simple-http",
  "rendered-browser",
] as const;

export type WebsiteHtmlAcquisitionMechanism = (typeof WEBSITE_HTML_ACQUISITION_MECHANISMS)[number];

const WEBSITE_HTML_ACQUISITION_MECHANISM_SET = new Set<string>(WEBSITE_HTML_ACQUISITION_MECHANISMS);

export function isWebsiteHtmlAcquisitionMechanism(value: string): value is WebsiteHtmlAcquisitionMechanism {
  return WEBSITE_HTML_ACQUISITION_MECHANISM_SET.has(value);
}

export function normalizeWebsiteHtmlAcquisitionMechanism(value: string): WebsiteHtmlAcquisitionMechanism {
  const normalized = value.trim().toLowerCase();

  if (!isWebsiteHtmlAcquisitionMechanism(normalized)) {
    throw new Error(
      `Website HTML acquisition mechanism must be one of ${WEBSITE_HTML_ACQUISITION_MECHANISMS.join(", ")}. Received "${value}".`,
    );
  }

  return normalized;
}
