import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { AssetDefinition, AssetMetadata, AssetPackAssetEntry } from "../../../../contracts/asset";
import { runAssetPackQualityGates } from "../asset-pack-quality-gates.service";

describe("asset pack quality gates", () => {
  it("passes a fixture entry with stable identity, display name, and AI context", () => {
    const result = runAssetPackQualityGates(validEntry());
    assert.equal(result.status, "valid");
    assert.deepEqual(result.issues, []);
  });

  it("fails when display name is missing", () => {
    const result = runAssetPackQualityGates(
      validEntry({ definition: validDefinition({ displayName: "" }) }),
    );
    assert.equal(result.status, "invalid");
    assert.match(messages(result), /display name/i);
  });

  it("returns an issue when AI context is missing", () => {
    const result = runAssetPackQualityGates(
      validEntry({ definition: validDefinition({ aiContext: undefined }) }),
    );
    assert.equal(result.status, "invalid");
    assert.match(messages(result), /AI context/i);
  });

  it("fails configurable fixtures without configuration schema", () => {
    const result = runAssetPackQualityGates(
      validEntry({ category: "forms-fields", definition: validDefinition({ configurationSchema: undefined }) }),
    );
    assert.equal(result.status, "invalid");
    assert.match(messages(result), /configuration schema/i);
  });

  it("fails renderer implementation paths and unsafe metadata values", () => {
    const result = runAssetPackQualityGates(
      validEntry({
        metadata: {
          sourcePack: { packId: "system.foundation", version: "1.0.0" },
          rendererImplementation: "apps/desktop/src/renderer/Foo.tsx",
        },
      }),
    );

    assert.equal(result.status, "invalid");
    assert.match(messages(result), /unsafe/i);
  });

  it("fails local paths, tokens, base64, and raw provider payloads", () => {
    const unsafeMetadataValues: readonly AssetMetadata[] = [
      { localPath: "C:\\Users\\alice\\secret.txt" },
      { note: "token=abc" },
      { image: "data:image/png;base64,AAAA" },
      { providerPayload: { raw: true } },
    ];
    for (const unsafe of unsafeMetadataValues) {
      const result = runAssetPackQualityGates(
        validEntry({
          metadata: {
            sourcePack: { packId: "system.foundation", version: "1.0.0" },
            ...unsafe,
          },
        }),
      );
      assert.equal(result.status, "invalid");
    }
  });

  it("allows explanatory non-goal language about workflows and execution", () => {
    const result = runAssetPackQualityGates(
      validEntry({
        definition: validDefinition({
          description: "Fixture primitive. Does not run workflows.",
          aiContext: {
            ...validDefinition().aiContext,
            purpose: "Does not run workflows.",
            limitations: [
              {
                limitationId: "fixture.no-workflows",
                summary: "No runtime execution occurs.",
              },
            ],
            safetyNotes: [
              {
                safetyNoteId: "fixture.no-execution",
                category: "operational",
                severity: "info",
                summary: "Does not execute workflows.",
              },
            ],
          },
        }),
      }),
    );

    assert.equal(result.status, "valid", messages(result));
  });

  it("allows safe deferred and non-goal behavior language", () => {
    for (const safeSummary of [
      "Does not fetch data.",
      "Uses semantic descriptors without reading resources.",
      "Preview rendering is deferred.",
      "Resource reads are not implemented by this definition.",
    ]) {
      const result = runAssetPackQualityGates(
        validEntry({
          definition: validDefinition({
            description: safeSummary,
            aiContext: {
              ...validDefinition().aiContext,
              purpose: safeSummary,
              limitations: [{ limitationId: "fixture.safe-non-goal", summary: safeSummary }],
            },
          }),
        }),
      );
      assert.equal(result.status, "valid", `${safeSummary}\n${messages(result)}`);
    }
  });

  it("rejects positive execution, resource, provider, and preview behavior claims", () => {
    for (const unsafeSummary of [
      "This primitive can fetch records for a table.",
      "This primitive will read file content.",
      "This primitive can write storage after submit.",
      "This primitive will run validation on user input.",
      "This primitive can execute workflow steps.",
      "This primitive will start runtime workers.",
      "This primitive can create task records.",
      "This primitive will schedule job work.",
      "This primitive can call provider clients.",
      "This primitive will call API endpoints.",
      "This primitive can invoke IPC channels.",
      "This primitive will download resource content.",
      "This primitive can upload files.",
      "This primitive will render preview content.",
      "This primitive can decode image bytes.",
      "This primitive will open file handles.",
    ]) {
      const result = runAssetPackQualityGates(
        validEntry({
          definition: validDefinition({
            description: unsafeSummary,
            aiContext: {
              ...validDefinition().aiContext,
              purpose: unsafeSummary,
            },
          }),
        }),
      );
      assert.equal(result.status, "invalid", unsafeSummary);
      assert.match(messages(result), /unsafe implementation|execution behavior/i);
    }
  });

  it("rejects runtime execution requirements for foundation primitives", () => {
    const result = runAssetPackQualityGates(
      validEntry({
        definition: validDefinition({
          requirements: [
            {
              requirementKind: "runtime-capability",
              required: true,
              runtimeCapabilityId: "image-generation",
              permissionKind: "runtime-execution",
            },
          ],
        }),
      }),
    );

    assert.equal(result.status, "invalid");
    assert.match(messages(result), /runtime/i);
  });

  it("rejects actual execution claims outside explanatory non-goals", () => {
    const result = runAssetPackQualityGates(
      validEntry({
        definition: validDefinition({
          displayName: "Workflow Runner",
          description: "This primitive will execute workflow runs.",
        }),
      }),
    );

    assert.equal(result.status, "invalid");
    assert.match(messages(result), /unsafe implementation/i);
  });

  it("fails shell primitives that claim execution behavior", () => {
    const result = runAssetPackQualityGates(
      validEntry({
        category: "workflow-system-shells",
        definition: validDefinition({
          description: "Fixture shell that claims it can execute workflow runs.",
          aiContext: {
            ...validDefinition().aiContext,
            userFacingSummary: "Execute workflow runs from this shell.",
          },
        }),
      }),
    );

    assert.equal(result.status, "invalid");
    assert.match(messages(result), /execution behavior/i);
  });

  it("rejects renderer library and path details", () => {
    const result = runAssetPackQualityGates(
      validEntry({
        definition: validDefinition({
          aiContext: {
            ...validDefinition().aiContext,
            configurationGuidance: {
              summary: "Use React from apps/desktop/src/renderer/Foo.tsx.",
            },
          },
        }),
      }),
    );

    assert.equal(result.status, "invalid");
    assert.match(messages(result), /unsafe implementation/i);
  });
});

