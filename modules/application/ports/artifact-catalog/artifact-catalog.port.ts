import type { ContractResult } from "../../../contracts/shared";
import type { ApplicationRequestContext } from "../application-request-context";
import type { ArtifactCatalogRecord } from "./artifact-catalog-record";

export interface AppendArtifactCatalogRecordRequest {
  record: ArtifactCatalogRecord;
}

export interface BrowseArtifactCatalogRecordsRequest {
  artifactFamily?: ArtifactCatalogRecord["artifactFamily"];
}

export interface ReadArtifactCatalogRecordRequest {
  storageKey: string;
}

export interface DeleteArtifactCatalogRecordRequest {
  storageKey: string;
}

export interface ArtifactCatalogAppendPort {
  appendArtifactCatalogRecord(
    request: AppendArtifactCatalogRecordRequest,
    context?: ApplicationRequestContext,
  ): Promise<ContractResult<{ storageKey: string }>>;
}

export interface ArtifactCatalogReadPort {
  browseArtifactCatalogRecords(
    request: BrowseArtifactCatalogRecordsRequest,
    context?: ApplicationRequestContext,
  ): Promise<ContractResult<{ records: ArtifactCatalogRecord[] }>>;

  readArtifactCatalogRecord(
    request: ReadArtifactCatalogRecordRequest,
    context?: ApplicationRequestContext,
  ): Promise<ContractResult<{ record: ArtifactCatalogRecord }>>;
}

export interface ArtifactCatalogDeletePort {
  deleteArtifactCatalogRecord(
    request: DeleteArtifactCatalogRecordRequest,
    context?: ApplicationRequestContext,
  ): Promise<ContractResult<{ deleted: boolean }>>;
}
