import type { RuntimeInventory, RuntimeInventorySourceId, RuntimeInventorySourceKind, RuntimeInventoryStatus, RuntimeProviderAvailabilityStatus } from "../../../contracts/runtime-readiness";
import type { WorkspaceId } from "../../../contracts/workspace";

export interface RuntimeInventoryListQuery {
  readonly targetWorkspaceId: WorkspaceId;
  readonly inventorySourceKind?: RuntimeInventorySourceKind;
  readonly inventoryStatus?: RuntimeInventoryStatus;
  readonly providerAvailabilityStatus?: RuntimeProviderAvailabilityStatus;
  readonly blockedOnly?: boolean;
  readonly staleOnly?: boolean;
  readonly archived?: boolean;
  readonly checkedAfter?: string;
  readonly checkedBefore?: string;
  readonly limit?: number;
  readonly cursor?: string;
}

export interface RuntimeInventoryListResult {
  readonly records: readonly RuntimeInventory[];
  readonly nextCursor?: string;
}

export interface RuntimeInventoryRepositoryPort {
  saveRuntimeInventoryRecord(record: RuntimeInventory): Promise<RuntimeInventory>;
  updateRuntimeInventoryRecord(record: RuntimeInventory): Promise<RuntimeInventory>;
  readRuntimeInventoryRecord(targetWorkspaceId: WorkspaceId, inventorySourceId: RuntimeInventorySourceId): Promise<RuntimeInventory | undefined>;
  listRuntimeInventoryRecords(query: RuntimeInventoryListQuery): Promise<RuntimeInventoryListResult>;
  readLatestRuntimeInventoryRecord(targetWorkspaceId: WorkspaceId, inventorySourceKind: RuntimeInventorySourceKind): Promise<RuntimeInventory | undefined>;
}
