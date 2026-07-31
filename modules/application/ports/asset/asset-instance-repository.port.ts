import type {
  WorkspaceId,
} from "../../../contracts/workspace";
import type {
  AssetInstance,
  AssetLifecycleStatus,
  AssetReference,
  AssetReviewStatus,
} from "../../../contracts/asset";

export interface AssetInstanceListQuery {
  readonly definitionRef?: AssetReference;
  readonly lifecycleStatus?: AssetLifecycleStatus;
  readonly reviewStatus?: AssetReviewStatus;
  readonly parentCompositionRef?: AssetReference;
  readonly workspaceId?: WorkspaceId | string;
  readonly text?: string;
  readonly limit?: number;
  readonly cursor?: string;
}

export interface AssetInstanceListResult {
  readonly instances: readonly AssetInstance[];
  readonly nextCursor?: string;
}

export interface AssetInstanceRepositoryPort {
  saveInstance(instance: AssetInstance): Promise<AssetInstance>;
  getInstance(reference: AssetReference): Promise<AssetInstance | undefined>;
  listInstances(query?: AssetInstanceListQuery): Promise<AssetInstanceListResult>;
  deleteInstance?(reference: AssetReference): Promise<void>;
}
