import type { WorkspaceId } from '../../../contracts/workspace';
import type { ExecutionCancellationRequestId, ExecutionCancellationRequestRecord, ExecutionRunId } from '../../../contracts/execution-runs';
export interface ExecutionCancellationRequestRepositoryPort {
  saveExecutionCancellationRequest(record: ExecutionCancellationRequestRecord): Promise<ExecutionCancellationRequestRecord>;
  getExecutionCancellationRequestById(workspaceId: WorkspaceId, requestId: ExecutionCancellationRequestId): Promise<ExecutionCancellationRequestRecord | undefined>;
  listExecutionCancellationRequestsByRun(workspaceId: WorkspaceId, executionRunId: ExecutionRunId): Promise<readonly ExecutionCancellationRequestRecord[]>;
}
