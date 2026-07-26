import type { AssetFamily } from "./asset-family";
import { isAssetFamily } from "./asset-family";
import { normalizeAssetId } from "./asset-id";
import type { AssetMetadata } from "./asset-metadata";
import type { AssetReference } from "./asset-reference";
import type { AssetType } from "./asset-type";
import { isAssetType } from "./asset-type";
import { isAssetVersion } from "./asset-version";

export const ASSET_SLOT_DEFINITION_SCHEMA_VERSION =
  "asset-slot-definition.v1" as const;
export const MAX_ASSET_SLOTS_PER_DEFINITION = 24;
export const MAX_ASSET_SLOT_ACCEPTED_DEFINITION_REFS = 128;
export const MAX_ASSET_SLOT_CHILDREN = 128;

export type AssetSlotId = string & {
  readonly __assetSlotIdBrand: unique symbol;
};

export interface AssetSlotCardinality {
  readonly minItems: number;
  readonly maxItems: number;
}

export interface AssetSlotDefinition {
  readonly schemaVersion: typeof ASSET_SLOT_DEFINITION_SCHEMA_VERSION;
  readonly slotId: AssetSlotId;
  readonly displayName: string;
  readonly description?: string;
  readonly cardinality: AssetSlotCardinality;
  readonly acceptedAssetTypes?: readonly AssetType[];
  readonly acceptedAssetFamilies?: readonly AssetFamily[];
  readonly acceptedDefinitionRefs?: readonly AssetReference[];
  readonly metadata?: AssetMetadata;
}

export function isAssetSlotId(value: string): value is AssetSlotId {
  return value.length <= 64 && /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(value);
}

export function normalizeAssetSlotId(value: string): AssetSlotId {
  const normalized = value.trim().toLowerCase();
  if (!isAssetSlotId(normalized)) {
    throw safeError(
      "Asset slot id must be a lowercase, direction-neutral identifier of 64 characters or fewer.",
    );
  }
  return normalized;
}

export function normalizeAssetSlotDefinition(
  value: AssetSlotDefinition,
): AssetSlotDefinition {
  if (value.schemaVersion !== ASSET_SLOT_DEFINITION_SCHEMA_VERSION) {
    throw safeError("Asset slot definition schema version is unsupported.");
  }
  const displayName = boundedText(value.displayName, 120, "display name");
  const description = optionalBoundedText(
    value.description,
    1_000,
    "description",
  );
  const cardinality = normalizeCardinality(value.cardinality);
  const acceptedAssetTypes = uniqueValues(
    value.acceptedAssetTypes,
    isAssetType,
    "asset type",
  );
  const acceptedAssetFamilies = uniqueValues(
    value.acceptedAssetFamilies,
    isAssetFamily,
    "asset family",
  );
  const acceptedDefinitionRefs = normalizeAcceptedDefinitionRefs(
    value.acceptedDefinitionRefs,
  );
  if (
    acceptedAssetTypes.length === 0 &&
    acceptedAssetFamilies.length === 0 &&
    acceptedDefinitionRefs.length === 0
  ) {
    throw safeError(
      "Asset slots must declare at least one accepted child rule.",
    );
  }
  return {
    schemaVersion: ASSET_SLOT_DEFINITION_SCHEMA_VERSION,
    slotId: normalizeAssetSlotId(value.slotId),
    displayName,
    ...(description ? { description } : {}),
    cardinality,
    ...(acceptedAssetTypes.length ? { acceptedAssetTypes } : {}),
    ...(acceptedAssetFamilies.length ? { acceptedAssetFamilies } : {}),
    ...(acceptedDefinitionRefs.length ? { acceptedDefinitionRefs } : {}),
    ...(value.metadata ? { metadata: value.metadata } : {}),
  };
}

export function normalizeAssetSlotDefinitions(
  values: readonly AssetSlotDefinition[] | undefined,
): readonly AssetSlotDefinition[] {
  if (!values) return [];
  if (values.length > MAX_ASSET_SLOTS_PER_DEFINITION) {
    throw safeError(
      `Asset definitions may declare at most ${MAX_ASSET_SLOTS_PER_DEFINITION} slots.`,
    );
  }
  const normalized = values.map(normalizeAssetSlotDefinition);
  const ids = new Set<string>();
  for (const slot of normalized) {
    if (ids.has(slot.slotId)) {
      throw safeError("Asset slot ids must be unique within a definition.");
    }
    ids.add(slot.slotId);
  }
  return normalized;
}

function normalizeCardinality(
  value: AssetSlotCardinality,
): AssetSlotCardinality {
  if (
    !Number.isInteger(value.minItems) ||
    !Number.isInteger(value.maxItems) ||
    value.minItems < 0 ||
    value.maxItems < value.minItems ||
    value.maxItems > MAX_ASSET_SLOT_CHILDREN
  ) {
    throw safeError(
      `Asset slot cardinality must be an ordered integer range between 0 and ${MAX_ASSET_SLOT_CHILDREN}.`,
    );
  }
  return { minItems: value.minItems, maxItems: value.maxItems };
}

function normalizeAcceptedDefinitionRefs(
  values: readonly AssetReference[] | undefined,
): readonly AssetReference[] {
  if (!values) return [];
  if (values.length > MAX_ASSET_SLOT_ACCEPTED_DEFINITION_REFS) {
    throw safeError(
      "Asset slot accepted definition references exceed the limit.",
    );
  }
  const seen = new Set<string>();
  return values.map((reference) => {
    if (
      reference.kind !== "asset-definition-version" ||
      !reference.version ||
      !isAssetVersion(reference.version)
    ) {
      throw safeError(
        "Asset slot accepted definition references must pin an exact definition version.",
      );
    }
    const id = normalizeAssetId(String(reference.id));
    if (String(id).length > 160) {
      throw safeError("Asset slot accepted definition ids exceed the limit.");
    }
    const key = `${id}@${reference.version}`;
    if (seen.has(key)) {
      throw safeError(
        "Asset slot accepted definition references must be unique.",
      );
    }
    seen.add(key);
    return {
      kind: "asset-definition-version",
      id,
      version: reference.version,
      ...(reference.label
        ? { label: boundedText(reference.label, 120, "reference label") }
        : {}),
      ...(reference.metadata ? { metadata: reference.metadata } : {}),
    } as AssetReference;
  });
}

function uniqueValues<T extends string>(
  values: readonly T[] | undefined,
  allowed: (value: string) => value is T,
  label: string,
): readonly T[] {
  if (!values) return [];
  const normalized = values.map((value) => String(value).trim().toLowerCase());
  const typedValues = normalized.filter(allowed);
  if (typedValues.length !== normalized.length) {
    throw safeError(`Asset slot accepted ${label} is unsupported.`);
  }
  if (new Set(typedValues).size !== typedValues.length) {
    throw safeError(`Asset slot accepted ${label} values must be unique.`);
  }
  return typedValues;
}

function boundedText(value: string, maximum: number, label: string): string {
  const normalized = value.trim();
  if (
    !normalized ||
    normalized.length > maximum ||
    /[\u0000-\u001f\u007f]/.test(normalized)
  ) {
    throw safeError(`Asset slot ${label} is invalid.`);
  }
  return normalized;
}

function optionalBoundedText(
  value: string | undefined,
  maximum: number,
  label: string,
): string | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  return boundedText(value, maximum, label);
}

function safeError(message: string): Error {
  const error = new Error(message);
  error.stack = undefined;
  return error;
}
