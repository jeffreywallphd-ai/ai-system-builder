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
import { UI_STRUCTURAL_PRIMITIVE_VERSION, type UiStructuralPrimitiveId } from "./ui-structural-primitive-ids";

const UI_STRUCTURE_CATEGORY_ID = "ui-structure";

export interface UiStructuralPrimitiveSpec {
  readonly id: UiStructuralPrimitiveId;
  readonly displayName: string;
  readonly description: string;
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
  readonly accessibilityGuidance: string;
  readonly exampleDescription: string;
  readonly tags: readonly string[];
}

export function createUiStructuralPrimitiveDefinition(
  spec: UiStructuralPrimitiveSpec,
): AssetDefinition {
  return {
    definitionId: spec.id,
    assetType: "ui-component",
    assetFamily: "structural",
    version: UI_STRUCTURAL_PRIMITIVE_VERSION,
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
      schemaVersion: UI_STRUCTURAL_PRIMITIVE_VERSION,
      fields: spec.configurationFields,
      requiredFieldIds: spec.configurationFields
        .filter((field) => field.required)
        .map((field) => field.fieldId),
      strict: true,
      description: `${spec.displayName} semantic configuration.`,
      metadata: {
        categoryId: UI_STRUCTURE_CATEGORY_ID,
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
      categoryId: UI_STRUCTURE_CATEGORY_ID,
      assetPackEntryKind: "ui-structural-primitive",
      declarativeOnly: true,
    },
  };
}

