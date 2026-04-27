import {
  normalizeOptionalWebsiteIngestionMode,
  type WebsiteIngestionMode,
} from "./website-ingestion-mode";
import {
  normalizeWebsiteIngestionTarget,
  type WebsiteIngestionTarget,
} from "./website-ingestion-target";

export interface IngestWebsitePagesBatchRequest {
  targets: WebsiteIngestionTarget[];
  mode?: WebsiteIngestionMode;
}

export function createIngestWebsitePagesBatchRequest(
  request: IngestWebsitePagesBatchRequest,
): IngestWebsitePagesBatchRequest {
  if (request.targets.length === 0) {
    throw new Error("Website batch ingestion request must include at least one target.");
  }

  return {
    targets: request.targets.map((target) => normalizeWebsiteIngestionTarget(target)),
    mode:
      typeof request.mode === "string"
        ? normalizeOptionalWebsiteIngestionMode(request.mode)
        : undefined,
  };
}
