import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import type {
  AssetBinding,
  AssetComposition,
  AssetDefinition,
  AssetInstance,
  AssetReference,
} from "../../../../contracts/asset";
import {
  CreateAssetCompositionUseCase,
  CreateAssetInstanceUseCase,
  RegisterAssetDefinitionUseCase,
} from "../../../../application/use-cases/asset";
import {
  ASSET_KERNEL_LOCAL_SCHEMA_VERSION,
  ASSET_KERNEL_LOCAL_STORE_KIND,
  LocalAssetRecordStore,
  LocalAssetRecordStoreError,
  createLocalAssetBindingRepositoryAdapter,
  createLocalAssetCompositionRepositoryAdapter,
  createLocalAssetDefinitionRepositoryAdapter,
  createLocalAssetInstanceRepositoryAdapter,
} from "..";
import { createInMemoryStructuredDocumentStore } from "../../shared";

const definitionRef: AssetReference = {
  kind: "asset-definition",
  id: "definition.one" as AssetReference["id"],
};
const definitionVersionRef: AssetReference = {
  kind: "asset-definition-version",
  id: "definition.one" as AssetReference["id"],
  version: "1.0.0",
};
const instanceRef: AssetReference = {
  kind: "asset-instance",
  id: "instance.one" as AssetReference["id"],
};
const compositionRef: AssetReference = {
  kind: "asset-composition",
  id: "composition.one" as AssetReference["id"],
};
const bindingRef: AssetReference = {
  kind: "asset-binding",
  id: "binding.one" as AssetReference["id"],
};

async function tempRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), "asset-kernel-store-"));
}

function fixedNow(): string {
  return "2026-05-07T00:00:00.000Z";
}

function validDefinition(
  overrides: Partial<AssetDefinition> = {},
): AssetDefinition {
  return {
    definitionId: "definition.one",
    assetType: "tool",
    assetFamily: "resource-backed",
    version: "1.0.0",
    displayName: "Definition One",
    description: "A valid asset definition.",
    lifecycleStatus: "draft",
    reviewStatus: "unreviewed",
    provenance: {
      sourceKind: "human-authored",
      updatedAt: "2026-05-07T00:00:00.000Z",
    },
    metadata: { summary: "metadata only" },
    ...overrides,
  };
}

function invalidDefinition(): AssetDefinition {
  return validDefinition({ definitionId: "/unsafe/path", displayName: "" });
}

function validInstance(overrides: Partial<AssetInstance> = {}): AssetInstance {
  return {
    instanceId: "instance.one",
    definitionRef,
    displayName: "Instance One",
    lifecycleStatus: "draft",
    reviewStatus: "unreviewed",
    parentCompositionRef: compositionRef,
    stateSummary: { summary: "Ready instance" },
    provenance: {
      sourceKind: "human-authored",
      updatedAt: "2026-05-07T00:00:00.000Z",
    },
    ...overrides,
  };
}

function invalidInstance(): AssetInstance {
  return validInstance({
    instanceId: "../bad",
    definitionRef: { kind: "asset-instance", id: "not-a-definition" },
  });
}

function validBinding(overrides: Partial<AssetBinding> = {}): AssetBinding {
  return {
    bindingId: "binding.one",
    bindingKind: "input",
    sourceRef: instanceRef,
    targetRef: instanceRef,
    lifecycleStatus: "draft",
    provenance: {
      sourceKind: "human-authored",
      updatedAt: "2026-05-07T00:00:00.000Z",
    },
    ...overrides,
  };
}

function validComposition(
  overrides: Partial<AssetComposition> = {},
): AssetComposition {
  return {
    compositionId: "composition.one",
    compositionType: "feature",
    displayName: "Composition One",
    description: "Feature composition summary",
    version: "1.0.0",
    lifecycleStatus: "draft",
    reviewStatus: "unreviewed",
    rootInstanceRefs: [instanceRef],
    instanceRefs: [instanceRef],
    bindingRefs: [bindingRef],
    provenance: {
      sourceKind: "human-authored",
      updatedAt: "2026-05-07T00:00:00.000Z",
    },
    ...overrides,
  };
}

function invalidComposition(): AssetComposition {
  return validComposition({
    compositionId: "https://bad.example/id",
    rootInstanceRefs: [{ kind: "asset-instance", id: "missing-root" }],
  });
}

