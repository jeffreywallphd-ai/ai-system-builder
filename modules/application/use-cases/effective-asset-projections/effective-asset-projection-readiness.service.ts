import type { EffectiveAssetProjectionStatus } from "../../../contracts/effective-asset-projections";

const CONSUMABLE_STATUSES: ReadonlySet<EffectiveAssetProjectionStatus> = new Set(["ready"]);

export class EffectiveAssetProjectionReadinessService {
  isProjectionConsumable(status: EffectiveAssetProjectionStatus): boolean {
    return CONSUMABLE_STATUSES.has(status);
  }

  isProjectionReadyForDownstreamPlanning(status: EffectiveAssetProjectionStatus): boolean {
    return this.isProjectionConsumable(status);
  }

  isBlockedForDownstreamPlanning(status: EffectiveAssetProjectionStatus): boolean {
    return !this.isProjectionConsumable(status);
  }
}

export const defaultEffectiveAssetProjectionReadinessService = new EffectiveAssetProjectionReadinessService();
