import type { ArtifactContentRetrievalPort } from "../../../../application/ports/artifact-content";
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
} from "../../../../application/use-cases";
import {
  createApiArtifactBrowseFailureResponse,
  createApiArtifactBrowseRequest,
  createApiArtifactBrowseSuccessResponse,
  createApiArtifactContentReadFailureResponse,
  createApiArtifactContentReadRequest,
  createApiArtifactContentReadSuccessResponse,
  createApiArtifactReadFailureResponse,
  createApiArtifactReadRequest,
  createApiArtifactReadSuccessResponse,
  type ApiArtifactBrowseResponse,
  type ApiArtifactContentReadResponse,
  type ApiArtifactReadResponse,
} from "../../../../contracts/api";

interface ArtifactBrowseApiRequestBody {
  artifactFamily?: string;
  source?: string;
}

interface ArtifactReadApiRequestBody {
  locator: { storageKey: string };
  source?: string;
}

export interface ExpressRequestLike {
  body?: ArtifactBrowseApiRequestBody | ArtifactReadApiRequestBody;
  query?: Record<string, string | string[] | undefined>;
  headers?: Record<string, string | string[] | undefined>;
}

export interface ExpressResponseLike {
  status: (statusCode: number) => ExpressResponseLike;
  json: (
    body: ApiArtifactBrowseResponse | ApiArtifactReadResponse | ApiArtifactContentReadResponse,
  ) => void;
  send?: (body: Uint8Array | Buffer) => void;
  setHeader?: (name: string, value: string) => void;
}

export interface ExpressRoutePort {
  post: (
    path: string,
    handler: (request: ExpressRequestLike, response: ExpressResponseLike) => Promise<void>,
  ) => void;
  get: (
    path: string,
    handler: (request: ExpressRequestLike, response: ExpressResponseLike) => Promise<void>,
  ) => void;
}

export interface RegisterArtifactBrowserApiRoutesDependencies {
  app: ExpressRoutePort;
  browseArtifactsUseCase: BrowseArtifactsUseCasePort;
  readArtifactDetailUseCase: ReadArtifactDetailUseCasePort;
  readArtifactContentUseCase: ReadArtifactContentUseCasePort;
  artifactMediaViewRetrieval: ArtifactContentRetrievalPort;
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
  return normalized && normalized.length > 0 ? normalized : "thin-client.artifact-browser";
}

function mapArtifactBrowserApiRequestContext(
  request: ExpressRequestLike,
): { requestId?: string; correlationId?: string } {
  return {
    requestId: getRequestHeader(request.headers, "x-request-id"),
    correlationId: getRequestHeader(request.headers, "x-correlation-id"),
  };
}

