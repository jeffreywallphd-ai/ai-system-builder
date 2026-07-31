import type {
  AssistantResponseRepositoryPort,
  ConversationMessageRepositoryPort,
  ConversationOperationRecord,
  ConversationOperationRepositoryPort,
  ConversationSessionRepositoryPort,
  ConversationTurnRepositoryPort,
} from "../../../application/ports/conversations";
import {
  normalizeAssistantResponseRecord,
  normalizeConversationMessageRecord,
  normalizeConversationSessionRecord,
  normalizeConversationTurnRecord,
  type AssistantResponseRecord,
  type ConversationMessageRecord,
  type ConversationSessionRecord,
  type ConversationTurnRecord,
} from "../../../contracts/conversations";
import { pageRecords } from "../user-library/local-user-library-repository-helpers";
import { LocalConversationRecordStore } from "./local-conversation-record-store";
import type { StructuredDocumentStore } from "../shared";
type ConversationUpdatedRecord = { id: string; updatedAt: string };
type ConversationCreatedRecord = { id: string; createdAt: string };
const byUpdated = (
  a: ConversationUpdatedRecord,
  b: ConversationUpdatedRecord,
) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id);
const byCreated = (
  a: ConversationCreatedRecord,
  b: ConversationCreatedRecord,
) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
export function createLocalConversationRepositoryAdapters(o: {
  rootDir: string;
  now?: () => string;
  documents?: StructuredDocumentStore;
}) {
  const s = new LocalConversationRecordStore(o);
  const sessions = async () =>
    (
      await s.readCollection<ConversationSessionRecord>(
        "conversation-sessions.json",
      )
    ).map(normalizeConversationSessionRecord);
  const turns = async () =>
    (
      await s.readCollection<ConversationTurnRecord>("conversation-turns.json")
    ).map(normalizeConversationTurnRecord);
  const messages = async () =>
    (
      await s.readCollection<ConversationMessageRecord>(
        "conversation-messages.json",
      )
    ).map(normalizeConversationMessageRecord);
  const responses = async () =>
    (
      await s.readCollection<AssistantResponseRecord>(
        "assistant-responses.json",
      )
    ).map(normalizeAssistantResponseRecord);
  const operations = async () =>
    await s.readCollection<ConversationOperationRecord>(
      "conversation-operations.json",
    );
  const conversationSessionRepository: ConversationSessionRepositoryPort = {
    async saveConversationSession(r) {
      const n = normalizeConversationSessionRecord(r);
      await s.mutateCollection<ConversationSessionRecord, void>(
        "conversation-sessions.json",
        (current) => ({
          records: [
            ...current
              .map(normalizeConversationSessionRecord)
              .filter(
                (x) => !(x.workspaceId === n.workspaceId && x.id === n.id),
              ),
            n,
          ].sort(byUpdated),
          result: undefined,
        }),
      );
      return n;
    },
    async updateConversationSession(r) {
      return this.saveConversationSession(r);
    },
    async getConversationSessionById(workspaceId, id) {
      if (!workspaceId) throw new Error("workspaceId is required.");
      return (await sessions()).find(
        (x) => x.workspaceId === workspaceId && x.id === id,
      );
    },
    async listConversationSessions(q) {
      if (!q.workspaceId) throw new Error("workspaceId is required.");
      const xs = (await sessions()).filter(
        (x) =>
          x.workspaceId === q.workspaceId &&
          (!q.status || x.status === q.status) &&
          (!q.sourceExecutionPlanId ||
            x.sourceExecutionPlanId === q.sourceExecutionPlanId),
      );
      const p = pageRecords(xs.sort(byUpdated), q.limit, q.cursor);
      return { sessions: p.records, nextCursor: p.nextCursor };
    },
  };
  const conversationTurnRepository: ConversationTurnRepositoryPort = {
    async saveConversationTurn(r) {
      const n = normalizeConversationTurnRecord(r);
      await s.mutateCollection<ConversationTurnRecord, void>(
        "conversation-turns.json",
        (current) => ({
          records: [
            ...current
              .map(normalizeConversationTurnRecord)
              .filter(
                (x) => !(x.workspaceId === n.workspaceId && x.id === n.id),
              ),
            n,
          ].sort((a, b) => a.sequence - b.sequence || byCreated(a, b)),
          result: undefined,
        }),
      );
      return n;
    },
    async updateConversationTurn(r) {
      return this.saveConversationTurn(r);
    },
    async getConversationTurnById(workspaceId, id) {
      if (!workspaceId) throw new Error("workspaceId is required.");
      return (await turns()).find(
        (x) => x.workspaceId === workspaceId && x.id === id,
      );
    },
    async listConversationTurnsBySession(workspaceId, sessionId, status) {
      if (!workspaceId) throw new Error("workspaceId is required.");
      return (await turns())
        .filter(
          (x) =>
            x.workspaceId === workspaceId &&
            x.conversationSessionId === sessionId &&
            (!status || x.status === status),
        )
        .sort((a, b) => a.sequence - b.sequence || byCreated(a, b));
    },
    async listConversationTurnsByExecutionRun(workspaceId, runId) {
      if (!workspaceId) throw new Error("workspaceId is required.");
      return (await turns())
        .filter(
          (x) => x.workspaceId === workspaceId && x.executionRunId === runId,
        )
        .sort((a, b) => a.sequence - b.sequence || byCreated(a, b));
    },
    async getLatestConversationTurnBySession(workspaceId, sessionId) {
      const xs = await this.listConversationTurnsBySession(
        workspaceId,
        sessionId,
      );
      return xs[xs.length - 1];
    },
  };
  const conversationMessageRepository: ConversationMessageRepositoryPort = {
    async saveConversationMessage(r) {
      const n = normalizeConversationMessageRecord(r);
      await s.mutateCollection<ConversationMessageRecord, void>(
        "conversation-messages.json",
        (current) => ({
          records: [
            ...current
              .map(normalizeConversationMessageRecord)
              .filter(
                (x) => !(x.workspaceId === n.workspaceId && x.id === n.id),
              ),
            n,
          ].sort(byCreated),
          result: undefined,
        }),
      );
      return n;
    },
    async getConversationMessageById(workspaceId, id) {
      if (!workspaceId) throw new Error("workspaceId is required.");
      return (await messages()).find(
        (x) => x.workspaceId === workspaceId && x.id === id,
      );
    },
    async listConversationMessagesBySession(workspaceId, sessionId) {
      if (!workspaceId) throw new Error("workspaceId is required.");
      return (await messages())
        .filter(
          (x) =>
            x.workspaceId === workspaceId &&
            x.conversationSessionId === sessionId,
        )
        .sort(byCreated);
    },
    async listConversationMessagesByTurn(workspaceId, turnId) {
      if (!workspaceId) throw new Error("workspaceId is required.");
      return (await messages())
        .filter(
          (x) =>
            x.workspaceId === workspaceId && x.conversationTurnId === turnId,
        )
        .sort(byCreated);
    },
  };
  const assistantResponseRepository: AssistantResponseRepositoryPort = {
    async saveAssistantResponse(r) {
      const n = normalizeAssistantResponseRecord(r);
      await s.mutateCollection<AssistantResponseRecord, void>(
        "assistant-responses.json",
        (current) => ({
          records: [
            ...current
              .map(normalizeAssistantResponseRecord)
              .filter(
                (x) => !(x.workspaceId === n.workspaceId && x.id === n.id),
              ),
            n,
          ].sort(byCreated),
          result: undefined,
        }),
      );
      return n;
    },
    async updateAssistantResponse(r) {
      return this.saveAssistantResponse(r);
    },
    async getAssistantResponseById(workspaceId, id) {
      if (!workspaceId) throw new Error("workspaceId is required.");
      return (await responses()).find(
        (x) => x.workspaceId === workspaceId && x.id === id,
      );
    },
    async listAssistantResponsesBySession(workspaceId, sessionId) {
      if (!workspaceId) throw new Error("workspaceId is required.");
      return (await responses())
        .filter(
          (x) =>
            x.workspaceId === workspaceId &&
            x.conversationSessionId === sessionId,
        )
        .sort(byCreated);
    },
    async listAssistantResponsesByTurn(workspaceId, turnId) {
      if (!workspaceId) throw new Error("workspaceId is required.");
      return (await responses())
        .filter(
          (x) =>
            x.workspaceId === workspaceId && x.conversationTurnId === turnId,
        )
        .sort(byCreated);
    },
  };
  const conversationOperationRepository: ConversationOperationRepositoryPort = {
    async getConversationOperationById(
      workspaceId,
      conversationSessionId,
      operationId,
    ) {
      if (!workspaceId) throw new Error("workspaceId is required.");
      return (await operations()).find(
        (x) =>
          x.workspaceId === workspaceId &&
          x.conversationSessionId === conversationSessionId &&
          x.operationId === operationId,
      );
    },
    async saveConversationOperation(r) {
      await s.mutateCollection<ConversationOperationRecord, void>(
        "conversation-operations.json",
        (current) => ({
          records: [
            ...current.filter(
              (x) =>
                !(
                  x.workspaceId === r.workspaceId &&
                  x.conversationSessionId === r.conversationSessionId &&
                  x.operationId === r.operationId
                ),
            ),
            r,
          ].sort(
            (a, b) =>
              b.updatedAt.localeCompare(a.updatedAt) ||
              a.operationId.localeCompare(b.operationId),
          ),
          result: undefined,
        }),
      );
      return r;
    },
  };
  return {
    conversationSessionRepository,
    conversationTurnRepository,
    conversationMessageRepository,
    assistantResponseRepository,
    conversationOperationRepository,
  };
}
