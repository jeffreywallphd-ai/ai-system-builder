import type { WorkspaceId } from '../../../contracts/workspace';
import type { ExecutionAttemptId, ExecutionEventId, ExecutionEventRecord, ExecutionRunId } from '../../../contracts/execution-runs';
export interface ExecutionEventRepositoryPort {
  appendExecutionEvent(record: ExecutionEventRecord): Promise<ExecutionEventRecord>;
  getExecutionEventById(workspaceId: WorkspaceId, executionEventId: ExecutionEventId): Promise<ExecutionEventRecord | undefined>;
  listExecutionEventsByRun(workspaceId: WorkspaceId, executionRunId: ExecutionRunId, limit?: number, cursor?: string): Promise<{ readonly events: readonly ExecutionEventRecord[]; readonly nextCursor?: string }>;
  listExecutionEventsByAttempt(workspaceId: WorkspaceId, executionAttemptId: ExecutionAttemptId): Promise<readonly ExecutionEventRecord[]>;
}
