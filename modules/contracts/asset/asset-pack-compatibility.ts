import type { AssetFamily } from "./asset-family";
import type { AssetMetadata } from "./asset-metadata";
import type { AssetType } from "./asset-type";

export interface AssetPackCompatibility {
  readonly schemaVersion: string;
  readonly minimumAppVersion?: string;
  readonly maximumAppVersion?: string;
  readonly assetKernelVersion?: string;
  readonly requiresAssetTypes?: readonly AssetType[];
  readonly requiresAssetFamilies?: readonly AssetFamily[];
  readonly requiresCapabilities?: readonly string[];
  readonly metadata?: AssetMetadata;
}
