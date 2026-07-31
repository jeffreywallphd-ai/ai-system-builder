import type { ImageGenerationRequest } from "../../../../contracts/image-generation";
import { createApiError, createApiFailureResponse, createApiSuccessResponse } from "../../../../contracts/api";
import type { GenerateImageUseCase } from "../../../../application/use-cases/image-generation/generate-image.use-case";
import type { ImageGenerationFinalizationOrchestratorService } from "../../../../application/services/image/image-generation-finalization-orchestrator.service";
import { isRuntimeCapabilityUnavailableError } from "../../../../application/services/runtime";

const API_IMAGE_GENERATION_START_OPERATION = "image-generation.start" as const;
const API_IMAGE_GENERATION_READ_OPERATION = "image-generation.read" as const;
const API_IMAGE_GENERATION_CANCEL_OPERATION = "image-generation.cancel" as const;
const API_IMAGE_GENERATION_FINALIZE_OPERATION = "image-generation.finalize-if-completed" as const;
const API_IMAGE_GENERATION_UNLOAD_MODEL_OPERATION = "image-generation.unload-model" as const;
const API_IMAGE_GENERATION_RUNTIME_RESOURCES_OPERATION = "image-generation.runtime-resources" as const;

type ImageGenerationOperation = typeof API_IMAGE_GENERATION_START_OPERATION | typeof API_IMAGE_GENERATION_READ_OPERATION | typeof API_IMAGE_GENERATION_CANCEL_OPERATION | typeof API_IMAGE_GENERATION_FINALIZE_OPERATION | typeof API_IMAGE_GENERATION_UNLOAD_MODEL_OPERATION | typeof API_IMAGE_GENERATION_RUNTIME_RESOURCES_OPERATION;

interface ExpressRequestLike { body?: unknown; headers?: Record<string, string | string[] | undefined>; }
interface ExpressResponseLike { status: (code: number) => ExpressResponseLike; json: (body: unknown) => void; }
export interface ExpressRoutePort { post: (path: string, handler: (request: ExpressRequestLike, response: ExpressResponseLike) => Promise<void>) => void; get?: (path: string, handler: (request: any, response: any) => Promise<void>) => void; }
interface ImageGenerationRouteLogger { info: (event: string, data: Record<string, unknown>) => void; warn: (event: string, data: Record<string, unknown>) => void; }

export interface RegisterImageGenerationApiRoutesDependencies {
  app: ExpressRoutePort;
  logger?: ImageGenerationRouteLogger;
  generateImageUseCase: Pick<GenerateImageUseCase, "startImageGeneration" | "readImageGeneration" | "cancelImageGeneration">;
  imageGenerationFinalizationOrchestrator?: Pick<ImageGenerationFinalizationOrchestratorService, "finalizeIfCompleted">;
  imageGenerationRuntimeControl?: {
    unloadModel: () => Promise<{ unloaded: boolean; message?: string }>;
    readRuntimeResources?: () => Promise<{ memoryUsagePercent: number; cpuUsagePercent: number; gpuUsagePercent: number }>;
  };
}

const getHeader = (h: ExpressRequestLike["headers"], k: string) => Array.isArray(h?.[k]) ? h?.[k][0] : h?.[k];
const contextFrom = (r: ExpressRequestLike) => ({ requestId: getHeader(r.headers, "x-request-id"), correlationId: getHeader(r.headers, "x-correlation-id"), clientSource: getHeader(r.headers, "x-client-source"), workspaceId: isObjectRecord(r.body) && typeof r.body.workspaceId === "string" ? r.body.workspaceId : undefined });

const isObjectRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

function mapStartBody(body: unknown): ImageGenerationRequest {
  if (!isObjectRecord(body)) throw new Error("Request body must be an object.");
  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  if (!prompt) throw new Error("prompt is required.");
  return { ...body, prompt } as ImageGenerationRequest;
}

