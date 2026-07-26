import type {
  AssetInstance,
  AssetPlacement,
  AssetReference,
} from "../../../contracts/asset";
import { normalizeAssetId } from "../../../contracts/asset";
import type { SystemBuilderTemplateMaterialization } from "../../../contracts/system-builder";

import { createCanonicalSystemBuilderStructure } from "./create-canonical-system-builder-structure.service";
import { materializeReferenceSystemVisualHierarchy } from "./materialize-reference-system-visual-hierarchy.service";

export interface MaterializeReferenceSystemTemplateStructureInput {
  readonly systemId: string;
  readonly name: string;
  readonly actorId: string;
  readonly timestamp: string;
  readonly materialized: SystemBuilderTemplateMaterialization;
}

export function materializeReferenceSystemTemplateStructure(
  input: MaterializeReferenceSystemTemplateStructureInput,
): SystemBuilderTemplateMaterialization {
  const sourceRootRef = input.materialized.composition.rootInstanceRefs[0];
  if (!sourceRootRef) {
    throw new Error("A reference system requires a configured root instance.");
  }
  const seed = createCanonicalSystemBuilderStructure({
    systemId: input.systemId,
    compositionId: String(input.materialized.composition.compositionId),
    name: input.name,
    actorId: input.actorId,
    timestamp: input.timestamp,
    profile: "interactive",
  });
  const seedRootRef = seed.rootInstanceRefs[0];
  if (!seedRootRef) {
    throw new Error(
      "The required reference-system layout root is unavailable.",
    );
  }

  const seedInstances = seed.instances.filter(
    (instance) => String(instance.instanceId) !== String(seedRootRef.id),
  );
  const seedPlacements = seed.placements.map((placement) =>
    replacePlacementReference(placement, seedRootRef, sourceRootRef),
  );
  const hierarchy = materializeReferenceSystemVisualHierarchy({
    systemId: input.systemId,
    compositionId: String(input.materialized.composition.compositionId),
    actorId: input.actorId,
    timestamp: input.timestamp,
    instances: [...seedInstances, ...input.materialized.instances],
    placements: seedPlacements,
  });

  return {
    ...input.materialized,
    composition: {
      ...input.materialized.composition,
      rootInstanceRefs: [sourceRootRef],
      instanceRefs: hierarchy.instances.map(instanceReference),
      placementRefs: hierarchy.placements.map(placementReference),
    },
    instances: hierarchy.instances,
    structure: seed.structure,
    placements: hierarchy.placements,
  };
}

function replacePlacementReference(
  placement: AssetPlacement,
  from: AssetReference,
  to: AssetReference,
): AssetPlacement {
  return {
    ...placement,
    parentInstanceRef:
      String(placement.parentInstanceRef.id) === String(from.id)
        ? to
        : placement.parentInstanceRef,
    childInstanceRef:
      String(placement.childInstanceRef.id) === String(from.id)
        ? to
        : placement.childInstanceRef,
  };
}

function instanceReference(instance: AssetInstance): AssetReference {
  return {
    kind: "asset-instance",
    id: normalizeAssetId(String(instance.instanceId)),
  };
}

function placementReference(placement: AssetPlacement): AssetReference {
  return {
    kind: "asset-placement",
    id: normalizeAssetId(String(placement.placementId)),
  };
}
