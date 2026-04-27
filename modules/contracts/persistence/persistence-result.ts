import {
  type ContractBoundaryContext,
  type ContractFailure,
  type ContractSuccess,
  createFailureResult,
  createSuccessResult,
} from "../shared";
import type {
  PersistenceError,
  PersistenceFailureDetails,
} from "./persistence-error";
import {
  assertPersistenceOperationMatchesRecord,
  type PersistenceOperation,
} from "./persistence-operation";
import type { PersistenceRecordReference } from "./persistence-record-reference";

export interface PersistenceResultEnvelope extends ContractBoundaryContext {
  operation: PersistenceOperation;
  record?: PersistenceRecordReference;
}

export type PersistenceSuccessResult<TValue> = PersistenceResultEnvelope &
  ContractSuccess<TValue>;

export type PersistenceFailureResult<
  TDetails extends PersistenceFailureDetails = PersistenceFailureDetails,
> = PersistenceResultEnvelope &
  Omit<ContractFailure<TDetails>, "error"> & {
    error: PersistenceError<TDetails>;
  };

export type PersistenceResult<
  TValue,
  TDetails extends PersistenceFailureDetails = PersistenceFailureDetails,
> = PersistenceSuccessResult<TValue> | PersistenceFailureResult<TDetails>;

export function createPersistenceSuccessResult<TValue>(
  operation: PersistenceOperation,
  value: TValue,
  options?: {
    requestId?: string;
    correlationId?: string;
    record?: PersistenceRecordReference;
  },
): PersistenceSuccessResult<TValue> {
  if (options?.record !== undefined) {
    assertPersistenceOperationMatchesRecord(operation, options.record);
  }

  const result = createSuccessResult(value, {
    requestId: options?.requestId,
    correlationId: options?.correlationId,
  });

  return {
    ...result,
    operation,
    record: options?.record,
  };
}

export function createPersistenceFailureResult<
  TDetails extends PersistenceFailureDetails = PersistenceFailureDetails,
>(
  error: PersistenceError<TDetails>,
  context?: ContractBoundaryContext,
): PersistenceFailureResult<TDetails> {
  const result = createFailureResult(error, context);

  return {
    ...result,
    error,
    operation: error.operation,
    record: error.record,
  };
}
