import type { DelegatedConversationTurnAdmissionPort } from "../../../application/ports/conversations/delegated-conversation-turn-admission.port";
import { normalizeConversationSessionRecord } from "../../../contracts/conversations";
import { normalizeExecutionApprovalRecord } from "../../../contracts/execution-runs";
import { createWorkspaceId } from "../../../contracts/workspace";
import { createLocalExecutionRunRepositoryAdapters } from "../execution-runs";
import type { StructuredDocumentStore } from "../shared";
import { createLocalConversationRepositoryAdapters } from "./createLocalConversationRepositoryAdapters";

const refused = new Error("The delegated conversation admission changed.");

/** Only a scoped store with an owned commit fence can admit a delegated turn. */
export function createLocalDelegatedConversationTurnAdmission(options: {
  readonly rootDir: string;
  readonly documents: StructuredDocumentStore;
  readonly now?: () => string;
}): DelegatedConversationTurnAdmissionPort {
  const { documents } = options;
  const createRepositories = (transaction: StructuredDocumentStore) => ({
    ...createLocalConversationRepositoryAdapters({ ...options, documents: transaction }),
    ...createLocalExecutionRunRepositoryAdapters({ ...options, documents: transaction }),
  });
  return {
    async isStillCurrent({ session, approval, isCurrent }) {
      if (!documents.organizationId || !documents.runInOwnedTransaction || !isCurrent()) return false;
      try {
        const workspaceId = createWorkspaceId(session.workspaceId);
        const capturedSession = JSON.stringify(normalizeConversationSessionRecord(session));
        const capturedApproval = JSON.stringify(normalizeExecutionApprovalRecord(approval));
        const same = await documents.runInOwnedTransaction(async (transaction) => {
          if (!isCurrent()) return false;
          const { conversationSessionRepository, executionApprovalRepository } = createRepositories(transaction);
          const saved = await conversationSessionRepository.getConversationSessionById(workspaceId, session.id);
          const permission = await executionApprovalRepository.getExecutionApprovalById(workspaceId, approval.id);
          return JSON.stringify(saved) === capturedSession && JSON.stringify(permission) === capturedApproval;
        }, () => { if (!isCurrent()) throw refused; });
        return same && isCurrent();
      } catch {
        return false;
      }
    },
    async admit({ session, approval, turnId, operationId, updatedAt, isCurrent, writeInitialRecords }) {
      if (!documents.organizationId || !documents.runInOwnedTransaction || !isCurrent()) return undefined;
      const workspaceId = createWorkspaceId(session.workspaceId);
      const capturedSession = JSON.stringify(normalizeConversationSessionRecord(session));
      const capturedApproval = JSON.stringify(normalizeExecutionApprovalRecord(approval));
      const ensureCurrent = () => { if (!isCurrent()) throw refused; };
      try {
        return await documents.runInOwnedTransaction(async (transaction) => {
          ensureCurrent();
          const repositories = createRepositories(transaction);
          const { conversationSessionRepository: sessions, conversationOperationRepository: operations,
            executionApprovalRepository: approvals } = repositories;
          const saved = await sessions.getConversationSessionById(workspaceId, session.id);
          const permission = await approvals.getExecutionApprovalById(workspaceId, approval.id);
          if (!saved || JSON.stringify(saved) !== capturedSession ||
              (saved.status !== "approved" && saved.status !== "active") || saved.closedAt || saved.archivedAt ||
              saved.turnIds.includes(turnId) || !permission || JSON.stringify(permission) !== capturedApproval ||
              permission.approvalStatus !== "granted" || permission.revokedAt || permission.invalidatedAt ||
              saved.executionApprovalId !== permission.id || permission.conversationSessionId !== saved.id ||
              permission.sourceExecutionPlanId !== saved.sourceExecutionPlanId || permission.runtimeReferenceId !== saved.runtimeReferenceId ||
              await operations.getConversationOperationById(session.workspaceId, session.id, operationId)) throw refused;
          ensureCurrent();
          await operations.saveConversationOperation({
            workspaceId: session.workspaceId, conversationSessionId: session.id, operationId, status: "pending",
            result: { kind: "failure", failureKind: "conflict", diagnostics: [{
              code: "conversation-operation-pending", message: "This operation was already admitted. Check the saved turn status.",
            }] }, createdAt: updatedAt, updatedAt,
          });
          await writeInitialRecords({
            messageRepository: repositories.conversationMessageRepository,
            turnRepository: repositories.conversationTurnRepository,
            executionRunRepository: repositories.executionRunRepository,
            executionAttemptRepository: repositories.executionAttemptRepository,
            executionEventRepository: repositories.executionEventRepository,
          });
          return sessions.updateConversationSession({ ...saved, status: "active", turnIds: [...saved.turnIds, turnId], updatedAt });
        }, ensureCurrent);
      } catch (error) {
        if (error === refused) return undefined;
        throw error;
      }
    },
  };
}
