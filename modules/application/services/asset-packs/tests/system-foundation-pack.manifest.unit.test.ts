import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { AssetPackOverrideRule } from "../../../../contracts/asset";
import { validateAssetDefinition } from "../../asset/validate-asset-definition.service";
import { runAssetPackQualityGates } from "../asset-pack-quality-gates.service";
import { validateAssetPackManifest } from "../asset-pack-validation.service";
import {
  DISPLAY_PRIMITIVE_ENTRIES,
  SYSTEM_FOUNDATION_PACK_CATEGORIES,
  SYSTEM_FOUNDATION_PACK_CATEGORY_IDS,
  SYSTEM_FOUNDATION_PACK_MANIFEST,
  SYSTEM_FOUNDATION_PACK_SOURCE_LAYER,
  FORM_PRIMITIVE_ENTRIES,
  FUNCTIONAL_DEFAULT_ENTRIES,
  SHELL_PRIMITIVE_ENTRIES,
  CONVERSATION_ASSET_ENTRIES,
  UI_STRUCTURAL_PRIMITIVE_ENTRIES,
} from "../system-packs";

function serialized(value: unknown): string {
  return JSON.stringify(value).toLowerCase();
}

const expectedCategoryGroups = [
  "ui-structure",
  "forms-fields",
  "data-display",
  "state-messages",
  "page-feature-shells",
  "workflow-system-shells",
  "conversational-systems",
  "data-modeling",
  "security-policy",
  "artifact-preview",
  "ai-context",
  "logic-workflow",
  "test-observability",
  "reference-features",
] as const;

