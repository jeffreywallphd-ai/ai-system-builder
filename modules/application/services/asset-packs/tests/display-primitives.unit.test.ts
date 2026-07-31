import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { validateAssetDefinition } from "../../asset/validate-asset-definition.service";
import { runAssetPackQualityGates } from "../asset-pack-quality-gates.service";
import { validateAssetPackManifest } from "../asset-pack-validation.service";
import {
  ALL_DISPLAY_STATE_MESSAGE_PRIMITIVE_IDS,
  DISPLAY_PRIMITIVE_CATALOG,
  DISPLAY_PRIMITIVE_DEFINITIONS,
  DISPLAY_PRIMITIVE_ENTRIES,
  DISPLAY_PRIMITIVE_IDS,
  STATE_MESSAGE_PRIMITIVE_IDS,
  SYSTEM_FOUNDATION_PACK_ID,
  SYSTEM_FOUNDATION_PACK_MANIFEST,
  SYSTEM_FOUNDATION_PACK_SOURCE_LAYER,
  SYSTEM_FOUNDATION_PACK_VERSION,
} from "../system-packs";

const expectedFieldsById: Record<string, readonly string[]> = {
  "builtin.display.table": [
    "title",
    "description",
    "columns",
    "rowIdentityField",
    "emptyStateMessage",
    "loadingStateMessage",
    "errorStateMessage",
    "selectionMode",
    "density",
    "sortBehavior",
    "paginationBehavior",
    "accessibilityLabel",
  ],
  "builtin.display.list": [
    "title",
    "description",
    "itemTitleField",
    "itemSummaryField",
    "itemMetadataFields",
    "emptyStateMessage",
    "selectionMode",
    "layout",
    "accessibilityLabel",
  ],
  "builtin.display.detail-view": [
    "title",
    "description",
    "sections",
    "primaryField",
    "summaryFields",
    "metadataFields",
    "emptyStateMessage",
    "accessibilityLabel",
  ],
  "builtin.display.key-value-summary": [
    "title",
    "description",
    "fields",
    "emptyValueDisplay",
    "layout",
    "accessibilityLabel",
  ],
  "builtin.display.status-badge": [
    "label",
    "status",
    "tone",
    "description",
    "showIconHint",
    "accessibilityLabel",
  ],
  "builtin.display.progress-indicator": [
    "label",
    "progressKind",
    "currentValue",
    "maximumValue",
    "showPercent",
    "description",
    "accessibilityLabel",
  ],
  "builtin.display.image-preview-placeholder": [
    "title",
    "description",
    "altText",
    "emptyStateMessage",
    "unavailableMessage",
    "previewIntent",
    "accessibilityLabel",
  ],
  "builtin.display.resource-preview-placeholder": [
    "title",
    "description",
    "resourceKind",
    "emptyStateMessage",
    "unavailableMessage",
    "previewIntent",
    "accessibilityLabel",
  ],
  "builtin.state.empty-state": [
    "title",
    "message",
    "suggestedActionLabel",
    "tone",
    "accessibilityLabel",
  ],
  "builtin.state.loading-state": [
    "message",
    "progressKind",
    "showSkeletonHint",
    "accessibilityLabel",
  ],
  "builtin.state.error-state": [
    "title",
    "message",
    "severity",
    "retryLabel",
    "supportingActionLabel",
    "accessibilityLabel",
  ],
  "builtin.state.success-message": [
    "title",
    "message",
    "dismissible",
    "tone",
    "accessibilityLabel",
  ],
};

const expectedPortsById: Record<string, readonly string[]> = {
  "builtin.display.table": [
    "rows",
    "columns",
    "selection-state",
    "loading-state",
    "error-state",
    "row-selected",
    "sort-requested",
    "page-requested",
  ],
  "builtin.display.list": [
    "items",
    "selection-state",
    "loading-state",
    "error-state",
    "item-selected",
  ],
  "builtin.display.detail-view": [
    "record",
    "loading-state",
    "error-state",
    "field-action-requested",
  ],
  "builtin.display.key-value-summary": ["record", "fields"],
  "builtin.display.status-badge": ["status"],
  "builtin.display.progress-indicator": ["progress-value", "progress-state"],
  "builtin.display.image-preview-placeholder": [
    "resource-reference",
    "preview-state",
    "preview-requested",
  ],
  "builtin.display.resource-preview-placeholder": [
    "resource-reference",
    "preview-state",
    "preview-requested",
  ],
  "builtin.state.empty-state": ["state", "action-requested"],
  "builtin.state.loading-state": ["state"],
  "builtin.state.error-state": ["state", "retry-requested"],
  "builtin.state.success-message": ["state", "dismissed"],
};

