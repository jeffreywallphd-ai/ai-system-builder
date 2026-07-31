import type { ConversationFailure, ConversationSuccess } from '../../../contracts/conversations';
import { createWorkspaceId } from '../../../contracts/workspace';
import type { ConversationOperationRepositoryPort, ConversationTurnRepositoryPort } from '../../ports/conversations';
import { SubmitConversationTurnUseCase } from './submit-conversation-turn.use-case';

export type RetryConversationTurnCommand = { workspaceId: string; conversationSessionId: string; conversationTurnId: string; operationId: string };
export type RetryConversationTurnResult = ConversationSuccess<{ status: 'not-supported'; conversationTurnId: string }> | ConversationFailure;
export class RetryConversationTurnUseCase {
  public constructor(private readonly d: { turnRepository: ConversationTurnRepositoryPort; operationRepository: ConversationOperationRepositoryPort; submitUseCase: SubmitConversationTurnUseCase; now?: () => string }) {}
  public async execute(command: RetryConversationTurnCommand): Promise<RetryConversationTurnResult> {
    if (!command.workspaceId || !command.conversationSessionId || !command.conversationTurnId || !command.operationId) return { kind: 'failure', failureKind: 'validation', diagnostics: [{ code: 'conversation-turn-retry-input-invalid', message: 'Workspace, session, turn, and operation id are required.' }] };
    const workspaceId = createWorkspaceId(command.workspaceId);
    const now = (this.d.now ?? (() => new Date().toISOString()))();
    const prior = await this.d.operationRepository.getConversationOperationById(command.workspaceId, command.conversationSessionId, command.operationId);
    if (prior) return prior.result as RetryConversationTurnResult;
    const turn = await this.d.turnRepository.getConversationTurnById(workspaceId, command.conversationTurnId as any);
    if (!turn) return { kind: 'failure', failureKind: 'not-found', diagnostics: [{ code: 'conversation-turn-not-found', message: 'Conversation turn was not found.' }] };
    if (turn.conversationSessionId !== command.conversationSessionId) return { kind: 'failure', failureKind: 'conflict', diagnostics: [{ code: 'conversation-turn-session-mismatch', message: 'Conversation turn does not belong to the specified conversation session.' }] };
    if (!['failed', 'retryable'].includes(turn.status)) return { kind: 'failure', failureKind: 'retry-not-allowed', diagnostics: [{ code: 'conversation-turn-retry-not-allowed', message: 'Conversation turn cannot be retried in its current state.' }] };
    const result: RetryConversationTurnResult = { kind: 'success', value: { status: 'not-supported', conversationTurnId: turn.id } };
    await this.d.operationRepository.saveConversationOperation({ workspaceId: command.workspaceId, conversationSessionId: command.conversationSessionId, operationId: command.operationId, status: 'accepted', result, createdAt: now, updatedAt: now });
    return result;
  }
}
