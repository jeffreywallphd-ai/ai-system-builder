import type {
  BrowseModelsRequest,
  BrowseModelsResult,
  DeleteModelRecordRequest,
  DeleteModelRecordResult,
  RevealModelInFolderRequest,
  RevealModelInFolderResult,
  DownloadModelRequest,
  DownloadModelResult,
  StartModelDownloadTaskResult,
  ReadModelDownloadTaskRequest,
  ReadModelDownloadTaskResult,
  ListModelDownloadTasksRequest,
  ListModelDownloadTasksResult,
  CancelModelDownloadTaskRequest,
  CancelModelDownloadTaskResult,
  GetModelDetailsRequest,
  GetModelDetailsResult,
  ListModelsRequest,
  ListModelsResult,
  SaveModelReferenceRequest,
  SaveModelReferenceResult,
  UpdateModelRecordRequest,
  UpdateModelRecordResult,
  ModelTrainingRequest,
  ModelTrainingStatusRequest,
  ModelTrainingResult,
  ValidateModelRequest,
  ValidateModelResult,
  PublishModelRequest,
  PublishModelResult,
} from "../model";
import { createTransportOperation } from "../transport";
import { createIpcChannel } from "./ipc-channel";
import { createIpcRequest, type IpcRequest } from "./ipc-request";
import { createIpcSuccessResponse, type IpcResponse } from "./ipc-response";

export const DESKTOP_MODEL_BROWSE_OPERATION = createTransportOperation("model", "browse");
export const DESKTOP_MODEL_DETAILS_READ_OPERATION = createTransportOperation("model", "details-read");
export const DESKTOP_MODEL_LIST_OPERATION = createTransportOperation("model", "list");
export const DESKTOP_MODEL_REFERENCE_SAVE_OPERATION = createTransportOperation("model", "reference-save");
export const DESKTOP_MODEL_DOWNLOAD_OPERATION = createTransportOperation("model", "download");
export const DESKTOP_MODEL_DOWNLOAD_START_OPERATION = createTransportOperation("model", "download-start");
export const DESKTOP_MODEL_DOWNLOAD_READ_OPERATION = createTransportOperation("model", "download-read");
export const DESKTOP_MODEL_DOWNLOAD_LIST_OPERATION = createTransportOperation("model", "download-list");
export const DESKTOP_MODEL_DOWNLOAD_CANCEL_OPERATION = createTransportOperation("model", "download-cancel");
export const DESKTOP_MODEL_RECORD_UPDATE_OPERATION = createTransportOperation("model", "record-update");
export const DESKTOP_MODEL_RECORD_DELETE_OPERATION = createTransportOperation("model", "record-delete");
export const DESKTOP_MODEL_FOLDER_REVEAL_OPERATION = createTransportOperation("model", "folder-reveal");
export const DESKTOP_MODEL_TRAIN_OPERATION = createTransportOperation("model", "train");
export const DESKTOP_MODEL_TRAIN_STATUS_OPERATION = createTransportOperation("model", "train-status");
export const DESKTOP_MODEL_VALIDATE_OPERATION = createTransportOperation("model", "validate");
export const DESKTOP_MODEL_PUBLISH_OPERATION = createTransportOperation("model", "publish");

