import type { AssetBinding, AssetInstance, AssetJsonObject, AssetPlacement, AssetValidationIssue } from "../../../contracts/asset";
import {
  readSystemFormRoute, SYSTEM_FORM_ROUTE_METADATA_KEY, type SystemFormRoute,
  type SystemFormRouteCondition, type SystemFormValue,
} from "../../../contracts/system-builder";

const FORM = "builtin.form.form";
const STEP = "builtin.form.field-group";
const FIELD_KINDS = {
  "builtin.form.text-field": "text",
  "builtin.form.text-area": "multiline",
  "builtin.form.select-field": "choice",
  "builtin.form.number-field": "number",
  "builtin.form.date-time-field": "date-time",
  "builtin.form.checkbox-field": "checkbox",
} as const;
const MAX_STEPS = 32;
const MAX_FIELDS = 64;
const MAX_TEXT = 4000;
const MAX_OPTIONS = 32;
const hasKey = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key);

export interface SystemFormField {
  readonly id: string;
  readonly label: string;
  readonly helpText: string;
  readonly kind: typeof FIELD_KINDS[keyof typeof FIELD_KINDS];
  readonly required: boolean;
  readonly options: readonly { readonly label: string; readonly value: string }[];
  readonly min: number | undefined;
  readonly max: number | undefined;
  readonly dateKind: "date" | "time" | "date-time";
  readonly earliest: string | undefined;
  readonly latest: string | undefined;
}
export interface SystemFormStep {
  readonly id: string;
  readonly label: string;
  readonly fields: readonly SystemFormField[];
  readonly conditions: readonly SystemFormRoute[];
  readonly defaultDestinationId: string;
}
export interface CompiledSystemForm {
  readonly id: string;
  readonly title: string;
  readonly steps: readonly SystemFormStep[];
}
export interface SystemFormSource {
  readonly instances: readonly AssetInstance[];
  readonly placements?: readonly AssetPlacement[];
  readonly bindings: readonly AssetBinding[];
}

function identity(instance: AssetInstance | undefined, id?: string): instance is AssetInstance {
  return Boolean(instance?.definitionRef.kind === "asset-definition-version" &&
    instance.definitionRef.version === "3.0.0" && (!id || instance.definitionRef.id === id));
}

function label(instance: AssetInstance): string {
  return (instance.displayName ?? "").trim().slice(0, 200) || "Untitled";
}

function validDate(value: string, kind: SystemFormField["dateKind"]): boolean {
  const [date, time, rest] = kind === "time" ? [undefined, value, undefined] : value.split("T");
  if (rest !== undefined || (kind === "date" && time !== undefined) || (kind === "date-time" && !time)) return false;
  if (date !== undefined) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
    const utc = new Date(`${date}T00:00:00Z`);
    if (!Number.isFinite(utc.getTime()) || utc.toISOString().slice(0, 10) !== date) return false;
  }
  return time === undefined || /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time);
}

