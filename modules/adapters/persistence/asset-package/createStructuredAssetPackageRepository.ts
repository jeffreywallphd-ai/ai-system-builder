import type { AssetPackageRepositoryPort } from "../../../application/ports/asset-package";
import type {
  AssetPackageInspectionRecord,
  AssetPackageRecord,
} from "../../../contracts/asset-package";
import type { WorkspaceId } from "../../../contracts/workspace";
import {
  StructuredDocumentConflictError,
  cloneStructuredJson,
  type StructuredDocumentStore,
} from "../shared";

const INSPECTIONS = "asset-package/inspections";
const PACKAGES = "asset-package/records";

export function createStructuredAssetPackageRepository(
  documents: StructuredDocumentStore,
): AssetPackageRepositoryPort {
  return {
    saveInspection: (record) => immutable(documents, INSPECTIONS, key(record.workspaceId, record.inspectionId), record),
    readInspection: (workspaceId, inspectionId) => readScoped<AssetPackageInspectionRecord>(documents, INSPECTIONS, key(workspaceId, inspectionId), workspaceId),
    savePackage: (record) => immutable(documents, PACKAGES, key(record.workspaceId, record.recordId), record),
    readPackage: (workspaceId, recordId) => readScoped<AssetPackageRecord>(documents, PACKAGES, key(workspaceId, recordId), workspaceId),
    async updatePackage(record, expectedRevision) {
      const documentKey = key(record.workspaceId, record.recordId);
      return documents.runInTransaction(async (transaction) => {
        const current = await transaction.readDocument<AssetPackageRecord>(PACKAGES, documentKey);
        if (!current || current.value.revision !== expectedRevision || record.revision !== expectedRevision + 1) {
          throw new StructuredDocumentConflictError(PACKAGES, documentKey, expectedRevision);
        }
        const safe = cloneStructuredJson(record);
        await transaction.writeDocument(PACKAGES, documentKey, safe, { expectedRevision: current.revision });
        return cloneStructuredJson(safe);
      });
    },
    async listPackages(workspaceId) {
      return (await documents.listDocuments<AssetPackageRecord>(PACKAGES))
        .map((entry) => entry.value)
        .filter((entry) => entry.workspaceId === workspaceId)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .map(cloneStructuredJson);
    },
  };
}

const key = (workspaceId: WorkspaceId, id: string) => `${workspaceId}/${id}`;

async function immutable<T>(documents: StructuredDocumentStore, namespace: string, documentKey: string, value: T): Promise<T> {
  const safe = cloneStructuredJson(value);
  const existing = await documents.readDocument<T>(namespace, documentKey);
  if (existing) {
    if (JSON.stringify(existing.value) === JSON.stringify(safe)) return cloneStructuredJson(safe);
    throw new StructuredDocumentConflictError(namespace, documentKey, 0);
  }
  await documents.writeDocument(namespace, documentKey, safe, { expectedRevision: 0 });
  return cloneStructuredJson(safe);
}

async function readScoped<T extends { workspaceId: WorkspaceId }>(
  documents: StructuredDocumentStore,
  namespace: string,
  documentKey: string,
  workspaceId: WorkspaceId,
): Promise<T | undefined> {
  const record = await documents.readDocument<T>(namespace, documentKey);
  return record?.value.workspaceId === workspaceId ? cloneStructuredJson(record.value) : undefined;
}