export const DESKTOP_MODEL_BROWSE_REQUEST_CHANNEL = createIpcChannel(DESKTOP_MODEL_BROWSE_OPERATION, "request");
export const DESKTOP_MODEL_BROWSE_RESPONSE_CHANNEL = createIpcChannel(DESKTOP_MODEL_BROWSE_OPERATION, "response");
export const DESKTOP_MODEL_DETAILS_READ_REQUEST_CHANNEL = createIpcChannel(DESKTOP_MODEL_DETAILS_READ_OPERATION, "request");
export const DESKTOP_MODEL_DETAILS_READ_RESPONSE_CHANNEL = createIpcChannel(DESKTOP_MODEL_DETAILS_READ_OPERATION, "response");
export const DESKTOP_MODEL_LIST_REQUEST_CHANNEL = createIpcChannel(DESKTOP_MODEL_LIST_OPERATION, "request");
export const DESKTOP_MODEL_LIST_RESPONSE_CHANNEL = createIpcChannel(DESKTOP_MODEL_LIST_OPERATION, "response");
export const DESKTOP_MODEL_REFERENCE_SAVE_REQUEST_CHANNEL = createIpcChannel(DESKTOP_MODEL_REFERENCE_SAVE_OPERATION, "request");
export const DESKTOP_MODEL_REFERENCE_SAVE_RESPONSE_CHANNEL = createIpcChannel(DESKTOP_MODEL_REFERENCE_SAVE_OPERATION, "response");
export const DESKTOP_MODEL_DOWNLOAD_REQUEST_CHANNEL = createIpcChannel(DESKTOP_MODEL_DOWNLOAD_OPERATION, "request");
export const DESKTOP_MODEL_DOWNLOAD_RESPONSE_CHANNEL = createIpcChannel(DESKTOP_MODEL_DOWNLOAD_OPERATION, "response");
export const DESKTOP_MODEL_DOWNLOAD_START_REQUEST_CHANNEL = createIpcChannel(DESKTOP_MODEL_DOWNLOAD_START_OPERATION, "request");
export const DESKTOP_MODEL_DOWNLOAD_START_RESPONSE_CHANNEL = createIpcChannel(DESKTOP_MODEL_DOWNLOAD_START_OPERATION, "response");
export const DESKTOP_MODEL_DOWNLOAD_READ_REQUEST_CHANNEL = createIpcChannel(DESKTOP_MODEL_DOWNLOAD_READ_OPERATION, "request");
export const DESKTOP_MODEL_DOWNLOAD_READ_RESPONSE_CHANNEL = createIpcChannel(DESKTOP_MODEL_DOWNLOAD_READ_OPERATION, "response");
export const DESKTOP_MODEL_DOWNLOAD_LIST_REQUEST_CHANNEL = createIpcChannel(DESKTOP_MODEL_DOWNLOAD_LIST_OPERATION, "request");
export const DESKTOP_MODEL_DOWNLOAD_LIST_RESPONSE_CHANNEL = createIpcChannel(DESKTOP_MODEL_DOWNLOAD_LIST_OPERATION, "response");
export const DESKTOP_MODEL_DOWNLOAD_CANCEL_REQUEST_CHANNEL = createIpcChannel(DESKTOP_MODEL_DOWNLOAD_CANCEL_OPERATION, "request");
export const DESKTOP_MODEL_DOWNLOAD_CANCEL_RESPONSE_CHANNEL = createIpcChannel(DESKTOP_MODEL_DOWNLOAD_CANCEL_OPERATION, "response");
export const DESKTOP_MODEL_RECORD_UPDATE_REQUEST_CHANNEL = createIpcChannel(DESKTOP_MODEL_RECORD_UPDATE_OPERATION, "request");
export const DESKTOP_MODEL_RECORD_UPDATE_RESPONSE_CHANNEL = createIpcChannel(DESKTOP_MODEL_RECORD_UPDATE_OPERATION, "response");
export const DESKTOP_MODEL_RECORD_DELETE_REQUEST_CHANNEL = createIpcChannel(DESKTOP_MODEL_RECORD_DELETE_OPERATION, "request");
export const DESKTOP_MODEL_RECORD_DELETE_RESPONSE_CHANNEL = createIpcChannel(DESKTOP_MODEL_RECORD_DELETE_OPERATION, "response");
export const DESKTOP_MODEL_FOLDER_REVEAL_REQUEST_CHANNEL = createIpcChannel(DESKTOP_MODEL_FOLDER_REVEAL_OPERATION, "request");
export const DESKTOP_MODEL_FOLDER_REVEAL_RESPONSE_CHANNEL = createIpcChannel(DESKTOP_MODEL_FOLDER_REVEAL_OPERATION, "response");
export const DESKTOP_MODEL_TRAIN_REQUEST_CHANNEL = createIpcChannel(DESKTOP_MODEL_TRAIN_OPERATION, "request");
export const DESKTOP_MODEL_TRAIN_RESPONSE_CHANNEL = createIpcChannel(DESKTOP_MODEL_TRAIN_OPERATION, "response");
export const DESKTOP_MODEL_TRAIN_STATUS_REQUEST_CHANNEL = createIpcChannel(DESKTOP_MODEL_TRAIN_STATUS_OPERATION, "request");
export const DESKTOP_MODEL_TRAIN_STATUS_RESPONSE_CHANNEL = createIpcChannel(DESKTOP_MODEL_TRAIN_STATUS_OPERATION, "response");
export const DESKTOP_MODEL_VALIDATE_REQUEST_CHANNEL = createIpcChannel(DESKTOP_MODEL_VALIDATE_OPERATION, "request");
export const DESKTOP_MODEL_VALIDATE_RESPONSE_CHANNEL = createIpcChannel(DESKTOP_MODEL_VALIDATE_OPERATION, "response");
export const DESKTOP_MODEL_PUBLISH_REQUEST_CHANNEL = createIpcChannel(DESKTOP_MODEL_PUBLISH_OPERATION, "request");
export const DESKTOP_MODEL_PUBLISH_RESPONSE_CHANNEL = createIpcChannel(DESKTOP_MODEL_PUBLISH_OPERATION, "response");

