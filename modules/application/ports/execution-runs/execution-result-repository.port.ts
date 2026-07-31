import type { WorkspaceId } from '../../../contracts/workspace';
import type { ExecutionResultId, ExecutionResultRecord, ExecutionRunId } from '../../../contracts/execution-runs';
export interface ExecutionResultRepositoryPort {
  saveExecutionResult(record: ExecutionResultRecord): Promise<ExecutionResultRecord>;
  updateExecutionResult(record: ExecutionResultRecord): Promise<ExecutionResultRecord>;
  getExecutionResultById(workspaceId: WorkspaceId, executionResultId: ExecutionResultId): Promise<ExecutionResultRecord | undefined>;
  listExecutionResultsByRun(workspaceId: WorkspaceId, executionRunId: ExecutionRunId): Promise<readonly ExecutionResultRecord[]>;
  getLatestExecutionResultForRun(workspaceId: WorkspaceId, executionRunId: ExecutionRunId): Promise<ExecutionResultRecord | undefined>;
}
