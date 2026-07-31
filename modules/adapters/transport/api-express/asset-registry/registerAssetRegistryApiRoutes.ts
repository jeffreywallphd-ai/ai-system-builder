import type { AssetRegistryDefinitionReadPort } from "../../../../application/ports/asset";
import { sanitizeAssetViewValue } from "../../../../application/services/asset/asset-safe-metadata";
import {
  createApiAssetDefinitionReadFailureResponse,
  createApiAssetDefinitionReadSuccessResponse,
  createApiAssetDefinitionVersionReadFailureResponse,
  createApiAssetDefinitionVersionReadSuccessResponse,
  createApiAssetDefinitionsListFailureResponse,
  createApiAssetDefinitionsListSuccessResponse,
  createApiAssetResourceBackedViewReadFailureResponse,
  createApiAssetResourceBackedViewReadSuccessResponse,
  createApiAssetResourceBackedViewsListFailureResponse,
  createApiAssetResourceBackedViewsListSuccessResponse,
} from "../../../../contracts/api";
import {
  parseAssetRegistryDefinitionListInput,
  parseAssetRegistryDefinitionReadInput,
  parseAssetRegistryResourceBackedViewListInput,
  parseAssetRegistryResourceBackedViewReadInput,
  toAssetRegistryDefinitionReference,
  toAssetRegistryFacadeListQuery,
  toAssetRegistryResourceBackedViewListQuery,
  toAssetRegistryResourceBackedViewReadOptions,
  toAssetRegistryReadOptions,
} from "../../asset-registry/assetRegistryReadInputMapper";

interface ExpressRequestLike {
  headers?: Record<string, string | string[] | undefined>;
  params?: Record<string, string | undefined>;
  query?: Record<string, unknown>;
}

interface ExpressResponseLike {
  status: (code: number) => ExpressResponseLike;
  json: (body: unknown) => void;
}

export interface ExpressAssetRegistryRoutePort {
  get: (path: string, handler: (request: ExpressRequestLike, response: ExpressResponseLike) => Promise<void>) => void;
}

export interface RegisterAssetRegistryApiRoutesDependencies {
  app: ExpressAssetRegistryRoutePort;
  assetRegistryRead: AssetRegistryDefinitionReadPort;
}

