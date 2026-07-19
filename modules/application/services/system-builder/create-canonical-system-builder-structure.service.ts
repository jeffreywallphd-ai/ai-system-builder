import type {
  AssetDefinition,
  AssetInstance,
  AssetPlacement,
  AssetReference,
} from "../../../contracts/asset";
import {
  ASSET_PLACEMENT_SCHEMA_VERSION,
  normalizeAssetId,
} from "../../../contracts/asset";
import type {
  SystemBuilderProfile,
  SystemBuilderStructure,
} from "../../../contracts/system-builder";
import { SYSTEM_BUILDER_STRUCTURE_SCHEMA_VERSION } from "../../../contracts/system-builder";
import {
  exactSystemFoundationDefinitionReference,
  readSystemFoundationLayoutPreset,
  SYSTEM_FOUNDATION_APPLICATION_LAYOUT_IDS,
  SYSTEM_FOUNDATION_CURRENT_PACK_VERSION,
  SYSTEM_FOUNDATION_PACK_V2_MANIFEST,
  SYSTEM_FOUNDATION_PAGE_LAYOUT_IDS,
} from "../asset-packs/system-packs";

export interface CreateCanonicalSystemBuilderStructureInput {
  readonly systemId: string;
  readonly compositionId: string;
  readonly name: string;
  readonly actorId: string;
  readonly timestamp: string;
  readonly profile: SystemBuilderProfile;
  readonly layoutPresetRef?: AssetReference;
}

export interface CanonicalSystemBuilderStructureSeed {
  readonly structure: SystemBuilderStructure;
  readonly instances: readonly AssetInstance[];
  readonly placements: readonly AssetPlacement[];
  readonly rootInstanceRefs: readonly AssetReference[];
  readonly instanceRefs: readonly AssetReference[];
  readonly placementRefs: readonly AssetReference[];
}

const DEFAULT_APPLICATION_LAYOUT_ID =
  "builtin.layout.application.standard" as const;
const DEFAULT_PAGE_LAYOUT_ID = "builtin.layout.page.single" as const;
const EMPTY_STATE_ID = "builtin.state.empty-state" as const;

export function createCanonicalSystemBuilderStructure(
  input: CreateCanonicalSystemBuilderStructureInput,
): CanonicalSystemBuilderStructureSeed {
  if (input.profile !== "interactive") {
    return {
      structure: {
        schemaVersion: SYSTEM_BUILDER_STRUCTURE_SCHEMA_VERSION,
        profile: input.profile,
      },
      instances: [],
      placements: [],
      rootInstanceRefs: [],
      instanceRefs: [],
      placementRefs: [],
    };
  }

  const layoutPresetRef = applicationLayoutReference(input.layoutPresetRef);
  const layoutPreset = readSystemFoundationLayoutPreset(
    String(layoutPresetRef.id),
  );
  if (!layoutPreset || layoutPreset.kind !== "application-shell") {
    throw safeError("The selected application layout is unavailable.");
  }

  const instances: AssetInstance[] = [];
  const placements: AssetPlacement[] = [];
  const root = addInstance(
    instances,
    input,
    "root",
    exactSystemFoundationDefinitionReference("builtin.system.system"),
    input.name,
  );
  const shell = addInstance(
    instances,
    input,
    "shell",
    layoutPresetRef,
    layoutPreset.displayName,
  );
  addPlacement(placements, input.systemId, root, "application-shell", shell, 0);

  const pagePresetRef = exactSystemFoundationDefinitionReference(
    DEFAULT_PAGE_LAYOUT_ID,
  );
  let pageIndex = 0;
  for (const slot of layoutPreset.slots) {
    if (
      slot.cardinality.minItems === 0 ||
      !slot.acceptedDefinitionRefs?.some((reference) =>
        SYSTEM_FOUNDATION_PAGE_LAYOUT_IDS.includes(
          String(
            reference.id,
          ) as (typeof SYSTEM_FOUNDATION_PAGE_LAYOUT_IDS)[number],
        ),
      )
    ) {
      continue;
    }
    for (let order = 0; order < slot.cardinality.minItems; order += 1) {
      pageIndex += 1;
      const page = addInstance(
        instances,
        input,
        `page-${pageIndex}`,
        pagePresetRef,
        pageIndex === 1 ? "Main page" : `Page ${pageIndex}`,
      );
      addPlacement(placements, input.systemId, shell, slot.slotId, page, order);
      addRequiredPageContent(instances, placements, input, page, pageIndex);
    }
  }

  const rootInstanceRefs = [instanceReference(root)];
  return {
    structure: {
      schemaVersion: SYSTEM_BUILDER_STRUCTURE_SCHEMA_VERSION,
      profile: "interactive",
      layoutPresetRef,
    },
    instances,
    placements,
    rootInstanceRefs,
    instanceRefs: instances.map(instanceReference),
    placementRefs: placements.map(placementReference),
  };
}

