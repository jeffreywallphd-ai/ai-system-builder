import type {
  BrowseModelsUseCase,
  DeleteModelRecordUseCase,
  DownloadModelUseCase,
  GetModelDetailsUseCase,
  ListModelsUseCase,
  SaveModelReferenceUseCase,
  UpdateModelRecordUseCase,
  TrainModelUseCase,
  ValidateModelUseCase,
  PublishModelUseCase,
} from "../../../../application/use-cases/model";
import {
  DESKTOP_MODEL_BROWSE_REQUEST_CHANNEL,
  DESKTOP_MODEL_DETAILS_READ_REQUEST_CHANNEL,
  DESKTOP_MODEL_LIST_REQUEST_CHANNEL,
  DESKTOP_MODEL_RECORD_DELETE_REQUEST_CHANNEL,
  DESKTOP_MODEL_RECORD_UPDATE_REQUEST_CHANNEL,
  DESKTOP_MODEL_DOWNLOAD_REQUEST_CHANNEL,
  DESKTOP_MODEL_REFERENCE_SAVE_REQUEST_CHANNEL,
  DESKTOP_MODEL_BROWSE_RESPONSE_CHANNEL,
  DESKTOP_MODEL_DETAILS_READ_RESPONSE_CHANNEL,
  DESKTOP_MODEL_LIST_RESPONSE_CHANNEL,
  DESKTOP_MODEL_RECORD_DELETE_RESPONSE_CHANNEL,
  DESKTOP_MODEL_TRAIN_REQUEST_CHANNEL,
  DESKTOP_MODEL_TRAIN_RESPONSE_CHANNEL,
  DESKTOP_MODEL_TRAIN_STATUS_REQUEST_CHANNEL,
  DESKTOP_MODEL_TRAIN_STATUS_RESPONSE_CHANNEL,
  DESKTOP_MODEL_RECORD_UPDATE_RESPONSE_CHANNEL,
  DESKTOP_MODEL_DOWNLOAD_RESPONSE_CHANNEL,
  DESKTOP_MODEL_REFERENCE_SAVE_RESPONSE_CHANNEL,
  DESKTOP_MODEL_VALIDATE_REQUEST_CHANNEL,
  DESKTOP_MODEL_VALIDATE_RESPONSE_CHANNEL,
  DESKTOP_MODEL_PUBLISH_REQUEST_CHANNEL,
  DESKTOP_MODEL_PUBLISH_RESPONSE_CHANNEL,
  createDesktopModelBrowseSuccessResponse,
  createDesktopModelDetailsReadSuccessResponse,
  createDesktopModelListSuccessResponse,
  createDesktopModelRecordDeleteSuccessResponse,
  createDesktopModelTrainSuccessResponse,
  createDesktopModelTrainStatusSuccessResponse,
  createDesktopModelRecordUpdateSuccessResponse,
  createDesktopModelDownloadSuccessResponse,
  createDesktopModelReferenceSaveSuccessResponse,
  createDesktopModelValidateSuccessResponse,
  createDesktopModelPublishSuccessResponse,
  createIpcError,
  createIpcFailureResponse,
  type IpcChannel,
  type IpcChannelValue,
  type IpcOperation,
  type DesktopModelBrowseRequest,
  type DesktopModelBrowseResponse,
  type DesktopModelDetailsReadRequest,
  type DesktopModelDetailsReadResponse,
  type DesktopModelListRequest,
  type DesktopModelListResponse,
  type DesktopModelRecordDeleteRequest,
  type DesktopModelRecordDeleteResponse,
  type DesktopModelRecordUpdateRequest,
  type DesktopModelTrainRequest,
  type DesktopModelTrainResponse,
  type DesktopModelTrainStatusRequest,
  type DesktopModelTrainStatusResponse,
  type DesktopModelRecordUpdateResponse,
  type DesktopModelDownloadRequest,
  type DesktopModelDownloadResponse,
  type DesktopModelReferenceSaveRequest,
  type DesktopModelReferenceSaveResponse,
  type DesktopModelValidateRequest,
  type DesktopModelValidateResponse,
  type DesktopModelPublishRequest,
  type DesktopModelPublishResponse,
} from "../../../../contracts/ipc";
import type { IpcMainHandlePort } from "../ipcMainHandlePort";

export interface RegisterModelManagementIpcDependencies {
  ipcMain: IpcMainHandlePort;
  browseModelsUseCase: Pick<BrowseModelsUseCase, "execute">;
  getModelDetailsUseCase: Pick<GetModelDetailsUseCase, "execute">;
  listModelsUseCase: Pick<ListModelsUseCase, "execute">;
  saveModelReferenceUseCase: Pick<SaveModelReferenceUseCase, "execute">;
  downloadModelUseCase: Pick<DownloadModelUseCase, "execute">;
  updateModelRecordUseCase: Pick<UpdateModelRecordUseCase, "execute">;
  deleteModelRecordUseCase: Pick<DeleteModelRecordUseCase, "execute">;
  trainModelUseCase: Pick<TrainModelUseCase, "execute" | "read">;
  validateModelUseCase: Pick<ValidateModelUseCase, "execute">;
  publishModelUseCase: Pick<PublishModelUseCase, "execute">;
}

