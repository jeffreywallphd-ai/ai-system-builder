import type { WorkspaceId } from '../../../contracts/workspace';
import type { ExecutionApprovalId, ExecutionApprovalRecord } from '../../../contracts/execution-runs';
export interface ExecutionApprovalRepositoryPort {
  saveExecutionApproval(record: ExecutionApprovalRecord): Promise<ExecutionApprovalRecord>;
  updateExecutionApproval(record: ExecutionApprovalRecord): Promise<ExecutionApprovalRecord>;
  getExecutionApprovalById(workspaceId: WorkspaceId, executionApprovalId: ExecutionApprovalId): Promise<ExecutionApprovalRecord | undefined>;
  listExecutionApprovals(workspaceId: WorkspaceId, sourceExecutionPlanId?: string, executionRunId?: string, conversationSessionId?: string): Promise<readonly ExecutionApprovalRecord[]>;
}