function createRepositories(rootDir: string) {
  const options = { rootDir, now: fixedNow };
  return {
    definitions: createLocalAssetDefinitionRepositoryAdapter(options),
    instances: createLocalAssetInstanceRepositoryAdapter(options),
    compositions: createLocalAssetCompositionRepositoryAdapter(options),
    bindings: createLocalAssetBindingRepositoryAdapter(options),
  };
}

describe("local Asset Kernel record store", () => {
  it("creates deterministic store files and a schema-versioned manifest when missing", async () => {
    const rootDir = await tempRoot();
    await new LocalAssetRecordStore({ rootDir, now: fixedNow }).initialize();

    const storeDir = join(rootDir, "asset-kernel");
    assert.equal(existsSync(join(storeDir, "manifest.json")), true);
    assert.equal(existsSync(join(storeDir, "definitions.json")), true);
    assert.equal(existsSync(join(storeDir, "instances.json")), true);
    assert.equal(existsSync(join(storeDir, "compositions.json")), true);
    assert.equal(existsSync(join(storeDir, "bindings.json")), true);
    const manifest = JSON.parse(
      await readFile(join(storeDir, "manifest.json"), "utf8"),
    ) as { schemaVersion?: number; storeKind?: string; updatedAt?: string };
    assert.deepEqual(manifest, {
      schemaVersion: ASSET_KERNEL_LOCAL_SCHEMA_VERSION,
      storeKind: ASSET_KERNEL_LOCAL_STORE_KIND,
      updatedAt: fixedNow(),
    });
  });

  it("saves and reloads definitions, instances, compositions, and bindings across adapter instances", async () => {
    const rootDir = await tempRoot();
    let repositories = createRepositories(rootDir);
    await repositories.definitions.saveDefinition(validDefinition());
    await repositories.instances.saveInstance(validInstance());
    await repositories.bindings.saveBinding(validBinding());
    await repositories.compositions.saveComposition(validComposition());

    repositories = createRepositories(rootDir);
    assert.equal(
      (await repositories.definitions.getDefinition(definitionRef))
        ?.definitionId,
      "definition.one",
    );
    assert.equal(
      (await repositories.instances.getInstance(instanceRef))?.instanceId,
      "instance.one",
    );
    assert.equal(
      (await repositories.bindings.getBinding(bindingRef))?.bindingId,
      "binding.one",
    );
    assert.equal(
      (await repositories.compositions.getComposition(compositionRef))
        ?.compositionId,
      "composition.one",
    );
  });

  it("stores JSON-compatible records only and does not require resource payload bytes", async () => {
    const rootDir = await tempRoot();
    const repositories = createRepositories(rootDir);
    await repositories.definitions.saveDefinition(
      validDefinition({
        metadata: { resourceRef: "artifact.logical.id", note: "no bytes" },
      }),
    );
    const serialized = await readFile(
      join(rootDir, "asset-kernel", "definitions.json"),
      "utf8",
    );
    assert.doesNotMatch(
      serialized,
      /(?:Buffer|base64Blob|fileBytes|payloadBytes|secret|token|process\.env|\/tmp\/payload)/i,
    );
  });

  it("validates manifest schema version, store kind, and shape with sanitized errors", async () => {
    const rootDir = await tempRoot();
    const store = new LocalAssetRecordStore({ rootDir, now: fixedNow });
    await store.initialize();
    assert.deepEqual(await store.readManifest(), {
      schemaVersion: ASSET_KERNEL_LOCAL_SCHEMA_VERSION,
      storeKind: ASSET_KERNEL_LOCAL_STORE_KIND,
      updatedAt: fixedNow(),
    });

    const manifestPath = join(rootDir, "asset-kernel", "manifest.json");
    for (const manifest of [
      {
        schemaVersion: 999,
        storeKind: ASSET_KERNEL_LOCAL_STORE_KIND,
        updatedAt: fixedNow(),
      },
      {
        schemaVersion: ASSET_KERNEL_LOCAL_SCHEMA_VERSION,
        storeKind: "wrong-kind",
        updatedAt: fixedNow(),
      },
      {
        schemaVersion: ASSET_KERNEL_LOCAL_SCHEMA_VERSION,
        storeKind: ASSET_KERNEL_LOCAL_STORE_KIND,
        updatedAt: 123,
      },
      ["not", "a", "manifest"],
    ]) {
      await writeFile(manifestPath, `${JSON.stringify(manifest)}\n`, "utf8");
      await assert.rejects(
        () => store.readManifest(),
        (error: unknown) => {
          assert.equal(error instanceof LocalAssetRecordStoreError, true);
          assert.equal((error as Error).stack, undefined);
          assert.doesNotMatch(
            String((error as Error).message),
            /(?:asset-kernel-store-|\/tmp|secret|token|stack|wrong-kind|999)/i,
          );
          return true;
        },
      );
    }
  });

  it("rejects unsafe non-JSON asset records before persistence writes", async () => {
    const repositories = createRepositories(await tempRoot());
    const circular: Record<string, unknown> = { ok: true };
    circular.self = circular;

    for (const metadata of [
      { unsafe: undefined },
      { unsafe: () => "nope" },
      { unsafe: Symbol("nope") },
      { unsafe: Number.POSITIVE_INFINITY },
      { unsafe: new Date("2026-05-07T00:00:00.000Z") },
      { unsafe: Buffer.from("bytes") },
      circular,
      { unsafe: new (class UnsafeRecord {})() },
    ] as readonly Record<string, unknown>[]) {
      await assert.rejects(
        () =>
          repositories.definitions.saveDefinition(
            validDefinition({ metadata }),
          ),
        (error: unknown) => {
          assert.equal(error instanceof LocalAssetRecordStoreError, true);
          assert.doesNotMatch(
            String((error as Error).message),
            /(?:bytes|nope|UnsafeRecord|asset-kernel-store-|\/tmp|stack)/i,
          );
          return true;
        },
      );
    }
  });

  it("initializes missing collection files as empty stores and fails predictably on malformed JSON", async () => {
    const rootDir = await tempRoot();
    const repositories = createRepositories(rootDir);
    assert.deepEqual(await repositories.instances.listInstances(), {
      instances: [],
      nextCursor: undefined,
    });
    await writeFile(
      join(rootDir, "asset-kernel", "definitions.json"),
      "{not-json",
      "utf8",
    );
    await assert.rejects(
      () => repositories.definitions.listDefinitions(),
      (error: unknown) => {
        assert.equal(error instanceof LocalAssetRecordStoreError, true);
        assert.equal((error as Error).stack, undefined);
        assert.doesNotMatch(
          String((error as Error).message),
          /(?:asset-kernel-store-|\/tmp|secret|token|stack)/i,
        );
        return true;
      },
    );
  });
});

