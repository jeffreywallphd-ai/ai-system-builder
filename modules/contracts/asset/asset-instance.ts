import type { AssetMetadata } from "./asset-metadata";
import type { AssetConfigurationValues } from "./asset-configuration-value";
import type { AssetId } from "./asset-id";
import type { AssetLifecycleStatus } from "./asset-lifecycle-status";
import type { AssetProvenance } from "./asset-provenance";
import type { AssetReference } from "./asset-reference";
import type { AssetReviewStatus } from "./asset-review-status";

export interface AssetInstanceStateSummary {
  readonly status?: string;
  readonly summary?: string;
  readonly updatedAt?: string;
}

export interface AssetInstance {
  readonly instanceId: AssetId | string;
  readonly definitionRef: AssetReference;
  readonly displayName?: string;
  readonly lifecycleStatus: AssetLifecycleStatus;
  readonly reviewStatus?: AssetReviewStatus;
  readonly selectedConfiguration?: AssetConfigurationValues;
  readonly bindingRefs?: readonly AssetReference[];
  readonly parentCompositionRef?: AssetReference;
  readonly resourceRefs?: readonly AssetReference[];
  readonly stateSummary?: AssetInstanceStateSummary;
  readonly provenance: AssetProvenance;
  readonly metadata?: AssetMetadata;
}
