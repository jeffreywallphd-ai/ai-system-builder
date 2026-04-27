import type {
  LogHost,
  StructuredLogData,
  StructuredLogDiagnosticFields,
  StructuredLogEvent,
} from "../logging";
import type { ContractBoundaryContext } from "../shared";

export type RuntimeExecutionDiagnosticData = StructuredLogData;
export type RuntimeDiagnosticEvent = `runtime.${string}`;

export interface RuntimeDiagnosticLogContext extends ContractBoundaryContext {
  host?: LogHost;
  operation?: string;
  useCase?: string;
  subsystem?: string;
}

export interface RuntimeExecutionDiagnostic<
  TData extends RuntimeExecutionDiagnosticData = RuntimeExecutionDiagnosticData,
> extends Omit<StructuredLogDiagnosticFields<TData>, "event"> {
  event: RuntimeDiagnosticEvent;
  executionId?: string;
  stage?: string;
}

export interface RuntimeExecutionDiagnosticInput<
  TData extends RuntimeExecutionDiagnosticData = RuntimeExecutionDiagnosticData,
> extends Omit<RuntimeExecutionDiagnostic<TData>, "event"> {
  event: string;
}

export function isRuntimeDiagnosticEvent(
  value: string,
): value is RuntimeDiagnosticEvent {
  return value.startsWith("runtime.") && value.length > "runtime.".length;
}

export function normalizeRuntimeDiagnosticEvent(
  event: string,
): RuntimeDiagnosticEvent {
  const normalizedEvent = event.trim().toLowerCase();
  if (!isRuntimeDiagnosticEvent(normalizedEvent)) {
    throw new Error("Runtime diagnostic events must use the runtime.* namespace");
  }

  return normalizedEvent;
}

export function createRuntimeExecutionDiagnostic<
  TData extends RuntimeExecutionDiagnosticData = RuntimeExecutionDiagnosticData,
>(
  diagnostic: RuntimeExecutionDiagnosticInput<TData>,
): RuntimeExecutionDiagnostic<TData> {
  return {
    ...diagnostic,
    event: normalizeRuntimeDiagnosticEvent(diagnostic.event),
  };
}

export function mapRuntimeDiagnosticToStructuredLogEvent<
  TData extends RuntimeExecutionDiagnosticData = RuntimeExecutionDiagnosticData,
>(
  diagnostic: RuntimeExecutionDiagnostic<TData>,
  context?: RuntimeDiagnosticLogContext,
): StructuredLogEvent<TData> {
  return {
    timestamp: diagnostic.timestamp,
    level: diagnostic.level,
    verbosity: diagnostic.verbosity,
    event: diagnostic.event,
    message: diagnostic.message,
    component: diagnostic.component,
    operation: diagnostic.operation ?? context?.operation,
    useCase: context?.useCase,
    host: context?.host,
    subsystem: context?.subsystem,
    outcome: diagnostic.outcome,
    durationMs: diagnostic.durationMs,
    data: diagnostic.data,
    error: diagnostic.error,
    requestId: context?.requestId,
    correlationId: context?.correlationId,
  };
}
