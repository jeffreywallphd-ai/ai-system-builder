import { describe, expect, it } from "../../../../testing/node-test";
import type {
  AssetConfigurationSchema,
  AssetInstance,
  AssetPort,
} from "../../../../contracts/asset";
import { normalizeAssetId } from "../../../../contracts/asset";
import type { SystemBuilderComposerAsset } from "../../../../contracts/system-builder";
import {
  bindingKindForSystemComposerEndpoint,
  buildSystemComposerConfigurationSections,
  listCompatibleSystemComposerTargets,
  listSystemComposerPortEndpoints,
  materializeSystemComposerConfiguration,
  validateSystemComposerConfiguration,
} from "../systemComposerInspectorModel";

describe("System composer inspector model", () => {
  it("groups ordered generated controls and omits hidden fields", () => {
    const schema: AssetConfigurationSchema = {
      fields: [
        {
          fieldId: "advanced",
          valueKind: "json",
          uiHint: { hintKind: "advanced" },
        },
        {
          fieldId: "subtitle",
          valueKind: "string",
          uiHint: { hintKind: "text", section: "Content", order: 2 },
        },
        {
          fieldId: "title",
          valueKind: "string",
          uiHint: { hintKind: "text", section: "Content", order: 1 },
        },
        { fieldId: "enabled", valueKind: "boolean" },
        {
          fieldId: "internal",
          valueKind: "string",
          uiHint: { hintKind: "hidden" },
        },
      ],
    };
    const sections = buildSystemComposerConfigurationSections(schema);
    expect(sections.map((section) => section.label)).toEqual([
      "General",
      "Content",
      "Advanced",
    ]);
    expect(sections[1]?.fields.map((field) => field.fieldId)).toEqual([
      "title",
      "subtitle",
    ]);
    expect(
      sections
        .flatMap((section) => section.fields)
        .some((field) => field.fieldId === "internal"),
    ).toBe(false);
  });

  it("materializes defaults and reports field-level constraints", () => {
    const definition = asset("builtin.card", [], {
      fields: [
        {
          fieldId: "title",
          valueKind: "string",
          required: true,
          defaultValue: "Default",
          constraints: [
            {
              constraintKind: "min-length",
              value: 3,
              message: "Title is too short.",
            },
          ],
        },
        {
          fieldId: "count",
          valueKind: "integer",
          constraints: [{ constraintKind: "min", value: 1 }],
        },
        {
          fieldId: "mode",
          valueKind: "enum",
          options: [{ value: "safe" }, { value: "fast" }],
        },
      ],
    });
    const values = materializeSystemComposerConfiguration(definition, {
      title: "x",
      count: 0,
      mode: "unknown",
    });
    expect(values.title).toBe("x");
    const errors = validateSystemComposerConfiguration(
      definition.configurationSchema,
      values,
    );
    expect(errors.title).toEqual(["Title is too short."]);
    expect(errors.count?.[0]).toContain("does not satisfy min");
    expect(errors.mode?.[0]).toContain("approved option");
  });

  it("offers only compatible declared port targets and derives typed binding kinds", () => {
    const source = asset("builtin.source", [
      port("records", "output", "json", "records"),
    ]);
    const target = asset("builtin.target", [
      port("records", "input", "json", "records"),
    ]);
    const wrong = asset("builtin.wrong", [
      port("text", "input", "text", "plain-text"),
    ]);
    const instances = [
      instance("instance.source", source),
      instance("instance.target", target),
      instance("instance.wrong", wrong),
    ];
    const endpoints = listSystemComposerPortEndpoints(instances, [
      source,
      target,
      wrong,
    ]);
    const sourceEndpoint = endpoints.find(
      (endpoint) => endpoint.instanceId === "instance.source",
    );
    const targets = listCompatibleSystemComposerTargets(
      sourceEndpoint,
      endpoints,
    );
    expect(targets.map((endpoint) => endpoint.instanceId)).toEqual([
      "instance.target",
    ]);
    expect(bindingKindForSystemComposerEndpoint(sourceEndpoint!)).toBe(
      "output",
    );
  });
});

function instance(
  instanceId: string,
  definition: SystemBuilderComposerAsset,
): AssetInstance {
  return {
    instanceId: normalizeAssetId(instanceId),
    definitionRef: definition.definitionRef,
    displayName: instanceId,
    lifecycleStatus: "draft",
    selectedConfiguration: {},
    provenance: { sourceKind: "system-generated" },
  };
}

function port(
  portId: string,
  direction: AssetPort["direction"],
  contractKind: "json" | "text",
  dataKind: string,
): AssetPort {
  return { portId, direction, contract: { contractKind, dataKind } };
}

function asset(
  definitionId: string,
  ports: readonly AssetPort[],
  configurationSchema?: AssetConfigurationSchema,
): SystemBuilderComposerAsset {
  return {
    definitionRef: {
      kind: "asset-definition-version",
      id: normalizeAssetId(definitionId),
      version: "2.0.0",
    },
    definitionId,
    version: "2.0.0",
    displayName: definitionId,
    assetType: "ui-component",
    assetFamily: "structural",
    lifecycleStatus: "published",
    builtIn: true,
    configurationSchema,
    defaultConfiguration: { title: "Definition default" },
    ports,
    slots: [],
    compatibility: { status: "compatible" },
    implementationAvailability: "trusted-system-foundation",
    previewAvailability: "trusted-declarative",
  };
}
