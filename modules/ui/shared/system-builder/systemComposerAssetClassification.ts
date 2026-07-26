import type {
  AssetInstance,
  AssetPlacement,
  AssetReference,
} from "../../../contracts/asset";
import type { SystemBuilderComposerAsset } from "../../../contracts/system-builder";

const VISUAL_ASSET_TYPES = new Set(["feature", "page", "ui-component"]);
const VISUAL_CONTAINER_SYSTEM_TYPES = new Set(["system", "subsystem"]);
const TRUSTED_REFERENCE_VISUAL_FACADE_IDS = new Set([
  "conversation.basic-assistant-system",
  "conversation.user-message-input",
  "conversation.assistant-text-response-output",
]);

export interface SystemComposerUnplacedInstanceGroups {
  readonly unplacedInstances: readonly AssetInstance[];
  readonly unassignedVisualInstances: readonly AssetInstance[];
  readonly systemResourceInstances: readonly AssetInstance[];
}

export function systemComposerAssetForInstance(
  instance: AssetInstance | undefined,
  catalog: readonly SystemBuilderComposerAsset[],
): SystemBuilderComposerAsset | undefined {
  if (!instance) return undefined;
  return catalog.find(
    (asset) =>
      asset.definitionId === String(instance.definitionRef.id) &&
      asset.version === instance.definitionRef.version,
  );
}

export function isSystemComposerVisualInstance(
  instance: AssetInstance,
  catalog: readonly SystemBuilderComposerAsset[],
): boolean {
  const asset = systemComposerAssetForInstance(instance, catalog);
  return Boolean(asset && isSystemComposerVisualAsset(asset));
}

export function isSystemComposerVisualAsset(
  asset: SystemBuilderComposerAsset,
): boolean {
  if (asset.layoutRole || asset.definitionId === "builtin.system.system") {
    return false;
  }
  if (VISUAL_ASSET_TYPES.has(asset.assetType)) return true;
  if (
    TRUSTED_REFERENCE_VISUAL_FACADE_IDS.has(asset.definitionId) &&
    asset.implementationAvailability === "trusted-system-foundation" &&
    asset.previewAvailability === "trusted-declarative"
  ) {
    return true;
  }
  return (
    VISUAL_CONTAINER_SYSTEM_TYPES.has(asset.assetType) &&
    asset.slots.length > 0 &&
    asset.implementationAvailability === "trusted-system-foundation" &&
    asset.previewAvailability === "trusted-declarative"
  );
}

export function groupSystemComposerUnplacedInstances(input: {
  readonly instances: readonly AssetInstance[];
  readonly placements: readonly AssetPlacement[];
  readonly rootInstanceRefs: readonly AssetReference[];
  readonly catalog: readonly SystemBuilderComposerAsset[];
}): SystemComposerUnplacedInstanceGroups {
  const roots = new Set(
    input.rootInstanceRefs.map((reference) => String(reference.id)),
  );
  const placed = new Set(
    input.placements.map((placement) => String(placement.childInstanceRef.id)),
  );
  const unplacedInstances = input.instances.filter(
    (instance) =>
      !roots.has(String(instance.instanceId)) &&
      !placed.has(String(instance.instanceId)),
  );
  const unassignedVisualInstances: AssetInstance[] = [];
  const systemResourceInstances: AssetInstance[] = [];
  for (const instance of unplacedInstances) {
    if (isSystemComposerVisualInstance(instance, input.catalog)) {
      unassignedVisualInstances.push(instance);
    } else {
      systemResourceInstances.push(instance);
    }
  }
  return {
    unplacedInstances,
    unassignedVisualInstances,
    systemResourceInstances,
  };
}
