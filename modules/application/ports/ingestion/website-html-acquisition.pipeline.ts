import type {
  WebsiteHtmlAcquisitionRequest,
  WebsiteHtmlAcquisitionResult,
} from "../../../contracts/ingestion";

import type { ApplicationRequestContext } from "../application-request-context";

export interface WebsiteHtmlAcquisitionStrategy {
  acquireWebsiteHtml(
    request: WebsiteHtmlAcquisitionRequest,
    context?: ApplicationRequestContext,
  ): Promise<WebsiteHtmlAcquisitionResult>;
}

/**
 * Application-layer orchestration boundary for multi-strategy HTML acquisition.
 * Implementations coordinate strategy ordering and fallback behavior only.
 */
export interface WebsiteHtmlAcquisitionPipeline {
  acquireWebsiteHtml(
    request: WebsiteHtmlAcquisitionRequest,
    context?: ApplicationRequestContext,
  ): Promise<WebsiteHtmlAcquisitionResult>;
}
