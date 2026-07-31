import type { WorkspaceId } from '../../../contracts/workspace';
import type { ExecutionRunId, ExecutionRunRecord, ExecutionRunSourceContextKind, ExecutionRunStatus } from '../../../contracts/execution-runs';

export interface ExecutionRunListQuery {
  readonly workspaceId: WorkspaceId;
  readonly status?: ExecutionRunStatus;
  readonly sourceExecutionPlanId?: string;
  readonly sourceCompositionPlanId?: string;
  readonly sourceRuntimeReadinessBindingId?: string;
  readonly sourceContextKind?: ExecutionRunSourceContextKind;
  readonly sourceContextId?: string;
  readonly approvalStatus?: string;
  readonly runtimeReferenceStatus?: string;
  readonly runtimeReferenceKind?: string;
  readonly archived?: boolean;
  readonly createdAfter?: string;
  readonly createdBefore?: string;
  readonly updatedAfter?: string;
  readonly updatedBefore?: string;
  readonly limit?: number;
  readonly cursor?: string;
}
export interface ExecutionRunListResult { readonly runs: readonly ExecutionRunRecord[]; readonly nextCursor?: string }
export interface ExecutionRunRepositoryPort {
  saveExecutionRun(record: ExecutionRunRecord): Promise<ExecutionRunRecord>;
  updateExecutionRun(record: ExecutionRunRecord): Promise<ExecutionRunRecord>;
  getExecutionRunById(workspaceId: WorkspaceId, executionRunId: ExecutionRunId): Promise<ExecutionRunRecord | undefined>;
  listExecutionRuns(query: ExecutionRunListQuery): Promise<ExecutionRunListResult>;
  listActiveExecutionRuns(workspaceId: WorkspaceId): Promise<readonly ExecutionRunRecord[]>;
  listRetryableExecutionRuns(workspaceId: WorkspaceId): Promise<readonly ExecutionRunRecord[]>;
  archiveExecutionRun(workspaceId: WorkspaceId, executionRunId: ExecutionRunId, archivedAt: string): Promise<ExecutionRunRecord | undefined>;
}
