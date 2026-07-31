import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { validateAssetDefinition } from "../../asset/validate-asset-definition.service";
import { runAssetPackQualityGates } from "../asset-pack-quality-gates.service";
import { validateAssetPackManifest } from "../asset-pack-validation.service";
import {
  DEFERRED_FORM_PRIMITIVE_IDS,
  FORM_PRIMITIVE_CATALOG,
  FORM_PRIMITIVE_DEFINITIONS,
  FORM_PRIMITIVE_ENTRIES,
  FORM_PRIMITIVE_IDS,
  SYSTEM_FOUNDATION_PACK_ID,
  SYSTEM_FOUNDATION_PACK_MANIFEST,
  SYSTEM_FOUNDATION_PACK_SOURCE_LAYER,
  SYSTEM_FOUNDATION_PACK_VERSION,
} from "../system-packs";

const expectedFieldsById: Record<string, readonly string[]> = {
  "builtin.form.form": [
    "title",
    "description",
    "submitLabel",
    "cancelLabel",
    "submitBehavior",
    "validationMode",
    "layout",
    "showRequiredIndicator",
    "successMessage",
    "errorMessage",
    "accessibilityLabel",
  ],
  "builtin.form.field-group": [
    "title",
    "description",
    "layout",
    "collapsible",
    "defaultExpanded",
    "showGroupValidation",
    "visibilityCondition",
  ],
  "builtin.form.text-field": [
    "label",
    "helpText",
    "placeholder",
    "required",
    "defaultValue",
    "minLength",
    "maxLength",
    "patternHint",
    "autocompleteHint",
    "disabled",
    "visibilityCondition",
    "accessibilityLabel",
  ],
  "builtin.form.number-field": [
    "label",
    "helpText",
    "placeholder",
    "required",
    "defaultValue",
    "minimum",
    "maximum",
    "step",
    "numberFormat",
    "disabled",
    "visibilityCondition",
    "accessibilityLabel",
  ],
  "builtin.form.text-area": [
    "label",
    "helpText",
    "placeholder",
    "required",
    "defaultValue",
    "minLength",
    "maxLength",
    "preferredRows",
    "resizeBehavior",
    "disabled",
    "visibilityCondition",
    "accessibilityLabel",
  ],
  "builtin.form.select-field": [
    "label",
    "helpText",
    "placeholder",
    "required",
    "optionsSource",
    "staticOptions",
    "defaultValue",
    "allowEmpty",
    "disabled",
    "visibilityCondition",
    "accessibilityLabel",
  ],
  "builtin.form.checkbox-field": [
    "label",
    "helpText",
    "defaultChecked",
    "required",
    "disabled",
    "visibilityCondition",
    "accessibilityLabel",
  ],
  "builtin.form.radio-group": [
    "label",
    "helpText",
    "required",
    "optionsSource",
    "staticOptions",
    "defaultValue",
    "layout",
    "disabled",
    "visibilityCondition",
    "accessibilityLabel",
  ],
  "builtin.form.date-time-field": [
    "label",
    "helpText",
    "required",
    "dateTimeKind",
    "defaultValue",
    "minimum",
    "maximum",
    "autocompleteHint",
    "disabled",
    "visibilityCondition",
    "accessibilityLabel",
  ],
  "builtin.form.validation-message": [
    "message",
    "severity",
    "showWhen",
    "fieldRef",
    "summaryMode",
    "accessibilityRole",
  ],
  "builtin.form.submit-action": [
    "label",
    "confirmationRequired",
    "disabledWhenInvalid",
    "successMessage",
    "pendingLabel",
    "accessibilityLabel",
  ],
  "builtin.form.cancel-action": [
    "label",
    "confirmationRequired",
    "resetBehavior",
    "accessibilityLabel",
  ],
};

