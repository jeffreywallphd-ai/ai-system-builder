import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import type {
  AssetDefinition,
  AssetInstance,
  AssetReference,
  AssetResourceBackedView,
  FinalizeGeneratedOutputCommand,
} from "../../../../contracts/asset";
import type {
  FinalizeGeneratedOutputPort,
  FinalizeGeneratedOutputRequest,
  FinalizeGeneratedOutputResult,
} from "../../../ports/image";
import type {
  AssetDefinitionListQuery,
  AssetDefinitionRepositoryPort,
  AssetInstanceListQuery,
  AssetInstanceRepositoryPort,
} from "../../../ports/asset";
import type { AssetRegistryReadOptions, AssetRegistryResourceBackedViewDetail } from "../../../services/asset";
import { AssetSourceIdentityService, BUILT_IN_ASSET_DEFINITIONS } from "../../../services/asset";
import { FinalizeGeneratedOutputAsAssetUseCase } from "..";

class FakeDefinitionRepository implements AssetDefinitionRepositoryPort {
  public readonly definitions = new Map<string, AssetDefinition>();
  public getCalls = 0;
  public constructor(definitions: readonly AssetDefinition[] = BUILT_IN_ASSET_DEFINITIONS) {
    for (const definition of definitions) this.definitions.set(key(definitionRef(definition)), definition);
  }
  public async saveDefinition(definition: AssetDefinition): Promise<AssetDefinition> {
    this.definitions.set(key(definitionRef(definition)), definition);
    return definition;
  }
  public async getDefinition(reference: AssetReference): Promise<AssetDefinition | undefined> {
    this.getCalls += 1;
    return this.definitions.get(key(reference)) ?? this.definitions.get(`${reference.id}@`);
  }
  public async listDefinitions(_query?: AssetDefinitionListQuery) {
    return { definitions: [...this.definitions.values()] };
  }
}

class FakeInstanceRepository implements AssetInstanceRepositoryPort {
  public readonly saved: AssetInstance[] = [];
  public instances: AssetInstance[] = [];
  public saveFails = false;
  public lastQuery?: AssetInstanceListQuery;
  public listCalls = 0;
  public async saveInstance(instance: AssetInstance): Promise<AssetInstance> {
    if (this.saveFails) throw new Error("C:\\secret\\raw stack token prompt workflow base64");
    this.saved.push(instance);
    this.instances.push(instance);
    return instance;
  }
  public async getInstance(reference: AssetReference): Promise<AssetInstance | undefined> {
    return this.instances.find((instance) => String(instance.instanceId) === reference.id);
  }
  public async listInstances(query?: AssetInstanceListQuery) {
    this.listCalls += 1;
    this.lastQuery = query;
    const instances = query?.workspaceId
      ? this.instances.filter((instance) => instanceWorkspaceId(instance) === query.workspaceId)
      : this.instances;
    return { instances: instances.slice(0, query?.limit ?? instances.length) };
  }
}


function instanceWorkspaceId(instance: AssetInstance): string | undefined {
  const metadata = instance.metadata as Record<string, unknown> | undefined;
  const finalization = metadata?.assetFinalization as Record<string, unknown> | undefined;
  const finalizedImage = finalization?.finalizedImage as Record<string, unknown> | undefined;
  return typeof finalization?.workspaceId === "string"
    ? finalization.workspaceId
    : typeof finalizedImage?.workspaceId === "string"
      ? finalizedImage.workspaceId
      : undefined;
}