function compileField(instance: AssetInstance): SystemFormField | undefined {
  const definitionId = String(instance.definitionRef.id);
  if (!identity(instance) || !hasKey(FIELD_KINDS, definitionId)) return;
  const kind = FIELD_KINDS[definitionId as keyof typeof FIELD_KINDS];
  const values = instance.selectedConfiguration ?? {};
  // These descriptors are outside the bounded form runner's supported surface.
  if ((values.disabled !== undefined && values.disabled !== false) || values.visibilityCondition ||
      (values.required !== undefined && typeof values.required !== "boolean")) return;
  const number = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value : undefined;
  const bounds = kind === "number" ? [values.minimum, values.maximum]
    : kind === "text" || kind === "multiline" ? [values.minLength, values.maxLength] : [];
  if (bounds.some((value) => value !== undefined && number(value) === undefined)) return;
  const min = kind === "number" ? number(values.minimum) : kind === "text" || kind === "multiline" ? number(values.minLength) ?? 0 : undefined;
  const max = kind === "number" ? number(values.maximum) : kind === "text" || kind === "multiline" ? number(values.maxLength) ?? MAX_TEXT : undefined;
  if (min !== undefined && max !== undefined && min > max) return;
  if ((kind === "text" || kind === "multiline") &&
      (!Number.isInteger(min) || !Number.isInteger(max) || min! < 0 || min! > MAX_TEXT || max! < 1 || max! > MAX_TEXT)) return;
  const options: { label: string; value: string }[] = [];
  if (kind === "choice") {
    if (values.optionsSource && values.optionsSource !== "static") return;
    const items = values.staticOptions;
    if (!Array.isArray(items) || items.length > MAX_OPTIONS || items.length === 0) return;
    const ids = new Set<string>();
    const usedValues = new Set<string>();
    for (const option of items) {
      if (!option || typeof option !== "object" || Array.isArray(option)) return;
      const { optionId, label: text, value, disabled } = option as AssetJsonObject;
      if (typeof optionId !== "string" || !optionId.trim() || optionId.length > 160 || ids.has(optionId) ||
          typeof text !== "string" || !text.trim() || text.length > 200 ||
          typeof value !== "string" || !value.trim() || value.length > 200 || usedValues.has(value) ||
          (disabled !== undefined && typeof disabled !== "boolean")) return;
      ids.add(optionId);
      usedValues.add(value);
      if (disabled !== true) options.push({ label: text, value });
    }
    if (options.length === 0) return;
  }
  if (kind === "date-time" && ((values.dateTimeKind !== undefined && values.dateTimeKind !== "date" &&
      values.dateTimeKind !== "time" && values.dateTimeKind !== "date-time") ||
      [values.minimum, values.maximum].some((value) => value !== undefined && typeof value !== "string"))) return;
  const dateKind = values.dateTimeKind === "time" || values.dateTimeKind === "date-time" ? values.dateTimeKind : "date";
  const earliest = kind === "date-time" && typeof values.minimum === "string" && values.minimum ? values.minimum : undefined;
  const latest = kind === "date-time" && typeof values.maximum === "string" && values.maximum ? values.maximum : undefined;
  if ((earliest && !validDate(earliest, dateKind)) || (latest && !validDate(latest, dateKind)) ||
      (earliest && latest && earliest > latest)) return;
  return { id: String(instance.instanceId), kind, required: values.required === true,
    label: typeof values.label === "string" && values.label.trim() ? values.label.slice(0, 200) : label(instance),
    helpText: typeof values.helpText === "string" ? values.helpText.slice(0, 1000) : "",
    options, min, max, dateKind, earliest, latest };
}

export function validateSystemFormValue(field: SystemFormField, value: unknown): string | undefined {
  if (value === undefined || value === "" || (field.kind === "checkbox" && value === false && field.required)) {
    return field.required ? "Enter an answer." : undefined;
  }
  if (field.kind === "checkbox") return typeof value !== "boolean" ? "Select or clear the checkbox." : undefined;
  if (field.kind === "number") {
    if (typeof value !== "number" || !Number.isFinite(value)) return "Enter a number.";
    if (field.min !== undefined && value < field.min) return `Enter a number of at least ${field.min}.`;
    if (field.max !== undefined && value > field.max) return `Enter a number no more than ${field.max}.`;
    return;
  }
  if (typeof value !== "string" || value.length > MAX_TEXT) return "Enter a shorter text answer.";
  if (field.kind === "choice") return field.options.some((option) => option.value === value) ? undefined : "Choose an available option.";
  if (field.kind === "date-time") {
    return !validDate(value, field.dateKind) || (field.earliest && value < field.earliest) ||
      (field.latest && value > field.latest) ? "Enter a valid date or time in the allowed range." : undefined;
  }
  if (field.required && !value.trim()) return "Enter an answer.";
  if (field.min !== undefined && value.length < field.min) return `Enter at least ${field.min} characters.`;
  if (field.max !== undefined && value.length > field.max) return `Enter no more than ${field.max} characters.`;
  return;
}

