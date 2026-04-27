import {
  API_ARTIFACT_UPLOAD_OPERATION,
  API_ARTIFACT_UPLOAD_POLICY_READ_OPERATION,
  createApiArtifactUploadPolicyReadSuccessResponse,
  createApiArtifactUploadSuccessResponse,
  createApiError,
  createApiFailureResponse,
  type ApiArtifactUploadPolicyReadResponse,
  type ApiArtifactUploadResponse,
} from "../../../../contracts/api";
import type { ArtifactUploadAcceptedTypePolicy } from "../../../../contracts/artifact-upload";
import type {
  StoreArtifactUploadCommand,
  StoreArtifactUploadCommandContext,
  StoreArtifactUploadUseCaseResult,
} from "../../../../application/use-cases";
import { parseMultipartArtifactUploadRequest } from "./parseMultipartArtifactUploadRequest";

export interface StoreArtifactUploadUseCasePort {
  execute: (
    command: StoreArtifactUploadCommand,
    commandContext: StoreArtifactUploadCommandContext,
    context?: {
      requestId?: string;
      correlationId?: string;
    },
  ) => Promise<StoreArtifactUploadUseCaseResult>;
  getAcceptedUploadPolicy: () => ArtifactUploadAcceptedTypePolicy;
}

interface ApiArtifactUploadMultipartRequestBody {
  source?: string;
}

export interface ApiArtifactUploadJsonRequestBody {
  fileName: string;
  mediaType: string;
  bytes: number[];
  source: string;
}

export interface ExpressRequestLike {
  body?: ApiArtifactUploadJsonRequestBody | ApiArtifactUploadMultipartRequestBody;
  headers?: Record<string, string | string[] | undefined>;
  on?: (event: string, listener: (chunk?: Buffer | string) => void) => void;
}

export interface ExpressResponseLike {
  status: (statusCode: number) => ExpressResponseLike;
  json: (body: ApiArtifactUploadResponse | ApiArtifactUploadPolicyReadResponse) => void;
}

export interface ExpressPostRoutePort {
  post: (
    path: string,
    handler: (request: ExpressRequestLike, response: ExpressResponseLike) => Promise<void>,
  ) => void;
  get: (
    path: string,
    handler: (request: ExpressRequestLike, response: ExpressResponseLike) => Promise<void>,
  ) => void;
}

export interface RegisterArtifactUploadApiRouteDependencies {
  app: ExpressPostRoutePort;
  storeArtifactUploadUseCase: StoreArtifactUploadUseCasePort;
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

function normalizeSource(value: string | undefined): string {
  const normalized = value?.trim();
  if (!normalized) {
    return "thin-client.artifact-upload.form";
  }

  return normalized;
}

export function mapApiArtifactUploadRequestBody(
  requestBody: ApiArtifactUploadJsonRequestBody,
): {
  command: StoreArtifactUploadCommand;
  commandContext: StoreArtifactUploadCommandContext;
} {
  return {
    command: {
      fileName: requestBody.fileName,
      mediaType: requestBody.mediaType,
      bytes: new Uint8Array(requestBody.bytes),
    },
    commandContext: {
      source: requestBody.source,
    },
  };
}

function mapMultipartArtifactUploadRequest(
  multipartUpload: Awaited<ReturnType<typeof parseMultipartArtifactUploadRequest>>,
): {
  command: StoreArtifactUploadCommand;
  commandContext: StoreArtifactUploadCommandContext;
} {
  return {
    command: {
      fileName: multipartUpload.file.originalName,
      mediaType: multipartUpload.file.mediaType,
      bytes: multipartUpload.file.bytes,
    },
    commandContext: {
      source: normalizeSource(multipartUpload.source),
    },
  };
}

export async function mapApiArtifactUploadRequest(
  request: ExpressRequestLike,
): Promise<{
  command: StoreArtifactUploadCommand;
  commandContext: StoreArtifactUploadCommandContext;
}> {
  const contentType = getRequestHeader(request.headers, "content-type")?.toLowerCase() ?? "";
  if (contentType.includes("multipart/form-data")) {
    const multipartUpload = await parseMultipartArtifactUploadRequest(request);
    return mapMultipartArtifactUploadRequest(multipartUpload);
  }

  return mapApiArtifactUploadRequestBody(request.body as ApiArtifactUploadJsonRequestBody);
}

export function mapStoreArtifactUploadResultToApiResponse(
  result: StoreArtifactUploadUseCaseResult,
  context: {
    requestId?: string;
    correlationId?: string;
  },
): ApiArtifactUploadResponse {
  if (result.ok) {
    return createApiArtifactUploadSuccessResponse(result.value, {
      requestId: result.requestId ?? context.requestId,
      correlationId: result.correlationId ?? context.correlationId,
    });
  }

  return createApiFailureResponse(
    createApiError(
      API_ARTIFACT_UPLOAD_OPERATION,
      result.error.code,
      result.error.message,
      {
        details: result.error.details,
        requestId: result.requestId ?? context.requestId,
        correlationId: result.correlationId ?? context.correlationId,
      },
    ),
    {
      requestId: result.requestId ?? context.requestId,
      correlationId: result.correlationId ?? context.correlationId,
    },
  );
}

function resolveStatusCode(response: ApiArtifactUploadResponse | ApiArtifactUploadPolicyReadResponse): number {
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

export function registerArtifactUploadApiRoute(
  dependencies: RegisterArtifactUploadApiRouteDependencies,
): void {
  dependencies.app.get("/api/artifact/upload/policy", async (request, response) => {
    const requestId = getRequestHeader(request.headers, "x-request-id");
    const correlationId = getRequestHeader(request.headers, "x-correlation-id");
    const apiResponse = createApiArtifactUploadPolicyReadSuccessResponse(
      dependencies.storeArtifactUploadUseCase.getAcceptedUploadPolicy(),
      {
        requestId,
        correlationId,
      },
    );

    response.status(resolveStatusCode(apiResponse)).json(apiResponse);
  });

  dependencies.app.post("/api/artifact/upload", async (request, response) => {
    const requestId = getRequestHeader(request.headers, "x-request-id");
    const correlationId = getRequestHeader(request.headers, "x-correlation-id");

    let mapping;

    try {
      mapping = await mapApiArtifactUploadRequest(request);
    } catch (error) {
      const apiResponse = createApiFailureResponse(
        createApiError(
          API_ARTIFACT_UPLOAD_OPERATION,
          "validation",
          error instanceof Error ? error.message : "Invalid upload request.",
          {
            requestId,
            correlationId,
          },
        ),
        {
          requestId,
          correlationId,
        },
      );

      response.status(resolveStatusCode(apiResponse)).json(apiResponse);
      return;
    }

    const result = await dependencies.storeArtifactUploadUseCase.execute(
      mapping.command,
      mapping.commandContext,
      {
        requestId,
        correlationId,
      },
    );

    const apiResponse = mapStoreArtifactUploadResultToApiResponse(result, {
      requestId,
      correlationId,
    });

    response.status(resolveStatusCode(apiResponse)).json(apiResponse);
  });
}