class FakeReadPort {
  public readonly readCalls: Array<{ kind: "view" | "output"; id: string; options?: AssetRegistryReadOptions }> = [];
  public readonly details = new Map<string, AssetRegistryResourceBackedViewDetail>();
  public async readResourceBackedViewDetail(viewId: string, options?: AssetRegistryReadOptions): Promise<AssetRegistryResourceBackedViewDetail | undefined> {
    this.readCalls.push({ kind: "view", id: viewId, options });
    return this.details.get(viewId);
  }
  public async readGeneratedOutputResourceBackedViewByOutputId(outputId: string, options?: AssetRegistryReadOptions): Promise<AssetRegistryResourceBackedViewDetail | undefined> {
    this.readCalls.push({ kind: "output", id: outputId, options });
    return [...this.details.values()].find((detail) => detail.view.generatedOutput?.outputId === outputId);
  }
}

class FakeFinalizer implements FinalizeGeneratedOutputPort {
  public readonly calls: FinalizeGeneratedOutputRequest[] = [];
  public result: FinalizeGeneratedOutputResult = finalizedResult();
  public async finalizeGeneratedOutput(request: FinalizeGeneratedOutputRequest): Promise<FinalizeGeneratedOutputResult> {
    this.calls.push(request);
    return this.result;
  }
}

class CountingSourceIdentityService extends AssetSourceIdentityService {
  public calls = 0;
  public override deriveFromResourceBackedView(view: AssetResourceBackedView) {
    this.calls += 1;
    return super.deriveFromResourceBackedView(view);
  }
}

function command(overrides: Partial<FinalizeGeneratedOutputCommand> = {}): FinalizeGeneratedOutputCommand {
  return {
    operation: "asset.finalize-generated-output",
    workspaceId: "workspace-a" as never,
    viewId: "view.generated",
    approval: { userConfirmed: true, confirmationKind: "finalize-generated-output", allowFilesystemWrite: true, allowPartialCompletion: true },
    actor: { initiatedBy: "human", actorRef: "user.1", actorDisplayName: "User One" },
    context: { requestId: "request.1", correlationId: "correlation.1", idempotencyKey: "idem.1" },
    ...overrides,
  };
}

function generatedView(overrides: Partial<AssetResourceBackedView> = {}): AssetResourceBackedView {
  return {
    viewId: "view.generated",
    viewKind: "generated-output",
    generatedOutput: {
      outputId: "generated.safe-output",
      runtimeCapabilityId: "image-generation",
      producedAssetType: "image",
      producedAt: "2026-05-08T11:00:00.000Z",
      metadata: { workspaceId: "workspace-a", engine: "comfyui", prompt: "raw prompt text" },
    },
    resourceBacking: {
      backingId: "generated-output.safe-output",
      resourceKind: "generated-output",
      ref: {
        outputId: "generated.safe-output",
        runtimeCapabilityId: "image-generation",
        producedAssetType: "image",
      },
      role: "derived",
      metadata: { prompt: "raw prompt text", ok: "safe" },
    },
    displayName: "Generated Safe Output",
    metadata: {
      workspaceId: "workspace-a",
      outputId: "generated.safe-output",
      producedAssetType: "image",
      finalized: false,
      registered: false,
      status: "succeeded",
      width: 512,
      height: 512,
      seed: 123,
      prompt: "raw prompt text",
      workflow: { node: "raw" },
    },
    diagnostics: [{ severity: "info", code: "generated-output-not-finalized", message: "Not finalized." }],
    ...overrides,
  };
}

function finalizedResult(overrides: Partial<FinalizeGeneratedOutputResult & { ok: true }> = {}): FinalizeGeneratedOutputResult {
  return {
    ok: true,
    status: "finalized",
    finalizedImage: {
      workspaceId: "workspace-a" as never,
      imageAssetId: "image.safe-output",
      backingArtifactId: "artifact.safe-output",
      source: "generated",
      displayName: "Final Safe Image",
      mediaType: "image/png",
      width: 512,
      height: 512,
      seed: 123,
      model: "safe-model",
      engine: "comfyui",
      createdAt: "2026-05-08T12:00:00.000Z",
      metadata: { prompt: "raw prompt text", safe: true },
    },
    ...overrides,
  };
}

