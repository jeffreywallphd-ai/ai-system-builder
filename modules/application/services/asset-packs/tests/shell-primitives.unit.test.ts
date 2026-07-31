import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { validateAssetDefinition } from "../../asset/validate-asset-definition.service";
import { runAssetPackQualityGates } from "../asset-pack-quality-gates.service";
import { validateAssetPackManifest } from "../asset-pack-validation.service";
import {
  ALL_SHELL_PRIMITIVE_IDS,
  PAGE_FEATURE_SHELL_PRIMITIVE_IDS,
  SHELL_PRIMITIVE_CATALOG,
  SHELL_PRIMITIVE_DEFINITIONS,
  SHELL_PRIMITIVE_ENTRIES,
  SYSTEM_FOUNDATION_PACK_ID,
  SYSTEM_FOUNDATION_PACK_MANIFEST,
  SYSTEM_FOUNDATION_PACK_SOURCE_LAYER,
  SYSTEM_FOUNDATION_PACK_VERSION,
  WORKFLOW_SYSTEM_SHELL_PRIMITIVE_IDS,
} from "../system-packs";

const expectedFieldsById: Record<string, readonly string[]> = {
  "builtin.shell.page": ["title", "description", "primaryPurpose", "defaultLayout", "navigationLabel", "emptyStateMessage", "accessibilityLabel"],
  "builtin.shell.feature": ["title", "description", "featurePurpose", "defaultSections", "primaryActions", "statusBehavior", "accessibilityLabel"],
  "builtin.shell.dashboard-section": ["title", "description", "summaryIntent", "refreshHint", "emptyStateMessage", "accessibilityLabel"],
  "builtin.shell.settings-panel": ["title", "description", "settingsGroup", "changeSummaryBehavior", "validationSummaryBehavior", "accessibilityLabel"],
  "builtin.shell.resource-browser": ["title", "description", "resourceKind", "listDisplayMode", "filterBehavior", "selectionMode", "emptyStateMessage", "accessibilityLabel"],
  "builtin.shell.detail-page": ["title", "description", "primaryResourceKind", "summaryFields", "detailSections", "actionsPlacement", "accessibilityLabel"],
  "builtin.shell.wizard-step": ["title", "description", "stepPurpose", "stepOrderHint", "canSkip", "validationSummaryBehavior", "nextLabel", "backLabel", "accessibilityLabel"],
  "builtin.shell.navigation-group": ["label", "description", "displayOrder", "collapsible", "accessibilityLabel"],
  "builtin.workflow.workflow": ["title", "description", "workflowPurpose", "expectedInputs", "expectedOutputs", "reviewRequired", "declarativeStatus", "nonRunningNotice"],
  "builtin.workflow.step": ["title", "description", "stepPurpose", "inputSummary", "outputSummary", "reviewRequired", "nonRunningNotice"],
  "builtin.workflow.input-step": ["title", "description", "inputKind", "requiredInputs", "validationSummary", "nonRunningNotice"],
  "builtin.workflow.transform-step": ["title", "description", "transformIntent", "inputSummary", "outputSummary", "nonRunningNotice"],
  "builtin.workflow.validation-step": ["title", "description", "validationIntent", "severityBehavior", "reviewGuidance", "nonRunningNotice"],
  "builtin.workflow.approval-step": ["title", "description", "approvalPurpose", "requiredActorKind", "approvalSummary", "nonRunningNotice"],
  "builtin.workflow.output-step": ["title", "description", "outputKind", "deliveryIntent", "reviewGuidance", "nonRunningNotice"],
  "builtin.system.system": ["title", "description", "systemPurpose", "primaryUsers", "majorCapabilities", "includedSubsystems", "nonRunningNotice"],
  "builtin.system.subsystem": ["title", "description", "subsystemPurpose", "ownedCapabilities", "dependencies", "nonRunningNotice"],
  "builtin.system.policy-check": ["title", "description", "policyPurpose", "severity", "reviewGuidance", "nonRunningNotice"],
  "builtin.system.test-check": ["title", "description", "testPurpose", "expectedBehavior", "reviewGuidance", "nonRunningNotice"],
};

