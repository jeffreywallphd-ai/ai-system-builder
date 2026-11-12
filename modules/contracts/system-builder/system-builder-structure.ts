import {
  isAssetVersion,
  normalizeAssetId,
  type AssetPlacement,
  type AssetReference,
  type AssetSlotDefinition,
} from "../asset";

export const SYSTEM_BUILDER_STRUCTURE_SCHEMA_VERSION =
  "system-builder-structure.v1" as const;

export const SYSTEM_BUILDER_PROFILES = [
  "interactive",
  "service",
  "workflow",
] as const;

export type SystemBuilderProfile = (typeof SYSTEM_BUILDER_PROFILES)[number];

const FOUNDATION_CONTENT_PAGE_IDS = new Set([
  "builtin.layout.page.single",
  "builtin.layout.page.header-content",
  "builtin.layout.page.main-aside",
  "builtin.layout.page.aside-main",
  "builtin.layout.page.three-panel",
]);

/** System Builder allows empty visual regions on the exact Foundation v3 pages. */
export function minimumSystemBuilderSlotItems(
  profile: SystemBuilderProfile | undefined,
  parent: AssetReference,
  slot: Pick<AssetSlotDefinition, "slotId" | "cardinality">,
): number {
  if (
    profile === "interactive" &&
    parent.kind === "asset-definition-version" &&
    parent.version === "3.0.0"
  ) {
    const definitionId = String(parent.id);
    if (FOUNDATION_CONTENT_PAGE_IDS.has(definitionId) && slot.slotId === "content") {
      return 0;
    }
    if (
      definitionId === "builtin.layout.page.equal-split" &&
      (slot.slotId === "start-panel" || slot.slotId === "end-panel")
    ) {
      return 0;
    }
  }
  return slot.cardinality.minItems;
}

export interface SystemBuilderStructure {
  readonly schemaVersion: typeof SYSTEM_BUILDER_STRUCTURE_SCHEMA_VERSION;
  readonly profile: SystemBuilderProfile;
  readonly layoutPresetRef?: AssetReference;
}

export type SystemBuilderStructureStatus = "slot-based" | "legacy-flat";

export interface SystemBuilderStructureClassification {
  readonly status: SystemBuilderStructureStatus;
  readonly profile?: SystemBuilderProfile;
  readonly schemaVersion?: typeof SYSTEM_BUILDER_STRUCTURE_SCHEMA_VERSION;
}

export function isSystemBuilderProfile(
  value: unknown,
): value is SystemBuilderProfile {
  return (
    typeof value === "string" &&
    SYSTEM_BUILDER_PROFILES.includes(value as SystemBuilderProfile)
  );
}

export function normalizeSystemBuilderProfile(
  value: string,
): SystemBuilderProfile {
  const normalized = value.trim().toLowerCase();
  if (!isSystemBuilderProfile(normalized)) {
    throw safeError("System Builder profile is unsupported.");
  }
  return normalized;
}

export function normalizeSystemBuilderStructure(
  value: SystemBuilderStructure,
): SystemBuilderStructure {
  if (value.schemaVersion !== SYSTEM_BUILDER_STRUCTURE_SCHEMA_VERSION) {
    throw safeError("System Builder structure schema version is unsupported.");
  }
  const layoutPresetRef = value.layoutPresetRef
    ? normalizeLayoutPresetReference(value.layoutPresetRef)
    : undefined;
  return {
    schemaVersion: SYSTEM_BUILDER_STRUCTURE_SCHEMA_VERSION,
    profile: normalizeSystemBuilderProfile(value.profile),
    ...(layoutPresetRef ? { layoutPresetRef } : {}),
  };
}

export function classifySystemBuilderStructure(value: {
  readonly structure?: SystemBuilderStructure;
  readonly placements?: readonly AssetPlacement[];
}): SystemBuilderStructureClassification {
  if (
    !value.structure &&
    (!value.placements || value.placements.length === 0)
  ) {
    return { status: "legacy-flat" };
  }
  if (!value.structure) {
    throw safeError(
      "Slot-based revisions must declare a structure descriptor.",
    );
  }
  const structure = normalizeSystemBuilderStructure(value.structure);
  return {
    status: "slot-based",
    profile: structure.profile,
    schemaVersion: structure.schemaVersion,
  };
}

function normalizeLayoutPresetReference(value: AssetReference): AssetReference {
  if (
    value.kind !== "asset-definition-version" ||
    !value.version ||
    !isAssetVersion(value.version)
  ) {
    throw safeError(
      "System Builder layout presets must pin an exact definition version.",
    );
  }
  const id = normalizeAssetId(String(value.id));
  if (String(id).length > 160) {
    throw safeError(
      "System Builder layout preset id exceeds the supported length.",
    );
  }
  return { ...value, id };
}

function safeError(message: string): Error {
  const error = new Error(message);
  error.stack = undefined;
  return error;
}