function validEntry(overrides: Partial<AssetPackAssetEntry> = {}): AssetPackAssetEntry {
  const definition = overrides.definition ?? validDefinition();
  return {
    entryId: "system.foundation.fixture",
    definition,
    definitionRef: {
      kind: "asset-definition-version",
      id: String(definition.definitionId) as never,
      version: String(definition.version),
    },
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
    description: "Fixture-only structural primitive for quality gate tests.",
    lifecycleStatus: "published",
    reviewStatus: "approved",
    provenance: { sourceKind: "system-generated", authorship: "human-authored" },
    aiContext: {
      purpose: "Validate future foundation pack asset quality.",
      userFacingSummary: "Fixture primitive for quality gate tests.",
      developerFacingSummary: "Used by unit tests and not shipped as a real foundation asset.",
      capabilities: [{ capabilityId: "fixture.capability", summary: "Declares test semantics." }],
      limitations: [{ limitationId: "fixture.limitation", summary: "Does not execute or render." }],
      configurationGuidance: { summary: "Configure fixture labels with safe test values." },
      compositionGuidance: { summary: "Use only in tests." },
    },
    ports: [{ portId: "content", direction: "input", displayName: "Content" }],
    configurationSchema: {
      schemaId: "system.foundation.fixture.configuration",
      schemaVersion: "1.0.0",
      fields: [{ fieldId: "label", valueKind: "string", required: false, label: "Label" }],
    },
    ...overrides,
  };
}

function messages(result: { readonly issues: readonly { readonly message: string }[] }): string {
  return result.issues.map((issue) => issue.message).join("\n");
}
