import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { createOrganizationId } from "../../../../contracts/organization";
import { createWorkspaceId } from "../../../../contracts/workspace";
import { normalizeAssetImplementationRelease, normalizeAssetImplementationFacetId, normalizeSha256Digest, describeAssetImplementationBackingResourceFiles } from "../../../../contracts/asset-implementation";
import type { AssetDefinition, AssetReference } from "../../../../contracts/asset";
import type { AssetDefinitionPublicationPort } from "../../../../application/ports/asset-publication";
import { AssetStudioAssetDraftWorkflowUseCase } from "../../../../application/use-cases/asset-studio";
import { AssetDerivedCustomizationWorkflowUseCase } from "../../../../application/use-cases/asset-authoring";
import { AssetDerivedCustomizationTargetCatalogService } from "../../../../application/services/asset";
import { createInMemoryStructuredDocumentStore, type StructuredDocumentStore } from "../../shared";
import { createSqliteStructuredDocumentStore, migrateLocalSqliteDatabase } from "../../sqlite/sqlite-database";
import { createLocalAssetDefinitionRepositoryAdapter } from "../../asset";
import { createStructuredAssetStudioAssetDraftRepository } from "../../asset-studio";
import { createStructuredAssetDerivedCustomizationRepository } from "../../asset-authoring";
import { createStructuredAssetImplementationRepository, createStructuredAssetImplementationBackingResourceRepository } from "../../asset-implementation";
import { createAssetImplementationArtifactAdapter } from "../../../storage/asset-implementation";
import { createStructuredAssetDefinitionPublication } from "..";

export const organization = createOrganizationId("publication.test-a");
export const otherOrganization = createOrganizationId("publication.test-b");
export const workspaceId = createWorkspaceId("workspace.publication-test");
export const reference = (id: string): AssetReference => ({kind: "asset-definition-version", id: id as never, version: "1.0.0" as never});
export const semantic = (displayName = "Status summary") => ({
  assetType: "tool" as const, assetFamily: "behavioral" as const, displayName,
  description: "Summarize a system's status for its user.",
  aiContext: {purpose: "Produce a bounded status summary.", userFacingSummary: "Status summary tool.", developerFacingSummary: "Three resource publication fixture; never executed.", capabilities: [{summary: "Produce a status summary"}], limitations: [{summary: "Synthetic test data only."}]},
});
export const resources = [
  {path: "frontend/status.tsx", role: "frontend-structure", mediaType: "text/typescript-jsx", content: "export const Status = () => <output>Ready</output>;"},
  {path: "frontend/status.css", role: "frontend-style", mediaType: "text/css", content: "output { color: #176325; }"},
  {path: "backend/status.ts", role: "backend-logic", mediaType: "text/typescript", content: "export const summarize = (rows: unknown[]) => ({ count: rows.length });"},
] as const;
export function studioValue<T>(result: {ok: true; value: T} | {ok: false; error: unknown}): T {
  assert.equal(result.ok, true, JSON.stringify(result));
  if (!result.ok) throw new Error("Studio fixture failed");
  return result.value;
}
export function derivedValue<T>(result: {kind: "success"; value: T} | {kind: "failure"; failure: unknown}): T {
  assert.equal(result.kind, "success", JSON.stringify(result));
  if (result.kind !== "success") throw new Error("Derived fixture failed");
  return result.value;
}
export const signal = () => {
  let resolve!: () => void;
  return {promise: new Promise<void>(done => {resolve = done;}), resolve: () => resolve()};
};

