import { createHash } from "node:crypto";
import type { StructuredDocumentStore } from "../../../../modules/adapters/persistence/shared";
import { writeDocumentRecord } from "../../../../modules/adapters/persistence/shared";
import { createStructuredSystemBuilderRepository } from "../../../../modules/adapters/persistence/system-builder";
import { createStructuredSystemBuildRepository } from "../../../../modules/adapters/persistence/system-build";
import { LocalAssetRecordStore } from "../../../../modules/adapters/persistence/asset";
import { LocalAssetAuthoringRecordStore } from "../../../../modules/adapters/persistence/asset-authoring/local-asset-authoring-record-store";
import type { AssetDefinition } from "../../../../modules/contracts/asset";
import type { WorkspaceId } from "../../../../modules/contracts/workspace";

const time = "2026-10-21T00:00:00.000Z";
export const referenceCandidatePrefix = "qualification.reference.candidate.";
export function referenceCandidates(): AssetDefinition[] {
  return Array.from({length: 1000}, (_, i) => ({definitionId: `${referenceCandidatePrefix}${String(i).padStart(4,"0")}` as never, version: "1.0.0", displayName: `Reference candidate ${String(i).padStart(4,"0")}`, assetType: i%10===0 ? "ui-component" : "tool", assetFamily: "structural", description: "Inert synthetic sparse browse fixture", lifecycleStatus: "published", provenance: {sourceKind: "human-authored"}, metadata: {categoryId: "ui-structure"}}));
}

/** Setup only; actual adapters and persistence, never response interception. */
export async function seedReferenceBrowseFixture(input: {documents: StructuredDocumentStore; definitionDocuments: StructuredDocumentStore; rootDirectory: string; workspaceId: WorkspaceId}) {
  const {documents, definitionDocuments, rootDirectory, workspaceId} = input;
  const definitions = referenceCandidates();
  const definitionStore = new LocalAssetRecordStore({rootDir: rootDirectory, documents: definitionDocuments});
  const existing = await definitionStore.readCollection("definitions");
  if (existing.some(record=>String(record.definitionId).startsWith(referenceCandidatePrefix))) throw new Error("Reference fixture already exists.");
  await definitionStore.writeCollection("definitions", [...existing, ...definitions]);
  await documents.runInTransaction(async transaction => {
    const systems = createStructuredSystemBuilderRepository(transaction);
    const releases = createStructuredSystemBuildRepository(transaction);
    for (let i=0; i<1000; i++) await systems.createRecord({systemId: `qualification.system.${i}`, targetWorkspaceId: workspaceId, status: "draft", name: `Reference system ${i}`, revision: 1, composition: {instanceRefs: [], rootInstanceRefs: []}, createdAt: time, updatedAt: time, createdBy: "qualification-owner", updatedBy: "qualification-owner"} as never);
    for (let i=0; i<10000; i++) await releases.saveRelease({releaseId: `qualification.release.${i}`, systemId: `qualification.system.${i%1000}`, targetWorkspaceId: workspaceId, approvedAt: String(i).padStart(8,"0"), createdAt: String(i).padStart(8,"0"), lock: {resolvedImplementations: Array(i%3+1).fill({})}} as never);
    const models = Array.from({length: 10000}, (_, i) => ({workspaceId, modelRecordId: `qualification.model.${i}`, displayName: `Reference model ${i}`, source: i%4===0 ? "generated" : "huggingface", lifecycleStatus: "downloaded", artifactForm: "full-model", provider: "huggingface", createdAt: time, ...(i%2 ? {localPath: "synthetic-no-model-weights"} : {})}));
    await writeDocumentRecord({rootDirectory, documents: transaction}, "model-registry/models.json", {models});
    const authored = Array.from({length: 10000}, (_, i) => ({workspaceId, authoredAssetId: `qualification.authored.${i}`, assetReference: i<1000 ? {kind: "asset-definition-version", id: definitions[i]!.definitionId, version: "1.0.0"} : {kind: "asset-instance", id: `qualification.asset.${i}`, version: "1"}, currentRevisionId: `qualification.revision.${i}`, status: "published", editableValues: {"display-name": i<1000 ? definitions[i]!.displayName : `Synthetic asset ${i}`}, provenance: {kind: "authored-from-scratch", operationAt: time}, createdAt: time, updatedAt: time}));
    const store = new LocalAssetAuthoringRecordStore({rootDir: rootDirectory, documents: transaction});
    await store.writeCollection("authoredAssets", authored);
    await store.writeCollection("revisions", authored.map(record=>({revisionId: record.currentRevisionId, workspaceId, authoredAssetId: record.authoredAssetId, revision: "1.0.0", status: "published", editableValues: record.editableValues, provenance: {kind: "revised-authored-asset", operationAt: time}, createdAt: time, updatedAt: time, publishedAt: time})));
  });
  return {systems: 1000, releases: 10000, models: 10000, customAssets: 10000, candidates: 1000, compatible: 100, fixtureSha256: createHash("sha256").update(JSON.stringify({version:1, definitions, counts:[1000,10000,10000,10000]})).digest("hex")};
}