const getHeader = (headers: ExpressRequestLike["headers"], key: string) => {
  const value = headers?.[key] ?? headers?.[key.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
};

const contextFrom = (request: ExpressRequestLike) => ({
  requestId: getHeader(request.headers, "x-request-id"),
  correlationId: getHeader(request.headers, "x-correlation-id"),
});

export function registerAssetRegistryApiRoutes(dependencies: RegisterAssetRegistryApiRoutesDependencies): void {
  dependencies.app.get("/api/assets/definitions", async (request, response) => {
    const context = contextFrom(request);
    let query: Parameters<AssetRegistryDefinitionReadPort["listDefinitionCards"]>[0];
    try {
      query = toAssetRegistryFacadeListQuery(parseAssetRegistryDefinitionListInput(withWorkspaceId(request, request.query ?? {}), "api-query"));
    } catch {
      response.status(400).json(createApiAssetDefinitionsListFailureResponse("validation", "Invalid asset definitions query.", context));
      return;
    }

    if (!hasWorkspaceId(query)) {
      response.status(400).json(createApiAssetDefinitionsListFailureResponse("validation", "Workspace id is required for Asset Library reads.", context));
      return;
    }

    try {
      const result = await dependencies.assetRegistryRead.listDefinitionCards(query);
      response.status(200).json(createApiAssetDefinitionsListSuccessResponse(sanitizeAssetViewValue(result), context));
    } catch (error) {
      writeApiReadError(response, createApiAssetDefinitionsListFailureResponse, error, context, "Unable to read asset definitions.");
    }
  });

  dependencies.app.get("/api/assets/resource-backed-views", async (request, response) => {
    const context = contextFrom(request);
    let query: Parameters<NonNullable<AssetRegistryDefinitionReadPort["listResourceBackedViewCards"]>>[0];
    try {
      query = toAssetRegistryResourceBackedViewListQuery(parseAssetRegistryResourceBackedViewListInput(withWorkspaceId(request, request.query ?? {}), "api-query"));
    } catch {
      response.status(400).json(createApiAssetResourceBackedViewsListFailureResponse("validation", "Invalid asset resource-backed views query.", context));
      return;
    }

    if (!hasWorkspaceId(query)) {
      response.status(400).json(createApiAssetResourceBackedViewsListFailureResponse("validation", "Workspace id is required for Asset Library reads.", context));
      return;
    }

    if (!dependencies.assetRegistryRead.listResourceBackedViewCards) {
      response.status(503).json(createApiAssetResourceBackedViewsListFailureResponse("unavailable", "Asset resource-backed views are unavailable.", context));
      return;
    }

    try {
      const result = await dependencies.assetRegistryRead.listResourceBackedViewCards(query);
      response.status(200).json(createApiAssetResourceBackedViewsListSuccessResponse(sanitizeAssetViewValue(result), context));
    } catch (error) {
      writeApiReadError(response, createApiAssetResourceBackedViewsListFailureResponse, error, context, "Unable to read asset resource-backed views.");
    }
  });

  dependencies.app.get("/api/assets/resource-backed-views/:viewId", async (request, response) => {
    const context = contextFrom(request);
    let payload;
    try {
      payload = parseAssetRegistryResourceBackedViewReadInput(
        {
          viewId: request.params?.viewId,
          workspaceId: workspaceIdFrom(request),
          ...(request.query?.expand !== undefined ? { expand: request.query.expand } : {}),
          ...(request.query?.includeValidation !== undefined ? { includeValidation: request.query.includeValidation } : {}),
        },
        "api-query",
      );
    } catch {
      response.status(400).json(createApiAssetResourceBackedViewReadFailureResponse("validation", "Invalid asset resource-backed view read request.", context));
      return;
    }

    if (!hasWorkspaceId(payload)) {
      response.status(400).json(createApiAssetResourceBackedViewReadFailureResponse("validation", "Workspace id is required for Asset Library reads.", context));
      return;
    }

    if (!dependencies.assetRegistryRead.readResourceBackedViewDetail) {
      response.status(503).json(createApiAssetResourceBackedViewReadFailureResponse("unavailable", "Asset resource-backed views are unavailable.", context));
      return;
    }

    try {
      const detail = await dependencies.assetRegistryRead.readResourceBackedViewDetail(
        payload.viewId,
        toAssetRegistryResourceBackedViewReadOptions(payload),
      );
      if (!detail) {
        response.status(404).json(createApiAssetResourceBackedViewReadFailureResponse("not-found", "Asset resource-backed view was not found.", context));
        return;
      }
      response.status(200).json(createApiAssetResourceBackedViewReadSuccessResponse(sanitizeAssetViewValue(detail), context));
    } catch (error) {
      writeApiReadError(response, createApiAssetResourceBackedViewReadFailureResponse, error, context, "Unable to read asset resource-backed view.");
    }
  });

  dependencies.app.get("/api/assets/definitions/:definitionId", async (request, response) => {
    const context = contextFrom(request);
    let payload;
    try {
      payload = parseDefinitionReadRequest(request, request.query?.version, false);
    } catch {
      response.status(400).json(createApiAssetDefinitionReadFailureResponse("validation", "Invalid asset definition read request.", context));
      return;
    }

    if (!hasWorkspaceId(payload)) {
      response.status(400).json(createApiAssetDefinitionReadFailureResponse("validation", "Workspace id is required for Asset Library reads.", context));
      return;
    }

    try {
      const detail = await dependencies.assetRegistryRead.readDefinitionDetail(
        toAssetRegistryDefinitionReference(payload),
        toAssetRegistryReadOptions(payload),
      );
      if (!detail) {
        response.status(404).json(createApiAssetDefinitionReadFailureResponse("not-found", "Asset definition was not found.", context));
        return;
      }
      response.status(200).json(createApiAssetDefinitionReadSuccessResponse(sanitizeAssetViewValue(detail), context));
    } catch (error) {
      writeApiReadError(response, createApiAssetDefinitionReadFailureResponse, error, context, "Unable to read asset definition.");
    }
  });

  dependencies.app.get("/api/assets/definitions/:definitionId/versions/:version", async (request, response) => {
    const context = contextFrom(request);
    let payload;
    try {
      payload = parseDefinitionReadRequest(request, request.params?.version, true);
    } catch {
      response.status(400).json(createApiAssetDefinitionVersionReadFailureResponse("validation", "Invalid asset definition version read request.", context));
      return;
    }

    if (!hasWorkspaceId(payload)) {
      response.status(400).json(createApiAssetDefinitionVersionReadFailureResponse("validation", "Workspace id is required for Asset Library reads.", context));
      return;
    }

    try {
      const detail = await dependencies.assetRegistryRead.readDefinitionDetail(
        toAssetRegistryDefinitionReference(payload),
        toAssetRegistryReadOptions(payload),
      );
      if (!detail) {
        response.status(404).json(createApiAssetDefinitionVersionReadFailureResponse("not-found", "Asset definition version was not found.", context));
        return;
      }
      response.status(200).json(createApiAssetDefinitionVersionReadSuccessResponse(sanitizeAssetViewValue(detail), context));
    } catch (error) {
      writeApiReadError(response, createApiAssetDefinitionVersionReadFailureResponse, error, context, "Unable to read asset definition version.");
    }
  });
}

function hasWorkspaceId(value: { readonly workspaceId?: unknown } | undefined): value is { readonly workspaceId: string } {
  return typeof value?.workspaceId === "string" && value.workspaceId.trim().length > 0;
}

function workspaceIdFrom(request: ExpressRequestLike): string | undefined {
  const queryValue = request.query?.workspaceId;
  if (typeof queryValue === "string") return queryValue;
  const headerValue = getHeader(request.headers, "x-workspace-id");
  return typeof headerValue === "string" ? headerValue : undefined;
}

function withWorkspaceId(request: ExpressRequestLike, input: Record<string, unknown>): Record<string, unknown> {
  const workspaceId = workspaceIdFrom(request);
  return workspaceId !== undefined ? { ...input, workspaceId } : input;
}

function workspaceReadErrorCode(error: unknown): "validation" | "not-found" | "unavailable" | "internal" {
  const code = typeof error === "object" && error && "code" in error ? String((error as { code?: unknown }).code) : "";
  if (code === "workspace-required" || code === "workspace-invalid") return "validation";
  if (code === "workspace-not-found" || code === "workspace-asset-not-in-effective-view") return "not-found";
  if (code === "workspace-unavailable" || code === "workspace-resource-backed-view-deferred" || code === "workspace-system-pack-activation-unavailable") return "unavailable";
  return "internal";
}

function workspaceReadErrorStatus(code: "validation" | "not-found" | "unavailable" | "internal"): number {
  return code === "validation" ? 400 : code === "not-found" ? 404 : code === "unavailable" ? 503 : 500;
}

function workspaceReadErrorMessage(error: unknown, fallback: string): string {
  const code = typeof error === "object" && error && "code" in error ? String((error as { code?: unknown }).code) : "";
  return code.startsWith("workspace-") && error instanceof Error && error.message ? error.message : fallback;
}

function writeApiReadError(
  response: ExpressResponseLike,
  factory: (code: "validation" | "not-found" | "unavailable" | "internal", message: string, context: { requestId?: string; correlationId?: string }) => unknown,
  error: unknown,
  context: { requestId?: string; correlationId?: string },
  fallback: string,
): void {
  const code = workspaceReadErrorCode(error);
  response.status(workspaceReadErrorStatus(code)).json(factory(code, workspaceReadErrorMessage(error, fallback), context));
}

function parseDefinitionReadRequest(request: ExpressRequestLike, versionValue: unknown, requireVersion: boolean) {
  return parseAssetRegistryDefinitionReadInput(
    {
      definitionId: request.params?.definitionId,
      workspaceId: workspaceIdFrom(request),
      ...(versionValue !== undefined ? { version: versionValue } : {}),
      ...(request.query?.expand !== undefined ? { expand: request.query.expand } : {}),
      ...(request.query?.includeValidation !== undefined ? { includeValidation: request.query.includeValidation } : {}),
    },
    "api-query",
    { requireVersion },
  );
}
