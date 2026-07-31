import type { SystemReviewAuditRepositoryPort } from "../../../application/ports/system-review";
import type { SystemReleaseId } from "../../../contracts/system-build";
import type { SystemReviewAuditEntry } from "../../../contracts/system-review";
import type { WorkspaceId } from "../../../contracts/workspace";
import {
  StructuredDocumentConflictError,
  cloneStructuredJson,
  type StructuredDocumentStore,
} from "../shared";

const AUDIT_NAMESPACE = "system-review/audit";

export function createStructuredSystemReviewAuditRepository(
  documents: StructuredDocumentStore,
): SystemReviewAuditRepositoryPort {
  return {
    async appendAudit(entry) {
      const key = auditKey(entry);
      if (
        await documents.readDocument<SystemReviewAuditEntry>(
          AUDIT_NAMESPACE,
          key,
        )
      ) {
        throw new StructuredDocumentConflictError(AUDIT_NAMESPACE, key, 0);
      }
      await documents.writeDocument(
        AUDIT_NAMESPACE,
        key,
        cloneStructuredJson(entry),
        { expectedRevision: 0 },
      );
    },
    async listAudit(
      workspaceId: WorkspaceId,
      releaseId: SystemReleaseId,
      limit: number,
    ) {
      return (
        await documents.listDocuments<SystemReviewAuditEntry>(AUDIT_NAMESPACE)
      )
        .map((item) => item.value)
        .filter(
          (item) =>
            item.targetWorkspaceId === workspaceId &&
            item.releaseId === releaseId,
        )
        .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt))
        .slice(0, limit)
        .map(cloneStructuredJson);
    },
  };
}

function auditKey(entry: SystemReviewAuditEntry): string {
  return [
    entry.targetWorkspaceId,
    entry.releaseId,
    entry.occurredAt,
    entry.auditId,
  ].join("/");
}
