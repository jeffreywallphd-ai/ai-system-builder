import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type FormEvent } from "react";
import type { AssetConfigurationField, AssetConfigurationValues, AssetInstance } from "../../../contracts/asset";
import { readSystemFormAction, systemFormPlacementAllowed, type SystemBuilderComposerAsset,
  type SystemBuilderResult, type SystemFormAction, type SystemFormRoute } from "../../../contracts/system-builder";
import { compileSystemForm, type CompiledSystemForm } from "../../../application/services/system-builder/system-form-rules.service";
import { SystemFormPreview } from "./SystemFormPreview";
import { SystemFormActionEditor } from "./SystemFormActionEditor";
import { isFormChoiceAsset, readFormChoiceOptions, SystemFormRoutingEditor } from "./SystemFormRoutingEditor";
import { TabbedPanel } from "../components/TabbedPanel";
import { ModalDialog } from "../components/ModalDialog";
import { SystemComposerConfigurationField } from "./SystemComposerInspector";
import { isSystemComposerSemanticStyleField, materializeSystemComposerConfiguration, validateSystemComposerConfiguration } from "./systemComposerInspectorModel";
import { systemComposerDescendantIds, type SystemComposerDraft } from "./systemComposerDraft";
import { FORM_COMPOSER_FOUNDATION_ASSET_IDS, FORM_COMPOSER_FOUNDATION_VERSION, type SystemFormDraftEntry } from "./systemFormComposerDraft";

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
  readonly onRemoveElement: (instanceId: string) => boolean;
  readonly onUpdate: (instanceId: string, values: AssetConfigurationValues) => void;
  readonly onSaveRoute: (formId: string, route: SystemFormRoute) => void;
  readonly onRemoveRoute: (formId: string, bindingId: string) => void;
  readonly onUpdateAction: (formId: string, action?: SystemFormAction) => void;
  readonly onUndo: () => void;
  readonly onRedo: () => void;
}

