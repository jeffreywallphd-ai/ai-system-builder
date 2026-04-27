import {
  createIngestWebsitePageSuccessResult,
  createIngestWebsitePagesBatchSuccessResult,
  createStagedArtifactDescriptorFromStorageObjectDescriptor,
  normalizeWebsiteHtmlAcquisitionRequest,
  normalizeWebsiteHtmlAcquisitionResult,
  normalizeWebsiteIngestionTarget,
  type IngestWebsitePageRequest,
  type IngestWebsitePageResult,
  type IngestWebsitePagesBatchResult,
  type IngestWebsitePageBatchItemResult,
  type StagedArtifactDescriptor,
  type WebsiteHtmlAcquisitionRequest,
  type WebsiteHtmlAcquisitionResult,
} from "../../../contracts/ingestion";
import type { StorageObjectDescriptorInput, StorageObjectMetadata, StorageObjectDescriptor } from "../../../contracts/storage";
import { type ArtifactFamily } from "../../../domain/artifact";
import {
  normalizeWebsiteHtmlCaptureMetadata,
  normalizeWebsiteIngestionMode,
  normalizeWebsiteIngestionResult,
  normalizeWebsiteIngestionTarget as normalizeDomainWebsiteIngestionTarget,
  type WebsiteHtmlCaptureMetadata,
  type WebsiteIngestionMode,
  type WebsiteIngestionResult,
  type WebsiteIngestionTarget,
} from "../../../domain/website-ingestion";

export interface WebsitePageIngestionCommand {
  target: WebsiteIngestionTarget;
  mode: WebsiteIngestionMode;
}

type WebsiteIngestionArtifactMetadata =
  StorageObjectMetadata
  & WebsiteHtmlCaptureMetadata
  & { artifactFamily: ArtifactFamily };

export interface WebsitePageIngestionCompleted {
  ingestion: WebsiteIngestionResult;
  stagedArtifact: StagedArtifactDescriptor<WebsiteIngestionArtifactMetadata>;
}

export function mapIngestWebsitePageRequestToDomain(
  request: IngestWebsitePageRequest,
): WebsitePageIngestionCommand {
  return {
    target: normalizeDomainWebsiteIngestionTarget({
      url: request.url,
      label: request.label,
    }),
    mode: normalizeWebsiteIngestionMode(request.mode ?? "automatic"),
  };
}

export function mapBatchTargetToPageRequest(input: {
  target: { url: string; label?: string };
  mode?: WebsiteIngestionMode;
}): IngestWebsitePageRequest {
  const normalizedTarget = normalizeWebsiteIngestionTarget(input.target);
  return {
    url: normalizedTarget.url,
    label: normalizedTarget.label,
    mode: input.mode,
  };
}

export function mapDomainCommandToAcquisitionRequest(
  command: WebsitePageIngestionCommand,
): WebsiteHtmlAcquisitionRequest {
  return normalizeWebsiteHtmlAcquisitionRequest({
    sourceKind: "scrape",
    target: {
      url: command.target.url,
      label: command.target.label,
    },
    mode: command.mode,
  });
}

export function mapAcquisitionResultToDomain(
  acquisitionResult: WebsiteHtmlAcquisitionResult,
  command: WebsitePageIngestionCommand,
): WebsiteIngestionResult {
  const normalized = normalizeWebsiteHtmlAcquisitionResult(acquisitionResult);

  return normalizeWebsiteIngestionResult({
    target: command.target,
    resolvedUrl: normalized.resolvedUrl,
    acquisitionMechanismUsed: normalized.acquisitionMechanismUsed,
  });
}

function toStorageKey(resolvedUrl: string, retrievedAt: string): string {
  const url = new URL(resolvedUrl);
  const host = url.hostname.toLowerCase();
  const path = url.pathname === "/" ? "index" : url.pathname;
  const pathToken = path.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase() || "index";
  const timestampToken = retrievedAt.replace(/[:.]/g, "-");
  return `staged/website/${host}/${pathToken}-${timestampToken}.html`;
}

function toOriginalName(resolvedUrl: string): string {
  const url = new URL(resolvedUrl);
  const host = url.hostname.toLowerCase();
  const segments = url.pathname
    .split("/")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0)
    .map((segment) => segment.replace(/\.[a-zA-Z0-9]+$/, ""))
    .map((segment) => segment.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase())
    .filter((segment) => segment.length > 0);

  if (segments.length === 0) {
    return `${host}.html`;
  }

  return `${host}-${segments.join("-")}.html`;
}

