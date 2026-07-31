import type { SystemDataRepositoryPort } from "../../../application/ports/system-data";
import type { SystemReleaseId } from "../../../contracts/system-build";
import type { SystemDataAuditEntry, SystemDataRecord } from "../../../contracts/system-data";
import type { WorkspaceId } from "../../../contracts/workspace";
import { StructuredDocumentConflictError, cloneStructuredJson, type StructuredDocumentStore } from "../shared";

const RECORD_NAMESPACE = "system-data/records";
const AUDIT_NAMESPACE = "system-data/audit";

export function createStructuredSystemDataRepository(documents: StructuredDocumentStore): SystemDataRepositoryPort {
  return {
    async createRecordWithAudit(record, audit) {
      return documents.runInTransaction(async (transaction) => {
        const key = recordKey(record.targetWorkspaceId, record.releaseId, record.entityType, record.recordId);
        if (await transaction.readDocument<SystemDataRecord>(RECORD_NAMESPACE, key)) {
          throw new StructuredDocumentConflictError(RECORD_NAMESPACE, key, 0);
        }
        await transaction.writeDocument(RECORD_NAMESPACE, key, cloneStructuredJson(record), { expectedRevision: 0 });
        await writeAudit(transaction, audit);
        return cloneStructuredJson(record);
      });
    },
    async updateRecordWithAudit(record, audit, expectedRevision) {
      return documents.runInTransaction(async (transaction) => {
        const key = recordKey(record.targetWorkspaceId, record.releaseId, record.entityType, record.recordId);
        const current = await transaction.readDocument<SystemDataRecord>(RECORD_NAMESPACE, key);
        if (!current || current.value.revision !== expectedRevision || record.revision !== expectedRevision + 1) {
          throw new StructuredDocumentConflictError(RECORD_NAMESPACE, key, expectedRevision);
        }
        await transaction.writeDocument(RECORD_NAMESPACE, key, cloneStructuredJson(record), { expectedRevision: current.revision });
        await writeAudit(transaction, audit);
        return cloneStructuredJson(record);
      });
    },
    async readRecord(workspaceId, releaseId, entityType, recordId) {
      const value = (await documents.readDocument<SystemDataRecord>(RECORD_NAMESPACE, recordKey(workspaceId, releaseId, entityType, recordId)))?.value;
      return value?.targetWorkspaceId === workspaceId && value.releaseId === releaseId && value.entityType === entityType
        ? cloneStructuredJson(value)
        : undefined;
    },
    async listRecords(workspaceId, releaseId, entityType) {
      return (await documents.listDocuments<SystemDataRecord>(RECORD_NAMESPACE))
        .map((item) => item.value)
        .filter((item) => item.targetWorkspaceId === workspaceId && item.releaseId === releaseId && item.entityType === entityType)
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
        .map(cloneStructuredJson);
    },
    async appendAudit(entry) {
      await writeAudit(documents, entry);
    },
    async listAudit(workspaceId, releaseId, entityType, limit) {
      return (await documents.listDocuments<SystemDataAuditEntry>(AUDIT_NAMESPACE))
        .map((item) => item.value)
        .filter((item) => item.targetWorkspaceId === workspaceId && item.releaseId === releaseId && item.entityType === entityType)
        .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt))
        .slice(0, limit)
        .map(cloneStructuredJson);
    },
  };
}

async function writeAudit(documents: StructuredDocumentStore, entry: SystemDataAuditEntry): Promise<void> {
  const key = auditKey(entry);
  if (await documents.readDocument<SystemDataAuditEntry>(AUDIT_NAMESPACE, key)) {
    throw new StructuredDocumentConflictError(AUDIT_NAMESPACE, key, 0);
  }
  await documents.writeDocument(AUDIT_NAMESPACE, key, cloneStructuredJson(entry), { expectedRevision: 0 });
}

function recordKey(workspaceId: WorkspaceId, releaseId: SystemReleaseId, entityType: string, recordId: string): string {
  return [workspaceId, releaseId, entityType, recordId].join("/");
}

function auditKey(entry: SystemDataAuditEntry): string {
  return [entry.targetWorkspaceId, entry.releaseId, entry.entityType, entry.occurredAt, entry.auditId].join("/");
}
