import * as assert from "node:assert/strict";
import { test } from "node:test";
import type { AssetBinding, AssetComposition, AssetDefinition, AssetInstance } from "../../../../contracts/asset";
import {
  AssetValidationService,
  deriveAssetValidationStatus,
  validateAssetBinding,
  validateAssetComposition,
  validateAssetDefinition,
  validateAssetInstance,
} from "../index";
import { validateAssetBinding as validateAssetBindingRole } from "../validate-asset-binding.service";
import { validateAssetDefinition as validateAssetDefinitionRole } from "../validate-asset-definition.service";

const provenance = { sourceKind: "human-authored" as const };
const aiContext = {
  purpose: "Compose a feature safely.",
  userFacingSummary: "A user summary.",
  developerFacingSummary: "A developer summary.",
  capabilities: [{ summary: "Capability." }],
  limitations: [{ summary: "Limitation." }],
  configurationGuidance: { summary: "Configure it." },
  compositionGuidance: { summary: "Compose it." },
  safetyNotes: [{ category: "runtime-execution" as const, severity: "warning" as const, summary: "Review runtime use." }],
};

function definition(overrides: Partial<AssetDefinition> = {}): AssetDefinition {
  return {
    definitionId: "def.feature",
    assetType: "feature",
    assetFamily: "structural",
    version: "1.0.0",
    displayName: "Feature",
    description: "Feature description.",
    lifecycleStatus: "validated",
    reviewStatus: "approved",
    provenance,
    aiContext,
    ...overrides,
  } as AssetDefinition;
}

function instance(overrides: Partial<AssetInstance> = {}): AssetInstance {
  return {
    instanceId: "inst.feature",
    definitionRef: { kind: "asset-definition", id: "def.feature" },
    lifecycleStatus: "validated",
    provenance,
    ...overrides,
  } as AssetInstance;
}

function binding(overrides: Partial<AssetBinding> = {}): AssetBinding {
  return {
    bindingId: "binding.feature",
    bindingKind: "input",
    sourceRef: { kind: "asset-definition", id: "source.def" },
    targetRef: { kind: "asset-definition", id: "target.def" },
    sourcePortRef: { kind: "asset-definition", id: "out" },
    targetPortRef: { kind: "asset-definition", id: "in" },
    ...overrides,
  } as AssetBinding;
}

function composition(overrides: Partial<AssetComposition> = {}): AssetComposition {
  return {
    compositionId: "composition.feature",
    compositionType: "feature",
    displayName: "Composition",
    version: "1.0.0",
    lifecycleStatus: "validated",
    rootInstanceRefs: [{ kind: "asset-instance", id: "inst.feature" } as any],
    instanceRefs: [{ kind: "asset-instance", id: "inst.feature" } as any],
    provenance,
    ...overrides,
  } as AssetComposition;
}


test("public validation facade and role-specific validators remain usable", () => {
  const service = new AssetValidationService();
  assert.equal(service.validateDefinition(definition()).status, "valid");
  assert.equal(validateAssetDefinitionRole(definition()).status, "valid");
  assert.equal(validateAssetBindingRole(binding(), {
    definitionsById: new Map([
      ["source.def", definition({ definitionId: "source.def", ports: [{ portId: "out", direction: "output", contract: { contractKind: "json" } }] })],
      ["target.def", definition({ definitionId: "target.def", ports: [{ portId: "in", direction: "input", contract: { contractKind: "json" } }] })],
    ]),
  }).status, "valid");
});

test("binding validation issues are anchored to asset-binding references", () => {
  const result = validateAssetBinding(binding({ bindingId: "binding.issue", sourceRef: undefined as never, targetRef: undefined as never }));
  assert.equal(result.status, "invalid");
  assert.ok(result.issues.length > 0);
  assert.ok(result.issues.every((issue) => issue.assetRef?.kind === "asset-binding"));
  assert.equal(result.issues[0]?.assetRef?.id, "binding.issue");
});

test("valid minimal asset definition returns valid and complete AI context passes", () => {
  const result = validateAssetDefinition(definition());
  assert.equal(result.status, "valid");
  assert.deepEqual(result.issues, []);
});

