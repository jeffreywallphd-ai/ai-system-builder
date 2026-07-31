import type { ExecutionPlanRecord } from '../../../contracts/execution-plans';
import type { RuntimeReadinessBinding } from '../../../contracts/runtime-readiness';

export type ConversationalEligibility = { eligible: true } | { eligible: false; code: string; message: string };

const blockedPlanStatuses = new Set(['stale','invalid','blocked','missing-inputs','missing-outputs','provider-setup-required','safety-review-required','archived']);
const blockedReadinessStatuses = new Set(['draft','missing-requirements','provider-unavailable','provider-unsupported','setup-required','permission-required','configuration-required','blocked','stale','invalid','archived']);

export class ConversationalExecutionPlanEligibilityService {
  public evaluatePlan(plan: ExecutionPlanRecord): ConversationalEligibility {
    if (plan.archivedAt || blockedPlanStatuses.has(plan.status)) return { eligible: false, code: 'source-execution-plan-not-ready', message: 'Source execution plan is not eligible.' };
    if (plan.status !== 'ready-for-review') return { eligible: false, code: 'source-execution-plan-not-ready', message: 'Source execution plan is not in ready-for-review status.' };
    const blockerCodes = new Set(plan.blockers.map((b) => b.code));
    if (blockerCodes.size > 0) return { eligible: false, code: 'source-execution-plan-blocked', message: 'Source execution plan has unresolved blockers.' };
    return { eligible: true };
  }

  public evaluateReadiness(readiness: RuntimeReadinessBinding | undefined, expectedWorkspaceId: string, expectedCompositionPlanId: string): ConversationalEligibility {
    if (!readiness) return { eligible: false, code: 'runtime-readiness-missing', message: 'Runtime readiness binding is missing.' };
    if (readiness.targetWorkspaceId !== expectedWorkspaceId) return { eligible: false, code: 'runtime-readiness-workspace-mismatch', message: 'Runtime readiness binding workspace does not match source plan workspace.' };
    if (readiness.compositionPlanId !== expectedCompositionPlanId) return { eligible: false, code: 'runtime-readiness-composition-mismatch', message: 'Runtime readiness binding does not match source composition plan.' };
    if (readiness.archivedAt || blockedReadinessStatuses.has(readiness.status)) return { eligible: false, code: 'runtime-readiness-not-ready', message: 'Runtime readiness binding is not eligible.' };
    if (readiness.blockers.length > 0) return { eligible: false, code: 'runtime-readiness-blocked', message: 'Runtime readiness binding has unresolved blockers.' };
    return { eligible: true };
  }
}
