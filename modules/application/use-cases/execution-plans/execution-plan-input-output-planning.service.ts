import type { AssetCompositionPlan } from '../../../contracts/asset-composition';
import type { ExecutionBlocker, ExecutionDiagnostic, ExecutionInput, ExecutionInputId, ExecutionOutput, ExecutionOutputId, ExecutionStep } from '../../../contracts/execution-plans';

type Result = { inputs: ExecutionInput[]; outputs: ExecutionOutput[]; blockers: ExecutionBlocker[]; diagnostics: ExecutionDiagnostic[]; };

export class ExecutionPlanInputOutputPlanningService {
  public plan(args: { steps: ExecutionStep[]; compositionPlan: AssetCompositionPlan; nextExecutionInputId: () => ExecutionInputId | string; nextExecutionOutputId: () => ExecutionOutputId | string; }): Result {
    const byNode = new Map(args.steps.map((s) => [s.sourceNodeId, s]));
    const inputs: ExecutionInput[] = [];
    const outputs: ExecutionOutput[] = [];
    const blockers: ExecutionBlocker[] = [];
    const diagnostics: ExecutionDiagnostic[] = [];
    for (const node of args.compositionPlan.nodes) {
      const step = byNode.get(node.nodeId);
      if (!step) continue;
      const role = String(node.role).toLowerCase();
      const requiresInput = ['generate-image','generate-text','embed-content','call-api','transform-data','validate-output','store-artifact'].includes(step.kind);
      const producesOutput = ['generate-image','generate-text','embed-content','call-api','transform-data','store-artifact','compose-output'].includes(step.kind);
      if (role.includes('input') || role.includes('artifact') || role.includes('source') || role.includes('data') || requiresInput) {
        const required = !role.includes('optional');
        const input: ExecutionInput = { id: args.nextExecutionInputId() as ExecutionInputId, stepId: step.id, kind: role.includes('artifact') ? 'artifact-reference' : role.includes('source') ? 'asset-reference' : 'workspace-data', status: required ? 'planned' : 'needs-review', label: node.label ?? `Input for ${step.label}`, sourceReferenceKind: 'composition-node', sourceReferenceId: node.nodeId, required, blockers: [], diagnostics: [] };
        if (required && !node.nodeId) blockers.push({ code: 'execution-plan-missing-inputs', message: 'Missing required input reference.', targetReferenceKind: 'execution-step', targetReferenceId: step.id });
        if (!required) diagnostics.push({ code: 'execution-plan-optional-input-review', severity: 'info', message: 'Optional/unknown input requires review.', targetReferenceKind: 'execution-input', targetReferenceId: input.id });
        inputs.push(input);
      }
      if (role.includes('output') || role.includes('storage') || role.includes('report') || role.includes('preview') || role.includes('workspace-record') || producesOutput) {
        const output: ExecutionOutput = { id: args.nextExecutionOutputId() as ExecutionOutputId, stepId: step.id, kind: role.includes('report') ? 'report' : role.includes('preview') ? 'preview' : role.includes('workspace-record') ? 'workspace-record' : 'artifact', status: 'planned', label: node.label ?? `Output for ${step.label}`, destinationReferenceKind: 'composition-node', destinationReferenceId: node.nodeId, required: true, blockers: [], diagnostics: [] };
        if (!output.destinationReferenceId) {
          output.status = 'missing';
          output.blockers.push({ code: 'execution-plan-missing-outputs', message: 'Missing output destination.', targetReferenceKind: 'execution-output', targetReferenceId: output.id });
          blockers.push({ code: 'execution-plan-missing-outputs', message: 'Missing output destination.', targetReferenceKind: 'execution-step', targetReferenceId: step.id });
        }
        outputs.push(output);
      } else if (producesOutput) {
        blockers.push({ code: 'execution-plan-missing-outputs', message: 'Missing output destination.', targetReferenceKind: 'execution-step', targetReferenceId: step.id });
      }
    }
    return { inputs, outputs, blockers, diagnostics };
  }
}
