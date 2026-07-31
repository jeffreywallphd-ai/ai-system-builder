import type { RuntimeReadinessPort } from "../../../../application/ports/runtime";
import type { RuntimeInventoryListQuery } from "../../../../application/ports/runtime-readiness";
import type { CreateRuntimeReadinessBindingUseCase, ValidateRuntimeReadinessBindingUseCase } from "../../../../application/use-cases/runtime-readiness";
import type { RuntimeCapabilityInventoryService, RuntimeCapabilityInventorySummaryService } from "../../../../application/services/runtime-readiness";
import { normalizeRuntimeCapabilityId } from "../../../../contracts/runtime";
import type { CreateRuntimeReadinessBindingCommand, ValidateRuntimeReadinessBindingCommand } from "../../../../contracts/runtime-readiness";
import {
  DESKTOP_RUNTIME_CAPABILITY_STATUS_READ_REQUEST_CHANNEL,
  DESKTOP_RUNTIME_CAPABILITY_STATUS_READ_RESPONSE_CHANNEL,
  DESKTOP_RUNTIME_READINESS_READ_REQUEST_CHANNEL,
  DESKTOP_RUNTIME_READINESS_READ_RESPONSE_CHANNEL,
  createDesktopRuntimeCapabilityStatusReadSuccessResponse,
  createDesktopRuntimeReadinessReadSuccessResponse,
  createIpcError,
  createIpcFailureResponse,
  type DesktopRuntimeCapabilityStatusReadRequest,
  type DesktopRuntimeCapabilityStatusReadResponse,
  type DesktopRuntimeReadinessReadRequest,
  type DesktopRuntimeReadinessReadResponse,
  DESKTOP_RUNTIME_READINESS_REFRESH_INVENTORY_REQUEST_CHANNEL,
  DESKTOP_RUNTIME_READINESS_LIST_INVENTORY_REQUEST_CHANNEL,
  DESKTOP_RUNTIME_READINESS_READ_INVENTORY_REQUEST_CHANNEL,
  DESKTOP_RUNTIME_READINESS_READ_LATEST_INVENTORY_REQUEST_CHANNEL,
  DESKTOP_RUNTIME_READINESS_SUMMARIZE_INVENTORY_REQUEST_CHANNEL,
  DESKTOP_RUNTIME_READINESS_CREATE_BINDING_REQUEST_CHANNEL,
  DESKTOP_RUNTIME_READINESS_VALIDATE_BINDING_REQUEST_CHANNEL,
  DESKTOP_RUNTIME_READINESS_LIST_SUMMARIES_REQUEST_CHANNEL,
  DESKTOP_RUNTIME_READINESS_READ_DETAIL_REQUEST_CHANNEL,
  DESKTOP_RUNTIME_READINESS_LIST_FOR_COMPOSITION_PLAN_REQUEST_CHANNEL,
  DESKTOP_RUNTIME_READINESS_READ_LATEST_FOR_COMPOSITION_PLAN_REQUEST_CHANNEL,
  DESKTOP_RUNTIME_READINESS_LIST_NEEDING_ATTENTION_REQUEST_CHANNEL,
  DESKTOP_RUNTIME_READINESS_SUMMARIZE_WORKSPACE_REQUEST_CHANNEL,
} from "../../../../contracts/ipc";
import type { IpcMainHandlePort } from "../ipcMainHandlePort";

export interface RegisterRuntimeReadinessIpcDependencies {
  ipcMain: IpcMainHandlePort;
  runtimeReadiness: RuntimeReadinessPort;
  runtimeReadinessV2?: {
    inventory: RuntimeCapabilityInventoryService;
    inventorySummary: RuntimeCapabilityInventorySummaryService;
    createBinding: CreateRuntimeReadinessBindingUseCase;
    validateBinding: ValidateRuntimeReadinessBindingUseCase;
    readModel: import("../../../../application/services/runtime-readiness/runtime-readiness-read-model.service").WorkspaceRuntimeReadinessReadModelService;
  };
}

const RUNTIME_READINESS_INTERNAL_ERROR_MESSAGE = "Unable to read runtime readiness.";
const RUNTIME_CAPABILITY_STATUS_INTERNAL_ERROR_MESSAGE = "Unable to read runtime capability status.";


type RuntimeReadinessV2Request = { requestId?: string; correlationId?: string; payload?: Record<string, unknown> };
const ok = <T>(request: RuntimeReadinessV2Request, value: T) => ({ ok: true as const, requestId: request.requestId, correlationId: request.correlationId, value });
const fail = (request: RuntimeReadinessV2Request, code: string, message: string) => ({ ok: false as const, requestId: request.requestId, correlationId: request.correlationId, error: { code, message } });

