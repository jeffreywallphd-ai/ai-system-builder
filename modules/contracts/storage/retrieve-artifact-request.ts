import type { ContractBoundaryContext } from "../shared";
import { normalizeStorageArtifactKey, type StorageArtifactKey } from "./storage-artifact-key";

export interface RetrieveArtifactRequest extends ContractBoundaryContext {
  key: StorageArtifactKey;
}

export function createRetrieveArtifactRequest(
  key: string,
  options?: ContractBoundaryContext,
): RetrieveArtifactRequest {
  return {
    key: normalizeStorageArtifactKey(key),
    requestId: options?.requestId,
    correlationId: options?.correlationId,
  };
}
