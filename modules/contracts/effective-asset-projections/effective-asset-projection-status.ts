export const EFFECTIVE_ASSET_PROJECTION_STATUSES = [
  "ready",
  "draft-only",
  "blocked",
  "conflicted",
  "invalid",
  "source-missing",
  "unsupported",
  "stale",
  "disabled",
] as const;
export type EffectiveAssetProjectionStatus = (typeof EFFECTIVE_ASSET_PROJECTION_STATUSES)[number];
export const isEffectiveAssetProjectionStatus = (value: unknown): value is EffectiveAssetProjectionStatus =>
  typeof value === "string" && EFFECTIVE_ASSET_PROJECTION_STATUSES.includes(value.trim().toLowerCase() as EffectiveAssetProjectionStatus);
export function normalizeEffectiveAssetProjectionStatus(value: string): EffectiveAssetProjectionStatus {
  const normalized = value.trim().toLowerCase() as EffectiveAssetProjectionStatus;
  if (!EFFECTIVE_ASSET_PROJECTION_STATUSES.includes(normalized)) throw new Error("Effective asset projection status is invalid.");
  return normalized;
}
