import type { AssetStudioAssetDraftRepositoryPort } from "../../../application/ports/asset-studio";
import {
  normalizeAssetStudioAssetDraftRecord,
  type AssetStudioAssetDraftRecord,
} from "../../../contracts/asset-studio";
import {
  StructuredDocumentConflictError,
  cloneStructuredJson,
  type StructuredDocumentStore,
} from "../shared";

const NAMESPACE = "asset-studio/asset-drafts";

export function createStructuredAssetStudioAssetDraftRepository(
  documents: StructuredDocumentStore,
): AssetStudioAssetDraftRepositoryPort {
  return {
    async create(record) {
      const normalized = normalizeAssetStudioAssetDraftRecord(record);
      const key = recordKey(normalized.workspaceId, normalized.draftId);
      const written = await documents.writeDocument(
        NAMESPACE,
        key,
        normalized,
        {
          expectedRevision: 0,
          updatedAt: normalized.updatedAt,
        },
      );
      return cloneStructuredJson(
        normalizeAssetStudioAssetDraftRecord(written.value),
      );
    },

    async read(workspaceId, draftId) {
      const document =
        await documents.readDocument<AssetStudioAssetDraftRecord>(
          NAMESPACE,
          recordKey(workspaceId, draftId),
        );
      if (!document) return undefined;
      const normalized = normalizeAssetStudioAssetDraftRecord(document.value);
      return normalized.workspaceId === workspaceId
        ? cloneStructuredJson(normalized)
        : undefined;
    },

    async update(record, expectedRevision) {
      const normalized = normalizeAssetStudioAssetDraftRecord(record);
      if (normalized.revision !== expectedRevision + 1) {
        throw new StructuredDocumentConflictError(
          NAMESPACE,
          recordKey(normalized.workspaceId, normalized.draftId),
          expectedRevision,
        );
      }
      const key = recordKey(normalized.workspaceId, normalized.draftId);
      const current = await documents.readDocument<AssetStudioAssetDraftRecord>(
        NAMESPACE,
        key,
      );
      if (!current || current.value.revision !== expectedRevision) {
        throw new StructuredDocumentConflictError(
          NAMESPACE,
          key,
          expectedRevision,
        );
      }
      const written = await documents.writeDocument(
        NAMESPACE,
        key,
        normalized,
        {
          expectedRevision: current.revision,
          updatedAt: normalized.updatedAt,
        },
      );
      return cloneStructuredJson(
        normalizeAssetStudioAssetDraftRecord(written.value),
      );
    },

    async list(query) {
      const limit = normalizeLimit(query.limit);
      const offset = normalizeCursor(query.cursor);
      const text = query.text?.trim().toLowerCase();
      const records = (
        await documents.listDocuments<AssetStudioAssetDraftRecord>(NAMESPACE)
      )
        .map((document) => normalizeAssetStudioAssetDraftRecord(document.value))
        .filter(
          (record) =>
            record.workspaceId === query.workspaceId &&
            (!query.status || record.status === query.status) &&
            (!query.unpublishedOnly ||
              (record.status !== "published" &&
                record.status !== "abandoned")) &&
            (!text || searchableText(record).includes(text)),
        )
        .sort(
          (left, right) =>
            right.updatedAt.localeCompare(left.updatedAt) ||
            String(left.draftId).localeCompare(String(right.draftId)),
        );
      const page = records
        .slice(offset, offset + limit)
        .map(cloneStructuredJson);
      return {
        records: page,
        ...(offset + limit < records.length
          ? { nextCursor: String(offset + limit) }
          : {}),
      };
    },
  };
}

function recordKey(workspaceId: string, draftId: string): string {
  return `${workspaceId}::${draftId}`;
}

function normalizeLimit(value: number | undefined): number {
  return Number.isSafeInteger(value) && Number(value) > 0
    ? Math.min(Number(value), 100)
    : 50;
}

function normalizeCursor(value: string | undefined): number {
  if (value === undefined) return 0;
  if (!/^\d+$/.test(value)) throw new Error("Studio draft cursor is invalid.");
  const offset = Number(value);
  if (!Number.isSafeInteger(offset)) {
    throw new Error("Studio draft cursor is invalid.");
  }
  return offset;
}

function searchableText(record: AssetStudioAssetDraftRecord): string {
  return [
    record.draftId,
    record.definitionRef.id,
    record.semanticDefinition.displayName,
    record.semanticDefinition.description,
    record.semanticDefinition.assetType,
    record.semanticDefinition.assetFamily,
    record.status,
  ]
    .join(" ")
    .toLowerCase();
}
