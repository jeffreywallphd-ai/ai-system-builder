import type { ArtifactContentRetrievalPort } from "../../../../application/ports/artifact-content";
import type {
  BrowseArtifactsCommand,
  BrowseHuggingFaceDatasetParquetFilesCommand,
  BrowseHuggingFaceDatasetParquetFilesUseCase,
  BrowseHuggingFaceNamespaceDatasetsCommand,
  BrowseHuggingFaceNamespaceDatasetsUseCase,
  BrowseArtifactsUseCasePort,
  BrowseUnregisteredArtifactsUseCasePort,
  DeleteUnregisteredArtifactCommand,
  DeleteUnregisteredArtifactUseCasePort,
  DeleteRegisteredArtifactUseCasePort,
  LocalizeArtifactFromRepoCommand,
  LocalizeArtifactFromRepoUseCase,
  PublishArtifactToRepoCommand,
  PublishArtifactToRepoUseCase,
  RegisterArtifactFromRepoCommand,
  RegisterArtifactFromRepoUseCase,
  RegisterUnregisteredArtifactCommand,
  RegisterUnregisteredArtifactUseCasePort,
  VerifyImportedArtifactSourceBackingCommand,
  VerifyImportedArtifactSourceBackingUseCase,
  VerifyPublishedArtifactBackingCommand,
  VerifyPublishedArtifactBackingUseCase,
  BrowseArtifactsUseCaseResult,
  ReadArtifactContentCommand,
  ReadArtifactContentUseCasePort,
  ReadArtifactContentUseCaseResult,
  ReadArtifactDetailCommand,
  ReadArtifactDetailUseCasePort,
  ReadArtifactDetailUseCaseResult,
} from "../../../../application/use-cases";
import {
  DESKTOP_ARTIFACT_BROWSE_REQUEST_CHANNEL,
  DESKTOP_ARTIFACT_CONTENT_READ_REQUEST_CHANNEL,
  DESKTOP_ARTIFACT_MEDIA_VIEW_REQUEST_CHANNEL,
  DESKTOP_ARTIFACT_READ_REQUEST_CHANNEL,
  DESKTOP_ARTIFACT_PUBLISH_REQUEST_CHANNEL,
  DESKTOP_ARTIFACT_PUBLISH_VERIFY_REQUEST_CHANNEL,
  DESKTOP_ARTIFACT_SOURCE_VERIFY_REQUEST_CHANNEL,
  DESKTOP_ARTIFACT_REGISTER_FROM_REPO_REQUEST_CHANNEL,
  DESKTOP_ARTIFACT_LOCALIZE_FROM_REPO_REQUEST_CHANNEL,
  DESKTOP_ARTIFACT_BROWSE_RESPONSE_CHANNEL,
  DESKTOP_ARTIFACT_UNREGISTERED_BROWSE_REQUEST_CHANNEL,
  DESKTOP_ARTIFACT_UNREGISTERED_BROWSE_RESPONSE_CHANNEL,
  DESKTOP_ARTIFACT_UNREGISTERED_REGISTER_REQUEST_CHANNEL,
  DESKTOP_ARTIFACT_UNREGISTERED_REGISTER_RESPONSE_CHANNEL,
  DESKTOP_ARTIFACT_UNREGISTERED_DELETE_REQUEST_CHANNEL,
  DESKTOP_ARTIFACT_UNREGISTERED_DELETE_RESPONSE_CHANNEL,
  DESKTOP_ARTIFACT_REGISTERED_DELETE_REQUEST_CHANNEL,
  DESKTOP_ARTIFACT_REGISTERED_DELETE_RESPONSE_CHANNEL,
  createDesktopArtifactRegisteredDeleteSuccessResponse,
  type DesktopArtifactRegisteredDeleteRequest,
  type DesktopArtifactRegisteredDeleteResponse,
  DESKTOP_ARTIFACT_CONTENT_READ_RESPONSE_CHANNEL,
  DESKTOP_ARTIFACT_READ_RESPONSE_CHANNEL,
  DESKTOP_ARTIFACT_MEDIA_VIEW_RESPONSE_CHANNEL,
  DESKTOP_ARTIFACT_PUBLISH_RESPONSE_CHANNEL,
  DESKTOP_ARTIFACT_PUBLISH_VERIFY_RESPONSE_CHANNEL,
  DESKTOP_ARTIFACT_SOURCE_VERIFY_RESPONSE_CHANNEL,
  DESKTOP_ARTIFACT_REGISTER_FROM_REPO_RESPONSE_CHANNEL,
  DESKTOP_ARTIFACT_LOCALIZE_FROM_REPO_RESPONSE_CHANNEL,
  createDesktopArtifactBrowseSuccessResponse,
  createDesktopArtifactUnregisteredBrowseSuccessResponse,
  createDesktopArtifactUnregisteredRegisterSuccessResponse,
  createDesktopArtifactUnregisteredDeleteSuccessResponse,
  createDesktopArtifactContentReadSuccessResponse,
  createDesktopArtifactMediaViewSuccessResponse,
  createDesktopArtifactReadSuccessResponse,
  createDesktopArtifactPublishSuccessResponse,
  createDesktopArtifactPublishVerifySuccessResponse,
  createDesktopArtifactSourceVerifySuccessResponse,
  createDesktopArtifactRegisterFromRepoSuccessResponse,
  createDesktopArtifactLocalizeFromRepoSuccessResponse,
  createIpcError,
  createIpcFailureResponse,
  type DesktopArtifactBrowseRequest,
  type DesktopArtifactBrowseResponse,
  type DesktopArtifactContentReadRequest,
  type DesktopArtifactContentReadResponse,
  type DesktopArtifactMediaViewRequest,
  type DesktopArtifactMediaViewResponse,
  type DesktopArtifactReadRequest,
  type DesktopArtifactReadResponse,
  type DesktopArtifactPublishRequest,
  type DesktopArtifactPublishResponse,
  type DesktopArtifactPublishVerifyRequest,
  type DesktopArtifactPublishVerifyResponse,
  type DesktopArtifactSourceVerifyRequest,
  type DesktopArtifactSourceVerifyResponse,
  type DesktopArtifactRegisterFromRepoRequest,
  type DesktopArtifactRegisterFromRepoResponse,
  type DesktopArtifactLocalizeFromRepoRequest,
  type DesktopArtifactLocalizeFromRepoResponse,
  type DesktopArtifactUnregisteredBrowseRequest,
  type DesktopArtifactUnregisteredBrowseResponse,
  type DesktopArtifactUnregisteredRegisterRequest,
  type DesktopArtifactUnregisteredRegisterResponse,
  type DesktopArtifactUnregisteredDeleteRequest,
  type DesktopArtifactUnregisteredDeleteResponse,
  DESKTOP_HUGGING_FACE_TOKEN_GET_REQUEST_CHANNEL,
  DESKTOP_HUGGING_FACE_TOKEN_SET_REQUEST_CHANNEL,
  DESKTOP_HUGGING_FACE_TOKEN_CLEAR_REQUEST_CHANNEL,
  DESKTOP_HUGGING_FACE_TOKEN_GET_RESPONSE_CHANNEL,
  DESKTOP_HUGGING_FACE_TOKEN_SET_RESPONSE_CHANNEL,
  DESKTOP_HUGGING_FACE_TOKEN_CLEAR_RESPONSE_CHANNEL,
  createDesktopHuggingFaceTokenGetSuccessResponse,
  createDesktopHuggingFaceTokenSetSuccessResponse,
  createDesktopHuggingFaceTokenClearSuccessResponse,
  type DesktopHuggingFaceTokenGetRequest,
  type DesktopHuggingFaceTokenGetResponse,
  type DesktopHuggingFaceTokenSetRequest,
  type DesktopHuggingFaceTokenSetResponse,
  type DesktopHuggingFaceTokenClearRequest,
  type DesktopHuggingFaceTokenClearResponse,
  DESKTOP_HUGGING_FACE_NAMESPACE_DATASETS_BROWSE_REQUEST_CHANNEL,
  DESKTOP_HUGGING_FACE_NAMESPACE_DATASETS_BROWSE_RESPONSE_CHANNEL,
  DESKTOP_HUGGING_FACE_DATASET_PARQUET_FILES_BROWSE_REQUEST_CHANNEL,
  DESKTOP_HUGGING_FACE_DATASET_PARQUET_FILES_BROWSE_RESPONSE_CHANNEL,
  createDesktopHuggingFaceNamespaceDatasetsBrowseSuccessResponse,
  createDesktopHuggingFaceDatasetParquetFilesBrowseSuccessResponse,
  type DesktopHuggingFaceNamespaceDatasetsBrowseRequest,
  type DesktopHuggingFaceNamespaceDatasetsBrowseResponse,
  type DesktopHuggingFaceDatasetParquetFilesBrowseRequest,
  type DesktopHuggingFaceDatasetParquetFilesBrowseResponse,
} from "../../../../contracts/ipc";
import { normalizeArtifactFamily } from "../../../../domain/artifact";
import type { IpcMainHandlePort } from "../ipcMainHandlePort";
export type { IpcMainHandlePort } from "../ipcMainHandlePort";

