import { parseApiEnvelope } from '../../../security/apiErrorEnvelope';
import { secureFetch } from '../../../security/secureFetch';

type Result<T> = { ok: true; value: T } | { ok: false; error: { code: string; message: string } };
export type ConversationHostCapabilities = { sessions: { read: boolean; create: boolean; approve: boolean }; submitTurn: { transport: boolean; hostSupport: 'supported'|'unsupported'|'unavailable'; streaming: false }; cancellation: { supported: boolean; deferred: boolean }; retry: { supported: boolean; deferred: boolean } };
type SessionListValue = { sessions?: unknown[]; items?: unknown[] };
type SessionValue = { conversationSessionId?: string; id?: string; approvalStatus?: string; executionApprovalStatus?: string; sessionStatus?: string; status?: string; executionApprovalId?: string; approvalId?: string };
type TranscriptValue = { entries?: unknown[]; messages?: unknown[]; turns?: unknown[] };
const fail = (message: string, code = 'internal'): Result<never> => ({ ok: false, error: { code, message } });
const unwrap = <T,>(v: unknown): Result<T> => {
  const r = v as { ok?: boolean; value?: T; error?: { code?: string; message?: string } };
  return r?.ok === true ? { ok: true, value: r.value as T } : fail(r?.error?.message ?? 'Unable to complete request.', r?.error?.code ?? 'internal');
};
const get = async (url: string) => parseApiEnvelope(await (await secureFetch(url, { method: 'GET' })).json());
const post = async (url: string, body: unknown) => parseApiEnvelope(await (await secureFetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })).json());

export function createThinClientConversationExecutionClient(base = '/api/conversations') {
  const b = base.replace(/\/+$/, '');
  return {
    async createConversationSessionFromPlan(input: { workspaceId: string; sourceExecutionPlanId: string }) {
      if (!input.workspaceId || !input.sourceExecutionPlanId) return fail('Workspace id and source execution plan id are required.', 'validation');
      try { return unwrap<SessionValue>(await post(`${b}/workspaces/${encodeURIComponent(input.workspaceId)}/sessions`, { sourceExecutionPlanId: input.sourceExecutionPlanId })); } catch { return fail('Conversation session creation is unavailable.', 'unavailable'); }
    },
    async approveConversationSession(input: { workspaceId: string; conversationSessionId: string; executionApprovalId: string }) {
      if (!input.workspaceId || !input.conversationSessionId || !input.executionApprovalId) return fail('Workspace, session, and approval ids are required.', 'validation');
      try { return unwrap<SessionValue>(await post(`${b}/workspaces/${encodeURIComponent(input.workspaceId)}/sessions/${encodeURIComponent(input.conversationSessionId)}/approve`, { executionApprovalId: input.executionApprovalId })); } catch { return fail('Conversation session approval is unavailable.', 'unavailable'); }
    },
    async listConversationSessions(input: { workspaceId: string; status?: string; includeArchived?: boolean; sourceExecutionPlanId?: string; cursor?: string; limit?: number }) {
      if (!input.workspaceId) return fail('Workspace id is required.', 'validation');
      const q = new URLSearchParams();
      if (input.status) q.set('status', input.status); if (input.includeArchived !== undefined) q.set('archived', String(input.includeArchived)); if (input.sourceExecutionPlanId) q.set('sourceExecutionPlanId', input.sourceExecutionPlanId); if (input.cursor) q.set('cursor', input.cursor); if (input.limit !== undefined) q.set('limit', String(input.limit));
      try { return unwrap<SessionListValue>(await get(`${b}/workspaces/${encodeURIComponent(input.workspaceId)}/sessions${q.size ? `?${q.toString()}` : ''}`)); } catch { return fail('Conversation sessions are unavailable.', 'unavailable'); }
    },
    async readConversationSession(input: { workspaceId: string; conversationSessionId: string }) {
      if (!input.workspaceId || !input.conversationSessionId) return fail('Workspace and session ids are required.', 'validation');
      try { return unwrap<SessionValue>(await get(`${b}/workspaces/${encodeURIComponent(input.workspaceId)}/sessions/${encodeURIComponent(input.conversationSessionId)}`)); } catch { return fail('Conversation session detail is unavailable.', 'unavailable'); }
    },
    async readConversationTranscript(input: { workspaceId: string; conversationSessionId: string }) {
      if (!input.workspaceId || !input.conversationSessionId) return fail('Workspace and session ids are required.', 'validation');
      try { return unwrap<TranscriptValue>(await get(`${b}/workspaces/${encodeURIComponent(input.workspaceId)}/sessions/${encodeURIComponent(input.conversationSessionId)}/transcript`)); } catch { return fail('Conversation transcript is unavailable.', 'unavailable'); }
    },
    async readConversationTurnActivity(input: { workspaceId: string; conversationSessionId: string; conversationTurnId: string }) {
      if (!input.workspaceId || !input.conversationSessionId || !input.conversationTurnId) return fail('Workspace, session, and turn ids are required.', 'validation');
      try { return unwrap(await get(`${b}/workspaces/${encodeURIComponent(input.workspaceId)}/sessions/${encodeURIComponent(input.conversationSessionId)}/turns/${encodeURIComponent(input.conversationTurnId)}/activity`)); } catch { return fail('Conversation turn activity is unavailable.', 'unavailable'); }
    },
    async submitConversationTurn(input: { workspaceId: string; conversationSessionId: string; text: string; operationId: string }) {
      if (!input.workspaceId || !input.conversationSessionId || !input.text || !input.operationId) return fail('Workspace, session, text, and operation id are required.', 'validation');
      try { return unwrap(await post(`${b}/workspaces/${encodeURIComponent(input.workspaceId)}/sessions/${encodeURIComponent(input.conversationSessionId)}/turns`, { text: input.text, operationId: input.operationId })); } catch { return fail('Conversation turn submission is unavailable.', 'unavailable'); }
    },
    async cancelConversationTurn(input: { workspaceId: string; conversationSessionId: string; conversationTurnId: string; operationId: string }) {
      if (!input.workspaceId || !input.conversationSessionId || !input.conversationTurnId || !input.operationId) return fail('Workspace, session, turn, and operation id are required.', 'validation');
      try { return unwrap(await post(`${b}/workspaces/${encodeURIComponent(input.workspaceId)}/sessions/${encodeURIComponent(input.conversationSessionId)}/turns/${encodeURIComponent(input.conversationTurnId)}/cancel`, { operationId: input.operationId })); } catch { return fail('Conversation turn cancellation is unavailable.', 'unavailable'); }
    },
    async retryConversationTurn(input: { workspaceId: string; conversationSessionId: string; conversationTurnId: string; operationId: string }) {
      if (!input.workspaceId || !input.conversationSessionId || !input.conversationTurnId || !input.operationId) return fail('Workspace, session, turn, and operation id are required.', 'validation');
      try { return unwrap(await post(`${b}/workspaces/${encodeURIComponent(input.workspaceId)}/sessions/${encodeURIComponent(input.conversationSessionId)}/turns/${encodeURIComponent(input.conversationTurnId)}/retry`, { operationId: input.operationId })); } catch { return fail('Conversation turn retry is unavailable.', 'unavailable'); }
    },
    readCapabilities() { return { sessions: { read: true, create: true, approve: true }, submitTurn: { transport: true, hostSupport: 'supported', streaming: false }, cancellation: { supported: false, deferred: true }, retry: { supported: false, deferred: true } } satisfies ConversationHostCapabilities; },
  };
}