test("definition validation reports invalid vocabulary, missing text, lifecycle, review, and provenance values", () => {
  const result = validateAssetDefinition(definition({
    assetType: "bad-type" as AssetDefinition["assetType"],
    assetFamily: "bad-family" as AssetDefinition["assetFamily"],
    displayName: " ",
    description: "",
    lifecycleStatus: "bad-life" as AssetDefinition["lifecycleStatus"],
    reviewStatus: "bad-review" as AssetDefinition["reviewStatus"],
    provenance: { sourceKind: "bad-source" } as unknown as AssetDefinition["provenance"],
  }));
  assert.equal(result.status, "invalid");
  assert.ok(result.issues.filter((issue) => issue.severity === "error").length >= 7);
});

test("definition configuration validation checks duplicate fields, strict defaults, missing required values, and descriptors", () => {
  const result = validateAssetDefinition(definition({
    configurationSchema: {
      strict: true,
      fields: [
        { fieldId: "mode", valueKind: "enum", required: true, options: [] },
        { fieldId: "mode", valueKind: "bad-kind" as never, constraints: [{ constraintKind: "bad-constraint" as never }], uiHint: { hintKind: "bad-hint" as never } },
      ],
      requiredFieldIds: ["missing"],
      validationRules: [{ ruleId: "", ruleKind: "bad-rule" as never }],
    },
    defaultConfiguration: { extra: true },
    aiContext: { ...aiContext, configurationGuidance: { summary: "Configure." } },
  }));
  assert.equal(result.status, "invalid");
  assert.ok(result.issues.some((issue) => issue.message.includes("unique")));
  assert.ok(result.issues.some((issue) => issue.message.includes("Strict schema")));
  assert.ok(result.issues.some((issue) => issue.message.includes("Required field IDs")));
  assert.ok(result.issues.some((issue) => issue.path?.includes("ruleKind")));
});

test("definition port, composition dependency, and requirement validation reports invalid structural descriptors", () => {
  const result = validateAssetDefinition(definition({
    ports: [
      { portId: "out", direction: "output", contract: { contractKind: "json" } },
      { portId: "out", direction: "bad-direction" as never, contract: { contractKind: "bad-contract" as never } },
    ],
    compositionRules: [{ ruleKind: "bad-rule" as never }, { ruleKind: "required-dependency", requiredDependencies: [] }],
    dependencies: [{ dependencyKind: "bad-dep" as never, required: "yes" as never }, { dependencyKind: "runtime-capability", required: true, runtimeCapabilityId: "bad-runtime" as never }],
    requirements: [
      { requirementKind: "bad-req" as never, required: "yes" as never },
      { requirementKind: "runtime-capability", required: true, runtimeCapabilityId: "python-runtime" },
      { requirementKind: "runtime-capability", required: true, runtimeCapabilityId: "bad-runtime" as never },
      { requirementKind: "host", required: true, hostKind: "bad-host" as never },
      { requirementKind: "permission", required: true, permissionKind: "bad-permission" as never },
      { requirementKind: "thin-client-safety", required: true, safetyStatus: "bad-safety" as never },
      { requirementKind: "secret-access", required: true, requirementId: "secret=super-secret-token" },
      { requirementKind: "filesystem-access", required: true, requirementId: "/tmp/raw-path" },
    ],
  }));
  assert.equal(result.status, "invalid");
  assert.ok(result.issues.some((issue) => issue.message.includes("Port IDs")));
  assert.ok(result.issues.some((issue) => issue.message.includes("runtime capability ID")));
  assert.ok(result.issues.some((issue) => issue.category === "security"));
});

test("missing AI context for composable definitions returns structured ai-context warnings", () => {
  const result = validateAssetDefinition(definition({ aiContext: undefined }));
  assert.equal(result.status, "valid-with-warnings");
  assert.ok(result.issues.every((issue) => issue.category === "ai-context"));
  assert.ok(result.issues.some((issue) => issue.path?.join(".") === "aiContext.purpose"));
});

