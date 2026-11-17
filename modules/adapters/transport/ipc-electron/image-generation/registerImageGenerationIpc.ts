import { createIpcError, createIpcFailureResponse, createDesktopImageGenerationStartSuccessResponse, createDesktopImageGenerationReadSuccessResponse, createDesktopImageGenerationCancelSuccessResponse, createDesktopImageGenerationFinalizeSuccessResponse, DESKTOP_IMAGE_GENERATION_START_REQUEST_CHANNEL, DESKTOP_IMAGE_GENERATION_READ_REQUEST_CHANNEL, DESKTOP_IMAGE_GENERATION_CANCEL_REQUEST_CHANNEL, DESKTOP_IMAGE_GENERATION_FINALIZE_REQUEST_CHANNEL, DESKTOP_IMAGE_GENERATION_START_RESPONSE_CHANNEL, DESKTOP_IMAGE_GENERATION_READ_RESPONSE_CHANNEL, DESKTOP_IMAGE_GENERATION_CANCEL_RESPONSE_CHANNEL, DESKTOP_IMAGE_GENERATION_FINALIZE_RESPONSE_CHANNEL, type DesktopImageGenerationStartRequest, type DesktopImageGenerationReadRequest, type DesktopImageGenerationCancelRequest, type DesktopImageGenerationFinalizeRequest } from "../../../../contracts/ipc";
import type { GenerateImageUseCase } from "../../../../application/use-cases/image-generation/generate-image.use-case";
import type { ImageGenerationFinalizationOrchestratorService } from "../../../../application/services/image/image-generation-finalization-orchestrator.service";
import { isRuntimeCapabilityUnavailableError } from "../../../../application/services/runtime";
import type { IpcMainHandlePort } from "../ipcMainHandlePort";
import { readStrictPassiveRecord } from "../../../../contracts/shared";

export interface RegisterImageGenerationIpcDependencies { ipcMain: IpcMainHandlePort; generateImageUseCase: Pick<GenerateImageUseCase, "startImageGeneration"|"readImageGeneration"|"cancelImageGeneration">; imageGenerationFinalizationOrchestrator?: Pick<ImageGenerationFinalizationOrchestratorService, "finalizeIfCompleted">; }

const INTERNAL_IMAGE_GENERATION_IPC_FAILURE_MESSAGE = "Image generation request failed.";

export function registerImageGenerationIpc(dependencies: RegisterImageGenerationIpcDependencies): void {
  dependencies.ipcMain.handle(DESKTOP_IMAGE_GENERATION_START_REQUEST_CHANNEL.value, async (_e, request: DesktopImageGenerationStartRequest) => {
    try {
      const fields = readStrictPassiveRecord(request.payload, Object.keys(request.payload));
      const { workspaceId, ...generation } = fields;
      if (typeof generation.prompt !== "string") throw new Error("Image generation prompt must be a string.");
      const value = await dependencies.generateImageUseCase.startImageGeneration({ ...generation, prompt: generation.prompt }, { requestId: request.requestId, correlationId: request.correlationId, workspaceId: typeof workspaceId === "string" ? workspaceId : undefined });
      return createDesktopImageGenerationStartSuccessResponse(value, { requestId: request.requestId, correlationId: request.correlationId });
    }
    catch (error) { const unavailable = isRuntimeCapabilityUnavailableError(error); return createIpcFailureResponse(createIpcError(DESKTOP_IMAGE_GENERATION_START_RESPONSE_CHANNEL, unavailable ? "unavailable" : "internal", unavailable ? "Required runtime capability is not ready." : INTERNAL_IMAGE_GENERATION_IPC_FAILURE_MESSAGE, { details: unavailable ? error.details : undefined, requestId: request.requestId, correlationId: request.correlationId })); }
  });
  dependencies.ipcMain.handle(DESKTOP_IMAGE_GENERATION_READ_REQUEST_CHANNEL.value, async (_e, request: DesktopImageGenerationReadRequest) => {
    try { const value = await dependencies.generateImageUseCase.readImageGeneration(request.payload.requestId, { requestId: request.requestId, correlationId: request.correlationId, workspaceId: request.payload.workspaceId }); return createDesktopImageGenerationReadSuccessResponse(value, { requestId: request.requestId, correlationId: request.correlationId }); }
    catch { return createIpcFailureResponse(createIpcError(DESKTOP_IMAGE_GENERATION_READ_RESPONSE_CHANNEL, "internal", INTERNAL_IMAGE_GENERATION_IPC_FAILURE_MESSAGE, { requestId: request.requestId, correlationId: request.correlationId })); }
  });
  dependencies.ipcMain.handle(DESKTOP_IMAGE_GENERATION_CANCEL_REQUEST_CHANNEL.value, async (_e, request: DesktopImageGenerationCancelRequest) => {
    try { const value = await dependencies.generateImageUseCase.cancelImageGeneration(request.payload.requestId, { requestId: request.requestId, correlationId: request.correlationId, workspaceId: request.payload.workspaceId }); return createDesktopImageGenerationCancelSuccessResponse(value, { requestId: request.requestId, correlationId: request.correlationId }); }
    catch { return createIpcFailureResponse(createIpcError(DESKTOP_IMAGE_GENERATION_CANCEL_RESPONSE_CHANNEL, "internal", INTERNAL_IMAGE_GENERATION_IPC_FAILURE_MESSAGE, { requestId: request.requestId, correlationId: request.correlationId })); }
  });
  dependencies.ipcMain.handle(DESKTOP_IMAGE_GENERATION_FINALIZE_REQUEST_CHANNEL.value, async (_e, request: DesktopImageGenerationFinalizeRequest) => {
    if (!dependencies.imageGenerationFinalizationOrchestrator) return createDesktopImageGenerationFinalizeSuccessResponse({ finalized: false, reason: "image generation finalization is unavailable" }, { requestId: request.requestId, correlationId: request.correlationId });
    try { const value = await dependencies.imageGenerationFinalizationOrchestrator.finalizeIfCompleted(request.payload.requestId, request.payload.workspaceId); return createDesktopImageGenerationFinalizeSuccessResponse(value, { requestId: request.requestId, correlationId: request.correlationId }); }
    catch { return createIpcFailureResponse(createIpcError(DESKTOP_IMAGE_GENERATION_FINALIZE_RESPONSE_CHANNEL, "internal", INTERNAL_IMAGE_GENERATION_IPC_FAILURE_MESSAGE, { requestId: request.requestId, correlationId: request.correlationId })); }
  });
}
