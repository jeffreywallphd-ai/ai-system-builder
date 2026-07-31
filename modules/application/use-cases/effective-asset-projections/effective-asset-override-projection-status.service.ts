import type { AssetOverrideRecord } from "../../../contracts/asset-authoring";
import type { EffectiveAssetProjectionPolicy, EffectiveAssetProjectionStatus } from "../../../contracts/effective-asset-projections";

export function deriveOverrideProjectionStatus(overrideRecord: AssetOverrideRecord): { status: EffectiveAssetProjectionStatus; policy: EffectiveAssetProjectionPolicy; diagnosticCode?: "effective-projection-disabled-override"|"effective-projection-conflict-detected" } {
  if (overrideRecord.status === "disabled" || overrideRecord.status === "archived") {
    return { status: "disabled", policy: "blocked", diagnosticCode: "effective-projection-disabled-override" };
  }
  if (overrideRecord.conflictStatus === "open") {
    return { status: "conflicted", policy: "blocked", diagnosticCode: "effective-projection-conflict-detected" };
  }
  if (overrideRecord.status !== "active") {
    return { status: "blocked", policy: "blocked", diagnosticCode: "effective-projection-disabled-override" };
  }
  return { status: "ready", policy: "safe-fields-only" };
}
