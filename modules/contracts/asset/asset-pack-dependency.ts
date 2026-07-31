import type { AssetMetadata } from "./asset-metadata";
import type { AssetPackId } from "./asset-pack-id";

export interface AssetPackDependency {
  readonly packId: AssetPackId;
  readonly versionRange: string;
  readonly optional?: boolean;
  readonly reason?: string;
  readonly metadata?: AssetMetadata;
}
