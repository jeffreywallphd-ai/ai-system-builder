import type { LoggingPort } from "../../../application/ports/logging";
import { createLoggingConfig, type LoggingConfig } from "../../../contracts/config";
import type {
  LogHost,
  LogLevel,
  LogVerbosity,
  StructuredLogEvent,
} from "../../../contracts/logging";

export type StructuredLogSink = (
  serializedEvent: string,
  event: StructuredLogEvent,
) => void | Promise<void>;

export interface CreateLoggerOptions {
  config?: LoggingConfig;
  host?: LogHost;
  component?: string;
  sink?: StructuredLogSink;
  now?: () => string;
}

const LOG_LEVEL_ORDER: Record<LogLevel, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
};

const LOG_VERBOSITY_ORDER: Record<LogVerbosity, number> = {
  minimal: 1,
  normal: 2,
  verbose: 3,
  trace: 4,
};

function shouldEmitByLevel(eventLevel: LogLevel, configuredLevel: LogLevel): boolean {
  return LOG_LEVEL_ORDER[eventLevel] >= LOG_LEVEL_ORDER[configuredLevel];
}

function shouldEmitByVerbosity(
  eventVerbosity: LogVerbosity,
  configuredVerbosity: LogVerbosity,
): boolean {
  return LOG_VERBOSITY_ORDER[eventVerbosity] <= LOG_VERBOSITY_ORDER[configuredVerbosity];
}

function getConsoleWriterForLevel(level: LogLevel): (message: string) => void {
  if (level === "fatal" || level === "error") {
    return (message) => console.error(message);
  }

  if (level === "warn") {
    return (message) => console.warn(message);
  }

  if (level === "debug" || level === "trace") {
    return (message) => console.debug(message);
  }

  return (message) => console.info(message);
}

async function defaultSink(
  serializedEvent: string,
  event: StructuredLogEvent,
): Promise<void> {
  getConsoleWriterForLevel(event.level)(serializedEvent);
}

function normalizeLogEvent(
  event: StructuredLogEvent,
  defaults: {
    host?: LogHost;
    component?: string;
    now: () => string;
  },
): StructuredLogEvent {
  return {
    ...event,
    timestamp: event.timestamp.trim().length > 0 ? event.timestamp : defaults.now(),
    host: event.host ?? defaults.host,
    component: event.component.trim().length > 0
      ? event.component
      : (defaults.component ?? "application"),
  };
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

export function createLogger(options: CreateLoggerOptions = {}): LoggingPort {
  const config = options.config ?? createLoggingConfig();
  const minimumLevel = config.level ?? "info";
  const verbosity = config.verbosity;
  const sink = options.sink ?? defaultSink;
  const now = options.now ?? (() => new Date().toISOString());

  return {
    async log(event): Promise<void> {
      if (!shouldEmitByLevel(event.level, minimumLevel)) {
        return;
      }

      if (!shouldEmitByVerbosity(event.verbosity, verbosity)) {
        return;
      }

      const eventToWrite = normalizeLogEvent(event, {
        host: options.host,
        component: options.component,
        now,
      });
      const serializedEvent = JSON.stringify(eventToWrite);

      try {
        await sink(serializedEvent, eventToWrite);
      } catch (error) {
        const sinkFailureEvent: StructuredLogEvent = {
          timestamp: now(),
          level: "error",
          verbosity: "normal",
          event: "observability.logging.write_failed",
          message: "Failed to write structured log event",
          component: "observability-logger",
          host: options.host,
          data: {
            sinkErrorMessage: toErrorMessage(error),
            failedEvent: eventToWrite.event,
          },
        };

        console.error(JSON.stringify(sinkFailureEvent));
      }
    },
  };
}
