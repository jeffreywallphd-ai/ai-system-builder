import { describe, expect, it } from "../../../testing/node-test";

import {
  ASSET_CONFIGURATION_CONSTRAINT_KINDS,
  ASSET_CONFIGURATION_UI_HINT_KINDS,
  ASSET_CONFIGURATION_VALIDATION_RULE_KINDS,
  ASSET_CONFIGURATION_VALUE_KINDS,
  normalizeAssetConfigurationConstraintKind,
  normalizeAssetConfigurationUiHintKind,
  normalizeAssetConfigurationValidationRuleKind,
  normalizeAssetConfigurationValueKind,
  normalizeAssetId,
  type AssetConfigurationConstraint,
  type AssetConfigurationExample,
  type AssetConfigurationField,
  type AssetConfigurationSchema,
  type AssetConfigurationUiHint,
  type AssetConfigurationValidationRule,
  type AssetConfigurationValues,
  type AssetDefinition,
  type AssetInstance,
  type AssetProvenance,
} from "..";

const provenance: AssetProvenance = {
  sourceKind: "human-authored",
  authorship: "human-authored",
};

function forbiddenKeys(value: object): readonly string[] {
  return [
    "filePath",
    "filesystemPath",
    "localPath",
    "tempPath",
    "providerPath",
    "bytes",
    "blob",
    "buffer",
    "stream",
    "commandLine",
    "token",
    "secret",
    "rawEnvironment",
    "rawStackTrace",
    "adapterDetails",
    "reactComponent",
    "componentName",
    "cssClass",
    "rendererRoute",
    "ipcChannel",
  ].filter((key) => key in value);
}

describe("asset configuration contract vocabularies", () => {
  it("allows the initial configuration value kinds", () => {
    expect([...ASSET_CONFIGURATION_VALUE_KINDS]).toEqual([
      "string",
      "number",
      "integer",
      "boolean",
      "enum",
      "array",
      "object",
      "asset-reference",
      "resource-reference",
      "artifact-reference",
      "runtime-capability-reference",
      "json",
    ]);
    expect(normalizeAssetConfigurationValueKind(" Asset-Reference ")).toBe(
      "asset-reference",
    );
  });

  it("allows the initial configuration constraint kinds", () => {
    expect([...ASSET_CONFIGURATION_CONSTRAINT_KINDS]).toEqual([
      "required",
      "min",
      "max",
      "min-length",
      "max-length",
      "pattern",
      "one-of",
      "asset-type",
      "asset-family",
      "runtime-capability",
      "resource-kind",
      "custom",
    ]);
    expect(normalizeAssetConfigurationConstraintKind(" Min-Length ")).toBe(
      "min-length",
    );
  });

  it("allows the initial generic UI hint kinds", () => {
    expect([...ASSET_CONFIGURATION_UI_HINT_KINDS]).toEqual([
      "text",
      "textarea",
      "color",
      "number",
      "checkbox",
      "select",
      "multi-select",
      "slider",
      "asset-picker",
      "resource-picker",
      "artifact-picker",
      "runtime-capability-picker",
      "json-editor",
      "hidden",
      "advanced",
    ]);
    expect(normalizeAssetConfigurationUiHintKind(" JSON-Editor ")).toBe(
      "json-editor",
    );
  });

  it("allows validation rule descriptor kinds without requiring validators", () => {
    expect([...ASSET_CONFIGURATION_VALIDATION_RULE_KINDS]).toEqual([
      "field-required",
      "field-kind",
      "field-constraint",
      "cross-field",
      "composition-context",
      "resource-reference",
      "runtime-requirement",
      "custom",
    ]);
    expect(
      normalizeAssetConfigurationValidationRuleKind(" Runtime-Requirement "),
    ).toBe("runtime-requirement");
  });
});

