import type {
  WebsiteHtmlAcquisitionRequest,
  WebsiteHtmlAcquisitionResult,
} from "../../../contracts/ingestion";

import type { ApplicationRequestContext } from "../application-request-context";

/**
 * Boundary for obtaining HTML for a single website target.
 * Implementations belong in adapters, not in the application layer.
 */
export interface WebsiteHtmlAcquisitionPort {
  acquireWebsiteHtml(
    request: WebsiteHtmlAcquisitionRequest,
    context?: ApplicationRequestContext,
  ): Promise<WebsiteHtmlAcquisitionResult>;
}
