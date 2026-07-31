import { createHash } from "node:crypto";

import { describe, expect, it } from "../../../../testing/node-test";
import { createStructuredAssetImplementationRepository } from "../../../../adapters/persistence/asset-implementation";
import { createStructuredAssetStudioAssetDraftRepository } from "../../../../adapters/persistence/asset-studio";
import { createInMemoryStructuredDocumentStore } from "../../../../adapters/persistence/shared";
import { createAssetImplementationArtifactAdapter } from "../../../../adapters/storage/asset-implementation";
import type { AssetDefinitionRepositoryPort } from "../../../ports/asset";
import { createWorkspaceId } from "../../../../contracts/workspace";
import { ASSET_STUDIO_LIMITS } from "../../../../contracts/asset-studio";
import type { AssetImplementationBackingResourceFile } from "../../../../contracts/asset-implementation";
import { AssetStudioAssetDraftWorkflowUseCase } from "..";

describe("Studio asset draft workflow", () => {
  it("persists, reopens, reviews, and publishes complete resource-backed assets", async () => {
    const fixture = createFixture();
    const created = await fixture.workflow.create({
      workspaceId: fixture.workspaceA,
      definitionRef: fixture.definitionRef,
      semanticDefinition: semanticDefinition("Studio Tool"),
      resources: resources("initial"),
      sourceLegacyDraftId: "asset-draft.legacy-1" as never,
      actorId: "author-a",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.value.status).toBe("draft");
    expect(JSON.stringify(created.value)).not.toContain("initial backend");
    const repeatedLegacyUpgrade = await fixture.workflow.create({
      workspaceId: fixture.workspaceA,
      definitionRef: fixture.definitionRef,
      semanticDefinition: semanticDefinition("Studio Tool"),
      resources: resources("initial"),
      sourceLegacyDraftId: "asset-draft.legacy-1" as never,
      actorId: "author-a",
    });
    expect(repeatedLegacyUpgrade.ok).toBe(true);
    if (repeatedLegacyUpgrade.ok)
      expect(repeatedLegacyUpgrade.value.draftId).toBe(created.value.draftId);

    const opened = await fixture.workflow.read({
      workspaceId: fixture.workspaceA,
      draftId: created.value.draftId,
    });
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    expect(opened.value.resources).toEqual(resources("initial"));

    const hidden = await fixture.workflow.read({
      workspaceId: fixture.workspaceB,
      draftId: created.value.draftId,
    });
    expect(hidden.ok).toBe(false);
    if (!hidden.ok) {
      expect(hidden.error.code).toBe("asset-studio.asset-draft.not-found");
    }

    const restartedRepository = createStructuredAssetStudioAssetDraftRepository(
      fixture.documents,
    );
    const restarted = await restartedRepository.read(
      fixture.workspaceA,
      created.value.draftId,
    );
    expect(restarted?.semanticDefinition.displayName).toBe("Studio Tool");
    expect(
      (
        await restartedRepository.list({
          workspaceId: fixture.workspaceB,
          unpublishedOnly: true,
        })
      ).records,
    ).toEqual([]);

    const stale = await fixture.workflow.update({
      workspaceId: fixture.workspaceA,
      draftId: created.value.draftId,
      expectedRevision: 99,
      semanticDefinition: semanticDefinition("Stale"),
      resources: resources("stale"),
      actorId: "author-a",
    });
    expect(stale.ok).toBe(false);
    if (!stale.ok) {
      expect(stale.error.code).toBe("asset-studio.asset-draft.conflict");
    }

    const firstReview = await fixture.workflow.review({
      workspaceId: fixture.workspaceA,
      draftId: created.value.draftId,
      expectedRevision: 1,
      actorId: "reviewer-a",
    });
    expect(firstReview.ok).toBe(true);
    if (!firstReview.ok) return;
    expect(firstReview.value.status).toBe("reviewed");

    const updated = await fixture.workflow.update({
      workspaceId: fixture.workspaceA,
      draftId: created.value.draftId,
      expectedRevision: 2,
      semanticDefinition: semanticDefinition("Updated Studio Tool"),
      resources: resources("updated"),
      actorId: "author-a",
    });
    expect(updated.ok).toBe(true);
    if (!updated.ok) return;
    expect(updated.value.status).toBe("draft");
    expect(updated.value.review).toBeUndefined();

    const reviewed = await fixture.workflow.review({
      workspaceId: fixture.workspaceA,
      draftId: created.value.draftId,
      expectedRevision: 3,
      actorId: "reviewer-a",
    });
    expect(reviewed.ok).toBe(true);
    if (!reviewed.ok) return;
    const published = await fixture.workflow.publish({
      workspaceId: fixture.workspaceA,
      draftId: created.value.draftId,
      expectedRevision: 4,
      actorId: "publisher-a",
    });
    expect(published.ok).toBe(true);
    if (!published.ok) return;
    expect(published.value.status).toBe("published");

    const definition = await fixture.definitions.getDefinition(
      fixture.definitionRef,
    );
    expect(definition?.displayName).toBe("Updated Studio Tool");
    expect(definition?.provenance.metadata?.studioDraftId).toBe(
      created.value.draftId,
    );
    expect(
      (await fixture.implementations.listReleases(fixture.workspaceA)).length,
    ).toBe(0);

    const snapshot = await fixture.implementations.readSourceSnapshot(
      fixture.workspaceA,
      published.value.publication!.sourceSnapshotId,
    );
    const snapshotBytes = await fixture.artifacts.readVerified<Uint8Array>(
      fixture.workspaceA,
      snapshot!.artifact,
    );
    const bundle = JSON.parse(new TextDecoder().decode(snapshotBytes));
    expect(
      bundle.files.find((file: any) => file.path === "backend/logic.ts")
        .content,
    ).toContain("updated backend");
    expect(
      JSON.parse(
        bundle.files.find((file: any) => file.path === "other/definition.json")
          .content,
      ).displayName,
    ).toBe("Updated Studio Tool");

    const unpublished = await fixture.workflow.list({
      workspaceId: fixture.workspaceA,
      unpublishedOnly: true,
    });
    expect(unpublished.ok).toBe(true);
    if (unpublished.ok) expect(unpublished.value.drafts).toEqual([]);

    const restartedWorkflow = new AssetStudioAssetDraftWorkflowUseCase({
      drafts: restartedRepository,
      definitions: fixture.definitions,
      implementations: fixture.implementations,
      artifacts: fixture.artifacts,
      nextDraftId: () => "studio-asset-draft.after-restart",
      now: () => "2026-07-18T14:00:00.000Z",
    });
    const reopenedAfterRestart = await restartedWorkflow.read({
      workspaceId: fixture.workspaceA,
      draftId: created.value.draftId,
    });
    expect(reopenedAfterRestart.ok).toBe(true);
    if (reopenedAfterRestart.ok) {
      expect(reopenedAfterRestart.value.record.status).toBe("published");
      expect(reopenedAfterRestart.value.resources).toEqual(
        resources("updated"),
      );
    }
    const rediscoveredAfterRestart = await restartedWorkflow.list({
      workspaceId: fixture.workspaceA,
      text: "Updated Studio Tool",
    });
    expect(rediscoveredAfterRestart.ok).toBe(true);
    if (rediscoveredAfterRestart.ok) {
      expect(rediscoveredAfterRestart.value.drafts.length).toBe(1);
      expect(rediscoveredAfterRestart.value.drafts[0]?.draftId).toBe(
        created.value.draftId,
      );
    }
  });

  it("fails closed for collisions, protected files, secrets, unsafe paths, and oversized source", async () => {
    const collision = createFixture();
    await collision.definitions.saveDefinition({
      definitionId: collision.definitionRef.id,
      version: collision.definitionRef.version!,
      lifecycleStatus: "published",
      reviewStatus: "reviewed",
      provenance: { sourceKind: "human-authored" },
      ...semanticDefinition("Existing Tool"),
    });
    const duplicate = await collision.workflow.create({
      workspaceId: collision.workspaceA,
      definitionRef: collision.definitionRef,
      semanticDefinition: semanticDefinition("Duplicate Tool"),
      resources: resources("duplicate"),
      actorId: "author-a",
    });
    expect(duplicate.ok).toBe(false);
    if (!duplicate.ok) {
      expect(duplicate.error.code).toBe("asset-studio.asset-draft.conflict");
    }

    const protectedFixture = createFixture();
    const protectedResult = await protectedFixture.workflow.create({
      workspaceId: protectedFixture.workspaceA,
      definitionRef: protectedFixture.definitionRef,
      semanticDefinition: semanticDefinition("Protected Tool"),
      resources: [
        ...resources("protected"),
        {
          path: "other/definition.json",
          role: "other",
          mediaType: "application/json",
          content: "{}",
        },
      ],
      actorId: "author-a",
    });
    expect(protectedResult.ok).toBe(false);

    const secretFixture = createFixture();
    const secretResult = await secretFixture.workflow.create({
      workspaceId: secretFixture.workspaceA,
      definitionRef: secretFixture.definitionRef,
      semanticDefinition: semanticDefinition("Secret Tool"),
      resources: [
        {
          path: "backend/logic.ts",
          role: "backend-logic",
          mediaType: "text/typescript",
          content: "const api_key = '1234567890abcdef';",
        },
      ],
      actorId: "author-a",
    });
    expect(secretResult.ok).toBe(false);

    const traversalFixture = createFixture();
    const traversalResult = await traversalFixture.workflow.create({
      workspaceId: traversalFixture.workspaceA,
      definitionRef: traversalFixture.definitionRef,
      semanticDefinition: semanticDefinition("Traversal Tool"),
      resources: [
        {
          path: "../outside.ts",
          role: "backend-logic",
          mediaType: "text/typescript",
          content: "export const outside = false;",
        },
      ],
      actorId: "author-a",
    });
    expect(traversalResult.ok).toBe(false);

    const oversizedFixture = createFixture();
    const oversizedResult = await oversizedFixture.workflow.create({
      workspaceId: oversizedFixture.workspaceA,
      definitionRef: oversizedFixture.definitionRef,
      semanticDefinition: semanticDefinition("Oversized Tool"),
      resources: [
        {
          path: "backend/logic.ts",
          role: "backend-logic",
          mediaType: "text/typescript",
          content: "x".repeat(ASSET_STUDIO_LIMITS.maxFileCharacters + 1),
        },
      ],
      actorId: "author-a",
    });
    expect(oversizedResult.ok).toBe(false);
  });
});

function createFixture() {
  const documents = createInMemoryStructuredDocumentStore();
  const implementations =
    createStructuredAssetImplementationRepository(documents);
  const drafts = createStructuredAssetStudioAssetDraftRepository(documents);
  const artifacts = createAssetImplementationArtifactAdapter(memoryStorage());
  const definitions = memoryDefinitions();
  const workspaceA = createWorkspaceId("workspace-a");
  const workspaceB = createWorkspaceId("workspace-b");
  const definitionRef = {
    kind: "asset-definition-version" as const,
    id: "asset.studio-tool" as never,
    version: "1.0.0" as never,
  };
  let tick = 0;
  const workflow = new AssetStudioAssetDraftWorkflowUseCase({
    drafts,
    definitions,
    implementations,
    artifacts,
    nextDraftId: () => "studio-asset-draft.test-1",
    now: () => new Date(Date.UTC(2026, 6, 18, 13, 0, tick++)).toISOString(),
  });
  return {
    documents,
    implementations,
    artifacts,
    definitions,
    workflow,
    workspaceA,
    workspaceB,
    definitionRef,
  };
}

function semanticDefinition(displayName: string) {
  return {
    assetType: "tool" as const,
    assetFamily: "behavioral" as const,
    displayName,
    description: "A complete resource-backed Studio asset used for testing.",
    aiContext: {
      purpose: "Exercise the Studio asset draft lifecycle.",
      userFacingSummary: "A Studio-authored test tool.",
      developerFacingSummary: "A deterministic test fixture.",
      capabilities: ["test-behavior"],
      limitations: ["Test-only fixture."],
    },
  };
}

function resources(
  label: string,
): readonly AssetImplementationBackingResourceFile[] {
  return [
    {
      path: "frontend/view.tsx",
      role: "frontend-structure",
      mediaType: "text/typescript-jsx",
      content: `export const View = () => "${label} frontend";`,
    },
    {
      path: "frontend/styles.css",
      role: "frontend-style",
      mediaType: "text/css",
      content: `.${label} { color: blue; }`,
    },
    {
      path: "backend/logic.ts",
      role: "backend-logic",
      mediaType: "text/typescript",
      content: `export const behavior = "${label} backend";`,
    },
  ];
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