function validCondition(field: SystemFormField | undefined, condition: SystemFormRouteCondition): boolean {
  if (!field || validateSystemFormValue({ ...field, required: false }, condition.value) !== undefined) return false;
  if (condition.operator === "equals" || condition.operator === "not-equals") return true;
  if (field.kind !== "number" || typeof condition.value !== "number") return false;
  return condition.operator === "less-than" ? field.min === undefined || condition.value > field.min
    : field.max === undefined || condition.value < field.max;
}

export type SystemFormCompilation = { readonly ok: true; readonly value: CompiledSystemForm } |
  { readonly ok: false; readonly message: string };

export function compileSystemForm(source: SystemFormSource, formId: string): SystemFormCompilation {
  const fail = (message: string) => ({ ok: false as const, message });
  const byId = new Map(source.instances.map((item) => [String(item.instanceId), item]));
  const form = byId.get(formId);
  if (!identity(form, FORM)) return fail("Select an available Foundation form.");
  const children = (id: string) => (source.placements ?? []).filter((edge) => edge.parentInstanceRef.id === id && edge.slotId === "fields")
    .sort((left, right) => left.order - right.order).map((edge) => byId.get(String(edge.childInstanceRef.id)));
  const groups = children(formId);
  if (groups.length === 0 || groups.length > MAX_STEPS || groups.some((step) => !identity(step, STEP) || step.selectedConfiguration?.visibilityCondition)) {
    return fail("Use 1 to 32 supported form steps and put each field inside a step.");
  }
  const ids = new Set(groups.map((step) => String(step!.instanceId)));
  if (ids.size !== groups.length) return fail("Each step must appear once in the form.");
  const routes = new Map<string, SystemFormRoute[]>();
  for (const binding of source.bindings) {
    if (!hasKey(binding.metadata ?? {}, SYSTEM_FORM_ROUTE_METADATA_KEY) || !ids.has(String(binding.sourceRef.id))) continue;
    const route = readSystemFormRoute(binding);
    if (!route || (route.destinationId !== formId && !ids.has(route.destinationId))) return fail("A route must end this form or go to one of its steps.");
    const current = routes.get(route.fromStepId) ?? [];
    if (current.length >= 9 || current.some((other) => other.when === null ? route.when === null : route.when !== null && other.priority === route.priority)) {
      return fail("Use distinct rule positions and one default route per step.");
    }
    current.push(route);
    routes.set(route.fromStepId, current);
  }
  const steps: SystemFormStep[] = [];
  const fieldIds = new Set<string>();
  for (const [index, instance] of groups.entries()) {
    const id = String(instance!.instanceId);
    const fields: SystemFormField[] = [];
    for (const member of children(id)) {
      const field = member && compileField(member);
      if (!field || fieldIds.has(field.id) || fieldIds.size >= MAX_FIELDS) {
        return fail("Use no more than 64 supported fields with valid settings and choice options.");
      }
      fields.push(field);
      fieldIds.add(field.id);
    }
    const entries = routes.get(id) ?? [];
    const conditions = entries.filter((route) => route.when !== null).sort((a, b) => a.priority - b.priority);
    if (conditions.some(({ when }) => !validCondition(fields.find((field) => field.id === when!.fieldId), when!))) {
      return fail("Each route rule needs a field on this step, a compatible comparison, and a valid value.");
    }
    if (new Set(conditions.map(({ when }) => JSON.stringify([when!.fieldId, when!.operator, when!.value]))).size !== conditions.length) {
      return fail("Use each rule condition only once on a step.");
    }
    const defaultDestinationId = entries.find((route) => route.when === null)?.destinationId ??
      (groups[index + 1] ? String(groups[index + 1]!.instanceId) : formId);
    steps.push({ id, label: label(instance!), fields, conditions, defaultDestinationId });
  }
  const stepsById = new Map(steps.map((step) => [step.id, step]));
  const open = new Set<string>();
  const visited = new Set<string>();
  function visit(id: string): boolean {
    if (id === formId || visited.has(id)) return true;
    const step = stepsById.get(id);
    if (!step || open.has(id)) return false;
    open.add(id);
    const destinations = [step.defaultDestinationId, ...step.conditions.map((rule) => rule.destinationId)];
    if (!destinations.every(visit)) return false;
    open.delete(id);
    visited.add(id);
    return true;
  }
  if (!visit(steps[0]!.id)) return fail("Remove cycles so every route can reach the end of the form.");
  if (visited.size !== steps.length) return fail("Add a route to every step or remove the steps that cannot be reached.");
  return { ok: true, value: { id: formId, title: label(form), steps } };
}

