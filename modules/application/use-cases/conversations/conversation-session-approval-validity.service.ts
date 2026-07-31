import type { ConversationSessionRecord } from '../../../contracts/conversations';
import type { ExecutionApprovalRecord } from '../../../contracts/execution-runs';
import type { ExecutionPlanRepositoryPort } from '../../ports/execution-plans';
import type { RuntimeReadinessBindingRepositoryPort } from '../../ports/runtime-readiness';
import type { AssetCompositionPlanRepositoryPort } from '../../ports/asset-composition';
import { ConversationalExecutionPlanEligibilityService } from './conversational-execution-plan-eligibility.service';
import { ConversationalSourceSystemVerificationService } from './conversational-source-system-verification.service';

export class ConversationSessionApprovalValidityService {
  public constructor(private readonly d?: { executionPlanRepository: ExecutionPlanRepositoryPort; runtimeReadinessRepository: RuntimeReadinessBindingRepositoryPort; assetCompositionPlanRepository: AssetCompositionPlanRepositoryPort; eligibilityService: ConversationalExecutionPlanEligibilityService; sourceVerificationService: ConversationalSourceSystemVerificationService }) {}
  public isValid(session: ConversationSessionRecord, approval?: ExecutionApprovalRecord) {
    if (session.status !== 'approved' && session.status !== 'active') return { valid: false, reason: 'approval-required' };
    if (!approval || approval.approvalStatus !== 'granted' || approval.invalidatedAt) return { valid: false, reason: 'approval-invalidated' };
    if (session.executionApprovalId && approval.id !== session.executionApprovalId) return { valid: false, reason: 'approval-invalidated' };
    if (approval.runtimeReferenceId && session.runtimeReferenceId && approval.runtimeReferenceId !== session.runtimeReferenceId) return { valid: false, reason: 'approval-invalidated' };
    return { valid: true as const };
  }

  public async isValidForInvocation(session: ConversationSessionRecord, approval: ExecutionApprovalRecord | undefined) {
    const base = this.isValid(session, approval);
    if (!base.valid) return base;
    if (!this.d) return base;
    const plan = await this.d.executionPlanRepository.getExecutionPlanById(session.workspaceId as any, session.sourceExecutionPlanId as any);
    if (!plan) return { valid: false as const, reason: 'source-plan-not-ready' };
    if (approval?.sourcePlanRevision && approval.sourcePlanRevision !== plan.updatedAt) return { valid: false as const, reason: 'source-plan-stale' };
    const planEligibility = this.d.eligibilityService.evaluatePlan(plan);
    if (!planEligibility.eligible) return { valid: false as const, reason: 'source-plan-not-ready' };
    const composition = await this.d.assetCompositionPlanRepository.readAssetCompositionPlanRecord(session.workspaceId as any, plan.sourceCompositionPlanId as any);
    const source = this.d.sourceVerificationService.verify(plan, composition);
    if (!source.ok) return { valid: false as const, reason: 'source-plan-stale' };
    const readiness = await this.d.runtimeReadinessRepository.readRuntimeReadinessBindingRecord(session.workspaceId as any, plan.sourceRuntimeReadinessBindingId as any);
    if (approval?.sourceReadinessRevision && readiness?.updatedAt && approval.sourceReadinessRevision !== readiness.updatedAt) return { valid: false as const, reason: 'runtime-readiness-not-acceptable' };
    const readinessEligibility = this.d.eligibilityService.evaluateReadiness(readiness, session.workspaceId, plan.sourceCompositionPlanId);
    if (!readinessEligibility.eligible) return { valid: false as const, reason: 'runtime-readiness-not-acceptable' };
    return { valid: true as const };
  }
}
