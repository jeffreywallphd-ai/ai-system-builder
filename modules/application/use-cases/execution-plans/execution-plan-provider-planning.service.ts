import { normalizeExecutionAdapterReferenceId, type ExecutionAdapterReference, type ExecutionAdapterReferenceKind, type ExecutionAdapterReferenceStatus, type ExecutionBlocker, type ExecutionDiagnostic, type ExecutionStep } from '../../../contracts/execution-plans';
import type { RuntimeCapabilityKind, RuntimeReadinessBinding } from '../../../contracts/runtime-readiness';

const needsProvider = new Set<ExecutionStep['kind']>(['generate-image','generate-text','embed-content','call-api','store-artifact','read-artifact']);

const inferCapability = (stepKind: ExecutionStep['kind']): RuntimeCapabilityKind | '' => {
  if (stepKind === 'generate-image') return 'image-generation-runtime';
  if (stepKind === 'generate-text') return 'text-generation-runtime';
  if (stepKind === 'embed-content') return 'embedding-runtime';
  if (stepKind === 'store-artifact' || stepKind === 'read-artifact') return 'artifact-storage';
  if (stepKind === 'call-api') return 'api-service';
  return '';
};

export class ExecutionPlanProviderPlanningService {
  public plan(args:{ planId:string; sourceRuntimeReadinessBindingId:string; readiness:RuntimeReadinessBinding; steps:ExecutionStep[]; createAdapterReferenceId:()=>string; }) {
    const adapterReferences:ExecutionAdapterReference[]=[]; const blockers:ExecutionBlocker[]=[]; const diagnostics:ExecutionDiagnostic[]=[];
    const selected = args.readiness.bindings
      .filter((binding) => binding.status === 'selected' || binding.status === 'bound')
      .map((binding) => {
        const capability = args.readiness.providerCandidates
          .flatMap((provider) => provider.capabilities)
          .find((candidateCapability) => candidateCapability.capabilityId === binding.selectedCapabilityId);
        return { runtimeBindingId: binding.bindingId, providerKind: binding.selectedProviderCandidateId, capabilityKind: capability?.capabilityKind, status: binding.status, label: capability?.label };
      });
    const steps = args.steps.map((step)=>{
      if (!needsProvider.has(step.kind)) return step;
      const requiredCapability = inferCapability(step.kind);
      const binding = selected.find((b)=> (b.capabilityKind ?? '').toLowerCase() === requiredCapability);
      const status:ExecutionAdapterReferenceStatus = binding ? 'available-by-readiness':'needs-setup';
      const kind:ExecutionAdapterReferenceKind = step.kind === 'call-api' ? 'api-adapter' : step.kind === 'store-artifact' ? 'storage-adapter' : step.kind === 'read-artifact' ? 'artifact-adapter' : step.kind === 'generate-image' ? 'model-adapter' : 'provider-adapter';
      const ar:ExecutionAdapterReference = { id: normalizeExecutionAdapterReferenceId(args.createAdapterReferenceId()), kind, status, sourceRuntimeReadinessBindingId: args.sourceRuntimeReadinessBindingId, sourceRuntimeBindingId: binding?.runtimeBindingId, providerKind: binding?.providerKind, capabilityKind: binding?.capabilityKind, label: binding?.label ?? `Setup required for ${step.kind}`, blockers:[], diagnostics:[] };
      adapterReferences.push(ar);
      if (!binding) blockers.push({ code:'execution-plan-provider-setup-required', message:'Provider setup selection required.', targetReferenceKind:'execution-step', targetReferenceId:step.id });

      diagnostics.push({ code:'execution-plan-provider-planning-deferred', severity:'info', message:'Provider invocation remains deferred.', targetReferenceKind:'execution-step', targetReferenceId:step.id });
      return { ...step, requiredAdapterReferenceIds:[...step.requiredAdapterReferenceIds, ar.id] };
    });
    return { steps, adapterReferences, blockers, diagnostics };
  }
}
