import { createTestImageResourceIdentity } from "./fixtures/image-resource-identities.fixture";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import type {
  AssetBinding,
  AssetComposition,
  AssetDefinition,
  AssetInstance,
  AssetReference,
  AssetResourceBackedView,
} from "../../../../contracts/asset";
import { normalizeAssetId } from "../../../../contracts/asset";
import type { ArtifactBrowseItem, ArtifactBrowseSuccessValue } from "../../../../contracts/artifact-browser";
import { createSuccessResult, type ContractResult } from "../../../../contracts/shared";
import type { ArtifactBrowserMetadataReadPort } from "../../../ports/artifact-browser";
import type {
  AssetBindingListQuery,
  AssetBindingRepositoryPort,
  AssetCompositionListQuery,
  AssetCompositionRepositoryPort,
  AssetDefinitionListQuery,
  AssetDefinitionRepositoryPort,
  AssetInstanceListQuery,
  AssetInstanceRepositoryPort,
  AssetResourceBackedViewProvider,
} from "../../../ports/asset";
import type { ModelRegistryPort } from "../../../ports/model";
import { BUILT_IN_ASSET_DEFINITION_CATALOG } from "../built-ins";
import { readSystemFoundationManifest } from "../../asset-packs/system-packs/system-foundation-pack-v3.manifest";
import { ArtifactResourceBackedViewProvider } from "../asset-artifact-resource-backed-view-provider.service";
import { AssetDatasetModelResourceBackedViewProvider, type SafeDatasetDescriptorSource } from "../asset-dataset-model-resource-backed-view-provider.service";
import { AssetExternalRepositoryResourceBackedViewProvider, type SafeExternalRepositoryObjectDescriptorSource } from "../asset-external-repository-resource-backed-view-provider.service";
import { AssetImageResourceBackedViewProvider, type GeneratedImageOutputDescriptorSource } from "../asset-image-resource-backed-view-provider.service";
import { AssetRegistryReadFacade, AssetRegistryReadFacadeError } from "../asset-registry-read-facade.service";

const definitionRef: AssetReference = { kind: "asset-definition-version", id: normalizeAssetId("definition.alpha"), version: "1.0.0" };
const instanceRef: AssetReference = { kind: "asset-instance", id: normalizeAssetId("instance.alpha") };
const compositionRef: AssetReference = { kind: "asset-composition", id: normalizeAssetId("composition.alpha"), version: "1.0.0" };
const bindingRef: AssetReference = { kind: "asset-binding", id: normalizeAssetId("binding.alpha") };

class FakeDefinitionRepository implements AssetDefinitionRepositoryPort {
  public readonly saved: AssetDefinition[] = [];
  public readonly deleted: AssetReference[] = [];
  public lastQuery?: AssetDefinitionListQuery;
  public failReads = false;
  private readonly definitions = new Map<string, AssetDefinition>();

  public constructor(definitions: readonly AssetDefinition[] = []) {
    for (const definition of definitions) this.definitions.set(definitionMapKey(definition), definition);
  }

  public async saveDefinition(definition: AssetDefinition): Promise<AssetDefinition> { this.saved.push(definition); this.definitions.set(definitionMapKey(definition), definition); return definition; }
  public async getDefinition(reference: AssetReference): Promise<AssetDefinition | undefined> { if (this.failReads) throw new Error("/tmp/provider secret token stack"); return this.definitions.get(`${reference.id}@${reference.version ?? ""}`) ?? this.definitions.get(`${reference.id}@1.0.0`) ?? this.definitions.get(reference.id); }
  public async listDefinitions(query?: AssetDefinitionListQuery) {
    if (this.failReads) throw new Error("/tmp/provider secret token stack");
    this.lastQuery = query;
    const definitions = [...this.definitions.values()]
      .filter((definition) => !query?.assetType || definition.assetType === query.assetType)
      .filter((definition) => !query?.assetFamily || definition.assetFamily === query.assetFamily)
      .filter((definition) => !query?.assetTypes?.length || query.assetTypes.includes(definition.assetType))
      .filter((definition) => !query?.assetFamilies?.length || query.assetFamilies.includes(definition.assetFamily))
      .filter((definition) => !query?.lifecycleStatus || definition.lifecycleStatus === query.lifecycleStatus)
      .filter((definition) => matchesTextQuery(query?.text, [definition.definitionId, definition.displayName, definition.description, definition.assetType, definition.assetFamily]));
    return { definitions: takeLimit(definitions, query?.limit), nextCursor: query?.cursor ? "next-definition" : undefined };
  }
  public async deleteDefinition(reference: AssetReference): Promise<void> { this.deleted.push(reference); }
}

class FakeInstanceRepository implements AssetInstanceRepositoryPort {
  public readonly saved: AssetInstance[] = [];
  public readonly deleted: AssetReference[] = [];
  public lastQuery?: AssetInstanceListQuery;
  private readonly instances = new Map<string, AssetInstance>();

  public constructor(instances: readonly AssetInstance[] = []) {
    for (const instance of instances) this.instances.set(String(instance.instanceId), instance);
  }

  public async saveInstance(instance: AssetInstance): Promise<AssetInstance> { this.saved.push(instance); this.instances.set(String(instance.instanceId), instance); return instance; }
  public async getInstance(reference: AssetReference): Promise<AssetInstance | undefined> { return this.instances.get(reference.id); }
  public async listInstances(query?: AssetInstanceListQuery) {
    this.lastQuery = query;
    const instances = [...this.instances.values()]
      .filter((instance) => !query?.lifecycleStatus || instance.lifecycleStatus === query.lifecycleStatus)
      .filter((instance) => matchesTextQuery(query?.text, [instance.instanceId, instance.displayName, instance.stateSummary?.summary]));
    return { instances: takeLimit(instances, query?.limit), nextCursor: query?.cursor ? "next-instance" : undefined };
  }
  public async deleteInstance(reference: AssetReference): Promise<void> { this.deleted.push(reference); }
}

class FakeCompositionRepository implements AssetCompositionRepositoryPort {
  public readonly saved: AssetComposition[] = [];
  public readonly deleted: AssetReference[] = [];
  public lastQuery?: AssetCompositionListQuery;
  private readonly compositions = new Map<string, AssetComposition>();

  public constructor(compositions: readonly AssetComposition[] = []) {
    for (const composition of compositions) this.compositions.set(String(composition.compositionId), composition);
  }

  public async saveComposition(composition: AssetComposition): Promise<AssetComposition> { this.saved.push(composition); this.compositions.set(String(composition.compositionId), composition); return composition; }
  public async getComposition(reference: AssetReference): Promise<AssetComposition | undefined> { return this.compositions.get(reference.id); }
  public async listCompositions(query?: AssetCompositionListQuery) {
    this.lastQuery = query;
    const compositions = [...this.compositions.values()]
      .filter((composition) => !query?.lifecycleStatus || composition.lifecycleStatus === query.lifecycleStatus)
      .filter((composition) => matchesTextQuery(query?.text, [composition.compositionId, composition.displayName, composition.description, composition.compositionType]));
    return { compositions: takeLimit(compositions, query?.limit), nextCursor: query?.cursor ? "next-composition" : undefined };
  }
  public async deleteComposition(reference: AssetReference): Promise<void> { this.deleted.push(reference); }
}