export function createUiStructuralPrimitiveEntry(
  definition: AssetDefinition,
  tags: readonly string[],
): AssetPackAssetEntry {
  const fingerprint = createUiStructuralPrimitiveFingerprint(definition);
  return {
    entryId: `system.foundation.${String(definition.definitionId).replace(/^builtin\./, "")}`,
    definition,
    definitionRef: {
      kind: "asset-definition-version",
      id: String(definition.definitionId) as never,
      version: definition.version,
      label: definition.displayName,
    },
    category: UI_STRUCTURE_CATEGORY_ID,
    sourceLayer: SYSTEM_FOUNDATION_PACK_SOURCE_LAYER,
    fingerprint,
    tags: ["foundation", "ui-structure", ...tags],
    metadata: {
      sourcePack: {
        packId: SYSTEM_FOUNDATION_PACK_ID,
        version: SYSTEM_FOUNDATION_PACK_VERSION,
      },
      categoryId: UI_STRUCTURE_CATEGORY_ID,
      sourceLayer: SYSTEM_FOUNDATION_PACK_SOURCE_LAYER,
      builtIn: true,
      systemOwned: true,
      declarativeOnly: true,
      fingerprint,
    },
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

export function inputPort(
  portId: string,
  displayName: string,
  description: string,
  dataKind = "semantic-ui-asset",
): AssetPort {
  return {
    portId,
    direction: "input",
    displayName,
    description,
    contract: {
      contractKind: "asset",
      assetType: "ui-component",
      assetFamily: "structural",
      dataKind,
      description,
    },
    cardinality: { preset: "zero-or-more", allowMultiple: true },
  };
}

export function stateInputPort(
  portId: string,
  displayName: string,
  description: string,
): AssetPort {
  return {
    portId,
    direction: "input",
    displayName,
    description,
    contract: {
      contractKind: "configuration",
      dataKind: "semantic-state",
      description,
    },
    cardinality: { preset: "optional" },
  };
}

export function eventPort(
  portId: string,
  displayName: string,
  description: string,
): AssetPort {
  return {
    portId,
    direction: "event",
    displayName,
    description,
    contract: {
      contractKind: "event",
      dataKind: "semantic-ui-event",
      description,
    },
    cardinality: { preset: "optional" },
  };
}

export function allowedChildRule(
  ruleId: string,
  description: string,
): NonNullable<AssetDefinition["compositionRules"]>[number] {
  return {
    ruleId,
    ruleKind: "allowed-child",
    description,
    allowedChildTypes: ["ui-component"],
    message: "May contain semantic UI structure primitives and later compatible UI asset categories.",
    metadata: {
      currentScope: "ui-structure",
      futureCompatibleCategories: ["forms-fields", "data-display", "state-messages"],
    },
  };
}

function createAiContext(spec: UiStructuralPrimitiveSpec): AssetAiContext {
  return {
    purpose: spec.purpose,
    userFacingSummary: spec.userSummary,
    developerFacingSummary:
      `${spec.displayName} is a semantic asset definition, not a concrete renderer component, CSS class, visual editor node, or executable UI.`,
    capabilities: spec.capabilities.map((summary, index) => ({
      capabilityId: `${spec.id}.capability.${index + 1}`,
      summary,
    })),
    limitations: [
      ...(spec.limitations ?? []),
      "Does not render pixels, call runtime or provider systems, persist records, navigate routes, or run workflows.",
      "Does not define form fields; form and field primitives live in the forms-fields category.",
    ].map((summary, index) => ({
      limitationId: `${spec.id}.limitation.${index + 1}`,
      summary,
    })),
    inputSummary: {
      summary: "Accepts semantic child assets or semantic state descriptors through declared ports.",
      expectedAssetTypes: ["ui-component"],
      required: false,
    },
    outputSummary: {
      summary: "No data output is produced; events are declarative composition signals only when listed.",
    },
    configurationGuidance: {
      summary: spec.configurationGuidance,
      recommendedDefaults: spec.defaultConfiguration,
      commonMistakes: [
        "Do not use implementation library names, style class names, route handlers, or code snippets.",
        "Use semantic labels and behavior hints that can be interpreted by future renderers.",
      ],
    },
    compositionGuidance: {
      summary: spec.compositionGuidance,
      bindingGuidance:
        "Ports describe semantic containment or state only; they do not bind to runtime calls, routers, or workflows.",
    },
    examples: [
      {
        exampleId: `${spec.id}.example.1`,
        title: `${spec.displayName} usage`,
        description: spec.exampleDescription,
        configurationValues: spec.defaultConfiguration,
        expectedOutcome: "A future composer can reason about structure without receiving implementation code.",
      },
    ],
    antiPatterns: [
      {
        antiPatternId: `${spec.id}.anti-pattern.1`,
        title: "Implementation-specific primitive",
        description: "Using this definition to name framework components, style classes, files, routes, or executable handlers.",
        whyAvoid: "The foundation pack must remain host-neutral and declarative.",
        saferAlternative: "Keep implementation choices in renderer or host layers outside the asset pack.",
      },
    ],
    safetyNotes: [
      {
        safetyNoteId: `${spec.id}.safety.1`,
        category: "operational",
        severity: "info",
        summary: "Descriptor-only UI structure with no capability requirement.",
        details: spec.accessibilityGuidance,
      },
      {
        safetyNoteId: `${spec.id}.safety.2`,
        category: "thin-client",
        severity: "info",
        summary: "Safe for read-only catalog display because it carries descriptors only and no sensitive values.",
      },
    ],
    metadata: {
      sectionIds: [
        "purpose",
        "use-cases",
        "configuration-guidance",
        "composition-guidance",
        "accessibility-guidance",
        "non-goals",
      ],
      accessibilityGuidance: spec.accessibilityGuidance,
    },
  };
}

function sourceMetadata(definitionId: UiStructuralPrimitiveId): Record<string, AssetConfigurationValue> {
  return {
    sourcePackId: SYSTEM_FOUNDATION_PACK_ID,
    sourcePackVersion: SYSTEM_FOUNDATION_PACK_VERSION,
    sourceLayer: SYSTEM_FOUNDATION_PACK_SOURCE_LAYER,
    categoryId: UI_STRUCTURE_CATEGORY_ID,
    definitionId,
  };
}

function createUiStructuralPrimitiveFingerprint(definition: AssetDefinition): string {
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