function makeUseCase(
  read = new FakeReadPort(),
  definitions = new FakeDefinitionRepository(),
  instances = new FakeInstanceRepository(),
  finalizer: FakeFinalizer | null | undefined = new FakeFinalizer(),
) {
  const generatedOutputFinalizer = finalizer ?? undefined;
  return {
    read,
    definitions,
    instances,
    finalizer: generatedOutputFinalizer,
    useCase: new FinalizeGeneratedOutputAsAssetUseCase({
      assetRegistryRead: read,
      generatedOutputFinalizer,
      definitionRepository: definitions,
      instanceRepository: instances,
      now: () => "2026-05-08T12:00:00.000Z",
      generateInstanceId: () => `finalized.${instances.saved.length + 1}`,
    }),
  };
}

describe("FinalizeGeneratedOutputAsAssetUseCase", () => {
  it("finalizes an eligible generated-output view and registers an AssetInstance", async () => {
    const read = new FakeReadPort();
    read.details.set("view.generated", { view: generatedView() });
    const { useCase, instances, finalizer } = makeUseCase(read);

    const result = await useCase.execute(command());

    assert.equal(result.ok, true);
    assert.equal(result.status, "created");
    assert.equal(finalizer?.calls.length, 1);
    assert.equal(finalizer?.calls[0]?.generatedOutputId, "generated.safe-output");
    assert.equal(instances.saved.length, 1);
    assert.equal(result.assetInstance?.definitionRef.id, "builtin.resource-backed-image");
    assert.equal(result.assetInstance?.metadata?.generatedOutputFinalization, true);
    assert.doesNotMatch(JSON.stringify(result.assetInstance), /raw prompt text|workflow|contentBase64|base64|bytes|C:\\|\/tmp|token/i);
  });

  it("re-reads generated-output by id and does not trust caller payload", async () => {
    const read = new FakeReadPort();
    read.details.set("view.generated", { view: generatedView({ displayName: "Server Truth" }) });
    const { useCase, instances } = makeUseCase(read);
    const result = await useCase.execute(command({ displayName: "Caller Safe Name" }));

    assert.equal(result.ok, true);
    assert.equal(read.readCalls.length, 1);
    assert.equal(read.readCalls[0]?.id, "view.generated");
    assert.equal(read.readCalls[0]?.options?.includeResourceBackings, true);
    assert.equal(instances.saved[0]?.displayName, "Caller Safe Name");

    const byOutput = await useCase.execute(command({ viewId: undefined, generatedOutputId: "generated.safe-output" }));
    assert.equal(byOutput.status, "existing");
    assert.equal(read.readCalls[1]?.kind, "output");
  });

  it("rejects missing, failed, incomplete, cancelled, preview-only, and finalized image views", async () => {
    const read = new FakeReadPort();
    read.details.set("view.failed", { view: generatedView({ viewId: "view.failed", metadata: { status: "failed" } }) });
    read.details.set("view.running", { view: generatedView({ viewId: "view.running", metadata: { status: "running" } }) });
    read.details.set("view.cancelled", { view: generatedView({ viewId: "view.cancelled", metadata: { status: "cancelled" } }) });
    read.details.set("view.preview", { view: generatedView({ viewId: "view.preview", metadata: { status: "succeeded", previewOnly: true } }) });
    read.details.set("view.image", { view: { ...generatedView(), viewId: "view.image", viewKind: "image-asset" } });
    const { useCase, instances, finalizer } = makeUseCase(read);

    assert.equal((await useCase.execute(command({ viewId: "missing" }))).failure?.code, "not-found");
    assert.equal((await useCase.execute(command({ viewId: "view.failed" }))).failure?.code, "validation");
    assert.equal((await useCase.execute(command({ viewId: "view.running" }))).failure?.code, "validation");
    assert.equal((await useCase.execute(command({ viewId: "view.cancelled" }))).failure?.code, "validation");
    assert.equal((await useCase.execute(command({ viewId: "view.preview" }))).failure?.code, "validation");
    assert.equal((await useCase.execute(command({ viewId: "view.image" }))).failure?.code, "conflict");
    assert.equal(instances.saved.length, 0);
    assert.equal(finalizer?.calls.length, 0);
  });

  it("rejects generated output finalization across workspaces", async () => {
    const { read, useCase, finalizer } = makeUseCase();
    read.details.set("view.generated", { view: generatedView() });
    const result = await useCase.execute(command({ workspaceId: "workspace-b" as never }));
    assert.equal(result.ok, false);
    assert.equal(result.failure?.code, "validation");
    assert.equal(result.failure?.diagnostics?.some((diagnostic) => diagnostic.code === "generated-output-workspace-mismatch"), true);
    assert.equal(finalizer?.calls.length, 0);
  });

  it("requires approval, confirmation kind, filesystem write, and rejects network or credential access", async () => {
    const read = new FakeReadPort();
    read.details.set("view.generated", { view: generatedView() });
    const { useCase, finalizer, instances } = makeUseCase(read);

    assert.equal((await useCase.execute(command({ approval: { userConfirmed: false, confirmationKind: "finalize-generated-output", allowFilesystemWrite: true, allowPartialCompletion: true } }))).failure?.code, "approval-required");
    assert.equal((await useCase.execute(command({ approval: { userConfirmed: true, confirmationKind: "register-resource-backed-view", allowFilesystemWrite: true, allowPartialCompletion: true } }))).failure?.code, "validation");
    assert.equal((await useCase.execute(command({ approval: { userConfirmed: true, confirmationKind: "finalize-generated-output" } }))).failure?.code, "permission");
    assert.equal((await useCase.execute(command({ approval: { userConfirmed: true, confirmationKind: "finalize-generated-output", allowFilesystemWrite: true } }))).failure?.code, "permission");
    assert.equal((await useCase.execute(command({ approval: { userConfirmed: true, confirmationKind: "finalize-generated-output", allowFilesystemWrite: true, allowPartialCompletion: true, allowNetworkAccess: true } }))).failure?.code, "validation");
    assert.equal((await useCase.execute(command({ approval: { userConfirmed: true, confirmationKind: "finalize-generated-output", allowFilesystemWrite: true, allowPartialCompletion: true, allowCredentialUse: true } }))).failure?.code, "validation");
    assert.equal(finalizer?.calls.length, 0);
    assert.equal(read.readCalls.length, 0);
    assert.equal(instances.listCalls, 0);
    assert.equal(instances.saved.length, 0);
  });

  it("does not read sources, repositories, or finalization ports when the command guard fails", async () => {
    const guardFailures = [
      command({ approval: { userConfirmed: false, confirmationKind: "finalize-generated-output", allowFilesystemWrite: true, allowPartialCompletion: true } }),
      command({ approval: { userConfirmed: true, confirmationKind: "register-resource-backed-view", allowFilesystemWrite: true, allowPartialCompletion: true } }),
      command({ approval: { userConfirmed: true, confirmationKind: "finalize-generated-output" } }),
      command({ approval: { userConfirmed: true, confirmationKind: "finalize-generated-output", allowFilesystemWrite: true } }),
      command({ approval: { userConfirmed: true, confirmationKind: "finalize-generated-output", allowFilesystemWrite: true, allowPartialCompletion: true, allowNetworkAccess: true } }),
      command({ approval: { userConfirmed: true, confirmationKind: "finalize-generated-output", allowFilesystemWrite: true, allowPartialCompletion: true, allowCredentialUse: true } }),
    ];

    for (const failingCommand of guardFailures) {
      const read = new FakeReadPort();
      read.details.set("view.generated", { view: generatedView() });
      const definitions = new FakeDefinitionRepository();
      const instances = new FakeInstanceRepository();
      const finalizer = new FakeFinalizer();
      const sourceIdentityService = new CountingSourceIdentityService();
      let generatedIds = 0;
      const useCase = new FinalizeGeneratedOutputAsAssetUseCase({
        assetRegistryRead: read,
        generatedOutputFinalizer: finalizer,
        definitionRepository: definitions,
        instanceRepository: instances,
        sourceIdentityService,
        now: () => "2026-05-08T12:00:00.000Z",
        generateInstanceId: () => {
          generatedIds += 1;
          return `finalized.${generatedIds}`;
        },
      });
      const result = await useCase.execute(failingCommand);

      assert.equal(result.ok, false);
      assert.equal(read.readCalls.length, 0);
      assert.equal(sourceIdentityService.calls, 0);
      assert.equal(finalizer.calls.length, 0);
      assert.equal(instances.listCalls, 0);
      assert.equal(definitions.getCalls, 0);
      assert.equal(generatedIds, 0);
      assert.equal(instances.saved.length, 0);
    }
  });

  it("fails safely before source reads or saves when no instance ID generator is injected", async () => {
    const read = new FakeReadPort();
    read.details.set("view.generated", { view: generatedView() });
    const instances = new FakeInstanceRepository();
    const finalizer = new FakeFinalizer();
    const useCase = new FinalizeGeneratedOutputAsAssetUseCase({
      assetRegistryRead: read,
      generatedOutputFinalizer: finalizer,
      definitionRepository: new FakeDefinitionRepository(),
      instanceRepository: instances,
      now: () => "2026-05-08T12:00:00.000Z",
    });

    const result = await useCase.execute(command());

    assert.equal(result.ok, false);
    assert.equal(result.failure?.code, "unavailable");
    assert.doesNotMatch(JSON.stringify(result), /Math\.random|random|C:\\|\/tmp|token|prompt|workflow|base64|stack/i);
    assert.equal(read.readCalls.length, 0);
    assert.equal(finalizer.calls.length, 0);
    assert.equal(instances.listCalls, 0);
    assert.equal(instances.saved.length, 0);
  });

  it("uses the injected ID generator for created instances", async () => {
    const read = new FakeReadPort();
    read.details.set("view.generated", { view: generatedView() });
    const { useCase, instances } = makeUseCase(read);

    const result = await useCase.execute(command());

    assert.equal(result.ok, true);
    assert.equal(instances.saved[0]?.instanceId, "finalized.1");
  });

  it("uses supplied target definition, infers builtin image definition, and fails when missing", async () => {
    const read = new FakeReadPort();
    read.details.set("view.generated", { view: generatedView() });
    const customDefinition: AssetDefinition = {
      ...BUILT_IN_ASSET_DEFINITIONS.find((definition) => definition.definitionId === "builtin.resource-backed-image")!,
      definitionId: "definition.custom-image",
      displayName: "Custom Image",
    };
    const supplied = makeUseCase(read, new FakeDefinitionRepository([...BUILT_IN_ASSET_DEFINITIONS, customDefinition]));
    const result = await supplied.useCase.execute(command({ targetDefinitionRef: definitionRef(customDefinition) }));
    assert.equal(result.ok, true);
    assert.equal(result.assetInstance?.definitionRef.id, "definition.custom-image");

    const inferred = makeUseCase(read);
    assert.equal((await inferred.useCase.execute(command())).assetInstance?.definitionRef.id, "builtin.resource-backed-image");

    const missing = makeUseCase(read, new FakeDefinitionRepository([]));
    assert.equal((await missing.useCase.execute(command())).failure?.code, "unavailable");
  });

  it("does not call finalization when a duplicate AssetInstance already exists", async () => {
    const read = new FakeReadPort();
    read.details.set("view.generated", { view: generatedView() });
    const { useCase, instances, finalizer } = makeUseCase(read);
    const first = await useCase.execute(command());
    assert.equal(first.ok, true);
    const second = await useCase.execute(command({ displayName: "Different" }));
    assert.equal(second.status, "existing");
    assert.equal(finalizer?.calls.length, 1);
    assert.equal(instances.saved.length, 1);
  });

  it("scopes duplicate detection to the command workspace", async () => {
    const read = new FakeReadPort();
    read.details.set("view.generated", { view: generatedView() });
    const { useCase, instances, finalizer } = makeUseCase(read);

    const first = await useCase.execute(command());
    assert.equal(first.status, "created");
    assert.equal(instances.lastQuery?.workspaceId, "workspace-a");

    read.details.set("view.generated.b", {
      view: generatedView({
        viewId: "view.generated.b",
        metadata: { ...generatedView().metadata, workspaceId: "workspace-b" },
        generatedOutput: { ...generatedView().generatedOutput!, metadata: { workspaceId: "workspace-b" } },
      }),
    });
    finalizer!.result = finalizedResult({ finalizedImage: { ...finalizedResult().finalizedImage, workspaceId: "workspace-b" as never, imageAssetId: "image.safe-output-b", backingArtifactId: "artifact.safe-output-b" } });

    const second = await useCase.execute(command({ workspaceId: "workspace-b" as never, viewId: "view.generated.b" }));

    assert.equal(second.status, "created");
    assert.equal(instances.saved.length, 2);
    assert.equal(instances.lastQuery?.workspaceId, "workspace-b");
    assert.equal(finalizer?.calls.length, 2);
  });

  it("performs duplicate detection before finalization after the guard passes", async () => {
    const read = new FakeReadPort();
    read.details.set("view.generated", { view: generatedView() });
    const { useCase, instances, finalizer } = makeUseCase(read);
    const first = await useCase.execute(command());
    assert.equal(first.ok, true);

    finalizer!.calls.length = 0;
    const second = await useCase.execute(command());

    assert.equal(second.status, "existing");
    assert.equal(finalizer?.calls.length, 0);
    assert.equal(instances.saved.length, 1);
  });

  it("registers the missing AssetInstance when finalization reports already-finalized", async () => {
    const read = new FakeReadPort();
    read.details.set("view.generated", { view: generatedView() });
    const finalizer = new FakeFinalizer();
    finalizer.result = finalizedResult({ status: "already-finalized" });
    const { useCase, instances } = makeUseCase(read, new FakeDefinitionRepository(), new FakeInstanceRepository(), finalizer);

    const result = await useCase.execute(command());

    assert.equal(result.ok, true);
    assert.equal(result.status, "created");
    assert.equal(instances.saved.length, 1);
    assert.match(JSON.stringify(result.diagnostics), /already finalized/i);
  });

  it("returns existing for an already-finalized retry when the AssetInstance exists", async () => {
    const read = new FakeReadPort();
    read.details.set("view.generated", { view: generatedView() });
    const finalizer = new FakeFinalizer();
    finalizer.result = finalizedResult({ status: "already-finalized" });
    const { useCase, instances } = makeUseCase(read, new FakeDefinitionRepository(), new FakeInstanceRepository(), finalizer);

    const first = await useCase.execute(command());
    const second = await useCase.execute(command());

    assert.equal(first.status, "created");
    assert.equal(second.status, "existing");
    assert.equal(instances.saved.length, 1);
  });

  it("validates before save and returns partial-failure after successful finalization when validation or save fails", async () => {
    const read = new FakeReadPort();
    read.details.set("view.generated", { view: generatedView() });
    const invalid = new FinalizeGeneratedOutputAsAssetUseCase({
      assetRegistryRead: read,
      generatedOutputFinalizer: new FakeFinalizer(),
      definitionRepository: new FakeDefinitionRepository(),
      instanceRepository: new FakeInstanceRepository(),
      now: () => "2026-05-08T12:00:00.000Z",
      generateInstanceId: () => "../bad",
    });
    const invalidResult = await invalid.execute(command());
    assert.equal(invalidResult.failure?.code, "partial-failure");
    assert.equal(invalidResult.failure?.safeDetails?.retrySafe, true);
    assert.deepEqual(Object.keys((invalidResult.failure?.safeDetails?.finalizedImage as Record<string, unknown>) ?? {}).sort(), [
      "backingArtifactId",
      "createdAt",
      "height",
      "imageAssetId",
      "mediaType",
      "source",
      "width",
    ].sort());

    const instances = new FakeInstanceRepository();
    instances.saveFails = true;
    const finalizer = new FakeFinalizer();
    const saveFailure = makeUseCase(read, new FakeDefinitionRepository(), instances, finalizer);
    const result = await saveFailure.useCase.execute(command());
    assert.equal(result.ok, false);
    assert.equal(result.failure?.code, "partial-failure");
    assert.equal(result.failure?.safeDetails?.retrySafe, true);
    assert.equal(finalizer.calls.length, 1);
    assert.doesNotMatch(JSON.stringify(result), /raw stack|C:\\|token|prompt|workflow|bytes|blob|base64/i);
  });

  it("keeps idempotency key diagnostic-only and sanitizes source identity, provenance, metadata, and failures", async () => {
    const read = new FakeReadPort();
    read.details.set("view.generated", { view: generatedView({
      displayName: "C:\\secret\\file.png",
      metadata: { status: "succeeded", prompt: "raw prompt text", workflow: { bad: true }, token: "secret", ok: "safe" },
      resourceBacking: {
        ...generatedView().resourceBacking!,
        backingId: "C:\\secret\\generated",
      },
    }) });
    const { useCase, finalizer, instances } = makeUseCase(read);
    const result = await useCase.execute(command({ displayName: "Bearer token abc.def" }));

    assert.equal(result.ok, true);
    assert.equal(finalizer?.calls[0]?.idempotencyKey, "idem.1");
    assert.match(result.sourceIdentity?.deduplicationKey ?? "", /^asset-source\./);
    assert.notEqual(result.sourceIdentity?.deduplicationKey, "idem.1");
    assert.doesNotMatch(JSON.stringify({ result, saved: instances.saved }), /C:\\|secret\\|Bearer token|raw prompt text|workflow|token|base64|bytes|blob|stack/i);
  });

  it("returns unavailable when no finalization seam is supplied", async () => {
    const read = new FakeReadPort();
    read.details.set("view.generated", { view: generatedView() });
    const { useCase } = makeUseCase(read, new FakeDefinitionRepository(), new FakeInstanceRepository(), null);
    const result = await useCase.execute(command());
    assert.equal(result.ok, false);
    assert.equal(result.failure?.code, "unavailable");
  });

  it("imports no adapters, hosts, public transports, UI, runtime, storage, provider clients, or byte readers", () => {
    const source = readFileSync(
      join(process.cwd(), "modules/application/use-cases/asset/finalize-generated-output-as-asset.use-case.ts"),
      "utf8",
    );
    assert.doesNotMatch(source, /from\s+["'][^"']*(?:adapters|hosts|contracts\/api|contracts\/ipc|api-express|ipc-electron|preload|renderer|thin-client|runtime\/.*adapter|storage\/.*adapter|persistence\/.*adapter|provider-client|huggingface)[^"']*["']/i);
    assert.doesNotMatch(source, /\b(?:readBytes|readResourceBytes|fetch\(|startRuntime|probeRuntime|installRuntime|repairRuntime|RuntimeTaskRegistry|ComfyUI|ImageGenerationUseCase|importExternal|localizeExternal|seedBuiltIns|discoverModels|prepareDataset|trainModel|validateModel|publishModel)\b/i);
  });
});

function definitionRef(definition: AssetDefinition): AssetReference {
  return { kind: "asset-definition-version", id: String(definition.definitionId) as AssetReference["id"], version: definition.version };
}

function key(reference: AssetReference): string {
  return `${reference.id}@${reference.version ?? ""}`;
}
