import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import type { AssetPackManifest } from "../../../../contracts/asset";
import {
  createAssetPackManifestFingerprint,
  normalizeAssetPackManifestForSerialization,
  parseAssetPackManifestJson,
  serializeAssetPackManifest,
  validateAssetPackManifest,
} from "../index";
import {
  createImportedPackManifestFixture,
  createSystemFoundationManifestFixture,
  createUnsafePackManifestFixture,
  createUserOverridePackManifestFixture,
} from "./fixtures/asset-pack-manifest.fixtures";

function assertNoUnsafeContent(value: unknown): void {
  const output = JSON.stringify(value).toLowerCase();
  for (const unsafe of [
    "c:\\",
    "/tmp",
    "/home/",
    "bearer ",
    "token=",
    "password",
    "secret",
    '"authorization":"bearer ',
    '"authorization":"basic ',
    "signedurl",
    "x-amz-signature",
    "providerpayload",
    "rawpayload",
    "data:",
    "base64",
    "workflowjson",
    "executioncode",
    "resourcebytes",
    "resourcecontent",
  ]) {
    assert.equal(output.includes(unsafe), false, unsafe);
  }
}

function parseOk(input: string): AssetPackManifest {
  const result = parseAssetPackManifestJson(input);
  assert.equal(result.ok, true, result.ok ? "" : JSON.stringify(result.issues));
  return result.manifest;
}

describe("asset pack manifest serialization", () => {
  it("serializes system.foundation to JSON and parses back to a valid manifest", () => {
    const manifest = createSystemFoundationManifestFixture();
    const serialized = serializeAssetPackManifest(manifest);
    const parsed = parseOk(serialized);
    const validation = validateAssetPackManifest(parsed);

    assert.equal(JSON.parse(serialized).packId, "system.foundation");
    assert.equal(validation.status, "valid");
    assert.equal(parsed.assets.length, manifest.assets.length);
  });

  it("is deterministic across serialize, parse, validate, and re-serialize cycles", () => {
    const manifest = createSystemFoundationManifestFixture();
    const first = serializeAssetPackManifest(manifest);
    const second = serializeAssetPackManifest(manifest);
    const parsed = parseOk(first);
    const third = serializeAssetPackManifest(parsed);

    assert.equal(first, second);
    assert.equal(third, first);
    assert.equal(validateAssetPackManifest(parsed).status, "valid");
  });

  it("preserves entries, categories, source metadata, trust metadata, and override rules", () => {
    const systemParsed = parseOk(
      serializeAssetPackManifest(createSystemFoundationManifestFixture()),
    );
    const userParsed = parseOk(
      serializeAssetPackManifest(createUserOverridePackManifestFixture()),
    );

    assert.deepEqual(systemParsed.categories, createSystemFoundationManifestFixture().categories);
    assert.equal(systemParsed.sourceKind, "system");
    assert.equal(systemParsed.sourceLayer, "system-default");
    assert.equal(systemParsed.trustStatus, "system-trusted");
    assert.equal(systemParsed.assets.length > 0, true);
    assert.equal(userParsed.overrideRules?.length, 1);
    assert.equal(userParsed.overrideRules?.[0]?.targetRef.id, createSystemFoundationManifestFixture().assets[0]?.definitionRef.id);
  });

  it("returns safe parse issues for invalid JSON and wrong-shaped JSON", () => {
    const invalid = parseAssetPackManifestJson("{ bad json");
    const wrongShape = parseAssetPackManifestJson("[]");
    const missingFields = parseAssetPackManifestJson(JSON.stringify({ assets: {} }));

    assert.equal(invalid.ok, false);
    assert.equal(wrongShape.ok, false);
    assert.equal(missingFields.ok, false);
    assert.match(JSON.stringify(invalid), /invalid-json/);
    assert.doesNotMatch(JSON.stringify(invalid), /SyntaxError|at JSON\.parse|stack/i);
    assert.match(JSON.stringify(wrongShape), /invalid-root/);
    assert.match(JSON.stringify(missingFields), /missing-pack-id|invalid-assets/);
  });

  it("does not execute code or preserve functions, symbols, or undefined values", () => {
    let executed = false;
    const manifest = {
      ...createImportedPackManifestFixture(),
      metadata: {
        safe: "visible",
        unsafeFunction: () => {
          executed = true;
        },
        unsafeSymbol: Symbol("fixture"),
        unsafeUndefined: undefined,
      },
    } as unknown as AssetPackManifest;
    const serialized = serializeAssetPackManifest(manifest);
    const parsed = parseOk(serialized);
    const output = JSON.stringify(parsed);

    assert.equal(executed, false);
    assert.equal(output.includes("unsafeFunction"), false);
    assert.equal(output.includes("unsafeSymbol"), false);
    assert.equal(output.includes("unsafeUndefined"), false);
    assert.equal(parsed.metadata?.safe, "visible");
  });

  it("reports unsafe parsed manifests and validation rejects unsafe fixture content", () => {
    const unsafeParsed = parseAssetPackManifestJson(
      JSON.stringify(createUnsafePackManifestFixture()),
    );
    const validation = validateAssetPackManifest(createUnsafePackManifestFixture());

    assert.equal(unsafeParsed.ok, false);
    assert.match(JSON.stringify(unsafeParsed), /unsafe-key|unsafe-value/);
    assert.equal(validation.status, "invalid");
  });

  it("keeps safe fixture manifests free of local paths, credentials, payloads, bytes, and workflow content", () => {
    for (const fixture of [
      createSystemFoundationManifestFixture(),
      createUserOverridePackManifestFixture(),
      createImportedPackManifestFixture(),
    ]) {
      assertNoUnsafeContent(fixture);
      assert.equal(validateAssetPackManifest(fixture).status, "valid");
    }
  });
});

