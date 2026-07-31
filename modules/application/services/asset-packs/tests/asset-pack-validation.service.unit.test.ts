import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type {
  AssetDefinition,
  AssetPackAssetEntry,
  AssetPackManifest,
  AssetPackOverrideRule,
  AssetReference,
} from "../../../../contracts/asset";
import { normalizeAssetPackId } from "../../../../contracts/asset";
import { createSystemFoundationPackManifest } from "../asset-pack-manifest-builder.service";
import { validateAssetPackManifest } from "../asset-pack-validation.service";
import { SYSTEM_FOUNDATION_PACK_MANIFEST } from "../system-packs";

describe("asset pack validation service", () => {
  it("passes the valid empty system foundation manifest", () => {
    const result = validateAssetPackManifest(SYSTEM_FOUNDATION_PACK_MANIFEST);
    assert.equal(result.status, "valid");
    assert.deepEqual(result.issues, []);
  });

  it("fails unsafe pack identity and invalid pack version", () => {
    const result = validateAssetPackManifest({
      ...SYSTEM_FOUNDATION_PACK_MANIFEST,
      packId: "../bad" as never,
      version: "version",
    });

    assert.equal(result.status, "invalid");
    assert.match(messages(result), /pack ID/i);
    assert.match(messages(result), /version/i);
  });

  it("fails duplicate category, entry ID, and definition ref values", () => {
    const entry = validEntry();
    const result = validateAssetPackManifest({
      ...createSystemFoundationPackManifest([entry, { ...entry }]),
      categories: ["ui-structure", "ui-structure"],
    });

    assert.equal(result.status, "invalid");
    assert.match(messages(result), /Category IDs must be unique/i);
    assert.match(messages(result), /entry IDs must be unique/i);
    assert.match(messages(result), /definition refs must be unique/i);
  });

  it("fails when a full definition does not match its definitionRef", () => {
    const result = validateAssetPackManifest(
      createSystemFoundationPackManifest([
        validEntry({
          definitionRef: {
            kind: "asset-definition-version",
            id: "system.foundation.other" as never,
            version: "1.0.0",
          },
        }),
      ]),
    );

    assert.equal(result.status, "invalid");
    assert.match(messages(result), /definitionRef ID must match/i);
  });

  it("fails unsafe manifest, entry, and dependency metadata", () => {
    const manifest = createSystemFoundationPackManifest([validEntry({
      metadata: { sourcePack: { packId: "system.foundation", version: "1.0.0" }, token: "abc" },
    })]);
    const result = validateAssetPackManifest({
      ...manifest,
      metadata: { apiKey: "abc" },
      dependencies: [
        {
          packId: normalizeAssetPackId("system.other"),
          versionRange: "^1.0.0",
          reason: "token=abc",
        },
      ],
    });

    assert.equal(result.status, "invalid");
    assert.match(messages(result), /unsafe/i);
  });

  it("allows explanatory non-goal language in AI context and docs-like descriptions", () => {
    const entry = validEntry({
      definition: validDefinition({
        description:
          "Avoid renderer implementation details. Does not include prompt text.",
        aiContext: {
          ...validDefinition().aiContext,
          purpose:
            "Does not run workflows, does not store resource bytes, and does not contain workflow JSON.",
          limitations: [
            {
              limitationId: "fixture.limitation",
              summary: "No runtime execution occurs.",
            },
            {
              limitationId: "fixture.prompt-text",
              summary: "Does not include prompt text.",
            },
          ],
          safetyNotes: [
            {
              safetyNoteId: "fixture.safety",
              category: "operational",
              severity: "info",
              summary: "Does not store resource bytes.",
            },
          ],
          antiPatterns: [
            {
              antiPatternId: "fixture.anti-pattern",
              title: "Renderer implementation leakage",
              description: "Avoid renderer implementation details.",
              whyAvoid: "The pack remains semantic only.",
              saferAlternative: "Keep implementation choices outside the pack.",
            },
          ],
        },
      }),
    });

    const result = validateAssetPackManifest(createSystemFoundationPackManifest([entry]));

    assert.equal(result.status, "valid", messages(result));
  });

  it("still rejects unsafe payload, path, token, provider, content, and execution fields", () => {
    const unsafeManifests: readonly AssetPackManifest[] = [
      {
        ...createSystemFoundationPackManifest(),
        metadata: { note: "C:\\Users\\alice\\secret.txt" },
      },
      {
        ...createSystemFoundationPackManifest(),
        metadata: { note: "/tmp/asset-cache/value.json" },
      },
      {
        ...createSystemFoundationPackManifest(),
        metadata: { token: "abc" },
      },
      {
        ...createSystemFoundationPackManifest(),
        metadata: { authorization: "Bearer abc" },
      },
      {
        ...createSystemFoundationPackManifest(),
        metadata: {
          download:
            "https://example.test/object?X-Amz-Signature=abc&expires=999",
        },
      },
      createSystemFoundationPackManifest([
        validEntry({
          definition: validDefinition({
            metadata: {
              rawProviderPayload: { provider: "example" },
            } as never,
          }),
        }),
      ]),
      createSystemFoundationPackManifest([
        validEntry({
          definition: validDefinition({
            metadata: {
              workflowJson: { nodes: [] },
            } as never,
          }),
        }),
      ]),
      createSystemFoundationPackManifest([
        validEntry({
          definition: validDefinition({
            metadata: {
              promptText: "write a system",
            } as never,
          }),
        }),
      ]),
      createSystemFoundationPackManifest([
        validEntry({
          definition: validDefinition({
            metadata: {
              executionCode: "console.log('run')",
            } as never,
          }),
        }),
      ]),
      createSystemFoundationPackManifest([
        validEntry({
          definition: validDefinition({
            metadata: {
              preview: "data:text/plain;base64,SGVsbG8=",
            },
          }),
        }),
      ]),
    ];

    for (const manifest of unsafeManifests) {
      const result = validateAssetPackManifest(manifest);
      assert.equal(result.status, "invalid", JSON.stringify(manifest));
      assert.match(messages(result), /unsafe/i);
    }
  });

  it("fails invalid override rules", () => {
    const ref = definitionRef("system.foundation.fixture");
    const overrideRule: AssetPackOverrideRule = {
      ruleId: "system.foundation.override.fixture",
      targetRef: ref,
      replacementRef: ref,
      scope: "workspace",
      sourceLayer: "workspace-pack",
      priority: 1,
      enabled: true,
      conflictPolicy: "prefer-replacement",
    };

    const result = validateAssetPackManifest(
      createSystemFoundationPackManifest([], [overrideRule]),
    );

    assert.equal(result.status, "invalid");
    assert.match(messages(result), /distinct replacement/i);
  });

  it("validates full asset definitions through the existing definition validator", () => {
    const result = validateAssetPackManifest(
      createSystemFoundationPackManifest([
        validEntry({ definition: validDefinition({ displayName: "" }) }),
      ]),
    );

    assert.equal(result.status, "invalid");
    assert.match(messages(result), /display name/i);
  });

  it("returns structured issues instead of throwing for validation failures", () => {
    assert.doesNotThrow(() => {
      const result = validateAssetPackManifest({
        ...SYSTEM_FOUNDATION_PACK_MANIFEST,
        packId: "bad" as never,
      });
      assert.equal(result.status, "invalid");
      assert.ok(result.issues.every((issue) => issue.severity && issue.category && issue.message));
    });
  });
});

