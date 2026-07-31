import type { AssetAuthoringStatus, AssetDraftId, AuthoredAssetDraftRecord, AuthoredAssetId } from "../../../contracts/asset-authoring";
import type { WorkspaceId } from "../../../contracts/workspace";
export interface AssetDraftListQuery { readonly workspaceId: WorkspaceId; readonly status?: AssetAuthoringStatus; readonly authoredAssetId?: AuthoredAssetId; readonly limit?: number; readonly cursor?: string; }
export interface AssetDraftListResult { readonly records: readonly AuthoredAssetDraftRecord[]; readonly nextCursor?: string; }
export interface AssetDraftRepositoryPort {
 saveAssetDraftRecord(record: AuthoredAssetDraftRecord): Promise<AuthoredAssetDraftRecord>;
 updateAssetDraftRecord(record: AuthoredAssetDraftRecord): Promise<AuthoredAssetDraftRecord>;
 readAssetDraftRecord(workspaceId: WorkspaceId, draftId: AssetDraftId): Promise<AuthoredAssetDraftRecord|undefined>;
 listAssetDraftRecords(query: AssetDraftListQuery): Promise<AssetDraftListResult>;
}