export function validateSystemFormRoutes(source: SystemFormSource): readonly AssetValidationIssue[] {
  if (!source.bindings.some((binding) => hasKey(binding.metadata ?? {}, SYSTEM_FORM_ROUTE_METADATA_KEY))) return [];
  const issues: AssetValidationIssue[] = [];
  const byId = new Map(source.instances.map((item) => [String(item.instanceId), item]));
  const parentByStep = new Map((source.placements ?? []).filter((edge) => edge.slotId === "fields")
    .map((edge) => [String(edge.childInstanceRef.id), String(edge.parentInstanceRef.id)]));
  const forms = new Map<string, number>();
  for (const [index, binding] of source.bindings.entries()) {
    if (!hasKey(binding.metadata ?? {}, SYSTEM_FORM_ROUTE_METADATA_KEY)) continue;
    const route = readSystemFormRoute(binding);
    const formId = route && parentByStep.get(route.fromStepId);
    if (!route || !formId || !identity(byId.get(formId), FORM) || !identity(byId.get(route.fromStepId), STEP)) {
      issues.push({ severity: "error", category: "binding", path: ["bindings", String(index)],
        message: "Each form route needs a valid rule and a step inside an exact Foundation form." });
    } else if (!forms.has(formId)) forms.set(formId, index);
  }
  for (const [formId, index] of forms) {
    const result = compileSystemForm(source, formId);
    if (!result.ok) issues.push({ severity: "error", category: "binding", path: ["bindings", String(index)], message: result.message });
  }
  return issues;
}

export function resolveSystemFormDestination(step: SystemFormStep, answers: ReadonlyMap<string, SystemFormValue>): string {
  for (const route of step.conditions) {
    const rule = route.when!;
    const value = answers.get(rule.fieldId);
    if (value === undefined || value === "") continue;
    const match = rule.operator === "equals" ? value === rule.value
      : rule.operator === "not-equals" ? value !== rule.value
      : typeof value === "number" && typeof rule.value === "number" &&
        (rule.operator === "less-than" ? value < rule.value : value > rule.value);
    if (match) return route.destinationId;
  }
  return step.defaultDestinationId;
}

export function evaluateSystemForm(form: CompiledSystemForm, answers: ReadonlyMap<string, SystemFormValue>) {
  const submitted = new Map<string, SystemFormValue>();
  const path: string[] = [];
  const invalidForm = () => ({ ok: false as const, fieldId: undefined, message: "This form route is unavailable.", path });
  if (form.steps.length < 1 || form.steps.length > MAX_STEPS) return invalidForm();
  const stepsById = new Map(form.steps.map((step) => [step.id, step]));
  let id = form.steps[0]!.id;
  for (let index = 0; index < MAX_STEPS && id !== form.id; index++) {
    const step = stepsById.get(id);
    if (!step || step.fields.length > MAX_FIELDS || step.conditions.length > 8) return invalidForm();
    path.push(id);
    for (const field of step.fields) {
      const value = answers.get(field.id);
      const error = validateSystemFormValue(field, value);
      if (error) return { ok: false as const, fieldId: field.id, message: error, path };
      if (value !== undefined && value !== "") submitted.set(field.id, value);
    }
    id = resolveSystemFormDestination(step, submitted);
  }
  if (id !== form.id || path.length === 0) return invalidForm();
  return { ok: true as const, submitted, path };
}
