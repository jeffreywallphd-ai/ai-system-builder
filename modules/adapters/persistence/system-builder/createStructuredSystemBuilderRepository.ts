import type { SystemBuilderRepositoryPort } from "../../../application/ports/system-builder";
import type {
  SystemBuilderRecord,
  SystemBuilderRevision,
  SystemBuilderRevisionId,
  SystemBuilderSystemId,
} from "../../../contracts/system-builder";
import type { WorkspaceId } from "../../../contracts/workspace";
import {
  StructuredDocumentConflictError,
  cloneStructuredJson,
  type StructuredDocumentStore,
} from "../shared";
import { appendCommittedSystemChange } from "./structuredSystemChangeJournal";

export const SYSTEM_BUILDER_RECORD_NAMESPACE = "system-builder/records";
const RECORD_NAMESPACE = SYSTEM_BUILDER_RECORD_NAMESPACE;
const REVISION_NAMESPACE = "system-builder/revisions";

export function createStructuredSystemBuilderRepository(
  documents: StructuredDocumentStore,
  options: { readonly journalChanges?: boolean } = {},
): SystemBuilderRepositoryPort {
  async function journal(transaction: StructuredDocumentStore, record: SystemBuilderRecord) {
    if (!options.journalChanges) return;
    await appendCommittedSystemChange(transaction, record.targetWorkspaceId, {
      systemId: record.systemId, recordRevision: record.revision, revisionId: record.currentRevisionId ?? null,
    });
  }
  return {
    async createRecordAndRevision(record, revision) {
      const savedRecord = cloneStructuredJson(record);
      const savedRevision = cloneStructuredJson(revision);
      return documents.runInTransaction(async (transaction) => {
        const recordDocumentKey = recordKey(savedRecord.targetWorkspaceId, savedRecord.systemId);
        const revisionDocumentKey = revisionKey(savedRevision.targetWorkspaceId, savedRevision.systemId, savedRevision.revisionId);
        if (await transaction.readDocument<SystemBuilderRecord>(RECORD_NAMESPACE, recordDocumentKey)) {
          throw new StructuredDocumentConflictError(RECORD_NAMESPACE, recordDocumentKey, 0);
        }
        if (await transaction.readDocument<SystemBuilderRevision>(REVISION_NAMESPACE, revisionDocumentKey)) {
          throw new StructuredDocumentConflictError(REVISION_NAMESPACE, revisionDocumentKey, 0);
        }
        await transaction.writeDocument(RECORD_NAMESPACE, recordDocumentKey, savedRecord, { expectedRevision: 0 });
        await transaction.writeDocument(REVISION_NAMESPACE, revisionDocumentKey, savedRevision, { expectedRevision: 0 });
        await journal(transaction, savedRecord);
        return { record: savedRecord, revision: savedRevision };
      });
    },
    async createRecord(record) {
      const savedRecord = cloneStructuredJson(record);
      const key = recordKey(savedRecord.targetWorkspaceId, savedRecord.systemId);
      return documents.runInTransaction(async (transaction) => {
        const existing = await transaction.readDocument<SystemBuilderRecord>(RECORD_NAMESPACE, key);
        if (existing) throw new StructuredDocumentConflictError(RECORD_NAMESPACE, key, 0);
        await transaction.writeDocument(RECORD_NAMESPACE, key, savedRecord, { expectedRevision: 0 });
        await journal(transaction, savedRecord);
        return savedRecord;
      });
    },
    async readRecord(workspaceId, systemId) {
      const document = await documents.readDocument<SystemBuilderRecord>(RECORD_NAMESPACE, recordKey(workspaceId, systemId));
      return document?.value.targetWorkspaceId === workspaceId ? cloneStructuredJson(document.value) : undefined;
    },
    async listRecords(workspaceId, includeArchived = false) {
      return (await documents.listDocuments<SystemBuilderRecord>(RECORD_NAMESPACE))
        .map((entry) => entry.value)
        .filter((record) => record.targetWorkspaceId === workspaceId && (includeArchived || record.status !== "archived"))
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
        .map(cloneStructuredJson);
    },
    async updateRecord(record, expectedRevision) {
      const savedRecord = cloneStructuredJson(record);
      const key = recordKey(savedRecord.targetWorkspaceId, savedRecord.systemId);
      return documents.runInTransaction(async (transaction) => {
        const current = await transaction.readDocument<SystemBuilderRecord>(RECORD_NAMESPACE, key);
        if (!current || current.value.revision !== expectedRevision || savedRecord.revision !== expectedRevision + 1) {
          throw new StructuredDocumentConflictError(RECORD_NAMESPACE, key, expectedRevision);
        }
        await transaction.writeDocument(RECORD_NAMESPACE, key, savedRecord, { expectedRevision: current.revision });
        await journal(transaction, savedRecord);
        return savedRecord;
      });
    },
    async saveRevision(revision) {
      const savedRevision = cloneStructuredJson(revision);
      const key = revisionKey(savedRevision.targetWorkspaceId, savedRevision.systemId, savedRevision.revisionId);
      const current = await documents.readDocument<SystemBuilderRevision>(REVISION_NAMESPACE, key);
      if (current) {
        if (JSON.stringify(current.value) === JSON.stringify(savedRevision)) return savedRevision;
        throw new StructuredDocumentConflictError(REVISION_NAMESPACE, key, 0);
      }
      await documents.writeDocument(REVISION_NAMESPACE, key, savedRevision, { expectedRevision: 0 });
      return savedRevision;
    },
    async saveRevisionAndRecord(revision, record, expectedRecordRevision) {
      const savedRecord = cloneStructuredJson(record);
      const savedRevision = cloneStructuredJson(revision);
      return documents.runInTransaction(async (transaction) => {
        const recordDocumentKey = recordKey(savedRecord.targetWorkspaceId, savedRecord.systemId);
        const current = await transaction.readDocument<SystemBuilderRecord>(RECORD_NAMESPACE, recordDocumentKey);
        if (!current || current.value.revision !== expectedRecordRevision || savedRecord.revision !== expectedRecordRevision + 1) {
          throw new StructuredDocumentConflictError(RECORD_NAMESPACE, recordDocumentKey, expectedRecordRevision);
        }
        const revisionDocumentKey = revisionKey(savedRevision.targetWorkspaceId, savedRevision.systemId, savedRevision.revisionId);
        if (await transaction.readDocument<SystemBuilderRevision>(REVISION_NAMESPACE, revisionDocumentKey)) {
          throw new StructuredDocumentConflictError(REVISION_NAMESPACE, revisionDocumentKey, 0);
        }
        await transaction.writeDocument(REVISION_NAMESPACE, revisionDocumentKey, savedRevision, { expectedRevision: 0 });
        await transaction.writeDocument(RECORD_NAMESPACE, recordDocumentKey, savedRecord, { expectedRevision: current.revision });
        await journal(transaction, savedRecord);
        return { revision: savedRevision, record: savedRecord };
      });
    },
    async readRevision(workspaceId, systemId, revisionId) {
      const document = await documents.readDocument<SystemBuilderRevision>(REVISION_NAMESPACE, revisionKey(workspaceId, systemId, revisionId));
      const value = document?.value;
      return value?.targetWorkspaceId === workspaceId && value.systemId === systemId ? cloneStructuredJson(value) : undefined;
    },
    async listRevisions(workspaceId, systemId) {
      return (await documents.listDocuments<SystemBuilderRevision>(REVISION_NAMESPACE))
        .map((entry) => entry.value)
        .filter((revision) => revision.targetWorkspaceId === workspaceId && revision.systemId === systemId)
        .sort((left, right) => right.revisionNumber - left.revisionNumber)
        .map(cloneStructuredJson);
    },
  };
}

const recordKey = (workspaceId: WorkspaceId, systemId: SystemBuilderSystemId) => `${workspaceId}/${systemId}`;
const revisionKey = (workspaceId: WorkspaceId, systemId: SystemBuilderSystemId, revisionId: SystemBuilderRevisionId) => `${workspaceId}/${systemId}/${revisionId}`;
