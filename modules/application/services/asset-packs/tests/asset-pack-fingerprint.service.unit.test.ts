import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import type { AssetPackManifest } from "../../../../contracts/asset";
import {
  createAssetPackEntryFingerprint,
  createAssetPackManifestFingerprint,
  verifyAssetPackManifestFingerprint,
  verifyAssetPackEntryFingerprint,
} from "../asset-pack-fingerprint.service";
import { captureAssetPackFingerprintInput } from "../asset-pack-fingerprint-input";
import { SYSTEM_FOUNDATION_PACK_MANIFEST, SYSTEM_FOUNDATION_PACK_V2_MANIFEST, SYSTEM_FOUNDATION_PACK_V3_MANIFEST } from "../system-packs";
import {
  createImportedPackManifestFixture,
  createSystemFoundationManifestFixture,
  createUnsafePackManifestFixture,
  createUserOverridePackManifestFixture,
} from "./fixtures/asset-pack-manifest.fixtures";
import { validateAssetPackManifest } from "../asset-pack-validation.service";
import { parseAssetPackManifestJson } from "../asset-pack-serialization.service";

function firstEntryManifest(): AssetPackManifest {
  const manifest = createSystemFoundationManifestFixture();
  return {
    ...manifest,
    assets: [manifest.assets[0]!],
  };
}

function withFirstDefinition(
  manifest: AssetPackManifest,
  mutate: (definition: AssetPackManifest["assets"][number]["definition"]) => AssetPackManifest["assets"][number]["definition"],
): AssetPackManifest {
  const [entry, ...rest] = manifest.assets;
  assert.ok(entry);
  const updatedEntry = {
    ...entry,
    definition: mutate(structuredClone(entry.definition)),
  };
  return {
    ...manifest,
    assets: [updatedEntry, ...rest],
  };
}

