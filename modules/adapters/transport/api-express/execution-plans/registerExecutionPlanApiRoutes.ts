import type { CreateExecutionPlanUseCase, ValidateExecutionPlanUseCase } from "../../../../application/use-cases/execution-plans";
import type { ExecutionPlanReadModelService } from "../../../../application/services/execution-plans";
import { createApiError, createApiFailureResponse, createApiSuccessResponse } from "../../../../contracts/api";

interface ExpressRequestLike { params?: Record<string, string | undefined>; body?: Record<string, unknown>; query?: Record<string, unknown>; }
interface ExpressResponseLike { status: (code: number) => ExpressResponseLike; json: (body: unknown) => void; }
export interface ExpressRoutePort { get: (path: string, handler: (request: ExpressRequestLike, response: ExpressResponseLike) => Promise<void>) => void; post: (path: string, handler: (request: ExpressRequestLike, response: ExpressResponseLike) => Promise<void>) => void; }

export interface RegisterExecutionPlanApiRoutesDependencies {
  app: ExpressRoutePort;
  executionPlans: {
    create: CreateExecutionPlanUseCase;
    validate: ValidateExecutionPlanUseCase;
    readModel: ExecutionPlanReadModelService;
    archive?: { execute: (command: { workspaceId: string; executionPlanId: string }) => Promise<unknown> };
  };
}

const OPERATION = "execution-plans.preview" as const;

const VALID_STATUSES = new Set(['draft','preparing','ready-for-review','needs-setup','missing-inputs','missing-outputs','provider-setup-required','safety-review-required','blocked','stale','invalid','archived']);

