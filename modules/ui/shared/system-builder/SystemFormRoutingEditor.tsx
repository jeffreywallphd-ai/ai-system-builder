import { useState, type FormEvent } from "react";
import type { AssetBinding, AssetInstance } from "../../../contracts/asset";
import { readSystemFormRoute, type SystemFormRoute, type SystemFormRouteOperator, type SystemFormValue } from "../../../contracts/system-builder";

const OPERATORS: Readonly<Record<SystemFormRouteOperator, string>> = {
  equals: "is", "not-equals": "is not", "less-than": "is less than", "greater-than": "is greater than",
};

export function isFormChoiceAsset(id: string): boolean {
  return id === "builtin.form.select-field" || id === "builtin.form.radio-group";
}

export function readFormChoiceOptions(field: AssetInstance) {
  const values = field.selectedConfiguration?.staticOptions;
  if (!Array.isArray(values)) return [];
  return values.filter((item): item is { optionId: string; label: string; value: string; disabled?: boolean } =>
    Boolean(item && typeof item === "object" && !Array.isArray(item) && typeof item.optionId === "string" &&
      typeof item.label === "string" && typeof item.value === "string"));
}

export function SystemFormRoutingEditor({ form, steps, step, fields, bindings, onSave, onRemove }: {
  readonly form: AssetInstance;
  readonly steps: readonly AssetInstance[];
  readonly step: AssetInstance;
  readonly fields: readonly AssetInstance[];
  readonly bindings: readonly AssetBinding[];
  readonly onSave: (route: SystemFormRoute) => void;
  readonly onRemove: (bindingId: string) => void;
}) {
  const [fieldId, setFieldId] = useState("");
  const [operator, setOperator] = useState<SystemFormRouteOperator>("equals");
  const [rawValue, setRawValue] = useState("");
  const [destination, setDestination] = useState("");
  const entries = bindings.flatMap((binding) => {
    const route = readSystemFormRoute(binding);
    return route && route.fromStepId === step.instanceId ? [{ id: String(binding.bindingId), route }] : [];
  });
  const fallback = entries.find((entry) => entry.route.when === null);
  const rules = entries.filter((entry) => entry.route.when).sort((left, right) => left.route.priority - right.route.priority);
  const destinations = steps.filter((item) => item !== step);
  const field = fields.find((item) => item.instanceId === fieldId);
  const numeric = field?.definitionRef.id === "builtin.form.number-field";
  const checkbox = field?.definitionRef.id === "builtin.form.checkbox-field";
  const choice = field ? isFormChoiceAsset(field.definitionRef.id) : false;
  const date = field?.definitionRef.id === "builtin.form.date-time-field";
  const dateKind = field?.selectedConfiguration?.dateTimeKind;
  const priority = Array.from({ length: 8 }, (_, index) => index).find((index) => !rules.some((entry) => entry.route.priority === index));
  const destinationOptions = () => <>
    {destinations.map((item) => <option key={item.instanceId} value={item.instanceId}>{item.displayName}</option>)}
    <option value={form.instanceId}>Finish form</option>
  </>;

  function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!field || !destination || !rawValue.trim() || priority === undefined) return;
    const value: SystemFormValue = numeric ? Number(rawValue) : checkbox ? rawValue === "true" : rawValue;
    if (typeof value === "number" && !Number.isFinite(value)) return;
    onSave({ fromStepId: String(step.instanceId), destinationId: destination, priority,
      when: { fieldId: String(field.instanceId), operator, value } });
  }

  return (
    <section className="ui-panel ui-stack ui-stack--sm" aria-label="Routes after this page">
      <h4>Routes after this page</h4>
      <p>The first matching rule chooses the next form page. If no rule matches, the form uses the default route.</p>
      <label className="ui-stack ui-stack--sm">
        Default route
        <select value={fallback?.route.destinationId ?? ""} onChange={(event) => {
          const destinationId = event.currentTarget.value;
          if (destinationId) onSave({ fromStepId: String(step.instanceId), destinationId, priority: 0, when: null });
          else if (fallback) onRemove(fallback.id);
        }}>
          <option value="">Next page in order, or finish</option>
          {destinationOptions()}
        </select>
      </label>
      {rules.length ? <ol>{rules.map(({ id, route }, index) => {
        const rule = route.when!;
        const question = fields.find((item) => item.instanceId === rule.fieldId);
        const target = destinations.find((item) => item.instanceId === route.destinationId);
        const option = question && readFormChoiceOptions(question).find((item) => item.value === rule.value);
        const value = typeof rule.value === "boolean" ? rule.value ? "selected" : "cleared" : option?.label ?? String(rule.value);
        return <li key={id}>
          <span>When {question?.displayName ?? "an unavailable field"} {OPERATORS[rule.operator]} {value}, go to {target?.displayName ?? (route.destinationId === form.instanceId ? "Finish form" : "an unavailable page")}.</span>{" "}
          <button className="ui-button ui-button--outline" type="button" aria-label={`Remove route rule ${index + 1}`} onClick={() => onRemove(id)}>Remove</button>
        </li>;
      })}</ol> : <p className="ui-text-muted">No answer rules yet.</p>}
      {fields.length && priority !== undefined ? (
        <form className="ui-stack ui-stack--sm" onSubmit={add}>
          <label className="ui-stack ui-stack--sm">Answer field
            <select required value={fieldId} onChange={(event) => { setFieldId(event.currentTarget.value); setOperator("equals"); setRawValue(""); }}>
              <option value="">Select a field</option>
              {fields.map((item) => <option key={item.instanceId} value={item.instanceId}>{item.displayName}</option>)}
            </select>
          </label>
          {field ? <>
            <label className="ui-stack ui-stack--sm">Comparison
              <select value={operator} onChange={(event) => setOperator(event.currentTarget.value as SystemFormRouteOperator)}>
                {(numeric ? Object.keys(OPERATORS) as SystemFormRouteOperator[] : ["equals", "not-equals"] as const)
                  .map((item) => <option key={item} value={item}>{OPERATORS[item]}</option>)}
              </select>
            </label>
            <label className="ui-stack ui-stack--sm">Compare with
              {checkbox || choice ? <select value={rawValue} required onChange={(event) => setRawValue(event.currentTarget.value)}>
                <option value="">Select a value</option>
                {checkbox ? <><option value="true">Selected</option><option value="false">Cleared</option></>
                  : readFormChoiceOptions(field).filter((item) => !item.disabled).map((item) =>
                    <option key={item.optionId} value={item.value}>{item.label}</option>)}
              </select> : <input required value={rawValue} maxLength={200} step={numeric ? "any" : undefined}
                type={numeric ? "number" : date ? dateKind === "time" ? "time" : dateKind === "date-time" ? "datetime-local" : "date" : "text"}
                onChange={(event) => setRawValue(event.currentTarget.value)} />}
            </label>
            <label className="ui-stack ui-stack--sm">Go to form page
              <select value={destination} required onChange={(event) => setDestination(event.currentTarget.value)}>
                <option value="">Select a destination</option>
                {destinationOptions()}
              </select>
            </label>
          </> : null}
          <div><button className="ui-button ui-button--outline" type="submit" disabled={!field || !destination || !rawValue.trim()}>Add route rule</button></div>
        </form>
      ) : null}
    </section>
  );
}
