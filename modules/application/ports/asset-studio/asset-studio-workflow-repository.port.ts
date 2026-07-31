import type { AssetStudioWorkflowRecord } from "../../../contracts/asset-studio";
import type { WorkspaceId } from "../../../contracts/workspace";

export interface AssetStudioWorkflowRepositoryPort {
  create(record: AssetStudioWorkflowRecord): Promise<AssetStudioWorkflowRecord>;
  read(workspaceId: WorkspaceId, workflowId: string): Promise<AssetStudioWorkflowRecord | undefined>;
  update(record: AssetStudioWorkflowRecord, expectedRevision: number): Promise<AssetStudioWorkflowRecord>;
  list(workspaceId: WorkspaceId): Promise<readonly AssetStudioWorkflowRecord[]>;
}
