import { describe, expect, it } from "../../../testing/node-test";

import {
  ASSET_BINDING_KINDS,
  ASSET_COMPOSITION_TYPES,
  ASSET_FAMILIES,
  ASSET_LIFECYCLE_STATUSES,
  ASSET_REFERENCE_KINDS,
  ASSET_PROVENANCE_SOURCE_KINDS,
  ASSET_REVIEW_STATUSES,
  ASSET_TYPES,
  ASSET_VALIDATION_ISSUE_CATEGORIES,
  ASSET_VALIDATION_ISSUE_SEVERITIES,
  isAssetId,
  normalizeAssetBindingKind,
  normalizeAssetCompositionType,
  normalizeAssetFamily,
  normalizeAssetId,
  normalizeAssetLifecycleStatus,
  normalizeAssetProvenanceSourceKind,
  normalizeAssetReferenceKind,
  normalizeAssetReviewStatus,
  normalizeAssetType,
  normalizeAssetValidationIssueCategory,
  normalizeAssetValidationIssueSeverity,
  type AssetBinding,
  type AssetComposition,
  type AssetDefinition,
  type AssetInstance,
  type AssetProvenance,
  type AssetReference,
} from "..";

const provenance: AssetProvenance = {
  sourceKind: "human-authored",
  authorship: "human-authored",
};

function ref(kind: AssetReference["kind"], id: string): AssetReference {
  return { kind, id: normalizeAssetId(id) };
}

function forbiddenKeys(value: object): readonly string[] {
  return [
    "filePath",
    "filesystemPath",
    "localPath",
    "tempPath",
    "providerPath",
    "bytes",
    "blob",
    "transport",
    "channel",
    "host",
    "hostProcess",
    "runtimeReadinessSnapshot",
    "rendererState",
    "uiState",
  ].filter((key) => key in value);
}

describe("asset core contract vocabularies", () => {
  it("allows the initial Asset Kernel family values", () => {
    expect([...ASSET_FAMILIES]).toEqual([
      "structural",
      "behavioral",
      "resource-backed",
      "context",
      "composition",
    ]);
    expect(normalizeAssetFamily(" Resource-Backed ")).toBe("resource-backed");
  });

  it("allows the initial extensible asset type values", () => {
    expect([...ASSET_TYPES]).toEqual([
      "ui-component",
      "page",
      "tool",
      "workflow",
      "workflow-step",
      "schema",
      "prompt-template",
      "data-source",
      "runtime-binding",
      "adapter-binding",
      "model",
      "dataset",
      "image",
      "document",
      "feature",
      "subsystem",
      "system",
      "policy",
      "test",
    ]);
    expect(normalizeAssetType(" Prompt-Template ")).toBe("prompt-template");
  });

  it("allows lifecycle status values", () => {
    expect([...ASSET_LIFECYCLE_STATUSES]).toEqual([
      "draft",
      "validated",
      "published",
      "deprecated",
      "archived",
      "failed-validation",
    ]);
    expect(normalizeAssetLifecycleStatus(" Failed-Validation ")).toBe(
      "failed-validation",
    );
  });

  it("allows review status values", () => {
    expect([...ASSET_REVIEW_STATUSES]).toEqual([
      "unreviewed",
      "reviewed",
      "approved",
      "rejected",
    ]);
    expect(normalizeAssetReviewStatus(" Approved ")).toBe("approved");
  });

  it("keeps lifecycle and review status as separate vocabularies", () => {
    for (const reviewStatus of ASSET_REVIEW_STATUSES) {
      expect(ASSET_LIFECYCLE_STATUSES.includes(reviewStatus as never)).toBe(
        false,
      );
    }

    for (const lifecycleStatus of ASSET_LIFECYCLE_STATUSES) {
      expect(ASSET_REVIEW_STATUSES.includes(lifecycleStatus as never)).toBe(
        false,
      );
    }
  });

  it("allows asset reference kinds", () => {
    expect([...ASSET_REFERENCE_KINDS]).toEqual([
      "asset-definition",
      "asset-definition-version",
      "asset-instance",
      "asset-composition",
      "asset-binding",
      "asset-placement",
      "asset-requirement",
      "resource-backed-asset",
      "asset-resource-backing",
      "artifact",
      "resource",
      "external-repository-object",
    ]);
    expect(normalizeAssetReferenceKind(" Asset-Instance ")).toBe(
      "asset-instance",
    );
    expect(normalizeAssetReferenceKind(" Asset-Binding ")).toBe(
      "asset-binding",
    );
  });

  it("allows provenance source kinds without requiring raw prompts or unsafe source details", () => {
    expect([...ASSET_PROVENANCE_SOURCE_KINDS]).toEqual([
      "human-authored",
      "ai-generated",
      "imported",
      "runtime-generated",
      "system-generated",
    ]);
    expect(normalizeAssetProvenanceSourceKind(" AI-Generated ")).toBe(
      "ai-generated",
    );
    expect(
      forbiddenKeys({ sourceKind: "ai-generated", generationContextRefs: [] }),
    ).toEqual([]);
  });

  it("allows binding kinds", () => {
    expect([...ASSET_BINDING_KINDS]).toEqual([
      "input",
      "output",
      "event",
      "control",
      "resource",
      "runtime",
      "adapter",
      "dependency",
    ]);
    expect(normalizeAssetBindingKind(" Runtime ")).toBe("runtime");
  });

  it("allows composition types without introducing system-of-systems", () => {
    expect([...ASSET_COMPOSITION_TYPES]).toEqual([
      "feature",
      "workflow",
      "page",
      "subsystem",
      "system",
      "system-of-subsystems",
    ]);
    expect(ASSET_COMPOSITION_TYPES.includes("system-of-systems" as never)).toBe(
      false,
    );
    expect(normalizeAssetCompositionType(" System-Of-Subsystems ")).toBe(
      "system-of-subsystems",
    );
  });

  it("allows validation issue severities and categories", () => {
    expect([...ASSET_VALIDATION_ISSUE_SEVERITIES]).toEqual([
      "info",
      "warning",
      "error",
    ]);
    expect([...ASSET_VALIDATION_ISSUE_CATEGORIES]).toEqual([
      "identity",
      "lifecycle",
      "configuration",
      "ai-context",
      "binding",
      "composition",
      "requirement",
      "provenance",
      "security",
      "resource",
      "unknown",
    ]);
    expect(normalizeAssetValidationIssueSeverity(" Warning ")).toBe("warning");
    expect(normalizeAssetValidationIssueCategory(" AI-Context ")).toBe(
      "ai-context",
    );
  });
});

