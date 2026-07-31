import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { describe } from "node:test";

import type { AssetDefinition, AssetReference } from "../../../../../contracts/asset";
import { RUNTIME_CAPABILITY_IDS, type RuntimeCapabilityId } from "../../../../../contracts/runtime";
import type { AssetDefinitionListQuery, AssetDefinitionRepositoryPort } from "../../../../ports/asset";
import { RegisterAssetDefinitionUseCase } from "../../../../use-cases/asset";
import { composeLocalAssetKernel } from "../../../../../hosts/shared/composition/composeLocalAssetKernel";
import { BuiltInAssetDefinitionSeedingService } from "../../built-in-asset-definition-seeding.service";
import { validateAssetDefinition } from "../../validate-asset-definition.service";
import {
  BUILT_IN_ASSET_DEFINITION_CATALOG,
} from "../built-in-asset-definition-catalog";
import { createBuiltInAssetDefinitionFingerprint } from "../built-in-asset-definition-fingerprint";
import { BUILT_IN_ASSET_DEFINITION_IDS, BUILT_IN_ASSET_DEFINITION_VERSION } from "../built-in-asset-definition-ids";

const REQUIRED_AI_CONTEXT_FIELDS = [
  "purpose",
  "userFacingSummary",
  "developerFacingSummary",
  "capabilities",
  "limitations",
  "inputSummary",
  "outputSummary",
  "configurationGuidance",
  "compositionGuidance",
  "safetyNotes",
] as const;

const RUNTIME_BACKED_EXPECTATIONS: Readonly<Record<string, RuntimeCapabilityId>> = {
  "builtin.image-generation": "image-generation",
  "builtin.dataset-preparation": "dataset-preparation",
  "builtin.model-training": "model-training",
  "builtin.model-validation": "model-validation",
  "builtin.model-publishing": "model-publishing",
};

const RESOURCE_BACKED_IDS = ["builtin.artifact", "builtin.resource-backed-image", "builtin.dataset", "builtin.model", "builtin.document"] as const;

