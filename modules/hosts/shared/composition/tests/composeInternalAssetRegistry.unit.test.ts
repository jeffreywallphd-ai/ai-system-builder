import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import type { AssetDefinition, AssetReference, AssetResourceBackedView } from "../../../../contracts/asset";
import { normalizeAssetId } from "../../../../contracts/asset";
import { createWorkspaceId } from "../../../../contracts/workspace";
import type { AssetResourceBackedViewListQuery, AssetResourceBackedViewListResult, AssetResourceBackedViewProvider } from "../../../../application/ports/asset";
import { BuiltInAssetDefinitionSeedingService } from "../../../../application/services/asset/built-in-asset-definition-seeding.service";
import { AssetRegistryReadFacade, AssetRegistryReadFacadeError } from "../../../../application/services/asset/asset-registry-read-facade.service";
import { BUILT_IN_ASSET_DEFINITION_CATALOG } from "../../../../application/services/asset/built-ins";
import { SYSTEM_FOUNDATION_PACK_MANIFEST } from "../../../../application/services/asset-packs";
import { composeInternalAssetRegistry } from "../composeInternalAssetRegistry";
import {createInMemoryStructuredDocumentStore} from "../../../../adapters/persistence/shared";
import {LocalAssetAuthoringRecordStore} from "../../../../adapters/persistence/asset-authoring";
import {createOrganizationId} from "../../../../contracts/organization";
import { createStructuredAssetStudioAssetDraftRepository } from "../../../../adapters/persistence/asset-studio/createStructuredAssetStudioAssetDraftRepository";
import type { AssetStudioAssetDraftRecord } from "../../../../contracts/asset-studio";
import { ASSET_IMPLEMENTATION_BACKING_RESOURCE_MEDIA_TYPE } from "../../../../contracts/asset-implementation";
import { createStructuredAssetDerivedCustomizationRepository } from "../../../../adapters/persistence/asset-authoring/createStructuredAssetDerivedCustomizationRepository";
import type { AssetDerivedCustomizationDraftRecord } from "../../../../contracts/asset-authoring";

it("rediscovers exact published Studio and derived versions after recomposition only in their owning organization and workspace", async () => {
  const store = createInMemoryStructuredDocumentStore();
  const organizationA = store.forOrganization(createOrganizationId("organization.studio-a"));
  const organizationB = store.forOrganization(createOrganizationId("organization.studio-b"));
  const compose = (documents: typeof organizationA) => composeInternalAssetRegistry({rootDirectory: "studio-visibility-fixture", documents, definitionDocuments: store});
  const first = compose(organizationA);
  const foreign = compose(organizationB);
  const owner = createWorkspaceId("workspace.studio-owner");
  const other = createWorkspaceId("workspace.studio-other");
  for (const [registry, workspaceId, organizationId] of [[first, owner, organizationA.organizationId],
    [first, other, organizationA.organizationId], [foreign, owner, organizationB.organizationId]] as const) {
    await registry.workspaceUseCases.createWorkspace.execute({command: {displayName: "Studio fixture"},
      organizationId: organizationId!, generateWorkspaceId: () => workspaceId});
  }
  const published = validDefinition({definitionId: "studio.visibility.published", lifecycleStatus: "published"});
  const unpublished = validDefinition({definitionId: "studio.visibility.unpublished", lifecycleStatus: "published",
    metadata: {workspaceId: owner, sourceKind: "workspace-authored"}});
  const derived = validDefinition({definitionId: "studio.visibility.derived", lifecycleStatus: "published"});
  for (const definition of [published, unpublished, derived]) await first.assetKernel.repositories.definitionRepository.saveDefinition(definition);
  const repository = createStructuredAssetStudioAssetDraftRepository(organizationA);
  await repository.create(studioVisibilityRecord(owner, published, true));
  await repository.create(studioVisibilityRecord(owner, unpublished, false));
  await createStructuredAssetDerivedCustomizationRepository(organizationA).create(derivedVisibilityRecord(owner, derived));
  const restarted = compose(organizationA);
  const ref = {kind: "asset-definition-version", id: published.definitionId, version: published.version} as AssetReference;
  assert.deepEqual((await restarted.workspaceReadFacade.listDefinitionCards({workspaceId: owner, searchText: "studio.visibility"})).items.map(card => card.definitionId).sort(), [derived.definitionId, published.definitionId].sort());
  assert.equal((await restarted.workspaceReadFacade.readDefinitionDetail(ref, {workspaceId: owner}))?.definition.definitionId, published.definitionId);
  const derivedRef = {...ref, id: normalizeAssetId(derived.definitionId)};
  assert.equal((await restarted.workspaceReadFacade.readDefinitionDetail(derivedRef, {workspaceId: owner}))?.definition.definitionId, derived.definitionId);
  for (const [registry, workspaceId] of [[restarted, other], [foreign, owner]] as const) {
    assert.equal((await registry.workspaceReadFacade.listDefinitionCards({workspaceId, searchText: "studio.visibility"})).items.length, 0);
    await assert.rejects(registry.workspaceReadFacade.readDefinitionDetail(ref, {workspaceId}), /workspace effective asset view/);
    await assert.rejects(registry.workspaceReadFacade.readDefinitionDetail(derivedRef, {workspaceId}), /workspace effective asset view/);
  }
  await assert.rejects(restarted.workspaceReadFacade.readDefinitionDetail({...ref, id: normalizeAssetId(unpublished.definitionId)}, {workspaceId: owner}), /workspace effective asset view/);
});

