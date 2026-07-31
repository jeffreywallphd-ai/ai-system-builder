import { describe, expect, it, testDouble } from '../../../../testing/node-test';
import { registerExecutionPlansIpc } from '../execution-plans/registerExecutionPlansIpc';
import { DESKTOP_EXECUTION_PLANS_CREATE_PLAN_REQUEST_CHANNEL, DESKTOP_EXECUTION_PLANS_LIST_SUMMARIES_REQUEST_CHANNEL } from '../../../../contracts/ipc';

describe('registerExecutionPlansIpc',()=>{
 it('registers channels and validates workspace', async()=>{
  const handlers=new Map<string, any>();
  registerExecutionPlansIpc({ ipcMain:{ handle:testDouble.fn((c,h)=>handlers.set(c,h)) } as any, executionPlans:{ create:{execute:testDouble.fn(async()=>({}))} as any, validate:{execute:testDouble.fn(async()=>({}))} as any, readModel:{ listExecutionPlanSummaries:testDouble.fn(async()=>({summaries:[]})), readExecutionPlanDetail:testDouble.fn(async()=>({})), listExecutionPlansForCompositionPlan:testDouble.fn(async()=>[]), readLatestExecutionPlanForCompositionPlan:testDouble.fn(async()=>undefined), listExecutionPlansForRuntimeReadinessBinding:testDouble.fn(async()=>[]), readLatestExecutionPlanForRuntimeReadinessBinding:testDouble.fn(async()=>undefined), listExecutionPlansNeedingAttention:testDouble.fn(async()=>[]), summarizeWorkspaceExecutionPlans:testDouble.fn(async()=>({total:0})) } as any } });
  expect(handlers.has(DESKTOP_EXECUTION_PLANS_CREATE_PLAN_REQUEST_CHANNEL.value)).toBe(true);
  const res=await handlers.get(DESKTOP_EXECUTION_PLANS_LIST_SUMMARIES_REQUEST_CHANNEL.value)(null,{payload:{}});
  expect(res.ok).toBe(false);
  expect(res.error.code).toBe('validation');
 });
});


it('rejects invalid status filter', async()=>{
 const handlers=new Map<string, any>();
 registerExecutionPlansIpc({ ipcMain:{ handle:testDouble.fn((c,h)=>handlers.set(c,h)) } as any, executionPlans:{ create:{execute:testDouble.fn(async()=>({}))} as any, validate:{execute:testDouble.fn(async()=>({}))} as any, readModel:{ listExecutionPlanSummaries:testDouble.fn(async()=>({summaries:[]})), readExecutionPlanDetail:testDouble.fn(async()=>({})), listExecutionPlansForCompositionPlan:testDouble.fn(async()=>[]), readLatestExecutionPlanForCompositionPlan:testDouble.fn(async()=>undefined), listExecutionPlansForRuntimeReadinessBinding:testDouble.fn(async()=>[]), readLatestExecutionPlanForRuntimeReadinessBinding:testDouble.fn(async()=>undefined), listExecutionPlansNeedingAttention:testDouble.fn(async()=>[]), summarizeWorkspaceExecutionPlans:testDouble.fn(async()=>({total:0})) } as any } });
 const res=await handlers.get(DESKTOP_EXECUTION_PLANS_LIST_SUMMARIES_REQUEST_CHANNEL.value)(null,{payload:{workspaceId:'ws.1',status:'bad-status'}});
 expect(res.ok).toBe(false);
 expect(res.error.code).toBe('validation');
});
