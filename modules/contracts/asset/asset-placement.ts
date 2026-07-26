import type { AssetId } from "./asset-id";
import { normalizeAssetId } from "./asset-id";
import type { AssetMetadata } from "./asset-metadata";
import type { AssetProvenance } from "./asset-provenance";
import type { AssetReference } from "./asset-reference";
import {
  MAX_ASSET_SLOT_CHILDREN,
  normalizeAssetSlotId,
  type AssetSlotId,
} from "./asset-slot-definition";

export const ASSET_PLACEMENT_SCHEMA_VERSION = "asset-placement.v1" as const;
export const MAX_ASSET_PLACEMENTS_PER_COMPOSITION = 512;
export const MAX_ASSET_PLACEMENT_DEPTH = 32;

export interface AssetPlacement {
  readonly schemaVersion: typeof ASSET_PLACEMENT_SCHEMA_VERSION;
  readonly placementId: AssetId | string;
  readonly parentInstanceRef: AssetReference;
  readonly slotId: AssetSlotId;
  readonly childInstanceRef: AssetReference;
  readonly order: number;
  readonly provenance?: AssetProvenance;
  readonly metadata?: AssetMetadata;
}

export function normalizeAssetPlacement(value: AssetPlacement): AssetPlacement {
  if (value.schemaVersion !== ASSET_PLACEMENT_SCHEMA_VERSION) {
    throw safeError("Asset placement schema version is unsupported.");
  }
  if (
    !Number.isInteger(value.order) ||
    value.order < 0 ||
    value.order >= MAX_ASSET_SLOT_CHILDREN
  ) {
    throw safeError("Asset placement order is outside the supported range.");
  }
  const parentInstanceRef = normalizeInstanceReference(
    value.parentInstanceRef,
    "parent",
  );
  const childInstanceRef = normalizeInstanceReference(
    value.childInstanceRef,
    "child",
  );
  if (String(parentInstanceRef.id) === String(childInstanceRef.id)) {
    throw safeError("An asset placement cannot contain itself.");
  }
  return {
    schemaVersion: ASSET_PLACEMENT_SCHEMA_VERSION,
    placementId: normalizeBoundedId(value.placementId, "placement"),
    parentInstanceRef,
    slotId: normalizeAssetSlotId(value.slotId),
    childInstanceRef,
    order: value.order,
    ...(value.provenance ? { provenance: value.provenance } : {}),
    ...(value.metadata ? { metadata: value.metadata } : {}),
  };
}

export function normalizeAssetPlacements(
  values: readonly AssetPlacement[] | undefined,
): readonly AssetPlacement[] {
  if (!values) return [];
  if (values.length > MAX_ASSET_PLACEMENTS_PER_COMPOSITION) {
    throw safeError(
      `Asset compositions may declare at most ${MAX_ASSET_PLACEMENTS_PER_COMPOSITION} placements.`,
    );
  }
  const normalized = values.map(normalizeAssetPlacement);
  const placementIds = new Set<string>();
  const childIds = new Set<string>();
  const positions = new Set<string>();
  for (const placement of normalized) {
    const placementId = String(placement.placementId);
    const childId = String(placement.childInstanceRef.id);
    const position = `${placement.parentInstanceRef.id}:${placement.slotId}:${placement.order}`;
    if (placementIds.has(placementId)) {
      throw safeError("Asset placement ids must be unique.");
    }
    if (childIds.has(childId)) {
      throw safeError("An asset instance may have only one placement parent.");
    }
    if (positions.has(position)) {
      throw safeError(
        "Asset placement order must be unique within a parent slot.",
      );
    }
    if (String(placement.parentInstanceRef.id) === childId) {
      throw safeError("An asset placement cannot contain itself.");
    }
    placementIds.add(placementId);
    childIds.add(childId);
    positions.add(position);
  }
  return normalized;
}

function normalizeInstanceReference(
  value: AssetReference,
  label: "parent" | "child",
): AssetReference {
  if (value.kind !== "asset-instance" || value.version !== undefined) {
    throw safeError(
      `Asset placement ${label} must reference an asset instance.`,
    );
  }
  return {
    kind: "asset-instance",
    id: normalizeBoundedId(value.id, `${label} instance`),
    ...(value.label ? { label: boundedLabel(value.label) } : {}),
    ...(value.metadata ? { metadata: value.metadata } : {}),
  } as AssetReference;
}

function normalizeBoundedId(value: AssetId | string, label: string): AssetId {
  const normalized = normalizeAssetId(String(value));
  if (String(normalized).length > 160) {
    throw safeError(`Asset ${label} id exceeds the supported length.`);
  }
  return normalized;
}

function boundedLabel(value: string): string {
  const normalized = value.trim();
  if (
    !normalized ||
    normalized.length > 120 ||
    /[\u0000-\u001f\u007f]/.test(normalized)
  ) {
    throw safeError("Asset placement reference label is invalid.");
  }
  return normalized;
}

function safeError(message: string): Error {
  const error = new Error(message);
  error.stack = undefined;
  return error;
}
