import type { WorkspaceId } from "../workspace";
import type { EffectiveAssetProjectionId } from "./effective-asset-projection-identity";
import type { EffectiveAssetProjectionPolicy } from "./effective-asset-projection-policy";
import type { SafeEffectiveAssetProjectedFieldPatch } from "./effective-asset-projected-fields";
import type { EffectiveAssetProjectionSource, EffectiveAssetProjectionTarget } from "./effective-asset-projection-source";

export const EFFECTIVE_ASSET_PROJECTION_REFRESH_REASONS = ["source-updated","override-updated","override-disabled","draft-published","source-missing","conflict-detected","unsafe-field-detected","manual-refresh-requested"] as const;
export type EffectiveAssetProjectionRefreshReason = (typeof EFFECTIVE_ASSET_PROJECTION_REFRESH_REASONS)[number];
export type EffectiveAssetProjectionInvalidationReason = EffectiveAssetProjectionRefreshReason;

export function normalizeEffectiveAssetProjectionRefreshReason(value: string): EffectiveAssetProjectionRefreshReason {
  const normalized = value.trim().toLowerCase() as EffectiveAssetProjectionRefreshReason;
  if (!EFFECTIVE_ASSET_PROJECTION_REFRESH_REASONS.includes(normalized)) {
    throw new Error("Effective asset projection refresh reason is invalid.");
  }
  return normalized;
}

export type CreateEffectiveAssetProjectionCommand = { targetWorkspaceId: WorkspaceId; source: EffectiveAssetProjectionSource; target: EffectiveAssetProjectionTarget; policy: EffectiveAssetProjectionPolicy; projectedFieldPatch?: SafeEffectiveAssetProjectedFieldPatch; };
export type RefreshEffectiveAssetProjectionCommand = { targetWorkspaceId: WorkspaceId; projectionId: EffectiveAssetProjectionId; reason: EffectiveAssetProjectionRefreshReason; };
export type InvalidateEffectiveAssetProjectionCommand = { targetWorkspaceId: WorkspaceId; projectionId: EffectiveAssetProjectionId; reason: EffectiveAssetProjectionInvalidationReason; };
export type ReadEffectiveAssetProjectionCommand = { targetWorkspaceId: WorkspaceId; projectionId: EffectiveAssetProjectionId; };
export type ListEffectiveAssetProjectionsCommand = { targetWorkspaceId: WorkspaceId; status?: string; sourceKind?: string; limit?: number; cursor?: string; };
export type PreviewDraftEffectiveAssetProjectionCommand = { targetWorkspaceId: WorkspaceId; source: EffectiveAssetProjectionSource; policy: "draft-preview-only"; projectedFieldPatch?: SafeEffectiveAssetProjectedFieldPatch; };
export type ValidateEffectiveAssetProjectionReadinessCommand = { targetWorkspaceId: WorkspaceId; projectionId: EffectiveAssetProjectionId; requiredPolicy?: EffectiveAssetProjectionPolicy; };