function studioVisibilityRecord(workspaceId: ReturnType<typeof createWorkspaceId>, definition: AssetDefinition, published: boolean): AssetStudioAssetDraftRecord {
  const time = "2026-10-22T00:00:00Z";
  const ref = {kind: "asset-definition-version", id: definition.definitionId, version: definition.version} as AssetReference;
  const artifact = {artifactId: "artifact.studio-visibility" as never, kind: "source" as const,
    digest: `sha256:${"a".repeat(64)}` as never, mediaType: ASSET_IMPLEMENTATION_BACKING_RESOURCE_MEDIA_TYPE, sizeBytes: 120};
  const snapshot = "source-snapshot.studio-visibility" as never;
  const implementationDraftId = "implementation.studio-visibility" as never;
  return {draftId: `studio-draft.${definition.definitionId}` as never, workspaceId, definitionRef: ref,
    semanticDefinition: {displayName: definition.displayName, description: definition.description!, assetType: definition.assetType, assetFamily: definition.assetFamily},
    implementationDraftId, source: {artifact, files: [{path: "backend/logic.ts", role: "backend-logic", mediaType: "text/typescript", sizeCharacters: 0, editable: true}], totalCharacters: 0},
    status: published ? "published" : "draft", revision: published ? 3 : 1,
    provenance: {kind: "studio-from-scratch", createdAt: time, createdBy: "fixture-author"},
    ...(published ? {review: {sourceSnapshotId: snapshot, sourceArtifact: artifact, materializedFromRevision: 1, materializedAt: time, materializedBy: "fixture-reviewer"},
      publication: {definitionRef: ref, implementationDraftId, sourceSnapshotId: snapshot, publishedAt: time, publishedBy: "fixture-publisher"}} : {}),
    createdAt: time, updatedAt: time, createdBy: "fixture-author"};
}

