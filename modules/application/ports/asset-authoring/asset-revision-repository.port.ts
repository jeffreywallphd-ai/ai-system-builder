import type { AssetAuthoringStatus, AssetRevisionId, AuthoredAssetId, AuthoredAssetRevisionRecord } from "../../../contracts/asset-authoring";
import type { WorkspaceId } from "../../../contracts/workspace";
export interface AssetRevisionListQuery { readonly authoredAssetId: AuthoredAssetId; readonly workspaceId: WorkspaceId; readonly status?: AssetAuthoringStatus; readonly limit?: number; readonly cursor?: string; }
export interface AssetRevisionListResult { readonly records: readonly AuthoredAssetRevisionRecord[]; readonly nextCursor?: string; }
export interface AssetRevisionRepositoryPort {
 saveAssetRevisionRecord(record: AuthoredAssetRevisionRecord): Promise<AuthoredAssetRevisionRecord>;
 readAssetRevisionRecord(workspaceId: WorkspaceId, authoredAssetId: AuthoredAssetId, revisionId: AssetRevisionId): Promise<AuthoredAssetRevisionRecord|undefined>;
 listAssetRevisionRecords(query: AssetRevisionListQuery): Promise<AssetRevisionListResult>;
 findLatestPublishedAssetRevision(workspaceId: WorkspaceId, authoredAssetId: AuthoredAssetId): Promise<AuthoredAssetRevisionRecord|undefined>;
}
