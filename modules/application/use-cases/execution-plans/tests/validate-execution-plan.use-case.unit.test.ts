import test from 'node:test';
import assert from 'node:assert/strict';
import { ValidateExecutionPlanUseCase } from '../validate-execution-plan.use-case';
import { ExecutionPlanPreflightValidationService } from '../execution-plan-preflight-validation.service';
import { ExecutionPlanSafetyGateValidationService } from '../execution-plan-safety-gate-validation.service';
import { ExecutionPlanResourceEstimateService } from '../execution-plan-resource-estimate.service';
import { ExecutionPlanStatusService } from '../execution-plan-status.service';

const record:any = { id:'ep_1', workspaceId:'ws_1', sourceCompositionPlanId:'acp_1', sourceRuntimeReadinessBindingId:'rrb_1', sourceReadinessStatus:'ready-for-setup', status:'draft', steps:[{id:'es_1',sourceCompositionPlanId:'acp_1',kind:'generate-text',status:'planned',label:'s',summary:'safe',requiredAdapterReferenceIds:[],inputIds:[],outputIds:[],dependencyIds:[],safetyGateIds:[],blockers:[],diagnostics:[]}], dependencies:[], inputs:[], outputs:[], adapterReferences:[], safetyGates:[{id:'g1',kind:'user-review-required',status:'planned',label:'g',blockers:[],diagnostics:[]}], blockers:[], diagnostics:[], resourceEstimates:[], provenance:[], createdAt:'2026-01-01T00:00:00.000Z', updatedAt:'2026-01-01T00:00:00.000Z' };

test('validate use case saves and returns success', async ()=>{
 const repo:any={getExecutionPlanById:async()=>record, updateExecutionPlan:async(v:any)=>v};
 const uc = new ValidateExecutionPlanUseCase({executionPlanRepository:repo, preflightValidationService:new ExecutionPlanPreflightValidationService(), safetyGateValidationService:new ExecutionPlanSafetyGateValidationService(), resourceEstimateService:new ExecutionPlanResourceEstimateService(), statusService:new ExecutionPlanStatusService(), now:()=> '2026-05-21T00:00:00.000Z'});
 const r:any = await uc.execute({workspaceId:'ws_1',executionPlanId:'ep_1'});
 assert.equal(r.kind,'success');
 assert.equal(r.value.status,'safety-review-required');
});


test('validation is idempotent for derived blockers/diagnostics', async ()=>{
 let stored:any = JSON.parse(JSON.stringify(record));
 stored.outputs=[{id:'eo_1',stepId:'es_1',kind:'artifact',status:'missing',label:'o',destinationReferenceKind:'composition-node',required:true,blockers:[],diagnostics:[]}];
 stored.safetyGates=[{id:'g1',kind:'output-destination-planned',status:'planned',label:'g',outputId:'eo_1',blockers:[],diagnostics:[]}];
 const repo:any={getExecutionPlanById:async()=>stored, updateExecutionPlan:async(v:any)=>{stored=v; return v;}};
 const uc = new ValidateExecutionPlanUseCase({executionPlanRepository:repo, preflightValidationService:new ExecutionPlanPreflightValidationService(), safetyGateValidationService:new ExecutionPlanSafetyGateValidationService(), resourceEstimateService:new ExecutionPlanResourceEstimateService(), statusService:new ExecutionPlanStatusService(), now:()=> '2026-05-21T00:00:00.000Z'});
 await uc.execute({workspaceId:'ws_1',executionPlanId:'ep_1'});
 const once = { blockers: stored.blockers.length, diagnostics: stored.diagnostics.length };
 await uc.execute({workspaceId:'ws_1',executionPlanId:'ep_1'});
 assert.equal(stored.blockers.length, once.blockers);
 assert.equal(stored.diagnostics.length, once.diagnostics);
});
