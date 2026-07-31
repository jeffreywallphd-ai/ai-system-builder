import * as assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import {
  ASSET_PACK_INSTALL_STATUSES,
  ASSET_PACK_SOURCE_KINDS,
  ASSET_PACK_TRUST_STATUSES,
  ASSET_RESOLUTION_MODES,
  ASSET_SOURCE_LAYERS,
  isAssetPackId,
  normalizeAssetPackId,
  type AssetDefinition,
  type AssetPackAssetEntry,
  type AssetPackCompatibility,
  type AssetPackDependency,
  type AssetPackManifest,
  type AssetPackOverrideRule,
  type AssetReference,
  type AssetResolutionRequest,
  type AssetResolutionResult,
} from "..";

const systemDefinitionRef: AssetReference = {
  kind: "asset-definition-version",
  id: "builtin.artifact" as never,
  version: "1.0.0",
};

const replacementDefinitionRef: AssetReference = {
  kind: "asset-definition",
  id: "workspace.artifact" as never,
};

const systemDefinition: AssetDefinition = {
  definitionId: "builtin.artifact" as never,
  assetType: "data-source",
  assetFamily: "resource-backed",
  version: "1.0.0",
  displayName: "Artifact",
  description: "Descriptor-only artifact asset definition.",
  lifecycleStatus: "published",
  reviewStatus: "approved",
  provenance: {
    sourceKind: "system-generated",
    authorship: "human-authored",
  },
  metadata: {
    safeCatalog: "system-foundation",
  },
};

const systemEntry: AssetPackAssetEntry = {
  entryId: "system.foundation.entry.artifact",
  definition: systemDefinition,
  definitionRef: systemDefinitionRef,
  category: "resource-backed",
  sourceLayer: "system-default",
  fingerprint: "sha256.foundation-artifact",
  tags: ["foundation", "resource-backed"],
  metadata: {
    descriptorOnly: true,
  },
};

const compatibility: AssetPackCompatibility = {
  schemaVersion: "asset-pack-compatibility.v1",
  assetKernelVersion: "5.0.0",
  requiresAssetTypes: ["data-source"],
  requiresAssetFamilies: ["resource-backed"],
  requiresCapabilities: ["asset-kernel.contracts"],
};

const dependency: AssetPackDependency = {
  packId: normalizeAssetPackId("system.foundation"),
  versionRange: "^1.0.0",
  optional: true,
  reason: "Shares foundation semantics.",
};

const overrideRule: AssetPackOverrideRule = {
  ruleId: "workspace.artifact.override",
  targetRef: { kind: "asset-definition", id: "builtin.artifact" as never },
  replacementRef: replacementDefinitionRef,
  scope: "workspace",
  sourceLayer: "workspace-pack",
  priority: 10,
  enabled: true,
  conflictPolicy: "prefer-replacement",
  reason: "Use workspace-specific artifact semantics.",
  createdByPackRef: {
    packId: normalizeAssetPackId("workspace.foundation"),
    version: "1.0.0",
  },
  metadata: {
    nonDestructive: true,
  },
};

function systemFoundationManifest(): AssetPackManifest {
  return {
    schemaVersion: "asset-pack-manifest.v1",
    packId: normalizeAssetPackId("system.foundation"),
    version: "1.0.0",
    displayName: "System Foundation",
    description: "System-owned descriptor pack for foundational Asset Kernel defaults.",
    publisher: "ai-system-builder",
    license: {
      kind: "internal",
      name: "Internal system use",
    },
    sourceKind: "system",
    sourceLayer: "system-default",
    trustStatus: "system-trusted",
    compatibility,
    dependencies: [dependency],
    assets: [systemEntry],
    overrideRules: [],
    tags: ["foundation", "system"],
    categories: ["resource-backed"],
    checksum: "sha256.foundation-pack",
    createdAt: "2026-05-09T00:00:00.000Z",
    updatedAt: "2026-05-09T00:00:00.000Z",
    metadata: {
      declarativeOnly: true,
    },
  };
}

function assertJsonSerializable(value: unknown): void {
  assert.deepEqual(JSON.parse(JSON.stringify(value)), value);
}

function serialized(value: unknown): string {
  return JSON.stringify(value).toLowerCase();
}

function assertSafeFixture(value: unknown): void {
  const output = serialized(value);
  for (const unsafe of [
    "c:\\",
    "/tmp",
    "/home",
    "bearer",
    "token",
    "password",
    "secret",
    "signedurl",
    "rawpayload",
    "providerpayload",
    "bytes",
    "blob",
    "base64",
    "data:",
    "workflowjson",
    "resourcecontent",
    "modelcontent",
    "datasetcontent",
    "documentcontent",
  ]) {
    assert.equal(output.includes(unsafe), false, `fixture included ${unsafe}: ${output}`);
  }
}

