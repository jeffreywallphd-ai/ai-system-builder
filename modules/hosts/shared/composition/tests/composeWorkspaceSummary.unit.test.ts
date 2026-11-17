import assert from "node:assert/strict";
import { test } from "node:test";
import { composeWorkspaceSummary } from "../composeWorkspaceSummary";
import { createInMemoryStructuredDocumentStore, writeDocumentRecord } from "../../../../adapters/persistence/shared";
import { createStructuredSystemBuilderRepository } from "../../../../adapters/persistence/system-builder";
import { createStructuredSystemBuildRepository } from "../../../../adapters/persistence/system-build";
import { createLocalModelRegistryAdapter } from "../../../../adapters/persistence/model";
import { createLocalAuthoredAssetRepositoryAdapter, createLocalAssetOverrideRepositoryAdapter } from "../../../../adapters/persistence/asset-authoring";
import { createStructuredAssetDerivedCustomizationRepository } from "../../../../adapters/persistence/asset-authoring/createStructuredAssetDerivedCustomizationRepository";
import { createStructuredAssetStudioAssetDraftRepository } from "../../../../adapters/persistence/asset-studio/createStructuredAssetStudioAssetDraftRepository";
import { createWorkspaceId } from "../../../../contracts/workspace";
import { countAssetsUsed, countModels, countSystems } from "../../../../ui/shared/page-dashboard/dashboardMetrics";

