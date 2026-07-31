import type {
  AssetMetadata,
  AssetPackAssetEntry,
  AssetPackCompatibility,
  AssetPackDependency,
  AssetPackId,
  AssetPackLicense,
  AssetPackManifest,
  AssetPackOverrideRule,
  AssetPackSourceKind,
  AssetPackTrustStatus,
  AssetPackVersion,
  AssetSourceLayer,
} from "../../../contracts/asset";

import {
  SYSTEM_FOUNDATION_PACK_CATEGORIES,
  SYSTEM_FOUNDATION_PACK_CATEGORY_IDS,
} from "./system-packs/system-foundation-pack.categories";
import {
  SYSTEM_FOUNDATION_PACK_COMPATIBILITY_SCHEMA_VERSION,
  SYSTEM_FOUNDATION_PACK_DISPLAY_NAME,
  SYSTEM_FOUNDATION_PACK_ID,
  SYSTEM_FOUNDATION_PACK_SCHEMA_VERSION,
  SYSTEM_FOUNDATION_PACK_SOURCE_KIND,
  SYSTEM_FOUNDATION_PACK_SOURCE_LAYER,
  SYSTEM_FOUNDATION_PACK_TRUST_STATUS,
  SYSTEM_FOUNDATION_PACK_VERSION,
} from "./system-packs/system-foundation-pack.constants";

export interface CreateAssetPackManifestInput {
  readonly schemaVersion: string;
  readonly packId: AssetPackId;
  readonly version: AssetPackVersion;
  readonly displayName: string;
  readonly description?: string;
  readonly publisher?: string;
  readonly license?: AssetPackLicense;
  readonly sourceKind: AssetPackSourceKind;
  readonly sourceLayer: AssetSourceLayer;
  readonly trustStatus: AssetPackTrustStatus;
  readonly compatibility?: AssetPackCompatibility;
  readonly dependencies?: readonly AssetPackDependency[];
  readonly assets?: readonly AssetPackAssetEntry[];
  readonly overrideRules?: readonly AssetPackOverrideRule[];
  readonly tags?: readonly string[];
  readonly categories?: readonly string[];
  readonly checksum?: string;
  readonly createdAt?: string;
  readonly updatedAt?: string;
  readonly metadata?: AssetMetadata;
}

export function createAssetPackManifest(
  input: CreateAssetPackManifestInput,
): AssetPackManifest {
  return {
    schemaVersion: input.schemaVersion,
    packId: input.packId,
    version: input.version,
    displayName: input.displayName,
    ...(input.description ? { description: input.description } : {}),
    ...(input.publisher ? { publisher: input.publisher } : {}),
    ...(input.license ? { license: input.license } : {}),
    sourceKind: input.sourceKind,
    sourceLayer: input.sourceLayer,
    trustStatus: input.trustStatus,
    ...(input.compatibility ? { compatibility: input.compatibility } : {}),
    dependencies: [...(input.dependencies ?? [])],
    assets: [...(input.assets ?? [])],
    overrideRules: [...(input.overrideRules ?? [])],
    ...(input.tags ? { tags: [...input.tags] } : {}),
    ...(input.categories ? { categories: [...input.categories] } : {}),
    ...(input.checksum ? { checksum: input.checksum } : {}),
    ...(input.createdAt ? { createdAt: input.createdAt } : {}),
    ...(input.updatedAt ? { updatedAt: input.updatedAt } : {}),
    ...(input.metadata ? { metadata: input.metadata } : {}),
  };
}

export function createSystemFoundationPackManifest(
  entries: readonly AssetPackAssetEntry[] = [],
  overrideRules: readonly AssetPackOverrideRule[] = [],
): AssetPackManifest {
  return createAssetPackManifest({
    schemaVersion: SYSTEM_FOUNDATION_PACK_SCHEMA_VERSION,
    packId: SYSTEM_FOUNDATION_PACK_ID,
    version: SYSTEM_FOUNDATION_PACK_VERSION,
    displayName: SYSTEM_FOUNDATION_PACK_DISPLAY_NAME,
    description:
      "System-owned pack for foundational Asset Kernel catalog definitions.",
    publisher: "ai-system-builder",
    license: {
      kind: "internal",
      name: "Internal system use",
    },
    sourceKind: SYSTEM_FOUNDATION_PACK_SOURCE_KIND,
    sourceLayer: SYSTEM_FOUNDATION_PACK_SOURCE_LAYER,
    trustStatus: SYSTEM_FOUNDATION_PACK_TRUST_STATUS,
    compatibility: {
      schemaVersion: SYSTEM_FOUNDATION_PACK_COMPATIBILITY_SCHEMA_VERSION,
      assetKernelVersion: "5.0.0",
      metadata: {
        declarativeOnly: true,
      },
    },
    dependencies: [],
    assets: entries,
    overrideRules,
    tags: ["foundation", "system"],
    categories: SYSTEM_FOUNDATION_PACK_CATEGORY_IDS,
    metadata: {
      declarativeOnly: true,
      catalogKind: "system-foundation",
      catalogStatus: "functional",
      catalogVersion: "1.0.0",
      categoryCount: SYSTEM_FOUNDATION_PACK_CATEGORIES.length,
      containsDefinitions: entries.length > 0,
    },
  });
}