export type DesktopModelBrowseRequest = IpcRequest<
  BrowseModelsRequest,
  typeof DESKTOP_MODEL_BROWSE_OPERATION,
  Record<string, never>,
  typeof DESKTOP_MODEL_BROWSE_REQUEST_CHANNEL.value
>;
export type DesktopModelBrowseResponse = IpcResponse<
  BrowseModelsResult,
  Record<string, unknown>,
  typeof DESKTOP_MODEL_BROWSE_OPERATION,
  Record<string, never>,
  typeof DESKTOP_MODEL_BROWSE_RESPONSE_CHANNEL.value
>;
export type DesktopModelDetailsReadRequest = IpcRequest<
  GetModelDetailsRequest,
  typeof DESKTOP_MODEL_DETAILS_READ_OPERATION,
  Record<string, never>,
  typeof DESKTOP_MODEL_DETAILS_READ_REQUEST_CHANNEL.value
>;
export type DesktopModelDetailsReadResponse = IpcResponse<
  GetModelDetailsResult,
  Record<string, unknown>,
  typeof DESKTOP_MODEL_DETAILS_READ_OPERATION,
  Record<string, never>,
  typeof DESKTOP_MODEL_DETAILS_READ_RESPONSE_CHANNEL.value
>;
export type DesktopModelListRequest = IpcRequest<
  ListModelsRequest,
  typeof DESKTOP_MODEL_LIST_OPERATION,
  Record<string, never>,
  typeof DESKTOP_MODEL_LIST_REQUEST_CHANNEL.value
>;
export type DesktopModelListResponse = IpcResponse<
  ListModelsResult,
  Record<string, unknown>,
  typeof DESKTOP_MODEL_LIST_OPERATION,
  Record<string, never>,
  typeof DESKTOP_MODEL_LIST_RESPONSE_CHANNEL.value
>;
export type DesktopModelReferenceSaveRequest = IpcRequest<
  SaveModelReferenceRequest,
  typeof DESKTOP_MODEL_REFERENCE_SAVE_OPERATION,
  Record<string, never>,
  typeof DESKTOP_MODEL_REFERENCE_SAVE_REQUEST_CHANNEL.value
>;
export type DesktopModelReferenceSaveResponse = IpcResponse<
  SaveModelReferenceResult,
  Record<string, unknown>,
  typeof DESKTOP_MODEL_REFERENCE_SAVE_OPERATION,
  Record<string, never>,
  typeof DESKTOP_MODEL_REFERENCE_SAVE_RESPONSE_CHANNEL.value
>;
export type DesktopModelDownloadRequest = IpcRequest<
  DownloadModelRequest,
  typeof DESKTOP_MODEL_DOWNLOAD_OPERATION,
  Record<string, never>,
  typeof DESKTOP_MODEL_DOWNLOAD_REQUEST_CHANNEL.value
>;
export type DesktopModelDownloadResponse = IpcResponse<
  DownloadModelResult,
  Record<string, unknown>,
  typeof DESKTOP_MODEL_DOWNLOAD_OPERATION,
  Record<string, never>,
  typeof DESKTOP_MODEL_DOWNLOAD_RESPONSE_CHANNEL.value
