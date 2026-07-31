import type { AssetInstance, AssetReference } from "../../../contracts/asset";
import type { AssetInstanceListQuery, AssetInstanceRepositoryPort } from "../../../application/ports/asset";
import { cloneJson, LocalAssetRecordStore, type LocalAssetRecordStoreOptions } from "./local-asset-record-store";
import { deleteRecord, pageRecords, referenceEquals, sortByUpdatedAtDescendingThenId, textValuesMatch, upsertRecord } from "./local-asset-repository-helpers";

export function createLocalAssetInstanceRepositoryAdapter(options: LocalAssetRecordStoreOptions): AssetInstanceRepositoryPort {
  const store = new LocalAssetRecordStore(options);

  return {
    async saveInstance(instance: AssetInstance): Promise<AssetInstance> {
      await store.mutateCollection("instances", (instances) => ({
        records: upsertRecord(instances, instance, instanceStorageKey),
        result: undefined,
      }));
      return cloneJson(instance);
    },

    async getInstance(reference: AssetReference): Promise<AssetInstance | undefined> {
      if (reference.kind !== "asset-instance") return undefined;
      const instance = (await store.readCollection("instances")).find((record) => record.instanceId === reference.id);
      return instance ? cloneJson(instance) : undefined;
    },

    async listInstances(query: AssetInstanceListQuery = {}) {
      const instances = sortByUpdatedAtDescendingThenId(
        (await store.readCollection("instances")).filter((instance) => matchesInstance(instance, query)),
        instanceStorageKey,
      );
      const page = pageRecords(instances, query.limit, query.cursor);
      return { instances: page.records, nextCursor: page.nextCursor };
    },

    async deleteInstance(reference: AssetReference): Promise<void> {
      if (reference.kind !== "asset-instance") return;
      await store.mutateCollection("instances", (instances) => ({
        records: deleteRecord(instances, String(reference.id), instanceStorageKey),
        result: undefined,
      }));
    },
  };
}

function matchesInstance(instance: AssetInstance, query: AssetInstanceListQuery): boolean {
  if (query.workspaceId && !matchesWorkspace(instance, String(query.workspaceId))) return false;
  if (query.definitionRef && !referenceEquals(instance.definitionRef, query.definitionRef)) return false;
  if (query.lifecycleStatus && instance.lifecycleStatus !== query.lifecycleStatus) return false;
  if (query.reviewStatus && instance.reviewStatus !== query.reviewStatus) return false;
  if (query.parentCompositionRef && !referenceEquals(instance.parentCompositionRef, query.parentCompositionRef)) return false;
  return textValuesMatch([
    String(instance.instanceId),
    instance.displayName,
    instance.stateSummary?.summary,
    instance.stateSummary?.status,
    String(instance.definitionRef.id),
  ], query.text);
}

function instanceStorageKey(instance: AssetInstance): string {
  return String(instance.instanceId);
}

function matchesWorkspace(instance: AssetInstance, workspaceId: string): boolean {
  const metadata = instance.metadata as Record<string, unknown> | undefined;
  return (
    nestedWorkspaceId(metadata?.assetFinalization) === workspaceId ||
    nestedWorkspaceId(nestedRecord(metadata?.assetFinalization)?.finalizedImage) === workspaceId ||
    nestedWorkspaceId(metadata?.assetRegistration) === workspaceId ||
    nestedWorkspaceId(metadata?.workspaceOwnership) === workspaceId ||
    metadata?.workspaceId === workspaceId
  );
}

function nestedWorkspaceId(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const workspaceId = (value as Record<string, unknown>).workspaceId;
  return typeof workspaceId === "string" ? workspaceId : undefined;
}

function nestedRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" ? value as Record<string, unknown> : undefined;
}
