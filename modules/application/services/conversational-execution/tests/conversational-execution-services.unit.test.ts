import test from 'node:test';
import assert from 'node:assert/strict';
import { ConversationSessionApprovalValidityService } from '../../../use-cases/conversations';
import { ConversationTurnInvocationOrchestratorService, ConversationalInvocationContextValidationService, ConversationalRuntimeAdapterSelectionService, ConversationalRuntimeGuardService } from '../index';

test('adapter selection returns deferred when unsupported', async () => {
  const svc = new ConversationalRuntimeAdapterSelectionService({ resolveForRuntime: async () => ({ status: 'deferred' }) });
  const result = await svc.select({ runtimeId: 'r1', capabilityKind: 'text-generation' });
  assert.equal(result.status, 'deferred');
});

<<<<<<< ours
test('context validation allows technical text while enforcing structural bounds', () => {
  const svc = new ConversationalInvocationContextValidationService();
  const ok = svc.validate({ conversationSessionId: 's1', userTurnContent: 'Show me a curl example with a bearer token placeholder and JSON payload.', history: [] });
  assert.equal(ok.valid, true);
  const bad = svc.validate({ conversationSessionId: 's1', userTurnContent: 'hello', history: new Array(51).fill({ role: 'user', content: 'x' }) as any });
=======
test('context validation blocks unsafe tokens and allows technical text', () => {
  const svc = new ConversationalInvocationContextValidationService();
  const ok = svc.validate({ conversationSessionId: 's1', userTurnContent: 'Explain runtime failures conceptually, do not include sensitive values.', history: [] });
  assert.equal(ok.valid, true);
  const bad = svc.validate({ conversationSessionId: 's1', userTurnContent: 'api_key=secret', history: [] });
>>>>>>> theirs
  assert.equal(bad.valid, false);
});

test('runtime guard allows ready only', async () => {
  const svc = new ConversationalRuntimeGuardService({ getRuntimeStatus: async () => 'ready' });
  const can = await svc.canInvoke('adapter.1');
  assert.equal(can.allowed, true);
});

test('orchestrator returns deferred when no adapter exists', async () => {
  let invoked = false;
  const orch = new ConversationTurnInvocationOrchestratorService({
    approvalValidityService: new ConversationSessionApprovalValidityService(),
    adapterSelectionService: new ConversationalRuntimeAdapterSelectionService({ resolveForRuntime: async () => ({ status: 'deferred' }) }),
    runtimeGuardService: new ConversationalRuntimeGuardService({ getRuntimeStatus: async () => 'ready' }),
    contextPort: { prepareProtectedInvocationContext: async () => ({ conversationSessionId: 's1', userTurnContent: 'hello' }) },
    contextValidationService: new ConversationalInvocationContextValidationService(),
    invocationPort: { invokeConversationTurn: async () => (invoked = true, { status: 'completed', assistantResponseText: 'ok' }) },
  });
<<<<<<< ours
  const result = await orch.invoke({ workspaceId: 'w1', session: { id: 's1', status: 'approved', executionApprovalId: 'a1' }, approval: { id: 'a1', approvalStatus: 'granted' }, runtime: { runtimeId: 'r1', capabilityKind: 'text-generation' }, userTurnContent: 'hello' });
=======
  const result = await orch.invoke({ workspaceId: 'w1', session: { id: 's1', status: 'approved', executionApprovalId: 'a1' }, approval: { approvalStatus: 'approved' }, runtime: { runtimeId: 'r1', capabilityKind: 'text-generation' }, userTurnContent: 'hello' });
>>>>>>> theirs
  assert.equal(result.status, 'deferred');
  assert.equal(invoked, false);
});

test('orchestrator invokes exactly once on valid supported happy path', async () => {
  let count = 0;
  const orch = new ConversationTurnInvocationOrchestratorService({
    approvalValidityService: new ConversationSessionApprovalValidityService(),
    adapterSelectionService: new ConversationalRuntimeAdapterSelectionService({ resolveForRuntime: async () => ({ status: 'supported', adapterId: 'adapter.1', capabilityKind: 'text-generation', capabilities: { progress: false, cancellation: false } }) }),
    runtimeGuardService: new ConversationalRuntimeGuardService({ getRuntimeStatus: async () => 'ready' }),
    contextPort: { prepareProtectedInvocationContext: async () => ({ conversationSessionId: 's1', userTurnContent: 'hello', systemInstruction: 'be brief' }) },
    contextValidationService: new ConversationalInvocationContextValidationService(),
    invocationPort: { invokeConversationTurn: async () => (count++, { status: 'completed', assistantResponseText: 'safe response' }) },
  });
<<<<<<< ours
  const result = await orch.invoke({ workspaceId: 'w1', session: { id: 's1', status: 'approved', executionApprovalId: 'a1' }, approval: { id: 'a1', approvalStatus: 'granted' }, runtime: { runtimeId: 'r1', capabilityKind: 'text-generation' }, userTurnContent: 'hello' });
=======
  const result = await orch.invoke({ workspaceId: 'w1', session: { id: 's1', status: 'approved', executionApprovalId: 'a1' }, approval: { approvalStatus: 'approved' }, runtime: { runtimeId: 'r1', capabilityKind: 'text-generation' }, userTurnContent: 'hello' });
>>>>>>> theirs
  assert.equal(result.status, 'completed');
  assert.equal(count, 1);
});
