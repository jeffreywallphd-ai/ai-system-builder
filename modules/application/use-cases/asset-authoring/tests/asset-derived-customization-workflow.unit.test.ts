import { createOrganizationId } from "../../../../contracts/organization";
import { createLocalAssetDefinitionRepositoryAdapter } from "../../../../adapters/persistence/asset";
import { createStructuredAssetDefinitionPublication } from "../../../../adapters/persistence/asset-publication";
// These lifecycle fixtures explicitly admit their synthetic workspaces; real policy denials have separate composed coverage.
const workspaceAccess = { async authorize() {} };
import { createHash } from "node:crypto";

import { describe, expect, it } from "../../../../testing/node-test";
import { createInMemoryStructuredDocumentStore } from "../../../../adapters/persistence/shared";
import {
  createStructuredAssetImplementationBackingResourceRepository,
  createStructuredAssetImplementationRepository,
} from "../../../../adapters/persistence/asset-implementation";
import { createStructuredAssetDerivedCustomizationRepository } from "../../../../adapters/persistence/asset-authoring";
import { createAssetImplementationArtifactAdapter } from "../../../../adapters/storage/asset-implementation";
import { AssetDerivedCustomizationTargetCatalogService } from "../../../services/asset";
import type { AssetDefinitionRepositoryPort } from "../../../ports/asset";
import {
  ASSET_IMPLEMENTATION_BACKING_RESOURCE_MEDIA_TYPE,
  describeAssetImplementationBackingResourceFiles,
  normalizeAssetImplementationRelease,
  normalizeAssetImplementationRevocation,
  normalizeAssetImplementationRevocationId,
  normalizeSha256Digest,
  type AssetImplementationBackingResourceBundleV1,
} from "../../../../contracts/asset-implementation";
import { createWorkspaceId } from "../../../../contracts/workspace";
import { AssetDerivedCustomizationWorkflowUseCase } from "..";

