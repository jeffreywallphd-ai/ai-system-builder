import type { RuntimeInventoryRepositoryPort, RuntimeReadinessBindingRepositoryPort } from "../../ports/runtime-readiness";
import { normalizeRuntimeReadinessBindingId, type RuntimeInventory, type RuntimeReadinessBinding, type RuntimeReadinessStatus } from "../../../contracts/runtime-readiness";
import { normalizeAssetCompositionPlanId } from "../../../contracts/asset-composition";
import { createWorkspaceId, type WorkspaceId } from "../../../contracts/workspace";
import { sanitizeRuntimeReadinessMessage } from "./runtime-readiness-safety";

export interface WorkspaceRuntimeReadinessReadModelDependencies {
  readonly bindingRepository: RuntimeReadinessBindingRepositoryPort;
  readonly inventoryRepository: RuntimeInventoryRepositoryPort;
}

export interface WorkspaceRuntimeReadinessSummary {
  readonly readinessBindingId: string; readonly targetWorkspaceId: string; readonly compositionPlanId: string; readonly readinessStatus: RuntimeReadinessStatus; readonly setupReadinessLabel: string; readonly needsAttention: boolean;
  readonly requirementCount: number; readonly missingRequirementCount: number; readonly providerCandidateCount: number; readonly selectedBindingCount: number; readonly blockerCount: number; readonly diagnosticCount: number;
  readonly configurationRequiredCount: number; readonly permissionRequiredCount: number; readonly providerUnavailableCount: number; readonly providerUnsupportedCount: number; readonly staleCount: number;
  readonly updatedAt: string; readonly checkedAt?: string; readonly archivedAt?: string;
}

export class WorkspaceRuntimeReadinessReadModelService {
  public constructor(private readonly d: WorkspaceRuntimeReadinessReadModelDependencies) {}
  private normalizeId(value: string | undefined, field: string): string { const v = value?.trim(); if (!v) throw new Error(`validation:${field}`); return v; }
  private normalizeWorkspaceId(value: string | undefined): WorkspaceId { return createWorkspaceId(this.normalizeId(value, "targetWorkspaceId")); }

  public async listRuntimeReadinessSummaries(request: { targetWorkspaceId: string; limit?: number; cursor?: string; archived?: boolean }) {
    const targetWorkspaceId = this.normalizeWorkspaceId(request.targetWorkspaceId);
    const { records, nextCursor } = await this.d.bindingRepository.listRuntimeReadinessBindingRecords({ targetWorkspaceId, limit: request.limit, cursor: request.cursor, archived: request.archived });
    return { summaries: records.map((r) => this.toSummary(r)), nextCursor };
  }

  public async readRuntimeReadinessDetail(request: { targetWorkspaceId: string; readinessBindingId: string }) {
    const targetWorkspaceId = this.normalizeWorkspaceId(request.targetWorkspaceId);
    const readinessBindingId = normalizeRuntimeReadinessBindingId(this.normalizeId(request.readinessBindingId, 'readinessBindingId'));
    const record = await this.d.bindingRepository.readRuntimeReadinessBindingRecord(targetWorkspaceId, readinessBindingId);
    if (!record) return undefined;
    return { summary: this.toSummary(record), requirements: record.requirements.map((x) => ({ requirementId: x.requirementId, sourceCompositionPlanId: x.compositionPlanId, sourceNodeId: x.sourceNodeId, sourceRelationshipId: x.sourceRelationshipId, capabilityKind: x.capabilityKind, capabilityKey: sanitizeRuntimeReadinessMessage(x.capabilityKey), isRequired: x.isRequired, label: sanitizeRuntimeReadinessMessage(x.label), summary: sanitizeRuntimeReadinessMessage(x.summary), candidateCount: record.bindingCandidates.filter((c) => c.requirementId === x.requirementId).length, selectedBindingCount: record.bindings.filter((b) => b.requirementId === x.requirementId).length, blockerCount: x.blockers.length, diagnosticCount: x.diagnostics.length, statusLabel: this.requirementStatusLabel(record, x.requirementId, x.isRequired) })),
      providerCandidates: record.providerCandidates.map((p) => ({ providerCandidateId: p.providerCandidateId, providerKind: p.providerKind, inventorySourceId: p.inventorySourceId, availabilityStatus: p.availabilityStatus, configurationStatus: p.configurationStatus, displayLabel: sanitizeRuntimeReadinessMessage(p.displayLabel), capabilityCount: p.capabilities.length, blockerCount: p.blockers.length, diagnosticCount: p.diagnostics.length, statusLabel: this.providerStatusLabel(p.availabilityStatus, p.configurationStatus) })),
      bindingCandidates: record.bindingCandidates.map((c) => ({ bindingCandidateId: c.bindingCandidateId, requirementId: c.requirementId, providerCandidateId: c.providerCandidateId, capabilityId: c.capabilityId, matchStatus: c.matchStatus, matchLabel: c.matchStatus === "matched" ? "Available" : "Missing", blockerCount: c.blockers.length, diagnosticCount: c.diagnostics.length, label: sanitizeRuntimeReadinessMessage(c.label), summary: sanitizeRuntimeReadinessMessage(c.summary) })),
      selectedBindings: record.bindings.map((b) => ({ bindingId: b.bindingId, requirementId: b.requirementId, providerCandidateId: b.selectedProviderCandidateId, capabilityId: b.selectedCapabilityId, bindingStatus: b.status, setupLabel: this.statusLabel(b.status as RuntimeReadinessStatus), blockerCount: b.blockers.length, diagnosticCount: b.diagnostics.length, configurationReferenceLabel: b.safeConfigurationReference ? "Configured reference" : undefined })),
      blockers: record.blockers.map((b) => ({ code: b.code, severity: "error", message: sanitizeRuntimeReadinessMessage(b.message), category: "readiness" })),
      diagnostics: record.diagnostics.map((d) => ({ code: d.code, severity: d.severity, message: sanitizeRuntimeReadinessMessage(d.message), category: "readiness" })),
      provenanceSummary: { createdAt: record.createdAt, lastStatusUpdateAt: record.updatedAt, archivedAt: record.archivedAt, eventCount: record.provenance.length },
    };
  }

