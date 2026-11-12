import { useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent } from "react";
import type { AssetConfigurationValues, AssetInstance } from "../../../contracts/asset";
import { readSystemFormAction, systemFormPlacementAllowed, type SystemBuilderComposerAsset,
  type SystemBuilderResult, type SystemFormAction, type SystemFormRoute } from "../../../contracts/system-builder";
import { compileSystemForm, type CompiledSystemForm } from "../../../application/services/system-builder/system-form-rules.service";
import { SystemFormPreview } from "./SystemFormPreview";
import { SystemFormActionEditor } from "./SystemFormActionEditor";
import { isFormChoiceAsset, readFormChoiceOptions, SystemFormRoutingEditor } from "./SystemFormRoutingEditor";
import { TabbedPanel } from "../components/TabbedPanel";
import { SystemComposerInspector } from "./SystemComposerInspector";
import type { SystemComposerDraft } from "./systemComposerDraft";
import { FORM_COMPOSER_FOUNDATION_VERSION, type SystemFormDraftEntry } from "./systemFormComposerDraft";

export const FORM_COMPOSER_FIELDS = [
  ["builtin.form.text-field", "Short text"],
  ["builtin.form.text-area", "Long text"],
  ["builtin.form.select-field", "Choice"],
  ["builtin.form.radio-group", "Radio buttons"],
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

export function readFormPresentationElements(draft: SystemComposerDraft, entry: SystemFormDraftEntry): readonly AssetInstance[] {
  const members = [entry.form, ...entry.steps];
  const byOwner = new Map(members.map((item) => [item.instanceId, item]));
  const byId = new Map(draft.instances.map((item) => [item.instanceId, item]));
  const controls = draft.placements.flatMap((edge) => {
    if (edge.slotId !== "actions" && edge.slotId !== "messages") return [];
    const owner = byOwner.get(edge.parentInstanceRef.id);
    const element = byId.get(edge.childInstanceRef.id);
    if (!owner || element?.definitionRef.kind !== "asset-definition-version" ||
        element.definitionRef.version !== FORM_COMPOSER_FOUNDATION_VERSION ||
        !["builtin.form.submit-action", "builtin.form.cancel-action", "builtin.form.validation-message"].includes(element.definitionRef.id) ||
        !systemFormPlacementAllowed(element.definitionRef, owner.definitionRef, edge.slotId)) return [];
    return [element];
  });
  return [...members, ...controls];
}

interface SystemFormComposerViewProps {
  readonly draft: SystemComposerDraft;
  readonly form: SystemFormDraftEntry;
  readonly ready: boolean;
  readonly readDefinition: (instance: AssetInstance, isOpen: () => boolean) => Promise<SystemBuilderResult<SystemBuilderComposerAsset>>;
  readonly onUpdatePresentation: (instanceId: string, definition: SystemBuilderComposerAsset, values: AssetConfigurationValues) => void;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly onBackToCanvas: () => void;
  readonly onAddStep: (formId: string, name: string) => Promise<string | undefined>;
  readonly onAddField: (stepId: string, definitionId: FormComposerFieldId) => Promise<string | undefined>;
  readonly onMove: (instanceId: string, direction: -1 | 1) => void;
  readonly onUpdate: (instanceId: string, values: AssetConfigurationValues) => void;
  readonly onSaveRoute: (formId: string, route: SystemFormRoute) => void;
  readonly onRemoveRoute: (formId: string, bindingId: string) => void;
  readonly onUpdateAction: (formId: string, action?: SystemFormAction) => void;
  readonly onUndo: () => void;
  readonly onRedo: () => void;
}

export function SystemFormComposerView({
  draft, form, ready, readDefinition, onUpdatePresentation, canUndo, canRedo, onBackToCanvas, onAddStep, onAddField, onMove,
  onUpdate, onSaveRoute, onRemoveRoute, onUpdateAction, onUndo, onRedo,
}: SystemFormComposerViewProps) {
  const backButton = useRef<HTMLButtonElement>(null);
  const pageEditor = useRef<HTMLDivElement>(null);
  const entered = useRef(false);
  const adding = useRef(false);
  const [selectedPageId, setSelectedPageId] = useState("");
  const [selectedElementId, setSelectedElementId] = useState("");
  const [focusPageId, setFocusPageId] = useState<string>();
  const [fieldType, setFieldType] = useState<FormComposerFieldId>(FORM_COMPOSER_FIELDS[0][0]);
  const [preview, setPreview] = useState<CompiledSystemForm>();
  const [previewError, setPreviewError] = useState<{ readonly draft: SystemComposerDraft; readonly formId: string; readonly message: string }>();
  const formId = String(form.form.instanceId);
  const directFields = useMemo(() => readFormStepFields(draft, formId), [draft, formId]);
  const page = form.steps.find((entry) => entry.instanceId === selectedPageId) ?? form.steps[0];
  const currentPageId = page ? String(page.instanceId) : undefined;
  const fields = useMemo(() => page ? readFormStepFields(draft, String(page.instanceId)) : [], [draft, page]);
  const presentation = useMemo(() => readFormPresentationElements(draft, form), [draft, form]);
  const controls = useMemo(() => {
    const currentControlIds = new Set<string>(draft.placements.filter((edge) =>
      (edge.slotId === "actions" || edge.slotId === "messages") &&
      (edge.parentInstanceRef.id === formId || edge.parentInstanceRef.id === page?.instanceId))
      .map((edge) => edge.childInstanceRef.id));
    return presentation.filter((item) => currentControlIds.has(item.instanceId));
  }, [draft.placements, formId, page?.instanceId, presentation]);
  const elements = [form.form, ...(page ? [page] : []), ...fields, ...directFields, ...controls];
  const selected = elements.find((item) => item.instanceId === selectedElementId) ?? page ?? directFields[0] ?? form.form;
  const fieldGroup = fields.some((item) => item.instanceId === selected.instanceId) ? fields : directFields;
  const selectedField = fieldGroup.find((item) => item.instanceId === selected.instanceId);
  const action = draft.bindings.map(readSystemFormAction).find((entry) => entry?.formId === formId);
  const actionFields = useMemo(() => form.steps.flatMap((item) => readFormStepFields(draft, String(item.instanceId))), [draft, form.steps]);

  useEffect(() => {
    if (ready && !entered.current && backButton.current) {
      entered.current = true;
      backButton.current.focus();
    }
  }, [ready]);

  useLayoutEffect(() => {
    if (currentPageId && focusPageId === currentPageId) {
      pageEditor.current?.querySelector<HTMLButtonElement>('[role="tab"][aria-selected="true"]')?.focus();
      setFocusPageId(undefined);
    }
  }, [currentPageId, focusPageId]);

  function selectPage(id: string) {
    setSelectedPageId(id);
    setSelectedElementId("");
  }

  async function addPage() {
    if (adding.current || form.steps.length >= 32) return;
    adding.current = true;
    try {
      const titles = new Set(form.steps.map((item) => item.displayName));
      let number = form.steps.length + 1;
      while (titles.has(`Page ${number}`)) number += 1;
      const id = await onAddStep(formId, `Page ${number}`);
      if (id) {
        selectPage(id);
        setFocusPageId(id);
      }
    } finally {
      adding.current = false;
    }
  }

  async function addField() {
    if (!page || adding.current) return;
    adding.current = true;
    try {
      const id = await onAddField(String(page.instanceId), fieldType);
      if (id) setSelectedElementId(id);
    } finally {
      adding.current = false;
    }
  }

  function openPreview() {
    const result = compileSystemForm(draft, formId);
    if (result.ok) { setPreview(result.value); setPreviewError(undefined); }
    else setPreviewError({ draft, formId, message: result.message });
  }

  const addPageAction = <button className="ui-tabbed-panel__tab system-form-composer__new-page" type="button"
    disabled={form.steps.length >= 32} title={form.steps.length >= 32 ? "This form has the maximum of 32 pages." : undefined}
    onClick={() => void addPage()}>New Form Page +</button>;

  const fieldList = (items: readonly AssetInstance[], label: string) => (
    <ul className="system-form-composer__fields" aria-label={label}>
      {items.map((item) => (
        <li key={item.instanceId}>
          <button className="ui-button ui-button--outline" type="button"
            aria-pressed={selected.instanceId === item.instanceId} onClick={() => setSelectedElementId(String(item.instanceId))}>
            {item.displayName ?? "Untitled field"}
          </button>
        </li>
      ))}
    </ul>
  );

  const pageContent = (
    <div className="ui-stack ui-stack--md">
      <section className="ui-stack ui-stack--sm" aria-label="Fields on this page">
        <div className="ui-workflow__actions">
          <label>Field type <select value={fieldType} onChange={(event) => setFieldType(event.currentTarget.value as FormComposerFieldId)}>
            {FORM_COMPOSER_FIELDS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          </select></label>
          <button className="ui-button ui-button--outline" type="button" onClick={() => void addField()}>Add field</button>
        </div>
        {fields.length ? fieldList(fields, "Form fields") : <p className="ui-text-muted">No fields yet.</p>}
      </section>
      {page ? <SystemFormRoutingEditor key={page.instanceId} form={form.form} steps={form.steps} step={page}
        fields={fields} bindings={draft.bindings} onSave={(route) => onSaveRoute(formId, route)}
        onRemove={(id) => onRemoveRoute(formId, id)} /> : null}
    </div>
  );
  const pages = form.steps.map((item) => ({ id: String(item.instanceId), label: item.displayName ?? "Untitled page",
    keepMounted: true, content: item.instanceId === currentPageId ? pageContent : null }));

  return (
    <section className="system-form-composer ui-stack ui-stack--md" aria-labelledby="system-form-composer-heading">
      <div className="ui-workflow__actions">
        <h3 id="system-form-composer-heading">Form Composer</h3>
        <button ref={backButton} className="ui-button ui-button--outline" type="button" onClick={onBackToCanvas}>Back to Canvas</button>
        <button className="ui-button ui-button--outline" type="button" onClick={onUndo} disabled={!canUndo}>Undo</button>
        <button className="ui-button ui-button--outline" type="button" onClick={onRedo} disabled={!canRedo}>Redo</button>
        <button className="ui-button ui-button--outline" type="button" onClick={openPreview}>Preview form</button>
      </div>
      <div className="ui-stack ui-stack--xs">
        <h4>{form.form.displayName ?? "Form"}</h4>
        {form.page ? <p>Canvas page <strong>{form.page.displayName}</strong></p>
          : <p>Canvas container <strong>{form.region?.displayName ?? "System layout"}</strong></p>}
      </div>
      {previewError?.draft === draft && previewError.formId === formId ? <p role="alert">{previewError.message}</p> : null}
      {preview ? <SystemFormPreview form={preview} hasConfiguredAction={action?.formId === preview.id}
        onClose={() => setPreview(undefined)} /> : null}
      <div className="system-form-composer__workspace">
        <div className="system-form-composer__page-editor ui-stack ui-stack--md" ref={pageEditor}>
          {pages.length ? <TabbedPanel tabs={pages} activeTabId={currentPageId} tabListAriaLabel="Form pages"
            tabListAction={addPageAction} onTabChange={selectPage} /> : (
            <section className="ui-panel ui-stack ui-stack--sm" aria-label="Form pages">
              <div className="ui-workflow__actions">{addPageAction}</div>
              <p>Add a form page to start adding fields.</p>
            </section>
          )}
          {directFields.length ? <section className="ui-panel ui-stack ui-stack--sm" aria-label="Fields outside form pages">
            <h5>Fields outside form pages</h5>
            <p>In Canvas, move these fields to a form page before you preview the form or set a submission action.</p>
            {fieldList(directFields, "Fields to move")}
          </section> : null}
          <SystemFormActionEditor key={formId} formId={formId} fields={actionFields} instances={draft.instances} action={action}
            onSave={(next) => onUpdateAction(formId, next)} onRemove={() => onUpdateAction(formId)} />
        </div>
        <aside className="system-form-composer__properties ui-panel ui-stack ui-stack--sm" aria-label="Properties">
          <h5>Properties</h5>
          <label className="ui-stack ui-stack--sm">
            Element
            <select value={selected.instanceId} onChange={(event) => setSelectedElementId(event.currentTarget.value)}>
              <optgroup label="Form"><option value={formId}>{form.form.displayName ?? "Form"}</option></optgroup>
              {page ? <optgroup label="Page"><option value={page.instanceId}>{page.displayName ?? "Untitled page"}</option></optgroup> : null}
              {fields.length ? <optgroup label="Fields">{fields.map((item) => <option key={item.instanceId} value={item.instanceId}>
                {item.displayName ?? "Untitled field"}
              </option>)}</optgroup> : null}
              {directFields.length ? <optgroup label="Fields outside form pages">{directFields.map((item) => <option key={item.instanceId} value={item.instanceId}>
                {item.displayName ?? "Untitled field"}
              </option>)}</optgroup> : null}
              {controls.length ? <optgroup label="Buttons and messages">{controls.map((item) => <option key={item.instanceId} value={item.instanceId}>
                {item.displayName ?? item.definitionRef.id}
              </option>)}</optgroup> : null}
            </select>
          </label>
          {selectedField ? (
            <>
              <FieldSettings key={selectedField.instanceId} field={selectedField} onUpdate={onUpdate} />
              <div className="ui-workflow__actions">
                <button className="ui-button ui-button--outline" type="button"
                  disabled={fieldGroup[0] === selectedField} onClick={() => onMove(String(selectedField.instanceId), -1)}>Move field up</button>
                <button className="ui-button ui-button--outline" type="button"
                  disabled={fieldGroup[fieldGroup.length - 1] === selectedField} onClick={() => onMove(String(selectedField.instanceId), 1)}>Move field down</button>
              </div>
            </>
          ) : page?.instanceId === selected.instanceId ? (
            <div className="ui-stack ui-stack--sm" key={page.instanceId}>
              <label className="ui-stack ui-stack--sm">
                Form page name
                <input key={page.displayName} maxLength={200} defaultValue={page.displayName}
                  onBlur={(event) => {
                    const title = event.currentTarget.value.trim();
                    if (title && title !== page.displayName) onUpdate(String(page.instanceId), { title });
                    else event.currentTarget.value = page.displayName ?? "";
                  }} />
              </label>
              <div className="ui-workflow__actions">
                <button className="ui-button ui-button--outline" type="button"
                  disabled={form.steps[0] === page} onClick={() => onMove(String(page.instanceId), -1)}>Move form page up</button>
                <button className="ui-button ui-button--outline" type="button"
                  disabled={form.steps[form.steps.length - 1] === page} onClick={() => onMove(String(page.instanceId), 1)}>Move form page down</button>
              </div>
              <MorePageProperties element={selected} members={presentation}
                readDefinition={readDefinition} onUpdate={onUpdatePresentation} />
            </div>
          ) : <FormAssetProperties key={selected.instanceId} element={selected} members={presentation}
            readDefinition={readDefinition} onUpdate={onUpdatePresentation} />}
        </aside>
      </div>
    </section>
  );
}

interface FormAssetPropertiesProps {
  readonly element: AssetInstance;
  readonly members: readonly AssetInstance[];
  readonly readDefinition: SystemFormComposerViewProps["readDefinition"];
  readonly onUpdate: SystemFormComposerViewProps["onUpdatePresentation"];
}

function MorePageProperties(props: FormAssetPropertiesProps) {
  const [open, setOpen] = useState(false);
  return <details onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary>More page properties</summary>
    {open ? <FormAssetProperties {...props} /> : null}
  </details>;
}

function FormAssetProperties({ element, members, readDefinition, onUpdate }: FormAssetPropertiesProps) {
  const [attempt, setAttempt] = useState(0);
  const [resolved, setResolved] = useState<{ definition?: SystemBuilderComposerAsset }>();
  const id = String(element.instanceId);
  const definitionRef = element.definitionRef;
  useEffect(() => {
    let active = true;
    setResolved(undefined);
    void readDefinition(element, () => active).then((result) => {
      if (!active) return;
      const definition = result.ok && result.value?.builtIn && result.value.configurationSchema ? result.value : undefined;
      setResolved({ definition });
    }).catch(() => { if (active) setResolved({}); });
    return () => { active = false; };
  }, [attempt, definitionRef.id, definitionRef.kind, definitionRef.version, id, readDefinition]);
  const definition = resolved?.definition;
  return definition ? <SystemComposerInspector mode="configuration" embedded
    selectedInstance={element} selectedDefinition={definition} instances={members} catalog={[definition]} bindings={[]}
    onConfigurationChange={(values) => onUpdate(id, definition, values)} onAddConnection={() => {}} onRemoveConnection={() => {}} />
    : resolved ? <div className="ui-stack ui-stack--xs">
      <p role="status">Properties are unavailable for this form asset.</p>
      <button type="button" className="ui-button ui-button--outline" onClick={() => setAttempt((current) => current + 1)}>Retry properties</button>
    </div> : <p role="status">Loading form properties…</p>;
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
  const choice = isFormChoiceAsset(definition);
  const options = choice ? readFormChoiceOptions(field) : [];
  const [newOption, setNewOption] = useState("");
  const [newOptionValue, setNewOptionValue] = useState("");
  const nextOptionValue = newOptionValue.trim() || newOption.trim();
  const canAddOption = Boolean(newOption.trim()) && options.length < 32 &&
    !options.some((option) => option.label === newOption.trim() || option.value === nextOptionValue);
  function addOption(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next = newOption.trim();
    if (!canAddOption) return;
    const base = `option-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
    let index = 1;
    while (options.some((option) => option.optionId === `${base}-${index}` || option.value === `${base}-${index}`)) index++;
    const optionId = `${base}-${index}`;
    onUpdate(String(field.instanceId), { staticOptions: [...options, { optionId, label: next, value: nextOptionValue }] });
    setNewOption("");
    setNewOptionValue("");
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
          <label className="ui-stack ui-stack--sm">Submitted value (optional)
            <input value={newOptionValue} maxLength={200} onChange={(event) => setNewOptionValue(event.currentTarget.value)} />
          </label>
          <p>Leave the value blank to use the label.</p>
          <div><button type="submit" className="ui-button ui-button--outline"
            disabled={!canAddOption}>Add option</button></div>
        </form>
      </div> : null}
    </>
  );
}
