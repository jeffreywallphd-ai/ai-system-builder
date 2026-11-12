import { useMemo, useState, type FormEvent } from "react";
import type { AssetConfigurationValues, AssetInstance } from "../../../contracts/asset";
import type { SystemBuilderComposerAsset } from "../../../contracts/system-builder";
import type { SystemComposerDraft } from "./systemComposerDraft";
import { FORM_COMPOSER_FOUNDATION_VERSION, readSystemForms } from "./systemFormComposerDraft";

export const FORM_COMPOSER_FIELDS = [
  ["builtin.form.text-field", "Short text"],
  ["builtin.form.text-area", "Long text"],
  ["builtin.form.select-field", "Choice"],
  ["builtin.form.number-field", "Number"],
  ["builtin.form.date-time-field", "Date and time"],
  ["builtin.form.checkbox-field", "Checkbox"],
] as const;
export type FormComposerFieldId = (typeof FORM_COMPOSER_FIELDS)[number][0];

export function readFormStepFields(draft: SystemComposerDraft, stepId: string): readonly AssetInstance[] {
  const byId = new Map(draft.instances.map((item) => [item.instanceId, item]));
  return draft.placements.filter((edge) => edge.parentInstanceRef.id === stepId && edge.slotId === "fields")
    .sort((left, right) => left.order - right.order)
    .map((edge) => byId.get(edge.childInstanceRef.id))
    .filter((item): item is AssetInstance => Boolean(item?.definitionRef.kind === "asset-definition-version" &&
      item.definitionRef.version === FORM_COMPOSER_FOUNDATION_VERSION &&
      FORM_COMPOSER_FIELDS.some(([id]) => id === item.definitionRef.id)));
}

interface SystemFormComposerViewProps {
  readonly draft: SystemComposerDraft;
  readonly catalog: readonly SystemBuilderComposerAsset[];
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly onCreateForm: (name: string) => void;
  readonly onAddStep: (formId: string, name: string) => void;
  readonly onAddField: (stepId: string, definitionId: FormComposerFieldId) => void;
  readonly onMove: (instanceId: string, direction: -1 | 1) => void;
  readonly onUpdate: (instanceId: string, values: AssetConfigurationValues) => void;
  readonly onUndo: () => void;
  readonly onRedo: () => void;
}

