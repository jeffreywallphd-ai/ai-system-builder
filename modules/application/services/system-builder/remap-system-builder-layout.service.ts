import type {
  AssetDefinition,
  AssetInstance,
  AssetPlacement,
  AssetReference,
} from "../../../contracts/asset";
import {
  normalizeAssetId,
  normalizeAssetPlacements,
} from "../../../contracts/asset";
import type {
  PreviewSystemBuilderLayoutChangeCommand,
  SystemBuilderLayoutChangeItem,
  SystemBuilderLayoutChangePreview,
} from "../../../contracts/system-builder";
import { normalizeSystemBuilderStructure } from "../../../contracts/system-builder";
import type { AssetDefinitionVersionReaderPort } from "../../ports/asset-implementation";
import {
  readSystemFoundationLayoutPreset,
  SYSTEM_FOUNDATION_CURRENT_PACK_VERSION,
  SYSTEM_FOUNDATION_PACK_V2_MANIFEST,
} from "../asset-packs/system-packs";
import { createCanonicalSystemBuilderStructure } from "./create-canonical-system-builder-structure.service";
import { systemBuilderSlotAcceptsDefinition } from "./validate-system-builder-structure.service";

export async function remapSystemBuilderLayout(
  command: PreviewSystemBuilderLayoutChangeCommand,
  definitions: AssetDefinitionVersionReaderPort,
  timestamp = new Date().toISOString(),
): Promise<Omit<SystemBuilderLayoutChangePreview, "validationIssues">> {
  if (!command.structure) {
    return materializeLegacySystemBuilderLayout(command, timestamp);
  }
  const sourceStructure = normalizeSystemBuilderStructure(command.structure);
  const sourceLayoutPresetRef = sourceStructure.layoutPresetRef;
  if (!sourceLayoutPresetRef || sourceStructure.profile !== "interactive") {
    throw safeError(
      "Only interactive systems with a predefined layout can change layouts.",
    );
  }
  const sourcePreset = readSystemFoundationLayoutPreset(
    String(sourceLayoutPresetRef.id),
  );
  if (!sourcePreset || sourcePreset.kind !== "application-shell") {
    throw safeError("The current application layout is unavailable.");
  }
  const targetLayoutPresetRef = exactApplicationLayout(
    command.targetLayoutPresetRef,
  );
  const targetPreset = readSystemFoundationLayoutPreset(
    String(targetLayoutPresetRef.id),
  );
  const targetDefinition = foundationDefinition(targetLayoutPresetRef);
  if (!targetPreset || targetPreset.kind !== "application-shell") {
    throw safeError("The selected application layout is unavailable.");
  }

  const instancesById = new Map(
    command.instances.map((instance) => [
      String(instance.instanceId),
      instance,
    ]),
  );
  const rootIds = new Set(
    command.composition.rootInstanceRefs.map((reference) =>
      String(reference.id),
    ),
  );
  const sourcePlacements = command.placements ?? [];
  const shellPlacement = sourcePlacements.find(
    (placement) =>
      rootIds.has(String(placement.parentInstanceRef.id)) &&
      String(placement.slotId) === "application-shell",
  );
  const shell = shellPlacement
    ? instancesById.get(String(shellPlacement.childInstanceRef.id))
    : undefined;
  if (!shell) {
    throw safeError("The current application shell could not be identified.");
  }

  const directPlacements = sourcePlacements
    .filter(
      (placement) =>
        String(placement.parentInstanceRef.id) === String(shell.instanceId),
    )
    .sort((left, right) => {
      const leftSlot = sourcePreset.sourceOrder.indexOf(String(left.slotId));
      const rightSlot = sourcePreset.sourceOrder.indexOf(String(right.slotId));
      return (
        safeSourceOrder(leftSlot) - safeSourceOrder(rightSlot) ||
        left.order - right.order ||
        String(left.placementId).localeCompare(String(right.placementId))
      );
    });
  const definitionsByKey = await loadDefinitions(
    directPlacements,
    instancesById,
    definitions,
  );
  const targetSlots = targetPreset.sourceOrder.flatMap((slotId) => {
    const slot = targetDefinition.slots?.find(
      (candidate) => String(candidate.slotId) === slotId,
    );
    return slot ? [slot] : [];
  });
  const counts = new Map<string, number>();
  const changes: SystemBuilderLayoutChangeItem[] = [];
  const remapped: AssetPlacement[] = [];
  const unassignedInstanceRefs: AssetReference[] = [];

  for (const placement of directPlacements) {
    const child = instancesById.get(String(placement.childInstanceRef.id));
    const childDefinition = child
      ? definitionsByKey.get(definitionKey(child.definitionRef))
      : undefined;
    const compatibleSlot = childDefinition
      ? chooseTargetSlot(
          String(placement.slotId),
          targetSlots,
          counts,
          childDefinition,
        )
      : undefined;
    if (!compatibleSlot) {
      unassignedInstanceRefs.push(placement.childInstanceRef);
      changes.push({
        instanceRef: placement.childInstanceRef,
        disposition: "unassigned",
        fromSlotId: String(placement.slotId),
      });
      continue;
    }
    const slotId = String(compatibleSlot.slotId);
    const order = counts.get(slotId) ?? 0;
    counts.set(slotId, order + 1);
    remapped.push({ ...placement, slotId: compatibleSlot.slotId, order });
    changes.push({
      instanceRef: placement.childInstanceRef,
      disposition: String(placement.slotId) === slotId ? "preserved" : "moved",
      fromSlotId: String(placement.slotId),
      toSlotId: slotId,
    });
  }

  const placements = normalizeAssetPlacements([
    ...sourcePlacements.filter(
      (placement) =>
        String(placement.parentInstanceRef.id) !== String(shell.instanceId),
    ),
    ...remapped,
  ]);
  const instances = command.instances.map((instance) =>
    String(instance.instanceId) === String(shell.instanceId)
      ? { ...instance, definitionRef: targetLayoutPresetRef }
      : instance,
  );
  const structure = {
    ...sourceStructure,
    layoutPresetRef: targetLayoutPresetRef,
  };
  const composition = {
    ...command.composition,
    instanceRefs: instances.map(instanceReference),
    bindingRefs: command.bindings.map((binding) => ({
      kind: "asset-binding" as const,
      id: normalizeAssetId(String(binding.bindingId)),
    })),
    placementRefs: placements.map((placement) => ({
      kind: "asset-placement" as const,
      id: normalizeAssetId(String(placement.placementId)),
    })),
  };
  return {
    sourceLayoutPresetRef,
    targetLayoutPresetRef,
    composition,
    structure,
    instances,
    bindings: command.bindings,
    placements,
    changes,
    unassignedInstanceRefs,
  };
}

