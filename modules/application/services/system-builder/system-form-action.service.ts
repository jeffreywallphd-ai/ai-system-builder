import type { AssetValidationIssue } from "../../../contracts/asset";
import {
  readSystemFormAction, SYSTEM_FORM_ACTION_DEFINITION_ID, SYSTEM_FORM_ACTION_DEFINITION_VERSION,
  SYSTEM_FORM_ACTION_METADATA_KEY, type SystemFormActionMapping,
} from "../../../contracts/system-builder";
import { compileSystemForm, type CompiledSystemForm, type SystemFormSource } from "./system-form-rules.service";

const hasAction = (metadata: object | undefined) => Object.prototype.hasOwnProperty.call(metadata ?? {}, SYSTEM_FORM_ACTION_METADATA_KEY);

export interface CompiledSystemFormAction {
  readonly form: CompiledSystemForm;
  readonly operationId: string;
  readonly entityType: string;
  readonly mappings: readonly SystemFormActionMapping[];
}

export function compileSystemFormAction(source: SystemFormSource, formId: string): CompiledSystemFormAction | undefined {
  const outgoing = source.bindings.filter((binding) => binding.sourceRef.id === formId && hasAction(binding.metadata));
  if (outgoing.length !== 1) return;
  const action = readSystemFormAction(outgoing[0]!);
  if (!action) return;
  const target = source.instances.find((instance) => instance.instanceId === action.operationId);
  const entityType = target?.selectedConfiguration?.entity;
  if (target?.definitionRef.kind !== "asset-definition-version" || target.definitionRef.id !== SYSTEM_FORM_ACTION_DEFINITION_ID ||
      target.definitionRef.version !== SYSTEM_FORM_ACTION_DEFINITION_VERSION || typeof entityType !== "string" ||
      !/^[a-zA-Z][a-zA-Z0-9_.-]{0,63}$/.test(entityType) || entityType.includes("..")) return;
  const form = compileSystemForm(source, formId);
  if (!form.ok) return;
  const fieldIds = new Set(form.value.steps.flatMap((step) => step.fields.map((field) => field.id)));
  if (action.mappings.some(({ fieldId }) => !fieldIds.has(fieldId))) return;
  return { form: form.value, operationId: action.operationId, entityType, mappings: action.mappings };
}

export function validateSystemFormActions(source: SystemFormSource): readonly AssetValidationIssue[] {
  const examined = new Set<string>();
  return source.bindings.flatMap((binding, index) => {
    if (!hasAction(binding.metadata)) return [];
    const formId = String(binding.sourceRef.id);
    if (examined.has(formId)) return [];
    examined.add(formId);
    if (compileSystemFormAction(source, formId)) return [];
    return [{ severity: "error" as const, category: "binding" as const, path: ["bindings", String(index)],
      message: "Connect the form to one exact Create Record operation and map only fields in that form." }];
  });
}
