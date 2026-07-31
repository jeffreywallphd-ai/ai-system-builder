import type { WorkspaceId } from '../../../contracts/workspace';
import type { ConversationSessionId, ConversationSessionRecord, ConversationSessionStatus } from '../../../contracts/conversations';
export interface ConversationSessionListQuery { readonly workspaceId: WorkspaceId; readonly status?: ConversationSessionStatus; readonly sourceExecutionPlanId?: string; readonly sourceCompositionPlanId?: string; readonly sourceRuntimeReadinessBindingId?: string; readonly approvalStatus?: string; readonly includeArchived?: boolean; readonly limit?: number; readonly cursor?: string; }
export interface ConversationSessionRepositoryPort {
  saveConversationSession(record: ConversationSessionRecord): Promise<ConversationSessionRecord>;
  updateConversationSession(record: ConversationSessionRecord): Promise<ConversationSessionRecord>;
  getConversationSessionById(workspaceId: WorkspaceId, sessionId: ConversationSessionId): Promise<ConversationSessionRecord | undefined>;
  listConversationSessions(query: ConversationSessionListQuery): Promise<{ readonly sessions: readonly ConversationSessionRecord[]; readonly nextCursor?: string }>;
}
