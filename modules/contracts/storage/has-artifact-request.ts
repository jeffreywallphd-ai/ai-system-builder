import type { ContractBoundaryContext } from "../shared";
import { normalizeStorageArtifactKey, type StorageArtifactKey } from "./storage-artifact-key";

export interface HasArtifactRequest extends ContractBoundaryContext {
  key: StorageArtifactKey;
}

export function createHasArtifactRequest(
  key: string,
  options?: ContractBoundaryContext,
): HasArtifactRequest {
  return {
    key: normalizeStorageArtifactKey(key),
    requestId: options?.requestId,
    correlationId: options?.correlationId,
  };
}
