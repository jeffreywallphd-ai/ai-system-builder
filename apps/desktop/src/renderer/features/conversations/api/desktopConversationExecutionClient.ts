type Result<T> = { ok: true; value: T } | { ok: false; error: { code: string; message: string } };
export type ConversationHostCapabilities = { sessions: { read: boolean; create: boolean; approve: boolean }; submitTurn: { transport: boolean; hostSupport: 'supported'|'unsupported'|'unavailable'; streaming: false }; cancellation: { supported: boolean; deferred: boolean }; retry: { supported: boolean; deferred: boolean } };
type SessionListValue = { sessions?: unknown[]; items?: unknown[] };
type SessionValue = { conversationSessionId?: string; id?: string; approvalStatus?: string; executionApprovalStatus?: string; sessionStatus?: string; status?: string; executionApprovalId?: string; approvalId?: string };
type TranscriptValue = { entries?: unknown[]; messages?: unknown[]; turns?: unknown[] };
const fail = (message: string, code = 'internal'): Result<never> => ({ ok: false, error: { code, message } });
const asResult = <T,>(v: unknown): Result<T> => {
  const r = v as { ok?: boolean; value?: unknown; error?: { message?: string; code?: string } };
  if (r?.ok !== true) return fail(r?.error?.message ?? 'Unable to complete request.', r?.error?.code ?? 'internal');
  const nested = r.value as { kind?: string; value?: T; failureKind?: string; diagnostics?: Array<{ message?: string; code?: string }> } | undefined;
  if (nested?.kind === 'success') return { ok: true, value: nested.value as T };
  if (nested?.kind === 'failure') {
    const diagnostic = nested.diagnostics?.[0];
    return fail(diagnostic?.message ?? 'Unable to complete request.', diagnostic?.code ?? nested.failureKind ?? 'internal');
  }
  return { ok: true, value: r.value as T };
};

type DesktopApi = {
  createConversationExecutionSessionFromPlan?: (input: { workspaceId: string; sourceExecutionPlanId: string }) => Promise<unknown>;
  approveConversationSession?: (input: { workspaceId: string; conversationSessionId: string; executionApprovalId: string }) => Promise<unknown>;
  listConversationSessions?: (input: { workspaceId: string; status?: string; includeArchived?: boolean; sourceExecutionPlanId?: string; cursor?: string; limit?: number }) => Promise<unknown>;
  readConversationSession?: (input: { workspaceId: string; conversationSessionId: string }) => Promise<unknown>;
  readConversationTranscript?: (input: { workspaceId: string; conversationSessionId: string }) => Promise<unknown>;
  readConversationTurnActivity?: (input: { workspaceId: string; conversationSessionId: string; conversationTurnId: string }) => Promise<unknown>;
  submitConversationTurn?: (input: { workspaceId: string; conversationSessionId: string; text: string; operationId: string }) => Promise<unknown>;
  cancelConversationTurn?: (input: { workspaceId: string; conversationSessionId: string; conversationTurnId: string; operationId: string }) => Promise<unknown>;
  retryConversationTurn?: (input: { workspaceId: string; conversationSessionId: string; conversationTurnId: string; operationId: string }) => Promise<unknown>;
};

const api = (): DesktopApi => ((globalThis as { window?: { desktopApi?: DesktopApi } }).window?.desktopApi ?? {});

const call = async <T,>(name: keyof DesktopApi, input: unknown, unavailable: string): Promise<Result<T>> => {
  const fn = api()[name];
  if (typeof fn !== 'function') return fail(unavailable, 'unavailable');
  return asResult(await fn(input as never));
};

export function createDesktopConversationExecutionClient() {
  return {
    async createConversationSessionFromPlan(input: { workspaceId: string; sourceExecutionPlanId: string }) {
      if (!input.workspaceId || !input.sourceExecutionPlanId) return fail('Workspace id and source execution plan id are required.', 'validation');
      return call<SessionValue>('createConversationExecutionSessionFromPlan', input, 'Conversation session creation is not available yet.');
    },
    async approveConversationSession(input: { workspaceId: string; conversationSessionId: string; executionApprovalId: string }) {
      if (!input.workspaceId || !input.conversationSessionId || !input.executionApprovalId) return fail('Workspace, session, and approval ids are required.', 'validation');
      return call<SessionValue>('approveConversationSession', input, 'Conversation session approval is not available yet.');
    },
    async listConversationSessions(input: { workspaceId: string; status?: string; includeArchived?: boolean; sourceExecutionPlanId?: string; cursor?: string; limit?: number }) {
      if (!input.workspaceId) return fail('Workspace id is required.', 'validation');
      return call<SessionListValue>('listConversationSessions', input, 'Conversation sessions are unavailable.');
    },
    async readConversationSession(input: { workspaceId: string; conversationSessionId: string }) {
      if (!input.workspaceId || !input.conversationSessionId) return fail('Workspace and session ids are required.', 'validation');
      return call<SessionValue>('readConversationSession', input, 'Conversation session detail is unavailable.');
    },
    async readConversationTranscript(input: { workspaceId: string; conversationSessionId: string }) {
      if (!input.workspaceId || !input.conversationSessionId) return fail('Workspace and session ids are required.', 'validation');
      return call<TranscriptValue>('readConversationTranscript', input, 'Conversation transcript is unavailable.');
    },
    async readConversationTurnActivity(input: { workspaceId: string; conversationSessionId: string; conversationTurnId: string }) {
      if (!input.workspaceId || !input.conversationSessionId || !input.conversationTurnId) return fail('Workspace, session, and turn ids are required.', 'validation');
      return call('readConversationTurnActivity', input, 'Conversation turn activity is unavailable.');
    },
    async submitConversationTurn(input: { workspaceId: string; conversationSessionId: string; text: string; operationId: string }) {
      if (!input.workspaceId || !input.conversationSessionId || !input.text || !input.operationId) return fail('Workspace, session, text, and operation id are required.', 'validation');
      return call('submitConversationTurn', input, 'Conversation turn submission is unavailable.');
    },
    async cancelConversationTurn(input: { workspaceId: string; conversationSessionId: string; conversationTurnId: string; operationId: string }) {
      if (!input.workspaceId || !input.conversationSessionId || !input.conversationTurnId || !input.operationId) return fail('Workspace, session, turn, and operation id are required.', 'validation');
      return call('cancelConversationTurn', input, 'Conversation turn cancellation is unavailable.');
    },
    async retryConversationTurn(input: { workspaceId: string; conversationSessionId: string; conversationTurnId: string; operationId: string }) {
      if (!input.workspaceId || !input.conversationSessionId || !input.conversationTurnId || !input.operationId) return fail('Workspace, session, turn, and operation id are required.', 'validation');
      return call('retryConversationTurn', input, 'Conversation turn retry is unavailable.');
    },
    readCapabilities() {
      return { sessions: { read: true, create: true, approve: true }, submitTurn: { transport: true, hostSupport: 'supported', streaming: false }, cancellation: { supported: false, deferred: true }, retry: { supported: false, deferred: true } } satisfies ConversationHostCapabilities;
    },
  };
}
