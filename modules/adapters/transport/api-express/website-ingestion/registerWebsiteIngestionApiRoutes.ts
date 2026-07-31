import type {
  IngestWebsitePageRequest,
  IngestWebsitePageResult,
  IngestWebsitePagesBatchRequest,
  IngestWebsitePagesBatchResult,
} from "../../../../contracts/ingestion";
import {
  createApiIngestWebsitePageFailureResponse,
  createApiIngestWebsitePageRequest,
  createApiIngestWebsitePageSuccessResponse,
  createApiIngestWebsitePagesBatchFailureResponse,
  createApiIngestWebsitePagesBatchRequest,
  createApiIngestWebsitePagesBatchSuccessResponse,
  type ApiIngestWebsitePageResponse,
  type ApiIngestWebsitePagesBatchResponse,
} from "../../../../contracts/api";

export interface IngestWebsitePageUseCasePort {
  execute: (
    request: IngestWebsitePageRequest,
    context?: {
      requestId?: string;
      correlationId?: string;
      workspaceId?: string;
    },
  ) => Promise<IngestWebsitePageResult>;
}

export interface IngestWebsitePagesBatchUseCasePort {
  execute: (
    request: IngestWebsitePagesBatchRequest,
    context?: {
      requestId?: string;
      correlationId?: string;
      workspaceId?: string;
    },
  ) => Promise<IngestWebsitePagesBatchResult>;
}

interface WebsiteIngestionRequestBody<TRequest> {
  request?: TRequest;
  workspaceId?: string;
  source?: string;
}

export interface WebsiteIngestionExpressRequestLike {
  body?: unknown;
  headers?: Record<string, string | string[] | undefined>;
}

export interface WebsiteIngestionExpressResponseLike {
  status: (statusCode: number) => WebsiteIngestionExpressResponseLike;
  json: (body: ApiIngestWebsitePageResponse | ApiIngestWebsitePagesBatchResponse) => void;
}

export interface WebsiteIngestionExpressRoutePort {
  post: (
    path: string,
    handler: (
      request: WebsiteIngestionExpressRequestLike,
      response: WebsiteIngestionExpressResponseLike,
    ) => Promise<void>,
  ) => void;
}

export interface RegisterWebsiteIngestionApiRoutesDependencies {
  app: WebsiteIngestionExpressRoutePort;
  ingestWebsitePageUseCase: IngestWebsitePageUseCasePort;
  ingestWebsitePagesBatchUseCase: IngestWebsitePagesBatchUseCasePort;
}

function getRequestHeader(
  headers: Record<string, string | string[] | undefined> | undefined,
  key: string,
): string | undefined {
  const value = headers?.[key];
  return Array.isArray(value) ? value[0] : value;
}

function normalizeSource(value: string | undefined): string {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : "thin-client.artifact-upload.website-scrape";
}

function mapRequestContext(
  request: WebsiteIngestionExpressRequestLike,
): { requestId?: string; correlationId?: string } {
  return {
    requestId: getRequestHeader(request.headers, "x-request-id"),
    correlationId: getRequestHeader(request.headers, "x-correlation-id"),
  };
}

function resolveStatusCode(response: ApiIngestWebsitePageResponse | ApiIngestWebsitePagesBatchResponse): number {
  if (response.ok) {
    return 200;
  }

  switch (response.error.kind) {
    case "client":
      return 400;
    case "transient":
      return 503;
    default:
      return 500;
  }
}

function mapIngestWebsitePageResultToApiResponse(
  result: IngestWebsitePageResult,
  context: { requestId?: string; correlationId?: string },
): ApiIngestWebsitePageResponse {
  if (result.ok) {
    return createApiIngestWebsitePageSuccessResponse(result.value, {
      requestId: result.requestId ?? context.requestId,
      correlationId: result.correlationId ?? context.correlationId,
    });
  }

  return createApiIngestWebsitePageFailureResponse(
    result.error.code,
    result.error.message,
    {
      details: result.error.details,
      requestId: result.requestId ?? context.requestId,
      correlationId: result.correlationId ?? context.correlationId,
    },
  );
}

function mapIngestWebsitePagesBatchResultToApiResponse(
  result: IngestWebsitePagesBatchResult,
  context: { requestId?: string; correlationId?: string },
): ApiIngestWebsitePagesBatchResponse {
  if (result.ok) {
    return createApiIngestWebsitePagesBatchSuccessResponse(result.value, {
      requestId: result.requestId ?? context.requestId,
      correlationId: result.correlationId ?? context.correlationId,
    });
  }

  return createApiIngestWebsitePagesBatchFailureResponse(
    result.error.code,
    result.error.message,
    {
      details: result.error.details,
      requestId: result.requestId ?? context.requestId,
      correlationId: result.correlationId ?? context.correlationId,
    },
  );
}

export function registerWebsiteIngestionApiRoutes(
  dependencies: RegisterWebsiteIngestionApiRoutesDependencies,
): void {
  dependencies.app.post("/api/artifact/ingest-website-page", async (request, response) => {
    const context = mapRequestContext(request);

    let apiRequest;
    try {
      const body = request.body as WebsiteIngestionRequestBody<IngestWebsitePageRequest>;
      apiRequest = createApiIngestWebsitePageRequest(
        {
          request: (body.request ?? body) as IngestWebsitePageRequest,
          workspaceId: body.workspaceId ?? "",
          boundary: {
            host: "server",
            source: normalizeSource(body.source),
          },
        },
        context,
      );
    } catch (error) {
      const apiResponse = createApiIngestWebsitePageFailureResponse(
        "validation",
        error instanceof Error ? error.message : "Invalid website ingestion request.",
        context,
      );
      response.status(resolveStatusCode(apiResponse)).json(apiResponse);
      return;
    }

    const result = await dependencies.ingestWebsitePageUseCase.execute(
      apiRequest.payload.request,
      {
        requestId: apiRequest.requestId,
        correlationId: apiRequest.correlationId,
        workspaceId: apiRequest.payload.workspaceId,
      },
    );
    const apiResponse = mapIngestWebsitePageResultToApiResponse(result, context);
    response.status(resolveStatusCode(apiResponse)).json(apiResponse);
  });

  dependencies.app.post("/api/artifact/ingest-website-pages-batch", async (request, response) => {
    const context = mapRequestContext(request);

    let apiRequest;
    try {
      const body = request.body as WebsiteIngestionRequestBody<IngestWebsitePagesBatchRequest>;
      apiRequest = createApiIngestWebsitePagesBatchRequest(
        {
          request: (body.request ?? body) as IngestWebsitePagesBatchRequest,
          workspaceId: body.workspaceId ?? "",
          boundary: {
            host: "server",
            source: normalizeSource(body.source),
          },
        },
        context,
      );
    } catch (error) {
      const apiResponse = createApiIngestWebsitePagesBatchFailureResponse(
        "validation",
        error instanceof Error ? error.message : "Invalid website batch ingestion request.",
        context,
      );
      response.status(resolveStatusCode(apiResponse)).json(apiResponse);
      return;
    }

    const result = await dependencies.ingestWebsitePagesBatchUseCase.execute(
      apiRequest.payload.request,
      {
        requestId: apiRequest.requestId,
        correlationId: apiRequest.correlationId,
        workspaceId: apiRequest.payload.workspaceId,
      },
    );
    const apiResponse = mapIngestWebsitePagesBatchResultToApiResponse(result, context);
    response.status(resolveStatusCode(apiResponse)).json(apiResponse);
  });
}
