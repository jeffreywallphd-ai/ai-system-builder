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
  createDesktopArtifactUploadRequest,
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
import type {
  IpcMainHandlePort,
  IpcSenderTrustPolicy,
} from "../ipcMainHandlePort";
export type { IpcMainHandlePort } from "../ipcMainHandlePort";

export interface StoreArtifactUploadUseCasePort {
  execute: (
    command: StoreArtifactUploadCommand,
    commandContext: StoreArtifactUploadCommandContext,
    context?: {
      requestId?: string;
      correlationId?: string;
      workspaceId?: string;
    },
  ) => Promise<StoreArtifactUploadUseCaseResult>;
  getAcceptedUploadPolicy: () => ArtifactUploadAcceptedTypePolicy | Promise<ArtifactUploadAcceptedTypePolicy>;
}

export interface RegisterArtifactUploadIpcDependencies {
  ipcMain: IpcMainHandlePort;
  senderTrust: IpcSenderTrustPolicy;
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
      workspaceId: payload.workspaceId,
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
  senderTrust: IpcSenderTrustPolicy,
) {
  return async (
    event: unknown,
    request: DesktopArtifactUploadRequest,
  ): Promise<DesktopArtifactUploadResponse> => {
    if (!senderTrust.isTrustedSender(event)) {
      return createIpcFailureResponse(
        createIpcError(
          DESKTOP_ARTIFACT_UPLOAD_RESPONSE_CHANNEL,
          "forbidden",
          "The desktop IPC sender is not trusted.",
          {
            requestId: readOptionalRequestText(request, "requestId"),
            correlationId: readOptionalRequestText(request, "correlationId"),
          },
        ),
      );
    }

    let normalizedRequest: DesktopArtifactUploadRequest;
    try {
      normalizedRequest = createDesktopArtifactUploadRequest(request.payload, {
        requestId: readOptionalRequestText(request, "requestId"),
        correlationId: readOptionalRequestText(request, "correlationId"),
      });
    } catch (error) {
      return createIpcFailureResponse(
        createIpcError(
          DESKTOP_ARTIFACT_UPLOAD_RESPONSE_CHANNEL,
          "validation",
          error instanceof Error ? error.message : "Invalid upload request.",
          {
            requestId: readOptionalRequestText(request, "requestId"),
            correlationId: readOptionalRequestText(request, "correlationId"),
          },
        ),
      );
    }

    const mapping = mapIpcRequestPayload(normalizedRequest.payload);
    const result = await storeArtifactUploadUseCase.execute(
      mapping.command,
      mapping.commandContext,
      {
        requestId: normalizedRequest.requestId,
        correlationId: normalizedRequest.correlationId,
        workspaceId: normalizedRequest.payload.workspaceId,
      },
    );

    return mapStoreArtifactUploadResultToIpcResponse(result, normalizedRequest);
  };
}

function readOptionalRequestText(
  request: unknown,
  field: "requestId" | "correlationId",
): string | undefined {
  if (!request || typeof request !== "object") return undefined;
  const value = (request as Record<string, unknown>)[field];
  return typeof value === "string" ? value : undefined;
}

export function registerArtifactUploadIpc(
  dependencies: RegisterArtifactUploadIpcDependencies,
): void {
  dependencies.ipcMain.handle(
    DESKTOP_ARTIFACT_UPLOAD_REQUEST_CHANNEL.value,
    createDesktopArtifactUploadIpcHandler(
      dependencies.storeArtifactUploadUseCase,
      dependencies.senderTrust,
    ),
  );

  dependencies.ipcMain.handle(
    DESKTOP_ARTIFACT_UPLOAD_POLICY_READ_REQUEST_CHANNEL.value,
    async (_event, request: { requestId?: string; correlationId?: string }) =>
      createDesktopArtifactUploadPolicyReadSuccessResponse(
        await dependencies.storeArtifactUploadUseCase.getAcceptedUploadPolicy(),
        {
          requestId: request.requestId,
          correlationId: request.correlationId,
        },
      ),
  );
}
