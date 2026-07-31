import { describe, expect, it } from "../../../testing/node-test";

import {
  ASSET_BINDING_CONSTRAINT_KINDS,
  ASSET_COMPOSITION_DEPENDENCY_KINDS,
  ASSET_COMPOSITION_RULE_KINDS,
  ASSET_COMPOSITION_VALIDATION_STATUSES,
  ASSET_PORT_CARDINALITY_PRESETS,
  ASSET_PORT_CONTRACT_KINDS,
  ASSET_PORT_DIRECTIONS,
  normalizeAssetBindingConstraintKind,
  normalizeAssetCompositionDependencyKind,
  normalizeAssetCompositionRuleKind,
  normalizeAssetCompositionValidationStatus,
  normalizeAssetId,
  normalizeAssetPortCardinalityPreset,
  normalizeAssetPortContractKind,
  normalizeAssetPortDirection,
  type AssetAiContext,
  type AssetBinding,
  type AssetComposition,
  type AssetCompositionDependency,
  type AssetCompositionRule,
  type AssetConfiguration,
  type AssetDefinition,
  type AssetPort,
  type AssetProvenance,
  type AssetReference,
} from "..";
import type { RuntimeCapabilityId } from "../../runtime";

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
    "providerNativePath",
    "bytes",
    "blob",
    "buffer",
    "stream",
    "transport",
    "transportEnvelope",
    "channel",
    "ipcChannel",
    "host",
    "hostProcess",
    "runtimeReadinessSnapshot",
    "taskStatus",
    "rendererState",
    "uiState",
    "componentName",
    "reactComponent",
    "rendererRoute",
    "routeName",
    "execute",
    "run",
    "handler",
    "validate",
    "validator",
    "commandLine",
    "token",
    "secret",
    "rawEnvironment",
    "rawStackTrace",
    "adapterDetails",
  ].filter((key) => key in value);
}

describe("asset port and composition vocabularies", () => {
  it("allows port direction values", () => {
    expect([...ASSET_PORT_DIRECTIONS]).toEqual([
      "input",
      "output",
      "event",
      "control",
    ]);
    expect(normalizeAssetPortDirection(" Control ")).toBe("control");
  });

  it("allows port contract kind values", () => {
    expect([...ASSET_PORT_CONTRACT_KINDS]).toEqual([
      "asset",
      "asset-instance",
      "asset-definition",
      "resource",
      "artifact",
      "external-repository-object",
      "configuration",
      "runtime-capability",
      "event",
      "control",
      "json",
      "text",
      "binary-reference",
      "custom",
    ]);
    expect(normalizeAssetPortContractKind(" Binary-Reference ")).toBe(
      "binary-reference",
    );
  });

  it("allows port cardinality preset values", () => {
    expect([...ASSET_PORT_CARDINALITY_PRESETS]).toEqual([
      "optional",
      "required",
      "zero-or-more",
      "one-or-more",
      "exactly-one",
    ]);
    expect(normalizeAssetPortCardinalityPreset(" One-Or-More ")).toBe(
      "one-or-more",
    );
  });

  it("allows binding constraint kind values", () => {
    expect([...ASSET_BINDING_CONSTRAINT_KINDS]).toEqual([
      "required",
      "same-contract-kind",
      "same-data-kind",
      "asset-type",
      "asset-family",
      "resource-kind",
      "runtime-capability",
      "single-source",
      "single-target",
      "ordering",
      "custom",
    ]);
    expect(normalizeAssetBindingConstraintKind(" Same-Data-Kind ")).toBe(
      "same-data-kind",
    );
  });

  it("allows composition rule kind values", () => {
    expect([...ASSET_COMPOSITION_RULE_KINDS]).toEqual([
      "allowed-parent",
      "allowed-child",
      "required-child",
      "optional-child",
      "incompatible-child",
      "required-dependency",
      "cardinality",
      "ordering",
      "binding-required",
      "runtime-requirement",
      "custom",
    ]);
    expect(normalizeAssetCompositionRuleKind(" Runtime-Requirement ")).toBe(
      "runtime-requirement",
    );
  });

  it("allows composition dependency kind values", () => {
    expect([...ASSET_COMPOSITION_DEPENDENCY_KINDS]).toEqual([
      "asset",
      "asset-type",
      "asset-family",
      "resource",
      "artifact",
      "runtime-capability",
      "external-repository-object",
      "configuration",
      "custom",
    ]);
    expect(normalizeAssetCompositionDependencyKind(" Asset-Family ")).toBe(
      "asset-family",
    );
  });

  it("allows composition validation status values", () => {
    expect([...ASSET_COMPOSITION_VALIDATION_STATUSES]).toEqual([
      "not-validated",
      "valid",
      "valid-with-warnings",
      "invalid",
      "unknown",
    ]);
    expect(normalizeAssetCompositionValidationStatus(" Valid-With-Warnings ")).toBe(
      "valid-with-warnings",
    );
  });
});