describe("asset pack manifest contracts", () => {
  it("can represent a system foundation pack without creating an installed-pack record", () => {
    const manifest = systemFoundationManifest();

    assert.equal(manifest.packId, "system.foundation");
    assert.equal(manifest.sourceKind, "system");
    assert.equal(manifest.sourceLayer, "system-default");
    assert.equal(manifest.trustStatus, "system-trusted");
    assert.equal("installStatus" in manifest, false);
    assert.equal("registryUrl" in manifest, false);
    assert.equal("marketplace" in manifest, false);
  });

  it("can include full AssetDefinition entries alongside definition refs", () => {
    const manifest = systemFoundationManifest();
    const entry = manifest.assets[0];

    assert.deepEqual(entry?.definition, systemDefinition);
    assert.deepEqual(entry?.definitionRef, systemDefinitionRef);
    assert.equal(entry?.definition.definitionId, entry?.definitionRef.id);
    assert.equal(entry?.definition.version, entry?.definitionRef.version);
    assert.equal("resourceBytes" in entry, false);
    assert.equal("rendererFile" in entry, false);
    assert.equal("executionCode" in entry, false);
  });

  it("is JSON-serializable and keeps sample metadata safe", () => {
    const manifest = systemFoundationManifest();

    assertJsonSerializable(manifest);
    assertSafeFixture(manifest);
  });

  it("uses namespaced pack IDs instead of paths, URLs, or manifest file names", () => {
    for (const valid of [
      "system.foundation",
      "system.foundation.ui",
      "org.example.dashboard-kit",
      "user.my-ui-overrides",
      "community.healthcare-forms",
    ]) {
      assert.equal(isAssetPackId(valid), true, valid);
      assert.equal(normalizeAssetPackId(` ${valid} `), valid);
    }

    for (const invalid of [
      "",
      "   ",
      "/tmp/system.foundation",
      "./system.foundation",
      "../system.foundation",
      "C:\\system\\foundation",
      "https://example.test/system.foundation",
      "org/example/dashboard-kit",
      "system foundation",
      "foundation.json",
    ]) {
      assert.equal(isAssetPackId(invalid), false, invalid);
    }
  });

  it("declares source kinds, source layers, trust statuses, and install vocabulary narrowly", () => {
    assert.deepEqual([...ASSET_PACK_SOURCE_KINDS], [
      "system",
      "workspace",
      "organization",
      "user",
      "imported",
      "community",
      "external",
    ]);
    assert.deepEqual([...ASSET_SOURCE_LAYERS], [
      "system-default",
      "installed-pack",
      "workspace-pack",
      "organization-override",
      "user-override",
      "imported-pack",
    ]);
    assert.deepEqual([...ASSET_PACK_TRUST_STATUSES], [
      "system-trusted",
      "trusted",
      "unverified",
      "restricted",
      "blocked",
    ]);
    assert.deepEqual([...ASSET_PACK_INSTALL_STATUSES], [
      "cataloged",
      "installed",
      "active",
      "disabled",
      "blocked",
      "removed",
    ]);
    assert.equal("install" in ASSET_PACK_INSTALL_STATUSES, false);
  });

  it("keeps dependency and compatibility declarations declarative only", () => {
    assertJsonSerializable({ compatibility, dependency });
    assert.deepEqual(compatibility.requiresAssetTypes, ["data-source"]);
    assert.deepEqual(compatibility.requiresAssetFamilies, ["resource-backed"]);
    assert.equal("probe" in compatibility, false);
    assert.equal("hostCheck" in compatibility, false);
    assert.equal("install" in dependency, false);
    assert.equal("registry" in dependency, false);
    assertSafeFixture({ compatibility, dependency });
  });
});

