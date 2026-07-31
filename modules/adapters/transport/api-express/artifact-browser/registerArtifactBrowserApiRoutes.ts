import type { ArtifactContentRetrievalPort } from "../../../../application/ports/artifact-content";
import { normalizeArtifactFamily } from "../../../../domain/artifact";
import type {
  BrowseArtifactsCommand,
  BrowseArtifactsUseCasePort,
  BrowseArtifactsUseCaseResult,
  ReadArtifactContentCommand,
  ReadArtifactContentUseCasePort,
  ReadArtifactContentUseCaseResult,
  ReadArtifactDetailCommand,
  ReadArtifactDetailUseCasePort,
  ReadArtifactDetailUseCaseResult,
  DeleteRegisteredArtifactCommand,
  DeleteRegisteredArtifactUseCase,
} from "../../../../application/use-cases";
import {
  createApiArtifactBrowseFailureResponse,
  createApiArtifactBrowseRequest,
  createApiArtifactBrowseSuccessResponse,
  createApiArtifactContentReadFailureResponse,
  createApiArtifactContentReadRequest,
  createApiArtifactContentReadSuccessResponse,
  createApiArtifactRegisteredDeleteFailureResponse,
  createApiArtifactRegisteredDeleteRequest,
  createApiArtifactRegisteredDeleteSuccessResponse,
  createApiArtifactReadFailureResponse,
  createApiArtifactReadRequest,
  createApiArtifactReadSuccessResponse,
  type ApiArtifactBrowseResponse,
  type ApiArtifactContentReadResponse,
  type ApiArtifactRegisteredDeleteResponse,
  type ApiArtifactReadResponse,
} from "../../../../contracts/api";
import { RETRIEVE_ARTIFACT_MAXIMUM_BYTES } from "../../../../contracts/storage";

interface ArtifactBrowseApiRequestBody {
  artifactFamily?: string;
  workspaceId?: string;
  source?: string;
}

interface ArtifactReadApiRequestBody {
  locator: { storageKey: string };
  workspaceId?: string;
  source?: string;
}

export interface ExpressRequestLike {
  body?: ArtifactBrowseApiRequestBody | ArtifactReadApiRequestBody;
  query?: Record<string, string | string[] | undefined>;
  headers?: Record<string, string | string[] | undefined>;
}

function isArtifactReadApiRequestBody(
  value: unknown,
): value is ArtifactReadApiRequestBody {
  if (!value || typeof value !== "object") return false;
  const body = value as { locator?: unknown };
  if (!body.locator || typeof body.locator !== "object") return false;
  return (
    typeof (body.locator as { storageKey?: unknown }).storageKey === "string"
  );
}

export interface ExpressResponseLike {
  status: (statusCode: number) => ExpressResponseLike;
  json: (
    body:
      | ApiArtifactBrowseResponse
      | ApiArtifactReadResponse
      | ApiArtifactContentReadResponse
      | ApiArtifactRegisteredDeleteResponse,
  ) => void;
  send?: (body: Uint8Array | Buffer) => void;
  setHeader?: (name: string, value: string) => void;
}

export interface ExpressRoutePort {
  post: (
    path: string,
    handler: (
      request: ExpressRequestLike,
      response: ExpressResponseLike,
    ) => Promise<void>,
  ) => void;
  get: (
    path: string,
    handler: (
      request: ExpressRequestLike,
      response: ExpressResponseLike,
    ) => Promise<void>,
  ) => void;
}

export interface RegisterArtifactBrowserApiRoutesDependencies {
  app: ExpressRoutePort;
  browseArtifactsUseCase: BrowseArtifactsUseCasePort;
  readArtifactDetailUseCase: ReadArtifactDetailUseCasePort;
  readArtifactContentUseCase: ReadArtifactContentUseCasePort;
  artifactMediaViewRetrieval: ArtifactContentRetrievalPort;
  deleteRegisteredArtifactUseCase: Pick<
    DeleteRegisteredArtifactUseCase,
    "execute"
  >;
}

function getRequestHeader(
  headers: Record<string, string | string[] | undefined> | undefined,
  key: string,
): string | undefined {
  const value = headers?.[key];
  if (Array.isArray(value)) {
    return value[0];
  }

  return value;
}

function getQueryValue(
  query: Record<string, string | string[] | undefined> | undefined,
  key: string,
): string | undefined {
  const value = query?.[key];
  if (Array.isArray(value)) {
    return value[0];
  }

  return value;
}

function normalizeSource(value: string | undefined): string {
  const normalized = value?.trim();
  return normalized && normalized.length > 0
    ? normalized
    : "thin-client.artifact-browser";
}