export interface RegisterArtifactBrowserIpcDependencies {
  ipcMain: IpcMainHandlePort;
  getHuggingFaceTokenStatus: () => { configured: boolean; maskedToken?: string };
  setHuggingFaceToken: (token: string) => { configured: boolean; maskedToken?: string };
  clearHuggingFaceToken: () => { configured: boolean; maskedToken?: string };
  browseArtifactsUseCase: BrowseArtifactsUseCasePort;
  browseUnregisteredArtifactsUseCase: BrowseUnregisteredArtifactsUseCasePort;
  registerUnregisteredArtifactUseCase: RegisterUnregisteredArtifactUseCasePort;
  deleteUnregisteredArtifactUseCase: DeleteUnregisteredArtifactUseCasePort;
  deleteRegisteredArtifactUseCase: DeleteRegisteredArtifactUseCasePort;
  readArtifactDetailUseCase: ReadArtifactDetailUseCasePort;
  readArtifactContentUseCase: ReadArtifactContentUseCasePort;
  artifactMediaViewRetrieval: ArtifactContentRetrievalPort;
  publishArtifactToRepoUseCase: Pick<PublishArtifactToRepoUseCase, "execute">;
  browseHuggingFaceNamespaceDatasetsUseCase: Pick<BrowseHuggingFaceNamespaceDatasetsUseCase, "execute">;
  browseHuggingFaceDatasetParquetFilesUseCase: Pick<BrowseHuggingFaceDatasetParquetFilesUseCase, "execute">;
  verifyPublishedArtifactBackingUseCase: Pick<VerifyPublishedArtifactBackingUseCase, "execute">;
  verifyImportedArtifactSourceBackingUseCase: Pick<VerifyImportedArtifactSourceBackingUseCase, "execute">;
  registerArtifactFromRepoUseCase: Pick<RegisterArtifactFromRepoUseCase, "execute">;
  localizeArtifactFromRepoUseCase: Pick<LocalizeArtifactFromRepoUseCase, "execute">;
}