describe("local asset definition repository adapter", () => {
  it("preserves concurrent updates from independent repository instances", async () => {
    const documents = createInMemoryStructuredDocumentStore(fixedNow);
    const rootDir = await tempRoot();
    const repositories = [
      createLocalAssetDefinitionRepositoryAdapter({ rootDir, documents }),
      createLocalAssetDefinitionRepositoryAdapter({ rootDir, documents }),
    ];

    await Promise.all(
      Array.from({ length: 24 }, (_, index) =>
        repositories[index % repositories.length].saveDefinition(
          validDefinition({
            definitionId: `definition.concurrent-${index}`,
            displayName: `Concurrent definition ${index}`,
          }),
        ),
      ),
    );

    const result = await repositories[0].listDefinitions();
    assert.equal(result.definitions.length, 24);
    assert.equal(
      new Set(result.definitions.map((definition) => definition.definitionId))
        .size,
      24,
    );
  });

  it("upserts definitions, resolves definition and version references, and does not mutate supplied records", async () => {
    const repositories = createRepositories(await tempRoot());
    const definition = validDefinition();
    const before = structuredClone(definition);
    await repositories.definitions.saveDefinition(definition);
    await repositories.definitions.saveDefinition(
      validDefinition({ displayName: "Definition One Updated" }),
    );
    await repositories.definitions.saveDefinition(
      validDefinition({
        version: "2.0.0",
        displayName: "Definition Two",
        provenance: {
          sourceKind: "human-authored",
          updatedAt: "2026-05-07T01:00:00.000Z",
        },
      }),
    );

    assert.deepEqual(definition, before);
    assert.equal(
      (await repositories.definitions.getDefinition(definitionVersionRef))
        ?.displayName,
      "Definition One Updated",
    );
    assert.equal(
      (await repositories.definitions.getDefinition(definitionRef))?.version,
      "2.0.0",
    );
    assert.deepEqual(
      (await repositories.definitions.listDefinitions()).definitions.map(
        (record) => record.version,
      ),
      ["2.0.0", "1.0.0"],
    );
  });

  it("filters by type, family, lifecycle, review, text, and paginates deterministically", async () => {
    const repositories = createRepositories(await tempRoot());
    await repositories.definitions.saveDefinition(
      validDefinition({
        definitionId: "definition.alpha",
        displayName: "Alpha Tool",
        assetType: "tool",
        assetFamily: "resource-backed",
        lifecycleStatus: "draft",
        reviewStatus: "unreviewed",
        provenance: {
          sourceKind: "human-authored",
          updatedAt: "2026-05-07T03:00:00.000Z",
        },
      }),
    );
    await repositories.definitions.saveDefinition(
      validDefinition({
        definitionId: "definition.beta",
        displayName: "Beta Page",
        description: "Beta description for text search.",
        assetType: "page",
        assetFamily: "structural",
        lifecycleStatus: "published",
        reviewStatus: "approved",
        provenance: {
          sourceKind: "human-authored",
          updatedAt: "2026-05-07T02:00:00.000Z",
        },
      }),
    );
    await repositories.definitions.saveDefinition(
      validDefinition({
        definitionId: "definition.gamma",
        displayName: "Gamma Tool",
        assetType: "tool",
        assetFamily: "structural",
        lifecycleStatus: "published",
        reviewStatus: "approved",
        provenance: {
          sourceKind: "human-authored",
          updatedAt: "2026-05-07T01:00:00.000Z",
        },
      }),
    );

    assert.deepEqual(
      (
        await repositories.definitions.listDefinitions({ assetType: "tool" })
      ).definitions.map((record) => record.definitionId),
      ["definition.alpha", "definition.gamma"],
    );
    assert.deepEqual(
      (
        await repositories.definitions.listDefinitions({
          assetFamily: "structural",
        })
      ).definitions.map((record) => record.definitionId),
      ["definition.beta", "definition.gamma"],
    );
    assert.deepEqual(
      (
        await repositories.definitions.listDefinitions({
          lifecycleStatus: "published",
          reviewStatus: "approved",
        })
      ).definitions.map((record) => record.definitionId),
      ["definition.beta", "definition.gamma"],
    );
    assert.deepEqual(
      (
        await repositories.definitions.listDefinitions({ text: "beta" })
      ).definitions.map((record) => record.definitionId),
      ["definition.beta"],
    );
    assert.deepEqual(
      (
        await repositories.definitions.listDefinitions({
          text: "definition.alpha",
        })
      ).definitions.map((record) => record.definitionId),
      ["definition.alpha"],
    );
    assert.deepEqual(
      (
        await repositories.definitions.listDefinitions({
          text: "Beta description",
        })
      ).definitions.map((record) => record.definitionId),
      ["definition.beta"],
    );
    assert.deepEqual(
      (
        await repositories.definitions.listDefinitions({ text: "page" })
      ).definitions.map((record) => record.definitionId),
      ["definition.beta"],
    );
    assert.deepEqual(
      (
        await repositories.definitions.listDefinitions({ text: "unrelated" })
      ).definitions.map((record) => record.definitionId),
      [],
    );
    const first = await repositories.definitions.listDefinitions({ limit: 2 });
    const second = await repositories.definitions.listDefinitions({
      limit: 2,
      cursor: first.nextCursor,
    });
    assert.deepEqual(
      first.definitions.map((record) => record.definitionId),
      ["definition.alpha", "definition.beta"],
    );
    assert.deepEqual(
      second.definitions.map((record) => record.definitionId),
      ["definition.gamma"],
    );
  });
});

