import type { WorkspaceId } from '../../../contracts/workspace';
import type { ExecutionRetryRequestId, ExecutionRetryRequestRecord, ExecutionRunId } from '../../../contracts/execution-runs';
export interface ExecutionRetryRequestRepositoryPort {
  saveExecutionRetryRequest(record: ExecutionRetryRequestRecord): Promise<ExecutionRetryRequestRecord>;
  getExecutionRetryRequestById(workspaceId: WorkspaceId, requestId: ExecutionRetryRequestId): Promise<ExecutionRetryRequestRecord | undefined>;
  listExecutionRetryRequestsByRun(workspaceId: WorkspaceId, executionRunId: ExecutionRunId): Promise<readonly ExecutionRetryRequestRecord[]>;
}
