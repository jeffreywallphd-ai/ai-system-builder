import type { AssetBinding, AssetReference } from "../../../contracts/asset";
import type { AssetBindingListQuery, AssetBindingRepositoryPort } from "../../../application/ports/asset";
import { cloneJson, LocalAssetRecordStore, type LocalAssetRecordStoreOptions } from "./local-asset-record-store";
import { deleteRecord, pageRecords, referenceEquals, sortByUpdatedAtDescendingThenId, textValuesMatch, upsertRecord } from "./local-asset-repository-helpers";

export function createLocalAssetBindingRepositoryAdapter(options: LocalAssetRecordStoreOptions): AssetBindingRepositoryPort {
  const store = new LocalAssetRecordStore(options);

  return {
    async saveBinding(binding: AssetBinding): Promise<AssetBinding> {
      await store.mutateCollection("bindings", (bindings) => ({
        records: upsertRecord(bindings, binding, bindingStorageKey),
        result: undefined,
      }));
      return cloneJson(binding);
    },

    async getBinding(reference: AssetReference): Promise<AssetBinding | undefined> {
      if (reference.kind !== "asset-binding") return undefined;
      const binding = (await store.readCollection("bindings")).find((record) => record.bindingId === reference.id);
      return binding ? cloneJson(binding) : undefined;
    },

    async listBindings(query: AssetBindingListQuery = {}) {
      const bindings = sortByUpdatedAtDescendingThenId(
        (await store.readCollection("bindings")).filter((binding) => matchesBinding(binding, query)),
        bindingStorageKey,
      );
      const page = pageRecords(bindings, query.limit, query.cursor);
      return { bindings: page.records, nextCursor: page.nextCursor };
    },

    async deleteBinding(reference: AssetReference): Promise<void> {
      if (reference.kind !== "asset-binding") return;
      await store.mutateCollection("bindings", (bindings) => ({
        records: deleteRecord(bindings, String(reference.id), bindingStorageKey),
        result: undefined,
      }));
    },
  };
}

function matchesBinding(binding: AssetBinding, query: AssetBindingListQuery): boolean {
  if (query.bindingKind && binding.bindingKind !== query.bindingKind) return false;
  if (query.sourceRef && !referenceEquals(binding.sourceRef, query.sourceRef)) return false;
  if (query.targetRef && !referenceEquals(binding.targetRef, query.targetRef)) return false;
  if (query.lifecycleStatus && binding.lifecycleStatus !== query.lifecycleStatus) return false;
  return textValuesMatch([
    String(binding.bindingId),
    binding.bindingKind,
    String(binding.sourceRef.id),
    String(binding.targetRef.id),
  ], query.text);
}

function bindingStorageKey(binding: AssetBinding): string {
  return String(binding.bindingId);
}
