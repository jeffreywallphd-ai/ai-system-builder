import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { validateAssetDefinition } from "../../asset/validate-asset-definition.service";
import { runAssetPackQualityGates } from "../asset-pack-quality-gates.service";
import { validateAssetPackManifest } from "../asset-pack-validation.service";
import {
  DEFERRED_UI_STRUCTURAL_PRIMITIVE_IDS,
  SYSTEM_FOUNDATION_PACK_ID,
  SYSTEM_FOUNDATION_PACK_MANIFEST,
  SYSTEM_FOUNDATION_PACK_SOURCE_LAYER,
  SYSTEM_FOUNDATION_PACK_VERSION,
  UI_STRUCTURAL_PRIMITIVE_CATALOG,
  UI_STRUCTURAL_PRIMITIVE_DEFINITIONS,
  UI_STRUCTURAL_PRIMITIVE_ENTRIES,
  UI_STRUCTURAL_PRIMITIVE_IDS,
} from "../system-packs";

const expectedFieldsById: Record<string, readonly string[]> = {
  "builtin.ui.container": [
    "label",
    "layoutDirection",
    "spacing",
    "padding",
    "widthBehavior",
    "visibilityCondition",
    "accessibilityLabel",
  ],
  "builtin.ui.section": [
    "title",
    "description",
    "collapsible",
    "defaultExpanded",
    "spacing",
    "visibilityCondition",
  ],
  "builtin.ui.panel": [
    "title",
    "description",
    "variant",
    "emphasis",
    "padding",
    "actionsPlacement",
  ],
  "builtin.ui.card": [
    "title",
    "description",
    "mediaPlacement",
    "emphasis",
    "clickBehavior",
    "padding",
  ],
  "builtin.ui.stack": [
    "direction",
    "spacing",
    "alignment",
    "wrap",
    "responsiveBehavior",
  ],
  "builtin.ui.grid": [
    "columnCount",
    "gap",
    "responsiveBehavior",
    "itemAlignment",
  ],
  "builtin.ui.tabs": [
    "orientation",
    "defaultTab",
    "activationMode",
    "showTabListLabel",
  ],
  "builtin.ui.collapsible-section": [
    "title",
    "defaultExpanded",
    "allowMultipleOpen",
    "summary",
    "accessibilityLabel",
  ],
};

const expectedPortsById: Record<string, readonly string[]> = {
  "builtin.ui.container": ["children", "visibility-state"],
  "builtin.ui.section": ["children", "visibility-state"],
  "builtin.ui.panel": ["children"],
  "builtin.ui.card": ["children"],
  "builtin.ui.stack": ["children", "layout-items"],
  "builtin.ui.grid": ["children", "layout-items"],
  "builtin.ui.tabs": ["tab-items", "active-tab", "active-tab-changed"],
  "builtin.ui.collapsible-section": [
    "expanded-state",
    "children",
    "expanded-state-changed",
  ],
};