function mapArtifactBrowserApiRequestContext(request: ExpressRequestLike): {
  requestId?: string;
  correlationId?: string;
  workspaceId?: string;
} {
  return {
    requestId: getRequestHeader(request.headers, "x-request-id"),
    correlationId: getRequestHeader(request.headers, "x-correlation-id"),
  };
}

function resolveStatusCode(
  response:
    | ApiArtifactBrowseResponse
    | ApiArtifactReadResponse
    | ApiArtifactContentReadResponse
    | ApiArtifactRegisteredDeleteResponse,
): number {
  if (response.ok) {
    return 200;
  }

  switch (response.error.code) {
    case "validation":
      return 400;
    case "forbidden":
      return 403;
    case "not-found":
      return 404;
    case "unavailable":
      return 503;
    default:
      return 500;
  }
}

export function mapArtifactBrowseApiRequestToCommand(
  requestBody: ArtifactBrowseApiRequestBody,
  context: { requestId?: string; correlationId?: string; workspaceId?: string },
): BrowseArtifactsCommand {
  const apiRequest = createApiArtifactBrowseRequest(
    {
      artifactFamily: requestBody.artifactFamily
        ? normalizeArtifactFamily(requestBody.artifactFamily)
        : undefined,
      workspaceId: requestBody.workspaceId as never,
      boundary: {
        host: "server",
        source: normalizeSource(requestBody.source),
      },
    },
    context,
  );

  context.workspaceId = apiRequest.payload.workspaceId;
  return {
    artifactFamily: apiRequest.payload.artifactFamily,
  };
}

export function mapArtifactReadApiRequestToCommand(
  requestBody: ArtifactReadApiRequestBody,
  context: { requestId?: string; correlationId?: string; workspaceId?: string },
): ReadArtifactDetailCommand {
  const apiRequest = createApiArtifactReadRequest(
    {
      locator: requestBody.locator,
      workspaceId: requestBody.workspaceId as never,
      boundary: {
        host: "server",
        source: normalizeSource(requestBody.source),
      },
    },
    context,
  );

  context.workspaceId = apiRequest.payload.workspaceId;
  return { locator: apiRequest.payload.locator };
}

export function mapArtifactContentReadApiRequestToCommand(
  requestBody: ArtifactReadApiRequestBody,
  context: { requestId?: string; correlationId?: string; workspaceId?: string },
): ReadArtifactContentCommand {
  const apiRequest = createApiArtifactContentReadRequest(
    {
      locator: requestBody.locator,
      workspaceId: requestBody.workspaceId as never,
      boundary: {
        host: "server",
        source: normalizeSource(requestBody.source),
      },
    },
    context,
  );

  context.workspaceId = apiRequest.payload.workspaceId;
  return { locator: apiRequest.payload.locator };
}

export function mapArtifactRegisteredDeleteApiRequestToCommand(
  requestBody: ArtifactReadApiRequestBody,
  context: { requestId?: string; correlationId?: string; workspaceId?: string },
): DeleteRegisteredArtifactCommand {
  if (!isArtifactReadApiRequestBody(requestBody)) {
    throw new Error("locator.storageKey is required.");
  }
  if (typeof requestBody.workspaceId !== "string") {
    throw new Error("workspaceId is required.");
  }

  const apiRequest = createApiArtifactRegisteredDeleteRequest(
    {
      storageKey: requestBody.locator.storageKey,
      workspaceId: requestBody.workspaceId as never,
      boundary: {
        host: "server",
        source: normalizeSource(requestBody.source),
      },
    },
    context,
  );

  context.workspaceId = apiRequest.payload.workspaceId;
  return { storageKey: apiRequest.payload.storageKey };
}

export function mapArtifactMediaViewApiRequest(request: ExpressRequestLike): {
  storageKey: string;
  workspaceId?: string;
  maximumBytes?: number;
} {
  const storageKey = getQueryValue(request.query, "storageKey")?.trim();
  if (!storageKey) {
    throw new Error("storageKey query parameter is required.");
  }

  const workspaceId = getQueryValue(request.query, "workspaceId")?.trim();
  const maximumBytesValue = getQueryValue(
    request.query,
    "maximumBytes",
  )?.trim();
  let maximumBytes: number | undefined;
  if (maximumBytesValue) {
    maximumBytes = Number(maximumBytesValue);
    if (
      !Number.isInteger(maximumBytes) ||
      maximumBytes < 1 ||
      maximumBytes > RETRIEVE_ARTIFACT_MAXIMUM_BYTES
    ) {
      throw new Error(
        `maximumBytes must be an integer between 1 and ${RETRIEVE_ARTIFACT_MAXIMUM_BYTES}.`,
      );
    }
  }
  return {
    storageKey,
    ...(workspaceId ? { workspaceId } : {}),
    ...(maximumBytes !== undefined ? { maximumBytes } : {}),
  };
}

