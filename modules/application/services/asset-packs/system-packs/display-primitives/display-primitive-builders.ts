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
  DISPLAY_PRIMITIVE_VERSION,
  type DisplayStateMessagePrimitiveId,
} from "./display-primitive-ids";

export type DisplayPrimitiveCategoryId = "data-display" | "state-messages";

export interface DisplayPrimitiveSpec {
  readonly id: DisplayStateMessagePrimitiveId;
  readonly categoryId: DisplayPrimitiveCategoryId;
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
  readonly stateGuidance: string;
  readonly accessibilityGuidance: string;
  readonly exampleDescription: string;
  readonly tags: readonly string[];
}

export function createDisplayPrimitiveDefinition(
  spec: DisplayPrimitiveSpec,
): AssetDefinition {
  return {
    definitionId: spec.id,
    assetType: "ui-component",
    assetFamily: spec.family,
    version: DISPLAY_PRIMITIVE_VERSION,
    displayName: spec.displayName,
    description: spec.description,
    lifecycleStatus: "published",
    reviewStatus: "approved",
    provenance: {
      sourceKind: "system-generated",
      authorship: "human-authored",
      metadata: sourceMetadata(spec.id, spec.categoryId),
    },
    configurationSchema: {
      schemaId: `${spec.id}.configuration`,
      schemaVersion: DISPLAY_PRIMITIVE_VERSION,
      fields: spec.configurationFields,
      requiredFieldIds: spec.configurationFields
        .filter((field) => field.required)
        .map((field) => field.fieldId),
      strict: true,
      description: `${spec.displayName} semantic configuration.`,
      metadata: {
        categoryId: spec.categoryId,
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
        summary:
          "Safe to describe in thin-client read models because it contains descriptors only.",
      },
    ],
    ports: spec.ports,
    compositionRules: spec.compositionRules,
    metadata: {
      ...sourceMetadata(spec.id, spec.categoryId),
      builtIn: true,
      systemOwned: true,
      categoryId: spec.categoryId,
      assetPackEntryKind:
        spec.categoryId === "state-messages"
          ? "state-message-primitive"
          : "data-display-primitive",
      declarativeOnly: true,
    },
  };
}

