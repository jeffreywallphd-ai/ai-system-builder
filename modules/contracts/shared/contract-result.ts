import type {
  ContractBoundaryContext,
  ContractError,
  ContractErrorDetails,
} from "./contract-error";

export interface ContractSuccess<TValue> extends ContractBoundaryContext {
  ok: true;
  value: TValue;
}

export interface ContractFailure<
  TDetails extends ContractErrorDetails = ContractErrorDetails,
> extends ContractBoundaryContext {
  ok: false;
  error: ContractError<TDetails>;
}

export type ContractResult<
  TValue,
  TDetails extends ContractErrorDetails = ContractErrorDetails,
> = ContractSuccess<TValue> | ContractFailure<TDetails>;

export function createSuccessResult<TValue>(
  value: TValue,
  context?: ContractBoundaryContext,
): ContractSuccess<TValue> {
  return {
    ok: true,
    value,
    correlationId: context?.correlationId,
    requestId: context?.requestId,
  };
}

export function createFailureResult<
  TDetails extends ContractErrorDetails = ContractErrorDetails,
>(
  error: ContractError<TDetails>,
  context?: ContractBoundaryContext,
): ContractFailure<TDetails> {
  return {
    ok: false,
    error,
    correlationId: context?.correlationId ?? error.correlationId,
    requestId: context?.requestId ?? error.requestId,
  };
}

export function isContractSuccess<TValue>(
  result: ContractResult<TValue>,
): result is ContractSuccess<TValue> {
  return result.ok;
}

export function isContractFailure<
  TValue,
  TDetails extends ContractErrorDetails = ContractErrorDetails,
>(result: ContractResult<TValue, TDetails>): result is ContractFailure<TDetails> {
  return !result.ok;
}