export function SystemFormComposerView({
  draft, form, ready, readDefinition, onUpdatePresentation, canUndo, canRedo, onBackToCanvas, onAddStep, onAddField, onMove,
  onRemoveElement, onUpdate, onSaveRoute, onRemoveRoute, onUpdateAction, onUndo, onRedo,
}: SystemFormComposerViewProps) {
  const backButton = useRef<HTMLButtonElement>(null);
  const pageEditor = useRef<HTMLDivElement>(null);
  const entered = useRef(false);
  const adding = useRef(false);
  const [selectedPageId, setSelectedPageId] = useState("");
  const [selectedElementId, setSelectedElementId] = useState("");
  const [focusPageId, setFocusPageId] = useState<string>();
  const [removalId, setRemovalId] = useState<string>();
  const removalDescriptionId = useId();
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
    const ids = new Set<string>(draft.placements.filter((edge) =>
      (edge.slotId === "actions" || edge.slotId === "messages") &&
      (edge.parentInstanceRef.id === formId || edge.parentInstanceRef.id === page?.instanceId))
      .map((edge) => edge.childInstanceRef.id));
    return presentation.filter((item) => ids.has(item.instanceId));
  }, [draft.placements, formId, page?.instanceId, presentation]);
  const elements = [form.form, ...(page ? [page] : []), ...fields, ...directFields, ...controls];
  const selected = elements.find((item) => item.instanceId === selectedElementId) ?? page ?? directFields[0] ?? form.form;
  const fieldGroup = fields.some((item) => item.instanceId === selected.instanceId) ? fields : directFields;
  const selectedField = fieldGroup.find((item) => item.instanceId === selected.instanceId);
  const propertySource = useFormAssetDefinition(selectedField ? undefined : selected, readDefinition);
  const action = draft.bindings.map(readSystemFormAction).find((entry) => entry?.formId === formId);
  const actionFields = useMemo(() => form.steps.flatMap((item) => readFormStepFields(draft, String(item.instanceId))), [draft, form.steps]);
  const canRemovePage = Boolean(page && page !== form.steps[0]);
  const removalPage = canRemovePage && page?.instanceId === removalId ? page : undefined;
  const removalField = removalId ? [...fields, ...directFields].find((item) => item.instanceId === removalId) : undefined;
  const removal = removalPage ?? removalField;
  const removalKind = removalPage ? "form page" : "field";
  const removedChildren = removal ? systemComposerDescendantIds(draft.placements, String(removal.instanceId)).size : 0;

  useEffect(() => {
    if (ready && !entered.current && backButton.current) {
      entered.current = true;
      backButton.current.focus();
    }
  }, [ready]);

  useLayoutEffect(() => {
    if (!focusPageId || focusPageId !== (currentPageId ?? formId)) return;
    pageEditor.current?.querySelector<HTMLButtonElement>(currentPageId
      ? '[role="tab"][aria-selected="true"]' : 'button.system-form-composer__new-page')?.focus();
    setFocusPageId(undefined);
  }, [currentPageId, focusPageId, formId]);

  function selectPage(id: string) {
    setSelectedPageId(id);
    setSelectedElementId("");
    setRemovalId(undefined);
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

  function confirmRemoval() {
    if (!removal || !onRemoveElement(String(removal.instanceId))) return;
    setRemovalId(undefined);
    if (removalPage) {
      const index = form.steps.indexOf(removalPage);
      const next = form.steps[index + 1] ?? form.steps[index - 1];
      if (next) {
        selectPage(String(next.instanceId));
        setFocusPageId(String(next.instanceId));
      }
    } else {
      if (selectedElementId === removal.instanceId) setSelectedElementId("");
      setFocusPageId(currentPageId ?? formId);
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
          <button className="ui-button ui-button--outline system-form-composer__remove-field" type="button"
            aria-label={`Remove field: ${item.displayName ?? "Untitled field"}`}
            onClick={() => setRemovalId(String(item.instanceId))}>Remove</button>
        </li>
      ))}
    </ul>
  );

  const appearance = (
    <section className="ui-stack ui-stack--sm" aria-label="Element appearance">
      <h5>Element appearance</h5>
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
          <FieldAppearance key={selectedField.instanceId} field={selectedField} onUpdate={onUpdate} />
          <div className="ui-workflow__actions">
            <button className="ui-button ui-button--outline" type="button"
              disabled={fieldGroup[0] === selectedField} onClick={() => onMove(String(selectedField.instanceId), -1)}>Move field up</button>
            <button className="ui-button ui-button--outline" type="button"
              disabled={fieldGroup[fieldGroup.length - 1] === selectedField} onClick={() => onMove(String(selectedField.instanceId), 1)}>Move field down</button>
          </div>
        </>
      ) : propertySource.definition ? (
        <FormAssetControls key={selected.instanceId} part="appearance" element={selected}
          definition={propertySource.definition} onUpdate={onUpdatePresentation} />
      ) : propertySource.failed ? (
        <div className="ui-stack ui-stack--xs">
          <p role="status">Properties are unavailable for this form asset.</p>
          <button type="button" className="ui-button ui-button--outline" onClick={propertySource.retry}>Retry properties</button>
        </div>
      ) : <p role="status">Loading form properties…</p>}
    </section>
  );

  const pageContent = page ? (
    <div className="ui-stack ui-stack--md">
      <section className="ui-stack ui-stack--sm" aria-label="Form page setup">
        <label className="ui-stack ui-stack--sm" key={page.instanceId}>
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
          {canRemovePage ? <button className="ui-button ui-button--outline" type="button"
            onClick={() => setRemovalId(String(page.instanceId))}>Remove form page</button> : null}
        </div>
      </section>
      <section className="ui-stack ui-stack--sm" aria-label="Fields on this page">
        <div className="ui-workflow__actions">
          <label>Field type <select value={fieldType} onChange={(event) => setFieldType(event.currentTarget.value as FormComposerFieldId)}>
            {FORM_COMPOSER_FIELDS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          </select></label>
          <button className="ui-button ui-button--outline" type="button" onClick={() => void addField()}>Add field</button>
        </div>
        {fields.length ? fieldList(fields, "Form fields") : <p className="ui-text-muted">No fields yet.</p>}
      </section>
      {appearance}
    </div>
  ) : null;
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
              {appearance}
            </section>
          )}
          {directFields.length ? <section className="ui-panel ui-stack ui-stack--sm" aria-label="Fields outside form pages">
            <h5>Fields outside form pages</h5>
            <p>In Canvas, move these fields to a form page before you preview the form or set a submission action.</p>
            {fieldList(directFields, "Fields to move")}
          </section> : null}
        </div>
        <aside className="system-form-composer__properties ui-panel ui-stack ui-stack--sm" aria-label="Properties">
          <h5>Properties</h5>
          <p className="ui-text-muted">Styling, validation, and behavior for {selected.displayName ?? "the selected element"}.</p>
          {propertySource.definition ? <FormAssetControls key={`styling:${selected.instanceId}`} part="styling" element={selected}
            definition={propertySource.definition} onUpdate={onUpdatePresentation} /> : null}
          {selectedField ? <FieldBehavior key={`behavior:${selectedField.instanceId}`} field={selectedField} onUpdate={onUpdate} />
            : propertySource.definition ? <FormAssetControls key={`behavior:${selected.instanceId}`} part="behavior" element={selected}
              definition={propertySource.definition} onUpdate={onUpdatePresentation} /> : null}
          {page ? <SystemFormRoutingEditor key={`routes:${page.instanceId}`} form={form.form} steps={form.steps} step={page}
            fields={fields} bindings={draft.bindings} onSave={(route) => onSaveRoute(formId, route)}
            onRemove={(id) => onRemoveRoute(formId, id)} /> : null}
          <SystemFormActionEditor key={`action:${formId}`} formId={formId} fields={actionFields} instances={draft.instances} action={action}
            onSave={(next) => onUpdateAction(formId, next)} onRemove={() => onUpdateAction(formId)} />
        </aside>
      </div>
      {removal ? <ModalDialog open title={`Remove ${removalKind}?`} descriptionId={removalDescriptionId}
        onClose={() => setRemovalId(undefined)}>
        <div className="ui-stack ui-stack--sm" id={removalDescriptionId}>
          <p>Remove <strong>{removal.displayName ?? "this element"}</strong> from the form?</p>
          {removedChildren ? <p>All child fields and controls will also be removed ({removedChildren} total).</p> : null}
          <p>Use Undo to restore the draft before saving.</p>
        </div>
        <div className="ui-workflow__actions">
          <button type="button" className="ui-button ui-button--outline" data-modal-initial-focus
            onClick={() => setRemovalId(undefined)}>Cancel</button>
          <button type="button" className="ui-button ui-button--destructive" onClick={confirmRemoval}>
            Remove {removalKind}
          </button>
        </div>
      </ModalDialog> : null}
    </section>
  );
}

