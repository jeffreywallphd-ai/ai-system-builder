import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import type {
  AssetDefinition,
  AssetInstance,
  AssetReference,
  AssetResourceBackedView,
  ImportExternalRepositoryObjectCommand,
} from "../../../../contracts/asset";
import type {
  AssetDefinitionListQuery,
  AssetDefinitionRepositoryPort,
  AssetInstanceListQuery,
  AssetInstanceRepositoryPort,
  ExternalRepositoryObjectLocalizationPort,
  ExternalRepositoryObjectLocalizationRequest,
  ExternalRepositoryObjectLocalizationResult,
} from "../../../ports/asset";
import type { AssetRegistryReadOptions, AssetRegistryResourceBackedViewDetail } from "../../../services/asset";
import { AssetSourceIdentityService, BUILT_IN_ASSET_DEFINITIONS, validateImportExternalRepositoryObjectMutationGuard } from "../../../services/asset";
import { ImportExternalRepositoryObjectAsAssetUseCase } from "..";

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

class FakeExternalObjectPort implements ExternalRepositoryObjectLocalizationPort {
  public readonly calls: ExternalRepositoryObjectLocalizationRequest[] = [];
  public result: ExternalRepositoryObjectLocalizationResult = importedResult();
  public throws = false;
  public async processExternalRepositoryObject(request: ExternalRepositoryObjectLocalizationRequest): Promise<ExternalRepositoryObjectLocalizationResult> {
    this.calls.push(request);
    if (this.throws) throw new Error("C:\\secret\\token raw provider payload stack");
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

function command(overrides: Partial<ImportExternalRepositoryObjectCommand> = {}): ImportExternalRepositoryObjectCommand {
  return {
    operation: "asset.import-external-repository-object",
    workspaceId: "workspace-a" as never,
    viewId: "view.external",
    importMode: "catalog-registration",
    approval: {
      userConfirmed: true,
      confirmationKind: "import-external-object",
      allowNetworkAccess: true,
      allowCredentialUse: true,
      allowFilesystemWrite: true,
      allowPartialCompletion: true,
    },
    actor: { initiatedBy: "human", actorRef: "user.1", actorDisplayName: "User One" },
    context: { requestId: "request.1", correlationId: "correlation.1", idempotencyKey: "idem.1" },
    ...overrides,
  };
}

function externalView(overrides: Partial<AssetResourceBackedView> = {}): AssetResourceBackedView {
  return {
    viewId: "view.external",
    viewKind: "external-repository-object",
    assetType: "data-source",
    assetFamily: "resource-backed",
    sourceRef: { kind: "external-repository-object", id: "external.safe" as AssetReference["id"], label: "External Safe" },
    resourceBacking: {
      backingId: "external.safe",
      resourceKind: "external-repository-object",
      ref: {
        provider: "huggingface",
        repositoryId: "owner/repo",
        revision: "main",
        objectPath: "artifacts/model.bin",
        objectKind: "artifact",
        contentType: "application/octet-stream",
        metadata: { providerLabel: "Hugging Face", repositoryLabel: "owner/repo", objectLabel: "model.bin" },
      },
      role: "source",
      displayName: "External Safe",
      metadata: { signedUrl: "https://example.test/file?token=secret", ok: "safe" },
    },
    displayName: "External Safe",
    metadata: { imported: false, localized: false, registered: false, rawProviderPayload: { token: "secret" } },
    diagnostics: [{ severity: "info", code: "external-object-not-registered", message: "Not registered." }],
    ...overrides,
  };
}

function importedResult(overrides: Partial<ExternalRepositoryObjectLocalizationResult & { ok: true }> = {}): ExternalRepositoryObjectLocalizationResult {
  return {
    ok: true,
    status: "imported",
    resultId: "import.safe",
    internalResourceRefs: [{ kind: "artifact", id: "artifact.imported-safe" as AssetReference["id"], label: "Imported Safe" }],
    internalBackings: [{
      backingId: "artifact.imported-safe",
      resourceKind: "artifact",
      ref: { kind: "artifact", id: "artifact.imported-safe" as AssetReference["id"] },
      role: "primary",
      metadata: { localPath: "C:\\secret\\file.bin", ok: "safe" },
    }],
    providerLabel: "Hugging Face",
    repositoryLabel: "owner/repo",
    objectLabel: "Imported Safe",
    durableState: true,
    ...overrides,
  };
}

function makeUseCase(
  read = new FakeReadPort(),
  definitions = new FakeDefinitionRepository(),
  instances = new FakeInstanceRepository(),
  port: FakeExternalObjectPort | null | undefined = new FakeExternalObjectPort(),
) {
  const externalObjectLocalizer = port ?? undefined;
  return {
    read,
    definitions,
    instances,
    port: externalObjectLocalizer,
    useCase: new ImportExternalRepositoryObjectAsAssetUseCase({
      assetRegistryRead: read,
      externalObjectLocalizer,
      definitionRepository: definitions,
      instanceRepository: instances,
      now: () => "2026-05-08T12:00:00.000Z",
      generateInstanceId: () => `imported.${instances.saved.length + 1}`,
    }),
  };
}

describe("ImportExternalRepositoryObjectAsAssetUseCase", () => {
  it("imports an eligible external object and registers an AssetInstance", async () => {
    const read = new FakeReadPort();
    read.details.set("view.external", { view: externalView() });
    const { useCase, instances, port } = makeUseCase(read);

    const result = await useCase.execute(command());

    assert.equal(result.ok, true);
    assert.equal(result.status, "created");
    assert.equal(port?.calls.length, 1);
    assert.equal(port?.calls[0]?.operation, "import");
    assert.equal(instances.saved.length, 1);
    assert.equal(result.assetInstance?.definitionRef.id, "builtin.artifact");
    assert.equal(result.assetInstance?.metadata?.externalRepositoryObjectImport, true);
    assert.doesNotMatch(JSON.stringify({ result, saved: instances.saved }), /secret-token|signedUrl|rawProviderPayload|localPath|C:\\|token|base64|bytes|blob|stack/i);
    assert.match(String(result.sourceIdentity?.deduplicationKey), /^asset-source\.external-repository-object\.[a-z0-9]+$/);
    const externalMetadata = result.assetInstance?.metadata?.externalRepositoryObject as Record<string, unknown> | undefined;
    const importedIdentity = externalMetadata?.importedOrLocalizedIdentity as Record<string, unknown> | undefined;
    assert.match(String(importedIdentity?.sourceId), /^import\.[a-z0-9]+$/);
  });

  it("runs guard failures before source reads, duplicate lookups, definition lookups, port calls, or saves", async () => {
    const read = new FakeReadPort();
    read.details.set("view.external", { view: externalView() });
    const definitions = new FakeDefinitionRepository();
    const instances = new FakeInstanceRepository();
    const port = new FakeExternalObjectPort();
    const sourceIdentityService = new CountingSourceIdentityService();
    let generatedIds = 0;
    const useCase = new ImportExternalRepositoryObjectAsAssetUseCase({
      assetRegistryRead: read,
      externalObjectLocalizer: port,
      definitionRepository: definitions,
      instanceRepository: instances,
      sourceIdentityService,
      now: () => "2026-05-08T12:00:00.000Z",
      generateInstanceId: () => {
        generatedIds += 1;
        return `imported.${generatedIds}`;
      },
    });

    const failures = [
      command({ approval: { userConfirmed: false, confirmationKind: "import-external-object", allowNetworkAccess: true, allowCredentialUse: true, allowFilesystemWrite: true, allowPartialCompletion: true } }),
      command({ approval: { userConfirmed: true, confirmationKind: "localize-external-object", allowNetworkAccess: true, allowCredentialUse: true, allowFilesystemWrite: true, allowPartialCompletion: true } }),
      command({ approval: { userConfirmed: true, confirmationKind: "import-external-object", allowCredentialUse: true, allowFilesystemWrite: true, allowPartialCompletion: true } }),
      command({ approval: { userConfirmed: true, confirmationKind: "import-external-object", allowNetworkAccess: true, allowFilesystemWrite: true, allowPartialCompletion: true } }),
      command({ approval: { userConfirmed: true, confirmationKind: "import-external-object", allowNetworkAccess: true, allowCredentialUse: true, allowPartialCompletion: true } }),
      command({ approval: { userConfirmed: true, confirmationKind: "import-external-object", allowNetworkAccess: true, allowCredentialUse: true, allowFilesystemWrite: true } }),
    ];

    for (const failingCommand of failures) {
      const result = await useCase.execute(failingCommand);
      assert.equal(result.ok, false);
    }
    assert.equal(read.readCalls.length, 0);
    assert.equal(sourceIdentityService.calls, 0);
    assert.equal(instances.listCalls, 0);
    assert.equal(definitions.getCalls, 0);
    assert.equal(port.calls.length, 0);
    assert.equal(generatedIds, 0);
    assert.equal(instances.saved.length, 0);
  });

  it("keeps import approval conservative for remote-reference and catalog-registration modes", async () => {
    for (const importMode of ["remote-reference", "catalog-registration"] as const) {
      assert.equal(validateImportResult(command({ importMode })), undefined);
      assert.equal(validateImportResult(command({
        importMode,
        approval: { userConfirmed: true, confirmationKind: "import-external-object", allowCredentialUse: true, allowFilesystemWrite: true, allowPartialCompletion: true },
      })), "permission");
      assert.equal(validateImportResult(command({
        importMode,
        approval: { userConfirmed: true, confirmationKind: "import-external-object", allowNetworkAccess: true, allowFilesystemWrite: true, allowPartialCompletion: true },
      })), "permission");
      assert.equal(validateImportResult(command({
        importMode,
        approval: { userConfirmed: true, confirmationKind: "import-external-object", allowNetworkAccess: true, allowCredentialUse: true, allowPartialCompletion: true },
      })), "permission");
      assert.equal(validateImportResult(command({
        importMode,
        approval: { userConfirmed: true, confirmationKind: "import-external-object", allowNetworkAccess: true, allowCredentialUse: true, allowFilesystemWrite: true },
      })), "permission");
    }
  });

  it("re-reads by view id, rejects invalid external views, and does not trust caller payloads", async () => {
    const read = new FakeReadPort();
    read.details.set("view.external", { view: externalView({ displayName: "Server Truth" }) });
    read.details.set("view.artifact", { view: { ...externalView(), viewId: "view.artifact", viewKind: "artifact" } });
    read.details.set("view.repository", { view: externalView({ viewId: "view.repository", resourceBacking: { ...externalView().resourceBacking!, ref: { provider: "huggingface", repositoryId: "owner/repo", objectKind: "repository" } } }) });
    read.details.set("view.unsafe", { view: externalView({ viewId: "view.unsafe", resourceBacking: { ...externalView().resourceBacking!, ref: { provider: "huggingface", repositoryId: "owner/repo", objectPath: "model.bin?token=secret", objectKind: "artifact" } } }) });
    read.details.set("view.unsupported", { view: externalView({ viewId: "view.unsupported", diagnostics: [{ severity: "warning", code: "external-repository-resource-backed-view-source-unavailable", message: "Not wired." }] }) });
    const { useCase, instances, port } = makeUseCase(read);

    const result = await useCase.execute(command({ viewId: "view.external" }));
    assert.equal(result.ok, true);
    assert.equal(read.readCalls[0]?.viewId, "view.external");
    assert.equal(read.readCalls[0]?.options?.includeResourceBackings, true);
    assert.equal(instances.saved[0]?.displayName, "Imported Safe");

    assert.equal((await useCase.execute(command({ viewId: "missing" }))).failure?.code, "not-found");
    assert.equal((await useCase.execute(command({ viewId: "view.artifact" }))).failure?.code, "validation");
    assert.equal((await useCase.execute(command({ viewId: "view.repository" }))).failure?.code, "validation");
    assert.equal((await useCase.execute(command({ viewId: "view.unsafe" }))).failure?.code, "validation");
    assert.equal((await useCase.execute(command({ viewId: "view.unsupported" }))).failure?.code, "validation");
    assert.equal(port?.calls.length, 1);
  });

  it("rejects unsafe external object refs before calling the port", async () => {
    const unsafeRefs: Array<{ name: string; ref: Record<string, unknown> }> = [
      { name: "signed URL", ref: { provider: "huggingface", repositoryId: "owner/repo", objectPath: "model.bin", signedUrl: "https://example.invalid/file?X-Amz-Signature=secret" } },
      { name: "token URL", ref: { provider: "huggingface", repositoryId: "owner/repo", objectPath: "model.bin", downloadUrl: "https://example.invalid/file?token=secret" } },
      { name: "query credentials", ref: { provider: "huggingface", repositoryId: "owner/repo", objectPath: "model.bin?token=secret" } },
      { name: "Bearer", ref: { provider: "huggingface", repositoryId: "owner/repo", objectPath: "model.bin", authorization: "Bearer secret" } },
      { name: "token", ref: { provider: "huggingface", repositoryId: "owner/repo", objectPath: "model.bin", token: "secret" } },
      { name: "secret", ref: { provider: "huggingface", repositoryId: "owner/repo", objectPath: "model.bin", secret: "hidden" } },
      { name: "password", ref: { provider: "huggingface", repositoryId: "owner/repo", objectPath: "model.bin", password: "hidden" } },
      { name: "apiKey", ref: { provider: "huggingface", repositoryId: "owner/repo", objectPath: "model.bin", apiKey: "hidden" } },
      { name: "auth headers", ref: { provider: "huggingface", repositoryId: "owner/repo", objectPath: "model.bin", headers: { authorization: "Bearer hidden" } } },
      { name: "local filesystem path", ref: { provider: "huggingface", repositoryId: "owner/repo", objectPath: "C:\\Users\\name\\model.bin" } },
      { name: "Hugging Face cache path", ref: { provider: "huggingface", repositoryId: "owner/repo", objectPath: "models/model.bin", cachePath: "C:\\Users\\name\\.cache\\huggingface\\hub\\model.bin" } },
      { name: "temp cache path", ref: { provider: "huggingface", repositoryId: "owner/repo", objectPath: "models/model.bin", tempPath: "/tmp/cache/model.bin" } },
      { name: "raw provider payload", ref: { provider: "huggingface", repositoryId: "owner/repo", objectPath: "model.bin", rawProviderPayload: { ok: true } } },
      { name: "raw metadata payload", ref: { provider: "huggingface", repositoryId: "owner/repo", objectPath: "model.bin", rawMetadata: { ok: true } } },
      { name: "bytes", ref: { provider: "huggingface", repositoryId: "owner/repo", objectPath: "model.bin", bytes: [1, 2, 3] } },
      { name: "blob", ref: { provider: "huggingface", repositoryId: "owner/repo", objectPath: "model.bin", blob: "blob" } },
      { name: "base64", ref: { provider: "huggingface", repositoryId: "owner/repo", objectPath: "model.bin", contentBase64: "QUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFB" } },
      { name: "data URL", ref: { provider: "huggingface", repositoryId: "owner/repo", objectPath: "model.bin", dataUrl: "data:application/octet-stream;base64,AAAA" } },
      { name: "command line", ref: { provider: "huggingface", repositoryId: "owner/repo", objectPath: "model.bin", commandLine: "python download.py" } },
      { name: "stack trace", ref: { provider: "huggingface", repositoryId: "owner/repo", objectPath: "model.bin", stack: "Error: bad\n    at file.ts:1:2" } },
      { name: "environment value", ref: { provider: "huggingface", repositoryId: "owner/repo", objectPath: "model.bin", env: "HF_TOKEN=secret" } },
    ];

    for (const { name, ref } of unsafeRefs) {
      const read = new FakeReadPort();
      read.details.set("view.external", { view: externalView({ resourceBacking: { ...externalView().resourceBacking!, ref: ref as never } }) });
      const { useCase, port } = makeUseCase(read);
      const result = await useCase.execute(command());

      assert.equal(result.failure?.code, "validation", name);
      assert.equal(port?.calls.length, 0, name);
      assert.doesNotMatch(JSON.stringify(result), /Bearer secret|HF_TOKEN|X-Amz-Signature|contentBase64|rawProviderPayload|python download|file\.ts|C:\\Users/i, name);
    }
  });

  it("does not call the port before duplicate and target-definition checks pass", async () => {
    const read = new FakeReadPort();
    read.details.set("view.external", { view: externalView() });
    const first = makeUseCase(read);
    const created = await first.useCase.execute(command());
    assert.equal(created.ok, true);

    const duplicate = makeUseCase(read, first.definitions, first.instances, new FakeExternalObjectPort());
    assert.equal((await duplicate.useCase.execute(command())).status, "existing");
    assert.equal(duplicate.port?.calls.length, 0);

    const missingDefinition = makeUseCase(read, new FakeDefinitionRepository([]), new FakeInstanceRepository(), new FakeExternalObjectPort());
    assert.equal((await missingDefinition.useCase.execute(command())).failure?.code, "unavailable");
    assert.equal(missingDefinition.port?.calls.length, 0);
  });

  it("passes only safe descriptor refs and safe request context to the port", async () => {
    const read = new FakeReadPort();
    read.details.set("view.external", { view: externalView() });
    const { useCase, port } = makeUseCase(read);
    await useCase.execute(command({ context: { requestId: "request.safe", correlationId: "correlation.safe", idempotencyKey: "idem.safe" } }));

    const serialized = JSON.stringify(port?.calls[0]);
    assert.match(serialized, /owner\/repo|artifacts\/model.bin|idem.safe/);
    assert.doesNotMatch(serialized, /secret-token|signedUrl|rawProviderPayload|downloadUrl|authorization|authHeader|localPath|C:\\|base64|bytes|blob|payload/i);
    assert.deepEqual(Object.keys(port?.calls[0] ?? {}).sort(), [
      "correlationId",
      "externalObjectRef",
      "idempotencyKey",
      "importMode",
      "operation",
      "requestId",
      "sourceIdentity",
      "targetDefinitionRef",
      "viewId",
    ]);
    assert.deepEqual(Object.keys(port?.calls[0]?.externalObjectRef ?? {}).sort(), [
      "contentType",
      "metadata",
      "objectKind",
      "objectPath",
      "provider",
      "repositoryId",
      "revision",
    ]);
    assert.equal(port?.calls[0]?.externalObjectRef.metadata?.providerLabel, "Hugging Face");
  });

  it("registers missing instances for existing imported state and returns existing on later retries", async () => {
    const read = new FakeReadPort();
    read.details.set("view.external", { view: externalView() });
    const port = new FakeExternalObjectPort();
    port.result = importedResult({ status: "existing" });
    const { useCase, instances } = makeUseCase(read, new FakeDefinitionRepository(), new FakeInstanceRepository(), port);

    const first = await useCase.execute(command());
    const second = await useCase.execute(command());

    assert.equal(first.status, "created");
    assert.equal(second.status, "existing");
    assert.equal(instances.saved.length, 1);
  });

  it("returns partial-failure for validation or save failure after durable import succeeds", async () => {
    const read = new FakeReadPort();
    read.details.set("view.external", { view: externalView() });
    const invalid = new ImportExternalRepositoryObjectAsAssetUseCase({
      assetRegistryRead: read,
      externalObjectLocalizer: new FakeExternalObjectPort(),
      definitionRepository: new FakeDefinitionRepository(),
      instanceRepository: new FakeInstanceRepository(),
      now: () => "2026-05-08T12:00:00.000Z",
      generateInstanceId: () => "../bad",
    });
    const invalidResult = await invalid.execute(command());
    assert.equal(invalidResult.failure?.code, "partial-failure");
    assert.equal(invalidResult.failure?.safeDetails?.retrySafe, true);

    const instances = new FakeInstanceRepository();
    instances.saveFails = true;
    const saveFailure = makeUseCase(read, new FakeDefinitionRepository(), instances, new FakeExternalObjectPort());
    const result = await saveFailure.useCase.execute(command());
    assert.equal(result.failure?.code, "partial-failure");
    assert.equal(result.failure?.safeDetails?.retrySafe, true);
    assert.doesNotMatch(JSON.stringify(result), /raw stack|C:\\|token|prompt|workflow|bytes|blob|base64/i);
  });

  it("returns unavailable or partial safely when the seam or internal backing is missing", async () => {
    const read = new FakeReadPort();
    read.details.set("view.external", { view: externalView() });
    assert.equal((await makeUseCase(read, new FakeDefinitionRepository(), new FakeInstanceRepository(), null).useCase.execute(command())).failure?.code, "unavailable");

    const port = new FakeExternalObjectPort();
    port.result = importedResult({ internalResourceRefs: undefined, internalBackings: undefined, durableState: true });
    const partial = await makeUseCase(read, new FakeDefinitionRepository(), new FakeInstanceRepository(), port).useCase.execute(command());
    assert.equal(partial.failure?.code, "partial-failure");
    assert.equal(partial.failure?.safeDetails?.retrySafe, true);
  });

  it("maps localization port failures to consistent sanitized mutation failure codes", async () => {
    const read = new FakeReadPort();
    read.details.set("view.external", { view: externalView() });

    for (const code of ["validation", "permission", "not-found", "unavailable"] as const) {
      const port = new FakeExternalObjectPort();
      port.result = {
        ok: false,
        failure: {
          code,
          message: `Safe ${code} failure.`,
          diagnostics: [{ severity: "error", code: `safe-${code}`, message: "Safe diagnostic.", safeDetails: { rawProviderPayload: "hidden", ok: "safe" } }],
          safeDetails: { authorization: "Bearer hidden", ok: "safe" },
        },
      };

      const result = await makeUseCase(read, new FakeDefinitionRepository(), new FakeInstanceRepository(), port).useCase.execute(command({ context: { idempotencyKey: `idem.${code}` } }));
      assert.equal(result.failure?.code, code);
      assert.doesNotMatch(JSON.stringify(result), /Bearer hidden|rawProviderPayload|authorization|token|C:\\|stack/i);
    }

    const throwingPort = new FakeExternalObjectPort();
    throwingPort.throws = true;
    const internal = await makeUseCase(read, new FakeDefinitionRepository(), new FakeInstanceRepository(), throwingPort).useCase.execute(command({ context: { idempotencyKey: "idem.internal" } }));
    assert.equal(internal.failure?.code, "internal");
    assert.doesNotMatch(JSON.stringify(internal), /C:\\secret|raw provider|token|stack/i);
  });

  it("imports no adapters, hosts, public transports, UI, runtime, storage adapters, provider clients, or byte readers", () => {
    const source = readFileSync(
      join(process.cwd(), "modules/application/use-cases/asset/external-repository-object-as-asset-workflow.ts"),
      "utf8",
    );
    assert.doesNotMatch(source, /from\s+["'][^"']*(?:adapters|hosts|contracts\/api|contracts\/ipc|api-express|ipc-electron|preload|renderer|thin-client|runtime\/.*adapter|storage\/.*adapter|persistence\/.*adapter|provider-client|huggingface)[^"']*["']/i);
    assert.doesNotMatch(source, /\b(?:readBytes|readResourceBytes|fetch\(|startRuntime|probeRuntime|installRuntime|repairRuntime|RuntimeTaskRegistry|ComfyUI|ImageGenerationUseCase|seedBuiltIns|discoverModels|prepareDataset|trainModel|validateModel|publishModel|download\(|upload\(|readContent)\b/i);
  });
});

function validateImportResult(input: ImportExternalRepositoryObjectCommand): string | undefined {
  return validateImportExternalRepositoryObjectMutationGuard(input)?.code;
}

function definitionRef(definition: AssetDefinition): AssetReference {
  return { kind: "asset-definition-version", id: String(definition.definitionId) as AssetReference["id"], version: definition.version };
}

function key(reference: AssetReference): string {
  return `${reference.id}@${reference.version ?? ""}`;
}