test("real repositories project exact large-fixture counts without returning catalogs or release locks", async () => {
  const workspaceId = createWorkspaceId("workspace.a"); const other = createWorkspaceId("workspace.b");
  const backing = createInMemoryStructuredDocumentStore(); const reads = new Map<string, number>();
  const documents = new Proxy(backing, {get(target, key) {
    if (key === "readDocument") return async (namespace: string, id: string) => { const identity = `${namespace}/${id}`; reads.set(identity, (reads.get(identity) ?? 0) + 1); return target.readDocument(namespace, id); };
    if (key === "listDocuments") return async (namespace: string) => {reads.set(namespace, (reads.get(namespace) ?? 0) + 1); return target.listDocuments(namespace);};
    const value = Reflect.get(target, key); return typeof value === "function" ? value.bind(target) : value;
  }});
  const rootDirectory = "summary-fixture";
  const systems = createStructuredSystemBuilderRepository(documents); const builds = createStructuredSystemBuildRepository(documents);
  const activeSystems = Array.from({length: 1000}, (_, i) => ({systemId: `system.${i}`}));
  for (const record of activeSystems) await systems.createRecord({...record, targetWorkspaceId: workspaceId, status: "draft", name: "Fixture", revision: 1, composition: {instanceRefs: [], rootInstanceRefs: []}, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", createdBy: "fixture", updatedBy: "fixture"} as any);
  await systems.createRecord({systemId: "system.other", targetWorkspaceId: other, status: "draft", name: "Fixture", revision: 1, composition: {instanceRefs: [], rootInstanceRefs: []}, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", createdBy: "fixture", updatedBy: "fixture"} as any);
  const releases = Array.from({length: 10000}, (_, i) => ({systemId: `system.${i % 1000}`, approvedAt: String(i).padStart(8, "0"), createdAt: String(i).padStart(8, "0"), assetCount: i % 3 + 1}));
  for (const [index, release] of releases.entries()) await builds.saveRelease({...release, releaseId: `release.${index}`, targetWorkspaceId: workspaceId, lock: {resolvedImplementations: Array(release.assetCount).fill({})}} as any);
  const models = Array.from({length: 10000}, (_, i) => ({workspaceId, modelRecordId: `model.${i}`, displayName: `Model ${i}`, source: i % 4 === 0 ? "generated" : "huggingface", lifecycleStatus: "downloaded", artifactForm: "full-model", provider: "huggingface", createdAt: "2026-01-01T00:00:00Z", localPath: i % 2 ? "fixture-model" : undefined}));
  await writeDocumentRecord({rootDirectory, documents}, "model-registry/models.json", {models: [...models, {...models[0], workspaceId: other, source: "invalid-other-workspace"}]});
  const authored = Array.from({length: 10000}, (_, i) => ({workspaceId, authoredAssetId: `authored.${i}`, assetReference: {kind: "asset-instance", id: `asset.${i}`, version: "1"}, currentRevisionId: `revision.${i}`, status: "published", editableValues: {summary: "Fixture"}, provenance: {kind: "authored-from-scratch", operationAt: "2026-01-01T00:00:00Z"}, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z"}));
  await writeDocumentRecord({rootDirectory, documents}, "asset-authoring/authored-assets.json", [...authored, {...authored[0], workspaceId: other, editableValues: {"protected-unsupported-field": "ignored-other-workspace"}}]);
  const options = {rootDir: rootDirectory, documents};
  const summary = composeWorkspaceSummary({workspaceRepository: {readWorkspace: async id => ({workspaceId: id, status: "active"}) as any}, authorization: {async authorizeWorkspaceOperation() {}}, systems, builds,
    models: createLocalModelRegistryAdapter({filePath: "unused", rootDirectory, documents, discovery: {enabled: false}}), countDatasets: async () => 37,
    assetSources: [createLocalAuthoredAssetRepositoryAdapter(options), createLocalAssetOverrideRepositoryAdapter(options), createStructuredAssetDerivedCustomizationRepository(documents), createStructuredAssetStudioAssetDraftRepository(documents)],
  });
  reads.clear();
  const home = await summary.execute({workspaceId, page: "home"});
  assert.deepEqual(home.metrics.systemsPublished, {status: "available", value: countSystems(activeSystems, releases).published});
  assert.deepEqual(home.metrics.modelsTrained, {status: "available", value: countModels(models.map(model => ({source: model.source, localFilesAvailable: Boolean(model.localPath)}))).trained});
  assert.deepEqual(home.metrics.customAssets, {status: "available", value: 10000});
  assert.equal(reads.get("model-registry/models.json"), 1);
  assert.equal(reads.get("system-build/releases"), 1);
  assert.equal(reads.get("asset-authoring/authored-assets.json"), 1);
  assert.equal(reads.get("asset-authoring/derived-customizations"), 1);
  assert.equal(reads.get("asset-studio/asset-drafts"), 1);
  const assets = await summary.execute({workspaceId, page: "assets"});
  assert.deepEqual(assets.metrics.assetsUsed, {status: "available", value: countAssetsUsed(releases)});
  const inventory = await summary.execute({workspaceId, page: "models"});
  assert.deepEqual(inventory.metrics.modelsInstalled, {status: "available", value: 5000});
  assert.ok(JSON.stringify(home).length < 1000); assert.ok(!JSON.stringify(home).includes("resolvedImplementations")); assert.ok(!JSON.stringify(home).includes("localPath"));
});

test("artifact projection preserves runtime/internal visibility semantics", async () => {
  const workspaceId=createWorkspaceId("workspace.a");
  const records=[{workspaceId,storageKey:"uploads/runtime.txt",sourceKind:"runtime",artifactFamily:"text"},{workspaceId,storageKey:"uploads/user.txt",sourceKind:"upload",artifactFamily:"text"},{workspaceId,storageKey:"uploads/hidden+json",sourceKind:"upload",artifactFamily:"metadata"}];
  const service=composeWorkspaceSummary({workspaceRepository:{readWorkspace:async()=>({workspaceId,status:"active"}) as any},authorization:{async authorizeWorkspaceOperation(){}},assetSources:[],countDatasets:async()=>0,artifacts:{browseArtifactCatalogRecords:async()=>({ok:true,value:{records}}) as any,readArtifactCatalogRecord:async()=>{throw new Error("No content reads");}}});
  const result=await service.execute({workspaceId,page:"artifacts"});
  assert.deepEqual(result.metrics.artifactsUploaded,{status:"available",value:1});
});