const unsafePositiveBehaviorClaims = [
  /\bfetch records\b/i,
  /\bfetch data\b/i,
  /\bread file\b/i,
  /\bread resource\b/i,
  /\bread storage\b/i,
  /\bwrite storage\b/i,
  /\bwrite file\b/i,
  /\bsubmit data\b/i,
  /\bsave data\b/i,
  /\brun validation\b/i,
  /\bvalidate data\b/i,
  /\bexecute workflow\b/i,
  /\brun workflow\b/i,
  /\bstart runtime\b/i,
  /\bcreate task\b/i,
  /\bschedule job\b/i,
  /\bcall provider\b/i,
  /\bcall API\b/i,
  /\binvoke IPC\b/i,
  /\bdownload\b/i,
  /\bupload\b/i,
  /\brender preview\b/i,
  /\bdecode image\b/i,
  /\bopen file\b/i,
] as const;

describe("data display, state, and message primitives", () => {
  it("publishes stable namespaced IDs for display and state/message primitives", () => {
    assert.deepEqual(DISPLAY_PRIMITIVE_IDS, [
      "builtin.display.table",
      "builtin.display.list",
      "builtin.display.detail-view",
      "builtin.display.key-value-summary",
      "builtin.display.status-badge",
      "builtin.display.progress-indicator",
      "builtin.display.image-preview-placeholder",
      "builtin.display.resource-preview-placeholder",
    ]);
    assert.deepEqual(STATE_MESSAGE_PRIMITIVE_IDS, [
      "builtin.state.empty-state",
      "builtin.state.loading-state",
      "builtin.state.error-state",
      "builtin.state.success-message",
    ]);
    assert.deepEqual(ALL_DISPLAY_STATE_MESSAGE_PRIMITIVE_IDS, [
      ...DISPLAY_PRIMITIVE_IDS,
      ...STATE_MESSAGE_PRIMITIVE_IDS,
    ]);
    assert.deepEqual(DISPLAY_PRIMITIVE_CATALOG.deferredPrimitiveIds, []);
  });

  it("creates full asset definitions with source pack metadata", () => {
    assert.equal(
      DISPLAY_PRIMITIVE_DEFINITIONS.length,
      ALL_DISPLAY_STATE_MESSAGE_PRIMITIVE_IDS.length,
    );
    for (const definition of DISPLAY_PRIMITIVE_DEFINITIONS) {
      assert.match(
        String(definition.definitionId),
        /^builtin\.(?:display|state)\.[a-z0-9.-]+$/,
      );
      assert.equal(definition.version, "1.0.0");
      assert.equal(definition.assetType, "ui-component");
      assert.ok(["structural", "composition", "context"].includes(definition.assetFamily));
      assert.equal(definition.lifecycleStatus, "published");
      assert.equal(definition.reviewStatus, "approved");
      assert.equal(definition.provenance.sourceKind, "system-generated");
      assert.ok(definition.displayName);
      assert.ok(definition.description);
      assert.equal(definition.metadata?.sourcePackId, SYSTEM_FOUNDATION_PACK_ID);
      assert.equal(definition.metadata?.sourcePackVersion, SYSTEM_FOUNDATION_PACK_VERSION);
      assert.equal(definition.metadata?.sourceLayer, SYSTEM_FOUNDATION_PACK_SOURCE_LAYER);
      assert.equal(definition.metadata?.builtIn, true);
      assert.ok(["data-display", "state-messages"].includes(String(definition.metadata?.categoryId)));
    }
  });

  it("passes asset definition validation, pack entry validation, and quality gates", () => {
    assert.equal(validateAssetPackManifest(SYSTEM_FOUNDATION_PACK_MANIFEST).status, "valid");
    for (const entry of DISPLAY_PRIMITIVE_ENTRIES) {
      assert.equal(validateAssetDefinition(entry.definition).status, "valid", entry.entryId);
      const quality = runAssetPackQualityGates(entry);
      assert.equal(quality.status, "valid", messages(quality));
    }
  });

  it("provides meaningful semantic configuration schemas", () => {
    for (const definition of DISPLAY_PRIMITIVE_DEFINITIONS) {
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
          ["enum", "number", "boolean", "array"].includes(field.valueKind),
        ),
      );
      assert.equal(schema?.fields.some((field) => field.fieldId === "className"), false);
      assert.equal(schema?.fields.some((field) => field.fieldId === "endpoint"), false);
      assert.equal(schema?.fields.some((field) => field.fieldId === "query"), false);
    }
  });

  it("keeps table, list, detail, and preview fields declarative only", () => {
    for (const definitionId of [
      "builtin.display.table",
      "builtin.display.list",
      "builtin.display.detail-view",
      "builtin.display.image-preview-placeholder",
      "builtin.display.resource-preview-placeholder",
    ]) {
      const definition = DISPLAY_PRIMITIVE_DEFINITIONS.find(
        (candidate) => candidate.definitionId === definitionId,
      );
      assert.ok(definition);
      const output = JSON.stringify(definition).toLowerCase();
      assert.match(output, /semantic asset definition|declarative/);
      assert.match(output, /does not fetch data/i);
      assert.match(output, /read storage/i);
      assert.match(output, /preview rendering/i);
      assert.doesNotMatch(output, /sql|graphql|endpoint|handler|encoded content|reader implementation/i);
    }
  });

  it("does not contain positive execution, transfer, resource-read, or preview-rendering claims", () => {
    for (const definition of DISPLAY_PRIMITIVE_DEFINITIONS) {
      const output = JSON.stringify(definition);
      for (const unsafePattern of unsafePositiveBehaviorClaims) {
        const matches = output.match(new RegExp(unsafePattern.source, "gi")) ?? [];
        for (const match of matches) {
          assert.equal(
            isSafeNonGoalContext(output, match),
            true,
            `${definition.definitionId} contains unsafe claim: ${match}`,
          );
        }
      }
    }
  });

  it("provides AI context with required sections and explicit non-goals", () => {
    for (const definition of DISPLAY_PRIMITIVE_DEFINITIONS) {
      const context = definition.aiContext;
      const output = JSON.stringify(context);
      assert.ok(context?.purpose);
      assert.ok(context?.userFacingSummary);
      assert.match(context?.developerFacingSummary ?? "", /semantic asset definition/i);
      assert.match(context?.developerFacingSummary ?? "", /not a concrete renderer component/i);
      assert.match(context?.developerFacingSummary ?? "", /not.*preview renderer/i);
      assert.ok(context?.configurationGuidance?.summary);
      assert.ok(context?.compositionGuidance?.summary);
      assert.ok(context?.capabilities?.length);
      assert.ok(context?.limitations?.length);
      assert.match(output, /Does not fetch data/i);
      assert.match(output, /read storage/i);
      assert.match(output, /workflow execution/i);
      assert.deepEqual(context?.metadata?.sectionIds, [
        "purpose",
        "use-cases",
        "configuration-guidance",
        "composition-guidance",
        "state-guidance",
        "accessibility-guidance",
        "non-goals",
      ]);
    }
  });

  it("declares expected semantic ports and composition rules", () => {
    for (const definition of DISPLAY_PRIMITIVE_DEFINITIONS) {
      const expectedPorts = expectedPortsById[String(definition.definitionId)];
      assert.ok(expectedPorts);
      assert.deepEqual(definition.ports?.map((port) => port.portId), expectedPorts);
      assert.ok(definition.ports?.every((port) => port.contract));
      assert.ok((definition.compositionRules?.length ?? 0) >= 1);
      assert.ok(
        definition.compositionRules?.some((rule) =>
          ["allowed-parent", "optional-child", "cardinality"].includes(rule.ruleKind),
        ),
      );
    }
  });

  it("keeps preview placeholders placeholder-only", () => {
    for (const definitionId of [
      "builtin.display.image-preview-placeholder",
      "builtin.display.resource-preview-placeholder",
    ]) {
      const definition = DISPLAY_PRIMITIVE_DEFINITIONS.find(
        (candidate) => candidate.definitionId === definitionId,
      );
      assert.ok(definition);
      assert.deepEqual(definition.ports?.map((port) => port.portId), [
        "resource-reference",
        "preview-state",
        "preview-requested",
      ]);
      assert.deepEqual(
        definition.ports?.map((port) => port.contract?.dataKind),
        ["semantic-resource-reference", "semantic-preview-state", "semantic-preview-event"],
      );
      const output = JSON.stringify(definition);
      assert.match(output, /placeholder/i);
      assert.match(output, /does not read/i);
      assert.match(output, /rendering.*outside this definition|without rendering content/i);
      assert.doesNotMatch(output, /https?:\/\/|file:\/\/|data:image|base64|byte|encoded content/i);
      assert.doesNotMatch(output, /\b(?:path|url|uri)\b/i);
    }
  });

  it("connects display and state composition to UI structural and form primitives", () => {
    const displayOutput = JSON.stringify(
      DISPLAY_PRIMITIVE_DEFINITIONS.find(
        (definition) => definition.definitionId === "builtin.display.table",
      )?.compositionRules,
    );
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
      assert.match(displayOutput, new RegExp(uiDefinitionId.replaceAll(".", "\\.")));
    }

    const stateOutput = JSON.stringify(
      DISPLAY_PRIMITIVE_DEFINITIONS.find(
        (definition) => definition.definitionId === "builtin.state.empty-state",
      )?.compositionRules,
    );
    for (const definitionId of [
      "builtin.form.form",
      "builtin.form.field-group",
      "builtin.display.table",
      "builtin.display.list",
      "builtin.display.detail-view",
      "builtin.display.key-value-summary",
    ]) {
      assert.match(stateOutput, new RegExp(definitionId.replaceAll(".", "\\.")));
    }
  });

  it("keeps entries in data-display or state-messages categories with safe source metadata", () => {
    for (const entry of DISPLAY_PRIMITIVE_ENTRIES) {
      const sourcePack = entry.metadata?.sourcePack as
        | { readonly packId?: string; readonly version?: string }
        | undefined;
      assert.ok(["data-display", "state-messages"].includes(entry.category));
      assert.equal(entry.sourceLayer, "system-default");
      assert.equal(sourcePack?.packId, "system.foundation");
      assert.equal(sourcePack?.version, "1.0.0");
      assert.match(entry.entryId, /^system\.foundation\.(?:display|state)\.[a-z0-9.-]+$/);
      assert.match(entry.fingerprint, /^fnv1a:[a-f0-9]{8}$/);
      assert.deepEqual(entry.definitionRef, {
        kind: "asset-definition-version",
        id: entry.definition.definitionId,
        version: "1.0.0",
        label: entry.definition.displayName,
      });
    }
  });

  it("contains no renderer details, payloads, routes, queries, or behavior surfaces", () => {
    const output = JSON.stringify(DISPLAY_PRIMITIVE_ENTRIES).toLowerCase();
    for (const forbidden of [
      "react",
      "tsx",
      "jsx",
      "css module",
      "renderer file",
      "component path",
      "implementation path",
      "dom node",
      "classname",
      "localpath",
      "filesystempath",
      "token",
      "secret",
      "signedurl",
      "providerpayload",
      "rawpayload",
      "base64",
      "workflowjson",
      "prompt text",
      "routehandler",
      "installstatus",
      "marketplace",
      "sql",
      "graphql",
    ]) {
      assert.equal(output.includes(forbidden), false, forbidden);
    }
  });

  it("declares no runtime, provider, network, storage, filesystem, or resource read requirements", () => {
    for (const definition of DISPLAY_PRIMITIVE_DEFINITIONS) {
      for (const requirement of definition.requirements ?? []) {
        assert.notEqual(requirement.requirementKind, "runtime-capability");
        assert.notEqual(requirement.requirementKind, "network-access");
        assert.notEqual(requirement.requirementKind, "filesystem-access");
        assert.notEqual(requirement.requirementKind, "secret-access");
        assert.notEqual(requirement.requirementKind, "external-provider");
        assert.notEqual(requirement.requirementKind, "resource");
        assert.notEqual(requirement.requirementKind, "artifact");
        assert.equal(requirement.permissionKind, undefined);
      }
    }
  });

  it("keeps state/message primitives from implying workflow execution", () => {
    const output = JSON.stringify(
      DISPLAY_PRIMITIVE_DEFINITIONS.filter((definition) =>
        String(definition.definitionId).startsWith("builtin.state."),
      ),
    ).toLowerCase();
    assert.match(output, /declarative event/);
    assert.doesNotMatch(output, /workflow runner|execute workflow|run workflow|handler implementation/);
  });

  it("is JSON-serializable", () => {
    assert.deepEqual(
      JSON.parse(JSON.stringify(DISPLAY_PRIMITIVE_CATALOG)),
      DISPLAY_PRIMITIVE_CATALOG,
    );
  });
});

function messages(result: { readonly issues: readonly { readonly message: string }[] }): string {
  return result.issues.map((issue) => issue.message).join("\n");
}

function isSafeNonGoalContext(output: string, match: string): boolean {
  const index = output.toLowerCase().indexOf(match.toLowerCase());
  if (index < 0) return true;
  const context = output.slice(Math.max(0, index - 80), index + match.length + 80);
  return /\b(?:does not|do not|without|outside|deferred|not implemented by this definition)\b/i.test(context);
}
