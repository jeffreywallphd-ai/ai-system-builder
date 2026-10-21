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
  CancelSystemBuildUseCase,
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


function repeatedRevision(count = 3): SystemBuilderRevision {
  const instances = Array.from({length: count}, (_, i) => ({...instance, instanceId: normalizeAssetId(`instance.repeat.${i}`)}));
  const refs = instances.map(value => ({kind: "asset-instance" as const, id: value.instanceId}));
  return {...revision, instances, composition: {...revision.composition, instanceRefs: refs, rootInstanceRefs: refs}};
}

it("reuses exact selections per build, refreshes authority and preserves every instance lock", async () => {
  let calls = 0; const base = resolver();
  const counting: SystemBuildImplementationResolverPort = {async resolve(request) {calls++;return base.resolve(request);}};
  const documents = createInMemoryStructuredDocumentStore(); const repository=createStructuredSystemBuildRepository(documents); const hasher=createSha256SystemBuildHasher(); const artifacts=artifactPort(hasher);
  const build=new RequestSystemBuildUseCase({repository,systems:systemRepository(repeatedRevision(500)),validator:new ValidateSystemBuilderRevisionService({readExactDefinition:async()=>definition}),resolver:counting,artifacts:artifacts.port,hasher,materializer:createDeterministicSystemBuildMaterializer()});
  const first=await build.execute(command("build.reuse.one"));
  expect(first.ok && first.value.status).toBe("succeeded"); expect(calls).toBe(2);
  if(first.ok) expect(first.value.lock?.resolvedImplementations.length).toBe(500);
  const next=await Promise.all([build.execute(command("build.reuse.two")),build.execute(command("build.reuse.three"))]);
  expect(next.every(result=>result.ok && result.value.status==="succeeded")).toBe(true); expect(calls).toBe(6);
  if(first.ok && next[0].ok && next[1].ok) {expect(next[0].value.lockDigest).toBe(first.value.lockDigest);expect(next[1].value.lockDigest).toBe(first.value.lockDigest);}
});

it("revoked, changed or unavailable reused authority denies before materialization or artifact writes", async () => {
  for(const disposition of ["revoked","changed","unavailable"]) {
    let calls=0;let writes=0;let materializations=0;const base=resolver();const hasher=createSha256SystemBuildHasher();const artifacts=artifactPort(hasher);
    const build=new RequestSystemBuildUseCase({repository:createStructuredSystemBuildRepository(createInMemoryStructuredDocumentStore()),systems:systemRepository(repeatedRevision()),validator:new ValidateSystemBuilderRevisionService({readExactDefinition:async()=>definition}),resolver:{async resolve(request){
      calls++;const result=await base.resolve(request);if(calls===1)return result;
      if(disposition==="unavailable")throw new Error("private source unavailable");
      return disposition==="revoked"?{...result,status:"revoked",selectedRelease:undefined}:{...result,selectedRelease:{...result.selectedRelease!,packageDigest:`sha256:${"e".repeat(64)}`}};
    }},artifacts:{...artifacts.port,async putImmutable(request){writes++;return artifacts.port.putImmutable(request);}},hasher,materializer:{async materialize(){materializations++;return [];}}});
    const result=await build.execute(command(`build.reuse.${disposition}`));expect(result.ok && result.value.status).toBe("failed");expect(writes).toBe(0);expect(materializations).toBe(0);
    expect(JSON.stringify(result)).not.toContain("private source unavailable");
  }
});

it("cached unsuccessful selections retain instance-specific diagnostics", async () => {
 const hasher=createSha256SystemBuildHasher();const artifacts=artifactPort(hasher);
 const build=new RequestSystemBuildUseCase({repository:createStructuredSystemBuildRepository(createInMemoryStructuredDocumentStore()),systems:systemRepository(repeatedRevision(2)),validator:new ValidateSystemBuilderRevisionService({readExactDefinition:async()=>definition}),resolver:resolver(false),artifacts:artifacts.port,hasher,materializer:createDeterministicSystemBuildMaterializer()});
 const result=await build.execute(command("build.reuse.failed"));expect(result.ok && result.value.status).toBe("failed");
 if(result.ok) {expect(result.value.diagnostics.some(item=>item.path?.includes("instance.repeat.0"))).toBe(true);expect(result.value.diagnostics.some(item=>item.path?.includes("instance.repeat.1"))).toBe(true);}
});

