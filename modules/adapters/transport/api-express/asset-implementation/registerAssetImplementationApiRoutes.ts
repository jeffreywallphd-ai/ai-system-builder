import type {
  ListAssetImplementationReleasesUseCase,
  ResolveAssetImplementationUseCase,
} from "../../../../application/use-cases/asset-implementation";
import { normalizeAssetImplementationResolutionRequest } from "../../../../contracts/asset-implementation";
import {
  API_ASSET_IMPLEMENTATION_RELEASES_LIST_OPERATION,
  API_ASSET_IMPLEMENTATION_RESOLVE_OPERATION,
  createApiError,
  createApiFailureResponse,
  createApiSuccessResponse,
} from "../../../../contracts/api";
import { createWorkspaceId } from "../../../../contracts/workspace";

interface RequestLike {
  readonly body?: unknown;
  readonly query?: Readonly<Record<string, unknown>>;
  readonly headers?: Readonly<Record<string, string | string[] | undefined>>;
}

interface ResponseLike {
  status(code: number): ResponseLike;
  json(body: unknown): void;
}

export interface AssetImplementationExpressPort {
  get(
    path: string,
    handler: (request: RequestLike, response: ResponseLike) => Promise<void>,
  ): void;
  post(
    path: string,
    handler: (request: RequestLike, response: ResponseLike) => Promise<void>,
  ): void;
}

export interface RegisterAssetImplementationApiRoutesDependencies {
  readonly app: AssetImplementationExpressPort;
  readonly listReleases: Pick<
    ListAssetImplementationReleasesUseCase,
    "execute"
  >;
  readonly resolve: Pick<ResolveAssetImplementationUseCase, "execute">;
}

const header = (request: RequestLike, name: string): string | undefined => {
  const value = request.headers?.[name];
  return Array.isArray(value) ? value[0] : value;
};

const context = (request: RequestLike) => ({
  requestId: header(request, "x-request-id"),
  correlationId: header(request, "x-correlation-id"),
});

const message = (error: unknown): string =>
  error instanceof Error &&
  /required|invalid|must|supported/i.test(error.message)
    ? error.message
    : "Asset implementation request could not be completed.";

export function registerAssetImplementationApiRoutes(
  dependencies: RegisterAssetImplementationApiRoutesDependencies,
): void {
  dependencies.app.get(
    "/api/asset-implementations/releases",
    async (request, response) => {
      try {
        if (typeof request.query?.workspaceId !== "string") {
          throw new Error("workspaceId is required.");
        }
        const workspaceId = createWorkspaceId(request.query.workspaceId);
        const value = await dependencies.listReleases.execute(workspaceId);
        response
          .status(200)
          .json(
            createApiSuccessResponse(
              API_ASSET_IMPLEMENTATION_RELEASES_LIST_OPERATION,
              value,
              context(request),
            ),
          );
      } catch (error) {
        response
          .status(400)
          .json(
            createApiFailureResponse(
              createApiError(
                API_ASSET_IMPLEMENTATION_RELEASES_LIST_OPERATION,
                "validation",
                message(error),
                context(request),
              ),
              context(request),
            ),
          );
      }
    },
  );

  dependencies.app.post(
    "/api/asset-implementations/resolve",
    async (request, response) => {
      try {
        if (!request.body || typeof request.body !== "object") {
          throw new Error("Request body is required.");
        }
        const normalized = normalizeAssetImplementationResolutionRequest(
          request.body as never,
        );
        const value = await dependencies.resolve.execute(normalized);
        response
          .status(200)
          .json(
            createApiSuccessResponse(
              API_ASSET_IMPLEMENTATION_RESOLVE_OPERATION,
              value,
              context(request),
            ),
          );
      } catch (error) {
        response
          .status(400)
          .json(
            createApiFailureResponse(
              createApiError(
                API_ASSET_IMPLEMENTATION_RESOLVE_OPERATION,
                "validation",
                message(error),
                context(request),
              ),
              context(request),
            ),
          );
      }
    },
  );
}
