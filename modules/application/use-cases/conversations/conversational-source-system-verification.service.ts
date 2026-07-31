import type { ExecutionPlanRecord } from '../../../contracts/execution-plans';
import type { AssetCompositionPlan } from '../../../contracts/asset-composition';

export type ConversationalSourceVerification = { ok: true } | { ok: false; code: string; message: string };

export class ConversationalSourceSystemVerificationService {
  public verify(plan: ExecutionPlanRecord, compositionPlan?: AssetCompositionPlan): ConversationalSourceVerification {
    if (!plan.sourceCompositionPlanId) return { ok: false, code: 'conversational-source-system-missing', message: 'Source composition plan reference is missing.' };
    if (!compositionPlan) return { ok: false, code: 'source-composition-plan-not-found', message: 'Source composition plan was not found.' };
    if (compositionPlan.archivedAt || ['blocked', 'conflicted', 'stale', 'archived'].includes(compositionPlan.status)) {
      return { ok: false, code: 'source-composition-plan-not-eligible', message: 'Source composition plan is not eligible for conversational execution.' };
    }
    const hasConversationInterfaceNode = compositionPlan.nodes.some((node) =>
      node.role === 'ui-surface' && node.providedCapabilities.some((capability) => capability.kind === 'text-output' || capability.kind === 'text-input'),
    );
    if (!hasConversationInterfaceNode) return { ok: false, code: 'conversational-system-requirement-missing', message: 'Conversational interface composition evidence is missing.' };
    const hasTextRuntimeRequirement = plan.adapterReferences.some((ref) => ref.capabilityKind === 'text-generation' || ref.kind === 'provider-capability');
    if (!hasTextRuntimeRequirement) return { ok: false, code: 'text-generation-runtime-requirement-missing', message: 'Text-generation runtime requirement evidence is missing.' };
    return { ok: true };
  }
}
