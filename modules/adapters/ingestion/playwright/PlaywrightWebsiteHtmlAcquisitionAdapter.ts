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

type BrowserFactory = () => Promise<PlaywrightBrowser>;

export interface PlaywrightWebsiteHtmlAcquisitionAdapterDependencies {
  browserFactory?: BrowserFactory;
  navigationTimeoutMs?: number;
}

async function defaultBrowserFactory(): Promise<PlaywrightBrowser> {
  const launchChromium = loadPlaywrightChromiumLauncher();
  return launchChromium({ headless: true });
}

export class PlaywrightWebsiteHtmlAcquisitionAdapter implements WebsiteHtmlAcquisitionStrategy {
  private readonly browserFactory: BrowserFactory;
  private readonly navigationTimeoutMs: number;

  public constructor(dependencies?: PlaywrightWebsiteHtmlAcquisitionAdapterDependencies) {
    this.browserFactory = dependencies?.browserFactory ?? defaultBrowserFactory;
    this.navigationTimeoutMs = dependencies?.navigationTimeoutMs ?? 15000;
  }

  public async acquireWebsiteHtml(
    request: WebsiteHtmlAcquisitionRequest,
    _context?: ApplicationRequestContext,
  ): Promise<WebsiteHtmlAcquisitionResult> {
    const normalizedRequest = normalizeWebsiteHtmlAcquisitionRequest(request);

    const browser = await this.browserFactory();

    try {
      const page = await browser.newPage();
      const navigation = await page.goto(normalizedRequest.target.url, {
        waitUntil: "domcontentloaded",
        timeout: this.navigationTimeoutMs,
      });
      const html = (await page.content()).trim();

      return normalizeWebsiteHtmlAcquisitionResult({
        sourceKind: "scrape",
        resolvedUrl: normalizedRequest.target.url,
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
