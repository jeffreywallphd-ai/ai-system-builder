import type { WorkspaceId } from '../../../contracts/workspace';
import type { AssistantResponseId, AssistantResponseRecord, ConversationSessionId, ConversationTurnId } from '../../../contracts/conversations';
export interface AssistantResponseRepositoryPort {
  saveAssistantResponse(record: AssistantResponseRecord): Promise<AssistantResponseRecord>;
  updateAssistantResponse(record: AssistantResponseRecord): Promise<AssistantResponseRecord>;
  getAssistantResponseById(workspaceId: WorkspaceId, assistantResponseId: AssistantResponseId): Promise<AssistantResponseRecord | undefined>;
  listAssistantResponsesBySession(workspaceId: WorkspaceId, conversationSessionId: ConversationSessionId): Promise<readonly AssistantResponseRecord[]>;
  listAssistantResponsesByTurn(workspaceId: WorkspaceId, conversationTurnId: ConversationTurnId): Promise<readonly AssistantResponseRecord[]>;
}
