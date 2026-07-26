import type {
  AssetBinding,
  AssetInstance,
  AssetPlacement,
  AssetReference,
  AssetSlotId,
} from "../../../contracts/asset";
import {
  ASSET_PLACEMENT_SCHEMA_VERSION,
  normalizeAssetId,
  normalizeAssetSlotId,
} from "../../../contracts/asset";
import type {
  SystemBuilderComposerAsset,
  SystemBuilderStructure,
} from "../../../contracts/system-builder";

export interface SystemComposerDraft {
  readonly instances: readonly AssetInstance[];
  readonly placements: readonly AssetPlacement[];
  readonly bindings: readonly AssetBinding[];
  readonly structure?: SystemBuilderStructure;
}

export interface SystemComposerDraftHistory {
  readonly past: readonly SystemComposerDraft[];
  readonly present: SystemComposerDraft;
  readonly future: readonly SystemComposerDraft[];
}

export interface SystemComposerTreeNode {
  readonly instance: AssetInstance;
  readonly placement?: AssetPlacement;
  readonly depth: number;
  readonly children: readonly SystemComposerTreeNode[];
}

export type SystemComposerDraftResult =
  | { readonly ok: true; readonly value: SystemComposerDraft }
  | { readonly ok: false; readonly message: string };

export function createSystemComposerDraftHistory(
  draft: SystemComposerDraft,
): SystemComposerDraftHistory {
  return { past: [], present: cloneDraft(draft), future: [] };
}

export function commitSystemComposerDraft(
  history: SystemComposerDraftHistory,
  next: SystemComposerDraft,
): SystemComposerDraftHistory {
  if (JSON.stringify(history.present) === JSON.stringify(next)) return history;
  return {
    past: [...history.past, cloneDraft(history.present)].slice(-50),
    present: cloneDraft(next),
    future: [],
  };
}

export function undoSystemComposerDraft(
  history: SystemComposerDraftHistory,
): SystemComposerDraftHistory {
  const previous = history.past[history.past.length - 1];
  if (!previous) return history;
  return {
    past: history.past.slice(0, -1),
    present: cloneDraft(previous),
    future: [cloneDraft(history.present), ...history.future].slice(0, 50),
  };
}

export function redoSystemComposerDraft(
  history: SystemComposerDraftHistory,
): SystemComposerDraftHistory {
  const next = history.future[0];
  if (!next) return history;
  return {
    past: [...history.past, cloneDraft(history.present)].slice(-50),
    present: cloneDraft(next),
    future: history.future.slice(1),
  };
}

export function addSystemComposerAsset(
  draft: SystemComposerDraft,
  input: {
    readonly asset: SystemBuilderComposerAsset;
    readonly compositionId: string;
    readonly parentInstanceId: string;
    readonly slotId: string;
    readonly instanceId: string;
    readonly actorId?: string;
    readonly order?: number;
  },
): SystemComposerDraftResult {
  if (!findInstance(draft, input.parentInstanceId)) {
    return failure("Select an available parent asset before adding content.");
  }
  if (findInstance(draft, input.instanceId)) {
    return failure("A unique asset instance id could not be created.");
  }
  const slotId = normalizeAssetSlotId(input.slotId);
  const order = boundedInsertionOrder(
    input.order,
    nextSlotOrder(draft.placements, input.parentInstanceId, slotId),
  );
  const instance: AssetInstance = {
    instanceId: normalizeAssetId(input.instanceId),
    definitionRef: input.asset.definitionRef,
    displayName: input.asset.displayName,
    lifecycleStatus: "draft",
    selectedConfiguration: {},
    parentCompositionRef: {
      kind: "asset-composition",
      id: normalizeAssetId(input.compositionId),
    },
    provenance: {
      sourceKind: "human-authored",
      createdBy: input.actorId ?? "current-user",
    },
  };
  const placement = createPlacement({
    placementId: `placement.${safeId(input.instanceId)}`,
    parentInstanceId: input.parentInstanceId,
    childInstanceId: input.instanceId,
    slotId,
    order,
  });
  return success({
    ...draft,
    instances: [...draft.instances, instance],
    placements: normalizePlacementOrders([
      ...draft.placements.map((item) =>
        String(item.parentInstanceRef.id) === input.parentInstanceId &&
        item.slotId === slotId &&
        item.order >= order
          ? { ...item, order: item.order + 1 }
          : item,
      ),
      placement,
    ]),
  });
}

