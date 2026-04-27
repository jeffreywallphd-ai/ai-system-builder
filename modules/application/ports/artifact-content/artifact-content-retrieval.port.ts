import type { ContractResult } from "../../../contracts/shared";
import type { ApplicationRequestContext } from "../application-request-context";

export interface RetrieveArtifactViewerMediaByStorageKeyRequest {
  storageKey: string;
}

export interface ArtifactContentRetrievalValue {
  storageKey: string;
  mediaType?: string;
  sizeBytes?: number;
  bytes: Uint8Array;
}

export interface ArtifactContentRetrievalPort {
  retrieveArtifactViewerMediaByStorageKey(
    request: RetrieveArtifactViewerMediaByStorageKeyRequest,
    context?: ApplicationRequestContext,
  ): Promise<ContractResult<ArtifactContentRetrievalValue>>;
}