>;
export type DesktopModelDownloadStartRequest = IpcRequest<DownloadModelRequest, typeof DESKTOP_MODEL_DOWNLOAD_START_OPERATION, Record<string, never>, typeof DESKTOP_MODEL_DOWNLOAD_START_REQUEST_CHANNEL.value>;
export type DesktopModelDownloadStartResponse = IpcResponse<StartModelDownloadTaskResult, Record<string, unknown>, typeof DESKTOP_MODEL_DOWNLOAD_START_OPERATION, Record<string, never>, typeof DESKTOP_MODEL_DOWNLOAD_START_RESPONSE_CHANNEL.value>;
export type DesktopModelDownloadReadRequest = IpcRequest<ReadModelDownloadTaskRequest, typeof DESKTOP_MODEL_DOWNLOAD_READ_OPERATION, Record<string, never>, typeof DESKTOP_MODEL_DOWNLOAD_READ_REQUEST_CHANNEL.value>;
export type DesktopModelDownloadReadResponse = IpcResponse<ReadModelDownloadTaskResult, Record<string, unknown>, typeof DESKTOP_MODEL_DOWNLOAD_READ_OPERATION, Record<string, never>, typeof DESKTOP_MODEL_DOWNLOAD_READ_RESPONSE_CHANNEL.value>;
export type DesktopModelDownloadListRequest = IpcRequest<ListModelDownloadTasksRequest, typeof DESKTOP_MODEL_DOWNLOAD_LIST_OPERATION, Record<string, never>, typeof DESKTOP_MODEL_DOWNLOAD_LIST_REQUEST_CHANNEL.value>;
export type DesktopModelDownloadListResponse = IpcResponse<ListModelDownloadTasksResult, Record<string, unknown>, typeof DESKTOP_MODEL_DOWNLOAD_LIST_OPERATION, Record<string, never>, typeof DESKTOP_MODEL_DOWNLOAD_LIST_RESPONSE_CHANNEL.value>;
export type DesktopModelDownloadCancelRequest = IpcRequest<CancelModelDownloadTaskRequest, typeof DESKTOP_MODEL_DOWNLOAD_CANCEL_OPERATION, Record<string, never>, typeof DESKTOP_MODEL_DOWNLOAD_CANCEL_REQUEST_CHANNEL.value>;
export type DesktopModelDownloadCancelResponse = IpcResponse<CancelModelDownloadTaskResult, Record<string, unknown>, typeof DESKTOP_MODEL_DOWNLOAD_CANCEL_OPERATION, Record<string, never>, typeof DESKTOP_MODEL_DOWNLOAD_CANCEL_RESPONSE_CHANNEL.value>;
export type DesktopModelRecordUpdateRequest = IpcRequest<
  UpdateModelRecordRequest,
  typeof DESKTOP_MODEL_RECORD_UPDATE_OPERATION,
  Record<string, never>,
  typeof DESKTOP_MODEL_RECORD_UPDATE_REQUEST_CHANNEL.value
>;
export type DesktopModelRecordUpdateResponse = IpcResponse<
  UpdateModelRecordResult,
  Record<string, unknown>,
  typeof DESKTOP_MODEL_RECORD_UPDATE_OPERATION,
  Record<string, never>,
  typeof DESKTOP_MODEL_RECORD_UPDATE_RESPONSE_CHANNEL.value
>;
export type DesktopModelRecordDeleteRequest = IpcRequest<
  DeleteModelRecordRequest,
  typeof DESKTOP_MODEL_RECORD_DELETE_OPERATION,
  Record<string, never>,
  typeof DESKTOP_MODEL_RECORD_DELETE_REQUEST_CHANNEL.value
>;
export type DesktopModelRecordDeleteResponse = IpcResponse<
  DeleteModelRecordResult,
  Record<string, unknown>,
  typeof DESKTOP_MODEL_RECORD_DELETE_OPERATION,
  Record<string, never>,
  typeof DESKTOP_MODEL_RECORD_DELETE_RESPONSE_CHANNEL.value
>;
export type DesktopModelFolderRevealRequest = IpcRequest<
  RevealModelInFolderRequest,
  typeof DESKTOP_MODEL_FOLDER_REVEAL_OPERATION,
  Record<string, never>,
  typeof DESKTOP_MODEL_FOLDER_REVEAL_REQUEST_CHANNEL.value
>;
export type DesktopModelFolderRevealResponse = IpcResponse<
  RevealModelInFolderResult,
  Record<string, unknown>,
  typeof DESKTOP_MODEL_FOLDER_REVEAL_OPERATION,
  Record<string, never>,
  typeof DESKTOP_MODEL_FOLDER_REVEAL_RESPONSE_CHANNEL.value
>;