test("instance validation checks IDs, references, selected config, and definition lifecycle compatibility", () => {
  const def = definition({
    configurationSchema: { strict: true, fields: [{ fieldId: "count", valueKind: "integer", required: true }] },
    lifecycleStatus: "archived",
  });
  const result = validateAssetInstance(instance({ instanceId: "../bad", lifecycleStatus: "published", selectedConfiguration: { count: "wrong", extra: true }, resourceRefs: [{ kind: "resource", id: "https://bad" } as any] }), {
    definitionsById: new Map([["def.feature", def]]),
  });
  assert.equal(result.status, "invalid");
  assert.ok(result.issues.some((issue) => issue.path?.includes("instanceId")));
  assert.ok(result.issues.some((issue) => issue.message.includes("selected configuration")));
  assert.ok(result.issues.some((issue) => issue.message.includes("archived")));
});

test("valid instance referencing a valid definition returns valid", () => {
  const result = validateAssetInstance(instance(), { definitionsById: new Map([["def.feature", definition()]]) });
  assert.equal(result.status, "valid");
});

test("failed-validation definitions produce lifecycle warning for instances", () => {
  const result = validateAssetInstance(instance(), { definitionsById: new Map([["def.feature", definition({ lifecycleStatus: "failed-validation" })]]) });
  assert.equal(result.status, "valid-with-warnings");
  assert.ok(result.issues.some((issue) => issue.severity === "warning"));
});

test("binding validation checks compatible ports, missing refs, invalid kind, constraints, missing ports, directions, and contracts", () => {
  const source = definition({ definitionId: "source.def", ports: [{ portId: "out", direction: "output", contract: { contractKind: "json" } }] });
  const target = definition({ definitionId: "target.def", ports: [{ portId: "in", direction: "input", contract: { contractKind: "json" } }] });
  const context = { definitionsById: new Map([["source.def", source], ["target.def", target]]) };
  assert.equal(validateAssetBinding(binding(), context).status, "valid");

  const invalid = validateAssetBinding(binding({
    bindingKind: "bad-kind" as never,
    sourceRef: undefined as never,
    targetRef: undefined as never,
    constraints: [{ constraintKind: "bad-constraint" as never }],
  }), context);
  assert.equal(invalid.status, "invalid");

  const missingPort = validateAssetBinding(binding({ sourcePortRef: { kind: "asset-definition", id: "missing" } as any }), context);
  assert.equal(missingPort.status, "invalid");

  const inToIn = validateAssetBinding(binding({ sourcePortRef: { kind: "asset-definition", id: "in-source" } as any }), { definitionsById: new Map([["source.def", definition({ definitionId: "source.def", ports: [{ portId: "in-source", direction: "input", contract: { contractKind: "json" } }] })], ["target.def", target]]) });
  assert.equal(inToIn.status, "invalid");

  const outputToOutput = validateAssetBinding(binding({ targetPortRef: { kind: "asset-definition", id: "out-target" } as any }), { definitionsById: new Map([["source.def", source], ["target.def", definition({ definitionId: "target.def", ports: [{ portId: "out-target", direction: "output", contract: { contractKind: "json" } }] })]]) });
  assert.equal(outputToOutput.status, "invalid");

  const contractMismatch = validateAssetBinding(binding(), { definitionsById: new Map([["source.def", source], ["target.def", definition({ definitionId: "target.def", ports: [{ portId: "in", direction: "input", contract: { contractKind: "text" } }] })]]) });
  assert.equal(contractMismatch.status, "invalid");
});



test("instance and composition bindingRefs must use asset-binding references", () => {
  const invalidInstanceRef = validateAssetInstance(instance({ bindingRefs: [{ kind: "asset-definition", id: "binding.feature" } as any] }), {
    definitionsById: new Map([["def.feature", definition()]]),
  });
  assert.equal(invalidInstanceRef.status, "invalid");
  assert.ok(invalidInstanceRef.issues.some((issue) => issue.message.includes("Instance bindingRefs must reference asset bindings")));

  const context = { definitionsById: new Map([["def.feature", definition()]]), instancesById: new Map([["inst.feature", instance()]]) };
  const invalidCompositionRef = validateAssetComposition(composition({ bindingRefs: [{ kind: "asset-definition", id: "binding.feature" } as any] }), context);
  assert.equal(invalidCompositionRef.status, "invalid");
  assert.ok(invalidCompositionRef.issues.some((issue) => issue.message.includes("Composition bindingRefs must reference asset bindings")));

  const structuralOnly = validateAssetComposition(composition({ bindingRefs: [{ kind: "asset-binding", id: "binding.feature" } as any] }), context);
  assert.equal(structuralOnly.status, "valid");
});

