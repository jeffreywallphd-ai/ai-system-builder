import type { PrepareTrainingDatasetFromArtifactsCommand } from "../../../../application/use-cases";
import type { ContractResult } from "../../../../contracts/shared";
import type {
  DatasetQualityReviewPage,
  RuntimeTaskProgress,
  RuntimeTaskStatusRecord,
} from "../../../../contracts/runtime";
import {
  DESKTOP_DATASET_PREPARE_TRAINING_START_REQUEST_CHANNEL,
  DESKTOP_DATASET_PREPARE_TRAINING_START_RESPONSE_CHANNEL,
  DESKTOP_DATASET_PREPARE_TRAINING_TASK_READ_REQUEST_CHANNEL,
  DESKTOP_DATASET_PREPARE_TRAINING_TASK_READ_RESPONSE_CHANNEL,
  DESKTOP_DATASET_PREPARE_TRAINING_TASK_CANCEL_REQUEST_CHANNEL,
  DESKTOP_DATASET_PREPARE_TRAINING_TASK_CANCEL_RESPONSE_CHANNEL,
  DESKTOP_DATASET_PREPARE_TRAINING_APPROVE_REQUEST_CHANNEL,
  DESKTOP_DATASET_PREPARE_TRAINING_APPROVE_RESPONSE_CHANNEL,
  DESKTOP_DATASET_PREPARE_TRAINING_REVIEW_PAGE_REQUEST_CHANNEL,
  DESKTOP_DATASET_PREPARE_TRAINING_REVIEW_PAGE_RESPONSE_CHANNEL,
  createDesktopPrepareTrainingDatasetStartSuccessResponse,
  createDesktopPrepareTrainingDatasetTaskReadSuccessResponse,
  createDesktopPrepareTrainingDatasetTaskCancelSuccessResponse,
  createDesktopPrepareTrainingDatasetApproveSuccessResponse,
  createDesktopPrepareTrainingDatasetReviewPageSuccessResponse,
  createIpcError,
  createIpcFailureResponse,
  type DesktopPrepareTrainingDatasetStartRequest,
  type DesktopPrepareTrainingDatasetStartResponse,
  type DesktopPrepareTrainingDatasetTaskReadRequest,
  type DesktopPrepareTrainingDatasetTaskReadResponse,
  type DesktopPrepareTrainingDatasetTaskCancelRequest,
  type DesktopPrepareTrainingDatasetTaskCancelResponse,
  type DesktopPrepareTrainingDatasetTaskReadSuccessValue,
  type DesktopPrepareTrainingDatasetApproveRequest,
  type DesktopPrepareTrainingDatasetApproveResponse,
  type DesktopPrepareTrainingDatasetApproveSuccessValue,
  type DesktopPrepareTrainingDatasetReviewPageRequest,
  type DesktopPrepareTrainingDatasetReviewPageResponse,
  type DesktopPrepareTrainingDatasetFinalResult,
} from "../../../../contracts/ipc";
import type { IpcMainHandlePort } from "../ipcMainHandlePort";

type StartResultValue = {
  requestId: string;
  taskType: string;
  accepted: true;
  status: "queued" | "running";
  startedAt?: string;
  updatedAt?: string;
  metadata?: Record<string, unknown>;
};
type RuntimeTaskStatusReadResult = RuntimeTaskStatusRecord & {
  message?: string;
};
type ReadResultValue =
  | RuntimeTaskStatusReadResult
  | {
      requestId: string;
      taskType: string;
      status: "succeeded" | "review-required";
      result: DesktopPrepareTrainingDatasetFinalResult;
      startedAt?: string;
      updatedAt?: string;
      completedAt?: string;
    };
type CancelResultValue = {
  requestId: string;
  cancelled: boolean;
  status: "cancelled" | "running" | "unknown";
};

type DatasetPreparationRequestContext = {
  requestId?: string;
  correlationId?: string;
  workspaceId?: string;
  organizationId?: string;
  principalId?: string;
};

type AuthoritativeRequestContext = Pick<
  DatasetPreparationRequestContext,
  "organizationId" | "principalId"
>;