class FakeBindingRepository implements AssetBindingRepositoryPort {
  public readonly saved: AssetBinding[] = [];
  public readonly deleted: AssetReference[] = [];
  public lastQuery?: AssetBindingListQuery;
  private readonly bindings = new Map<string, AssetBinding>();

  public constructor(bindings: readonly AssetBinding[] = []) {
    for (const binding of bindings) this.bindings.set(String(binding.bindingId), binding);
  }

  public async saveBinding(binding: AssetBinding): Promise<AssetBinding> { this.saved.push(binding); this.bindings.set(String(binding.bindingId), binding); return binding; }
  public async getBinding(reference: AssetReference): Promise<AssetBinding | undefined> { return this.bindings.get(reference.id); }
  public async listBindings(query?: AssetBindingListQuery) { this.lastQuery = query; return { bindings: [...this.bindings.values()] }; }
  public async deleteBinding(reference: AssetReference): Promise<void> { this.deleted.push(reference); }
}

class FakeArtifactBrowserMetadataRead implements Pick<ArtifactBrowserMetadataReadPort, "browseArtifacts"> {
  public browseCalls = 0;
  public readContentCalls = 0;
  public readDetailCalls = 0;

  public constructor(private readonly items: readonly ArtifactBrowseItem[]) {}

  public async browseArtifacts(): Promise<ContractResult<ArtifactBrowseSuccessValue>> {
    this.browseCalls += 1;
    return createSuccessResult({ items: [...this.items] });
  }

  public async readArtifactDetail(request: Parameters<ArtifactBrowserMetadataReadPort["readArtifactDetail"]>[0]) {
    this.readDetailCalls += 1;
    const item = this.items.find((candidate) => candidate.storageKey === request.locator.storageKey) ?? this.items[0]!;
    return createSuccessResult({
      artifact: {
        locator: request.locator,
        artifactFamily: item.artifactFamily,
        mediaType: item.mediaType,
        sizeBytes: item.sizeBytes,
        sourceKind: item.sourceKind,
        originalName: item.originalName,
        createdAt: item.createdAt,
        metadata: item.metadata,
      },
    });
  }
}

class FakeGeneratedOutputDescriptorSource implements GeneratedImageOutputDescriptorSource {
  public byteReadCalls = 0;
  public statusReadCalls = 0;
  public generationCalls = 0;
  public async readGeneratedImageOutputDescriptor(workspaceId: string, outputId: string) {
    if (workspaceId !== "workspace-a" || outputId !== "output-facade") return undefined;
    return (await this.listGeneratedImageOutputDescriptors()).items[0];
  }

  public async listGeneratedImageOutputDescriptors() {
    return {
      items: [
        {
          outputId: "output-facade",
          output: {
            type: "image" as const,
            engine: "comfyui",
            fileName: "Draft.png",
            contentBase64: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ=",
            mediaType: "image/png",
            promptId: "prompt-hidden",
          },
          metadata: unsafeMetadata(),
        },
      ],
    };
  }
}

class FakeImageAssetDescriptorRead {
  public byteReadCalls = 0;
  public storageScanCalls = 0;
  public createAssetInstanceCalls = 0;
  public persistMappingCalls = 0;
  public async readImageAssetDescriptor(workspaceId: string, assetId: string) {
    if (workspaceId !== "workspace-a" || assetId !== "image-facade") return undefined;
    return (await this.listImageAssetDescriptors()).items[0];
  }

  public async listImageAssetDescriptors() {
    return {
      items: [
        {
          workspaceId: "workspace-a" as never,
          assetId: "image-facade",
          artifactId: "artifact-facade",
          source: "generated" as const,
          metadata: {
            originalFileName: "Final.png",
            prompt: "hidden prompt",
            negativePrompt: "hidden negative prompt",
            engine: "comfyui",
            seed: 12,
            createdAt: "2026-01-01T00:00:00.000Z",
            ...unsafeMetadata(),
          },
        },
      ],
    };
  }
}

class FakeDatasetDescriptorSource implements SafeDatasetDescriptorSource {
  public prepareCalls = 0;
  public fileReadCalls = 0;
  public storageScanCalls = 0;

  public async listDatasetDescriptors() {
    return {
      items: [
        {
          id: "dataset-facade",
          name: "Facade Dataset",
          schema: { fieldCount: 1, fields: [{ name: "text", type: "string" }] },
          sourceArtifacts: [{ key: "artifact-dataset" }],
          materializations: [{ artifactKey: "datasets/private/facade.parquet", format: "parquet", rowCount: 5 }],
          metadata: unsafeMetadata(),
        },
      ],
    };
  }

  public async readDatasetDescriptor(datasetId: string) {
    const result = await this.listDatasetDescriptors();
    return result.items.find((item) => item.id === datasetId);
  }
}

class FakeExternalRepositoryObjectDescriptorSource implements SafeExternalRepositoryObjectDescriptorSource {
  public providerNetworkCalls = 0;
  public cacheReadCalls = 0;
  public runtimeCalls = 0;
  public fileReadCalls = 0;
  public validationCalls = 0;

  public async listExternalRepositoryObjectDescriptors() {
    return {
      items: [
        {
          descriptorId: "external-facade",
          provider: "huggingface",
          repositoryId: "org/facade",
          revision: "main",
          objectPath: "models/facade.safetensors",
          objectKind: "model",
          sizeBytes: 100,
          metadata: unsafeMetadata(),
        },
      ],
    };
  }

  public async readExternalRepositoryObjectDescriptor(descriptorId: string) {
    const result = await this.listExternalRepositoryObjectDescriptors();
    return result.items.find((item) => item.descriptorId === descriptorId);
  }
}

class FakeModelRegistry implements Pick<ModelRegistryPort, "listModels" | "getModelRecord"> {
  public discoveryCalls = 0;
  public validationCalls = 0;
  public trainingCalls = 0;
  public publishingCalls = 0;
  public localModelScanCalls = 0;

  private readonly records = [
    {
      modelRecordId: "model-facade",
      displayName: "Facade Model",
      source: "generated" as const,
      lifecycleStatus: "validated" as const,
      artifactForm: "adapter" as const,
      provider: "unknown" as const,
      createdAt: "2026-01-01T00:00:00.000Z",
      validationStatus: "valid" as const,
      backingArtifactIds: ["artifact-model"],
      localPath: "C:\\Users\\name\\.cache\\huggingface\\model",
      validationReportPath: "/tmp/model-report.json",
      metadata: unsafeMetadata(),
    },
  ];

  public async listModels(request: Parameters<ModelRegistryPort["listModels"]>[0]) {
    if (request.includeDiscovered !== false) this.discoveryCalls += 1;
    return { models: this.records.slice(0, request.limit) };
  }

  public async getModelRecord(modelRecordId: string) {
    return this.records.find((record) => record.modelRecordId === modelRecordId);
  }
}

