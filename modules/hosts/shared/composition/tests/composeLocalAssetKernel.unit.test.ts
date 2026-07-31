import assert from "node:assert/strict";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import type { AssetBinding, AssetComposition, AssetDefinition, AssetInstance, AssetReference } from "../../../../contracts/asset";
import { LocalAssetRecordStoreError } from "../../../../adapters/persistence/asset";
import { composeLocalAssetKernel } from "../composeLocalAssetKernel";

const definitionRef: AssetReference = { kind: "asset-definition", id: "definition.one" as AssetReference["id"] };
const definitionVersionRef: AssetReference = { kind: "asset-definition-version", id: "definition.one" as AssetReference["id"], version: "1.0.0" };
const instanceRef: AssetReference = { kind: "asset-instance", id: "instance.one" as AssetReference["id"] };
const compositionRef: AssetReference = { kind: "asset-composition", id: "composition.one" as AssetReference["id"] };
const bindingRef: AssetReference = { kind: "asset-binding", id: "binding.one" as AssetReference["id"] };

async function tempRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), "local-asset-kernel-composition-"));
}

function validDefinition(overrides: Partial<AssetDefinition> = {}): AssetDefinition {
  return {
    definitionId: "definition.one",
    assetType: "tool",
    assetFamily: "resource-backed",
    version: "1.0.0",
    displayName: "Definition One",
    description: "A valid asset definition.",
    lifecycleStatus: "draft",
    reviewStatus: "unreviewed",
    provenance: { sourceKind: "human-authored" },
    ...overrides,
  };
}

function validInstance(overrides: Partial<AssetInstance> = {}): AssetInstance {
  return {
    instanceId: "instance.one",
    definitionRef,
    displayName: "Instance One",
    lifecycleStatus: "draft",
    reviewStatus: "unreviewed",
    provenance: { sourceKind: "human-authored" },
    ...overrides,
  };
}

function validBinding(overrides: Partial<AssetBinding> = {}): AssetBinding {
  return {
    bindingId: "binding.one",
    bindingKind: "input",
    sourceRef: definitionRef,
    targetRef: definitionRef,
    lifecycleStatus: "draft",
    provenance: { sourceKind: "human-authored" },
    ...overrides,
  };
}

function validComposition(overrides: Partial<AssetComposition> = {}): AssetComposition {
  return {
    compositionId: "composition.one",
    compositionType: "feature",
    displayName: "Composition One",
    version: "1.0.0",
    lifecycleStatus: "draft",
    reviewStatus: "unreviewed",
    rootInstanceRefs: [instanceRef],
    instanceRefs: [instanceRef],
    provenance: { sourceKind: "human-authored" },
    ...overrides,
  };
}

