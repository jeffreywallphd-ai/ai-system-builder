import { normalizeApproveConversationSessionCommand, type ApproveConversationSessionCommand, type ApproveConversationSessionResult } from '../../../contracts/conversations';
import { normalizeExecutionApprovalId } from '../../../contracts/execution-runs';
import type { ExecutionPlanRecord } from '../../../contracts/execution-plans';
import type { RuntimeReadinessBinding } from '../../../contracts/runtime-readiness';
import type { ConversationSessionRepositoryPort } from '../../ports/conversations';
import type { ExecutionApprovalRepositoryPort, ExecutionRuntimeReferenceRepositoryPort } from '../../ports/execution-runs';
import type { ExecutionPlanRepositoryPort } from '../../ports/execution-plans';
import type { RuntimeReadinessBindingRepositoryPort } from '../../ports/runtime-readiness';
import type { AssetCompositionPlanRepositoryPort } from '../../ports/asset-composition';
import { conversationSessionFailure } from './conversation-session-result-helpers';
import { ConversationalExecutionPlanEligibilityService } from './conversational-execution-plan-eligibility.service';
import { ConversationalSourceSystemVerificationService } from './conversational-source-system-verification.service';

export class ApproveConversationSessionUseCase {
  public constructor(private readonly d:{sessionRepository:ConversationSessionRepositoryPort;approvalRepository:ExecutionApprovalRepositoryPort;executionRuntimeReferenceRepository?:ExecutionRuntimeReferenceRepositoryPort;executionPlanRepository:ExecutionPlanRepositoryPort;runtimeReadinessRepository:RuntimeReadinessBindingRepositoryPort;assetCompositionPlanRepository: AssetCompositionPlanRepositoryPort;eligibilityService:ConversationalExecutionPlanEligibilityService;sourceVerificationService:ConversationalSourceSystemVerificationService;nextApprovalId:()=>string;nextRuntimeReferenceId?:()=>string;now?:()=>string}){}
  public async execute(command: ApproveConversationSessionCommand): Promise<ApproveConversationSessionResult>{
    let c; try { c = normalizeApproveConversationSessionCommand(command); } catch { return conversationSessionFailure('validation','conversation-session-approval-input-invalid','Workspace, session, and approval identifiers are required.'); }
    const now=(this.d.now??(()=>new Date().toISOString()))();
    const session=await this.d.sessionRepository.getConversationSessionById(c.workspaceId as never,c.conversationSessionId as never); if(!session) return conversationSessionFailure('not-found','conversation-session-not-found','Conversation session was not found.');
    if (session.archivedAt || ['closed','stale','invalid','blocked'].includes(session.status)) return conversationSessionFailure('conflict','conversation-session-not-approvable','Conversation session is not approvable in its current state.');
    const plan=await this.d.executionPlanRepository.getExecutionPlanById(c.workspaceId as never,session.sourceExecutionPlanId as never); if(!plan) return conversationSessionFailure('not-found','source-execution-plan-not-found','Source execution plan was not found.');
    const pe=this.d.eligibilityService.evaluatePlan(plan); if(!pe.eligible) return conversationSessionFailure('conflict',pe.code!,pe.message!);
    const compositionPlan = await this.d.assetCompositionPlanRepository.readAssetCompositionPlanRecord(c.workspaceId as any, plan.sourceCompositionPlanId as any);
    const sv=this.d.sourceVerificationService.verify(plan, compositionPlan); if(!sv.ok) return conversationSessionFailure('conflict',sv.code,sv.message);
    const rb=await this.d.runtimeReadinessRepository.readRuntimeReadinessBindingRecord(c.workspaceId as never,plan.sourceRuntimeReadinessBindingId as never); const re=this.d.eligibilityService.evaluateReadiness(rb, c.workspaceId, plan.sourceCompositionPlanId); if(!re.eligible) return conversationSessionFailure('runtime-not-ready',re.code!,re.message!);
    const runtimeReferenceId = session.runtimeReferenceId ?? await this.createRuntimeReference(c.workspaceId, plan, rb, now);
    const approvalId=normalizeExecutionApprovalId(this.d.nextApprovalId());
    await this.d.approvalRepository.saveExecutionApproval({id:approvalId,workspaceId:c.workspaceId,sourceExecutionPlanId:plan.id,conversationSessionId:session.id,approvalKind:'conversation-session-execution',approvalStatus:'granted',label:'Conversation Session Approval',runtimeReferenceId:runtimeReferenceId as never,sourcePlanRevision:plan.updatedAt,sourceReadinessRevision:rb?.updatedAt,createdAt:now,updatedAt:now,grantedAt:now,provenance:[{at:now,kind:'execution-run-approval-requested'}],blockers:[],diagnostics:[]});
    const updated = await this.d.sessionRepository.updateConversationSession({...session,status:'approved',executionApprovalId:approvalId,executionApprovalStatus:'granted',runtimeReferenceId:runtimeReferenceId as never,updatedAt:now,provenance:[...session.provenance,{at:now,kind:'conversation-session-approved',actorId:'application'}]});
    return {kind:'success',value:updated};
  }

  private async createRuntimeReference(workspaceId:string, plan: ExecutionPlanRecord, _readiness: RuntimeReadinessBinding | undefined, _now:string) {
    if (!this.d.executionRuntimeReferenceRepository || !this.d.nextRuntimeReferenceId) return undefined;
    const adapterReference = plan.adapterReferences.find((ref) => ref.capabilityKind === 'text-generation' || ref.kind === 'provider-capability') ?? plan.adapterReferences[0];
    const runtimeKind = 'python-sidecar';
    const id = this.d.nextRuntimeReferenceId();
    await this.d.executionRuntimeReferenceRepository.saveExecutionRuntimeReference({ id: id as never, workspaceId, sourceExecutionPlanAdapterReferenceId: adapterReference?.id ?? 'epar.unavailable', sourceRuntimeReadinessBindingId: plan.sourceRuntimeReadinessBindingId, capabilityKind: 'text-generation', runtimeKind, label: 'Approved conversation runtime', status: 'supported', blockers: [], diagnostics: [] });
    return id;
  }
}
