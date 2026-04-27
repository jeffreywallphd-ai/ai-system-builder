import {
  createIngestWebsitePageRequest,
  createIngestWebsitePagesBatchRequest,
  normalizeIngestWebsitePageSuccessValue,
  normalizeIngestWebsitePagesBatchSuccessValue,
  type IngestWebsitePageRequest,
  type IngestWebsitePageSuccessValue,
  type IngestWebsitePagesBatchRequest,
  type IngestWebsitePagesBatchSuccessValue,
} from "../ingestion";
import { createTransportOperation } from "../transport";
import {
  createIpcChannel,
  type IpcChannel,
  type IpcChannelValue,
} from "./ipc-channel";
import {
  createIpcRequest,
  type IpcRequest,
} from "./ipc-request";
import {
  createIpcSuccessResponse,
  type IpcResponse,
} from "./ipc-response";

export const DESKTOP_INGEST_WEBSITE_PAGE_OPERATION = createTransportOperation(
  "artifact",
  "ingest-website-page",
);

export const DESKTOP_INGEST_WEBSITE_PAGES_BATCH_OPERATION = createTransportOperation(
  "artifact",
  "ingest-website-pages-batch",
);

export const DESKTOP_INGEST_WEBSITE_PAGE_REQUEST_CHANNEL = createIpcChannel(
  DESKTOP_INGEST_WEBSITE_PAGE_OPERATION,
  "request",
);

export const DESKTOP_INGEST_WEBSITE_PAGE_RESPONSE_CHANNEL = createIpcChannel(
  DESKTOP_INGEST_WEBSITE_PAGE_OPERATION,
  "response",
);

export const DESKTOP_INGEST_WEBSITE_PAGES_BATCH_REQUEST_CHANNEL = createIpcChannel(
  DESKTOP_INGEST_WEBSITE_PAGES_BATCH_OPERATION,
  "request",
);

export const DESKTOP_INGEST_WEBSITE_PAGES_BATCH_RESPONSE_CHANNEL = createIpcChannel(
  DESKTOP_INGEST_WEBSITE_PAGES_BATCH_OPERATION,
  "response",
);

export interface DesktopWebsiteIngestionBoundaryContext {
  host: "desktop";
  source: string;
}

export interface DesktopIngestWebsitePageRequestPayload {
  request: IngestWebsitePageRequest;
  boundary: DesktopWebsiteIngestionBoundaryContext;
}

export interface DesktopIngestWebsitePagesBatchRequestPayload {
  request: IngestWebsitePagesBatchRequest;
  boundary: DesktopWebsiteIngestionBoundaryContext;
}

export interface DesktopIngestWebsitePageSuccessValue {
  result: IngestWebsitePageSuccessValue;
}

export interface DesktopIngestWebsitePagesBatchSuccessValue {
  result: IngestWebsitePagesBatchSuccessValue;
}

export type DesktopIngestWebsitePageRequest = IpcRequest<
  DesktopIngestWebsitePageRequestPayload,
  typeof DESKTOP_INGEST_WEBSITE_PAGE_OPERATION,
  Record<string, never>,
  typeof DESKTOP_INGEST_WEBSITE_PAGE_REQUEST_CHANNEL.value
>;

export type DesktopIngestWebsitePageResponse = IpcResponse<
  DesktopIngestWebsitePageSuccessValue,
  Record<string, unknown>,
  typeof DESKTOP_INGEST_WEBSITE_PAGE_OPERATION,
  Record<string, never>,
  typeof DESKTOP_INGEST_WEBSITE_PAGE_RESPONSE_CHANNEL.value
>;

export type DesktopIngestWebsitePagesBatchRequest = IpcRequest<
  DesktopIngestWebsitePagesBatchRequestPayload,
  typeof DESKTOP_INGEST_WEBSITE_PAGES_BATCH_OPERATION,
  Record<string, never>,
  typeof DESKTOP_INGEST_WEBSITE_PAGES_BATCH_REQUEST_CHANNEL.value
>;

export type DesktopIngestWebsitePagesBatchResponse = IpcResponse<
  DesktopIngestWebsitePagesBatchSuccessValue,
  Record<string, unknown>,
  typeof DESKTOP_INGEST_WEBSITE_PAGES_BATCH_OPERATION,
  Record<string, never>,
  typeof DESKTOP_INGEST_WEBSITE_PAGES_BATCH_RESPONSE_CHANNEL.value
>;

function normalizeRequiredTextField(value: string, fieldName: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new Error(`${fieldName} must be a non-empty, trimmed string.`);
  }

  return normalized;
}

function normalizeBoundary(
  boundary: DesktopWebsiteIngestionBoundaryContext,
): DesktopWebsiteIngestionBoundaryContext {
  return {
    host: "desktop",
    source: normalizeRequiredTextField(boundary.source, "boundary.source"),
  };
}

export function createDesktopIngestWebsitePageRequest(
  payload: DesktopIngestWebsitePageRequestPayload,
  options?: {
    requestId?: string;
    correlationId?: string;
  },
): DesktopIngestWebsitePageRequest {
  return createIpcRequest(
    DESKTOP_INGEST_WEBSITE_PAGE_REQUEST_CHANNEL,
    {
      request: createIngestWebsitePageRequest(payload.request),
      boundary: normalizeBoundary(payload.boundary),
    },
    options,
  );
}

export function createDesktopIngestWebsitePageSuccessResponse(
  result: IngestWebsitePageSuccessValue,
  options?: {
    requestId?: string;
    correlationId?: string;
  },
): DesktopIngestWebsitePageResponse {
  return createIpcSuccessResponse(
    DESKTOP_INGEST_WEBSITE_PAGE_RESPONSE_CHANNEL,
    {
      result: normalizeIngestWebsitePageSuccessValue(result),
    },
    options,
  );
}