describe("local asset instance repository adapter", () => {
  it("upserts, resolves, filters, and paginates instances", async () => {
    const repositories = createRepositories(await tempRoot());
    await repositories.instances.saveInstance(
      validInstance({ displayName: "Original" }),
    );
    await repositories.instances.saveInstance(
      validInstance({
        displayName: "Updated Alpha",
        lifecycleStatus: "published",
        reviewStatus: "approved",
        provenance: {
          sourceKind: "human-authored",
          updatedAt: "2026-05-07T03:00:00.000Z",
        },
      }),
    );
    await repositories.instances.saveInstance(
      validInstance({
        instanceId: "instance.two",
        displayName: "Beta",
        definitionRef: {
          kind: "asset-definition",
          id: "definition.two" as AssetReference["id"],
        },
        parentCompositionRef: {
          kind: "asset-composition",
          id: "composition.two" as AssetReference["id"],
        },
        stateSummary: { summary: "Beta summary" },
        provenance: {
          sourceKind: "human-authored",
          updatedAt: "2026-05-07T02:00:00.000Z",
        },
      }),
    );

    assert.equal(
      (await repositories.instances.getInstance(instanceRef))?.displayName,
      "Updated Alpha",
    );
    assert.deepEqual(
      (
        await repositories.instances.listInstances({ definitionRef })
      ).instances.map((record) => record.instanceId),
      ["instance.one"],
    );
    assert.deepEqual(
      (
        await repositories.instances.listInstances({
          lifecycleStatus: "published",
          reviewStatus: "approved",
        })
      ).instances.map((record) => record.instanceId),
      ["instance.one"],
    );
    assert.deepEqual(
      (
        await repositories.instances.listInstances({
          parentCompositionRef: compositionRef,
        })
      ).instances.map((record) => record.instanceId),
      ["instance.one"],
    );
    assert.deepEqual(
      (
        await repositories.instances.listInstances({ text: "summary" })
      ).instances.map((record) => record.instanceId),
      ["instance.two"],
    );
    assert.deepEqual(
      (
        await repositories.instances.listInstances({ text: "instance.one" })
      ).instances.map((record) => record.instanceId),
      ["instance.one"],
    );
    assert.deepEqual(
      (
        await repositories.instances.listInstances({ text: "updated alpha" })
      ).instances.map((record) => record.instanceId),
      ["instance.one"],
    );
    assert.deepEqual(
      (
        await repositories.instances.listInstances({ text: "definition.two" })
      ).instances.map((record) => record.instanceId),
      ["instance.two"],
    );
    assert.deepEqual(
      (
        await repositories.instances.listInstances({ text: "unrelated" })
      ).instances.map((record) => record.instanceId),
      [],
    );

    await repositories.instances.saveInstance(
      validInstance({
        instanceId: "instance.workspace-a",
        metadata: {
          assetFinalization: {
            workspaceId: "workspace-a",
            sourceIdentity: { deduplicationKey: "safe-key" },
          },
        },
        provenance: {
          sourceKind: "human-authored",
          updatedAt: "2026-05-07T01:00:00.000Z",
        },
      }),
    );
    await repositories.instances.saveInstance(
      validInstance({
        instanceId: "instance.workspace-b",
        metadata: {
          assetFinalization: {
            workspaceId: "workspace-b",
            finalizedImage: { workspaceId: "workspace-b" },
            sourceIdentity: { deduplicationKey: "safe-key" },
          },
        },
        provenance: {
          sourceKind: "human-authored",
          updatedAt: "2026-05-07T01:30:00.000Z",
        },
      }),
    );
    assert.deepEqual(
      (
        await repositories.instances.listInstances({
          workspaceId: "workspace-a" as never,
        })
      ).instances.map((record) => record.instanceId),
      ["instance.workspace-a"],
    );
    assert.deepEqual(
      (
        await repositories.instances.listInstances({
          workspaceId: "workspace-b" as never,
        })
      ).instances.map((record) => record.instanceId),
      ["instance.workspace-b"],
    );

    const first = await repositories.instances.listInstances({ limit: 1 });
    const second = await repositories.instances.listInstances({
      limit: 1,
      cursor: first.nextCursor,
    });
    assert.deepEqual(
      first.instances.map((record) => record.instanceId),
      ["instance.one"],
    );
    assert.deepEqual(
      second.instances.map((record) => record.instanceId),
      ["instance.two"],
    );
  });
});

