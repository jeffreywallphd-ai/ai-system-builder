import type {
  AssetDefinition,
  AssetFamily,
  AssetLifecycleStatus,
  AssetReference,
  AssetReviewStatus,
  AssetType,
} from "../../../contracts/asset";

export interface AssetDefinitionListQuery {
  readonly assetType?: AssetType;
  readonly assetFamily?: AssetFamily;
  readonly lifecycleStatus?: AssetLifecycleStatus;
  readonly reviewStatus?: AssetReviewStatus;
  readonly text?: string;
  readonly limit?: number;
  readonly cursor?: string;
}

export interface AssetDefinitionListResult {
  readonly definitions: readonly AssetDefinition[];
  readonly nextCursor?: string;
}

export interface AssetDefinitionRepositoryPort {
  saveDefinition(definition: AssetDefinition): Promise<AssetDefinition>;
  getDefinition(reference: AssetReference): Promise<AssetDefinition | undefined>;
  listDefinitions(query?: AssetDefinitionListQuery): Promise<AssetDefinitionListResult>;
  deleteDefinition?(reference: AssetReference): Promise<void>;
}
