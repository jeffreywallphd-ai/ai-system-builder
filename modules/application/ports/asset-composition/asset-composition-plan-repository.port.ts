import type { AssetReference } from "../../../contracts/asset";
import type { AssetCompositionNodeRole, AssetCompositionPlan, AssetCompositionPlanId, AssetCompositionPlanStatus, AssetCompositionRelationshipKind, AssetCompositionCompatibilityStatus } from "../../../contracts/asset-composition";
import type { EffectiveAssetProjectionId } from "../../../contracts/effective-asset-projections";
import type { WorkspaceId } from "../../../contracts/workspace";

export interface AssetCompositionPlanListQuery {
  readonly targetWorkspaceId: WorkspaceId;
  readonly status?: AssetCompositionPlanStatus;
  readonly selectedProjectionId?: EffectiveAssetProjectionId;
  readonly effectiveAssetReference?: AssetReference;
  readonly nodeRole?: AssetCompositionNodeRole;
  readonly relationshipKind?: AssetCompositionRelationshipKind;
  readonly compatibilityStatus?: AssetCompositionCompatibilityStatus;
  readonly blockedOnly?: boolean;
  readonly conflictedOnly?: boolean;
  readonly staleOnly?: boolean;
  readonly archived?: boolean;
  readonly text?: string;
  readonly createdAfter?: string;
  readonly createdBefore?: string;
  readonly updatedAfter?: string;
  readonly updatedBefore?: string;
  readonly limit?: number;
  readonly cursor?: string;
}

export interface AssetCompositionPlanListResult {
  readonly records: readonly AssetCompositionPlan[];
  readonly nextCursor?: string;
}

export interface AssetCompositionPlanRepositoryPort {
  saveAssetCompositionPlanRecord(record: AssetCompositionPlan): Promise<AssetCompositionPlan>;
  updateAssetCompositionPlanRecord(record: AssetCompositionPlan): Promise<AssetCompositionPlan>;
  readAssetCompositionPlanRecord(targetWorkspaceId: WorkspaceId, planId: AssetCompositionPlanId): Promise<AssetCompositionPlan | undefined>;
  listAssetCompositionPlanRecords(query: AssetCompositionPlanListQuery): Promise<AssetCompositionPlanListResult>;
  listValidDraftBlockedConflictedStaleOrArchivedAssetCompositionPlanRecords(targetWorkspaceId: WorkspaceId): Promise<readonly AssetCompositionPlan[]>;
  listAssetCompositionPlanRecordsBySelectedProjectionId(targetWorkspaceId: WorkspaceId, selectedProjectionId: EffectiveAssetProjectionId): Promise<readonly AssetCompositionPlan[]>;
  listAssetCompositionPlanRecordsByEffectiveAssetReference(targetWorkspaceId: WorkspaceId, effectiveAssetReference: AssetReference): Promise<readonly AssetCompositionPlan[]>;
  archiveAssetCompositionPlanRecord(targetWorkspaceId: WorkspaceId, planId: AssetCompositionPlanId, archivedAt: string): Promise<AssetCompositionPlan | undefined>;
}