describe("asset pack manifest fingerprints", () => {
  it("rejects malformed set-like lists before semantic normalization", () => {
    const manifest = firstEntryManifest();
    const entry = manifest.assets[0]!;
    for (const tags of ["ab", null, false, 12, {}, [1], [null], [["a"]]]) {
      assert.throws(() => createAssetPackManifestFingerprint({ ...manifest, tags } as never));
      assert.throws(() => createAssetPackEntryFingerprint({ ...entry, tags } as never));
      assert.throws(() => createAssetPackManifestFingerprint({ ...manifest, assets: [{ ...entry, tags }] } as never));
    }
    for (const field of ["dependencies", "overrideRules", "categories"] as const) {
      for (const value of [null, false, {}, "ab"]) {
        assert.throws(() => createAssetPackManifestFingerprint({ ...manifest, [field]: value } as never));
      }
    }
    assert.throws(() => createAssetPackManifestFingerprint({ ...manifest, categories: [12] } as never));
    assert.match(createAssetPackManifestFingerprint({ ...manifest, tags: ["a", "b"] }), /^sha256:semantic-v2:/);
    assert.match(createAssetPackEntryFingerprint({ ...entry, tags: ["a", "b"] }), /^sha256:semantic-v2:/);
  });

  it("charges complete encoded JSON bytes including primitives, punctuation and escapes", () => {
    const cap = 16 * 1024 * 1024;
    // The old counter saw only the near-limit text and ignored all numbers.
    const oversized = ["x".repeat(cap - 32), ...Array.from({ length: 30 }, () => Array(8192).fill(1.2345678901234567e100))];
    assert.ok(Buffer.byteLength(JSON.stringify(oversized)) > cap);
    assert.throws(() => captureAssetPackFingerprintInput(oversized));
    for (const value of [null, false, true, 0, 1.2345678901234567e100, "\"\\\n\u0000é😀\ud800"]) {
      const overhead = Buffer.byteLength(JSON.stringify(["", value]));
      const exact = ["x".repeat(cap - overhead), value];
      assert.equal(Buffer.byteLength(JSON.stringify(exact)), cap);
      assert.deepEqual(captureAssetPackFingerprintInput(exact), exact);
      assert.throws(() => captureAssetPackFingerprintInput([`${exact[0]}x`, value]));
    }
    const overhead = Buffer.byteLength(JSON.stringify({ text: "", count: 1 }));
    const exact = { text: "x".repeat(cap - overhead), count: 1 };
    assert.equal(Buffer.byteLength(JSON.stringify(exact)), cap);
    assert.equal(Buffer.byteLength(JSON.stringify(captureAssetPackFingerprintInput(exact))), cap);
    assert.throws(() => captureAssetPackFingerprintInput({ ...exact, count: 12 }));
  });

  it("separates validated semantic-v2 identities from legacy unversioned hashes", () => {
    assert.match(createAssetPackManifestFingerprint(firstEntryManifest()), /^sha256:semantic-v2:[a-f0-9]{64}$/);
  });

  it("rejects unsafe content before hashing instead of silently omitting it", () => {
    assert.throws(() => createAssetPackManifestFingerprint(createUnsafePackManifestFixture()));
  });

  it("distinguishes validated authorship and explanatory content hidden by display projection", () => {
    const base = firstEntryManifest();
    const human = withFirstDefinition(base, (definition) => ({
      ...definition, provenance: { ...definition.provenance!, authorship: "human-authored" },
    }));
    const generated = withFirstDefinition(base, (definition) => ({
      ...definition, provenance: { ...definition.provenance!, authorship: "ai-generated" },
    }));
    assert.notEqual(validateAssetPackManifest(human).status, "invalid");
    assert.notEqual(validateAssetPackManifest(generated).status, "invalid");
    assert.notEqual(createAssetPackManifestFingerprint(human), createAssetPackManifestFingerprint(generated));
    const first = withFirstDefinition(base, (definition) => ({ ...definition, description: "Never include provider payloads." }));
    const second = withFirstDefinition(base, (definition) => ({ ...definition, description: "Avoid retaining provider payloads." }));
    assert.notEqual(validateAssetPackManifest(first).status, "invalid");
    assert.notEqual(validateAssetPackManifest(second).status, "invalid");
    assert.notEqual(createAssetPackManifestFingerprint(first), createAssetPackManifestFingerprint(second));
  });

  it("creates deterministic fingerprints for system.foundation manifests and entries", () => {
    const manifest = createSystemFoundationManifestFixture();
    const entry = manifest.assets[0]!;

    assert.equal(
      createAssetPackManifestFingerprint(manifest),
      createAssetPackManifestFingerprint(structuredClone(manifest)),
    );
    assert.equal(
      createAssetPackEntryFingerprint(entry),
      createAssetPackEntryFingerprint(structuredClone(entry)),
    );
    assert.match(createAssetPackManifestFingerprint(manifest), /^sha256:semantic-v2:[a-f0-9]{64}$/);
    assert.match(createAssetPackEntryFingerprint(entry), /^sha256:semantic-v2:[a-f0-9]{64}$/);
  });

  it("changes when definition version, configuration schema, or AI context changes", () => {
    const manifest = firstEntryManifest();
    const base = createAssetPackManifestFingerprint(manifest);
    const versionChangedDefinition = withFirstDefinition(manifest, (definition) => ({
      ...definition,
      version: "1.0.1",
    }));
    // A version change must retain a coherent exact reference before hashing.
    const versionChanged = { ...versionChangedDefinition, assets: versionChangedDefinition.assets.map((entry) => ({ ...entry, definitionRef: { ...entry.definitionRef, version: "1.0.1" } })) };
    const schemaChanged = withFirstDefinition(manifest, (definition) => ({
      ...definition,
      configurationSchema: {
        schemaId: "fixture.schema",
        fields: [
          {
            fieldId: "density",
            displayName: "Density",
            valueKind: "string",
          },
        ],
      },
    }));
    const aiContextChanged = withFirstDefinition(manifest, (definition) => ({
      ...definition,
      aiContext: {
        ...definition.aiContext!,
        userFacingSummary: "Changed fixture summary.",
      },
    }));

    assert.notEqual(createAssetPackManifestFingerprint(versionChanged), base);
    assert.notEqual(createAssetPackManifestFingerprint(schemaChanged), base);
    assert.notEqual(createAssetPackManifestFingerprint(aiContextChanged), base);
  });

  it("changes when an override rule changes", () => {
    const manifest = createUserOverridePackManifestFixture();
    const changed = {
      ...manifest,
      overrideRules: (manifest.overrideRules ?? []).map((rule) => ({
        ...rule,
        priority: rule.priority + 1,
      })),
    };

    assert.notEqual(
      createAssetPackManifestFingerprint(changed),
      createAssetPackManifestFingerprint(manifest),
    );
  });

  it("normalizes allowed non-semantic ordering where practical", () => {
    const manifest = createImportedPackManifestFixture();
    const reordered = {
      ...manifest,
      tags: [...(manifest.tags ?? [])].reverse(),
      categories: [...(manifest.categories ?? [])].reverse(),
      dependencies: [...(manifest.dependencies ?? [])].reverse(),
      assets: [...manifest.assets].reverse(),
      overrideRules: [...(manifest.overrideRules ?? [])].reverse(),
    };

    assert.equal(
      createAssetPackManifestFingerprint(reordered),
      createAssetPackManifestFingerprint(manifest),
    );
  });

  it("normalizes timestamps, checksum, and previous entry fingerprint values out of semantic hashes", () => {
    const manifest = createImportedPackManifestFixture();
    const changedPackagingFields = {
      ...manifest,
      checksum: "sha256:different",
      createdAt: "2026-05-09T00:00:00.000Z",
      updatedAt: "2026-05-09T01:00:00.000Z",
      assets: manifest.assets.map((entry) => ({
        ...entry,
        fingerprint: "sha256:different-entry-fingerprint",
      })),
    };

    assert.equal(
      createAssetPackManifestFingerprint(changedPackagingFields),
      createAssetPackManifestFingerprint(manifest),
    );
  });

  it("rejects unsafe manifest content with a static error", () => {
    const unsafe = createUnsafePackManifestFixture();
    assert.throws(() => createAssetPackManifestFingerprint(unsafe), { message: "Asset pack semantic fingerprint input is invalid." });
  });

  it("does not treat fingerprinting as validation or import approval", () => {
    const unsafe = createUnsafePackManifestFixture();
    const validation = validateAssetPackManifest(unsafe);
    const parsed = parseAssetPackManifestJson(JSON.stringify(unsafe));

    assert.throws(() => createAssetPackManifestFingerprint(unsafe));
    assert.equal(validation.status, "invalid");
    assert.equal(parsed.ok, false);
    assert.equal(JSON.stringify({ validation, parsed }).includes("Bearer"), false);
    assert.equal(JSON.stringify({ validation, parsed }).includes("token=hidden"), false);
  });

  it("verifies exact v2 identities and leaves legacy identity and content untouched", () => {
    const manifest = createImportedPackManifestFixture();
    const before = structuredClone(manifest);
    const hash = createAssetPackManifestFingerprint(manifest);
    assert.deepEqual(verifyAssetPackManifestFingerprint(manifest, hash), { status: "verified" });
    assert.deepEqual(verifyAssetPackEntryFingerprint(manifest.assets[0]!, createAssetPackEntryFingerprint(manifest.assets[0]!)), { status: "verified" });
    for (const legacy of [`sha256:${"a".repeat(64)}`, "fnv1a:12345678"]) {
      assert.deepEqual(verifyAssetPackManifestFingerprint(manifest, legacy), { status: "legacy-revalidation-required" });
    }
    assert.deepEqual(verifyAssetPackManifestFingerprint(manifest, `${hash.slice(0, -1)}${hash.endsWith("0") ? "1" : "0"}`), { status: "mismatch" });
    assert.deepEqual(verifyAssetPackManifestFingerprint(manifest, "sha256:semantic-v3:unknown"), { status: "invalid" });
    assert.deepEqual(verifyAssetPackManifestFingerprint(createUnsafePackManifestFixture(), hash), { status: "invalid" });
    assert.deepEqual(manifest, before);
  });

  it("does not evaluate accessors, proxies, coercion or toJSON", () => {
    let calls = 0;
    const accessor = { ...firstEntryManifest() };
    Object.defineProperty(accessor, "metadata", { enumerable: true, get() { calls++; return {}; } });
    const active = { ...firstEntryManifest(), metadata: { toJSON() { calls++; return {}; } } };
    const proxy = new Proxy(firstEntryManifest(), { ownKeys() { calls++; return []; }, getPrototypeOf() { calls++; return Object.prototype; } });
    for (const value of [accessor, active, proxy]) {
      assert.throws(() => createAssetPackManifestFingerprint(value as AssetPackManifest), { message: "Asset pack semantic fingerprint input is invalid." });
    }
    assert.equal(calls, 0);
  });

  it("rejects malformed passive input and traversal budgets rather than omitting distinctions", () => {
    const cyclic: Record<string, unknown> = {}; cyclic.self = cyclic;
    let deep: unknown = {}; for (let i = 0; i < 34; i++) deep = { nested: deep };
    const cases: unknown[] = [NaN, Infinity, 1n, Symbol("inert"), () => 0, new Date(), cyclic, deep,
      [undefined], Array(2), Object.assign([1], { extra: 2 }), Object.assign({}, { toJSON: () => ({}) }),
      Object.fromEntries(Array.from({ length: 8193 }, (_, i) => [`key${i}`, i])), "x".repeat(16 * 1024 * 1024 + 1),
      Array.from({ length: 32 }, () => Array(8000).fill(0)), JSON.parse('{"__proto__":{}}')];
    for (const value of cases) assert.throws(() => captureAssetPackFingerprintInput(value));
    assert.deepEqual(JSON.parse(JSON.stringify(captureAssetPackFingerprintInput({ missing: undefined, zero: 0, false: false, nil: null, empty: "" }))), { zero: 0, false: false, nil: null, empty: "" });
  });

  it("validates even excluded packaging fields and fingerprints all immutable Foundation releases without migration", () => {
    assert.throws(() => createAssetPackManifestFingerprint({ ...firstEntryManifest(), checksum: "token=hidden" }));
    assert.throws(() => createAssetPackEntryFingerprint({ ...firstEntryManifest().assets[0]!, fingerprint: "token=hidden" }));
    for (const manifest of [SYSTEM_FOUNDATION_PACK_MANIFEST, SYSTEM_FOUNDATION_PACK_V2_MANIFEST, SYSTEM_FOUNDATION_PACK_V3_MANIFEST]) {
      const before = JSON.stringify(manifest);
      assert.match(createAssetPackManifestFingerprint(manifest), /^sha256:semantic-v2:[a-f0-9]{64}$/);
      assert.equal(JSON.stringify(manifest), before);
      assert.ok(manifest.assets.every((entry) => /^fnv1a:[a-f0-9]{8}$/.test(entry.fingerprint)));
    }
  });

  it("does not require filesystem, network, runtime, provider, storage, host, or transport behavior", () => {
    const source = readFileSync(
      join(process.cwd(), "modules/application/services/asset-packs/asset-pack-fingerprint.service.ts"),
      "utf8",
    );

    for (const forbidden of [
      "node:fs",
      "node:path",
      "fetch(",
      "modules/adapters",
      "modules/hosts",
      "contracts/api",
      "contracts/ipc",
      "electron",
      "express",
      "preload",
      "renderer",
      "thin-client",
      "RepositoryPort",
      "Runtime",
    ]) {
      assert.equal(source.includes(forbidden), false, forbidden);
    }
  });
});
