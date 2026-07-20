import type { AssetPlacement } from "../../../contracts/asset";
import type { SystemBuilderComposerAsset } from "../../../contracts/system-builder";
import type { SystemComposerDraft } from "./systemComposerDraft";

export interface SystemComposerPaletteDragData {
  readonly kind: "palette-asset";
  readonly definitionId: string;
  readonly version: string;
  readonly label: string;
}

export interface SystemComposerInstanceDragData {
  readonly kind: "instance";
  readonly instanceId: string;
  readonly definitionId: string;
  readonly version: string;
  readonly label: string;
  readonly parentInstanceId: string;
  readonly slotId: string;
  readonly order: number;
}

export interface SystemComposerSlotDropData {
  readonly kind: "slot";
  readonly parentInstanceId: string;
  readonly slotId: string;
  readonly label: string;
}

export type SystemComposerDragData =
  SystemComposerPaletteDragData | SystemComposerInstanceDragData;

export type SystemComposerDropData =
  SystemComposerSlotDropData | SystemComposerInstanceDragData;

export interface SystemComposerDropTarget {
  readonly parentInstanceId: string;
  readonly slotId: string;
  readonly order?: number;
}

export type SystemComposerDropIntent =
  | {
      readonly kind: "add";
      readonly asset: SystemBuilderComposerAsset;
      readonly target: SystemComposerDropTarget;
      readonly announcement: string;
    }
  | {
      readonly kind: "place";
      readonly instanceId: string;
      readonly target: SystemComposerDropTarget;
      readonly announcement: string;
    };

export type SystemComposerDropResolution =
  | { readonly ok: true; readonly value: SystemComposerDropIntent }
  | { readonly ok: false; readonly message: string };

export function paletteDragData(
  asset: SystemBuilderComposerAsset,
): SystemComposerPaletteDragData {
  return {
    kind: "palette-asset",
    definitionId: asset.definitionId,
    version: asset.version,
    label: asset.displayName,
  };
}

export function instanceDragData(input: {
  readonly instanceId: string;
  readonly definitionId: string;
  readonly version: string;
  readonly label: string;
  readonly placement: AssetPlacement;
}): SystemComposerInstanceDragData {
  return {
    kind: "instance",
    instanceId: input.instanceId,
    definitionId: input.definitionId,
    version: input.version,
    label: input.label,
    parentInstanceId: String(input.placement.parentInstanceRef.id),
    slotId: input.placement.slotId,
    order: input.placement.order,
  };
}

export function slotDropData(input: {
  readonly parentInstanceId: string;
  readonly slotId: string;
  readonly label: string;
}): SystemComposerSlotDropData {
  return { kind: "slot", ...input };
}

export function isSystemComposerDragData(
  value: unknown,
): value is SystemComposerDragData {
  if (!isRecord(value) || typeof value.kind !== "string") return false;
  if (value.kind === "palette-asset") {
    return hasStrings(value, ["definitionId", "version", "label"]);
  }
  return (
    value.kind === "instance" &&
    hasStrings(value, [
      "instanceId",
      "definitionId",
      "version",
      "label",
      "parentInstanceId",
      "slotId",
    ]) &&
    typeof value.order === "number" &&
    Number.isInteger(value.order) &&
    Number(value.order) >= 0
  );
}

export function isSystemComposerDropData(
  value: unknown,
): value is SystemComposerDropData {
  if (isSystemComposerDragData(value) && value.kind === "instance") {
    return true;
  }
  return (
    isRecord(value) &&
    value.kind === "slot" &&
    hasStrings(value, ["parentInstanceId", "slotId", "label"])
  );
}

export function describeSystemComposerDragData(value: unknown): string {
  return isSystemComposerDragData(value) ? value.label : "asset";
}

export function describeSystemComposerDropData(value: unknown): string {
  return isSystemComposerDropData(value) ? value.label : "available region";
}

