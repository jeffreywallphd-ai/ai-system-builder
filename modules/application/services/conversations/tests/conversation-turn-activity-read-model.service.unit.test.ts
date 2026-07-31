import test from 'node:test';
import assert from 'node:assert/strict';
import { ConversationTurnActivityReadModelService } from '../conversation-turn-activity-read-model.service';

test('activity view allowlists event kinds and keeps retry/cancel truthful', async () => {
  const svc = new ConversationTurnActivityReadModelService(
    { getConversationTurnById: async () => ({ id: 't.1', conversationSessionId: 's.1', executionRunId: 'r.1', status: 'failed', createdAt: '1', updatedAt: '2' }) } as never,
    { listAssistantResponsesByTurn: async () => [] } as never,
    { getExecutionRunById: async () => ({ id: 'r.1', status: 'failed', diagnostics: [{ code: 'runtime-unavailable' }], progress: { phase: 'failed' } }) } as never,
    { getLatestExecutionAttemptForRun: async () => undefined } as never,
    { listExecutionEventsByRun: async () => ({ events: [{ kind: 'run-failed', at: '2' }, { kind: 'progress-updated', at: '2' }] }) } as never,
  );
  const result = await svc.readActivity({ workspaceId: 'ws.1', conversationSessionId: 's.1', conversationTurnId: 't.1' });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.events.length, 1);
  assert.equal(result.cancellation.available, false);
  assert.equal(result.retry.deferred, true);
});