describe("asset pack override and resolution contracts", () => {
  it("maps targetRef to replacementRef without destructively overwriting definitions", () => {
    const before = structuredClone(systemDefinition);

    assert.deepEqual(overrideRule.targetRef, {
      kind: "asset-definition",
      id: "builtin.artifact",
    });
    assert.deepEqual(overrideRule.replacementRef, replacementDefinitionRef);
    assert.equal("definition" in overrideRule, false);
    assert.equal("mutatedDefinition" in overrideRule, false);
    assert.equal("overwrite" in overrideRule, false);
    assert.deepEqual(systemDefinition, before);
  });

  it("includes scope, source layer, priority, enabled flag, and conflict policy", () => {
    assert.equal(overrideRule.scope, "workspace");
    assert.equal(overrideRule.sourceLayer, "workspace-pack");
    assert.equal(overrideRule.priority, 10);
    assert.equal(overrideRule.enabled, true);
    assert.equal(overrideRule.conflictPolicy, "prefer-replacement");
    assertJsonSerializable(overrideRule);
    assertSafeFixture(overrideRule);
  });

  it("represents exact and semantic resolution modes with override intent", () => {
    assert.deepEqual([...ASSET_RESOLUTION_MODES], [
      "exact",
      "semantic",
      "compatible",
      "latest-active",
    ]);

    const exactRequest: AssetResolutionRequest = {
      requestedRef: systemDefinitionRef,
      mode: "exact",
      allowOverrides: false,
      includeTrace: true,
    };
    const semanticRequest: AssetResolutionRequest = {
      requestedRef: { kind: "asset-definition", id: "builtin.artifact" as never },
      mode: "semantic",
      scope: "workspace",
      sourceLayerPreference: ["workspace-pack", "system-default"],
      allowOverrides: true,
      includeTrace: true,
    };

    assert.equal(exactRequest.requestedRef.kind, "asset-definition-version");
    assert.equal(exactRequest.allowOverrides, false);
    assert.equal(semanticRequest.requestedRef.kind, "asset-definition");
    assert.equal(semanticRequest.allowOverrides, true);
    assertJsonSerializable({ exactRequest, semanticRequest });
  });

  it("can carry resolution trace, diagnostics, and conflicts without resolver behavior", () => {
    const result: AssetResolutionResult = {
      requestedRef: { kind: "asset-definition", id: "builtin.artifact" as never },
      resolvedRef: replacementDefinitionRef,
      resolvedDefinition: { ...systemDefinition, definitionId: "workspace.artifact" as never },
      appliedOverrideRuleIds: [overrideRule.ruleId],
      trace: [
        {
          stepId: "resolution.step.lookup",
          message: "Matched semantic reference and noted an override rule.",
          inputRef: overrideRule.targetRef,
          outputRef: overrideRule.replacementRef,
          sourceLayer: "workspace-pack",
          appliedOverrideRuleId: overrideRule.ruleId,
        },
      ],
      diagnostics: [
        {
          severity: "info",
          code: "override-applied",
          message: "Replacement reference selected by declarative override rule.",
          ref: replacementDefinitionRef,
        },
      ],
      conflicts: [
        {
          conflictId: "resolution.conflict.workspace-artifact",
          targetRef: overrideRule.targetRef,
          candidateRefs: [systemDefinitionRef, replacementDefinitionRef],
          overrideRuleIds: [overrideRule.ruleId],
          message: "Multiple candidates were available for future resolver policy.",
        },
      ],
    };

    assertJsonSerializable(result);
    assert.equal(result.trace.length, 1);
    assert.equal(result.diagnostics[0]?.severity, "info");
    assert.equal(result.conflicts[0]?.candidateRefs.length, 2);
    assertSafeFixture(result);
  });
});

describe("asset pack contract boundaries", () => {
  it("does not import application services, adapters, hosts, transports, UI, runtime, storage, providers, filesystem, or network modules", () => {
    const assetDir = join(process.cwd(), "modules/contracts/asset");
    const files = readdirSync(assetDir)
      .filter((file) => (file.includes("pack") || file.includes("resolution") || file === "asset-source-layer.ts"))
      .filter((file) => file.endsWith(".ts"));

    for (const file of files) {
      const source = readFileSync(join(assetDir, file), "utf8");
      for (const forbidden of [
        "modules/application",
        "../../../application",
        "modules/adapters",
        "../../../adapters",
        "modules/hosts",
        "../../../hosts",
        "contracts/api",
        "contracts/ipc",
        "electron",
        "express",
        "preload",
        "renderer",
        "thin-client",
        "modules/ui",
        "../../../ui",
        "contracts/runtime",
        "../../runtime",
        "contracts/storage",
        "../../storage",
        "contracts/persistence",
        "../../persistence",
        "@huggingface",
        "openai",
        "fetch(",
        "node:fs",
        "node:path",
      ]) {
        assert.equal(source.includes(forbidden), false, `${file} imports or references ${forbidden}`);
      }
    }
  });

  it("keeps sample manifests free of unsafe content, resource payloads, and marketplace behavior", () => {
    const manifest = systemFoundationManifest();
    const output = serialized(manifest);

    assertSafeFixture(manifest);
    for (const forbidden of [
      "public marketplace",
      "registry publish",
      "remote package",
      "package install",
      "plugin install",
      "package manager",
      "signed archive",
      "resource bytes",
      "renderer implementation",
      "workflow json",
    ]) {
      assert.equal(output.includes(forbidden), false, forbidden);
    }
  });
});
