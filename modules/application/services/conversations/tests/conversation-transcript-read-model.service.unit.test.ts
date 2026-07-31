import test from 'node:test';
import assert from 'node:assert/strict';
import { ConversationTranscriptReadModelService } from '../conversation-transcript-read-model.service';

test('projects ordered transcript and returns degraded state on succeeded turn without response', async () => {
  const svc = new ConversationTranscriptReadModelService(
    { listConversationTurnsBySession: async () => [{ id: 't.2', sequence: 2, status: 'succeeded', conversationSessionId: 's.1', createdAt: '2', updatedAt: '2' }, { id: 't.1', sequence: 1, status: 'submitted', conversationSessionId: 's.1', createdAt: '1', updatedAt: '1' }] } as never,
    { listConversationMessagesByTurn: async (_w, turnId) => [{ id: `m.${turnId}`, role: 'user', text: `u.${turnId}`, createdAt: '1' }] } as never,
    { listAssistantResponsesByTurn: async () => [] } as never,
  );
  const result = await svc.readTranscript({ workspaceId: 'ws.1', conversationSessionId: 's.1' });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.turns[0]?.turnId, 't.1');
  assert.equal(result.turns[1]?.degraded?.code, 'response-unavailable');
});
