import {
  resolveLogVerbosity,
  type LogLevel,
  type LogVerbosity,
  type LogVerbosityConfig,
} from "../logging";

export interface LoggingConfig extends LogVerbosityConfig {
  level?: LogLevel;
  includeDiagnostics?: boolean;
}

export function createLoggingConfig(options?: {
  verbosity?: string;
  fallbackVerbosity?: LogVerbosity;
  level?: LogLevel;
  includeDiagnostics?: boolean;
}): LoggingConfig {
  return {
    verbosity: resolveLogVerbosity(
      options?.verbosity,
      options?.fallbackVerbosity,
    ),
    level: options?.level,
    includeDiagnostics: options?.includeDiagnostics,
  };
}
