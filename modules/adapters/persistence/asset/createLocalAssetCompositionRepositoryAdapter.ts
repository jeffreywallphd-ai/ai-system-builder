import type { AssetComposition, AssetReference } from "../../../contracts/asset";
import type { AssetCompositionListQuery, AssetCompositionRepositoryPort } from "../../../application/ports/asset";
import { cloneJson, LocalAssetRecordStore, type LocalAssetRecordStoreOptions } from "./local-asset-record-store";
import { deleteRecord, pageRecords, sortByUpdatedAtDescendingThenId, textValuesMatch, upsertRecord } from "./local-asset-repository-helpers";

export function createLocalAssetCompositionRepositoryAdapter(options: LocalAssetRecordStoreOptions): AssetCompositionRepositoryPort {
  const store = new LocalAssetRecordStore(options);

  return {
    async saveComposition(composition: AssetComposition): Promise<AssetComposition> {
      await store.mutateCollection("compositions", (compositions) => ({
        records: upsertRecord(compositions, composition, compositionStorageKey),
        result: undefined,
      }));
      return cloneJson(composition);
    },

    async getComposition(reference: AssetReference): Promise<AssetComposition | undefined> {
      if (reference.kind !== "asset-composition") return undefined;
      const composition = (await store.readCollection("compositions")).find((record) => record.compositionId === reference.id);
      return composition ? cloneJson(composition) : undefined;
    },

    async listCompositions(query: AssetCompositionListQuery = {}) {
      const compositions = sortByUpdatedAtDescendingThenId(
        (await store.readCollection("compositions")).filter((composition) => matchesComposition(composition, query)),
        compositionStorageKey,
      );
      const page = pageRecords(compositions, query.limit, query.cursor);
      return { compositions: page.records, nextCursor: page.nextCursor };
    },

    async deleteComposition(reference: AssetReference): Promise<void> {
      if (reference.kind !== "asset-composition") return;
      await store.mutateCollection("compositions", (compositions) => ({
        records: deleteRecord(compositions, String(reference.id), compositionStorageKey),
        result: undefined,
      }));
    },
  };
}

function matchesComposition(composition: AssetComposition, query: AssetCompositionListQuery): boolean {
  if (query.compositionType && composition.compositionType !== query.compositionType) return false;
  if (query.lifecycleStatus && composition.lifecycleStatus !== query.lifecycleStatus) return false;
  if (query.reviewStatus && composition.reviewStatus !== query.reviewStatus) return false;
  return textValuesMatch([
    String(composition.compositionId),
    composition.displayName,
    composition.description,
    composition.compositionType,
  ], query.text);
}

function compositionStorageKey(composition: AssetComposition): string {
  return String(composition.compositionId);
}