const asText = (value: unknown): string => (typeof value === "string" ? value.trim() : "");
const asWorkspaceId = (request: ExpressRequestLike): string => asText(request.params?.workspaceId);
const asQueryBool = (value: unknown): boolean | undefined => (value === "true" ? true : value === "false" ? false : undefined);
const asQueryNumber = (value: unknown): number | undefined => {
  if (typeof value !== "string" || value.trim().length === 0) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const sendValidation = (response: ExpressResponseLike, message: string) => response.status(400).json(createApiFailureResponse(createApiError(OPERATION, "validation", message)));
const sendUnavailable = (response: ExpressResponseLike, message: string) => response.status(501).json(createApiFailureResponse(createApiError(OPERATION, "unavailable", message)));
const sendInternal = (response: ExpressResponseLike) => response.status(500).json(createApiFailureResponse(createApiError(OPERATION, "internal", "Unable to complete request.")));
const sendOk = (response: ExpressResponseLike, value: unknown) => response.status(200).json(createApiSuccessResponse(OPERATION, value));

export function registerExecutionPlanApiRoutes(dependencies: RegisterExecutionPlanApiRoutesDependencies): void {
  const { app, executionPlans } = dependencies;

  app.post("/api/execution-plans/workspaces/:workspaceId/plans", async (request, response) => {
    const routeWorkspaceId = asWorkspaceId(request);
    const bodyWorkspaceId = asText((request.body as { workspaceId?: unknown })?.workspaceId);
    const runtimeReadinessBindingId = asText((request.body as { runtimeReadinessBindingId?: unknown })?.runtimeReadinessBindingId);
    if (!routeWorkspaceId || !bodyWorkspaceId || routeWorkspaceId !== bodyWorkspaceId || !runtimeReadinessBindingId) return void sendValidation(response, "Workspace id and runtime readiness binding id are required.");
    try { sendOk(response, await executionPlans.create.execute({ workspaceId: bodyWorkspaceId, runtimeReadinessBindingId, compositionPlanId: asText((request.body as { compositionPlanId?: unknown })?.compositionPlanId) || undefined })); } catch { sendInternal(response); }
  });

  app.post("/api/execution-plans/workspaces/:workspaceId/plans/:executionPlanId/validate", async (request, response) => {
    const routeWorkspaceId = asWorkspaceId(request);
    const routeExecutionPlanId = asText(request.params?.executionPlanId);
    const bodyWorkspaceId = asText((request.body as { workspaceId?: unknown })?.workspaceId);
    const bodyExecutionPlanId = asText((request.body as { executionPlanId?: unknown })?.executionPlanId);
    if (!routeWorkspaceId || !routeExecutionPlanId || !bodyWorkspaceId || !bodyExecutionPlanId || routeWorkspaceId !== bodyWorkspaceId || routeExecutionPlanId !== bodyExecutionPlanId) return void sendValidation(response, "Workspace id and execution plan id are required.");
    try { sendOk(response, await executionPlans.validate.execute({ workspaceId: bodyWorkspaceId, executionPlanId: bodyExecutionPlanId })); } catch { sendInternal(response); }
  });

  app.post("/api/execution-plans/workspaces/:workspaceId/plans/:executionPlanId/archive", async (request, response) => {
    if (!executionPlans.archive) return void sendUnavailable(response, "Execution plan archive is not available.");
    const workspaceId = asWorkspaceId(request);
    const executionPlanId = asText(request.params?.executionPlanId);
    if (!workspaceId || !executionPlanId) return void sendValidation(response, "Workspace id and execution plan id are required.");
    try { sendOk(response, await executionPlans.archive.execute({ workspaceId, executionPlanId })); } catch { sendInternal(response); }
  });

  app.get("/api/execution-plans/workspaces/:workspaceId/plans", async (request, response) => {
    const workspaceId = asWorkspaceId(request);
    if (!workspaceId) return void sendValidation(response, "Workspace id is required.");
    const limit = asQueryNumber(request.query?.limit);
    if (request.query?.limit !== undefined && limit === undefined) return void sendValidation(response, "Invalid limit filter.");
    const statusRaw = asText(request.query?.status);
    const status = statusRaw.length === 0 ? undefined : statusRaw;
    if (status && !VALID_STATUSES.has(status)) return void sendValidation(response, "Invalid status filter.");
    try { sendOk(response, await executionPlans.readModel.listExecutionPlanSummaries({ workspaceId, limit, cursor: asText(request.query?.cursor), includeArchived: asQueryBool(request.query?.archived), status: status as Parameters<ExecutionPlanReadModelService["listExecutionPlanSummaries"]>[0]["status"] })); } catch { sendInternal(response); }
  });

  app.get("/api/execution-plans/workspaces/:workspaceId/plans/:executionPlanId", async (request, response) => {
    const workspaceId = asWorkspaceId(request); const executionPlanId = asText(request.params?.executionPlanId);
    if (!workspaceId || !executionPlanId) return void sendValidation(response, "Workspace id and execution plan id are required.");
    try { sendOk(response, await executionPlans.readModel.readExecutionPlanDetail({ workspaceId, executionPlanId })); } catch { sendInternal(response); }
  });

  app.get("/api/execution-plans/workspaces/:workspaceId/composition-plans/:compositionPlanId/plans", async (request, response) => {
    const workspaceId = asWorkspaceId(request); const compositionPlanId = asText(request.params?.compositionPlanId);
    if (!workspaceId || !compositionPlanId) return void sendValidation(response, "Workspace id and composition plan id are required.");
    try { sendOk(response, await executionPlans.readModel.listExecutionPlansForCompositionPlan({ workspaceId, compositionPlanId, includeArchived: asQueryBool(request.query?.archived) })); } catch { sendInternal(response); }
  });

  app.get("/api/execution-plans/workspaces/:workspaceId/composition-plans/:compositionPlanId/latest", async (request, response) => {
    const workspaceId = asWorkspaceId(request); const compositionPlanId = asText(request.params?.compositionPlanId);
    if (!workspaceId || !compositionPlanId) return void sendValidation(response, "Workspace id and composition plan id are required.");
    try { sendOk(response, await executionPlans.readModel.readLatestExecutionPlanForCompositionPlan({ workspaceId, compositionPlanId, includeArchived: asQueryBool(request.query?.archived) })); } catch { sendInternal(response); }
  });

  app.get("/api/execution-plans/workspaces/:workspaceId/runtime-readiness-bindings/:runtimeReadinessBindingId/plans", async (request, response) => {
    const workspaceId = asWorkspaceId(request); const runtimeReadinessBindingId = asText(request.params?.runtimeReadinessBindingId);
    if (!workspaceId || !runtimeReadinessBindingId) return void sendValidation(response, "Workspace id and runtime readiness binding id are required.");
    try { sendOk(response, await executionPlans.readModel.listExecutionPlansForRuntimeReadinessBinding({ workspaceId, runtimeReadinessBindingId, includeArchived: asQueryBool(request.query?.archived) })); } catch { sendInternal(response); }
  });

  app.get("/api/execution-plans/workspaces/:workspaceId/runtime-readiness-bindings/:runtimeReadinessBindingId/latest", async (request, response) => {
    const workspaceId = asWorkspaceId(request); const runtimeReadinessBindingId = asText(request.params?.runtimeReadinessBindingId);
    if (!workspaceId || !runtimeReadinessBindingId) return void sendValidation(response, "Workspace id and runtime readiness binding id are required.");
    try { sendOk(response, await executionPlans.readModel.readLatestExecutionPlanForRuntimeReadinessBinding({ workspaceId, runtimeReadinessBindingId, includeArchived: asQueryBool(request.query?.archived) })); } catch { sendInternal(response); }
  });

  app.get("/api/execution-plans/workspaces/:workspaceId/needing-attention", async (request, response) => {
    const workspaceId = asWorkspaceId(request); if (!workspaceId) return void sendValidation(response, "Workspace id is required.");
    try { sendOk(response, await executionPlans.readModel.listExecutionPlansNeedingAttention({ workspaceId })); } catch { sendInternal(response); }
  });

  app.get("/api/execution-plans/workspaces/:workspaceId/summary", async (request, response) => {
    const workspaceId = asWorkspaceId(request); if (!workspaceId) return void sendValidation(response, "Workspace id is required.");
    try { sendOk(response, await executionPlans.readModel.summarizeWorkspaceExecutionPlans({ workspaceId })); } catch { sendInternal(response); }
  });
}
