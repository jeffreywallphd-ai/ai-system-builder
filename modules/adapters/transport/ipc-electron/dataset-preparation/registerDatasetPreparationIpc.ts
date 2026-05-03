import type {
  PrepareTrainingDatasetFromArtifactsCommand,
} from "../../../../application/use-cases";
import type { ContractResult } from "../../../../contracts/shared";
import type { RuntimeTaskRecord } from "../../../../contracts/runtime";
import {
  DESKTOP_DATASET_PREPARE_TRAINING_START_REQUEST_CHANNEL,
  DESKTOP_DATASET_PREPARE_TRAINING_START_RESPONSE_CHANNEL,
  DESKTOP_DATASET_PREPARE_TRAINING_TASK_READ_REQUEST_CHANNEL,
  DESKTOP_DATASET_PREPARE_TRAINING_TASK_READ_RESPONSE_CHANNEL,
  DESKTOP_DATASET_PREPARE_TRAINING_TASK_CANCEL_REQUEST_CHANNEL,
  DESKTOP_DATASET_PREPARE_TRAINING_TASK_CANCEL_RESPONSE_CHANNEL,
  createDesktopPrepareTrainingDatasetStartSuccessResponse,
  createDesktopPrepareTrainingDatasetTaskReadSuccessResponse,
  createDesktopPrepareTrainingDatasetTaskCancelSuccessResponse,
  createIpcError,
  createIpcFailureResponse,
  type DesktopPrepareTrainingDatasetStartRequest,
  type DesktopPrepareTrainingDatasetStartResponse,
  type DesktopPrepareTrainingDatasetTaskReadRequest,
  type DesktopPrepareTrainingDatasetTaskReadResponse,
  type DesktopPrepareTrainingDatasetTaskCancelRequest,
  type DesktopPrepareTrainingDatasetTaskCancelResponse,
  type DesktopPrepareTrainingDatasetTaskReadSuccessValue,
  type DesktopPrepareTrainingDatasetFinalResult,
} from "../../../../contracts/ipc";
import type { IpcMainHandlePort } from "../ipcMainHandlePort";

type StartResultValue = { requestId: string; taskType: string; accepted: true; status: "queued" | "running"; startedAt?: string; updatedAt?: string; metadata?: Record<string, unknown> };
type RuntimeTaskStatusReadResult = RuntimeTaskRecord & {
  message?: string;
};
type ReadResultValue = RuntimeTaskStatusReadResult | { requestId: string; taskType: string; status: "succeeded"; result: DesktopPrepareTrainingDatasetFinalResult; startedAt?: string; updatedAt?: string; completedAt?: string };
type CancelResultValue = { requestId: string; cancelled: boolean; status: "cancelled" | "running" | "unknown" };

export interface PrepareTrainingDatasetFromArtifactsUseCasePort {
  startPrepareTrainingDataset: (command: PrepareTrainingDatasetFromArtifactsCommand, context?: { requestId?: string; correlationId?: string }) => Promise<ContractResult<StartResultValue>>;
  readPrepareTrainingDataset: (requestId: string, context?: { requestId?: string; correlationId?: string }) => Promise<ContractResult<ReadResultValue>>;
  cancelPrepareTrainingDataset?: (requestId: string, context?: { requestId?: string; correlationId?: string }) => Promise<ContractResult<CancelResultValue>>;
}
export interface RegisterDatasetPreparationIpcDependencies { ipcMain: IpcMainHandlePort; prepareTrainingDatasetUseCase: PrepareTrainingDatasetFromArtifactsUseCasePort; }

function mapTaskProgress(progress: RuntimeTaskRecord["progress"]): { message?: string; processed?: number; total?: number } | undefined {
  if (!progress) {
    return undefined;
  }

  const details = (typeof progress.details === "object" && progress.details !== null)
    ? progress.details as Record<string, unknown>
    : undefined;
  return {
    message: typeof progress.message === "string" ? progress.message : undefined,
    processed: typeof progress.current === "number"
      ? progress.current
      : (typeof details?.processedChunkCount === "number" ? details.processedChunkCount : undefined),
    total: typeof progress.total === "number"
      ? progress.total
      : (typeof details?.totalChunkCount === "number" ? details.totalChunkCount : undefined),
  };
}

function mapTaskMessage(value: RuntimeTaskStatusReadResult): string | undefined {
  if (typeof value.message === "string") {
    return value.message;
  }

  return typeof value.progress?.message === "string" ? value.progress.message : undefined;
}

function mapTaskError(value: RuntimeTaskStatusReadResult): { code?: string; message: string; details?: Record<string, unknown> } {
  return {
    code: value.error?.code,
    message: value.error?.message ?? mapTaskMessage(value) ?? "Dataset preparation task failed.",
    details: value.error?.details,
  };
}