export function mapBrowseArtifactsResultToApiResponse(
  result: BrowseArtifactsUseCaseResult,
  context: { requestId?: string; correlationId?: string; workspaceId?: string },
): ApiArtifactBrowseResponse {
  if (result.ok) {
    return createApiArtifactBrowseSuccessResponse(result.value, {
      requestId: result.requestId ?? context.requestId,
      correlationId: result.correlationId ?? context.correlationId,
    });
  }

  return createApiArtifactBrowseFailureResponse(
    result.error.code === "validation" ||
      result.error.code === "forbidden" ||
      result.error.code === "unavailable"
      ? result.error.code
      : "internal",
    result.error.message,
    {
      details: result.error.details,
      requestId: result.requestId ?? context.requestId,
      correlationId: result.correlationId ?? context.correlationId,
    },
  );
}

export function mapReadArtifactDetailResultToApiResponse(
  result: ReadArtifactDetailUseCaseResult,
  context: { requestId?: string; correlationId?: string; workspaceId?: string },
): ApiArtifactReadResponse {
  if (result.ok) {
    return createApiArtifactReadSuccessResponse(result.value, {
      requestId: result.requestId ?? context.requestId,
      correlationId: result.correlationId ?? context.correlationId,
    });
  }

  return createApiArtifactReadFailureResponse(
    result.error.code === "validation" ||
      result.error.code === "forbidden" ||
      result.error.code === "not-found" ||
      result.error.code === "unavailable"
      ? result.error.code
      : "internal",
    result.error.message,
    {
      details: result.error.details,
      requestId: result.requestId ?? context.requestId,
      correlationId: result.correlationId ?? context.correlationId,
    },
  );
}

export function mapReadArtifactContentResultToApiResponse(
  result: ReadArtifactContentUseCaseResult,
  context: { requestId?: string; correlationId?: string; workspaceId?: string },
): ApiArtifactContentReadResponse {
  if (result.ok) {
    return createApiArtifactContentReadSuccessResponse(result.value, {
      requestId: result.requestId ?? context.requestId,
      correlationId: result.correlationId ?? context.correlationId,
    });
  }

  return createApiArtifactContentReadFailureResponse(
    result.error.code === "validation" ||
      result.error.code === "forbidden" ||
      result.error.code === "not-found" ||
      result.error.code === "unavailable"
      ? result.error.code
      : "internal",
    result.error.message,
    {
      details: result.error.details,
      requestId: result.requestId ?? context.requestId,
      correlationId: result.correlationId ?? context.correlationId,
    },
  );
}

