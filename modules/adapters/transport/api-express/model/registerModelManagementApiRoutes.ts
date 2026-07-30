import type { BrowseModelsUseCase, DeleteModelRecordUseCase, DownloadModelUseCase, GetModelDetailsUseCase, ListModelsUseCase, ModelDownloadTasksUseCase, PublishModelUseCase, SaveModelReferenceUseCase, UpdateModelRecordUseCase, ValidateModelUseCase } from "../../../../application/use-cases/model";
import { createApiError, createApiFailureResponse, createApiSuccessResponse } from "../../../../contracts/api";
import { isRuntimeCapabilityUnavailableError } from "../../../../application/services/runtime";
import {
  normalizeBrowseModelsRequest,
  normalizeDeleteModelRecordRequest,
  normalizeDownloadModelRequest,
  normalizeListModelDownloadTasksRequest,
  normalizeModelDownloadTaskIdentity,
  normalizeGetModelDetailsRequest,
  normalizeListModelsRequest,
  normalizePublishModelRequest,
  normalizeSaveModelReferenceRequest,
  normalizeUpdateModelRecordRequest,
  normalizeValidateModelRequest,
  type BrowseModelsRequest,
  type DeleteModelRecordRequest,
  type DownloadModelRequest,
  type ListModelDownloadTasksRequest,
  type ReadModelDownloadTaskRequest,
  type GetModelDetailsRequest,
  type ListModelsRequest,
  type PublishModelRequest,
  type SaveModelReferenceRequest,
  type UpdateModelRecordRequest,
  type ValidateModelRequest,
} from "../../../../contracts/model";

interface ExpressRequestLike { body?: unknown; headers?: Record<string, string | string[] | undefined>; }
interface ExpressResponseLike { status: (code: number) => ExpressResponseLike; json: (body: unknown) => void; }
export interface ModelManagementExpressRoutePort { post: (path: string, handler: (request: ExpressRequestLike, response: ExpressResponseLike) => Promise<void>) => void; }
interface ModelRouteLogger { info: (event: string, data: Record<string, unknown>) => void; warn: (event: string, data: Record<string, unknown>) => void; }
export interface RegisterModelManagementApiRoutesDependencies { app: ModelManagementExpressRoutePort; logger?: ModelRouteLogger; browseModelsUseCase: Pick<BrowseModelsUseCase, "execute">; getModelDetailsUseCase: Pick<GetModelDetailsUseCase, "execute">; listModelsUseCase: Pick<ListModelsUseCase, "execute">; saveModelReferenceUseCase: Pick<SaveModelReferenceUseCase, "execute">; downloadModelUseCase: Pick<DownloadModelUseCase, "execute">; modelDownloadTasksUseCase?: Pick<ModelDownloadTasksUseCase, "start" | "read" | "list" | "cancel">; updateModelRecordUseCase: Pick<UpdateModelRecordUseCase, "execute">; deleteModelRecordUseCase: Pick<DeleteModelRecordUseCase, "execute">; validateModelUseCase?: Pick<ValidateModelUseCase, "execute">; publishModelUseCase?: Pick<PublishModelUseCase, "execute">; }

class ModelManagementApiValidationError extends Error {}
const getHeader = (h: ExpressRequestLike["headers"], k: string) => Array.isArray(h?.[k]) ? h?.[k][0] : h?.[k];
const contextFrom = (r: ExpressRequestLike) => ({ requestId: getHeader(r.headers, "x-request-id"), correlationId: getHeader(r.headers, "x-correlation-id"), clientSource: getHeader(r.headers, "x-client-source") });
const isObjectRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

function requireBodyObject(body: unknown): Record<string, unknown> {
  if (!isObjectRecord(body)) throw new ModelManagementApiValidationError("Request body must be an object.");
  return body;
}

function mapWithContractNormalizer<T>(body: unknown, normalize: (request: T) => T): T {
  try {
    return normalize(requireBodyObject(body) as T);
  } catch (error) {
    if (error instanceof ModelManagementApiValidationError) throw error;
    throw new ModelManagementApiValidationError(error instanceof Error ? error.message : "Invalid request body.");
  }
}

