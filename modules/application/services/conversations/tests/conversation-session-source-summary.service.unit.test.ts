import test from 'node:test';
import assert from 'node:assert/strict';
import { ConversationSessionSourceSummaryService } from '../conversation-session-source-summary.service';

const session = {
  id: 'conversation.session.1',
  workspaceId: 'workspace.1',
  sourceExecutionPlanId: 'execution.plan.1',
  sourceCompositionPlanId: 'composition.plan.1',
  status: 'active',
  systemLabel: 'Stored Label',
  turnIds: [],
  blockers: [],
  diagnostics: [],
  provenance: [],
  createdAt: '2026-05-22T00:00:00.000Z',
  updatedAt: '2026-05-22T00:00:00.000Z',
};

const plan = {
  id: 'execution.plan.1',
  workspaceId: 'workspace.1',
  sourceCompositionPlanId: 'composition.plan.1',
  sourceRuntimeReadinessBindingId: 'runtime.readiness.binding.1',
  adapterReferences: [{ capabilityKind: 'text-generation' }],
  steps: [],
};

function composition(projectionSourceKind: string, status = 'ready') {
  return {
    planId: 'composition.plan.1',
    targetWorkspaceId: 'workspace.1',
    name: 'Verified Conversation System',
    description: 'Safe display summary',
    status,
    selectedProjections: [{ targetWorkspaceId: 'workspace.1', projectionId: 'projection.1', projectionSourceKind }],
    nodes: [{
      nodeId: 'node.1',
      targetWorkspaceId: 'workspace.1',
      selectedProjection: { targetWorkspaceId: 'workspace.1', projectionId: 'projection.1', projectionSourceKind },
      role: 'ui-surface',
      status: 'compatible',
      requiredCapabilities: [],
      providedCapabilities: [{ kind: 'text-output' }],
      diagnostics: [],
      blockers: [],
      createdAt: '2026-05-22T00:00:00.000Z',
      updatedAt: '2026-05-22T00:00:00.000Z',
    }],
    relationships: [],
    compatibilityDiagnostics: [],
    blockers: [],
    planningSummary: { totalNodes: 1, compatibleNodeCount: 1, blockedNodeCount: 0, conflictedNodeCount: 0, missingDependencyCount: 0, staleProjectionCount: 0, unsupportedCount: 0, totalRelationships: 0, compatibleRelationshipCount: 0, blockedRelationshipCount: 0, planningReadiness: 'ready' },
    provenance: [],
    createdAt: '2026-05-22T00:00:00.000Z',
    updatedAt: '2026-05-22T00:00:00.000Z',
  };
}

function service(comp: unknown) {
  return new ConversationSessionSourceSummaryService({
    executionPlanRepository: { getExecutionPlanById: async () => plan },
    assetCompositionPlanRepository: { readAssetCompositionPlanRecord: async () => comp },
    sourceVerificationService: { verify: (executionPlan: unknown, compositionPlan: unknown) => {
      if (!compositionPlan) return { ok: false, code: 'missing', message: 'Source unavailable.' };
      const status = (compositionPlan as { status?: string }).status;
      if (status === 'stale') return { ok: false, code: 'stale', message: 'Source is stale.' };
      return { ok: true };
    } },
  } as never);
}

test('does not treat an arbitrary composition plan id as reusable conversational proof', async () => {
  const result = await service(undefined).summarize(session as never);
  assert.equal(result.basedOnReusableConversationalSystem, false);
  assert.equal(result.sourceKind, 'invalidated-or-blocked-source');
});

test('summarizes a verified reusable conversational system from structured evidence', async () => {
  const result = await service(composition('user-library-linked')).summarize({ ...session, systemLabel: 'Caller Claim' } as never);
  assert.equal(result.sourceKind, 'verified-reusable-conversational-system');
  assert.equal(result.basedOnReusableConversationalSystem, true);
  assert.equal(result.systemLabel, 'Verified Conversation System');
  assert.equal(result.summary, 'Verified reusable conversational system.');
});

test('summarizes a verified customized derivative without exposing internals', async () => {
  const result = await service(composition('workspace-customized')).summarize(session as never);
  assert.equal(result.sourceKind, 'verified-customized-conversational-system');
  assert.equal(result.summary, 'Customized from a verified reusable conversational system.');
  assert.doesNotMatch(JSON.stringify(result), /protected|instruction|prompt|provider|runtime/i);
});

test('stale source evidence does not claim runnable verified origin', async () => {
  const result = await service(composition('user-library-linked', 'stale')).summarize(session as never);
  assert.equal(result.basedOnReusableConversationalSystem, false);
  assert.equal(result.sourceKind, 'invalidated-or-blocked-source');
});