export function mapDesktopArtifactBrowseRequestToCommand(
  request: DesktopArtifactBrowseRequest,
): BrowseArtifactsCommand {
  return {
    artifactFamily: request.payload.artifactFamily,
  };
}

export function mapDesktopArtifactReadRequestToCommand(
  request: DesktopArtifactReadRequest,
): ReadArtifactDetailCommand {
  return {
    locator: request.payload.locator,
  };
}

export function mapDesktopArtifactContentReadRequestToCommand(
  request: DesktopArtifactContentReadRequest,
): ReadArtifactContentCommand {
  return {
    locator: request.payload.locator,
  };
}

export function mapDesktopArtifactMediaViewRequest(
  request: DesktopArtifactMediaViewRequest,
): { storageKey: string } {
  return {
    storageKey: request.payload.storageKey,
  };
}

export function mapDesktopArtifactPublishRequestToCommand(
  request: DesktopArtifactPublishRequest,
): PublishArtifactToRepoCommand {
  return {
    artifactId: request.payload.artifactId,
    target: request.payload.target,
    mediaType: request.payload.mediaType,
  };
}

export function mapDesktopArtifactPublishVerifyRequestToCommand(
  request: DesktopArtifactPublishVerifyRequest,
): VerifyPublishedArtifactBackingCommand {
  return {
    artifactId: request.payload.artifactId,
  };
}

export function mapDesktopArtifactSourceVerifyRequestToCommand(
  request: DesktopArtifactSourceVerifyRequest,
): VerifyImportedArtifactSourceBackingCommand {
  return {
    artifactId: request.payload.artifactId,
  };
}

export function mapDesktopArtifactRegisterFromRepoRequestToCommand(
  request: DesktopArtifactRegisterFromRepoRequest,
): RegisterArtifactFromRepoCommand {
  return {
    target: request.payload.target,
    artifactFamily: request.payload.artifactFamily
      ? normalizeArtifactFamily(request.payload.artifactFamily)
      : undefined,
    mediaType: request.payload.mediaType,
  };
}

export function mapDesktopArtifactLocalizeFromRepoRequestToCommand(
  request: DesktopArtifactLocalizeFromRepoRequest,
): LocalizeArtifactFromRepoCommand {
  return {
    artifactId: request.payload.artifactId,
  };
}

export function mapDesktopUnregisteredRegisterRequestToCommand(
  request: DesktopArtifactUnregisteredRegisterRequest,
): RegisterUnregisteredArtifactCommand {
  return {
    storageKey: request.payload.storageKey,
  };
}

export function mapDesktopUnregisteredDeleteRequestToCommand(
  request: DesktopArtifactUnregisteredDeleteRequest,
): DeleteUnregisteredArtifactCommand {
  return {
    storageKey: request.payload.storageKey,
  };
}


export function mapDesktopRegisteredDeleteRequestToCommand(
  request: DesktopArtifactRegisteredDeleteRequest,
): { storageKey: string } {
  return { storageKey: request.payload.storageKey };
}
export function mapDesktopArtifactRequestContext(
  request:
    | DesktopArtifactBrowseRequest
    | DesktopArtifactReadRequest
    | DesktopArtifactContentReadRequest
    | DesktopArtifactMediaViewRequest
    | DesktopArtifactPublishRequest
    | DesktopArtifactPublishVerifyRequest
    | DesktopArtifactSourceVerifyRequest
    | DesktopArtifactRegisterFromRepoRequest
    | DesktopArtifactLocalizeFromRepoRequest
    | DesktopArtifactUnregisteredBrowseRequest
    | DesktopArtifactUnregisteredRegisterRequest
    | DesktopArtifactUnregisteredDeleteRequest
    | DesktopArtifactRegisteredDeleteRequest,
): { requestId?: string; correlationId?: string } {
  return {
    requestId: request.requestId,
    correlationId: request.correlationId,
  };
}

function mapDesktopHuggingFaceBrowseRequestContext(
  request: DesktopHuggingFaceNamespaceDatasetsBrowseRequest | DesktopHuggingFaceDatasetParquetFilesBrowseRequest,
): { requestId?: string; correlationId?: string } {
  return {
    requestId: request.requestId,
    correlationId: request.correlationId,
  };
}

function mapDesktopHuggingFaceNamespaceDatasetsRequestToCommand(
  request: DesktopHuggingFaceNamespaceDatasetsBrowseRequest,
): BrowseHuggingFaceNamespaceDatasetsCommand {
  return {
    namespace: request.payload.namespace,
  };
}

function mapDesktopHuggingFaceDatasetParquetFilesRequestToCommand(
  request: DesktopHuggingFaceDatasetParquetFilesBrowseRequest,
): BrowseHuggingFaceDatasetParquetFilesCommand {
  return {
    repository: request.payload.repository,
    revision: request.payload.revision,
  };
}

function mapIpcFailure(
  code: string,
) {
  return code === "validation" || code === "not-found" || code === "unavailable"
    ? code
    : "internal";
}

function toMutableErrorDetails(
  details: Readonly<Record<string, unknown>> | undefined,
): Record<string, unknown> | undefined {
  if (!details) {
    return undefined;
  }

  return {
    ...details,
  };
}

function mapBrowseFailure(
  request: { requestId?: string; correlationId?: string },
  error: { code: string; message: string; details?: Readonly<Record<string, unknown>> },
): DesktopArtifactBrowseResponse {
  return createIpcFailureResponse(
    createIpcError(
      DESKTOP_ARTIFACT_BROWSE_RESPONSE_CHANNEL,
      mapIpcFailure(error.code),
      error.message,
      {
        details: toMutableErrorDetails(error.details),
        requestId: request.requestId,
        correlationId: request.correlationId,
      },
    ),
  );
}