function derivedVisibilityRecord(workspaceId: ReturnType<typeof createWorkspaceId>, definition: AssetDefinition): AssetDerivedCustomizationDraftRecord {
  const studio = studioVisibilityRecord(workspaceId, definition, true);
  const base = {definitionRef: {kind: "asset-definition-version", id: "base.visibility", version: "1.0.0"} as AssetReference,
    implementationReleaseId: "implementation-release.visibility-base" as never, sourceSnapshotId: "source-snapshot.visibility-base" as never, sourceArtifact: studio.source.artifact};
  return {customizationId: "customization.visibility" as never, workspaceId, base, derivedDefinitionRef: studio.definitionRef,
    semanticPatch: {"display-name": definition.displayName}, status: "published", revision: 3,
    provenance: {kind: "layered-derived-customization", sourceKind: "system-owned-asset", baseDefinitionRef: base.definitionRef,
      baseImplementationReleaseId: base.implementationReleaseId, baseSourceSnapshotId: base.sourceSnapshotId, derivedAt: studio.createdAt, derivedBy: studio.createdBy},
    review: {...studio.review!, materializedFromRevision: 2, implementationDraftId: studio.implementationDraftId, semanticPatchDigest: `sha256:${"b".repeat(64)}` as never},
    publication: studio.publication, createdAt: studio.createdAt, updatedAt: studio.updatedAt, createdBy: studio.createdBy};
}

it("composes published authored definitions only into their owning workspace and organization",async()=>{
  const root=createInMemoryStructuredDocumentStore();
  const a=root.forOrganization(createOrganizationId("organization.a"));
  const b=root.forOrganization(createOrganizationId("organization.b"));
  const primary=composeInternalAssetRegistry({rootDirectory:"shared-authoring-fixture",documents:a,definitionDocuments:root});
  const foreign=composeInternalAssetRegistry({rootDirectory:"shared-authoring-fixture",documents:b,definitionDocuments:root});
  const workspaceId=createWorkspaceId("workspace.authored");const foreignWorkspaceId=createWorkspaceId("workspace.foreign");
  await primary.workspaceUseCases.createWorkspace.execute({command:{displayName:"Primary"},organizationId:createOrganizationId("organization.a"),generateWorkspaceId:()=>workspaceId});
  await foreign.workspaceUseCases.createWorkspace.execute({command:{displayName:"Foreign"},organizationId:createOrganizationId("organization.b"),generateWorkspaceId:()=>foreignWorkspaceId});
  const definition=validDefinition({definitionId:"workspace.published.component",assetType:"ui-component",assetFamily:"structural",lifecycleStatus:"published"});
  await primary.assetKernel.repositories.definitionRepository.saveDefinition(definition);
  const time="2026-10-21T00:00:00Z";
  const reference={kind:"asset-definition-version",id:definition.definitionId,version:definition.version} as AssetReference;
  const store=new LocalAssetAuthoringRecordStore({rootDir:"shared-authoring-fixture",documents:a});
  await store.writeCollection("authoredAssets",[{workspaceId,authoredAssetId:"authored.component",assetReference:reference,currentRevisionId:"revision.component",status:"published",editableValues:{"display-name":"Published component"},provenance:{kind:"authored-from-scratch",operationAt:time},createdAt:time,updatedAt:time}]);
  await store.writeCollection("revisions",[{workspaceId,authoredAssetId:"authored.component",revisionId:"revision.component",revision:"1.0.0",status:"published",editableValues:{"display-name":"Published component"},provenance:{kind:"revised-authored-asset",operationAt:time},createdAt:time,updatedAt:time,publishedAt:time}]);
  const result=await primary.workspaceReadFacade.listDefinitionCards({workspaceId,searchText:"workspace.published.component"});
  assert.deepEqual(result.items.map(item=>item.definitionId),[definition.definitionId]);
  const detail=await primary.workspaceReadFacade.readDefinitionDetail(reference,{workspaceId});
  assert.equal(detail?.definition.definitionId,definition.definitionId);
  assert.equal((await foreign.workspaceReadFacade.listDefinitionCards({workspaceId:foreignWorkspaceId,searchText:"workspace.published.component"})).items.length,0);
  await assert.rejects(foreign.workspaceReadFacade.readDefinitionDetail(reference,{workspaceId:foreignWorkspaceId}),/workspace effective asset view/);
  await assert.rejects(primary.workspaceReadFacade.listDefinitionCards({workspaceId:foreignWorkspaceId}));
});

const definitionRef: AssetReference = { kind: "asset-definition-version", id: "definition.internal", version: "1.0.0" } as AssetReference;

