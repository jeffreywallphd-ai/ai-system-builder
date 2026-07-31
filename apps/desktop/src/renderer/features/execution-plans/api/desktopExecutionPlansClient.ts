type Result<T> = { ok: true; value: T } | { ok: false; error: { code: string; message: string } };
const fail = (message: string, code = 'internal'): Result<never> => ({ ok: false, error: { code, message } });
const asResult = <T,>(v: unknown): Result<T> => { const r=v as {ok?:boolean;value?:T;error?:{message?:string;code?:string}}; return r?.ok===true?{ok:true,value:r.value as T}:fail(r?.error?.message ?? 'Unable to complete request.', r?.error?.code ?? 'internal'); };
export type ExecutionPlanSummaryPayload = {
  executionPlanId: string;
  plan?: { executionPlanId?: string };
  executionPlanStatus?: string;
  status?: string;
  updatedAt?: string;
  stepCount?: number;
  missingInputCount?: number;
  missingOutputCount?: number;
  providerSetupRequiredCount?: number;
  safetyReviewRequiredCount?: number;
  blockerCount?: number;
  diagnosticCount?: number;
  resourceEstimateSummary?: { compute?: string; storage?: string; duration?: string };
};
export type ExecutionPlanDetailPayload = {
  summary?: ExecutionPlanSummaryPayload;
  stepSummaries?: Array<{ label?: string; stepStatus?: string; status?: string; summary?: string }>;
  steps?: Array<{ label?: string; stepStatus?: string; status?: string; summary?: string }>;
  diagnostics?: Array<{ message?: string }>;
  blockers?: Array<{ message?: string }>;
  resourceEstimateSummaries?: Array<{ estimate?: { compute?: string; storage?: string; duration?: string }; summary?: string }>;
};
type ExecutionPlanListPayload = { summaries?: ExecutionPlanSummaryPayload[] };
type WorkspaceExecutionPlansSummaryPayload = { total?: number; byStatus?: Record<string, number> };
type Api = {
  createExecutionPlan?: (input: { workspaceId: string; runtimeReadinessBindingId: string; compositionPlanId?: string }) => Promise<unknown>;
  validateExecutionPlan?: (input: { workspaceId: string; executionPlanId: string }) => Promise<unknown>;
  archiveExecutionPlan?: (input: { workspaceId: string; executionPlanId: string }) => Promise<unknown>;
  listExecutionPlanSummaries?: (input: { workspaceId: string; includeArchived?: boolean; limit?: number; cursor?: string; status?: string }) => Promise<unknown>;
  readExecutionPlanDetail?: (input: { workspaceId: string; executionPlanId: string }) => Promise<unknown>;
  listExecutionPlansForCompositionPlan?: (input: { workspaceId: string; compositionPlanId: string; includeArchived?: boolean }) => Promise<unknown>;
  readLatestExecutionPlanForCompositionPlan?: (input: { workspaceId: string; compositionPlanId: string; includeArchived?: boolean }) => Promise<unknown>;
  listExecutionPlansForRuntimeReadinessBinding?: (input: { workspaceId: string; runtimeReadinessBindingId: string; includeArchived?: boolean }) => Promise<unknown>;
  readLatestExecutionPlanForRuntimeReadinessBinding?: (input: { workspaceId: string; runtimeReadinessBindingId: string; includeArchived?: boolean }) => Promise<unknown>;
  listExecutionPlansNeedingAttention?: (input: { workspaceId: string }) => Promise<unknown>;
  summarizeWorkspaceExecutionPlans?: (input: { workspaceId: string }) => Promise<unknown>;
};
const api = (): Api => ((globalThis as unknown as { window?: { desktopApi?: Api } }).window?.desktopApi ?? {});
const call = async <T, K extends keyof Api = keyof Api>(name: K, input: Parameters<NonNullable<Api[K]>>[0], unavailable: string): Promise<Result<T>> => {
  const fn = api()[name];
  if (typeof fn !== 'function') return fail(unavailable, 'unavailable');
  return asResult<T>(await (fn as (payload: typeof input) => Promise<unknown>)(input));
};