test("composition validation resolves binding refs from validation context", () => {
  const context = {
    definitionsById: new Map([
      ["source.def", definition({ definitionId: "source.def", ports: [{ portId: "out", direction: "input", contract: { contractKind: "json" } }] })],
      ["target.def", definition({ definitionId: "target.def", ports: [{ portId: "in", direction: "input", contract: { contractKind: "json" } }] })],
    ]),
    instancesById: new Map([["inst.feature", instance()]]),
    bindingsById: new Map([["binding.feature", binding()]]),
  };
  const result = validateAssetComposition(composition({ bindingRefs: [{ kind: "asset-binding", id: "binding.feature" } as any] }), context);
  assert.equal(result.status, "invalid");
  assert.ok(result.issues.some((issue) => issue.path?.join(".").startsWith("bindingRefs.0")));
});

test("composition validation checks roots, duplicates, inline bindings, dependencies, runtime capability, cardinality, and incompatible types", () => {
  const def = definition({ definitionId: "def.feature", assetType: "feature" });
  const inst = instance();
  const context = { definitionsById: new Map([["def.feature", def], ["source.def", definition({ definitionId: "source.def", ports: [{ portId: "out", direction: "output", contract: { contractKind: "json" } }] })], ["target.def", definition({ definitionId: "target.def", ports: [{ portId: "in", direction: "input", contract: { contractKind: "json" } }] })]]), instancesById: new Map([["inst.feature", inst]]) };
  assert.equal(validateAssetComposition(composition({ bindings: [binding()] }), context).status, "valid");

  const invalid = validateAssetComposition(composition({
    rootInstanceRefs: [{ kind: "asset-instance", id: "missing-root" } as any],
    instanceRefs: [{ kind: "asset-instance", id: "inst.feature" } as any, { kind: "asset-instance", id: "inst.feature" } as any],
    bindings: [binding({ sourcePortRef: { kind: "asset-definition", id: "missing" } as any })],
    dependencies: [{ dependencyKind: "runtime-capability", required: true, runtimeCapabilityId: "bad-runtime" as never }],
    compositionRules: [
      { ruleKind: "required-dependency", requiredDependencies: [] },
      { ruleKind: "cardinality", cardinality: { min: 3 } },
      { ruleKind: "incompatible-child", incompatibleAssetTypes: ["feature"] },
    ],
    validationSummary: { status: "bad-status" as never },
  }), context);
  assert.equal(invalid.status, "invalid");
  assert.ok(invalid.issues.some((issue) => issue.message.includes("Root instance")));
  assert.ok(invalid.issues.some((issue) => issue.message.includes("unique")));
  assert.ok(invalid.issues.some((issue) => issue.message.includes("cardinality")));
  assert.ok(invalid.issues.some((issue) => issue.message.includes("incompatible")));
});

test("validators return issues instead of throwing, derive status, keep safe details, do not mutate inputs, and are exported", () => {
  const service = new AssetValidationService();
  const input = definition({ definitionId: "https://unsafe", aiContext: undefined });
  const before = JSON.stringify(input);
  assert.doesNotThrow(() => service.validateDefinition(input));
  const result = service.validateDefinition(input);
  assert.equal(JSON.stringify(input), before);
  assert.equal(deriveAssetValidationStatus([]), "valid");
  assert.equal(deriveAssetValidationStatus([{ severity: "warning", category: "unknown", message: "warn" }]), "valid-with-warnings");
  assert.equal(deriveAssetValidationStatus([{ severity: "error", category: "unknown", message: "err" }]), "invalid");
  assert.ok(result.issues.every((issue) => !JSON.stringify(issue).includes("/tmp/")));
  assert.equal(typeof validateAssetDefinition, "function");
  assert.equal(typeof validateAssetInstance, "function");
  assert.equal(typeof validateAssetBinding, "function");
  assert.equal(typeof validateAssetComposition, "function");
});