  public async listRuntimeReadinessForCompositionPlan(request: { targetWorkspaceId: string; compositionPlanId: string }) { const targetWorkspaceId=this.normalizeWorkspaceId(request.targetWorkspaceId); const compositionPlanId=normalizeAssetCompositionPlanId(this.normalizeId(request.compositionPlanId,'compositionPlanId')); const records = await this.d.bindingRepository.listRuntimeReadinessBindingRecordsByCompositionPlanId(targetWorkspaceId, compositionPlanId); return records.map((r) => this.toSummary(r)); }
  public async readLatestRuntimeReadinessForCompositionPlan(request: { targetWorkspaceId: string; compositionPlanId: string }) { const items = await this.listRuntimeReadinessForCompositionPlan(request); return items.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.readinessBindingId.localeCompare(a.readinessBindingId))[0]; }
  public async listRuntimeReadinessNeedingAttention(request: { targetWorkspaceId: string }) { const { summaries } = await this.listRuntimeReadinessSummaries({ targetWorkspaceId: request.targetWorkspaceId }); return summaries.filter((x) => x.needsAttention); }
  public async summarizeWorkspaceRuntimeReadiness(request: { targetWorkspaceId: string }) { const { summaries } = await this.listRuntimeReadinessSummaries(request); return { total: summaries.length, needingAttention: summaries.filter((s) => s.needsAttention).length, byStatus: summaries.reduce<Record<string, number>>((a, s) => ((a[s.readinessStatus] = (a[s.readinessStatus] ?? 0) + 1), a), {}) }; }
  public async summarizeWorkspaceRuntimeInventory(request: { targetWorkspaceId: string }) {
    const targetWorkspaceId=this.normalizeWorkspaceId(request.targetWorkspaceId);
    const { records } = await this.d.inventoryRepository.listRuntimeInventoryRecords({ targetWorkspaceId });
    return summarizeInventory(records);
  }

  private toSummary(record: RuntimeReadinessBinding): WorkspaceRuntimeReadinessSummary {
    const missingRequired = record.requirements.filter((r) => r.isRequired && !record.bindings.some((b) => b.requirementId === r.requirementId)).length;
    const statusCounts = countStatuses(record);
    const needsAttention = this.needsAttention(record, missingRequired);
    return { readinessBindingId: record.readinessBindingId, targetWorkspaceId: record.targetWorkspaceId, compositionPlanId: record.compositionPlanId, readinessStatus: record.status, setupReadinessLabel: this.statusLabel(record.status), needsAttention, requirementCount: record.requirements.length, missingRequirementCount: missingRequired, providerCandidateCount: record.providerCandidates.length, selectedBindingCount: record.bindings.length, blockerCount: record.blockers.length, diagnosticCount: record.diagnostics.length, configurationRequiredCount: statusCounts.configurationRequired, permissionRequiredCount: statusCounts.permissionRequired, providerUnavailableCount: statusCounts.providerUnavailable, providerUnsupportedCount: statusCounts.providerUnsupported, staleCount: statusCounts.stale, updatedAt: record.updatedAt, archivedAt: record.archivedAt };
  }
  private needsAttention(record: RuntimeReadinessBinding, missingRequired: number) { if (["blocked", "missing-requirements", "provider-unavailable", "provider-unsupported", "configuration-required", "permission-required", "stale", "invalid"].includes(record.status)) return true; if (missingRequired > 0 || record.blockers.length > 0) return true; return false; }
  private statusLabel(status: RuntimeReadinessStatus): string { const m: Record<string, string> = { "ready-for-setup": "Ready for setup", draft: "Draft", archived: "Archived", blocked: "Needs setup", "missing-requirements": "Missing requirement", "provider-unavailable": "Provider unavailable", "provider-unsupported": "Not supported", "configuration-required": "Needs configuration", "permission-required": "Permission needed", stale: "Refresh needed", invalid: "Invalid" }; return m[status] ?? "Needs setup"; }
  private requirementStatusLabel(record: RuntimeReadinessBinding, requirementId: string, isRequired: boolean) { if (record.bindings.some((b) => b.requirementId === requirementId)) return "Satisfied"; if (!isRequired) return "Needs setup"; if (!record.bindingCandidates.some((b) => b.requirementId === requirementId)) return "Missing"; return "Unknown"; }
  private providerStatusLabel(availability: string, config?: string) { if (config === "not-configured" || availability === "not-configured") return "Needs configuration"; if (availability === "permission-required") return "Permission needed"; if (availability === "unsupported") return "Not supported"; if (availability === "stale") return "Refresh needed"; if (availability === "available") return "Available"; return "Missing"; }
}