describe("local asset composition and binding repository adapters", () => {
  it("upserts, resolves, filters, and paginates compositions", async () => {
    const repositories = createRepositories(await tempRoot());
    await repositories.compositions.saveComposition(
      validComposition({
        displayName: "Updated Feature",
        lifecycleStatus: "published",
        reviewStatus: "approved",
        provenance: {
          sourceKind: "human-authored",
          updatedAt: "2026-05-07T03:00:00.000Z",
        },
      }),
    );
    await repositories.compositions.saveComposition(
      validComposition({
        compositionId: "composition.two",
        compositionType: "workflow",
        displayName: "Beta Workflow",
        description: "Workflow composition summary",
        rootInstanceRefs: [],
        instanceRefs: [],
        bindingRefs: [],
        provenance: {
          sourceKind: "human-authored",
          updatedAt: "2026-05-07T02:00:00.000Z",
        },
      }),
    );

    assert.equal(
      (await repositories.compositions.getComposition(compositionRef))
        ?.displayName,
      "Updated Feature",
    );
    assert.deepEqual(
      (
        await repositories.compositions.listCompositions({
          compositionType: "feature",
        })
      ).compositions.map((record) => record.compositionId),
      ["composition.one"],
    );
    assert.deepEqual(
      (
        await repositories.compositions.listCompositions({
          lifecycleStatus: "published",
          reviewStatus: "approved",
        })
      ).compositions.map((record) => record.compositionId),
      ["composition.one"],
    );
    assert.deepEqual(
      (
        await repositories.compositions.listCompositions({ text: "workflow" })
      ).compositions.map((record) => record.compositionId),
      ["composition.two"],
    );
    assert.deepEqual(
      (
        await repositories.compositions.listCompositions({
          text: "Feature composition summary",
        })
      ).compositions.map((record) => record.compositionId),
      ["composition.one"],
    );
    assert.deepEqual(
      (
        await repositories.compositions.listCompositions({
          text: "composition.two",
        })
      ).compositions.map((record) => record.compositionId),
      ["composition.two"],
    );
    assert.deepEqual(
      (
        await repositories.compositions.listCompositions({ text: "unrelated" })
      ).compositions.map((record) => record.compositionId),
      [],
    );
  });

  it("upserts, resolves, filters, and paginates bindings", async () => {
    const repositories = createRepositories(await tempRoot());
    await repositories.bindings.saveBinding(
      validBinding({
        bindingKind: "input",
        provenance: {
          sourceKind: "human-authored",
          updatedAt: "2026-05-07T03:00:00.000Z",
        },
      }),
    );
    await repositories.bindings.saveBinding(
      validBinding({
        bindingId: "binding.two",
        bindingKind: "dependency",
        sourceRef: {
          kind: "asset-instance",
          id: "instance.two" as AssetReference["id"],
        },
        targetRef: instanceRef,
        lifecycleStatus: "published",
        provenance: {
          sourceKind: "human-authored",
          updatedAt: "2026-05-07T02:00:00.000Z",
        },
      }),
    );

    assert.equal(
      (await repositories.bindings.getBinding(bindingRef))?.bindingId,
      "binding.one",
    );
    assert.deepEqual(
      (
        await repositories.bindings.listBindings({ bindingKind: "dependency" })
      ).bindings.map((record) => record.bindingId),
      ["binding.two"],
    );
    assert.deepEqual(
      (
        await repositories.bindings.listBindings({ sourceRef: instanceRef })
      ).bindings.map((record) => record.bindingId),
      ["binding.one"],
    );
    assert.deepEqual(
      (
        await repositories.bindings.listBindings({ targetRef: instanceRef })
      ).bindings.map((record) => record.bindingId),
      ["binding.one", "binding.two"],
    );
    assert.deepEqual(
      (
        await repositories.bindings.listBindings({ text: "dependency" })
      ).bindings.map((record) => record.bindingId),
      ["binding.two"],
    );
    assert.deepEqual(
      (
        await repositories.bindings.listBindings({ text: "binding.two" })
      ).bindings.map((record) => record.bindingId),
      ["binding.two"],
    );
    assert.deepEqual(
      (
        await repositories.bindings.listBindings({ text: "instance.two" })
      ).bindings.map((record) => record.bindingId),
      ["binding.two"],
    );
    assert.deepEqual(
      (
        await repositories.bindings.listBindings({ text: "instance.one" })
      ).bindings.map((record) => record.bindingId),
      ["binding.one", "binding.two"],
    );
    assert.deepEqual(
      (
        await repositories.bindings.listBindings({ text: "unrelated" })
      ).bindings.map((record) => record.bindingId),
      [],
    );
    const first = await repositories.bindings.listBindings({
      text: "binding",
      limit: 1,
    });
    const second = await repositories.bindings.listBindings({
      text: "binding",
      limit: 1,
      cursor: first.nextCursor,
    });
    assert.deepEqual(
      first.bindings.map((record) => record.bindingId),
      ["binding.one"],
    );
    assert.deepEqual(
      second.bindings.map((record) => record.bindingId),
      ["binding.two"],
    );
  });
});

