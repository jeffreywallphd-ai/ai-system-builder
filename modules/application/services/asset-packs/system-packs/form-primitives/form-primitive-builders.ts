import type {
  AssetAiContext,
  AssetConfigurationField,
  AssetConfigurationValue,
  AssetDefinition,
  AssetPackAssetEntry,
  AssetPort,
} from "../../../../../contracts/asset";

import {
  SYSTEM_FOUNDATION_PACK_ID,
  SYSTEM_FOUNDATION_PACK_SOURCE_LAYER,
  SYSTEM_FOUNDATION_PACK_VERSION,
} from "../system-foundation-pack.constants";
import {
  FORM_PRIMITIVE_VERSION,
  type FormPrimitiveId,
} from "./form-primitive-ids";

const FORMS_FIELDS_CATEGORY_ID = "forms-fields";

export interface FormPrimitiveSpec {
  readonly id: FormPrimitiveId;
  readonly displayName: string;
  readonly description: string;
  readonly family: AssetDefinition["assetFamily"];
  readonly purpose: string;
  readonly userSummary: string;
  readonly capabilities: readonly string[];
  readonly limitations?: readonly string[];
  readonly configurationFields: readonly AssetConfigurationField[];
  readonly defaultConfiguration: Record<string, AssetConfigurationValue>;
  readonly ports: readonly AssetPort[];
  readonly compositionRules: AssetDefinition["compositionRules"];
  readonly configurationGuidance: string;
  readonly compositionGuidance: string;
  readonly validationGuidance: string;
  readonly accessibilityGuidance: string;
  readonly exampleDescription: string;
  readonly tags: readonly string[];
}

export function createFormPrimitiveDefinition(
  spec: FormPrimitiveSpec,
): AssetDefinition {
  return {
    definitionId: spec.id,
    assetType: "ui-component",
    assetFamily: spec.family,
    version: FORM_PRIMITIVE_VERSION,
    displayName: spec.displayName,
    description: spec.description,
    lifecycleStatus: "published",
    reviewStatus: "approved",
    provenance: {
      sourceKind: "system-generated",
      authorship: "human-authored",
      metadata: sourceMetadata(spec.id),
    },
    configurationSchema: {
      schemaId: `${spec.id}.configuration`,
      schemaVersion: FORM_PRIMITIVE_VERSION,
      fields: spec.configurationFields,
      requiredFieldIds: spec.configurationFields
        .filter((field) => field.required)
        .map((field) => field.fieldId),
      strict: true,
      description: `${spec.displayName} semantic configuration.`,
      metadata: {
        categoryId: FORMS_FIELDS_CATEGORY_ID,
        declarativeOnly: true,
      },
    },
    defaultConfiguration: spec.defaultConfiguration,
    aiContext: createAiContext(spec),
    requirements: [
      {
        requirementId: `${spec.id}.declarative-primitive`,
        requirementKind: "custom",
        required: false,
        safetyStatus: "safe",
        summary: "Semantic catalog definition only; no host capability is required.",
        details: {
          declarativeOnly: true,
          capabilityFree: true,
        },
      },
      {
        requirementId: `${spec.id}.thin-client-safe`,
        requirementKind: "thin-client-safety",
        required: false,
        safetyStatus: "safe",
        summary: "Safe to describe in thin-client read models because it contains descriptors only.",
      },
    ],
    ports: spec.ports,
    compositionRules: spec.compositionRules,
    metadata: {
      ...sourceMetadata(spec.id),
      builtIn: true,
      systemOwned: true,
      categoryId: FORMS_FIELDS_CATEGORY_ID,
      assetPackEntryKind: "form-field-primitive",
      declarativeOnly: true,
    },
  };
}

export function createFormPrimitiveEntry(
  definition: AssetDefinition,
  tags: readonly string[],
): AssetPackAssetEntry {
  const fingerprint = createFormPrimitiveFingerprint(definition);
  return {
    entryId: `system.foundation.${String(definition.definitionId).replace(/^builtin\./, "")}`,
    definition,
    definitionRef: {
      kind: "asset-definition-version",
      id: String(definition.definitionId) as never,
      version: definition.version,
      label: definition.displayName,
    },
    category: FORMS_FIELDS_CATEGORY_ID,
    sourceLayer: SYSTEM_FOUNDATION_PACK_SOURCE_LAYER,
    fingerprint,
    tags: ["foundation", "forms-fields", ...tags],
    metadata: {
      sourcePack: {
        packId: SYSTEM_FOUNDATION_PACK_ID,
        version: SYSTEM_FOUNDATION_PACK_VERSION,
      },
      categoryId: FORMS_FIELDS_CATEGORY_ID,
      sourceLayer: SYSTEM_FOUNDATION_PACK_SOURCE_LAYER,
      builtIn: true,
      systemOwned: true,
      declarativeOnly: true,
      fingerprint,
    },
  };
}

export function stringField(
  fieldId: string,
  label: string,
  defaultValue = "",
  description?: string,
): AssetConfigurationField {
  return {
    fieldId,
    valueKind: "string",
    label,
    ...(description ? { description } : {}),
    required: false,
    defaultValue,
    uiHint: { hintKind: "text" },
  };
}