function toFailureResponse<
  TResponse,
  TOperation extends IpcOperation = IpcOperation,
  TChannel extends IpcChannelValue<TOperation, "response"> = IpcChannelValue<TOperation, "response">,
>(
  channel: IpcChannel<TOperation, "response", TChannel>,
  error: unknown,
  request: { requestId?: string; correlationId?: string },
): TResponse {
  return createIpcFailureResponse(
    createIpcError(
      channel,
      "internal",
      error instanceof Error ? error.message : "Unexpected IPC model handler failure.",
      { requestId: request.requestId, correlationId: request.correlationId },
    ),
  ) as TResponse;
}

export function createBrowseModelsIpcHandler(useCase: Pick<BrowseModelsUseCase, "execute">) {
  return async (_event: unknown, request: DesktopModelBrowseRequest): Promise<DesktopModelBrowseResponse> => {
    try {
      const result = await useCase.execute(request.payload);
      return createDesktopModelBrowseSuccessResponse(result, { requestId: request.requestId, correlationId: request.correlationId });
    } catch (error) {
      return toFailureResponse<DesktopModelBrowseResponse>(DESKTOP_MODEL_BROWSE_RESPONSE_CHANNEL, error, request);
    }
  };
}

export function createGetModelDetailsIpcHandler(useCase: Pick<GetModelDetailsUseCase, "execute">) {
  return async (_event: unknown, request: DesktopModelDetailsReadRequest): Promise<DesktopModelDetailsReadResponse> => {
    try {
      const result = await useCase.execute(request.payload);
      return createDesktopModelDetailsReadSuccessResponse(result, { requestId: request.requestId, correlationId: request.correlationId });
    } catch (error) {
      return toFailureResponse<DesktopModelDetailsReadResponse>(DESKTOP_MODEL_DETAILS_READ_RESPONSE_CHANNEL, error, request);
    }
  };
}

export function createListModelsIpcHandler(useCase: Pick<ListModelsUseCase, "execute">) {
  return async (_event: unknown, request: DesktopModelListRequest): Promise<DesktopModelListResponse> => {
    try {
      const result = await useCase.execute(request.payload);
      return createDesktopModelListSuccessResponse(result, { requestId: request.requestId, correlationId: request.correlationId });
    } catch (error) {
      return toFailureResponse<DesktopModelListResponse>(DESKTOP_MODEL_LIST_RESPONSE_CHANNEL, error, request);
    }
  };
}

export function createSaveModelReferenceIpcHandler(useCase: Pick<SaveModelReferenceUseCase, "execute">) {
  return async (_event: unknown, request: DesktopModelReferenceSaveRequest): Promise<DesktopModelReferenceSaveResponse> => {
    try {
      const result = await useCase.execute(request.payload);
      return createDesktopModelReferenceSaveSuccessResponse(result, { requestId: request.requestId, correlationId: request.correlationId });
    } catch (error) {
      return toFailureResponse<DesktopModelReferenceSaveResponse>(DESKTOP_MODEL_REFERENCE_SAVE_RESPONSE_CHANNEL, error, request);
    }
  };
}

export function createDownloadModelIpcHandler(useCase: Pick<DownloadModelUseCase, "execute">) {
  return async (_event: unknown, request: DesktopModelDownloadRequest): Promise<DesktopModelDownloadResponse> => {
    try {
      const result = await useCase.execute(request.payload);
      return createDesktopModelDownloadSuccessResponse(result, { requestId: request.requestId, correlationId: request.correlationId });
    } catch (error) {
      return toFailureResponse<DesktopModelDownloadResponse>(DESKTOP_MODEL_DOWNLOAD_RESPONSE_CHANNEL, error, request);
    }
  };
}

export function createUpdateModelRecordIpcHandler(useCase: Pick<UpdateModelRecordUseCase, "execute">) {
  return async (_event: unknown, request: DesktopModelRecordUpdateRequest): Promise<DesktopModelRecordUpdateResponse> => {
    try {
      const result = await useCase.execute(request.payload);
      return createDesktopModelRecordUpdateSuccessResponse(result, { requestId: request.requestId, correlationId: request.correlationId });
    } catch (error) {
      return toFailureResponse<DesktopModelRecordUpdateResponse>(DESKTOP_MODEL_RECORD_UPDATE_RESPONSE_CHANNEL, error, request);
    }
  };
}

export function createDeleteModelRecordIpcHandler(useCase: Pick<DeleteModelRecordUseCase, "execute">) {
  return async (_event: unknown, request: DesktopModelRecordDeleteRequest): Promise<DesktopModelRecordDeleteResponse> => {
    try {
      const result = await useCase.execute(request.payload);
      return createDesktopModelRecordDeleteSuccessResponse(result, { requestId: request.requestId, correlationId: request.correlationId });
    } catch (error) {
      return toFailureResponse<DesktopModelRecordDeleteResponse>(DESKTOP_MODEL_RECORD_DELETE_RESPONSE_CHANNEL, error, request);
    }
  };
}


