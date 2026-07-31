import type {
  ApproveConversationSessionUseCase,
  CancelConversationTurnUseCase,
  CreateConversationExecutionSessionFromPlanUseCase,
  RetryConversationTurnUseCase,
  SubmitConversationTurnUseCase,
} from '../../../../application/use-cases/conversations';
import type {
  ConversationSessionReadModelService,
  ConversationTranscriptReadModelService,
  ConversationTurnActivityReadModelService,
} from '../../../../application/services/conversations';
import type { IpcMainHandlePort } from '../ipcMainHandlePort';
import {
  DESKTOP_CONVERSATION_EXECUTION_V2_APPROVE_SESSION_REQUEST_CHANNEL,
  DESKTOP_CONVERSATION_EXECUTION_V2_CANCEL_TURN_REQUEST_CHANNEL,
  DESKTOP_CONVERSATION_EXECUTION_V2_CREATE_SESSION_REQUEST_CHANNEL,
  DESKTOP_CONVERSATION_EXECUTION_V2_LIST_SESSIONS_REQUEST_CHANNEL,
  DESKTOP_CONVERSATION_EXECUTION_V2_READ_SESSION_REQUEST_CHANNEL,
  DESKTOP_CONVERSATION_EXECUTION_V2_READ_TRANSCRIPT_REQUEST_CHANNEL,
  DESKTOP_CONVERSATION_EXECUTION_V2_READ_TURN_ACTIVITY_REQUEST_CHANNEL,
  DESKTOP_CONVERSATION_EXECUTION_V2_RETRY_TURN_REQUEST_CHANNEL,
  DESKTOP_CONVERSATION_EXECUTION_V2_SUBMIT_TURN_REQUEST_CHANNEL,
  type DesktopConversationApproveSessionRequestPayload,
  type DesktopConversationCancelTurnRequestPayload,
  type DesktopConversationCreateSessionRequestPayload,
  type DesktopConversationListSessionsRequestPayload,
  type DesktopConversationReadSessionRequestPayload,
  type DesktopConversationReadTranscriptRequestPayload,
  type DesktopConversationReadTurnActivityRequestPayload,
  type DesktopConversationRetryTurnRequestPayload,
  type DesktopConversationSubmitTurnRequestPayload,
} from '../../../../contracts/ipc';

export interface RegisterConversationExecutionIpcDependencies {
  ipcMain: IpcMainHandlePort;
  conversations: {
    create: CreateConversationExecutionSessionFromPlanUseCase;
    approve: ApproveConversationSessionUseCase;
    readSessions: ConversationSessionReadModelService;
    readTranscript: ConversationTranscriptReadModelService;
    readActivity: ConversationTurnActivityReadModelService;
    submitTurn: SubmitConversationTurnUseCase;
    cancelTurn: CancelConversationTurnUseCase;
    retryTurn: RetryConversationTurnUseCase;
  };
}

type ConversationIpcRequest<TPayload> = { requestId?: string; correlationId?: string; payload?: TPayload };
type ConversationIpcHandlerResult = { ok: true; requestId?: string; correlationId?: string; value: unknown } | { ok: false; requestId?: string; correlationId?: string; error: { code: string; message: string } };
const asText = (v: unknown): string => typeof v === 'string' ? v.trim() : '';
const ok = <TPayload>(r: ConversationIpcRequest<TPayload>, value: unknown): ConversationIpcHandlerResult => ({ ok: true, requestId: r.requestId, correlationId: r.correlationId, value });
const fail = <TPayload>(r: ConversationIpcRequest<TPayload>, code: string, message: string): ConversationIpcHandlerResult => ({ ok: false, requestId: r.requestId, correlationId: r.correlationId, error: { code, message } });
const hasOnlyKeys = (payload: object | undefined, allowed: readonly string[]) => !payload || Object.keys(payload).every((key) => allowed.includes(key));

function requestHandler<TPayload extends object>(fn: (p: TPayload) => Promise<unknown>, validate: (p: TPayload | undefined) => string | undefined) {
  return async (_event: unknown, request: ConversationIpcRequest<TPayload>): Promise<ConversationIpcHandlerResult> => {
    const message = validate(request?.payload);
    if (message) return fail(request, 'validation', message);
    try { return ok(request, await fn(request.payload as TPayload)); } catch { return fail(request, 'internal', 'Unable to complete request.'); }
  };
}

