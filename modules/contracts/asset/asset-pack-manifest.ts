import type { AssetMetadata } from "./asset-metadata";
import type { AssetPackAssetEntry } from "./asset-pack-asset-entry";
import type { AssetPackCompatibility } from "./asset-pack-compatibility";
import type { AssetPackDependency } from "./asset-pack-dependency";
import type { AssetPackId } from "./asset-pack-id";
import type { AssetPackLicense } from "./asset-pack-license";
import type { AssetPackOverrideRule } from "./asset-pack-override-rule";
import type { AssetPackSourceKind } from "./asset-pack-source-kind";
import type { AssetPackTrustStatus } from "./asset-pack-trust-status";
import type { AssetPackVersion } from "./asset-pack-version";
import type { AssetSourceLayer } from "./asset-source-layer";

export interface AssetPackManifest {
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
  readonly assets: readonly AssetPackAssetEntry[];
  readonly overrideRules?: readonly AssetPackOverrideRule[];
  readonly tags?: readonly string[];
  readonly categories?: readonly string[];
  readonly checksum?: string;
  readonly createdAt?: string;
  readonly updatedAt?: string;
  readonly metadata?: AssetMetadata;
}