export function resolveSystemComposerDrop(input: {
  readonly source: unknown;
  readonly destination: unknown;
  readonly draft: SystemComposerDraft;
  readonly catalog: readonly SystemBuilderComposerAsset[];
  readonly compatibleAssets: readonly SystemBuilderComposerAsset[];
  readonly compatibilityTarget?: {
    readonly parentInstanceId: string;
    readonly slotId: string;
  };
  readonly protectedInstanceIds: ReadonlySet<string>;
}): SystemComposerDropResolution {
  if (!isSystemComposerDragData(input.source)) {
    return failure("The dragged asset is unavailable.");
  }
  if (!isSystemComposerDropData(input.destination)) {
    return failure("Drop the asset into an available canvas region.");
  }
  if (
    input.source.kind === "instance" &&
    input.destination.kind === "instance" &&
    input.source.instanceId === input.destination.instanceId
  ) {
    return failure("The asset is already in that position.");
  }
  if (
    input.source.kind === "instance" &&
    input.protectedInstanceIds.has(input.source.instanceId)
  ) {
    return failure("This asset is required by the selected system layout.");
  }

  const target = targetForSystemComposerDrop(
    input.destination,
    input.draft.placements,
  );
  if (!target) {
    return failure("Drop the asset into an available canvas region.");
  }
  const parent = input.draft.instances.find(
    (instance) => String(instance.instanceId) === target.parentInstanceId,
  );
  const parentDefinition = input.catalog.find(
    (asset) =>
      asset.definitionId === String(parent?.definitionRef.id) &&
      asset.version === parent?.definitionRef.version,
  );
  const slot = parentDefinition?.slots.find(
    (candidate) => candidate.slotId === target.slotId,
  );
  if (!parent || !slot) {
    return failure("The requested canvas region is unavailable.");
  }

  const sameSlot =
    input.source.kind === "instance" &&
    input.source.parentInstanceId === target.parentInstanceId &&
    input.source.slotId === target.slotId;
  const childCount = input.draft.placements.filter(
    (placement) =>
      String(placement.parentInstanceRef.id) === target.parentInstanceId &&
      placement.slotId === target.slotId,
  ).length;
  if (!sameSlot && childCount >= slot.cardinality.maxItems) {
    return failure(`${slot.displayName} has reached its asset limit.`);
  }

  const sourceDefinitionId = input.source.definitionId;
  const sourceVersion = input.source.version;
  const exactSource = input.catalog.find(
    (asset) =>
      asset.definitionId === sourceDefinitionId &&
      asset.version === sourceVersion,
  );
  if (!exactSource) {
    return failure("The exact asset definition is unavailable.");
  }
  if (!sameSlot) {
    const targetIsCurrent =
      input.compatibilityTarget?.parentInstanceId === target.parentInstanceId &&
      input.compatibilityTarget.slotId === target.slotId;
    const compatible =
      targetIsCurrent &&
      input.compatibleAssets.some(
        (asset) =>
          asset.definitionId === exactSource.definitionId &&
          asset.version === exactSource.version &&
          asset.compatibility.status === "compatible",
      );
    if (!compatible) {
      return failure(
        "This exact asset is not compatible with the selected canvas region.",
      );
    }
  }

  if (input.source.kind === "palette-asset") {
    return success({
      kind: "add",
      asset: exactSource,
      target,
      announcement: `${input.source.label} added to ${slot.displayName}.`,
    });
  }
  return success({
    kind: "place",
    instanceId: input.source.instanceId,
    target,
    announcement: `${input.source.label} moved to ${slot.displayName}.`,
  });
}

export function targetForSystemComposerDrop(
  destination: unknown,
  placements: readonly AssetPlacement[],
): SystemComposerDropTarget | undefined {
  if (!isSystemComposerDropData(destination)) return undefined;
  if (destination.kind === "instance") {
    return {
      parentInstanceId: destination.parentInstanceId,
      slotId: destination.slotId,
      order: destination.order,
    };
  }
  const order = placements.filter(
    (placement) =>
      String(placement.parentInstanceRef.id) === destination.parentInstanceId &&
      placement.slotId === destination.slotId,
  ).length;
  return {
    parentInstanceId: destination.parentInstanceId,
    slotId: destination.slotId,
    order,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function hasStrings(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  return keys.every(
    (key) => typeof value[key] === "string" && String(value[key]).length > 0,
  );
}

const success = (
  value: SystemComposerDropIntent,
): SystemComposerDropResolution => ({
  ok: true,
  value,
});

const failure = (message: string): SystemComposerDropResolution => ({
  ok: false,
  message,
});
