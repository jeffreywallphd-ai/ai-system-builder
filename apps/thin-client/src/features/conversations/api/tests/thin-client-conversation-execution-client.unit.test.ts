import * as testing from '../../../../../../../modules/testing/node-test';
import { createThinClientConversationExecutionClient } from '../thinClientConversationExecutionClient';
const runtimeTesting = (testing as unknown as { default?: typeof testing }).default ?? testing;
const { describe, expect, it, testDouble } = runtimeTesting;
const emptyStorage = { getItem: () => null, setItem: () => undefined, removeItem: () => undefined };

describe('thinClientConversationExecutionClient', () => {
  it('encodes workspace and session route params', async () => {
    const fetchStub = testDouble.fn<(url: string, init?: RequestInit) => Promise<{ json: () => Promise<{ ok: true; value: Record<string, never> }> }>>(async () => ({ json: async () => ({ ok: true, value: {} }) }));
    Object.defineProperty(globalThis, 'fetch', { configurable: true, value: fetchStub });
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: emptyStorage });
    const client = createThinClientConversationExecutionClient('/api/conversations');
    await client.readConversationSession({ workspaceId: 'workspace/a', conversationSessionId: 'session/b' });
    expect(String(fetchStub.mock.calls[0]?.[0])).toContain('workspace%2Fa');
    expect(String(fetchStub.mock.calls[0]?.[0])).toContain('session%2Fb');
  });

  it('sends only safe submit-turn body fields', async () => {
    const fetchStub = testDouble.fn<(url: string, init?: RequestInit) => Promise<{ json: () => Promise<{ ok: true; value: Record<string, never> }>; init?: RequestInit }>>(async (_url: string, init?: RequestInit) => ({ json: async () => ({ ok: true, value: {} }), init }));
    Object.defineProperty(globalThis, 'fetch', { configurable: true, value: fetchStub });
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: emptyStorage });
    const client = createThinClientConversationExecutionClient('/api/conversations');
    await client.submitConversationTurn({ workspaceId: 'w', conversationSessionId: 's', text: 'hello', operationId: 'op-1' });
    const body = JSON.parse(String(fetchStub.mock.calls[0]?.[1]?.body));
    expect(body).toEqual({ text: 'hello', operationId: 'op-1' });
  });

  it('sends only the reviewed execution plan id when creating a session', async () => {
    const fetchStub = testDouble.fn<(url: string, init?: RequestInit) => Promise<{ json: () => Promise<{ ok: true; value: Record<string, never> }> }>>(async () => ({ json: async () => ({ ok: true, value: {} }) }));
    Object.defineProperty(globalThis, 'fetch', { configurable: true, value: fetchStub });
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: emptyStorage });
    const client = createThinClientConversationExecutionClient('/api/conversations');
    await client.createConversationSessionFromPlan({ workspaceId: 'w', sourceExecutionPlanId: 'plan' });
    const body = JSON.parse(String(fetchStub.mock.calls[0]?.[1]?.body));
    expect(body).toEqual({ sourceExecutionPlanId: 'plan' });
  });

  it('exposes safe host capabilities without streaming cancel or retry claims', () => {
    const capabilities = createThinClientConversationExecutionClient().readCapabilities();
    expect(capabilities.submitTurn).toEqual({ transport: true, hostSupport: 'supported', streaming: false });
    expect(capabilities.cancellation).toEqual({ supported: false, deferred: true });
    expect(capabilities.retry).toEqual({ supported: false, deferred: true });
  });
});
