import { normalizeAssetId, type AssetBinding, type AssetJsonObject, type AssetJsonValue } from "../asset";

export const SYSTEM_FORM_ACTION_METADATA_KEY = "systemBuilderFormAction";
export const SYSTEM_FORM_ACTION_SCHEMA = "system-builder-form-action.v1";
export const SYSTEM_FORM_ACTION_DEFINITION_ID = "builtin.data.create-operation";
export const SYSTEM_FORM_ACTION_DEFINITION_VERSION = "3.0.0";
export const SYSTEM_FORM_ACTION_SOURCE_PORT = "submitted-values";
export const SYSTEM_FORM_ACTION_TARGET_PORT = "input";

export interface SystemFormActionMapping {
  readonly fieldId: string;
  readonly recordField: string;
}

export interface SystemFormAction {
  readonly formId: string;
  readonly operationId: string;
  readonly mappings: readonly SystemFormActionMapping[];
}

function object(value: AssetJsonValue | undefined): AssetJsonObject | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as AssetJsonObject : undefined;
}

function safeId(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 160) return false;
  try { return value === normalizeAssetId(value); } catch { return false; }
}

function safeField(value: unknown): value is string {
  return typeof value === "string" && /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(value) &&
    !Object.prototype.hasOwnProperty.call(Object.prototype, value);
}

export function readSystemFormAction(binding: AssetBinding): SystemFormAction | undefined {
  const data = object(binding.metadata?.[SYSTEM_FORM_ACTION_METADATA_KEY]);
  if (!data || data.schemaVersion !== SYSTEM_FORM_ACTION_SCHEMA || Object.keys(data).length !== 2 ||
      binding.bindingKind !== "output" || binding.sourceRef.kind !== "asset-instance" ||
      binding.targetRef.kind !== "asset-instance" || binding.sourceRef.version !== undefined ||
      binding.targetRef.version !== undefined || !safeId(binding.sourceRef.id) || !safeId(binding.targetRef.id) ||
      binding.sourcePortRef?.kind !== "asset-definition" || binding.sourcePortRef.id !== SYSTEM_FORM_ACTION_SOURCE_PORT ||
      binding.sourcePortRef.version !== undefined || binding.targetPortRef?.kind !== "asset-definition" ||
      binding.targetPortRef.id !== SYSTEM_FORM_ACTION_TARGET_PORT || binding.targetPortRef.version !== undefined ||
      binding.constraints?.length || !Array.isArray(data.mappings) || data.mappings.length < 1 || data.mappings.length > 32) return;
  const mappings: SystemFormActionMapping[] = [];
  const fieldIds = new Set<string>();
  const recordFields = new Set<string>();
  for (const raw of data.mappings) {
    const mapping = object(raw);
    if (!mapping || Object.keys(mapping).length !== 2 || !safeId(mapping.fieldId) || !safeField(mapping.recordField) ||
        fieldIds.has(mapping.fieldId) || recordFields.has(mapping.recordField)) return;
    fieldIds.add(mapping.fieldId);
    recordFields.add(mapping.recordField);
    mappings.push({ fieldId: mapping.fieldId, recordField: mapping.recordField });
  }
  return { formId: binding.sourceRef.id, operationId: binding.targetRef.id, mappings };
}

export function createSystemFormActionBinding(bindingId: string, action: SystemFormAction): AssetBinding {
  return {
    bindingId: normalizeAssetId(bindingId), bindingKind: "output", lifecycleStatus: "draft",
    sourceRef: { kind: "asset-instance", id: normalizeAssetId(action.formId) },
    targetRef: { kind: "asset-instance", id: normalizeAssetId(action.operationId) },
    sourcePortRef: { kind: "asset-definition", id: normalizeAssetId(SYSTEM_FORM_ACTION_SOURCE_PORT) },
    targetPortRef: { kind: "asset-definition", id: normalizeAssetId(SYSTEM_FORM_ACTION_TARGET_PORT) },
    metadata: { [SYSTEM_FORM_ACTION_METADATA_KEY]: {
      schemaVersion: SYSTEM_FORM_ACTION_SCHEMA, mappings: action.mappings.map((mapping) => ({ ...mapping })),
    } },
  };
}
