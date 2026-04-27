import {
  type ContractError,
  type ContractErrorDetails,
  type ContractResult,
  createFailureResult,
  createSuccessResult,
} from "../shared";
import {
  normalizeIngestWebsitePageSuccessValue,
  type IngestWebsitePageResult,
  type IngestWebsitePageSuccessValue,
} from "./ingest-website-page-result";
import {
  normalizeWebsiteIngestionTarget,
  type WebsiteIngestionTarget,
} from "./website-ingestion-target";

export interface IngestWebsitePagesBatchSummary {
  attempted: number;
  succeeded: number;
  failed: number;
}

export interface IngestWebsitePageBatchItemResult {
  target: WebsiteIngestionTarget;
  result: IngestWebsitePageResult;
}

export interface IngestWebsitePagesBatchSuccessValue {
  items: IngestWebsitePageBatchItemResult[];
  summary: IngestWebsitePagesBatchSummary;
}

export type IngestWebsitePagesBatchResult<
  TDetails extends ContractErrorDetails = ContractErrorDetails,
> = ContractResult<IngestWebsitePagesBatchSuccessValue, TDetails>;

function normalizeItemResult(item: IngestWebsitePageBatchItemResult): IngestWebsitePageBatchItemResult {
  if (item.result.ok) {
    return {
      target: normalizeWebsiteIngestionTarget(item.target),
      result: {
        ...item.result,
        value: normalizeIngestWebsitePageSuccessValue(item.result.value as IngestWebsitePageSuccessValue),
      },
    };
  }

  return {
    target: normalizeWebsiteIngestionTarget(item.target),
    result: item.result,
  };
}

export function normalizeIngestWebsitePagesBatchSuccessValue(
  value: IngestWebsitePagesBatchSuccessValue,
): IngestWebsitePagesBatchSuccessValue {
  const items = value.items.map((item) => normalizeItemResult(item));
  const attempted = items.length;

  if (value.summary.attempted !== attempted) {
    throw new Error(`Batch summary attempted count must equal item count (${attempted}).`);
  }

  if (value.summary.succeeded + value.summary.failed !== attempted) {
    throw new Error("Batch summary counts must satisfy succeeded + failed === attempted.");
  }

  return {
    items,
    summary: {
      attempted,
      succeeded: value.summary.succeeded,
      failed: value.summary.failed,
    },
  };
}

export function createIngestWebsitePagesBatchSuccessResult<
  TDetails extends ContractErrorDetails = ContractErrorDetails,
>(
  value: IngestWebsitePagesBatchSuccessValue,
): IngestWebsitePagesBatchResult<TDetails> {
  return createSuccessResult(normalizeIngestWebsitePagesBatchSuccessValue(value));
}

export function createIngestWebsitePagesBatchFailureResult<
  TDetails extends ContractErrorDetails = ContractErrorDetails,
>(
  error: ContractError<TDetails>,
): IngestWebsitePagesBatchResult<TDetails> {
  return createFailureResult(error);
}
