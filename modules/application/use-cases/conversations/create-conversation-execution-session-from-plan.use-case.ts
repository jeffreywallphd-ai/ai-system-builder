import { normalizeCreateConversationSessionCommand, normalizeConversationSessionId, normalizeConversationSessionRecord, type ConversationSessionId, type CreateConversationSessionCommand, type CreateConversationSessionResult } from '../../../contracts/conversations';
import type { ConversationSessionRepositoryPort } from '../../ports/conversations';
import type { ExecutionPlanRepositoryPort } from '../../ports/execution-plans';
import type { RuntimeReadinessBindingRepositoryPort } from '../../ports/runtime-readiness';
import type { AssetCompositionPlanRepositoryPort } from '../../ports/asset-composition';
import { conversationSessionFailure } from './conversation-session-result-helpers';
import { ConversationalExecutionPlanEligibilityService } from './conversational-execution-plan-eligibility.service';
import { ConversationalSourceSystemVerificationService } from './conversational-source-system-verification.service';

export class CreateConversationExecutionSessionFromPlanUseCase {
  public constructor(private readonly d: { sessionRepository: ConversationSessionRepositoryPort; executionPlanRepository: ExecutionPlanRepositoryPort; runtimeReadinessRepository: RuntimeReadinessBindingRepositoryPort; assetCompositionPlanRepository: AssetCompositionPlanRepositoryPort; eligibilityService: ConversationalExecutionPlanEligibilityService; sourceVerificationService: ConversationalSourceSystemVerificationService; nextConversationSessionId: () => ConversationSessionId | string; now?: () => string }) {}
  public async execute(command: CreateConversationSessionCommand): Promise<CreateConversationSessionResult> {
    let c: CreateConversationSessionCommand;
    try { c = normalizeCreateConversationSessionCommand(command); } catch { return conversationSessionFailure('validation', 'workspace-or-source-execution-plan-required', 'Workspace and source execution plan are required.'); }
    const now = (this.d.now ?? (() => new Date().toISOString()))();
    try {
      const plan = await this.d.executionPlanRepository.getExecutionPlanById(c.workspaceId as never, c.sourceExecutionPlanId as never);
      if (!plan) return conversationSessionFailure('not-found', 'source-execution-plan-not-found', 'Source execution plan was not found.');
      const planEligibility = this.d.eligibilityService.evaluatePlan(plan);
      if (!planEligibility.eligible) return conversationSessionFailure('conflict', planEligibility.code!, planEligibility.message!);
      const compositionPlan = await this.d.assetCompositionPlanRepository.readAssetCompositionPlanRecord(c.workspaceId as any, plan.sourceCompositionPlanId as any);
      const sourceVerification = this.d.sourceVerificationService.verify(plan, compositionPlan);
      if (!sourceVerification.ok) return conversationSessionFailure('conflict', sourceVerification.code, sourceVerification.message);
      const readiness = await this.d.runtimeReadinessRepository.readRuntimeReadinessBindingRecord(c.workspaceId as never, plan.sourceRuntimeReadinessBindingId as never);
      const readinessEligibility = this.d.eligibilityService.evaluateReadiness(readiness, c.workspaceId, plan.sourceCompositionPlanId);
      if (!readinessEligibility.eligible) return conversationSessionFailure('runtime-not-ready', readinessEligibility.code!, readinessEligibility.message!);
      const sessionId = normalizeConversationSessionId(this.d.nextConversationSessionId());
      const verifiedCompositionPlan = compositionPlan!;
      const session = normalizeConversationSessionRecord({ id: sessionId, workspaceId: c.workspaceId, sourceExecutionPlanId: plan.id, sourceCompositionPlanId: plan.sourceCompositionPlanId, sourceRuntimeReadinessBindingId: plan.sourceRuntimeReadinessBindingId, status: 'awaiting-approval', systemLabel: verifiedCompositionPlan.name || plan.steps.find((s) => s.kind === 'generate-text')?.label || 'Conversational Session', systemSummary: verifiedCompositionPlan.description, turnIds: [], blockers: [], diagnostics: [], provenance: [{ at: now, kind: 'conversation-session-created', actorId: 'application' }], createdAt: now, updatedAt: now });
      return { kind: 'success', value: await this.d.sessionRepository.saveConversationSession(session) };
    } catch {
      return conversationSessionFailure('internal', 'conversation-session-service-unavailable', 'Conversation session service is unavailable.');
    }
  }
}
