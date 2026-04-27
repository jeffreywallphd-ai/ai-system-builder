import {
  normalizeIngestionSourceKind,
  type IngestionSourceKind,
} from "./ingestion-source-kind";
import {
  normalizeWebsiteHtmlAcquisitionMechanism,
  type WebsiteHtmlAcquisitionMechanism,
} from "./website-html-acquisition-mechanism";
import {
  normalizeWebsiteIngestionMode,
  type WebsiteIngestionMode,
} from "./website-ingestion-mode";
import {
  normalizeWebsiteIngestionTarget,
  type WebsiteIngestionTarget,
} from "./website-ingestion-target";

export interface WebsiteHtmlAcquisitionRequest {
  target: WebsiteIngestionTarget;
  mode: WebsiteIngestionMode;
  sourceKind?: IngestionSourceKind;
}

export interface WebsiteHtmlAcquisitionResult {
  sourceKind?: IngestionSourceKind;
  resolvedUrl: string;
  html: string;
  mediaType: string;
  acquisitionMechanismUsed: WebsiteHtmlAcquisitionMechanism;
  httpStatus?: number;
  contentTypeHeader?: string;
}

function normalizeRequiredText(fieldName: string, value: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new Error(`${fieldName} must be a non-empty trimmed string.`);
  }

  return normalized;
}

function normalizeOptionalText(value: string | undefined): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

export function normalizeWebsiteHtmlAcquisitionRequest(
  request: WebsiteHtmlAcquisitionRequest,
): WebsiteHtmlAcquisitionRequest {
  return {
    target: normalizeWebsiteIngestionTarget(request.target),
    mode: normalizeWebsiteIngestionMode(request.mode),
    sourceKind:
      typeof request.sourceKind === "string"
        ? normalizeIngestionSourceKind(request.sourceKind)
        : "scrape",
  };
}

export function normalizeWebsiteHtmlAcquisitionResult(
  result: WebsiteHtmlAcquisitionResult,
): WebsiteHtmlAcquisitionResult {
  return {
    sourceKind:
      typeof result.sourceKind === "string"
        ? normalizeIngestionSourceKind(result.sourceKind)
        : "scrape",
    resolvedUrl: normalizeRequiredText("resolvedUrl", result.resolvedUrl),
    html: normalizeRequiredText("html", result.html),
    mediaType: normalizeRequiredText("mediaType", result.mediaType),
    acquisitionMechanismUsed: normalizeWebsiteHtmlAcquisitionMechanism(result.acquisitionMechanismUsed),
    httpStatus: typeof result.httpStatus === "number" ? result.httpStatus : undefined,
    contentTypeHeader: normalizeOptionalText(result.contentTypeHeader),
  };
}
