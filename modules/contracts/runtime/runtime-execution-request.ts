import type { ContractBoundaryContext } from "../shared";
import { createRuntimeTarget, type RuntimeTarget } from "./runtime-target";
import type { RuntimeOperation } from "./runtime-operation";

export type RuntimeExecutionMetadata = Readonly<Record<string, unknown>>;

export interface RuntimeExecutionOptions {
  timeoutMs?: number;
  cancellationKey?: string;
  emitProgress?: boolean;
  includeDiagnostics?: boolean;
}

export interface RuntimeExecutionRequest<
  TInput = unknown,
  TMetadata extends RuntimeExecutionMetadata = RuntimeExecutionMetadata,
> extends ContractBoundaryContext {
  executionId: string;
  operation: RuntimeOperation;
  target: RuntimeTarget;
  input: TInput;
  options?: RuntimeExecutionOptions;
  metadata?: TMetadata;
  causationId?: string;
}

export function createRuntimeExecutionRequest<
  TInput,
  TMetadata extends RuntimeExecutionMetadata = RuntimeExecutionMetadata,
>(
  operation: RuntimeOperation,
  input: TInput,
  options: {
    executionId: string;
    target?: RuntimeTarget;
    runtimeKind?: string;
    requestId?: string;
    correlationId?: string;
    causationId?: string;
    executionOptions?: RuntimeExecutionOptions;
    metadata?: TMetadata;
  },
): RuntimeExecutionRequest<TInput, TMetadata> {
  return {
    executionId: options.executionId,
    operation,
    input,
    target: options.target ?? createRuntimeTarget(options.runtimeKind),
    requestId: options.requestId,
    correlationId: options.correlationId,
    causationId: options.causationId,
    options: options.executionOptions,
    metadata: options.metadata,
  };
}
