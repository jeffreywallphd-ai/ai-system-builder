import { describe, expect, it } from "../../../../testing/node-test";
import type { AssetBinding, AssetDefinition, AssetInstance, AssetReference } from "../../../../contracts/asset";
import { normalizeAssetId } from "../../../../contracts/asset";
import type { SystemBuilderComposition } from "../../../../contracts/system-builder";
import { ValidateSystemBuilderRevisionService } from "../validate-system-builder-revision.service";

const definition = (id: string, direction: "input" | "output", required = false): AssetDefinition => ({
  definitionId: normalizeAssetId(id), assetType: "ui-component", assetFamily: "structural", version: "1.0.0",
  displayName: id, description: id, lifecycleStatus: "published",
  provenance: { sourceKind: "system-generated" },
  ports: [{ portId: direction === "input" ? "in" : "out", direction, contract: { contractKind: "json" }, ...(required ? { cardinality: { preset: "exactly-one" } } : {}) }],
});
const definitions = new Map([["source", definition("source", "output")], ["target", definition("target", "input", true)]]);
const exactRef = (id: string): AssetReference => ({ kind: "asset-definition-version", id: normalizeAssetId(id), version: "1.0.0" });
const instance = (id: string, definitionId: string): AssetInstance => ({
  instanceId: normalizeAssetId(id), definitionRef: exactRef(definitionId), lifecycleStatus: "draft",
  parentCompositionRef: { kind: "asset-composition", id: normalizeAssetId("system.test.composition") },
  provenance: { sourceKind: "human-authored" },
});
const composition = (instances: readonly AssetInstance[], bindings: readonly AssetBinding[]): SystemBuilderComposition => ({
  compositionId: normalizeAssetId("system.test.composition"), compositionType: "system", displayName: "Test", version: "0.1.0", lifecycleStatus: "draft",
  rootInstanceRefs: instances.slice(0, 1).map((item) => ({ kind: "asset-instance", id: item.instanceId as ReturnType<typeof normalizeAssetId> })),
  instanceRefs: instances.map((item) => ({ kind: "asset-instance", id: item.instanceId as ReturnType<typeof normalizeAssetId> })),
  bindingRefs: bindings.map((item) => ({ kind: "asset-binding", id: item.bindingId as ReturnType<typeof normalizeAssetId> })),
  provenance: { sourceKind: "human-authored" },
});
const binding = (id: string, source: string, target: string, kind: AssetBinding["bindingKind"] = "output"): AssetBinding => ({
  bindingId: normalizeAssetId(id), bindingKind: kind,
  sourceRef: { kind: "asset-instance", id: normalizeAssetId(source) }, targetRef: { kind: "asset-instance", id: normalizeAssetId(target) },
  sourcePortRef: { kind: "asset-definition", id: normalizeAssetId("out") }, targetPortRef: { kind: "asset-definition", id: normalizeAssetId("in") },
});

describe("ValidateSystemBuilderRevisionService", () => {
  const validator = new ValidateSystemBuilderRevisionService({ readExactDefinition: async (reference) => definitions.get(String(reference.id)) }, () => "2026-07-17T00:00:00.000Z");

  it("accepts exact definitions, compatible ports, and satisfied cardinality", async () => {
    const instances = [instance("one", "source"), instance("two", "target")];
    const bindings = [binding("edge", "one", "two")];
    const result = await validator.execute({ composition: composition(instances, bindings), instances, bindings });
    expect(result.status).toBe("valid");
    expect(result.issues).toEqual([]);
  });

  it("fails closed for unpinned definitions, missing endpoints, cardinality, and dependency cycles", async () => {
    const instances = [instance("one", "source"), { ...instance("two", "target"), definitionRef: { kind: "asset-definition", id: normalizeAssetId("target") } as AssetReference }];
    const bindings = [binding("forward", "one", "missing", "dependency"), binding("back", "two", "one", "dependency")];
    const result = await validator.execute({ composition: composition(instances, bindings), instances, bindings });
    expect(result.status).toBe("invalid");
    expect(result.issues.some((issue) => issue.message.includes("pin an exact"))).toBe(true);
    expect(result.issues.some((issue) => issue.message.includes("same revision"))).toBe(true);
  });

  it("rejects a dependency cycle", async () => {
    const cycleDefinitions = new Map([["source", definition("source", "output")]]);
    const cycleValidator = new ValidateSystemBuilderRevisionService({ readExactDefinition: async (reference) => cycleDefinitions.get(String(reference.id)) });
    const instances = [instance("one", "source"), instance("two", "source")];
    const bindings = [binding("a", "one", "two", "dependency"), binding("b", "two", "one", "dependency")];
    const result = await cycleValidator.execute({ composition: composition(instances, bindings), instances, bindings });
    expect(result.issues.some((issue) => issue.message.includes("must not contain a cycle"))).toBe(true);
  });

  it("rejects instances whose parent points outside the saved composition", async () => {
    const instances = [{
      ...instance("one", "source"),
      parentCompositionRef: { kind: "asset-composition", id: normalizeAssetId("system.other.composition") } as AssetReference,
    }];
    const result = await validator.execute({ composition: composition(instances, []), instances, bindings: [] });
    expect(result.status).toBe("invalid");
    expect(result.issues.some((issue) => issue.message.includes("belong to the saved system composition"))).toBe(true);
  });
});