describe("asset port and composition contract shapes", () => {
  it("lets AssetDefinition declare reusable ports, composition rules, and dependencies", () => {
    const inputPort: AssetPort = {
      portId: "summary.input",
      direction: "input",
      displayName: "Summary input",
      contract: {
        contractKind: "json",
        dataKind: "dashboard-record",
        schemaRef: ref("asset-definition", "schema.dashboard.summary.input"),
      },
      cardinality: {
        preset: "exactly-one",
        minConnections: 1,
        maxConnections: 1,
        required: true,
      },
    };
    const dependency: AssetCompositionDependency = {
      dependencyId: "summary.requires.image-generation",
      dependencyKind: "runtime-capability",
      required: true,
      runtimeCapabilityId: "image-generation",
      description: "A future validator can ensure this capability is available.",
    };
    const rule: AssetCompositionRule = {
      ruleId: "summary.allowed-child.page",
      ruleKind: "allowed-child",
      allowedChildTypes: ["page", "workflow-step"],
      requiredDependencies: [dependency],
      cardinality: { min: 1, max: 3 },
      message: "Summary assets can compose with page or workflow-step children.",
    };
    const definition: AssetDefinition = {
      definitionId: normalizeAssetId("feature.dashboard.summary"),
      assetType: "feature",
      assetFamily: "structural",
      version: "1.0.0",
      displayName: "Dashboard summary",
      description: "Reusable dashboard summary feature definition.",
      lifecycleStatus: "draft",
      provenance,
      ports: [inputPort],
      compositionRules: [rule],
      dependencies: [dependency],
    };

    expect(definition.ports?.[0]?.contract?.contractKind).toBe("json");
    expect(definition.compositionRules?.[0]?.ruleKind).toBe("allowed-child");
    expect(definition.dependencies?.[0]?.runtimeCapabilityId).toBe(
      "image-generation",
    );
    expect(forbiddenKeys(definition)).toEqual([]);
  });

  it("lets AssetBinding connect source and target refs with source and target port refs", () => {
    const binding: AssetBinding = {
      bindingId: normalizeAssetId("binding.dashboard.summary.output"),
      bindingKind: "output",
      sourceRef: ref("asset-instance", "instance.dashboard.summary.primary"),
      targetRef: ref("asset-instance", "instance.dashboard.page.primary"),
      sourcePortRef: ref("asset-definition", "port.summary.output"),
      targetPortRef: ref("asset-definition", "port.page.input"),
      constraints: [
        {
          constraintKind: "same-data-kind",
          value: "dashboard-record",
          message: "Future validation should compare dataKind descriptors.",
        },
      ],
      lifecycleStatus: "draft",
      provenance,
    };

    expect(binding.sourcePortRef?.id).toBe("port.summary.output");
    expect(binding.targetPortRef?.id).toBe("port.page.input");
    expect(binding.constraints?.[0]?.constraintKind).toBe("same-data-kind");
    expect("validate" in binding).toBe(false);
    expect(forbiddenKeys(binding)).toEqual([]);
  });

  it("lets AssetComposition reference instances, binding refs, inline bindings, rules, dependencies, and validation summaries", () => {
    const rootInstanceRef = ref("asset-instance", "instance.dashboard.summary.primary");
    const bindingRef = ref("asset-instance", "binding.dashboard.summary.output");
    const dependency: AssetCompositionDependency = {
      dependencyKind: "asset-type",
      required: false,
      assetType: "document",
    };
    const rule: AssetCompositionRule = {
      ruleKind: "ordering",
      ordering: {
        afterRefs: [rootInstanceRef],
        message: "Future validation can evaluate ordering descriptors.",
      },
    };
    const composition: AssetComposition = {
      compositionId: normalizeAssetId("composition.dashboard.feature"),
      compositionType: "feature",
      displayName: "Dashboard feature",
      version: "1.0.0",
      lifecycleStatus: "draft",
      rootInstanceRefs: [rootInstanceRef],
      instanceRefs: [rootInstanceRef],
      bindingRefs: [bindingRef],
      bindings: [
        {
          bindingId: "binding.dashboard.summary.inline",
          bindingKind: "input",
          sourceRef: rootInstanceRef,
          targetRef: ref("asset-instance", "instance.dashboard.page.primary"),
        },
      ],
      compositionRules: [rule],
      dependencies: [dependency],
      provenance,
      validationSummary: {
        status: "not-validated",
        issueCount: 0,
      },
    };

    expect(composition.bindingRefs).toEqual([bindingRef]);
    expect(composition.bindings?.[0]?.bindingKind).toBe("input");
    expect(composition.compositionRules?.[0]?.ruleKind).toBe("ordering");
    expect(composition.dependencies?.[0]?.assetType).toBe("document");
    expect(composition.validationSummary?.status).toBe("not-validated");
    expect(forbiddenKeys(composition)).toEqual([]);
  });

  it("references runtime capability ids without duplicating readiness snapshots", () => {
    const runtimeCapabilityId: RuntimeCapabilityId = "image-generation";
    const dependency: AssetCompositionDependency = {
      dependencyKind: "runtime-capability",
      required: true,
      runtimeCapabilityId,
    };
    const port: AssetPort = {
      portId: "image.capability",
      direction: "control",
      contract: {
        contractKind: "runtime-capability",
        runtimeCapabilityId,
      },
    };

    expect(dependency.runtimeCapabilityId).toBe("image-generation");
    expect(port.contract?.runtimeCapabilityId).toBe("image-generation");
    expect("runtimeReadinessSnapshot" in dependency).toBe(false);
    expect("capabilities" in dependency).toBe(false);
    expect("status" in dependency).toBe(false);
  });

  it("keeps AI-context composition guidance separate from machine-readable composition rules", () => {
    const aiContext: AssetAiContext = {
      purpose: "Explain when to compose a summary card.",
      compositionGuidance: {
        summary: "Place after a data preparation step and before page display.",
        orderingGuidance: "Use after normalization.",
        bindingGuidance: "Bind the normalized record output to the summary input.",
      },
    };
    const rule: AssetCompositionRule = {
      ruleKind: "binding-required",
      message: "A future validator can require a binding descriptor.",
    };

    expect(aiContext.compositionGuidance?.summary).toContain("Place after");
    expect(rule.ruleKind).toBe("binding-required");
    expect("compositionRules" in aiContext).toBe(false);
    expect("compositionGuidance" in rule).toBe(false);
  });

  it("keeps configuration contracts separate from port and composition contracts", () => {
    const configuration: AssetConfiguration = {
      selectedValues: {
        tone: "neutral",
        maxItems: 5,
      },
    };
    const port: AssetPort = {
      portId: "summary.configuration",
      direction: "input",
      contract: {
        contractKind: "configuration",
        dataKind: "selected-values",
      },
    };
    const dependency: AssetCompositionDependency = {
      dependencyKind: "configuration",
      required: true,
      ref: ref("asset-definition", "configuration.summary.schema"),
    };

    expect(configuration.selectedValues?.tone).toBe("neutral");
    expect(port.contract?.contractKind).toBe("configuration");
    expect(dependency.dependencyKind).toBe("configuration");
    expect("fields" in port).toBe(false);
    expect("selectedValues" in dependency).toBe(false);
  });

  it("does not require unsafe filesystem, provider-native, byte, transport, host, renderer, or executable fields", () => {
    const port: AssetPort = {
      portId: "artifact.reference.output",
      direction: "output",
      contract: {
        contractKind: "binary-reference",
        resourceKind: "image",
        description: "Carries a safe reference to binary content, not bytes.",
      },
    };
    const rule: AssetCompositionRule = {
      ruleKind: "custom",
      metadata: {
        ruleDescriptorId: "future.safe-reference.rule",
      },
    };

    expect(forbiddenKeys(port)).toEqual([]);
    expect(forbiddenKeys(port.contract ?? {})).toEqual([]);
    expect(forbiddenKeys(rule)).toEqual([]);
    expect("bytes" in (port.contract ?? {})).toBe(false);
    expect("filePath" in (port.contract ?? {})).toBe(false);
    expect("rendererRoute" in rule).toBe(false);
    expect("validate" in rule).toBe(false);
  });
});
