import { describe, expect, it } from "../../../../testing/node-test";
import {
  normalizeAssetId,
  type AssetBinding,
  type AssetDefinition,
  type AssetInstance,
  type AssetReference,
} from "../../../../contracts/asset";
import {
  normalizeAssetImplementationFacetId,
  normalizeAssetImplementationReleaseId,
} from "../../../../contracts/asset-implementation";
import {
  createSystemBuilderModelBinding,
  createSystemBuilderConversationInteractionMetadata,
  normalizeSystemBuilderRevisionId,
  normalizeSystemBuilderSystemId,
  SYSTEM_BUILDER_MODEL_BINDING_FIELD_ID,
  type SystemBuilderRevision,
} from "../../../../contracts/system-builder";
import type { ModelInventoryRecord } from "../../../../contracts/model";
import {
  normalizeSystemBuildArtifactId,
  normalizeSystemBuildId,
  normalizeSystemReleaseId,
  type SystemBuildArtifactDescriptor,
} from "../../../../contracts/system-build";
import { createWorkspaceId } from "../../../../contracts/workspace";
import { createInMemoryStructuredDocumentStore } from "../../../../adapters/persistence/shared";
import { createStructuredSystemBuildRepository } from "../../../../adapters/persistence/system-build";
import { createSha256SystemBuildHasher } from "../../../../adapters/storage/system-build";
import {
  SystemBuilderModelAuthorityService,
  ValidateSystemBuilderRevisionService,
} from "../../../services/system-builder";
import { createDeterministicSystemBuildMaterializer } from "../../../services/system-build";
import type { SystemBuilderRepositoryPort } from "../../../ports/system-builder";
import type {
  SystemBuildArtifactPort,
  SystemBuildImplementationResolverPort,
} from "../../../ports/system-build";
import {
  ApproveSystemReleaseUseCase,
  CompareSystemReleasesUseCase,
  RequestSystemBuildUseCase,
} from "../system-build-use-cases";

const workspaceId = createWorkspaceId("workspace-build-test");
const systemId = normalizeSystemBuilderSystemId("system.build-test");
const systemRevisionId = normalizeSystemBuilderRevisionId(
  "system-revision.build-test.1",
);
const definitionRef: AssetReference = {
  kind: "asset-definition-version",
  id: normalizeAssetId("builtin.ui.page"),
  version: "1.0.0",
};
const compositionId = normalizeAssetId("composition.build-test");
const instance: AssetInstance = {
  instanceId: normalizeAssetId("instance.page"),
  definitionRef,
  displayName: "Page",
  lifecycleStatus: "draft",
  selectedConfiguration: {},
  parentCompositionRef: { kind: "asset-composition", id: compositionId },
  provenance: { sourceKind: "human-authored" },
};
const revision: SystemBuilderRevision = {
  revisionId: systemRevisionId,
  systemId,
  targetWorkspaceId: workspaceId,
  revisionNumber: 1,
  composition: {
    compositionId,
    compositionType: "system",
    displayName: "Build test",
    version: "0.1.0",
    lifecycleStatus: "draft",
    rootInstanceRefs: [
      {
        kind: "asset-instance",
        id: normalizeAssetId(String(instance.instanceId)),
      },
    ],
    instanceRefs: [
      {
        kind: "asset-instance",
        id: normalizeAssetId(String(instance.instanceId)),
      },
    ],
    bindingRefs: [],
    provenance: { sourceKind: "human-authored" },
  },
  instances: [instance],
  bindings: [],
  validationIssues: [],
  createdAt: "2026-07-17T00:00:00.000Z",
  createdBy: "user-1",
};
const definition: AssetDefinition = {
  definitionId: normalizeAssetId("builtin.ui.page"),
  assetType: "page",
  assetFamily: "structural",
  version: "1.0.0",
  displayName: "Page",
  description: "Page",
  lifecycleStatus: "published",
  provenance: { sourceKind: "system-generated" },
};

function systemRepository(
  value: SystemBuilderRevision = revision,
): SystemBuilderRepositoryPort {
  return {
    createRecordAndRevision: async () => {
      throw new Error("unused");
    },
    createRecord: async () => {
      throw new Error("unused");
    },
    readRecord: async () => undefined,
    listRecords: async () => [],
    updateRecord: async () => {
      throw new Error("unused");
    },
    saveRevision: async (value) => value,
    saveRevisionAndRecord: async () => {
      throw new Error("unused");
    },
    readRevision: async (
      requestedWorkspace,
      requestedSystem,
      requestedRevision,
    ) =>
      requestedWorkspace === workspaceId &&
      requestedSystem === systemId &&
      requestedRevision === systemRevisionId
        ? value
        : undefined,
    listRevisions: async () => [value],
  };
}

