import type {
  AssetDefinition,
  AssetInstance,
  AssetPlacement,
  AssetReference,
  AssetSlotDefinition,
  AssetValidationIssue,
} from "../../../contracts/asset";
import {
  MAX_ASSET_PLACEMENT_DEPTH,
  normalizeAssetPlacements,
} from "../../../contracts/asset";
import type { SystemBuilderRevision } from "../../../contracts/system-builder";
import {
  classifySystemBuilderStructure,
  normalizeSystemBuilderStructure,
} from "../../../contracts/system-builder";
import {
  SYSTEM_FOUNDATION_APPLICATION_LAYOUT_IDS,
  SYSTEM_FOUNDATION_CURRENT_PACK_VERSION,
} from "../asset-packs/system-packs";

type StructureRevision = Pick<
  SystemBuilderRevision,
  "composition" | "instances" | "structure" | "placements"
>;

export function validateSystemBuilderStructure(
  revision: StructureRevision,
  definitionsById: ReadonlyMap<string, AssetDefinition>,
  instancesById: ReadonlyMap<string, AssetInstance>,
  issues: AssetValidationIssue[],
): void {
  let classification;
  try {
    classification = classifySystemBuilderStructure(revision);
  } catch {
    addIssue(
      issues,
      "Slot-based revisions must declare a supported structure descriptor.",
      ["structure"],
    );
    return;
  }
  if (classification.status === "legacy-flat") return;

  let structure;
  let placements: readonly AssetPlacement[];
  try {
    structure = normalizeSystemBuilderStructure(revision.structure!);
    placements = normalizeAssetPlacements(revision.placements);
  } catch {
    addIssue(
      issues,
      "System placements contain an unsupported or unsafe value.",
      ["placements"],
    );
    return;
  }

  const placementsById = uniquePlacementsById(placements);
  validatePlacementMembership(
    revision.composition.placementRefs ?? [],
    placementsById,
    issues,
  );
  validatePlacementEndpoints(placements, instancesById, issues);
  validatePlacementCoverage(
    revision.composition.rootInstanceRefs,
    revision.instances,
    placements,
    issues,
  );
  validateSlotsAndCompatibility(
    placements,
    instancesById,
    definitionsById,
    issues,
  );
  validatePlacementGraph(placements, instancesById, issues);

  if (structure.profile === "interactive") {
    validateInteractiveRoot(
      revision,
      structure.layoutPresetRef,
      placements,
      instancesById,
      definitionsById,
      issues,
    );
  }
}

function validateInteractiveRoot(
  revision: StructureRevision,
  layoutPresetRef: AssetReference | undefined,
  placements: readonly AssetPlacement[],
  instancesById: ReadonlyMap<string, AssetInstance>,
  definitionsById: ReadonlyMap<string, AssetDefinition>,
  issues: AssetValidationIssue[],
): void {
  if (revision.composition.rootInstanceRefs.length !== 1) {
    addIssue(
      issues,
      "Interactive systems require exactly one protected system root.",
      ["composition", "rootInstanceRefs"],
    );
    return;
  }
  const rootReference = revision.composition.rootInstanceRefs[0]!;
  const root = instancesById.get(String(rootReference.id));
  if (rootReference.kind !== "asset-instance" || !root) {
    addIssue(
      issues,
      "The interactive system root must resolve to an instance in this revision.",
      ["composition", "rootInstanceRefs", "0"],
    );
    return;
  }
  const rootDefinition = definitionsById.get(String(root.definitionRef.id));
  if (!rootDefinition || !isFoundationSystemRoot(rootDefinition)) {
    addIssue(
      issues,
      "The interactive root must use or explicitly derive from builtin.system.system@2.0.0.",
      ["instances", String(root.instanceId), "definitionRef"],
    );
  }
  if (!isSupportedApplicationLayoutReference(layoutPresetRef)) {
    addIssue(
      issues,
      "Interactive systems require an exact supported Foundation application layout.",
      ["structure", "layoutPresetRef"],
    );
    return;
  }
  const shellPlacements = placements.filter(
    (placement) =>
      String(placement.parentInstanceRef.id) === String(root.instanceId) &&
      placement.slotId === "application-shell",
  );
  if (shellPlacements.length !== 1) {
    addIssue(
      issues,
      "The protected system root requires exactly one application shell.",
      ["placements"],
    );
    return;
  }
  const shell = instancesById.get(
    String(shellPlacements[0]!.childInstanceRef.id),
  );
  if (!shell || !sameExactReference(shell.definitionRef, layoutPresetRef!)) {
    addIssue(
      issues,
      "The root application shell must match the revision layout preset.",
      ["structure", "layoutPresetRef"],
    );
  }
}