function useFormAssetDefinition(
  element: AssetInstance | undefined,
  readDefinition: SystemFormComposerViewProps["readDefinition"],
) {
  const [attempt, setAttempt] = useState(0);
  const [resolved, setResolved] = useState<{ id: string; definition?: SystemBuilderComposerAsset }>();
  const id = element ? String(element.instanceId) : undefined;
  const ref = element?.definitionRef;
  useEffect(() => {
    if (!element || !id) return;
    let active = true;
    setResolved(undefined);
    void readDefinition(element, () => active).then((result) => {
      if (!active) return;
      const definition = result.ok && result.value?.builtIn && result.value.configurationSchema ? result.value : undefined;
      setResolved({ id, definition });
    }).catch(() => { if (active) setResolved({ id }); });
    return () => { active = false; };
  }, [attempt, id, ref?.id, ref?.kind, ref?.version, readDefinition]);
  const current = resolved?.id === id ? resolved : undefined;
  return { definition: current?.definition, failed: Boolean(current && !current.definition),
    retry: () => setAttempt((value) => value + 1) };
}

const FORM_BEHAVIOR_FIELDS: ReadonlySet<string> = new Set([
  "submitBehavior", "validationMode", "collapsible", "defaultExpanded", "visibilityCondition",
  "showWhen", "fieldRef", "summaryMode", "confirmationRequired", "disabledWhenInvalid", "resetBehavior",
  "showGroupValidation", "severity", "accessibilityRole",
]);