export type DesktopModelTrainRequest = IpcRequest<
  ModelTrainingRequest,
  typeof DESKTOP_MODEL_TRAIN_OPERATION,
  Record<string, never>,
  typeof DESKTOP_MODEL_TRAIN_REQUEST_CHANNEL.value
>;
export type DesktopModelTrainResponse = IpcResponse<
  ModelTrainingResult,
  Record<string, unknown>,
  typeof DESKTOP_MODEL_TRAIN_OPERATION,
  Record<string, never>,
  typeof DESKTOP_MODEL_TRAIN_RESPONSE_CHANNEL.value
>;
export type DesktopModelTrainStatusRequest = IpcRequest<
  ModelTrainingStatusRequest,
  typeof DESKTOP_MODEL_TRAIN_STATUS_OPERATION,
  Record<string, never>,
  typeof DESKTOP_MODEL_TRAIN_STATUS_REQUEST_CHANNEL.value
>;
export type DesktopModelTrainStatusResponse = IpcResponse<
  ModelTrainingResult,
  Record<string, unknown>,
  typeof DESKTOP_MODEL_TRAIN_STATUS_OPERATION,
  Record<string, never>,
  typeof DESKTOP_MODEL_TRAIN_STATUS_RESPONSE_CHANNEL.value
>;
export type DesktopModelValidateRequest = IpcRequest<
  ValidateModelRequest,
  typeof DESKTOP_MODEL_VALIDATE_OPERATION,
  Record<string, never>,
  typeof DESKTOP_MODEL_VALIDATE_REQUEST_CHANNEL.value
>;
export type DesktopModelValidateResponse = IpcResponse<
  ValidateModelResult,
  Record<string, unknown>,
  typeof DESKTOP_MODEL_VALIDATE_OPERATION,
  Record<string, never>,
  typeof DESKTOP_MODEL_VALIDATE_RESPONSE_CHANNEL.value
>;
export type DesktopModelPublishRequest = IpcRequest<
  PublishModelRequest,
  typeof DESKTOP_MODEL_PUBLISH_OPERATION,
  Record<string, never>,
  typeof DESKTOP_MODEL_PUBLISH_REQUEST_CHANNEL.value
>;
export type DesktopModelPublishResponse = IpcResponse<
  PublishModelResult,
  Record<string, unknown>,
  typeof DESKTOP_MODEL_PUBLISH_OPERATION,
  Record<string, never>,
  typeof DESKTOP_MODEL_PUBLISH_RESPONSE_CHANNEL.value
>;

