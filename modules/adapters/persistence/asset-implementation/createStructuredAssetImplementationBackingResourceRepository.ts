import type { AssetImplementationBackingResourceRepositoryPort } from "../../../application/ports/asset-implementation";
import {
  normalizeAssetImplementationBackingResourceRecord,
  type AssetImplementationBackingResourceRecord,
} from "../../../contracts/asset-implementation";
import {
  StructuredDocumentConflictError,
  cloneStructuredJson,
  type StructuredDocumentStore,
} from "../shared";

const NAMESPACE = "asset-implementation/backing-resources";

export function createStructuredAssetImplementationBackingResourceRepository(
  documents: StructuredDocumentStore,
): AssetImplementationBackingResourceRepositoryPort {
  return {
    async save(record) {
      const normalized = normalizeAssetImplementationBackingResourceRecord(record);
      const key = String(normalized.releaseId);
      const existing = await documents.readDocument<AssetImplementationBackingResourceRecord>(
        NAMESPACE,
        key,
      );
      if (existing) {
        const current = normalizeAssetImplementationBackingResourceRecord(
          existing.value,
        );
        if (JSON.stringify(current) !== JSON.stringify(normalized)) {
          throw new StructuredDocumentConflictError(
            NAMESPACE,
            key,
            existing.revision,
          );
        }
        return cloneStructuredJson(current);
      }
      const saved = await documents.writeDocument(NAMESPACE, key, normalized, {
        expectedRevision: 0,
        updatedAt: normalized.createdAt,
      });
      return cloneStructuredJson(
        normalizeAssetImplementationBackingResourceRecord(saved.value),
      );
    },
    async readByRelease(releaseId, workspaceId) {
      const document = await documents.readDocument<AssetImplementationBackingResourceRecord>(
        NAMESPACE,
        String(releaseId),
      );
      if (!document) return undefined;
      const record = normalizeAssetImplementationBackingResourceRecord(
        document.value,
      );
      if (record.scope === "workspace" && record.workspaceId !== workspaceId) {
        return undefined;
      }
      return cloneStructuredJson(record);
    },
    async list(workspaceId) {
      const documentsFound =
        await documents.listDocuments<AssetImplementationBackingResourceRecord>(
          NAMESPACE,
        );
      return documentsFound
        .map((document) =>
          normalizeAssetImplementationBackingResourceRecord(document.value),
        )
        .filter(
          (record) =>
            record.scope === "system" || record.workspaceId === workspaceId,
        )
        .sort((left, right) =>
          String(left.releaseId).localeCompare(String(right.releaseId)),
        )
        .map(cloneStructuredJson);
    },
  };
}
