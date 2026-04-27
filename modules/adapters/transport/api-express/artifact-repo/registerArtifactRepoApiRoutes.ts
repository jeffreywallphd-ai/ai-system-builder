import type {
  HasArtifactInRepoCommand,
  HasArtifactInRepoUseCasePort,
  LocalizeArtifactFromRepoUseCase,
  PublishArtifactToRepoUseCase,
  BrowseHuggingFaceNamespaceDatasetsUseCase,
  BrowseHuggingFaceDatasetParquetFilesUseCase,
  VerifyImportedArtifactSourceBackingUseCase,
  StoreArtifactInRepoCommand,
  StoreArtifactInRepoUseCasePort,
  VerifyPublishedArtifactBackingUseCase,
  RegisterArtifactFromRepoUseCase,
} from "../../../../application/use-cases";
import {
  createApiArtifactPublishFailureResponse,
  createApiArtifactPublishRequest,
  createApiArtifactPublishSuccessResponse,
  createApiArtifactPublishVerifyFailureResponse,
  createApiArtifactPublishVerifyRequest,
  createApiArtifactPublishVerifySuccessResponse,
  createApiArtifactSourceVerifyFailureResponse,
  createApiArtifactSourceVerifyRequest,
  createApiArtifactSourceVerifySuccessResponse,
  createApiArtifactLocalizeFromRepoFailureResponse,
  createApiArtifactLocalizeFromRepoRequest,
  createApiArtifactLocalizeFromRepoSuccessResponse,
  createApiArtifactRegisterFromRepoFailureResponse,
  createApiArtifactRegisterFromRepoRequest,
  createApiArtifactRegisterFromRepoSuccessResponse,
  createApiArtifactRepoHasFailureResponse,
  createApiArtifactRepoHasRequest,
  createApiArtifactRepoHasSuccessResponse,
  createApiArtifactRepoStoreFailureResponse,
  createApiArtifactRepoStoreRequest,
  createApiArtifactRepoStoreSuccessResponse,
  createApiHuggingFaceDatasetParquetFilesBrowseFailureResponse,
  createApiHuggingFaceDatasetParquetFilesBrowseRequest,
  createApiHuggingFaceDatasetParquetFilesBrowseSuccessResponse,
  createApiHuggingFaceNamespaceDatasetsBrowseFailureResponse,
  createApiHuggingFaceNamespaceDatasetsBrowseRequest,
  createApiHuggingFaceNamespaceDatasetsBrowseSuccessResponse,
  type ApiArtifactPublishResponse,
  type ApiArtifactPublishVerifyResponse,
  type ApiArtifactSourceVerifyResponse,
  type ApiArtifactLocalizeFromRepoResponse,
  type ApiArtifactRegisterFromRepoResponse,
  type ApiArtifactRepoHasResponse,
  type ApiArtifactRepoStoreResponse,
  type ApiHuggingFaceDatasetParquetFilesBrowseResponse,
  type ApiHuggingFaceNamespaceDatasetsBrowseResponse,
} from "../../../../contracts/api";

interface ArtifactRepoHasApiRequestBody {
  target: {
    provider: string;
    repository: string;
    revision?: string;
    path?: string;
  };
  source?: string;
}

interface ArtifactRepoStoreApiRequestBody extends ArtifactRepoHasApiRequestBody {
  contentBase64: string;
  mediaType?: string;
  overwrite?: boolean;
}

interface ArtifactPublishApiRequestBody {
  artifactId: string;
  target: {
    provider: string;
    repository: string;
    revision?: string;
    path?: string;
  };
  mediaType?: string;
  verify?: boolean;
  source?: string;
}

interface ArtifactPublishVerifyApiRequestBody {
  artifactId: string;
  source?: string;
}

interface ArtifactSourceVerifyApiRequestBody {
  artifactId: string;
  source?: string;
}

interface ArtifactLocalizeFromRepoApiRequestBody {
  artifactId: string;
  source?: string;
}

interface ArtifactRegisterFromRepoApiRequestBody {
  target: {
    provider: string;
    repository: string;
    revision?: string;
    path?: string;
  };
  artifactFamily?: "image";
  mediaType?: string;
  source?: string;
}

export interface ArtifactRepoExpressRequestLike {
  body?: unknown;
  headers?: Record<string, string | string[] | undefined>;
}