export function removeSystemComposerSubtree(
  draft: SystemComposerDraft,
  instanceId: string,
  protectedInstanceIds: ReadonlySet<string>,
): SystemComposerDraftResult {
  if (protectedInstanceIds.has(instanceId)) {
    return failure("This asset is required by the selected system layout.");
  }
  if (!findInstance(draft, instanceId)) {
    return failure("The selected asset instance is unavailable.");
  }
  const removedIds = descendantsOf(draft.placements, instanceId);
  removedIds.add(instanceId);
  for (const protectedId of protectedInstanceIds) {
    if (removedIds.has(protectedId)) {
      return failure(
        "Removing this asset would remove required layout content.",
      );
    }
  }
  return success({
    instances: draft.instances.filter(
      (instance) => !removedIds.has(String(instance.instanceId)),
    ),
    placements: normalizePlacementOrders(
      draft.placements.filter(
        (placement) =>
          !removedIds.has(String(placement.parentInstanceRef.id)) &&
          !removedIds.has(String(placement.childInstanceRef.id)),
      ),
    ),
    bindings: draft.bindings.filter(
      (binding) =>
        !removedIds.has(String(binding.sourceRef.id)) &&
        !removedIds.has(String(binding.targetRef.id)),
    ),
  });
}

export function moveSystemComposerPlacement(
  draft: SystemComposerDraft,
  instanceId: string,
  offset: -1 | 1,
): SystemComposerDraftResult {
  const placement = placementForChild(draft.placements, instanceId);
  if (!placement) return failure("Root assets cannot be reordered.");
  const siblings = slotPlacements(
    draft.placements,
    String(placement.parentInstanceRef.id),
    placement.slotId,
  );
  const index = siblings.findIndex(
    (item) => String(item.childInstanceRef.id) === instanceId,
  );
  const target = index + offset;
  if (index < 0 || target < 0 || target >= siblings.length) {
    return failure(
      offset < 0
        ? "This asset is already first."
        : "This asset is already last.",
    );
  }
  const other = siblings[target];
  if (!other) return failure("The requested order is unavailable.");
  return success({
    ...draft,
    placements: draft.placements.map((item) => {
      if (String(item.placementId) === String(placement.placementId)) {
        return { ...item, order: other.order };
      }
      if (String(item.placementId) === String(other.placementId)) {
        return { ...item, order: placement.order };
      }
      return item;
    }),
  });
}

export function reparentSystemComposerAsset(
  draft: SystemComposerDraft,
  input: {
    readonly instanceId: string;
    readonly parentInstanceId: string;
    readonly slotId: string;
    readonly order?: number;
  },
): SystemComposerDraftResult {
  const placement = placementForChild(draft.placements, input.instanceId);
  if (!placement) return failure("Root assets cannot be reparented.");
  if (!findInstance(draft, input.parentInstanceId)) {
    return failure("The selected parent asset is unavailable.");
  }
  if (
    input.instanceId === input.parentInstanceId ||
    descendantsOf(draft.placements, input.instanceId).has(
      input.parentInstanceId,
    )
  ) {
    return failure(
      "An asset cannot be moved inside itself or its descendants.",
    );
  }
  const slotId = normalizeAssetSlotId(input.slotId);
  const remaining = draft.placements.filter(
    (item) => String(item.placementId) !== String(placement.placementId),
  );
  const order = boundedInsertionOrder(
    input.order,
    nextSlotOrder(remaining, input.parentInstanceId, slotId),
  );
  return success({
    ...draft,
    placements: normalizePlacementOrders([
      ...remaining.map((item) =>
        String(item.parentInstanceRef.id) === input.parentInstanceId &&
        item.slotId === slotId &&
        item.order >= order
          ? { ...item, order: item.order + 1 }
          : item,
      ),
      {
        ...placement,
        parentInstanceRef: instanceReference(input.parentInstanceId),
        slotId,
        order,
      },
    ]),
  });
}

export function attachUnassignedSystemComposerAsset(
  draft: SystemComposerDraft,
  input: {
    readonly instanceId: string;
    readonly parentInstanceId: string;
    readonly slotId: string;
    readonly rootInstanceIds: ReadonlySet<string>;
    readonly order?: number;
  },
): SystemComposerDraftResult {
  if (!findInstance(draft, input.instanceId)) {
    return failure("The selected asset instance is unavailable.");
  }
  if (input.rootInstanceIds.has(input.instanceId)) {
    return failure(
      "The protected system root cannot be placed inside another asset.",
    );
  }
  if (placementForChild(draft.placements, input.instanceId)) {
    return reparentSystemComposerAsset(draft, input);
  }
  if (!findInstance(draft, input.parentInstanceId)) {
    return failure("The selected parent asset is unavailable.");
  }
  if (
    input.instanceId === input.parentInstanceId ||
    descendantsOf(draft.placements, input.instanceId).has(
      input.parentInstanceId,
    )
  ) {
    return failure(
      "An asset cannot be moved inside itself or its descendants.",
    );
  }
  const slotId = normalizeAssetSlotId(input.slotId);
  const order = boundedInsertionOrder(
    input.order,
    nextSlotOrder(draft.placements, input.parentInstanceId, slotId),
  );
  return success({
    ...draft,
    placements: normalizePlacementOrders([
      ...draft.placements.map((item) =>
        String(item.parentInstanceRef.id) === input.parentInstanceId &&
        item.slotId === slotId &&
        item.order >= order
          ? { ...item, order: item.order + 1 }
          : item,
      ),
      createPlacement({
        placementId: `placement.${safeId(input.instanceId)}.attached`,
        parentInstanceId: input.parentInstanceId,
        childInstanceId: input.instanceId,
        slotId,
        order,
      }),
    ]),
  });
}

