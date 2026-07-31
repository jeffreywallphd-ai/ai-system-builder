import type {
  ExecutionPlanRecord,
  ExecutionPlanStatus,
  ExecutionStepKind,
  ExecutionStepStatus,
  ExecutionAdapterReferenceKind,
  ExecutionSafetyGateStatus,
  ExecutionPlanId,
} from '../../../contracts/execution-plans';
import type { WorkspaceId } from '../../../contracts/workspace';

export interface ExecutionPlanListQuery {
  readonly workspaceId: WorkspaceId;
  readonly status?: ExecutionPlanStatus;
  readonly sourceRuntimeReadinessBindingId?: string;
  readonly sourceCompositionPlanId?: string;
  readonly stepKind?: ExecutionStepKind;
  readonly stepStatus?: ExecutionStepStatus;
  readonly adapterReferenceKind?: ExecutionAdapterReferenceKind;
  readonly safetyGateStatus?: ExecutionSafetyGateStatus;
  readonly archived?: boolean;
  readonly text?: string;
  readonly limit?: number;
  readonly cursor?: string;
}
export interface ExecutionPlanListResult { readonly plans: readonly ExecutionPlanRecord[]; readonly nextCursor?: string; }
export interface ExecutionPlanRepositoryPort {
  saveExecutionPlan(plan: ExecutionPlanRecord): Promise<ExecutionPlanRecord>;
  updateExecutionPlan(plan: ExecutionPlanRecord): Promise<ExecutionPlanRecord>;
  getExecutionPlanById(workspaceId: WorkspaceId, executionPlanId: ExecutionPlanId): Promise<ExecutionPlanRecord | undefined>;
  listExecutionPlans(query: ExecutionPlanListQuery): Promise<ExecutionPlanListResult>;
  archiveExecutionPlan(workspaceId: WorkspaceId, executionPlanId: ExecutionPlanId, archivedAt: string): Promise<ExecutionPlanRecord | undefined>;
}
