import {
  type ContractBoundaryContext,
  type ContractFailure,
  type ContractSuccess,
  createFailureResult,
  createSuccessResult,
} from "../shared";
import type { RuntimeExecutionDiagnostic } from "./runtime-execution-diagnostic";
import {
  type RuntimeExecutionError,
  type RuntimeExecutionFailureDetails,
} from "./runtime-execution-error";
import type { RuntimeOperation } from "./runtime-operation";
import type { RuntimeTarget } from "./runtime-target";

export type RuntimeExecutionResultMetadata = Readonly<Record<string, unknown>>;

export interface RuntimeExecutionSuccessValue<TOutput = unknown> {
  output: TOutput;
  completedAt: string;
  durationMs?: number;
  diagnostics?: readonly RuntimeExecutionDiagnostic[];
}

export interface RuntimeExecutionEnvelope<
  TMetadata extends RuntimeExecutionResultMetadata = RuntimeExecutionResultMetadata,
> extends ContractBoundaryContext {
  operation: RuntimeOperation;
  executionId: string;
  target: RuntimeTarget;
  metadata?: TMetadata;
}

export type RuntimeExecutionSuccessResult<
  TOutput,
  TMetadata extends RuntimeExecutionResultMetadata = RuntimeExecutionResultMetadata,
> = RuntimeExecutionEnvelope<TMetadata> &
  ContractSuccess<RuntimeExecutionSuccessValue<TOutput>>;

export type RuntimeExecutionFailureResult<
  TDetails extends RuntimeExecutionFailureDetails = RuntimeExecutionFailureDetails,
  TMetadata extends RuntimeExecutionResultMetadata = RuntimeExecutionResultMetadata,
> = RuntimeExecutionEnvelope<TMetadata> &
  Omit<ContractFailure<TDetails>, "error"> & {
    error: RuntimeExecutionError<TDetails>;
  };

export type RuntimeExecutionResult<
  TOutput = unknown,
  TDetails extends RuntimeExecutionFailureDetails = RuntimeExecutionFailureDetails,
  TMetadata extends RuntimeExecutionResultMetadata = RuntimeExecutionResultMetadata,
> =
  | RuntimeExecutionSuccessResult<TOutput, TMetadata>
  | RuntimeExecutionFailureResult<TDetails, TMetadata>;

export function createRuntimeExecutionSuccessResult<
  TOutput,
  TMetadata extends RuntimeExecutionResultMetadata = RuntimeExecutionResultMetadata,
>(
  operation: RuntimeOperation,
  executionId: string,
  target: RuntimeTarget,
  output: TOutput,
  options?: {
    completedAt: string;
    durationMs?: number;
    diagnostics?: readonly RuntimeExecutionDiagnostic[];
    requestId?: string;
    correlationId?: string;
    metadata?: TMetadata;
  },
): RuntimeExecutionSuccessResult<TOutput, TMetadata> {
  const result = createSuccessResult<RuntimeExecutionSuccessValue<TOutput>>(
    {
      output,
      completedAt: options?.completedAt ?? new Date().toISOString(),
      durationMs: options?.durationMs,
      diagnostics: options?.diagnostics,
    },
    {
      requestId: options?.requestId,
      correlationId: options?.correlationId,
    },
  );

  return {
    ...result,
    operation,
    executionId,
    target,
    metadata: options?.metadata,
  };
}

export function createRuntimeExecutionFailureResult<
  TDetails extends RuntimeExecutionFailureDetails = RuntimeExecutionFailureDetails,
  TMetadata extends RuntimeExecutionResultMetadata = RuntimeExecutionResultMetadata,
>(
  error: RuntimeExecutionError<TDetails>,
  options?: {
    requestId?: string;
    correlationId?: string;
    metadata?: TMetadata;
  },
): RuntimeExecutionFailureResult<TDetails, TMetadata> {
  const result = createFailureResult(error, {
    requestId: options?.requestId,
    correlationId: options?.correlationId,
  });

  return {
    ...result,
    error,
    operation: error.operation,
    executionId: error.executionId,
    target: error.target,
    metadata: options?.metadata,
  };
}
