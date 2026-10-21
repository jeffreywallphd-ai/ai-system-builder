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
      if (!reference || !["asset-definition", "asset-definition-version"].includes(reference.kind)) return undefined;
      return (await this.getDefinitions!([reference]))[0];
    },

    async getDefinitions(references: readonly AssetReference[]) {
      if (!Array.isArray(references) || references.length > 250 || references.some(ref => !ref || typeof ref.id !== "string" || !["asset-definition", "asset-definition-version"].includes(ref.kind))) throw new Error("Invalid bounded definition references.");
      if (!references.length) return [];
      const definitions = await store.readCollection("definitions");
      const exact = new Map(definitions.map(definition => [definitionStorageKey(definition), definition]));
      const current = new Map<string, AssetDefinition>();
      for (const definition of definitions) {
        const prior = current.get(String(definition.definitionId));
        if (!prior || String(definition.version).localeCompare(String(prior.version)) > 0) current.set(String(definition.definitionId), definition);
      }
      return references.map(reference => {
        const value = reference.kind === "asset-definition-version" ? exact.get(`${reference.id}@${reference.version ?? ""}`) : current.get(String(reference.id));
        return value ? cloneJson(value) : undefined;
      });
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