function mapRequestIdBody(body: unknown): string {
  if (!isObjectRecord(body)) throw new Error("Request body must be an object.");
  const requestId = typeof body.requestId === "string" ? body.requestId.trim() : "";
  if (!requestId) throw new Error("requestId is required.");
  return requestId;
}
function failure(operation: ImageGenerationOperation, code: "internal" | "validation" | "not-found" | "unavailable", message: string, context: { requestId?: string; correlationId?: string }, details?: Record<string, unknown>) {
  return createApiFailureResponse(createApiError(operation, code, message, { ...context, details }), context);
}

function statusCode(response: { ok: boolean; error?: { code: string } }): number {
  if (response.ok) return 200;
  switch (response.error?.code) {
    case "validation": return 400;
    case "not-found": return 404;
    case "unavailable": return 503;
    default: return 500;
  }
}

function mapFailureCode(error: unknown): "internal" | "validation" | "not-found" | "unavailable" {
  if (error instanceof Error && (error.message.includes("required") || error.message.includes("body"))) return "validation";
  if (error instanceof Error && /ComfyUI install failed|ComfyUI runtime failed|runtime is not ready/i.test(error.message)) return "unavailable";
  if (typeof error === "object" && error && "code" in error) {
    const code = (error as { code?: string }).code;
    if (code === "validation" || code === "not-found" || code === "unavailable") return code;
  }
  return "internal";
}

function safeFailureMessage(code: "internal" | "validation" | "not-found" | "unavailable", error: unknown): string {
  if (code === "unavailable") return "ComfyUI runtime is not ready.";
  if (code === "validation") return error instanceof Error ? error.message : "Request validation failed.";
  if (code === "not-found") return "Image generation request was not found.";
  return "Image generation request failed.";
}

function summarizeRequestBody(body: unknown): Record<string, unknown> {
  const record = isObjectRecord(body) ? body : {};
  return {
    requestId: typeof record.requestId === "string" ? record.requestId : undefined,
    workspaceId: typeof record.workspaceId === "string" ? record.workspaceId : undefined,
    hasPrompt: typeof record.prompt === "string" && record.prompt.trim().length > 0,
    model: typeof record.model === "string" ? record.model : undefined,
    width: typeof record.width === "number" ? record.width : undefined,
    height: typeof record.height === "number" ? record.height : undefined,
    numImages: typeof record.numImages === "number" ? record.numImages : undefined,
  };
}

function summarizeResult(value: unknown): Record<string, unknown> {
  if (!isObjectRecord(value)) return {};
  return {
    requestId: typeof value.requestId === "string" ? value.requestId : undefined,
    status: typeof value.status === "string" ? value.status : undefined,
    finalized: typeof value.finalized === "boolean" ? value.finalized : undefined,
    assetCount: Array.isArray(value.assets) ? value.assets.length : undefined,
    cancelled: typeof value.cancelled === "boolean" ? value.cancelled : undefined,
    unloaded: typeof value.unloaded === "boolean" ? value.unloaded : undefined,
  };
}

function logReceived(dependencies: RegisterImageGenerationApiRoutesDependencies, operation: ImageGenerationOperation, request: ExpressRequestLike, startedAt: number) {
  dependencies.logger?.info("api.image-generation.request.received", { operation, elapsedMs: Date.now() - startedAt, ...summarizeRequestBody(request.body), ...contextFrom(request) });
}

function logSucceeded(dependencies: RegisterImageGenerationApiRoutesDependencies, operation: ImageGenerationOperation, request: ExpressRequestLike, value: unknown, startedAt: number) {
  dependencies.logger?.info("api.image-generation.request.succeeded", { operation, ...summarizeResult(value), elapsedMs: Date.now() - startedAt, ...contextFrom(request) });
}

function logFailed(dependencies: RegisterImageGenerationApiRoutesDependencies, operation: ImageGenerationOperation, request: ExpressRequestLike, code: string, message: string, details: Record<string, unknown> | undefined, startedAt: number) {
  dependencies.logger?.warn("api.image-generation.request.failed", { operation, code, message, details, elapsedMs: Date.now() - startedAt, ...summarizeRequestBody(request.body), ...contextFrom(request) });
}

