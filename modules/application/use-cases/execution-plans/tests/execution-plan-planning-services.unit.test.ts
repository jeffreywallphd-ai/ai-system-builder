import test from 'node:test';
import assert from 'node:assert/strict';
import { ExecutionPlanStepPlanningService } from '../execution-plan-step-planning.service';

test('maps image capability node to generate-image', () => {
  const service = new ExecutionPlanStepPlanningService();
  const composition = { nodes:[{ nodeId:'n1', role:'generator', requiredCapabilities:[{kind:'image-output', key:'x'}], providedCapabilities:[], label:'img', summary:'sum' }], relationships:[] } as any;
  const result = service.plan({ planId:'ep_1', compositionPlan: composition, nextExecutionStepId: ()=> 'es_1', sourceCompositionPlanId:'acp_1' });
  assert.equal(result.steps[0].kind, 'generate-image');
});

test('unknown maps to manual-review', () => {
  const service = new ExecutionPlanStepPlanningService();
  const composition = { nodes:[{ nodeId:'n1', role:'unknown', requiredCapabilities:[], providedCapabilities:[], label:'x' }], relationships:[] } as any;
  const result = service.plan({ planId:'ep_1', compositionPlan: composition, nextExecutionStepId: ()=> 'es_1', sourceCompositionPlanId:'acp_1' });
  assert.equal(result.steps[0].kind, 'manual-review');
  assert.equal(result.blockers.length, 1);
});