export function createTrainModelIpcHandler(useCase: Pick<TrainModelUseCase, "execute">) {
  return async (_event: unknown, request: DesktopModelTrainRequest): Promise<DesktopModelTrainResponse> => {
    try {
      const result = await useCase.execute(request.payload);
      return createDesktopModelTrainSuccessResponse(result, { requestId: request.requestId, correlationId: request.correlationId });
    } catch (error) {
      return toFailureResponse<DesktopModelTrainResponse>(DESKTOP_MODEL_TRAIN_RESPONSE_CHANNEL, error, request);
    }
  };
}

export function createReadModelTrainingStatusIpcHandler(useCase: Pick<TrainModelUseCase, "read">) {
  return async (_event: unknown, request: DesktopModelTrainStatusRequest): Promise<DesktopModelTrainStatusResponse> => {
    try {
      const result = await useCase.read(request.payload.runId);
      return createDesktopModelTrainStatusSuccessResponse(result, { requestId: request.requestId, correlationId: request.correlationId });
    } catch (error) {
      return toFailureResponse<DesktopModelTrainStatusResponse>(DESKTOP_MODEL_TRAIN_STATUS_RESPONSE_CHANNEL, error, request);
    }
  };
}

export function createValidateModelIpcHandler(useCase: Pick<ValidateModelUseCase, "execute">) {
  return async (_event: unknown, request: DesktopModelValidateRequest): Promise<DesktopModelValidateResponse> => {
    try {
      const result = await useCase.execute(request.payload);
      return createDesktopModelValidateSuccessResponse(result, { requestId: request.requestId, correlationId: request.correlationId });
    } catch (error) {
      return toFailureResponse<DesktopModelValidateResponse>(DESKTOP_MODEL_VALIDATE_RESPONSE_CHANNEL, error, request);
    }
  };
}

export function createPublishModelIpcHandler(useCase: Pick<PublishModelUseCase, "execute">) {
  return async (_event: unknown, request: DesktopModelPublishRequest): Promise<DesktopModelPublishResponse> => {
    try {
      const result = await useCase.execute(request.payload);
      return createDesktopModelPublishSuccessResponse(result, { requestId: request.requestId, correlationId: request.correlationId });
    } catch (error) {
      return toFailureResponse<DesktopModelPublishResponse>(DESKTOP_MODEL_PUBLISH_RESPONSE_CHANNEL, error, request);
    }
  };
}

export function registerModelManagementIpc(dependencies: RegisterModelManagementIpcDependencies): void {
  dependencies.ipcMain.handle(
    DESKTOP_MODEL_BROWSE_REQUEST_CHANNEL.value,
    createBrowseModelsIpcHandler(dependencies.browseModelsUseCase),
  );
  dependencies.ipcMain.handle(
    DESKTOP_MODEL_DETAILS_READ_REQUEST_CHANNEL.value,
    createGetModelDetailsIpcHandler(dependencies.getModelDetailsUseCase),
  );
  dependencies.ipcMain.handle(
    DESKTOP_MODEL_LIST_REQUEST_CHANNEL.value,
    createListModelsIpcHandler(dependencies.listModelsUseCase),
  );
  dependencies.ipcMain.handle(
    DESKTOP_MODEL_REFERENCE_SAVE_REQUEST_CHANNEL.value,
    createSaveModelReferenceIpcHandler(dependencies.saveModelReferenceUseCase),
  );
  dependencies.ipcMain.handle(
    DESKTOP_MODEL_DOWNLOAD_REQUEST_CHANNEL.value,
    createDownloadModelIpcHandler(dependencies.downloadModelUseCase),
  );
  dependencies.ipcMain.handle(
    DESKTOP_MODEL_RECORD_UPDATE_REQUEST_CHANNEL.value,
    createUpdateModelRecordIpcHandler(dependencies.updateModelRecordUseCase),
  );
  dependencies.ipcMain.handle(
    DESKTOP_MODEL_RECORD_DELETE_REQUEST_CHANNEL.value,
    createDeleteModelRecordIpcHandler(dependencies.deleteModelRecordUseCase),
  );
  dependencies.ipcMain.handle(
    DESKTOP_MODEL_TRAIN_REQUEST_CHANNEL.value,
    createTrainModelIpcHandler(dependencies.trainModelUseCase),
  );
  dependencies.ipcMain.handle(
    DESKTOP_MODEL_TRAIN_STATUS_REQUEST_CHANNEL.value,
    createReadModelTrainingStatusIpcHandler(dependencies.trainModelUseCase),
  );
  dependencies.ipcMain.handle(
    DESKTOP_MODEL_VALIDATE_REQUEST_CHANNEL.value,
    createValidateModelIpcHandler(dependencies.validateModelUseCase),
  );
  dependencies.ipcMain.handle(
    DESKTOP_MODEL_PUBLISH_REQUEST_CHANNEL.value,
    createPublishModelIpcHandler(dependencies.publishModelUseCase),
  );
}
