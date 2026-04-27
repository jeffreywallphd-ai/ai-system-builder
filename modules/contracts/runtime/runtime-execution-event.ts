import type { ContractBoundaryContext } from "../shared";
import type { RuntimeExecutionDiagnostic } from "./runtime-execution-diagnostic";
import type { RuntimeOperation } from "./runtime-operation";
import type { RuntimeTarget } from "./runtime-target";

export type RuntimeExecutionEventMetadata = Readonly<Record<string, unknown>>;

export interface RuntimeExecutionEventEnvelope<
  TMetadata extends RuntimeExecutionEventMetadata = RuntimeExecutionEventMetadata,
> extends ContractBoundaryContext {
  type: "started" | "progress" | "output" | "completed";
  timestamp: string;
  operation: RuntimeOperation;
  executionId: string;
  target: RuntimeTarget;
  sequence: number;
  metadata?: TMetadata;
}

export interface RuntimeExecutionStartedEvent<
  TMetadata extends RuntimeExecutionEventMetadata = RuntimeExecutionEventMetadata,
> extends RuntimeExecutionEventEnvelope<TMetadata> {
  type: "started";
}

export interface RuntimeExecutionProgressEvent<
  TMetadata extends RuntimeExecutionEventMetadata = RuntimeExecutionEventMetadata,
> extends RuntimeExecutionEventEnvelope<TMetadata> {
  type: "progress";
  stage: string;
  message?: string;
  percent?: number;
  diagnostic?: RuntimeExecutionDiagnostic;
}

export interface RuntimeExecutionOutputEvent<
  TChunk = unknown,
  TMetadata extends RuntimeExecutionEventMetadata = RuntimeExecutionEventMetadata,
> extends RuntimeExecutionEventEnvelope<TMetadata> {
  type: "output";
  chunk: TChunk;
}

export interface RuntimeExecutionCompletedEvent<
  TMetadata extends RuntimeExecutionEventMetadata = RuntimeExecutionEventMetadata,
> extends RuntimeExecutionEventEnvelope<TMetadata> {
  type: "completed";
  durationMs?: number;
}

export type RuntimeExecutionEvent<
  TChunk = unknown,
  TMetadata extends RuntimeExecutionEventMetadata = RuntimeExecutionEventMetadata,
> =
  | RuntimeExecutionStartedEvent<TMetadata>
  | RuntimeExecutionProgressEvent<TMetadata>
  | RuntimeExecutionOutputEvent<TChunk, TMetadata>
  | RuntimeExecutionCompletedEvent<TMetadata>;

export function createRuntimeExecutionProgressEvent<
  TMetadata extends RuntimeExecutionEventMetadata = RuntimeExecutionEventMetadata,
>(
  operation: RuntimeOperation,
  executionId: string,
  target: RuntimeTarget,
  stage: string,
  options?: {
    sequence?: number;
    message?: string;
    percent?: number;
    diagnostic?: RuntimeExecutionDiagnostic;
    requestId?: string;
    correlationId?: string;
    metadata?: TMetadata;
  },
): RuntimeExecutionProgressEvent<TMetadata> {
  return {
    type: "progress",
    timestamp: new Date().toISOString(),
    operation,
    executionId,
    target,
    sequence: options?.sequence ?? 0,
    stage,
    message: options?.message,
    percent: options?.percent,
    diagnostic: options?.diagnostic,
    requestId: options?.requestId,
    correlationId: options?.correlationId,
    metadata: options?.metadata,
  };
}