describe("built-in asset definition catalog", () => {
  test("exports the required stable built-in seed IDs in deterministic order", () => {
    assert.deepEqual(seedIds(), [...BUILT_IN_ASSET_DEFINITION_IDS]);
    assert.deepEqual(definitionIds(), [...BUILT_IN_ASSET_DEFINITION_IDS]);
    assert.deepEqual(seedIds(), [...seedIds()].sort((left, right) => BUILT_IN_ASSET_DEFINITION_IDS.indexOf(left as never) - BUILT_IN_ASSET_DEFINITION_IDS.indexOf(right as never)));
  });

  test("declares unique seed IDs, definition IDs, namespaced identities, versions, and deterministic metadata", () => {
    assert.equal(new Set(seedIds()).size, BUILT_IN_ASSET_DEFINITION_CATALOG.length);
    assert.equal(new Set(definitionIds()).size, BUILT_IN_ASSET_DEFINITION_CATALOG.length);

    for (const seed of BUILT_IN_ASSET_DEFINITION_CATALOG) {
      assert.equal(seed.seedId, seed.definition.definitionId);
      assert.equal(seed.seedVersion, BUILT_IN_ASSET_DEFINITION_VERSION);
      assert.equal(seed.definition.version, BUILT_IN_ASSET_DEFINITION_VERSION);
      assert.match(seed.seedId, /^builtin\.[a-z0-9.-]+$/);
      assert.match(String(seed.definition.definitionId), /^builtin\.[a-z0-9.-]+$/);
      assert.equal(seed.source, "built-in");
      assert.match(seed.fingerprint ?? "", /^fnv1a:[0-9a-f]{8}$/);
      assert.equal(seed.fingerprint, createBuiltInAssetDefinitionFingerprint(seed.definition));
      assert.equal(JSON.stringify(seed).includes("lastSeededAt"), false);
      assert.doesNotMatch(JSON.stringify(seed), /(?:token|secret|password|api[_-]?key|process\.env)/i);
    }
  });

  test("validates every built-in definition with the existing asset definition validator", () => {
    for (const seed of BUILT_IN_ASSET_DEFINITION_CATALOG) {
      const validation = validateAssetDefinition(seed.definition, { options: { requireAiContextForResourceBackedAssets: true } });
      assert.equal(validation.status, "valid", `${seed.seedId}: ${JSON.stringify(validation.issues)}`);
    }
  });

  test("seeds the full catalog idempotently through the built-in seeding service", async () => {
    const repository = new FakeDefinitionRepository();
    const service = createService(repository);

    const first = await service.seedDefinitions(BUILT_IN_ASSET_DEFINITION_CATALOG);
    const second = await service.seedDefinitions(BUILT_IN_ASSET_DEFINITION_CATALOG);

    assert.equal(first.createdCount, BUILT_IN_ASSET_DEFINITION_CATALOG.length);
    assert.equal(first.unchangedCount, 0);
    assert.deepEqual(first.diagnostics.map((diagnostic) => diagnostic.status), BUILT_IN_ASSET_DEFINITION_CATALOG.map(() => "created"));
    assert.equal(second.createdCount, 0);
    assert.equal(second.unchangedCount, BUILT_IN_ASSET_DEFINITION_CATALOG.length);
    assert.deepEqual(second.diagnostics.map((diagnostic) => diagnostic.status), BUILT_IN_ASSET_DEFINITION_CATALOG.map(() => "already-current"));
    assert.equal((await repository.listDefinitions()).definitions.length, BUILT_IN_ASSET_DEFINITION_CATALOG.length);
  });

  test("does not overwrite a conflicting user or custom definition", async () => {
    const repository = new FakeDefinitionRepository();
    const seed = BUILT_IN_ASSET_DEFINITION_CATALOG[0];
    assert.ok(seed);
    const userDefinition: AssetDefinition = { ...seed.definition, description: "User-owned custom definition.", metadata: { owner: "user" } };
    await repository.saveDefinition(userDefinition);
    repository.saveCount = 0;

    const result = await createService(repository).seedDefinitions([seed]);
    const saved = await repository.getDefinition(referenceFor(seed.definition));

    assert.equal(result.skippedCount, 1);
    assert.equal(result.diagnostics[0]?.status, "skipped-user-modified");
    assert.equal(repository.saveCount, 0);
    assert.equal(saved?.description, "User-owned custom definition.");
    assert.deepEqual(saved?.metadata, { owner: "user" });
  });

  test("references shared runtime capability IDs for runtime-backed definitions only", () => {
    for (const [definitionId, runtimeCapabilityId] of Object.entries(RUNTIME_BACKED_EXPECTATIONS)) {
      assert.equal(RUNTIME_CAPABILITY_IDS.includes(runtimeCapabilityId), true);
      assert.deepEqual(runtimeRequirements(definitionId), [runtimeCapabilityId]);
      assertRuntimePorts(definitionId);
    }

    for (const definitionId of RESOURCE_BACKED_IDS) {
      assert.deepEqual(runtimeRequirements(definitionId), []);
    }
  });

  test("keeps generic artifact and document built-ins distinct resource-backed definitions", () => {
    const artifact = definitionById("builtin.artifact");
    const document = definitionById("builtin.document");

    assert.equal(artifact.assetType, "data-source");
    assert.equal(document.assetType, "document");
    assert.equal(artifact.assetFamily, "resource-backed");
    assert.equal(document.assetFamily, "resource-backed");
    assert.deepEqual(runtimeRequirements("builtin.artifact"), []);
    assert.deepEqual(runtimeRequirements("builtin.document"), []);
    assert.match(JSON.stringify(artifact.aiContext), /stored or managed artifact descriptor|descriptor\/reference/i);
    assert.doesNotMatch(JSON.stringify(artifact.aiContext), /uploaded document/i);
    assert.match(JSON.stringify(document.aiContext), /uploaded or imported document/i);
  });

  test("marks model publishing runtime execution as unavailable or not implemented in AI context", () => {
    const modelPublishing = definitionById("builtin.model-publishing");
    const aiContext = JSON.stringify(modelPublishing.aiContext).toLowerCase();

    assert.match(aiContext, /unavailable|not implemented/);
    assert.match(aiContext, /runtime execution/);
    assert.equal(JSON.stringify(modelPublishing.metadata).includes("ready"), false);
    assert.equal(JSON.stringify(modelPublishing.metadata).includes("executable"), false);
  });

  test("includes concise required AI context and avoids UI, transport, local path, secret, command, and stack details", () => {
    for (const seed of BUILT_IN_ASSET_DEFINITION_CATALOG) {
      const context = seed.definition.aiContext as Record<string, unknown> | undefined;
      assert.ok(context, `${seed.seedId} has AI context`);
      for (const field of REQUIRED_AI_CONTEXT_FIELDS) {
        assert.ok(hasAiContextField(context, field), `${seed.seedId} missing ${field}`);
      }
      assert.doesNotMatch(JSON.stringify(context), forbiddenContentPattern());
    }
  });

  test("uses safe configuration and resource-backed definitions do not store bytes or raw locations", () => {
    for (const seed of BUILT_IN_ASSET_DEFINITION_CATALOG) {
      const serializedSeed = JSON.stringify(seed);
      assert.doesNotMatch(serializedSeed, /(?:BEGIN [A-Z ]+PRIVATE KEY|token|secret|password|api[_-]?key|process\.env)/i);
      assert.doesNotMatch(serializedSeed, /(?:^|["'\s])(?:\/{1,2}[A-Za-z0-9_.-]+|[A-Za-z]:\\|\.\.\/|\.\/)/);
    }

    for (const definitionId of RESOURCE_BACKED_IDS) {
      const serializedDefinition = JSON.stringify(definitionById(definitionId));
      assert.doesNotMatch(serializedDefinition, /(?:bytes|blob payload|raw file|filesystem path|local path|provider credentials)/i);
      assert.doesNotMatch(serializedDefinition, /(?:data:[a-z]+\/|base64|[A-Za-z]:\\|\.\.\/|\.\/)/);
    }
  });

  test("catalog production files do not import forbidden UI, host startup, API, IPC, adapter, runtime task, network, filesystem, or AI modules", async () => {
    const files = [
      "modules/application/services/asset/built-ins/index.ts",
      "modules/application/services/asset/built-ins/built-in-asset-definition-catalog.ts",
      "modules/application/services/asset/built-ins/built-in-asset-definition-ids.ts",
      "modules/application/services/asset/built-ins/createBuiltInAssetDefinitionSeed.ts",
      "modules/application/services/asset/built-ins/built-in-asset-definition-fingerprint.ts",
    ];

    for (const file of files) {
      const source = await readFile(join(process.cwd(), file), "utf8");
      assert.doesNotMatch(source, /apps\/|renderer|thin-client|hosts\/|adapters\/|electron|express|ipc|preload|api\/|routes?\/|runtime-task|runtime-readiness|node:fs|node:http|node:https|node:net|fetch\(|https?:\/\/|huggingface|openai|llm|embedding|scan\(|scanResources|resourceScan/i, file);
      assert.doesNotMatch(source, /createRuntime|startRuntime|executeWorkflow|assemblePrompt|ipcMain|contextBridge|app\.get|app\.post/i, file);
    }
  });

  test("seeds the full catalog into the composed local Asset Kernel repositories", async () => {
    const rootDirectory = await mkdtemp(join(tmpdir(), "asset-kernel-built-ins-"));
    const localKernel = composeLocalAssetKernel({ rootDirectory, now: () => "2026-05-07T00:00:00.000Z" });
    const service = new BuiltInAssetDefinitionSeedingService({
      definitionRepository: localKernel.repositories.definitionRepository,
      registerAssetDefinition: localKernel.useCases.registerAssetDefinition,
      now: () => "2026-05-07T00:00:00.000Z",
    });

    const first = await service.seedDefinitions(BUILT_IN_ASSET_DEFINITION_CATALOG);
    const second = await service.seedDefinitions(BUILT_IN_ASSET_DEFINITION_CATALOG);
    assert.equal(first.createdCount, BUILT_IN_ASSET_DEFINITION_CATALOG.length);
    assert.equal(second.unchangedCount, BUILT_IN_ASSET_DEFINITION_CATALOG.length);
    for (const seed of BUILT_IN_ASSET_DEFINITION_CATALOG) {
      assert.ok(await localKernel.repositories.definitionRepository.getDefinition(referenceFor(seed.definition)), seed.seedId);
    }
  });
});

class FakeDefinitionRepository implements AssetDefinitionRepositoryPort {
  public readonly definitions = new Map<string, AssetDefinition>();
  public saveCount = 0;

  public async saveDefinition(definition: AssetDefinition): Promise<AssetDefinition> {
    this.saveCount += 1;
    this.definitions.set(keyFor(definition.definitionId, definition.version), structuredClone(definition));
    return structuredClone(definition);
  }

  public async getDefinition(reference: AssetReference): Promise<AssetDefinition | undefined> {
    const definition = this.definitions.get(keyFor(reference.id, reference.version));
    return definition ? structuredClone(definition) : undefined;
  }

  public async listDefinitions(_query?: AssetDefinitionListQuery) {
    return { definitions: [...this.definitions.values()].map((definition) => structuredClone(definition)) };
  }
}

function createService(repository: FakeDefinitionRepository): BuiltInAssetDefinitionSeedingService {
  return new BuiltInAssetDefinitionSeedingService({
    definitionRepository: repository,
    registerAssetDefinition: new RegisterAssetDefinitionUseCase({ definitionRepository: repository }),
    now: () => "2026-05-07T00:00:00.000Z",
  });
}

function seedIds(): string[] {
  return BUILT_IN_ASSET_DEFINITION_CATALOG.map((seed) => seed.seedId);
}

function definitionIds(): string[] {
  return BUILT_IN_ASSET_DEFINITION_CATALOG.map((seed) => String(seed.definition.definitionId));
}

function definitionById(definitionId: string): AssetDefinition {
  const seed = BUILT_IN_ASSET_DEFINITION_CATALOG.find((item) => item.definition.definitionId === definitionId);
  assert.ok(seed, `Missing definition ${definitionId}`);
  return seed.definition;
}

function runtimeRequirements(definitionId: string): RuntimeCapabilityId[] {
  return (definitionById(definitionId).requirements ?? [])
    .filter((requirement) => requirement.requirementKind === "runtime-capability")
    .map((requirement) => requirement.runtimeCapabilityId)
    .filter((runtimeCapabilityId): runtimeCapabilityId is RuntimeCapabilityId => typeof runtimeCapabilityId === "string");
}

function assertRuntimePorts(definitionId: string): void {
  const ports = definitionById(definitionId).ports ?? [];
  assert.ok(ports.some((port) => port.direction === "input"), `${definitionId} has input port`);
  assert.ok(ports.some((port) => port.direction === "output"), `${definitionId} has output port`);
  assert.ok(ports.every((port) => typeof port.contract?.contractKind === "string"), `${definitionId} has explicit port contracts`);
}

function hasAiContextField(context: Record<string, unknown> | undefined, field: (typeof REQUIRED_AI_CONTEXT_FIELDS)[number]): boolean {
  const value = context?.[field];
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return typeof value === "object" && value !== null;
}

function forbiddenContentPattern(): RegExp {
  return /(?:renderer|thin-client|react|component|route id|navigation key|ipc|preload|api route|\/tmp|\/users\/|[A-Za-z]:\\|\.\.\/|\.\/|token|secret|password|api[_-]?key|process\.env|node --|npm |npx |curl |stack trace|traceback)/i;
}

function referenceFor(definition: AssetDefinition): AssetReference {
  return { kind: "asset-definition-version", id: String(definition.definitionId) as AssetReference["id"], version: definition.version };
}

function keyFor(id: unknown, version: unknown): string {
  return `${String(id)}@${String(version ?? "")}`;
}
