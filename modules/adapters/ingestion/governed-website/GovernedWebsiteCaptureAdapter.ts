import { createHash } from "node:crypto";

import {
  type GovernedWebsiteCapturePort,
  type GovernedWebsitePageCapture,
  type GovernedWebsiteRobotsEvidence,
} from "../../../application/ports/ingestion";
import {
  GOVERNED_WEBSITE_MAXIMUM_HTML_BYTES,
  GOVERNED_WEBSITE_MAXIMUM_PAGES,
  GOVERNED_WEBSITE_MAXIMUM_ROBOTS_BYTES,
  GOVERNED_WEBSITE_MAXIMUM_SITEMAP_BYTES,
  type GovernedWebsiteScopeRequest,
} from "../../../contracts/ingestion";
import type { ApplicationRequestContext } from "../../../application/ports";
import { SecureEgressBroker } from "../../security/egress";

const USER_AGENT = "ai-system-builder";

export interface GovernedWebsiteCaptureAdapterDependencies {
  readonly egressBroker?: Pick<SecureEgressBroker, "createSession">;
  readonly now?: () => string;
  readonly maximumHtmlBytes?: number;
  readonly timeoutMs?: number;
}

export class GovernedWebsiteCaptureAdapter implements GovernedWebsiteCapturePort {
  private readonly egressBroker: Pick<SecureEgressBroker, "createSession">;
  private readonly now: () => string;
  private readonly maximumHtmlBytes: number;
  private readonly timeoutMs: number;

  public constructor(dependencies: GovernedWebsiteCaptureAdapterDependencies = {}) {
    this.egressBroker = dependencies.egressBroker ?? new SecureEgressBroker();
    this.now = dependencies.now ?? (() => new Date().toISOString());
    this.maximumHtmlBytes = boundedInteger(
      dependencies.maximumHtmlBytes ?? GOVERNED_WEBSITE_MAXIMUM_HTML_BYTES,
      1,
      GOVERNED_WEBSITE_MAXIMUM_HTML_BYTES,
      "Website HTML byte limit",
    );
    this.timeoutMs = boundedInteger(dependencies.timeoutMs ?? 15_000, 1_000, 60_000, "Website timeout");
  }

  public async resolveScope(request: GovernedWebsiteScopeRequest, _context?: ApplicationRequestContext): Promise<readonly string[]> {
    const maximumPages = boundedInteger(request.maximumPages ?? GOVERNED_WEBSITE_MAXIMUM_PAGES, 1, GOVERNED_WEBSITE_MAXIMUM_PAGES, "Website page limit");
    if (!Array.isArray(request.urls) || request.urls.length < 1 || request.urls.length > GOVERNED_WEBSITE_MAXIMUM_PAGES) {
      throw new Error(`Website scope must include 1 through ${GOVERNED_WEBSITE_MAXIMUM_PAGES} URLs.`);
    }
    if (request.kind === "pages") return uniqueUrls(request.urls).slice(0, maximumPages);
    if (request.kind !== "sitemap" || request.urls.length !== 1) throw new Error("Sitemap scope requires exactly one sitemap URL.");

    const sitemapUrl = safeUrl(request.urls[0]!);
    const response = await this.egressBroker.createSession({
      allowedMediaTypes: ["application/xml", "text/xml", "text/plain"],
      maximumResponseBytes: GOVERNED_WEBSITE_MAXIMUM_SITEMAP_BYTES,
      maximumTotalBytes: GOVERNED_WEBSITE_MAXIMUM_SITEMAP_BYTES,
      timeoutMs: this.timeoutMs,
    }).fetch(sitemapUrl);
    if (response.status < 200 || response.status >= 300) throw new Error("The sitemap could not be read.");
    requireSameOrigin(sitemapUrl, response.url, "Sitemap redirects must remain on the selected website.");
    const body = new TextDecoder("utf-8", { fatal: true }).decode(response.bytes);
    if (!/<urlset(?:\s|>)/i.test(body) || /<sitemapindex(?:\s|>)/i.test(body)) {
      throw new Error("Only a bounded page sitemap is supported.");
    }
    const matches = [...body.matchAll(/<loc(?:\s[^>]*)?>([\s\S]*?)<\/loc>/gi)];
    if (matches.length < 1) throw new Error("The sitemap does not contain any page URLs.");
    const origin = new URL(sitemapUrl).origin;
    const urls = uniqueUrls(matches.slice(0, GOVERNED_WEBSITE_MAXIMUM_PAGES + 1).map((match) => decodeXml(match[1] ?? "")));
    for (const url of urls) if (new URL(url).origin !== origin) throw new Error("Sitemap page URLs must remain on the selected website.");
    return urls.slice(0, maximumPages);
  }