export function createDesktopRuntimeReadinessReadIpcHandler(
  dependencies: Pick<RegisterRuntimeReadinessIpcDependencies, "runtimeReadiness">,
) {
  return async (
    _event: unknown,
    request: DesktopRuntimeReadinessReadRequest,
  ): Promise<DesktopRuntimeReadinessReadResponse> => {
    try {
      const snapshot = await dependencies.runtimeReadiness.getReadinessSnapshot();
      return createDesktopRuntimeReadinessReadSuccessResponse(snapshot, {
        requestId: request.requestId,
        correlationId: request.correlationId,
      });
    } catch {
      return createIpcFailureResponse(createIpcError(
        DESKTOP_RUNTIME_READINESS_READ_RESPONSE_CHANNEL,
        "internal",
        RUNTIME_READINESS_INTERNAL_ERROR_MESSAGE,
        { requestId: request.requestId, correlationId: request.correlationId },
      ));
    }
  };
}

export function createDesktopRuntimeCapabilityStatusReadIpcHandler(
  dependencies: Pick<RegisterRuntimeReadinessIpcDependencies, "runtimeReadiness">,
) {
  return async (
    _event: unknown,
    request: DesktopRuntimeCapabilityStatusReadRequest,
  ): Promise<DesktopRuntimeCapabilityStatusReadResponse> => {
    let capabilityId;
    try {
      capabilityId = normalizeRuntimeCapabilityId(request.payload.capabilityId);
    } catch {
      return createIpcFailureResponse(createIpcError(
        DESKTOP_RUNTIME_CAPABILITY_STATUS_READ_RESPONSE_CHANNEL,
        "validation",
        "Unknown runtime capability id.",
        {
          details: { field: "capabilityId" },
          requestId: request.requestId,
          correlationId: request.correlationId,
        },
      ));
    }

    try {
      const status = await dependencies.runtimeReadiness.getCapabilityStatus(capabilityId);
      return createDesktopRuntimeCapabilityStatusReadSuccessResponse(status, {
        requestId: request.requestId,
        correlationId: request.correlationId,
      });
    } catch {
      return createIpcFailureResponse(createIpcError(
        DESKTOP_RUNTIME_CAPABILITY_STATUS_READ_RESPONSE_CHANNEL,
        "internal",
        RUNTIME_CAPABILITY_STATUS_INTERNAL_ERROR_MESSAGE,
        { requestId: request.requestId, correlationId: request.correlationId },
      ));
    }
  };
}

