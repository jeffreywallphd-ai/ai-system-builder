import type {
  PrepareTrainingDatasetFromArtifactsCommand,
  PrepareTrainingDatasetFromArtifactsResult,
} from "../../../../application/use-cases";
import {
  DESKTOP_DATASET_PREPARE_TRAINING_REQUEST_CHANNEL,
  DESKTOP_DATASET_PREPARE_TRAINING_RESPONSE_CHANNEL,
  createDesktopPrepareTrainingDatasetSuccessResponse,
  createIpcError,
  createIpcFailureResponse,
  type DesktopPrepareTrainingDatasetRequest,
  type DesktopPrepareTrainingDatasetResponse,
} from "../../../../contracts/ipc";
import type { IpcMainHandlePort } from "../ipcMainHandlePort";

export interface PrepareTrainingDatasetFromArtifactsUseCasePort {
  execute: (
    command: PrepareTrainingDatasetFromArtifactsCommand,
    context?: {
      requestId?: string;
      correlationId?: string;
    },
  ) => Promise<PrepareTrainingDatasetFromArtifactsResult>;
}

export interface RegisterDatasetPreparationIpcDependencies {
  ipcMain: IpcMainHandlePort;
  prepareTrainingDatasetFromArtifactsUseCase: PrepareTrainingDatasetFromArtifactsUseCasePort;
}

function mapPrepareTrainingDatasetResultToIpcResponse(
  result: PrepareTrainingDatasetFromArtifactsResult,
  request: DesktopPrepareTrainingDatasetRequest,
): DesktopPrepareTrainingDatasetResponse {
  if (result.ok) {
    return createDesktopPrepareTrainingDatasetSuccessResponse(result.value, {
      requestId: result.requestId ?? request.requestId,
      correlationId: result.correlationId ?? request.correlationId,
    });
  }

  return createIpcFailureResponse(
    createIpcError(
      DESKTOP_DATASET_PREPARE_TRAINING_RESPONSE_CHANNEL,
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

export function createDesktopPrepareTrainingDatasetIpcHandler(
  useCase: PrepareTrainingDatasetFromArtifactsUseCasePort,
) {
  return async (
    _event: unknown,
    request: DesktopPrepareTrainingDatasetRequest,
  ): Promise<DesktopPrepareTrainingDatasetResponse> => {
    const result = await useCase.execute(
      request.payload.command,
      {
        requestId: request.requestId,
        correlationId: request.correlationId,
      },
    );

    return mapPrepareTrainingDatasetResultToIpcResponse(result, request);
  };
}

export function registerDatasetPreparationIpc(
  dependencies: RegisterDatasetPreparationIpcDependencies,
): void {
  dependencies.ipcMain.handle(
    DESKTOP_DATASET_PREPARE_TRAINING_REQUEST_CHANNEL.value,
    createDesktopPrepareTrainingDatasetIpcHandler(dependencies.prepareTrainingDatasetFromArtifactsUseCase),
  );
}
