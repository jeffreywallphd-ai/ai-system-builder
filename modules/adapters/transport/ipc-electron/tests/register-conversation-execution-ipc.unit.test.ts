import { describe, expect, it, testDouble } from '../../../../testing/node-test';
import {
  DESKTOP_CONVERSATION_EXECUTION_V2_CREATE_SESSION_REQUEST_CHANNEL,
  DESKTOP_CONVERSATION_EXECUTION_V2_LIST_SESSIONS_REQUEST_CHANNEL,
  DESKTOP_CONVERSATION_EXECUTION_V2_SUBMIT_TURN_REQUEST_CHANNEL,
} from '../../../../contracts/ipc';
import { registerConversationExecutionIpc } from '../conversations/registerConversationExecutionIpc';
import type { IpcMainHandleListener } from '../ipcMainHandlePort';

type Handler = IpcMainHandleListener<{ payload?: Record<string, unknown> }, unknown>;

function services() {
  return {
    create: { execute: testDouble.fn(async (input) => ({ kind: 'success', value: { id: 's.1', input } })) },
    approve: { execute: testDouble.fn(async (input) => ({ kind: 'success', value: { id: 's.1', input } })) },
    readSessions: {
      listConversationSessions: testDouble.fn(async () => ({ sessions: [] })),
      readDetail: testDouble.fn(async () => undefined),
    },
    readTranscript: { readTranscript: testDouble.fn(async () => ({ ok: true, turns: [] })) },
    readActivity: { readActivity: testDouble.fn(async () => ({ ok: true, events: [] })) },
    submitTurn: { execute: testDouble.fn(async () => ({ kind: 'success', value: { status: 'succeeded' } })) },
    cancelTurn: { execute: testDouble.fn(async () => ({ kind: 'success', value: { status: 'not-supported' } })) },
    retryTurn: { execute: testDouble.fn(async () => ({ kind: 'success', value: { status: 'not-supported', conversationTurnId: 't.1' } })) },
  };
}

describe('registerConversationExecutionIpc', () => {
  it('registers typed conversation execution channels', () => {
    const handlers = new Map<string, Handler>();
    registerConversationExecutionIpc({
      ipcMain: { handle: testDouble.fn((channel, handler) => handlers.set(channel, handler as Handler)) },
      conversations: services() as never,
    });
    expect([...handlers.keys()]).toContain(DESKTOP_CONVERSATION_EXECUTION_V2_CREATE_SESSION_REQUEST_CHANNEL.value);
    expect([...handlers.keys()]).toContain(DESKTOP_CONVERSATION_EXECUTION_V2_LIST_SESSIONS_REQUEST_CHANNEL.value);
    expect([...handlers.keys()]).toContain(DESKTOP_CONVERSATION_EXECUTION_V2_SUBMIT_TURN_REQUEST_CHANNEL.value);
  });

  it('uses the canonical session list read-model method', async () => {
    const handlers = new Map<string, Handler>();
    const conversations = services();
    registerConversationExecutionIpc({
      ipcMain: { handle: testDouble.fn((channel, handler) => handlers.set(channel, handler as Handler)) },
      conversations: conversations as never,
    });
    await handlers.get(DESKTOP_CONVERSATION_EXECUTION_V2_LIST_SESSIONS_REQUEST_CHANNEL.value)!(undefined, { payload: { workspaceId: 'ws.1' } });
    expect(conversations.readSessions.listConversationSessions).toHaveBeenCalledWith({ workspaceId: 'ws.1' });
  });

  it('rejects caller supplied source identity fields during session creation', async () => {
    const handlers = new Map<string, Handler>();
    const conversations = services();
    registerConversationExecutionIpc({
      ipcMain: { handle: testDouble.fn((channel, handler) => handlers.set(channel, handler as Handler)) },
      conversations: conversations as never,
    });
    const result = await handlers.get(DESKTOP_CONVERSATION_EXECUTION_V2_CREATE_SESSION_REQUEST_CHANNEL.value)!(undefined, {
      payload: { workspaceId: 'ws.1', sourceExecutionPlanId: 'ep.1', systemLabel: 'Injected', systemSummary: 'Injected' },
    });
    expect(result).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(conversations.create.execute).not.toHaveBeenCalled();
  });

  it('accepts submit turn visible text and operation identity only', async () => {
    const handlers = new Map<string, Handler>();
    const conversations = services();
    registerConversationExecutionIpc({
      ipcMain: { handle: testDouble.fn((channel, handler) => handlers.set(channel, handler as Handler)) },
      conversations: conversations as never,
    });
    await handlers.get(DESKTOP_CONVERSATION_EXECUTION_V2_SUBMIT_TURN_REQUEST_CHANNEL.value)!(undefined, {
      payload: { workspaceId: 'ws.1', conversationSessionId: 's.1', text: 'hello', operationId: 'op.1' },
    });
    expect(conversations.submitTurn.execute).toHaveBeenCalledWith({
      workspaceId: 'ws.1',
      conversationSessionId: 's.1',
      text: 'hello',
      operationId: 'op.1',
    });
  });
});
