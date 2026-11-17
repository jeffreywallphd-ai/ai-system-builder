import assert from "node:assert/strict";
import { LocalAssetRecordStore } from "../../../modules/adapters/persistence/asset";
import { LocalAssetAuthoringRecordStore } from "../../../modules/adapters/persistence/asset-authoring/local-asset-authoring-record-store";
import { createLocalAuthoredAssetRepositoryAdapter, createLocalAssetRevisionRepositoryAdapter } from "../../../modules/adapters/persistence/asset-authoring";
import { composeInternalAssetRegistry } from "../../../modules/hosts/shared/composition/composeInternalAssetRegistry";
import { WorkspaceAssetRegistryReadFacade } from "../../../modules/application/services/asset/workspace-asset-registry-read-facade.service";
import { fixtureDefinition, fixtureTime, fixtureWorkspace } from "./asset-system-workload-fixtures";

export async function createCatalogWorkload(rootDir: string) {
  const definitions = Array.from({length: 1000}, (_, i) => ({...fixtureDefinition, definitionId: `qualification.catalog.${i}`, displayName: `Catalog ${String(i).padStart(4, "0")}`}));
  const kernel = composeInternalAssetRegistry({rootDirectory: rootDir, now: () => fixtureTime});
  await kernel.workspaceRepositories.workspaceRepository.saveWorkspace({workspaceId: fixtureWorkspace, displayName: "Qualification", status: "active", createdAt: fixtureTime, updatedAt: fixtureTime} as any);
  await new LocalAssetRecordStore({rootDir, now: () => fixtureTime}).writeCollection("definitions", definitions);
  const authored = definitions.map((definition, i) => ({authoredAssetId: `authored.${i}`, workspaceId: fixtureWorkspace, assetReference: {kind: "asset-definition-version", id: definition.definitionId, version: definition.version}, currentRevisionId: `revision.${i}`, status: "published", editableValues: {"display-name": definition.displayName}, provenance: {kind: "authored-from-scratch", operationAt: fixtureTime}, createdAt: fixtureTime, updatedAt: fixtureTime}));
  const revisions = authored.map(record => ({revisionId: record.currentRevisionId, workspaceId: fixtureWorkspace, authoredAssetId: record.authoredAssetId, revision: "1.0.0", status: "published", editableValues: record.editableValues, provenance: {kind: "revised-authored-asset", operationAt: fixtureTime}, createdAt: fixtureTime, updatedAt: fixtureTime, publishedAt: fixtureTime}));
  const store = new LocalAssetAuthoringRecordStore({rootDir, now: () => fixtureTime});
  await store.writeCollection("authoredAssets", authored); await store.writeCollection("revisions", revisions);
  const facade = new WorkspaceAssetRegistryReadFacade({assetRegistryRead: kernel.readFacade, workspaceRepository: kernel.workspaceRepositories.workspaceRepository, listWorkspaceSystemPackActivations: kernel.workspaceUseCases.listWorkspaceSystemPackActivations,
    authoredAssetRepository: createLocalAuthoredAssetRepositoryAdapter({rootDir}), assetRevisionRepository: createLocalAssetRevisionRepositoryAdapter({rootDir})});
  await assert.rejects(facade.listDefinitionCards({workspaceId: "qualification.missing"}));
  return async () => {
    let cursor: string | undefined; const seen = new Set<string>(); const identities = new Set<string>(); let pages = 0;
    do {
      const result = await facade.listDefinitionCards({workspaceId: fixtureWorkspace, includeBuiltIns: false, includeCustom: true, limit: 250, cursor});
      pages++; assert.ok(result.items.length <= 250);
      for (const item of result.items) {
        assert.equal(item.assetAuthoringEffectiveSourceSummary?.targetWorkspaceId, fixtureWorkspace);
        const identity = `${item.definitionId}@${item.version}`; assert.ok(!identities.has(identity)); identities.add(identity);
      }
      cursor = result.nextCursor;
      if (cursor) {assert.ok(!seen.has(cursor)); seen.add(cursor);}
    } while (cursor);
    assert.equal(pages, 4); assert.equal(identities.size, 1000);
  };
}