function mapUnregisteredBrowseFailure(
  request: { requestId?: string; correlationId?: string },
  error: { code: string; message: string; details?: Readonly<Record<string, unknown>> },
): DesktopArtifactUnregisteredBrowseResponse {
  return createIpcFailureResponse(
    createIpcError(
      DESKTOP_ARTIFACT_UNREGISTERED_BROWSE_RESPONSE_CHANNEL,
      mapIpcFailure(error.code),
      error.message,
      {
        details: toMutableErrorDetails(error.details),
        requestId: request.requestId,
        correlationId: request.correlationId,
      },
    ),
  );
}

function mapUnregisteredRegisterFailure(
  request: { requestId?: string; correlationId?: string },
  error: { code: string; message: string; details?: Readonly<Record<string, unknown>> },
): DesktopArtifactUnregisteredRegisterResponse {
  return createIpcFailureResponse(
    createIpcError(
      DESKTOP_ARTIFACT_UNREGISTERED_REGISTER_RESPONSE_CHANNEL,
      mapIpcFailure(error.code),
      error.message,
      {
        details: toMutableErrorDetails(error.details),
        requestId: request.requestId,
        correlationId: request.correlationId,
      },
    ),
  );
}

function mapUnregisteredDeleteFailure(
  request: { requestId?: string; correlationId?: string },
  error: { code: string; message: string; details?: Readonly<Record<string, unknown>> },
): DesktopArtifactUnregisteredDeleteResponse {
  return createIpcFailureResponse(
    createIpcError(
      DESKTOP_ARTIFACT_UNREGISTERED_DELETE_RESPONSE_CHANNEL,
      mapIpcFailure(error.code),
      error.message,
      {
        details: toMutableErrorDetails(error.details),
        requestId: request.requestId,
        correlationId: request.correlationId,
      },
    ),
  );
}

function mapReadFailure(
  request: { requestId?: string; correlationId?: string },
  error: { code: string; message: string; details?: Readonly<Record<string, unknown>> },
): DesktopArtifactReadResponse {
  return createIpcFailureResponse(
    createIpcError(
      DESKTOP_ARTIFACT_READ_RESPONSE_CHANNEL,
      mapIpcFailure(error.code),
      error.message,
      {
        details: toMutableErrorDetails(error.details),
        requestId: request.requestId,
        correlationId: request.correlationId,
      },
    ),
  );
}

function mapContentReadFailure(
  request: { requestId?: string; correlationId?: string },
  error: { code: string; message: string; details?: Readonly<Record<string, unknown>> },
): DesktopArtifactContentReadResponse {
  return createIpcFailureResponse(
    createIpcError(
      DESKTOP_ARTIFACT_CONTENT_READ_RESPONSE_CHANNEL,
      mapIpcFailure(error.code),
      error.message,
      {
        details: toMutableErrorDetails(error.details),
        requestId: request.requestId,
        correlationId: request.correlationId,
      },
    ),
  );
}

function mapMediaViewFailure(
  request: { requestId?: string; correlationId?: string },
  error: { code: string; message: string; details?: Readonly<Record<string, unknown>> },
): DesktopArtifactMediaViewResponse {
  return createIpcFailureResponse(
    createIpcError(
      DESKTOP_ARTIFACT_MEDIA_VIEW_RESPONSE_CHANNEL,
      mapIpcFailure(error.code),
      error.message,
      {
        details: toMutableErrorDetails(error.details),
        requestId: request.requestId,
        correlationId: request.correlationId,
      },
    ),
  );
}

function mapPublishFailure(
  request: { requestId?: string; correlationId?: string },
  error: { code: string; message: string; details?: Readonly<Record<string, unknown>> },
): DesktopArtifactPublishResponse {
  return createIpcFailureResponse(
    createIpcError(
      DESKTOP_ARTIFACT_PUBLISH_RESPONSE_CHANNEL,
      mapIpcFailure(error.code),
      error.message,
      {
        details: toMutableErrorDetails(error.details),
        requestId: request.requestId,
        correlationId: request.correlationId,
      },
    ),
  );
}

function mapPublishVerifyFailure(
  request: { requestId?: string; correlationId?: string },
  error: { code: string; message: string; details?: Readonly<Record<string, unknown>> },
): DesktopArtifactPublishVerifyResponse {
  return createIpcFailureResponse(
    createIpcError(
      DESKTOP_ARTIFACT_PUBLISH_VERIFY_RESPONSE_CHANNEL,
      mapIpcFailure(error.code),
      error.message,
      {
        details: toMutableErrorDetails(error.details),
        requestId: request.requestId,
        correlationId: request.correlationId,
      },
    ),
  );
}

function mapSourceVerifyFailure(
  request: { requestId?: string; correlationId?: string },
  error: { code: string; message: string; details?: Readonly<Record<string, unknown>> },
): DesktopArtifactSourceVerifyResponse {
  return createIpcFailureResponse(
    createIpcError(
      DESKTOP_ARTIFACT_SOURCE_VERIFY_RESPONSE_CHANNEL,
      mapIpcFailure(error.code),
      error.message,
      {
        details: toMutableErrorDetails(error.details),
        requestId: request.requestId,
        correlationId: request.correlationId,
      },
    ),
  );
}