function validatePlacementMembership(
  references: readonly AssetReference[],
  placementsById: ReadonlyMap<string, AssetPlacement>,
  issues: AssetValidationIssue[],
): void {
  const referenced = new Set<string>();
  references.forEach((reference, index) => {
    const id = String(reference.id);
    if (reference.kind !== "asset-placement" || !placementsById.has(id)) {
      addIssue(
        issues,
        "Composition placement references must resolve inside the saved revision.",
        ["composition", "placementRefs", String(index)],
      );
      return;
    }
    if (referenced.has(id)) {
      addIssue(issues, "Composition placement references must be unique.", [
        "composition",
        "placementRefs",
        String(index),
      ]);
    }
    referenced.add(id);
  });
  for (const id of placementsById.keys()) {
    if (!referenced.has(id)) {
      addIssue(
        issues,
        "Every saved placement must be referenced by its composition.",
        ["placements", id],
      );
    }
  }
}

function validatePlacementEndpoints(
  placements: readonly AssetPlacement[],
  instancesById: ReadonlyMap<string, AssetInstance>,
  issues: AssetValidationIssue[],
): void {
  placements.forEach((placement, index) => {
    for (const [side, reference] of [
      ["parentInstanceRef", placement.parentInstanceRef],
      ["childInstanceRef", placement.childInstanceRef],
    ] as const) {
      if (
        reference.kind !== "asset-instance" ||
        !instancesById.has(String(reference.id))
      ) {
        addIssue(
          issues,
          "System placements must reference instances in the same revision.",
          ["placements", String(index), side],
        );
      }
    }
  });
}

function validatePlacementCoverage(
  rootReferences: readonly AssetReference[],
  instances: readonly AssetInstance[],
  placements: readonly AssetPlacement[],
  issues: AssetValidationIssue[],
): void {
  const rootIds = new Set(
    rootReferences.map((reference) => String(reference.id)),
  );
  const childIds = new Set(
    placements.map((placement) => String(placement.childInstanceRef.id)),
  );
  for (const rootId of rootIds) {
    if (childIds.has(rootId)) {
      addIssue(issues, "A composition root cannot also be a placement child.", [
        "composition",
        "rootInstanceRefs",
      ]);
    }
  }
  for (const instance of instances) {
    const id = String(instance.instanceId);
    if (!rootIds.has(id) && !childIds.has(id)) {
      addIssue(
        issues,
        "Every non-root instance must have exactly one placement parent.",
        ["instances", id],
      );
    }
  }
}

function validateSlotsAndCompatibility(
  placements: readonly AssetPlacement[],
  instancesById: ReadonlyMap<string, AssetInstance>,
  definitionsById: ReadonlyMap<string, AssetDefinition>,
  issues: AssetValidationIssue[],
): void {
  const grouped = new Map<string, AssetPlacement[]>();
  for (const placement of placements) {
    const key = `${placement.parentInstanceRef.id}:${placement.slotId}`;
    const group = grouped.get(key) ?? [];
    group.push(placement);
    grouped.set(key, group);
  }

  for (const parent of instancesById.values()) {
    const definition = definitionsById.get(String(parent.definitionRef.id));
    if (!definition) continue;
    const slots = new Map(
      (definition.slots ?? []).map((slot) => [String(slot.slotId), slot]),
    );
    for (const slot of slots.values()) {
      const group =
        grouped.get(`${parent.instanceId}:${String(slot.slotId)}`) ?? [];
      validateSlotCardinality(parent, slot, group.length, issues);
      validateContiguousOrder(parent, slot, group, issues);
    }
    for (const placement of placements.filter(
      (candidate) =>
        String(candidate.parentInstanceRef.id) === String(parent.instanceId),
    )) {
      const slot = slots.get(String(placement.slotId));
      if (!slot) {
        addIssue(
          issues,
          "A placement targets a slot that the parent definition does not declare.",
          ["placements", String(placement.placementId), "slotId"],
        );
        continue;
      }
      const child = instancesById.get(String(placement.childInstanceRef.id));
      const childDefinition = child
        ? definitionsById.get(String(child.definitionRef.id))
        : undefined;
      if (
        childDefinition &&
        !systemBuilderSlotAcceptsDefinition(slot, childDefinition)
      ) {
        addIssue(
          issues,
          "The selected child definition is not compatible with this slot.",
          ["placements", String(placement.placementId), "childInstanceRef"],
        );
      }
    }
  }
}

