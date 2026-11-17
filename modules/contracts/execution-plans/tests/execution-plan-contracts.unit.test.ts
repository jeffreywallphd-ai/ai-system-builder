import { describe, expect, it } from '../../../testing/node-test';
import { normalizeExecutionAdapterReferenceId, normalizeExecutionDependencyId, normalizeExecutionInputId, normalizeExecutionOutputId, normalizeExecutionPlanId, normalizeExecutionSafetyGateId, normalizeExecutionStepId } from '../execution-plan-identity';
import { normalizeExecutionPlanStatus, normalizeExecutionStepKind, normalizeExecutionStepStatus } from '../execution-plan-status';
import { normalizeExecutionDependencyKind, normalizeExecutionDependencyStatus } from '../execution-plan-dependency';
import { normalizeExecutionInputKind, normalizeExecutionInputOutputStatus, normalizeExecutionOutputKind } from '../execution-plan-input-output';
import { normalizeExecutionAdapterReferenceKind, normalizeExecutionAdapterReferenceStatus } from '../execution-plan-adapter-reference';
import { normalizeExecutionSafetyGateKind, normalizeExecutionSafetyGateStatus } from '../execution-plan-safety-gate';
import { normalizeExecutionComputeEstimateCategory } from '../execution-plan-resource-estimate';
import { normalizeExecutionDiagnostic, normalizeExecutionBlocker, normalizeExecutionPlanRecord } from '../execution-plan-normalization';
import * as records from '../execution-plan-normalization';

describe('execution plan contracts',()=>{
 it('normalizes ids',()=>{ expect(normalizeExecutionPlanId('plan.alpha')).toBe('plan.alpha'); expect(normalizeExecutionStepId('step.a')).toBe('step.a'); expect(normalizeExecutionDependencyId('dep.a')).toBe('dep.a'); expect(normalizeExecutionInputId('input.a')).toBe('input.a'); expect(normalizeExecutionOutputId('output.a')).toBe('output.a'); expect(normalizeExecutionAdapterReferenceId('adapter.a')).toBe('adapter.a'); expect(normalizeExecutionSafetyGateId('gate.a')).toBe('gate.a');});
 it('rejects unsafe ids and sanitizes errors',()=>{ for(const v of ['',' ',' ../x ','https://x','token-abc']) expect(()=>normalizeExecutionPlanId(v)).toThrow(/safe non-empty identifier/); expect(()=>normalizeExecutionPlanId('https://bad')).toThrow(new Error('ExecutionPlanId must be a safe non-empty identifier.')); });
 it('normalizes statuses and kinds',()=>{ expect(normalizeExecutionPlanStatus('draft')).toBe('draft'); expect(()=>normalizeExecutionPlanStatus('running')).toThrow(); expect(normalizeExecutionStepStatus('planned')).toBe('planned'); expect(normalizeExecutionStepKind('generate-image')).toBe('generate-image'); expect(normalizeExecutionDependencyKind('input-required')).toBe('input-required'); expect(normalizeExecutionDependencyStatus('missing')).toBe('missing'); expect(normalizeExecutionInputKind('asset-reference')).toBe('asset-reference'); expect(normalizeExecutionOutputKind('artifact')).toBe('artifact'); expect(normalizeExecutionInputOutputStatus('planned')).toBe('planned'); expect(normalizeExecutionAdapterReferenceKind('provider-adapter')).toBe('provider-adapter'); expect(normalizeExecutionAdapterReferenceStatus('needs-setup')).toBe('needs-setup'); expect(normalizeExecutionSafetyGateKind('user-review-required')).toBe('user-review-required'); expect(normalizeExecutionSafetyGateStatus('planned')).toBe('planned'); expect(normalizeExecutionComputeEstimateCategory('low')).toBe('low'); });
 it('validates diagnostics and blockers',()=>{ expect(normalizeExecutionDiagnostic({code:'execution-plan-step-missing',severity:'error',message:'Step is missing'}).code).toBe('execution-plan-step-missing'); expect(()=>normalizeExecutionDiagnostic({code:'x',severity:'error',message:'secret token'})).toThrow(); expect(()=>normalizeExecutionBlocker({code:'bad/path',message:'blocked'})).toThrow(); });
 it('validates record safety constraints',()=>{ const base:any={id:'plan.alpha',workspaceId:'ws-1',sourceCompositionPlanId:'cp-1',sourceRuntimeReadinessBindingId:'rb-1',sourceReadinessStatus:'ready-for-review',status:'draft',steps:[],dependencies:[],inputs:[],outputs:[],adapterReferences:[],safetyGates:[],blockers:[],diagnostics:[],resourceEstimates:[],provenance:[],createdAt:'2026-01-01T00:00:00.000Z',updatedAt:'2026-01-01T00:00:00.000Z'}; expect(normalizeExecutionPlanRecord(base).workspaceId).toBe('ws-1'); expect(()=>normalizeExecutionPlanRecord({...base,workspaceId:' '})).toThrow(); expect(()=>normalizeExecutionPlanRecord({...base,sourceRuntimeReadinessBindingId:''})).toThrow(); expect(()=>normalizeExecutionPlanRecord({...base,sourceCompositionPlanId:''})).toThrow(); expect(()=>normalizeExecutionPlanRecord({...base,commandLine:'rm -rf /'})).toThrow(); });
});

