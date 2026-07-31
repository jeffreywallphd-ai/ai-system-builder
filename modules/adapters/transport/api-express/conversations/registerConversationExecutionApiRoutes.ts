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
import { createApiError, createApiFailureResponse, createApiSuccessResponse } from '../../../../contracts/api';

interface ExpressRequestLike { params?: Record<string, string | undefined>; body?: Record<string, unknown>; query?: Record<string, unknown>; }
interface ExpressResponseLike { status: (code: number) => ExpressResponseLike; json: (body: unknown) => void; }
export interface ExpressRoutePort { get: (path: string, handler: (request: ExpressRequestLike, response: ExpressResponseLike) => Promise<void>) => void; post: (path: string, handler: (request: ExpressRequestLike, response: ExpressResponseLike) => Promise<void>) => void; }

export interface RegisterConversationExecutionApiRoutesDependencies {
  app: ExpressRoutePort;
  conversations: {
    create: CreateConversationExecutionSessionFromPlanUseCase;
    approve: ApproveConversationSessionUseCase;
    submitTurn: SubmitConversationTurnUseCase;
    cancelTurn: CancelConversationTurnUseCase;
    retryTurn: RetryConversationTurnUseCase;
    readSessions: ConversationSessionReadModelService;
    readTranscript: ConversationTranscriptReadModelService;
    readActivity: ConversationTurnActivityReadModelService;
  };
}

const OPERATION = 'conversations.execution';
const VALID_SESSION_STATUS = new Set(['awaiting-approval', 'approved', 'active', 'closed', 'stale', 'invalid', 'blocked']);
const asText = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
const asBoolean = (value: unknown): boolean | undefined => value === 'true' ? true : value === 'false' ? false : undefined;
const asLimit = (value: unknown): number | undefined => {
  if (typeof value !== 'string' || value.trim().length === 0) return undefined;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1 || parsed > 200) return undefined;
  return parsed;
};

function sendValidation(response: ExpressResponseLike, message: string): void {
  response.status(400).json(createApiFailureResponse(createApiError(OPERATION, 'validation', message)));
}

function sendInternal(response: ExpressResponseLike): void {
  response.status(500).json(createApiFailureResponse(createApiError(OPERATION, 'internal', 'Unable to complete request.')));
}

function sendMappedFailure(response: ExpressResponseLike, kind: string | undefined, message: string): void {
  const status = kind === 'validation' ? 400 : kind === 'not-found' ? 404 : (kind === 'conflict' || kind === 'runtime-not-ready' || kind === 'blocked' || kind === 'retry-not-allowed') ? 409 : 500;
  const code = kind === 'validation' || kind === 'not-found' || kind === 'conflict' || kind === 'unavailable' || kind === 'not-supported' ? kind : status === 409 ? 'conflict' : 'internal';
  response.status(status).json(createApiFailureResponse(createApiError(OPERATION, code, message)));
}

function hasOnlyKeys(body: Record<string, unknown> | undefined, allowed: readonly string[]): boolean {
  if (!body) return true;
  return Object.keys(body).every((key) => allowed.includes(key));
}