const expectedPortsById: Record<string, readonly string[]> = {
  "builtin.form.form": [
    "fields",
    "initial-values",
    "validation-state",
    "submitted-values",
    "cancel-requested",
    "validation-requested",
  ],
  "builtin.form.field-group": [
    "fields",
    "visibility-state",
    "group-validation-state",
  ],
  "builtin.form.text-field": [
    "value",
    "disabled-state",
    "validation-state",
    "value-changed",
    "field-blurred",
    "validation-requested",
  ],
  "builtin.form.number-field": [
    "value",
    "disabled-state",
    "validation-state",
    "value-changed",
    "field-blurred",
    "validation-requested",
  ],
  "builtin.form.text-area": [
    "value",
    "disabled-state",
    "validation-state",
    "value-changed",
    "field-blurred",
    "validation-requested",
  ],
  "builtin.form.select-field": [
    "value",
    "disabled-state",
    "validation-state",
    "value-changed",
    "field-blurred",
    "validation-requested",
  ],
  "builtin.form.checkbox-field": [
    "value",
    "disabled-state",
    "validation-state",
    "value-changed",
    "field-blurred",
    "validation-requested",
  ],
  "builtin.form.radio-group": [
    "value",
    "disabled-state",
    "validation-state",
    "value-changed",
    "field-blurred",
    "validation-requested",
  ],
  "builtin.form.date-time-field": [
    "value",
    "disabled-state",
    "validation-state",
    "value-changed",
    "field-blurred",
    "validation-requested",
  ],
  "builtin.form.validation-message": ["validation-state", "field-ref"],
  "builtin.form.submit-action": [
    "form-state",
    "validation-state",
    "submit-requested",
  ],
  "builtin.form.cancel-action": ["form-state", "cancel-requested"],
};

