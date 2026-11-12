import assert from "node:assert/strict";
import test from "node:test";
import { normalizeAssetId, normalizeAssetSlotId, type AssetInstance, type AssetPlacement } from "../../../../contracts/asset";
import { createSystemFormActionBinding, readSystemFormAction } from "../../../../contracts/system-builder";
import { compileSystemFormAction, validateSystemFormActions } from "../system-form-action.service";
import { SYSTEM_FOUNDATION_PACK_V3_MANIFEST } from "../../asset-packs/system-packs";

const ref = (id: string) => ({ kind: "asset-instance" as const, id: normalizeAssetId(id) });
const member = (id: string, definition: string, selectedConfiguration: AssetInstance["selectedConfiguration"] = {}): AssetInstance => ({
  instanceId: normalizeAssetId(id), displayName: id, definitionRef: { kind: "asset-definition-version", id: normalizeAssetId(definition), version: "3.0.0" },
  lifecycleStatus: "draft", provenance: { sourceKind: "human-authored" }, selectedConfiguration,
});
const edge = (parent: string, child: string): AssetPlacement => ({
  schemaVersion: "asset-placement.v1", placementId: `place.${child}`, parentInstanceRef: ref(parent), childInstanceRef: ref(child), slotId: normalizeAssetSlotId("fields"), order: 0,
});
const action = createSystemFormActionBinding("action.response", { formId: "form-a", operationId: "create-a", mappings: [{ fieldId: "reason", recordField: "reason" }] });
const fixture = {
  instances: [member("form-a", "builtin.form.form"), member("step-a", "builtin.form.field-group"), member("reason", "builtin.form.text-field", { required: true }),
    member("create-a", "builtin.data.create-operation", { entity: "Request" }), member("other-reason", "builtin.form.text-field")],
  placements: [edge("form-a", "step-a"), edge("step-a", "reason")], bindings: [action],
};

test("the exact existing Create Record action receives one explicit field mapping through compatible ports", () => {
  assert.equal(action.sourcePortRef?.id, "submitted-values");
  assert.equal(action.targetPortRef?.id, "input");
  const definitions = SYSTEM_FOUNDATION_PACK_V3_MANIFEST.assets.map((entry) => entry.definition);
  const formPort = definitions.find((entry) => entry.definitionId === "builtin.form.form")?.ports?.find((port) => port.portId === action.sourcePortRef?.id);
  const actionPort = definitions.find((entry) => entry.definitionId === "builtin.data.create-operation")?.ports?.find((port) => port.portId === action.targetPortRef?.id);
  assert.equal(formPort?.direction, "output");
  assert.equal(actionPort?.direction, "input");
  assert.equal(formPort?.contract?.contractKind, actionPort?.contract?.contractKind);
  assert.equal(compileSystemFormAction(fixture, "form-a")?.entityType, "Request");
  assert.deepEqual(validateSystemFormActions(fixture), []);
  assert.equal(compileSystemFormAction({ ...fixture, bindings: [] }, "form-a"), undefined);
});

test("invalid ports, foreign fields, duplicate actions and other implementations cannot become form actions", () => {
  const bad = createSystemFormActionBinding("action.foreign", { formId: "form-a", operationId: "create-a",
    mappings: [{ fieldId: "other-reason", recordField: "reason" }] });
  const duplicate = { ...action, bindingId: "action.duplicate" };
  const wrongPort = { ...action, targetPortRef: { ...action.targetPortRef!, id: normalizeAssetId("alternate") } };
  assert.equal(readSystemFormAction(wrongPort), undefined);
  assert.equal(readSystemFormAction(createSystemFormActionBinding("action.bad-key", { formId: "form-a", operationId: "create-a",
    mappings: [{ fieldId: "reason", recordField: "constructor" }] })), undefined);
  const wrongTarget = { ...fixture, instances: fixture.instances.map((instance) => instance.instanceId === "create-a"
    ? member("create-a", "builtin.data.update-operation", { entity: "Request" }) : instance) };
  for (const source of [wrongTarget, { ...fixture, bindings: [bad] }, { ...fixture, bindings: [action, duplicate] }, { ...fixture, bindings: [wrongPort] }]) {
    assert.equal(compileSystemFormAction(source, "form-a"), undefined);
    assert.equal(validateSystemFormActions(source)[0]?.severity, "error");
  }
});
