import type { ApplicationRequestContext } from "../application-request-context";
import type { ContractResult } from "../../../contracts/shared";
import type { DatasetPublicationVisibility, DatasetVersionDigest } from "../../../contracts/dataset";

export interface DatasetVersionPublicationFile {
  readonly path: string;
  readonly content: Uint8Array;
  readonly mediaType: string;
  readonly digest: DatasetVersionDigest;
}

export interface DatasetVersionPublishRequest {
  readonly provider: "hugging-face";
  readonly repositoryId: string;
  readonly branch: string;
  readonly visibility: DatasetPublicationVisibility;
  readonly repositoryCreationApproved: boolean;
  readonly versionDigest: DatasetVersionDigest;
  readonly files: readonly DatasetVersionPublicationFile[];
}

export interface DatasetVersionPublishValue {
  readonly provider: "hugging-face";
  readonly repositoryId: string;
  readonly revision: string;
}

export interface DatasetVersionPublisherPort {
  publishDatasetVersion(
    request: DatasetVersionPublishRequest,
    context?: ApplicationRequestContext,
  ): Promise<ContractResult<DatasetVersionPublishValue>>;
}
