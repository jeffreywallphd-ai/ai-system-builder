import type { ContractError, ContractResult } from "../shared";
import { createFailureResult, createSuccessResult } from "../shared";
import {
  normalizeArtifactRepoDescriptor,
  type ArtifactRepoDescriptor,
} from "./artifact-repo-descriptor";

export interface StoreArtifactInRepoSuccessValue {
  descriptor: ArtifactRepoDescriptor;
}

export type StoreArtifactInRepoResult = ContractResult<StoreArtifactInRepoSuccessValue>;

export function createStoreArtifactInRepoSuccessResult(
  descriptor: ArtifactRepoDescriptor,
  options?: {
    requestId?: string;
    correlationId?: string;
  },
): StoreArtifactInRepoResult {
  return createSuccessResult(
    {
      descriptor: normalizeArtifactRepoDescriptor(descriptor),
    },
    options,
  );
}

export function createStoreArtifactInRepoFailureResult(
  error: ContractError,
  options?: {
    requestId?: string;
    correlationId?: string;
  },
): StoreArtifactInRepoResult {
  return createFailureResult(error, options);
}
