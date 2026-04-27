import type { ContractError, ContractResult } from "../shared";
import { createFailureResult, createSuccessResult } from "../shared";
import {
  normalizeArtifactRepoDescriptor,
  type ArtifactRepoDescriptor,
} from "./artifact-repo-descriptor";

export interface RetrieveArtifactFromRepoResultValue {
  descriptor: ArtifactRepoDescriptor;
  content: Uint8Array;
}

export type RetrieveArtifactFromRepoResult = ContractResult<RetrieveArtifactFromRepoResultValue>;

export function createRetrieveArtifactFromRepoSuccessResult(
  descriptor: ArtifactRepoDescriptor,
  content: Uint8Array,
  options?: {
    requestId?: string;
    correlationId?: string;
  },
): RetrieveArtifactFromRepoResult {
  return createSuccessResult(
    {
      descriptor: normalizeArtifactRepoDescriptor(descriptor),
      content,
    },
    options,
  );
}

export function createRetrieveArtifactFromRepoFailureResult(
  error: ContractError,
  options?: {
    requestId?: string;
    correlationId?: string;
  },
): RetrieveArtifactFromRepoResult {
  return createFailureResult(error, options);
}
