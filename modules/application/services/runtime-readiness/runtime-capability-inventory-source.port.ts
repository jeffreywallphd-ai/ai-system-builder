import type { RuntimeInventory, RuntimeInventorySourceId, RuntimeInventorySourceKind } from "../../../contracts/runtime-readiness";
import type { WorkspaceId } from "../../../contracts/workspace";

export interface RuntimeCapabilityInventorySourcePort {
  readonly sourceId: RuntimeInventorySourceId;
  readonly sourceKind: RuntimeInventorySourceKind;
  collectRuntimeInventory(input: {
    readonly targetWorkspaceId: WorkspaceId;
  }): Promise<RuntimeCapabilityInventorySourceResult>;
}

export interface RuntimeCapabilityInventorySourceResult {
  readonly targetWorkspaceId: WorkspaceId;
  readonly inventorySourceId: RuntimeInventorySourceId;
  readonly inventorySourceKind: RuntimeInventorySourceKind;
  readonly discoveredProviderCandidates: RuntimeInventory["discoveredProviderCandidates"];
  readonly discoveredCapabilities: RuntimeInventory["discoveredCapabilities"];
  readonly diagnostics: RuntimeInventory["diagnostics"];
  readonly blockers: RuntimeInventory["blockers"];
  readonly inventoryStatus?: RuntimeInventory["inventoryStatus"];
  readonly checkedAt?: string;
}