describe("derived asset customization workflow", () => {
  it("lists 343 exact definitions through bounded fresh batches without queue fan-out", async () => {
    const fixture = await createFixture();
    const base = await fixture.definitions.getDefinition(fixture.baseRef);
    const original = await fixture.implementations.readRelease(fixture.releaseId, fixture.workspaceA);
    if (!base || !original) throw new Error("Missing synthetic base.");
    const releases = Array.from({length: 343}, (_, index) => ({...original,
      releaseId: `implementation-release.bulk.${index}` as never,
      definitionRef: {...fixture.baseRef, version: `1.0.${index}` as never},
    }));
    releases.push({...releases[0]!, releaseId: "implementation-release.bulk.duplicate" as never});
    const batches: number[] = []; let prefix = "Before";
    const targets = new AssetDerivedCustomizationTargetCatalogService({workspaceAccess,
      definitions: {...fixture.definitions,
        async getDefinition() {throw new Error("Single collection reads must not amplify the queue.");},
        async getDefinitions(references) {
          batches.push(references.length);
          expect(references.length <= 250).toBe(true);
          return references.map(reference => ({...base, version: reference.version!, displayName: `${prefix} ${reference.version}`}));
        },
      },
      implementations: {...fixture.implementations, async listReleases() {return releases;}},
      backingResources: fixture.backingResources, artifacts: fixture.artifacts,
    });
    const first = await targets.list({workspaceId: fixture.workspaceA, limit: 100, eligibility: "all"});
    expect(batches).toEqual([250, 93]);
    expect(first.targets.length).toBe(100); expect(first.nextCursor).toBe("100");
    expect(first.targets[0]?.displayName).toContain("Before");
    expect(first.targets.every(target => target.eligibility.code === "backing-resources-unavailable")).toBe(true);
    prefix = "After";
    const fresh = await targets.list({workspaceId: fixture.workspaceA, text: "After 1.0.342", eligibility: "all"});
    expect(fresh.targets.length).toBe(1); expect(fresh.targets[0]?.definitionRef.version).toBe("1.0.342");
    expect(batches).toEqual([250, 93, 250, 93]);
    const eligible = await targets.list({workspaceId: fixture.workspaceA, eligibility: "eligible"});
    expect(eligible.targets).toEqual([]);
  });

  it("keeps single-read compatibility sequential and retains missing exact definitions", async () => {
    const fixture = await createFixture();
    const original = await fixture.implementations.readRelease(fixture.releaseId, fixture.workspaceA);
    if (!original) throw new Error("Missing synthetic release.");
    let active = 0, maximum = 0, reads = 0;
    const targets = new AssetDerivedCustomizationTargetCatalogService({workspaceAccess,
      definitions: {...fixture.definitions, getDefinitions: undefined,
        async getDefinition(reference) {
          active++; reads++; maximum = Math.max(maximum, active);
          try {await new Promise(resolve => setImmediate(resolve)); return await fixture.definitions.getDefinition(reference);}
          finally {active--;}
        },
      },
      implementations: {...fixture.implementations, async listReleases() {return [original, ...[1, 2].map(index => ({...original,
        releaseId: `implementation-release.missing.${index}` as never, definitionRef: {...fixture.baseRef, version: `2.0.${index}` as never},
      }))];}},
      backingResources: fixture.backingResources, artifacts: fixture.artifacts,
    });
    const result = await targets.list({workspaceId: fixture.workspaceA, eligibility: "all"});
    expect(reads).toBe(3); expect(maximum).toBe(1);
    expect(result.targets.filter(target => target.eligibility.code === "definition-unavailable").length).toBe(2);
    expect(result.targets.filter(target => target.eligibility.eligible).length).toBe(1);
  });

  it("denies malformed exact-definition batches and authorizes before any batch read", async () => {
    const fixture = await createFixture();
    const base = await fixture.definitions.getDefinition(fixture.baseRef);
    if (!base) throw new Error("Missing synthetic definition.");
    let accessorReads = 0;
    const accessor = new Array(1); Object.defineProperty(accessor, "0", {get() {accessorReads++; return base;}});
    for (const invalid of [[], new Array(1), accessor, [{...base, version: "9.0.0"}], [{...base, definitionId: "asset.foreign"}]]) {
      const targets = new AssetDerivedCustomizationTargetCatalogService({workspaceAccess,
        definitions: {...fixture.definitions, async getDefinitions() {return invalid;}},
        implementations: fixture.implementations, backingResources: fixture.backingResources, artifacts: fixture.artifacts,
      });
      await expect(targets.list({workspaceId: fixture.workspaceA})).rejects.toThrow("Customization definition snapshot is invalid.");
    }
    expect(accessorReads).toBe(0);
    let reads = 0;
    const denied = new AssetDerivedCustomizationTargetCatalogService({workspaceAccess: {async authorize() {throw new Error("Denied synthetic workspace.");}},
      definitions: {...fixture.definitions, async getDefinitions() {reads++; return [base];}},
      implementations: fixture.implementations, backingResources: fixture.backingResources, artifacts: fixture.artifacts,
    });
    await expect(denied.list({workspaceId: fixture.workspaceB})).rejects.toThrow(); expect(reads).toBe(0);
  });

  it("owns earlier summary values while a later definition batch waits", {timeout: 5_000}, async () => {
    const fixture = await createFixture();
    const base = await fixture.definitions.getDefinition(fixture.baseRef);
    const original = await fixture.implementations.readRelease(fixture.releaseId, fixture.workspaceA);
    if (!base || !original) throw new Error("Missing synthetic base.");
    let entered!: () => void, release!: () => void;
    const secondBatch = new Promise<void>(done => {entered = done;});
    const resume = new Promise<void>(done => {release = done;});
    const releases = Array.from({length: 251}, (_, index) => ({...original,
      releaseId: `implementation-release.snapshot.${index}` as never,
      definitionRef: {...fixture.baseRef, version: `1.0.${index}` as never},
    }));
    let calls = 0, borrowed: any;
    const targets = new AssetDerivedCustomizationTargetCatalogService({workspaceAccess,
      definitions: {...fixture.definitions,
        async getDefinition() {throw new Error("Collection lookup must use the batch seam.");},
        async getDefinitions(references) {
          calls++;
          if (calls === 2) {entered(); await resume;}
          const values = references.map(reference => ({...base, version: reference.version!,
            displayName: reference.version === "1.0.0" ? "Original batch label" : "Other batch label",
          }));
          if (calls === 1) borrowed = values[0];
          return values;
        },
      },
      implementations: {...fixture.implementations, async listReleases() {return releases;}},
      backingResources: fixture.backingResources, artifacts: fixture.artifacts,
    });
    const pending = targets.list({workspaceId: fixture.workspaceA, text: "Original batch label", eligibility: "all"});
    try {
      await secondBatch;
      borrowed.displayName = "Changed batch label"; borrowed.description = "Changed description";
      borrowed.assetType = "model"; borrowed.assetFamily = "resource";
      release(); const result = await pending;
      expect(calls).toBe(2); expect(result.targets.length).toBe(1);
      expect(result.targets[0]?.displayName).toBe("Original batch label");
      expect(result.targets[0]?.description).toBe(base.description);
      expect(result.targets[0]?.assetType).toBe(base.assetType);
      expect(result.targets[0]?.assetFamily).toBe(base.assetFamily);
    } finally {release(); await pending;}
  });

  it("owns earlier summary values while a later compatibility single read waits", {timeout: 5_000}, async () => {
    const fixture = await createFixture();
    const base = await fixture.definitions.getDefinition(fixture.baseRef);
    const original = await fixture.implementations.readRelease(fixture.releaseId, fixture.workspaceA);
    if (!base || !original) throw new Error("Missing synthetic base.");
    let entered!: () => void, release!: () => void;
    const secondBatch = new Promise<void>(done => {entered = done;});
    const resume = new Promise<void>(done => {release = done;});
    const releases = Array.from({length: 2}, (_, index) => ({...original,
      releaseId: `implementation-release.single.snapshot.${index}` as never,
      definitionRef: {...fixture.baseRef, version: `1.0.${index}` as never},
    }));
    let calls = 0, borrowed: any;
    const targets = new AssetDerivedCustomizationTargetCatalogService({workspaceAccess,
      definitions: {...fixture.definitions,
        getDefinitions: undefined,
        async getDefinition(reference) {
          calls++;
          if (calls === 2) {entered(); await resume;}
          const value = {...base, version: reference.version!,
            displayName: reference.version === "1.0.0" ? "Original single label" : "Other single label"};
          if (calls === 1) borrowed = value;
          return value;
        },
      },
      implementations: {...fixture.implementations, async listReleases() {return releases;}},
      backingResources: fixture.backingResources, artifacts: fixture.artifacts,
    });
    const pending = targets.list({workspaceId: fixture.workspaceA, text: "Original single label", eligibility: "all"});
    try {
      await secondBatch;
      borrowed.displayName = "Changed single label"; borrowed.description = "Changed description";
      borrowed.assetType = "model"; borrowed.assetFamily = "resource";
      release(); const result = await pending;
      expect(calls).toBe(2); expect(result.targets.length).toBe(1);
      expect(result.targets[0]?.displayName).toBe("Original single label");
      expect(result.targets[0]?.description).toBe(base.description);
      expect(result.targets[0]?.assetType).toBe(base.assetType);
      expect(result.targets[0]?.assetFamily).toBe(base.assetFamily);
    } finally {release(); await pending;}
  });

  it("searches exact targets and publishes a distinct restart-safe copy with materialized resources", async () => {
    const fixture = await createFixture();
    const listed = await fixture.targets.list({
      workspaceId: fixture.workspaceA,
      text: "base tool",
      eligibility: "eligible",
    });
    expect(listed.targets.length).toBe(1);
    expect(listed.targets[0]?.sourceKind).toBe("workspace-imported-asset");
    expect(listed.targets[0]?.resources.frontendStructure).toBe(1);
    expect(listed.targets[0]?.resources.frontendStyle).toBe(1);
    expect(listed.targets[0]?.resources.backendLogic).toBe(1);

    const detail = await fixture.targets.read({
      workspaceId: fixture.workspaceA,
      definitionRef: fixture.baseRef,
      implementationReleaseId: fixture.releaseId,
    });
    expect(
      detail?.backingResources.find(
        (resource) => resource.path === "backend/logic.ts",
      )?.content,
    ).toContain("base");
    expect(
      detail?.backingResources.find(
        (resource) => resource.path === "other/definition.json",
      )?.editable,
    ).toBe(false);

    const created = await fixture.workflow.create({
      workspaceId: fixture.workspaceA,
      baseDefinitionRef: fixture.baseRef,
      baseImplementationReleaseId: fixture.releaseId,
      derivedDefinitionRef: fixture.derivedRef,
      semanticPatch: {
        "display-name": "Customized tool",
        description: "Workspace-owned customized tool.",
        "safe-metadata": { purpose: "workspace-review" },
      },
      sourceChanges: [
        {
          operation: "upsert",
          path: "backend/logic.ts",
          role: "backend-logic",
          mediaType: "text/typescript",
          content: "export const behavior = 'customized';",
        },
      ],
      actorId: "actor-a",
    });
    expect(created.kind).toBe("success");
    if (created.kind !== "success") return;
    expect(created.value.base.sourceArtifact.digest).toBe(
      fixture.baseArtifactDigest,
    );

    const stale = await fixture.workflow.update({
      workspaceId: fixture.workspaceA,
      customizationId: created.value.customizationId,
      expectedRevision: 99,
      semanticPatch: created.value.semanticPatch,
      actorId: "actor-a",
    });
    expect(stale.kind).toBe("failure");
    if (stale.kind === "failure") expect(stale.failure.code).toBe("conflict");

    const reviewed = await fixture.workflow.review({
      workspaceId: fixture.workspaceA,
      customizationId: created.value.customizationId,
      expectedRevision: 1,
      actorId: "reviewer-a",
    });
    expect(reviewed.kind).toBe("success");
    if (reviewed.kind !== "success") return;
    expect(reviewed.value.status).toBe("reviewed");
    expect(Boolean(reviewed.value.review?.implementationDraftId)).toBe(true);

    const published = await fixture.workflow.publish({
      workspaceId: fixture.workspaceA,
      customizationId: created.value.customizationId,
      expectedRevision: 2,
      actorId: "publisher-a",
    });
    expect(published.kind).toBe("success");
    if (published.kind !== "success") return;
    expect(published.value.status).toBe("published");
    expect(published.value.publication?.definitionRef).toEqual(
      fixture.derivedRef,
    );

    const baseAfter = await fixture.definitions.getDefinition(fixture.baseRef);
    const derived = await fixture.definitions.getDefinition(fixture.derivedRef);
    expect(baseAfter?.displayName).toBe("Base Tool");
    expect(derived?.displayName).toBe("Customized tool");
    expect(derived?.provenance.derivedFromRefs).toEqual([fixture.baseRef]);
    expect((derived?.metadata as any)?.purpose).toBe("workspace-review");
    expect(
      (await fixture.implementations.listReleases(fixture.workspaceA)).length,
    ).toBe(1);

    const snapshot = await fixture.implementations.readSourceSnapshot(
      fixture.workspaceA,
      published.value.publication!.sourceSnapshotId,
    );
    const snapshotBytes = await fixture.artifacts.readVerified<Uint8Array>(
      fixture.workspaceA,
      snapshot!.artifact,
    );
    const materialized = JSON.parse(new TextDecoder().decode(snapshotBytes));
    expect(
      materialized.files.find((file: any) => file.path === "backend/logic.ts")
        .content,
    ).toContain("customized");

    const restarted = createStructuredAssetDerivedCustomizationRepository(
      fixture.documents,
    );
    const history = await restarted.list({ workspaceId: fixture.workspaceA });
    expect(history.records[0]?.status).toBe("published");
    const reopened = await restarted.read(fixture.workspaceA, published.value.customizationId);
    expect(reopened?.base).toEqual(published.value.base);
    expect(reopened?.semanticPatch).toEqual(published.value.semanticPatch);
    expect(reopened?.sourceOverlay).toEqual(published.value.sourceOverlay);
    expect(reopened?.publication).toEqual(published.value.publication);
    const restartedImplementations = createStructuredAssetImplementationRepository(fixture.documents);
    const restartedArtifacts = createAssetImplementationArtifactAdapter(fixture.artifactStorage);
    const reopenedSnapshot = await restartedImplementations.readSourceSnapshot(fixture.workspaceA, reopened!.publication!.sourceSnapshotId);
    expect(reopenedSnapshot?.artifact).toEqual(snapshot!.artifact);
    const reopenedBytes = await restartedArtifacts.readVerified<Uint8Array>(fixture.workspaceA, reopenedSnapshot!.artifact);
    expect(Array.from(reopenedBytes)).toEqual(Array.from(snapshotBytes));
    expect(JSON.parse(new TextDecoder().decode(reopenedBytes))).toEqual(materialized);
    expect((await restartedImplementations.listReleases(fixture.workspaceA)).length).toBe(1);
    expect(await restartedImplementations.readSourceSnapshot(fixture.workspaceB, reopened!.publication!.sourceSnapshotId)).toBeUndefined();
    expect(
      (await restarted.list({ workspaceId: fixture.workspaceB })).records
        .length,
    ).toBe(0);
    expect(
      await restarted.read(fixture.workspaceB, published.value.customizationId),
    ).toBeUndefined();
  });
  it("customizes a System Foundation base without mutating it and rediscovers the published copy after restart", async () => {
    const fixture = await createFixture("system-foundation");
    const listed = await fixture.targets.list({
      workspaceId: fixture.workspaceA,
      text: "base tool",
      eligibility: "eligible",
    });
    expect(listed.targets.length).toBe(1);
    expect(listed.targets[0]?.sourceKind).toBe("system-owned-asset");

    const baseBefore = await fixture.definitions.getDefinition(fixture.baseRef);
    const created = await fixture.workflow.create({
      workspaceId: fixture.workspaceA,
      baseDefinitionRef: fixture.baseRef,
      baseImplementationReleaseId: fixture.releaseId,
      derivedDefinitionRef: fixture.derivedRef,
      semanticPatch: {
        "display-name": "Workspace System Tool",
        description: "A workspace-owned copy of a System Foundation asset.",
      },
      sourceChanges: [
        {
          operation: "upsert",
          path: "frontend/styles.css",
          role: "frontend-style",
          mediaType: "text/css",
          content: ".base { color: rebeccapurple; }",
        },
      ],
      actorId: "actor-a",
    });
    expect(created.kind).toBe("success");
    if (created.kind !== "success") return;

    const reviewed = await fixture.workflow.review({
      workspaceId: fixture.workspaceA,
      customizationId: created.value.customizationId,
      expectedRevision: 1,
      actorId: "reviewer-a",
    });
    expect(reviewed.kind).toBe("success");
    if (reviewed.kind !== "success") return;
    const published = await fixture.workflow.publish({
      workspaceId: fixture.workspaceA,
      customizationId: created.value.customizationId,
      expectedRevision: 2,
      actorId: "publisher-a",
    });
    expect(published.kind).toBe("success");
    if (published.kind !== "success") return;

    expect(await fixture.definitions.getDefinition(fixture.baseRef)).toEqual(
      baseBefore,
    );
    expect(
      (await fixture.definitions.getDefinition(fixture.derivedRef))
        ?.displayName,
    ).toBe("Workspace System Tool");
    const restarted = createStructuredAssetDerivedCustomizationRepository(
      fixture.documents,
    );
    const rediscovered = await restarted.list({
      workspaceId: fixture.workspaceA,
      status: "published",
    });
    expect(rediscovered.records.length).toBe(1);
    expect(rediscovered.records[0]?.derivedDefinitionRef).toEqual(
      fixture.derivedRef,
    );
  });
  it("clears a reverted source overlay before review and publishes the exact base resources", async () => {
    const fixture = await createFixture();
    const created = await fixture.workflow.create({
      workspaceId: fixture.workspaceA,
      baseDefinitionRef: fixture.baseRef,
      baseImplementationReleaseId: fixture.releaseId,
      derivedDefinitionRef: fixture.derivedRef,
      semanticPatch: { "display-name": "Customized tool" },
      sourceChanges: [{
        operation: "upsert",
        path: "backend/logic.ts",
        role: "backend-logic",
        mediaType: "text/typescript",
        content: "export const behavior = 'temporary edit';",
      }],
      actorId: "actor-a",
    });
    expect(created.kind).toBe("success");
    if (created.kind !== "success") return;

    const reverted = await fixture.workflow.update({
      workspaceId: fixture.workspaceA,
      customizationId: created.value.customizationId,
      expectedRevision: 1,
      semanticPatch: created.value.semanticPatch,
      clearSourceOverlay: true,
      actorId: "actor-a",
    });
    expect(reverted.kind).toBe("success");
    if (reverted.kind !== "success") return;
    expect(reverted.value.sourceOverlay).toBeUndefined();

    const reviewed = await fixture.workflow.review({
      workspaceId: fixture.workspaceA,
      customizationId: reverted.value.customizationId,
      expectedRevision: 2,
      actorId: "reviewer-a",
    });
    if (reviewed.kind !== "success") {
      throw new Error(JSON.stringify(reviewed.failure));
    }
    expect(reviewed.kind).toBe("success");
    const published = await fixture.workflow.publish({
      workspaceId: fixture.workspaceA,
      customizationId: reviewed.value.customizationId,
      expectedRevision: 3,
      actorId: "publisher-a",
    });
    expect(published.kind).toBe("success");
    if (published.kind !== "success") return;

    const snapshot = await fixture.implementations.readSourceSnapshot(
      fixture.workspaceA,
      published.value.publication!.sourceSnapshotId,
    );
    const snapshotBytes = await fixture.artifacts.readVerified<Uint8Array>(
      fixture.workspaceA,
      snapshot!.artifact,
    );
    const materialized = JSON.parse(new TextDecoder().decode(snapshotBytes));
    expect(
      materialized.files.find((file: any) => file.path === "backend/logic.ts")
        .content,
    ).toContain("base");
    expect(JSON.stringify(materialized)).not.toContain("temporary edit");
  });
  it("fails closed when a base is revoked or revocation truth is unavailable", async () => {
    const revokedFixture = await createFixture();
    await revokedFixture.implementations.saveRevocation(
      normalizeAssetImplementationRevocation({
        revocationId: normalizeAssetImplementationRevocationId("implementation-revocation.base-tool.1"),
        releaseId: revokedFixture.releaseId,
        reasonCode: "qualification-revoked",
        message: "Revoked by the qualification fixture.",
        revokedAt: "2026-07-18T14:00:00.000Z",
        revokedBy: "security-reviewer",
      }),
    );
    const revokedTargets = await revokedFixture.targets.list({
      workspaceId: revokedFixture.workspaceA,
      eligibility: "all",
    });
    expect(revokedTargets.targets[0]?.eligibility.eligible).toBe(false);
    expect(revokedTargets.targets[0]?.eligibility.message).toContain("revoked");

    const attempted = await revokedFixture.workflow.create({
      workspaceId: revokedFixture.workspaceA,
      baseDefinitionRef: revokedFixture.baseRef,
      baseImplementationReleaseId: revokedFixture.releaseId,
      derivedDefinitionRef: revokedFixture.derivedRef,
      semanticPatch: { "display-name": "Revoked copy" },
      actorId: "actor-a",
    });
    expect(attempted.kind).toBe("failure");

    const unavailableFixture = await createFixture();
    const unavailableTargets =
      new AssetDerivedCustomizationTargetCatalogService({ workspaceAccess,
        definitions: unavailableFixture.definitions,
        implementations: {
          ...unavailableFixture.implementations,
          async listRevocations() {
            throw new Error("sensitive persistence failure");
          },
        },
        backingResources: unavailableFixture.backingResources,
        artifacts: unavailableFixture.artifacts,
      });
    const unavailable = await unavailableTargets.list({
      workspaceId: unavailableFixture.workspaceA,
      eligibility: "all",
    });
    expect(unavailable.targets[0]?.eligibility.eligible).toBe(false);
    expect(unavailable.targets[0]?.eligibility.message).toBe(
      "Implementation revocation status is unavailable.",
    );
    expect(JSON.stringify(unavailable)).not.toContain("sensitive persistence");
  });

  it("fails closed for cross-workspace bases and read-only compiled resources", async () => {
    const fixture = await createFixture();
    const hidden = await fixture.targets.read({
      workspaceId: fixture.workspaceB,
      definitionRef: fixture.baseRef,
      implementationReleaseId: fixture.releaseId,
    });
    expect(hidden).toBeUndefined();

    const created = await fixture.workflow.create({
      workspaceId: fixture.workspaceA,
      baseDefinitionRef: fixture.baseRef,
      baseImplementationReleaseId: fixture.releaseId,
      derivedDefinitionRef: fixture.derivedRef,
      semanticPatch: { "display-name": "Unsafe edit attempt" },
      sourceChanges: [
        {
          operation: "upsert",
          path: "frontend/compiled.js" as never,
          role: "frontend-structure",
          mediaType: "text/javascript",
          content: "export default 'changed';",
        },
      ],
      actorId: "actor-a",
    });
    expect(created.kind).toBe("failure");
  });
});

