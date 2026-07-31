import { normalizeCreateRuntimeReadinessBindingCommand, normalizeRuntimeReadinessBinding, normalizeRuntimeReadinessBindingId, type CreateRuntimeReadinessBindingCommand, type CreateRuntimeReadinessBindingResult, type RuntimeBindingCandidate, type RuntimeReadinessBindingId, type RuntimeReadinessStatus } from "../../../contracts/runtime-readiness";
import type { AssetCompositionPlanRepositoryPort } from "../../ports/asset-composition";
import type { RuntimeInventoryRepositoryPort, RuntimeReadinessBindingRepositoryPort } from "../../ports/runtime-readiness";
import { runtimeReadinessFailure } from "./runtime-readiness-binding-result-helpers";
import { RuntimeRequirementExtractionService } from "./runtime-requirement-extraction.service";
import { RuntimeCapabilityMatchingService } from "./runtime-capability-matching.service";
import { RuntimeBindingCandidateSelectionService } from "./runtime-binding-candidate-selection.service";
import { createRuntimeReadinessProvenanceEvent } from "./runtime-readiness-binding-provenance.service";

const hasStatus = (candidates: readonly RuntimeBindingCandidate[], status: RuntimeBindingCandidate["matchStatus"]) => candidates.some((candidate) => candidate.matchStatus === status);

export class CreateRuntimeReadinessBindingUseCase {
  public constructor(private readonly d: { compositionRepository: AssetCompositionPlanRepositoryPort; inventoryRepository: RuntimeInventoryRepositoryPort; bindingRepository: RuntimeReadinessBindingRepositoryPort; requirementExtractionService: RuntimeRequirementExtractionService; capabilityMatchingService: RuntimeCapabilityMatchingService; candidateSelectionService: RuntimeBindingCandidateSelectionService; nextReadinessBindingId: () => RuntimeReadinessBindingId | string; nextRequirementId: RuntimeRequirementExtractionService["extractRequirements"] extends (args: infer A)=>any ? A extends {nextRequirementId: infer T} ? T : never : never; nextBindingCandidateId: RuntimeCapabilityMatchingService["match"] extends (args: infer A)=>any ? A extends {nextBindingCandidateId: infer T} ? T : never : never; nextBindingId: RuntimeBindingCandidateSelectionService["select"] extends (args: infer A)=>any ? A extends {nextBindingId: infer T} ? T : never : never; now?: () => string }) {}
  public async execute(command: CreateRuntimeReadinessBindingCommand): Promise<CreateRuntimeReadinessBindingResult> {
    let c; try { c = normalizeCreateRuntimeReadinessBindingCommand(command); } catch { return runtimeReadinessFailure("validation", "runtime-readiness-composition-plan-required"); }
    const now = (this.d.now ?? (() => new Date().toISOString()))();
    try {
      const plan = await this.d.compositionRepository.readAssetCompositionPlanRecord(c.targetWorkspaceId, c.compositionPlanId);
      if (!plan) return runtimeReadinessFailure("not-found", "runtime-readiness-composition-plan-missing");
      if (plan.status === "archived") return runtimeReadinessFailure("conflict", "runtime-readiness-composition-plan-not-valid");
      if (plan.status !== "valid") return runtimeReadinessFailure(plan.status === "stale" ? "stale" : "blocked", "runtime-readiness-composition-plan-not-valid");
      const readinessBindingId = normalizeRuntimeReadinessBindingId(this.d.nextReadinessBindingId());
      const extraction = this.d.requirementExtractionService.extractRequirements({ plan, nextRequirementId: this.d.nextRequirementId, now });
      const inventories = (await this.d.inventoryRepository.listRuntimeInventoryRecords({ targetWorkspaceId: c.targetWorkspaceId })).records;
      const matching = this.d.capabilityMatchingService.match({ inventory: inventories, requirements: extraction.requirements, targetWorkspaceId: c.targetWorkspaceId, nextBindingCandidateId: this.d.nextBindingCandidateId, now });
      const selection = this.d.candidateSelectionService.select({ readinessBindingId, targetWorkspaceId: c.targetWorkspaceId, requirements: extraction.requirements, candidates: matching.candidates, nextBindingId: this.d.nextBindingId, now });
      const selectedRequired = new Set(selection.bindings.map((binding) => binding.requirementId));
      const required = extraction.requirements.filter((item) => item.isRequired);
      let status: RuntimeReadinessStatus = "draft";
      if (matching.blockers.length > 0) status = "missing-requirements";
      else if (hasStatus(matching.candidates, "provider-unavailable") || hasStatus(matching.candidates, "unknown")) status = "provider-unavailable";
      else if (hasStatus(matching.candidates, "unsupported")) status = "provider-unsupported";
      else if (required.every((item) => selectedRequired.has(item.requirementId))) status = "ready-for-setup";
      const record = normalizeRuntimeReadinessBinding({ readinessBindingId, targetWorkspaceId: c.targetWorkspaceId, compositionPlanId: c.compositionPlanId, compositionPlanValidationAt: plan.updatedAt, status, requirements: extraction.requirements, providerCandidates: matching.providerCandidates, bindingCandidates: matching.candidates, bindings: selection.bindings, blockers: matching.blockers, diagnostics: [...extraction.diagnostics, ...matching.diagnostics, ...selection.diagnostics], provenance: [createRuntimeReadinessProvenanceEvent("readiness-binding-created", c.targetWorkspaceId, c.compositionPlanId, now, readinessBindingId)], createdAt: now, updatedAt: now });
      return { status: "success", value: await this.d.bindingRepository.saveRuntimeReadinessBindingRecord(record) };
    } catch {
      return runtimeReadinessFailure("internal", "runtime-readiness-service-unavailable");
    }
  }
}