async function tempRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), "internal-asset-registry-composition-"));
}

function validDefinition(overrides: Partial<AssetDefinition> = {}): AssetDefinition {
  return {
    definitionId: "definition.internal",
    assetType: "tool",
    assetFamily: "behavioral",
    version: "1.0.0",
    displayName: "Internal Definition",
    description: "A valid internally composed definition.",
    lifecycleStatus: "draft",
    reviewStatus: "unreviewed",
    provenance: { sourceKind: "human-authored" },
    ...overrides,
  };
}

function validResourceBackedView(overrides: Partial<AssetResourceBackedView> = {}): AssetResourceBackedView {
  return {
    viewId: "view.internal.resource",
    viewKind: "artifact",
    assetType: "data-source",
    assetFamily: "resource-backed",
    assetDefinitionRef: { kind: "asset-definition", id: "builtin.artifact" } as AssetReference,
    displayName: "Internal Resource View",
    summary: "Computed test view from an injected provider seam.",
    lifecycleStatus: "draft",
    metadata: { safe: true, localPath: "/tmp/should-be-removed", token: "secret" },
    ...overrides,
  };
}

class TestResourceBackedViewProvider implements AssetResourceBackedViewProvider {
  public readonly providerId = "test-resource-backed-provider";
  public readonly queries: AssetResourceBackedViewListQuery[] = [];
  public listCalls = 0;
  public readCalls = 0;

  public constructor(private readonly views: readonly AssetResourceBackedView[]) {}

  public async listResourceBackedViews(query: AssetResourceBackedViewListQuery = {}) {
    this.listCalls += 1;
    this.queries.push(query);
    return { items: this.views, diagnostics: [{ severity: "info" as const, code: "test-provider-read", message: "Provider returned test views.", providerId: this.providerId }] };
  }

  public async readResourceBackedView(viewId: string): Promise<AssetResourceBackedView | undefined> {
    this.readCalls += 1;
    return this.views.find((view) => view.viewId === viewId);
  }
}

class ThrowingResourceBackedViewProvider implements AssetResourceBackedViewProvider {
  public async listResourceBackedViews(): Promise<AssetResourceBackedViewListResult> {
    throw new Error("/tmp/raw-provider-path token stack should not leak");
  }

  public async readResourceBackedView(): Promise<AssetResourceBackedView | undefined> {
    throw new Error("/tmp/raw-provider-path token stack should not leak");
  }
}