it("cancellation during the fresh locked check prevents materialization and artifact writes", async () => {
  const repository = createStructuredSystemBuildRepository(createInMemoryStructuredDocumentStore());
  const hasher = createSha256SystemBuildHasher(); const artifacts = artifactPort(hasher);
  const base = resolver(); let writes = 0; let materializations = 0;
  const request = command("build.reuse.cancelled");
  const build = new RequestSystemBuildUseCase({repository, systems: systemRepository(repeatedRevision()), validator: new ValidateSystemBuilderRevisionService({readExactDefinition: async () => definition}), resolver: {async resolve(value) {
    if (value.lockedReleaseId) {
      const cancelled = await new CancelSystemBuildUseCase(repository).execute({workspaceId, buildId: request.buildId, actorId: "owner-1"});
      expect(cancelled.ok).toBe(true);
    }
    return base.resolve(value);
  }}, artifacts: {...artifacts.port, async putImmutable(value) {writes++; return artifacts.port.putImmutable(value);}}, hasher, materializer: {async materialize() {materializations++; return [];}}});
  const result = await build.execute(request);
  expect(result.ok && result.value.status).toBe("cancelled"); expect(materializations).toBe(0); expect(writes).toBe(0);
});

it("keeps exact versions and concurrent resolution policies separate and locks fresh requests", async () => {
  const value = repeatedRevision(4);
  const exactRevision = {...value, instances: value.instances.map((entry, index) => ({...entry, definitionRef: {...definitionRef, version: index < 2 ? "1.0.0" : "2.0.0"}}))};
  const hasher = createSha256SystemBuildHasher(); const artifacts = artifactPort(hasher); const base = resolver();
  const seen: Parameters<SystemBuildImplementationResolverPort["resolve"]>[0][] = [];
  const build = new RequestSystemBuildUseCase({repository: createStructuredSystemBuildRepository(createInMemoryStructuredDocumentStore()), systems: systemRepository(exactRevision), validator: new ValidateSystemBuilderRevisionService({readExactDefinition: async ref => ({...definition, version: ref.version!})}), resolver: {async resolve(request) {
    seen.push(request);
    const result = await base.resolve(request);
    if (!result.selectedRelease) return result;
    const releaseId = normalizeAssetImplementationReleaseId(`implementation.${request.definitionRef.version}.${request.deploymentProfile}`);
    if (request.lockedReleaseId) {expect(request.lockedReleaseId).toBe(releaseId); expect(request.requiredFacets).toEqual(["ui"]);}
    return {...result, selectedRelease: {...result.selectedRelease, releaseId, definitionRef: request.definitionRef, version: request.definitionRef.version!}};
  }}, artifacts: artifacts.port, hasher, materializer: createDeterministicSystemBuildMaterializer()});
  const results = await Promise.all([
    build.execute({...command("build.exact.desktop"), availableCapabilities: ["artifact:read"], runtimeAbiVersion: "1.0.0"}),
    build.execute({...command("build.exact.server"), deploymentProfile: "campus-server", availableCapabilities: [], runtimeAbiVersion: "2.0.0"}),
  ]);
  expect(results.every(result => result.ok && result.value.status === "succeeded")).toBe(true);
  expect(seen.length).toBe(8); expect(seen.filter(request => !!request.lockedReleaseId).length).toBe(4);
  for (const request of seen) {expect(request.workspaceId).toBe(workspaceId); expect(request.permittedTrustLevels).toEqual(["system-trusted"]); expect(request.hostApiVersion).toBe("1.0.0"); expect(request.runtimeAbiVersion).toBe(request.deploymentProfile === "local-desktop" ? "1.0.0" : "2.0.0"); expect(request.availableCapabilities).toEqual(request.deploymentProfile === "local-desktop" ? ["artifact:read"] : []);}
  if (results[0].ok && results[1].ok) {expect(new Set(results[0].value.lock?.resolvedImplementations.map(item => item.releaseId)).size).toBe(2); expect(results[0].value.lockDigest === results[1].value.lockDigest).toBe(false);}
});
