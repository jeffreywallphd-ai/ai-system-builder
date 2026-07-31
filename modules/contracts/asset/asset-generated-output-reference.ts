import type { RuntimeCapabilityId } from "../runtime";
import type { AssetMetadata } from "./asset-metadata";
import type { AssetReference } from "./asset-reference";
import type { AssetType } from "./asset-type";

export interface AssetGeneratedOutputReference {
  readonly outputId: string;
  readonly taskRef?: AssetReference;
  readonly runtimeCapabilityId?: RuntimeCapabilityId;
  readonly producedAssetType?: AssetType;
  readonly producedAt?: string;
  readonly sourceRefs?: readonly AssetReference[];
  readonly metadata?: AssetMetadata;
}
