export type ConversationOperationStatus = 'accepted' | 'failed';

export type ConversationOperationRecord = {
  workspaceId: string;
  conversationSessionId: string;
  operationId: string;
  status: ConversationOperationStatus;
  result: unknown;
  createdAt: string;
  updatedAt: string;
};

export interface ConversationOperationRepositoryPort {
  getConversationOperationById(workspaceId: string, conversationSessionId: string, operationId: string): Promise<ConversationOperationRecord | undefined>;
  saveConversationOperation(record: ConversationOperationRecord): Promise<ConversationOperationRecord>;
}
