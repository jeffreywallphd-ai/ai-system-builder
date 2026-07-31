import test from 'node:test';
import assert from 'node:assert/strict';
import { ExecutionPlanSafetyGateValidationService } from '../execution-plan-safety-gate-validation.service';

test('safety gate marks review required', ()=>{
  const svc = new ExecutionPlanSafetyGateValidationService();
  const r = svc.validate({safetyGates:[{id:'g1',kind:'user-review-required'}],blockers:[],adapterReferences:[]} as any);
  assert.equal(r.requiresReview, true);
});
