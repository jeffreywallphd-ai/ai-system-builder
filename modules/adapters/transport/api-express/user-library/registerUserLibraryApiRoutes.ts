import type { AssetRegistryDefinitionReadPort } from "../../../../application/ports/asset";
import type { UserLibraryAssetRepositoryPort, WorkspaceUserLibraryLinkRepositoryPort } from "../../../../application/ports/user-library";
import type { CopyUserLibraryAssetToWorkspaceUseCase, ImportWorkspaceAssetToWorkspaceUseCase, LinkUserLibraryAssetToWorkspaceUseCase, PromoteWorkspaceAssetToUserLibraryUseCase } from "../../../../application/use-cases/user-library";
import type { AssetReference } from "../../../../contracts/asset";
import {
  API_USER_LIBRARY_ASSET_LIST_OPERATION,
  API_USER_LIBRARY_ASSET_READ_OPERATION,
  API_USER_LIBRARY_COPY_OPERATION,
  API_USER_LIBRARY_IMPORT_OPERATION,
  API_USER_LIBRARY_LINK_LIST_OPERATION,
  API_USER_LIBRARY_LINK_OPERATION,
  API_USER_LIBRARY_LINK_READ_OPERATION,
  API_USER_LIBRARY_PROMOTE_OPERATION,
  API_WORKSPACE_EFFECTIVE_ASSET_SOURCE_LIST_OPERATION,
  createApiUserLibraryFailureResponse,
  createApiUserLibraryOperationSuccessResponse,
} from "../../../../contracts/api";
import { createWorkspaceId } from "../../../../contracts/workspace";

interface ExpressRequestLike {
  readonly headers?: Record<string, string | string[] | undefined>;
  readonly body?: unknown;
  readonly params?: Record<string, string | undefined>;
  readonly query?: Record<string, unknown>;
}

interface ExpressResponseLike {
  status: (code: number) => ExpressResponseLike;
  json: (body: unknown) => void;
}

interface ExpressUserLibraryRoutePort {
  get: (path: string, handler: (request: ExpressRequestLike, response: ExpressResponseLike) => Promise<void>) => void;
  post: (path: string, handler: (request: ExpressRequestLike, response: ExpressResponseLike) => Promise<void>) => void;
}

export interface RegisterUserLibraryApiRoutesDependencies {
  readonly app: ExpressUserLibraryRoutePort;
  readonly promoteUseCase?: PromoteWorkspaceAssetToUserLibraryUseCase;
  readonly linkUseCase?: LinkUserLibraryAssetToWorkspaceUseCase;
  readonly copyUseCase?: CopyUserLibraryAssetToWorkspaceUseCase;
  readonly importUseCase?: ImportWorkspaceAssetToWorkspaceUseCase;
  readonly userLibraryAssetRepository?: UserLibraryAssetRepositoryPort;
  readonly workspaceUserLibraryLinkRepository?: WorkspaceUserLibraryLinkRepositoryPort;
  readonly assetRegistryRead?: AssetRegistryDefinitionReadPort;
}

type UserLibraryFailureCode = "validation" | "internal" | "not-found" | "unavailable";