describe("form and field primitives", () => {
  it("publishes stable namespaced IDs and documents deferred primitives", () => {
    assert.deepEqual(FORM_PRIMITIVE_IDS, [
      "builtin.form.form",
      "builtin.form.field-group",
      "builtin.form.text-field",
      "builtin.form.number-field",
      "builtin.form.text-area",
      "builtin.form.select-field",
      "builtin.form.checkbox-field",
      "builtin.form.radio-group",
      "builtin.form.date-time-field",
      "builtin.form.validation-message",
      "builtin.form.submit-action",
      "builtin.form.cancel-action",
    ]);
    assert.deepEqual(DEFERRED_FORM_PRIMITIVE_IDS, [
      "builtin.form.file-upload-field",
    ]);
    assert.deepEqual(
      FORM_PRIMITIVE_CATALOG.deferredPrimitiveIds,
      DEFERRED_FORM_PRIMITIVE_IDS,
    );
  });

  it("creates full asset definitions with system foundation source metadata", () => {
    assert.equal(FORM_PRIMITIVE_DEFINITIONS.length, FORM_PRIMITIVE_IDS.length);
    for (const definition of FORM_PRIMITIVE_DEFINITIONS) {
      assert.match(String(definition.definitionId), /^builtin\.form\.[a-z0-9.-]+$/);
      assert.equal(definition.version, "1.0.0");
      assert.equal(definition.assetType, "ui-component");
      assert.ok(["structural", "composition", "context", "behavioral"].includes(definition.assetFamily));
      assert.equal(definition.lifecycleStatus, "published");
      assert.equal(definition.reviewStatus, "approved");
      assert.equal(definition.provenance.sourceKind, "system-generated");
      assert.ok(definition.displayName);
      assert.ok(definition.description);
      assert.equal(definition.metadata?.sourcePackId, SYSTEM_FOUNDATION_PACK_ID);
      assert.equal(definition.metadata?.sourcePackVersion, SYSTEM_FOUNDATION_PACK_VERSION);
      assert.equal(definition.metadata?.categoryId, "forms-fields");
      assert.equal(definition.metadata?.sourceLayer, SYSTEM_FOUNDATION_PACK_SOURCE_LAYER);
      assert.equal(definition.metadata?.builtIn, true);
    }
  });

  it("passes asset definition validation, pack entry validation, and quality gates", () => {
    assert.equal(validateAssetPackManifest(SYSTEM_FOUNDATION_PACK_MANIFEST).status, "valid");
    for (const entry of FORM_PRIMITIVE_ENTRIES) {
      assert.equal(validateAssetDefinition(entry.definition).status, "valid", entry.entryId);
      const quality = runAssetPackQualityGates(entry);
      assert.equal(quality.status, "valid", messages(quality));
    }
  });

  it("provides meaningful semantic configuration schemas", () => {
    for (const definition of FORM_PRIMITIVE_DEFINITIONS) {
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
          ["enum", "integer", "number", "boolean", "array"].includes(field.valueKind),
        ),
      );
      assert.ok(schema?.fields.every((field) => field.fieldId !== "className"));
    }
  });

  it("declares semantic static option descriptor shape without requiring raw JSON editing", () => {
    for (const definitionId of [
      "builtin.form.select-field",
      "builtin.form.radio-group",
    ]) {
      const definition = FORM_PRIMITIVE_DEFINITIONS.find(
        (candidate) => candidate.definitionId === definitionId,
      );
      assert.ok(definition);
      const staticOptions = definition.configurationSchema?.fields.find(
        (field) => field.fieldId === "staticOptions",
      );
      assert.ok(staticOptions);
      assert.equal(staticOptions.valueKind, "array");
      assert.equal(staticOptions.uiHint?.hintKind, "advanced");
      assert.notEqual(staticOptions.uiHint?.hintKind, "json-editor");
      assert.equal(
        staticOptions.metadata?.semanticItemKind,
        "form-option-descriptor",
      );
      assert.equal(staticOptions.metadata?.itemSchemaStatus, "deferred");
      assert.deepEqual(staticOptions.metadata?.expectedFields, [
        "optionId",
        "label",
        "value",
      ]);
      assert.deepEqual(staticOptions.metadata?.optionalFields, [
        "description",
        "disabled",
      ]);
      assert.equal(staticOptions.metadata?.dynamicFetch, false);
      assert.equal(staticOptions.metadata?.rendererSpecific, false);
      assert.equal(staticOptions.metadata?.executable, false);
      assert.ok(staticOptions.exampleValues?.length);
    }
  });

  it("keeps validation, submission, and file-transfer semantics declarative only", () => {
    for (const definition of FORM_PRIMITIVE_DEFINITIONS) {
      const output = JSON.stringify(definition).toLowerCase();
      assert.match(output, /semantic asset definition|declarative/);
      assert.match(output, /does not|outside this definition/);
      assert.doesNotMatch(output, /validator function|storage write|read file|read bytes|upload route|form engine implementation/i);
    }
  });

  it("provides AI context with required guidance and explicit non-goals", () => {
    for (const definition of FORM_PRIMITIVE_DEFINITIONS) {
      const context = definition.aiContext;
      const output = JSON.stringify(context);
      assert.ok(context?.purpose);
      assert.ok(context?.userFacingSummary);
      assert.match(context?.developerFacingSummary ?? "", /semantic asset definition/i);
      assert.match(context?.developerFacingSummary ?? "", /not a concrete renderer component/i);
      assert.match(context?.developerFacingSummary ?? "", /not.*validation engine/i);
      assert.ok(context?.configurationGuidance?.summary);
      assert.ok(context?.compositionGuidance?.summary);
      assert.ok(context?.capabilities?.length);
      assert.ok(context?.limitations?.length);
      assert.match(output, /does not render pixels/i);
      assert.match(output, /does not.*validate values/i);
      assert.match(output, /does not.*submit records/i);
      assert.match(output, /does not.*write storage/i);
      assert.deepEqual(context?.metadata?.sectionIds, [
        "purpose",
        "use-cases",
        "configuration-guidance",
        "composition-guidance",
        "validation-guidance",
        "accessibility-guidance",
        "non-goals",
      ]);
    }
  });

  it("declares semantic ports and composition rules where expected", () => {
    for (const definition of FORM_PRIMITIVE_DEFINITIONS) {
      const expectedPorts = expectedPortsById[String(definition.definitionId)];
      assert.ok(expectedPorts);
      assert.deepEqual(definition.ports?.map((port) => port.portId), expectedPorts);
      assert.ok(definition.ports?.every((port) => port.contract));
      assert.ok((definition.compositionRules?.length ?? 0) >= 1);
      assert.ok(
        definition.compositionRules?.some((rule) =>
          ["allowed-parent", "allowed-child", "optional-child", "cardinality"].includes(rule.ruleKind),
        ),
      );
    }
  });

  it("connects form composition to existing UI structural primitives", () => {
    const form = FORM_PRIMITIVE_DEFINITIONS.find(
      (definition) => definition.definitionId === "builtin.form.form",
    );
    assert.ok(form);
    const output = JSON.stringify(form.compositionRules);
    for (const uiDefinitionId of [
      "builtin.ui.container",
      "builtin.ui.section",
      "builtin.ui.panel",
      "builtin.ui.card",
      "builtin.ui.stack",
      "builtin.ui.grid",
      "builtin.ui.tabs",
      "builtin.ui.collapsible-section",
    ]) {
      assert.match(output, new RegExp(uiDefinitionId.replaceAll(".", "\\.")));
    }
  });

  it("keeps entries in the forms-fields category with safe source metadata", () => {
    for (const entry of FORM_PRIMITIVE_ENTRIES) {
      const sourcePack = entry.metadata?.sourcePack as
        | { readonly packId?: string; readonly version?: string }
        | undefined;
      assert.equal(entry.category, "forms-fields");
      assert.equal(entry.sourceLayer, "system-default");
      assert.equal(sourcePack?.packId, "system.foundation");
      assert.equal(sourcePack?.version, "1.0.0");
      assert.match(entry.entryId, /^system\.foundation\.form\.[a-z0-9.-]+$/);
      assert.match(entry.fingerprint, /^fnv1a:[a-f0-9]{8}$/);
      assert.deepEqual(entry.definitionRef, {
        kind: "asset-definition-version",
        id: entry.definition.definitionId,
        version: "1.0.0",
        label: entry.definition.displayName,
      });
    }
  });

  it("contains no renderer details, unsafe payloads, or behavior surfaces", () => {
    const output = JSON.stringify(FORM_PRIMITIVE_ENTRIES).toLowerCase();
    for (const forbidden of [
      "react",
      "tsx",
      "jsx",
      "css module",
      "renderer file",
      "component path",
      "implementation path",
      "dom node",
      "html",
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

  it("declares no runtime, provider, network, storage, filesystem, or upload requirements", () => {
    for (const definition of FORM_PRIMITIVE_DEFINITIONS) {
      for (const requirement of definition.requirements ?? []) {
        assert.notEqual(requirement.requirementKind, "runtime-capability");
        assert.notEqual(requirement.requirementKind, "network-access");
        assert.notEqual(requirement.requirementKind, "filesystem-access");
        assert.notEqual(requirement.requirementKind, "secret-access");
        assert.notEqual(requirement.requirementKind, "external-provider");
        assert.notEqual(requirement.requirementKind, "resource");
        assert.equal(requirement.permissionKind, undefined);
      }
    }
  });

  it("is JSON-serializable", () => {
    assert.deepEqual(
      JSON.parse(JSON.stringify(FORM_PRIMITIVE_CATALOG)),
      FORM_PRIMITIVE_CATALOG,
    );
  });
});

function messages(result: { readonly issues: readonly { readonly message: string }[] }): string {
  return result.issues.map((issue) => issue.message).join("\n");
}