export function wrapSystemComposerAsset(
  draft: SystemComposerDraft,
  input: {
    readonly instanceId: string;
    readonly wrapper: SystemBuilderComposerAsset;
    readonly wrapperInstanceId: string;
    readonly wrapperSlotId: string;
    readonly compositionId: string;
  },
): SystemComposerDraftResult {
  const placement = placementForChild(draft.placements, input.instanceId);
  if (!placement) return failure("Root assets cannot be wrapped.");
  if (findInstance(draft, input.wrapperInstanceId)) {
    return failure("A unique wrapper instance id could not be created.");
  }
  const wrapper: AssetInstance = {
    instanceId: normalizeAssetId(input.wrapperInstanceId),
    definitionRef: input.wrapper.definitionRef,
    displayName: input.wrapper.displayName,
    lifecycleStatus: "draft",
    selectedConfiguration: {},
    parentCompositionRef: {
      kind: "asset-composition",
      id: normalizeAssetId(input.compositionId),
    },
    provenance: { sourceKind: "human-authored", createdBy: "current-user" },
  };
  const wrapperPlacement = createPlacement({
    placementId: `placement.${safeId(input.wrapperInstanceId)}`,
    parentInstanceId: String(placement.parentInstanceRef.id),
    childInstanceId: input.wrapperInstanceId,
    slotId: placement.slotId,
    order: placement.order,
  });
  const childPlacement: AssetPlacement = {
    ...placement,
    parentInstanceRef: instanceReference(input.wrapperInstanceId),
    slotId: normalizeAssetSlotId(input.wrapperSlotId),
    order: 0,
  };
  return success({
    ...draft,
    instances: [...draft.instances, wrapper],
    placements: draft.placements
      .map((item) =>
        String(item.placementId) === String(placement.placementId)
          ? childPlacement
          : item,
      )
      .concat(wrapperPlacement),
  });
}

export function buildSystemComposerTree(
  draft: SystemComposerDraft,
  rootInstanceRefs: readonly AssetReference[],
): readonly SystemComposerTreeNode[] {
  const byId = new Map(
    draft.instances.map((instance) => [String(instance.instanceId), instance]),
  );
  const byParent = new Map<string, AssetPlacement[]>();
  for (const placement of draft.placements) {
    const key = String(placement.parentInstanceRef.id);
    byParent.set(key, [...(byParent.get(key) ?? []), placement]);
  }
  for (const placements of byParent.values()) {
    placements.sort(
      (left, right) =>
        left.slotId.localeCompare(right.slotId) || left.order - right.order,
    );
  }
  const visit = (
    instanceId: string,
    depth: number,
    path: ReadonlySet<string>,
    placement?: AssetPlacement,
  ): SystemComposerTreeNode | undefined => {
    const instance = byId.get(instanceId);
    if (!instance || path.has(instanceId) || depth > 32) return undefined;
    const nextPath = new Set(path).add(instanceId);
    const children = (byParent.get(instanceId) ?? []).flatMap(
      (childPlacement) => {
        const child = visit(
          String(childPlacement.childInstanceRef.id),
          depth + 1,
          nextPath,
          childPlacement,
        );
        return child ? [child] : [];
      },
    );
    return { instance, ...(placement ? { placement } : {}), depth, children };
  };
  return rootInstanceRefs.flatMap((reference) => {
    const node = visit(String(reference.id), 1, new Set());
    return node ? [node] : [];
  });
}

export function flattenSystemComposerTree(
  nodes: readonly SystemComposerTreeNode[],
): readonly SystemComposerTreeNode[] {
  return nodes.flatMap((node) => [
    node,
    ...flattenSystemComposerTree(node.children),
  ]);
}