describe("UI structural primitives", () => {
  it("publishes the selected stable namespaced IDs and documents deferred structure primitives", () => {
    assert.deepEqual(UI_STRUCTURAL_PRIMITIVE_IDS, [
      "builtin.ui.container",
      "builtin.ui.section",
      "builtin.ui.panel",
      "builtin.ui.card",
      "builtin.ui.stack",
      "builtin.ui.grid",
      "builtin.ui.tabs",
      "builtin.ui.collapsible-section",
    ]);
    assert.deepEqual(DEFERRED_UI_STRUCTURAL_PRIMITIVE_IDS, [
      "builtin.ui.dialog",
      "builtin.ui.drawer",
      "builtin.ui.toolbar",
      "builtin.ui.navigation-item",
    ]);
    assert.deepEqual(
      UI_STRUCTURAL_PRIMITIVE_CATALOG.deferredPrimitiveIds,
      DEFERRED_UI_STRUCTURAL_PRIMITIVE_IDS,
    );
  });

  it("creates full asset definitions with source pack metadata", () => {
    assert.equal(UI_STRUCTURAL_PRIMITIVE_DEFINITIONS.length, UI_STRUCTURAL_PRIMITIVE_IDS.length);
    for (const definition of UI_STRUCTURAL_PRIMITIVE_DEFINITIONS) {
      assert.match(String(definition.definitionId), /^builtin\.ui\.[a-z0-9.-]+$/);
      assert.equal(definition.version, "1.0.0");
      assert.equal(definition.assetType, "ui-component");
      assert.equal(definition.assetFamily, "structural");
      assert.equal(definition.lifecycleStatus, "published");
      assert.equal(definition.reviewStatus, "approved");
      assert.equal(definition.provenance.sourceKind, "system-generated");
      assert.ok(definition.displayName);
      assert.ok(definition.description);
      assert.equal(definition.metadata?.sourcePackId, SYSTEM_FOUNDATION_PACK_ID);
      assert.equal(definition.metadata?.sourcePackVersion, SYSTEM_FOUNDATION_PACK_VERSION);
      assert.equal(definition.metadata?.categoryId, "ui-structure");
      assert.equal(definition.metadata?.sourceLayer, SYSTEM_FOUNDATION_PACK_SOURCE_LAYER);
      assert.equal(definition.metadata?.builtIn, true);
    }
  });

  it("passes asset definition validation, pack entry validation, and quality gates", () => {
    assert.equal(validateAssetPackManifest(SYSTEM_FOUNDATION_PACK_MANIFEST).status, "valid");
    for (const entry of UI_STRUCTURAL_PRIMITIVE_ENTRIES) {
      assert.equal(validateAssetDefinition(entry.definition).status, "valid", entry.entryId);
      const quality = runAssetPackQualityGates(entry);
      assert.equal(quality.status, "valid", messages(quality));
    }
  });

  it("provides meaningful semantic configuration schemas", () => {
    for (const definition of UI_STRUCTURAL_PRIMITIVE_DEFINITIONS) {
      const expectedFields = expectedFieldsById[String(definition.definitionId)];
      assert.ok(expectedFields, String(definition.definitionId));
      const schema = definition.configurationSchema;
      assert.ok(schema);
      assert.equal(schema?.strict, true);
      assert.ok((schema?.fields.length ?? 0) >= 4);
      assert.deepEqual(schema?.fields.map((field) => field.fieldId), expectedFields);
      assert.deepEqual(Object.keys(definition.defaultConfiguration ?? {}), expectedFields);
      assert.ok(
        schema?.fields.some((field) =>
          ["enum", "integer", "boolean"].includes(field.valueKind),
        ),
      );
      assert.ok(schema?.fields.every((field) => !String(field.defaultValue).includes("{")));
    }
  });

  it("provides AI context with required guidance and explicit non-goals", () => {
    for (const definition of UI_STRUCTURAL_PRIMITIVE_DEFINITIONS) {
      const context = definition.aiContext;
      assert.ok(context?.purpose);
      assert.ok(context?.userFacingSummary);
      assert.match(context?.developerFacingSummary ?? "", /semantic asset definition/i);
      assert.match(context?.developerFacingSummary ?? "", /not a concrete renderer component/i);
      assert.ok(context?.configurationGuidance?.summary);
      assert.ok(context?.compositionGuidance?.summary);
      assert.ok(context?.capabilities?.length);
      assert.ok(context?.limitations?.length);
      assert.match(JSON.stringify(context), /Does not render pixels/i);
      assert.doesNotMatch(JSON.stringify(context), /runtime execution|workflow json|prompt text/i);
      assert.deepEqual(context?.metadata?.sectionIds, [
        "purpose",
        "use-cases",
        "configuration-guidance",
        "composition-guidance",
        "accessibility-guidance",
        "non-goals",
      ]);
    }
  });

  it("declares semantic ports and composition rules where expected", () => {
    for (const definition of UI_STRUCTURAL_PRIMITIVE_DEFINITIONS) {
      const expectedPorts = expectedPortsById[String(definition.definitionId)];
      assert.ok(expectedPorts);
      assert.deepEqual(definition.ports?.map((port) => port.portId), expectedPorts);
      assert.ok(definition.ports?.every((port) => port.contract));
      assert.ok((definition.compositionRules?.length ?? 0) >= 1);
      assert.ok(
        definition.compositionRules?.some((rule) =>
          ["allowed-child", "cardinality"].includes(rule.ruleKind),
        ),
      );
    }
  });

  it("keeps entries in the system foundation pack category with safe source metadata", () => {
    for (const entry of UI_STRUCTURAL_PRIMITIVE_ENTRIES) {
      const sourcePack = entry.metadata?.sourcePack as
        | { readonly packId?: string; readonly version?: string }
        | undefined;
      assert.equal(entry.category, "ui-structure");
      assert.equal(entry.sourceLayer, "system-default");
      assert.equal(sourcePack?.packId, "system.foundation");
      assert.equal(sourcePack?.version, "1.0.0");
      assert.match(entry.fingerprint, /^fnv1a:[a-f0-9]{8}$/);
      assert.deepEqual(entry.definitionRef, {
        kind: "asset-definition-version",
        id: entry.definition.definitionId,
        version: "1.0.0",
        label: entry.definition.displayName,
      });
    }
  });

  it("contains no renderer implementation leakage, unsafe payloads, or behavior surfaces", () => {
    const output = JSON.stringify(UI_STRUCTURAL_PRIMITIVE_ENTRIES).toLowerCase();
    for (const forbidden of [
      "react",
      "tsx",
      "jsx",
      "css module",
      "renderer file",
      "component path",
      "implementation path",
      "dom node",
      "localpath",
      "filesystempath",
      "token",
      "secret",
      "signedurl",
      "providerpayload",
      "rawpayload",
      "bytes",
      "blob",
      "base64",
      "workflowjson",
      "prompt text",
      "resource content",
      "routehandler",
      "installstatus",
      "marketplace",
    ]) {
      assert.equal(output.includes(forbidden), false, forbidden);
    }
  });

  it("declares no runtime, provider, network, storage, or filesystem requirements", () => {
    for (const definition of UI_STRUCTURAL_PRIMITIVE_DEFINITIONS) {
      for (const requirement of definition.requirements ?? []) {
        assert.notEqual(requirement.requirementKind, "runtime-capability");
        assert.notEqual(requirement.requirementKind, "network-access");
        assert.notEqual(requirement.requirementKind, "filesystem-access");
        assert.notEqual(requirement.requirementKind, "secret-access");
        assert.notEqual(requirement.requirementKind, "external-provider");
        assert.equal(requirement.permissionKind, undefined);
      }
    }
  });

  it("is JSON-serializable", () => {
    assert.deepEqual(
      JSON.parse(JSON.stringify(UI_STRUCTURAL_PRIMITIVE_CATALOG)),
      UI_STRUCTURAL_PRIMITIVE_CATALOG,
    );
  });
});

function messages(result: { readonly issues: readonly { readonly message: string }[] }): string {
  return result.issues.map((issue) => issue.message).join("\n");
}
