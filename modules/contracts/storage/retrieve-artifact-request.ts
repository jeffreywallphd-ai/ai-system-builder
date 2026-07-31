import type { ContractBoundaryContext } from "../shared";
import {
  normalizeStorageArtifactKey,
  type StorageArtifactKey,
} from "./storage-artifact-key";

export interface RetrieveArtifactRequest extends ContractBoundaryContext {
  key: StorageArtifactKey;
  maximumBytes?: number;
}

export const RETRIEVE_ARTIFACT_MAXIMUM_BYTES = 64 * 1024 * 1024;

export interface RetrieveArtifactRequestOptions extends ContractBoundaryContext {
  maximumBytes?: number;
}

export function createRetrieveArtifactRequest(
  key: string,
  options?: RetrieveArtifactRequestOptions,
): RetrieveArtifactRequest {
  if (
    options?.maximumBytes !== undefined &&
    (!Number.isInteger(options.maximumBytes) ||
      options.maximumBytes < 1 ||
      options.maximumBytes > RETRIEVE_ARTIFACT_MAXIMUM_BYTES)
  ) {
    throw new Error(
      `maximumBytes must be an integer between 1 and ${RETRIEVE_ARTIFACT_MAXIMUM_BYTES}.`,
    );
  }

  return {
    key: normalizeStorageArtifactKey(key),
    maximumBytes: options?.maximumBytes,
    requestId: options?.requestId,
    correlationId: options?.correlationId,
  };
}
