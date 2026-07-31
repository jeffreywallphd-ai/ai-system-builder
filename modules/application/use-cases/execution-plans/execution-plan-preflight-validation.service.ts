import type { ExecutionPlanRecord, ExecutionBlocker, ExecutionDiagnostic } from '../../../contracts/execution-plans';

export class ExecutionPlanPreflightValidationService {
  public validate(plan: ExecutionPlanRecord): { blockers: ExecutionBlocker[]; diagnostics: ExecutionDiagnostic[]; hasMissingInputs: boolean; hasMissingOutputs: boolean; hasMissingAdapters: boolean; hasUnsafeDetails: boolean } {
    const blockers: ExecutionBlocker[] = [];
    const diagnostics: ExecutionDiagnostic[] = [];
    if (!plan.workspaceId) blockers.push(this.b('execution-plan-workspace-missing','Workspace is required.'));
    if (!plan.sourceRuntimeReadinessBindingId) blockers.push(this.b('execution-plan-source-readiness-missing','Source readiness reference is required.'));
    if (!plan.sourceCompositionPlanId) blockers.push(this.b('execution-plan-source-composition-missing','Source composition plan reference is required.'));
    if (plan.steps.length === 0) blockers.push(this.b('execution-plan-no-steps-planned','At least one step must be planned.'));

    const stepIds = new Set(plan.steps.map((s) => s.id));
    const inputIds = new Set(plan.inputs.map((i) => i.id));
    const outputIds = new Set(plan.outputs.map((o) => o.id));
    const adapterIds = new Set(plan.adapterReferences.map((a) => a.id));
    const gateIds = new Set(plan.safetyGates.map((g) => g.id));

    for (const dep of plan.dependencies) {
      if (dep.sourceStepId && !stepIds.has(dep.sourceStepId)) blockers.push(this.b('execution-plan-invalid-source-step-dependency','Dependency references unknown source step.', dep.id));
      if (dep.targetStepId && !stepIds.has(dep.targetStepId)) blockers.push(this.b('execution-plan-invalid-target-step-dependency','Dependency references unknown target step.', dep.id));
      if (dep.inputId && !inputIds.has(dep.inputId)) blockers.push(this.b('execution-plan-missing-required-input','Dependency references unknown input.', dep.id));
      if (dep.outputId && !outputIds.has(dep.outputId)) blockers.push(this.b('execution-plan-missing-required-output','Dependency references unknown output.', dep.id));
      if (dep.adapterReferenceId && !adapterIds.has(dep.adapterReferenceId)) blockers.push(this.b('execution-plan-missing-adapter-reference','Dependency references unknown adapter.', dep.id));
      if (dep.safetyGateId && !gateIds.has(dep.safetyGateId)) blockers.push(this.b('execution-plan-safety-gate-target-missing','Dependency references unknown safety gate.', dep.id));
    }

    for (const i of plan.inputs) if (!stepIds.has(i.stepId)) blockers.push(this.b('execution-plan-input-step-unknown','Input references unknown step.', i.id));
    for (const o of plan.outputs) if (!stepIds.has(o.stepId)) blockers.push(this.b('execution-plan-output-step-unknown','Output references unknown step.', o.id));
    for (const s of plan.steps) {
      for (const inId of s.inputIds) if (!inputIds.has(inId)) blockers.push(this.b('execution-plan-missing-required-input','Step input missing.', s.id));
      for (const outId of s.outputIds) if (!outputIds.has(outId)) blockers.push(this.b('execution-plan-missing-required-output','Step output missing.', s.id));
      for (const aId of s.requiredAdapterReferenceIds) if (!adapterIds.has(aId)) blockers.push(this.b('execution-plan-provider-setup-required','Step adapter missing.', s.id));
    }
    for (const g of plan.safetyGates) {
      if (g.stepId && !stepIds.has(g.stepId)) blockers.push(this.b('execution-plan-safety-gate-target-missing','Safety gate references unknown step.', g.id));
      if (g.inputId && !inputIds.has(g.inputId)) blockers.push(this.b('execution-plan-safety-gate-target-missing','Safety gate references unknown input.', g.id));
      if (g.outputId && !outputIds.has(g.outputId)) blockers.push(this.b('execution-plan-safety-gate-target-missing','Safety gate references unknown output.', g.id));
      if (g.adapterReferenceId && !adapterIds.has(g.adapterReferenceId)) blockers.push(this.b('execution-plan-safety-gate-target-missing','Safety gate references unknown adapter.', g.id));
    }

    const hasUnsafeDetails = this.hasForbiddenDetails(plan);
    if (hasUnsafeDetails) diagnostics.push({ code: 'execution-plan-unsafe-details-redacted', severity: 'warning', message: 'Unsafe details were detected and deferred.' });
    return { blockers, diagnostics, hasMissingInputs: blockers.some((b) => b.code.includes('input')), hasMissingOutputs: blockers.some((b) => b.code.includes('output')), hasMissingAdapters: blockers.some((b) => b.code.includes('adapter') || b.code.includes('provider-setup')), hasUnsafeDetails };
  }
  private hasForbiddenDetails(plan: ExecutionPlanRecord): boolean {
    const unsafeKeyPattern = /^(?:unsafePayload|rawPath|payload|token|secret|credential|apiKey|api_key|commandLine|envValue|base64|blob|workflowJson|providerPayload|promptText)$/i;
    const unsafeValuePattern = /(?:base64|base64:\/\/|signed\s*url|[a-zA-Z]:[\\/]|(?:^|\s)(?:\.|~)?\/(?:tmp|var|home|users|etc)\b|token|secret|api[_-]?key|command\s*line|process\.env)/i;
    const hasUnsafeShape = (value: unknown): boolean => {
      if (typeof value === 'string') return unsafeValuePattern.test(value);
      if (Array.isArray(value)) return value.some(hasUnsafeShape);
      if (value && typeof value === 'object') {
        return Object.entries(value as Record<string, unknown>).some(([key, entry]) => unsafeKeyPattern.test(key) || hasUnsafeShape(entry));
      }
      return false;
    };
    const textFields = [
      ...plan.steps.map((x)=>x.summary ?? ''),
      ...plan.diagnostics.map((x)=>x.message ?? ''),
      ...plan.blockers.map((x)=>x.message ?? ''),
    ].join(' ').toLowerCase();
    const hasForbiddenField = plan.outputs.some((o)=> (o as unknown as Record<string, unknown>).rawPath || (o as unknown as Record<string, unknown>).payload)
      || plan.inputs.some((i)=> (i as unknown as Record<string, unknown>).token || (i as unknown as Record<string, unknown>).secret)
      || textFields.includes('base64://');
    return hasForbiddenField || hasUnsafeShape(plan);
  }
  private b(code: string, message: string, targetReferenceId?: string): ExecutionBlocker { return { code, message, ...(targetReferenceId ? { targetReferenceKind: 'execution-step', targetReferenceId: targetReferenceId } : {}) }; }
}
