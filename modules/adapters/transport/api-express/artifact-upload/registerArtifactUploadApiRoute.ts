import {
  API_ARTIFACT_UPLOAD_OPERATION,
  API_ARTIFACT_UPLOAD_POLICY_READ_OPERATION,
  createApiArtifactUploadFailureResponse,
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
import { ARTIFACT_UPLOAD_MAXIMUM_BYTES } from "../../../../application/use-cases";
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

export interface ApiArtifactUploadJsonRequestBody {
  fileName?: unknown;
  mediaType?: unknown;
  bytes?: unknown;
  source?: unknown;
  workspaceId?: unknown;
}

export interface ExpressRequestLike {
  body?: unknown;
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

function resolveMaximumBytes(maximumBytes: number | undefined): number {
  return Number.isSafeInteger(maximumBytes) && (maximumBytes ?? 0) > 0
    ? maximumBytes as number
    : ARTIFACT_UPLOAD_MAXIMUM_BYTES;
}

function requireUploadRequestRecord(requestBody: unknown): Record<string, unknown> {
  if (!requestBody || typeof requestBody !== "object" || Array.isArray(requestBody)) {
    throw new Error("Artifact upload request body must be an object.");
  }
  return requestBody as Record<string, unknown>;
}

function requireUploadTextField(
  requestBody: Record<string, unknown>,
  fieldName: "fileName" | "mediaType",
): string {
  const value = requestBody[fieldName];
  if (typeof value !== "string") {
    throw new Error(`Artifact upload ${fieldName} must be a string.`);
  }
  return value;
}

function parseUploadBytes(value: unknown, maximumBytes: number): Uint8Array {
  if (!Array.isArray(value)) {
    throw new Error("Artifact upload bytes must be an array of byte values.");
  }
  if (value.length > maximumBytes) {
    throw new Error(`Artifact upload exceeds the ${maximumBytes}-byte limit.`);
  }
  if (value.some((entry) => !Number.isInteger(entry) || entry < 0 || entry > 255)) {
    throw new Error("Artifact upload bytes must contain only integers from 0 through 255.");
  }
  return new Uint8Array(value as number[]);
}

export function mapApiArtifactUploadRequestBody(
  requestBody: unknown,
  maximumBytes = ARTIFACT_UPLOAD_MAXIMUM_BYTES,
): {
  command: StoreArtifactUploadCommand;
  commandContext: StoreArtifactUploadCommandContext;
} {
  const normalizedMaximumBytes = resolveMaximumBytes(maximumBytes);
  const body = requireUploadRequestRecord(requestBody);
  const source = body.source;
  const workspaceId = body.workspaceId;
  if (source !== undefined && typeof source !== "string") {
    throw new Error("Artifact upload source must be a string.");
  }
  if (workspaceId !== undefined && typeof workspaceId !== "string") {
    throw new Error("Artifact upload workspaceId must be a string.");
  }
  return {
    command: {
      fileName: requireUploadTextField(body, "fileName"),
      mediaType: requireUploadTextField(body, "mediaType"),
      bytes: parseUploadBytes(body.bytes, normalizedMaximumBytes),
    },
    commandContext: {
      source: normalizeSource(source as string | undefined),
      ...(workspaceId ? { workspaceId } : {}),
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
      ...(multipartUpload.workspaceId ? { workspaceId: multipartUpload.workspaceId } : {}),
    },
  };
}

export async function mapApiArtifactUploadRequest(
  request: ExpressRequestLike,
  maximumBytes = ARTIFACT_UPLOAD_MAXIMUM_BYTES,
): Promise<{
  command: StoreArtifactUploadCommand;
  commandContext: StoreArtifactUploadCommandContext;
}> {
  const contentType = getRequestHeader(request.headers, "content-type")?.toLowerCase() ?? "";
  if (contentType.includes("multipart/form-data")) {
    const multipartUpload = await parseMultipartArtifactUploadRequest(
      request,
      resolveMaximumBytes(maximumBytes),
    );
    return mapMultipartArtifactUploadRequest(multipartUpload);
  }

  return mapApiArtifactUploadRequestBody(request.body, maximumBytes);
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
      const maximumBytes = resolveMaximumBytes(
        dependencies.storeArtifactUploadUseCase.getAcceptedUploadPolicy().maximumBytes,
      );
      mapping = await mapApiArtifactUploadRequest(request, maximumBytes);
    } catch (error) {
      const apiResponse = createApiArtifactUploadFailureResponse(
        "validation",
        error instanceof Error ? error.message : "Invalid upload request.",
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
      { requestId, correlationId, workspaceId: mapping.commandContext.workspaceId } as { requestId?: string; correlationId?: string; workspaceId?: string },
    );

    const apiResponse = mapStoreArtifactUploadResultToApiResponse(result, {
      requestId,
      correlationId,
    });

    response.status(resolveStatusCode(apiResponse)).json(apiResponse);
  });
}
