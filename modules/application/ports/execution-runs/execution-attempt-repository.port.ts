import type { WorkspaceId } from '../../../contracts/workspace';
import type { ExecutionAttemptId, ExecutionAttemptRecord, ExecutionAttemptStatus, ExecutionRunId } from '../../../contracts/execution-runs';
export interface ExecutionAttemptRepositoryPort {
  saveExecutionAttempt(record: ExecutionAttemptRecord): Promise<ExecutionAttemptRecord>;
  updateExecutionAttempt(record: ExecutionAttemptRecord): Promise<ExecutionAttemptRecord>;
  getExecutionAttemptById(workspaceId: WorkspaceId, executionAttemptId: ExecutionAttemptId): Promise<ExecutionAttemptRecord | undefined>;
  listExecutionAttemptsByRun(workspaceId: WorkspaceId, executionRunId: ExecutionRunId, status?: ExecutionAttemptStatus): Promise<readonly ExecutionAttemptRecord[]>;
  getLatestExecutionAttemptForRun(workspaceId: WorkspaceId, executionRunId: ExecutionRunId): Promise<ExecutionAttemptRecord | undefined>;
}
