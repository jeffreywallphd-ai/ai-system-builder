export const RUNTIME_READINESS_ACTIONS = [
  "wait",
  "start",
  "install",
  "repair",
  "configure",
  "retry",
  "view-logs",
] as const;

export type RuntimeReadinessAction = (typeof RUNTIME_READINESS_ACTIONS)[number];

export function isRuntimeReadinessAction(value: string): value is RuntimeReadinessAction {
  return (RUNTIME_READINESS_ACTIONS as readonly string[]).includes(value);
}

export function normalizeRuntimeReadinessAction(value: string): RuntimeReadinessAction {
  const normalized = value.trim().toLowerCase();
  if (!isRuntimeReadinessAction(normalized)) {
    throw new Error(`Unknown runtime readiness action: ${value}`);
  }

  return normalized;
}