function addRequiredPageContent(
  instances: AssetInstance[],
  placements: AssetPlacement[],
  input: CreateCanonicalSystemBuilderStructureInput,
  page: AssetInstance,
  pageIndex: number,
): void {
  const pagePreset = readSystemFoundationLayoutPreset(DEFAULT_PAGE_LAYOUT_ID);
  if (!pagePreset) throw safeError("The default page layout is unavailable.");
  let contentIndex = 0;
  for (const slot of pagePreset.slots) {
    for (let order = 0; order < slot.cardinality.minItems; order += 1) {
      contentIndex += 1;
      const content = addInstance(
        instances,
        input,
        `page-${pageIndex}-content-${contentIndex}`,
        exactSystemFoundationDefinitionReference(EMPTY_STATE_ID),
        "Empty content",
      );
      addPlacement(
        placements,
        input.systemId,
        page,
        slot.slotId,
        content,
        order,
      );
    }
  }
}

function applicationLayoutReference(
  requested: AssetReference | undefined,
): AssetReference {
  const reference =
    requested ??
    exactSystemFoundationDefinitionReference(DEFAULT_APPLICATION_LAYOUT_ID);
  if (
    reference.kind !== "asset-definition-version" ||
    reference.version !== SYSTEM_FOUNDATION_CURRENT_PACK_VERSION ||
    !SYSTEM_FOUNDATION_APPLICATION_LAYOUT_IDS.includes(
      String(
        reference.id,
      ) as (typeof SYSTEM_FOUNDATION_APPLICATION_LAYOUT_IDS)[number],
    )
  ) {
    throw safeError(
      "Interactive systems require an exact supported Foundation application layout.",
    );
  }
  return exactSystemFoundationDefinitionReference(String(reference.id));
}

function addInstance(
  instances: AssetInstance[],
  input: CreateCanonicalSystemBuilderStructureInput,
  suffix: string,
  definitionRef: AssetReference,
  displayName: string,
): AssetInstance {
  const definition = exactDefinition(definitionRef);
  const instance: AssetInstance = {
    instanceId: normalizeAssetId(`${input.systemId}.${suffix}`),
    definitionRef,
    displayName,
    lifecycleStatus: "draft",
    ...(definition.defaultConfiguration
      ? { selectedConfiguration: clone(definition.defaultConfiguration) }
      : {}),
    parentCompositionRef: {
      kind: "asset-composition",
      id: normalizeAssetId(input.compositionId),
    },
    provenance: {
      sourceKind: "human-authored",
      createdAt: input.timestamp,
      createdBy: input.actorId,
    },
  };
  instances.push(instance);
  return instance;
}

function addPlacement(
  placements: AssetPlacement[],
  systemId: string,
  parent: AssetInstance,
  slotId: string,
  child: AssetInstance,
  order: number,
): void {
  placements.push({
    schemaVersion: ASSET_PLACEMENT_SCHEMA_VERSION,
    placementId: normalizeAssetId(
      `${systemId}.placement-${placements.length + 1}`,
    ),
    parentInstanceRef: instanceReference(parent),
    slotId: slotId as AssetPlacement["slotId"],
    childInstanceRef: instanceReference(child),
    order,
  });
}

function exactDefinition(reference: AssetReference): AssetDefinition {
  const definition = SYSTEM_FOUNDATION_PACK_V2_MANIFEST.assets.find(
    (entry) =>
      String(entry.definition.definitionId) === String(reference.id) &&
      entry.definition.version === reference.version,
  )?.definition;
  if (!definition) {
    throw safeError("A required System Foundation definition is unavailable.");
  }
  return definition;
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

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function safeError(message: string): Error {
  const error = new Error(message);
  error.stack = undefined;
  return error;
}