describe("asset configuration contract shapes", () => {
  it("represents nested JSON-compatible configuration values", () => {
    const values: AssetConfigurationValues = {
      title: "Dashboard",
      retryCount: 3,
      enabled: true,
      nullable: null,
      thresholds: [0.2, 0.5, 0.8],
      references: {
        modelAssetId: "asset.model.summary",
        runtimeCapabilityId: "runtime.python.inference",
      },
    };

    expect(JSON.parse(JSON.stringify(values))).toEqual(values);
    expect(forbiddenKeys(values)).toEqual([]);
  });

  it("does not require unsafe runtime, host, filesystem, or file/blob fields", () => {
    const values: AssetConfigurationValues = {
      artifactRef: { kind: "artifact", id: "artifact.image.reference" },
      resourceRef: { kind: "resource", id: "resource.document.reference" },
      runtimeCapabilityRef: "runtime.python.inference",
    };

    expect(forbiddenKeys(values)).toEqual([]);
  });

  it("creates a minimal AssetConfigurationSchema", () => {
    const schema: AssetConfigurationSchema = {
      fields: [],
    };

    expect(schema.fields).toEqual([]);
    expect(schema.strict).toBeUndefined();
    expect(forbiddenKeys(schema)).toEqual([]);
  });

  it("creates a minimal AssetConfigurationField", () => {
    const field: AssetConfigurationField = {
      fieldId: "title",
      valueKind: "string",
    };

    expect(field.fieldId).toBe("title");
    expect(field.defaultValue).toBeUndefined();
    expect(forbiddenKeys(field)).toEqual([]);
  });

  it("supports enum-like fields with explicit options", () => {
    const field: AssetConfigurationField = {
      fieldId: "mode",
      valueKind: "enum",
      options: [
        { value: "fast", label: "Fast" },
        { value: "accurate", label: "Accurate", disabled: false },
      ],
      defaultValue: "fast",
    };

    expect(field.options?.map((option) => option.value)).toEqual([
      "fast",
      "accurate",
    ]);
    expect(forbiddenKeys(field.options?.[0] ?? {})).toEqual([]);
  });

  it("keeps UI hints generic and renderer-neutral", () => {
    const uiHint: AssetConfigurationUiHint = {
      hintKind: "select",
      placeholder: "Choose a mode",
      helpText: "Controls the reusable asset behavior.",
      section: "Behavior",
      order: 10,
      advanced: false,
    };

    expect(uiHint.hintKind).toBe("select");
    expect(forbiddenKeys(uiHint)).toEqual([]);
    expect("componentName" in uiHint).toBe(false);
    expect("reactComponent" in uiHint).toBe(false);
    expect("rendererRoute" in uiHint).toBe(false);
  });

  it("models validation rules as descriptors only", () => {
    const rule: AssetConfigurationValidationRule = {
      ruleId: "mode.requires.model",
      ruleKind: "cross-field",
      targetFieldIds: ["mode", "modelAssetRef"],
      message: "Model selection is required for this mode.",
    };

    expect(rule.ruleKind).toBe("cross-field");
    expect(forbiddenKeys(rule)).toEqual([]);
    expect("validate" in rule).toBe(false);
    expect("validator" in rule).toBe(false);
    expect("execute" in rule).toBe(false);
  });

  it("creates constraints without executable custom validation functions", () => {
    const constraint: AssetConfigurationConstraint = {
      constraintKind: "custom",
      value: { ruleId: "model.compatibility.future" },
      message: "Future validation can resolve this descriptor.",
    };

    expect(constraint.constraintKind).toBe("custom");
    expect(forbiddenKeys(constraint)).toEqual([]);
    expect("validate" in constraint).toBe(false);
  });

  it("creates configuration examples with safe values", () => {
    const example: AssetConfigurationExample = {
      exampleId: "balanced-summary",
      label: "Balanced summary",
      values: {
        mode: "balanced",
        maxItems: 5,
        includeCharts: true,
      },
    };

    expect(example.values).toMatchObject({ mode: "balanced" });
    expect(forbiddenKeys(example)).toEqual([]);
  });

  it("lets AssetDefinition own schema, defaults, and examples", () => {
    const configurationSchema: AssetConfigurationSchema = {
      schemaId: "dashboard.summary.config",
      schemaVersion: "1.0.0",
      strict: true,
      fields: [
        {
          fieldId: "mode",
          valueKind: "enum",
          required: true,
          options: [{ value: "balanced", label: "Balanced" }],
          uiHint: { hintKind: "select" },
        },
      ],
      requiredFieldIds: ["mode"],
      validationRules: [
        {
          ruleId: "mode.required",
          ruleKind: "field-required",
          targetFieldIds: ["mode"],
        },
      ],
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
      configurationSchema,
      defaultConfiguration: { mode: "balanced" },
      configurationExamples: [
        {
          exampleId: "balanced",
          values: { mode: "balanced" },
        },
      ],
    };

    expect(definition.configurationSchema).toBe(configurationSchema);
    expect(definition.defaultConfiguration).toEqual({ mode: "balanced" });
    expect(definition.configurationExamples?.[0]?.values).toEqual({
      mode: "balanced",
    });
  });

  it("lets AssetInstance own selected configuration values", () => {
    const instance: AssetInstance = {
      instanceId: normalizeAssetId("instance.dashboard.summary.primary"),
      definitionRef: {
        kind: "asset-definition-version",
        id: normalizeAssetId("feature.dashboard.summary@1.0.0"),
      },
      lifecycleStatus: "draft",
      selectedConfiguration: {
        mode: "balanced",
        includeCharts: true,
      },
      provenance,
    };

    expect(instance.selectedConfiguration).toEqual({
      mode: "balanced",
      includeCharts: true,
    });
  });

  it("keeps configuration optional for assets that are not configurable", () => {
    const definition: AssetDefinition = {
      definitionId: normalizeAssetId("document.static.reference"),
      assetType: "document",
      assetFamily: "resource-backed",
      version: "1.0.0",
      displayName: "Static reference document",
      description: "A resource-backed document with no configurable surface.",
      lifecycleStatus: "draft",
      provenance,
    };

    const instance: AssetInstance = {
      instanceId: normalizeAssetId("instance.document.static.reference"),
      definitionRef: {
        kind: "asset-definition",
        id: normalizeAssetId("document.static.reference"),
      },
      lifecycleStatus: "draft",
      provenance,
    };

    expect(definition.configurationSchema).toBeUndefined();
    expect(definition.defaultConfiguration).toBeUndefined();
    expect(definition.configurationExamples).toBeUndefined();
    expect(instance.selectedConfiguration).toBeUndefined();
  });
});
