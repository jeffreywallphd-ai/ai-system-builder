import type { AssetCompositionPlanId } from "../../../contracts/asset-composition";
import type { RuntimeBindingStatus, RuntimeCapabilityKind, RuntimeProviderAvailabilityStatus, RuntimeReadinessBinding, RuntimeReadinessBindingId, RuntimeReadinessStatus } from "../../../contracts/runtime-readiness";
import type { WorkspaceId } from "../../../contracts/workspace";

export interface RuntimeReadinessBindingListQuery {
  readonly targetWorkspaceId: WorkspaceId;
  readonly status?: RuntimeReadinessStatus;
  readonly compositionPlanId?: AssetCompositionPlanId;
  readonly requiredCapabilityKind?: RuntimeCapabilityKind;
  readonly providerAvailabilityStatus?: RuntimeProviderAvailabilityStatus;
  readonly bindingStatus?: RuntimeBindingStatus;
  readonly blockedOnly?: boolean;
  readonly missingRequirementsOnly?: boolean;
  readonly providerUnavailableOnly?: boolean;
  readonly configurationRequiredOnly?: boolean;
  readonly permissionRequiredOnly?: boolean;
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

export interface RuntimeReadinessBindingListResult {
  readonly records: readonly RuntimeReadinessBinding[];
  readonly nextCursor?: string;
}

export interface RuntimeReadinessBindingRepositoryPort {
  saveRuntimeReadinessBindingRecord(record: RuntimeReadinessBinding): Promise<RuntimeReadinessBinding>;
  updateRuntimeReadinessBindingRecord(record: RuntimeReadinessBinding): Promise<RuntimeReadinessBinding>;
  readRuntimeReadinessBindingRecord(targetWorkspaceId: WorkspaceId, readinessBindingId: RuntimeReadinessBindingId): Promise<RuntimeReadinessBinding | undefined>;
  listRuntimeReadinessBindingRecords(query: RuntimeReadinessBindingListQuery): Promise<RuntimeReadinessBindingListResult>;
  listRuntimeReadinessBindingRecordsByCompositionPlanId(targetWorkspaceId: WorkspaceId, compositionPlanId: AssetCompositionPlanId): Promise<readonly RuntimeReadinessBinding[]>;
  listDraftCheckingBlockedStaleOrArchivedRuntimeReadinessBindingRecords(targetWorkspaceId: WorkspaceId): Promise<readonly RuntimeReadinessBinding[]>;
  archiveRuntimeReadinessBindingRecord(targetWorkspaceId: WorkspaceId, readinessBindingId: RuntimeReadinessBindingId, archivedAt: string): Promise<RuntimeReadinessBinding | undefined>;
}
