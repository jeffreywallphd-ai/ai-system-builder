import type { AssetReference } from "../asset";

const version = "3.0.0";
const form = "builtin.form.form";
const group = "builtin.form.field-group";
const fields = new Set([
  "builtin.form.text-field",
  "builtin.form.text-area",
  "builtin.form.number-field",
  "builtin.form.select-field",
  "builtin.form.checkbox-field",
  "builtin.form.radio-group",
  "builtin.form.date-time-field",
]);
const actions = new Set(["builtin.form.submit-action", "builtin.form.cancel-action"]);
const message = "builtin.form.validation-message";

export const SYSTEM_FORM_PLACEMENT_MESSAGE = "Place form elements inside a Form asset, in the matching fields, actions, or messages region.";

type DefinitionIdentity = Pick<AssetReference, "kind" | "version"> & { readonly id: string };

function currentDefinitionId(reference?: DefinitionIdentity): string | undefined {
  return reference?.kind === "asset-definition-version" && reference.version === version
    ? String(reference.id) : undefined;
}

function isElementId(id?: string): boolean {
  return id === group || id === message || (id !== undefined && (fields.has(id) || actions.has(id)));
}

export function isSystemFormDefinition(reference: DefinitionIdentity): boolean {
  return reference.kind === "asset-definition-version" && (reference.id === form || isElementId(reference.id));
}

export function isCurrentSystemForm(reference: DefinitionIdentity): boolean {
  return currentDefinitionId(reference) === form;
}

export function isCurrentSystemFormElement(reference: DefinitionIdentity): boolean {
  return isElementId(currentDefinitionId(reference));
}

/** Additional restriction on the released slot definition; does not grant compatibility. */
export function systemFormPlacementAllowed(
  child: DefinitionIdentity,
  parent: DefinitionIdentity | undefined,
  slotId: string,
): boolean {
  const childId = currentDefinitionId(child);
  const parentId = currentDefinitionId(parent);
  if (!childId && parent?.version === version && isSystemFormDefinition(child)) return false;
  if (childId === form) return parentId !== form && parentId !== group;
  if (childId === group) return parentId === form && slotId === "fields";
  if (childId === message) return (parentId === form || parentId === group) && slotId === "messages";
  if (childId && actions.has(childId)) return parentId === form && slotId === "actions";
  if (childId && fields.has(childId)) return (parentId === form || parentId === group) && slotId === "fields";
  return true;
}
