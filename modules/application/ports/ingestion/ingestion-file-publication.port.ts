import type { ApplicationRequestContext } from "../application-request-context";
import type { IngestionSha256Digest, IngestionTaskId, IngestionTaskFileId } from "../../../contracts/ingestion";
import type { OrganizationId } from "../../../contracts/organization";
import type { WorkspaceId } from "../../../contracts/workspace";
import type { ContractResult } from "../../../contracts/shared";
import type { ArtifactStreamStoragePort } from "../storage";

export interface IngestionFileByteStoragePort extends ArtifactStreamStoragePort {
  /** Bounded stream inspection, before reserving or publishing a target. */
  verifyContent(input: {
    readonly content: AsyncIterable<Uint8Array>;
    readonly maximumBytes: number;
    readonly expectedSizeBytes: number;
    readonly expectedSha256?: IngestionSha256Digest;
  }, context: ApplicationRequestContext): Promise<ContractResult<{ readonly sizeBytes: number; readonly digest: IngestionSha256Digest }>>;
}

export type IngestionFilePublicationOutcome =
  | { readonly kind: "content-rejected" }
  | { readonly kind: "published"; readonly publication: IngestionFilePublication };

/** Private effect records. Never accepted from an IPC/HTTP descriptor. */
export interface IngestionFilePublication {
  readonly schemaVersion: "1.0";
  readonly publicationId: string;
  readonly workspaceId: WorkspaceId;
  readonly organizationId?: OrganizationId;
  readonly taskId: IngestionTaskId;
  readonly fileId: IngestionTaskFileId;
  readonly taskCreatedAt: string;
  readonly checkpointExpiresAt?: string;
  readonly checkpointId: string;
  readonly fileName: string;
  readonly mediaType: string;
  readonly totalBytes: number;
  readonly acceptedBytes: number;
  readonly nextChunkIndex: number;
  readonly expectedSha256?: IngestionSha256Digest;
  readonly key: string;
  readonly capturedAt: string;
  readonly revision: number;
  readonly state: "reserved" | "writing" | "bytes-acknowledged" | "origin-issued" | "origin-complete" | "committed";
  readonly digest?: IngestionSha256Digest;
}

export interface IngestionFilePublicationRepositoryPort {
  createPublication(publication: IngestionFilePublication): Promise<IngestionFilePublication>;
  readPublication(workspaceId: WorkspaceId, taskId: IngestionTaskId, fileId: IngestionTaskFileId): Promise<IngestionFilePublication | undefined>;
  savePublication(publication: IngestionFilePublication, expectedRevision: number): Promise<IngestionFilePublication>;
}

export interface IngestionFilePublicationPort {
  publishFile(request: { readonly taskId: IngestionTaskId; readonly fileId: IngestionTaskFileId; readonly expectedSha256?: IngestionSha256Digest }, context: ApplicationRequestContext): Promise<IngestionFilePublicationOutcome>;
  /** Read only: an existing output never acquires a missing origin on retry. */
  verifyFilePublication(request: { readonly taskId: IngestionTaskId; readonly fileId: IngestionTaskFileId; readonly expectedSha256?: IngestionSha256Digest }, context: ApplicationRequestContext): Promise<IngestionFilePublication>;
}
