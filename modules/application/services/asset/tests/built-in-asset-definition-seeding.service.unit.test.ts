import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test, { describe } from "node:test";

import type { AssetDefinition, AssetReference } from "../../../../contracts/asset";
import type { AssetDefinitionListQuery, AssetDefinitionRepositoryPort } from "../../../ports/asset";
import {
  BuiltInAssetDefinitionSeedingError,
  BuiltInAssetDefinitionSeedingService,
  type BuiltInAssetDefinitionSeed,
} from "../built-in-asset-definition-seeding.service";
import { createBuiltInAssetDefinitionFingerprint } from "../built-ins/built-in-asset-definition-fingerprint";
import { createBuiltInAssetDefinitionSeed } from "../built-ins/createBuiltInAssetDefinitionSeed";

class FakeDefinitionRepository implements AssetDefinitionRepositoryPort {
  public readonly definitions = new Map<string, AssetDefinition>();
  public saveCount = 0;
  public failReads = false;
  public failSaves = false;

  public async saveDefinition(definition: AssetDefinition): Promise<AssetDefinition> {
    if (this.failSaves) throw new Error("raw save failed /tmp/secret TOKEN=abc node --inspect stack trace");
    this.saveCount += 1;
    this.definitions.set(keyFor(definition.definitionId, definition.version), structuredClone(definition));
    return structuredClone(definition);
  }

  public async getDefinition(reference: AssetReference): Promise<AssetDefinition | undefined> {
    if (this.failReads) throw new Error("raw read failed /Users/alice/token stack trace API_KEY=abc");
    const definition = this.definitions.get(keyFor(reference.id, reference.version));
    return definition ? structuredClone(definition) : undefined;
  }

  public async listDefinitions(_query?: AssetDefinitionListQuery) {
    return { definitions: [...this.definitions.values()].map((definition) => structuredClone(definition)) };
  }
}