const countStatuses = (record: RuntimeReadinessBinding) => ({
  configurationRequired: record.providerCandidates.filter((x) => x.availabilityStatus === "not-configured" || x.configurationStatus === "not-configured").length,
  permissionRequired: record.providerCandidates.filter((x) => x.availabilityStatus === "permission-required" || x.configurationStatus === "permission-required").length,
  providerUnavailable: record.providerCandidates.filter((x) => x.availabilityStatus === "unavailable" || x.availabilityStatus === "not-installed").length,
  providerUnsupported: record.providerCandidates.filter((x) => x.availabilityStatus === "unsupported").length,
  stale: record.providerCandidates.filter((x) => x.availabilityStatus === "stale").length,
});

const summarizeInventory = (records: readonly RuntimeInventory[]) => {
  const byCapabilityKind: Record<string, number> = {}; const byProviderKind: Record<string, number> = {}; const byAvailabilityStatus: Record<string, number> = {};
  let providerCandidates = 0; let capabilities = 0; let configurationRequired = 0; let permissionRequired = 0; let staleOrBlockedOrUnavailable = 0;
  for (const r of records) { if (["stale", "blocked"].includes(r.inventoryStatus)) staleOrBlockedOrUnavailable += 1; providerCandidates += r.discoveredProviderCandidates.length; capabilities += r.discoveredCapabilities.length;
    for (const c of r.discoveredCapabilities) { byCapabilityKind[c.capabilityKind] = (byCapabilityKind[c.capabilityKind] ?? 0) + 1; byAvailabilityStatus[c.availabilityStatus] = (byAvailabilityStatus[c.availabilityStatus] ?? 0) + 1; if (c.configurationStatus === "not-configured") configurationRequired++; if (c.availabilityStatus === "permission-required") permissionRequired++; if (["unavailable", "not-installed"].includes(c.availabilityStatus)) staleOrBlockedOrUnavailable++; }
    for (const p of r.discoveredProviderCandidates) { byProviderKind[p.providerKind] = (byProviderKind[p.providerKind] ?? 0) + 1; byAvailabilityStatus[p.availabilityStatus] = (byAvailabilityStatus[p.availabilityStatus] ?? 0) + 1; if (p.configurationStatus === "not-configured") configurationRequired++; if (p.availabilityStatus === "permission-required") permissionRequired++; if (["unavailable", "not-installed", "stale"].includes(p.availabilityStatus)) staleOrBlockedOrUnavailable++; }
  }
  return { inventorySourceCount: records.length, providerCandidateCount: providerCandidates, capabilityCount: capabilities, byCapabilityKind, byProviderKind, byAvailabilityStatus, configurationRequiredCount: configurationRequired, permissionRequiredCount: permissionRequired, staleBlockedUnavailableCount: staleOrBlockedOrUnavailable };
};