export function registerConversationExecutionApiRoutes(dependencies: RegisterConversationExecutionApiRoutesDependencies): void {
  const { app, conversations } = dependencies;

  app.post('/api/conversations/workspaces/:workspaceId/sessions', async (request, response) => {
    const workspaceId = asText(request.params?.workspaceId);
    const sourceExecutionPlanId = asText(request.body?.sourceExecutionPlanId);
    if (!workspaceId || !sourceExecutionPlanId) return void sendValidation(response, 'Workspace id and source execution plan id are required.');
    if (!hasOnlyKeys(request.body, ['sourceExecutionPlanId'])) return void sendValidation(response, 'Unsupported request fields.');
    try {
      const result = await conversations.create.execute({ workspaceId, sourceExecutionPlanId });
      if (result.kind === 'success') return void response.status(200).json(createApiSuccessResponse(OPERATION, result.value));
      return void sendMappedFailure(response, result.failureKind, result.diagnostics[0]?.message ?? 'Conversation session creation failed.');
    } catch { return void sendInternal(response); }
  });

  app.post('/api/conversations/workspaces/:workspaceId/sessions/:conversationSessionId/approve', async (request, response) => {
    const workspaceId = asText(request.params?.workspaceId);
    const conversationSessionId = asText(request.params?.conversationSessionId);
    const executionApprovalId = asText(request.body?.executionApprovalId);
    if (!workspaceId || !conversationSessionId || !executionApprovalId) return void sendValidation(response, 'Workspace, session, and approval ids are required.');
    if (!hasOnlyKeys(request.body, ['executionApprovalId'])) return void sendValidation(response, 'Unsupported request fields.');
    try {
      const result = await conversations.approve.execute({ workspaceId, conversationSessionId, approvalId: executionApprovalId });
      if (result.kind === 'success') return void response.status(200).json(createApiSuccessResponse(OPERATION, result.value));
      return void sendMappedFailure(response, result.failureKind, result.diagnostics[0]?.message ?? 'Conversation session approval failed.');
    } catch { return void sendInternal(response); }
  });

  app.get('/api/conversations/workspaces/:workspaceId/sessions', async (request, response) => {
    const workspaceId = asText(request.params?.workspaceId);
    if (!workspaceId) return void sendValidation(response, 'Workspace id is required.');
    const statusRaw = asText(request.query?.status);
    const status = statusRaw.length > 0 ? statusRaw : undefined;
    if (status && !VALID_SESSION_STATUS.has(status)) return void sendValidation(response, 'Invalid session status filter.');
    const includeArchived = asBoolean(request.query?.archived);
    if (request.query?.archived !== undefined && includeArchived === undefined) return void sendValidation(response, 'Invalid archived filter.');
    const limit = asLimit(request.query?.limit);
    if (request.query?.limit !== undefined && limit === undefined) return void sendValidation(response, 'Invalid limit filter.');
    try {
      const value = await conversations.readSessions.listConversationSessions({ workspaceId, status: status as never, includeArchived, sourceExecutionPlanId: asText(request.query?.sourceExecutionPlanId) || undefined, cursor: asText(request.query?.cursor) || undefined, limit });
      response.status(200).json(createApiSuccessResponse(OPERATION, value));
    } catch { sendInternal(response); }
  });

  app.get('/api/conversations/workspaces/:workspaceId/sessions/:conversationSessionId', async (request, response) => {
    const workspaceId = asText(request.params?.workspaceId);
    const conversationSessionId = asText(request.params?.conversationSessionId);
    if (!workspaceId || !conversationSessionId) return void sendValidation(response, 'Workspace and session ids are required.');
    try { response.status(200).json(createApiSuccessResponse(OPERATION, await conversations.readSessions.readDetail({ workspaceId, conversationSessionId }))); } catch { sendInternal(response); }
  });

  app.get('/api/conversations/workspaces/:workspaceId/sessions/:conversationSessionId/transcript', async (request, response) => {
    const workspaceId = asText(request.params?.workspaceId);
    const conversationSessionId = asText(request.params?.conversationSessionId);
    if (!workspaceId || !conversationSessionId) return void sendValidation(response, 'Workspace and session ids are required.');
    try { response.status(200).json(createApiSuccessResponse(OPERATION, await conversations.readTranscript.readTranscript({ workspaceId, conversationSessionId }))); } catch { sendInternal(response); }
  });

  app.get('/api/conversations/workspaces/:workspaceId/sessions/:conversationSessionId/turns/:conversationTurnId/activity', async (request, response) => {
    const workspaceId = asText(request.params?.workspaceId);
    const conversationSessionId = asText(request.params?.conversationSessionId);
    const conversationTurnId = asText(request.params?.conversationTurnId);
    if (!workspaceId || !conversationSessionId || !conversationTurnId) return void sendValidation(response, 'Workspace, session, and turn ids are required.');
    try { response.status(200).json(createApiSuccessResponse(OPERATION, await conversations.readActivity.readActivity({ workspaceId, conversationSessionId, conversationTurnId }))); } catch { sendInternal(response); }
  });

  app.post('/api/conversations/workspaces/:workspaceId/sessions/:conversationSessionId/turns', async (request, response) => {
    const workspaceId = asText(request.params?.workspaceId);
    const conversationSessionId = asText(request.params?.conversationSessionId);
    const text = asText(request.body?.text);
    const operationId = asText(request.body?.operationId);
    if (!workspaceId || !conversationSessionId || !text || !operationId) return void sendValidation(response, 'Workspace, session, text, and operation id are required.');
    if (!hasOnlyKeys(request.body, ['text', 'operationId'])) return void sendValidation(response, 'Unsupported request fields.');
    try {
      const result = await conversations.submitTurn.execute({ workspaceId, conversationSessionId, text, operationId });
      if (result.kind === 'success') return void response.status(200).json(createApiSuccessResponse(OPERATION, result.value));
      return void sendMappedFailure(response, result.failureKind, result.diagnostics[0]?.message ?? 'Conversation turn submission failed.');
    } catch { return void sendInternal(response); }
  });

  app.post('/api/conversations/workspaces/:workspaceId/sessions/:conversationSessionId/turns/:conversationTurnId/cancel', async (request, response) => {
    const workspaceId = asText(request.params?.workspaceId);
    const conversationSessionId = asText(request.params?.conversationSessionId);
    const conversationTurnId = asText(request.params?.conversationTurnId);
    const operationId = asText(request.body?.operationId);
    if (!workspaceId || !conversationSessionId || !conversationTurnId || !operationId) return void sendValidation(response, 'Workspace, session, turn, and operation id are required.');
    if (!hasOnlyKeys(request.body, ['operationId'])) return void sendValidation(response, 'Unsupported request fields.');
    try {
      const result = await conversations.cancelTurn.execute({ workspaceId, conversationSessionId, conversationTurnId, operationId });
      if (result.kind === 'success') return void response.status(200).json(createApiSuccessResponse(OPERATION, result.value));
      return void sendMappedFailure(response, result.failureKind, result.diagnostics[0]?.message ?? 'Conversation turn cancellation failed.');
    } catch { return void sendInternal(response); }
  });

  app.post('/api/conversations/workspaces/:workspaceId/sessions/:conversationSessionId/turns/:conversationTurnId/retry', async (request, response) => {
    const workspaceId = asText(request.params?.workspaceId);
    const conversationSessionId = asText(request.params?.conversationSessionId);
    const conversationTurnId = asText(request.params?.conversationTurnId);
    const operationId = asText(request.body?.operationId);
    if (!workspaceId || !conversationSessionId || !conversationTurnId || !operationId) return void sendValidation(response, 'Workspace, session, turn, and operation id are required.');
    if (!hasOnlyKeys(request.body, ['operationId'])) return void sendValidation(response, 'Unsupported request fields.');
    try {
      const result = await conversations.retryTurn.execute({ workspaceId, conversationSessionId, conversationTurnId, operationId });
      if (result.kind === 'success') return void response.status(200).json(createApiSuccessResponse(OPERATION, result.value));
      return void sendMappedFailure(response, result.failureKind, result.diagnostics[0]?.message ?? 'Conversation turn retry failed.');
    } catch { return void sendInternal(response); }
  });
}
