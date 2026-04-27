import {
  createIngestWebsitePagesBatchFailureResult,
  createIngestWebsitePagesBatchRequest,
  type IngestWebsitePageBatchItemResult,
  type IngestWebsitePagesBatchRequest,
  type IngestWebsitePagesBatchResult,
} from "../../contracts/ingestion";
import { createContractError } from "../../contracts/shared";

import type { ApplicationRequestContext } from "../ports";
import { IngestWebsitePageUseCase } from "./ingest-website-page.use-case";
import { mapBatchItemResultsToContractResult, mapBatchTargetToPageRequest } from "./website-ingestion/website-ingestion.mappers";

export interface IngestWebsitePagesBatchUseCaseDependencies {
  ingestWebsitePage: IngestWebsitePageUseCase;
}

export class IngestWebsitePagesBatchUseCase {
  private readonly ingestWebsitePage: IngestWebsitePageUseCase;

  public constructor(dependencies: IngestWebsitePagesBatchUseCaseDependencies) {
    this.ingestWebsitePage = dependencies.ingestWebsitePage;
  }

  public async execute(
    request: IngestWebsitePagesBatchRequest,
    context?: ApplicationRequestContext,
  ): Promise<IngestWebsitePagesBatchResult> {
    try {
      const normalizedRequest = createIngestWebsitePagesBatchRequest(request);
      const items: IngestWebsitePageBatchItemResult[] = [];

      for (const target of normalizedRequest.targets) {
        const pageRequest = mapBatchTargetToPageRequest({
          target,
          mode: normalizedRequest.mode,
        });

        const result = await this.ingestWebsitePage.execute(pageRequest, context);
        items.push({
          target,
          result,
        });
      }

      return mapBatchItemResultsToContractResult(items);
    } catch (error) {
      return createIngestWebsitePagesBatchFailureResult(
        createContractError(
          "validation",
          error instanceof Error ? error.message : "Batch website ingestion request was invalid.",
        ),
      );
    }
  }
}