describe("composeInternalAssetRegistry", () => {
  it("composes local Asset Kernel repositories/use cases and the Asset Registry read facade", async () => {
    const composition = composeInternalAssetRegistry({ rootDirectory: await tempRoot(), now: () => "2026-05-07T00:00:00.000Z" });

    assert.equal(composition.readFacade instanceof AssetRegistryReadFacade, true);
    assert.equal(typeof composition.assetKernel.repositories.definitionRepository.listDefinitions, "function");
    assert.equal(typeof composition.assetKernel.useCases.registerAssetDefinition.execute, "function");
    assert.equal(typeof composition.assetPackInstaller.install, "function");
    assert.equal(typeof composition.installSystemFoundationPack.install, "function");
    assert.deepEqual(composition.diagnostics, {
      storeKind: "asset-kernel-local-store",
      schemaVersion: 1,
      registryFacadeComposed: true,
      resourceBackedViewsEnabled: false,
    });
  });

  it("accepts a host-owned root and initializes local persistence under the asset-kernel child directory", async () => {
    const rootDirectory = await tempRoot();
    assert.equal(existsSync(join(rootDirectory, "asset-kernel")), false);

    composeInternalAssetRegistry({ rootDirectory, now: () => "2026-05-07T00:00:00.000Z" });

    assert.equal((await stat(join(rootDirectory, "asset-kernel"))).isDirectory(), true);
    assert.deepEqual(JSON.parse(await readFile(join(rootDirectory, "asset-kernel", "definitions.json"), "utf8")), []);
  });

  it("keeps diagnostics sanitized and free of local filesystem details", async () => {
    const rootDirectory = await tempRoot();
    const composition = composeInternalAssetRegistry({ rootDirectory });

    assert.equal("rootDirectory" in composition.diagnostics, false);
    assert.equal("path" in composition.diagnostics, false);
    assert.equal("builtInCatalogDefinitionCount" in composition.diagnostics, false);
    assert.doesNotMatch(JSON.stringify(composition.diagnostics), /(?:\/tmp|[A-Za-z]:\\|\.\.\/|\.\/|secret|token|stack)/i);
  });

  it("registers a definition through composed use cases and reads it through the facade", async () => {
    const composition = composeInternalAssetRegistry({ rootDirectory: await tempRoot() });

    assert.equal((await composition.assetKernel.useCases.registerAssetDefinition.execute(validDefinition())).ok, true);

    const cards = await composition.readFacade.listDefinitionCards({ includeCustom: true });
    const detail = await composition.readFacade.readDefinitionDetail(definitionRef);
    assert.deepEqual(cards.items.map((card) => card.definitionId), ["definition.internal"]);
    assert.equal(detail?.definition.definitionId, "definition.internal");
  });

  it("can list explicitly seeded built-ins without seeding during helper composition", async () => {
    const composition = composeInternalAssetRegistry({ rootDirectory: await tempRoot(), now: () => "2026-05-07T00:00:00.000Z" });
    assert.equal((await composition.readFacade.listDefinitionCards({ includeBuiltIns: true })).items.length, 0);

    const seeding = new BuiltInAssetDefinitionSeedingService({
      definitionRepository: composition.assetKernel.repositories.definitionRepository,
      registerAssetDefinition: composition.assetKernel.useCases.registerAssetDefinition,
      now: () => "2026-05-07T00:00:00.000Z",
    });
    const result = await seeding.seedDefinitions(BUILT_IN_ASSET_DEFINITION_CATALOG.slice(0, 2));

    assert.equal(result.createdCount, 2);
    const cards = await composition.readFacade.listDefinitionCards({ includeBuiltIns: true, includeCustom: false });
    assert.deepEqual(cards.items.map((card) => card.builtIn), [true, true]);
  });

  it("serves the workspace Asset Library immediately after workspace creation", async () => {
    const composition = composeInternalAssetRegistry({
      rootDirectory: await tempRoot(),
      now: () => "2026-05-09T00:00:00.000Z",
    });
    const workspaceId = createWorkspaceId(
      "workspace.asset-library-composition",
    );
    const created = await composition.workspaceUseCases.createWorkspace.execute({
      command: { displayName: "Asset Library Workspace" },
      generateWorkspaceId: () => workspaceId,
      now: () => new Date("2026-05-09T00:00:00.000Z"),
    });

    assert.equal(created.status, "created");
    const result = await composition.workspaceReadFacade.listDefinitionCards({
      workspaceId,
      limit: 50,
    });

    assert.ok(result.items.length > 0);
    assert.ok(
      result.items.every(
        (item) =>
          item.sourcePackId === "system.foundation" &&
          item.sourceLayer === "system-default",
      ),
    );
  });

  it("does not install the system foundation pack during helper composition", async () => {
    const composition = composeInternalAssetRegistry({ rootDirectory: await tempRoot(), now: () => "2026-05-09T00:00:00.000Z" });

    assert.equal((await composition.assetKernel.repositories.definitionRepository.listDefinitions()).definitions.length, 0);

    const result = await composition.installSystemFoundationPack.install({
      mode: "validate-only",
      now: () => new Date("2026-05-09T00:00:00.000Z"),
    });

    assert.equal(result.status, "validated");
    assert.equal(result.checkedEntryCount, SYSTEM_FOUNDATION_PACK_MANIFEST.assets.length);
    assert.equal((await composition.assetKernel.repositories.definitionRepository.listDefinitions()).definitions.length, 0);
  });

  it("returns empty resource-backed results when no provider seam is supplied", async () => {
    const composition = composeInternalAssetRegistry({ rootDirectory: await tempRoot() });

    assert.deepEqual(await composition.readFacade.listResourceBackedViewCards(), { items: [] });
    assert.equal(await composition.readFacade.readResourceBackedViewDetail("missing"), undefined);
    assert.equal(composition.resourceBackedViewProvider, undefined);
    assert.equal(composition.diagnostics.resourceBackedViewsEnabled, false);
  });

  it("delegates resource-backed reads to an injected provider seam without scanning resources itself", async () => {
    const provider = new TestResourceBackedViewProvider([validResourceBackedView()]);
    const composition = composeInternalAssetRegistry({ rootDirectory: await tempRoot(), resourceBackedViewProvider: provider });

    const cards = await composition.readFacade.listResourceBackedViewCards({ searchText: "resource", includeMetadata: true, limit: 10 });
    const detail = await composition.readFacade.readResourceBackedViewDetail("view.internal.resource", { includeMetadata: true });

    assert.equal(composition.resourceBackedViewProvider, provider);
    assert.equal(composition.diagnostics.resourceBackedViewsEnabled, true);
    assert.equal(provider.listCalls, 1);
    assert.equal(provider.readCalls, 1);
    assert.deepEqual(provider.queries, [{ searchText: "resource", assetTypes: undefined, assetFamilies: undefined, lifecycleStatuses: undefined, viewKinds: undefined, limit: 10, cursor: undefined, workspaceId: undefined }]);
    assert.deepEqual(cards.items.map((card) => card.viewId), ["view.internal.resource"]);
    assert.equal(cards.diagnostics?.some((diagnostic) => diagnostic.code === "test-provider-read"), true);
    assert.equal(detail?.view.viewId, "view.internal.resource");
    assert.deepEqual(cards.items[0]?.metadata, { safe: true });
  });

  it("can wrap a deterministic list of resource-backed providers with the aggregate foundation", async () => {
    const first = new TestResourceBackedViewProvider([validResourceBackedView({ viewId: "view.first", displayName: "First View" })]);
    const second = new TestResourceBackedViewProvider([validResourceBackedView({ viewId: "view.second", displayName: "Second View" })]);
    const composition = composeInternalAssetRegistry({ rootDirectory: await tempRoot(), resourceBackedViewProviders: [first, second] });

    const cards = await composition.readFacade.listResourceBackedViewCards({ limit: 10 });

    assert.notEqual(composition.resourceBackedViewProvider, first);
    assert.deepEqual(cards.items.map((card) => card.viewId), ["view.first", "view.second"]);
    assert.equal(composition.diagnostics.resourceBackedViewsEnabled, true);
  });

  it("surfaces provider failures through sanitized facade errors", async () => {
    const composition = composeInternalAssetRegistry({ rootDirectory: await tempRoot(), resourceBackedViewProvider: new ThrowingResourceBackedViewProvider() });

    await assert.rejects(() => composition.readFacade.listResourceBackedViewCards(), (error: unknown) => {
      assert.equal(error instanceof AssetRegistryReadFacadeError, true);
      assert.equal((error as AssetRegistryReadFacadeError).code, "resource-backed-view-provider-failed");
      assert.doesNotMatch((error as Error).message, /(?:\/tmp|secret|token|stack|provider-path)/i);
      return true;
    });
  });

  it("does not import public transports, UI, runtime adapters, provider clients, or storage source readers", async () => {
    const source = await readFile(join(process.cwd(), "modules/hosts/shared/composition/composeInternalAssetRegistry.ts"), "utf8");

    assert.doesNotMatch(source, /adapters\/transport|ipc-electron|api-express|electron|express|preload|renderer|thin-client|apps\//i);
    assert.doesNotMatch(source, /runtime|runtime-readiness|runtime-task|huggingface|artifact\/(?!asset)|model\/huggingface|dataset|image\//i);
    assert.doesNotMatch(source, /readdir|readFile|opendir|glob|fetch|scan|crawler/i);
  });
});