function mapPrepareTrainingDatasetTaskStatusToIpcValue(value: ReadResultValue): DesktopPrepareTrainingDatasetTaskReadSuccessValue {
  const shared = { requestId: value.requestId, taskType: value.taskType, startedAt: value.startedAt, updatedAt: value.updatedAt };
  if (value.status === "succeeded") {
    if ("result" in value) {
      return { ...shared, status: "succeeded", result: value.result, completedAt: value.completedAt };
    }
    return { ...shared, status: "unknown", message: "Dataset preparation succeeded without materialized result.", completedAt: value.completedAt };
  }
  if (value.status === "failed") return { ...shared, status: "failed", error: mapTaskError(value), completedAt: value.completedAt };
  if (value.status === "cancelled") return { ...shared, status: "cancelled", message: mapTaskMessage(value), progress: mapTaskProgress(value.progress), completedAt: value.completedAt };
  if (value.status === "unknown") return { ...shared, status: "unknown", message: mapTaskMessage(value), progress: mapTaskProgress(value.progress), completedAt: value.completedAt };
  return { ...shared, status: value.status, progress: mapTaskProgress(value.progress) };
}

export const createDesktopPrepareTrainingDatasetStartIpcHandler = (useCase: PrepareTrainingDatasetFromArtifactsUseCasePort) => async (_e: unknown, request: DesktopPrepareTrainingDatasetStartRequest): Promise<DesktopPrepareTrainingDatasetStartResponse> => {
  const result = await useCase.startPrepareTrainingDataset(request.payload.command, { requestId: request.requestId, correlationId: request.correlationId });
  if (result.ok) return createDesktopPrepareTrainingDatasetStartSuccessResponse(result.value, { requestId: result.requestId ?? request.requestId, correlationId: result.correlationId ?? request.correlationId });
  return createIpcFailureResponse(createIpcError(DESKTOP_DATASET_PREPARE_TRAINING_START_RESPONSE_CHANNEL, result.error.code, result.error.message, { details: result.error.details, requestId: result.requestId ?? request.requestId, correlationId: result.correlationId ?? request.correlationId }));
};

export const createDesktopPrepareTrainingDatasetTaskReadIpcHandler = (useCase: PrepareTrainingDatasetFromArtifactsUseCasePort) => async (_e: unknown, request: DesktopPrepareTrainingDatasetTaskReadRequest): Promise<DesktopPrepareTrainingDatasetTaskReadResponse> => {
  const result = await useCase.readPrepareTrainingDataset(request.payload.requestId, { requestId: request.requestId, correlationId: request.correlationId });
  if (result.ok) return createDesktopPrepareTrainingDatasetTaskReadSuccessResponse(mapPrepareTrainingDatasetTaskStatusToIpcValue(result.value), { requestId: result.requestId ?? request.requestId, correlationId: result.correlationId ?? request.correlationId });
  return createIpcFailureResponse(createIpcError(DESKTOP_DATASET_PREPARE_TRAINING_TASK_READ_RESPONSE_CHANNEL, result.error.code, result.error.message, { details: result.error.details, requestId: result.requestId ?? request.requestId, correlationId: result.correlationId ?? request.correlationId }));
};

export const createDesktopPrepareTrainingDatasetTaskCancelIpcHandler = (useCase: PrepareTrainingDatasetFromArtifactsUseCasePort) => async (_e: unknown, request: DesktopPrepareTrainingDatasetTaskCancelRequest): Promise<DesktopPrepareTrainingDatasetTaskCancelResponse> => {
  if (!useCase.cancelPrepareTrainingDataset) {
    return createIpcFailureResponse(createIpcError(DESKTOP_DATASET_PREPARE_TRAINING_TASK_CANCEL_RESPONSE_CHANNEL, "unavailable", "Dataset preparation cancellation is unavailable.", { requestId: request.requestId, correlationId: request.correlationId }));
  }
  const result = await useCase.cancelPrepareTrainingDataset(request.payload.requestId, { requestId: request.requestId, correlationId: request.correlationId });
  if (result.ok) return createDesktopPrepareTrainingDatasetTaskCancelSuccessResponse(result.value, { requestId: result.requestId ?? request.requestId, correlationId: result.correlationId ?? request.correlationId });
  return createIpcFailureResponse(createIpcError(DESKTOP_DATASET_PREPARE_TRAINING_TASK_CANCEL_RESPONSE_CHANNEL, result.error.code, result.error.message, { details: result.error.details, requestId: result.requestId ?? request.requestId, correlationId: result.correlationId ?? request.correlationId }));
};

export function registerDatasetPreparationIpc(dependencies: RegisterDatasetPreparationIpcDependencies): void {
  dependencies.ipcMain.handle(DESKTOP_DATASET_PREPARE_TRAINING_START_REQUEST_CHANNEL.value, createDesktopPrepareTrainingDatasetStartIpcHandler(dependencies.prepareTrainingDatasetUseCase));
  dependencies.ipcMain.handle(DESKTOP_DATASET_PREPARE_TRAINING_TASK_READ_REQUEST_CHANNEL.value, createDesktopPrepareTrainingDatasetTaskReadIpcHandler(dependencies.prepareTrainingDatasetUseCase));
  dependencies.ipcMain.handle(DESKTOP_DATASET_PREPARE_TRAINING_TASK_CANCEL_REQUEST_CHANNEL.value, createDesktopPrepareTrainingDatasetTaskCancelIpcHandler(dependencies.prepareTrainingDatasetUseCase));
}
