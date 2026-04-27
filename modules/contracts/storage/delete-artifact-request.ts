import type { ContractBoundaryContext } from "../shared";
import { normalizeStorageArtifactKey, type StorageArtifactKey } from "./storage-artifact-key";

export interface DeleteArtifactRequest extends ContractBoundaryContext {
  key: StorageArtifactKey;
}

export function createDeleteArtifactRequest(
  key: string,
  options?: ContractBoundaryContext,
): DeleteArtifactRequest {
  return {
    key: normalizeStorageArtifactKey(key),
    requestId: options?.requestId,
    correlationId: options?.correlationId,
  };
}
