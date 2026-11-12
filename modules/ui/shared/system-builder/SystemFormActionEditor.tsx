import { useState, type FormEvent } from "react";
import type { AssetInstance } from "../../../contracts/asset";
import {
  SYSTEM_FORM_ACTION_DEFINITION_ID, SYSTEM_FORM_ACTION_DEFINITION_VERSION,
  type SystemFormAction, type SystemFormActionMapping,
} from "../../../contracts/system-builder";
import { readFormChoiceOptions } from "./SystemFormRoutingEditor";

export const SYSTEM_FORM_RECORD_FIELD_ID = "builtin.data.field";

function exact(instance: AssetInstance, definitionId: string) {
  return instance.definitionRef.kind === "asset-definition-version" && instance.definitionRef.id === definitionId &&
    instance.definitionRef.version === SYSTEM_FORM_ACTION_DEFINITION_VERSION;
}

function availableEntity(value: unknown): value is string {
  return typeof value === "string" && /^[a-zA-Z][a-zA-Z0-9_.-]{0,63}$/.test(value) && !value.includes("..");
}

function availableRecordField(value: unknown): value is string {
  return typeof value === "string" && /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(value) &&
    !Object.prototype.hasOwnProperty.call(Object.prototype, value);
}

export function readFormActionOptions(instances: readonly AssetInstance[]) {
  const operationInstances = instances.filter((instance) => instance.definitionRef.id === SYSTEM_FORM_ACTION_DEFINITION_ID);
  const operations = operationInstances.filter((instance) => exact(instance, SYSTEM_FORM_ACTION_DEFINITION_ID) &&
    availableEntity(instance.selectedConfiguration?.entity));
  const candidates = instances.flatMap((instance) => {
    const config = instance.selectedConfiguration;
    const name = config?.name;
    return exact(instance, SYSTEM_FORM_RECORD_FIELD_ID) && availableRecordField(name)
      ? [{ name, label: typeof config?.label === "string" && config.label.trim() ? config.label : name, type: config?.type, enumValues: config?.enumValues }]
      : [];
  });
  const counts = new Map<string, number>();
  for (const field of candidates) counts.set(field.name, (counts.get(field.name) ?? 0) + 1);
  const recordFields = candidates.filter((field) => counts.get(field.name) === 1);
  return { operations, operationCount: operationInstances.length, recordFields };
}

export function isFormActionFieldCompatible(source: AssetInstance, target: ReturnType<typeof readFormActionOptions>["recordFields"][number]): boolean {
  const type = source.definitionRef.id;
  if (target.type === "number") return type === "builtin.form.number-field";
  if (target.type === "date") return type === "builtin.form.date-time-field" &&
    (!source.selectedConfiguration?.dateTimeKind || source.selectedConfiguration.dateTimeKind === "date");
  if (target.type === "text") return type === "builtin.form.text-field" || type === "builtin.form.text-area" || type === "builtin.form.select-field";
  if (target.type === "enum" && type === "builtin.form.select-field" && Array.isArray(target.enumValues)) {
    const allowed = new Set(target.enumValues);
    const choices = readFormChoiceOptions(source).filter((choice) => !choice.disabled);
    return choices.length > 0 && choices.every((choice) => allowed.has(choice.value));
  }
  return false;
}

