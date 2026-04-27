import type { ContractError, ContractResult } from "../shared";
import { createFailureResult, createSuccessResult } from "../shared";
import {
  normalizeArtifactRepoDescriptor,
  type ArtifactRepoDescriptor,
} from "./artifact-repo-descriptor";

export interface HasArtifactInRepoResultValue {
  exists: boolean;
  descriptor?: ArtifactRepoDescriptor;
}

export type HasArtifactInRepoResult = ContractResult<HasArtifactInRepoResultValue>;

export function createHasArtifactInRepoSuccessResult(
  exists: boolean,
  options?: {
    descriptor?: ArtifactRepoDescriptor;
    requestId?: string;
    correlationId?: string;
  },
): HasArtifactInRepoResult {
  return createSuccessResult(
    {
      exists,
      descriptor: options?.descriptor
        ? normalizeArtifactRepoDescriptor(options.descriptor)
        : undefined,
    },
    options,
  );
}

export function createHasArtifactInRepoFailureResult(
  error: ContractError,
  options?: {
    requestId?: string;
    correlationId?: string;
  },
): HasArtifactInRepoResult {
  return createFailureResult(error, options);
}
