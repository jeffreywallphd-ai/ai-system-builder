import {
  normalizeWebsiteHtmlAcquisitionRequest,
  normalizeWebsiteHtmlAcquisitionResult,
  type WebsiteHtmlAcquisitionRequest,
  type WebsiteHtmlAcquisitionResult,
} from "../../../contracts/ingestion";
import type { WebsiteHtmlAcquisitionStrategy } from "../../../application/ports/ingestion";
import type { ApplicationRequestContext } from "../../../application/ports";

type FetchLike = (input: string, init?: { headers?: Record<string, string> }) => Promise<{
  url: string;
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}>;

export interface SimpleHttpWebsiteHtmlAcquisitionAdapterDependencies {
  fetchImpl?: FetchLike;
}

export class SimpleHttpWebsiteHtmlAcquisitionAdapter implements WebsiteHtmlAcquisitionStrategy {
  private readonly fetchImpl: FetchLike;

  public constructor(dependencies?: SimpleHttpWebsiteHtmlAcquisitionAdapterDependencies) {
    this.fetchImpl = dependencies?.fetchImpl ?? ((input, init) => fetch(input, init) as ReturnType<FetchLike>);
  }

  public async acquireWebsiteHtml(
    request: WebsiteHtmlAcquisitionRequest,
    _context?: ApplicationRequestContext,
  ): Promise<WebsiteHtmlAcquisitionResult> {
    const normalizedRequest = normalizeWebsiteHtmlAcquisitionRequest(request);

    const response = await this.fetchImpl(normalizedRequest.target.url, {
      headers: {
        accept: "text/html,application/xhtml+xml",
      },
    });

    const html = (await response.text()).trim();

    return normalizeWebsiteHtmlAcquisitionResult({
      sourceKind: "scrape",
      resolvedUrl: response.url || normalizedRequest.target.url,
      html,
      mediaType: "text/html",
      acquisitionMechanismUsed: "simple-http",
      httpStatus: response.status,
      contentTypeHeader: response.headers.get("content-type") ?? undefined,
    });
  }
}
