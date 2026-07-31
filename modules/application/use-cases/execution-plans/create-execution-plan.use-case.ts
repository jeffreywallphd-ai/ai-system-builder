import { normalizeCreateExecutionPlanCommand, normalizeExecutionPlanId, normalizeExecutionPlanRecord, type CreateExecutionPlanCommand, type CreateExecutionPlanResult, type ExecutionPlanRecord } from "../../../contracts/execution-plans";
import { normalizeAssetCompositionPlanId } from "../../../contracts/asset-composition";
import { normalizeRuntimeReadinessBindingId } from "../../../contracts/runtime-readiness";
import type { AssetCompositionPlanRepositoryPort } from "../../ports/asset-composition";
import type { ExecutionPlanRepositoryPort } from "../../ports/execution-plans";
import type { RuntimeReadinessBindingRepositoryPort } from "../../ports/runtime-readiness";
import { executionPlanFailure } from "./execution-plan-result-helpers";
import { ExecutionPlanStepPlanningService } from "./execution-plan-step-planning.service";
import { ExecutionPlanStatusService } from "./execution-plan-status.service";
import { createExecutionPlanProvenanceEvent } from "./execution-plan-provenance.service";
import { ExecutionPlanProviderPlanningService } from "./execution-plan-provider-planning.service";
import { ExecutionPlanSafetyGatePlanningService } from './execution-plan-safety-gate-planning.service';
import { ExecutionPlanInputOutputPlanningService } from './execution-plan-input-output-planning.service';
import { ExecutionPlanDependencyPlanningService } from './execution-plan-dependency-planning.service';
import { ExecutionPlanResourceEstimateService } from './execution-plan-resource-estimate.service';