describe("composeLocalAssetKernel", () => {
  it("creates all local Asset Kernel repository ports and existing registry use cases", async () => {
    const composition = composeLocalAssetKernel({ rootDirectory: await tempRoot() });

    for (const repository of Object.values(composition.repositories)) {
      assert.equal(typeof repository, "object");
    }
    for (const useCase of Object.values(composition.useCases)) {
      assert.equal(typeof useCase, "object");
      assert.equal(typeof (useCase as { execute?: unknown }).execute, "function");
    }
    assert.equal(typeof composition.repositories.bindingRepository.saveBinding, "function");
    assert.deepEqual(composition.diagnostics, {
      storeKind: "asset-kernel-local-store",
      schemaVersion: 1,
      initialized: true,
    });
    assert.equal("rootDirectory" in composition.diagnostics, false);
    assert.doesNotMatch(JSON.stringify(composition.diagnostics), /(?:\/tmp|[A-Za-z]:\\|\.\.\/|\.\/)/);
  });

  it("initializes missing stores and stores records under the host root asset-kernel directory", async () => {
    const rootDirectory = await tempRoot();
    assert.equal(existsSync(join(rootDirectory, "asset-kernel")), false);

    composeLocalAssetKernel({ rootDirectory, now: () => "2026-05-07T00:00:00.000Z" });

    assert.equal((await stat(join(rootDirectory, "asset-kernel"))).isDirectory(), true);
    assert.deepEqual(JSON.parse(await readFile(join(rootDirectory, "asset-kernel", "definitions.json"), "utf8")), []);
  });

  it("registers, reads, and lists a valid asset definition through composed use cases", async () => {
    const { useCases } = composeLocalAssetKernel({ rootDirectory: await tempRoot() });
    const result = await useCases.registerAssetDefinition.execute(validDefinition());

    assert.equal(result.ok, true);
    assert.equal((await useCases.readAssetDefinition.execute(definitionVersionRef)).value?.definitionId, "definition.one");
    assert.deepEqual((await useCases.listAssetDefinitions.execute()).definitions.map((definition) => definition.definitionId), ["definition.one"]);
  });

  it("creates, reads, and lists a valid asset instance through composed use cases", async () => {
    const { useCases } = composeLocalAssetKernel({ rootDirectory: await tempRoot() });
    assert.equal((await useCases.registerAssetDefinition.execute(validDefinition())).ok, true);
    assert.equal((await useCases.createAssetInstance.execute(validInstance())).ok, true);

    assert.equal((await useCases.readAssetInstance.execute(instanceRef)).value?.instanceId, "instance.one");
    assert.deepEqual((await useCases.listAssetInstances.execute()).instances.map((instance) => instance.instanceId), ["instance.one"]);
  });

  it("creates, reads, and lists a valid asset composition through composed use cases", async () => {
    const { useCases } = composeLocalAssetKernel({ rootDirectory: await tempRoot() });
    assert.equal((await useCases.registerAssetDefinition.execute(validDefinition())).ok, true);
    assert.equal((await useCases.createAssetInstance.execute(validInstance())).ok, true);
    assert.equal((await useCases.createAssetComposition.execute(validComposition())).ok, true);

    assert.equal((await useCases.readAssetComposition.execute(compositionRef)).value?.compositionId, "composition.one");
    assert.deepEqual((await useCases.listAssetCompositions.execute()).compositions.map((composition) => composition.compositionId), ["composition.one"]);
  });

  it("saves, reads, and lists bindings through the binding repository", async () => {
    const { repositories } = composeLocalAssetKernel({ rootDirectory: await tempRoot() });
    await repositories.bindingRepository.saveBinding(validBinding());

    assert.equal((await repositories.bindingRepository.getBinding(bindingRef))?.bindingId, "binding.one");
    assert.deepEqual((await repositories.bindingRepository.listBindings()).bindings.map((binding) => binding.bindingId), ["binding.one"]);
  });

  it("validates definitions, instances, and compositions before saving through use cases", async () => {
    const { repositories, useCases } = composeLocalAssetKernel({ rootDirectory: await tempRoot() });

    assert.equal((await useCases.registerAssetDefinition.execute(validDefinition({ definitionId: "../bad", displayName: "" }))).ok, false);
    assert.equal((await repositories.definitionRepository.listDefinitions()).definitions.length, 0);

    assert.equal((await useCases.registerAssetDefinition.execute(validDefinition())).ok, true);
    assert.equal((await useCases.createAssetInstance.execute(validInstance({ instanceId: "../bad" }))).ok, false);
    assert.equal((await repositories.instanceRepository.listInstances()).instances.length, 0);

    assert.equal((await useCases.createAssetInstance.execute(validInstance())).ok, true);
    assert.equal((await useCases.createAssetComposition.execute(validComposition({ compositionId: "https://bad.example/id" }))).ok, false);
    assert.equal((await repositories.compositionRepository.listCompositions()).compositions.length, 0);
  });

  it("fails clearly on malformed and unsupported manifests without leaking local paths", async () => {
    const rootDirectory = await tempRoot();
    composeLocalAssetKernel({ rootDirectory });
    await writeFile(join(rootDirectory, "asset-kernel", "manifest.json"), "{not-json", "utf8");

    assert.throws(() => composeLocalAssetKernel({ rootDirectory }), (error: unknown) => {
      assert.equal(error instanceof LocalAssetRecordStoreError, true);
      assert.match((error as Error).message, /malformed JSON/);
      assert.doesNotMatch((error as Error).message, /(?:\/tmp|secret|token|stack)/i);
      return true;
    });

    await writeFile(join(rootDirectory, "asset-kernel", "manifest.json"), JSON.stringify({ schemaVersion: 999, storeKind: "asset-kernel-local-store", updatedAt: "2026-05-07T00:00:00.000Z" }), "utf8");
    assert.throws(() => composeLocalAssetKernel({ rootDirectory }), (error: unknown) => {
      assert.equal(error instanceof LocalAssetRecordStoreError, true);
      assert.match((error as Error).message, /schema version is unsupported/);
      assert.doesNotMatch((error as Error).message, /(?:\/tmp|secret|token|stack)/i);
      return true;
    });
  });

  it("does not import host, transport, UI, Express, Electron, or runtime modules", async () => {
    const source = await readFile(join(process.cwd(), "modules/hosts/shared/composition/composeLocalAssetKernel.ts"), "utf8");

    assert.doesNotMatch(source, /hosts\/(?:desktop|server)|electron|express|renderer|thin-client|runtime-readiness|runtime\//i);
    assert.doesNotMatch(source, /adapters\/transport|apps\/|preload|ipc-electron/i);
  });
});
