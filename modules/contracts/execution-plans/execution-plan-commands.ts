export interface CreateExecutionPlanCommand { workspaceId: string; runtimeReadinessBindingId: string; compositionPlanId?: string; }
export interface ReadExecutionPlanCommand { workspaceId: string; executionPlanId: string; }
export interface ListExecutionPlansCommand { workspaceId: string; }
export interface ArchiveExecutionPlanCommand { workspaceId: string; executionPlanId: string; }
export interface RefreshExecutionPlanCommand { workspaceId: string; executionPlanId: string; runtimeReadinessBindingId: string; }
export interface PrepareExecutionStepsCommand { workspaceId: string; executionPlanId: string; runtimeReadinessBindingId: string; }
export interface PrepareExecutionDependenciesCommand { workspaceId: string; executionPlanId: string; }
export interface PrepareExecutionInputsCommand { workspaceId: string; executionPlanId: string; }
export interface PrepareExecutionOutputsCommand { workspaceId: string; executionPlanId: string; }
export interface ValidateExecutionPlanCommand { workspaceId: string; executionPlanId: string; }
export interface PreviewExecutionPlanCommand { workspaceId: string; executionPlanId: string; }