  public async capturePage(urlValue: string, _context?: ApplicationRequestContext, validators: { readonly etag?: string; readonly lastModified?: string } = {}): Promise<GovernedWebsitePageCapture> {
    const requestedUrl = safeUrl(urlValue);
    const robots = await this.requireRobotsAllowed(requestedUrl);
    const response = await this.egressBroker.createSession({
      allowedMediaTypes: ["text/html", "application/xhtml+xml"],
      maximumResponseBytes: this.maximumHtmlBytes,
      maximumTotalBytes: this.maximumHtmlBytes,
      timeoutMs: this.timeoutMs,
    }).fetch(requestedUrl, { headers: {
      accept: "text/html,application/xhtml+xml",
      ...(safeHeader(validators.etag) ? { "if-none-match": safeHeader(validators.etag)! } : {}),
      ...(safeHeader(validators.lastModified) ? { "if-modified-since": safeHeader(validators.lastModified)! } : {}),
    } });
    const canonicalUrl = safeUrl(response.url);
    requireSameOrigin(requestedUrl, canonicalUrl, "Website redirects must remain on the selected website.");
    if (response.status === 304) return { outcome: "unchanged", requestedUrl, canonicalUrl, httpStatus: 304, robots };
    if (response.status === 404 || response.status === 410) {
      return { outcome: "removed", requestedUrl, canonicalUrl, httpStatus: response.status, robots };
    }
    if (response.status < 200 || response.status >= 300) throw new Error("The website page is currently unavailable.");
    if (response.bytes.byteLength < 1) throw new Error("The website page returned no content.");
    const html = new TextDecoder("utf-8", { fatal: true }).decode(response.bytes);
    const derivedTextBytes = new TextEncoder().encode(extractReadableText(html));
    return {
      outcome: "captured",
      requestedUrl,
      canonicalUrl,
      rawBytes: response.bytes,
      derivedTextBytes,
      mediaType: "text/html",
      httpStatus: response.status,
      contentDigest: `sha256:${createHash("sha256").update(response.bytes).digest("hex")}`,
      robots,
      ...(safeHeader(response.headers.etag) ? { etag: safeHeader(response.headers.etag) } : {}),
      ...(safeHeader(response.headers["last-modified"]) ? { lastModified: safeHeader(response.headers["last-modified"]) } : {}),
    };
  }

  private async requireRobotsAllowed(pageUrl: string): Promise<GovernedWebsiteRobotsEvidence> {
    const parsed = new URL(pageUrl);
    const policyUrl = `${parsed.origin}/robots.txt`;
    const response = await this.egressBroker.createSession({
      allowedMediaTypes: ["text/plain", "text/html"],
      maximumResponseBytes: GOVERNED_WEBSITE_MAXIMUM_ROBOTS_BYTES,
      maximumTotalBytes: GOVERNED_WEBSITE_MAXIMUM_ROBOTS_BYTES,
      timeoutMs: this.timeoutMs,
    }).fetch(policyUrl, { headers: { accept: "text/plain" } });
    requireSameOrigin(policyUrl, response.url, "Robots policy redirects must remain on the selected website.");
    if (response.status === 401 || response.status === 403) throw new Error("This website does not allow automated capture.");
    if (response.status === 429 || response.status >= 500) throw new Error("The website robots policy is currently unavailable.");
    const body = response.status >= 200 && response.status < 300
      ? new TextDecoder("utf-8", { fatal: true }).decode(response.bytes)
      : "";
    if (!robotsAllows(body, parsed)) throw new Error("This page is not allowed by the website robots policy.");
    return { policyUrl, checkedAt: this.now(), decision: "allowed" };
  }
}

