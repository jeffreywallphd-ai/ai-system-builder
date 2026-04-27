export const LOG_VERBOSITIES = [
  "minimal",
  "normal",
  "verbose",
  "trace",
] as const;

export type LogVerbosity = (typeof LOG_VERBOSITIES)[number];

export interface LogVerbosityConfig {
  verbosity: LogVerbosity;
}

export function isLogVerbosity(value: string): value is LogVerbosity {
  return (LOG_VERBOSITIES as readonly string[]).includes(value);
}

export function resolveLogVerbosity(
  value: string | undefined,
  fallback: LogVerbosity = "normal",
): LogVerbosity {
  if (!value) {
    return fallback;
  }

  const normalizedValue = value.trim().toLowerCase();
  if (isLogVerbosity(normalizedValue)) {
    return normalizedValue;
  }

  return fallback;
}
