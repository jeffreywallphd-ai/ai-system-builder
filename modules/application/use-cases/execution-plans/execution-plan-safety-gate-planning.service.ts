import type { ExecutionAdapterReference, ExecutionInput, ExecutionOutput, ExecutionSafetyGate, ExecutionSafetyGateId, ExecutionStep } from '../../../contracts/execution-plans';

const REVIEW_GATES: Array<ExecutionSafetyGate['kind']> = ['no-unresolved-blockers','access-material-not-embedded','unsafe-details-redacted','runnable-material-deferred'];

export class ExecutionPlanSafetyGatePlanningService {
  public plan(args:{steps:ExecutionStep[]; inputs:ExecutionInput[]; outputs:ExecutionOutput[]; adapterReferences:ExecutionAdapterReference[]; createSafetyGateId:()=>ExecutionSafetyGateId|string;}) {
    const gates: ExecutionSafetyGate[] = [];
    for (const step of args.steps) {
      for (const inputId of step.inputIds) gates.push({id:args.createSafetyGateId() as ExecutionSafetyGateId, kind:'required-input-available', status:'planned', label:'Required input available', stepId:step.id, inputId, blockers:[], diagnostics:[]});
      for (const outputId of step.outputIds) gates.push({id:args.createSafetyGateId() as ExecutionSafetyGateId, kind:'output-destination-planned', status:'planned', label:'Output destination planned', stepId:step.id, outputId, blockers:[], diagnostics:[]});
      for (const adapterReferenceId of step.requiredAdapterReferenceIds) gates.push({id:args.createSafetyGateId() as ExecutionSafetyGateId, kind:'provider-setup-selected', status:'planned', label:'Provider setup selected', stepId:step.id, adapterReferenceId, blockers:[], diagnostics:[]});
      gates.push({id:args.createSafetyGateId() as ExecutionSafetyGateId, kind:'storage-destination-safe', status:'planned', label:'Storage destination safe', stepId:step.id, blockers:[], diagnostics:[]});
    }
    for (const kind of REVIEW_GATES) gates.push({id:args.createSafetyGateId() as ExecutionSafetyGateId, kind, status:'planned', label:kind.replace(/-/g,' '), blockers:[], diagnostics:[]});
    return { safetyGates: gates };
  }
}