describe("system.foundation export readiness as a manifest string", () => {
  it("contains pack metadata, categories, entries, and full definitions without archive behavior", () => {
    const manifest = createSystemFoundationManifestFixture();
    const serialized = serializeAssetPackManifest(manifest);
    const parsed = parseOk(serialized);

    assert.equal(typeof serialized, "string");
    assert.equal(JSON.parse(serialized).packId, "system.foundation");
    assert.deepEqual(parsed.categories, manifest.categories);
    assert.equal(parsed.assets.length, manifest.assets.length);
    assert.equal(Boolean(parsed.assets[0]?.definition), true);
    assert.equal(validateAssetPackManifest(parsed).status, "valid");
    assert.match(createAssetPackManifestFingerprint(parsed), /^sha256:[a-f0-9]{64}$/);
    assertNoUnsafeContent(parsed);
    assert.doesNotMatch(serialized.toLowerCase(), /archivepath|archivebytes|signaturevalue|preloadmethod|ipchandler|apiroute|rendererbutton|runtimeadapter|storageadapter/);
  });

  it("normalizes object keys deterministically while preserving manifest semantics", () => {
    const manifest = createSystemFoundationManifestFixture();
    const reordered = JSON.parse(JSON.stringify(manifest));
    const normalized = normalizeAssetPackManifestForSerialization(reordered);

    assert.equal(serializeAssetPackManifest(manifest), serializeAssetPackManifest(normalized));
    assert.deepEqual(normalized.assets.map((entry) => entry.entryId), manifest.assets.map((entry) => entry.entryId));
  });

  it("keeps serialization helper source pure and free of filesystem, host, transport, UI, runtime, storage, and provider imports", () => {
    const source = readFileSync(
      join(process.cwd(), "modules/application/services/asset-packs/asset-pack-serialization.service.ts"),
      "utf8",
    );

    for (const forbidden of [
      "node:fs",
      "node:path",
      "modules/adapters",
      "modules/hosts",
      "contracts/api",
      "contracts/ipc",
      "electron",
      "express",
      "preload",
      "renderer",
      "thin-client",
      "fetch(",
    ]) {
      assert.equal(source.includes(forbidden), false, forbidden);
    }
  });
});
