import type {
  AssetBindingKind,
  AssetConfigurationField,
  AssetConfigurationSchema,
  AssetConfigurationValue,
  AssetConfigurationValues,
  AssetInstance,
  AssetPort,
} from "../../../contracts/asset";
import type { SystemBuilderComposerAsset } from "../../../contracts/system-builder";

export interface SystemComposerConfigurationSection {
  readonly id: string;
  readonly label: string;
  readonly fields: readonly AssetConfigurationField[];
}

export interface SystemComposerConfigurationSectionOptions {
  readonly groupLayoutFields?: boolean;
  readonly includeField?: (field: AssetConfigurationField) => boolean;
}

export type SystemComposerPropertyPanel = "design" | "data" | "events";

export type SystemComposerPropertyPanelSections = Readonly<
  Record<
    SystemComposerPropertyPanel,
    readonly SystemComposerConfigurationSection[]
  >
>;

export interface SystemComposerPortEndpoint {
  readonly key: string;
  readonly instanceId: string;
  readonly instanceLabel: string;
  readonly definitionId: string;
  readonly port: AssetPort;
}

export function buildSystemComposerConfigurationSections(
  schema: AssetConfigurationSchema | undefined,
  options: SystemComposerConfigurationSectionOptions = {},
): readonly SystemComposerConfigurationSection[] {
  if (!schema) return [];
  const sections = new Map<string, AssetConfigurationField[]>();
  for (const field of schema.fields) {
    if (field.uiHint?.hintKind === "hidden") continue;
    if (options.includeField && !options.includeField(field)) continue;
    const label =
      field.uiHint?.section?.trim() ||
      (options.groupLayoutFields && isLayoutConfigurationField(field)
        ? "Layout"
        : field.uiHint?.advanced || field.uiHint?.hintKind === "advanced"
          ? "Advanced"
          : "General");
    const fields = sections.get(label) ?? [];
    fields.push(field);
    sections.set(label, fields);
  }
  return Array.from(sections.entries())
    .map(([label, fields]) => ({
      id:
        label
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "") || "general",
      label,
      fields: [...fields].sort(
        (left, right) =>
          (left.uiHint?.order ?? Number.MAX_SAFE_INTEGER) -
            (right.uiHint?.order ?? Number.MAX_SAFE_INTEGER) ||
          left.fieldId.localeCompare(right.fieldId),
      ),
    }))
    .sort((left, right) => {
      if (left.label === "General") return -1;
      if (right.label === "General") return 1;
      if (left.label === "Advanced") return 1;
      if (right.label === "Advanced") return -1;
      return left.label.localeCompare(right.label);
    });
}

export function isSystemComposerStylingField(
  field: AssetConfigurationField,
): boolean {
  return field.uiHint?.metadata?.editorScope === "styling";
}

export function isSystemComposerSemanticStyleField(
  field: AssetConfigurationField,
): boolean {
  return field.uiHint?.metadata?.semanticStyleField === true;
}

export function buildSystemComposerPropertyPanelSections(
  schema: AssetConfigurationSchema | undefined,
  options: SystemComposerConfigurationSectionOptions = {},
): SystemComposerPropertyPanelSections {
  const grouped: Record<
    SystemComposerPropertyPanel,
    SystemComposerConfigurationSection[]
  > = { design: [], data: [], events: [] };
  for (const section of buildSystemComposerConfigurationSections(
    schema,
    options,
  )) {
    const fieldsByPanel: Record<
      SystemComposerPropertyPanel,
      AssetConfigurationField[]
    > = { design: [], data: [], events: [] };
    for (const field of section.fields) {
      fieldsByPanel[propertyPanelForField(field)].push(field);
    }
    for (const panel of ["design", "data", "events"] as const) {
      if (fieldsByPanel[panel].length) {
        grouped[panel].push({ ...section, fields: fieldsByPanel[panel] });
      }
    }
  }
  return grouped;
}

