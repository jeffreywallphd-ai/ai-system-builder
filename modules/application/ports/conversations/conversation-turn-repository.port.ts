import type { WorkspaceId } from '../../../contracts/workspace';
import type { ConversationSessionId, ConversationTurnId, ConversationTurnRecord, ConversationTurnStatus } from '../../../contracts/conversations';
import type { ExecutionRunId } from '../../../contracts/execution-runs';
export interface ConversationTurnRepositoryPort {
  saveConversationTurn(record: ConversationTurnRecord): Promise<ConversationTurnRecord>;
  updateConversationTurn(record: ConversationTurnRecord): Promise<ConversationTurnRecord>;
  getConversationTurnById(workspaceId: WorkspaceId, turnId: ConversationTurnId): Promise<ConversationTurnRecord | undefined>;
  listConversationTurnsBySession(workspaceId: WorkspaceId, conversationSessionId: ConversationSessionId, status?: ConversationTurnStatus): Promise<readonly ConversationTurnRecord[]>;
  listConversationTurnsByExecutionRun(workspaceId: WorkspaceId, executionRunId: ExecutionRunId): Promise<readonly ConversationTurnRecord[]>;
  getLatestConversationTurnBySession(workspaceId: WorkspaceId, conversationSessionId: ConversationSessionId): Promise<ConversationTurnRecord | undefined>;
}
