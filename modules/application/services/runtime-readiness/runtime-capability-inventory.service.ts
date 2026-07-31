import {
  normalizeRuntimeInventory,
  normalizeRuntimeInventorySourceId,
  normalizeRuntimeInventorySourceKind,
  normalizeRuntimeProviderAvailabilityStatus,
  type RuntimeInventory,
  type RuntimeInventorySourceKind,
} from "../../../contracts/runtime-readiness";
import { createWorkspaceId } from "../../../contracts/workspace";
import type { RuntimeInventoryRepositoryPort } from "../../ports/runtime-readiness";
import type { RuntimeCapabilityInventorySourcePort } from "./runtime-capability-inventory-source.port";
import type { RuntimeCapabilityInventoryOperationResult } from "./runtime-capability-inventory-results";
import { sanitizeRuntimeReadinessMessage } from "./runtime-readiness-safety";

export class RuntimeCapabilityInventoryService {
  public constructor(
    private readonly repository: RuntimeInventoryRepositoryPort,
    private readonly sources: readonly RuntimeCapabilityInventorySourcePort[] = [],
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  public async refreshInventoryFromSources(request: { targetWorkspaceId: string; sourceKind?: RuntimeInventorySourceKind; sourceId?: string }): Promise<RuntimeCapabilityInventoryOperationResult<{ records: readonly RuntimeInventory[] }>> {
    if (!request.targetWorkspaceId) return { status: "validation-failure", reason: "workspace-required", diagnostics: ["Target workspace is required."] };
    const workspaceId = createWorkspaceId(request.targetWorkspaceId);
    let sourceKind: RuntimeInventorySourceKind | undefined;
    let sourceId: string | undefined;
    try {
      sourceKind = request.sourceKind ? normalizeRuntimeInventorySourceKind(request.sourceKind) : undefined;
      sourceId = request.sourceId ? normalizeRuntimeInventorySourceId(request.sourceId) : undefined;
    } catch {
      return { status: "validation-failure", reason: "inventory-source-filter-invalid", diagnostics: ["Invalid runtime inventory source filter."] };
    }
    const selected = this.sources.filter((source) => {
      if (sourceKind && normalizeRuntimeInventorySourceKind(source.sourceKind) !== sourceKind) return false;
      if (sourceId && normalizeRuntimeInventorySourceId(source.sourceId) !== sourceId) return false;
      return true;
    });
    const records: RuntimeInventory[] = [];
    const diagnostics: string[] = [];
    for (const source of selected) {
      try {
        const result = await source.collectRuntimeInventory({ targetWorkspaceId: workspaceId });
        const normalized = normalizeRuntimeInventory({ ...result, checkedAt: result.checkedAt ?? this.now(), inventoryStatus: result.inventoryStatus ?? (result.blockers.length > 0 ? "blocked" : "checked") });
        const saved = await this.repository.saveRuntimeInventoryRecord(normalized);
        records.push(saved);
      } catch (error) {
        diagnostics.push(`source ${source.sourceId}: ${sanitizeRuntimeReadinessMessage(error instanceof Error ? error.message : error)}`);
      }
    }
    if (records.length === 0 && diagnostics.length > 0) return { status: "unavailable", reason: "sources-failed", diagnostics };
    if (diagnostics.length > 0) return { status: "partial-success", value: { records }, diagnostics };
    return { status: "success", value: { records }, diagnostics };
  }

  public async listRuntimeInventory(request: Parameters<RuntimeInventoryRepositoryPort["listRuntimeInventoryRecords"]>[0]): Promise<RuntimeCapabilityInventoryOperationResult<{ records: readonly RuntimeInventory[]; nextCursor?: string }>> {
    if (!request?.targetWorkspaceId) return { status: "validation-failure", reason: "workspace-required", diagnostics: ["Target workspace is required."] };
    const normalized = { ...request, targetWorkspaceId: createWorkspaceId(request.targetWorkspaceId), providerAvailabilityStatus: request.providerAvailabilityStatus ? normalizeRuntimeProviderAvailabilityStatus(request.providerAvailabilityStatus) : undefined };
    const result = await this.repository.listRuntimeInventoryRecords(normalized);
    return { status: "success", value: result, diagnostics: [] };
  }

  public async readRuntimeInventory(request: { targetWorkspaceId: string; inventorySourceId: string }): Promise<RuntimeCapabilityInventoryOperationResult<{ record: RuntimeInventory }>> {
    if (!request.targetWorkspaceId) return { status: "validation-failure", reason: "workspace-required", diagnostics: ["Target workspace is required."] };
    const record = await this.repository.readRuntimeInventoryRecord(createWorkspaceId(request.targetWorkspaceId), normalizeRuntimeInventorySourceId(request.inventorySourceId));
    if (!record) return { status: "not-found", reason: "inventory-not-found", diagnostics: [] };
    return { status: "success", value: { record }, diagnostics: [] };
  }

  public async readLatestRuntimeInventory(request: { targetWorkspaceId: string; sourceKind?: RuntimeInventorySourceKind; sourceId?: string }): Promise<RuntimeCapabilityInventoryOperationResult<{ record: RuntimeInventory }>> {
    if (!request.targetWorkspaceId) return { status: "validation-failure", reason: "workspace-required", diagnostics: ["Target workspace is required."] };
    try {
      const workspaceId = createWorkspaceId(request.targetWorkspaceId);
      const record = request.sourceId
        ? await this.repository.readRuntimeInventoryRecord(workspaceId, normalizeRuntimeInventorySourceId(request.sourceId))
        : request.sourceKind
          ? await this.repository.readLatestRuntimeInventoryRecord(workspaceId, normalizeRuntimeInventorySourceKind(request.sourceKind))
          : (await this.repository.listRuntimeInventoryRecords({ targetWorkspaceId: workspaceId, limit: 1 })).records[0];
      if (!record) return { status: "not-found", reason: "inventory-not-found", diagnostics: [] };
      return { status: "success", value: { record }, diagnostics: [] };
    } catch {
      return { status: "validation-failure", reason: "inventory-source-filter-invalid", diagnostics: ["Invalid runtime inventory source filter."] };
    }
  }
}
