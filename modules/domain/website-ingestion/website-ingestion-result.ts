import {
  normalizeWebsiteHtmlAcquisitionMechanism,
  type WebsiteHtmlAcquisitionMechanism,
} from "./website-html-acquisition-mechanism";
import {
  normalizeWebsiteIngestionTarget,
  type WebsiteIngestionTarget,
} from "./website-ingestion-target";

export interface WebsiteIngestionResult {
  target: WebsiteIngestionTarget;
  resolvedUrl: string;
  acquisitionMechanismUsed: WebsiteHtmlAcquisitionMechanism;
  warnings?: string[];
}

function normalizeRequiredText(fieldName: string, value: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new Error(`${fieldName} must be a non-empty trimmed string.`);
  }

  return normalized;
}

export function normalizeWebsiteIngestionResult(
  result: WebsiteIngestionResult,
): WebsiteIngestionResult {
  return {
    target: normalizeWebsiteIngestionTarget(result.target),
    resolvedUrl: normalizeRequiredText("resolvedUrl", result.resolvedUrl),
    acquisitionMechanismUsed: normalizeWebsiteHtmlAcquisitionMechanism(result.acquisitionMechanismUsed),
    warnings:
      result.warnings
        ?.map((warning) => warning.trim())
        .filter((warning) => warning.length > 0),
  };
}
