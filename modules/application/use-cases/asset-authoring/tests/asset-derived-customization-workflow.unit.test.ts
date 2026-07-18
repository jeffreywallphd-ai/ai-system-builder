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
  normalizeSha256Digest,
  type AssetImplementationBackingResourceBundleV1,
} from "../../../../contracts/asset-implementation";
import { createWorkspaceId } from "../../../../contracts/workspace";
import { AssetDerivedCustomizationWorkflowUseCase } from "..";

describe("derived asset customization workflow", () => {
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
  it("fails closed when a base is revoked or revocation truth is unavailable", async () => {
    const revokedFixture = await createFixture();
    await revokedFixture.implementations.saveRevocation(
      normalizeAssetImplementationRevocation({
        revocationId: "implementation-revocation.base-tool.1",
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
      new AssetDerivedCustomizationTargetCatalogService({
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
  const documents = createInMemoryStructuredDocumentStore();
  const implementations =
    createStructuredAssetImplementationRepository(documents);
  const backingResources =
    createStructuredAssetImplementationBackingResourceRepository(documents);
  const customizations =
    createStructuredAssetDerivedCustomizationRepository(documents);
  const artifacts = createAssetImplementationArtifactAdapter(memoryStorage());
  const definitions = memoryDefinitions();
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
  const targets = new AssetDerivedCustomizationTargetCatalogService({
    definitions,
    implementations,
    backingResources,
    artifacts,
  });
  let tick = 0;
  const workflow = new AssetDerivedCustomizationWorkflowUseCase({
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