function artifactItem(overrides: Partial<ArtifactBrowseItem> = {}): ArtifactBrowseItem {
  return {
    artifactId: "artifact-readme",
    storageKey: "uploads/private/readme.md",
    artifactFamily: "document",
    mediaType: "text/markdown",
    originalName: "Readme.md",
    sourceKind: "upload",
    metadata: unsafeMetadata(),
    ...overrides,
  };
}


function takeLimit<T>(values: readonly T[], limit: number | undefined): readonly T[] {
  return typeof limit === "number" && Number.isFinite(limit) ? values.slice(0, Math.max(0, Math.floor(limit))) : values;
}

function matchesTextQuery(text: string | undefined, values: readonly (string | undefined)[]): boolean {
  const needle = text?.trim().toLowerCase();
  if (!needle) return true;
  return values.some((value) => value?.toLowerCase().includes(needle));
}

function definitionMapKey(definition: AssetDefinition): string {
  return `${definition.definitionId}@${definition.version ?? ""}`;
}

function createFacade(overrides: Partial<ConstructorParameters<typeof AssetRegistryReadFacade>[0]> = {}) {
  const definitionRepository = overrides.definitionRepository ?? new FakeDefinitionRepository([validDefinition()]);
  const instanceRepository = overrides.instanceRepository ?? new FakeInstanceRepository([validInstance()]);
  const compositionRepository = overrides.compositionRepository ?? new FakeCompositionRepository([validComposition()]);
  return new AssetRegistryReadFacade({ definitionRepository, instanceRepository, compositionRepository, ...overrides });
}

function validDefinition(overrides: Partial<AssetDefinition> = {}): AssetDefinition {
  return {
    definitionId: "definition.alpha",
    assetType: "tool",
    assetFamily: "behavioral",
    version: "1.0.0",
    displayName: "Alpha Tool",
    description: "Reusable alpha tool definition.",
    lifecycleStatus: "draft",
    reviewStatus: "unreviewed",
    provenance: { sourceKind: "human-authored" },
    configurationSchema: { schemaId: "definition.alpha.config", schemaVersion: "1.0.0", fields: [{ fieldId: "safeField", valueKind: "string", label: "Safe field" }] },
    requirements: [{ requirementId: "runtime.alpha", requirementKind: "runtime-capability", required: true, hostKind: "desktop-or-server", runtimeCapabilityId: "image-generation", permissionKind: "runtime-execution", safetyStatus: "requires-review" }],
    ports: [{ portId: "output", direction: "output", contract: { contractKind: "asset", assetType: "tool" } }],
    aiContext: { purpose: "Explain alpha safely.", userFacingSummary: "Alpha", developerFacingSummary: "Alpha developer summary.", capabilities: [{ summary: "Alpha" }], limitations: [{ summary: "No runtime execution." }], inputSummary: { summary: "Input" }, outputSummary: { summary: "Output" }, configurationGuidance: { summary: "Configure" }, compositionGuidance: { summary: "Compose" }, safetyNotes: [{ category: "operational", summary: "Safe", severity: "info" }] },
    metadata: unsafeMetadata(),
    ...overrides,
  };
}

function validInstance(overrides: Partial<AssetInstance> = {}): AssetInstance {
  return {
    instanceId: "instance.alpha",
    definitionRef,
    displayName: "Alpha Instance",
    lifecycleStatus: "draft",
    selectedConfiguration: { safeField: "visible", token: "token=super-secret", localPath: "/tmp/secret.txt" },
    stateSummary: { status: "ready", summary: "Safe state" },
    provenance: { sourceKind: "human-authored" },
    metadata: unsafeMetadata(),
    ...overrides,
  };
}

function validBinding(overrides: Partial<AssetBinding> = {}): AssetBinding {
  return {
    bindingId: "binding.alpha",
    bindingKind: "input",
    sourceRef: instanceRef,
    targetRef: definitionRef,
    lifecycleStatus: "draft",
    provenance: { sourceKind: "human-authored" },
    metadata: unsafeMetadata(),
    ...overrides,
  };
}

function validComposition(overrides: Partial<AssetComposition> = {}): AssetComposition {
  return {
    compositionId: "composition.alpha",
    compositionType: "feature",
    displayName: "Alpha Feature",
    description: "Feature composed from alpha instance.",
    version: "1.0.0",
    lifecycleStatus: "draft",
    rootInstanceRefs: [instanceRef],
    instanceRefs: [instanceRef],
    bindingRefs: [bindingRef],
    provenance: { sourceKind: "human-authored" },
    metadata: unsafeMetadata(),
    ...overrides,
  };
}

function unsafeMetadata() {
  return {
    safe: "visible",
    localPath: "/tmp/secret/file.txt",
    token: "bearer abcdef",
    password: "password=hidden",
    apiKey: "api_key=hidden",
    commandLine: "curl secret",
    stackTrace: "Error: boom\n at stack",
    rawPayload: { nestedSecret: "secret=hidden" },
    requestId: "request-hidden",
    taskId: "task-hidden",
    blobBytes: "AAAA",
    contentBase64: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ=",
    env: { SECRET_ENV: "hidden" },
  };
}

function serialized(value: unknown): string {
  return JSON.stringify(value).toLowerCase();
}

function assertSafe(value: unknown) {
  const output = serialized(value);
  for (const forbidden of ["/tmp/", "token", "secret", "password", "apikey", "api_key", "commandline", "stacktrace", "rawpayload", "blobbytes", "contentbase64", "secret_env", "bearer", "hidden prompt", "hidden negative prompt", "prompt-hidden", "request-hidden", "task-hidden"]) {
    assert.equal(output.includes(forbidden), false, `serialized output included ${forbidden}: ${output}`);
  }
}

