import type { AssetDerivedCustomizationRepositoryPort } from "../../../application/ports/asset-authoring";
import {
  normalizeAssetDerivedCustomizationDraftRecord,
  type AssetDerivedCustomizationDraftRecord,
} from "../../../contracts/asset-authoring";
import {
  StructuredDocumentConflictError,
  cloneStructuredJson,
  type StructuredDocumentStore,
} from "../shared";

const NAMESPACE = "asset-authoring/derived-customizations";

export function createStructuredAssetDerivedCustomizationRepository(
  documents: StructuredDocumentStore,
): AssetDerivedCustomizationRepositoryPort {
  return {
    async create(record) {
      const normalized = normalizeAssetDerivedCustomizationDraftRecord(record);
      const key = recordKey(normalized.workspaceId, normalized.customizationId);
      const written = await documents.writeDocument(NAMESPACE, key, normalized, {
        expectedRevision: 0,
        updatedAt: normalized.updatedAt,
      });
      return cloneStructuredJson(
        normalizeAssetDerivedCustomizationDraftRecord(written.value),
      );
    },

    async read(workspaceId, customizationId) {
      const document =
        await documents.readDocument<AssetDerivedCustomizationDraftRecord>(
          NAMESPACE,
          recordKey(workspaceId, customizationId),
        );
      if (!document) return undefined;
      const normalized = normalizeAssetDerivedCustomizationDraftRecord(
        document.value,
      );
      return normalized.workspaceId === workspaceId
        ? cloneStructuredJson(normalized)
        : undefined;
    },

    async update(record, expectedRevision) {
      const normalized = normalizeAssetDerivedCustomizationDraftRecord(record);
      if (normalized.revision !== expectedRevision + 1) {
        throw new StructuredDocumentConflictError(
          NAMESPACE,
          recordKey(normalized.workspaceId, normalized.customizationId),
          expectedRevision,
        );
      }
      const key = recordKey(normalized.workspaceId, normalized.customizationId);
      const current =
        await documents.readDocument<AssetDerivedCustomizationDraftRecord>(
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
      const written = await documents.writeDocument(NAMESPACE, key, normalized, {
        expectedRevision: current.revision,
        updatedAt: normalized.updatedAt,
      });
      return cloneStructuredJson(
        normalizeAssetDerivedCustomizationDraftRecord(written.value),
      );
    },

    async list(query) {
      const limit = normalizeLimit(query.limit);
      const offset = normalizeCursor(query.cursor);
      const text = query.text?.trim().toLowerCase();
      const records = (
        await documents.listDocuments<AssetDerivedCustomizationDraftRecord>(
          NAMESPACE,
        )
      )
        .map((document) =>
          normalizeAssetDerivedCustomizationDraftRecord(document.value),
        )
        .filter(
          (record) =>
            record.workspaceId === query.workspaceId &&
            (!query.status || record.status === query.status) &&
            (!text || searchableText(record).includes(text)),
        )
        .sort(
          (left, right) =>
            right.updatedAt.localeCompare(left.updatedAt) ||
            String(left.customizationId).localeCompare(
              String(right.customizationId),
            ),
        );
      const page = records.slice(offset, offset + limit).map(cloneStructuredJson);
      return {
        records: page,
        ...(offset + limit < records.length
          ? { nextCursor: String(offset + limit) }
          : {}),
      };
    },
  };
}

function recordKey(workspaceId: string, customizationId: string): string {
  return `${workspaceId}::${customizationId}`;
}

function normalizeLimit(value: number | undefined): number {
  return Number.isSafeInteger(value) && Number(value) > 0
    ? Math.min(Number(value), 100)
    : 50;
}

function normalizeCursor(value: string | undefined): number {
  if (value === undefined) return 0;
  if (!/^\d+$/.test(value)) throw new Error("Customization cursor is invalid.");
  const offset = Number(value);
  if (!Number.isSafeInteger(offset)) throw new Error("Customization cursor is invalid.");
  return offset;
}

function searchableText(record: AssetDerivedCustomizationDraftRecord): string {
  return [
    record.customizationId,
    record.base.definitionRef.id,
    record.derivedDefinitionRef.id,
    record.semanticPatch["display-name"],
    record.status,
  ]
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toLowerCase();
}

