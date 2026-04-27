import {
  normalizeWebsiteHtmlAcquisitionMechanism,
  type WebsiteHtmlAcquisitionMechanism,
} from "./website-html-acquisition-mechanism";
import {
  normalizeWebsiteIngestionMode,
  type WebsiteIngestionMode,
} from "./website-ingestion-mode";

export interface WebsiteHtmlCaptureMetadata {
  sourceUrl: string;
  resolvedUrl: string;
  retrievedAt: string;
  requestedMode: WebsiteIngestionMode;
  acquisitionMechanismUsed: WebsiteHtmlAcquisitionMechanism;
  rendered: boolean;
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

export function normalizeWebsiteHtmlCaptureMetadata(
  metadata: WebsiteHtmlCaptureMetadata,
): WebsiteHtmlCaptureMetadata {
  return {
    sourceUrl: normalizeRequiredText("sourceUrl", metadata.sourceUrl),
    resolvedUrl: normalizeRequiredText("resolvedUrl", metadata.resolvedUrl),
    retrievedAt: normalizeRequiredText("retrievedAt", metadata.retrievedAt),
    requestedMode: normalizeWebsiteIngestionMode(metadata.requestedMode),
    acquisitionMechanismUsed: normalizeWebsiteHtmlAcquisitionMechanism(metadata.acquisitionMechanismUsed),
    rendered: metadata.rendered,
    httpStatus: typeof metadata.httpStatus === "number" ? metadata.httpStatus : undefined,
    contentTypeHeader: normalizeOptionalText(metadata.contentTypeHeader),
  };
}
