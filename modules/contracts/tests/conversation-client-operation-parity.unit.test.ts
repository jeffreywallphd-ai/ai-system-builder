import { describe, expect, it, testDouble } from '../../testing/node-test';
import { createDesktopConversationExecutionClient } from '../../../apps/desktop/src/renderer/features/conversations/api/desktopConversationExecutionClient';
import { createThinClientConversationExecutionClient } from '../../../apps/thin-client/src/features/conversations/api/thinClientConversationExecutionClient';

const coreOperations = [
  'createConversationSessionFromPlan',
  'approveConversationSession',
  'listConversationSessions',
  'readConversationSession',
  'readConversationTranscript',
  'readConversationTurnActivity',
  'submitConversationTurn',
  'cancelConversationTurn',
  'retryConversationTurn',
  'readCapabilities',
] as const;
const emptyStorage = { getItem: () => null, setItem: () => undefined, removeItem: () => undefined };

describe('conversation client semantic parity', () => {
  it('exposes the same core conceptual operations without raw runtime access', () => {
    const desktop = Object.keys(createDesktopConversationExecutionClient()).sort();
    const thin = Object.keys(createThinClientConversationExecutionClient()).sort();
    expect(desktop).toEqual([...coreOperations].sort());
    expect(thin).toEqual([...coreOperations].sort());
    expect(desktop).not.toContain('streamConversationTurn');
    expect(desktop).not.toContain('invokeRawRuntime');
    expect(thin).not.toContain('streamConversationTurn');
    expect(thin).not.toContain('invokeRawRuntime');
  });

  it('requires explicit workspace identity for both clients', async () => {
    const desktop = createDesktopConversationExecutionClient();
    const thin = createThinClientConversationExecutionClient();
    expect(await desktop.listConversationSessions({ workspaceId: '' })).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(await thin.listConversationSessions({ workspaceId: '' })).toMatchObject({ ok: false, error: { code: 'validation' } });
  });

  it('uses the same safe create-session input concept and excludes display claims', async () => {
    const desktopCreate = testDouble.fn<(input: { workspaceId: string; sourceExecutionPlanId: string }) => Promise<{ ok: true; value: Record<string, never> }>>(async () => ({ ok: true, value: {} }));
    Object.defineProperty(globalThis, 'window', { configurable: true, value: { desktopApi: { createConversationExecutionSessionFromPlan: desktopCreate } } });
    const desktop = createDesktopConversationExecutionClient();
    await desktop.createConversationSessionFromPlan({ workspaceId: 'ws.1', sourceExecutionPlanId: 'ep.1' });
    expect(desktopCreate.mock.calls[0]?.[0]).toEqual({ workspaceId: 'ws.1', sourceExecutionPlanId: 'ep.1' });

    const fetchStub = testDouble.fn<(url: string, init?: RequestInit) => Promise<{ json: () => Promise<{ ok: true; value: Record<string, never> }> }>>(async () => ({ json: async () => ({ ok: true, value: {} }) }));
    Object.defineProperty(globalThis, 'fetch', { configurable: true, value: fetchStub });
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: emptyStorage });
    const thin = createThinClientConversationExecutionClient('/api/conversations');
    await thin.createConversationSessionFromPlan({ workspaceId: 'ws.1', sourceExecutionPlanId: 'ep.1' });
    expect(JSON.parse(String(fetchStub.mock.calls[0]?.[1]?.body))).toEqual({ sourceExecutionPlanId: 'ep.1' });
  });

  it('preserves content only through transcript and submit result surfaces', async () => {
    const desktopTranscript = testDouble.fn(async () => ({ ok: true, value: { turns: [{ userMessage: { text: 'visible user text' } }] } }));
    const desktopSession = testDouble.fn(async () => ({ ok: true, value: { conversationSessionId: 's.1', sessionStatus: 'active' } }));
    Object.defineProperty(globalThis, 'window', { configurable: true, value: { desktopApi: { readConversationTranscript: desktopTranscript, readConversationSession: desktopSession } } });
    const desktop = createDesktopConversationExecutionClient();
    const transcript = await desktop.readConversationTranscript({ workspaceId: 'ws.1', conversationSessionId: 's.1' });
    const session = await desktop.readConversationSession({ workspaceId: 'ws.1', conversationSessionId: 's.1' });
    expect(JSON.stringify(transcript)).toContain('visible user text');
    expect(JSON.stringify(session)).not.toContain('visible user text');
  });

  it('exposes truthful host capability shape without claiming streaming/cancel/retry support', () => {
    const desktop = createDesktopConversationExecutionClient().readCapabilities();
    const thin = createThinClientConversationExecutionClient().readCapabilities();
    expect(desktop.submitTurn).toMatchObject({ transport: true, hostSupport: 'supported', streaming: false });
    expect(thin.submitTurn).toMatchObject({ transport: true, hostSupport: 'supported', streaming: false });
    expect(desktop.cancellation).toEqual({ supported: false, deferred: true });
    expect(thin.cancellation).toEqual({ supported: false, deferred: true });
    expect(desktop.retry).toEqual({ supported: false, deferred: true });
    expect(thin.retry).toEqual({ supported: false, deferred: true });
  });

  it('maps transport failures to safe client outcomes', async () => {
    Object.defineProperty(globalThis, 'window', { configurable: true, value: { desktopApi: {} } });
    const desktop = createDesktopConversationExecutionClient();
    expect(await desktop.submitConversationTurn({ workspaceId: 'ws.1', conversationSessionId: 's.1', text: 'hello', operationId: 'op.1' })).toMatchObject({ ok: false, error: { code: 'unavailable' } });
  });
});
