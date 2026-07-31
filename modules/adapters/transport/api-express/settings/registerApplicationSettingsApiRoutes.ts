import type {
  ClearSettingUseCase,
  ListSettingsDefinitionsUseCase,
  ReadSettingsUseCase,
  UpdateSettingUseCase,
} from "../../../../application/use-cases";
import { createApiError, createApiFailureResponse, createApiSuccessResponse } from "../../../../contracts/api";
import type {
  ClearApplicationSettingRequest,
  ListApplicationSettingDefinitionsRequest,
  ReadApplicationSettingsRequest,
  UpdateApplicationSettingRequest,
} from "../../../../contracts/settings";

const API_APPLICATION_SETTINGS_LIST_DEFINITIONS_OPERATION = "application-settings.list-definitions" as const;
const API_APPLICATION_SETTINGS_READ_OPERATION = "application-settings.read" as const;
const API_APPLICATION_SETTINGS_UPDATE_OPERATION = "application-settings.update" as const;
const API_APPLICATION_SETTINGS_CLEAR_OPERATION = "application-settings.clear" as const;

type ApplicationSettingsOperation =
  | typeof API_APPLICATION_SETTINGS_LIST_DEFINITIONS_OPERATION
  | typeof API_APPLICATION_SETTINGS_READ_OPERATION
  | typeof API_APPLICATION_SETTINGS_UPDATE_OPERATION
  | typeof API_APPLICATION_SETTINGS_CLEAR_OPERATION;

interface ExpressRequestLike { body?: unknown; headers?: Record<string, string | string[] | undefined>; }
interface ExpressResponseLike { status: (code: number) => ExpressResponseLike; json: (body: unknown) => void; }
export interface ExpressRoutePort { post: (path: string, handler: (request: ExpressRequestLike, response: ExpressResponseLike) => Promise<void>) => void; }

export interface RegisterApplicationSettingsApiRoutesDependencies {
  app: ExpressRoutePort;
  listSettingsDefinitionsUseCase: Pick<ListSettingsDefinitionsUseCase, "execute">;
  readSettingsUseCase: Pick<ReadSettingsUseCase, "execute">;
  updateSettingUseCase: Pick<UpdateSettingUseCase, "execute">;
  clearSettingUseCase: Pick<ClearSettingUseCase, "execute">;
}

const getHeader = (headers: ExpressRequestLike["headers"], key: string) => Array.isArray(headers?.[key]) ? headers?.[key][0] : headers?.[key];
const contextFrom = (request: ExpressRequestLike) => ({ requestId: getHeader(request.headers, "x-request-id"), correlationId: getHeader(request.headers, "x-correlation-id") });
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

function mapFilterBody(body: unknown): ListApplicationSettingDefinitionsRequest & ReadApplicationSettingsRequest {
  if (body === undefined) return {};
  if (!isRecord(body)) throw new Error("Request body must be an object.");
  return body as ListApplicationSettingDefinitionsRequest & ReadApplicationSettingsRequest;
}

function mapUpdateBody(body: unknown): UpdateApplicationSettingRequest {
  if (!isRecord(body)) throw new Error("Request body must be an object.");
  if (typeof body.key !== "string" || body.key.trim().length === 0) throw new Error("key is required.");
  return body as unknown as UpdateApplicationSettingRequest;
}

function mapClearBody(body: unknown): ClearApplicationSettingRequest {
  if (!isRecord(body)) throw new Error("Request body must be an object.");
  if (typeof body.key !== "string" || body.key.trim().length === 0) throw new Error("key is required.");
  return { key: body.key };
}

function failure(operation: ApplicationSettingsOperation, message: string, context: { requestId?: string; correlationId?: string }) {
  return createApiFailureResponse(createApiError(operation, "validation", message, context), context);
}

function statusCode(response: { ok: boolean }): number {
  return response.ok ? 200 : 400;
}

export function registerApplicationSettingsApiRoutes(dependencies: RegisterApplicationSettingsApiRoutesDependencies): void {
  dependencies.app.post("/api/application-settings/list-definitions", async (request, response) => {
    const context = contextFrom(request);
    try {
      const definitions = await dependencies.listSettingsDefinitionsUseCase.execute(mapFilterBody(request.body));
      const apiResponse = createApiSuccessResponse(API_APPLICATION_SETTINGS_LIST_DEFINITIONS_OPERATION, { definitions }, context);
      response.status(statusCode(apiResponse)).json(apiResponse);
    } catch (error) {
      const apiResponse = failure(API_APPLICATION_SETTINGS_LIST_DEFINITIONS_OPERATION, error instanceof Error ? error.message : "Unexpected error.", context);
      response.status(statusCode(apiResponse)).json(apiResponse);
    }
  });

  dependencies.app.post("/api/application-settings/read", async (request, response) => {
    const context = contextFrom(request);
    try {
      const values = await dependencies.readSettingsUseCase.execute(mapFilterBody(request.body));
      const apiResponse = createApiSuccessResponse(API_APPLICATION_SETTINGS_READ_OPERATION, { values }, context);
      response.status(statusCode(apiResponse)).json(apiResponse);
    } catch (error) {
      const apiResponse = failure(API_APPLICATION_SETTINGS_READ_OPERATION, error instanceof Error ? error.message : "Unexpected error.", context);
      response.status(statusCode(apiResponse)).json(apiResponse);
    }
  });

  dependencies.app.post("/api/application-settings/update", async (request, response) => {
    const context = contextFrom(request);
    try {
      const value = await dependencies.updateSettingUseCase.execute(mapUpdateBody(request.body));
      const apiResponse = createApiSuccessResponse(API_APPLICATION_SETTINGS_UPDATE_OPERATION, { value }, context);
      response.status(statusCode(apiResponse)).json(apiResponse);
    } catch (error) {
      const apiResponse = failure(API_APPLICATION_SETTINGS_UPDATE_OPERATION, error instanceof Error ? error.message : "Unexpected error.", context);
      response.status(statusCode(apiResponse)).json(apiResponse);
    }
  });

  dependencies.app.post("/api/application-settings/clear", async (request, response) => {
    const context = contextFrom(request);
    try {
      const value = await dependencies.clearSettingUseCase.execute(mapClearBody(request.body));
      const apiResponse = createApiSuccessResponse(API_APPLICATION_SETTINGS_CLEAR_OPERATION, { value }, context);
      response.status(statusCode(apiResponse)).json(apiResponse);
    } catch (error) {
      const apiResponse = failure(API_APPLICATION_SETTINGS_CLEAR_OPERATION, error instanceof Error ? error.message : "Unexpected error.", context);
      response.status(statusCode(apiResponse)).json(apiResponse);
    }
  });
}
