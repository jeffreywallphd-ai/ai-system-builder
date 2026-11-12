import assert from "node:assert/strict";
import test from "node:test";
import { normalizeAssetId, normalizeAssetSlotId, type AssetConfigurationValues, type AssetInstance, type AssetPlacement } from "../../../../contracts/asset";
import { createSystemFormRouteBinding, type SystemFormRoute, type SystemFormValue } from "../../../../contracts/system-builder";
import { compileSystemForm, evaluateSystemForm, validateSystemFormRoutes } from "../system-form-rules.service";
import { ValidateSystemBuilderRevisionService } from "../validate-system-builder-revision.service";

const ref = (id: string) => ({ kind: "asset-instance" as const, id: normalizeAssetId(id) });
const member = (id: string, definition: string, selectedConfiguration: AssetConfigurationValues = {}) => ({
  instanceId: id, displayName: id, definitionRef: { kind: "asset-definition-version", id: `builtin.form.${definition}`, version: "3.0.0" },
  lifecycleStatus: "draft", provenance: { sourceKind: "human-authored" }, selectedConfiguration,
}) as AssetInstance;
const edge = (parent: string, child: string, order: number): AssetPlacement => ({
  schemaVersion: "asset-placement.v1", placementId: `place.${child}`, parentInstanceRef: ref(parent), childInstanceRef: ref(child), slotId: normalizeAssetSlotId("fields"), order,
});
const route = (fromStepId: string, destinationId: string, when: SystemFormRoute["when"] = null, priority = 0) =>
  createSystemFormRouteBinding(`route.${fromStepId}.${destinationId}.${when ? priority : "default"}`, { fromStepId, destinationId, when, priority });

const formId = "survey";
const next = route("intro", "details", { fieldId: "category", operator: "equals", value: "hardware" });
const fixture = {
  instances: [member(formId, "form"), member("intro", "field-group"), member("details", "field-group"), member("finish", "field-group"),
    member("category", "select-field", { required: true, staticOptions: [
      { optionId: "hardware", label: "Hardware", value: "hardware" },
      { optionId: "software", label: "Software", value: "software" },
    ] }), member("count", "number-field", { required: true, minimum: 1, maximum: 10 }),
    member("needed", "date-time-field", { dateTimeKind: "date", minimum: "2026-01-01" })],
  placements: [edge(formId, "intro", 0), edge(formId, "details", 1), edge(formId, "finish", 2),
    edge("intro", "category", 0), edge("details", "count", 0), edge("finish", "needed", 0)],
  bindings: [next, route("intro", "finish"), route("details", "finish")],
};

test("both answer routes check visited values and exclude answers from steps removed from the route", () => {
  const compiled = compileSystemForm(fixture, formId);
  assert.ok(compiled.ok);
  const answers = new Map<string, SystemFormValue>([["category", "hardware"], ["count", 12], ["needed", "2026-02-30"]]);
  const range = evaluateSystemForm(compiled.value, answers);
  assert.equal(range.ok ? undefined : range.fieldId, "count");
  answers.set("count", 4);
  const date = evaluateSystemForm(compiled.value, answers);
  assert.equal(date.ok ? undefined : date.fieldId, "needed");
  answers.set("needed", "2026-02-03");
  const hardware = evaluateSystemForm(compiled.value, answers);
  assert.ok(hardware.ok);
  assert.deepEqual(hardware.path, ["intro", "details", "finish"]);
  assert.equal(hardware.submitted.get("count"), 4);
  answers.set("category", "software");
  const software = evaluateSystemForm(compiled.value, answers);
  assert.ok(software.ok);
  assert.deepEqual(software.path, ["intro", "finish"]);
  assert.equal(software.submitted.has("count"), false);
  answers.delete("category");
  const required = evaluateSystemForm(compiled.value, answers);
  assert.equal(required.ok ? undefined : required.fieldId, "category");
});

test("revision checks reject unknown and cross-form destinations, unsupported expressions, skipped steps and cycles", () => {
  assert.deepEqual(validateSystemFormRoutes(fixture), []);
  assert.deepEqual(validateSystemFormRoutes({ ...fixture, bindings: [] }), []);
  const foreignStep = member("other.step", "field-group");
  const foreignForm = member("other.form", "form");
  const cases = [
    { ...fixture, bindings: [route("intro", "missing")] },
    { ...fixture, instances: [...fixture.instances, foreignStep, foreignForm],
      placements: [...fixture.placements, edge("other.form", "other.step", 0)], bindings: [route("intro", "other.step")] },
    { ...fixture, bindings: [route("intro", "finish", { fieldId: "count", operator: "greater-than", value: 3 })] },
    { ...fixture, bindings: [route("details", "finish", { fieldId: "count", operator: "greater-than", value: 10 })] },
    { ...fixture, bindings: [next, route("intro", "finish", { fieldId: "category", operator: "equals", value: "hardware" }, 1)] },
    { ...fixture, bindings: [route("intro", "finish")] },
    { ...fixture, bindings: [...fixture.bindings, route("finish", "intro")] },
    { ...fixture, bindings: [{ ...next, metadata: { systemBuilderFormRoute: { schemaVersion: "system-builder-form-route.v1", expression: "arbitrary expression", priority: 0 } } }] },
    { ...fixture, bindings: [route("finish", "intro"), route("not-a-step", formId)] },
  ];
  for (const source of cases) assert.notEqual(validateSystemFormRoutes(source).length, 0);
});

test("revision validation keeps a route error visible after more than 200 configuration warnings", async () => {
  const validator = new ValidateSystemBuilderRevisionService({ readExactDefinition: async (reference) => ({
    definitionId: normalizeAssetId(reference.id), version: "3.0.0", displayName: "Test form asset",
    description: "Test form asset with many unset settings", assetFamily: "structural", assetType: "ui-component",
    lifecycleStatus: "published", provenance: { sourceKind: "system-generated" },
    configurationSchema: { fields: [], requiredFieldIds: Array.from({ length: 40 }, (_, index) => `setting${index}`) },
  }) });
  const bindings = [route("intro", "finish")];
  const result = await validator.execute({ ...fixture, bindings, composition: {
    compositionId: normalizeAssetId("survey.composition"), compositionType: "system", displayName: "Survey",
    version: "0.1.0", lifecycleStatus: "draft", rootInstanceRefs: [ref(formId)],
    instanceRefs: fixture.instances.map((instance) => ref(instance.instanceId)),
    bindingRefs: bindings.map((binding) => ({ kind: "asset-binding", id: normalizeAssetId(binding.bindingId) })),
    provenance: { sourceKind: "human-authored" },
  } });
  assert.equal(result.status, "invalid");
  assert.ok(result.issues.some((issue) => issue.message.includes("limited to 200")));
  assert.ok(result.issues.some((issue) => issue.category === "binding" &&
    issue.message === "Add a route to every step or remove the steps that cannot be reached."));
});

test("malformed field bounds fail closed and evaluation stops if an invalid graph crosses the type boundary", () => {
  const wrong = { ...fixture, instances: fixture.instances.map((instance) => instance.instanceId === "count"
    ? { ...instance, selectedConfiguration: { minimum: "4" } } : instance) };
  assert.equal(compileSystemForm(wrong, formId).ok, false);
  const valid = compileSystemForm(fixture, formId);
  assert.ok(valid.ok);
  const loop = { ...valid.value, steps: [{ ...valid.value.steps[0]!, conditions: [], defaultDestinationId: "intro" }] };
  const result = evaluateSystemForm(loop, new Map([["category", "hardware"]]));
  assert.equal(result.ok, false);
  assert.ok(result.path.length <= 32);
});
