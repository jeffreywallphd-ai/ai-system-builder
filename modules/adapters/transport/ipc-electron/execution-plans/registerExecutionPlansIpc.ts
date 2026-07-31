import type { CreateExecutionPlanUseCase, ValidateExecutionPlanUseCase } from "../../../../application/use-cases/execution-plans";
import type { ExecutionPlanReadModelService } from "../../../../application/services/execution-plans";
import type { IpcMainHandlePort } from "../ipcMainHandlePort";
import {
  DESKTOP_EXECUTION_PLANS_ARCHIVE_PLAN_REQUEST_CHANNEL,
  DESKTOP_EXECUTION_PLANS_CREATE_PLAN_REQUEST_CHANNEL,
  DESKTOP_EXECUTION_PLANS_LIST_FOR_COMPOSITION_PLAN_REQUEST_CHANNEL,
  DESKTOP_EXECUTION_PLANS_LIST_FOR_RUNTIME_READINESS_BINDING_REQUEST_CHANNEL,
  DESKTOP_EXECUTION_PLANS_LIST_NEEDING_ATTENTION_REQUEST_CHANNEL,
  DESKTOP_EXECUTION_PLANS_LIST_SUMMARIES_REQUEST_CHANNEL,
  DESKTOP_EXECUTION_PLANS_READ_DETAIL_REQUEST_CHANNEL,
  DESKTOP_EXECUTION_PLANS_READ_LATEST_FOR_COMPOSITION_PLAN_REQUEST_CHANNEL,
  DESKTOP_EXECUTION_PLANS_READ_LATEST_FOR_RUNTIME_READINESS_BINDING_REQUEST_CHANNEL,
  DESKTOP_EXECUTION_PLANS_SUMMARIZE_WORKSPACE_REQUEST_CHANNEL,
  DESKTOP_EXECUTION_PLANS_VALIDATE_PLAN_REQUEST_CHANNEL,
} from "../../../../contracts/ipc";
import type { ExecutionPlanStatus } from "../../../../contracts/execution-plans";

export interface RegisterExecutionPlansIpcDependencies {
  ipcMain: IpcMainHandlePort;
  executionPlans: {
    create: CreateExecutionPlanUseCase;
    validate: ValidateExecutionPlanUseCase;
    readModel: ExecutionPlanReadModelService;
    archive?: { execute: (c: { workspaceId: string; executionPlanId: string }) => Promise<unknown> };
  };
}

type IpcRequest<TPayload> = { requestId?: string; correlationId?: string; payload?: TPayload };
const VALID_STATUSES = new Set<ExecutionPlanStatus>(["draft","preparing","ready-for-review","needs-setup","missing-inputs","missing-outputs","provider-setup-required","safety-review-required","blocked","stale","invalid","archived"]);
const asText = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const ok = <TPayload>(r: IpcRequest<TPayload>, v: unknown) => ({ ok: true, requestId: r.requestId, correlationId: r.correlationId, value: v });
const fail = <TPayload>(r: IpcRequest<TPayload>, code: string, message: string) => ({ ok: false, requestId: r.requestId, correlationId: r.correlationId, error: { code, message } });

