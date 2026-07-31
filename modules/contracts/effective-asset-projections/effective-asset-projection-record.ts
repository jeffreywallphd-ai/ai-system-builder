import type { AssetReference } from "../asset";
import type { WorkspaceId } from "../workspace";
import type { EffectiveAssetProjectionDiagnostic, EffectiveAssetProjectionBlocker } from "./effective-asset-projection-diagnostics";
import type { EffectiveAssetProjectionId, EffectiveAssetProjectionRevisionId, EffectiveAssetProjectionSnapshotId } from "./effective-asset-projection-identity";
import type { EffectiveAssetProjectionPolicy } from "./effective-asset-projection-policy";
import type { EffectiveAssetProjectionProvenance } from "./effective-asset-projection-provenance";
import type { SafeEffectiveAssetProjectedFieldPatch } from "./effective-asset-projected-fields";
import type { EffectiveAssetProjectionSource, EffectiveAssetProjectionSourceKind, EffectiveAssetProjectionTarget } from "./effective-asset-projection-source";
import type { EffectiveAssetProjectionStatus } from "./effective-asset-projection-status";

export type EffectiveAssetProjectionRecord = { projectionId: EffectiveAssetProjectionId; targetWorkspaceId: WorkspaceId; source: EffectiveAssetProjectionSource; target: EffectiveAssetProjectionTarget; sourceAssetReference?: AssetReference; effectiveAssetReference: AssetReference; sourceKind: EffectiveAssetProjectionSourceKind; status: EffectiveAssetProjectionStatus; policy: EffectiveAssetProjectionPolicy; projectedFields: SafeEffectiveAssetProjectedFieldPatch; diagnostics: EffectiveAssetProjectionDiagnostic[]; blockers: EffectiveAssetProjectionBlocker[]; provenance: EffectiveAssetProjectionProvenance; sourceGraphSummary?: { sourceCount: number; hasOverrides: boolean; hasMissingSource: boolean; hasConflict: boolean; }; projectionRevisionId?: EffectiveAssetProjectionRevisionId; projectionSnapshotId?: EffectiveAssetProjectionSnapshotId; createdAt: string; updatedAt: string; materializedAt?: string; invalidatedAt?: string; invalidationReason?: string; };
export type EffectiveAssetProjectionSnapshotRecord = Omit<EffectiveAssetProjectionRecord, "projectionSnapshotId"|"createdAt"> & { projectionSnapshotId: EffectiveAssetProjectionSnapshotId; createdAt: string; };