export function createDesktopIngestWebsitePagesBatchRequest(
  payload: DesktopIngestWebsitePagesBatchRequestPayload,
  options?: {
    requestId?: string;
    correlationId?: string;
  },
): DesktopIngestWebsitePagesBatchRequest {
  return createIpcRequest(
    DESKTOP_INGEST_WEBSITE_PAGES_BATCH_REQUEST_CHANNEL,
    {
      request: createIngestWebsitePagesBatchRequest(payload.request),
      boundary: normalizeBoundary(payload.boundary),
    },
    options,
  );
}

export function createDesktopIngestWebsitePagesBatchSuccessResponse(
  result: IngestWebsitePagesBatchSuccessValue,
  options?: {
    requestId?: string;
    correlationId?: string;
  },
): DesktopIngestWebsitePagesBatchResponse {
  return createIpcSuccessResponse(
    DESKTOP_INGEST_WEBSITE_PAGES_BATCH_RESPONSE_CHANNEL,
    {
      result: normalizeIngestWebsitePagesBatchSuccessValue(result),
    },
    options,
  );
}

export function isDesktopIngestWebsitePageRequestChannel(
  value: string,
): value is IpcChannelValue<
  typeof DESKTOP_INGEST_WEBSITE_PAGE_OPERATION,
  "request"
> {
  return value === DESKTOP_INGEST_WEBSITE_PAGE_REQUEST_CHANNEL.value;
}

export function isDesktopIngestWebsitePageResponseChannel(
  value: string,
): value is IpcChannelValue<
  typeof DESKTOP_INGEST_WEBSITE_PAGE_OPERATION,
  "response"
> {
  return value === DESKTOP_INGEST_WEBSITE_PAGE_RESPONSE_CHANNEL.value;
}

export function getDesktopIngestWebsitePageChannel(
  kind: "request",
): IpcChannel<
  typeof DESKTOP_INGEST_WEBSITE_PAGE_OPERATION,
  "request",
  IpcChannelValue<typeof DESKTOP_INGEST_WEBSITE_PAGE_OPERATION, "request">
>;
export function getDesktopIngestWebsitePageChannel(
  kind: "response",
): IpcChannel<
  typeof DESKTOP_INGEST_WEBSITE_PAGE_OPERATION,
  "response",
  IpcChannelValue<typeof DESKTOP_INGEST_WEBSITE_PAGE_OPERATION, "response">
>;
export function getDesktopIngestWebsitePageChannel(
  kind: "request" | "response",
):
  | IpcChannel<
    typeof DESKTOP_INGEST_WEBSITE_PAGE_OPERATION,
    "request",
    IpcChannelValue<typeof DESKTOP_INGEST_WEBSITE_PAGE_OPERATION, "request">
  >
  | IpcChannel<
    typeof DESKTOP_INGEST_WEBSITE_PAGE_OPERATION,
    "response",
    IpcChannelValue<typeof DESKTOP_INGEST_WEBSITE_PAGE_OPERATION, "response">
  > {
  return kind === "request"
    ? DESKTOP_INGEST_WEBSITE_PAGE_REQUEST_CHANNEL
    : DESKTOP_INGEST_WEBSITE_PAGE_RESPONSE_CHANNEL;
}

export function isDesktopIngestWebsitePagesBatchRequestChannel(
  value: string,
): value is IpcChannelValue<
  typeof DESKTOP_INGEST_WEBSITE_PAGES_BATCH_OPERATION,
  "request"
> {
  return value === DESKTOP_INGEST_WEBSITE_PAGES_BATCH_REQUEST_CHANNEL.value;
}

export function isDesktopIngestWebsitePagesBatchResponseChannel(
  value: string,
): value is IpcChannelValue<
  typeof DESKTOP_INGEST_WEBSITE_PAGES_BATCH_OPERATION,
  "response"
> {
  return value === DESKTOP_INGEST_WEBSITE_PAGES_BATCH_RESPONSE_CHANNEL.value;
}

export function getDesktopIngestWebsitePagesBatchChannel(
  kind: "request",
): IpcChannel<
  typeof DESKTOP_INGEST_WEBSITE_PAGES_BATCH_OPERATION,
  "request",
  IpcChannelValue<typeof DESKTOP_INGEST_WEBSITE_PAGES_BATCH_OPERATION, "request">
>;
export function getDesktopIngestWebsitePagesBatchChannel(
  kind: "response",
): IpcChannel<
  typeof DESKTOP_INGEST_WEBSITE_PAGES_BATCH_OPERATION,
  "response",
  IpcChannelValue<typeof DESKTOP_INGEST_WEBSITE_PAGES_BATCH_OPERATION, "response">
>;
export function getDesktopIngestWebsitePagesBatchChannel(
  kind: "request" | "response",
):
  | IpcChannel<
    typeof DESKTOP_INGEST_WEBSITE_PAGES_BATCH_OPERATION,
    "request",
    IpcChannelValue<typeof DESKTOP_INGEST_WEBSITE_PAGES_BATCH_OPERATION, "request">
  >
  | IpcChannel<
    typeof DESKTOP_INGEST_WEBSITE_PAGES_BATCH_OPERATION,
    "response",
    IpcChannelValue<typeof DESKTOP_INGEST_WEBSITE_PAGES_BATCH_OPERATION, "response">
  > {
  return kind === "request"
    ? DESKTOP_INGEST_WEBSITE_PAGES_BATCH_REQUEST_CHANNEL
    : DESKTOP_INGEST_WEBSITE_PAGES_BATCH_RESPONSE_CHANNEL;
}
