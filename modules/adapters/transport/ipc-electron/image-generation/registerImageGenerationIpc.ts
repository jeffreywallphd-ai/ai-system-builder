import { createIpcError, createIpcFailureResponse, createDesktopImageGenerationStartSuccessResponse, createDesktopImageGenerationReadSuccessResponse, createDesktopImageGenerationCancelSuccessResponse, createDesktopImageGenerationFinalizeSuccessResponse, DESKTOP_IMAGE_GENERATION_START_REQUEST_CHANNEL, DESKTOP_IMAGE_GENERATION_READ_REQUEST_CHANNEL, DESKTOP_IMAGE_GENERATION_CANCEL_REQUEST_CHANNEL, DESKTOP_IMAGE_GENERATION_FINALIZE_REQUEST_CHANNEL, DESKTOP_IMAGE_GENERATION_START_RESPONSE_CHANNEL, DESKTOP_IMAGE_GENERATION_READ_RESPONSE_CHANNEL, DESKTOP_IMAGE_GENERATION_CANCEL_RESPONSE_CHANNEL, DESKTOP_IMAGE_GENERATION_FINALIZE_RESPONSE_CHANNEL, type DesktopImageGenerationStartRequest, type DesktopImageGenerationReadRequest, type DesktopImageGenerationCancelRequest, type DesktopImageGenerationFinalizeRequest } from "../../../../contracts/ipc";
import type { GenerateImageUseCase } from "../../../../application/use-cases/image-generation/generate-image.use-case";
import type { ImageGenerationFinalizationOrchestratorService } from "../../../../application/services/image/image-generation-finalization-orchestrator.service";
import type { IpcMainHandlePort } from "../ipcMainHandlePort";

export interface RegisterImageGenerationIpcDependencies { ipcMain: IpcMainHandlePort; generateImageUseCase: Pick<GenerateImageUseCase, "startImageGeneration"|"readImageGeneration"|"cancelImageGeneration">; imageGenerationFinalizationOrchestrator?: Pick<ImageGenerationFinalizationOrchestratorService, "finalizeIfCompleted">; }

export function registerImageGenerationIpc(dependencies: RegisterImageGenerationIpcDependencies): void {
  dependencies.ipcMain.handle(DESKTOP_IMAGE_GENERATION_START_REQUEST_CHANNEL.value, async (_e, request: DesktopImageGenerationStartRequest) => {
    try { const value = await dependencies.generateImageUseCase.startImageGeneration(request.payload, { requestId: request.requestId, correlationId: request.correlationId }); return createDesktopImageGenerationStartSuccessResponse(value, { requestId: request.requestId, correlationId: request.correlationId }); }
    catch (error) { return createIpcFailureResponse(createIpcError(DESKTOP_IMAGE_GENERATION_START_RESPONSE_CHANNEL, "internal", (error as Error).message, { requestId: request.requestId, correlationId: request.correlationId })); }
  });
  dependencies.ipcMain.handle(DESKTOP_IMAGE_GENERATION_READ_REQUEST_CHANNEL.value, async (_e, request: DesktopImageGenerationReadRequest) => {
    try { const value = await dependencies.generateImageUseCase.readImageGeneration(request.payload.requestId, { requestId: request.requestId, correlationId: request.correlationId }); return createDesktopImageGenerationReadSuccessResponse(value, { requestId: request.requestId, correlationId: request.correlationId }); }
    catch (error) { return createIpcFailureResponse(createIpcError(DESKTOP_IMAGE_GENERATION_READ_RESPONSE_CHANNEL, "internal", (error as Error).message, { requestId: request.requestId, correlationId: request.correlationId })); }
  });
  dependencies.ipcMain.handle(DESKTOP_IMAGE_GENERATION_CANCEL_REQUEST_CHANNEL.value, async (_e, request: DesktopImageGenerationCancelRequest) => {
    try { const value = await dependencies.generateImageUseCase.cancelImageGeneration(request.payload.requestId, { requestId: request.requestId, correlationId: request.correlationId }); return createDesktopImageGenerationCancelSuccessResponse(value, { requestId: request.requestId, correlationId: request.correlationId }); }
    catch (error) { return createIpcFailureResponse(createIpcError(DESKTOP_IMAGE_GENERATION_CANCEL_RESPONSE_CHANNEL, "internal", (error as Error).message, { requestId: request.requestId, correlationId: request.correlationId })); }
  });
  dependencies.ipcMain.handle(DESKTOP_IMAGE_GENERATION_FINALIZE_REQUEST_CHANNEL.value, async (_e, request: DesktopImageGenerationFinalizeRequest) => {
    if (!dependencies.imageGenerationFinalizationOrchestrator) return createDesktopImageGenerationFinalizeSuccessResponse({ finalized: false, reason: "image generation finalization is unavailable" }, { requestId: request.requestId, correlationId: request.correlationId });
    try { const value = await dependencies.imageGenerationFinalizationOrchestrator.finalizeIfCompleted(request.payload.requestId); return createDesktopImageGenerationFinalizeSuccessResponse(value, { requestId: request.requestId, correlationId: request.correlationId }); }
    catch (error) { return createIpcFailureResponse(createIpcError(DESKTOP_IMAGE_GENERATION_FINALIZE_RESPONSE_CHANNEL, "internal", (error as Error).message, { requestId: request.requestId, correlationId: request.correlationId })); }
  });
}