function validateSlotCardinality(
  parent: AssetInstance,
  slot: AssetSlotDefinition,
  count: number,
  issues: AssetValidationIssue[],
): void {
  if (count < slot.cardinality.minItems || count > slot.cardinality.maxItems) {
    addIssue(
      issues,
      `Slot "${slot.slotId}" requires ${slot.cardinality.minItems} to ${slot.cardinality.maxItems} children; found ${count}.`,
      ["instances", String(parent.instanceId), "slots", String(slot.slotId)],
    );
  }
}

function validateContiguousOrder(
  parent: AssetInstance,
  slot: AssetSlotDefinition,
  placements: readonly AssetPlacement[],
  issues: AssetValidationIssue[],
): void {
  const ordered = [...placements].sort(
    (left, right) => left.order - right.order,
  );
  if (ordered.some((placement, index) => placement.order !== index)) {
    addIssue(
      issues,
      "Placement order must be contiguous from zero within each parent slot.",
      ["instances", String(parent.instanceId), "slots", String(slot.slotId)],
    );
  }
}

function validatePlacementGraph(
  placements: readonly AssetPlacement[],
  instancesById: ReadonlyMap<string, AssetInstance>,
  issues: AssetValidationIssue[],
): void {
  const childrenByParent = new Map<string, string[]>();
  for (const placement of placements) {
    const parentId = String(placement.parentInstanceRef.id);
    const children = childrenByParent.get(parentId) ?? [];
    children.push(String(placement.childInstanceRef.id));
    childrenByParent.set(parentId, children);
  }
  let cycle = false;
  let excessiveDepth = false;
  const visit = (
    id: string,
    depth: number,
    path: ReadonlySet<string>,
  ): void => {
    if (depth > MAX_ASSET_PLACEMENT_DEPTH) excessiveDepth = true;
    if (path.has(id)) {
      cycle = true;
      return;
    }
    const nextPath = new Set(path);
    nextPath.add(id);
    for (const child of childrenByParent.get(id) ?? []) {
      visit(child, depth + 1, nextPath);
    }
  };
  for (const id of instancesById.keys()) visit(id, 0, new Set());
  if (cycle) {
    addIssue(
      issues,
      "System placements must not contain a containment cycle.",
      ["placements"],
    );
  }
  if (excessiveDepth) {
    addIssue(
      issues,
      `System placement depth must not exceed ${MAX_ASSET_PLACEMENT_DEPTH}.`,
      ["placements"],
    );
  }
}

export function systemBuilderSlotAcceptsDefinition(
  slot: AssetSlotDefinition,
  child: AssetDefinition,
): boolean {
  return (
    slot.acceptedAssetTypes?.includes(child.assetType) === true ||
    slot.acceptedAssetFamilies?.includes(child.assetFamily) === true ||
    slot.acceptedDefinitionRefs?.some(
      (reference) =>
        String(reference.id) === String(child.definitionId) &&
        reference.version === child.version,
    ) === true
  );
}

function isFoundationSystemRoot(definition: AssetDefinition): boolean {
  if (
    String(definition.definitionId) === "builtin.system.system" &&
    definition.version === SYSTEM_FOUNDATION_CURRENT_PACK_VERSION
  ) {
    return true;
  }
  return (
    definition.provenance.derivedFromRefs?.some(
      (reference) =>
        reference.kind === "asset-definition-version" &&
        String(reference.id) === "builtin.system.system" &&
        reference.version === SYSTEM_FOUNDATION_CURRENT_PACK_VERSION,
    ) === true
  );
}

function isSupportedApplicationLayoutReference(
  reference: AssetReference | undefined,
): boolean {
  return (
    reference?.kind === "asset-definition-version" &&
    reference.version === SYSTEM_FOUNDATION_CURRENT_PACK_VERSION &&
    SYSTEM_FOUNDATION_APPLICATION_LAYOUT_IDS.includes(
      String(
        reference.id,
      ) as (typeof SYSTEM_FOUNDATION_APPLICATION_LAYOUT_IDS)[number],
    )
  );
}

function sameExactReference(
  left: AssetReference,
  right: AssetReference,
): boolean {
  return (
    left.kind === "asset-definition-version" &&
    right.kind === "asset-definition-version" &&
    String(left.id) === String(right.id) &&
    left.version === right.version
  );
}

function uniquePlacementsById(
  placements: readonly AssetPlacement[],
): ReadonlyMap<string, AssetPlacement> {
  return new Map(
    placements.map((placement) => [String(placement.placementId), placement]),
  );
}

function addIssue(
  issues: AssetValidationIssue[],
  message: string,
  path: readonly string[],
): void {
  issues.push({ severity: "error", category: "composition", message, path });
}