function materializeLegacySystemBuilderLayout(
  command: PreviewSystemBuilderLayoutChangeCommand,
  timestamp: string,
): Omit<SystemBuilderLayoutChangePreview, "validationIssues"> {
  const targetLayoutPresetRef = exactApplicationLayout(
    command.targetLayoutPresetRef,
  );
  if (command.composition.rootInstanceRefs.length !== 1) {
    throw safeError(
      "Choose a single-root reference system before selecting a visual layout.",
    );
  }
  const legacyRootId = String(command.composition.rootInstanceRefs[0]!.id);
  const legacyRoot = command.instances.find(
    (instance) => String(instance.instanceId) === legacyRootId,
  );
  if (!legacyRoot) {
    throw safeError("The reference system root could not be identified.");
  }

  const seed = createCanonicalSystemBuilderStructure({
    systemId: String(command.systemId),
    compositionId: String(command.composition.compositionId),
    name: command.composition.displayName,
    actorId: command.actorId,
    timestamp,
    profile: "interactive",
    layoutPresetRef: targetLayoutPresetRef,
  });
  const canonicalRootId = String(seed.rootInstanceRefs[0]!.id);
  const canonicalRoot = seed.instances.find(
    (instance) => String(instance.instanceId) === canonicalRootId,
  );
  if (!canonicalRoot) {
    throw safeError("The protected Foundation root could not be created.");
  }
  const addedInstances = seed.instances.filter(
    (instance) => String(instance.instanceId) !== canonicalRootId,
  );
  const existingIds = new Set(
    command.instances.map((instance) => String(instance.instanceId)),
  );
  if (
    addedInstances.some((instance) =>
      existingIds.has(String(instance.instanceId)),
    )
  ) {
    throw safeError(
      "The selected layout conflicts with an existing reference-system instance.",
    );
  }

  const root: AssetInstance = {
    ...legacyRoot,
    definitionRef: canonicalRoot.definitionRef,
  };
  const instances = [
    ...command.instances.map((instance) =>
      String(instance.instanceId) === legacyRootId ? root : instance,
    ),
    ...addedInstances,
  ];
  const placements = seed.placements.map((placement) => ({
    ...placement,
    parentInstanceRef:
      String(placement.parentInstanceRef.id) === canonicalRootId
        ? instanceReference(root)
        : placement.parentInstanceRef,
  }));
  const unassignedInstanceRefs = command.instances
    .filter((instance) => String(instance.instanceId) !== legacyRootId)
    .map(instanceReference);
  const composition = {
    ...command.composition,
    rootInstanceRefs: [instanceReference(root)],
    instanceRefs: instances.map(instanceReference),
    bindingRefs: command.bindings.map((binding) => ({
      kind: "asset-binding" as const,
      id: normalizeAssetId(String(binding.bindingId)),
    })),
    placementRefs: placements.map((placement) => ({
      kind: "asset-placement" as const,
      id: normalizeAssetId(String(placement.placementId)),
    })),
  };
  return {
    targetLayoutPresetRef,
    composition,
    structure: seed.structure,
    instances,
    bindings: command.bindings,
    placements,
    changes: unassignedInstanceRefs.map((instanceRef) => ({
      instanceRef,
      disposition: "unassigned" as const,
      fromSlotId: "legacy-flat",
    })),
    unassignedInstanceRefs,
  };
}

