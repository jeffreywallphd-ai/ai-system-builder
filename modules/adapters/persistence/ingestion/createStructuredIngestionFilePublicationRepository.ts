import type { IngestionFilePublicationRepositoryPort } from "../../../application/ports/ingestion";
import { assertPublicationTask, normalizeIngestionFilePublication, publicationUnavailable } from "../../../application/shared/ingestion-file-publication";
import { normalizeIngestionTaskRecord, type IngestionTaskRecord } from "../../../contracts/ingestion";
import { cloneStructuredJson, StructuredDocumentConflictError, type StructuredDocumentStore } from "../shared";
import { INGESTION_FILE_PUBLICATION_NAMESPACE, INGESTION_TASK_NAMESPACE } from "./createStructuredIngestionAcquisitionRepository";

export function createStructuredIngestionFilePublicationRepository(documents: StructuredDocumentStore): IngestionFilePublicationRepositoryPort {
  return {
    async readPublication(workspaceId, taskId, fileId) {
      const document = await documents.readDocument(INGESTION_FILE_PUBLICATION_NAMESPACE, `${workspaceId}/${taskId}/${fileId}`);
      if (!document) return undefined;
      const result = normalizeIngestionFilePublication(document.value);
      if (result.workspaceId !== workspaceId || result.taskId !== taskId || result.fileId !== fileId
        || result.organizationId !== documents.organizationId || result.revision !== document.revision) publicationUnavailable();
      return result;
    },
    async createPublication(input) {
      const publication = normalizeIngestionFilePublication(input);
      if (publication.revision !== 1 || publication.organizationId !== documents.organizationId) publicationUnavailable();
      const key = `${publication.workspaceId}/${publication.taskId}/${publication.fileId}`;
      return documents.runInTransaction(async transaction => {
        const current = await transaction.readDocument<IngestionTaskRecord>(INGESTION_TASK_NAMESPACE, `${publication.workspaceId}/${publication.taskId}`);
        if (!current) publicationUnavailable();
        const task = normalizeIngestionTaskRecord(current.value);
        if (task.revision !== current.revision) publicationUnavailable();
        assertPublicationTask(publication, task);
        if (task.status !== "finalizing" || task.files.find(file => file.fileId === publication.fileId)!.status === "finalized") publicationUnavailable();
        await transaction.writeDocument(INGESTION_FILE_PUBLICATION_NAMESPACE, key, publication, { expectedRevision: 0 });
        return cloneStructuredJson(publication);
      });
    },
    async savePublication(input, expectedRevision) {
      const next = normalizeIngestionFilePublication(input);
      if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1 || next.revision !== expectedRevision + 1 || next.state === "committed"
        || next.organizationId !== documents.organizationId) publicationUnavailable();
      const key = `${next.workspaceId}/${next.taskId}/${next.fileId}`;
      return documents.runInTransaction(async transaction => {
        const current = await transaction.readDocument(INGESTION_FILE_PUBLICATION_NAMESPACE, key);
        if (!current || current.revision !== expectedRevision) throw new StructuredDocumentConflictError(INGESTION_FILE_PUBLICATION_NAMESPACE, key, expectedRevision);
        const before = normalizeIngestionFilePublication(current.value);
        const { state: _beforeState, revision: _beforeRevision, digest: _beforeDigest, ...beforeIdentity } = before;
        const { state: _nextState, revision: _nextRevision, digest: _nextDigest, ...nextIdentity } = next;
        if (before.revision !== expectedRevision || JSON.stringify(beforeIdentity) !== JSON.stringify(nextIdentity) || (before.digest && before.digest !== next.digest)) publicationUnavailable();
        const storedTask = await transaction.readDocument<IngestionTaskRecord>(INGESTION_TASK_NAMESPACE, `${next.workspaceId}/${next.taskId}`);
        if (!storedTask) publicationUnavailable();
        const task = normalizeIngestionTaskRecord(storedTask.value);
        if (task.revision !== storedTask.revision) publicationUnavailable();
        assertPublicationTask(next, task);
        // Acknowledging an already returned byte write retains evidence even if
        // cancellation won; it never permits the next origin transition.
        if (next.state !== "bytes-acknowledged" && task.status !== "finalizing") publicationUnavailable();
        if (task.files.find(file => file.fileId === next.fileId)!.status === "finalized") publicationUnavailable();
        await transaction.writeDocument(INGESTION_FILE_PUBLICATION_NAMESPACE, key, next, { expectedRevision });
        return cloneStructuredJson(next);
      });
    },
  };
}
