import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import type {
  AssetDefinition,
  AssetInstance,
  AssetReference,
  AssetResourceBackedView,
  RegisterResourceBackedViewCommand,
} from "../../../../contracts/asset";
import { RegisterResourceBackedViewAsAssetInstanceUseCase } from "..";
import type {
  AssetDefinitionListQuery,
  AssetDefinitionRepositoryPort,
  AssetInstanceListQuery,
  AssetInstanceRepositoryPort,
} from "../../../ports/asset";
import type { AssetRegistryReadOptions, AssetRegistryResourceBackedViewDetail } from "../../../services/asset";
import { AssetSourceIdentityService, BUILT_IN_ASSET_DEFINITIONS } from "../../../services/asset";

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
  public lastQuery?: AssetInstanceListQuery;
  public instances: AssetInstance[] = [];
  public listCalls = 0;
  public async saveInstance(instance: AssetInstance): Promise<AssetInstance> {
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
    return { instances: this.instances.slice(0, query?.limit ?? this.instances.length) };
  }
}

class FakeReadPort {
  public readonly readCalls: Array<{ viewId: string; options?: AssetRegistryReadOptions }> = [];
  public readonly details = new Map<string, AssetRegistryResourceBackedViewDetail>();
  public async readResourceBackedViewDetail(viewId: string, options?: AssetRegistryReadOptions): Promise<AssetRegistryResourceBackedViewDetail | undefined> {
    this.readCalls.push({ viewId, options });
    return this.details.get(viewId);
  }
}

class CountingSourceIdentityService extends AssetSourceIdentityService {
  public calls = 0;
  public override deriveFromResourceBackedView(view: AssetResourceBackedView) {
    this.calls += 1;
    return super.deriveFromResourceBackedView(view);
  }
}

function command(overrides: Partial<RegisterResourceBackedViewCommand> = {}): RegisterResourceBackedViewCommand {
  return {
    operation: "asset.register-resource-backed-view",
    workspaceId: "workspace-a" as never,
    viewId: "view.artifact",
    approval: { userConfirmed: true, confirmationKind: "register-resource-backed-view" },
    actor: { initiatedBy: "human", actorRef: "user.1", actorDisplayName: "User One" },
    context: { requestId: "request.1", correlationId: "correlation.1", idempotencyKey: "idem.1" },
    ...overrides,
  };
}

function artifactView(overrides: Partial<AssetResourceBackedView> = {}): AssetResourceBackedView {
  return {
    viewId: "view.artifact",
    viewKind: "artifact",
    assetType: "data-source",
    assetFamily: "resource-backed",
    assetDefinitionRef: { kind: "asset-definition", id: "builtin.artifact" as AssetReference["id"], version: "1.0.0" },
    sourceRef: { kind: "artifact", id: "artifact-ref.safe-artifact" as AssetReference["id"], label: "Safe Artifact" },
    resourceBacking: {
      backingId: "artifact.safe-artifact",
      resourceKind: "artifact",
      ref: { kind: "artifact", id: "artifact-ref.safe-artifact" as AssetReference["id"] },
      role: "primary",
      displayName: "Safe Artifact",
      metadata: { artifactId: "safe-artifact" },
    },
    displayName: "Safe Artifact",
    metadata: { artifactId: "safe-artifact", token: "secret-token" },
    ...overrides,
  };
}

function imageView(): AssetResourceBackedView {
  return artifactView({
    viewId: "view.image",
    viewKind: "image-asset",
    assetType: "image",
    assetDefinitionRef: { kind: "asset-definition", id: "builtin.resource-backed-image" as AssetReference["id"], version: "1.0.0" },
    sourceRef: { kind: "artifact", id: "artifact-ref.image-artifact" as AssetReference["id"] },
    resourceBacking: {
      backingId: "image.safe-image",
      resourceKind: "image",
      ref: { kind: "artifact", id: "artifact-ref.image-artifact" as AssetReference["id"] },
      role: "primary",
    },
    displayName: "Safe Image",
  });
}

function modelView(): AssetResourceBackedView {
  return artifactView({
    viewId: "view.model",
    viewKind: "model",
    assetType: "model",
    assetDefinitionRef: { kind: "asset-definition", id: "builtin.model" as AssetReference["id"], version: "1.0.0" },
    sourceRef: { kind: "resource", id: "model-ref.model-one" as AssetReference["id"] },
    resourceBacking: {
      backingId: "model.model-one",
      resourceKind: "model",
      ref: { kind: "resource", id: "model-ref.model-one" as AssetReference["id"] },
      role: "primary",
    },
    displayName: "Model One",
  });
}

