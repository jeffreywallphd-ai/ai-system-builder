import type { AssetCompositionPlan } from '../../../contracts/asset-composition';
import type { ExecutionAdapterReference, ExecutionBlocker, ExecutionDependency, ExecutionDependencyId, ExecutionDependencyStatus, ExecutionDiagnostic, ExecutionInput, ExecutionOutput, ExecutionSafetyGate, ExecutionStep } from '../../../contracts/execution-plans';

const adapterToDep = (status: ExecutionAdapterReference['status']): ExecutionDependencyStatus => {
  if (status === 'available-by-readiness') return 'satisfied-by-plan';
  if (status === 'planned') return 'planned';
  if (status === 'needs-setup' || status === 'missing' || status === 'unsupported' || status === 'deferred') return 'missing';
  return status;
};
const gateToDep = (status: ExecutionSafetyGate['status']): ExecutionDependencyStatus => {
  if (status === 'passed-by-plan') return 'satisfied-by-plan';
  if (status === 'needs-review' || status === 'deferred' || status === 'not-applicable') return 'planned';
  if (status === 'failed') return 'blocked';
  return status;
};

export class ExecutionPlanDependencyPlanningService {
  public plan(args: { compositionPlan: AssetCompositionPlan; steps: ExecutionStep[]; inputs: ExecutionInput[]; outputs: ExecutionOutput[]; adapterReferences: ExecutionAdapterReference[]; safetyGates: ExecutionSafetyGate[]; nextExecutionDependencyId: () => ExecutionDependencyId | string; }) {
    const deps: ExecutionDependency[] = []; const blockers: ExecutionBlocker[] = []; const diagnostics: ExecutionDiagnostic[] = [];
    const byNode = new Map(args.steps.map((s) => [s.sourceNodeId, s]));
    for (const rel of args.compositionPlan.relationships) {
      const src = byNode.get(rel.sourceNodeId); const tgt = byNode.get(rel.targetNodeId);
      if (!src || !tgt) { diagnostics.push({ code:'execution-plan-ambiguous-relationship-mapping', severity:'warning', message:'Relationship mapping ambiguous.', targetReferenceKind:'composition-relationship', targetReferenceId: rel.relationshipId }); continue; }
      deps.push({ id: args.nextExecutionDependencyId() as ExecutionDependencyId, kind:'step-after-step', status:'planned', sourceStepId: src.id, targetStepId: tgt.id, label:'Step ordering dependency', blockers:[], diagnostics:[] });
    }
    for (const input of args.inputs) deps.push({ id: args.nextExecutionDependencyId() as ExecutionDependencyId, kind:'input-required', status:(input.status === 'available' || input.status === 'planned') ? 'satisfied-by-plan' : input.status === 'needs-review' ? 'planned' : input.status === 'missing' ? 'missing' : input.status, sourceStepId: input.stepId, inputId: input.id, label:'Input required dependency', blockers:[], diagnostics:[] });
    for (const output of args.outputs) deps.push({ id: args.nextExecutionDependencyId() as ExecutionDependencyId, kind:'output-required', status:(output.status === 'available' || (output.status === 'planned' && !!output.destinationReferenceId)) ? 'satisfied-by-plan' : output.status === 'needs-review' ? 'planned' : output.status === 'missing' ? 'missing' : output.status, sourceStepId: output.stepId, outputId: output.id, label:'Output required dependency', blockers:[], diagnostics:[] });
    for (const a of args.adapterReferences) {
      const step = args.steps.find((s) => s.requiredAdapterReferenceIds.includes(a.id));
      if (!step) { blockers.push({ code:'execution-plan-missing-step-reference', message:'Missing step for adapter dependency.' }); continue; }
      deps.push({ id: args.nextExecutionDependencyId() as ExecutionDependencyId, kind:'provider-required', status:adapterToDep(a.status), sourceStepId: step.id, adapterReferenceId: a.id, label:'Provider required dependency', blockers:[], diagnostics:[] });
    }
    for (const g of args.safetyGates) if (g.stepId) deps.push({ id: args.nextExecutionDependencyId() as ExecutionDependencyId, kind:'safety-gate-required', status:gateToDep(g.status), sourceStepId: g.stepId, safetyGateId: g.id, label:'Safety gate dependency', blockers:[], diagnostics:[] });
    return { dependencies: deps, blockers, diagnostics };
  }
}
