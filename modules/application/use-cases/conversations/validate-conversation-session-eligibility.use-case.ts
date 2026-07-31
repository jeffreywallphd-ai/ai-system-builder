import { normalizeCreateConversationSessionCommand, type CreateConversationSessionCommand } from '../../../contracts/conversations';
import type { ExecutionPlanRepositoryPort } from '../../ports/execution-plans';
import type { RuntimeReadinessBindingRepositoryPort } from '../../ports/runtime-readiness';
import type { AssetCompositionPlanRepositoryPort } from '../../ports/asset-composition';
import { ConversationalExecutionPlanEligibilityService } from './conversational-execution-plan-eligibility.service';
import { ConversationalSourceSystemVerificationService } from './conversational-source-system-verification.service';

export class ValidateConversationSessionEligibilityUseCase {
  public constructor(private readonly d: { executionPlanRepository: ExecutionPlanRepositoryPort; runtimeReadinessRepository: RuntimeReadinessBindingRepositoryPort; assetCompositionPlanRepository: AssetCompositionPlanRepositoryPort; eligibilityService: ConversationalExecutionPlanEligibilityService; sourceVerificationService: ConversationalSourceSystemVerificationService }) {}
  public async execute(command: Pick<CreateConversationSessionCommand, 'workspaceId' | 'sourceExecutionPlanId'>) {
    const c = normalizeCreateConversationSessionCommand(command);
    const plan = await this.d.executionPlanRepository.getExecutionPlanById(c.workspaceId as never, c.sourceExecutionPlanId as never);
    if (!plan) return { status: 'ineligible', reason: 'source-execution-plan-not-found', sessionCreationPermitted: false, approvalPermitted: false, turnInvocation: 'deferred' };
    const p = this.d.eligibilityService.evaluatePlan(plan); if (!p.eligible) return { status: 'ineligible', reason: p.code, sessionCreationPermitted: false, approvalPermitted: false, turnInvocation: 'deferred' };
    const compositionPlan = await this.d.assetCompositionPlanRepository.readAssetCompositionPlanRecord(c.workspaceId as any, plan.sourceCompositionPlanId as any);
    const s = this.d.sourceVerificationService.verify(plan, compositionPlan); if (!s.ok) return { status: 'ineligible', reason: s.code, sessionCreationPermitted: false, approvalPermitted: false, turnInvocation: 'deferred' };
    const r = await this.d.runtimeReadinessRepository.readRuntimeReadinessBindingRecord(c.workspaceId as never, plan.sourceRuntimeReadinessBindingId as never);
    const re = this.d.eligibilityService.evaluateReadiness(r, c.workspaceId, plan.sourceCompositionPlanId); if (!re.eligible) return { status: 'ineligible', reason: re.code, sessionCreationPermitted: false, approvalPermitted: false, turnInvocation: 'deferred' };
    return { status: 'eligible', reason: 'eligible-for-session', sessionCreationPermitted: true, approvalPermitted: true, turnInvocation: 'ready' };
  }
}
