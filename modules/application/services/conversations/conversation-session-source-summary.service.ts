import type { ConversationSessionRecord } from '../../../contracts/conversations';
import type { AssetCompositionPlan } from '../../../contracts/asset-composition';
import type { ExecutionPlanRepositoryPort } from '../../ports/execution-plans';
import type { AssetCompositionPlanRepositoryPort } from '../../ports/asset-composition';
import { ConversationalSourceSystemVerificationService } from '../../use-cases/conversations';
import type { ConversationSystemSourceSummaryReadModel } from './conversation-read-model-types';

const customizedSourceKinds = new Set(['workspace-customized', 'linked-with-workspace-override', 'copied-with-workspace-override', 'imported-with-workspace-override', 'system-derived-override']);
const reusableSourceKinds = new Set(['system-foundation', 'user-library-linked', 'user-library-copied', 'workspace-imported', 'workspace-authored', 'workspace-authored-revision', 'workspace-local']);

export class ConversationSessionSourceSummaryService {
  public constructor(private readonly d?: { executionPlanRepository: ExecutionPlanRepositoryPort; assetCompositionPlanRepository: AssetCompositionPlanRepositoryPort; sourceVerificationService: ConversationalSourceSystemVerificationService }) {}

  async summarize(session: ConversationSessionRecord): Promise<ConversationSystemSourceSummaryReadModel> {
    const base = { systemLabel: session.systemLabel, sourceExecutionPlanId: session.sourceExecutionPlanId, sourceCompositionPlanId: session.sourceCompositionPlanId, sourceRuntimeReadinessBindingId: session.sourceRuntimeReadinessBindingId };
    if (!this.d) return { ...base, basedOnReusableConversationalSystem: false, sourceKind: 'unavailable', summary: 'Conversational source summary is unavailable.' };
    const plan = await this.d.executionPlanRepository.getExecutionPlanById(session.workspaceId as never, session.sourceExecutionPlanId as never);
    if (!plan) return { ...base, basedOnReusableConversationalSystem: false, sourceKind: 'invalidated-or-blocked-source', summary: 'Source execution plan is unavailable or no longer valid.' };
    const composition = await this.d.assetCompositionPlanRepository.readAssetCompositionPlanRecord(session.workspaceId as never, plan.sourceCompositionPlanId as never);
    const verification = this.d.sourceVerificationService.verify(plan, composition);
    if (!verification.ok) return { ...base, basedOnReusableConversationalSystem: false, sourceKind: 'invalidated-or-blocked-source', summary: verification.message };
    const sourceKind = classifyComposition(composition);
    const label = safeLabel(composition?.name) ?? session.systemLabel;
    if (sourceKind === 'customized') return { ...base, systemLabel: label, basedOnReusableConversationalSystem: true, sourceKind: 'verified-customized-conversational-system', summary: 'Customized from a verified reusable conversational system.' };
    if (sourceKind === 'reusable') return { ...base, systemLabel: label, basedOnReusableConversationalSystem: true, sourceKind: 'verified-reusable-conversational-system', summary: 'Verified reusable conversational system.' };
    return { ...base, systemLabel: label, basedOnReusableConversationalSystem: true, sourceKind: 'verified-conversational-source', summary: 'Verified conversational execution source.' };
  }
}

function classifyComposition(composition?: AssetCompositionPlan): 'customized'|'reusable'|'verified' {
  const sourceKinds = [
    ...(composition?.selectedProjections ?? []).map((p) => p.projectionSourceKind),
    ...(composition?.nodes ?? []).map((n) => n.selectedProjection.projectionSourceKind),
  ].filter((v) => typeof v === 'string') as string[];
  if (sourceKinds.some((kind) => customizedSourceKinds.has(kind))) return 'customized';
  if (sourceKinds.some((kind) => reusableSourceKinds.has(kind))) return 'reusable';
  return 'verified';
}

function safeLabel(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 240) : undefined;
}