export function registerImageGenerationApiRoutes(dependencies: RegisterImageGenerationApiRoutesDependencies): void {
  dependencies.app.post("/api/image-generation/start", async (request, response) => {
    const startedAt = Date.now();
    const context = contextFrom(request);
    logReceived(dependencies, API_IMAGE_GENERATION_START_OPERATION, request, startedAt);
    try {
      const value = await dependencies.generateImageUseCase.startImageGeneration(mapStartBody(request.body), context);
      const apiResponse = createApiSuccessResponse(API_IMAGE_GENERATION_START_OPERATION, value, context);
      logSucceeded(dependencies, API_IMAGE_GENERATION_START_OPERATION, request, value, startedAt);
      response.status(statusCode(apiResponse)).json(apiResponse);
    } catch (error) {
      const unavailable = isRuntimeCapabilityUnavailableError(error);
      const code = unavailable ? "unavailable" : mapFailureCode(error);
      const message = safeFailureMessage(code, error);
      const details = unavailable ? error.details : undefined;
      logFailed(dependencies, API_IMAGE_GENERATION_START_OPERATION, request, code, message, details, startedAt);
      const apiResponse = failure(API_IMAGE_GENERATION_START_OPERATION, code, message, context, details);
      response.status(statusCode(apiResponse)).json(apiResponse);
    }
  });

  dependencies.app.post("/api/image-generation/read", async (request, response) => {
    const startedAt = Date.now();
    const context = contextFrom(request);
    logReceived(dependencies, API_IMAGE_GENERATION_READ_OPERATION, request, startedAt);
    try {
      const value = await dependencies.generateImageUseCase.readImageGeneration(mapRequestIdBody(request.body), context);
      const apiResponse = createApiSuccessResponse(API_IMAGE_GENERATION_READ_OPERATION, value, context);
      logSucceeded(dependencies, API_IMAGE_GENERATION_READ_OPERATION, request, value, startedAt);
      response.status(statusCode(apiResponse)).json(apiResponse);
    } catch (error) {
      const code = mapFailureCode(error);
      const message = safeFailureMessage(code, error);
      logFailed(dependencies, API_IMAGE_GENERATION_READ_OPERATION, request, code, message, undefined, startedAt);
      const apiResponse = failure(API_IMAGE_GENERATION_READ_OPERATION, code, message, context);
      response.status(statusCode(apiResponse)).json(apiResponse);
    }
  });

  dependencies.app.post("/api/image-generation/cancel", async (request, response) => {
    const startedAt = Date.now();
    const context = contextFrom(request);
    logReceived(dependencies, API_IMAGE_GENERATION_CANCEL_OPERATION, request, startedAt);
    try {
      const value = await dependencies.generateImageUseCase.cancelImageGeneration(mapRequestIdBody(request.body), context);
      const apiResponse = createApiSuccessResponse(API_IMAGE_GENERATION_CANCEL_OPERATION, value, context);
      logSucceeded(dependencies, API_IMAGE_GENERATION_CANCEL_OPERATION, request, value, startedAt);
      response.status(statusCode(apiResponse)).json(apiResponse);
    } catch (error) {
      const code = mapFailureCode(error);
      const message = safeFailureMessage(code, error);
      logFailed(dependencies, API_IMAGE_GENERATION_CANCEL_OPERATION, request, code, message, undefined, startedAt);
      const apiResponse = failure(API_IMAGE_GENERATION_CANCEL_OPERATION, code, message, context);
      response.status(statusCode(apiResponse)).json(apiResponse);
    }
  });

  dependencies.app.post("/api/image-generation/finalize", async (request, response) => {
    const startedAt = Date.now();
    const context = contextFrom(request);
    logReceived(dependencies, API_IMAGE_GENERATION_FINALIZE_OPERATION, request, startedAt);
    try {
      const requestId = mapRequestIdBody(request.body);
      if (!dependencies.imageGenerationFinalizationOrchestrator) {
        const apiResponse = createApiSuccessResponse(API_IMAGE_GENERATION_FINALIZE_OPERATION, { finalized: false, reason: "image generation finalization is unavailable" }, context);
        logSucceeded(dependencies, API_IMAGE_GENERATION_FINALIZE_OPERATION, request, apiResponse.value, startedAt);
        response.status(statusCode(apiResponse)).json(apiResponse);
        return;
      }

      const value = await dependencies.imageGenerationFinalizationOrchestrator.finalizeIfCompleted(requestId, context.workspaceId ?? "");
      const apiResponse = createApiSuccessResponse(API_IMAGE_GENERATION_FINALIZE_OPERATION, value, context);
      logSucceeded(dependencies, API_IMAGE_GENERATION_FINALIZE_OPERATION, request, value, startedAt);
      response.status(statusCode(apiResponse)).json(apiResponse);
    } catch (error) {
      const code = mapFailureCode(error);
      const message = safeFailureMessage(code, error);
      logFailed(dependencies, API_IMAGE_GENERATION_FINALIZE_OPERATION, request, code, message, undefined, startedAt);
      const apiResponse = failure(API_IMAGE_GENERATION_FINALIZE_OPERATION, code, message, context);
      response.status(statusCode(apiResponse)).json(apiResponse);
    }
  });

  dependencies.app.post("/api/image-generation/unload-model", async (request, response) => {
    const startedAt = Date.now();
    const context = contextFrom(request);
    logReceived(dependencies, API_IMAGE_GENERATION_UNLOAD_MODEL_OPERATION, request, startedAt);
    try {
      if (!dependencies.imageGenerationRuntimeControl) {
        const apiResponse = failure(API_IMAGE_GENERATION_UNLOAD_MODEL_OPERATION, "unavailable", "Image generation runtime control is unavailable.", context);
        logFailed(dependencies, API_IMAGE_GENERATION_UNLOAD_MODEL_OPERATION, request, "unavailable", "Image generation runtime control is unavailable.", undefined, startedAt);
        response.status(statusCode(apiResponse)).json(apiResponse);
        return;
      }
      const value = await dependencies.imageGenerationRuntimeControl.unloadModel();
      const apiResponse = createApiSuccessResponse(API_IMAGE_GENERATION_UNLOAD_MODEL_OPERATION, value, context);
      logSucceeded(dependencies, API_IMAGE_GENERATION_UNLOAD_MODEL_OPERATION, request, value, startedAt);
      response.status(statusCode(apiResponse)).json(apiResponse);
    } catch (error) {
      const code = mapFailureCode(error);
      const message = safeFailureMessage(code, error);
      logFailed(dependencies, API_IMAGE_GENERATION_UNLOAD_MODEL_OPERATION, request, code, message, undefined, startedAt);
      const apiResponse = failure(API_IMAGE_GENERATION_UNLOAD_MODEL_OPERATION, code, message, context);
      response.status(statusCode(apiResponse)).json(apiResponse);
    }
  });

  dependencies.app.post("/api/image-generation/runtime-resources", async (request, response) => {
    const startedAt = Date.now();
    const context = contextFrom(request);
    logReceived(dependencies, API_IMAGE_GENERATION_RUNTIME_RESOURCES_OPERATION, request, startedAt);
    try {
      const value = await dependencies.imageGenerationRuntimeControl?.readRuntimeResources?.() ?? { memoryUsagePercent: 0, cpuUsagePercent: 0, gpuUsagePercent: 0 };
      const apiResponse = createApiSuccessResponse(API_IMAGE_GENERATION_RUNTIME_RESOURCES_OPERATION, value, context);
      logSucceeded(dependencies, API_IMAGE_GENERATION_RUNTIME_RESOURCES_OPERATION, request, value, startedAt);
      response.status(statusCode(apiResponse)).json(apiResponse);
    } catch (error) {
      const code = mapFailureCode(error);
      const message = safeFailureMessage(code, error);
      logFailed(dependencies, API_IMAGE_GENERATION_RUNTIME_RESOURCES_OPERATION, request, code, message, undefined, startedAt);
      const apiResponse = failure(API_IMAGE_GENERATION_RUNTIME_RESOURCES_OPERATION, code, message, context);
      response.status(statusCode(apiResponse)).json(apiResponse);
    }
  });
}
