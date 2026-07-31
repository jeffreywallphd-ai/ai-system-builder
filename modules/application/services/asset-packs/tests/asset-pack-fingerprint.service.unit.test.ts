import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import type { AssetPackManifest } from "../../../../contracts/asset";
import {
  createAssetPackEntryFingerprint,
  createAssetPackManifestFingerprint,
} from "../asset-pack-fingerprint.service";
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
    assert.match(createAssetPackManifestFingerprint(manifest), /^sha256:[a-f0-9]{64}$/);
    assert.match(createAssetPackEntryFingerprint(entry), /^sha256:[a-f0-9]{64}$/);
  });

  it("changes when definition version, configuration schema, or AI context changes", () => {
    const manifest = firstEntryManifest();
    const base = createAssetPackManifestFingerprint(manifest);
    const versionChanged = withFirstDefinition(manifest, (definition) => ({
      ...definition,
      version: "1.0.1",
    }));
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

  it("safely handles unsafe manifest content without exposing raw content in the hash", () => {
    const unsafe = createUnsafePackManifestFixture();
    const fingerprint = createAssetPackManifestFingerprint(unsafe);

    assert.match(fingerprint, /^sha256:[a-f0-9]{64}$/);
    assert.equal(fingerprint.includes("token"), false);
    assert.equal(fingerprint.includes("hidden"), false);
    assert.equal(fingerprint.includes("apiKey"), false);
  });

  it("does not treat fingerprinting as validation or import approval", () => {
    const unsafe = createUnsafePackManifestFixture();
    const fingerprint = createAssetPackManifestFingerprint(unsafe);
    const validation = validateAssetPackManifest(unsafe);
    const parsed = parseAssetPackManifestJson(JSON.stringify(unsafe));

    assert.match(fingerprint, /^sha256:[a-f0-9]{64}$/);
    assert.equal(validation.status, "invalid");
    assert.equal(parsed.ok, false);
    assert.equal(JSON.stringify({ fingerprint, validation, parsed }).includes("Bearer"), false);
    assert.equal(JSON.stringify({ fingerprint, validation, parsed }).includes("token=hidden"), false);
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
