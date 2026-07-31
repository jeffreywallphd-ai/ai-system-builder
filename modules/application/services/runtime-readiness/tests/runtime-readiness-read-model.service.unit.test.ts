import test from 'node:test';
import assert from 'node:assert/strict';
import type { RuntimeInventoryRepositoryPort, RuntimeReadinessBindingRepositoryPort } from '../../../ports/runtime-readiness';
import { WorkspaceRuntimeReadinessReadModelService } from '../runtime-readiness-read-model.service';

const binding = (workspace='ws.a', id='rb.1', status: any='ready-for-setup', plan='plan.1') => ({ readinessBindingId:id,targetWorkspaceId:workspace,compositionPlanId:plan,status,requirements:[{requirementId:'req.1',targetWorkspaceId:workspace,compositionPlanId:plan,capabilityKind:'model',capabilityKey:'gpt',isRequired:true,label:'Req',diagnostics:[],blockers:[]}],providerCandidates:[{providerCandidateId:'pc.1',providerKind:'openai',inventorySourceId:'inv.1',capabilities:[],availabilityStatus:'available',displayLabel:'Provider',diagnostics:[],blockers:[]}],bindingCandidates:[{bindingCandidateId:'bc.1',targetWorkspaceId:workspace,requirementId:'req.1',providerCandidateId:'pc.1',matchStatus:'matched',blockers:[],diagnostics:[]}],bindings:[{bindingId:'b.1',targetWorkspaceId:workspace,readinessBindingId:id,requirementId:'req.1',selectedProviderCandidateId:'pc.1',status:'selected',diagnostics:[],blockers:[],provenance:[],createdAt:'2026-01-01T00:00:00.000Z',updatedAt:'2026-01-01T00:00:00.000Z'}],blockers:[],diagnostics:[],provenance:[],createdAt:'2026-01-01T00:00:00.000Z',updatedAt:'2026-01-02T00:00:00.000Z'} as any);

const repos = (bindings:any[], inventories:any[] =[]) => ({
  bindingRepository: {
    listRuntimeReadinessBindingRecords: async (q:any)=>({records: bindings.filter((b)=>b.targetWorkspaceId===q.targetWorkspaceId)}),
    readRuntimeReadinessBindingRecord: async (w:any,id:any)=>bindings.find((b)=>b.targetWorkspaceId===w && b.readinessBindingId===id),
    listRuntimeReadinessBindingRecordsByCompositionPlanId: async (w:any,p:any)=>bindings.filter((b)=>b.targetWorkspaceId===w && b.compositionPlanId===p),
  } as RuntimeReadinessBindingRepositoryPort,
  inventoryRepository: { listRuntimeInventoryRecords: async (q:any)=>({records: inventories.filter((r)=>r.targetWorkspaceId===q.targetWorkspaceId)}) } as RuntimeInventoryRepositoryPort,
});

test('workspace scoped summaries and attention mapping', async ()=>{
  const svc = new WorkspaceRuntimeReadinessReadModelService(repos([binding('ws.a','rb.1','ready-for-setup'), binding('ws.b','rb.2','missing-requirements'), binding('ws.a','rb.3','provider-unavailable')]))
  const { summaries } = await svc.listRuntimeReadinessSummaries({targetWorkspaceId:'ws.a'} as any);
  assert.equal(summaries.length,2);
  assert.equal(summaries.find((s)=>s.readinessBindingId==='rb.1')?.needsAttention,false);
  assert.equal(summaries.find((s)=>s.readinessBindingId==='rb.3')?.needsAttention,true);
  assert.equal(summaries[0].setupReadinessLabel.includes('runtime-ready'), false);
});

test('detail is workspace-scoped and sanitized', async ()=>{
  const b = binding();
  b.diagnostics=[{code:'runtime-readiness-service-unavailable', severity:'error', message:'/tmp/secret token=abc stack trace'}];
  const svc = new WorkspaceRuntimeReadinessReadModelService(repos([b]));
  assert.equal(await svc.readRuntimeReadinessDetail({targetWorkspaceId:'ws.b', readinessBindingId:'rb.1'} as any), undefined);
  const detail = await svc.readRuntimeReadinessDetail({targetWorkspaceId:'ws.a', readinessBindingId:'rb.1'} as any);
  assert.ok(detail);
  assert.ok(!JSON.stringify(detail).includes('/tmp/secret'));
});

test('composition plan latest is deterministic', async ()=>{
  const a = binding('ws.a','rb.1','draft','plan.1'); a.updatedAt='2026-01-01T00:00:00.000Z';
  const b = binding('ws.a','rb.2','ready-for-setup','plan.1'); b.updatedAt='2026-01-02T00:00:00.000Z';
  const svc = new WorkspaceRuntimeReadinessReadModelService(repos([a,b,binding('ws.b','rb.2','ready-for-setup','plan.1')]));
  const latest = await svc.readLatestRuntimeReadinessForCompositionPlan({targetWorkspaceId:'ws.a', compositionPlanId:'plan.1'} as any);
  assert.equal(latest?.readinessBindingId,'rb.2');
});

test('inventory summary is workspace-scoped and safe', async ()=>{
  const inv = {targetWorkspaceId:'ws.a',inventorySourceId:'inv.1',inventorySourceKind:'manual',inventoryStatus:'stale',discoveredProviderCandidates:[{providerCandidateId:'pc.1',providerKind:'openai',inventorySourceId:'inv.1',capabilities:[],availabilityStatus:'not-configured',configurationStatus:'not-configured',displayLabel:'OpenAI',diagnostics:[],blockers:[]}],discoveredCapabilities:[{capabilityId:'cap.1',capabilityKind:'model',capabilityKey:'gpt',label:'GPT',availabilityStatus:'permission-required',diagnostics:[],blockers:[]}],diagnostics:[],blockers:[]};
  const svc = new WorkspaceRuntimeReadinessReadModelService(repos([binding()], [inv, {...inv,targetWorkspaceId:'ws.b'}]));
  const summary = await svc.summarizeWorkspaceRuntimeInventory({targetWorkspaceId:'ws.a'} as any);
  assert.equal(summary.inventorySourceCount,1);
  assert.equal(summary.providerCandidateCount,1);
  assert.equal(summary.capabilityCount,1);
});