function datasetView(): AssetResourceBackedView {
  return artifactView({
    viewId: "view.dataset",
    viewKind: "dataset",
    assetType: "dataset",
    assetDefinitionRef: { kind: "asset-definition", id: "builtin.dataset" as AssetReference["id"], version: "1.0.0" },
    sourceRef: { kind: "resource", id: "dataset-ref.dataset-one" as AssetReference["id"] },
    resourceBacking: {
      backingId: "dataset.dataset-one",
      resourceKind: "dataset",
      ref: { kind: "resource", id: "dataset-ref.dataset-one" as AssetReference["id"] },
      role: "primary",
    },
  });
}

function makeUseCase(read: FakeReadPort, definitions = new FakeDefinitionRepository(), instances = new FakeInstanceRepository()) {
  return {
    definitions,
    instances,
    useCase: new RegisterResourceBackedViewAsAssetInstanceUseCase({
      assetRegistryRead: read,
      definitionRepository: definitions,
      instanceRepository: instances,
      now: () => "2026-05-08T12:00:00.000Z",
      generateInstanceId: () => `registered.${instances.saved.length + 1}`,
    }),
  };
}

describe("RegisterResourceBackedViewAsAssetInstanceUseCase", () => {
  it("registers eligible artifact/document, finalized image, dataset, and persisted model views", async () => {
    const read = new FakeReadPort();
    for (const view of [
      artifactView(),
      artifactView({ viewId: "view.document", viewKind: "document", assetType: "document", assetDefinitionRef: { kind: "asset-definition", id: "builtin.document" as AssetReference["id"], version: "1.0.0" } }),
      imageView(),
      datasetView(),
      modelView(),
    ]) read.details.set(view.viewId, { view });
    const { useCase, instances } = makeUseCase(read);

    for (const viewId of read.details.keys()) {
      const result = await useCase.execute(command({ viewId }));
      assert.equal(result.ok, true, viewId);
      assert.equal(result.status, "created");
      assert.equal(result.assetInstance?.lifecycleStatus, "validated");
      assert.equal(result.assetInstance?.metadata?.resourceBackedRegistration, true);
    }
    assert.equal(instances.saved.length, 5);
    assert.doesNotMatch(JSON.stringify(instances.saved), /bytes|base64|secret-token|C:\\|\/tmp|prompt text/i);
  });

  it("re-reads by view id and does not trust caller-supplied display name or source payload", async () => {
    const read = new FakeReadPort();
    read.details.set("view.artifact", { view: artifactView({ displayName: "Server Truth" }) });
    const { useCase, instances } = makeUseCase(read);
    const result = await useCase.execute(command({ displayName: "Caller Name" }));
    assert.equal(result.ok, true);
    assert.equal(read.readCalls.length, 1);
    assert.equal(read.readCalls[0]?.viewId, "view.artifact");
    assert.equal(read.readCalls[0]?.options?.includeResourceBackings, true);
    assert.equal(instances.saved[0]?.displayName, "Caller Name");
    assert.equal(result.sourceIdentity?.sourceViewId, "view.artifact");
  });

  it("rejects missing, generated-output, unimported external, unsupported, and unapproved views without saving", async () => {
    const read = new FakeReadPort();
    read.details.set("view.generated", { view: artifactView({ viewId: "view.generated", viewKind: "generated-output", assetType: undefined, assetDefinitionRef: undefined }) });
    read.details.set("view.external", { view: artifactView({ viewId: "view.external", viewKind: "external-repository-object", assetType: "data-source", assetDefinitionRef: undefined, metadata: { imported: false, localized: false, registered: false } }) });
    read.details.set("view.unsupported", { view: artifactView({ viewId: "view.unsupported", diagnostics: [{ severity: "warning", code: "unsupported-source-shape", message: "Unsupported." }] }) });
    const { useCase, instances } = makeUseCase(read);

    assert.equal((await useCase.execute(command({ viewId: "missing" }))).failure?.code, "not-found");
    assert.equal((await useCase.execute(command({ viewId: "view.generated" }))).failure?.code, "validation");
    assert.match((await useCase.execute(command({ viewId: "view.external" }))).failure?.message ?? "", /deferred/);
    assert.equal((await useCase.execute(command({ viewId: "view.unsupported" }))).failure?.code, "validation");
    assert.equal((await useCase.execute(command({ approval: { userConfirmed: false, confirmationKind: "register-resource-backed-view" } }))).failure?.code, "approval-required");
    assert.equal((await useCase.execute(command({ approval: { userConfirmed: true, confirmationKind: "register-resource-backed-view", allowNetworkAccess: true } }))).failure?.code, "validation");
    assert.equal(instances.saved.length, 0);
  });

  it("returns guard failures before source reads, duplicate reads, or saves", async () => {
    const read = new FakeReadPort();
    read.details.set("view.artifact", { view: artifactView() });
    const definitions = new FakeDefinitionRepository();
    const instances = new FakeInstanceRepository();
    const sourceIdentityService = new CountingSourceIdentityService();
    let generatedIds = 0;
    const useCase = new RegisterResourceBackedViewAsAssetInstanceUseCase({
      assetRegistryRead: read,
      definitionRepository: definitions,
      instanceRepository: instances,
      sourceIdentityService,
      now: () => "2026-05-08T12:00:00.000Z",
      generateInstanceId: () => {
        generatedIds += 1;
        return `registered.${generatedIds}`;
      },
    });

    assert.equal((await useCase.execute(command({ approval: { userConfirmed: false, confirmationKind: "register-resource-backed-view" } }))).failure?.code, "approval-required");
    assert.equal((await useCase.execute(command({ approval: { userConfirmed: true, confirmationKind: "register-resource-backed-view", allowFilesystemWrite: true } }))).failure?.code, "validation");

    assert.equal(read.readCalls.length, 0);
    assert.equal(sourceIdentityService.calls, 0);
    assert.equal(instances.listCalls, 0);
    assert.equal(definitions.getCalls, 0);
    assert.equal(generatedIds, 0);
    assert.equal(instances.saved.length, 0);
  });

  it("fails safely before source reads or saves when no instance ID generator is injected", async () => {
    const read = new FakeReadPort();
    read.details.set("view.artifact", { view: artifactView() });
    const instances = new FakeInstanceRepository();
    const useCase = new RegisterResourceBackedViewAsAssetInstanceUseCase({
      assetRegistryRead: read,
      definitionRepository: new FakeDefinitionRepository(),
      instanceRepository: instances,
      now: () => "2026-05-08T12:00:00.000Z",
    });

    const result = await useCase.execute(command());

    assert.equal(result.ok, false);
    assert.equal(result.failure?.code, "unavailable");
    assert.doesNotMatch(JSON.stringify(result), /Math\.random|random|C:\\|\/tmp|token|prompt|workflow|base64|stack/i);
    assert.equal(read.readCalls.length, 0);
    assert.equal(instances.listCalls, 0);
    assert.equal(instances.saved.length, 0);
  });

  it("uses the injected ID generator for created instances", async () => {
    const read = new FakeReadPort();
    read.details.set("view.artifact", { view: artifactView() });
    const { useCase, instances } = makeUseCase(read);

    const result = await useCase.execute(command());

    assert.equal(result.ok, true);
    assert.equal(instances.saved[0]?.instanceId, "registered.1");
  });

  it("requires a present target definition, supports supplied target definitions, and infers only safe built-ins", async () => {
    const read = new FakeReadPort();
    read.details.set("view.artifact", { view: artifactView({ assetDefinitionRef: undefined }) });
    const missingDefinitions = new FakeDefinitionRepository([]);
    const missing = makeUseCase(read, missingDefinitions);
    assert.equal((await missing.useCase.execute(command())).failure?.code, "unavailable");

    const customDefinition: AssetDefinition = {
      ...BUILT_IN_ASSET_DEFINITIONS.find((definition) => definition.definitionId === "builtin.artifact")!,
      definitionId: "definition.custom-resource",
      displayName: "Custom Resource",
    };
    const definitions = new FakeDefinitionRepository([...BUILT_IN_ASSET_DEFINITIONS, customDefinition]);
    const supplied = makeUseCase(read, definitions);
    const result = await supplied.useCase.execute(command({ targetDefinitionRef: definitionRef(customDefinition) }));
    assert.equal(result.ok, true);
    assert.equal(result.assetInstance?.definitionRef.id, "definition.custom-resource");

    const inferred = makeUseCase(read);
    const inferredResult = await inferred.useCase.execute(command());
    assert.equal(inferredResult.ok, true);
    assert.equal(inferredResult.assetInstance?.definitionRef.id, "builtin.artifact");
  });

  it("validates constructed instances before save and fails safely without raw error exposure", async () => {
    const read = new FakeReadPort();
    read.details.set("view.artifact", { view: artifactView() });
    const definitions = new FakeDefinitionRepository();
    const instances = new FakeInstanceRepository();
    const useCase = new RegisterResourceBackedViewAsAssetInstanceUseCase({
      assetRegistryRead: read,
      definitionRepository: definitions,
      instanceRepository: instances,
      now: () => "2026-05-08T12:00:00.000Z",
      generateInstanceId: () => "../bad",
    });
    const result = await useCase.execute(command());
    assert.equal(result.ok, false);
    assert.equal(result.failure?.code, "validation");
    assert.equal(instances.saved.length, 0);
    assert.doesNotMatch(JSON.stringify(result), /Raw Error|stack|C:\\|\/tmp|token|prompt|workflow|bytes|blob|base64/i);
  });

  it("detects duplicate source identities, does not use display name as identity, and reports conflicts for incompatible definitions", async () => {
    const read = new FakeReadPort();
    read.details.set("view.artifact", { view: artifactView({ displayName: "Changed Name" }) });
    const { useCase, instances } = makeUseCase(read);
    const first = await useCase.execute(command());
    assert.equal(first.ok, true);
    assert.equal((await useCase.execute(command({ displayName: "Different Display" }))).status, "existing");

    instances.instances = [];
    instances.saved.length = 0;
    await instances.saveInstance({
      ...first.assetInstance!,
      instanceId: "registered.other",
      definitionRef: { kind: "asset-definition-version", id: "definition.other" as AssetReference["id"], version: "1.0.0" },
    });
    const conflict = await useCase.execute(command());
    assert.equal(conflict.ok, false);
    assert.equal(conflict.failure?.code, "conflict");

    instances.instances = [{
      ...first.assetInstance!,
      instanceId: "registered.same-name",
      displayName: "Changed Name",
      metadata: undefined,
    }];
    const notDisplayDuplicate = await useCase.execute(command({ displayName: "Changed Name" }));
    assert.equal(notDisplayDuplicate.status, "created");
  });

  it("does not write source systems for generated output or external-object deferrals", async () => {
    const read = new FakeReadPort();
    read.details.set("view.generated", { view: artifactView({ viewId: "view.generated", viewKind: "generated-output", assetType: undefined, assetDefinitionRef: undefined }) });
    read.details.set("view.external", { view: artifactView({ viewId: "view.external", viewKind: "external-repository-object", assetType: "data-source", assetDefinitionRef: undefined, metadata: { imported: false, localized: false, registered: false } }) });
    const { useCase, instances } = makeUseCase(read);

    assert.equal((await useCase.execute(command({ viewId: "view.generated" }))).ok, false);
    assert.equal((await useCase.execute(command({ viewId: "view.external" }))).ok, false);
    assert.equal(instances.saved.length, 0);
  });

  it("keeps source identity, provenance, metadata, and failures sanitized", async () => {
    const read = new FakeReadPort();
    read.details.set("view.artifact", { view: artifactView({
      displayName: "C:\\secret\\file.png",
      metadata: { prompt: "raw prompt text", ok: "safe" },
      resourceBacking: {
        ...artifactView().resourceBacking!,
        backingId: "C:\\secret\\artifact",
      },
    }) });
    const { useCase } = makeUseCase(read);
    const result = await useCase.execute(command({ displayName: "Bearer token abc.def" }));
    assert.equal(result.ok, true);
    const serialized = JSON.stringify(result);
    assert.doesNotMatch(serialized, /C:\\|secret\\|Bearer token|raw prompt text|base64|bytes|blob|workflow|stack/i);
    assert.match(result.sourceIdentity?.deduplicationKey ?? "", /^asset-source\./);
  });

  it("imports no adapters, hosts, public transports, UI, runtime, storage, provider clients, or byte readers", () => {
    const source = readFileSync(
      join(process.cwd(), "modules/application/use-cases/asset/register-resource-backed-view-as-asset-instance.use-case.ts"),
      "utf8",
    );
    assert.doesNotMatch(source, /from\s+["'][^"']*(?:adapters|hosts|contracts\/api|contracts\/ipc|api-express|ipc-electron|preload|renderer|thin-client|runtime\/.*adapter|storage\/.*adapter|persistence\/.*adapter|provider-client|huggingface)[^"']*["']/i);
    assert.doesNotMatch(source, /\b(?:readBytes|readResourceBytes|fetch\(|startRuntime|probeRuntime|installRuntime|repairRuntime|finalizeGeneratedOutput|importExternal|localizeExternal|seedBuiltIns)\b/i);
  });
});

function definitionRef(definition: AssetDefinition): AssetReference {
  return { kind: "asset-definition-version", id: String(definition.definitionId) as AssetReference["id"], version: definition.version };
}

function key(reference: AssetReference): string {
  return `${reference.id}@${reference.version ?? ""}`;
}
