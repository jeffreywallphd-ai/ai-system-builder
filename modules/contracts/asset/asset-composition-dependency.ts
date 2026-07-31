import type { RuntimeCapabilityId } from "../runtime";
import type { AssetConfigurationMetadata } from "./asset-configuration-value";
import type { AssetFamily } from "./asset-family";
import type { AssetReference } from "./asset-reference";
import type { AssetType } from "./asset-type";

export const ASSET_COMPOSITION_DEPENDENCY_KINDS = [
  "asset",
  "asset-type",
  "asset-family",
  "resource",
  "artifact",
  "runtime-capability",
  "external-repository-object",
  "configuration",
  "custom",
] as const;

export type AssetCompositionDependencyKind =
  (typeof ASSET_COMPOSITION_DEPENDENCY_KINDS)[number];

export interface AssetCompositionDependency {
  readonly dependencyId?: string;
  readonly dependencyKind: AssetCompositionDependencyKind;
  readonly required: boolean;
  readonly ref?: AssetReference;
  readonly assetType?: AssetType;
  readonly assetFamily?: AssetFamily;
  readonly runtimeCapabilityId?: RuntimeCapabilityId;
  readonly description?: string;
  readonly metadata?: AssetConfigurationMetadata;
}

export function isAssetCompositionDependencyKind(
  value: string,
): value is AssetCompositionDependencyKind {
  return ASSET_COMPOSITION_DEPENDENCY_KINDS.includes(
    value as AssetCompositionDependencyKind,
  );
}

export function normalizeAssetCompositionDependencyKind(
  value: string,
): AssetCompositionDependencyKind {
  const normalized = value.trim().toLowerCase();

  if (!isAssetCompositionDependencyKind(normalized)) {
    throw new Error(
      `Asset composition dependency kind must be one of ${ASSET_COMPOSITION_DEPENDENCY_KINDS.join(", ")}. Received "${value}".`,
    );
  }

  return normalized;
}