function mapHuggingFaceNamespaceDatasetsFailure(
  request: { requestId?: string; correlationId?: string },
  error: { code: string; message: string; details?: Readonly<Record<string, unknown>> },
): DesktopHuggingFaceNamespaceDatasetsBrowseResponse {
  return createIpcFailureResponse(
    createIpcError(
      DESKTOP_HUGGING_FACE_NAMESPACE_DATASETS_BROWSE_RESPONSE_CHANNEL,
      mapIpcFailure(error.code),
      error.message,
      {
        details: toMutableErrorDetails(error.details),
        requestId: request.requestId,
        correlationId: request.correlationId,
      },
    ),
  );
}

function mapHuggingFaceDatasetParquetFilesFailure(
  request: { requestId?: string; correlationId?: string },
  error: { code: string; message: string; details?: Readonly<Record<string, unknown>> },
): DesktopHuggingFaceDatasetParquetFilesBrowseResponse {
  return createIpcFailureResponse(
    createIpcError(
      DESKTOP_HUGGING_FACE_DATASET_PARQUET_FILES_BROWSE_RESPONSE_CHANNEL,
      mapIpcFailure(error.code),
      error.message,
      {
        details: toMutableErrorDetails(error.details),
        requestId: request.requestId,
        correlationId: request.correlationId,
      },
    ),
  );
}

export function mapBrowseArtifactsResultToDesktopResponse(
  result: BrowseArtifactsUseCaseResult,
  request: DesktopArtifactBrowseRequest,
): DesktopArtifactBrowseResponse {
  if (!result.ok) {
    return mapBrowseFailure(request, result.error);
  }

  return createDesktopArtifactBrowseSuccessResponse(result.value, {
    requestId: result.requestId ?? request.requestId,
    correlationId: result.correlationId ?? request.correlationId,
  });
}

export function mapReadArtifactDetailResultToDesktopResponse(
  result: ReadArtifactDetailUseCaseResult,
  request: DesktopArtifactReadRequest,
): DesktopArtifactReadResponse {
  if (!result.ok) {
    return mapReadFailure(request, result.error);
  }

  return createDesktopArtifactReadSuccessResponse(result.value, {
    requestId: result.requestId ?? request.requestId,
    correlationId: result.correlationId ?? request.correlationId,
  });
}

export function mapReadArtifactContentResultToDesktopResponse(
  result: ReadArtifactContentUseCaseResult,
  request: DesktopArtifactContentReadRequest,
): DesktopArtifactContentReadResponse {
  if (!result.ok) {
    return mapContentReadFailure(request, result.error);
  }

  return createDesktopArtifactContentReadSuccessResponse(result.value, {
    requestId: result.requestId ?? request.requestId,
    correlationId: result.correlationId ?? request.correlationId,
  });
}

export function createDesktopArtifactBrowseIpcHandler(
  browseArtifactsUseCase: BrowseArtifactsUseCasePort,
) {
  return async (
    _event: unknown,
    request: DesktopArtifactBrowseRequest,
  ): Promise<DesktopArtifactBrowseResponse> => {
    const result = await browseArtifactsUseCase.execute(
      mapDesktopArtifactBrowseRequestToCommand(request),
      mapDesktopArtifactRequestContext(request),
    );

    return mapBrowseArtifactsResultToDesktopResponse(result, request);
  };
}

export function createDesktopUnregisteredArtifactBrowseIpcHandler(
  browseUnregisteredArtifactsUseCase: BrowseUnregisteredArtifactsUseCasePort,
) {
  return async (
    _event: unknown,
    request: DesktopArtifactUnregisteredBrowseRequest,
  ): Promise<DesktopArtifactUnregisteredBrowseResponse> => {
    const result = await browseUnregisteredArtifactsUseCase.execute(
      mapDesktopArtifactRequestContext(request),
    );

    if (!result.ok) {
      return mapUnregisteredBrowseFailure(request, result.error);
    }

    return createDesktopArtifactUnregisteredBrowseSuccessResponse(result.value, {
      requestId: result.requestId ?? request.requestId,
      correlationId: result.correlationId ?? request.correlationId,
    });
  };
}

export function createDesktopUnregisteredArtifactRegisterIpcHandler(
  registerUnregisteredArtifactUseCase: RegisterUnregisteredArtifactUseCasePort,
) {
  return async (
    _event: unknown,
    request: DesktopArtifactUnregisteredRegisterRequest,
  ): Promise<DesktopArtifactUnregisteredRegisterResponse> => {
    const result = await registerUnregisteredArtifactUseCase.execute(
      mapDesktopUnregisteredRegisterRequestToCommand(request),
      mapDesktopArtifactRequestContext(request),
    );

    if (!result.ok) {
      return mapUnregisteredRegisterFailure(request, result.error);
    }

    return createDesktopArtifactUnregisteredRegisterSuccessResponse(result.value, {
      requestId: result.requestId ?? request.requestId,
      correlationId: result.correlationId ?? request.correlationId,
    });
  };
}

export function createDesktopUnregisteredArtifactDeleteIpcHandler(
  deleteUnregisteredArtifactUseCase: DeleteUnregisteredArtifactUseCasePort,
) {
  return async (
    _event: unknown,
    request: DesktopArtifactUnregisteredDeleteRequest,
  ): Promise<DesktopArtifactUnregisteredDeleteResponse> => {
    const result = await deleteUnregisteredArtifactUseCase.execute(
      mapDesktopUnregisteredDeleteRequestToCommand(request),
      mapDesktopArtifactRequestContext(request),
    );

    if (!result.ok) {
      return mapUnregisteredDeleteFailure(request, result.error);
    }

    return createDesktopArtifactUnregisteredDeleteSuccessResponse(result.value, {
      requestId: result.requestId ?? request.requestId,
      correlationId: result.correlationId ?? request.correlationId,
    });
  };
}


