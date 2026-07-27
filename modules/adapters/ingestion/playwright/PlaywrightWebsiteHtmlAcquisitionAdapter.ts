import {
  normalizeWebsiteHtmlAcquisitionRequest,
  normalizeWebsiteHtmlAcquisitionResult,
  type WebsiteHtmlAcquisitionRequest,
  type WebsiteHtmlAcquisitionResult,
} from "../../../contracts/ingestion";
import type { WebsiteHtmlAcquisitionStrategy } from "../../../application/ports/ingestion";
import type { ApplicationRequestContext } from "../../../application/ports";
import { loadPlaywrightChromiumLauncher } from "./loadPlaywrightChromiumLauncher";
import type { PlaywrightBrowser } from "./playwrightChromiumTypes";
import { SecureEgressBroker } from "../../security/egress";

type BrowserFactory = () => Promise<PlaywrightBrowser>;

export interface PlaywrightWebsiteHtmlAcquisitionAdapterDependencies {
  browserFactory?: BrowserFactory;
  navigationTimeoutMs?: number;
  maximumHtmlBytes?: number;
  maximumSessionBytes?: number;
  egressBroker?: Pick<SecureEgressBroker, "createSession">;
}

async function defaultBrowserFactory(): Promise<PlaywrightBrowser> {
  const launchChromium = loadPlaywrightChromiumLauncher();
  return launchChromium({ headless: true });
}

export class PlaywrightWebsiteHtmlAcquisitionAdapter implements WebsiteHtmlAcquisitionStrategy {
  private readonly browserFactory: BrowserFactory;
  private readonly navigationTimeoutMs: number;
  private readonly maximumHtmlBytes: number;
  private readonly maximumSessionBytes: number;
  private readonly egressBroker: Pick<SecureEgressBroker, "createSession">;

  public constructor(dependencies?: PlaywrightWebsiteHtmlAcquisitionAdapterDependencies) {
    this.browserFactory = dependencies?.browserFactory ?? defaultBrowserFactory;
    this.navigationTimeoutMs = dependencies?.navigationTimeoutMs ?? 15000;
    this.maximumHtmlBytes = dependencies?.maximumHtmlBytes ?? 5 * 1024 * 1024;
    this.maximumSessionBytes = dependencies?.maximumSessionBytes ?? 12 * 1024 * 1024;
    this.egressBroker = dependencies?.egressBroker ?? new SecureEgressBroker();
  }

  public async acquireWebsiteHtml(
    request: WebsiteHtmlAcquisitionRequest,
    _context?: ApplicationRequestContext,
  ): Promise<WebsiteHtmlAcquisitionResult> {
    const normalizedRequest = normalizeWebsiteHtmlAcquisitionRequest(request);

    const browser = await this.browserFactory();

    try {
      const page = await browser.newPage({ serviceWorkers: "block" });
      const session = this.egressBroker.createSession({
        maximumResponseBytes: this.maximumHtmlBytes,
        maximumTotalBytes: this.maximumSessionBytes,
        timeoutMs: this.navigationTimeoutMs,
      });
      let resolvedUrl = normalizedRequest.target.url;
      await page.routeWebSocket("**/*", (route) => {
        route.close({ code: 1008, reason: "Network access is restricted by secure egress policy." });
      });
      await page.route("**/*", async (route) => {
        const routedRequest = route.request();
        if (!/^(?:HEAD|GET)$/i.test(routedRequest.method())) {
          await route.abort("blockedbyclient");
          return;
        }
        const requestHeaders = routedRequest.headers();
        const safeHeaders = Object.fromEntries(Object.entries(requestHeaders).filter(([name]) =>
          !["authorization", "cookie", "proxy-authorization", "host", "connection", "content-length"].includes(name.toLowerCase()),
        ));
        try {
          const response = await session.fetch(routedRequest.url(), { headers: safeHeaders });
          if (routedRequest.isNavigationRequest()) resolvedUrl = response.url;
          const safeResponseHeaders = Object.fromEntries(Object.entries(response.headers).filter(([name]) =>
            !["set-cookie", "set-cookie2", "transfer-encoding", "content-length", "connection"].includes(name.toLowerCase()),
          ));
          await route.fulfill({
            status: response.status,
            headers: safeResponseHeaders,
            body: response.bytes,
          });
        } catch {
          await route.abort("blockedbyclient");
        }
      });
      const navigation = await page.goto(normalizedRequest.target.url, {
        waitUntil: "domcontentloaded",
        timeout: this.navigationTimeoutMs,
      });
      const html = (await page.content()).trim();
      if (new TextEncoder().encode(html).byteLength > this.maximumHtmlBytes) {
        throw new Error("Rendered website HTML exceeds the configured byte limit.");
      }

      return normalizeWebsiteHtmlAcquisitionResult({
        sourceKind: "scrape",
        resolvedUrl,
        html,
        mediaType: "text/html",
        acquisitionMechanismUsed: "rendered-browser",
        httpStatus: navigation?.status() ?? undefined,
        contentTypeHeader: "text/html",
      });
    } finally {
      await browser.close();
    }
  }
}
