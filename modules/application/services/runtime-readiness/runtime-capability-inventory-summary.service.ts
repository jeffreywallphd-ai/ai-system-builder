import type { RuntimeInventoryRepositoryPort } from "../../ports/runtime-readiness";
import { createWorkspaceId } from "../../../contracts/workspace";
import type { RuntimeCapabilityInventoryOperationResult, WorkspaceRuntimeCapabilitySummary } from "./runtime-capability-inventory-results";

const inc = (map: Record<string, number>, key: string | undefined) => {
  if (!key) return;
  map[key] = (map[key] ?? 0) + 1;
};

export class RuntimeCapabilityInventorySummaryService {
  public constructor(private readonly repository: RuntimeInventoryRepositoryPort) {}

  public async summarizeRuntimeCapabilities(request: { targetWorkspaceId: string }): Promise<RuntimeCapabilityInventoryOperationResult<WorkspaceRuntimeCapabilitySummary>> {
    if (!request.targetWorkspaceId) return { status: "validation-failure", reason: "workspace-required", diagnostics: ["Target workspace is required."] };
    const result = await this.repository.listRuntimeInventoryRecords({ targetWorkspaceId: createWorkspaceId(request.targetWorkspaceId) });
    const capabilitiesByKind: Record<string, number> = {};
    const providerKinds: Record<string, number> = {};
    const availabilityStatuses: Record<string, number> = {};
    const capabilitySummaries = result.records.flatMap((record) => record.discoveredCapabilities.map((capability) => ({ capabilityId: capability.capabilityId, capabilityKind: capability.capabilityKind, capabilityKey: capability.capabilityKey, label: capability.label, summary: capability.summary, providerKind: capability.providerKind, availabilityStatus: capability.availabilityStatus, configurationStatus: capability.configurationStatus, diagnosticCount: capability.diagnostics.length, blockerCount: capability.blockers.length, inventorySourceId: record.inventorySourceId, inventorySourceKind: record.inventorySourceKind })));
    const providerSummaries = result.records.flatMap((record) => record.discoveredProviderCandidates.map((provider) => ({ providerCandidateId: provider.providerCandidateId, providerKind: provider.providerKind, inventorySourceId: record.inventorySourceId, availabilityStatus: provider.availabilityStatus, configurationStatus: provider.configurationStatus, displayLabel: provider.displayLabel, capabilityCount: provider.capabilities.length, diagnosticCount: provider.diagnostics.length, blockerCount: provider.blockers.length })));
    for (const cap of capabilitySummaries) { inc(capabilitiesByKind, cap.capabilityKind); inc(availabilityStatuses, cap.availabilityStatus); }
    for (const provider of providerSummaries) { inc(providerKinds, provider.providerKind); inc(availabilityStatuses, provider.availabilityStatus); }
    const checked = result.records.map((record) => record.checkedAt).filter(Boolean).sort();
    return { status: "success", diagnostics: [], value: { inventorySources: result.records.length, providerCandidates: providerSummaries.length, capabilities: capabilitySummaries.length, capabilitiesByKind, providerKinds, availabilityStatuses, requiresConfigurationCount: capabilitySummaries.filter((item) => item.configurationStatus === "not-configured" || item.availabilityStatus === "not-configured").length + providerSummaries.filter((item) => item.configurationStatus === "not-configured" || item.availabilityStatus === "not-configured").length, requiresPermissionCount: capabilitySummaries.filter((item) => item.availabilityStatus === "permission-required" || item.configurationStatus === "permission-required").length + providerSummaries.filter((item) => item.availabilityStatus === "permission-required" || item.configurationStatus === "permission-required").length, blockedCount: result.records.filter((record) => record.inventoryStatus === "blocked").length, staleCount: result.records.filter((record) => record.inventoryStatus === "stale").length, diagnosticCount: result.records.reduce((sum, record) => sum + record.diagnostics.length, 0), lastCheckedAt: checked[checked.length - 1], capabilitySummaries, providerSummaries } };
  }
}