async function createFixture(
  origin: "admitted-package" | "system-foundation" = "admitted-package",
) {
  const documents = createInMemoryStructuredDocumentStore().forOrganization(createOrganizationId("asset-publication.fixture"));
  const implementations =
    createStructuredAssetImplementationRepository(documents);
  const backingResources =
    createStructuredAssetImplementationBackingResourceRepository(documents);
  const customizations =
    createStructuredAssetDerivedCustomizationRepository(documents);
  const artifactStorage = memoryStorage();
  const artifacts = createAssetImplementationArtifactAdapter(artifactStorage);
  const definitions = createLocalAssetDefinitionRepositoryAdapter({rootDir: ".", documents});
  const publication = createStructuredAssetDefinitionPublication({artifacts, documents, ownerDocuments: documents, definitionScope: "organization"});
  const workspaceA = createWorkspaceId("workspace-a");
  const workspaceB = createWorkspaceId("workspace-b");
  const baseRef = {
    kind: "asset-definition-version",
    id: "asset.base-tool" as never,
    version: "1.0.0" as never,
  } as const;
  const derivedRef = {
    kind: "asset-definition-version",
    id: "asset.custom-tool" as never,
    version: "1.0.0" as never,
  } as const;
  const releaseId = "implementation-release.base-tool.1" as never;
  const definition = {
    definitionId: baseRef.id,
    assetType: "tool",
    assetFamily: "behavioral",
    version: baseRef.version,
    displayName: "Base Tool",
    description: "Base tool used for derived customization tests.",
    lifecycleStatus: "published",
    reviewStatus: "approved",
    provenance: {
      sourceKind:
        origin === "system-foundation" ? "system-generated" : "imported",
      createdAt: "2026-07-18T12:00:00.000Z",
      createdBy:
        origin === "system-foundation"
          ? "system-foundation-installer"
          : "package-admission",
    },
    aiContext: {
      purpose: "Exercise a bounded test behavior.",
      userFacingSummary: "A base test tool.",
      developerFacingSummary: "A deterministic test fixture.",
      capabilities: ["test-behavior"],
      limitations: ["Test-only fixture."],
    },
  } as const;
  await definitions.saveDefinition(definition as any);

  const bundle: AssetImplementationBackingResourceBundleV1 = {
    formatVersion: "1.0",
    files: [
      {
        path: "frontend/view.tsx",
        role: "frontend-structure",
        mediaType: "text/typescript-jsx",
        content: "export const View = () => 'base';",
      },
      {
        path: "frontend/styles.css",
        role: "frontend-style",
        mediaType: "text/css",
        content: ".base { color: blue; }",
      },
      {
        path: "backend/logic.ts",
        role: "backend-logic",
        mediaType: "text/typescript",
        content: "export const behavior = 'base';",
      },
      {
        path: "frontend/compiled.js",
        role: "other",
        mediaType: "text/javascript",
        content: "export default 'compiled';",
      },
      {
        path: "other/definition.json",
        role: "other",
        mediaType: "application/json",
        content: JSON.stringify(definition, null, 2),
      },
    ],
  };
  const baseArtifact = await artifacts.putImmutable({
    workspaceId: workspaceA,
    kind: "source",
    mediaType: ASSET_IMPLEMENTATION_BACKING_RESOURCE_MEDIA_TYPE,
    content: JSON.stringify(bundle),
  });
  const release = normalizeAssetImplementationRelease({
    releaseId,
    workspaceId: workspaceA,
    definitionRef: baseRef,
    version: "1.0.0",
    status: "published",
    trustLevel: "workspace-approved",
    facets: [
      {
        facetId: "facet.base-tool.logic" as never,
        kind: "logic",
        runtimeKind: "declarative-engine",
        entryKey: "backend.logic",
        requiredCapabilities: [],
        compatibility: {
          definitionVersion: "1.0.0",
          hostApiRange: ">=1.0.0 <2.0.0",
          deploymentProfiles: ["local-desktop", "campus-server"],
        },
      },
    ],
    packageDigest: `sha256:${"a".repeat(64)}`,
    evidenceArtifacts: [],
    createdAt: "2026-07-18T12:00:00.000Z",
    publishedAt: "2026-07-18T12:00:00.000Z",
    publishedBy: "package-admission",
  });
  await implementations.saveRelease(release);
  await backingResources.save({
    backingResourceId: "implementation-backing.base-tool.1",
    origin,
    releaseId,
    definitionRef: baseRef,
    scope: "workspace",
    workspaceId: workspaceA,
    artifactWorkspaceId: workspaceA,
    sourceSnapshotId: "source-snapshot.base-tool.1" as never,
    artifact: baseArtifact,
    files: describeAssetImplementationBackingResourceFiles(bundle),
    createdAt: "2026-07-18T12:00:00.000Z",
    createdBy:
      origin === "system-foundation"
        ? "system-foundation-installer"
        : "package-admission",
  });
  const targets = new AssetDerivedCustomizationTargetCatalogService({ workspaceAccess,
    definitions,
    implementations,
    backingResources,
    artifacts,
  });
  let tick = 0;
  const workflow = new AssetDerivedCustomizationWorkflowUseCase({ publication, workspaceAccess,
    customizations,
    targets,
    definitions,
    implementations,
    artifacts,
    digestText: (value) =>
      normalizeSha256Digest(
        `sha256:${createHash("sha256").update(value).digest("hex")}`,
      ),
    nextCustomizationId: () => "customization.asset.1",
    now: () => new Date(Date.UTC(2026, 6, 18, 13, 0, tick++)).toISOString(),
  });
  return {
    documents,
    implementations,
    artifacts,
    artifactStorage,
    definitions,
    backingResources,
    targets,
    workflow,
    workspaceA,
    workspaceB,
    baseRef,
    derivedRef,
    releaseId,
    baseArtifactDigest: baseArtifact.digest,
  };
}

