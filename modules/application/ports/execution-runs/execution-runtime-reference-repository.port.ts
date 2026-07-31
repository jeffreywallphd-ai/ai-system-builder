import type { WorkspaceId } from '../../../contracts/workspace';
import type { ExecutionRuntimeReferenceId, ExecutionRuntimeReferenceRecord } from '../../../contracts/execution-runs';
export interface ExecutionRuntimeReferenceRepositoryPort {
  saveExecutionRuntimeReference(record: ExecutionRuntimeReferenceRecord): Promise<ExecutionRuntimeReferenceRecord>;
  getExecutionRuntimeReferenceById(workspaceId: WorkspaceId, runtimeReferenceId: ExecutionRuntimeReferenceId): Promise<ExecutionRuntimeReferenceRecord | undefined>;
  listExecutionRuntimeReferences(workspaceId: WorkspaceId): Promise<readonly ExecutionRuntimeReferenceRecord[]>;
}