describe("BuiltInAssetDefinitionSeedingService", () => {
  test("creates a missing valid built-in definition with safe seed metadata without mutating the seed", async () => {
    const repository = new FakeDefinitionRepository();
    const service = createService(repository);
    const seed = validSeed();
    const before = structuredClone(seed.definition);

    const result = await service.seedDefinitions([seed]);
    const saved = await repository.getDefinition(referenceFor(seed.definition));

    assert.equal(result.createdCount, 1);
    assert.equal(result.unchangedCount, 0);
    assert.equal(result.skippedCount, 0);
    assert.equal(result.invalidCount, 0);
    assert.equal(result.failedCount, 0);
    assert.equal(result.diagnostics[0]?.status, "created");
    assert.equal(repository.saveCount, 1);
    const savedMarker = builtInSeedMetadata(saved);
    assert.equal(savedMarker?.managedBy, "asset-kernel");
    assert.equal(savedMarker?.seedId, seed.seedId);
    assert.equal(savedMarker?.seedVersion, seed.seedVersion);
    assert.equal(savedMarker?.lastSeededAt, "2026-05-07T00:00:00.000Z");
    assert.equal(typeof savedMarker?.fingerprint, "string");
    assert.deepEqual(seed.definition, before);
  });

  test("returns invalid diagnostics with validation issues and does not persist invalid definitions", async () => {
    const repository = new FakeDefinitionRepository();
    const service = createService(repository);

    const result = await service.seedDefinitions([
      validSeed({ seedId: "notnamespaced", seedVersion: "version", definition: validDefinition({ definitionId: "bad", displayName: "" }) }),
    ]);

    assert.equal(result.invalidCount, 1);
    assert.equal(result.createdCount, 0);
    assert.equal(result.diagnostics[0]?.status, "invalid");
    assert.ok((result.diagnostics[0]?.validationIssues?.length ?? 0) >= 3);
    assert.deepEqual((await repository.listDefinitions()).definitions, []);
    assert.equal(repository.saveCount, 0);
  });

  test("is idempotent when run twice with the same seed id, version, and fingerprint", async () => {
    const repository = new FakeDefinitionRepository();
    const service = createService(repository);
    const seed = validSeed({ fingerprint: "fixture:fingerprint" });

    const first = await service.seedDefinitions([seed]);
    const second = await service.seedDefinitions([seed]);

    assert.equal(first.diagnostics[0]?.status, "created");
    assert.equal(second.diagnostics[0]?.status, "already-current");
    assert.equal(second.unchangedCount, 1);
    assert.equal(repository.saveCount, 1);
  });

  test("does not treat matching seed id and fingerprint as current when seed version differs", async () => {
    const repository = new FakeDefinitionRepository();
    const seed = validSeed({ fingerprint: "fixture:fingerprint", seedVersion: "1.0.0" });
    await createService(repository).seedDefinitions([seed]);
    repository.saveCount = 0;

    const result = await createService(repository).seedDefinitions([validSeed({
      fingerprint: "fixture:fingerprint",
      seedVersion: "1.0.1",
    })]);

    assert.equal(result.diagnostics[0]?.status, "skipped-seed-version-mismatch");
    assert.equal(result.unchangedCount, 0);
    assert.equal(result.skippedCount, 1);
    assert.equal(repository.saveCount, 0);
    assert.deepEqual(result.diagnostics[0]?.metadata, { existingBuiltInSeed: true, seedVersionMismatch: true });
    assert.doesNotMatch(JSON.stringify(result.diagnostics[0]), /(?:\/tmp|Users|secret|token|API_KEY|stack|node --inspect|"owner"|"builtInSeed"|"fingerprint")/i);
    assert.equal(builtInSeedMetadata(await repository.getDefinition(referenceFor(seed.definition)))?.seedVersion, "1.0.0");
  });

  test("uses the shared built-in fingerprint helper for catalog seed creation and service fallback", async () => {
    const repository = new FakeDefinitionRepository();
    const definition = validDefinition({ description: "Fingerprint fixture." });
    const catalogSeed = createBuiltInAssetDefinitionSeed(definition);

    const result = await createService(repository).seedDefinitions([validSeed({
      definition,
      seedId: String(definition.definitionId),
      fingerprint: undefined,
    })]);

    assert.equal(catalogSeed.fingerprint, createBuiltInAssetDefinitionFingerprint(definition));
    assert.equal(result.diagnostics[0]?.status, "created");
    assert.equal(builtInSeedMetadata(await repository.getDefinition(referenceFor(definition)))?.fingerprint, catalogSeed.fingerprint);
  });

  test("skips a custom definition with the same definitionId and version", async () => {
    const repository = new FakeDefinitionRepository();
    const definition = validDefinition({ metadata: { owner: "user" } });
    await repository.saveDefinition(definition);
    repository.saveCount = 0;

    const result = await createService(repository).seedDefinitions([validSeed({ definition })]);

    assert.equal(result.diagnostics[0]?.status, "skipped-user-modified");
    assert.equal(result.skippedCount, 1);
    assert.equal(repository.saveCount, 0);
    assert.deepEqual((await repository.getDefinition(referenceFor(definition)))?.metadata, { owner: "user" });
  });

  test("skips an existing built-in definition when the fingerprint differs", async () => {
    const repository = new FakeDefinitionRepository();
    const seed = validSeed({ fingerprint: "fixture:new" });
    await createService(repository).seedDefinitions([validSeed({ fingerprint: "fixture:old" })]);
    repository.saveCount = 0;

    const result = await createService(repository).seedDefinitions([seed]);

    assert.equal(result.diagnostics[0]?.status, "skipped-user-modified");
    assert.equal(result.skippedCount, 1);
    assert.equal(repository.saveCount, 0);
    assert.equal(builtInSeedMetadata(await repository.getDefinition(referenceFor(seed.definition)))?.fingerprint, "fixture:old");
  });

  test("processes multiple seeds deterministically and keeps invalid seeds from blocking valid seeds", async () => {
    const repository = new FakeDefinitionRepository();
    const seeds = [
      validSeed({ seedId: "app.seed.one", definition: validDefinition({ definitionId: "app.definition.one" }) }),
      validSeed({ seedId: "app.seed.invalid", definition: validDefinition({ definitionId: "../bad" }) }),
      validSeed({ seedId: "app.seed.two", definition: validDefinition({ definitionId: "app.definition.two" }) }),
    ];

    const result = await createService(repository).seedDefinitions(seeds);

    assert.deepEqual(result.diagnostics.map((diagnostic) => diagnostic.seedId), seeds.map((seed) => seed.seedId));
    assert.deepEqual(result.diagnostics.map((diagnostic) => diagnostic.status), ["created", "invalid", "created"]);
    assert.equal(result.createdCount, 2);
    assert.equal(result.invalidCount, 1);
    assert.equal((await repository.listDefinitions()).definitions.length, 2);
  });

  test("returns sanitized failed diagnostics for read failures", async () => {
    const repository = new FakeDefinitionRepository();
    repository.failReads = true;

    const result = await createService(repository).seedDefinitions([validSeed()]);

    assert.equal(result.failedCount, 1);
    assert.equal(result.diagnostics[0]?.status, "failed");
    assert.equal(result.diagnostics[0]?.message, "Built-in asset definition seed could not be processed.");
    assert.doesNotMatch(JSON.stringify(result.diagnostics[0]), /(?:\/tmp|Users|secret|token|API_KEY|stack|node --inspect)/i);
    assert.equal(repository.saveCount, 0);
  });

  test("returns sanitized failed diagnostics for save failures", async () => {
    const repository = new FakeDefinitionRepository();
    repository.failSaves = true;

    const result = await createService(repository).seedDefinitions([validSeed()]);

    assert.equal(result.failedCount, 1);
    assert.equal(result.diagnostics[0]?.status, "failed");
    assert.doesNotMatch(JSON.stringify(result.diagnostics[0]), /(?:\/tmp|secret|token|TOKEN|stack|node --inspect)/i);
  });

  test("strict mode throws only sanitized seeding errors after diagnostics are available", async () => {
    const repository = new FakeDefinitionRepository();

    await assert.rejects(
      () => createService(repository).seedDefinitions([validSeed({ definition: validDefinition({ definitionId: "../bad" }) })], { failOnInvalid: true }),
      (error: unknown) => {
        assert.equal(error instanceof BuiltInAssetDefinitionSeedingError, true);
        assert.equal((error as BuiltInAssetDefinitionSeedingError).result.invalidCount, 1);
        assert.doesNotMatch((error as Error).message, /(?:\/tmp|secret|token|stack|node --inspect)/i);
        return true;
      },
    );
  });

  test("does not import forbidden host, adapter, API, UI, runtime, filesystem, network, or AI clients", async () => {
    const source = await readFile(join(process.cwd(), "modules/application/services/asset/built-in-asset-definition-seeding.service.ts"), "utf8");

    assert.doesNotMatch(source, /hosts\/|adapters\/|electron|express|renderer|thin-client|ipc|preload|runtime-readiness|runtime-task|runtime\/|resource storage|scan|huggingface|fetch\(|http|https|node:fs|node:net|node:http|node:https|llm|embedding/i);
    assert.doesNotMatch(source, /createRuntime|startRuntime|executeWorkflow|assemblePrompt|createRoute|app\.get|ipcMain|contextBridge/i);
  });
});

function createService(repository: FakeDefinitionRepository): BuiltInAssetDefinitionSeedingService {
  return new BuiltInAssetDefinitionSeedingService({ definitionRepository: repository, now: () => "2026-05-07T00:00:00.000Z" });
}

function validSeed(overrides: Partial<BuiltInAssetDefinitionSeed> = {}): BuiltInAssetDefinitionSeed {
  return {
    seedId: "app.seed.definition-one",
    seedVersion: "1.0.0",
    definition: validDefinition(),
    source: "built-in",
    ...overrides,
  };
}

function validDefinition(overrides: Partial<AssetDefinition> = {}): AssetDefinition {
  return {
    definitionId: "app.definition.one",
    assetType: "tool",
    assetFamily: "resource-backed",
    version: "1.0.0",
    displayName: "Definition One",
    description: "A minimal built-in test fixture definition.",
    lifecycleStatus: "draft",
    reviewStatus: "unreviewed",
    provenance: { sourceKind: "system-generated" },
    ...overrides,
  };
}

function builtInSeedMetadata(definition: AssetDefinition | undefined): Record<string, unknown> | undefined {
  const marker = definition?.metadata?.builtInSeed;
  return typeof marker === "object" && marker !== null && !Array.isArray(marker) ? (marker as Record<string, unknown>) : undefined;
}

function referenceFor(definition: AssetDefinition): AssetReference {
  return { kind: "asset-definition-version", id: String(definition.definitionId) as AssetReference["id"], version: definition.version };
}

function keyFor(definitionId: unknown, version: unknown): string {
  return `${String(definitionId)}@${String(version ?? "")}`;
}