const expectedPortsById: Record<string, readonly string[]> = {
  "builtin.shell.page": ["page-content", "navigation-context", "navigation-requested"],
  "builtin.shell.feature": ["feature-content", "feature-state", "feature-action-requested"],
  "builtin.shell.dashboard-section": ["section-content"],
  "builtin.shell.settings-panel": ["settings-content"],
  "builtin.shell.resource-browser": ["resource-list", "filter-state", "selection-state", "resource-selected", "filter-changed"],
  "builtin.shell.detail-page": ["resource-detail", "action-state", "detail-action-requested"],
  "builtin.shell.wizard-step": ["step-content", "step-state", "next-requested", "back-requested", "skip-requested"],
  "builtin.shell.navigation-group": ["navigation-items"],
  "builtin.workflow.workflow": ["workflow-inputs", "workflow-steps", "workflow-outputs", "workflow-review-requested"],
  "builtin.workflow.step": ["step-input", "step-context", "step-output", "step-review-requested"],
  "builtin.workflow.input-step": ["step-input", "step-context", "step-output", "step-review-requested"],
  "builtin.workflow.transform-step": ["step-input", "step-context", "step-output", "step-review-requested"],
  "builtin.workflow.validation-step": ["step-input", "step-context", "step-output", "step-review-requested"],
  "builtin.workflow.approval-step": ["step-input", "step-context", "step-output", "step-review-requested"],
  "builtin.workflow.output-step": ["step-input", "step-context", "step-output", "step-review-requested"],
  "builtin.system.system": ["capabilities", "subsystems", "features", "workflows", "system-summary"],
  "builtin.system.subsystem": ["capabilities", "subsystems", "features", "workflows", "system-summary"],
  "builtin.system.policy-check": ["candidate", "context", "check-result", "review-required"],
  "builtin.system.test-check": ["candidate", "context", "check-result", "review-required"],
};

const expectedShellKindById: Record<string, string> = {
  "builtin.shell.page": "page-shell",
  "builtin.shell.feature": "feature-shell",
  "builtin.shell.dashboard-section": "dashboard-section-shell",
  "builtin.shell.settings-panel": "settings-panel-shell",
  "builtin.shell.resource-browser": "resource-browser-shell",
  "builtin.shell.detail-page": "detail-page-shell",
  "builtin.shell.wizard-step": "wizard-step-shell",
  "builtin.shell.navigation-group": "navigation-group-shell",
  "builtin.workflow.workflow": "workflow-shell",
  "builtin.workflow.step": "workflow-step-shell",
  "builtin.workflow.input-step": "workflow-step-shell",
  "builtin.workflow.transform-step": "workflow-step-shell",
  "builtin.workflow.validation-step": "workflow-step-shell",
  "builtin.workflow.approval-step": "workflow-step-shell",
  "builtin.workflow.output-step": "workflow-step-shell",
  "builtin.system.system": "system-shell",
  "builtin.system.subsystem": "subsystem-shell",
  "builtin.system.policy-check": "policy-check-shell",
  "builtin.system.test-check": "test-check-shell",
};

const pageTypedRegionShellIds = [
  "builtin.shell.dashboard-section",
  "builtin.shell.settings-panel",
  "builtin.shell.resource-browser",
  "builtin.shell.detail-page",
  "builtin.shell.wizard-step",
  "builtin.shell.navigation-group",
] as const;

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