export interface ArtifactRepoExpressResponseLike {
  status: (statusCode: number) => ArtifactRepoExpressResponseLike;
  json: (body:
    | ApiArtifactRepoHasResponse
    | ApiArtifactRepoStoreResponse
    | ApiArtifactPublishResponse
    | ApiArtifactPublishVerifyResponse
    | ApiArtifactSourceVerifyResponse
    | ApiArtifactLocalizeFromRepoResponse
    | ApiArtifactRegisterFromRepoResponse
    | HuggingFaceTokenConfigApiResponse
  ) => void;
}

interface HuggingFaceTokenConfigApiResponse {
  ok: boolean;
  value?: {
    configured: boolean;
    maskedToken?: string;
  };
  error?: {
    code: "validation" | "internal";
    message: string;
  };
}

export interface ArtifactRepoExpressRoutePort {
  post: (
    path: string,
    handler: (
      request: ArtifactRepoExpressRequestLike,
      response: ArtifactRepoExpressResponseLike,
    ) => Promise<void>,
  ) => void;
  get?: (
    path: string,
    handler: (
      request: ArtifactRepoExpressRequestLike,
      response: ArtifactRepoExpressResponseLike,
    ) => Promise<void>,
  ) => void;
  delete?: (
    path: string,
    handler: (
      request: ArtifactRepoExpressRequestLike,
      response: ArtifactRepoExpressResponseLike,
    ) => Promise<void>,
  ) => void;
}

export interface RegisterArtifactRepoApiRoutesDependencies {
  app: ArtifactRepoExpressRoutePort;
  getHuggingFaceTokenStatus: () => { configured: boolean; maskedToken?: string };
  setHuggingFaceToken: (token: string) => { configured: boolean; maskedToken?: string };
  clearHuggingFaceToken: () => { configured: boolean; maskedToken?: string };
  hasArtifactInRepoUseCase: HasArtifactInRepoUseCasePort;
  browseHuggingFaceNamespaceDatasetsUseCase: Pick<BrowseHuggingFaceNamespaceDatasetsUseCase, "execute">;
  browseHuggingFaceDatasetParquetFilesUseCase: Pick<BrowseHuggingFaceDatasetParquetFilesUseCase, "execute">;
  storeArtifactInRepoUseCase: StoreArtifactInRepoUseCasePort;
  publishArtifactToRepoUseCase: Pick<PublishArtifactToRepoUseCase, "execute">;
  verifyPublishedArtifactBackingUseCase: Pick<VerifyPublishedArtifactBackingUseCase, "execute">;
  verifyImportedArtifactSourceBackingUseCase: Pick<VerifyImportedArtifactSourceBackingUseCase, "execute">;
  registerArtifactFromRepoUseCase: Pick<RegisterArtifactFromRepoUseCase, "execute">;
  localizeArtifactFromRepoUseCase: Pick<LocalizeArtifactFromRepoUseCase, "execute">;
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
  return normalized && normalized.length > 0 ? normalized : "thin-client.artifact-repo";
}

function mapRequestContext(
  request: ArtifactRepoExpressRequestLike,
): { requestId?: string; correlationId?: string } {
  return {
    requestId: getRequestHeader(request.headers, "x-request-id"),
    correlationId: getRequestHeader(request.headers, "x-correlation-id"),
  };
}

function mapApiHasRequestToCommand(
  requestBody: ArtifactRepoHasApiRequestBody,
  context: { requestId?: string; correlationId?: string },
): HasArtifactInRepoCommand {
  const apiRequest = createApiArtifactRepoHasRequest(
    {
      target: requestBody.target,
      boundary: {
        host: "server",
        source: normalizeSource(requestBody.source),
      },
    },
    context,
  );

  return {
    target: apiRequest.payload.target,
  };
}

function mapApiStoreRequestToCommand(
  requestBody: ArtifactRepoStoreApiRequestBody,
  context: { requestId?: string; correlationId?: string },
): StoreArtifactInRepoCommand {
  const apiRequest = createApiArtifactRepoStoreRequest(
    {
      target: requestBody.target,
      contentBase64: requestBody.contentBase64,
      mediaType: requestBody.mediaType,
      overwrite: requestBody.overwrite,
      boundary: {
        host: "server",
        source: normalizeSource(requestBody.source),
      },
    },
    context,
  );

  return {
    target: apiRequest.payload.target,
    content: new Uint8Array(Buffer.from(apiRequest.payload.contentBase64, "base64")),
    mediaType: apiRequest.payload.mediaType,
    overwrite: apiRequest.payload.overwrite,
  };
}