export function registerConversationExecutionIpc({ ipcMain, conversations }: RegisterConversationExecutionIpcDependencies): void {
  ipcMain.handle(DESKTOP_CONVERSATION_EXECUTION_V2_CREATE_SESSION_REQUEST_CHANNEL.value, requestHandler<DesktopConversationCreateSessionRequestPayload>(
    (payload) => conversations.create.execute(payload),
    (payload) => !asText(payload?.workspaceId) || !asText(payload?.sourceExecutionPlanId) ? 'Workspace id and source execution plan id are required.' : !hasOnlyKeys(payload, ['workspaceId', 'sourceExecutionPlanId']) ? 'Unsupported request fields.' : undefined,
  ));
  ipcMain.handle(DESKTOP_CONVERSATION_EXECUTION_V2_APPROVE_SESSION_REQUEST_CHANNEL.value, requestHandler<DesktopConversationApproveSessionRequestPayload>(
    (payload) => conversations.approve.execute({ workspaceId: payload.workspaceId, conversationSessionId: payload.conversationSessionId, approvalId: payload.executionApprovalId }),
    (payload) => !asText(payload?.workspaceId) || !asText(payload?.conversationSessionId) || !asText(payload?.executionApprovalId) ? 'Workspace, session, and approval ids are required.' : !hasOnlyKeys(payload, ['workspaceId', 'conversationSessionId', 'executionApprovalId']) ? 'Unsupported request fields.' : undefined,
  ));
  ipcMain.handle(DESKTOP_CONVERSATION_EXECUTION_V2_LIST_SESSIONS_REQUEST_CHANNEL.value, requestHandler<DesktopConversationListSessionsRequestPayload>(
    (payload) => conversations.readSessions.listConversationSessions({ ...payload, status: payload.status as never }),
    (payload) => !asText(payload?.workspaceId) ? 'Workspace id is required.' : !hasOnlyKeys(payload, ['workspaceId', 'status', 'includeArchived', 'sourceExecutionPlanId', 'cursor', 'limit']) ? 'Unsupported request fields.' : undefined,
  ));
  ipcMain.handle(DESKTOP_CONVERSATION_EXECUTION_V2_READ_SESSION_REQUEST_CHANNEL.value, requestHandler<DesktopConversationReadSessionRequestPayload>(
    (payload) => conversations.readSessions.readDetail(payload),
    (payload) => !asText(payload?.workspaceId) || !asText(payload?.conversationSessionId) ? 'Workspace and session ids are required.' : !hasOnlyKeys(payload, ['workspaceId', 'conversationSessionId']) ? 'Unsupported request fields.' : undefined,
  ));
  ipcMain.handle(DESKTOP_CONVERSATION_EXECUTION_V2_READ_TRANSCRIPT_REQUEST_CHANNEL.value, requestHandler<DesktopConversationReadTranscriptRequestPayload>(
    (payload) => conversations.readTranscript.readTranscript(payload),
    (payload) => !asText(payload?.workspaceId) || !asText(payload?.conversationSessionId) ? 'Workspace and session ids are required.' : !hasOnlyKeys(payload, ['workspaceId', 'conversationSessionId']) ? 'Unsupported request fields.' : undefined,
  ));
  ipcMain.handle(DESKTOP_CONVERSATION_EXECUTION_V2_READ_TURN_ACTIVITY_REQUEST_CHANNEL.value, requestHandler<DesktopConversationReadTurnActivityRequestPayload>(
    (payload) => conversations.readActivity.readActivity(payload),
    (payload) => !asText(payload?.workspaceId) || !asText(payload?.conversationSessionId) || !asText(payload?.conversationTurnId) ? 'Workspace, session, and turn ids are required.' : !hasOnlyKeys(payload, ['workspaceId', 'conversationSessionId', 'conversationTurnId']) ? 'Unsupported request fields.' : undefined,
  ));
  ipcMain.handle(DESKTOP_CONVERSATION_EXECUTION_V2_SUBMIT_TURN_REQUEST_CHANNEL.value, requestHandler<DesktopConversationSubmitTurnRequestPayload>(
    (payload) => conversations.submitTurn.execute(payload),
    (payload) => !asText(payload?.workspaceId) || !asText(payload?.conversationSessionId) || !asText(payload?.text) || !asText(payload?.operationId) ? 'Workspace, session, text, and operation id are required.' : !hasOnlyKeys(payload, ['workspaceId', 'conversationSessionId', 'text', 'operationId']) ? 'Unsupported request fields.' : undefined,
  ));
  ipcMain.handle(DESKTOP_CONVERSATION_EXECUTION_V2_CANCEL_TURN_REQUEST_CHANNEL.value, requestHandler<DesktopConversationCancelTurnRequestPayload>(
    (payload) => conversations.cancelTurn.execute(payload),
    (payload) => !asText(payload?.workspaceId) || !asText(payload?.conversationSessionId) || !asText(payload?.conversationTurnId) || !asText(payload?.operationId) ? 'Workspace, session, turn, and operation id are required.' : !hasOnlyKeys(payload, ['workspaceId', 'conversationSessionId', 'conversationTurnId', 'operationId']) ? 'Unsupported request fields.' : undefined,
  ));
  ipcMain.handle(DESKTOP_CONVERSATION_EXECUTION_V2_RETRY_TURN_REQUEST_CHANNEL.value, requestHandler<DesktopConversationRetryTurnRequestPayload>(
    (payload) => conversations.retryTurn.execute(payload),
    (payload) => !asText(payload?.workspaceId) || !asText(payload?.conversationSessionId) || !asText(payload?.conversationTurnId) || !asText(payload?.operationId) ? 'Workspace, session, turn, and operation id are required.' : !hasOnlyKeys(payload, ['workspaceId', 'conversationSessionId', 'conversationTurnId', 'operationId']) ? 'Unsupported request fields.' : undefined,
  ));
}
