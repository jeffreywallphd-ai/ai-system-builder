import test from 'node:test';
import assert from 'node:assert/strict';
import { CancelConversationTurnUseCase } from '../cancel-conversation-turn.use-case';
import { RetryConversationTurnUseCase } from '../retry-conversation-turn.use-case';
import { ConversationTurnFailureClassificationService } from '../conversation-turn-failure-classification.service';

test('cancel returns not-supported truthfully for existing run', async () => {
  const operations = new Map<string, any>();
  const uc = new CancelConversationTurnUseCase({
    turnRepository: { getConversationTurnById: async () => ({ id: 't1', conversationSessionId: 's1', executionRunId: 'r1' }) } as any,
    executionRunRepository: { getExecutionRunById: async () => ({ id: 'r1', status: 'running' }) } as any,
    operationRepository: { getConversationOperationById: async (w: string, s: string, o: string) => operations.get(`${w}:${s}:${o}`), saveConversationOperation: async (r: any) => (operations.set(`${r.workspaceId}:${r.conversationSessionId}:${r.operationId}`, r), r) } as any,
  });
  const result = await uc.execute({ workspaceId: 'w1', conversationTurnId: 't1', conversationSessionId: 's1', operationId: 'op1' });
  assert.equal(result.kind, 'success');
  if (result.kind === 'success') assert.equal(result.value.status, 'not-supported');
});

test('retry blocks non retryable turn status', async () => {
  const operations = new Map<string, any>();
  const uc = new RetryConversationTurnUseCase({ turnRepository: { getConversationTurnById: async () => ({ id: 't1', conversationSessionId: 's1', status: 'succeeded' }) } as any, operationRepository: { getConversationOperationById: async (w: string, s: string, o: string) => operations.get(`${w}:${s}:${o}`), saveConversationOperation: async (r: any) => (operations.set(`${r.workspaceId}:${r.conversationSessionId}:${r.operationId}`, r), r) } as any, submitUseCase: {} as any });
  const result = await uc.execute({ workspaceId: 'w1', conversationTurnId: 't1', conversationSessionId: 's1', operationId: 'op1' });
  assert.equal(result.kind, 'failure');
});

test('retry returns not-supported truthfully and is idempotent by operation id', async () => {
  const operations = new Map<string, any>();
  const uc = new RetryConversationTurnUseCase({
    turnRepository: { getConversationTurnById: async () => ({ id: 't1', conversationSessionId: 's1', status: 'failed' }) } as any,
    operationRepository: { getConversationOperationById: async (w: string, s: string, o: string) => operations.get(`${w}:${s}:${o}`), saveConversationOperation: async (r: any) => (operations.set(`${r.workspaceId}:${r.conversationSessionId}:${r.operationId}`, r), r) } as any,
    submitUseCase: {} as any,
  });
  const first = await uc.execute({ workspaceId: 'w1', conversationTurnId: 't1', conversationSessionId: 's1', operationId: 'op2' });
  const second = await uc.execute({ workspaceId: 'w1', conversationTurnId: 't1', conversationSessionId: 's1', operationId: 'op2' });
  assert.equal(first.kind, 'success');
  assert.equal(second.kind, 'success');
  if (first.kind === 'success') assert.equal(first.value.status, 'not-supported');
});

test('failure classification maps orchestration outcomes safely', () => {
  const svc = new ConversationTurnFailureClassificationService();
  assert.equal(svc.classify('timed-out'), 'invocation-timed-out');
  assert.equal(svc.classify('blocked'), 'runtime-readiness-not-acceptable');
  assert.equal(svc.classify('unsupported'), 'runtime-unsupported');
});
