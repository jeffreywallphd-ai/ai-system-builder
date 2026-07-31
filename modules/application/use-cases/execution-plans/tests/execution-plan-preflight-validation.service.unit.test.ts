import test from 'node:test';
import assert from 'node:assert/strict';
import { ExecutionPlanPreflightValidationService } from '../execution-plan-preflight-validation.service';

const mkPlan = () => ({ id:'ep_1', workspaceId:'ws_1', sourceCompositionPlanId:'acp_1', sourceRuntimeReadinessBindingId:'rrb_1', sourceReadinessStatus:'ready-for-setup', status:'draft', steps:[{id:'es_1',sourceCompositionPlanId:'acp_1',kind:'generate-text',status:'planned',label:'s',summary:'safe',requiredAdapterReferenceIds:['ear_1'],inputIds:['ei_1'],outputIds:['eo_1'],dependencyIds:[],safetyGateIds:[],blockers:[],diagnostics:[]}], dependencies:[], inputs:[{id:'ei_1',stepId:'es_1',kind:'text',status:'planned',label:'i',blockers:[],diagnostics:[]}], outputs:[{id:'eo_1',stepId:'es_1',kind:'text',status:'planned',label:'o',blockers:[],diagnostics:[]}], adapterReferences:[{id:'ear_1',kind:'provider-adapter',status:'planned',sourceRuntimeReadinessBindingId:'rrb_1',sourceRuntimeBindingId:'rb_1',label:'a',blockers:[],diagnostics:[]}], safetyGates:[], blockers:[], diagnostics:[], resourceEstimates:[], provenance:[], createdAt:'2026-01-01T00:00:00.000Z', updatedAt:'2026-01-01T00:00:00.000Z', archivedAt:undefined } as any);

test('preflight flags missing step IO and unsafe details', ()=>{
  const svc = new ExecutionPlanPreflightValidationService();
  const p = mkPlan();
  p.steps[0].inputIds = ['missing'];
  p['unsafePayload'] = 'base64';
  const r = svc.validate(p);
  assert.equal(r.hasMissingInputs, true);
  assert.equal(r.hasUnsafeDetails, true);
});