export function createDesktopRegisteredArtifactDeleteIpcHandler(
  deleteRegisteredArtifactUseCase: DeleteRegisteredArtifactUseCasePort,
) {
  return async (
    _event: unknown,
    request: DesktopArtifactRegisteredDeleteRequest,
  ): Promise<DesktopArtifactRegisteredDeleteResponse> => {
    const result = await deleteRegisteredArtifactUseCase.execute(
      mapDesktopRegisteredDeleteRequestToCommand(request),
      mapDesktopArtifactRequestContext(request),
    );

    if (!result.ok) {
      return createIpcFailureResponse(
        createIpcError(
          DESKTOP_ARTIFACT_REGISTERED_DELETE_RESPONSE_CHANNEL,
          result.error.code,
          result.error.message,
          {
            details: result.error.details as Record<string, unknown> | undefined,
            requestId: result.requestId ?? request.requestId,
            correlationId: result.correlationId ?? request.correlationId,
          },
        ),
      );
    }

    return createDesktopArtifactRegisteredDeleteSuccessResponse(result.value, {
      requestId: result.requestId ?? request.requestId,
      correlationId: result.correlationId ?? request.correlationId,
    });
  };
}

export function createDesktopArtifactReadIpcHandler(
  readArtifactDetailUseCase: ReadArtifactDetailUseCasePort,
) {
  return async (
    _event: unknown,
    request: DesktopArtifactReadRequest,
  ): Promise<DesktopArtifactReadResponse> => {
    const result = await readArtifactDetailUseCase.execute(
      mapDesktopArtifactReadRequestToCommand(request),
      mapDesktopArtifactRequestContext(request),
    );

    return mapReadArtifactDetailResultToDesktopResponse(result, request);
  };
}

export function createDesktopArtifactContentReadIpcHandler(
  readArtifactContentUseCase: ReadArtifactContentUseCasePort,
) {
  return async (
    _event: unknown,
    request: DesktopArtifactContentReadRequest,
  ): Promise<DesktopArtifactContentReadResponse> => {
    const result = await readArtifactContentUseCase.execute(
      mapDesktopArtifactContentReadRequestToCommand(request),
      mapDesktopArtifactRequestContext(request),
    );

    return mapReadArtifactContentResultToDesktopResponse(result, request);
  };
}

export function createDesktopArtifactMediaViewIpcHandler(
  artifactMediaViewRetrieval: ArtifactContentRetrievalPort,
) {
  return async (
    _event: unknown,
    request: DesktopArtifactMediaViewRequest,
  ): Promise<DesktopArtifactMediaViewResponse> => {
    const retrievalResult = await artifactMediaViewRetrieval.retrieveArtifactViewerMediaByStorageKey(
      mapDesktopArtifactMediaViewRequest(request),
      mapDesktopArtifactRequestContext(request),
    );

    if (!retrievalResult.ok) {
      return mapMediaViewFailure(request, retrievalResult.error);
    }

    return createDesktopArtifactMediaViewSuccessResponse(retrievalResult.value, {
      requestId: retrievalResult.requestId ?? request.requestId,
      correlationId: retrievalResult.correlationId ?? request.correlationId,
    });
  };
}

export function createDesktopArtifactPublishIpcHandler(
  publishArtifactToRepoUseCase: Pick<PublishArtifactToRepoUseCase, "execute">,
) {
  return async (
    _event: unknown,
    request: DesktopArtifactPublishRequest,
  ): Promise<DesktopArtifactPublishResponse> => {
    const result = await publishArtifactToRepoUseCase.execute(
      mapDesktopArtifactPublishRequestToCommand(request),
    );
    if (!result.ok) {
      return mapPublishFailure(request, result.error);
    }

    return createDesktopArtifactPublishSuccessResponse(result.value, {
      requestId: request.requestId,
      correlationId: request.correlationId,
    });
  };
}

export function createDesktopArtifactPublishVerifyIpcHandler(
  verifyPublishedArtifactBackingUseCase: Pick<VerifyPublishedArtifactBackingUseCase, "execute">,
) {
  return async (
    _event: unknown,
    request: DesktopArtifactPublishVerifyRequest,
  ): Promise<DesktopArtifactPublishVerifyResponse> => {
    const result = await verifyPublishedArtifactBackingUseCase.execute(
      mapDesktopArtifactPublishVerifyRequestToCommand(request),
    );
    if (!result.ok) {
      return mapPublishVerifyFailure(request, result.error);
    }

    return createDesktopArtifactPublishVerifySuccessResponse(result.value, {
      requestId: request.requestId,
      correlationId: request.correlationId,
    });
  };
}

export function createDesktopArtifactSourceVerifyIpcHandler(
  verifyImportedArtifactSourceBackingUseCase: Pick<VerifyImportedArtifactSourceBackingUseCase, "execute">,
) {
  return async (
    _event: unknown,
    request: DesktopArtifactSourceVerifyRequest,
  ): Promise<DesktopArtifactSourceVerifyResponse> => {
    const result = await verifyImportedArtifactSourceBackingUseCase.execute(
      mapDesktopArtifactSourceVerifyRequestToCommand(request),
    );
    if (!result.ok) {
      return mapSourceVerifyFailure(request, result.error);
    }

    return createDesktopArtifactSourceVerifySuccessResponse(result.value, {
      requestId: request.requestId,
      correlationId: request.correlationId,
    });
  };
}

