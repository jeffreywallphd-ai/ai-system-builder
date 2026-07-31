import { createApiError, createApiFailureResponse, createApiSuccessResponse } from "../../../../contracts/api";

const API_SERVER_RESTART_OPERATION = "server.restart" as const;

interface ExpressRequestLike { headers?: Record<string, string | string[] | undefined>; }
interface ExpressResponseLike { status: (code: number) => ExpressResponseLike; json: (body: unknown) => void; }
export interface ExpressRoutePort { post: (path: string, handler: (request: ExpressRequestLike, response: ExpressResponseLike) => Promise<void>) => void; }

export interface RegisterServerControlApiRoutesDependencies {
  app: ExpressRoutePort;
  restartServer?: () => void | Promise<void>;
}

const getHeader = (headers: ExpressRequestLike["headers"], key: string) => Array.isArray(headers?.[key]) ? headers?.[key][0] : headers?.[key];
const contextFrom = (request: ExpressRequestLike) => ({ requestId: getHeader(request.headers, "x-request-id"), correlationId: getHeader(request.headers, "x-correlation-id") });

export function registerServerControlApiRoutes(dependencies: RegisterServerControlApiRoutesDependencies): void {
  dependencies.app.post("/api/server/restart", async (request, response) => {
    const context = contextFrom(request);
    if (!dependencies.restartServer) {
      const apiResponse = createApiFailureResponse(
        createApiError(API_SERVER_RESTART_OPERATION, "unavailable", "Server restart is unavailable for this host process.", context),
        context,
      );
      response.status(503).json(apiResponse);
      return;
    }

    const apiResponse = createApiSuccessResponse(API_SERVER_RESTART_OPERATION, { restartRequested: true }, context);
    response.status(202).json(apiResponse);
    setTimeout(() => {
      void dependencies.restartServer?.();
    }, 50);
  });
}