export function registerRuntimeReadinessIpc(
  dependencies: RegisterRuntimeReadinessIpcDependencies,
): void {
  dependencies.ipcMain.handle(
    DESKTOP_RUNTIME_READINESS_READ_REQUEST_CHANNEL.value,
    createDesktopRuntimeReadinessReadIpcHandler({ runtimeReadiness: dependencies.runtimeReadiness }),
  );

  dependencies.ipcMain.handle(
    DESKTOP_RUNTIME_CAPABILITY_STATUS_READ_REQUEST_CHANNEL.value,
    createDesktopRuntimeCapabilityStatusReadIpcHandler({ runtimeReadiness: dependencies.runtimeReadiness }),
  );

  if (dependencies.runtimeReadinessV2) {
    const v2 = dependencies.runtimeReadinessV2;
    dependencies.ipcMain.handle(DESKTOP_RUNTIME_READINESS_REFRESH_INVENTORY_REQUEST_CHANNEL.value, async (_e: unknown, request: RuntimeReadinessV2Request) => {
      const workspaceId = request?.payload?.targetWorkspaceId;
      if (!workspaceId) return fail(request, "validation", "Workspace id is required.");
      return ok(request, await v2.inventory.refreshInventoryFromSources(request.payload as { targetWorkspaceId: string; sourceKind?: never; sourceId?: string }));
    });
    dependencies.ipcMain.handle(DESKTOP_RUNTIME_READINESS_LIST_INVENTORY_REQUEST_CHANNEL.value, async (_e: unknown, request: RuntimeReadinessV2Request) => {
      const workspaceId = request?.payload?.targetWorkspaceId; if (!workspaceId) return fail(request, "validation", "Workspace id is required.");
      return ok(request, await v2.inventory.listRuntimeInventory(request.payload as unknown as RuntimeInventoryListQuery));
    });
    dependencies.ipcMain.handle(DESKTOP_RUNTIME_READINESS_READ_INVENTORY_REQUEST_CHANNEL.value, async (_e: unknown, request: RuntimeReadinessV2Request) => {
      if (!request?.payload?.targetWorkspaceId || !request?.payload?.inventorySourceId) return fail(request, "validation", "Workspace id and inventory source id are required.");
      return ok(request, await v2.inventory.readRuntimeInventory(request.payload as { targetWorkspaceId: string; inventorySourceId: string }));
    });
    dependencies.ipcMain.handle(DESKTOP_RUNTIME_READINESS_READ_LATEST_INVENTORY_REQUEST_CHANNEL.value, async (_e: unknown, request: RuntimeReadinessV2Request) => {
      if (!request?.payload?.targetWorkspaceId) return fail(request, "validation", "Workspace id is required.");
      return ok(request, await v2.inventory.readLatestRuntimeInventory(request.payload as { targetWorkspaceId: string; sourceKind?: never; sourceId?: string }));
    });
    dependencies.ipcMain.handle(DESKTOP_RUNTIME_READINESS_SUMMARIZE_INVENTORY_REQUEST_CHANNEL.value, async (_e: unknown, request: RuntimeReadinessV2Request) => {
      if (!request?.payload?.targetWorkspaceId) return fail(request, "validation", "Workspace id is required.");
      return ok(request, await v2.inventorySummary.summarizeRuntimeCapabilities(request.payload as { targetWorkspaceId: string }));
    });
    dependencies.ipcMain.handle(DESKTOP_RUNTIME_READINESS_CREATE_BINDING_REQUEST_CHANNEL.value, async (_e: unknown, request: RuntimeReadinessV2Request) => {
      const p=request?.payload; if (!p?.targetWorkspaceId || !p?.compositionPlanId) return fail(request, "validation", "Workspace id and composition plan id are required.");
      return ok(request, await v2.createBinding.execute(p as unknown as CreateRuntimeReadinessBindingCommand));
    });
    dependencies.ipcMain.handle(DESKTOP_RUNTIME_READINESS_VALIDATE_BINDING_REQUEST_CHANNEL.value, async (_e: unknown, request: RuntimeReadinessV2Request) => {
      const p=request?.payload; if (!p?.targetWorkspaceId || !p?.readinessBindingId) return fail(request, "validation", "Workspace id and readiness binding id are required.");
      return ok(request, await v2.validateBinding.execute(p as unknown as ValidateRuntimeReadinessBindingCommand));
    });

    dependencies.ipcMain.handle(DESKTOP_RUNTIME_READINESS_LIST_SUMMARIES_REQUEST_CHANNEL.value, async (_e: unknown, request: RuntimeReadinessV2Request) => {
      const p=request?.payload; if (!p?.targetWorkspaceId) return fail(request, "validation", "Workspace id is required.");
      try { return ok(request, await v2.readModel.listRuntimeReadinessSummaries(p as any)); } catch { return fail(request, "internal", "Unable to complete request."); }
    });
    dependencies.ipcMain.handle(DESKTOP_RUNTIME_READINESS_READ_DETAIL_REQUEST_CHANNEL.value, async (_e: unknown, request: RuntimeReadinessV2Request) => {
      const p=request?.payload; if (!p?.targetWorkspaceId || !p?.readinessBindingId) return fail(request, "validation", "Workspace id and readiness binding id are required.");
      try { return ok(request, await v2.readModel.readRuntimeReadinessDetail(p as any)); } catch { return fail(request, "internal", "Unable to complete request."); }
    });
    dependencies.ipcMain.handle(DESKTOP_RUNTIME_READINESS_LIST_FOR_COMPOSITION_PLAN_REQUEST_CHANNEL.value, async (_e: unknown, request: RuntimeReadinessV2Request) => {
      const p=request?.payload; if (!p?.targetWorkspaceId || !p?.compositionPlanId) return fail(request, "validation", "Workspace id and composition plan id are required.");
      try { return ok(request, await v2.readModel.listRuntimeReadinessForCompositionPlan(p as any)); } catch { return fail(request, "internal", "Unable to complete request."); }
    });
    dependencies.ipcMain.handle(DESKTOP_RUNTIME_READINESS_READ_LATEST_FOR_COMPOSITION_PLAN_REQUEST_CHANNEL.value, async (_e: unknown, request: RuntimeReadinessV2Request) => {
      const p=request?.payload; if (!p?.targetWorkspaceId || !p?.compositionPlanId) return fail(request, "validation", "Workspace id and composition plan id are required.");
      try { return ok(request, await v2.readModel.readLatestRuntimeReadinessForCompositionPlan(p as any)); } catch { return fail(request, "internal", "Unable to complete request."); }
    });
    dependencies.ipcMain.handle(DESKTOP_RUNTIME_READINESS_LIST_NEEDING_ATTENTION_REQUEST_CHANNEL.value, async (_e: unknown, request: RuntimeReadinessV2Request) => {
      const p=request?.payload; if (!p?.targetWorkspaceId) return fail(request, "validation", "Workspace id is required.");
      try { return ok(request, await v2.readModel.listRuntimeReadinessNeedingAttention(p as any)); } catch { return fail(request, "internal", "Unable to complete request."); }
    });
    dependencies.ipcMain.handle(DESKTOP_RUNTIME_READINESS_SUMMARIZE_WORKSPACE_REQUEST_CHANNEL.value, async (_e: unknown, request: RuntimeReadinessV2Request) => {
      const p=request?.payload; if (!p?.targetWorkspaceId) return fail(request, "validation", "Workspace id is required.");
      try { return ok(request, await v2.readModel.summarizeWorkspaceRuntimeReadiness(p as any)); } catch { return fail(request, "internal", "Unable to complete request."); }
    });
  }

}