function artifactPort(hasher = createSha256SystemBuildHasher()) {
  const content = new Map<string, Uint8Array>();
  let tampered = false;
  const port: SystemBuildArtifactPort = {
    async putImmutable(request) {
      const bytes =
        typeof request.content === "string"
          ? new TextEncoder().encode(request.content)
          : (request.content as Uint8Array);
      const digest = hasher.digest(bytes);
      const descriptor: SystemBuildArtifactDescriptor = {
        artifactId: normalizeSystemBuildArtifactId(
          `artifact:${request.kind}:${digest.slice(7)}`,
        ),
        kind: request.kind,
        digest,
        mediaType: request.mediaType,
        sizeBytes: bytes.byteLength,
      };
      content.set(digest, bytes);
      return descriptor;
    },
    async readVerified(_workspace, descriptor) {
      if (tampered || !content.has(descriptor.digest))
        throw new Error("tampered");
      return content.get(descriptor.digest) as never;
    },
  };
  return {
    port,
    tamper: () => {
      tampered = true;
    },
  };
}

function resolver(ready = true): SystemBuildImplementationResolverPort {
  return {
    async resolve(request) {
      if (!ready || request.requiredFacets[0] !== "ui")
        return {
          status: ready ? "incompatible" : "unimplemented",
          definitionRef: request.definitionRef,
          selectedFacets: [],
          diagnostics: [
            {
              severity: "error",
              code: ready ? "facet.missing" : "implementation.missing",
              message: ready
                ? "Facet unavailable."
                : "Implementation unavailable.",
            },
          ],
        };
      return {
        status: "ready",
        definitionRef: request.definitionRef,
        selectedRelease: {
          releaseId: normalizeAssetImplementationReleaseId(
            "implementation.page.1",
          ),
          definitionRef,
          version: "1.0.0",
          status: "published",
          trustLevel: "system-trusted",
          facetKinds: ["ui"],
          packageDigest: `sha256:${"b".repeat(64)}`,
          publishedAt: "2026-07-17T00:00:00.000Z",
          revoked: false,
        },
        selectedFacets: [
          {
            facetId: normalizeAssetImplementationFacetId("facet.page.ui"),
            kind: "ui",
            runtimeKind: "trusted-built-in",
            entryKey: "foundation.page",
            requiredCapabilities: [],
            compatibility: {
              definitionVersion: "1.0.0",
              hostApiRange: ">=1.0.0 <2.0.0",
              deploymentProfiles: [
                "local-desktop",
                "campus-server",
                "cloud-server",
                "thin-client",
              ],
            },
          },
        ],
        diagnostics: [],
      };
    },
  };
}

function command(buildId: string) {
  return {
    buildId: normalizeSystemBuildId(buildId),
    workspaceId,
    systemId,
    systemRevisionId,
    deploymentProfile: "local-desktop" as const,
    availableCapabilities: [],
    permittedTrustLevels: ["system-trusted" as const],
    hostApiVersion: "1.0.0",
    toolchainProfile: "system-builder/1.0.0",
    actorId: "user-1",
  };
}

