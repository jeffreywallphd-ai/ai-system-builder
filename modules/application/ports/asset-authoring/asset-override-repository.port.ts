import type { AssetAuthoringConflictStatus, AssetOverrideId, AssetOverrideRecord, AssetOverrideStatus } from "../../../contracts/asset-authoring";
import type { AssetReference } from "../../../contracts/asset";
import type { WorkspaceId } from "../../../contracts/workspace";
export interface AssetOverrideListQuery { readonly targetWorkspaceId: WorkspaceId; readonly status?: AssetOverrideStatus; readonly conflictStatus?: AssetAuthoringConflictStatus; readonly baseAssetReference?: AssetReference; readonly limit?: number; readonly cursor?: string; }
export interface AssetOverrideListResult { readonly records: readonly AssetOverrideRecord[]; readonly nextCursor?: string; }
export interface AssetOverrideRepositoryPort {
 saveAssetOverrideRecord(record: AssetOverrideRecord): Promise<AssetOverrideRecord>;
 updateAssetOverrideRecord(record: AssetOverrideRecord): Promise<AssetOverrideRecord>;
 readAssetOverrideRecord(targetWorkspaceId: WorkspaceId, overrideId: AssetOverrideId): Promise<AssetOverrideRecord|undefined>;
 listAssetOverrideRecords(query: AssetOverrideListQuery): Promise<AssetOverrideListResult>;
 findActiveOverrideForTarget(targetWorkspaceId: WorkspaceId, targetAssetReference: AssetReference): Promise<AssetOverrideRecord|undefined>;
 listConflictedOverridesByWorkspace(targetWorkspaceId: WorkspaceId): Promise<readonly AssetOverrideRecord[]>;
}