describe("asset core contract shapes", () => {
  it("creates a minimal AssetDefinition without optional configuration, AI-context, or port contracts", () => {
    const definition: AssetDefinition = {
      definitionId: normalizeAssetId("feature.dashboard.summary"),
      assetType: "feature",
      assetFamily: "structural",
      version: "1.0.0",
      displayName: "Dashboard summary",
      description: "Reusable dashboard summary feature definition.",
      lifecycleStatus: "draft",
      provenance,
    };

    expect(definition.configurationSchema).toBeUndefined();
    expect(definition.aiContext).toBeUndefined();
    expect(definition.portRefs).toBeUndefined();
    expect(forbiddenKeys(definition)).toEqual([]);
  });

  it("creates a minimal AssetInstance that references a definition", () => {
    const definitionRef = ref(
      "asset-definition-version",
      "feature.dashboard.summary@1.0.0",
    );
    const instance: AssetInstance = {
      instanceId: normalizeAssetId("instance.dashboard.summary.primary"),
      definitionRef,
      lifecycleStatus: "draft",
      provenance,
    };

    expect(instance.definitionRef).toEqual(definitionRef);
    expect(instance.selectedConfiguration).toBeUndefined();
    expect(instance.bindingRefs).toBeUndefined();
    expect(instance.resourceRefs).toBeUndefined();
    expect(forbiddenKeys(instance)).toEqual([]);
  });

  it("creates a minimal AssetComposition that references instances and bindings", () => {
    const rootInstanceRef = ref(
      "asset-instance",
      "instance.dashboard.summary.primary",
    );
    const bindingRef = ref(
      "asset-instance",
      "binding.dashboard.summary.output",
    );
    const composition: AssetComposition = {
      compositionId: normalizeAssetId("composition.dashboard.feature"),
      compositionType: "feature",
      displayName: "Dashboard feature",
      version: "1.0.0",
      lifecycleStatus: "draft",
      rootInstanceRefs: [rootInstanceRef],
      instanceRefs: [rootInstanceRef],
      bindingRefs: [bindingRef],
      provenance,
    };

    expect(composition.rootInstanceRefs).toEqual([rootInstanceRef]);
    expect(composition.bindingRefs).toEqual([bindingRef]);
    expect(composition.validationSummary).toBeUndefined();
    expect(forbiddenKeys(composition)).toEqual([]);
  });

  it("creates a minimal AssetBinding without detailed port compatibility validation", () => {
    const binding: AssetBinding = {
      bindingId: normalizeAssetId("binding.dashboard.summary.output"),
      bindingKind: "output",
      sourceRef: ref("asset-instance", "instance.dashboard.summary.primary"),
      targetRef: ref("asset-instance", "instance.dashboard.page.primary"),
    };

    expect(binding.sourcePortRef).toBeUndefined();
    expect(binding.targetPortRef).toBeUndefined();
    expect(forbiddenKeys(binding)).toEqual([]);
  });

  it("does not accept unsafe values as canonical AssetId values", () => {
    expect(isAssetId("feature.dashboard.summary")).toBe(true);
    expect(isAssetId(" /tmp/asset.json ")).toBe(false);
    expect(isAssetId("org/model/path ")).toBe(false);
    expect(isAssetId("https://example.test/asset")).toBe(false);
    expect(isAssetId("   ")).toBe(false);
  });
});
