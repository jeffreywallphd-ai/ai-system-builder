export const GOVERNED_WEBSITE_MAXIMUM_PAGES = 25;
export const GOVERNED_WEBSITE_MAXIMUM_HTML_BYTES = 5 * 1024 * 1024;
export const GOVERNED_WEBSITE_MAXIMUM_SITEMAP_BYTES = 1024 * 1024;
export const GOVERNED_WEBSITE_MAXIMUM_ROBOTS_BYTES = 512 * 1024;

export interface GovernedWebsiteScopeRequest {
  readonly kind: "pages" | "sitemap";
  readonly urls: readonly string[];
  readonly maximumPages?: number;
}

export function normalizeGovernedWebsiteScopeRequest(value: GovernedWebsiteScopeRequest): GovernedWebsiteScopeRequest {
  if (value.kind !== "pages" && value.kind !== "sitemap") throw new Error("Website scope must be pages or sitemap.");
  if (!Array.isArray(value.urls) || value.urls.length < 1 || value.urls.length > GOVERNED_WEBSITE_MAXIMUM_PAGES) throw new Error(`Website scope must include 1 through ${GOVERNED_WEBSITE_MAXIMUM_PAGES} URLs.`);
  if (value.kind === "sitemap" && value.urls.length !== 1) throw new Error("Sitemap scope requires exactly one URL.");
  const urls = [...new Set(value.urls.map(normalizeGovernedWebsiteUrl))];
  const maximumPages = value.maximumPages ?? GOVERNED_WEBSITE_MAXIMUM_PAGES;
  if (!Number.isSafeInteger(maximumPages) || maximumPages < 1 || maximumPages > GOVERNED_WEBSITE_MAXIMUM_PAGES) throw new Error(`Website page limit must be between 1 and ${GOVERNED_WEBSITE_MAXIMUM_PAGES}.`);
  if (value.kind === "pages" && urls.length > maximumPages) throw new Error("Selected website pages exceed the page limit.");
  return { kind: value.kind, urls, maximumPages };
}

export function normalizeGovernedWebsiteUrl(value: string): string {
  const normalized = String(value).trim();
  if (!normalized || normalized.length > 2048) throw new Error("Website URL is required and bounded.");
  const parsed = new URL(normalized);
  if ((parsed.protocol !== "http:" && parsed.protocol !== "https:") || parsed.username || parsed.password) throw new Error("Website URLs must use HTTP or HTTPS without credentials.");
  parsed.hash = "";
  return parsed.toString();
}