export function deriveProtectedSystemInstanceIds(
  draft: SystemComposerDraft,
  rootInstanceRefs: readonly AssetReference[],
  catalog: readonly SystemBuilderComposerAsset[],
): ReadonlySet<string> {
  const protectedIds = new Set(
    rootInstanceRefs.map((reference) => String(reference.id)),
  );
  const definitions = new Map(
    catalog.map((asset) => [`${asset.definitionId}@${asset.version}`, asset]),
  );
  const instances = new Map(
    draft.instances.map((instance) => [String(instance.instanceId), instance]),
  );
  const queue = [...protectedIds];
  while (queue.length && protectedIds.size <= 512) {
    const parentId = queue.shift();
    if (!parentId) break;
    const parent = instances.get(parentId);
    if (!parent) continue;
    const definition = definitions.get(
      `${parent.definitionRef.id}@${parent.definitionRef.version}`,
    );
    if (!definition) continue;
    for (const slot of definition.slots) {
      if (slot.cardinality.minItems < 1) continue;
      const requiredChildren = slotPlacements(
        draft.placements,
        parentId,
        slot.slotId,
      ).slice(0, slot.cardinality.minItems);
      for (const placement of requiredChildren) {
        const childId = String(placement.childInstanceRef.id);
        if (protectedIds.has(childId)) continue;
        protectedIds.add(childId);
        queue.push(childId);
      }
    }
  }
  return protectedIds;
}

function createPlacement(input: {
  readonly placementId: string;
  readonly parentInstanceId: string;
  readonly childInstanceId: string;
  readonly slotId: AssetSlotId;
  readonly order: number;
}): AssetPlacement {
  return {
    schemaVersion: ASSET_PLACEMENT_SCHEMA_VERSION,
    placementId: normalizeAssetId(input.placementId),
    parentInstanceRef: instanceReference(input.parentInstanceId),
    childInstanceRef: instanceReference(input.childInstanceId),
    slotId: input.slotId,
    order: input.order,
    provenance: { sourceKind: "human-authored" },
  };
}

function instanceReference(instanceId: string): AssetReference {
  return { kind: "asset-instance", id: normalizeAssetId(instanceId) };
}

function nextSlotOrder(
  placements: readonly AssetPlacement[],
  parentInstanceId: string,
  slotId: AssetSlotId,
): number {
  return slotPlacements(placements, parentInstanceId, slotId).length;
}

function boundedInsertionOrder(
  requested: number | undefined,
  maximum: number,
): number {
  if (requested === undefined || !Number.isInteger(requested)) return maximum;
  return Math.max(0, Math.min(requested, maximum));
}

function slotPlacements(
  placements: readonly AssetPlacement[],
  parentInstanceId: string,
  slotId: AssetSlotId,
): readonly AssetPlacement[] {
  return placements
    .filter(
      (placement) =>
        String(placement.parentInstanceRef.id) === parentInstanceId &&
        placement.slotId === slotId,
    )
    .sort((left, right) => left.order - right.order);
}

function placementForChild(
  placements: readonly AssetPlacement[],
  instanceId: string,
): AssetPlacement | undefined {
  return placements.find(
    (placement) => String(placement.childInstanceRef.id) === instanceId,
  );
}

function findInstance(
  draft: SystemComposerDraft,
  instanceId: string,
): AssetInstance | undefined {
  return draft.instances.find(
    (instance) => String(instance.instanceId) === instanceId,
  );
}

function descendantsOf(
  placements: readonly AssetPlacement[],
  instanceId: string,
): Set<string> {
  const descendants = new Set<string>();
  const queue = [instanceId];
  while (queue.length && descendants.size <= 512) {
    const parent = queue.shift();
    for (const placement of placements) {
      if (String(placement.parentInstanceRef.id) !== parent) continue;
      const child = String(placement.childInstanceRef.id);
      if (descendants.has(child)) continue;
      descendants.add(child);
      queue.push(child);
    }
  }
  return descendants;
}

function normalizePlacementOrders(
  placements: readonly AssetPlacement[],
): readonly AssetPlacement[] {
  const groups = new Map<string, AssetPlacement[]>();
  for (const placement of placements) {
    const key = `${placement.parentInstanceRef.id}:${placement.slotId}`;
    groups.set(key, [...(groups.get(key) ?? []), placement]);
  }
  const normalized = new Map<string, AssetPlacement>();
  for (const group of groups.values()) {
    group
      .sort((left, right) => left.order - right.order)
      .forEach((placement, order) =>
        normalized.set(String(placement.placementId), { ...placement, order }),
      );
  }
  return placements.map(
    (placement) => normalized.get(String(placement.placementId)) ?? placement,
  );
}

function cloneDraft(draft: SystemComposerDraft): SystemComposerDraft {
  return JSON.parse(JSON.stringify(draft)) as SystemComposerDraft;
}

function safeId(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9.-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

const success = (value: SystemComposerDraft): SystemComposerDraftResult => ({
  ok: true,
  value,
});
const failure = (message: string): SystemComposerDraftResult => ({
  ok: false,
  message,
});