export function SystemFormActionEditor({ formId, fields, instances, action, onSave, onRemove }: {
  readonly formId: string;
  readonly fields: readonly AssetInstance[];
  readonly instances: readonly AssetInstance[];
  readonly action?: SystemFormAction;
  readonly onSave: (action: SystemFormAction) => void;
  readonly onRemove: () => void;
}) {
  const { operations, operationCount, recordFields } = readFormActionOptions(instances);
  const saved = JSON.stringify(action ?? null);
  const [source, setSource] = useState(saved);
  const [operationId, setOperationId] = useState(action?.operationId ?? "");
  const [mappings, setMappings] = useState<readonly SystemFormActionMapping[]>(action?.mappings ?? []);
  const [fieldId, setFieldId] = useState("");
  const [recordField, setRecordField] = useState("");
  if (source !== saved) {
    setSource(saved);
    setOperationId(action?.operationId ?? "");
    setMappings(action?.mappings ?? []);
    setFieldId("");
    setRecordField("");
  }
  const selectedField = fields.find((field) => field.instanceId === fieldId);
  const availableTargets = selectedField ? recordFields.filter((field) =>
    isFormActionFieldCompatible(selectedField, field) && !mappings.some((mapping) => mapping.recordField === field.name)) : [];
  const compatible = (mapping: SystemFormActionMapping) => {
    const source = fields.find((item) => item.instanceId === mapping.fieldId);
    const target = recordFields.find((item) => item.name === mapping.recordField);
    return Boolean(source && target && isFormActionFieldCompatible(source, target));
  };
  const hasOperation = operationCount === 1 && operations.length === 1;
  const canSave = hasOperation && operations[0]!.instanceId === operationId && mappings.length > 0 && mappings.every(compatible);
  function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedField || !availableTargets.some((field) => field.name === recordField) ||
        mappings.some((mapping) => mapping.fieldId === fieldId) || mappings.length >= 32) return;
    setMappings([...mappings, { fieldId, recordField }]);
    setFieldId("");
    setRecordField("");
  }

  return <details className="ui-panel ui-stack ui-stack--sm">
    <summary>After submission</summary>
    <p>Choose a Create Record operation that is already configured in this system. Only the answers you map are sent.</p>
    {hasOperation ? <>
      <label className="ui-stack ui-stack--sm">Record action
        <select value={operationId} onChange={(event) => setOperationId(event.currentTarget.value)}>
          <option value="">Choose an action</option>
          {operations.map((entry) => <option value={entry.instanceId} key={entry.instanceId}>{entry.displayName || "Create Record"} ({String(entry.selectedConfiguration?.entity)})</option>)}
        </select>
      </label>
      <ol>{mappings.map((mapping, index) => <li key={mapping.fieldId}>
        {fields.find((field) => field.instanceId === mapping.fieldId)?.displayName ?? "Unavailable answer"}
        {" → "}{recordFields.find((field) => field.name === mapping.recordField)?.label ?? "Unavailable record field"}{" "}
        <button type="button" className="ui-button ui-button--outline" aria-label={`Remove mapping ${index + 1}`}
          onClick={() => setMappings(mappings.filter((item) => item !== mapping))}>Remove</button>
      </li>)}</ol>
      {fields.length > 0 && recordFields.length > 0 ? <form className="ui-stack ui-stack--sm" onSubmit={add}>
        <label className="ui-stack ui-stack--sm">Form answer to send
          <select value={fieldId} onChange={(event) => { setFieldId(event.currentTarget.value); setRecordField(""); }}>
            <option value="">Choose an answer</option>
            {fields.filter((field) => !mappings.some((mapping) => mapping.fieldId === field.instanceId))
              .map((field) => <option key={field.instanceId} value={field.instanceId}>{field.displayName}</option>)}
          </select>
        </label>
        <label className="ui-stack ui-stack--sm">Destination record field
          <select value={recordField} onChange={(event) => setRecordField(event.currentTarget.value)}>
            <option value="">Choose a field</option>
            {availableTargets.map((field) => <option key={field.name} value={field.name}>{field.label}</option>)}
          </select>
        </label>
        <div><button type="submit" className="ui-button ui-button--outline" disabled={!recordField || mappings.length >= 32}>Add mapping</button></div>
      </form> : <p>Add form answers and record fields before setting up this action.</p>}
      <div className="ui-workflow__actions"><button type="button" className="ui-button" disabled={!canSave}
        onClick={() => onSave({ formId, operationId, mappings })}>Set submission action</button></div>
    </> : <p>{operationCount > 1 ? "Keep one Create Record operation in this system before setting up a form action."
      : operationCount === 1 ? "Configure a valid record entity for the Create Record operation."
        : "This system has no configured Create Record operation."}</p>}
    {action ? <button type="button" className="ui-button ui-button--outline" onClick={onRemove}>Remove submission action</button> : null}
  </details>;
}
