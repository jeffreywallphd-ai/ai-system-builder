import type {
  AssetComposition,
  AssetCompositionType,
  AssetLifecycleStatus,
  AssetReference,
  AssetReviewStatus,
} from "../../../contracts/asset";

export interface AssetCompositionListQuery {
  readonly compositionType?: AssetCompositionType;
  readonly lifecycleStatus?: AssetLifecycleStatus;
  readonly reviewStatus?: AssetReviewStatus;
  readonly text?: string;
  readonly limit?: number;
  readonly cursor?: string;
}

export interface AssetCompositionListResult {
  readonly compositions: readonly AssetComposition[];
  readonly nextCursor?: string;
}

export interface AssetCompositionRepositoryPort {
  saveComposition(composition: AssetComposition): Promise<AssetComposition>;
  getComposition(reference: AssetReference): Promise<AssetComposition | undefined>;
  listCompositions(query?: AssetCompositionListQuery): Promise<AssetCompositionListResult>;
  deleteComposition?(reference: AssetReference): Promise<void>;
}