describe("page, feature, workflow, and system shell primitives", () => {
  it("publishes stable namespaced shell primitive IDs", () => {
    assert.deepEqual(PAGE_FEATURE_SHELL_PRIMITIVE_IDS, [
      "builtin.shell.page",
      "builtin.shell.feature",
      "builtin.shell.dashboard-section",
      "builtin.shell.settings-panel",
      "builtin.shell.resource-browser",
      "builtin.shell.detail-page",
      "builtin.shell.wizard-step",
      "builtin.shell.navigation-group",
    ]);
    assert.deepEqual(WORKFLOW_SYSTEM_SHELL_PRIMITIVE_IDS, [
      "builtin.workflow.workflow",
      "builtin.workflow.step",
      "builtin.workflow.input-step",
      "builtin.workflow.transform-step",
      "builtin.workflow.validation-step",
      "builtin.workflow.approval-step",
      "builtin.workflow.output-step",
      "builtin.system.system",
      "builtin.system.subsystem",
      "builtin.system.policy-check",
      "builtin.system.test-check",
    ]);
    assert.deepEqual(ALL_SHELL_PRIMITIVE_IDS, [
      ...PAGE_FEATURE_SHELL_PRIMITIVE_IDS,
      ...WORKFLOW_SYSTEM_SHELL_PRIMITIVE_IDS,
    ]);
    assert.deepEqual(SHELL_PRIMITIVE_CATALOG.deferredPrimitiveIds, []);
  });

  it("creates full asset definitions with source pack metadata", () => {
    assert.equal(SHELL_PRIMITIVE_DEFINITIONS.length, ALL_SHELL_PRIMITIVE_IDS.length);
    for (const definition of SHELL_PRIMITIVE_DEFINITIONS) {
      assert.match(String(definition.definitionId), /^builtin\.(?:shell|workflow|system)\.[a-z0-9.-]+$/);
      assert.equal(definition.version, "1.0.0");
      assert.ok(["page", "feature", "workflow", "workflow-step", "system", "subsystem", "policy", "test"].includes(definition.assetType));
      assert.ok(["structural", "behavioral", "context", "composition"].includes(definition.assetFamily));
      assert.equal(definition.lifecycleStatus, "published");
      assert.equal(definition.reviewStatus, "approved");
      assert.equal(definition.provenance.sourceKind, "system-generated");
      assert.ok(definition.displayName);
      assert.ok(definition.description);
      assert.equal(definition.metadata?.sourcePackId, SYSTEM_FOUNDATION_PACK_ID);
      assert.equal(definition.metadata?.sourcePackVersion, SYSTEM_FOUNDATION_PACK_VERSION);
      assert.equal(definition.metadata?.sourceLayer, SYSTEM_FOUNDATION_PACK_SOURCE_LAYER);
      assert.equal(definition.metadata?.builtIn, true);
      assert.equal(definition.metadata?.shellKind, expectedShellKindById[String(definition.definitionId)]);
      assert.equal(definition.aiContext?.metadata?.shellKind, expectedShellKindById[String(definition.definitionId)]);
      assert.ok(["page-feature-shells", "workflow-system-shells"].includes(String(definition.metadata?.categoryId)));
    }
  });

  it("passes asset definition validation, pack entry validation, quality gates, and manifest validation", () => {
    assert.equal(validateAssetPackManifest(SYSTEM_FOUNDATION_PACK_MANIFEST).status, "valid");
    for (const entry of SHELL_PRIMITIVE_ENTRIES) {
      assert.equal(validateAssetDefinition(entry.definition).status, "valid", entry.entryId);
      const quality = runAssetPackQualityGates(entry);
      assert.equal(quality.status, "valid", messages(quality));
    }
  });

  it("provides meaningful semantic configuration schemas", () => {
    for (const definition of SHELL_PRIMITIVE_DEFINITIONS) {
      const expectedFields = expectedFieldsById[String(definition.definitionId)];
      assert.ok(expectedFields, String(definition.definitionId));
      const schema = definition.configurationSchema;
      assert.ok(schema);
      assert.equal(schema?.strict, true);
      assert.ok((schema?.fields.length ?? 0) >= 5);
      assert.deepEqual(schema?.fields.map((field) => field.fieldId), expectedFields);
      assert.deepEqual(Object.keys(definition.defaultConfiguration ?? {}), expectedFields);
      assert.equal(schema?.fields.every((field) => Boolean(field.fieldId && field.label)), true);
      assert.equal(schema?.fields.some((field) => ["className", "routePath", "apiEndpoint", "ipcChannel", "taskId"].includes(field.fieldId)), false);
    }
  });

  it("includes non-running guidance for workflow, system, and check shells", () => {
    for (const definition of SHELL_PRIMITIVE_DEFINITIONS.filter((candidate) =>
      /^(builtin\.workflow|builtin\.system)/.test(String(candidate.definitionId)),
    )) {
      const output = JSON.stringify(definition);
      assert.match(output, /non-running/i);
      assert.match(output, /not a concrete renderer page/i);
      assert.match(output, /not.*workflow engine/i);
      assert.match(output, /not.*runtime task/i);
      assert.match(output, /schedulers|scheduler/i);
      assert.match(output, /provider calls/i);
      assert.match(output, /AI-created composition/i);
    }
  });

  it("distinguishes page-region shell semantics from concrete routes or pages", () => {
    for (const definitionId of pageTypedRegionShellIds) {
      const definition = SHELL_PRIMITIVE_DEFINITIONS.find(
        (candidate) => candidate.definitionId === definitionId,
      );
      assert.ok(definition);
      assert.equal(definition.assetType, "page");
      assert.equal(definition.metadata?.shellKind, expectedShellKindById[definitionId]);
      assert.match(definition.aiContext?.developerFacingSummary ?? "", /not a concrete renderer page/i);
      assert.match(JSON.stringify(definition.aiContext), /not.*route|without.*route|do not use route/i);
      assert.match(JSON.stringify(definition.compositionRules), /semantic/i);
      assert.doesNotMatch(JSON.stringify(definition), /\b(?:routePath|routeName|pathName|url|href|apiEndpoint|ipcChannel|navigation handler)\b/i);
      assert.equal(typeof definition.metadata?.shellKind, "string");
    }
  });

  it("does not contain positive execution, transfer, resource-read, or preview-rendering claims", () => {
    for (const definition of SHELL_PRIMITIVE_DEFINITIONS) {
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

  it("keeps workflow, system, and check shell ports semantic and non-running", () => {
    for (const definition of SHELL_PRIMITIVE_DEFINITIONS.filter((candidate) =>
      /^(builtin\.workflow|builtin\.system)/.test(String(candidate.definitionId)),
    )) {
      const output = JSON.stringify(definition);
      assert.match(output, /non-running/i);
      assert.match(output, /declarative/i);
      assert.doesNotMatch(output, /\b(?:handler implementation|task id|scheduler config|queue name|runtime task id|assigned actor id|decision record id|generated system payload)\b/i);
      for (const port of definition.ports ?? []) {
        assert.match(port.contract?.dataKind ?? "", /^semantic-/);
      }
    }
  });

  it("declares expected semantic ports and composition rules", () => {
    for (const definition of SHELL_PRIMITIVE_DEFINITIONS) {
      const expectedPorts = expectedPortsById[String(definition.definitionId)];
      assert.ok(expectedPorts);
      assert.deepEqual(definition.ports?.map((port) => port.portId), expectedPorts);
      assert.ok(definition.ports?.every((port) => port.contract));
      assert.ok((definition.compositionRules?.length ?? 0) >= 1);
    }
  });

  it("connects shell composition to lower-level foundation primitives and shell children", () => {
    const page = SHELL_PRIMITIVE_DEFINITIONS.find((definition) => definition.definitionId === "builtin.shell.page");
    const feature = SHELL_PRIMITIVE_DEFINITIONS.find((definition) => definition.definitionId === "builtin.shell.feature");
    const workflow = SHELL_PRIMITIVE_DEFINITIONS.find((definition) => definition.definitionId === "builtin.workflow.workflow");
    const system = SHELL_PRIMITIVE_DEFINITIONS.find((definition) => definition.definitionId === "builtin.system.system");
    assert.ok(page);
    assert.ok(feature);
    assert.ok(workflow);
    assert.ok(system);

    const pageRules = JSON.stringify(page.compositionRules);
    for (const expected of ["ui-structure", "forms-fields", "data-display", "state-messages", "builtin.shell.feature", "builtin.shell.resource-browser", "builtin.shell.detail-page"]) {
      assert.match(pageRules, new RegExp(expected.replaceAll(".", "\\.")));
    }

    const featureRules = JSON.stringify(feature.compositionRules);
    assert.match(featureRules, /builtin\.workflow\.workflow/);

    const workflowRules = JSON.stringify(workflow.compositionRules);
    for (const stepId of ["builtin.workflow.step", "builtin.workflow.input-step", "builtin.workflow.transform-step", "builtin.workflow.validation-step", "builtin.workflow.approval-step", "builtin.workflow.output-step"]) {
      assert.match(workflowRules, new RegExp(stepId.replaceAll(".", "\\.")));
    }

    const systemRules = JSON.stringify(system.compositionRules);
    for (const childId of ["builtin.system.subsystem", "builtin.shell.feature", "builtin.workflow.workflow", "builtin.system.policy-check", "builtin.system.test-check"]) {
      assert.match(systemRules, new RegExp(childId.replaceAll(".", "\\.")));
    }
  });

  it("keeps shell entries in expected categories with safe source metadata", () => {
    for (const entry of SHELL_PRIMITIVE_ENTRIES) {
      const sourcePack = entry.metadata?.sourcePack as
        | { readonly packId?: string; readonly version?: string }
        | undefined;
      assert.ok(["page-feature-shells", "workflow-system-shells"].includes(entry.category));
      assert.equal(entry.sourceLayer, "system-default");
      assert.equal(sourcePack?.packId, "system.foundation");
      assert.equal(sourcePack?.version, "1.0.0");
      assert.equal(entry.metadata?.shellKind, expectedShellKindById[String(entry.definition.definitionId)]);
      assert.match(entry.entryId, /^system\.foundation\.(?:shell|workflow|system)\.[a-z0-9.-]+$/);
      assert.match(entry.fingerprint, /^fnv1a:[a-f0-9]{8}$/);
      assert.deepEqual(entry.definitionRef, {
        kind: "asset-definition-version",
        id: entry.definition.definitionId,
        version: "1.0.0",
        label: entry.definition.displayName,
      });
    }
  });

  it("contains no route, transport, renderer, engine, provider, payload, or resource leakage", () => {
    const output = JSON.stringify(SHELL_PRIMITIVE_ENTRIES).toLowerCase();
    for (const forbidden of [
      "react",
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
      "schedulerconfig",
      "workflowjson",
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
      "prompt text",
      "resource content",
      "installstatus",
      "marketplace",
      "sql",
      "graphql",
    ]) {
      assert.equal(output.includes(forbidden), false, forbidden);
    }
  });

  it("declares no runtime, provider, network, storage, filesystem, or resource read requirements", () => {
    for (const definition of SHELL_PRIMITIVE_DEFINITIONS) {
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
      JSON.parse(JSON.stringify(SHELL_PRIMITIVE_CATALOG)),
      SHELL_PRIMITIVE_CATALOG,
    );
  });
});

function messages(result: { readonly issues: readonly { readonly message: string }[] }): string {
  return result.issues.map((issue) => issue.message).join("\n");
}

function isSafeNonGoalContext(output: string, match: string): boolean {
  const index = output.toLowerCase().indexOf(match.toLowerCase());
  if (index < 0) return true;
  const context = output.slice(Math.max(0, index - 180), index + match.length + 180);
  return /\b(?:does not|do not|without|outside|deferred|not implemented by this definition)\b/i.test(context);
}