describe("AssetRegistryReadFacade definition reads", () => {
  it("lists definition cards from repository records and reads definition detail by reference", async () => {
    const facade = createFacade();
    const list = await facade.listDefinitionCards();
    assert.equal(list.items.length, 1);
    assert.equal(list.items[0]?.definitionId, "definition.alpha");
    assert.equal(list.items[0]?.displayName, "Alpha Tool");
    assert.equal(list.items[0]?.metadata, undefined);

    const detail = await facade.readDefinitionDetail(definitionRef, { includeConfigurationSchema: true, includePorts: true, includeRequirements: true, includeAiContext: true });
    assert.equal(detail?.definition.definitionId, "definition.alpha");
    assert.ok(detail?.definition.configurationSchema);
    assert.ok(detail?.definition.ports);
    assert.ok(detail?.definition.requirements);
    assert.ok(detail?.definition.aiContext);
    assert.equal(await facade.readDefinitionDetail({ kind: "asset-definition", id: normalizeAssetId("missing") }), undefined);
  });

  it("includes only safe pack, source, category, and override read fields on definition cards", async () => {
    const facade = createFacade({
      definitionRepository: new FakeDefinitionRepository([
        validDefinition({
          definitionId: "definition.system",
          metadata: {
            sourcePackId: "system.foundation",
            sourcePackVersion: "1.0.0",
            categoryId: "ui-structure",
            assetPackInstall: {
              packId: "system.foundation",
              packVersion: "1.0.0",
              entryId: "builtin.definition.system",
              fingerprint: "fnv1a:definition-system",
              sourceKind: "system",
              sourceLayer: "system-default",
              trustStatus: "system-trusted",
              managedBy: "asset-kernel",
              installedAt: "2026-05-09T12:00:00.000Z",
            },
            overridesDefinitionRef: { kind: "asset-definition-version", id: "definition.base", version: "1.0.0" },
            overriddenByDefinitionRefs: [
              { kind: "asset-definition-version", id: "definition.child", version: "1.0.0" },
              { kind: "asset-definition-version", id: "C:\\Users\\name\\secret", version: "Bearer token" },
            ],
            effectiveResolutionStatus: "available",
            resolutionSummary: "Safe informational summary.",
            unsafeSourcePackDisplayName: "Bearer token C:\\Users\\name\\secret",
          },
        }),
      ]),
    });

    const card = (await facade.listDefinitionCards()).items[0]!;

    assert.equal(card.sourcePackId, undefined);
    assert.equal(card.sourcePackVersion, undefined);
    assert.equal(card.sourcePackDisplayName, undefined);
    assert.equal(card.sourceKind, undefined);
    assert.equal(card.sourceLayer, undefined);
    assert.equal(card.trustStatus, undefined);
    assert.equal(card.packCategoryId, "ui-structure");
    assert.equal(card.packCategoryDisplayName, "UI Structure");
    assert.equal(card.systemDefault, undefined);
    assert.deepEqual(card.overridesDefinitionRef, { kind: "asset-definition-version", id: "definition.base", version: "1.0.0" });
    assert.deepEqual(card.overriddenByDefinitionRefs, [{ kind: "asset-definition-version", id: "definition.child", version: "1.0.0" }]);
    assert.equal(card.effectiveResolutionStatus, "available");
    assert.equal(card.resolutionSummary, "Safe informational summary.");
    assert.equal(JSON.stringify(card).includes("Bearer"), false);
    assert.equal(JSON.stringify(card).includes("C:\\Users"), false);
    assertSafe(card);
  });

  it("filters built-in/custom lists using exact content, consistently with single and batch details", async () => {
    const seed = BUILT_IN_ASSET_DEFINITION_CATALOG[0]!;
    const foundation = readSystemFoundationManifest("3.0.0")!.assets[0]!.definition;
    const forged = validDefinition({ definitionId: "definition.forged", metadata: {
      builtInSeed: { seedId: seed.seedId, seedVersion: seed.seedVersion, fingerprint: seed.fingerprint, managedBy: "asset-kernel", lastSeededAt: "2026-01-01T00:00:00.000Z" },
      sourcePackId: "system.foundation", sourcePackVersion: "3.0.0", sourceKind: "system",
      sourceLayer: "system-default", trustStatus: "system-trusted", systemDefault: true,
      sourcePackDisplayName: "System Foundation",
    } });
    const modified = { ...seed.definition, displayName: "Changed content" };
    const differentVersion = { ...seed.definition, version: "9.9.9" };
    for (const definition of [seed.definition, foundation, forged, modified, differentVersion]) {
      const repo = new FakeDefinitionRepository([definition]);
      const facade = createFacade({ definitionRepository: repo });
      const expected = definition === seed.definition || definition === foundation;
      const ref = { kind: "asset-definition-version", id: definition.definitionId, version: definition.version } as AssetReference;
      const card = (await facade.listDefinitionCards({ includeMetadata: true })).items[0]!;
      const single = await facade.readDefinitionDetail(ref, { includeMetadata: true });
      const batch = (await facade.readDefinitionDetails([ref], { includeMetadata: true }))[0];
      assert.equal(card.builtIn, expected ? true : undefined);
      assert.equal(single?.builtIn, card.builtIn);
      assert.deepEqual(batch, single);
      assert.equal((await facade.listDefinitionCards({ includeCustom: false })).items.length, expected ? 1 : 0);
      assert.equal((await facade.listDefinitionCards({ includeBuiltIns: false })).items.length, expected ? 0 : 1);
      if (definition === foundation) {
        assert.equal(card.systemDefault, true);
        assert.equal(card.trustStatus, "system-trusted");
        assert.equal(single?.definition.metadata?.systemDefault, true);
      }
      if (!expected) for (const value of [card, single?.definition.metadata]) {
        assert.equal(value?.systemDefault, undefined);
        assert.equal(value?.sourceKind, undefined);
        assert.equal(value?.trustStatus, undefined);
        assert.equal(value?.sourcePackId, undefined);
      }
      assert.equal(repo.saved.length, 0);
      assert.equal(repo.deleted.length, 0);
    }
    const facade = createFacade();
    assert.deepEqual((await facade.listDefinitionCards({ searchText: "alpha" })).items.map(card => card.definitionId), ["definition.alpha"]);
    assert.equal((await facade.listDefinitionCards({ assetTypes: ["dataset"] })).items.length, 0);
  });

  it("retains custom source descriptors and nonpositive trust states without positive marker fallbacks", async () => {
    for (const trustStatus of ["unverified", "restricted", "blocked", "trusted", "system-trusted"]) {
      const definition = validDefinition({ metadata: { sourcePackId: "custom.pack", sourceKind: "user", sourceLayer: "workspace-pack", trustStatus } });
      const facade = createFacade({ definitionRepository: new FakeDefinitionRepository([definition]) });
      const card = (await facade.listDefinitionCards({ includeMetadata: true })).items[0]!;
      assert.equal(card.sourcePackId, "custom.pack");
      assert.equal(card.sourceKind, "user");
      assert.equal(card.workspacePack, true);
      assert.equal(card.builtIn, undefined);
      assert.equal(card.trustStatus, ["trusted", "system-trusted"].includes(trustStatus) ? undefined : trustStatus);
    }
  });

  it("withholds normalized positive cues including padded top-level and installer fallback values", async () => {
    for (const padding of [" ", "\t", "\u00a0", "\ufeff"]) {
      const claims = { sourcePackId: `${padding}system.foundation${padding}`,
        sourcePackVersion: "3.0.0", sourcePackDisplayName: `${padding}System Foundation${padding}`,
        sourceKind: `${padding}system${padding}`, sourceLayer: `${padding}system-default${padding}`,
        trustStatus: `${padding}system-trusted${padding}`, systemDefault: true };
      for (const metadata of [claims, { assetPackInstall: {
        packId: claims.sourcePackId, packVersion: claims.sourcePackVersion,
        sourceKind: claims.sourceKind, sourceLayer: claims.sourceLayer, trustStatus: claims.trustStatus,
        entryId: "forged", fingerprint: "forged", managedBy: "asset-kernel", installedAt: "2026-01-01T00:00:00.000Z",
      } }]) {
        const definition = validDefinition({ metadata });
        const facade = createFacade({ definitionRepository: new FakeDefinitionRepository([definition]) });
        const card = (await facade.listDefinitionCards({ includeMetadata: true })).items[0]!;
        const detail = await facade.readDefinitionDetail(definitionRef, { includeMetadata: true });
        for (const value of [card, card.metadata, detail?.definition.metadata]) {
          for (const field of ["builtIn", "systemDefault", "sourcePackId", "sourcePackDisplayName", "sourceKind", "sourceLayer", "trustStatus", "assetPackInstall"])
            assert.equal((value as Record<string, unknown> | undefined)?.[field], undefined, field);
        }
        assert.equal(detail?.builtIn, undefined);
      }
    }
  });

  it("rejects accessor-bearing definitions without reading getters or mutating storage", async () => {
    let getters = 0;
    const definition = Object.defineProperty(validDefinition(), "displayName", { enumerable: true, get() { getters++; return "Forged"; } });
    const repo = new FakeDefinitionRepository([definition]);
    // Bypass fixture text filtering, which is outside the facade boundary.
    repo.listDefinitions = async () => ({ definitions: [definition] });
    const facade = createFacade({ definitionRepository: repo });
    await assert.rejects(() => facade.listDefinitionCards(), /Asset registry read failed/);
    await assert.rejects(() => facade.readDefinitionDetail(definitionRef), /Asset registry read failed/);
    assert.equal(getters, 0);
    assert.equal(repo.saved.length + repo.deleted.length, 0);
  });

  it("keeps passive records with invalid authority timestamps readable as custom content", async () => {
    const seed = BUILT_IN_ASSET_DEFINITION_CATALOG[0]!;
    for (const timestamp of [undefined, "not-a-time", "2026-02-30T00:00:00.000Z"]) {
      const definition = { ...seed.definition, metadata: { ...seed.definition.metadata, builtInSeed: {
        seedId: seed.seedId, seedVersion: seed.seedVersion, fingerprint: seed.fingerprint,
        managedBy: "asset-kernel", lastSeededAt: timestamp,
      } } };
      const repo = new FakeDefinitionRepository([definition]);
      const facade = createFacade({ definitionRepository: repo });
      const ref = { kind: "asset-definition-version", id: definition.definitionId, version: definition.version } as AssetReference;
      const card = (await facade.listDefinitionCards({ includeMetadata: true })).items[0]!;
      const detail = await facade.readDefinitionDetail(ref, { includeMetadata: true });
      assert.equal(card.displayName, definition.displayName);
      assert.equal(detail?.definition.displayName, definition.displayName);
      assert.deepEqual((await facade.readDefinitionDetails([ref], { includeMetadata: true }))[0], detail);
      assert.equal(card.builtIn, undefined);
      assert.equal(detail?.builtIn, undefined);
      for (const metadata of [card.metadata, detail?.definition.metadata]) {
        assert.equal(metadata?.builtInSeed, undefined);
        assert.equal(metadata?.systemDefault, undefined);
        assert.equal(metadata?.trustStatus, undefined);
      }
      assert.equal((await facade.listDefinitionCards({ includeCustom: false })).items.length, 0);
      assert.equal((await facade.listDefinitionCards({ includeBuiltIns: false })).items.length, 1);
      assert.equal(repo.saved.length + repo.deleted.length, 0);
    }
  });

  it("denies malformed unknown custom bodies consistently on list, single and native/fallback batch reads", async () => {
    let callbacks = 0;
    const original = validDefinition({ definitionId: "definition.custom.unknown", metadata: {} });
    const cyclic: Record<string, unknown> = {}; cyclic.child = cyclic;
    let deep: unknown = {};
    for (let index = 0; index < 14; index++) deep = { child: deep };
    const malformed = [
      Object.defineProperty({ ...original }, "displayName", { enumerable: true, get() { callbacks++; return "Custom"; } }),
      { ...original, toJSON() { callbacks++; return original; } },
      { ...original, metadata: cyclic }, { ...original, metadata: deep },
      { ...original, description: "x".repeat(2049) }, { ...original, requirements: new Array(1025).fill(null) },
      { ...original, requirements: new Array(2) },
      { ...original, metadata: { groups: Array.from({ length: 5 }, () => new Array(1024).fill(null)) } },
      { ...original, metadata: Object.fromEntries(Array.from({ length: 128 }, (_, i) => [`field${i}`, "x".repeat(2048)])) },
    ];
    for (const value of malformed) for (const nativeBatch of [false, true]) {
      const definition = value as AssetDefinition;
      const repo = new FakeDefinitionRepository([definition]);
      repo.listDefinitions = async () => ({ definitions: [definition] });
      if (nativeBatch) Object.assign(repo, { getDefinitions: async (refs: readonly AssetReference[]) => refs.map(() => definition) });
      const facade = createFacade({ definitionRepository: repo });
      const ref = { kind: "asset-definition-version", id: original.definitionId, version: original.version } as AssetReference;
      for (const read of [() => facade.listDefinitionCards(), () => facade.readDefinitionDetail(ref), () => facade.readDefinitionDetails([ref])]) {
        await assert.rejects(read, (error: unknown) => error instanceof AssetRegistryReadFacadeError
          && error.code === "repository-read-failed" && error.message === "Asset registry read failed.");
      }
      assert.equal(repo.saved.length + repo.deleted.length, 0);
    }
    assert.equal(callbacks, 0);
  });

  it("detaches projected detail bodies across caller storage, repeated reads and batch positions", async () => {
    const definition = validDefinition({ metadata: { note: "Readable" } });
    const repo = new FakeDefinitionRepository([definition]);
    const facade = createFacade({ definitionRepository: repo });
    const missing = { kind: "asset-definition-version", id: "definition.missing", version: "1.0.0" } as AssetReference;
    const options = { includeMetadata: true, includeConfigurationSchema: true };
    const batch = await facade.readDefinitionDetails([definitionRef, missing, definitionRef], options);
    assert.equal(batch[1], undefined);
    assert.notEqual(batch[0]!.definition, batch[2]!.definition);
    assert.notEqual(batch[0]!.definition.configurationSchema, definition.configurationSchema);
    (batch[0]!.definition.configurationSchema!.fields[0] as { label: string }).label = "Changed returned copy";
    (batch[0]!.definition.metadata as { note: string }).note = "Changed returned metadata";
    assert.equal(batch[2]!.definition.configurationSchema!.fields[0]!.label, "Safe field");
    assert.equal(definition.configurationSchema!.fields[0]!.label, "Safe field");
    assert.equal(definition.metadata?.note, "Readable");
    const next = await facade.readDefinitionDetail(definitionRef, options);
    assert.deepEqual(next, batch[2]);
    assert.equal(repo.saved.length + repo.deleted.length, 0);
  });

  it("omits validation by default and includes validation only when requested", async () => {
    const facade = createFacade({ definitionRepository: new FakeDefinitionRepository([validDefinition({ displayName: "" })]) });
    assert.equal((await facade.readDefinitionDetail(definitionRef))?.validationSummary, undefined);
    assert.equal((await facade.readDefinitionDetail(definitionRef, { includeValidation: true }))?.validationSummary?.status, "invalid");
  });
});