function memoryDefinitions(): AssetDefinitionRepositoryPort {
  const values = new Map<string, any>();
  return {
    async saveDefinition(value) {
      const key = `${value.definitionId}@${value.version}`;
      const existing = values.get(key);
      if (existing && JSON.stringify(existing) !== JSON.stringify(value)) {
        throw new Error("definition conflict");
      }
      values.set(key, structuredClone(value));
      return structuredClone(value);
    },
    async getDefinition(reference) {
      return structuredClone(
        values.get(`${reference.id}@${reference.version}`),
      );
    },
    async listDefinitions() {
      return { definitions: structuredClone([...values.values()]) };
    },
  };
}

function memoryStorage() {
  const values = new Map<string, Uint8Array>();
  return {
    async storeArtifact(request: any) {
      if (values.has(request.descriptor.key)) {
        return {
          ok: false as const,
          error: { code: "conflict", message: "exists" },
        };
      }
      values.set(request.descriptor.key, Uint8Array.from(request.content));
      return { ok: true as const, value: { descriptor: request.descriptor } };
    },
    async retrieveArtifact(request: any) {
      const value = values.get(request.key);
      return value
        ? {
            ok: true as const,
            value: {
              descriptor: {
                key: request.key,
                mediaType: "application/octet-stream",
                sizeBytes: value.byteLength,
                checksum: {
                  algorithm: "sha256",
                  value: createHash("sha256").update(value).digest("hex"),
                },
              },
              content: value,
            },
          }
        : {
            ok: false as const,
            error: { code: "not-found", message: "missing" },
          };
    },
  } as any;
}
