import type {
  AssetPackId,
  AssetPackSourceKind,
  AssetPackTrustStatus,
  AssetPackVersion,
  AssetSourceLayer,
} from "../../../../contracts/asset";
import { normalizeAssetPackId } from "../../../../contracts/asset";

export const SYSTEM_FOUNDATION_PACK_ID = normalizeAssetPackId("system.foundation");
export const SYSTEM_FOUNDATION_PACK_VERSION: AssetPackVersion = "1.0.0";
export const SYSTEM_FOUNDATION_CURRENT_PACK_VERSION: AssetPackVersion = "2.0.0";
export const SYSTEM_FOUNDATION_PACK_VERSIONS: readonly AssetPackVersion[] = [
  SYSTEM_FOUNDATION_PACK_VERSION,
  SYSTEM_FOUNDATION_CURRENT_PACK_VERSION,
];
export const SYSTEM_FOUNDATION_PACK_DISPLAY_NAME = "System Foundation";
export const SYSTEM_FOUNDATION_PACK_SCHEMA_VERSION = "asset-pack-manifest.v1";
export const SYSTEM_FOUNDATION_PACK_COMPATIBILITY_SCHEMA_VERSION =
  "asset-pack-compatibility.v1";
export const SYSTEM_FOUNDATION_PACK_SOURCE_KIND: AssetPackSourceKind = "system";
export const SYSTEM_FOUNDATION_PACK_SOURCE_LAYER: AssetSourceLayer =
  "system-default";
export const SYSTEM_FOUNDATION_PACK_TRUST_STATUS: AssetPackTrustStatus =
  "system-trusted";

export type SystemFoundationPackId = typeof SYSTEM_FOUNDATION_PACK_ID & AssetPackId;
