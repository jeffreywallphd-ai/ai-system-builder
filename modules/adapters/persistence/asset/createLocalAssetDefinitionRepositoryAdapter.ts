import type { AssetDefinition, AssetReference } from "../../../contracts/asset";
import type { AssetDefinitionListQuery, AssetDefinitionRepositoryPort } from "../../../application/ports/asset";
import { cloneJson, LocalAssetRecordStore, type LocalAssetRecordStoreOptions } from "./local-asset-record-store";
import { deleteRecord, pageRecords, sortByUpdatedAtDescendingThenId, textValuesMatch, upsertRecord } from "./local-asset-repository-helpers";

export function createLocalAssetDefinitionRepositoryAdapter(options: LocalAssetRecordStoreOptions): AssetDefinitionRepositoryPort {
  const store = new LocalAssetRecordStore(options);

  return {
    async saveDefinition(definition: AssetDefinition): Promise<AssetDefinition> {
      await store.mutateCollection("definitions", (definitions) => ({
        records: upsertRecord(definitions, definition, definitionStorageKey),
        result: undefined,
      }));
      return cloneJson(definition);
    },

    async getDefinition(reference: AssetReference): Promise<AssetDefinition | undefined> {
      if (reference.kind !== "asset-definition" && reference.kind !== "asset-definition-version") return undefined;
      const definitions = await store.readCollection("definitions");
      if (reference.kind === "asset-definition-version") {
        const exact = definitions.find((definition) => definition.definitionId === reference.id && definition.version === reference.version);
        return exact ? cloneJson(exact) : undefined;
      }
      const sorted = sortDefinitions(definitions.filter((definition) => definition.definitionId === reference.id));
      const latest = [...sorted].sort((left, right) => String(right.version).localeCompare(String(left.version)))[0];
      return latest ? cloneJson(latest) : undefined;
    },

    async listDefinitions(query: AssetDefinitionListQuery = {}) {
      const definitions = sortDefinitions((await store.readCollection("definitions")).filter((definition) => matchesDefinition(definition, query)));
      const page = pageRecords(definitions, query.limit, query.cursor);
      return { definitions: page.records, nextCursor: page.nextCursor };
    },

    async deleteDefinition(reference: AssetReference): Promise<void> {
      const key = reference.kind === "asset-definition-version" ? `${reference.id}@${reference.version ?? ""}` : String(reference.id);
      await store.mutateCollection("definitions", (definitions) => ({
        records: reference.kind === "asset-definition-version"
          ? deleteRecord(definitions, key, definitionStorageKey)
          : definitions.filter((definition) => definition.definitionId !== reference.id),
        result: undefined,
      }));
    },
  };
}

function matchesDefinition(definition: AssetDefinition, query: AssetDefinitionListQuery): boolean {
  if (query.assetType && definition.assetType !== query.assetType) return false;
  if (query.assetFamily && definition.assetFamily !== query.assetFamily) return false;
  if (query.lifecycleStatus && definition.lifecycleStatus !== query.lifecycleStatus) return false;
  if (query.reviewStatus && definition.reviewStatus !== query.reviewStatus) return false;
  return textValuesMatch([
    String(definition.definitionId),
    definition.displayName,
    definition.description,
    definition.assetType,
    definition.assetFamily,
    definition.aiContext?.purpose,
    definition.aiContext?.userFacingSummary,
    definition.aiContext?.developerFacingSummary,
  ], query.text);
}

function sortDefinitions(definitions: readonly AssetDefinition[]): AssetDefinition[] {
  return sortByUpdatedAtDescendingThenId(definitions, (definition) => definitionStorageKey(definition)).sort((left, right) => {
    const leftUpdatedAt = left.provenance.updatedAt;
    const rightUpdatedAt = right.provenance.updatedAt;
    if (leftUpdatedAt || rightUpdatedAt) return 0;
    if (left.definitionId === right.definitionId && left.version !== right.version) {
      return String(right.version).localeCompare(String(left.version));
    }
    return 0;
  });
}

function definitionStorageKey(definition: AssetDefinition): string {
  return `${definition.definitionId}@${definition.version}`;
}
