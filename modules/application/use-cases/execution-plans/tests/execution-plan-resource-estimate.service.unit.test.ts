import test from 'node:test';
import assert from 'node:assert/strict';
import { ExecutionPlanResourceEstimateService } from '../execution-plan-resource-estimate.service';

test('resource estimate computes unknown duration when adapter needs setup', ()=>{
  const svc = new ExecutionPlanResourceEstimateService();
  const est = svc.estimate({steps:[{kind:'generate-image'}],outputs:[1,2,3],adapterReferences:[{kind:'manual-adapter',status:'needs-setup'}]} as any);
  assert.equal(est[0]?.duration,'unknown');
});
