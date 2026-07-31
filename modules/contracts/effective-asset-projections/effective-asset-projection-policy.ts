export const EFFECTIVE_ASSET_PROJECTION_POLICIES = ["summary-only", "safe-fields-only", "draft-preview-only", "execution-ready-metadata-only", "blocked"] as const;
export type EffectiveAssetProjectionPolicy = (typeof EFFECTIVE_ASSET_PROJECTION_POLICIES)[number];
export const isEffectiveAssetProjectionPolicy = (value: unknown): value is EffectiveAssetProjectionPolicy =>
  typeof value === "string" && EFFECTIVE_ASSET_PROJECTION_POLICIES.includes(value.trim().toLowerCase() as EffectiveAssetProjectionPolicy);
export function normalizeEffectiveAssetProjectionPolicy(value: string): EffectiveAssetProjectionPolicy {
  const normalized = value.trim().toLowerCase() as EffectiveAssetProjectionPolicy;
  if (!EFFECTIVE_ASSET_PROJECTION_POLICIES.includes(normalized)) throw new Error("Effective asset projection policy is invalid.");
  return normalized;
}