export function SystemFormComposerView({
  draft, catalog, canUndo, canRedo, onCreateForm, onAddStep, onAddField, onMove,
  onUpdate, onUndo, onRedo,
}: SystemFormComposerViewProps) {
  const [formName, setFormName] = useState("");
  const [stepName, setStepName] = useState("");
  const [selectedFormId, setSelectedFormId] = useState("");
  const [selectedStepId, setSelectedStepId] = useState("");
  const [selectedFieldId, setSelectedFieldId] = useState("");
  const [fieldType, setFieldType] = useState<FormComposerFieldId>(FORM_COMPOSER_FIELDS[0][0]);
  const forms = useMemo(() => readSystemForms(draft, catalog), [draft, catalog]);
  const form = forms.find((entry) => entry.form.instanceId === selectedFormId) ?? forms[0];
  const step = form?.steps.find((entry) => entry.instanceId === selectedStepId) ?? form?.steps[0];
  const fields = useMemo(() => step ? readFormStepFields(draft, String(step.instanceId)) : [], [draft, step]);
  const field = fields.find((item) => item.instanceId === selectedFieldId) ?? fields[0];

  function submitForm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (formName.trim()) onCreateForm(formName);
  }
  function submitStep(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (form && stepName.trim()) onAddStep(String(form.form.instanceId), stepName);
  }

  return (
    <section className="ui-stack ui-stack--md" aria-labelledby="system-form-composer-heading">
      <div className="ui-workflow__actions">
        <h3 id="system-form-composer-heading">Form Composer</h3>
        <button className="ui-button ui-button--outline" type="button" onClick={onUndo} disabled={!canUndo}>Undo</button>
        <button className="ui-button ui-button--outline" type="button" onClick={onRedo} disabled={!canRedo}>Redo</button>
      </div>
      <form className="ui-panel ui-stack ui-stack--sm" onSubmit={submitForm}>
        <label className="ui-stack ui-stack--sm">
          New form name
          <input maxLength={200} required value={formName} onChange={(event) => setFormName(event.currentTarget.value)} />
        </label>
        <div className="ui-workflow__actions">
          <button className="ui-button" type="submit" disabled={!formName.trim()}>Create form</button>
        </div>
      </form>
      {form ? (
        <div className="ui-stack ui-stack--md">
          <section className="ui-panel ui-stack ui-stack--sm" aria-label="Form and steps">
            <label className="ui-stack ui-stack--sm">
              Form
              <select value={form.form.instanceId} onChange={(event) => {
                setSelectedFormId(event.currentTarget.value);
                setSelectedStepId("");
                setSelectedFieldId("");
              }}>
                {forms.map((entry) => <option key={entry.form.instanceId} value={entry.form.instanceId}>{entry.form.displayName}</option>)}
              </select>
            </label>
            <p>Canvas page <strong>{form.page.displayName}</strong></p>
            <form className="ui-stack ui-stack--sm" onSubmit={submitStep}>
              <label className="ui-stack ui-stack--sm">
                New step name
                <input maxLength={200} required value={stepName} onChange={(event) => setStepName(event.currentTarget.value)} />
              </label>
              <div className="ui-workflow__actions">
                <button className="ui-button ui-button--outline" type="submit" disabled={!stepName.trim()}>Add step</button>
              </div>
            </form>
            {step ? (
              <>
                <label className="ui-stack ui-stack--sm">
                  Form step
                  <select value={step.instanceId} onChange={(event) => {
                    setSelectedStepId(event.currentTarget.value);
                    setSelectedFieldId("");
                  }}>
                    {form.steps.map((entry) => <option key={entry.instanceId} value={entry.instanceId}>{entry.displayName}</option>)}
                  </select>
                </label>
                <label className="ui-stack ui-stack--sm" key={step.instanceId}>
                  Step name
                  <input key={step.displayName} maxLength={200} defaultValue={step.displayName}
                    onBlur={(event) => {
                      const title = event.currentTarget.value.trim();
                      if (title && title !== step.displayName) onUpdate(String(step.instanceId), { title });
                      else event.currentTarget.value = step.displayName ?? "";
                    }} />
                </label>
                <div className="ui-workflow__actions">
                  <button className="ui-button ui-button--outline" type="button"
                    disabled={form.steps[0] === step} onClick={() => onMove(String(step.instanceId), -1)}>Move step up</button>
                  <button className="ui-button ui-button--outline" type="button"
                    disabled={form.steps.at(-1) === step} onClick={() => onMove(String(step.instanceId), 1)}>Move step down</button>
                </div>
              </>
            ) : null}
          </section>
          {step ? (
            <section className="ui-panel ui-stack ui-stack--sm" aria-label="Fields in this step">
              <div className="ui-workflow__actions">
                <label>Field type <select value={fieldType} onChange={(event) => setFieldType(event.currentTarget.value as FormComposerFieldId)}>
                  {FORM_COMPOSER_FIELDS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
                </select></label>
                <button className="ui-button ui-button--outline" type="button" onClick={() => onAddField(String(step.instanceId), fieldType)}>Add field</button>
              </div>
              {field ? (
                <>
                  <label className="ui-stack ui-stack--sm">
                    Field
                    <select value={field.instanceId} onChange={(event) => setSelectedFieldId(event.currentTarget.value)}>
                      {fields.map((entry) => <option key={entry.instanceId} value={entry.instanceId}>{entry.displayName}</option>)}
                    </select>
                  </label>
                  <FieldSettings key={field.instanceId} field={field} onUpdate={onUpdate} />
                  <div className="ui-workflow__actions">
                    <button className="ui-button ui-button--outline" type="button"
                      disabled={fields[0] === field} onClick={() => onMove(String(field.instanceId), -1)}>Move field up</button>
                    <button className="ui-button ui-button--outline" type="button"
                      disabled={fields.at(-1) === field} onClick={() => onMove(String(field.instanceId), 1)}>Move field down</button>
                  </div>
                </>
              ) : <p className="ui-text-muted">No fields yet.</p>}
            </section>
          ) : null}
        </div>
      ) : <p className="ui-text-muted">Create a form to add its page to the system.</p>}
    </section>
  );
}

function FieldSettings({field, onUpdate}: {
  readonly field: AssetInstance;
  readonly onUpdate: SystemFormComposerViewProps["onUpdate"];
}) {
  const values = field.selectedConfiguration;
  const label = typeof values?.label === "string" ? values.label : field.displayName ?? "";
  const help = typeof values?.helpText === "string" ? values.helpText : "";
  return (
    <>
      <label className="ui-stack ui-stack--sm">
        Field label
        <input key={label} maxLength={200} defaultValue={label} onBlur={(event) => {
          const next = event.currentTarget.value.trim();
          if (next && next !== label) onUpdate(String(field.instanceId), { label: next });
          else event.currentTarget.value = label;
        }} />
      </label>
      <label className="ui-stack ui-stack--sm">
        Help text
        <textarea key={help} maxLength={1000} defaultValue={help} onBlur={(event) => {
          if (event.currentTarget.value !== help) onUpdate(String(field.instanceId), { helpText: event.currentTarget.value });
        }} />
      </label>
      <label><input type="checkbox" checked={values?.required === true} onChange={(event) => {
        onUpdate(String(field.instanceId), { required: event.currentTarget.checked });
      }} /> Required answer</label>
    </>
  );
}
