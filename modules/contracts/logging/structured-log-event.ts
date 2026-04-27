import type { ContractBoundaryContext } from "../shared";
import type { LogLevel } from "./log-level";
import type { LogVerbosity } from "./log-verbosity";

export type StructuredLogData = Readonly<Record<string, unknown>>;

export type LogHost = "desktop" | "server" | "hybrid";

export type LogEventOutcome = "success" | "failure" | "timeout" | "cancelled";

export interface StructuredLogError {
  errorType: string;
  errorMessage: string;
  errorCode?: string;
  details?: StructuredLogData;
}

export interface StructuredLogEvent<
  TData extends StructuredLogData = StructuredLogData,
> extends ContractBoundaryContext {
  timestamp: string;
  level: LogLevel;
  verbosity: LogVerbosity;
  event: string;
  message: string;
  subsystem?: string;
  component: string;
  operation?: string;
  useCase?: string;
  host?: LogHost;
  outcome?: LogEventOutcome;
  durationMs?: number;
  data?: TData;
  error?: StructuredLogError;
}

export type StructuredLogDiagnosticFields<
  TData extends StructuredLogData = StructuredLogData,
> = Pick<
  StructuredLogEvent<TData>,
  | "timestamp"
  | "level"
  | "verbosity"
  | "event"
  | "message"
  | "component"
  | "operation"
  | "outcome"
  | "durationMs"
  | "data"
  | "error"
>;
