import {
  type ContractBoundaryContext,
  type ContractError,
  type ContractErrorDetails,
  type ContractResult,
  createFailureResult,
  createSuccessResult,
} from "../shared";

export interface DeleteArtifactValue {
  deleted: boolean;
}

export type DeleteArtifactResult<
  TDetails extends ContractErrorDetails = ContractErrorDetails,
> = ContractResult<DeleteArtifactValue, TDetails>;

export function createDeleteArtifactSuccessResult(
  deleted = true,
  context?: ContractBoundaryContext,
): DeleteArtifactResult {
  return createSuccessResult({ deleted }, context);
}

export function createDeleteArtifactFailureResult<
  TDetails extends ContractErrorDetails = ContractErrorDetails,
>(
  error: ContractError<TDetails>,
  context?: ContractBoundaryContext,
): DeleteArtifactResult<TDetails> {
  return createFailureResult(error, context);
}
