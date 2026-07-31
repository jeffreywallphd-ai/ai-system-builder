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
  SHELL_PRIMITIVE_VERSION,
  type ShellPrimitiveId,
} from "./shell-primitive-ids";

export type ShellPrimitiveCategoryId =
  | "page-feature-shells"
  | "workflow-system-shells";

export type ShellPrimitiveKind =
  | "page-shell"
  | "feature-shell"
  | "dashboard-section-shell"
  | "settings-panel-shell"
  | "resource-browser-shell"
  | "detail-page-shell"
  | "wizard-step-shell"
  | "navigation-group-shell"
  | "workflow-shell"
  | "workflow-step-shell"
  | "system-shell"
  | "subsystem-shell"
  | "policy-check-shell"
  | "test-check-shell";

export interface ShellPrimitiveSpec {
  readonly id: ShellPrimitiveId;
  readonly categoryId: ShellPrimitiveCategoryId;
  readonly assetType: AssetDefinition["assetType"];
  readonly assetFamily: AssetDefinition["assetFamily"];
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
  readonly shellGuidance: string;
  readonly nonRunningGuidance: string;
  readonly exampleDescription: string;
  readonly tags: readonly string[];
}

export function createShellPrimitiveDefinition(
  spec: ShellPrimitiveSpec,
): AssetDefinition {
  const shellKind = shellKindForDefinitionId(spec.id);
  return {
    definitionId: spec.id,
    assetType: spec.assetType,
    assetFamily: spec.assetFamily,
    version: SHELL_PRIMITIVE_VERSION,
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
      schemaVersion: SHELL_PRIMITIVE_VERSION,
      fields: spec.configurationFields,
      requiredFieldIds: spec.configurationFields
        .filter((field) => field.required)
        .map((field) => field.fieldId),
      strict: true,
      description: `${spec.displayName} semantic shell configuration.`,
      metadata: {
        categoryId: spec.categoryId,
        shellKind,
        declarativeOnly: true,
      },
    },
    defaultConfiguration: spec.defaultConfiguration,
    aiContext: createAiContext(spec),
    requirements: [
      {
        requirementId: `${spec.id}.declarative-shell`,
        requirementKind: "custom",
        required: false,
        safetyStatus: "safe",
        summary: "Semantic catalog definition only; no host capability is required.",
        details: {
          declarativeOnly: true,
          capabilityFree: true,
          nonRunning: true,
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
        spec.categoryId === "page-feature-shells"
          ? "page-feature-shell-primitive"
          : "workflow-system-shell-primitive",
      shellKind,
      declarativeOnly: true,
      nonRunning: true,
    },
  };
}

export function createShellPrimitiveEntry(
  definition: AssetDefinition,
  categoryId: ShellPrimitiveCategoryId,
  tags: readonly string[],
): AssetPackAssetEntry {
  const fingerprint = createShellPrimitiveFingerprint(definition);
  const shellKind = definition.metadata?.shellKind;
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
      ...(typeof shellKind === "string" ? { shellKind } : {}),
      declarativeOnly: true,
      nonRunning: true,
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

export function descriptorArrayField(
  fieldId: string,
  label: string,
  semanticItemKind: string,
  expectedFields: readonly string[],
  description?: string,
): AssetConfigurationField {
  return {
    fieldId,
    valueKind: "array",
    label,
    description:
      description ??
      `Array of semantic ${semanticItemKind} descriptors for future composition.`,
    required: false,
    defaultValue: [],
    exampleValues: [
      Object.fromEntries(expectedFields.map((field) => [field, `example-${field}`])),
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
      rendererSpecific: false,
      executable: false,
    },
  };
}

export function assetInputPort(
  portId: string,
  displayName: string,
  description: string,
  dataKind: string,
  assetType?: AssetDefinition["assetType"],
  assetFamily?: AssetDefinition["assetFamily"],
): AssetPort {
  return {
    portId,
    direction: "input",
    displayName,
    description,
    contract: {
      contractKind: "asset",
      ...(assetType ? { assetType } : {}),
      ...(assetFamily ? { assetFamily } : {}),
      dataKind,
      description,
    },
    cardinality: { preset: "zero-or-more", allowMultiple: true },
  };
}

export function configurationInputPort(
  portId: string,
  displayName: string,
  description: string,
  dataKind: string,
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

export function outputPort(
  portId: string,
  displayName: string,
  description: string,
  dataKind: string,
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

export function eventPort(
  portId: string,
  displayName: string,
  description: string,
  dataKind = "semantic-shell-event",
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
  allowedChildTypes: readonly AssetDefinition["assetType"][],
  compatibleCategories: readonly string[],
  compatibleChildDefinitionIds: readonly string[] = [],
): NonNullable<AssetDefinition["compositionRules"]>[number] {
  return {
    ruleId,
    ruleKind: "allowed-child",
    description,
    allowedChildTypes,
    message:
      "May contain compatible semantic foundation definitions through future composition.",
    metadata: {
      compatibleCategories: [...compatibleCategories],
      compatibleChildDefinitionIds: [...compatibleChildDefinitionIds],
      declarativeOnly: true,
    },
  };
}

export function allowedParentRule(
  ruleId: string,
  description: string,
  allowedParentTypes: readonly AssetDefinition["assetType"][],
  compatibleParentCategories: readonly string[],
): NonNullable<AssetDefinition["compositionRules"]>[number] {
  return {
    ruleId,
    ruleKind: "allowed-parent",
    description,
    allowedParentTypes,
    message:
      "Should be attached to compatible semantic shell definitions through future composition.",
    metadata: {
      compatibleParentCategories: [...compatibleParentCategories],
      declarativeOnly: true,
    },
  };
}

export function optionalChildRule(
  ruleId: string,
  description: string,
  optionalAssetTypes: readonly AssetDefinition["assetType"][],
  compatibleChildDefinitionIds: readonly string[],
  compatibleChildCategories: readonly string[],
): NonNullable<AssetDefinition["compositionRules"]>[number] {
  return {
    ruleId,
    ruleKind: "optional-child",
    description,
    optionalAssetTypes,
    metadata: {
      compatibleChildDefinitionIds: [...compatibleChildDefinitionIds],
      compatibleChildCategories: [...compatibleChildCategories],
      declarativeOnly: true,
    },
  };
}

function createAiContext(spec: ShellPrimitiveSpec): AssetAiContext {
  const shellKind = shellKindForDefinitionId(spec.id);
  return {
    purpose: spec.purpose,
    userFacingSummary: spec.userSummary,
    developerFacingSummary:
      `${spec.displayName} is a semantic asset definition, not a concrete renderer page, component, route, workflow engine, runtime task, scheduler, provider integration, or generated system.`,
    capabilities: spec.capabilities.map((summary, index) => ({
      capabilityId: `${spec.id}.capability.${index + 1}`,
      summary,
    })),
    limitations: [
      ...(spec.limitations ?? []),
      spec.nonRunningGuidance,
      "Does not route users, render screens, create tasks, schedule work, process data, call providers, read or write storage, or author compositions by itself.",
      "Visual editing, graph or canvas behavior, workflow handling, task lifecycle behavior, and AI-created composition are outside this definition.",
    ].map((summary, index) => ({
      limitationId: `${spec.id}.limitation.${index + 1}`,
      summary,
    })),
    inputSummary: {
      summary:
        "Accepts semantic child definitions, state descriptors, content descriptors, or check candidates through declared ports.",
      expectedAssetTypes: ["ui-component", "feature", "workflow", "workflow-step", "system", "subsystem", "policy", "test"],
      required: false,
    },
    outputSummary: {
      summary:
        "Outputs and events are declarative signals for future composition only and do not perform effects by themselves.",
    },
    configurationGuidance: {
      summary: spec.configurationGuidance,
      recommendedDefaults: spec.defaultConfiguration,
      commonMistakes: [
        "Do not use route names, API targets, IPC channels, framework component names, style class names, code snippets, provider details, or task identifiers.",
        "Use semantic labels, purpose fields, state hints, and accessibility labels that future composers can interpret.",
      ],
    },
    compositionGuidance: {
      summary: spec.compositionGuidance,
      bindingGuidance:
        "Ports describe semantic containment, content, state, checks, and user intent only; they do not bind to routers, workflow runners, schedulers, provider clients, or storage.",
    },
    examples: [
      {
        exampleId: `${spec.id}.example.1`,
        title: `${spec.displayName} usage`,
        description: spec.exampleDescription,
        configurationValues: spec.defaultConfiguration,
        expectedOutcome:
          "A future composer can reason about shell semantics without receiving implementation code.",
      },
    ],
    antiPatterns: [
      {
        antiPatternId: `${spec.id}.anti-pattern.1`,
        title: "Implementation-specific shell",
        description:
          "Using this definition to name routes, framework pages, engine steps, task handlers, provider integrations, schedules, files, or generated composition payloads.",
        whyAvoid:
          "The system foundation pack must remain host-neutral, declarative, and non-running.",
        saferAlternative:
          "Keep implementation choices in renderer, application behavior, host, runtime, or provider layers outside the asset pack.",
      },
    ],
    safetyNotes: [
      {
        safetyNoteId: `${spec.id}.safety.1`,
        category: "operational",
        severity: "info",
        summary: "Descriptor-only shell primitive with no capability requirement.",
        details: spec.nonRunningGuidance,
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
        "shell-guidance",
        "non-running-guidance",
        "non-goals",
      ],
      shellGuidance: spec.shellGuidance,
      nonRunningGuidance: spec.nonRunningGuidance,
      shellKind,
      semanticDefinitionOnly: true,
      nonRunning: true,
    },
  };
}

function sourceMetadata(
  definitionId: ShellPrimitiveId,
  categoryId: ShellPrimitiveCategoryId,
): Record<string, AssetConfigurationValue> {
  return {
    sourcePackId: SYSTEM_FOUNDATION_PACK_ID,
    sourcePackVersion: SYSTEM_FOUNDATION_PACK_VERSION,
    sourceLayer: SYSTEM_FOUNDATION_PACK_SOURCE_LAYER,
    categoryId,
    definitionId,
  };
}

function shellKindForDefinitionId(definitionId: ShellPrimitiveId): ShellPrimitiveKind {
  switch (definitionId) {
    case "builtin.shell.page":
      return "page-shell";
    case "builtin.shell.feature":
      return "feature-shell";
    case "builtin.shell.dashboard-section":
      return "dashboard-section-shell";
    case "builtin.shell.settings-panel":
      return "settings-panel-shell";
    case "builtin.shell.resource-browser":
      return "resource-browser-shell";
    case "builtin.shell.detail-page":
      return "detail-page-shell";
    case "builtin.shell.wizard-step":
      return "wizard-step-shell";
    case "builtin.shell.navigation-group":
      return "navigation-group-shell";
    case "builtin.workflow.workflow":
      return "workflow-shell";
    case "builtin.workflow.step":
    case "builtin.workflow.input-step":
    case "builtin.workflow.transform-step":
    case "builtin.workflow.validation-step":
    case "builtin.workflow.approval-step":
    case "builtin.workflow.output-step":
      return "workflow-step-shell";
    case "builtin.system.system":
      return "system-shell";
    case "builtin.system.subsystem":
      return "subsystem-shell";
    case "builtin.system.policy-check":
      return "policy-check-shell";
    case "builtin.system.test-check":
      return "test-check-shell";
  }
}

function createShellPrimitiveFingerprint(definition: AssetDefinition): string {
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