export function createDesktopHuggingFaceNamespaceDatasetsBrowseIpcHandler(
  browseUseCase: Pick<BrowseHuggingFaceNamespaceDatasetsUseCase, "execute">,
) {
  return async (
    _event: unknown,
    request: DesktopHuggingFaceNamespaceDatasetsBrowseRequest,
  ): Promise<DesktopHuggingFaceNamespaceDatasetsBrowseResponse> => {
    const result = await browseUseCase.execute(
      mapDesktopHuggingFaceNamespaceDatasetsRequestToCommand(request),
      mapDesktopHuggingFaceBrowseRequestContext(request),
    );
    if (!result.ok) {
      return mapHuggingFaceNamespaceDatasetsFailure(request, result.error);
    }

    return createDesktopHuggingFaceNamespaceDatasetsBrowseSuccessResponse(result.value, {
      requestId: request.requestId,
      correlationId: request.correlationId,
    });
  };
}

export function createDesktopHuggingFaceDatasetParquetFilesBrowseIpcHandler(
  browseUseCase: Pick<BrowseHuggingFaceDatasetParquetFilesUseCase, "execute">,
) {
  return async (
    _event: unknown,
    request: DesktopHuggingFaceDatasetParquetFilesBrowseRequest,
  ): Promise<DesktopHuggingFaceDatasetParquetFilesBrowseResponse> => {
    const result = await browseUseCase.execute(
      mapDesktopHuggingFaceDatasetParquetFilesRequestToCommand(request),
      mapDesktopHuggingFaceBrowseRequestContext(request),
    );
    if (!result.ok) {
      return mapHuggingFaceDatasetParquetFilesFailure(request, result.error);
    }

    return createDesktopHuggingFaceDatasetParquetFilesBrowseSuccessResponse(result.value, {
      requestId: request.requestId,
      correlationId: request.correlationId,
    });
  };
}


function mapRegisterFromRepoFailure(
  request: { requestId?: string; correlationId?: string },
  error: { code: string; message: string; details?: Readonly<Record<string, unknown>> },
): DesktopArtifactRegisterFromRepoResponse {
  return createIpcFailureResponse(
    createIpcError(
      DESKTOP_ARTIFACT_REGISTER_FROM_REPO_RESPONSE_CHANNEL,
      mapIpcFailure(error.code),
      error.message,
      {
        details: toMutableErrorDetails(error.details),
        requestId: request.requestId,
        correlationId: request.correlationId,
      },
    ),
  );
}

function mapLocalizeFromRepoFailure(
  request: { requestId?: string; correlationId?: string },
  error: { code: string; message: string; details?: Readonly<Record<string, unknown>> },
): DesktopArtifactLocalizeFromRepoResponse {
  return createIpcFailureResponse(
    createIpcError(
      DESKTOP_ARTIFACT_LOCALIZE_FROM_REPO_RESPONSE_CHANNEL,
      mapIpcFailure(error.code),
      error.message,
      {
        details: toMutableErrorDetails(error.details),
        requestId: request.requestId,
        correlationId: request.correlationId,
      },
    ),
  );
}

export function createDesktopArtifactRegisterFromRepoIpcHandler(
  registerArtifactFromRepoUseCase: Pick<RegisterArtifactFromRepoUseCase, "execute">,
) {
  return async (
    _event: unknown,
    request: DesktopArtifactRegisterFromRepoRequest,
  ): Promise<DesktopArtifactRegisterFromRepoResponse> => {
    let command: RegisterArtifactFromRepoCommand;
    try {
      command = mapDesktopArtifactRegisterFromRepoRequestToCommand(request);
    } catch (error) {
      return mapRegisterFromRepoFailure(request, {
        code: "validation",
        message: error instanceof Error
          ? error.message
          : "Invalid artifact register-from-repo request.",
      });
    }

    const result = await registerArtifactFromRepoUseCase.execute(
      command,
      mapDesktopArtifactRequestContext(request),
    );

    if (!result.ok) {
      return mapRegisterFromRepoFailure(request, result.error);
    }

    return createDesktopArtifactRegisterFromRepoSuccessResponse(result.value, {
      requestId: request.requestId,
      correlationId: request.correlationId,
    });
  };
}

export function createDesktopArtifactLocalizeFromRepoIpcHandler(
  localizeArtifactFromRepoUseCase: Pick<LocalizeArtifactFromRepoUseCase, "execute">,
) {
  return async (
    _event: unknown,
    request: DesktopArtifactLocalizeFromRepoRequest,
  ): Promise<DesktopArtifactLocalizeFromRepoResponse> => {
    const result = await localizeArtifactFromRepoUseCase.execute(
      mapDesktopArtifactLocalizeFromRepoRequestToCommand(request),
    );

    if (!result.ok) {
      return mapLocalizeFromRepoFailure(request, result.error);
    }

    return createDesktopArtifactLocalizeFromRepoSuccessResponse(result.value, {
      requestId: request.requestId,
      correlationId: request.correlationId,
    });
  };
}

