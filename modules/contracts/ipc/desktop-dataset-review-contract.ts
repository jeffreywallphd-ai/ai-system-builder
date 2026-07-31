import type {
  DatasetReviewDatasetGroup,
  DatasetReviewRowEditResult,
  DatasetReviewPage,
  DatasetReviewPageSize,
  DatasetReviewRowRejectionResult,
} from "../dataset";
import { createTransportOperation } from "../transport";
import { createIpcChannel, type IpcChannelValue } from "./ipc-channel";
import { createIpcRequest, type IpcRequest } from "./ipc-request";
import { createIpcSuccessResponse, type IpcResponse } from "./ipc-response";
import type { IpcOperation } from "./ipc-operation";

export const DESKTOP_DATASET_REVIEW_TARGETS_OPERATION =
  createTransportOperation("artifact", "dataset-review.targets");
export const DESKTOP_DATASET_REVIEW_PAGE_OPERATION = createTransportOperation(
  "artifact",
  "dataset-review.page",
);
export const DESKTOP_DATASET_REVIEW_REJECT_OPERATION = createTransportOperation(
  "artifact",
  "dataset-review.reject",
);
export const DESKTOP_DATASET_REVIEW_EDIT_OPERATION = createTransportOperation(
  "artifact",
  "dataset-review.edit",
);

export const DESKTOP_DATASET_REVIEW_TARGETS_REQUEST_CHANNEL = createIpcChannel(
  DESKTOP_DATASET_REVIEW_TARGETS_OPERATION,
  "request",
);
export const DESKTOP_DATASET_REVIEW_TARGETS_RESPONSE_CHANNEL = createIpcChannel(
  DESKTOP_DATASET_REVIEW_TARGETS_OPERATION,
  "response",
);
export const DESKTOP_DATASET_REVIEW_PAGE_REQUEST_CHANNEL = createIpcChannel(
  DESKTOP_DATASET_REVIEW_PAGE_OPERATION,
  "request",
);
export const DESKTOP_DATASET_REVIEW_PAGE_RESPONSE_CHANNEL = createIpcChannel(
  DESKTOP_DATASET_REVIEW_PAGE_OPERATION,
  "response",
);
export const DESKTOP_DATASET_REVIEW_REJECT_REQUEST_CHANNEL = createIpcChannel(
  DESKTOP_DATASET_REVIEW_REJECT_OPERATION,
  "request",
);
export const DESKTOP_DATASET_REVIEW_REJECT_RESPONSE_CHANNEL = createIpcChannel(
  DESKTOP_DATASET_REVIEW_REJECT_OPERATION,
  "response",
);
export const DESKTOP_DATASET_REVIEW_EDIT_REQUEST_CHANNEL = createIpcChannel(
  DESKTOP_DATASET_REVIEW_EDIT_OPERATION,
  "request",
);
export const DESKTOP_DATASET_REVIEW_EDIT_RESPONSE_CHANNEL = createIpcChannel(
  DESKTOP_DATASET_REVIEW_EDIT_OPERATION,
  "response",
);

interface Boundary {
  host: "desktop";
  source: string;
  workspaceId: string;
}
export interface DesktopDatasetReviewTargetsPayload {
  boundary: Boundary;
}
export interface DesktopDatasetReviewPagePayload {
  artifactKey: string;
  versionId?: string;
  page: number;
  pageSize: DatasetReviewPageSize;
  boundary: Boundary;
}
export interface DesktopDatasetReviewRejectPayload {
  artifactKey: string;
  versionId?: string;
  rowIndex: number;
  rowFingerprint: `sha256:${string}`;
  boundary: Boundary;
}
export interface DesktopDatasetReviewEditPayload {
  artifactKey: string;
  versionId?: string;
  rowIndex: number;
  rowFingerprint: `sha256:${string}`;
  values: Readonly<Record<string, unknown>>;
  boundary: Boundary;
}

type Req<
  T,
  O extends IpcOperation,
  C extends IpcChannelValue<O, "request">,
> = IpcRequest<T, O, Record<string, never>, C>;
type Res<
  T,
  O extends IpcOperation,
  C extends IpcChannelValue<O, "response">,
> = IpcResponse<T, Record<string, unknown>, O, Record<string, never>, C>;

export type DesktopDatasetReviewTargetsRequest = Req<
  DesktopDatasetReviewTargetsPayload,
  typeof DESKTOP_DATASET_REVIEW_TARGETS_OPERATION,
  typeof DESKTOP_DATASET_REVIEW_TARGETS_REQUEST_CHANNEL.value
>;
export type DesktopDatasetReviewTargetsResponse = Res<
  { groups: readonly DatasetReviewDatasetGroup[] },
  typeof DESKTOP_DATASET_REVIEW_TARGETS_OPERATION,
  typeof DESKTOP_DATASET_REVIEW_TARGETS_RESPONSE_CHANNEL.value
>;
export type DesktopDatasetReviewPageRequest = Req<
  DesktopDatasetReviewPagePayload,
  typeof DESKTOP_DATASET_REVIEW_PAGE_OPERATION,
  typeof DESKTOP_DATASET_REVIEW_PAGE_REQUEST_CHANNEL.value
>;
export type DesktopDatasetReviewPageResponse = Res<
  { page: DatasetReviewPage },
  typeof DESKTOP_DATASET_REVIEW_PAGE_OPERATION,
  typeof DESKTOP_DATASET_REVIEW_PAGE_RESPONSE_CHANNEL.value