describe("local asset adapter use-case validation integration", () => {
  it("persists valid definitions, instances, and compositions through use cases", async () => {
    const repositories = createRepositories(await tempRoot());
    assert.equal(
      (
        await new RegisterAssetDefinitionUseCase({
          definitionRepository: repositories.definitions,
        }).execute(validDefinition())
      ).ok,
      true,
    );
    assert.equal(
      (
        await new CreateAssetInstanceUseCase({
          definitionRepository: repositories.definitions,
          instanceRepository: repositories.instances,
        }).execute(validInstance())
      ).ok,
      true,
    );
    await repositories.bindings.saveBinding(validBinding());
    assert.equal(
      (
        await new CreateAssetCompositionUseCase({
          compositionRepository: repositories.compositions,
          definitionRepository: repositories.definitions,
          instanceRepository: repositories.instances,
          bindingRepository: repositories.bindings,
        }).execute(validComposition())
      ).ok,
      true,
    );

    assert.equal(
      (await repositories.definitions.getDefinition(definitionRef))
        ?.definitionId,
      "definition.one",
    );
    assert.equal(
      (await repositories.instances.getInstance(instanceRef))?.instanceId,
      "instance.one",
    );
    assert.equal(
      (await repositories.compositions.getComposition(compositionRef))
        ?.compositionId,
      "composition.one",
    );
  });

  it("does not persist invalid definitions, instances, or compositions through use cases", async () => {
    const repositories = createRepositories(await tempRoot());
    assert.equal(
      (
        await new RegisterAssetDefinitionUseCase({
          definitionRepository: repositories.definitions,
        }).execute(invalidDefinition())
      ).ok,
      false,
    );
    assert.equal(
      (await repositories.definitions.listDefinitions()).definitions.length,
      0,
    );

    assert.equal(
      (
        await new CreateAssetInstanceUseCase({
          definitionRepository: repositories.definitions,
          instanceRepository: repositories.instances,
        }).execute(invalidInstance())
      ).ok,
      false,
    );
    assert.equal(
      (await repositories.instances.listInstances()).instances.length,
      0,
    );

    assert.equal(
      (
        await new CreateAssetCompositionUseCase({
          compositionRepository: repositories.compositions,
          definitionRepository: repositories.definitions,
          instanceRepository: repositories.instances,
          bindingRepository: repositories.bindings,
        }).execute(invalidComposition())
      ).ok,
      false,
    );
    assert.equal(
      (await repositories.compositions.listCompositions()).compositions.length,
      0,
    );
  });
});