describe("AssetRegistryReadFacade instance and composition reads", () => {
  it("lists and reads instance details with safe configuration summaries and opt-in validation", async () => {
    const facade = createFacade({ definitionRepository: new FakeDefinitionRepository([validDefinition()]), instanceRepository: new FakeInstanceRepository([validInstance({ definitionRef: { kind: "asset-instance", id: normalizeAssetId("wrong") } })]) });
    const card = (await facade.listInstanceCards()).items[0]!;
    assert.equal(card.instanceId, "instance.alpha");
    assert.deepEqual(card.configurationSummary?.configuredFieldIds, ["safeField"]);
    assertSafe(card);

    const defaultDetail = await facade.readInstanceDetail(instanceRef);
    assert.equal(defaultDetail?.validationSummary, undefined);
    assertSafe(defaultDetail);

    const validatedDetail = await facade.readInstanceDetail(instanceRef, { includeValidation: true });
    assert.equal(validatedDetail?.validationSummary?.status, "invalid");
  });

  it("lists and reads composition details with root, child, binding summaries and opt-in validation", async () => {
    const bindingRepository = new FakeBindingRepository([validBinding({ sourceRef: { kind: "asset-instance", id: normalizeAssetId("missing-source") } })]);
    const facade = createFacade({ bindingRepository, compositionRepository: new FakeCompositionRepository([validComposition({ rootInstanceRefs: [{ kind: "asset-instance", id: normalizeAssetId("missing-root") }] })]) });

    const card = (await facade.listCompositionCards()).items[0]!;
    assert.equal(card.compositionId, "composition.alpha");
    assert.equal(card.rootInstanceCount, 1);
    assert.equal(card.instanceCount, 1);
    assert.equal(card.bindingCount, 1);

    const defaultDetail = await facade.readCompositionDetail(compositionRef);
    assert.equal(defaultDetail?.validationSummary, undefined);
    assert.equal(defaultDetail?.rootInstanceRefs.length, 1);
    assert.equal(defaultDetail?.childInstanceRefs.length, 1);
    assert.equal(defaultDetail?.bindingSummaries[0]?.bindingId, "binding.alpha");

    const validatedDetail = await facade.readCompositionDetail(compositionRef, { includeValidation: true });
    assert.equal(validatedDetail?.validationSummary?.status, "invalid");
  });
});

