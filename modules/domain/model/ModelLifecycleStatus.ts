export const MODEL_LIFECYCLE_STATUSES = [
  "remote-reference",
  "saved-reference",
  "downloaded",
  "generated",
  "validated",
  "invalid",
] as const;

export type ModelLifecycleStatus = (typeof MODEL_LIFECYCLE_STATUSES)[number];

const MODEL_LIFECYCLE_STATUS_SET = new Set<string>(MODEL_LIFECYCLE_STATUSES);

export function normalizeModelLifecycleStatus(value: string): ModelLifecycleStatus {
  const normalized = value.trim().toLowerCase();
  if (MODEL_LIFECYCLE_STATUS_SET.has(normalized)) {
    return normalized as ModelLifecycleStatus;
  }

  throw new Error(
    `Model lifecycle status must be one of: ${MODEL_LIFECYCLE_STATUSES.join(", ")}. Received: ${value}`,
  );
}