export function createDesktopExecutionPlansClient() { return {
  async createExecutionPlan(input:{workspaceId:string;runtimeReadinessBindingId:string;compositionPlanId?:string}) { if(!input.workspaceId||!input.runtimeReadinessBindingId) return fail('Workspace id and runtime readiness binding id are required.','validation'); return call<ExecutionPlanSummaryPayload>('createExecutionPlan', input, 'Plan preview preparation is not available yet.'); },
  async validateExecutionPlan(input:{workspaceId:string;executionPlanId:string}) { if(!input.workspaceId||!input.executionPlanId) return fail('Workspace id and execution plan id are required.','validation'); return call<ExecutionPlanSummaryPayload>('validateExecutionPlan', input, 'Preview checking is not available yet.'); },
  async archiveExecutionPlan(input:{workspaceId:string;executionPlanId:string}) { if(!input.workspaceId||!input.executionPlanId) return fail('Workspace id and execution plan id are required.','validation'); return call<ExecutionPlanSummaryPayload>('archiveExecutionPlan', input, 'Execution plan archive is not available yet.'); },
  async listExecutionPlanSummaries(input:{workspaceId:string; includeArchived?: boolean; limit?: number; cursor?: string; status?: string}) { if(!input.workspaceId) return fail('Workspace id is required.','validation'); return call<ExecutionPlanListPayload>('listExecutionPlanSummaries', input, 'Execution plan summaries are unavailable.'); },
  async readExecutionPlanDetail(input:{workspaceId:string;executionPlanId:string}) { if(!input.workspaceId||!input.executionPlanId) return fail('Workspace id and execution plan id are required.','validation'); return call<ExecutionPlanDetailPayload | undefined>('readExecutionPlanDetail', input, 'Plan preview details are not available yet.'); },
  async listExecutionPlansForCompositionPlan(input:{workspaceId:string;compositionPlanId:string; includeArchived?: boolean}) { if(!input.workspaceId||!input.compositionPlanId) return fail('Workspace id and composition plan id are required.','validation'); return call<ExecutionPlanSummaryPayload[]>('listExecutionPlansForCompositionPlan', input, 'Plan preview details are not available yet.'); },
  async readLatestExecutionPlanForCompositionPlan(input:{workspaceId:string;compositionPlanId:string; includeArchived?: boolean}) { if(!input.workspaceId||!input.compositionPlanId) return fail('Workspace id and composition plan id are required.','validation'); return call<ExecutionPlanSummaryPayload | undefined>('readLatestExecutionPlanForCompositionPlan', input, 'Plan preview details are not available yet.'); },
  async listExecutionPlansForRuntimeReadinessBinding(input:{workspaceId:string;runtimeReadinessBindingId:string; includeArchived?: boolean}) { if(!input.workspaceId||!input.runtimeReadinessBindingId) return fail('Workspace id and runtime readiness binding id are required.','validation'); return call<ExecutionPlanSummaryPayload[]>('listExecutionPlansForRuntimeReadinessBinding', input, 'Plan preview details are not available yet.'); },
  async readLatestExecutionPlanForRuntimeReadinessBinding(input:{workspaceId:string;runtimeReadinessBindingId:string; includeArchived?: boolean}) { if(!input.workspaceId||!input.runtimeReadinessBindingId) return fail('Workspace id and runtime readiness binding id are required.','validation'); return call<ExecutionPlanSummaryPayload | undefined>('readLatestExecutionPlanForRuntimeReadinessBinding', input, 'Plan preview details are not available yet.'); },
  async listExecutionPlansNeedingAttention(input:{workspaceId:string}) { if(!input.workspaceId) return fail('Workspace id is required.','validation'); return call<ExecutionPlanSummaryPayload[]>('listExecutionPlansNeedingAttention', input, 'Execution plan summaries are unavailable.'); },
  async summarizeWorkspaceExecutionPlans(input:{workspaceId:string}) { if(!input.workspaceId) return fail('Workspace id is required.','validation'); return call<WorkspaceExecutionPlansSummaryPayload>('summarizeWorkspaceExecutionPlans', input, 'Execution plan summaries are unavailable.'); },
};}
