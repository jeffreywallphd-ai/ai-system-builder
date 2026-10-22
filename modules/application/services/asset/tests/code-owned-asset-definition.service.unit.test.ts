import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AssetDefinition } from "../../../../contracts/asset";
import { BUILT_IN_ASSET_DEFINITION_CATALOG } from "../built-ins";
import { readSystemFoundationManifest } from "../../asset-packs/system-packs/system-foundation-pack-v3.manifest";
import { admitAssetDefinitionForRead, matchCodeOwnedAssetDefinition, type CodeOwnedAssetDefinition } from "../code-owned-asset-definition.service";

const stamp = "2026-01-01T00:00:00.000Z";
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
function assertAuthority(input: unknown, expected: CodeOwnedAssetDefinition | undefined): void {
  assert.deepEqual(matchCodeOwnedAssetDefinition(input), expected);
  assert.deepEqual(admitAssetDefinitionForRead(input).authority, expected);
}

describe("Code-owned definition content authority", () => {
  it("recognizes every raw, JSON-persisted and precisely enriched shipped definition", () => {
    let count = 0;
    for (const seed of BUILT_IN_ASSET_DEFINITION_CATALOG) {
      for (const definition of [seed.definition, clone(seed.definition), {
        ...clone(seed.definition), metadata: { ...clone(seed.definition).metadata, builtInSeed: {
          seedId: seed.seedId, seedVersion: seed.seedVersion, fingerprint: seed.fingerprint,
          managedBy: "asset-kernel", lastSeededAt: stamp,
        } },
      }]) assertAuthority(definition, { kind: "legacy" });
      count++;
    }
    for (const version of ["1.0.0", "2.0.0", "3.0.0"]) {
      const manifest = readSystemFoundationManifest(version)!;
      for (const entry of manifest.assets) {
        const definition = clone(entry.definition);
        const installed = { ...definition, metadata: {
          ...definition.metadata, sourcePackId: manifest.packId, sourcePackVersion: manifest.version,
          sourceLayer: entry.sourceLayer, sourcePackEntryId: entry.entryId, sourcePackFingerprint: entry.fingerprint,
          assetPackInstall: { packId: manifest.packId, packVersion: manifest.version, entryId: entry.entryId,
            fingerprint: entry.fingerprint, sourceKind: "system", sourceLayer: "system-default",
            trustStatus: "system-trusted", managedBy: "asset-kernel", installedAt: stamp },
        }, provenance: { ...definition.provenance, metadata: {
          ...definition.provenance.metadata, sourcePackId: manifest.packId, sourcePackVersion: manifest.version,
          sourceLayer: entry.sourceLayer, sourcePackEntryId: entry.entryId,
        } } };
        for (const value of [entry.definition, definition, installed]) {
          assertAuthority(value, { kind: "foundation", packId: "system.foundation", packVersion: version });
        }
        count++;
      }
    }
    assert.equal(count, 360);
  });

  it("compares full bodies rather than IDs, markers, display normalization or FNV claims", () => {
    const seed = BUILT_IN_ASSET_DEFINITION_CATALOG[0]!;
    const original = clone(seed.definition);
    const variants = [
      { ...original, displayName: original.displayName + " changed" },
      { ...original, version: "9.9.9" },
      { ...original, configurationSchema: { fields: [] } },
      { ...original, aiContext: { ...original.aiContext, purpose: "Different purpose" } },
      { ...original, provenance: { ...original.provenance, metadata: { added: true } } },
      { ...original, metadata: { ...original.metadata, sourceKind: "system", trustStatus: "system-trusted" } },
      { ...original, metadata: { ...original.metadata, builtInSeed: { seedId: seed.seedId,
        seedVersion: seed.seedVersion, fingerprint: seed.fingerprint, managedBy: "asset-kernel",
        lastSeededAt: stamp, unknown: true } } },
    ];
    for (const value of variants) assertAuthority(value, undefined);
    const foundation = clone(readSystemFoundationManifest("3.0.0")!.assets[0]!.definition);
    for (const field of ["displayName", "sourcePackId", "sourcePackVersion", "categoryId"]) {
      const modified = { ...clone(foundation) };
      if (field === "displayName") modified.displayName += " changed";
      else modified.metadata = { ...modified.metadata, [field]: "forged" };
      assertAuthority(modified, undefined);
    }
    const reordered = Object.fromEntries(Object.entries(original).reverse());
    assertAuthority(reordered, { kind: "legacy" });
  });

  it("rejects getters, toJSON, cycles, nonfinite values and structural/byte excess without coercion", () => {
    let callbacks = 0;
    const original = clone(BUILT_IN_ASSET_DEFINITION_CATALOG[0]!.definition);
    const accessor = Object.defineProperty({ ...original }, "definitionId", { enumerable: true, get() { callbacks++; return original.definitionId; } });
    const cyclic: Record<string, unknown> = { ...original }; cyclic.metadata = cyclic;
    let deep: unknown = {};
    for (let index = 0; index < 14; index++) deep = { child: deep };
    for (const value of [accessor, cyclic, { ...original, toJSON() { callbacks++; return original; } },
      { ...original, metadata: { value: Infinity } }, { ...original, description: "x".repeat(2049) },
      { ...original, requirements: new Array(1025).fill(null) },
      { ...original, metadata: deep }, { ...original, requirements: new Array(2) },
      { ...original, metadata: { groups: Array.from({ length: 5 }, () => new Array(1024).fill(null)) } },
      { ...original, metadata: Object.fromEntries(Array.from({ length: 128 }, (_, i) => [`field${i}`, "x".repeat(2048)])) }]) {
      assert.equal(matchCodeOwnedAssetDefinition(value), undefined);
      assert.throws(() => admitAssetDefinitionForRead(value), /Passive record data is invalid/);
      // Unknown IDs never bypass complete passive admission.
      const custom = Object.getOwnPropertyDescriptor(value, "definitionId")?.get
        ? Object.defineProperty({ ...original, definitionId: "custom.definition" }, "metadata", { enumerable: true, get() { callbacks++; return {}; } })
        : { ...value, definitionId: "custom.definition" };
      assert.equal(matchCodeOwnedAssetDefinition(custom), undefined);
      assert.throws(() => admitAssetDefinitionForRead(custom), /Passive record data is invalid/);
    }
    assert.equal(callbacks, 0);
    assertAuthority(original, { kind: "legacy" });
  });

  it("keeps invalid authority timestamps readable and detaches admitted bodies and authority", () => {
    const seed = BUILT_IN_ASSET_DEFINITION_CATALOG[0]!;
    for (const timestamp of [undefined, "not-a-time", "2026-02-30T00:00:00.000Z"]) {
      const definition = { ...clone(seed.definition), metadata: { ...seed.definition.metadata, builtInSeed: {
        seedId: seed.seedId, seedVersion: seed.seedVersion, fingerprint: seed.fingerprint,
        managedBy: "asset-kernel", lastSeededAt: timestamp,
      } } };
      assertAuthority(definition, undefined);
      assert.deepEqual(admitAssetDefinitionForRead(definition).definition, definition);
    }
    const input = clone(seed.definition);
    const first = admitAssetDefinitionForRead(input), second = admitAssetDefinitionForRead(input);
    assert.notEqual(first.definition, input);
    assert.notEqual(first.definition.aiContext, input.aiContext);
    assert.notEqual(first.definition.aiContext, second.definition.aiContext);
    assert.notEqual(first.authority, second.authority);
    (first.definition.aiContext as { purpose: string }).purpose = "Changed admitted copy";
    (first.authority as { kind: string }).kind = "changed";
    assert.deepEqual(second.definition, input);
    (input.aiContext as { purpose: string }).purpose = "Changed caller input";
    assert.notEqual(first.definition.aiContext.purpose, input.aiContext.purpose);
    assert.notEqual(second.definition.aiContext.purpose, input.aiContext.purpose);
    assertAuthority(seed.definition, { kind: "legacy" });
  });
});