function mapStatusCode(response: ApiArtifactRepoHasResponse | ApiArtifactRepoStoreResponse): number {
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

function mapPublishStatusCode(
  response:
    | ApiArtifactPublishResponse
    | ApiArtifactPublishVerifyResponse
    | ApiArtifactLocalizeFromRepoResponse
    | ApiArtifactRegisterFromRepoResponse,
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

function mapBrowseStatusCode(
  response: ApiHuggingFaceNamespaceDatasetsBrowseResponse | ApiHuggingFaceDatasetParquetFilesBrowseResponse,
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

function mapHasResultToApiResponse(
  result: Awaited<ReturnType<HasArtifactInRepoUseCasePort["execute"]>>,
  context: { requestId?: string; correlationId?: string },
): ApiArtifactRepoHasResponse {
  if (result.ok) {
    return createApiArtifactRepoHasSuccessResponse(result.value, {
      requestId: result.requestId ?? context.requestId,
      correlationId: result.correlationId ?? context.correlationId,
    });
  }

  return createApiArtifactRepoHasFailureResponse(
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

function mapStoreResultToApiResponse(
  result: Awaited<ReturnType<StoreArtifactInRepoUseCasePort["execute"]>>,
  context: { requestId?: string; correlationId?: string },
): ApiArtifactRepoStoreResponse {
  if (result.ok) {
    return createApiArtifactRepoStoreSuccessResponse(result.value, {
      requestId: result.requestId ?? context.requestId,
      correlationId: result.correlationId ?? context.correlationId,
    });
  }

  return createApiArtifactRepoStoreFailureResponse(
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

export function registerArtifactRepoApiRoutes(
  dependencies: RegisterArtifactRepoApiRoutesDependencies,
): void {
  dependencies.app.get?.("/api/config/huggingface-token", async (_request, response) => {
    const apiResponse: HuggingFaceTokenConfigApiResponse = {
      ok: true,
      value: dependencies.getHuggingFaceTokenStatus(),
    };
    response.status(200).json(apiResponse);
  });

  dependencies.app.post("/api/config/huggingface-token", async (request, response) => {
    try {
      const token = typeof (request.body as { token?: unknown } | undefined)?.token === "string"
        ? (request.body as { token: string }).token
        : "";
      const apiResponse: HuggingFaceTokenConfigApiResponse = {
        ok: true,
        value: dependencies.setHuggingFaceToken(token),
      };
      response.status(200).json(apiResponse);
    } catch (error) {
      const failureResponse: HuggingFaceTokenConfigApiResponse = {
        ok: false,
        error: {
          code: "validation",
          message: error instanceof Error ? error.message : "Invalid Hugging Face token request.",
        },
      };
      response.status(400).json(failureResponse);
    }
  });

  dependencies.app.delete?.("/api/config/huggingface-token", async (_request, response) => {
    const apiResponse: HuggingFaceTokenConfigApiResponse = {
      ok: true,
      value: dependencies.clearHuggingFaceToken(),
    };
    response.status(200).json(apiResponse);
  });

  dependencies.app.post("/api/artifact-repo/has", async (request, response) => {
    const context = mapRequestContext(request);
    let command: HasArtifactInRepoCommand;

    try {
      command = mapApiHasRequestToCommand(request.body as ArtifactRepoHasApiRequestBody, context);
    } catch (error) {
      const apiResponse = createApiArtifactRepoHasFailureResponse(
        "validation",
        error instanceof Error ? error.message : "Invalid artifact-repo has request.",
        context,
      );
      response.status(mapStatusCode(apiResponse)).json(apiResponse);
      return;
    }

    const result = await dependencies.hasArtifactInRepoUseCase.execute(command, context);
    const apiResponse = mapHasResultToApiResponse(result, context);
    response.status(mapStatusCode(apiResponse)).json(apiResponse);
  });

  dependencies.app.post("/api/huggingface/namespace/datasets", async (request, response) => {
    const context = mapRequestContext(request);
    let apiRequest: ReturnType<typeof createApiHuggingFaceNamespaceDatasetsBrowseRequest>;

    try {
      apiRequest = createApiHuggingFaceNamespaceDatasetsBrowseRequest({
        namespace: (request.body as { namespace?: string } | undefined)?.namespace ?? "",
        source: normalizeSource((request.body as { source?: string } | undefined)?.source),
      }, context);
    } catch (error) {
      const apiResponse = createApiHuggingFaceNamespaceDatasetsBrowseFailureResponse(
        "validation",
        error instanceof Error ? error.message : "Invalid Hugging Face namespace browse request.",
        context,
      );
      response.status(mapBrowseStatusCode(apiResponse)).json(apiResponse);
      return;
    }

    const result = await dependencies.browseHuggingFaceNamespaceDatasetsUseCase.execute({
      namespace: apiRequest.payload.namespace,
    }, context);
    const apiResponse = result.ok
      ? createApiHuggingFaceNamespaceDatasetsBrowseSuccessResponse(result.value, context)
      : createApiHuggingFaceNamespaceDatasetsBrowseFailureResponse(
        result.error.code === "validation" || result.error.code === "not-found" || result.error.code === "unavailable"
          ? result.error.code
          : "internal",
        result.error.message,
        {
          details: result.error.details ? { ...result.error.details } : undefined,
          requestId: context.requestId,
          correlationId: context.correlationId,
        },
      );

    response.status(mapBrowseStatusCode(apiResponse)).json(apiResponse);
  });

  dependencies.app.post("/api/huggingface/dataset/parquet-files", async (request, response) => {
    const context = mapRequestContext(request);
    let apiRequest: ReturnType<typeof createApiHuggingFaceDatasetParquetFilesBrowseRequest>;

    try {
      apiRequest = createApiHuggingFaceDatasetParquetFilesBrowseRequest({
        repository: (request.body as { repository?: string } | undefined)?.repository ?? "",
        revision: (request.body as { revision?: string } | undefined)?.revision,
        source: normalizeSource((request.body as { source?: string } | undefined)?.source),
      }, context);
    } catch (error) {
      const apiResponse = createApiHuggingFaceDatasetParquetFilesBrowseFailureResponse(
        "validation",
        error instanceof Error ? error.message : "Invalid Hugging Face dataset file browse request.",
        context,
      );
      response.status(mapBrowseStatusCode(apiResponse)).json(apiResponse);
      return;
    }

    const result = await dependencies.browseHuggingFaceDatasetParquetFilesUseCase.execute({
      repository: apiRequest.payload.repository,
      revision: apiRequest.payload.revision,
    }, context);
    const apiResponse = result.ok
      ? createApiHuggingFaceDatasetParquetFilesBrowseSuccessResponse(result.value, context)
      : createApiHuggingFaceDatasetParquetFilesBrowseFailureResponse(
        result.error.code === "validation" || result.error.code === "not-found" || result.error.code === "unavailable"
          ? result.error.code
          : "internal",
        result.error.message,
        {
          details: result.error.details ? { ...result.error.details } : undefined,
          requestId: context.requestId,
          correlationId: context.correlationId,
        },
      );

    response.status(mapBrowseStatusCode(apiResponse)).json(apiResponse);
  });

  dependencies.app.post("/api/artifact-repo/store", async (request, response) => {
    const context = mapRequestContext(request);
    let command: StoreArtifactInRepoCommand;

    try {
      command = mapApiStoreRequestToCommand(request.body as ArtifactRepoStoreApiRequestBody, context);
    } catch (error) {
      const apiResponse = createApiArtifactRepoStoreFailureResponse(
        "validation",
        error instanceof Error ? error.message : "Invalid artifact-repo store request.",
        context,
      );
      response.status(mapStatusCode(apiResponse)).json(apiResponse);
      return;
    }

    const result = await dependencies.storeArtifactInRepoUseCase.execute(command, context);
    const apiResponse = mapStoreResultToApiResponse(result, context);
    response.status(mapStatusCode(apiResponse)).json(apiResponse);
  });

  dependencies.app.post("/api/artifact/publish", async (request, response) => {
    const context = mapRequestContext(request);
    let apiRequest: ReturnType<typeof createApiArtifactPublishRequest>;

    try {
      apiRequest = createApiArtifactPublishRequest({
        artifactId: (request.body as ArtifactPublishApiRequestBody).artifactId,
        target: {
          provider: (request.body as ArtifactPublishApiRequestBody).target?.provider ?? "",
          repository: (request.body as ArtifactPublishApiRequestBody).target?.repository ?? "",
          revision: (request.body as ArtifactPublishApiRequestBody).target?.revision,
          path: (request.body as ArtifactPublishApiRequestBody).target?.path ?? "",
        },
        mediaType: (request.body as ArtifactPublishApiRequestBody).mediaType,
        verify: (request.body as ArtifactPublishApiRequestBody).verify,
        source: normalizeSource((request.body as ArtifactPublishApiRequestBody).source),
      }, context);
    } catch (error) {
      const apiResponse = createApiArtifactPublishFailureResponse(
        "validation",
        error instanceof Error ? error.message : "Invalid artifact publish request.",
        context,
      );
      response.status(mapPublishStatusCode(apiResponse)).json(apiResponse);
      return;
    }

    const result = await dependencies.publishArtifactToRepoUseCase.execute({
      artifactId: apiRequest.payload.artifactId,
      target: apiRequest.payload.target,
      mediaType: apiRequest.payload.mediaType,
    });

    const apiResponse = result.ok
      ? createApiArtifactPublishSuccessResponse(result.value, context)
      : createApiArtifactPublishFailureResponse(
        result.error.code === "validation" || result.error.code === "not-found" || result.error.code === "unavailable"
          ? result.error.code
          : "internal",
        result.error.message,
        {
          details: result.error.details,
          requestId: context.requestId,
          correlationId: context.correlationId,
        },
      );
    response.status(mapPublishStatusCode(apiResponse)).json(apiResponse);
  });

  dependencies.app.post("/api/artifact/publish/verify", async (request, response) => {
    const context = mapRequestContext(request);
    let apiRequest: ReturnType<typeof createApiArtifactPublishVerifyRequest>;

    try {
      apiRequest = createApiArtifactPublishVerifyRequest({
        artifactId: (request.body as ArtifactPublishVerifyApiRequestBody).artifactId,
        source: normalizeSource((request.body as ArtifactPublishVerifyApiRequestBody).source),
      }, context);
    } catch (error) {
      const apiResponse = createApiArtifactPublishVerifyFailureResponse(
        "validation",
        error instanceof Error ? error.message : "Invalid artifact publish-verify request.",
        context,
      );
      response.status(mapPublishStatusCode(apiResponse)).json(apiResponse);
      return;
    }

    const result = await dependencies.verifyPublishedArtifactBackingUseCase.execute({
      artifactId: apiRequest.payload.artifactId,
    });

    const apiResponse = result.ok
      ? createApiArtifactPublishVerifySuccessResponse(result.value, context)
      : createApiArtifactPublishVerifyFailureResponse(
        result.error.code === "validation" || result.error.code === "not-found" || result.error.code === "unavailable"
          ? result.error.code
          : "internal",
        result.error.message,
        {
          details: result.error.details,
          requestId: context.requestId,
          correlationId: context.correlationId,
        },
      );
    response.status(mapPublishStatusCode(apiResponse)).json(apiResponse);
  });

  dependencies.app.post("/api/artifact/source/verify", async (request, response) => {
    const context = mapRequestContext(request);
    let apiRequest: ReturnType<typeof createApiArtifactSourceVerifyRequest>;

    try {
      apiRequest = createApiArtifactSourceVerifyRequest({
        artifactId: (request.body as ArtifactSourceVerifyApiRequestBody).artifactId,
        source: normalizeSource((request.body as ArtifactSourceVerifyApiRequestBody).source),
      }, context);
    } catch (error) {
      const apiResponse = createApiArtifactSourceVerifyFailureResponse(
        "validation",
        error instanceof Error ? error.message : "Invalid artifact source-verify request.",
        context,
      );
      response.status(mapPublishStatusCode(apiResponse)).json(apiResponse);
      return;
    }

    const result = await dependencies.verifyImportedArtifactSourceBackingUseCase.execute({
      artifactId: apiRequest.payload.artifactId,
    });

    const apiResponse = result.ok
      ? createApiArtifactSourceVerifySuccessResponse(result.value, context)
      : createApiArtifactSourceVerifyFailureResponse(
        result.error.code === "validation" || result.error.code === "not-found" || result.error.code === "unavailable"
          ? result.error.code
          : "internal",
        result.error.message,
        {
          details: result.error.details,
          requestId: context.requestId,
          correlationId: context.correlationId,
        },
      );
    response.status(mapPublishStatusCode(apiResponse)).json(apiResponse);
  });

  dependencies.app.post("/api/artifact/register-from-repo", async (request, response) => {
    const context = mapRequestContext(request);
    let apiRequest: ReturnType<typeof createApiArtifactRegisterFromRepoRequest>;

    try {
      apiRequest = createApiArtifactRegisterFromRepoRequest({
        target: {
          provider: (request.body as ArtifactRegisterFromRepoApiRequestBody).target?.provider ?? "",
          repository: (request.body as ArtifactRegisterFromRepoApiRequestBody).target?.repository ?? "",
          revision: (request.body as ArtifactRegisterFromRepoApiRequestBody).target?.revision,
          path: (request.body as ArtifactRegisterFromRepoApiRequestBody).target?.path ?? "",
        },
        artifactFamily: (request.body as ArtifactRegisterFromRepoApiRequestBody).artifactFamily ?? "image",
        mediaType: (request.body as ArtifactRegisterFromRepoApiRequestBody).mediaType,
        source: normalizeSource((request.body as ArtifactRegisterFromRepoApiRequestBody).source),
      }, context);
    } catch (error) {
      const apiResponse = createApiArtifactRegisterFromRepoFailureResponse(
        "validation",
        error instanceof Error ? error.message : "Invalid artifact register-from-repo request.",
        context,
      );
      response.status(mapPublishStatusCode(apiResponse)).json(apiResponse);
      return;
    }

    const result = await dependencies.registerArtifactFromRepoUseCase.execute(
      {
        target: apiRequest.payload.target,
        artifactFamily: apiRequest.payload.artifactFamily,
        mediaType: apiRequest.payload.mediaType,
      },
      context,
    );

    const apiResponse = result.ok
      ? createApiArtifactRegisterFromRepoSuccessResponse(result.value, context)
      : createApiArtifactRegisterFromRepoFailureResponse(
        result.error.code === "validation" || result.error.code === "not-found" || result.error.code === "unavailable"
          ? result.error.code
          : "internal",
        result.error.message,
        {
          details: result.error.details,
          requestId: context.requestId,
          correlationId: context.correlationId,
        },
      );

    response.status(mapPublishStatusCode(apiResponse)).json(apiResponse);
  });

  dependencies.app.post("/api/artifact/localize-from-repo", async (request, response) => {
    const context = mapRequestContext(request);
    let apiRequest: ReturnType<typeof createApiArtifactLocalizeFromRepoRequest>;

    try {
      apiRequest = createApiArtifactLocalizeFromRepoRequest({
        artifactId: (request.body as ArtifactLocalizeFromRepoApiRequestBody).artifactId ?? "",
        source: normalizeSource((request.body as ArtifactLocalizeFromRepoApiRequestBody).source),
      }, context);
    } catch (error) {
      const apiResponse = createApiArtifactLocalizeFromRepoFailureResponse(
        "validation",
        error instanceof Error ? error.message : "Invalid artifact localize-from-repo request.",
        context,
      );
      response.status(mapPublishStatusCode(apiResponse)).json(apiResponse);
      return;
    }

    const result = await dependencies.localizeArtifactFromRepoUseCase.execute({
      artifactId: apiRequest.payload.artifactId,
    });
    const apiResponse = result.ok
      ? createApiArtifactLocalizeFromRepoSuccessResponse(result.value, context)
      : createApiArtifactLocalizeFromRepoFailureResponse(
        result.error.code === "validation" || result.error.code === "not-found" || result.error.code === "unavailable"
          ? result.error.code
          : "internal",
        result.error.message,
        {
          details: result.error.details,
          requestId: context.requestId,
          correlationId: context.correlationId,
        },
      );

    response.status(mapPublishStatusCode(apiResponse)).json(apiResponse);
  });
}