export interface PrepareTrainingDatasetFromArtifactsUseCasePort {
  startPrepareTrainingDataset: (
    command: PrepareTrainingDatasetFromArtifactsCommand,
    context?: DatasetPreparationRequestContext,
  ) => Promise<ContractResult<StartResultValue>>;
  readPrepareTrainingDataset: (
    requestId: string,
    context?: DatasetPreparationRequestContext,
  ) => Promise<ContractResult<ReadResultValue>>;
  cancelPrepareTrainingDataset?: (
    requestId: string,
    context?: DatasetPreparationRequestContext,
  ) => Promise<ContractResult<CancelResultValue>>;
  approvePreparedTrainingDataset?: (
    approval: {
      requestId: string;
      reportFingerprint: string;
      outputBaseName?: string;
    },
    context?: DatasetPreparationRequestContext,
  ) => Promise<
    ContractResult<DesktopPrepareTrainingDatasetApproveSuccessValue>
  >;
  readPreparedDatasetQualityReviewPage?: (
    input: {
      requestId: string;
      reportFingerprint: string;
      lineId: DesktopPrepareTrainingDatasetReviewPageRequest["payload"]["lineId"];
      page: number;
    },
    context?: DatasetPreparationRequestContext,
  ) => Promise<ContractResult<DatasetQualityReviewPage>>;
}
export interface RegisterDatasetPreparationIpcDependencies {
  ipcMain: IpcMainHandlePort;
  prepareTrainingDatasetUseCase: PrepareTrainingDatasetFromArtifactsUseCasePort;
  getAuthoritativeRequestContext?: () => AuthoritativeRequestContext;
}

const createRequestContext = (
  request: {
    requestId?: string;
    correlationId?: string;
    payload: { boundary: { workspaceId?: string } };
  },
  getAuthoritativeRequestContext?: () => AuthoritativeRequestContext,
): DatasetPreparationRequestContext => ({
  requestId: request.requestId,
  correlationId: request.correlationId,
  workspaceId: request.payload.boundary.workspaceId,
  ...getAuthoritativeRequestContext?.(),
});

function mapTaskProgress(
  progress: RuntimeTaskProgress | undefined,
): { message?: string; processed?: number; total?: number } | undefined {
  if (!progress) {
    return undefined;
  }

  const details =
    typeof progress.details === "object" && progress.details !== null
      ? (progress.details as Record<string, unknown>)
      : undefined;
  return {
    message:
      typeof progress.message === "string" ? progress.message : undefined,
    processed:
      typeof progress.current === "number"
        ? progress.current
        : typeof details?.processedChunkCount === "number"
          ? details.processedChunkCount
          : undefined,
    total:
      typeof progress.total === "number"
        ? progress.total
        : typeof details?.totalChunkCount === "number"
          ? details.totalChunkCount
          : undefined,
  };
}

function mapTaskMessage(
  value: RuntimeTaskStatusReadResult,
): string | undefined {
  if (typeof value.message === "string") {
    return value.message;
  }

  if (typeof value.error?.message === "string") {
    return value.error.message;
  }

  const progress = "progress" in value ? value.progress : undefined;
  return typeof progress?.message === "string" ? progress.message : undefined;
}

function mapTaskError(value: RuntimeTaskStatusReadResult): {
  code?: string;
  message: string;
  details?: Record<string, unknown>;
} {
  return {
    code: value.error?.code,
    message:
      value.error?.message ??
      mapTaskMessage(value) ??
      "Dataset preparation task failed.",
    details: value.error?.details,
  };
}

function mapPrepareTrainingDatasetTaskStatusToIpcValue(
  value: ReadResultValue,
): DesktopPrepareTrainingDatasetTaskReadSuccessValue {
  const progress = "progress" in value ? value.progress : undefined;
  const completedAt = "completedAt" in value ? value.completedAt : undefined;
  const shared = {
    requestId: value.requestId,
    taskType: "taskType" in value ? value.taskType : undefined,
    startedAt: "startedAt" in value ? value.startedAt : undefined,
    updatedAt: value.updatedAt,
  };
  if (value.status === "succeeded" || value.status === "review-required") {
    if ("result" in value) {
      return {
        ...shared,
        status: value.status,
        result: value.result,
        completedAt,
      };
    }
    return {
      ...shared,
      status: "unknown",
      message: "Dataset preparation succeeded without materialized result.",
      completedAt,
    };
  }
  if (value.status === "failed")
    return {
      ...shared,
      status: "failed",
      error: mapTaskError(value),
      completedAt,
    };
  if (value.status === "cancelled")
    return {
      ...shared,
      status: "cancelled",
      message: mapTaskMessage(value),
      progress: mapTaskProgress(progress),
      completedAt,
    };
  if (value.status === "unknown")
    return {
      ...shared,
      status: "unknown",
      message: mapTaskMessage(value),
      progress: mapTaskProgress(progress),
      completedAt,
    };
  return {
    ...shared,
    status: value.status,
    progress: mapTaskProgress(progress),
  };
}