export function textAreaField(
  fieldId: string,
  label: string,
  defaultValue = "",
  description?: string,
): AssetConfigurationField {
  return {
    fieldId,
    valueKind: "string",
    label,
    ...(description ? { description } : {}),
    required: false,
    defaultValue,
    uiHint: { hintKind: "textarea" },
  };
}

export function booleanField(
  fieldId: string,
  label: string,
  defaultValue: boolean,
  description?: string,
): AssetConfigurationField {
  return {
    fieldId,
    valueKind: "boolean",
    label,
    ...(description ? { description } : {}),
    required: false,
    defaultValue,
    uiHint: { hintKind: "checkbox" },
  };
}

export function numberField(
  fieldId: string,
  label: string,
  defaultValue: number,
  description?: string,
): AssetConfigurationField {
  return {
    fieldId,
    valueKind: "number",
    label,
    ...(description ? { description } : {}),
    required: false,
    defaultValue,
    uiHint: { hintKind: "number" },
  };
}

export function integerField(
  fieldId: string,
  label: string,
  defaultValue: number,
  min: number,
  max: number,
  description?: string,
): AssetConfigurationField {
  return {
    fieldId,
    valueKind: "integer",
    label,
    ...(description ? { description } : {}),
    required: false,
    defaultValue,
    constraints: [
      { constraintKind: "min", value: min },
      { constraintKind: "max", value: max },
    ],
    uiHint: { hintKind: "number" },
  };
}

export function enumField(
  fieldId: string,
  label: string,
  values: readonly string[],
  defaultValue: string,
  description?: string,
): AssetConfigurationField {
  return {
    fieldId,
    valueKind: "enum",
    label,
    ...(description ? { description } : {}),
    required: false,
    defaultValue,
    options: values.map((value) => ({
      value,
      label: titleCase(value),
    })),
    uiHint: { hintKind: "select" },
  };
}

export function arrayField(
  fieldId: string,
  label: string,
  defaultValue: readonly AssetConfigurationValue[] = [],
  description?: string,
): AssetConfigurationField {
  return {
    fieldId,
    valueKind: "array",
    label,
    ...(description ? { description } : {}),
    required: false,
    defaultValue: [...defaultValue],
    uiHint: { hintKind: "json-editor" },
  };
}

export function semanticOptionDescriptorArrayField(
  fieldId: string,
  label: string,
): AssetConfigurationField {
  return {
    fieldId,
    valueKind: "array",
    label,
    description:
      "Array of semantic option descriptors shaped as optionId, label, value, optional description, and optional disabled flag.",
    required: false,
    defaultValue: [],
    exampleValues: [
      [
        {
          optionId: "example-option",
          label: "Example option",
          value: "example",
          description: "Optional user-facing option description.",
          disabled: false,
        },
      ],
    ],
    uiHint: {
      hintKind: "advanced",
      helpText:
        "Semantic option descriptors; future editors may provide a dedicated option list control.",
    },
    metadata: {
      semanticItemKind: "form-option-descriptor",
      itemSchemaStatus: "deferred",
      expectedFields: ["optionId", "label", "value"],
      optionalFields: ["description", "disabled"],
      dynamicFetch: false,
      rendererSpecific: false,
      executable: false,
    },
  };
}

export function formAssetInputPort(
  portId: string,
  displayName: string,
  description: string,
  cardinality: AssetPort["cardinality"] = {
    preset: "zero-or-more",
    allowMultiple: true,
  },
): AssetPort {
  return {
    portId,
    direction: "input",
    displayName,
    description,
    contract: {
      contractKind: "asset",
      assetType: "ui-component",
      dataKind: "semantic-form-asset",
      description,
    },
    cardinality,
  };
}

export function configurationInputPort(
  portId: string,
  displayName: string,
  description: string,
  dataKind = "semantic-form-state",
): AssetPort {
  return {
    portId,
    direction: "input",
    displayName,
    description,
    contract: {
      contractKind: "configuration",
      dataKind,
      description,
    },
    cardinality: { preset: "optional" },
  };
}

export function formOutputPort(
  portId: string,
  displayName: string,
  description: string,
  dataKind = "semantic-form-values",
): AssetPort {
  return {
    portId,
    direction: "output",
    displayName,
    description,
    contract: {
      contractKind: "configuration",
      dataKind,
      description,
    },
    cardinality: { preset: "optional" },
  };
}

export function formEventPort(
  portId: string,
  displayName: string,
  description: string,
  dataKind = "semantic-form-event",
): AssetPort {
  return {
    portId,
    direction: "event",
    displayName,
    description,
    contract: {
      contractKind: "event",
      dataKind,
      description,
    },
    cardinality: { preset: "optional" },
  };
}

export function allowedChildRule(
  ruleId: string,
  description: string,
  currentScope: string,
): NonNullable<AssetDefinition["compositionRules"]>[number] {
  return {
    ruleId,
    ruleKind: "allowed-child",
    description,
    allowedChildTypes: ["ui-component"],
    message:
      "May contain compatible semantic form assets and foundation UI structure assets.",
    metadata: {
      currentScope,
      compatibleCategories: ["forms-fields", "ui-structure"],
    },
  };
}

