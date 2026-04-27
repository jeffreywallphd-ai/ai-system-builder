import type {
  IngestWebsitePageRequest,
  IngestWebsitePageResult,
  IngestWebsitePagesBatchRequest,
  IngestWebsitePagesBatchResult,
} from "../../../../contracts/ingestion";
import {
  DESKTOP_INGEST_WEBSITE_PAGE_REQUEST_CHANNEL,
  DESKTOP_INGEST_WEBSITE_PAGE_RESPONSE_CHANNEL,
  DESKTOP_INGEST_WEBSITE_PAGES_BATCH_REQUEST_CHANNEL,
  DESKTOP_INGEST_WEBSITE_PAGES_BATCH_RESPONSE_CHANNEL,
  createDesktopIngestWebsitePageSuccessResponse,
  createDesktopIngestWebsitePagesBatchSuccessResponse,
  createIpcError,
  createIpcFailureResponse,
  type DesktopIngestWebsitePageRequest,
  type DesktopIngestWebsitePageResponse,
  type DesktopIngestWebsitePagesBatchRequest,
  type DesktopIngestWebsitePagesBatchResponse,
} from "../../../../contracts/ipc";
import type { IpcMainHandlePort } from "../ipcMainHandlePort";

export interface IngestWebsitePageUseCasePort {
  execute: (
    request: IngestWebsitePageRequest,
    context?: {
      requestId?: string;
      correlationId?: string;
    },
  ) => Promise<IngestWebsitePageResult>;
}

export interface IngestWebsitePagesBatchUseCasePort {
  execute: (
    request: IngestWebsitePagesBatchRequest,
    context?: {
      requestId?: string;
      correlationId?: string;
    },
  ) => Promise<IngestWebsitePagesBatchResult>;
}

export interface RegisterWebsiteIngestionIpcDependencies {
  ipcMain: IpcMainHandlePort;
  ingestWebsitePageUseCase: IngestWebsitePageUseCasePort;
  ingestWebsitePagesBatchUseCase: IngestWebsitePagesBatchUseCasePort;
}

function mapIngestWebsitePageResultToIpcResponse(
  result: IngestWebsitePageResult,
  request: DesktopIngestWebsitePageRequest,
): DesktopIngestWebsitePageResponse {
  if (result.ok) {
    return createDesktopIngestWebsitePageSuccessResponse(result.value, {
      requestId: result.requestId ?? request.requestId,
      correlationId: result.correlationId ?? request.correlationId,
    });
  }

  return createIpcFailureResponse(
    createIpcError(
      DESKTOP_INGEST_WEBSITE_PAGE_RESPONSE_CHANNEL,
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

function mapIngestWebsitePagesBatchResultToIpcResponse(
  result: IngestWebsitePagesBatchResult,
  request: DesktopIngestWebsitePagesBatchRequest,
): DesktopIngestWebsitePagesBatchResponse {
  if (result.ok) {
    return createDesktopIngestWebsitePagesBatchSuccessResponse(result.value, {
      requestId: result.requestId ?? request.requestId,
      correlationId: result.correlationId ?? request.correlationId,
    });
  }

  return createIpcFailureResponse(
    createIpcError(
      DESKTOP_INGEST_WEBSITE_PAGES_BATCH_RESPONSE_CHANNEL,
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

export function createDesktopIngestWebsitePageIpcHandler(
  ingestWebsitePageUseCase: IngestWebsitePageUseCasePort,
) {
  return async (
    _event: unknown,
    request: DesktopIngestWebsitePageRequest,
  ): Promise<DesktopIngestWebsitePageResponse> => {
    const result = await ingestWebsitePageUseCase.execute(
      request.payload.request,
      {
        requestId: request.requestId,
        correlationId: request.correlationId,
      },
    );

    return mapIngestWebsitePageResultToIpcResponse(result, request);
  };
}

export function createDesktopIngestWebsitePagesBatchIpcHandler(
  ingestWebsitePagesBatchUseCase: IngestWebsitePagesBatchUseCasePort,
) {
  return async (
    _event: unknown,
    request: DesktopIngestWebsitePagesBatchRequest,
  ): Promise<DesktopIngestWebsitePagesBatchResponse> => {
    const result = await ingestWebsitePagesBatchUseCase.execute(
      request.payload.request,
      {
        requestId: request.requestId,
        correlationId: request.correlationId,
      },
    );

    return mapIngestWebsitePagesBatchResultToIpcResponse(result, request);
  };
}

export function registerWebsiteIngestionIpc(
  dependencies: RegisterWebsiteIngestionIpcDependencies,
): void {
  dependencies.ipcMain.handle(
    DESKTOP_INGEST_WEBSITE_PAGE_REQUEST_CHANNEL.value,
    createDesktopIngestWebsitePageIpcHandler(dependencies.ingestWebsitePageUseCase),
  );

  dependencies.ipcMain.handle(
    DESKTOP_INGEST_WEBSITE_PAGES_BATCH_REQUEST_CHANNEL.value,
    createDesktopIngestWebsitePagesBatchIpcHandler(dependencies.ingestWebsitePagesBatchUseCase),
  );
}
