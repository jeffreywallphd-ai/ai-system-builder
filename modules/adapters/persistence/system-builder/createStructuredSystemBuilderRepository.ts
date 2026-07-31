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

const RECORD_NAMESPACE = "system-builder/records";
const REVISION_NAMESPACE = "system-builder/revisions";

export function createStructuredSystemBuilderRepository(
  documents: StructuredDocumentStore,
): SystemBuilderRepositoryPort {
  return {
    async createRecordAndRevision(record, revision) {
      return documents.runInTransaction(async (transaction) => {
        const recordDocumentKey = recordKey(record.targetWorkspaceId, record.systemId);
        const revisionDocumentKey = revisionKey(revision.targetWorkspaceId, revision.systemId, revision.revisionId);
        if (await transaction.readDocument<SystemBuilderRecord>(RECORD_NAMESPACE, recordDocumentKey)) {
          throw new StructuredDocumentConflictError(RECORD_NAMESPACE, recordDocumentKey, 0);
        }
        if (await transaction.readDocument<SystemBuilderRevision>(REVISION_NAMESPACE, revisionDocumentKey)) {
          throw new StructuredDocumentConflictError(REVISION_NAMESPACE, revisionDocumentKey, 0);
        }
        await transaction.writeDocument(RECORD_NAMESPACE, recordDocumentKey, cloneStructuredJson(record), { expectedRevision: 0 });
        await transaction.writeDocument(REVISION_NAMESPACE, revisionDocumentKey, cloneStructuredJson(revision), { expectedRevision: 0 });
        return { record: cloneStructuredJson(record), revision: cloneStructuredJson(revision) };
      });
    },
    async createRecord(record) {
      const key = recordKey(record.targetWorkspaceId, record.systemId);
      const existing = await documents.readDocument<SystemBuilderRecord>(RECORD_NAMESPACE, key);
      if (existing) throw new StructuredDocumentConflictError(RECORD_NAMESPACE, key, 0);
      await documents.writeDocument(RECORD_NAMESPACE, key, cloneStructuredJson(record), { expectedRevision: 0 });
      return cloneStructuredJson(record);
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
      const key = recordKey(record.targetWorkspaceId, record.systemId);
      return documents.runInTransaction(async (transaction) => {
        const current = await transaction.readDocument<SystemBuilderRecord>(RECORD_NAMESPACE, key);
        if (!current || current.value.revision !== expectedRevision || record.revision !== expectedRevision + 1) {
          throw new StructuredDocumentConflictError(RECORD_NAMESPACE, key, expectedRevision);
        }
        await transaction.writeDocument(RECORD_NAMESPACE, key, cloneStructuredJson(record), { expectedRevision: current.revision });
        return cloneStructuredJson(record);
      });
    },
    async saveRevision(revision) {
      const key = revisionKey(revision.targetWorkspaceId, revision.systemId, revision.revisionId);
      const current = await documents.readDocument<SystemBuilderRevision>(REVISION_NAMESPACE, key);
      if (current) {
        if (JSON.stringify(current.value) === JSON.stringify(revision)) return cloneStructuredJson(revision);
        throw new StructuredDocumentConflictError(REVISION_NAMESPACE, key, 0);
      }
      await documents.writeDocument(REVISION_NAMESPACE, key, cloneStructuredJson(revision), { expectedRevision: 0 });
      return cloneStructuredJson(revision);
    },
    async saveRevisionAndRecord(revision, record, expectedRecordRevision) {
      return documents.runInTransaction(async (transaction) => {
        const recordDocumentKey = recordKey(record.targetWorkspaceId, record.systemId);
        const current = await transaction.readDocument<SystemBuilderRecord>(RECORD_NAMESPACE, recordDocumentKey);
        if (!current || current.value.revision !== expectedRecordRevision || record.revision !== expectedRecordRevision + 1) {
          throw new StructuredDocumentConflictError(RECORD_NAMESPACE, recordDocumentKey, expectedRecordRevision);
        }
        const revisionDocumentKey = revisionKey(revision.targetWorkspaceId, revision.systemId, revision.revisionId);
        if (await transaction.readDocument<SystemBuilderRevision>(REVISION_NAMESPACE, revisionDocumentKey)) {
          throw new StructuredDocumentConflictError(REVISION_NAMESPACE, revisionDocumentKey, 0);
        }
        await transaction.writeDocument(REVISION_NAMESPACE, revisionDocumentKey, cloneStructuredJson(revision), { expectedRevision: 0 });
        await transaction.writeDocument(RECORD_NAMESPACE, recordDocumentKey, cloneStructuredJson(record), { expectedRevision: current.revision });
        return { revision: cloneStructuredJson(revision), record: cloneStructuredJson(record) };
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
