import {
  normalizeWebsiteIngestionResult,
  type WebsiteIngestionResult,
} from "./website-ingestion-result";

export interface WebsiteBatchIngestionSummary {
  attempted: number;
  succeeded: number;
  failed: number;
}

export interface WebsiteBatchIngestionResult {
  items: WebsiteIngestionResult[];
  summary: WebsiteBatchIngestionSummary;
}

export function normalizeWebsiteBatchIngestionResult(
  result: WebsiteBatchIngestionResult,
): WebsiteBatchIngestionResult {
  const items = result.items.map((item) => normalizeWebsiteIngestionResult(item));
  const attempted = items.length;
  const succeeded = result.summary.succeeded;
  const failed = result.summary.failed;

  if (result.summary.attempted !== attempted) {
    throw new Error(`Batch summary attempted count must equal item count (${attempted}).`);
  }

  if (succeeded + failed !== attempted) {
    throw new Error("Batch summary counts must satisfy succeeded + failed === attempted.");
  }

  return {
    items,
    summary: {
      attempted,
      succeeded,
      failed,
    },
  };
}