async function loadDefinitions(
  placements: readonly AssetPlacement[],
  instancesById: ReadonlyMap<string, AssetInstance>,
  definitions: AssetDefinitionVersionReaderPort,
): Promise<ReadonlyMap<string, AssetDefinition>> {
  const result = new Map<string, AssetDefinition>();
  for (const placement of placements) {
    const instance = instancesById.get(String(placement.childInstanceRef.id));
    if (!instance) continue;
    const key = definitionKey(instance.definitionRef);
    if (result.has(key)) continue;
    const definition = await definitions.readExactDefinition(
      instance.definitionRef,
    );
    if (definition) result.set(key, definition);
  }
  return result;
}

function chooseTargetSlot(
  currentSlotId: string,
  slots: NonNullable<AssetDefinition["slots"]>,
  counts: ReadonlyMap<string, number>,
  child: AssetDefinition,
): NonNullable<AssetDefinition["slots"]>[number] | undefined {
  return [...slots]
    .sort((left, right) => {
      const leftSame = String(left.slotId) === currentSlotId ? 0 : 1;
      const rightSame = String(right.slotId) === currentSlotId ? 0 : 1;
      return leftSame - rightSame;
    })
    .find(
      (slot) =>
        (counts.get(String(slot.slotId)) ?? 0) < slot.cardinality.maxItems &&
        systemBuilderSlotAcceptsDefinition(slot, child),
    );
}

function exactApplicationLayout(reference: AssetReference): AssetReference {
  const preset = readSystemFoundationLayoutPreset(String(reference.id));
  if (
    reference.kind !== "asset-definition-version" ||
    reference.version !== SYSTEM_FOUNDATION_CURRENT_PACK_VERSION ||
    preset?.kind !== "application-shell"
  ) {
    throw safeError(
      "Select an exact supported System Foundation application layout.",
    );
  }
  foundationDefinition(reference);
  return reference;
}

function foundationDefinition(reference: AssetReference): AssetDefinition {
  const definition = SYSTEM_FOUNDATION_PACK_V2_MANIFEST.assets.find(
    (entry) =>
      String(entry.definition.definitionId) === String(reference.id) &&
      entry.definition.version === reference.version,
  )?.definition;
  if (!definition)
    throw safeError("The selected application layout is unavailable.");
  return definition;
}

function definitionKey(reference: AssetReference): string {
  return `${reference.id}@${reference.version ?? ""}`;
}

function safeSourceOrder(index: number): number {
  return index < 0 ? Number.MAX_SAFE_INTEGER : index;
}

function instanceReference(instance: AssetInstance): AssetReference {
  return {
    kind: "asset-instance",
    id: normalizeAssetId(String(instance.instanceId)),
  };
}

function safeError(message: string): Error {
  const error = new Error(message);
  error.stack = undefined;
  return error;
}