describe("AssetRegistryReadFacade resource-backed view reads", () => {
  it("uses an injected provider for list/detail and preserves generated-output and external-object view kinds", async () => {
    const views: readonly AssetResourceBackedView[] = [
      { viewId: "view.generated", viewKind: "generated-output", displayName: "Generated", summary: "Generated output", metadata: unsafeMetadata(), generatedOutput: { outputId: "out", producedAssetType: "image", producedAt: "2026-01-01T00:00:00.000Z" } },
      { viewId: "view.external", viewKind: "external-repository-object", displayName: "External", summary: "External object", sourceRef: { kind: "external-repository-object", id: normalizeAssetId("external.one") } },
    ];
    const provider: AssetResourceBackedViewProvider = {
      async listResourceBackedViews() { return { items: views, nextCursor: "next-resource", diagnostics: [{ severity: "info", code: "provider-safe", message: "Provider returned safe resource-backed views.", providerId: "test-provider" }] }; },
      async readResourceBackedView(viewId) { return views.find((view) => view.viewId === viewId); },
    };
    const facade = createFacade({ resourceBackedViewProvider: provider });

    const list = await facade.listResourceBackedViewCards({ searchText: "generated", includeMetadata: true });
    assert.equal(list.items.length, 1);
    assert.equal(list.items[0]?.viewKind, "generated-output");
    assert.equal(list.items[0]?.assetDefinitionRef, undefined);
    assert.equal(list.nextCursor, "next-resource");
    assert.equal(list.diagnostics?.some((diagnostic) => diagnostic.code === "provider-safe"), true);
    assertSafe(list);

    const detail = await facade.readResourceBackedViewDetail("view.external", { includeMetadata: true });
    assert.equal(detail?.view.viewKind, "external-repository-object");
    assert.equal(detail?.view.assetDefinitionRef, undefined);
  });

  it("passes workspace context to resource-backed providers for isolated list/detail reads", async () => {
    const views: readonly AssetResourceBackedView[] = [
      { viewId: "view.workspace-a", viewKind: "generated-output", displayName: "Workspace A", assetType: "image", assetFamily: "resource-backed", metadata: { workspaceId: "workspace-a" }, generatedOutput: { outputId: "out-a", producedAssetType: "image", producedAt: "2026-01-01T00:00:00.000Z", metadata: { workspaceId: "workspace-a" } } },
      { viewId: "view.workspace-b", viewKind: "generated-output", displayName: "Workspace B", assetType: "image", assetFamily: "resource-backed", metadata: { workspaceId: "workspace-b" }, generatedOutput: { outputId: "out-b", producedAssetType: "image", producedAt: "2026-01-01T00:00:00.000Z", metadata: { workspaceId: "workspace-b" } } },
    ];
    const provider: AssetResourceBackedViewProvider = {
      async listResourceBackedViews(query = {}) {
        if (!query.workspaceId) return { items: [], diagnostics: [{ severity: "error", code: "workspace-required", message: "Workspace id is required." }] };
        return { items: views.filter((view) => (view.metadata as Record<string, unknown>).workspaceId === query.workspaceId) };
      },
      async readResourceBackedView(viewId, query = {}) {
        return views.find((view) => view.viewId === viewId && (view.metadata as Record<string, unknown>).workspaceId === query.workspaceId);
      },
    };
    const facade = createFacade({ resourceBackedViewProvider: provider });

    assert.deepEqual((await facade.listResourceBackedViewCards({ workspaceId: "workspace-a", limit: 10 })).items.map((item) => item.viewId), ["view.workspace-a"]);
    assert.deepEqual((await facade.listResourceBackedViewCards({ workspaceId: "workspace-b", limit: 10 })).items.map((item) => item.viewId), ["view.workspace-b"]);
    assert.equal((await facade.readResourceBackedViewDetail("view.workspace-a", { workspaceId: "workspace-a" }))?.view.viewId, "view.workspace-a");
    assert.equal(await facade.readResourceBackedViewDetail("view.workspace-a", { workspaceId: "workspace-b" }), undefined);
    const missingWorkspace = await facade.listResourceBackedViewCards({ limit: 10 });
    assert.equal(missingWorkspace.items.length, 0);
    assert.equal(missingWorkspace.diagnostics?.[0]?.code, "workspace-required");
  });

  it("returns empty/undefined without a provider and sanitizes provider errors", async () => {
    const noProviderFacade = createFacade();
    assert.deepEqual(await noProviderFacade.listResourceBackedViewCards(), { items: [] });
    assert.equal(await noProviderFacade.readResourceBackedViewDetail("missing"), undefined);

    const provider: AssetResourceBackedViewProvider = {
      async listResourceBackedViews() { throw new Error("/tmp/secret token stack"); },
      async readResourceBackedView() { throw new Error("/tmp/secret token stack"); },
    };
    const facade = createFacade({ resourceBackedViewProvider: provider });
    await assert.rejects(() => facade.listResourceBackedViewCards(), (error) => {
      assert.ok(error instanceof AssetRegistryReadFacadeError);
      assert.equal(error.code, "resource-backed-view-provider-failed");
      assertSafe(error);
      return true;
    });
  });

  it("lists and reads artifact/document provider cards and details without unsafe metadata or automatic validation", async () => {
    const browser = new FakeArtifactBrowserMetadataRead([
      artifactItem(),
      artifactItem({
        artifactId: "uploads/private/blob.bin",
        storageKey: "uploads/private/blob.bin",
        artifactFamily: "binary",
        mediaType: "application/octet-stream",
        originalName: "C:\\Users\\name\\blob.bin",
      }),
    ]);
    const provider = new ArtifactResourceBackedViewProvider({ artifactBrowserMetadataRead: browser });
    const facade = createFacade({ resourceBackedViewProvider: provider });

    const list = await facade.listResourceBackedViewCards({ includeMetadata: true, limit: 10, workspaceId: "workspace-a" });
    assert.deepEqual(list.items.map((item) => item.viewKind), ["document", "artifact"]);
    assert.equal(list.items[0]?.assetDefinitionRef?.id, "builtin.document");
    assert.equal(list.items[1]?.displayName?.startsWith("artifact."), true);
    assertSafe(list);

    const detail = await facade.readResourceBackedViewDetail(list.items[0]!.viewId, { includeMetadata: true, includeResourceBackings: true, workspaceId: "workspace-a" });
    assert.equal(detail?.view.viewKind, "document");
    assert.equal(detail?.validationSummary, undefined);
    assert.equal(detail?.view.validationSummary, undefined);
    assertSafe(detail);

    assert.equal(await facade.readResourceBackedViewDetail("missing-artifact-view", { workspaceId: "workspace-a" }), undefined);
    assert.equal(browser.readContentCalls, 0);
  });

  it("lists and reads image/generated-output provider cards and details without unsafe metadata or automatic validation", async () => {
    const imageSource = new FakeImageAssetDescriptorRead();
    const outputSource = new FakeGeneratedOutputDescriptorSource();
    const provider = new AssetImageResourceBackedViewProvider({
      imageResourceIdentity: createTestImageResourceIdentity(),
      imageAssetDescriptorRead: imageSource,
      generatedImageOutputDescriptorSource: outputSource,
    });
    const facade = createFacade({ resourceBackedViewProvider: provider });

    const list = await facade.listResourceBackedViewCards({ includeMetadata: true, limit: 10, workspaceId: "workspace-a" });
    assert.deepEqual(list.items.map((item) => item.viewKind), ["image-asset", "generated-output"]);
    assert.equal(list.items[0]?.assetDefinitionRef?.id, "builtin.resource-backed-image");
    assert.equal(list.items[1]?.assetDefinitionRef, undefined);
    assert.equal(list.items[1]?.summary?.includes("not finalized or registered"), true);
    assertSafe(list);

    const imageDetail = await facade.readResourceBackedViewDetail(list.items[0]!.viewId, {
      includeMetadata: true,
      includeResourceBackings: true,
      workspaceId: "workspace-a",
    });
    assert.equal(imageDetail?.view.viewKind, "image-asset");
    assert.equal(imageDetail?.validationSummary, undefined);
    assert.equal(imageDetail?.view.validationSummary, undefined);
    assertSafe(imageDetail);

    const generatedDetail = await facade.readResourceBackedViewDetail(list.items[1]!.viewId, {
      includeMetadata: true,
      includeResourceBackings: true,
      workspaceId: "workspace-a",
    });
    assert.equal(generatedDetail?.view.viewKind, "generated-output");
    assert.equal(generatedDetail?.view.assetDefinitionRef, undefined);
    assert.equal(generatedDetail?.view.resourceBackedAsset, undefined);
    assert.equal(generatedDetail?.view.summary?.includes("not finalized or registered"), true);
    assertSafe(generatedDetail);

    assert.equal(await facade.readResourceBackedViewDetail("missing-image-view", { workspaceId: "workspace-a" }), undefined);
    assert.equal(imageSource.byteReadCalls + outputSource.byteReadCalls, 0);
    assert.equal(outputSource.statusReadCalls + outputSource.generationCalls, 0);
    assert.equal(imageSource.storageScanCalls + imageSource.createAssetInstanceCalls + imageSource.persistMappingCalls, 0);
  });

  it("lists and reads dataset/model provider cards and details without unsafe metadata, discovery, validation, or file/runtime calls", async () => {
    const datasetSource = new FakeDatasetDescriptorSource();
    const modelRegistry = new FakeModelRegistry();
    const provider = new AssetDatasetModelResourceBackedViewProvider({
      datasetDescriptorSource: datasetSource,
      modelRegistry,
    });
    const facade = createFacade({ resourceBackedViewProvider: provider });

    const list = await facade.listResourceBackedViewCards({ includeMetadata: true, limit: 10, workspaceId: "workspace-a" });
    assert.deepEqual(list.items.map((item) => item.viewKind), ["dataset", "model"]);
    assert.equal(list.items[0]?.assetDefinitionRef?.id, "builtin.dataset");
    assert.equal(list.items[1]?.assetDefinitionRef?.id, "builtin.model");
    assertSafe(list);

    const datasetDetail = await facade.readResourceBackedViewDetail(list.items[0]!.viewId, {
      includeMetadata: true,
      includeResourceBackings: true,
      workspaceId: "workspace-a",
    });
    assert.equal(datasetDetail?.view.viewKind, "dataset");
    assert.equal(datasetDetail?.validationSummary, undefined);
    assertSafe(datasetDetail);

    const modelDetail = await facade.readResourceBackedViewDetail(list.items[1]!.viewId, {
      includeMetadata: true,
      includeResourceBackings: true,
      includeValidation: true,
      workspaceId: "workspace-a",
    });
    assert.equal(modelDetail?.view.viewKind, "model");
    assert.equal(modelDetail?.validationSummary?.status, "valid");
    assertSafe(modelDetail);

    assert.equal(await facade.readResourceBackedViewDetail("missing-dataset-model-view", { workspaceId: "workspace-a" }), undefined);
    assert.equal(modelRegistry.discoveryCalls, 0);
    assert.equal(modelRegistry.validationCalls, 0);
    assert.equal(modelRegistry.trainingCalls, 0);
    assert.equal(modelRegistry.publishingCalls, 0);
    assert.equal(modelRegistry.localModelScanCalls, 0);
    assert.equal(datasetSource.prepareCalls + datasetSource.fileReadCalls + datasetSource.storageScanCalls, 0);
  });

  it("lists and reads external repository provider cards and details without unsafe metadata or automatic validation/provider calls", async () => {
    const externalSource = new FakeExternalRepositoryObjectDescriptorSource();
    const provider = new AssetExternalRepositoryResourceBackedViewProvider({
      externalRepositoryObjectDescriptorSource: externalSource,
    });
    const facade = createFacade({ resourceBackedViewProvider: provider });

    const list = await facade.listResourceBackedViewCards({ includeMetadata: true, limit: 10, workspaceId: "workspace-a" });
    assert.equal(list.items.length, 1);
    assert.equal(list.items[0]?.viewKind, "external-repository-object");
    assert.equal(list.items[0]?.assetDefinitionRef, undefined);
    assert.equal(list.items[0]?.summary?.includes("not imported"), true);
    assertSafe(list);

    const detail = await facade.readResourceBackedViewDetail(list.items[0]!.viewId, {
      includeMetadata: true,
      includeResourceBackings: true,
      workspaceId: "workspace-a",
    });
    assert.equal(detail?.view.viewKind, "external-repository-object");
    assert.equal(detail?.view.assetDefinitionRef, undefined);
    assert.equal(detail?.view.assetInstanceRef, undefined);
    assert.equal(detail?.view.resourceBackedAsset, undefined);
    assert.equal(detail?.view.metadata?.registered, false);
    assert.equal(detail?.validationSummary, undefined);
    assert.equal(await facade.readResourceBackedViewDetail("missing-external-view"), undefined);
    assertSafe(detail);

    assert.equal(externalSource.providerNetworkCalls, 0);
    assert.equal(externalSource.cacheReadCalls, 0);
    assert.equal(externalSource.runtimeCalls, 0);
    assert.equal(externalSource.fileReadCalls, 0);
    assert.equal(externalSource.validationCalls, 0);
  });
});

