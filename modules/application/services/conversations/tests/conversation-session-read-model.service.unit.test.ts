import test from 'node:test';
import assert from 'node:assert/strict';
import { ConversationSessionReadModelService } from '../conversation-session-read-model.service';

const baseSession = {
  id: 's.1',
  workspaceId: 'ws.1',
  systemLabel: 'Basic Conversational Assistant',
  sourceExecutionPlanId: 'ep.1',
  status: 'active',
  turnIds: ['t.1'],
  createdAt: '1',
  updatedAt: '2',
  executionApprovalId: 'a.1',
  executionApprovalStatus: 'granted',
  runtimeReferenceId: 'rr.1',
  provenance: [{ runtimeReferenceStatus: 'supported' }],
};

function service(overrides: {
  session?: Record<string, unknown>;
  latestTurn?: Record<string, unknown>;
  validity?: { valid: boolean; reason?: string };
  runtimeReference?: Record<string, unknown> | null;
  hostSubmit?: 'supported' | 'unsupported' | 'unavailable';
} = {}) {
  return new ConversationSessionReadModelService(
    { listConversationSessions: async () => ({ sessions: [{ ...baseSession, ...overrides.session }] }) } as never,
    { getLatestConversationTurnBySession: async () => overrides.latestTurn ?? { id: 't.1', updatedAt: '2', status: 'succeeded' } } as never,
    { listAssistantResponsesByTurn: async () => [{ status: 'completed' }] } as never,
    { getExecutionRunById: async () => undefined } as never,
    {
      approvalRepository: { getExecutionApprovalById: async () => ({ id: 'a.1', approvalStatus: 'approved' }) },
      runtimeReferenceRepository: { getExecutionRuntimeReferenceById: async () => overrides.runtimeReference === null ? undefined : overrides.runtimeReference ?? { id: 'rr.1', status: 'supported', capabilityKind: 'text-generation', runtimeKind: 'python-sidecar', selectedModelRecordId: 'model.chat.local' } },
      approvalValidityService: { isValidForInvocation: async () => overrides.validity ?? { valid: true } },
      hostCapabilities: { submitTurn: overrides.hostSubmit ?? 'supported', cancelTurn: 'unsupported', retryTurn: 'unsupported', streaming: false },
    } as never,
  );
}

test('lists safe session summaries without transcript content', async () => {
  const { items } = await service().listConversationSessions({ workspaceId: 'ws.1' });
  assert.equal(items.length, 1);
  assert.equal(items[0]?.actions.maySubmitMessage, true);
  assert.equal((items[0] as Record<string, unknown>).text, undefined);
});

test('stale source or approval validity disables message submission', async () => {
  const { items } = await service({ validity: { valid: false, reason: 'source-changed' } }).listConversationSessions({ workspaceId: 'ws.1' });
  assert.equal(items[0]?.actions.maySubmitMessage, false);
  assert.equal(items[0]?.availability.setupStatus, 'source-review-required');
});

test('runtime not ready disables message submission even when provenance says supported', async () => {
  const { items } = await service({ runtimeReference: null, session: { runtimeReferenceId: undefined } }).listConversationSessions({ workspaceId: 'ws.1' });
  assert.equal(items[0]?.actions.maySubmitMessage, false);
  assert.equal(items[0]?.runtimeStatus, 'unavailable');
  assert.equal(items[0]?.availability.blockerCode, 'conversation-runtime-reference-missing');
});

test('active turn blocks parallel message submission', async () => {
  const { items } = await service({ latestTurn: { id: 't.1', updatedAt: '2', status: 'generating' } }).listConversationSessions({ workspaceId: 'ws.1' });
  assert.equal(items[0]?.actions.maySubmitMessage, false);
  assert.equal(items[0]?.availability.blockerCode, 'conversation-turn-active');
});

test('unsupported host disables submission and does not expose cancel or retry as available', async () => {
  const { items } = await service({ hostSubmit: 'unsupported' }).listConversationSessions({ workspaceId: 'ws.1' });
  assert.equal(items[0]?.actions.maySubmitMessage, false);
  assert.equal(items[0]?.availability.hostSubmitSupport, 'unsupported');
  assert.equal(items[0]?.actions.mayCancel, false);
  assert.equal(items[0]?.actions.mayRetry, false);
});
