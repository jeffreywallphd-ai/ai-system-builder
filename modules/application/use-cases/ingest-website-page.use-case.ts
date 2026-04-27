import {
  createIngestWebsitePageFailureResult,
  createIngestWebsitePageRequest,
  type IngestWebsitePageRequest,
  type IngestWebsitePageResult,
} from "../../contracts/ingestion";
import { createContractError } from "../../contracts/shared";
import { createStoreArtifactRequest } from "../../contracts/storage";

import type { ApplicationRequestContext } from "../ports";
import type { WebsiteHtmlAcquisitionPort } from "../ports/ingestion";
import type { ArtifactObjectStoragePort } from "../ports/storage";
import {
  mapAcquisitionResultToDomain,
  mapAcquisitionResultToStorageDescriptorInput,
  mapDomainCommandToAcquisitionRequest,
  mapDomainResultToContractResult,
  mapIngestWebsitePageRequestToDomain,
  mapStoredWebsiteToStagedArtifactDescriptor,
} from "./website-ingestion/website-ingestion.mappers";

export interface IngestWebsitePageUseCaseDependencies {
  acquisition: WebsiteHtmlAcquisitionPort;
  storage: ArtifactObjectStoragePort;
  now?: () => string;
}

export class IngestWebsitePageUseCase {
  private readonly acquisition: WebsiteHtmlAcquisitionPort;
  private readonly storage: ArtifactObjectStoragePort;
  private readonly now: () => string;

  public constructor(dependencies: IngestWebsitePageUseCaseDependencies) {
    this.acquisition = dependencies.acquisition;
    this.storage = dependencies.storage;
    this.now = dependencies.now ?? (() => new Date().toISOString());
  }

  public async execute(
    request: IngestWebsitePageRequest,
    context?: ApplicationRequestContext,
  ): Promise<IngestWebsitePageResult> {
    try {
      const normalizedRequest = createIngestWebsitePageRequest(request);
      const domainCommand = mapIngestWebsitePageRequestToDomain(normalizedRequest);
      const acquisitionRequest = mapDomainCommandToAcquisitionRequest(domainCommand);
      const acquisitionResult = await this.acquisition.acquireWebsiteHtml(acquisitionRequest, context);
      const domainResult = mapAcquisitionResultToDomain(acquisitionResult, domainCommand);

      const retrievedAt = this.now();
      const htmlBytes = new TextEncoder().encode(acquisitionResult.html);
      const storageDescriptorInput = mapAcquisitionResultToStorageDescriptorInput({
        command: domainCommand,
        acquisitionResult,
        retrievedAt,
      });
      const storageRequest = createStoreArtifactRequest(htmlBytes, {
        descriptor: storageDescriptorInput,
      });

      const expectedMetadata = storageDescriptorInput.metadata;
      if (!expectedMetadata) {
        throw new Error("Website ingestion storage descriptor metadata was not generated.");
      }

      const storeResult = await this.storage.storeArtifact(storageRequest, context);
      if (!storeResult.ok) {
        return createIngestWebsitePageFailureResult(storeResult.error);
      }

      const stagedArtifact = mapStoredWebsiteToStagedArtifactDescriptor({
        command: domainCommand,
        acquisitionResult,
        storageDescriptor: storeResult.value,
        expectedMetadata,
      });

      return mapDomainResultToContractResult({
        ingestion: domainResult,
        stagedArtifact,
      });
    } catch (error) {
      const code = error instanceof Error && error.message.includes("must") ? "validation" : "internal";
      return createIngestWebsitePageFailureResult(
        createContractError(
          code,
          error instanceof Error ? error.message : "Website ingestion failed unexpectedly.",
        ),
      );
    }
  }
}
