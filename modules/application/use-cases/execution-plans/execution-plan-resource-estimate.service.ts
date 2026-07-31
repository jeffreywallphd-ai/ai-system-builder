import { normalizeExecutionResourceEstimateId, type ExecutionPlanRecord, type ExecutionResourceEstimate } from '../../../contracts/execution-plans';

export class ExecutionPlanResourceEstimateService {
  public estimate(plan: ExecutionPlanRecord): ExecutionResourceEstimate[] {
    const steps = plan.steps ?? [];
    const inputs = plan.inputs ?? [];
    const outputs = plan.outputs ?? [];
    const dependencies = plan.dependencies ?? [];
    const adapterReferences = plan.adapterReferences ?? [];
    const safetyGates = plan.safetyGates ?? [];
    const blockers = plan.blockers ?? [];
    const diagnostics = plan.diagnostics ?? [];
    const providerCount = new Set(adapterReferences.map((a)=>a.providerKind).filter(Boolean)).size;
    const unresolvedSetup = adapterReferences.some((a)=>['needs-setup','missing','unsupported','deferred'].includes(a.status));
    const compute = steps.length > 8 ? 'high' : steps.length > 3 ? 'medium' : steps.length ? 'low' : 'none';
    const storage = outputs.length > 6 ? 'large' : outputs.length > 2 ? 'medium' : outputs.length ? 'small' : 'none';
    const duration = unresolvedSetup ? 'unknown' : dependencies.length > 10 ? 'long' : dependencies.length > 4 ? 'medium' : steps.length ? 'short' : 'instant';
    return [{ id: normalizeExecutionResourceEstimateId(`${plan.id ?? 'execution-plan'}_resource-estimate`), compute, storage, duration, summary: `steps=${steps.length};inputs=${inputs.length};outputs=${outputs.length};dependencies=${dependencies.length};adapters=${adapterReferences.length};gates=${safetyGates.length};blockers=${blockers.length};diagnostics=${diagnostics.length};providerCategories=${providerCount}` }];
  }
}
