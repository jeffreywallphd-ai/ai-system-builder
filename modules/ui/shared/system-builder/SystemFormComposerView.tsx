import { useMemo, useState, type FormEvent } from "react";
import type { AssetConfigurationValues, AssetInstance } from "../../../contracts/asset";
import type { SystemBuilderComposerAsset } from "../../../contracts/system-builder";
import type { SystemFormRoute } from "../../../contracts/system-builder";
import { compileSystemForm, type CompiledSystemForm } from "../../../application/services/system-builder/system-form-rules.service";
import { SystemFormPreview } from "./SystemFormPreview";
import { readFormChoiceOptions, SystemFormRoutingEditor } from "./SystemFormRoutingEditor";
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
  readonly onSaveRoute: (formId: string, route: SystemFormRoute) => void;
  readonly onRemoveRoute: (formId: string, bindingId: string) => void;
  readonly onUndo: () => void;
  readonly onRedo: () => void;
}

export function SystemFormComposerView({
  draft, catalog, canUndo, canRedo, onCreateForm, onAddStep, onAddField, onMove,
  onUpdate, onSaveRoute, onRemoveRoute, onUndo, onRedo,
}: SystemFormComposerViewProps) {
  const [formName, setFormName] = useState("");
  const [stepName, setStepName] = useState("");
  const [selectedFormId, setSelectedFormId] = useState("");
  const [selectedStepId, setSelectedStepId] = useState("");
  const [selectedFieldId, setSelectedFieldId] = useState("");
  const [fieldType, setFieldType] = useState<FormComposerFieldId>(FORM_COMPOSER_FIELDS[0][0]);
  const [preview, setPreview] = useState<CompiledSystemForm>();
  const [previewError, setPreviewError] = useState<{ readonly draft: SystemComposerDraft; readonly formId: string; readonly message: string }>();
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
  function openPreview() {
    if (!form) return;
    const formId = String(form.form.instanceId);
    const result = compileSystemForm(draft, formId);
    if (result.ok) { setPreview(result.value); setPreviewError(undefined); }
    else setPreviewError({ draft, formId, message: result.message });
  }

  return (
    <section className="ui-stack ui-stack--md" aria-labelledby="system-form-composer-heading">
      <div className="ui-workflow__actions">
        <h3 id="system-form-composer-heading">Form Composer</h3>
        <button className="ui-button ui-button--outline" type="button" onClick={onUndo} disabled={!canUndo}>Undo</button>
        <button className="ui-button ui-button--outline" type="button" onClick={onRedo} disabled={!canRedo}>Redo</button>
        {form ? <button className="ui-button ui-button--outline" type="button" onClick={openPreview}>Preview form</button> : null}
      </div>
      {previewError?.draft === draft && previewError.formId === form?.form.instanceId ? <p role="alert">{previewError.message}</p> : null}
      {preview ? <SystemFormPreview form={preview} onClose={() => setPreview(undefined)} /> : null}
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
          {step ? <SystemFormRoutingEditor key={step.instanceId} form={form.form} steps={form.steps} step={step}
            fields={fields} bindings={draft.bindings} onSave={(route) => onSaveRoute(String(form.form.instanceId), route)}
            onRemove={(id) => onRemoveRoute(String(form.form.instanceId), id)} /> : null}
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
  const definition = field.definitionRef.id;
  const numeric = definition === "builtin.form.number-field";
  const text = definition === "builtin.form.text-field" || definition === "builtin.form.text-area";
  const choice = definition === "builtin.form.select-field";
  const options = choice ? readFormChoiceOptions(field) : [];
  const [newOption, setNewOption] = useState("");
  function addOption(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next = newOption.trim();
    if (!next || options.length >= 32 || options.some((option) => option.label === next)) return;
    const base = `option-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
    let index = 1;
    while (options.some((option) => option.optionId === `${base}-${index}` || option.value === `${base}-${index}`)) index++;
    const optionId = `${base}-${index}`;
    onUpdate(String(field.instanceId), { staticOptions: [...options, { optionId, label: next, value: optionId }] });
    setNewOption("");
  }
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
      {numeric || text ? (numeric ? [["minimum", "Minimum value"], ["maximum", "Maximum value"]]
        : [["minLength", "Minimum characters"], ["maxLength", "Maximum characters"]]).map(([key, name]) => (
          <label className="ui-stack ui-stack--sm" key={`${key}-${values?.[key]}`}>
            {name}
            <input type="number" step={numeric ? "any" : 1} min={text ? key === "maxLength" ? 1 : 0 : undefined}
              max={text ? 4000 : undefined} defaultValue={typeof values?.[key] === "number" ? values[key] : ""}
              onBlur={(event) => {
                const value = event.currentTarget.valueAsNumber;
                if (!event.currentTarget.value && !event.currentTarget.validity.badInput && typeof values?.[key] === "number") {
                  onUpdate(String(field.instanceId), { [key]: null });
                } else if (event.currentTarget.validity.valid && Number.isFinite(value) && value !== values?.[key]) {
                  onUpdate(String(field.instanceId), { [key]: value });
                } else event.currentTarget.value = typeof values?.[key] === "number" ? String(values[key]) : "";
              }} />
          </label>
        )) : null}
      {definition === "builtin.form.date-time-field" ? <label className="ui-stack ui-stack--sm">
        Date and time format
        <select value={typeof values?.dateTimeKind === "string" ? values.dateTimeKind : "date"}
          onChange={(event) => onUpdate(String(field.instanceId), { dateTimeKind: event.currentTarget.value })}>
          <option value="date">Date</option><option value="time">Time</option><option value="date-time">Date and time</option>
        </select>
      </label> : null}
      {choice ? <div className="ui-stack ui-stack--sm">
        <h4>Choice options</h4>
        {options.length ? <ol>{options.map((option, index) => <li key={option.optionId}>
          <span>{option.label}</span>{" "}
          <button type="button" className="ui-button ui-button--outline" aria-label={`Remove choice ${index + 1}`}
            onClick={() => onUpdate(String(field.instanceId), { staticOptions: options.filter((item) => item !== option) })}>Remove</button>
        </li>)}</ol> : <p>Add an option so respondents can choose an answer.</p>}
        <form className="ui-stack ui-stack--sm" onSubmit={addOption}>
          <label className="ui-stack ui-stack--sm">New option label
            <input required value={newOption} maxLength={200} onChange={(event) => setNewOption(event.currentTarget.value)} />
          </label>
          <div><button type="submit" className="ui-button ui-button--outline"
            disabled={!newOption.trim() || options.length >= 32 || options.some((item) => item.label === newOption.trim())}>Add option</button></div>
        </form>
      </div> : null}
    </>
  );
}