interface RobotsRule { readonly allow: boolean; readonly path: string }
interface RobotsGroup { readonly agents: string[]; readonly rules: RobotsRule[] }

function robotsAllows(body: string, pageUrl: URL): boolean {
  const groups: RobotsGroup[] = [];
  let current: { agents: string[]; rules: RobotsRule[] } = { agents: [], rules: [] };
  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;
    const separator = line.indexOf(":");
    if (separator < 1) continue;
    const field = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    if (field === "user-agent") {
      if (current.rules.length > 0) { groups.push(current); current = { agents: [], rules: [] }; }
      current.agents.push(value.toLowerCase());
    } else if ((field === "allow" || field === "disallow") && current.agents.length > 0) {
      current.rules.push({ allow: field === "allow", path: value });
    }
  }
  if (current.agents.length || current.rules.length) groups.push(current);
  const matches = groups.map((group) => ({
    group,
    specificity: Math.max(...group.agents.map((agent) => agent === USER_AGENT ? USER_AGENT.length : agent === "*" ? 0 : -1)),
  })).filter((entry) => entry.specificity >= 0);
  if (!matches.length) return true;
  const bestSpecificity = Math.max(...matches.map((entry) => entry.specificity));
  const requestPath = `${pageUrl.pathname}${pageUrl.search}`;
  const rules = matches.filter((entry) => entry.specificity === bestSpecificity).flatMap((entry) => entry.group.rules);
  const applicable = rules.filter((rule) => rule.path && robotsPattern(rule.path).test(requestPath));
  if (!applicable.length) return true;
  applicable.sort((left, right) => ruleLength(right.path) - ruleLength(left.path) || Number(right.allow) - Number(left.allow));
  return applicable[0]!.allow;
}

function robotsPattern(value: string): RegExp {
  const anchored = value.endsWith("$");
  const source = (anchored ? value.slice(0, -1) : value).split("*").map(escapeRegex).join(".*");
  return new RegExp(`^${source}${anchored ? "$" : ""}`);
}
function ruleLength(value: string): number { return value.replace(/[\*$]/g, "").length; }
function escapeRegex(value: string): string { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

function extractReadableText(html: string): string {
  const withoutUnsafe = html.replace(/<script\b[\s\S]*?<\/script>/gi, " ").replace(/<style\b[\s\S]*?<\/style>/gi, " ").replace(/<template\b[\s\S]*?<\/template>/gi, " ");
  const text = withoutUnsafe.replace(/<[^>]+>/g, " ").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&quot;/gi, "\"").replace(/&#39;/g, "'").replace(/\s+/g, " ").trim();
  if (!text) throw new Error("The website page does not contain readable text.");
  return text;
}

function uniqueUrls(values: readonly string[]): string[] { return [...new Set(values.map(safeUrl))]; }
function safeUrl(value: string): string {
  const parsed = new URL(String(value).trim());
  if ((parsed.protocol !== "http:" && parsed.protocol !== "https:") || parsed.username || parsed.password) throw new Error("Website URLs must use HTTP or HTTPS without credentials.");
  parsed.hash = "";
  return parsed.toString();
}
function requireSameOrigin(expected: string, actual: string, message: string): void { if (new URL(expected).origin !== new URL(actual).origin) throw new Error(message); }
function decodeXml(value: string): string { return value.trim().replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&apos;/g, "'"); }
function safeHeader(value: string | undefined): string | undefined { const normalized = value?.trim(); return normalized && normalized.length <= 512 && !/[\r\n]|authorization|cookie/i.test(normalized) ? normalized : undefined; }
function boundedInteger(value: number, minimum: number, maximum: number, label: string): number { if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new Error(`${label} must be between ${minimum} and ${maximum}.`); return value; }