describe("local asset adapter architecture boundaries", () => {
  it("does not import hosts, UI, transports, runtime adapters, runtime readiness, or runtime guards", () => {
    const dir = dirname(fileURLToPath(import.meta.url));
    const adapterDir = dirname(dir);
    const forbiddenImportPattern =
      /from\s+["'][^"']*(?:hosts|api|ipc|electron|express|renderer|thin-client|runtime-readiness|runtime-guard|runtime\/.*adapter)[^"']*["']/;
    const forbiddenRuntimeCallPattern =
      /\b(?:requireCapabilityReady|startTask|startRuntime|probeRuntime|installRuntime|repairRuntime)\b/;
    for (const file of readdirSync(adapterDir)) {
      if (!file.endsWith(".ts") || file.endsWith(".unit.test.ts")) continue;
      const source = readFileSync(join(adapterDir, file), "utf8");
      assert.equal(
        forbiddenImportPattern.test(source),
        false,
        `${file} imports a forbidden boundary`,
      );
      assert.equal(
        forbiddenRuntimeCallPattern.test(source),
        false,
        `${file} calls runtime readiness or lifecycle behavior`,
      );
    }
  });

  it("exports adapters through the persistence asset barrel", () => {
    assert.equal(
      typeof createLocalAssetDefinitionRepositoryAdapter,
      "function",
    );
    assert.equal(typeof createLocalAssetInstanceRepositoryAdapter, "function");
    assert.equal(
      typeof createLocalAssetCompositionRepositoryAdapter,
      "function",
    );
    assert.equal(typeof createLocalAssetBindingRepositoryAdapter, "function");
  });
});