export function registerUserLibraryApiRoutes(dependencies: RegisterUserLibraryApiRoutesDependencies): void {
  dependencies.app.post("/api/user-library/assets/promote", async (request, response) => {
    const context = contextFrom(request);
    if (!dependencies.promoteUseCase) return unavailable(response, API_USER_LIBRARY_PROMOTE_OPERATION, context, "User-library promotion is unavailable.");

    const body = objectPayload(request.body);
    if (!hasText(body.sourceWorkspaceId)) return failure(response, 400, API_USER_LIBRARY_PROMOTE_OPERATION, "validation", "sourceWorkspaceId is required.", context);

    try {
      const result = await dependencies.promoteUseCase.execute({ ...body, sourceWorkspaceId: createWorkspaceId(body.sourceWorkspaceId) } as never);
      if (!result.ok) return failure(response, 400, API_USER_LIBRARY_PROMOTE_OPERATION, "validation", "User-library promotion request failed.", context);
      response.status(200).json(createApiUserLibraryOperationSuccessResponse(API_USER_LIBRARY_PROMOTE_OPERATION, sanitizeForTransport(result), context));
    } catch {
      failure(response, 500, API_USER_LIBRARY_PROMOTE_OPERATION, "internal", "Unable to promote workspace asset to the user library.", context);
    }
  });

  dependencies.app.post("/api/user-library/workspace-links", async (request, response) => {
    const context = contextFrom(request);
    if (!dependencies.linkUseCase) return unavailable(response, API_USER_LIBRARY_LINK_OPERATION, context, "User-library linking is unavailable.");

    const body = objectPayload(request.body);
    if (!hasText(body.targetWorkspaceId)) return failure(response, 400, API_USER_LIBRARY_LINK_OPERATION, "validation", "targetWorkspaceId is required.", context);

    try {
      const result = await dependencies.linkUseCase.execute({ ...body, targetWorkspaceId: createWorkspaceId(body.targetWorkspaceId) } as never);
      if (!result.ok) return failure(response, 400, API_USER_LIBRARY_LINK_OPERATION, "validation", "User-library link request failed.", context);
      response.status(200).json(createApiUserLibraryOperationSuccessResponse(API_USER_LIBRARY_LINK_OPERATION, sanitizeForTransport(result), context));
    } catch {
      failure(response, 500, API_USER_LIBRARY_LINK_OPERATION, "internal", "Unable to link user-library asset into workspace.", context);
    }
  });

  dependencies.app.post("/api/workspaces/:workspaceId/user-library/copies", async (request, response) => {
    const context = contextFrom(request);
    if (!dependencies.copyUseCase) return unavailable(response, API_USER_LIBRARY_COPY_OPERATION, context, "User-library detached copy is unavailable.");

    if (!hasText(request.params?.workspaceId)) return failure(response, 400, API_USER_LIBRARY_COPY_OPERATION, "validation", "workspaceId route parameter is required.", context);

    try {
      const result = await dependencies.copyUseCase.execute({ ...objectPayload(request.body), targetWorkspaceId: createWorkspaceId(request.params.workspaceId) } as never);
      if (!result.ok) return failure(response, 400, API_USER_LIBRARY_COPY_OPERATION, "validation", "User-library copy request failed.", context);
      response.status(200).json(createApiUserLibraryOperationSuccessResponse(API_USER_LIBRARY_COPY_OPERATION, sanitizeForTransport(result), context));
    } catch {
      failure(response, 500, API_USER_LIBRARY_COPY_OPERATION, "internal", "Unable to copy user-library asset into workspace.", context);
    }
  });

  dependencies.app.post("/api/workspaces/:targetWorkspaceId/imports/workspace-asset", async (request, response) => {
    const context = contextFrom(request);
    if (!dependencies.importUseCase) return unavailable(response, API_USER_LIBRARY_IMPORT_OPERATION, context, "Workspace asset import is unavailable.");

    const body = objectPayload(request.body);
    if (!hasText(request.params?.targetWorkspaceId)) return failure(response, 400, API_USER_LIBRARY_IMPORT_OPERATION, "validation", "targetWorkspaceId route parameter is required.", context);
    if (!hasText(body.sourceWorkspaceId)) return failure(response, 400, API_USER_LIBRARY_IMPORT_OPERATION, "validation", "sourceWorkspaceId is required.", context);

    try {
      const result = await dependencies.importUseCase.execute({ ...body, sourceWorkspaceId: createWorkspaceId(body.sourceWorkspaceId), targetWorkspaceId: createWorkspaceId(request.params.targetWorkspaceId) } as never);
      if (!result.ok) return failure(response, 400, API_USER_LIBRARY_IMPORT_OPERATION, "validation", "Workspace import request failed.", context);
      response.status(200).json(createApiUserLibraryOperationSuccessResponse(API_USER_LIBRARY_IMPORT_OPERATION, sanitizeForTransport(result), context));
    } catch {
      failure(response, 500, API_USER_LIBRARY_IMPORT_OPERATION, "internal", "Unable to import workspace asset into target workspace.", context);
    }
  });

  dependencies.app.get("/api/user-library/assets", async (request, response) => {
    const context = contextFrom(request);
    if (!dependencies.userLibraryAssetRepository) return unavailable(response, API_USER_LIBRARY_ASSET_LIST_OPERATION, context, "User-library asset reads are unavailable.");

    try {
      const query = request.query ?? {};
      const result = await dependencies.userLibraryAssetRepository.listUserLibraryAssetRecords({
        text: optionalString(query.text),
        status: optionalString(query.status) as never,
        sourceWorkspaceId: optionalString(query.sourceWorkspaceId) as never,
        sourceAssetReference: objectOrUndefined(query.sourceAssetReference) as AssetReference | undefined,
        sourceKind: optionalString(query.sourceKind) as never,
        limit: optionalNumber(query.limit),
        cursor: optionalString(query.cursor),
      });
      response.status(200).json(createApiUserLibraryOperationSuccessResponse(API_USER_LIBRARY_ASSET_LIST_OPERATION, sanitizeForTransport(result), context));
    } catch {
      failure(response, 500, API_USER_LIBRARY_ASSET_LIST_OPERATION, "internal", "Unable to list user-library assets.", context);
    }
  });

  dependencies.app.get("/api/user-library/assets/:assetId", async (request, response) => {
    const context = contextFrom(request);
    if (!dependencies.userLibraryAssetRepository) return unavailable(response, API_USER_LIBRARY_ASSET_READ_OPERATION, context, "User-library asset reads are unavailable.");
    if (!hasText(request.params?.assetId)) return failure(response, 400, API_USER_LIBRARY_ASSET_READ_OPERATION, "validation", "assetId route parameter is required.", context);

    try {
      const record = await dependencies.userLibraryAssetRepository.readUserLibraryAssetRecordById(request.params.assetId as never, optionalString(request.query?.version) as never);
      if (!record) return failure(response, 404, API_USER_LIBRARY_ASSET_READ_OPERATION, "not-found", "User-library asset was not found.", context);
      response.status(200).json(createApiUserLibraryOperationSuccessResponse(API_USER_LIBRARY_ASSET_READ_OPERATION, sanitizeForTransport(record), context));
    } catch {
      failure(response, 500, API_USER_LIBRARY_ASSET_READ_OPERATION, "internal", "Unable to read user-library asset.", context);
    }
  });

  dependencies.app.get("/api/workspaces/:workspaceId/user-library/links", async (request, response) => {
    const context = contextFrom(request);
    if (!dependencies.workspaceUserLibraryLinkRepository) return unavailable(response, API_USER_LIBRARY_LINK_LIST_OPERATION, context, "Workspace user-library link reads are unavailable.");
    if (!hasText(request.params?.workspaceId)) return failure(response, 400, API_USER_LIBRARY_LINK_LIST_OPERATION, "validation", "workspaceId route parameter is required.", context);

    try {
      const query = request.query ?? {};
      const result = await dependencies.workspaceUserLibraryLinkRepository.listWorkspaceUserLibraryLinkRecords({
        targetWorkspaceId: createWorkspaceId(request.params.workspaceId),
        status: optionalString(query.status) as never,
        propagationPolicy: optionalString(query.propagationPolicy) as never,
        userLibraryAssetReference: objectOrUndefined(query.userLibraryAssetReference) as never,
        text: optionalString(query.text),
        limit: optionalNumber(query.limit),
        cursor: optionalString(query.cursor),
      });
      response.status(200).json(createApiUserLibraryOperationSuccessResponse(API_USER_LIBRARY_LINK_LIST_OPERATION, sanitizeForTransport(result), context));
    } catch {
      failure(response, 500, API_USER_LIBRARY_LINK_LIST_OPERATION, "internal", "Unable to list workspace user-library links.", context);
    }
  });

  dependencies.app.get("/api/workspaces/:workspaceId/user-library/links/:linkId", async (request, response) => {
    const context = contextFrom(request);
    if (!dependencies.workspaceUserLibraryLinkRepository) return unavailable(response, API_USER_LIBRARY_LINK_READ_OPERATION, context, "Workspace user-library link reads are unavailable.");
    if (!hasText(request.params?.workspaceId)) return failure(response, 400, API_USER_LIBRARY_LINK_READ_OPERATION, "validation", "workspaceId route parameter is required.", context);
    if (!hasText(request.params?.linkId)) return failure(response, 400, API_USER_LIBRARY_LINK_READ_OPERATION, "validation", "linkId route parameter is required.", context);

    try {
      const record = await dependencies.workspaceUserLibraryLinkRepository.readWorkspaceUserLibraryLinkRecord(createWorkspaceId(request.params.workspaceId), request.params.linkId as never);
      if (!record) return failure(response, 404, API_USER_LIBRARY_LINK_READ_OPERATION, "not-found", "Workspace user-library link was not found.", context);
      response.status(200).json(createApiUserLibraryOperationSuccessResponse(API_USER_LIBRARY_LINK_READ_OPERATION, sanitizeForTransport(record), context));
    } catch {
      failure(response, 500, API_USER_LIBRARY_LINK_READ_OPERATION, "internal", "Unable to read workspace user-library link.", context);
    }
  });

  dependencies.app.get("/api/workspaces/:workspaceId/effective-asset-sources", async (request, response) => {
    const context = contextFrom(request);
    if (!dependencies.assetRegistryRead) return unavailable(response, API_WORKSPACE_EFFECTIVE_ASSET_SOURCE_LIST_OPERATION, context, "Effective asset source reads are unavailable.");
    if (!hasText(request.params?.workspaceId)) return failure(response, 400, API_WORKSPACE_EFFECTIVE_ASSET_SOURCE_LIST_OPERATION, "validation", "workspaceId route parameter is required.", context);

    try {
      const result = await dependencies.assetRegistryRead.listDefinitionCards({
        workspaceId: createWorkspaceId(request.params.workspaceId),
        limit: optionalNumber(request.query?.limit),
        cursor: optionalString(request.query?.cursor),
      });
      response.status(200).json(createApiUserLibraryOperationSuccessResponse(API_WORKSPACE_EFFECTIVE_ASSET_SOURCE_LIST_OPERATION, sanitizeForTransport({
        items: result.items.map((item) => item.effectiveSourceSummary).filter(Boolean),
        nextCursor: result.nextCursor,
      }), context));
    } catch {
      failure(response, 500, API_WORKSPACE_EFFECTIVE_ASSET_SOURCE_LIST_OPERATION, "internal", "Unable to read effective asset sources.", context);
    }
  });
}