export const createDesktopPrepareTrainingDatasetStartIpcHandler =
  (
    useCase: PrepareTrainingDatasetFromArtifactsUseCasePort,
    getAuthoritativeRequestContext?: () => AuthoritativeRequestContext,
  ) =>
  async (
    _e: unknown,
    request: DesktopPrepareTrainingDatasetStartRequest,
  ): Promise<DesktopPrepareTrainingDatasetStartResponse> => {
    const result = await useCase.startPrepareTrainingDataset(
      request.payload.command,
      createRequestContext(request, getAuthoritativeRequestContext),
    );
    if (result.ok)
      return createDesktopPrepareTrainingDatasetStartSuccessResponse(
        result.value,
        {
          requestId: result.requestId ?? request.requestId,
          correlationId: result.correlationId ?? request.correlationId,
        },
      );
    return createIpcFailureResponse(
      createIpcError(
        DESKTOP_DATASET_PREPARE_TRAINING_START_RESPONSE_CHANNEL,
        result.error.code,
        result.error.message,
        {
          details: result.error.details,
          requestId: result.requestId ?? request.requestId,
          correlationId: result.correlationId ?? request.correlationId,
        },
      ),
    );
  };

export const createDesktopPrepareTrainingDatasetTaskReadIpcHandler =
  (
    useCase: PrepareTrainingDatasetFromArtifactsUseCasePort,
    getAuthoritativeRequestContext?: () => AuthoritativeRequestContext,
  ) =>
  async (
    _e: unknown,
    request: DesktopPrepareTrainingDatasetTaskReadRequest,
  ): Promise<DesktopPrepareTrainingDatasetTaskReadResponse> => {
    const result = await useCase.readPrepareTrainingDataset(
      request.payload.requestId,
      createRequestContext(request, getAuthoritativeRequestContext),
    );
    if (result.ok)
      return createDesktopPrepareTrainingDatasetTaskReadSuccessResponse(
        mapPrepareTrainingDatasetTaskStatusToIpcValue(result.value),
        {
          requestId: result.requestId ?? request.requestId,
          correlationId: result.correlationId ?? request.correlationId,
        },
      );
    return createIpcFailureResponse(
      createIpcError(
        DESKTOP_DATASET_PREPARE_TRAINING_TASK_READ_RESPONSE_CHANNEL,
        result.error.code,
        result.error.message,
        {
          details: result.error.details,
          requestId: result.requestId ?? request.requestId,
          correlationId: result.correlationId ?? request.correlationId,
        },
      ),
    );
  };

export const createDesktopPrepareTrainingDatasetTaskCancelIpcHandler =
  (
    useCase: PrepareTrainingDatasetFromArtifactsUseCasePort,
    getAuthoritativeRequestContext?: () => AuthoritativeRequestContext,
  ) =>
  async (
    _e: unknown,
    request: DesktopPrepareTrainingDatasetTaskCancelRequest,
  ): Promise<DesktopPrepareTrainingDatasetTaskCancelResponse> => {
    if (!useCase.cancelPrepareTrainingDataset) {
      return createIpcFailureResponse(
        createIpcError(
          DESKTOP_DATASET_PREPARE_TRAINING_TASK_CANCEL_RESPONSE_CHANNEL,
          "unavailable",
          "Dataset preparation cancellation is unavailable.",
          {
            requestId: request.requestId,
            correlationId: request.correlationId,
          },
        ),
      );
    }
    const result = await useCase.cancelPrepareTrainingDataset(
      request.payload.requestId,
      createRequestContext(request, getAuthoritativeRequestContext),
    );
    if (result.ok)
      return createDesktopPrepareTrainingDatasetTaskCancelSuccessResponse(
        result.value,
        {
          requestId: result.requestId ?? request.requestId,
          correlationId: result.correlationId ?? request.correlationId,
        },
      );
    return createIpcFailureResponse(
      createIpcError(
        DESKTOP_DATASET_PREPARE_TRAINING_TASK_CANCEL_RESPONSE_CHANNEL,
        result.error.code,
        result.error.message,
        {
          details: result.error.details,
          requestId: result.requestId ?? request.requestId,
          correlationId: result.correlationId ?? request.correlationId,
        },
      ),
    );
  };

