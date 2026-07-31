import { normalizeExecutionPlanRecord, normalizeValidateExecutionPlanCommand, type ValidateExecutionPlanCommand, type ValidateExecutionPlanResult } from '../../../contracts/execution-plans';
import { createWorkspaceId } from '../../../contracts/workspace';
import { normalizeAssetCompositionPlanId } from '../../../contracts/asset-composition';
import { normalizeRuntimeReadinessBindingId, type RuntimeReadinessStatus } from '../../../contracts/runtime-readiness';
import type { AssetCompositionPlanRepositoryPort } from '../../ports/asset-composition';
import type { ExecutionPlanRepositoryPort } from '../../ports/execution-plans';
import type { RuntimeReadinessBindingRepositoryPort } from '../../ports/runtime-readiness';
import { executionPlanFailure } from './execution-plan-result-helpers';
import { ExecutionPlanPreflightValidationService } from './execution-plan-preflight-validation.service';
import { createExecutionPlanProvenanceEvent } from './execution-plan-provenance.service';
import { ExecutionPlanResourceEstimateService } from './execution-plan-resource-estimate.service';
import { ExecutionPlanSafetyGateValidationService } from './execution-plan-safety-gate-validation.service';
import { ExecutionPlanStatusService } from './execution-plan-status.service';

export class ValidateExecutionPlanUseCase {
  public constructor(private readonly d: { executionPlanRepository: ExecutionPlanRepositoryPort; runtimeReadinessBindingRepository?: RuntimeReadinessBindingRepositoryPort; compositionPlanRepository?: AssetCompositionPlanRepositoryPort; preflightValidationService: ExecutionPlanPreflightValidationService; safetyGateValidationService: ExecutionPlanSafetyGateValidationService; resourceEstimateService: ExecutionPlanResourceEstimateService; statusService: ExecutionPlanStatusService; now?: () => string }) {}
  public async execute(command: ValidateExecutionPlanCommand): Promise<ValidateExecutionPlanResult> {
    let c; try { c = normalizeValidateExecutionPlanCommand(command); } catch { return executionPlanFailure('validation','execution-plan-request-invalid'); }
    const now = (this.d.now ?? (() => new Date().toISOString()))();
    try {
      const record = await this.d.executionPlanRepository.getExecutionPlanById(c.workspaceId, c.executionPlanId);
      if (!record) return executionPlanFailure('not-found','execution-plan-not-found');
      if (record.status === 'archived') return executionPlanFailure('conflict','execution-plan-archived');
      let hasStaleSource = false;
      let readinessStatus = record.sourceReadinessStatus;
      if (this.d.runtimeReadinessBindingRepository) {
        const readiness = await this.d.runtimeReadinessBindingRepository.readRuntimeReadinessBindingRecord(createWorkspaceId(record.workspaceId), normalizeRuntimeReadinessBindingId(record.sourceRuntimeReadinessBindingId));
        if (!readiness) return executionPlanFailure('source-readiness-not-ready','execution-plan-source-readiness-not-found');
        readinessStatus = readiness.status;
        if (new Date(readiness.updatedAt).getTime() > new Date(record.updatedAt).getTime()) hasStaleSource = true;
      }
      if (this.d.compositionPlanRepository) {
        const comp = await this.d.compositionPlanRepository.readAssetCompositionPlanRecord(createWorkspaceId(record.workspaceId), normalizeAssetCompositionPlanId(record.sourceCompositionPlanId));
        if (!comp) return executionPlanFailure('blocked','execution-plan-source-composition-not-found');
        if (new Date(comp.updatedAt).getTime() > new Date(record.updatedAt).getTime()) hasStaleSource = true;
      }
      const pre = this.d.preflightValidationService.validate(record);
      const derivedCodes = new Set([...(pre.blockers.map((b)=>b.code)), ...(pre.diagnostics.map((d)=>d.code))]);
      const retainedBlockers = record.blockers.filter((b)=>!derivedCodes.has(b.code));
      const retainedDiagnostics = record.diagnostics.filter((d)=>!derivedCodes.has(d.code));
      const withPre = { ...record, blockers: [...retainedBlockers, ...pre.blockers], diagnostics: [...retainedDiagnostics, ...pre.diagnostics] };
      const gates = this.d.safetyGateValidationService.validate(withPre);
      const gateCodes = new Set([...(gates.blockers.map((b)=>b.code)), ...(gates.diagnostics.map((d)=>d.code))]);
      const withDerived = {
        ...withPre,
        blockers: [...withPre.blockers.filter((b)=>!gateCodes.has(b.code)), ...gates.blockers],
        diagnostics: [...withPre.diagnostics.filter((d)=>!gateCodes.has(d.code)), ...gates.diagnostics],
        safetyGates: gates.safetyGates,
      };
      const resourceEstimates = this.d.resourceEstimateService.estimate(withDerived);
      const status = this.d.statusService.calculate({ readinessStatus: readinessStatus as RuntimeReadinessStatus, hasStaleSource, hasBlockers: withDerived.blockers.length > 0, hasMissingInputs: pre.hasMissingInputs, hasMissingOutputs: pre.hasMissingOutputs, hasMissingAdapters: pre.hasMissingAdapters, requiresSafetyReview: gates.requiresReview, isInvalid: pre.hasUnsafeDetails });
      const next = normalizeExecutionPlanRecord({ ...withDerived, status, resourceEstimates, provenance: [...withDerived.provenance, createExecutionPlanProvenanceEvent('execution-plan-refreshed', now, { workspaceId: record.workspaceId, executionPlanId: record.id })], updatedAt: now });
      const saved = await this.d.executionPlanRepository.updateExecutionPlan(next);
      return { kind: 'success', value: saved };
    } catch { return executionPlanFailure('unavailable','execution-plan-service-unavailable'); }
  }
}