function isLayoutConfigurationField(field: AssetConfigurationField): boolean {
  return /^(?:layoutDirection|direction|orientation|spacing|padding|widthBehavior|mediaPlacement|actionsPlacement|columnCount|gap|itemAlignment|alignment|wrap|responsiveBehavior)$/.test(
    field.fieldId,
  );
}

export function propertyPanelForField(
  field: AssetConfigurationField,
): SystemComposerPropertyPanel {
  const text = [
    field.fieldId,
    field.label,
    field.description,
    field.uiHint?.section,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  if (
    /(^|[^a-z])(event|events|action|actions|handler|callback|click|submit|navigate|trigger)([^a-z]|$)/.test(
      text,
    )
  ) {
    return "events";
  }
  if (
    field.valueKind === "asset-reference" ||
    field.valueKind === "resource-reference" ||
    field.valueKind === "artifact-reference" ||
    field.valueKind === "runtime-capability-reference" ||
    /(^|[^a-z])(data|dataset|source|query|record|records|model|resource|artifact|binding)([^a-z]|$)/.test(
      text,
    )
  ) {
    return "data";
  }
  return "design";
}

export function materializeSystemComposerConfiguration(
  definition: SystemBuilderComposerAsset,
  selected: AssetConfigurationValues | undefined,
): AssetConfigurationValues {
  const values: Record<string, AssetConfigurationValue> = {};
  for (const field of definition.configurationSchema?.fields ?? []) {
    if (field.defaultValue !== undefined)
      values[field.fieldId] = field.defaultValue;
  }
  Object.assign(values, definition.defaultConfiguration ?? {}, selected ?? {});
  return values;
}

export function validateSystemComposerConfiguration(
  schema: AssetConfigurationSchema | undefined,
  values: AssetConfigurationValues,
): Readonly<Record<string, readonly string[]>> {
  if (!schema) return {};
  const errors: Record<string, string[]> = {};
  const required = new Set(schema.requiredFieldIds ?? []);
  for (const field of schema.fields) {
    const value = values[field.fieldId];
    const fieldErrors: string[] = [];
    if ((field.required || required.has(field.fieldId)) && isEmpty(value)) {
      fieldErrors.push(`${field.label ?? field.fieldId} is required.`);
    }
    if (!isEmpty(value) && !matchesValueKind(field, value)) {
      fieldErrors.push(
        `${field.label ?? field.fieldId} must be ${field.valueKind}.`,
      );
    }
    if (!isEmpty(value) && field.options?.length) {
      const allowed = field.options.some((option) =>
        sameJson(option.value, value),
      );
      if (!allowed)
        fieldErrors.push(
          `${field.label ?? field.fieldId} must use an approved option.`,
        );
    }
    for (const constraint of field.constraints ?? []) {
      const message =
        constraint.message ??
        `${field.label ?? field.fieldId} does not satisfy ${constraint.constraintKind}.`;
      if (
        constraint.constraintKind === "min" &&
        typeof value === "number" &&
        typeof constraint.value === "number" &&
        value < constraint.value
      )
        fieldErrors.push(message);
      if (
        constraint.constraintKind === "max" &&
        typeof value === "number" &&
        typeof constraint.value === "number" &&
        value > constraint.value
      )
        fieldErrors.push(message);
      if (
        constraint.constraintKind === "min-length" &&
        hasLength(value) &&
        typeof constraint.value === "number" &&
        value.length < constraint.value
      )
        fieldErrors.push(message);
      if (
        constraint.constraintKind === "max-length" &&
        hasLength(value) &&
        typeof constraint.value === "number" &&
        value.length > constraint.value
      )
        fieldErrors.push(message);
      if (
        constraint.constraintKind === "pattern" &&
        typeof value === "string" &&
        typeof constraint.value === "string"
      ) {
        try {
          if (!new RegExp(constraint.value).test(value))
            fieldErrors.push(message);
        } catch {
          fieldErrors.push("This field has an invalid definition pattern.");
        }
      }
      if (
        constraint.constraintKind === "one-of" &&
        Array.isArray(constraint.value) &&
        !constraint.value.some((option) => sameJson(option, value))
      )
        fieldErrors.push(message);
    }
    if (fieldErrors.length) errors[field.fieldId] = fieldErrors;
  }
  return errors;
}

export function listSystemComposerPortEndpoints(
  instances: readonly AssetInstance[],
  catalog: readonly SystemBuilderComposerAsset[],
): readonly SystemComposerPortEndpoint[] {
  const definitions = new Map(
    catalog.map((definition) => [
      `${definition.definitionId}@${definition.version}`,
      definition,
    ]),
  );
  return instances.flatMap((instance) => {
    const definition = definitions.get(
      `${String(instance.definitionRef.id)}@${instance.definitionRef.version ?? ""}`,
    );
    if (!definition) return [];
    return definition.ports.map((port) => ({
      key: systemComposerEndpointKey(String(instance.instanceId), port.portId),
      instanceId: String(instance.instanceId),
      instanceLabel: instance.displayName ?? String(instance.definitionRef.id),
      definitionId: definition.definitionId,
      port,
    }));
  });
}

export function listCompatibleSystemComposerTargets(
  source: SystemComposerPortEndpoint | undefined,
  endpoints: readonly SystemComposerPortEndpoint[],
): readonly SystemComposerPortEndpoint[] {
  if (!source || !isSourcePort(source.port)) return [];
  return endpoints.filter(
    (target) =>
      target.instanceId !== source.instanceId &&
      isTargetPort(source.port, target.port) &&
      contractsMatch(source.port, target.port),
  );
}

export function bindingKindForSystemComposerEndpoint(
  source: SystemComposerPortEndpoint,
): AssetBindingKind {
  if (source.port.contract?.contractKind === "resource") return "resource";
  if (source.port.contract?.contractKind === "runtime-capability")
    return "runtime";
  if (source.port.direction === "event") return "event";
  if (source.port.direction === "control") return "control";
  return "output";
}

export function systemComposerEndpointKey(
  instanceId: string,
  portId: string,
): string {
  return `${instanceId}::${portId}`;
}

function isSourcePort(port: AssetPort): boolean {
  return (
    port.direction === "output" ||
    port.direction === "event" ||
    port.direction === "control"
  );
}

function isTargetPort(source: AssetPort, target: AssetPort): boolean {
  if (source.direction === "output") return target.direction === "input";
  return target.direction === source.direction || target.direction === "input";
}

function contractsMatch(source: AssetPort, target: AssetPort): boolean {
  if (!source.contract || !target.contract) return false;
  return (
    source.contract.contractKind === target.contract.contractKind &&
    optionalEqual(source.contract.dataKind, target.contract.dataKind) &&
    optionalEqual(source.contract.resourceKind, target.contract.resourceKind) &&
    optionalEqual(
      source.contract.runtimeCapabilityId,
      target.contract.runtimeCapabilityId,
    ) &&
    optionalEqual(source.contract.assetType, target.contract.assetType) &&
    optionalEqual(source.contract.assetFamily, target.contract.assetFamily)
  );
}

function optionalEqual(left: unknown, right: unknown): boolean {
  return left === undefined || right === undefined || left === right;
}

function matchesValueKind(
  field: AssetConfigurationField,
  value: AssetConfigurationValue,
): boolean {
  switch (field.valueKind) {
    case "string":
    case "enum":
      return (
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean"
      );
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "integer":
      return typeof value === "number" && Number.isInteger(value);
    case "boolean":
      return typeof value === "boolean";
    case "array":
      return Array.isArray(value);
    case "object":
      return (
        typeof value === "object" && value !== null && !Array.isArray(value)
      );
    case "asset-reference":
    case "resource-reference":
    case "artifact-reference":
    case "runtime-capability-reference":
      return (
        typeof value === "string" ||
        (typeof value === "object" && value !== null && !Array.isArray(value))
      );
    case "json":
      return true;
  }
}

function hasLength(
  value: AssetConfigurationValue | undefined,
): value is string | readonly AssetConfigurationValue[] {
  return typeof value === "string" || Array.isArray(value);
}

function isEmpty(value: AssetConfigurationValue | undefined): boolean {
  return value === undefined || value === null || value === "";
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