function validEntry(overrides: Partial<AssetPackAssetEntry> = {}): AssetPackAssetEntry {
  const definition = overrides.definition ?? validDefinition();
  return {
    entryId: "system.foundation.fixture",
    definition,
    definitionRef: definitionRef(String(definition.definitionId)),
    category: "ui-structure",
    sourceLayer: "system-default",
    fingerprint: "sha256.fixture",
    tags: ["foundation", "fixture"],
    metadata: {
      sourcePack: {
        packId: "system.foundation",
        version: "1.0.0",
      },
    },
    ...overrides,
  };
}

function validDefinition(overrides: Partial<AssetDefinition> = {}): AssetDefinition {
  return {
    definitionId: "system.foundation.fixture",
    assetType: "ui-component",
    assetFamily: "structural",
    version: "1.0.0",
    displayName: "Fixture Primitive",
    description: "Fixture-only structural primitive for validation tests.",
    lifecycleStatus: "published",
    reviewStatus: "approved",
    provenance: { sourceKind: "system-generated", authorship: "human-authored" },
    aiContext: {
      purpose: "Validate future foundation pack structure.",
      userFacingSummary: "Fixture primitive for validation only.",
      developerFacingSummary: "Used by unit tests and not shipped as a real foundation asset.",
      capabilities: [{ capabilityId: "fixture.capability", summary: "Declares test semantics." }],
      limitations: [{ limitationId: "fixture.limitation", summary: "Does not execute or render." }],
      compositionGuidance: { summary: "Use only in tests." },
    },
    ports: [{ portId: "content", direction: "input", displayName: "Content" }],
    ...overrides,
  };
}

function definitionRef(id: string): AssetReference {
  return { kind: "asset-definition-version", id: id as never, version: "1.0.0" };
}

function messages(result: { readonly issues: readonly { readonly message: string }[] }): string {
  return result.issues.map((issue) => issue.message).join("\n");
}
