import {
  normalizeAssetId,
  type AssetReference,
} from "../../../contracts/asset";
import type {
  AssetCustomizationSourceFileChange,
  AssetDerivedCustomizationSemanticPatch,
  AssetDerivedCustomizationTargetDetail,
} from "../../../contracts/asset-authoring";
import type { AssetImplementationBackingResourceRole } from "../../../contracts/asset-implementation";

export interface AssetCustomizationEditorValues {
  readonly derivedDefinitionId: string;
  readonly derivedDefinitionVersion: string;
  readonly displayName: string;
  readonly summary: string;
  readonly description: string;
  readonly classification: string;
  readonly tags: string;
  readonly safeMetadata: string;
  readonly configurationSchema: string;
  readonly defaultConfiguration: string;
  readonly ports: string;
  readonly aiContext: string;
  readonly requirements: string;
  readonly compositionRules: string;
  readonly dependencies: string;
}

export interface AssetCustomizationResourceDraft {
  readonly path: string;
  readonly role: AssetImplementationBackingResourceRole;
  readonly mediaType: string;
  readonly content: string;
  readonly baseContent?: string;
  readonly editable: boolean;
  readonly deleted: boolean;
}

export function createAssetCustomizationEditorValues(
  target: AssetDerivedCustomizationTargetDetail,
): AssetCustomizationEditorValues {
  const definition = target.definition;
  const metadata = definition?.metadata as Record<string, unknown> | undefined;
  return {
    derivedDefinitionId: `${String(target.definitionRef.id)}.custom`,
    derivedDefinitionVersion: "1.0.0",
    displayName: `${target.displayName} (Custom)`,
    summary: stringValue(metadata?.summary),
    description: definition?.description ?? target.description,
    classification: stringValue(metadata?.classification),
    tags: stringList(metadata?.tags).join(", "),
    safeMetadata: "{}",
    configurationSchema: json(definition?.configurationSchema),
    defaultConfiguration: json(definition?.defaultConfiguration),
    ports: json(definition?.ports ?? []),
    aiContext: json(definition?.aiContext),
    requirements: json(definition?.requirements ?? []),
    compositionRules: json(definition?.compositionRules ?? []),
    dependencies: json(definition?.dependencies ?? []),
  };
}

export function createAssetCustomizationResourceDrafts(
  target: AssetDerivedCustomizationTargetDetail,
): readonly AssetCustomizationResourceDraft[] {
  return target.backingResources.map((resource) => ({
    path: resource.path,
    role: resource.role,
    mediaType: resource.mediaType,
    content: resource.content,
    baseContent: resource.content,
    editable: resource.editable,
    deleted: false,
  }));
}

export function buildAssetCustomizationSubmission(
  target: AssetDerivedCustomizationTargetDetail,
  values: AssetCustomizationEditorValues,
  resources: readonly AssetCustomizationResourceDraft[],
): {
  readonly derivedDefinitionRef: AssetReference;
  readonly semanticPatch: AssetDerivedCustomizationSemanticPatch;
  readonly sourceChanges: readonly AssetCustomizationSourceFileChange[];
} {
  const definition = target.definition;
  if (
    !values.derivedDefinitionId.trim() ||
    !values.derivedDefinitionVersion.trim()
  ) {
    throw new Error("Derived definition ID and version are required.");
  }
  if (!values.displayName.trim()) throw new Error("Display name is required.");
  const semanticPatch: Record<string, unknown> = {};
  changedString(
    semanticPatch,
    "display-name",
    values.displayName,
    definition?.displayName,
  );
  changedString(
    semanticPatch,
    "description",
    values.description,
    definition?.description,
  );
  const metadata = definition?.metadata as Record<string, unknown> | undefined;
  changedString(
    semanticPatch,
    "summary",
    values.summary,
    stringValue(metadata?.summary),
  );
  changedString(
    semanticPatch,
    "classification",
    values.classification,
    stringValue(metadata?.classification),
  );
  const tags = commaList(values.tags);
  if (!same(tags, stringList(metadata?.tags))) semanticPatch.tags = tags;
  const safeMetadata = parseJson(
    values.safeMetadata,
    "Safe metadata additions",
  );
  if (safeMetadata !== undefined && !isEmptyObject(safeMetadata))
    semanticPatch["safe-metadata"] = safeMetadata;
  changedJson(
    semanticPatch,
    "configuration-schema",
    values.configurationSchema,
    definition?.configurationSchema,
    "Configuration schema",
  );
  changedJson(
    semanticPatch,
    "default-configuration",
    values.defaultConfiguration,
    definition?.defaultConfiguration,
    "Default configuration",
  );
  changedJson(
    semanticPatch,
    "ports",
    values.ports,
    definition?.ports ?? [],
    "Ports",
  );
  changedJson(
    semanticPatch,
    "ai-context",
    values.aiContext,
    definition?.aiContext,
    "AI context",
  );
  changedJson(
    semanticPatch,
    "requirements",
    values.requirements,
    definition?.requirements ?? [],
    "Requirements",
  );
  changedJson(
    semanticPatch,
    "composition-rules",
    values.compositionRules,
    definition?.compositionRules ?? [],
    "Composition rules",
  );
  changedJson(
    semanticPatch,
    "dependencies",
    values.dependencies,
    definition?.dependencies ?? [],
    "Dependencies",
  );

  return {
    derivedDefinitionRef: {
      kind: "asset-definition-version",
      id: normalizeAssetId(values.derivedDefinitionId),
      version: values.derivedDefinitionVersion.trim(),
    },
    semanticPatch: semanticPatch as AssetDerivedCustomizationSemanticPatch,
    sourceChanges: resources.flatMap(
      (resource): readonly AssetCustomizationSourceFileChange[] => {
        if (resource.deleted)
          return resource.baseContent === undefined
            ? []
            : [{ operation: "delete", path: resource.path }];
        if (resource.baseContent === resource.content) return [];
        return [
          {
            operation: "upsert",
            path: resource.path,
            role: resource.role,
            mediaType: resource.mediaType,
            content: resource.content,
          },
        ];
      },
    ),
  };
}

export function resourceRoleLabel(
  role: AssetImplementationBackingResourceRole,
): string {
  switch (role) {
    case "frontend-structure":
      return "Frontend structure";
    case "frontend-style":
      return "Frontend styling";
    case "backend-logic":
      return "Backend logic";
    case "other":
      return "Other backing resources";
  }
}

function changedString(
  output: Record<string, unknown>,
  key: string,
  value: string,
  base: string | undefined,
) {
  const normalized = value.trim();
  if (normalized && normalized !== (base ?? "").trim())
    output[key] = normalized;
}

function changedJson(
  output: Record<string, unknown>,
  key: string,
  value: string,
  base: unknown,
  label: string,
) {
  if (!value.trim()) return;
  const parsed = parseJson(value, label);
  if (!same(parsed, base)) output[key] = parsed;
}

function parseJson(value: string, label: string): unknown {
  if (!value.trim()) return undefined;
  try {
    return JSON.parse(value);
  } catch {
    throw new Error(`${label} must be valid JSON.`);
  }
}

function json(value: unknown): string {
  return value === undefined ? "" : JSON.stringify(value, null, 2);
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function stringList(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function commaList(value: string): readonly string[] {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function isEmptyObject(value: unknown): boolean {
  return Boolean(
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value as object).length === 0,
  );
}
