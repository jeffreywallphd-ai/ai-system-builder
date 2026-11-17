import type { AssetReference } from "../../../contracts/asset";
import type {
  AssetStudioAssetDraftId,
  AssetStudioAssetDraftRecord,
  ListAssetStudioAssetDraftsQuery,
} from "../../../contracts/asset-studio";
import type { WorkspaceId } from "../../../contracts/workspace";

export interface AssetStudioAssetDraftListResult {
  readonly records: readonly AssetStudioAssetDraftRecord[];
  readonly nextCursor?: string;
}

export interface AssetStudioAssetDraftRepositoryPort {
  readPublishedAssetReferences?(workspaceId: WorkspaceId): Promise<readonly AssetReference[]>;
  create(
    record: AssetStudioAssetDraftRecord,
  ): Promise<AssetStudioAssetDraftRecord>;
  read(
    workspaceId: WorkspaceId,
    draftId: AssetStudioAssetDraftId,
  ): Promise<AssetStudioAssetDraftRecord | undefined>;
  update(
    record: AssetStudioAssetDraftRecord,
    expectedRevision: number,
  ): Promise<AssetStudioAssetDraftRecord>;
  list(
    query: ListAssetStudioAssetDraftsQuery,
  ): Promise<AssetStudioAssetDraftListResult>;
}
