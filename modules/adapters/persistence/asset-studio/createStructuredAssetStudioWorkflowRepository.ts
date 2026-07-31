import type { AssetStudioWorkflowRepositoryPort } from "../../../application/ports/asset-studio";
import type { AssetStudioWorkflowRecord } from "../../../contracts/asset-studio";
import type { WorkspaceId } from "../../../contracts/workspace";
import { StructuredDocumentConflictError, cloneStructuredJson, type StructuredDocumentStore } from "../shared";

const NAMESPACE = "asset-studio/workflows";

export function createStructuredAssetStudioWorkflowRepository(documents: StructuredDocumentStore): AssetStudioWorkflowRepositoryPort {
  return {
    async create(record) {
      const key = scopedKey(record.workspaceId, record.workflowId);
      const current = await documents.readDocument<AssetStudioWorkflowRecord>(NAMESPACE, key);
      if (current) {
        if (JSON.stringify(current.value) === JSON.stringify(record)) return cloneStructuredJson(record);
        throw new StructuredDocumentConflictError(NAMESPACE, key, 0);
      }
      await documents.writeDocument(NAMESPACE, key, cloneStructuredJson(record), { expectedRevision: 0 });
      return cloneStructuredJson(record);
    },
    async read(workspaceId, workflowId) {
      const document = await documents.readDocument<AssetStudioWorkflowRecord>(NAMESPACE, scopedKey(workspaceId, workflowId));
      return document?.value.workspaceId === workspaceId ? cloneStructuredJson(document.value) : undefined;
    },
    async update(record, expectedRevision) {
      const key = scopedKey(record.workspaceId, record.workflowId);
      return documents.runInTransaction(async (transaction) => {
        const current = await transaction.readDocument<AssetStudioWorkflowRecord>(NAMESPACE, key);
        if (!current || current.value.revision !== expectedRevision || record.revision !== expectedRevision + 1) throw new StructuredDocumentConflictError(NAMESPACE, key, expectedRevision);
        await transaction.writeDocument(NAMESPACE, key, cloneStructuredJson(record), { expectedRevision: current.revision });
        return cloneStructuredJson(record);
      });
    },
    async list(workspaceId) {
      return (await documents.listDocuments<AssetStudioWorkflowRecord>(NAMESPACE)).map((entry) => entry.value).filter((record) => record.workspaceId === workspaceId).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map(cloneStructuredJson);
    },
  };
}

const scopedKey = (workspaceId: WorkspaceId, workflowId: string) => `${workspaceId}/${workflowId}`;