describe("system build and release use cases", () => {
  it("produces repeatable content-addressed builds and an immutable approved release", async () => {
    const repository = createStructuredSystemBuildRepository(
      createInMemoryStructuredDocumentStore(),
    );
    const hasher = createSha256SystemBuildHasher();
    const artifacts = artifactPort(hasher);
    const build = new RequestSystemBuildUseCase({
      repository,
      systems: systemRepository(),
      validator: new ValidateSystemBuilderRevisionService({
        readExactDefinition: async () => definition,
      }),
      resolver: resolver(),
      artifacts: artifacts.port,
      hasher,
      materializer: createDeterministicSystemBuildMaterializer(),
      now: () => "2026-07-17T00:00:00.000Z",
    });
    const first = await build.execute(command("build.one"));
    const second = await build.execute(command("build.two"));
    expect(first.ok && first.value.status).toBe("succeeded");
    expect(second.ok && second.value.status).toBe("succeeded");
    if (!first.ok || !second.ok || !first.value.lockDigest)
      throw new Error("Expected successful builds.");
    expect(first.value.lockDigest).toBe(second.value.lockDigest);
    expect(first.value.outputArtifacts.map((item) => item.digest)).toEqual(
      second.value.outputArtifacts.map((item) => item.digest),
    );
    const approve = new ApproveSystemReleaseUseCase(
      repository,
      artifacts.port,
      hasher,
      () => "2026-07-17T01:00:00.000Z",
    );
    const approved = await approve.execute({
      workspaceId,
      buildId: first.value.buildId,
      expectedLockDigest: first.value.lockDigest,
      actorId: "approver-1",
    });
    expect(approved.ok).toBe(true);
    if (!approved.ok) throw new Error("Expected release.");
    expect(String(approved.value.releaseId)).toBe(
      `system-release:${approved.value.releaseDigest.slice(7)}`,
    );
    expect(approved.value.compatibility.deploymentProfiles).toEqual([
      "local-desktop",
      "campus-server",
      "cloud-server",
      "thin-client",
    ]);
    const comparison = await new CompareSystemReleasesUseCase(
      repository,
    ).execute({
      workspaceId,
      leftReleaseId: approved.value.releaseId,
      rightReleaseId: approved.value.releaseId,
    });
    expect(comparison.ok && comparison.value).toMatchObject({
      sameInputs: true,
      sameArtifacts: true,
      changedImplementationInstanceIds: [],
    });
  });

  it("materializes an exact deterministic model binding and changes the lock when the model revision changes", async () => {
    const repository = createStructuredSystemBuildRepository(
      createInMemoryStructuredDocumentStore(),
    );
    const hasher = createSha256SystemBuildHasher();
    const artifacts = artifactPort(hasher);
    const composerDefinition: AssetDefinition = {
      ...definition,
      definitionId: normalizeAssetId("conversation.message-composer"),
      assetType: "ui-component",
      assetFamily: "composition",
      displayName: "Message composer",
    };
    const composerInstance: AssetInstance = {
      ...instance,
      instanceId: normalizeAssetId("instance.message-composer"),
      definitionRef: {
        kind: "asset-definition-version",
        id: normalizeAssetId(String(composerDefinition.definitionId)),
        version: composerDefinition.version,
      },
      selectedConfiguration: {
        [SYSTEM_BUILDER_MODEL_BINDING_FIELD_ID]:
          createSystemBuilderModelBinding("model.chat.local"),
      },
    };
    const historyDefinition: AssetDefinition = {
      ...definition,
      definitionId: normalizeAssetId("conversation.message-history-display"),
      assetType: "ui-component",
      assetFamily: "composition",
      displayName: "Message history",
    };
    const historyInstance: AssetInstance = {
      ...instance,
      instanceId: normalizeAssetId("instance.message-history"),
      definitionRef: {
        kind: "asset-definition-version",
        id: normalizeAssetId(String(historyDefinition.definitionId)),
        version: historyDefinition.version,
      },
    };
    const conversationBinding: AssetBinding = {
      bindingId: "binding.message-composer-history",
      bindingKind: "control",
      sourceRef: {
        kind: "asset-instance",
        id: composerInstance.instanceId,
      },
      targetRef: {
        kind: "asset-instance",
        id: historyInstance.instanceId,
      },
      lifecycleStatus: "draft",
      provenance: { sourceKind: "human-authored" },
      metadata: createSystemBuilderConversationInteractionMetadata(),
    };
    const composerRevision: SystemBuilderRevision = {
      ...revision,
      composition: {
        ...revision.composition,
        rootInstanceRefs: [
          {
            kind: "asset-instance",
            id: normalizeAssetId(String(composerInstance.instanceId)),
          },
          {
            kind: "asset-instance",
            id: normalizeAssetId(String(historyInstance.instanceId)),
          },
        ],
        instanceRefs: [
          {
            kind: "asset-instance",
            id: normalizeAssetId(String(composerInstance.instanceId)),
          },
          {
            kind: "asset-instance",
            id: normalizeAssetId(String(historyInstance.instanceId)),
          },
        ],
        bindingRefs: [
          {
            kind: "asset-binding",
            id: conversationBinding.bindingId,
          },
        ],
      },
      instances: [composerInstance, historyInstance],
      bindings: [conversationBinding],
    };
    const modelRecord = (
      modelId: string,
      updatedAt: string,
    ): ModelInventoryRecord => ({
      workspaceId,
      modelRecordId: "model.chat.local",
      displayName: "Local chat",
      source: "local",
      lifecycleStatus: "validated",
      artifactForm: "full-model",
      provider: "huggingface",
      modelId,
      createdAt: "2026-07-29T00:00:00.000Z",
      updatedAt,
      taskTags: ["chat"],
      validationStatus: "valid",
    });
    const createBuild = (record: ModelInventoryRecord) => {
      const modelAuthority = new SystemBuilderModelAuthorityService({
        async listModels() {
          return { models: [record] };
        },
        async getModelRecord(requestedWorkspaceId, modelRecordId) {
          return requestedWorkspaceId === workspaceId &&
            modelRecordId === record.modelRecordId
            ? record
            : undefined;
        },
      });
      return new RequestSystemBuildUseCase({
        repository,
        systems: systemRepository(composerRevision),
        validator: new ValidateSystemBuilderRevisionService(
          {
            readExactDefinition: async (reference) =>
              String(reference.id) === String(historyDefinition.definitionId)
                ? historyDefinition
                : composerDefinition,
          },
          () => "2026-07-29T00:00:00.000Z",
          modelAuthority,
        ),
        resolver: resolver(),
        artifacts: artifacts.port,
        hasher,
        materializer: createDeterministicSystemBuildMaterializer(),
        modelAuthority,
        now: () => "2026-07-29T00:00:00.000Z",
      });
    };

    const first = await createBuild(
      modelRecord("local/chat-v1", "2026-07-29T01:00:00.000Z"),
    ).execute(command("build.model-one"));
    const repeated = await createBuild(
      modelRecord("local/chat-v1", "2026-07-29T01:00:00.000Z"),
    ).execute(command("build.model-two"));
    const changed = await createBuild(
      modelRecord("local/chat-v2", "2026-07-29T02:00:00.000Z"),
    ).execute(command("build.model-three"));

    if (
      !first.ok ||
      !repeated.ok ||
      !changed.ok ||
      !first.value.lock ||
      !repeated.value.lock ||
      !changed.value.lock
    ) {
      throw new Error("Expected successful model-bound builds.");
    }
    expect(first.value.lock.runtimeResourceBindings?.length).toBe(1);
    expect(first.value.lock.runtimeResourceBindings?.[0]).toMatchObject({
      instanceId: "instance.message-composer",
      bindingKind: "model-record",
      capabilityKind: "text-generation",
      modelRecordId: "model.chat.local",
    });
    expect(first.value.lock.runtimeInteractionBindings).toEqual([
      {
        interactionKind: "conversation-turn",
        composerInstanceId: "instance.message-composer",
        historyInstanceId: "instance.message-history",
        transcriptMode: "persisted-only",
      },
    ]);
    expect(first.value.lockDigest).toBe(repeated.value.lockDigest);
    expect(first.value.lockDigest === changed.value.lockDigest).toBe(false);
    expect(
      JSON.stringify(first.value.lock).includes("local/chat-v1"),
    ).toBe(false);
  });

  it("fails closed for unresolved implementations and tampered evidence", async () => {
    const repository = createStructuredSystemBuildRepository(
      createInMemoryStructuredDocumentStore(),
    );
    const hasher = createSha256SystemBuildHasher();
    const artifacts = artifactPort(hasher);
    const build = new RequestSystemBuildUseCase({
      repository,
      systems: systemRepository(),
      validator: new ValidateSystemBuilderRevisionService({
        readExactDefinition: async () => definition,
      }),
      resolver: resolver(false),
      artifacts: artifacts.port,
      hasher,
      materializer: createDeterministicSystemBuildMaterializer(),
      now: () => "2026-07-17T00:00:00.000Z",
    });
    const blocked = await build.execute(command("build.blocked"));
    expect(blocked.ok && blocked.value.status).toBe("failed");
    const good = new RequestSystemBuildUseCase({
      repository,
      systems: systemRepository(),
      validator: new ValidateSystemBuilderRevisionService({
        readExactDefinition: async () => definition,
      }),
      resolver: resolver(),
      artifacts: artifacts.port,
      hasher,
      materializer: createDeterministicSystemBuildMaterializer(),
      now: () => "2026-07-17T00:00:00.000Z",
    });
    const successful = await good.execute(command("build.tamper"));
    if (!successful.ok || !successful.value.lockDigest)
      throw new Error("Expected successful build.");
    artifacts.tamper();
    const denied = await new ApproveSystemReleaseUseCase(
      repository,
      artifacts.port,
      hasher,
    ).execute({
      workspaceId,
      buildId: successful.value.buildId,
      expectedLockDigest: successful.value.lockDigest,
      releaseId: normalizeSystemReleaseId("release.invalid"),
      actorId: "approver-1",
    });
    expect(denied).toMatchObject({ ok: false, error: { code: "integrity" } });
  });

  it("rejects a system revision that exceeds the bounded build instance count", async () => {
    const repository = createStructuredSystemBuildRepository(
      createInMemoryStructuredDocumentStore(),
    );
    const hasher = createSha256SystemBuildHasher();
    const artifacts = artifactPort(hasher);
    const build = new RequestSystemBuildUseCase({
      repository,
      systems: systemRepository({
        ...revision,
        instances: Array.from({ length: 5_001 }, () => instance),
      }),
      validator: new ValidateSystemBuilderRevisionService({
        readExactDefinition: async () => definition,
      }),
      resolver: resolver(),
      artifacts: artifacts.port,
      hasher,
      materializer: createDeterministicSystemBuildMaterializer(),
      now: () => "2026-07-17T00:00:00.000Z",
    });

    const result = await build.execute(command("build.oversized"));

    expect(result.ok && result.value.status).toBe("failed");
    expect(
      result.ok ? result.value.diagnostics[0]?.code : result.error.code,
    ).toBe("system.build.instance-count-exceeded");
  });
});
