import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import * as assetPorts from "../../../ports/asset";
import * as applicationPorts from "../../../ports";
import * as assetUseCases from "..";
import type { AssetBindingRepositoryPort } from "../../../ports";
import * as applicationUseCases from "../..";

describe("asset registry application boundaries", () => {
  it("exports asset ports and use cases through family and application barrels", () => {
    assert.equal(typeof assetPorts, "object");
    assert.equal(typeof applicationPorts, "object");
    assert.equal(typeof assetUseCases.RegisterAssetDefinitionUseCase, "function");
    assert.equal(typeof applicationUseCases.CreateAssetCompositionUseCase, "function");
    const bindingRepository: AssetBindingRepositoryPort = {
      saveBinding: async (binding) => binding,
      getBinding: async () => undefined,
      listBindings: async () => ({ bindings: [] }),
    };
    assert.equal(typeof bindingRepository.saveBinding, "function");
  });

  it("keeps asset use cases free of adapters, hosts, transports, UI, filesystem, persistence implementations, and runtime calls", () => {
    const dir = new URL("..", import.meta.url);
    const forbiddenImportPattern = /from\s+["'][^"']*(?:adapters|hosts|api|ipc|electron|express|renderer|thin-client|persistence\/.*adapter|runtime-installer|runtime\/.*adapter|node:fs|node:path|fs|path)[^"']*["']/;
    const forbiddenRuntimeCallPattern = /\b(?:requireCapabilityReady|startTask|startRuntime|probeRuntime|installRuntime|repairRuntime)\b/;
    for (const file of readdirSync(dir)) {
      if (!file.endsWith(".ts") || file.endsWith(".unit.test.ts")) continue;
      const source = readFileSync(join(fileURLToPath(dir), file), "utf8");
      assert.equal(forbiddenImportPattern.test(source), false, `${file} imports a forbidden boundary`);
      assert.equal(forbiddenRuntimeCallPattern.test(source), false, `${file} calls runtime readiness or lifecycle behavior`);
    }
  });

  it("returns safe structured error details", async () => {
    const reader = new assetUseCases.ReadAssetDefinitionUseCase({ definitionRepository: { saveDefinition: async (definition) => definition, getDefinition: async () => undefined, listDefinitions: async () => ({ definitions: [] }) } });
    const result = await reader.execute({ kind: "asset-definition", id: "missing" as never });
    assert.equal(result.ok, false);
    assert.deepEqual(result.error?.details, { referenceKind: "asset-definition", referenceId: "missing" });
    assert.doesNotMatch(JSON.stringify(result.error), /(?:stack|token|secret|password|\/tmp|C:\\|node_modules)/i);
  });
});


it("rejects malformed input shapes before looking up context or saving", async () => {
  let reads = 0; let writes = 0;
  const definitionRepository = { async getDefinition() { reads++; return undefined; } } as any;
  const instanceRepository = { async getInstance() { reads++; return undefined; }, async saveInstance(v: any) { writes++; return v; } } as any;
  const compositionRepository = { async saveComposition(v: any) { writes++; return v; } } as any;
  const createInstance = new assetUseCases.CreateAssetInstanceUseCase({ definitionRepository, instanceRepository });
  const createComposition = new assetUseCases.CreateAssetCompositionUseCase({ definitionRepository, instanceRepository, compositionRepository });
  for (const value of [null, {}, { definitionRef: null }, { definitionRef: "bad" }]) {
    assert.equal((await createInstance.execute(value as any)).ok, false);
  }
  for (const value of [null, {}, { instanceRefs: [null], rootInstanceRefs: [] }, { instanceRefs: "bad", rootInstanceRefs: [] }]) {
    assert.equal((await createComposition.execute(value as any)).ok, false);
  }
  assert.equal(reads, 0); assert.equal(writes, 0);
});