describe("AssetRegistryReadFacade query, pagination, and boundaries", () => {
  it("respects bounded limits, preserves repository order, and documents cursor pass-through", async () => {
    const repo = new FakeDefinitionRepository([
      validDefinition({ definitionId: "definition.one", displayName: "One" }),
      validDefinition({ definitionId: "definition.two", displayName: "Two" }),
      validDefinition({ definitionId: "definition.three", displayName: "Three" }),
    ]);
    const facade = createFacade({ definitionRepository: repo, maxListLimit: 2 });
    const list = await facade.listDefinitionCards({ limit: 99, cursor: "cursor" });
    assert.deepEqual(list.items.map((item) => item.definitionId), ["definition.one", "definition.two"]);
    assert.equal(repo.lastQuery?.limit, 2);
    assert.equal(repo.lastQuery?.cursor, "cursor");
    assert.equal(list.nextCursor, "next-definition");
    assert.equal(list.diagnostics?.[0]?.code, "cursor-passed-through");
  });


  it("forwards supported repository filters for definitions, instances, and compositions", async () => {
    const definitions = new FakeDefinitionRepository([validDefinition()]);
    const instances = new FakeInstanceRepository([validInstance()]);
    const compositions = new FakeCompositionRepository([validComposition()]);
    const facade = createFacade({ definitionRepository: definitions, instanceRepository: instances, compositionRepository: compositions });

    await facade.listDefinitionCards({ searchText: " alpha ", assetTypes: ["tool"], assetFamilies: ["behavioral"], lifecycleStatuses: ["draft"], limit: 7, cursor: "cursor" });
    assert.deepEqual(definitions.lastQuery, { assetType: "tool", assetFamily: "behavioral", lifecycleStatus: "draft", text: "alpha", limit: 7, cursor: "cursor" });

    await facade.listInstanceCards({ searchText: "instance", lifecycleStatuses: ["draft"], limit: 5 });
    assert.deepEqual(instances.lastQuery, { lifecycleStatus: "draft", text: "instance", limit: 5, cursor: undefined });

    await facade.listCompositionCards({ searchText: "feature", lifecycleStatuses: ["draft"], limit: 6 });
    assert.deepEqual(compositions.lastQuery, { lifecycleStatus: "draft", text: "feature", limit: 6, cursor: undefined });
  });

  it("forwards multi-value filters without advancing past unreturned compatible rows", async () => {
    const repo = new FakeDefinitionRepository([
      validDefinition({ definitionId: "definition.one", assetType: "dataset", displayName: "One" }),
      validDefinition({ definitionId: "definition.two", assetType: "tool", displayName: "Two" }),
      validDefinition({ definitionId: "definition.three", assetType: "dataset", displayName: "Three" }),
    ]);
    const facade = createFacade({ definitionRepository: repo, maxListLimit: 3 });

    const list = await facade.listDefinitionCards({ assetTypes: ["dataset", "tool"], limit: 1 });

    assert.equal(repo.lastQuery?.assetType, undefined);
    assert.deepEqual(repo.lastQuery?.assetTypes, ["dataset", "tool"]);
    assert.equal(repo.lastQuery?.limit, 1);
    assert.deepEqual(list.items.map((item) => item.definitionId), ["definition.one"]);
    assert.equal(list.diagnostics?.some((diagnostic) => diagnostic.code === "facade-side-filtering"), true);
  });

  it("does not import adapters, hosts, transports, UI, runtime, filesystem, network, or provider clients", () => {
    const source = readFileSync("modules/application/services/asset/asset-registry-read-facade.service.ts", "utf8");
    for (const forbidden of [
      "modules/adapters",
      "adapters/",
      "modules/hosts",
      "hosts/",
      "contracts/api",
      "contracts/ipc",
      "electron",
      "express",
      "preload",
      "renderer",
      "thin-client",
      "runtime-readiness",
      "task-registry",
      "huggingface",
      "node:fs",
      "node:http",
      "node:https",
    ]) {
      assert.equal(source.includes(forbidden), false, `facade source imported or referenced ${forbidden}`);
    }
  });

  it("does not call save, update, delete, seeding, runtime readiness, or task registry seams", async () => {
    const definitions = new FakeDefinitionRepository([validDefinition()]);
    const instances = new FakeInstanceRepository([validInstance()]);
    const compositions = new FakeCompositionRepository([validComposition()]);
    const bindings = new FakeBindingRepository([validBinding()]);
    const facade = createFacade({ definitionRepository: definitions, instanceRepository: instances, compositionRepository: compositions, bindingRepository: bindings });

    await facade.listDefinitionCards();
    await facade.readDefinitionDetail(definitionRef);
    await facade.listInstanceCards();
    await facade.readInstanceDetail(instanceRef);
    await facade.listCompositionCards();
    await facade.readCompositionDetail(compositionRef);

    assert.equal(definitions.saved.length + instances.saved.length + compositions.saved.length + bindings.saved.length, 0);
    assert.equal(definitions.deleted.length + instances.deleted.length + compositions.deleted.length + bindings.deleted.length, 0);
  });


  it("uses the centralized Asset Kernel sanitizer without a second local forbidden-key regex", () => {
    const source = readFileSync("modules/application/services/asset/asset-registry-read-facade.service.ts", "utf8");
    assert.equal(source.includes("FORBIDDEN_METADATA_KEY_PATTERN"), false);
    assert.equal(source.includes("sanitizeAssetMetadata"), true);
  });

  it("sanitizes repository errors and serialized cards/details", async () => {
    const definitions = new FakeDefinitionRepository([validDefinition()]);
    const facade = createFacade({ definitionRepository: definitions });
    const card = await facade.listDefinitionCards({ includeMetadata: true });
    const detail = await facade.readDefinitionDetail(definitionRef, { includeMetadata: true });
    assertSafe(card);
    assertSafe(detail);

    definitions.failReads = true;
    await assert.rejects(() => facade.listDefinitionCards(), (error) => {
      assert.ok(error instanceof AssetRegistryReadFacadeError);
      assert.equal(error.code, "repository-read-failed");
      assertSafe(error);
      return true;
    });
  });
});