function resolveStatusCode(
  response: ApiArtifactBrowseResponse | ApiArtifactReadResponse | ApiArtifactContentReadResponse,
): number {
  if (response.ok) {
    return 200;
  }

  switch (response.error.code) {
    case "validation":
      return 400;
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
  context: { requestId?: string; correlationId?: string },
): BrowseArtifactsCommand {
  const apiRequest = createApiArtifactBrowseRequest(
    {
      artifactFamily: requestBody.artifactFamily,
      boundary: {
        host: "server",
        source: normalizeSource(requestBody.source),
      },
    },
    context,
  );

  return { artifactFamily: apiRequest.payload.artifactFamily };
}

export function mapArtifactReadApiRequestToCommand(
  requestBody: ArtifactReadApiRequestBody,
  context: { requestId?: string; correlationId?: string },
): ReadArtifactDetailCommand {
  const apiRequest = createApiArtifactReadRequest(
    {
      locator: requestBody.locator,
      boundary: {
        host: "server",
        source: normalizeSource(requestBody.source),
      },
    },
    context,
  );

  return { locator: apiRequest.payload.locator };
}

export function mapArtifactContentReadApiRequestToCommand(
  requestBody: ArtifactReadApiRequestBody,
  context: { requestId?: string; correlationId?: string },
): ReadArtifactContentCommand {
  const apiRequest = createApiArtifactContentReadRequest(
    {
      locator: requestBody.locator,
      boundary: {
        host: "server",
        source: normalizeSource(requestBody.source),
      },
    },
    context,
  );

  return { locator: apiRequest.payload.locator };
}

export function mapArtifactMediaViewApiRequest(
  request: ExpressRequestLike,
): {
  storageKey: string;
} {
  const storageKey = getQueryValue(request.query, "storageKey")?.trim();
  if (!storageKey) {
    throw new Error("storageKey query parameter is required.");
  }

  return { storageKey };
}

export function mapBrowseArtifactsResultToApiResponse(
  result: BrowseArtifactsUseCaseResult,
  context: { requestId?: string; correlationId?: string },
): ApiArtifactBrowseResponse {
  if (result.ok) {
    return createApiArtifactBrowseSuccessResponse(result.value, {
      requestId: result.requestId ?? context.requestId,
      correlationId: result.correlationId ?? context.correlationId,
    });
  }

  return createApiArtifactBrowseFailureResponse(
    result.error.code === "validation" || result.error.code === "unavailable"
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
  context: { requestId?: string; correlationId?: string },
): ApiArtifactReadResponse {
  if (result.ok) {
    return createApiArtifactReadSuccessResponse(result.value, {
      requestId: result.requestId ?? context.requestId,
      correlationId: result.correlationId ?? context.correlationId,
    });
  }

  return createApiArtifactReadFailureResponse(
    result.error.code === "validation" || result.error.code === "not-found" || result.error.code === "unavailable"
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
  context: { requestId?: string; correlationId?: string },
): ApiArtifactContentReadResponse {
  if (result.ok) {
    return createApiArtifactContentReadSuccessResponse(result.value, {
      requestId: result.requestId ?? context.requestId,
      correlationId: result.correlationId ?? context.correlationId,
    });
  }

  return createApiArtifactContentReadFailureResponse(
    result.error.code === "validation" || result.error.code === "not-found" || result.error.code === "unavailable"
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
        error instanceof Error ? error.message : "Invalid artifact browse request.",
        context,
      );
      response.status(resolveStatusCode(apiResponse)).json(apiResponse);
      return;
    }

    const result = await dependencies.browseArtifactsUseCase.execute(command, context);
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
        error instanceof Error ? error.message : "Invalid artifact read request.",
        context,
      );
      response.status(resolveStatusCode(apiResponse)).json(apiResponse);
      return;
    }

    const result = await dependencies.readArtifactDetailUseCase.execute(command, context);
    const apiResponse = mapReadArtifactDetailResultToApiResponse(result, context);
    response.status(resolveStatusCode(apiResponse)).json(apiResponse);
  });

  dependencies.app.post("/api/artifact/content/read", async (request, response) => {
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
        error instanceof Error ? error.message : "Invalid artifact content-read request.",
        context,
      );
      response.status(resolveStatusCode(apiResponse)).json(apiResponse);
      return;
    }

    const result = await dependencies.readArtifactContentUseCase.execute(command, context);
    const apiResponse = mapReadArtifactContentResultToApiResponse(result, context);
    response.status(resolveStatusCode(apiResponse)).json(apiResponse);
  });

  dependencies.app.get("/api/artifact/media/view", async (request, response) => {
    const context = mapArtifactBrowserApiRequestContext(request);
    let mediaViewRequest: { storageKey: string };
    try {
      mediaViewRequest = mapArtifactMediaViewApiRequest(request);
    } catch (error) {
      response.status(400).json(
        createApiArtifactContentReadFailureResponse(
          "validation",
          error instanceof Error ? error.message : "Invalid artifact media-view request.",
          context,
        ),
      );
      return;
    }

    const retrievalResult = await dependencies.artifactMediaViewRetrieval.retrieveArtifactViewerMediaByStorageKey(
      mediaViewRequest,
      context,
    );

    if (!retrievalResult.ok) {
      const code =
        retrievalResult.error.code === "validation"
        || retrievalResult.error.code === "not-found"
        || retrievalResult.error.code === "unavailable"
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

    response.setHeader?.("content-type", retrievalResult.value.mediaType ?? "application/octet-stream");
    response.setHeader?.("cache-control", "no-store");
    response.status(200);
    response.send?.(Buffer.from(retrievalResult.value.bytes));
  });
}
