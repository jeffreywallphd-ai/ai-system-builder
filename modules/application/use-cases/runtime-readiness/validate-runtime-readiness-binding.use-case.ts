import { normalizeRuntimeReadinessBinding, normalizeValidateRuntimeReadinessBindingCommand, type RuntimeReadinessBinding, type ValidateRuntimeReadinessBindingCommand, type ValidateRuntimeReadinessBindingResult } from "../../../contracts/runtime-readiness";
import type { AssetCompositionPlanRepositoryPort } from "../../ports/asset-composition";
import type { RuntimeReadinessBindingRepositoryPort } from "../../ports/runtime-readiness";
import { runtimeReadinessFailure } from "./runtime-readiness-binding-result-helpers";
import { createRuntimeReadinessProvenanceEvent } from "./runtime-readiness-binding-provenance.service";
import { RuntimeReadinessValidationService } from "./runtime-readiness-validation.service";

export class ValidateRuntimeReadinessBindingUseCase {
  public constructor(private readonly d: { bindingRepository: RuntimeReadinessBindingRepositoryPort; validationService: RuntimeReadinessValidationService; compositionRepository?: Pick<AssetCompositionPlanRepositoryPort, "readAssetCompositionPlanRecord">; now?: () => string }) {}

  public async execute(command: ValidateRuntimeReadinessBindingCommand): Promise<ValidateRuntimeReadinessBindingResult> {
    let c;
    try { c = normalizeValidateRuntimeReadinessBindingCommand(command); } catch { return runtimeReadinessFailure("validation", "runtime-readiness-workspace-required"); }
    const now = (this.d.now ?? (() => new Date().toISOString()))();
    let binding: RuntimeReadinessBinding | undefined;
    try {
      binding = await this.d.bindingRepository.readRuntimeReadinessBindingRecord(c.targetWorkspaceId, c.readinessBindingId);
    } catch {
      return runtimeReadinessFailure("internal", "runtime-readiness-service-unavailable");
    }
    if (!binding) return runtimeReadinessFailure("not-found", "runtime-readiness-binding-candidate-missing");
    if (binding.targetWorkspaceId !== c.targetWorkspaceId || binding.readinessBindingId !== c.readinessBindingId) return runtimeReadinessFailure("validation", "runtime-readiness-workspace-invalid");
    if (binding.archivedAt || binding.status === "archived") return runtimeReadinessFailure("validation", "runtime-readiness-composition-plan-not-valid");

    // Re-evaluate authoritative composition and derived provider conditions.
    // Old persisted failures must not survive after their actual cause is fixed.
    const blockers: RuntimeReadinessBinding["blockers"][number][] = [];
    const diagnostics: RuntimeReadinessBinding["diagnostics"][number][] = [];
    if (!this.d.compositionRepository) return runtimeReadinessFailure("internal", "runtime-readiness-service-unavailable");
    if (this.d.compositionRepository) {
      try {
        const plan = await this.d.compositionRepository.readAssetCompositionPlanRecord(c.targetWorkspaceId, binding.compositionPlanId);
        if (!plan) blockers.push({ code: "runtime-readiness-composition-plan-missing", message: "Composition plan reference is missing." });
        else if (plan.targetWorkspaceId !== c.targetWorkspaceId || plan.planId !== binding.compositionPlanId) blockers.push({ code: "runtime-readiness-workspace-invalid", message: "Composition plan reference does not match the authorized workspace and plan." });
        else if (plan.status === "stale") blockers.push({ code: "runtime-readiness-composition-plan-stale", message: "Composition plan is stale." });
        else if (plan.status !== "valid" || plan.archivedAt || plan.blockers.length > 0) blockers.push({ code: "runtime-readiness-composition-plan-not-valid", message: "Composition plan is not valid for runtime readiness progression." });
        else if (!binding.compositionPlanValidationAt || !plan.updatedAt || binding.compositionPlanValidationAt !== plan.updatedAt) blockers.push({ code: "runtime-readiness-composition-plan-stale", message: "Composition plan changed; refresh the readiness binding before progression." });
      } catch {
        return runtimeReadinessFailure("internal", "runtime-readiness-composition-plan-missing");
      }
    }

    try {
      const evaluated = this.d.validationService.validate({ ...binding, blockers, diagnostics }, c.targetWorkspaceId);
      const updated: RuntimeReadinessBinding = normalizeRuntimeReadinessBinding({ ...binding, status: evaluated.status, blockers: evaluated.blockers, diagnostics: evaluated.diagnostics, bindings: evaluated.bindings, updatedAt: now, provenance: [...binding.provenance, createRuntimeReadinessProvenanceEvent("readiness-validated", c.targetWorkspaceId, binding.compositionPlanId, now, binding.readinessBindingId)] });
      const saved = await this.d.bindingRepository.saveRuntimeReadinessBindingRecord(updated);
      return { status: "success", value: saved };
    } catch {
      return runtimeReadinessFailure("internal", "runtime-readiness-service-unavailable");
    }
  }
}