const mapBrowseModelsApiRequestToCommand = (body: unknown): BrowseModelsRequest => mapWithContractNormalizer(body, normalizeBrowseModelsRequest);
const mapGetModelDetailsApiRequestToCommand = (body: unknown): GetModelDetailsRequest => mapWithContractNormalizer(body, normalizeGetModelDetailsRequest);
const mapListModelsApiRequestToCommand = (body: unknown): ListModelsRequest => mapWithContractNormalizer(body, normalizeListModelsRequest);
const mapSaveModelReferenceApiRequestToCommand = (body: unknown): SaveModelReferenceRequest => mapWithContractNormalizer(body, normalizeSaveModelReferenceRequest);
const mapDownloadModelApiRequestToCommand = (body: unknown): DownloadModelRequest => mapWithContractNormalizer(body, normalizeDownloadModelRequest);
const mapReadModelDownloadTaskRequest = (body: unknown): ReadModelDownloadTaskRequest => mapWithContractNormalizer(body, normalizeModelDownloadTaskIdentity);
const mapListModelDownloadTasksRequest = (body: unknown): ListModelDownloadTasksRequest => mapWithContractNormalizer(body, normalizeListModelDownloadTasksRequest);
const mapUpdateModelRecordApiRequestToCommand = (body: unknown): UpdateModelRecordRequest => mapWithContractNormalizer(body, normalizeUpdateModelRecordRequest);
const mapDeleteModelRecordApiRequestToCommand = (body: unknown): DeleteModelRecordRequest => mapWithContractNormalizer(body, normalizeDeleteModelRecordRequest);
const mapValidateModelApiRequestToCommand = (body: unknown): ValidateModelRequest => mapWithContractNormalizer(body, normalizeValidateModelRequest);
const mapPublishModelApiRequestToCommand = (body: unknown): PublishModelRequest => mapWithContractNormalizer(body, normalizePublishModelRequest);

const mapFailureCode = (error: unknown): "internal" | "validation" | "not-found" | "unavailable" => {
  if (isRuntimeCapabilityUnavailableError(error)) return "unavailable";
  if (error instanceof ModelManagementApiValidationError) return "validation";
  if (typeof error === "object" && error && "code" in error) {
    const code = (error as { code?: string }).code;
    if (code === "validation" || code === "not-found" || code === "unavailable") return code;
  }
  return "internal";
};
const statusCode = (response: { ok: boolean; error?: { code: string } }) => response.ok ? 200 : response.error?.code === "validation" ? 400 : response.error?.code === "not-found" ? 404 : response.error?.code === "unavailable" ? 503 : 500;

const safeFailureMessage = (code: "internal" | "validation" | "not-found" | "unavailable", error: unknown): string => {
  if (code === "unavailable") return "Required runtime capability is not ready.";
  if (code === "validation") return error instanceof Error ? error.message : "Request validation failed.";
  if (code === "not-found") return "Model resource was not found.";
  return "Model management request failed.";
};

function summarizeBody(body: unknown): Record<string, unknown> {
  const record = isObjectRecord(body) ? body : {};
  return {
    provider: typeof record.provider === "string" ? record.provider : undefined,
    query: typeof record.query === "string" ? record.query.trim() : undefined,
    modelId: typeof record.modelId === "string" ? record.modelId.trim() : undefined,
    modelRecordId: typeof record.modelRecordId === "string" ? record.modelRecordId.trim() : undefined,
  };
}

function summarizeResult(operation: string, value: unknown): Record<string, unknown> {
  if (!isObjectRecord(value)) return {};
  if (operation === "model.browse" || operation === "model.list") {
    return { resultCount: Array.isArray(value.models) ? value.models.length : undefined };
  }
  if (operation === "model.download") {
    const download = isObjectRecord(value.download) ? value.download : {};
    const model = isObjectRecord(value.model) ? value.model : {};
    return {
      modelId: typeof download.modelId === "string" ? download.modelId : undefined,
      modelRecordId: typeof model.modelRecordId === "string" ? model.modelRecordId : undefined,
      downloaded: typeof download.downloaded === "boolean" ? download.downloaded : undefined,
      fromCache: typeof download.fromCache === "boolean" ? download.fromCache : undefined,
    };
  }
  return {
    modelId: typeof value.modelId === "string" ? value.modelId : undefined,
    modelRecordId: typeof value.modelRecordId === "string" ? value.modelRecordId : undefined,
  };
}