export function createDesktopModelBrowseRequest(payload: BrowseModelsRequest, options?: { requestId?: string; correlationId?: string }): DesktopModelBrowseRequest {
  return createIpcRequest(DESKTOP_MODEL_BROWSE_REQUEST_CHANNEL, payload, options);
}
export function createDesktopModelBrowseSuccessResponse(result: BrowseModelsResult, options?: { requestId?: string; correlationId?: string }): DesktopModelBrowseResponse {
  return createIpcSuccessResponse(DESKTOP_MODEL_BROWSE_RESPONSE_CHANNEL, result, options) as DesktopModelBrowseResponse;
}
export function createDesktopModelDetailsReadRequest(payload: GetModelDetailsRequest, options?: { requestId?: string; correlationId?: string }): DesktopModelDetailsReadRequest {
  return createIpcRequest(DESKTOP_MODEL_DETAILS_READ_REQUEST_CHANNEL, payload, options);
}
export function createDesktopModelDetailsReadSuccessResponse(result: GetModelDetailsResult, options?: { requestId?: string; correlationId?: string }): DesktopModelDetailsReadResponse {
  return createIpcSuccessResponse(DESKTOP_MODEL_DETAILS_READ_RESPONSE_CHANNEL, result, options) as DesktopModelDetailsReadResponse;
}
export function createDesktopModelListRequest(payload: ListModelsRequest = {}, options?: { requestId?: string; correlationId?: string }): DesktopModelListRequest {
  return createIpcRequest(DESKTOP_MODEL_LIST_REQUEST_CHANNEL, payload, options);
}
export function createDesktopModelListSuccessResponse(result: ListModelsResult, options?: { requestId?: string; correlationId?: string }): DesktopModelListResponse {
  return createIpcSuccessResponse(DESKTOP_MODEL_LIST_RESPONSE_CHANNEL, result, options) as DesktopModelListResponse;
}
export function createDesktopModelReferenceSaveRequest(payload: SaveModelReferenceRequest, options?: { requestId?: string; correlationId?: string }): DesktopModelReferenceSaveRequest {
  return createIpcRequest(DESKTOP_MODEL_REFERENCE_SAVE_REQUEST_CHANNEL, payload, options);
}
export function createDesktopModelReferenceSaveSuccessResponse(result: SaveModelReferenceResult, options?: { requestId?: string; correlationId?: string }): DesktopModelReferenceSaveResponse {
  return createIpcSuccessResponse(DESKTOP_MODEL_REFERENCE_SAVE_RESPONSE_CHANNEL, result, options) as DesktopModelReferenceSaveResponse;
}
export function createDesktopModelDownloadRequest(payload: DownloadModelRequest, options?: { requestId?: string; correlationId?: string }): DesktopModelDownloadRequest {
  return createIpcRequest(DESKTOP_MODEL_DOWNLOAD_REQUEST_CHANNEL, payload, options);
}
export function createDesktopModelDownloadSuccessResponse(result: DownloadModelResult, options?: { requestId?: string; correlationId?: string }): DesktopModelDownloadResponse {
  return createIpcSuccessResponse(DESKTOP_MODEL_DOWNLOAD_RESPONSE_CHANNEL, result, options) as DesktopModelDownloadResponse;
}
export function createDesktopModelDownloadStartRequest(payload: DownloadModelRequest, options?: { requestId?: string; correlationId?: string }): DesktopModelDownloadStartRequest { return createIpcRequest(DESKTOP_MODEL_DOWNLOAD_START_REQUEST_CHANNEL, payload, options); }
export function createDesktopModelDownloadStartSuccessResponse(result: StartModelDownloadTaskResult, options?: { requestId?: string; correlationId?: string }): DesktopModelDownloadStartResponse { return createIpcSuccessResponse(DESKTOP_MODEL_DOWNLOAD_START_RESPONSE_CHANNEL, result, options) as DesktopModelDownloadStartResponse; }
export function createDesktopModelDownloadReadRequest(payload: ReadModelDownloadTaskRequest, options?: { requestId?: string; correlationId?: string }): DesktopModelDownloadReadRequest { return createIpcRequest(DESKTOP_MODEL_DOWNLOAD_READ_REQUEST_CHANNEL, payload, options); }
export function createDesktopModelDownloadReadSuccessResponse(result: ReadModelDownloadTaskResult, options?: { requestId?: string; correlationId?: string }): DesktopModelDownloadReadResponse { return createIpcSuccessResponse(DESKTOP_MODEL_DOWNLOAD_READ_RESPONSE_CHANNEL, result, options) as DesktopModelDownloadReadResponse; }
export function createDesktopModelDownloadListRequest(payload: ListModelDownloadTasksRequest, options?: { requestId?: string; correlationId?: string }): DesktopModelDownloadListRequest { return createIpcRequest(DESKTOP_MODEL_DOWNLOAD_LIST_REQUEST_CHANNEL, payload, options); }
export function createDesktopModelDownloadListSuccessResponse(result: ListModelDownloadTasksResult, options?: { requestId?: string; correlationId?: string }): DesktopModelDownloadListResponse { return createIpcSuccessResponse(DESKTOP_MODEL_DOWNLOAD_LIST_RESPONSE_CHANNEL, result, options) as DesktopModelDownloadListResponse; }
export function createDesktopModelDownloadCancelRequest(payload: CancelModelDownloadTaskRequest, options?: { requestId?: string; correlationId?: string }): DesktopModelDownloadCancelRequest { return createIpcRequest(DESKTOP_MODEL_DOWNLOAD_CANCEL_REQUEST_CHANNEL, payload, options); }
export function createDesktopModelDownloadCancelSuccessResponse(result: CancelModelDownloadTaskResult, options?: { requestId?: string; correlationId?: string }): DesktopModelDownloadCancelResponse { return createIpcSuccessResponse(DESKTOP_MODEL_DOWNLOAD_CANCEL_RESPONSE_CHANNEL, result, options) as DesktopModelDownloadCancelResponse; }
export function createDesktopModelRecordUpdateRequest(payload: UpdateModelRecordRequest, options?: { requestId?: string; correlationId?: string }): DesktopModelRecordUpdateRequest {
  return createIpcRequest(DESKTOP_MODEL_RECORD_UPDATE_REQUEST_CHANNEL, payload, options);
}
export function createDesktopModelRecordUpdateSuccessResponse(result: UpdateModelRecordResult, options?: { requestId?: string; correlationId?: string }): DesktopModelRecordUpdateResponse {
  return createIpcSuccessResponse(DESKTOP_MODEL_RECORD_UPDATE_RESPONSE_CHANNEL, result, options) as DesktopModelRecordUpdateResponse;
}
export function createDesktopModelRecordDeleteRequest(payload: DeleteModelRecordRequest, options?: { requestId?: string; correlationId?: string }): DesktopModelRecordDeleteRequest {
  return createIpcRequest(DESKTOP_MODEL_RECORD_DELETE_REQUEST_CHANNEL, payload, options);
}
export function createDesktopModelRecordDeleteSuccessResponse(result: DeleteModelRecordResult, options?: { requestId?: string; correlationId?: string }): DesktopModelRecordDeleteResponse {
  return createIpcSuccessResponse(DESKTOP_MODEL_RECORD_DELETE_RESPONSE_CHANNEL, result, options) as DesktopModelRecordDeleteResponse;
}
export function createDesktopModelFolderRevealRequest(payload: RevealModelInFolderRequest, options?: { requestId?: string; correlationId?: string }): DesktopModelFolderRevealRequest {
  return createIpcRequest(DESKTOP_MODEL_FOLDER_REVEAL_REQUEST_CHANNEL, payload, options);
}
export function createDesktopModelFolderRevealSuccessResponse(result: RevealModelInFolderResult, options?: { requestId?: string; correlationId?: string }): DesktopModelFolderRevealResponse {
  return createIpcSuccessResponse(DESKTOP_MODEL_FOLDER_REVEAL_RESPONSE_CHANNEL, result, options) as DesktopModelFolderRevealResponse;
}

