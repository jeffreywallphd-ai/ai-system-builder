import type { AssetReference } from "../../../contracts/asset";
import type { WorkspaceId } from "../../../contracts/workspace";
import type { AssetAuthoringStatus, AuthoredAssetId, AuthoredAssetRecord } from "../../../contracts/asset-authoring";

export interface AuthoredAssetListQuery { readonly workspaceId: WorkspaceId; readonly status?: AssetAuthoringStatus; readonly baseAssetReference?: AssetReference; readonly text?: string; readonly limit?: number; readonly cursor?: string; }
export interface AuthoredAssetListResult { readonly records: readonly AuthoredAssetRecord[]; readonly nextCursor?: string; }
export interface AuthoredAssetRepositoryPort {
 saveAuthoredAssetRecord(record: AuthoredAssetRecord): Promise<AuthoredAssetRecord>;
 updateAuthoredAssetRecord(record: AuthoredAssetRecord): Promise<AuthoredAssetRecord>;
 readAuthoredAssetRecordById(authoredAssetId: AuthoredAssetId): Promise<AuthoredAssetRecord|undefined>;
 readAuthoredAssetRecordByWorkspace(workspaceId: WorkspaceId, authoredAssetId: AuthoredAssetId): Promise<AuthoredAssetRecord|undefined>;
 listAuthoredAssetRecords(query: AuthoredAssetListQuery): Promise<AuthoredAssetListResult>;
 findAuthoredAssetByBaseReference(workspaceId: WorkspaceId, baseAssetReference: AssetReference): Promise<AuthoredAssetRecord|undefined>;
}
