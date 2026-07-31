import type { AssetCompositionNodeStatus } from "../../../contracts/asset-composition";
import type { EffectiveAssetProjectionStatus } from "../../../contracts/effective-asset-projections";

export const mapProjectionStatusToNodeStatus = (status: EffectiveAssetProjectionStatus): AssetCompositionNodeStatus => {
  switch (status) {
    case "ready": return "ready-for-planning";
    case "stale": return "stale-projection";
    case "conflicted": return "conflicted";
    case "blocked": return "blocked";
    case "disabled": return "disabled";
    case "unsupported": return "unsupported";
    case "source-missing": return "missing-projection";
    case "invalid":
    case "draft-only":
    default: return "invalid";
  }
};
