import {
  normalizeWebsiteHtmlAcquisitionRequest,
  normalizeWebsiteHtmlAcquisitionResult,
  type WebsiteHtmlAcquisitionRequest,
  type WebsiteHtmlAcquisitionResult,
} from "../../../contracts/ingestion";
import type { WebsiteHtmlAcquisitionStrategy } from "../../../application/ports/ingestion";
import type { ApplicationRequestContext } from "../../../application/ports";
import { SecureEgressBroker } from "../../security/egress";

export interface SimpleHttpWebsiteHtmlAcquisitionAdapterDependencies {
  egressBroker?: Pick<SecureEgressBroker, "createSession">;
  maximumHtmlBytes?: number;
  timeoutMs?: number;
}

export class SimpleHttpWebsiteHtmlAcquisitionAdapter implements WebsiteHtmlAcquisitionStrategy {
  private readonly egressBroker: Pick<SecureEgressBroker, "createSession">;
  private readonly maximumHtmlBytes: number;
  private readonly timeoutMs: number;

  public constructor(dependencies?: SimpleHttpWebsiteHtmlAcquisitionAdapterDependencies) {
    this.egressBroker = dependencies?.egressBroker ?? new SecureEgressBroker();
    this.maximumHtmlBytes = dependencies?.maximumHtmlBytes ?? 5 * 1024 * 1024;
    this.timeoutMs = dependencies?.timeoutMs ?? 15_000;
  }

  public async acquireWebsiteHtml(
    request: WebsiteHtmlAcquisitionRequest,
    _context?: ApplicationRequestContext,
  ): Promise<WebsiteHtmlAcquisitionResult> {
    const normalizedRequest = normalizeWebsiteHtmlAcquisitionRequest(request);

    const response = await this.egressBroker.createSession({
      allowedMediaTypes: ["text/html", "application/xhtml+xml"],
      maximumResponseBytes: this.maximumHtmlBytes,
      maximumTotalBytes: this.maximumHtmlBytes,
      timeoutMs: this.timeoutMs,
    }).fetch(normalizedRequest.target.url, {
      headers: {
        accept: "text/html,application/xhtml+xml",
      },
    });

    const html = new TextDecoder().decode(response.bytes).trim();

    return normalizeWebsiteHtmlAcquisitionResult({
      sourceKind: "scrape",
      resolvedUrl: response.url,
      html,
      mediaType: "text/html",
      acquisitionMechanismUsed: "simple-http",
      httpStatus: response.status,
      contentTypeHeader: response.headers["content-type"],
    });
  }
}
