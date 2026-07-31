import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { AssetPackManifest } from "../../../../contracts/asset";
import { validateAssetPackManifest } from "../asset-pack-validation.service";
import {
  createConflictingOverridePackManifestFixture,
  createImportedPackManifestFixture,
  createSystemFoundationManifestFixture,
  createUnsafePackManifestFixture,
  createUserOverridePackManifestFixture,
} from "./fixtures/asset-pack-manifest.fixtures";

function serialized(value: unknown): string {
  return JSON.stringify(value).toLowerCase();
}

function assertNoUnsafeSharingPayload(value: unknown): void {
  const output = serialized(value);
  for (const forbidden of [
    "c:\\",
    "/tmp",
    "/home/",
    "bearer ",
    "token=",
    "password",
    "secret",
    "authorization",
    "signedurl",
    "x-amz-signature",
    "providerpayload",
    "rawpayload",
    "workflowjson",
    "executioncode",
    "resourcebytes",
    "resourcecontent",
    "data:",
    "base64",
  ]) {
    assert.equal(output.includes(forbidden), false, forbidden);
  }
}

function messages(result: ReturnType<typeof validateAssetPackManifest>): string {
  return result.issues.map((issue) => issue.message).join("\n");
}

describe("asset pack import readiness fixtures", () => {
  it("validates user and imported override pack fixtures without installing them", () => {
    const user = createUserOverridePackManifestFixture();
    const imported = createImportedPackManifestFixture();

    assert.equal(validateAssetPackManifest(user).status, "valid", messages(validateAssetPackManifest(user)));
    assert.equal(validateAssetPackManifest(imported).status, "valid", messages(validateAssetPackManifest(imported)));
    assert.equal("installStatus" in user, false);
    assert.equal("installStatus" in imported, false);
  });

  it("represents system.foundation dependency declaratively", () => {
    const manifest = createImportedPackManifestFixture();
    const dependency = manifest.dependencies?.[0];

    assert.equal(dependency?.packId, "system.foundation");
    assert.equal(dependency?.versionRange, "^1.0.0");
    assert.equal("install" in (dependency ?? {}), false);
    assert.equal("registry" in (dependency ?? {}), false);
  });

  it("targets a system foundation definition and replaces it with a fixture-local definition", () => {
    const system = createSystemFoundationManifestFixture();
    const manifest = createImportedPackManifestFixture();
    const rule = manifest.overrideRules?.[0];

    assert.ok(rule);
    assert.equal(rule.targetRef.id, system.assets[0]?.definitionRef.id);
    assert.equal(
      manifest.assets.some((entry) => entry.definitionRef.id === rule.replacementRef.id),
      true,
    );
    assert.notEqual(rule.replacementRef.id, rule.targetRef.id);
  });

  it("can represent future conflicting override candidates without applying activation behavior", () => {
    const manifest = createConflictingOverridePackManifestFixture();

    assert.equal(validateAssetPackManifest(manifest).status, "valid");
    assert.equal(manifest.overrideRules?.length, 2);
    assert.equal(manifest.overrideRules?.[0]?.priority, manifest.overrideRules?.[1]?.priority);
    assert.equal(serialized(manifest).includes("installstatus"), false);
    assert.equal(serialized(manifest).includes("activation"), false);
  });

  it("rejects unsafe imported pack metadata and unsafe override rule metadata", () => {
    const unsafePack = validateAssetPackManifest(createUnsafePackManifestFixture());
    const unsafeRuleManifest: AssetPackManifest = {
      ...createImportedPackManifestFixture(),
      overrideRules: [
        {
          ...createImportedPackManifestFixture().overrideRules![0]!,
          metadata: {
            token: "token=hidden",
          },
        },
      ],
    };
    const unsafeRule = validateAssetPackManifest(unsafeRuleManifest);

    assert.equal(unsafePack.status, "invalid");
    assert.equal(unsafeRule.status, "invalid");
    assert.match(messages(unsafePack), /unsafe/i);
    assert.match(messages(unsafeRule), /unsafe/i);
  });

  it("keeps imported pack fixtures descriptor-only and free of unsafe share payloads", () => {
    const manifest = createImportedPackManifestFixture();

    assertNoUnsafeSharingPayload(manifest);
    assert.equal("resourceBytes" in manifest, false);
    assert.equal("bytes" in manifest, false);
    assert.equal("localPath" in manifest, false);
    assert.equal("providerPayload" in manifest, false);
    assert.equal("workflowJson" in manifest, false);
    assert.equal("executionCode" in manifest, false);
  });

  it("does not imply public product behavior, install behavior, activation behavior, marketplace, or registry behavior", () => {
    const manifest = createImportedPackManifestFixture();
    const output = serialized(manifest);

    for (const forbidden of [
      "installstatus",
      "activepack",
      "activate",
      "deactivate",
      "marketplace",
      "package registry",
      "package manager",
      "archive",
      "signature",
      "download",
    ]) {
      assert.equal(output.includes(forbidden), false, forbidden);
    }
  });
});