describe('strict passive execution planning',()=>{
 const at='2026-01-01T00:00:00.000Z';
 const history={blockers:[],diagnostics:[]};
 const fixtures:[((value:any)=>unknown),any][]=[
  [records.normalizeExecutionStep,{id:'step-1',sourceCompositionPlanId:'composition-1',kind:'generate-image',status:'planned',label:'Generate',requiredAdapterReferenceIds:[],inputIds:[],outputIds:[],dependencyIds:[],safetyGateIds:[],...history}],
  [records.normalizeExecutionDependency,{id:'dep-1',kind:'input-required',status:'planned',label:'Input required',...history}],
  [records.normalizeExecutionInput,{id:'input-1',stepId:'step-1',kind:'asset-reference',status:'planned',label:'Input',sourceReferenceKind:'asset',required:false,...history}],
  [records.normalizeExecutionOutput,{id:'output-1',stepId:'step-1',kind:'artifact',status:'planned',label:'Output',destinationReferenceKind:'artifact',required:true,...history}],
  [records.normalizeExecutionAdapterReference,{id:'adapter-1',kind:'provider-adapter',status:'planned',sourceRuntimeReadinessBindingId:'readiness-1',label:'Adapter',...history}],
  [records.normalizeExecutionSafetyGate,{id:'gate-1',kind:'user-review-required',status:'planned',label:'Review',...history}],
  [records.normalizeExecutionResourceEstimate,{id:'estimate-1',compute:'low',storage:'small',duration:'short',summary:'Estimate'}],
  [records.normalizeExecutionPlanProvenanceEntry,{kind:'execution-plan-created',at,workspaceId:'ws-1',executionPlanId:'plan-1'}],
 ];
 it('reconstructs all declared nested shapes and retains false required flags',()=>{
  for(const [normalize,value] of fixtures)expect(normalize(value)).toEqual(value);
 });
 it('rejects undeclared fields and accessors in every nested shape without executing them',()=>{
  let calls=0;
  for(const [normalize,value] of fixtures){
   expect(()=>normalize({...value,providerPayload:'private'})).toThrow();
   const getter={...value};Object.defineProperty(getter,'label',{enumerable:true,get(){calls++;return'private';}});
   expect(()=>normalize(getter)).toThrow();
   expect(()=>normalize({...value,summary:{trim(){calls++;return'private';}}})).toThrow();
  }
  expect(calls).toBe(0);
 });
 it('rejects truthy flags, unsafe diagnostics, invalid severity and provenance, and command extras',()=>{
  for(const required of ['false',0,null,undefined])expect(()=>records.normalizeExecutionInput({...fixtures[2][1],required})).toThrow();
  expect(()=>records.normalizeExecutionDiagnostic({code:'plan.invalid',severity:'fatal',message:'Invalid'} as any)).toThrow();
  expect(()=>records.normalizeExecutionBlocker({code:'plan.invalid',message:'\\private'})).toThrow();
  expect(()=>records.normalizeExecutionPlanProvenanceEntry({kind:'invented',at} as any)).toThrow();
  expect(()=>records.normalizeExecutionPlanProvenanceEntry({kind:'execution-plan-created',at:'2026-02-30T00:00:00.000Z'})).toThrow();
  expect(()=>records.normalizeListExecutionPlansCommand({workspaceId:'ws-1',payload:'private'} as any)).toThrow();
 });
 it('rejects actual credential representations in nested planning records',()=>{
  for(const prefix of ['ghp_','gho_','github_pat_','sk-proj-','sk-','sk_','hf_','xoxb-']){
   const message=prefix+'syntheticvalue'.repeat(3);
   expect(()=>records.normalizeExecutionDiagnostic({code:'plan.failed',severity:'error',message})).toThrow();
   expect(()=>records.normalizeExecutionBlocker({code:'plan.failed',message})).toThrow();
   expect(()=>records.normalizeExecutionStep({...fixtures[0][1],summary:message})).toThrow();
  }
 });
});
