import {
  type ContractError,
  type ContractErrorDetails,
  type ContractResult,
  createFailureResult,
  createSuccessResult,
} from "../shared";
import {
  normalizeStagedArtifactDescriptor,
  type StagedArtifactDescriptor,
} from "./staged-artifact-descriptor";
import {
  normalizeWebsiteHtmlAcquisitionMechanism,
  type WebsiteHtmlAcquisitionMechanism,
} from "./website-html-acquisition-mechanism";
import {
  normalizeWebsiteIngestionTarget,
  type WebsiteIngestionTarget,
} from "./website-ingestion-target";

export interface IngestWebsitePageSuccessValue {
  sourceKind?: "scrape";
  target: WebsiteIngestionTarget;
  resolvedUrl: string;
  acquisitionMechanismUsed: WebsiteHtmlAcquisitionMechanism;
  stagedArtifact?: StagedArtifactDescriptor;
  warnings?: string[];
}

export type IngestWebsitePageResult<
  TDetails extends ContractErrorDetails = ContractErrorDetails,
> = ContractResult<IngestWebsitePageSuccessValue, TDetails>;

function normalizeRequiredText(fieldName: string, value: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new Error(`${fieldName} must be a non-empty trimmed string.`);
  }

  return normalized;
}

export function normalizeIngestWebsitePageSuccessValue(
  value: IngestWebsitePageSuccessValue,
): IngestWebsitePageSuccessValue {
  return {
    sourceKind: value.sourceKind ?? "scrape",
    target: normalizeWebsiteIngestionTarget(value.target),
    resolvedUrl: normalizeRequiredText("resolvedUrl", value.resolvedUrl),
    acquisitionMechanismUsed: normalizeWebsiteHtmlAcquisitionMechanism(value.acquisitionMechanismUsed),
    stagedArtifact:
      value.stagedArtifact
        ? normalizeStagedArtifactDescriptor(value.stagedArtifact)
        : undefined,
    warnings:
      value.warnings
        ?.map((warning) => warning.trim())
        .filter((warning) => warning.length > 0),
  };
}

export function createIngestWebsitePageSuccessResult<
  TDetails extends ContractErrorDetails = ContractErrorDetails,
>(
  value: IngestWebsitePageSuccessValue,
): IngestWebsitePageResult<TDetails> {
  return createSuccessResult(normalizeIngestWebsitePageSuccessValue(value));
}

export function createIngestWebsitePageFailureResult<
  TDetails extends ContractErrorDetails = ContractErrorDetails,
>(
  error: ContractError<TDetails>,
): IngestWebsitePageResult<TDetails> {
  return createFailureResult(error);
}