export function createDisplayPrimitiveEntry(
  definition: AssetDefinition,
  categoryId: DisplayPrimitiveCategoryId,
  tags: readonly string[],
): AssetPackAssetEntry {
  const fingerprint = createDisplayPrimitiveFingerprint(definition);
  return {
    entryId: `system.foundation.${String(definition.definitionId).replace(/^builtin\./, "")}`,
    definition,
    definitionRef: {
      kind: "asset-definition-version",
      id: String(definition.definitionId) as never,
      version: definition.version,
      label: definition.displayName,
    },
    category: categoryId,
    sourceLayer: SYSTEM_FOUNDATION_PACK_SOURCE_LAYER,
    fingerprint,
    tags: ["foundation", categoryId, ...tags],
    metadata: {
      sourcePack: {
        packId: SYSTEM_FOUNDATION_PACK_ID,
        version: SYSTEM_FOUNDATION_PACK_VERSION,
      },
      categoryId,
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

export function descriptorArrayField(
  fieldId: string,
  label: string,
  semanticItemKind: string,
  expectedFields: readonly string[],
  optionalFields: readonly string[],
  description: string,
): AssetConfigurationField {
  return {
    fieldId,
    valueKind: "array",
    label,
    description,
    required: false,
    defaultValue: [],
    exampleValues: [
      Object.fromEntries([
        ...expectedFields.map((field) => [field, `example-${field}`]),
        ...optionalFields.map((field) => [field, `example-${field}`]),
      ]),
    ],
    uiHint: {
      hintKind: "advanced",
      helpText:
        "Semantic descriptor list; future editors may provide a dedicated structured control.",
    },
    metadata: {
      semanticItemKind,
      itemSchemaStatus: "deferred",
      expectedFields: [...expectedFields],
      optionalFields: [...optionalFields],
      dataRetrieval: false,
      rendererSpecific: false,
      executable: false,
    },
  };
}

export function configurationInputPort(
  portId: string,
  displayName: string,
  description: string,
  dataKind: string,
  cardinality: AssetPort["cardinality"] = { preset: "optional" },
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
    cardinality,
  };
}

export function displayEventPort(
  portId: string,
  displayName: string,
  description: string,
  dataKind = "semantic-display-event",
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

export function allowedParentRule(
  ruleId: string,
  description: string,
  compatibleParentDefinitionIds: readonly string[],
  compatibleParentCategories: readonly string[],
): NonNullable<AssetDefinition["compositionRules"]>[number] {
  return {
    ruleId,
    ruleKind: "allowed-parent",
    description,
    allowedParentTypes: ["ui-component"],
    message:
      "Should be placed within compatible semantic UI structure, form, display, or state-message assets.",
    metadata: {
      compatibleParentDefinitionIds: [...compatibleParentDefinitionIds],
      compatibleParentCategories: [...compatibleParentCategories],
    },
  };
}

export function optionalChildRule(
  ruleId: string,
  description: string,
  compatibleChildDefinitionIds: readonly string[],
  compatibleChildCategories: readonly string[],
): NonNullable<AssetDefinition["compositionRules"]>[number] {
  return {
    ruleId,
    ruleKind: "optional-child",
    description,
    optionalAssetTypes: ["ui-component"],
    metadata: {
      compatibleChildDefinitionIds: [...compatibleChildDefinitionIds],
      compatibleChildCategories: [...compatibleChildCategories],
    },
  };
}

function createAiContext(spec: DisplayPrimitiveSpec): AssetAiContext {
  return {
    purpose: spec.purpose,
    userFacingSummary: spec.userSummary,
    developerFacingSummary:
      `${spec.displayName} is a semantic asset definition, not a concrete renderer component, data-grid implementation, resource reader, preview renderer, API client, storage reader, or executable workflow.`,
    capabilities: spec.capabilities.map((summary, index) => ({
      capabilityId: `${spec.id}.capability.${index + 1}`,
      summary,
    })),
    limitations: [
      ...(spec.limitations ?? []),
      "Does not fetch data, render resource content, call provider systems, read storage, perform workflow execution, call runtimes, or choose a renderer.",
      "Data retrieval, resource reading, preview rendering, provider calls, workflow handling, and screen rendering are outside this definition.",
    ].map((summary, index) => ({
      limitationId: `${spec.id}.limitation.${index + 1}`,
      summary,
    })),
    inputSummary: {
      summary:
        "Accepts semantic records, item descriptors, state descriptors, or resource references through declared ports.",
      expectedAssetTypes: ["ui-component"],
      required: false,
    },
    outputSummary: {
      summary:
        "Events are declarative composition signals only and do not perform effects by themselves.",
    },
    configurationGuidance: {
      summary: spec.configurationGuidance,
      recommendedDefaults: spec.defaultConfiguration,
      commonMistakes: [
        "Do not use framework component names, style class names, route targets, code snippets, data-source expressions, or executable expressions.",
        "Use semantic fields, labels, state text, and accessibility labels that future renderers can interpret.",
      ],
    },
    compositionGuidance: {
      summary: spec.compositionGuidance,
      bindingGuidance:
        "Ports describe semantic data, state, and user intent only; they do not bind to stores, API clients, preview renderers, routers, or workflow systems.",
    },
    examples: [
      {
        exampleId: `${spec.id}.example.1`,
        title: `${spec.displayName} usage`,
        description: spec.exampleDescription,
        configurationValues: spec.defaultConfiguration,
        expectedOutcome:
          "A future composer can reason about display and state intent without receiving implementation code.",
      },
    ],
    antiPatterns: [
      {
        antiPatternId: `${spec.id}.anti-pattern.1`,
        title: "Implementation-specific display primitive",
        description:
          "Using this definition to name framework components, table libraries, style classes, files, routes, source expressions, reader bindings, external calls, or workflow effects.",
        whyAvoid: "The foundation pack must remain host-neutral and declarative.",
        saferAlternative:
          "Keep implementation choices in renderer, application, host, or provider layers outside the asset pack.",
      },
    ],
    safetyNotes: [
      {
        safetyNoteId: `${spec.id}.safety.1`,
        category: "operational",
        severity: "info",
        summary: "Descriptor-only display/state primitive with no capability requirement.",
        details: `${spec.accessibilityGuidance} ${spec.stateGuidance}`,
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
        "state-guidance",
        "accessibility-guidance",
        "non-goals",
      ],
      stateGuidance: spec.stateGuidance,
      accessibilityGuidance: spec.accessibilityGuidance,
      semanticDefinitionOnly: true,
    },
  };
}

function sourceMetadata(
  definitionId: DisplayStateMessagePrimitiveId,
  categoryId: DisplayPrimitiveCategoryId,
): Record<string, AssetConfigurationValue> {
  return {
    sourcePackId: SYSTEM_FOUNDATION_PACK_ID,
    sourcePackVersion: SYSTEM_FOUNDATION_PACK_VERSION,
    sourceLayer: SYSTEM_FOUNDATION_PACK_SOURCE_LAYER,
    categoryId,
    definitionId,
  };
}

function createDisplayPrimitiveFingerprint(definition: AssetDefinition): string {
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