function contextFrom(request: ExpressRequestLike): { requestId?: string; correlationId?: string } {
  return {
    requestId: headerValue(request.headers, "x-request-id"),
    correlationId: headerValue(request.headers, "x-correlation-id"),
  };
}

function headerValue(headers: ExpressRequestLike["headers"], key: string): string | undefined {
  const value = headers?.[key] ?? headers?.[key.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

function unavailable(response: ExpressResponseLike, operation: string, context: { requestId?: string; correlationId?: string }, message: string): void {
  failure(response, 503, operation, "unavailable", message, context);
}

function failure(response: ExpressResponseLike, status: number, operation: string, code: UserLibraryFailureCode, message: string, context: { requestId?: string; correlationId?: string }): void {
  response.status(status).json(createApiUserLibraryFailureResponse(operation, code, message, context));
}

function objectPayload(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? { ...(value as Record<string, unknown>) } : {};
}

function objectOrUndefined(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function hasText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  const numeric = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : undefined;
  return numeric !== undefined && Number.isFinite(numeric) ? numeric : undefined;
}

const UNSAFE_TRANSPORT_FIELD = /(path|storage|providerPayload|payload|prompt|workflow|token|stack|command|env|base64|blob|bytes|secret|signedUrl|url|locator)/i;

function sanitizeForTransport<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => sanitizeForTransport(item)) as T;
  if (!value || typeof value !== "object") return value;
  const sanitized: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (UNSAFE_TRANSPORT_FIELD.test(key)) continue;
    sanitized[key] = sanitizeForTransport(nested);
  }
  return sanitized as T;
}