export function createDesktopModelTrainRequest(payload: ModelTrainingRequest, options?: { requestId?: string; correlationId?: string }): DesktopModelTrainRequest {
  return createIpcRequest(DESKTOP_MODEL_TRAIN_REQUEST_CHANNEL, payload, options);
}
export function createDesktopModelTrainSuccessResponse(result: ModelTrainingResult, options?: { requestId?: string; correlationId?: string }): DesktopModelTrainResponse {
  return createIpcSuccessResponse(DESKTOP_MODEL_TRAIN_RESPONSE_CHANNEL, result, options) as DesktopModelTrainResponse;
}
export function createDesktopModelTrainStatusRequest(payload: ModelTrainingStatusRequest, options?: { requestId?: string; correlationId?: string }): DesktopModelTrainStatusRequest {
  return createIpcRequest(DESKTOP_MODEL_TRAIN_STATUS_REQUEST_CHANNEL, payload, options);
}
export function createDesktopModelTrainStatusSuccessResponse(result: ModelTrainingResult, options?: { requestId?: string; correlationId?: string }): DesktopModelTrainStatusResponse {
  return createIpcSuccessResponse(DESKTOP_MODEL_TRAIN_STATUS_RESPONSE_CHANNEL, result, options) as DesktopModelTrainStatusResponse;
}
export function createDesktopModelValidateRequest(payload: ValidateModelRequest, options?: { requestId?: string; correlationId?: string }): DesktopModelValidateRequest {
  return createIpcRequest(DESKTOP_MODEL_VALIDATE_REQUEST_CHANNEL, payload, options);
}
export function createDesktopModelValidateSuccessResponse(result: ValidateModelResult, options?: { requestId?: string; correlationId?: string }): DesktopModelValidateResponse {
  return createIpcSuccessResponse(DESKTOP_MODEL_VALIDATE_RESPONSE_CHANNEL, result, options) as DesktopModelValidateResponse;
}
export function createDesktopModelPublishRequest(payload: PublishModelRequest, options?: { requestId?: string; correlationId?: string }): DesktopModelPublishRequest {
  return createIpcRequest(DESKTOP_MODEL_PUBLISH_REQUEST_CHANNEL, payload, options);
}
export function createDesktopModelPublishSuccessResponse(result: PublishModelResult, options?: { requestId?: string; correlationId?: string }): DesktopModelPublishResponse {
  return createIpcSuccessResponse(DESKTOP_MODEL_PUBLISH_RESPONSE_CHANNEL, result, options) as DesktopModelPublishResponse;
}
