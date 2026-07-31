import type { WorkspaceId } from '../../../contracts/workspace';
import type { ConversationMessageId, ConversationMessageRecord, ConversationSessionId, ConversationTurnId } from '../../../contracts/conversations';
export interface ConversationMessageRepositoryPort {
  saveConversationMessage(record: ConversationMessageRecord): Promise<ConversationMessageRecord>;
  getConversationMessageById(workspaceId: WorkspaceId, messageId: ConversationMessageId): Promise<ConversationMessageRecord | undefined>;
  listConversationMessagesBySession(workspaceId: WorkspaceId, conversationSessionId: ConversationSessionId): Promise<readonly ConversationMessageRecord[]>;
  listConversationMessagesByTurn(workspaceId: WorkspaceId, conversationTurnId: ConversationTurnId): Promise<readonly ConversationMessageRecord[]>;
}