export function allowedParentRule(
  ruleId: string,
  description: string,
): NonNullable<AssetDefinition["compositionRules"]>[number] {
  return {
    ruleId,
    ruleKind: "allowed-parent",
    description,
    allowedParentTypes: ["ui-component"],
    message:
      "Should be placed within a semantic form, field group, or compatible UI structure primitive.",
    metadata: {
      compatibleParentCategories: ["forms-fields", "ui-structure"],
    },
  };
}

function createAiContext(spec: FormPrimitiveSpec): AssetAiContext {
  return {
    purpose: spec.purpose,
    userFacingSummary: spec.userSummary,
    developerFacingSummary:
      `${spec.displayName} is a semantic asset definition, not a concrete renderer component, form engine, validation engine, data-binding layer, or executable action.`,
    capabilities: spec.capabilities.map((summary, index) => ({
      capabilityId: `${spec.id}.capability.${index + 1}`,
      summary,
    })),
    limitations: [
      ...(spec.limitations ?? []),
      "Does not render pixels, collect data by itself, validate values, submit records, transfer files, call provider systems, write storage, or run workflows.",
      "Data binding, validation processing, submission handling, file transfer handling, visual editing, and screen rendering are outside this definition.",
    ].map((summary, index) => ({
      limitationId: `${spec.id}.limitation.${index + 1}`,
      summary,
    })),
    inputSummary: {
      summary:
        "Accepts semantic form child assets, state descriptors, or value descriptors through declared ports.",
      expectedAssetTypes: ["ui-component"],
      required: false,
    },
    outputSummary: {
      summary:
        "Outputs and events are declarative signals for future composition; they do not perform effects by themselves.",
    },
    configurationGuidance: {
      summary: spec.configurationGuidance,
      recommendedDefaults: spec.defaultConfiguration,
      commonMistakes: [
        "Do not use implementation library names, style class names, element props, route handlers, code snippets, or executable expressions.",
        "Use semantic labels, declarative options, declarative validation hints, and accessibility labels.",
      ],
    },
    compositionGuidance: {
      summary: spec.compositionGuidance,
      bindingGuidance:
        "Ports describe semantic containment, values, state, or events only; they do not bind to data stores, form processors, upload handlers, routers, or workflow runners.",
    },
    examples: [
      {
        exampleId: `${spec.id}.example.1`,
        title: `${spec.displayName} usage`,
        description: spec.exampleDescription,
        configurationValues: spec.defaultConfiguration,
        expectedOutcome:
          "A future composer can reason about form intent without receiving implementation code.",
      },
    ],
    antiPatterns: [
      {
        antiPatternId: `${spec.id}.anti-pattern.1`,
        title: "Implementation-specific form primitive",
        description:
          "Using this definition to name framework components, element props, style classes, files, routes, validators, submit handlers, or data stores.",
        whyAvoid: "The foundation pack must remain host-neutral and declarative.",
        saferAlternative:
          "Keep implementation choices in renderer, host, or application behavior layers outside the asset pack.",
      },
    ],
    safetyNotes: [
      {
        safetyNoteId: `${spec.id}.safety.1`,
        category: "operational",
        severity: "info",
        summary: "Descriptor-only form primitive with no capability requirement.",
        details: `${spec.accessibilityGuidance} ${spec.validationGuidance}`,
      },
      {
        safetyNoteId: `${spec.id}.safety.2`,
        category: "thin-client",
        severity: "info",
        summary:
          "Safe for read-only catalog display because it carries descriptors only and no sensitive values.",
      },
    ],
    metadata: {
      sectionIds: [
        "purpose",
        "use-cases",
        "configuration-guidance",
        "composition-guidance",
        "validation-guidance",
        "accessibility-guidance",
        "non-goals",
      ],
      validationGuidance: spec.validationGuidance,
      accessibilityGuidance: spec.accessibilityGuidance,
      semanticDefinitionOnly: true,
    },
  };
}

function sourceMetadata(
  definitionId: FormPrimitiveId,
): Record<string, AssetConfigurationValue> {
  return {
    sourcePackId: SYSTEM_FOUNDATION_PACK_ID,
    sourcePackVersion: SYSTEM_FOUNDATION_PACK_VERSION,
    sourceLayer: SYSTEM_FOUNDATION_PACK_SOURCE_LAYER,
    categoryId: FORMS_FIELDS_CATEGORY_ID,
    definitionId,
  };
}

function createFormPrimitiveFingerprint(definition: AssetDefinition): string {
  return `fnv1a:${fnv1a(stableStringify(definition))}`;
}

function stableStringify(value: unknown): string {
  if (value === undefined) return "undefined";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entryValue]) => entryValue !== undefined)
    .sort(([left], [right]) => left.localeCompare(right));
  return `{${entries.map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`).join(",")}}`;
}

function fnv1a(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function titleCase(value: string): string {
  return value
    .split("-")
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}