export function registerArtifactBrowserIpc(
  dependencies: RegisterArtifactBrowserIpcDependencies,
): void {
  dependencies.ipcMain.handle(
    DESKTOP_HUGGING_FACE_TOKEN_GET_REQUEST_CHANNEL.value,
    async (_event: unknown, request: DesktopHuggingFaceTokenGetRequest): Promise<DesktopHuggingFaceTokenGetResponse> => createDesktopHuggingFaceTokenGetSuccessResponse(
      dependencies.getHuggingFaceTokenStatus(),
      { requestId: request.requestId, correlationId: request.correlationId },
    ),
  );
  dependencies.ipcMain.handle(
    DESKTOP_HUGGING_FACE_NAMESPACE_DATASETS_BROWSE_REQUEST_CHANNEL.value,
    createDesktopHuggingFaceNamespaceDatasetsBrowseIpcHandler(dependencies.browseHuggingFaceNamespaceDatasetsUseCase),
  );
  dependencies.ipcMain.handle(
    DESKTOP_HUGGING_FACE_DATASET_PARQUET_FILES_BROWSE_REQUEST_CHANNEL.value,
    createDesktopHuggingFaceDatasetParquetFilesBrowseIpcHandler(dependencies.browseHuggingFaceDatasetParquetFilesUseCase),
  );
  dependencies.ipcMain.handle(
    DESKTOP_HUGGING_FACE_TOKEN_SET_REQUEST_CHANNEL.value,
    async (_event: unknown, request: DesktopHuggingFaceTokenSetRequest): Promise<DesktopHuggingFaceTokenSetResponse> => {
      try {
        return createDesktopHuggingFaceTokenSetSuccessResponse(
          dependencies.setHuggingFaceToken(request.payload.token),
          { requestId: request.requestId, correlationId: request.correlationId },
        );
      } catch (error) {
        return createIpcFailureResponse(
          createIpcError(
            DESKTOP_HUGGING_FACE_TOKEN_SET_RESPONSE_CHANNEL,
            "validation",
            error instanceof Error ? error.message : "Invalid Hugging Face token.",
            { requestId: request.requestId, correlationId: request.correlationId },
          ),
        );
      }
    },
  );
  dependencies.ipcMain.handle(
    DESKTOP_HUGGING_FACE_TOKEN_CLEAR_REQUEST_CHANNEL.value,
    async (_event: unknown, request: DesktopHuggingFaceTokenClearRequest): Promise<DesktopHuggingFaceTokenClearResponse> => createDesktopHuggingFaceTokenClearSuccessResponse(
      dependencies.clearHuggingFaceToken(),
      { requestId: request.requestId, correlationId: request.correlationId },
    ),
  );

  dependencies.ipcMain.handle(
    DESKTOP_ARTIFACT_BROWSE_REQUEST_CHANNEL.value,
    createDesktopArtifactBrowseIpcHandler(dependencies.browseArtifactsUseCase),
  );
  dependencies.ipcMain.handle(
    DESKTOP_ARTIFACT_UNREGISTERED_BROWSE_REQUEST_CHANNEL.value,
    createDesktopUnregisteredArtifactBrowseIpcHandler(dependencies.browseUnregisteredArtifactsUseCase),
  );
  dependencies.ipcMain.handle(
    DESKTOP_ARTIFACT_UNREGISTERED_REGISTER_REQUEST_CHANNEL.value,
    createDesktopUnregisteredArtifactRegisterIpcHandler(dependencies.registerUnregisteredArtifactUseCase),
  );
  dependencies.ipcMain.handle(
    DESKTOP_ARTIFACT_UNREGISTERED_DELETE_REQUEST_CHANNEL.value,
    createDesktopUnregisteredArtifactDeleteIpcHandler(dependencies.deleteUnregisteredArtifactUseCase),
  );
  dependencies.ipcMain.handle(
    DESKTOP_ARTIFACT_REGISTERED_DELETE_REQUEST_CHANNEL.value,
    createDesktopRegisteredArtifactDeleteIpcHandler(dependencies.deleteRegisteredArtifactUseCase),
  );
  dependencies.ipcMain.handle(
    DESKTOP_ARTIFACT_READ_REQUEST_CHANNEL.value,
    createDesktopArtifactReadIpcHandler(dependencies.readArtifactDetailUseCase),
  );
  dependencies.ipcMain.handle(
    DESKTOP_ARTIFACT_CONTENT_READ_REQUEST_CHANNEL.value,
    createDesktopArtifactContentReadIpcHandler(dependencies.readArtifactContentUseCase),
  );
  dependencies.ipcMain.handle(
    DESKTOP_ARTIFACT_MEDIA_VIEW_REQUEST_CHANNEL.value,
    createDesktopArtifactMediaViewIpcHandler(dependencies.artifactMediaViewRetrieval),
  );
  dependencies.ipcMain.handle(
    DESKTOP_ARTIFACT_PUBLISH_REQUEST_CHANNEL.value,
    createDesktopArtifactPublishIpcHandler(dependencies.publishArtifactToRepoUseCase),
  );
  dependencies.ipcMain.handle(
    DESKTOP_ARTIFACT_PUBLISH_VERIFY_REQUEST_CHANNEL.value,
    createDesktopArtifactPublishVerifyIpcHandler(dependencies.verifyPublishedArtifactBackingUseCase),
  );
  dependencies.ipcMain.handle(
    DESKTOP_ARTIFACT_SOURCE_VERIFY_REQUEST_CHANNEL.value,
    createDesktopArtifactSourceVerifyIpcHandler(dependencies.verifyImportedArtifactSourceBackingUseCase),
  );
  dependencies.ipcMain.handle(
    DESKTOP_ARTIFACT_REGISTER_FROM_REPO_REQUEST_CHANNEL.value,
    createDesktopArtifactRegisterFromRepoIpcHandler(dependencies.registerArtifactFromRepoUseCase),
  );
  dependencies.ipcMain.handle(
    DESKTOP_ARTIFACT_LOCALIZE_FROM_REPO_REQUEST_CHANNEL.value,
    createDesktopArtifactLocalizeFromRepoIpcHandler(dependencies.localizeArtifactFromRepoUseCase),
  );
}