describe("system foundation pack manifest", () => {
  it("declares the system foundation placeholder pack identity and source metadata", () => {
    assert.equal(SYSTEM_FOUNDATION_PACK_MANIFEST.packId, "system.foundation");
    assert.equal(SYSTEM_FOUNDATION_PACK_MANIFEST.version, "1.0.0");
    assert.equal(SYSTEM_FOUNDATION_PACK_MANIFEST.sourceKind, "system");
    assert.equal(SYSTEM_FOUNDATION_PACK_MANIFEST.sourceLayer, "system-default");
    assert.equal(SYSTEM_FOUNDATION_PACK_MANIFEST.trustStatus, "system-trusted");
  });

  it("contains the expected categories, UI structural, form, display, state, message, and shell primitive assets", () => {
    assert.deepEqual(
      SYSTEM_FOUNDATION_PACK_MANIFEST.categories,
      expectedCategoryGroups,
    );
    assert.deepEqual(SYSTEM_FOUNDATION_PACK_CATEGORY_IDS, expectedCategoryGroups);
    assert.deepEqual(
      SYSTEM_FOUNDATION_PACK_MANIFEST.assets.map((entry) => entry.entryId),
      [
        ...UI_STRUCTURAL_PRIMITIVE_ENTRIES,
        ...FORM_PRIMITIVE_ENTRIES,
        ...DISPLAY_PRIMITIVE_ENTRIES,
        ...SHELL_PRIMITIVE_ENTRIES,
        ...CONVERSATION_ASSET_ENTRIES,
        ...FUNCTIONAL_DEFAULT_ENTRIES,
      ].map((entry) => entry.entryId),
    );
    assert.equal(
      UI_STRUCTURAL_PRIMITIVE_ENTRIES.every((entry) =>
        SYSTEM_FOUNDATION_PACK_MANIFEST.assets.includes(entry),
      ),
      true,
    );
    assert.equal(
      FORM_PRIMITIVE_ENTRIES.every((entry) =>
        SYSTEM_FOUNDATION_PACK_MANIFEST.assets.includes(entry),
      ),
      true,
    );
    assert.equal(
      DISPLAY_PRIMITIVE_ENTRIES.every((entry) =>
        SYSTEM_FOUNDATION_PACK_MANIFEST.assets.includes(entry),
      ),
      true,
    );
    assert.equal(
      SHELL_PRIMITIVE_ENTRIES.every((entry) =>
        SYSTEM_FOUNDATION_PACK_MANIFEST.assets.includes(entry),
      ),
      true,
    );
    assert.equal(
      CONVERSATION_ASSET_ENTRIES.every((entry) =>
        SYSTEM_FOUNDATION_PACK_MANIFEST.assets.includes(entry),
      ),
      true,
    );
    assert.deepEqual(SYSTEM_FOUNDATION_PACK_MANIFEST.dependencies, []);
    assert.deepEqual(SYSTEM_FOUNDATION_PACK_MANIFEST.overrideRules, []);
  });

  it("uses stable manifest metadata without phase or prompt workflow labels", () => {
    assert.deepEqual(SYSTEM_FOUNDATION_PACK_MANIFEST.metadata, {
      declarativeOnly: true,
      catalogKind: "system-foundation",
      catalogStatus: "functional",
      catalogVersion: "1.0.0",
      categoryCount: SYSTEM_FOUNDATION_PACK_CATEGORIES.length,
      containsDefinitions: true,
    });

    const output = serialized(SYSTEM_FOUNDATION_PACK_MANIFEST.metadata);
    for (const forbidden of [
      "phase-5-prompt-5",
      "prompt-4",
      "prompt-5",
      "review-a",
      "phase 5",
      "phase-5",
    ]) {
      assert.equal(output.includes(forbidden), false, forbidden);
    }
  });

  it("keeps manifest category IDs backed by catalog-side descriptors", () => {
    const descriptorIds = new Set<string>(
      SYSTEM_FOUNDATION_PACK_CATEGORIES.map((category) => category.categoryId),
    );
    for (const categoryId of SYSTEM_FOUNDATION_PACK_MANIFEST.categories ?? []) {
      assert.equal(descriptorIds.has(categoryId), true, categoryId);
    }
    for (const entry of SYSTEM_FOUNDATION_PACK_MANIFEST.assets) {
      assert.equal(
        SYSTEM_FOUNDATION_PACK_MANIFEST.categories?.includes(entry.category),
        true,
        entry.category,
      );
      assert.equal(descriptorIds.has(entry.category), true, entry.category);
    }
  });

  it("keeps entry IDs, definition refs, and fingerprints unique and stable", () => {
    const entryIds = new Set<string>();
    const refKeys = new Set<string>();
    const fingerprints = new Set<string>();

    for (const entry of SYSTEM_FOUNDATION_PACK_MANIFEST.assets) {
      assert.ok(
        [
          "ui-structure",
          "forms-fields",
          "data-display",
          "state-messages",
          "page-feature-shells",
          "workflow-system-shells",
          "conversational-systems",
          "data-modeling",
          "security-policy",
          "artifact-preview",
          "ai-context",
          "logic-workflow",
          "test-observability",
          "reference-features",
        ].includes(entry.category),
      );
      assert.equal(entry.sourceLayer, SYSTEM_FOUNDATION_PACK_SOURCE_LAYER);
      assert.match(entry.entryId, /^system\.foundation\.[a-z0-9.-]+$/);
      assert.match(entry.fingerprint, /^fnv1a:[a-f0-9]{8}$/);
      assert.equal(entryIds.has(entry.entryId), false, entry.entryId);
      assert.equal(refKeys.has(`${entry.definitionRef.id}@${entry.definitionRef.version}`), false);
      assert.equal(fingerprints.has(entry.fingerprint), false, entry.fingerprint);
      entryIds.add(entry.entryId);
      refKeys.add(`${entry.definitionRef.id}@${entry.definitionRef.version}`);
      fingerprints.add(entry.fingerprint);
    }
  });

  it("has no duplicate display names within a category", () => {
    const displayNamesByCategory = new Map<string, Set<string>>();
    for (const entry of SYSTEM_FOUNDATION_PACK_MANIFEST.assets) {
      const displayNames = displayNamesByCategory.get(entry.category) ?? new Set<string>();
      const displayName = String(entry.definition.displayName).toLowerCase();
      assert.equal(displayNames.has(displayName), false, `${entry.category}:${displayName}`);
      displayNames.add(displayName);
      displayNamesByCategory.set(entry.category, displayNames);
    }
  });

  it("requires source pack and category metadata on every entry", () => {
    for (const entry of SYSTEM_FOUNDATION_PACK_MANIFEST.assets) {
      const sourcePack = entry.metadata?.sourcePack as
        | { readonly packId?: string; readonly version?: string }
        | undefined;
      assert.equal(sourcePack?.packId, "system.foundation", entry.entryId);
      assert.equal(sourcePack?.version, "1.0.0", entry.entryId);
      assert.equal(entry.metadata?.categoryId, entry.category, entry.entryId);
      assert.equal(entry.definition.metadata?.categoryId, entry.category, entry.entryId);
      assert.equal(entry.definition.metadata?.sourcePackId, "system.foundation", entry.entryId);
      assert.equal(entry.definition.metadata?.sourcePackVersion, "1.0.0", entry.entryId);
      assert.equal(entry.definition.provenance.metadata?.categoryId, entry.category, entry.entryId);
    }
  });

  it("contains only safe tags and metadata values", () => {
    for (const entry of SYSTEM_FOUNDATION_PACK_MANIFEST.assets) {
      for (const tag of entry.tags ?? []) {
        assert.match(tag, /^[a-z0-9][a-z0-9-]{1,39}$/, `${entry.entryId}:${tag}`);
      }
      const metadata = serialized({
        entryMetadata: entry.metadata,
        definitionMetadata: entry.definition.metadata,
        provenanceMetadata: entry.definition.provenance.metadata,
      });
      for (const forbidden of [
        "token",
        "secret",
        "password",
        "signedurl",
        "providerpayload",
        "rawpayload",
        "resourcebytes",
        "resourcecontent",
        "localpath",
        "filesystempath",
        "filepath",
        "base64",
        "workflowjson",
        "prompttext",
        "executioncode",
      ]) {
        assert.equal(metadata.includes(forbidden), false, `${entry.entryId}:${forbidden}`);
      }
    }
  });

  it("contains no implementation, editor, route, runtime, provider, storage, or workflow engine leakage", () => {
    const output = serialized(SYSTEM_FOUNDATION_PACK_MANIFEST);
    for (const forbidden of [
      "react",
      "vue",
      "svelte",
      "tsx",
      "jsx",
      "css module",
      "renderer file",
      "component path",
      "implementation path",
      "dom node",
      "routepath",
      "apiendpoint",
      "ipcchannel",
      "workflowjson",
      "schedulerconfig",
      "queue name",
      "taskid",
      "providerpayload",
      "rawpayload",
      "storage path",
      "filesystem path",
      "visual composition editor",
      "canvas authoring",
      "wizard authoring",
    ]) {
      assert.equal(output.includes(forbidden), false, forbidden);
    }
  });

  it("declares no runtime, provider, network, storage, filesystem, or resource requirements", () => {
    for (const entry of SYSTEM_FOUNDATION_PACK_MANIFEST.assets) {
      for (const requirement of entry.definition.requirements ?? []) {
        assert.notEqual(requirement.requirementKind, "runtime-capability", entry.entryId);
        assert.notEqual(requirement.requirementKind, "network-access", entry.entryId);
        assert.notEqual(requirement.requirementKind, "filesystem-access", entry.entryId);
        assert.notEqual(requirement.requirementKind, "secret-access", entry.entryId);
        assert.notEqual(requirement.requirementKind, "external-provider", entry.entryId);
        assert.notEqual(requirement.requirementKind, "resource", entry.entryId);
        assert.notEqual(requirement.requirementKind, "artifact", entry.entryId);
        assert.equal(requirement.permissionKind, undefined, entry.entryId);
      }
    }
  });

  it("is JSON-serializable and validates through the pack validator", () => {
    const cloned = JSON.parse(JSON.stringify(SYSTEM_FOUNDATION_PACK_MANIFEST));
    assert.deepEqual(cloned, SYSTEM_FOUNDATION_PACK_MANIFEST);
    assert.equal(validateAssetPackManifest(SYSTEM_FOUNDATION_PACK_MANIFEST).status, "valid");
  });

  it("passes quality gates and asset definition validation for every entry", () => {
    for (const entry of SYSTEM_FOUNDATION_PACK_MANIFEST.assets) {
      assert.equal(validateAssetDefinition(entry.definition).status, "valid", entry.entryId);
      const quality = runAssetPackQualityGates(entry);
      assert.equal(quality.status, "valid", `${entry.entryId}\n${quality.issues.map((issue) => issue.message).join("\n")}`);
    }
  });

  it("keeps every entry resolver and override ready without mutating system defaults", () => {
    const seenDefinitionIds = new Set<string>();
    for (const entry of SYSTEM_FOUNDATION_PACK_MANIFEST.assets) {
      const sourcePack = entry.metadata?.sourcePack as
        | { readonly packId?: string; readonly version?: string }
        | undefined;
      assert.equal(entry.definitionRef.kind, "asset-definition-version", entry.entryId);
      assert.equal(entry.definitionRef.id, entry.definition.definitionId, entry.entryId);
      assert.equal(entry.definitionRef.version, entry.definition.version, entry.entryId);
      assert.equal(entry.sourceLayer, "system-default", entry.entryId);
      assert.equal(sourcePack?.packId, "system.foundation", entry.entryId);
      assert.equal(sourcePack?.version, "1.0.0", entry.entryId);
      assert.match(entry.fingerprint, /^fnv1a:[a-f0-9]{8}$/, entry.entryId);
      assert.match(String(entry.definition.definitionId), /^(?:builtin|conversation)\.[a-z0-9.-]+$/, entry.entryId);
      if (String(entry.definition.definitionId).startsWith("conversation.")) {
        assert.equal(entry.metadata?.derivedComposite, true, entry.entryId);
        assert.equal(entry.metadata?.lineage, "foundation-referenced", entry.entryId);
      }
      assert.equal(seenDefinitionIds.has(String(entry.definition.definitionId)), false, entry.entryId);
      seenDefinitionIds.add(String(entry.definition.definitionId));
    }
    assert.deepEqual(SYSTEM_FOUNDATION_PACK_MANIFEST.overrideRules, []);
    assert.deepEqual(SYSTEM_FOUNDATION_PACK_MANIFEST.dependencies, []);
  });

  it("can express a future override rule targeting a foundation definition ref without changing the original", () => {
    const targetEntry = SYSTEM_FOUNDATION_PACK_MANIFEST.assets[0];
    assert.ok(targetEntry);
    const original = JSON.parse(JSON.stringify(targetEntry));
    const replacementRef = {
      kind: "asset-definition-version",
      id: "workspace.override.fixture" as never,
      version: "1.0.0",
      label: "Workspace Override Fixture",
    } as const;
    const overrideRule: AssetPackOverrideRule = {
      ruleId: "workspace.override.fixture-rule",
      targetRef: targetEntry.definitionRef,
      replacementRef,
      scope: "workspace",
      sourceLayer: "workspace-pack",
      priority: 100,
      enabled: true,
      conflictPolicy: "prefer-replacement",
      reason: "Fixture demonstrates future non-mutating override targeting.",
      createdByPackRef: {
        packId: "workspace.fixture" as never,
        version: "1.0.0",
      },
      metadata: {
        fixtureOnly: true,
        mutatesOriginal: false,
      },
    };

    assert.equal(overrideRule.targetRef, targetEntry.definitionRef);
    assert.notDeepEqual(overrideRule.replacementRef, targetEntry.definitionRef);
    assert.deepEqual(targetEntry, original);
  });

  it("does not contain unsafe values or imply install and activation behavior", () => {
    const output = serialized(SYSTEM_FOUNDATION_PACK_MANIFEST);
    for (const forbidden of [
      "token",
      "secret",
      "password",
      "signedurl",
      "providerpayload",
      "resource bytes",
      "local path",
      "renderer implementation",
      "workflow json",
      "form submission execution",
      "validation engine execution",
      "file upload/storage writes",
      "installstatus",
      "marketplace",
      "package manager",
      "installstatus",
    ]) {
      assert.equal(output.includes(forbidden), false, forbidden);
    }
    assert.doesNotMatch(output, /\bactivate\b|\bdisable\b/);
  });
});