function buildWebsiteIngestionMetadata(input: {
  sourceUrl: string;
  acquisitionResult: WebsiteHtmlAcquisitionResult;
  requestedMode: WebsiteIngestionMode;
  retrievedAt: string;
}): WebsiteIngestionArtifactMetadata {
  const normalizedAcquisition = normalizeWebsiteHtmlAcquisitionResult(input.acquisitionResult);
  const metadata = normalizeWebsiteHtmlCaptureMetadata({
    sourceUrl: input.sourceUrl,
    resolvedUrl: normalizedAcquisition.resolvedUrl,
    retrievedAt: input.retrievedAt,
    requestedMode: input.requestedMode,
    acquisitionMechanismUsed: normalizedAcquisition.acquisitionMechanismUsed,
    rendered: normalizedAcquisition.acquisitionMechanismUsed === "rendered-browser",
    httpStatus: normalizedAcquisition.httpStatus,
    contentTypeHeader: normalizedAcquisition.contentTypeHeader,
  });

  return {
    ...metadata,
    artifactFamily: "structured-text",
  };
}

function normalizeStoredWebsiteMetadata(
  metadata: StorageObjectMetadata | undefined,
  fallback: WebsiteIngestionArtifactMetadata,
): WebsiteIngestionArtifactMetadata {
  if (!metadata) {
    return fallback;
  }

  return {
    ...fallback,
    ...metadata,
  } as WebsiteIngestionArtifactMetadata;
}

export function mapAcquisitionResultToStorageDescriptorInput(input: {
  command: WebsitePageIngestionCommand;
  acquisitionResult: WebsiteHtmlAcquisitionResult;
  retrievedAt: string;
}): StorageObjectDescriptorInput<WebsiteIngestionArtifactMetadata> {
  const normalizedAcquisition = normalizeWebsiteHtmlAcquisitionResult(input.acquisitionResult);
  const metadata = buildWebsiteIngestionMetadata({
    sourceUrl: input.command.target.url,
    requestedMode: input.command.mode,
    acquisitionResult: normalizedAcquisition,
    retrievedAt: input.retrievedAt,
  });

  return {
    key: toStorageKey(normalizedAcquisition.resolvedUrl, input.retrievedAt),
    mediaType: "text/html",
    metadata,
  };
}

export function mapStoredWebsiteToStagedArtifactDescriptor(input: {
  command: WebsitePageIngestionCommand;
  acquisitionResult: WebsiteHtmlAcquisitionResult;
  storageDescriptor: StorageObjectDescriptor<StorageObjectMetadata>;
  expectedMetadata: WebsiteIngestionArtifactMetadata;
}): StagedArtifactDescriptor<WebsiteIngestionArtifactMetadata> {
  const normalizedAcquisition = normalizeWebsiteHtmlAcquisitionResult(input.acquisitionResult);
  return createStagedArtifactDescriptorFromStorageObjectDescriptor(
    {
      ...input.storageDescriptor,
      metadata: normalizeStoredWebsiteMetadata(input.storageDescriptor.metadata, input.expectedMetadata),
    },
    {
      sourceKind: "scrape",
      originalName: toOriginalName(normalizedAcquisition.resolvedUrl),
    },
  );
}

export function mapDomainResultToContractResult(
  completed: WebsitePageIngestionCompleted,
): IngestWebsitePageResult {
  return createIngestWebsitePageSuccessResult({
    sourceKind: "scrape",
    target: {
      url: completed.ingestion.target.url,
      label: completed.ingestion.target.label,
    },
    resolvedUrl: completed.ingestion.resolvedUrl,
    acquisitionMechanismUsed: completed.ingestion.acquisitionMechanismUsed,
    stagedArtifact: completed.stagedArtifact,
    warnings: completed.ingestion.warnings,
  });
}

export function mapBatchItemResultsToContractResult(items: IngestWebsitePageBatchItemResult[]): IngestWebsitePagesBatchResult {
  return createIngestWebsitePagesBatchSuccessResult({
    items,
    summary: {
      attempted: items.length,
      succeeded: items.filter((item) => item.result.ok).length,
      failed: items.filter((item) => !item.result.ok).length,
    },
  });
}