type FormPropertyPart = "appearance" | "styling" | "behavior";

function formPropertyPart(field: AssetConfigurationField): FormPropertyPart {
  if (isSystemComposerSemanticStyleField(field) || field.fieldId === "layout" || field.fieldId === "showRequiredIndicator") return "styling";
  return FORM_BEHAVIOR_FIELDS.has(field.fieldId) ? "behavior" : "appearance";
}

function FormAssetControls({ part, element, definition, onUpdate }: {
  readonly part: FormPropertyPart;
  readonly element: AssetInstance;
  readonly definition: SystemBuilderComposerAsset;
  readonly onUpdate: SystemFormComposerViewProps["onUpdatePresentation"];
}) {
  const values = materializeSystemComposerConfiguration(definition, element.selectedConfiguration);
  const errors = validateSystemComposerConfiguration(definition.configurationSchema, values);
  const scope = definition.configurationSchema?.fields.filter((field) => formPropertyPart(field) === part) ?? [];
  const fields = scope.filter((field) =>
    !(element.definitionRef.id === FORM_COMPOSER_FOUNDATION_ASSET_IDS.step && field.fieldId === "title"));
  function resetDefaults() {
    const defaults = materializeSystemComposerConfiguration(definition, undefined);
    const next = { ...values };
    for (const field of scope) {
      const value = defaults[field.fieldId];
      if (value === undefined) delete next[field.fieldId];
      else next[field.fieldId] = value;
    }
    onUpdate(String(element.instanceId), definition, next);
  }
  if (!scope.length) return null;
  const controls = (
    <div className="ui-stack ui-stack--sm">
      {fields.map((field) => <SystemComposerConfigurationField key={field.fieldId} field={field}
        value={values[field.fieldId]} errors={errors[field.fieldId] ?? []} catalog={[definition]}
        onChange={(value) => onUpdate(String(element.instanceId), definition, { ...values, [field.fieldId]: value })} />)}
      <div><button type="button" className="ui-button ui-button--outline" onClick={resetDefaults}>
        Reset {part} defaults
      </button></div>
    </div>
  );
  return part === "styling" ? (
    <section className="ui-stack ui-stack--sm" aria-label="Styling">
      <h6>Styling</h6>
      {controls}
    </section>
  ) : controls;
}

interface FieldControlsProps {
  readonly field: AssetInstance;
  readonly onUpdate: SystemFormComposerViewProps["onUpdate"];
}

