import test from 'node:test';
import assert from 'node:assert/strict';
import { ApproveConversationSessionUseCase, ConversationSessionApprovalValidityService, ConversationalExecutionPlanEligibilityService, ConversationalSourceSystemVerificationService, CreateConversationExecutionSessionFromPlanUseCase, ValidateConversationSessionEligibilityUseCase, ValidateConversationTurnEligibilityUseCase } from '../index';

const workspaceId = 'workspace.main' as any;
const basePlan: any = { id:'execution.plan.1', workspaceId, sourceCompositionPlanId:'composition.plan.1', sourceRuntimeReadinessBindingId:'readiness.binding.1', status:'ready-for-review', blockers:[], steps:[{kind:'generate-text',label:'Chat'}], adapterReferences:[{kind:'provider-capability',capabilityKind:'text-generation'}] };
const baseReadiness: any = { readinessBindingId:'readiness.binding.1', targetWorkspaceId:workspaceId, compositionPlanId:'composition.plan.1', status:'ready-for-setup', blockers:[] };
const baseComposition: any = { planId:'composition.plan.1', name:'Verified Chat', status:'valid', archivedAt: undefined, nodes:[{ role:'ui-surface', providedCapabilities:[{ kind:'text-output' }]}] };

test('creates awaiting-approval session from eligible reviewed plan', async () => {
  const saved:any[] = [];
  const uc = new CreateConversationExecutionSessionFromPlanUseCase({ sessionRepository:{saveConversationSession:async(r:any)=>(saved.push(r),r)} as any, executionPlanRepository:{getExecutionPlanById:async()=>basePlan} as any, runtimeReadinessRepository:{readRuntimeReadinessBindingRecord:async()=>baseReadiness} as any, assetCompositionPlanRepository: { readAssetCompositionPlanRecord: async () => baseComposition } as any, eligibilityService:new ConversationalExecutionPlanEligibilityService(), sourceVerificationService:new ConversationalSourceSystemVerificationService(), nextConversationSessionId:()=> 'conversation.session.1', now:()=> '2026-05-22T00:00:00.000Z' });
  const result = await uc.execute({ workspaceId, sourceExecutionPlanId: 'execution.plan.1' } as any);
  assert.equal(result.kind, 'success');
  assert.equal(result.value.status, 'awaiting-approval');
  assert.equal(saved.length, 1);
});

test('eligibility returns ready turn invocation truthfully', async () => {
  const uc = new ValidateConversationSessionEligibilityUseCase({ executionPlanRepository:{getExecutionPlanById:async()=>basePlan} as any, runtimeReadinessRepository:{readRuntimeReadinessBindingRecord:async()=>baseReadiness} as any, assetCompositionPlanRepository: { readAssetCompositionPlanRecord: async () => baseComposition } as any, eligibilityService:new ConversationalExecutionPlanEligibilityService(), sourceVerificationService:new ConversationalSourceSystemVerificationService() });
  const result = await uc.execute({ workspaceId, sourceExecutionPlanId: 'execution.plan.1' });
  assert.equal(result.status, 'eligible');
  assert.equal(result.turnInvocation, 'ready');
});

test('approves session without creating run/turn/message', async () => {
  const session:any = { id:'conversation.session.1', workspaceId, sourceExecutionPlanId:'execution.plan.1', sourceCompositionPlanId:'composition.plan.1', sourceRuntimeReadinessBindingId:'readiness.binding.1', status:'awaiting-approval', systemLabel:'Chat', turnIds:[], blockers:[], diagnostics:[], provenance:[], createdAt:'2026-05-22T00:00:00.000Z', updatedAt:'2026-05-22T00:00:00.000Z' };
  const approvals:any[]=[];
  const uc = new ApproveConversationSessionUseCase({ sessionRepository:{getConversationSessionById:async()=>session, updateConversationSession:async(r:any)=>r} as any, approvalRepository:{saveExecutionApproval:async(r:any)=>(approvals.push(r),r)} as any, executionPlanRepository:{getExecutionPlanById:async()=>basePlan} as any, runtimeReadinessRepository:{readRuntimeReadinessBindingRecord:async()=>baseReadiness} as any, assetCompositionPlanRepository: { readAssetCompositionPlanRecord: async () => baseComposition } as any, eligibilityService:new ConversationalExecutionPlanEligibilityService(), sourceVerificationService:new ConversationalSourceSystemVerificationService(), nextApprovalId:()=> 'execution.approval.1', now:()=> '2026-05-22T00:00:00.000Z' });
  const result = await uc.execute({ workspaceId, conversationSessionId:'conversation.session.1', approvalId:'execution.approval.1' } as any);
  assert.equal(result.kind, 'success');
  assert.equal(approvals[0].approvalKind, 'conversation-session-execution');
});

test('turn eligibility reflects ready invocation after approval validity passes', async () => {
  const session:any = { id:'conversation.session.1', workspaceId, sourceExecutionPlanId:'execution.plan.1', status:'approved', executionApprovalId:'execution.approval.1' };
  const approval:any = { id:'execution.approval.1', approvalStatus:'granted' };
  const uc = new ValidateConversationTurnEligibilityUseCase({ sessionRepository:{getConversationSessionById:async()=>session} as any, approvalRepository:{getExecutionApprovalById:async()=>approval} as any, approvalValidityService:new ConversationSessionApprovalValidityService() });
  const result = await uc.execute({ workspaceId, conversationSessionId:'conversation.session.1' });
  assert.equal(result.eligible, true);
  assert.equal(result.invocation, 'ready');
});