export function registerArtifactBrowserApiRoutes(
  dependencies: RegisterArtifactBrowserApiRoutesDependencies,
): void {
  dependencies.app.post("/api/artifact/browse", async (request, response) => {
    const context = mapArtifactBrowserApiRequestContext(request);

    let command: BrowseArtifactsCommand;
    try {
      command = mapArtifactBrowseApiRequestToCommand(
        request.body as ArtifactBrowseApiRequestBody,
        context,
      );
    } catch (error) {
      const apiResponse = createApiArtifactBrowseFailureResponse(
        "validation",
        error instanceof Error
          ? error.message
          : "Invalid artifact browse request.",
        context,
      );
      response.status(resolveStatusCode(apiResponse)).json(apiResponse);
      return;
    }

    const result = await dependencies.browseArtifactsUseCase.execute(
      command,
      context,
    );
    const apiResponse = mapBrowseArtifactsResultToApiResponse(result, context);
    response.status(resolveStatusCode(apiResponse)).json(apiResponse);
  });

  dependencies.app.post("/api/artifact/read", async (request, response) => {
    const context = mapArtifactBrowserApiRequestContext(request);

    let command: ReadArtifactDetailCommand;
    try {
      command = mapArtifactReadApiRequestToCommand(
        request.body as ArtifactReadApiRequestBody,
        context,
      );
    } catch (error) {
      const apiResponse = createApiArtifactReadFailureResponse(
        "validation",
        error instanceof Error
          ? error.message
          : "Invalid artifact read request.",
        context,
      );
      response.status(resolveStatusCode(apiResponse)).json(apiResponse);
      return;
    }

    const result = await dependencies.readArtifactDetailUseCase.execute(
      command,
      context,
    );
    const apiResponse = mapReadArtifactDetailResultToApiResponse(
      result,
      context,
    );
    response.status(resolveStatusCode(apiResponse)).json(apiResponse);
  });

  dependencies.app.post(
    "/api/artifact/content/read",
    async (request, response) => {
      const context = mapArtifactBrowserApiRequestContext(request);

      let command: ReadArtifactContentCommand;
      try {
        command = mapArtifactContentReadApiRequestToCommand(
          request.body as ArtifactReadApiRequestBody,
          context,
        );
      } catch (error) {
        const apiResponse = createApiArtifactContentReadFailureResponse(
          "validation",
          error instanceof Error
            ? error.message
            : "Invalid artifact content-read request.",
          context,
        );
        response.status(resolveStatusCode(apiResponse)).json(apiResponse);
        return;
      }

      const result = await dependencies.readArtifactContentUseCase.execute(
        command,
        context,
      );
      const apiResponse = mapReadArtifactContentResultToApiResponse(
        result,
        context,
      );
      response.status(resolveStatusCode(apiResponse)).json(apiResponse);
    },
  );

  dependencies.app.post("/api/artifact/delete", async (request, response) => {
    const context = mapArtifactBrowserApiRequestContext(request);

    let command: DeleteRegisteredArtifactCommand;
    try {
      command = mapArtifactRegisteredDeleteApiRequestToCommand(
        request.body as ArtifactReadApiRequestBody,
        context,
      );
    } catch (error) {
      const apiResponse = createApiArtifactRegisteredDeleteFailureResponse(
        "validation",
        error instanceof Error
          ? error.message
          : "Invalid artifact delete request.",
        context,
      );
      response.status(resolveStatusCode(apiResponse)).json(apiResponse);
      return;
    }

    const result = await dependencies.deleteRegisteredArtifactUseCase.execute(
      command,
      context,
    );
    if (!result.ok) {
      const apiResponse = createApiArtifactRegisteredDeleteFailureResponse(
        result.error.code === "validation" ||
          result.error.code === "forbidden" ||
          result.error.code === "not-found" ||
          result.error.code === "unavailable"
          ? result.error.code
          : "internal",
        result.error.message,
        {
          details: result.error.details,
          requestId: result.requestId ?? context.requestId,
          correlationId: result.correlationId ?? context.correlationId,
        },
      );
      response.status(resolveStatusCode(apiResponse)).json(apiResponse);
      return;
    }

    const apiResponse = createApiArtifactRegisteredDeleteSuccessResponse(
      result.value,
      {
        requestId: result.requestId ?? context.requestId,
        correlationId: result.correlationId ?? context.correlationId,
      },
    );
    response.status(resolveStatusCode(apiResponse)).json(apiResponse);
  });

  dependencies.app.get(
    "/api/artifact/media/view",
    async (request, response) => {
      const context = mapArtifactBrowserApiRequestContext(request);
      let mediaViewRequest: {
        storageKey: string;
        workspaceId?: string;
        maximumBytes?: number;
      };
      try {
        mediaViewRequest = mapArtifactMediaViewApiRequest(request);
        context.workspaceId = mediaViewRequest.workspaceId;
      } catch (error) {
        response
          .status(400)
          .json(
            createApiArtifactContentReadFailureResponse(
              "validation",
              error instanceof Error
                ? error.message
                : "Invalid artifact media-view request.",
              context,
            ),
          );
        return;
      }

      const retrievalResult =
        await dependencies.artifactMediaViewRetrieval.retrieveArtifactViewerMediaByStorageKey(
          {
            storageKey: mediaViewRequest.storageKey,
            maximumBytes: mediaViewRequest.maximumBytes,
          },
          context,
        );

      if (!retrievalResult.ok) {
        const code =
          retrievalResult.error.code === "validation" ||
          retrievalResult.error.code === "not-found" ||
          retrievalResult.error.code === "unavailable"
            ? retrievalResult.error.code
            : "internal";
        const payload = createApiArtifactContentReadFailureResponse(
          code,
          retrievalResult.error.message,
          {
            details: retrievalResult.error.details,
            requestId: context.requestId,
            correlationId: context.correlationId,
          },
        );
        response.status(resolveStatusCode(payload)).json(payload);
        return;
      }

      response.setHeader?.(
        "content-type",
        retrievalResult.value.mediaType ?? "application/octet-stream",
      );
      response.setHeader?.("cache-control", "no-store");
      response.setHeader?.("x-content-type-options", "nosniff");
      response.setHeader?.(
        "content-security-policy",
        "sandbox; default-src 'none'",
      );
      response.status(200);
      response.send?.(Buffer.from(retrievalResult.value.bytes));
    },
  );
}