export function registerExecutionPlansIpc({ ipcMain, executionPlans }: RegisterExecutionPlansIpcDependencies): void {
  const req = <TPayload>(
    fn: (p: TPayload) => Promise<unknown>,
    validate: (p: TPayload | undefined) => string | undefined,
  ) => async (_e: unknown, r: IpcRequest<TPayload>) => {
    const m = validate(r?.payload);
    if (m) return fail(r, "validation", m);
    try { return ok(r, await fn(r.payload as TPayload)); } catch { return fail(r, "internal", "Unable to complete request."); }
  };

  ipcMain.handle(DESKTOP_EXECUTION_PLANS_CREATE_PLAN_REQUEST_CHANNEL.value, req((p: { workspaceId: string; runtimeReadinessBindingId: string; compositionPlanId?: string }) => executionPlans.create.execute(p), (p) => !asText(p?.workspaceId) || !asText(p?.runtimeReadinessBindingId) ? "Workspace id and runtime readiness binding id are required." : undefined));
  ipcMain.handle(DESKTOP_EXECUTION_PLANS_VALIDATE_PLAN_REQUEST_CHANNEL.value, req((p: { workspaceId: string; executionPlanId: string }) => executionPlans.validate.execute(p), (p) => !asText(p?.workspaceId) || !asText(p?.executionPlanId) ? "Workspace id and execution plan id are required." : undefined));
  ipcMain.handle(DESKTOP_EXECUTION_PLANS_ARCHIVE_PLAN_REQUEST_CHANNEL.value, async (_e, r: IpcRequest<{ workspaceId: string; executionPlanId: string }>) => {
    if (!executionPlans.archive) return fail(r, "unavailable", "Execution plan archive is not available.");
    const p = r?.payload;
    if (!p || !asText(p.workspaceId) || !asText(p.executionPlanId)) return fail(r, "validation", "Workspace id and execution plan id are required.");
    const payload = { workspaceId: p.workspaceId, executionPlanId: p.executionPlanId };
    try { return ok(r, await executionPlans.archive.execute(payload)); } catch { return fail(r, "internal", "Unable to complete request."); }
  });
  ipcMain.handle(DESKTOP_EXECUTION_PLANS_LIST_SUMMARIES_REQUEST_CHANNEL.value, req((p: { workspaceId: string; status?: string }) => executionPlans.readModel.listExecutionPlanSummaries({ ...p, status: p.status as ExecutionPlanStatus | undefined }), (p) => {
    if (!asText(p?.workspaceId)) return "Workspace id is required.";
    if (p?.status && !VALID_STATUSES.has(p.status as ExecutionPlanStatus)) return "Invalid status filter.";
    return undefined;
  }));
  ipcMain.handle(DESKTOP_EXECUTION_PLANS_READ_DETAIL_REQUEST_CHANNEL.value, req((p: { workspaceId: string; executionPlanId: string }) => executionPlans.readModel.readExecutionPlanDetail(p), (p) => !asText(p?.workspaceId) || !asText(p?.executionPlanId) ? "Workspace id and execution plan id are required." : undefined));
  ipcMain.handle(DESKTOP_EXECUTION_PLANS_LIST_FOR_COMPOSITION_PLAN_REQUEST_CHANNEL.value, req((p: { workspaceId: string; compositionPlanId: string; includeArchived?: boolean }) => executionPlans.readModel.listExecutionPlansForCompositionPlan(p), (p) => !asText(p?.workspaceId) || !asText(p?.compositionPlanId) ? "Workspace id and composition plan id are required." : undefined));
  ipcMain.handle(DESKTOP_EXECUTION_PLANS_READ_LATEST_FOR_COMPOSITION_PLAN_REQUEST_CHANNEL.value, req((p: { workspaceId: string; compositionPlanId: string; includeArchived?: boolean }) => executionPlans.readModel.readLatestExecutionPlanForCompositionPlan(p), (p) => !asText(p?.workspaceId) || !asText(p?.compositionPlanId) ? "Workspace id and composition plan id are required." : undefined));
  ipcMain.handle(DESKTOP_EXECUTION_PLANS_LIST_FOR_RUNTIME_READINESS_BINDING_REQUEST_CHANNEL.value, req((p: { workspaceId: string; runtimeReadinessBindingId: string; includeArchived?: boolean }) => executionPlans.readModel.listExecutionPlansForRuntimeReadinessBinding(p), (p) => !asText(p?.workspaceId) || !asText(p?.runtimeReadinessBindingId) ? "Workspace id and runtime readiness binding id are required." : undefined));
  ipcMain.handle(DESKTOP_EXECUTION_PLANS_READ_LATEST_FOR_RUNTIME_READINESS_BINDING_REQUEST_CHANNEL.value, req((p: { workspaceId: string; runtimeReadinessBindingId: string; includeArchived?: boolean }) => executionPlans.readModel.readLatestExecutionPlanForRuntimeReadinessBinding(p), (p) => !asText(p?.workspaceId) || !asText(p?.runtimeReadinessBindingId) ? "Workspace id and runtime readiness binding id are required." : undefined));
  ipcMain.handle(DESKTOP_EXECUTION_PLANS_LIST_NEEDING_ATTENTION_REQUEST_CHANNEL.value, req((p: { workspaceId: string }) => executionPlans.readModel.listExecutionPlansNeedingAttention(p), (p) => !asText(p?.workspaceId) ? "Workspace id is required." : undefined));
  ipcMain.handle(DESKTOP_EXECUTION_PLANS_SUMMARIZE_WORKSPACE_REQUEST_CHANNEL.value, req((p: { workspaceId: string }) => executionPlans.readModel.summarizeWorkspaceExecutionPlans(p), (p) => !asText(p?.workspaceId) ? "Workspace id is required." : undefined));
}