export class CreateExecutionPlanUseCase {
  public constructor(private readonly d: { executionPlanRepository: ExecutionPlanRepositoryPort; runtimeReadinessBindingRepository: RuntimeReadinessBindingRepositoryPort; compositionPlanRepository: AssetCompositionPlanRepositoryPort; stepPlanningService: ExecutionPlanStepPlanningService; statusService: ExecutionPlanStatusService; providerPlanningService: ExecutionPlanProviderPlanningService; inputOutputPlanningService: ExecutionPlanInputOutputPlanningService; dependencyPlanningService: ExecutionPlanDependencyPlanningService; safetyGatePlanningService: ExecutionPlanSafetyGatePlanningService; resourceEstimateService: ExecutionPlanResourceEstimateService; nextExecutionPlanId: () => string; nextExecutionStepId: () => string; nextExecutionInputId: () => string; nextExecutionOutputId: () => string; nextExecutionDependencyId: () => string; nextExecutionAdapterReferenceId: () => string; nextExecutionSafetyGateId: () => string; now?: () => string; }) {}
  public async execute(command: CreateExecutionPlanCommand): Promise<CreateExecutionPlanResult> {
    let c; try { c = normalizeCreateExecutionPlanCommand(command); } catch { return executionPlanFailure("validation", "execution-plan-request-invalid"); }
    const now = (this.d.now ?? (() => new Date().toISOString()))();
    try {
      const readinessBindingId = normalizeRuntimeReadinessBindingId(c.runtimeReadinessBindingId);
      const readiness = await this.d.runtimeReadinessBindingRepository.readRuntimeReadinessBindingRecord(c.workspaceId, readinessBindingId);
      if (!readiness) return executionPlanFailure("not-found", "execution-plan-source-readiness-not-found");
      if (["archived", "invalid", "blocked", "missing-requirements", "provider-unavailable", "provider-unsupported", "configuration-required", "permission-required", "stale"].includes(readiness.status)) {
        return executionPlanFailure(readiness.status === "stale" ? "stale" : "source-readiness-not-ready", "execution-plan-source-readiness-not-ready");
      }
      const sourcePlanId = normalizeAssetCompositionPlanId(c.compositionPlanId ?? readiness.compositionPlanId);
      const composition = await this.d.compositionPlanRepository.readAssetCompositionPlanRecord(c.workspaceId, sourcePlanId);
      if (!composition) return executionPlanFailure("not-found", "execution-plan-source-composition-not-found");
      if (["archived", "invalid", "stale", "blocked", "conflicted"].includes(composition.status)) return executionPlanFailure(composition.status === "stale" ? "stale" : "blocked", "execution-plan-source-composition-not-usable");
      const planId = normalizeExecutionPlanId(this.d.nextExecutionPlanId());
      const stepPlan = this.d.stepPlanningService.plan({ planId, compositionPlan: composition, nextExecutionStepId: this.d.nextExecutionStepId, sourceCompositionPlanId: sourcePlanId });
      const providerPlan = this.d.providerPlanningService.plan({ planId, sourceRuntimeReadinessBindingId: readinessBindingId, readiness, steps: stepPlan.steps, createAdapterReferenceId: this.d.nextExecutionAdapterReferenceId });
      const ioPlan = this.d.inputOutputPlanningService.plan({ steps: providerPlan.steps, compositionPlan: composition, nextExecutionInputId: this.d.nextExecutionInputId, nextExecutionOutputId: this.d.nextExecutionOutputId });
      const safetyGatePlan = this.d.safetyGatePlanningService.plan({ steps: providerPlan.steps, inputs: ioPlan.inputs, outputs: ioPlan.outputs, adapterReferences: providerPlan.adapterReferences, createSafetyGateId: this.d.nextExecutionSafetyGateId });
      const dependencyPlan = this.d.dependencyPlanningService.plan({ compositionPlan: composition, steps: providerPlan.steps, inputs: ioPlan.inputs, outputs: ioPlan.outputs, adapterReferences: providerPlan.adapterReferences, safetyGates: safetyGatePlan.safetyGates, nextExecutionDependencyId: this.d.nextExecutionDependencyId });
      const status = this.d.statusService.calculate({ readinessStatus: readiness.status, hasStaleSource: false, hasBlockers: stepPlan.blockers.length + providerPlan.blockers.length + ioPlan.blockers.length + dependencyPlan.blockers.length > 0, hasMissingInputs: ioPlan.blockers.some((b)=>b.code.includes("missing-inputs")), hasMissingOutputs: ioPlan.blockers.some((b)=>b.code.includes("missing-outputs")), hasMissingAdapters: providerPlan.blockers.some((b)=>b.code.includes("provider-setup-required")) });
      const record: ExecutionPlanRecord = normalizeExecutionPlanRecord({ id: planId, workspaceId: c.workspaceId, sourceCompositionPlanId: sourcePlanId, sourceRuntimeReadinessBindingId: readinessBindingId, sourceReadinessStatus: readiness.status, status, steps: providerPlan.steps, dependencies: dependencyPlan.dependencies, inputs: ioPlan.inputs, outputs: ioPlan.outputs, adapterReferences: providerPlan.adapterReferences, safetyGates: safetyGatePlan.safetyGates, blockers: [...stepPlan.blockers, ...providerPlan.blockers, ...ioPlan.blockers, ...dependencyPlan.blockers], diagnostics: [...stepPlan.diagnostics, ...providerPlan.diagnostics, ...ioPlan.diagnostics, ...dependencyPlan.diagnostics], resourceEstimates: [], provenance: [createExecutionPlanProvenanceEvent("execution-plan-created", now, { workspaceId: c.workspaceId, executionPlanId: planId, runtimeReadinessBindingId: readinessBindingId, compositionPlanId: sourcePlanId })], createdAt: now, updatedAt: now });
      const withEstimates = normalizeExecutionPlanRecord({ ...record, resourceEstimates: this.d.resourceEstimateService.estimate(record) });
      const saved = await this.d.executionPlanRepository.saveExecutionPlan(withEstimates);
      return { kind: "success", value: saved };
    } catch { return executionPlanFailure("unavailable", "execution-plan-service-unavailable"); }
  }
}