function registerRoute(app: ModelManagementExpressRoutePort, logger: ModelRouteLogger | undefined, path: string, operation: `${Lowercase<string>}.${Lowercase<string>}`, execute: (body: unknown) => Promise<unknown>) {
  app.post(path, async (request, response) => {
    const startedAt = Date.now();
    const context = contextFrom(request);
    const requestSummary = summarizeBody(request.body);
    logger?.info("api.model.request.received", { operation, ...requestSummary, ...context });
    try {
      const value = await execute(request.body);
      const apiResponse = createApiSuccessResponse(operation, value, context);
      logger?.info("api.model.request.succeeded", { operation, ...summarizeResult(operation, value), elapsedMs: Date.now() - startedAt, ...context });
      response.status(statusCode(apiResponse)).json(apiResponse);
    } catch (error) {
      const code = mapFailureCode(error);
      const message = safeFailureMessage(code, error);
      const details = typeof error === "object" && error !== null && "details" in error && isObjectRecord((error as { details?: unknown }).details)
        ? (error as { details: Record<string, unknown> }).details
        : undefined;
      const safeDetails = isRuntimeCapabilityUnavailableError(error)
        ? error.details
        : (code === "validation" || code === "not-found" ? details : undefined);
      logger?.warn("api.model.request.failed", { operation, code, message, details: safeDetails, elapsedMs: Date.now() - startedAt, ...requestSummary, ...context });
      const apiResponse = createApiFailureResponse(createApiError(operation, code, message, { ...context, details: isRuntimeCapabilityUnavailableError(error) ? safeDetails : undefined }), context);
      response.status(statusCode(apiResponse)).json(apiResponse);
    }
  });
}

export function registerModelManagementApiRoutes(dependencies: RegisterModelManagementApiRoutesDependencies): void {
  registerRoute(dependencies.app, dependencies.logger, "/api/model/browse", "model.browse", async (body) => dependencies.browseModelsUseCase.execute(mapBrowseModelsApiRequestToCommand(body)));
  registerRoute(dependencies.app, dependencies.logger, "/api/model/details", "model.details", async (body) => dependencies.getModelDetailsUseCase.execute(mapGetModelDetailsApiRequestToCommand(body)));
  registerRoute(dependencies.app, dependencies.logger, "/api/model/list", "model.list", async (body) => dependencies.listModelsUseCase.execute(mapListModelsApiRequestToCommand(body)));
  registerRoute(dependencies.app, dependencies.logger, "/api/model/reference/save", "model.reference.save", async (body) => dependencies.saveModelReferenceUseCase.execute(mapSaveModelReferenceApiRequestToCommand(body)));
  registerRoute(dependencies.app, dependencies.logger, "/api/model/download", "model.download", async (body) => dependencies.downloadModelUseCase.execute(mapDownloadModelApiRequestToCommand(body)));
  const modelDownloadTasksUseCase = dependencies.modelDownloadTasksUseCase;
  if (modelDownloadTasksUseCase) {
    registerRoute(dependencies.app, dependencies.logger, "/api/model/download/start", "model.download-start", async (body) => modelDownloadTasksUseCase.start(mapDownloadModelApiRequestToCommand(body)));
    registerRoute(dependencies.app, dependencies.logger, "/api/model/download/read", "model.download-read", async (body) => modelDownloadTasksUseCase.read(mapReadModelDownloadTaskRequest(body)));
    registerRoute(dependencies.app, dependencies.logger, "/api/model/download/list", "model.download-list", async (body) => modelDownloadTasksUseCase.list(mapListModelDownloadTasksRequest(body)));
    registerRoute(dependencies.app, dependencies.logger, "/api/model/download/cancel", "model.download-cancel", async (body) => modelDownloadTasksUseCase.cancel(mapReadModelDownloadTaskRequest(body)));
  }
  registerRoute(dependencies.app, dependencies.logger, "/api/model/record/update", "model.record.update", async (body) => dependencies.updateModelRecordUseCase.execute(mapUpdateModelRecordApiRequestToCommand(body)));
  registerRoute(dependencies.app, dependencies.logger, "/api/model/record/delete", "model.record.delete", async (body) => dependencies.deleteModelRecordUseCase.execute(mapDeleteModelRecordApiRequestToCommand(body)));
  const validateModelUseCase = dependencies.validateModelUseCase;
  if (validateModelUseCase) {
    registerRoute(dependencies.app, dependencies.logger, "/api/model/validate", "model.validate", async (body) => validateModelUseCase.execute(mapValidateModelApiRequestToCommand(body)));
  }
  const publishModelUseCase = dependencies.publishModelUseCase;
  if (publishModelUseCase) {
    registerRoute(dependencies.app, dependencies.logger, "/api/model/publish", "model.publish", async (body) => publishModelUseCase.execute(mapPublishModelApiRequestToCommand(body)));
  }
}
