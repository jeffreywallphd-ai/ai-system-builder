export const RUNTIME_READINESS_STATUSES = [
  "unknown",
  "unavailable",
  "not-installed",
  "installing",
  "starting",
  "ready",
  "degraded",
  "failed",
] as const;

export type RuntimeReadinessStatus = (typeof RUNTIME_READINESS_STATUSES)[number];

export function isRuntimeReadinessStatus(value: string): value is RuntimeReadinessStatus {
  return (RUNTIME_READINESS_STATUSES as readonly string[]).includes(value);
}

export function normalizeRuntimeReadinessStatus(value: string): RuntimeReadinessStatus {
  const normalized = value.trim().toLowerCase();
  if (!isRuntimeReadinessStatus(normalized)) {
    throw new Error(`Unknown runtime readiness status: ${value}`);
  }

  return normalized;
}
