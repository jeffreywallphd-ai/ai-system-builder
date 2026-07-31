import type { ConversationFailure, ConversationSuccess } from '../../../contracts/conversations';
import { createWorkspaceId } from '../../../contracts/workspace';
import type { ConversationTurnRepositoryPort } from '../../ports/conversations';
import type { ConversationOperationRepositoryPort } from '../../ports/conversations';
import type { ExecutionRunRepositoryPort } from '../../ports/execution-runs';

export type CancelConversationTurnCommand = { workspaceId: string; conversationSessionId: string; conversationTurnId: string; operationId: string };
export type CancelConversationTurnResult = ConversationSuccess<{ status: 'not-supported' | 'cancelled' }> | ConversationFailure;
export class CancelConversationTurnUseCase {
  public constructor(private readonly d: { turnRepository: ConversationTurnRepositoryPort; executionRunRepository: ExecutionRunRepositoryPort; operationRepository: ConversationOperationRepositoryPort; now?: () => string }) {}
  public async execute(command: CancelConversationTurnCommand): Promise<CancelConversationTurnResult> {
    if (!command.workspaceId || !command.conversationSessionId || !command.conversationTurnId || !command.operationId) return { kind: 'failure', failureKind: 'validation', diagnostics: [{ code: 'conversation-turn-cancel-input-invalid', message: 'Workspace, session, turn, and operation id are required.' }] };
    const workspaceId = createWorkspaceId(command.workspaceId);
    const now = (this.d.now ?? (() => new Date().toISOString()))();
    const prior = await this.d.operationRepository.getConversationOperationById(command.workspaceId, command.conversationSessionId, command.operationId);
    if (prior) return prior.result as CancelConversationTurnResult;
    const turn = await this.d.turnRepository.getConversationTurnById(workspaceId, command.conversationTurnId as any);
    if (!turn) return { kind: 'failure', failureKind: 'not-found', diagnostics: [{ code: 'conversation-turn-not-found', message: 'Conversation turn was not found.' }] };
    if (turn.conversationSessionId !== command.conversationSessionId) return { kind: 'failure', failureKind: 'conflict', diagnostics: [{ code: 'conversation-turn-session-mismatch', message: 'Conversation turn does not belong to the specified conversation session.' }] };
    if (!turn.executionRunId) return { kind: 'failure', failureKind: 'conflict', diagnostics: [{ code: 'conversation-run-missing', message: 'Conversation turn has no execution run.' }] };
    const run = await this.d.executionRunRepository.getExecutionRunById(workspaceId, turn.executionRunId as any);
    if (!run) return { kind: 'failure', failureKind: 'not-found', diagnostics: [{ code: 'execution-run-not-found', message: 'Execution run was not found.' }] };
    if (['succeeded', 'failed', 'cancelled', 'archived', 'invalid', 'stale', 'blocked'].includes(run.status)) return { kind: 'failure', failureKind: 'conflict', diagnostics: [{ code: 'execution-run-terminal', message: 'Execution run is already terminal and cannot be cancelled.' }] };
    const result: CancelConversationTurnResult = { kind: 'success', value: { status: 'not-supported' } };
    await this.d.operationRepository.saveConversationOperation({ workspaceId: command.workspaceId, conversationSessionId: command.conversationSessionId, operationId: command.operationId, status: 'accepted', result, createdAt: now, updatedAt: now });
    return result;
  }
}
