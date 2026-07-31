import type { ExecutionAdapterReferenceStatus, ExecutionBlocker, ExecutionDiagnostic, ExecutionPlanRecord, ExecutionSafetyGate } from '../../../contracts/execution-plans';

const PASSABLE = new Set<ExecutionAdapterReferenceStatus>(['available-by-readiness','planned']);
const BLOCKED = new Set<ExecutionAdapterReferenceStatus>(['needs-setup','missing','blocked','unsupported','stale','invalid']);

export class ExecutionPlanSafetyGateValidationService {
  public validate(plan: ExecutionPlanRecord): { blockers: ExecutionBlocker[]; diagnostics: ExecutionDiagnostic[]; requiresReview: boolean; safetyGates: ExecutionSafetyGate[] } {
    const blockers: ExecutionBlocker[] = []; const diagnostics: ExecutionDiagnostic[] = []; let requiresReview = false;
    const safetyGates = plan.safetyGates.map((gate) => {
      let status = gate.status;
      if (['user-review-required','policy-review-required','execution-preview-reviewed','resource-estimate-review'].includes(gate.kind)) {
        status = 'needs-review';
        requiresReview = true;
        diagnostics.push({ code:'execution-plan-safety-gate-needs-review', severity:'warning', message:'Safety review required.', targetReferenceKind:'execution-safety-gate', targetReferenceId:gate.id });
      }
      if (gate.kind === 'no-unresolved-blockers') status = plan.blockers.length > 0 ? 'blocked' : 'passed-by-plan';
      if (gate.kind === 'required-input-available' && gate.inputId) {
        const ok = !!plan.inputs.find((i)=>i.id===gate.inputId && i.status!=='missing' && i.status !== 'blocked' && i.status !== 'invalid');
        status = ok ? 'passed-by-plan' : 'blocked';
        if (!ok) blockers.push({ code:'execution-plan-missing-inputs', message:'Required input unavailable.', targetReferenceKind:'execution-safety-gate', targetReferenceId:gate.id });
      }
      if (gate.kind === 'output-destination-planned' && gate.outputId) {
        const ok = !!plan.outputs.find((o)=>o.id===gate.outputId && o.destinationReferenceId && o.status !== 'missing' && o.status !== 'blocked');
        status = ok ? 'passed-by-plan' : 'blocked';
        if (!ok) blockers.push({ code:'execution-plan-missing-outputs', message:'Output destination missing.', targetReferenceKind:'execution-safety-gate', targetReferenceId:gate.id });
      }
      if (gate.kind === 'provider-setup-selected' && gate.adapterReferenceId) {
        const a = plan.adapterReferences.find((x)=>x.id===gate.adapterReferenceId);
        if (!a || BLOCKED.has(a.status)) {
          status = 'blocked';
          blockers.push({ code:'execution-plan-provider-setup-required', message:'Provider setup required.', targetReferenceKind:'execution-safety-gate', targetReferenceId:gate.id });
        } else if (PASSABLE.has(a.status)) status = 'passed-by-plan';
        else status = 'needs-review';
      }
      if (gate.kind === 'access-material-not-embedded' || gate.kind === 'unsafe-details-redacted' || gate.kind === 'runnable-material-deferred' || gate.kind === 'storage-destination-safe') status = 'passed-by-plan';
      return { ...gate, status };
    });
    return { blockers, diagnostics, requiresReview, safetyGates };
  }
}
