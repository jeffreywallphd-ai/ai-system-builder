import type {
  DesktopArtifactUploadRequest,
  DesktopArtifactUploadRequestPayload,
  DesktopArtifactUploadResponse,
} from "../../../../contracts/ipc";
import {
  DESKTOP_ARTIFACT_UPLOAD_POLICY_READ_REQUEST_CHANNEL,
  DESKTOP_ARTIFACT_UPLOAD_REQUEST_CHANNEL,
  DESKTOP_ARTIFACT_UPLOAD_RESPONSE_CHANNEL,
  createDesktopArtifactUploadPolicyReadSuccessResponse,
  createDesktopArtifactUploadSuccessResponse,
  createIpcError,
  createIpcFailureResponse,
} from "../../../../contracts/ipc";
import type {
  StoreArtifactUploadCommand,
  StoreArtifactUploadCommandContext,
  StoreArtifactUploadUseCaseResult,
} from "../../../../application/use-cases";
import type { ArtifactUploadAcceptedTypePolicy } from "../../../../contracts/artifact-upload";
import type { IpcMainHandlePort } from "../ipcMainHandlePort";
export type { IpcMainHandlePort } from "../ipcMainHandlePort";

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

export interface RegisterArtifactUploadIpcDependencies {
  ipcMain: IpcMainHandlePort;
  storeArtifactUploadUseCase: StoreArtifactUploadUseCasePort;
}

export function mapIpcRequestPayload(
  payload: DesktopArtifactUploadRequestPayload,
): {
  command: StoreArtifactUploadCommand;
  commandContext: StoreArtifactUploadCommandContext;
} {
  return {
    command: {
      fileName: payload.fileName,
      mediaType: payload.mediaType,
      bytes: payload.bytes,
    },
    commandContext: {
      source: payload.boundary.source,
    },
  };
}

export function mapStoreArtifactUploadResultToIpcResponse(
  result: StoreArtifactUploadUseCaseResult,
  request: DesktopArtifactUploadRequest,
): DesktopArtifactUploadResponse {
  if (result.ok) {
    return createDesktopArtifactUploadSuccessResponse(result.value, {
      requestId: result.requestId ?? request.requestId,
      correlationId: result.correlationId ?? request.correlationId,
    });
  }

  return createIpcFailureResponse(
    createIpcError(
      DESKTOP_ARTIFACT_UPLOAD_RESPONSE_CHANNEL,
      result.error.code,
      result.error.message,
      {
        details: result.error.details,
        requestId: result.requestId ?? request.requestId,
        correlationId: result.correlationId ?? request.correlationId,
      },
    ),
  );
}

export function createDesktopArtifactUploadIpcHandler(
  storeArtifactUploadUseCase: StoreArtifactUploadUseCasePort,
) {
  return async (
    _event: unknown,
    request: DesktopArtifactUploadRequest,
  ): Promise<DesktopArtifactUploadResponse> => {
    const mapping = mapIpcRequestPayload(request.payload);
    const result = await storeArtifactUploadUseCase.execute(
      mapping.command,
      mapping.commandContext,
      {
        requestId: request.requestId,
        correlationId: request.correlationId,
      },
    );

    return mapStoreArtifactUploadResultToIpcResponse(result, request);
  };
}

export function registerArtifactUploadIpc(
  dependencies: RegisterArtifactUploadIpcDependencies,
): void {
  dependencies.ipcMain.handle(
    DESKTOP_ARTIFACT_UPLOAD_REQUEST_CHANNEL.value,
    createDesktopArtifactUploadIpcHandler(dependencies.storeArtifactUploadUseCase),
  );

  dependencies.ipcMain.handle(
    DESKTOP_ARTIFACT_UPLOAD_POLICY_READ_REQUEST_CHANNEL.value,
    async (_event, request: { requestId?: string; correlationId?: string }) =>
      createDesktopArtifactUploadPolicyReadSuccessResponse(
        dependencies.storeArtifactUploadUseCase.getAcceptedUploadPolicy(),
        {
          requestId: request.requestId,
          correlationId: request.correlationId,
        },
      ),
  );
}