export function createFixture(backend: "memory" | "sqlite", definitionScope: "organization" | "platform") {
  const database = backend === "sqlite" ? new DatabaseSync(":memory:") : undefined;
  if (database) migrateLocalSqliteDatabase(database);
  const root = database ? createSqliteStructuredDocumentStore(database) : createInMemoryStructuredDocumentStore();
  const documents = root.forOrganization(organization);
  const definitions = createLocalAssetDefinitionRepositoryAdapter({rootDir: ".", documents: definitionScope === "platform" ? root : documents});
  const implementations = createStructuredAssetImplementationRepository(documents);
  const drafts = createStructuredAssetStudioAssetDraftRepository(documents);
  const customizations = createStructuredAssetDerivedCustomizationRepository(documents);
  const backingResources = createStructuredAssetImplementationBackingResourceRepository(documents);
  const bytes = new Map<string, Uint8Array>();
  const artifacts = createAssetImplementationArtifactAdapter({
    async storeArtifact(request: any) {
      if (bytes.has(request.descriptor.key)) return {ok: false, error: {code: "conflict", message: "exists"}};
      bytes.set(request.descriptor.key, Uint8Array.from(request.content));
      return {ok: true, value: {descriptor: request.descriptor}};
    },
    async retrieveArtifact(request: any) {
      const value = bytes.get(request.key);
      return value ? {ok: true, value: {descriptor: {key: request.key, mediaType: "application/octet-stream", sizeBytes: value.byteLength, checksum: {algorithm: "sha256", value: createHash("sha256").update(value).digest("hex")}}, content: Uint8Array.from(value)}} : {ok: false, error: {code: "not-found", message: "missing"}};
    },
  } as any);
  const publisher = (store = definitionScope === "platform" ? root : documents, owner = documents, verifiedArtifacts = artifacts) => createStructuredAssetDefinitionPublication({documents: store, ownerDocuments: owner, artifacts: verifiedArtifacts, definitionScope});
  const publication = publisher();
  let tick = 0, sequence = 0;
  const now = () => new Date(Date.UTC(2026, 9, 22, 12, 0, tick++)).toISOString();
  // Synthetic authorization only; actual persisted-policy wiring has separate host tests.
  const workspaceAccess = {async authorize() {}};
  const studio = (port: AssetDefinitionPublicationPort = publication) => new AssetStudioAssetDraftWorkflowUseCase({publication: port, workspaceAccess, drafts, definitions, implementations, artifacts, now, nextDraftId: () => `studio-asset-draft.publication-${++sequence}`});
  const targets = new AssetDerivedCustomizationTargetCatalogService({workspaceAccess, definitions, implementations, backingResources, artifacts});
  const derived = (port: AssetDefinitionPublicationPort = publication) => new AssetDerivedCustomizationWorkflowUseCase({publication: port, workspaceAccess, customizations, targets, definitions, implementations, artifacts, now, nextCustomizationId: () => `customization.publication-${++sequence}`, digestText: value => normalizeSha256Digest(`sha256:${createHash("sha256").update(value).digest("hex")}`)});
  async function reviewedStudio(ref = reference("asset.status-summary")) {
    const workflow = studio();
    const created = studioValue(await workflow.create({workspaceId, definitionRef: ref, semanticDefinition: semantic(), resources, actorId: "author"}));
    return studioValue(await workflow.review({workspaceId, draftId: created.draftId, expectedRevision: created.revision, actorId: "reviewer"}));
  }
  async function reviewedDerived() {
    const baseRef = reference(`asset.base-${++sequence}`);
    const reviewed = await reviewedStudio(baseRef);
    const published = studioValue(await studio().publish({workspaceId, draftId: reviewed.draftId, expectedRevision: reviewed.revision, actorId: "publisher"}));
    const releaseId = `implementation-release.publication-${++sequence}` as never;
    await implementations.saveRelease(normalizeAssetImplementationRelease({releaseId, workspaceId, definitionRef: baseRef, version: "1.0.0", status: "published", trustLevel: "workspace-approved", facets: [{facetId: normalizeAssetImplementationFacetId("facet.status.logic"), kind: "logic", runtimeKind: "declarative-engine", entryKey: "backend.status", requiredCapabilities: [], compatibility: {definitionVersion: "1.0.0", hostApiRange: ">=1.0.0 <2.0.0", deploymentProfiles: ["local-desktop", "campus-server"]}}], packageDigest: `sha256:${"a".repeat(64)}`, evidenceArtifacts: [], createdAt: now(), publishedAt: now(), publishedBy: "publisher"}));
    const artifact = published.review!.sourceArtifact;
    const bundle = JSON.parse(new TextDecoder().decode(await artifacts.readVerified<Uint8Array>(workspaceId, artifact)));
    await backingResources.save({backingResourceId: `implementation-backing.publication-${sequence}`, origin: "authored", releaseId, definitionRef: baseRef, scope: "workspace", workspaceId, artifactWorkspaceId: workspaceId, sourceSnapshotId: published.review!.sourceSnapshotId, artifact, files: describeAssetImplementationBackingResourceFiles(bundle), createdAt: now(), createdBy: "publisher"});
    const created = derivedValue(await derived().create({workspaceId, baseDefinitionRef: baseRef, baseImplementationReleaseId: releaseId, derivedDefinitionRef: reference(`asset.customized-${++sequence}`), semanticPatch: {"display-name": "Customized status summary"}, actorId: "author"}));
    return derivedValue(await derived().review({workspaceId, customizationId: created.customizationId, expectedRevision: created.revision, actorId: "reviewer"}));
  }
  async function reviewedDefinition(record: {review?: {sourceArtifact: any}}): Promise<AssetDefinition> {
    const bundle = JSON.parse(new TextDecoder().decode(await artifacts.readVerified<Uint8Array>(workspaceId, record.review!.sourceArtifact)));
    return JSON.parse(bundle.files.find((file: any) => file.path === "other/definition.json").content);
  }
  return {root, documents, definitions, implementations, drafts, customizations, backingResources, artifacts, publisher, publication, studio, derived, reviewedStudio, reviewedDerived, reviewedDefinition, close: () => database?.close()};
}

/** Real transaction wrapper for fault injection; preserves the supplied transaction owner. */
export function hookTransactions(store: StructuredDocumentStore, hook: (transaction: StructuredDocumentStore) => StructuredDocumentStore, afterCommit?: () => void): StructuredDocumentStore {
  return new Proxy(store, {get(target, property) {
    if (property === "runInTransaction") return async (work: (transaction: StructuredDocumentStore) => Promise<unknown>) => {
      const result = await target.runInTransaction(tx => work(hook(tx)));
      afterCommit?.();
      return result;
    };
    const value = Reflect.get(target, property);
    return typeof value === "function" ? value.bind(target) : value;
  }});
}
