import type { EffectiveAssetProjectionRecord } from "../../../contracts/effective-asset-projections";
import type { AssetCompositionDiagnosticCode, AssetCompositionFailureKind } from "../../../contracts/asset-composition";

export type ProjectionSelectionFailure = { kind: AssetCompositionFailureKind; code: AssetCompositionDiagnosticCode };

export const validateProjectionForSelection = (projection: EffectiveAssetProjectionRecord): ProjectionSelectionFailure | undefined => {
  switch (projection.status) {
    case "ready": return undefined;
    case "conflicted": return { kind: "conflict", code: "asset-composition-projection-conflicted" };
    case "stale": return { kind: "stale", code: "asset-composition-projection-stale" };
    case "unsupported": return { kind: "unsupported", code: "asset-composition-projection-not-ready-for-planning" };
    case "draft-only": return { kind: "blocked", code: "asset-composition-projection-not-ready-for-planning" };
    case "blocked": return { kind: "blocked", code: "asset-composition-projection-blocked" };
    case "disabled": return { kind: "blocked", code: "asset-composition-projection-disabled" };
    case "source-missing": return { kind: "blocked", code: "asset-composition-projection-missing" };
    case "invalid": return { kind: "blocked", code: "asset-composition-projection-not-ready-for-planning" };
    default: return { kind: "blocked", code: "asset-composition-projection-not-ready-for-planning" };
  }
};