>;
export type DesktopDatasetReviewRejectRequest = Req<
  DesktopDatasetReviewRejectPayload,
  typeof DESKTOP_DATASET_REVIEW_REJECT_OPERATION,
  typeof DESKTOP_DATASET_REVIEW_REJECT_REQUEST_CHANNEL.value
>;
export type DesktopDatasetReviewRejectResponse = Res<
  DatasetReviewRowRejectionResult,
  typeof DESKTOP_DATASET_REVIEW_REJECT_OPERATION,
  typeof DESKTOP_DATASET_REVIEW_REJECT_RESPONSE_CHANNEL.value
>;
export type DesktopDatasetReviewEditRequest = Req<
  DesktopDatasetReviewEditPayload,
  typeof DESKTOP_DATASET_REVIEW_EDIT_OPERATION,
  typeof DESKTOP_DATASET_REVIEW_EDIT_REQUEST_CHANNEL.value
>;
export type DesktopDatasetReviewEditResponse = Res<
  DatasetReviewRowEditResult,
  typeof DESKTOP_DATASET_REVIEW_EDIT_OPERATION,
  typeof DESKTOP_DATASET_REVIEW_EDIT_RESPONSE_CHANNEL.value
>;

const required = (value: string, field: string): string => {
  const normalized = value?.trim();
  if (!normalized) throw new Error(`${field} is required.`);
  return normalized;
};
const boundary = (value: Boundary): Boundary => ({
  host: "desktop",
  source: required(value.source, "boundary.source"),
  workspaceId: required(value.workspaceId, "boundary.workspaceId"),
});
const options = (request?: { requestId?: string; correlationId?: string }) =>
  request;

export const createDesktopDatasetReviewTargetsRequest = (
  payload: DesktopDatasetReviewTargetsPayload,
  request?: { requestId?: string; correlationId?: string },
): DesktopDatasetReviewTargetsRequest =>
  createIpcRequest(
    DESKTOP_DATASET_REVIEW_TARGETS_REQUEST_CHANNEL,
    { boundary: boundary(payload.boundary) },
    options(request),
  );
export const createDesktopDatasetReviewTargetsSuccessResponse = (
  value: { groups: readonly DatasetReviewDatasetGroup[] },
  request?: { requestId?: string; correlationId?: string },
): DesktopDatasetReviewTargetsResponse =>
  createIpcSuccessResponse(
    DESKTOP_DATASET_REVIEW_TARGETS_RESPONSE_CHANNEL,
    value,
    options(request),
  );
export const createDesktopDatasetReviewPageRequest = (
  payload: DesktopDatasetReviewPagePayload,
  request?: { requestId?: string; correlationId?: string },
): DesktopDatasetReviewPageRequest =>
  createIpcRequest(
    DESKTOP_DATASET_REVIEW_PAGE_REQUEST_CHANNEL,
    {
      artifactKey: required(payload.artifactKey, "artifactKey"),
      ...(payload.versionId?.trim()
        ? { versionId: payload.versionId.trim() }
        : {}),
      page: payload.page,
      pageSize: payload.pageSize,
      boundary: boundary(payload.boundary),
    },
    options(request),
  );
export const createDesktopDatasetReviewPageSuccessResponse = (
  value: { page: DatasetReviewPage },
  request?: { requestId?: string; correlationId?: string },
): DesktopDatasetReviewPageResponse =>
  createIpcSuccessResponse(
    DESKTOP_DATASET_REVIEW_PAGE_RESPONSE_CHANNEL,
    value,
    options(request),
  );
export const createDesktopDatasetReviewRejectRequest = (
  payload: DesktopDatasetReviewRejectPayload,
  request?: { requestId?: string; correlationId?: string },
): DesktopDatasetReviewRejectRequest =>
  createIpcRequest(
    DESKTOP_DATASET_REVIEW_REJECT_REQUEST_CHANNEL,
    {
      artifactKey: required(payload.artifactKey, "artifactKey"),
      ...(payload.versionId?.trim()
        ? { versionId: payload.versionId.trim() }
        : {}),
      rowIndex: payload.rowIndex,
      rowFingerprint: payload.rowFingerprint,
      boundary: boundary(payload.boundary),
    },
    options(request),
  );
export const createDesktopDatasetReviewRejectSuccessResponse = (
  value: DatasetReviewRowRejectionResult,
  request?: { requestId?: string; correlationId?: string },
): DesktopDatasetReviewRejectResponse =>
  createIpcSuccessResponse(
    DESKTOP_DATASET_REVIEW_REJECT_RESPONSE_CHANNEL,
    value,
    options(request),
  );
export const createDesktopDatasetReviewEditRequest = (
  payload: DesktopDatasetReviewEditPayload,
  request?: { requestId?: string; correlationId?: string },
): DesktopDatasetReviewEditRequest =>
  createIpcRequest(
    DESKTOP_DATASET_REVIEW_EDIT_REQUEST_CHANNEL,
    {
      artifactKey: required(payload.artifactKey, "artifactKey"),
      ...(payload.versionId?.trim()
        ? { versionId: payload.versionId.trim() }
        : {}),
      rowIndex: payload.rowIndex,
      rowFingerprint: payload.rowFingerprint,
      values: payload.values,
      boundary: boundary(payload.boundary),
    },
    options(request),
  );
export const createDesktopDatasetReviewEditSuccessResponse = (
  value: DatasetReviewRowEditResult,
  request?: { requestId?: string; correlationId?: string },
): DesktopDatasetReviewEditResponse =>
  createIpcSuccessResponse(
    DESKTOP_DATASET_REVIEW_EDIT_RESPONSE_CHANNEL,
    value,
    options(request),
  );
