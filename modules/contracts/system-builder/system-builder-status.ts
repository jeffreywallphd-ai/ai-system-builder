export const SYSTEM_BUILDER_STATUSES = [
  "draft",
  "in-composition",
  "blocked",
  "ready-for-validation",
  "validated",
  "archived",
] as const;

export type SystemBuilderStatus = (typeof SYSTEM_BUILDER_STATUSES)[number];

export function isSystemBuilderStatus(value: unknown): value is SystemBuilderStatus {
  return typeof value === "string" && SYSTEM_BUILDER_STATUSES.includes(value as SystemBuilderStatus);
}

export function normalizeSystemBuilderStatus(value: string): SystemBuilderStatus {
  const normalized = value.trim().toLowerCase();
  if (!isSystemBuilderStatus(normalized)) {
    throw new Error(`System Builder status must be one of ${SYSTEM_BUILDER_STATUSES.join(", ")}.`);
  }
  return normalized;
}