export const createDesktopPrepareTrainingDatasetApproveIpcHandler =
  (
    useCase: PrepareTrainingDatasetFromArtifactsUseCasePort,
    getAuthoritativeRequestContext?: () => AuthoritativeRequestContext,
  ) =>
  async (
    _e: unknown,
    request: DesktopPrepareTrainingDatasetApproveRequest,
  ): Promise<DesktopPrepareTrainingDatasetApproveResponse> => {
    if (!useCase.approvePreparedTrainingDataset) {
      return createIpcFailureResponse(
        createIpcError(
          DESKTOP_DATASET_PREPARE_TRAINING_APPROVE_RESPONSE_CHANNEL,
          "unavailable",
          "Dataset approval is unavailable.",
          {
            requestId: request.requestId,
            correlationId: request.correlationId,
          },
        ),
      );
    }
    const result = await useCase.approvePreparedTrainingDataset(
      {
        requestId: request.payload.requestId,
        reportFingerprint: request.payload.reportFingerprint,
        ...(request.payload.outputBaseName !== undefined
          ? { outputBaseName: request.payload.outputBaseName }
          : {}),
      },
      createRequestContext(request, getAuthoritativeRequestContext),
    );
    if (result.ok)
      return createDesktopPrepareTrainingDatasetApproveSuccessResponse(
        result.value,
        {
          requestId: result.requestId ?? request.requestId,
          correlationId: result.correlationId ?? request.correlationId,
        },
      );
    return createIpcFailureResponse(
      createIpcError(
        DESKTOP_DATASET_PREPARE_TRAINING_APPROVE_RESPONSE_CHANNEL,
        result.error.code,
        result.error.message,
        {
          details: result.error.details,
          requestId: result.requestId ?? request.requestId,
          correlationId: result.correlationId ?? request.correlationId,
        },
      ),
    );
  };

export const createDesktopPrepareTrainingDatasetReviewPageIpcHandler =
  (
    useCase: PrepareTrainingDatasetFromArtifactsUseCasePort,
    getAuthoritativeRequestContext?: () => AuthoritativeRequestContext,
  ) =>
  async (
    _e: unknown,
    request: DesktopPrepareTrainingDatasetReviewPageRequest,
  ): Promise<DesktopPrepareTrainingDatasetReviewPageResponse> => {
    if (!useCase.readPreparedDatasetQualityReviewPage) {
      return createIpcFailureResponse(
        createIpcError(
          DESKTOP_DATASET_PREPARE_TRAINING_REVIEW_PAGE_RESPONSE_CHANNEL,
          "unavailable",
          "Dataset preparation row review is unavailable.",
          {
            requestId: request.requestId,
            correlationId: request.correlationId,
          },
        ),
      );
    }
    const result = await useCase.readPreparedDatasetQualityReviewPage(
      {
        requestId: request.payload.requestId,
        reportFingerprint: request.payload.reportFingerprint,
        lineId: request.payload.lineId,
        page: request.payload.page,
      },
      createRequestContext(request, getAuthoritativeRequestContext),
    );
    if (result.ok)
      return createDesktopPrepareTrainingDatasetReviewPageSuccessResponse(
        result.value,
        {
          requestId: result.requestId ?? request.requestId,
          correlationId: result.correlationId ?? request.correlationId,
        },
      );
    return createIpcFailureResponse(
      createIpcError(
        DESKTOP_DATASET_PREPARE_TRAINING_REVIEW_PAGE_RESPONSE_CHANNEL,
        result.error.code,
        result.error.message,
        {
          details: result.error.details,
          requestId: result.requestId ?? request.requestId,
          correlationId: result.correlationId ?? request.correlationId,
        },
      ),
    );
  };

export function registerDatasetPreparationIpc(
  dependencies: RegisterDatasetPreparationIpcDependencies,
): void {
  dependencies.ipcMain.handle(
    DESKTOP_DATASET_PREPARE_TRAINING_START_REQUEST_CHANNEL.value,
    createDesktopPrepareTrainingDatasetStartIpcHandler(
      dependencies.prepareTrainingDatasetUseCase,
      dependencies.getAuthoritativeRequestContext,
    ),
  );
  dependencies.ipcMain.handle(
    DESKTOP_DATASET_PREPARE_TRAINING_TASK_READ_REQUEST_CHANNEL.value,
    createDesktopPrepareTrainingDatasetTaskReadIpcHandler(
      dependencies.prepareTrainingDatasetUseCase,
      dependencies.getAuthoritativeRequestContext,
    ),
  );
  dependencies.ipcMain.handle(
    DESKTOP_DATASET_PREPARE_TRAINING_TASK_CANCEL_REQUEST_CHANNEL.value,
    createDesktopPrepareTrainingDatasetTaskCancelIpcHandler(
      dependencies.prepareTrainingDatasetUseCase,
      dependencies.getAuthoritativeRequestContext,
    ),
  );
  dependencies.ipcMain.handle(
    DESKTOP_DATASET_PREPARE_TRAINING_APPROVE_REQUEST_CHANNEL.value,
    createDesktopPrepareTrainingDatasetApproveIpcHandler(
      dependencies.prepareTrainingDatasetUseCase,
      dependencies.getAuthoritativeRequestContext,
    ),
  );
  dependencies.ipcMain.handle(
    DESKTOP_DATASET_PREPARE_TRAINING_REVIEW_PAGE_REQUEST_CHANNEL.value,
    createDesktopPrepareTrainingDatasetReviewPageIpcHandler(
      dependencies.prepareTrainingDatasetUseCase,
      dependencies.getAuthoritativeRequestContext,
    ),
  );
}