function FieldAppearance({ field, onUpdate }: FieldControlsProps) {
  const values = field.selectedConfiguration;
  const id = String(field.instanceId);
  const label = typeof values?.label === "string" ? values.label : field.displayName ?? "";
  const help = typeof values?.helpText === "string" ? values.helpText : "";
  const definition = field.definitionRef.id;
  const choice = isFormChoiceAsset(definition);
  const options = choice ? readFormChoiceOptions(field) : [];
  const [newOption, setNewOption] = useState("");
  const optionLabel = newOption.trim();
  const canAddOption = Boolean(optionLabel) && options.length < 32 &&
    !options.some((option) => option.label === optionLabel);
  function addOption(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canAddOption) return;
    const idBase = `option-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
    let optionId = idBase;
    for (let index = 2; options.some((option) => option.optionId === optionId); index++) optionId = `${idBase}-${index}`;
    let value = optionLabel;
    for (let index = 2; options.some((option) => option.value === value); index++) {
      const suffix = `-${index}`;
      value = `${optionLabel.slice(0, 200 - suffix.length)}${suffix}`;
    }
    onUpdate(id, { staticOptions: [...options, { optionId, label: optionLabel, value }] });
    setNewOption("");
  }
  return <>
    <label className="ui-stack ui-stack--sm">
      Field label
      <input key={label} maxLength={200} defaultValue={label} onBlur={(event) => {
        const next = event.currentTarget.value.trim();
        if (next && next !== label) onUpdate(id, { label: next });
        else event.currentTarget.value = label;
      }} />
    </label>
    <label className="ui-stack ui-stack--sm">
      Help text
      <textarea key={help} maxLength={1000} defaultValue={help} onBlur={(event) => {
        if (event.currentTarget.value !== help) onUpdate(id, { helpText: event.currentTarget.value });
      }} />
    </label>
    {definition === "builtin.form.date-time-field" ? <label className="ui-stack ui-stack--sm">
      Date and time format
      <select value={typeof values?.dateTimeKind === "string" ? values.dateTimeKind : "date"}
        onChange={(event) => onUpdate(id, { dateTimeKind: event.currentTarget.value })}>
        <option value="date">Date</option><option value="time">Time</option><option value="date-time">Date and time</option>
      </select>
    </label> : null}
    {choice ? <div className="ui-stack ui-stack--sm">
      <h5>Choice labels</h5>
      {options.length ? <ol className="ui-stack ui-stack--xs">{options.map((option, index) => <li key={option.optionId}>
        <div className="ui-workflow__actions">
          <label>Choice label {index + 1}
            <input key={option.label} maxLength={200} defaultValue={option.label} onBlur={(event) => {
              const next = event.currentTarget.value.trim();
              if (next && next !== option.label && !options.some((item) => item !== option && item.label === next))
                onUpdate(id, { staticOptions: options.map((item) => item === option ? { ...item, label: next } : item) });
              else event.currentTarget.value = option.label;
            }} />
          </label>
          <button type="button" className="ui-button ui-button--outline" aria-label={`Remove choice ${index + 1}`}
            onClick={() => onUpdate(id, { staticOptions: options.filter((item) => item !== option) })}>Remove</button>
        </div>
      </li>)}</ol> : <p>Add an option so respondents can choose an answer.</p>}
      <form className="ui-stack ui-stack--sm" onSubmit={addOption}>
        <label className="ui-stack ui-stack--sm">New option label
          <input required value={newOption} maxLength={200} onChange={(event) => setNewOption(event.currentTarget.value)} />
        </label>
        <div><button type="submit" className="ui-button ui-button--outline" disabled={!canAddOption}>Add option</button></div>
      </form>
    </div> : null}
  </>;
}

function FieldBehavior({ field, onUpdate }: FieldControlsProps) {
  const values = field.selectedConfiguration;
  const id = String(field.instanceId);
  const definition = field.definitionRef.id;
  const numeric = definition === "builtin.form.number-field";
  const text = definition === "builtin.form.text-field" || definition === "builtin.form.text-area";
  const options = isFormChoiceAsset(definition) ? readFormChoiceOptions(field) : [];
  return <>
    <label><input type="checkbox" checked={values?.required === true} onChange={(event) => {
      onUpdate(id, { required: event.currentTarget.checked });
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
                onUpdate(id, { [key]: null });
              } else if (event.currentTarget.validity.valid && Number.isFinite(value) && value !== values?.[key]) {
                onUpdate(id, { [key]: value });
              } else event.currentTarget.value = typeof values?.[key] === "number" ? String(values[key]) : "";
            }} />
        </label>
      )) : null}
    {options.length ? <fieldset className="ui-stack ui-stack--sm">
      <legend>Submitted choice values</legend>
      <p>Change the value used by routes and submission actions. This does not change the choice label.</p>
      {options.map((option) => <label className="ui-stack ui-stack--sm" key={option.optionId}>
        Submitted value for {option.label}
        <input key={option.value} maxLength={200} defaultValue={option.value} onBlur={(event) => {
          const next = event.currentTarget.value.trim();
          if (next && next !== option.value && !options.some((item) => item !== option && item.value === next))
            onUpdate(id, { staticOptions: options.map((item) => item === option ? { ...item, value: next } : item) });
          else event.currentTarget.value = option.value;
        }} />
      </label>)}
    </fieldset> : null}
  </>;
}
