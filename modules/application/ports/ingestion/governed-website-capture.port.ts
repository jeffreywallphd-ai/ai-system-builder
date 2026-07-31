import type { ApplicationRequestContext } from "../application-request-context";
import type { GovernedWebsiteScopeRequest } from "../../../contracts/ingestion";

export interface GovernedWebsiteRobotsEvidence {
  readonly policyUrl: string;
  readonly checkedAt: string;
  readonly decision: "allowed";
}

export interface GovernedWebsiteCapturedPage {
  readonly outcome: "captured";
  readonly requestedUrl: string;
  readonly canonicalUrl: string;
  readonly rawBytes: Uint8Array;
  readonly derivedTextBytes: Uint8Array;
  readonly mediaType: "text/html";
  readonly httpStatus: number;
  readonly contentDigest: `sha256:${string}`;
  readonly robots: GovernedWebsiteRobotsEvidence;
  readonly etag?: string;
  readonly lastModified?: string;
}

export interface GovernedWebsiteRemovedPage {
  readonly outcome: "removed";
  readonly requestedUrl: string;
  readonly canonicalUrl: string;
  readonly httpStatus: 404 | 410;
  readonly robots: GovernedWebsiteRobotsEvidence;
}

export interface GovernedWebsiteUnchangedPage {
  readonly outcome: "unchanged";
  readonly requestedUrl: string;
  readonly canonicalUrl: string;
  readonly httpStatus: 304;
  readonly robots: GovernedWebsiteRobotsEvidence;
}

export type GovernedWebsitePageCapture = GovernedWebsiteCapturedPage | GovernedWebsiteRemovedPage | GovernedWebsiteUnchangedPage;

export interface GovernedWebsiteCapturePort {
  resolveScope(request: GovernedWebsiteScopeRequest, context?: ApplicationRequestContext): Promise<readonly string[]>;
  capturePage(url: string, context?: ApplicationRequestContext, validators?: { readonly etag?: string; readonly lastModified?: string }): Promise<GovernedWebsitePageCapture>;
}
