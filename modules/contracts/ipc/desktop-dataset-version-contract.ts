import type {
  DatasetPublicationVisibility,
  DatasetVersionComparison,
  DatasetVersionPublicationRecord,
  DatasetVersionRecord,
  DatasetVersionReproduction,
} from "../dataset";
import { createTransportOperation } from "../transport";
import { createIpcChannel, type IpcChannelValue } from "./ipc-channel";
import { createIpcRequest, type IpcRequest } from "./ipc-request";
import { createIpcSuccessResponse, type IpcResponse } from "./ipc-response";
import type { IpcOperation } from "./ipc-operation";

export const DESKTOP_DATASET_VERSION_LIST_OPERATION = createTransportOperation("artifact", "dataset-version.list");
export const DESKTOP_DATASET_VERSION_COMPARE_OPERATION = createTransportOperation("artifact", "dataset-version.compare");
export const DESKTOP_DATASET_VERSION_REPRODUCE_OPERATION = createTransportOperation("artifact", "dataset-version.reproduce");
export const DESKTOP_DATASET_VERSION_PUBLISH_OPERATION = createTransportOperation("artifact", "dataset-version.publish");

export const DESKTOP_DATASET_VERSION_LIST_REQUEST_CHANNEL = createIpcChannel(DESKTOP_DATASET_VERSION_LIST_OPERATION, "request");
export const DESKTOP_DATASET_VERSION_LIST_RESPONSE_CHANNEL = createIpcChannel(DESKTOP_DATASET_VERSION_LIST_OPERATION, "response");
export const DESKTOP_DATASET_VERSION_COMPARE_REQUEST_CHANNEL = createIpcChannel(DESKTOP_DATASET_VERSION_COMPARE_OPERATION, "request");
export const DESKTOP_DATASET_VERSION_COMPARE_RESPONSE_CHANNEL = createIpcChannel(DESKTOP_DATASET_VERSION_COMPARE_OPERATION, "response");
export const DESKTOP_DATASET_VERSION_REPRODUCE_REQUEST_CHANNEL = createIpcChannel(DESKTOP_DATASET_VERSION_REPRODUCE_OPERATION, "request");
export const DESKTOP_DATASET_VERSION_REPRODUCE_RESPONSE_CHANNEL = createIpcChannel(DESKTOP_DATASET_VERSION_REPRODUCE_OPERATION, "response");
export const DESKTOP_DATASET_VERSION_PUBLISH_REQUEST_CHANNEL = createIpcChannel(DESKTOP_DATASET_VERSION_PUBLISH_OPERATION, "request");
export const DESKTOP_DATASET_VERSION_PUBLISH_RESPONSE_CHANNEL = createIpcChannel(DESKTOP_DATASET_VERSION_PUBLISH_OPERATION, "response");

interface Boundary { host: "desktop"; source: string; workspaceId: string; }
export interface DesktopDatasetVersionListPayload { datasetId?: string; boundary: Boundary; }
export interface DesktopDatasetVersionComparePayload { fromVersionId: string; toVersionId: string; boundary: Boundary; }
export interface DesktopDatasetVersionReproducePayload { versionId: string; boundary: Boundary; }
export interface DesktopDatasetVersionPublishPayload {
  versionId: string;
  repositoryId: string;
  visibility: Exclude<DatasetPublicationVisibility, "protected">;
  createRepository?: boolean;
  publicAccessConfirmed?: true;
  boundary: Boundary;
}

type Req<T, O extends IpcOperation, C extends IpcChannelValue<O, "request">> = IpcRequest<T, O, Record<string, never>, C>;
type Res<T, O extends IpcOperation, C extends IpcChannelValue<O, "response">> = IpcResponse<T, Record<string, unknown>, O, Record<string, never>, C>;
export type DesktopDatasetVersionListRequest = Req<DesktopDatasetVersionListPayload, typeof DESKTOP_DATASET_VERSION_LIST_OPERATION, typeof DESKTOP_DATASET_VERSION_LIST_REQUEST_CHANNEL.value>;
export type DesktopDatasetVersionListResponse = Res<{ versions: readonly DatasetVersionRecord[] }, typeof DESKTOP_DATASET_VERSION_LIST_OPERATION, typeof DESKTOP_DATASET_VERSION_LIST_RESPONSE_CHANNEL.value>;
export type DesktopDatasetVersionCompareRequest = Req<DesktopDatasetVersionComparePayload, typeof DESKTOP_DATASET_VERSION_COMPARE_OPERATION, typeof DESKTOP_DATASET_VERSION_COMPARE_REQUEST_CHANNEL.value>;
export type DesktopDatasetVersionCompareResponse = Res<{ comparison: DatasetVersionComparison }, typeof DESKTOP_DATASET_VERSION_COMPARE_OPERATION, typeof DESKTOP_DATASET_VERSION_COMPARE_RESPONSE_CHANNEL.value>;
export type DesktopDatasetVersionReproduceRequest = Req<DesktopDatasetVersionReproducePayload, typeof DESKTOP_DATASET_VERSION_REPRODUCE_OPERATION, typeof DESKTOP_DATASET_VERSION_REPRODUCE_REQUEST_CHANNEL.value>;
export type DesktopDatasetVersionReproduceResponse = Res<{ reproduction: DatasetVersionReproduction }, typeof DESKTOP_DATASET_VERSION_REPRODUCE_OPERATION, typeof DESKTOP_DATASET_VERSION_REPRODUCE_RESPONSE_CHANNEL.value>;
export type DesktopDatasetVersionPublishRequest = Req<DesktopDatasetVersionPublishPayload, typeof DESKTOP_DATASET_VERSION_PUBLISH_OPERATION, typeof DESKTOP_DATASET_VERSION_PUBLISH_REQUEST_CHANNEL.value>;
export type DesktopDatasetVersionPublishResponse = Res<{ publication: DatasetVersionPublicationRecord }, typeof DESKTOP_DATASET_VERSION_PUBLISH_OPERATION, typeof DESKTOP_DATASET_VERSION_PUBLISH_RESPONSE_CHANNEL.value>;

const required = (value: string, field: string) => { const normalized = value?.trim(); if (!normalized) throw new Error(`${field} is required.`); return normalized; };
const boundary = (value: Boundary): Boundary => ({ host: "desktop", source: required(value.source, "boundary.source"), workspaceId: required(value.workspaceId, "boundary.workspaceId") });
const options = (request?: { requestId?: string; correlationId?: string }) => request;

export const createDesktopDatasetVersionListRequest = (payload: DesktopDatasetVersionListPayload, request?: { requestId?: string; correlationId?: string }): DesktopDatasetVersionListRequest => createIpcRequest(DESKTOP_DATASET_VERSION_LIST_REQUEST_CHANNEL, { ...(payload.datasetId?.trim() ? { datasetId: payload.datasetId.trim() } : {}), boundary: boundary(payload.boundary) }, options(request));
export const createDesktopDatasetVersionListSuccessResponse = (value: { versions: readonly DatasetVersionRecord[] }, request?: { requestId?: string; correlationId?: string }): DesktopDatasetVersionListResponse => createIpcSuccessResponse(DESKTOP_DATASET_VERSION_LIST_RESPONSE_CHANNEL, value, options(request));
export const createDesktopDatasetVersionCompareRequest = (payload: DesktopDatasetVersionComparePayload, request?: { requestId?: string; correlationId?: string }): DesktopDatasetVersionCompareRequest => createIpcRequest(DESKTOP_DATASET_VERSION_COMPARE_REQUEST_CHANNEL, { fromVersionId: required(payload.fromVersionId, "fromVersionId"), toVersionId: required(payload.toVersionId, "toVersionId"), boundary: boundary(payload.boundary) }, options(request));
export const createDesktopDatasetVersionCompareSuccessResponse = (value: { comparison: DatasetVersionComparison }, request?: { requestId?: string; correlationId?: string }): DesktopDatasetVersionCompareResponse => createIpcSuccessResponse(DESKTOP_DATASET_VERSION_COMPARE_RESPONSE_CHANNEL, value, options(request));
export const createDesktopDatasetVersionReproduceRequest = (payload: DesktopDatasetVersionReproducePayload, request?: { requestId?: string; correlationId?: string }): DesktopDatasetVersionReproduceRequest => createIpcRequest(DESKTOP_DATASET_VERSION_REPRODUCE_REQUEST_CHANNEL, { versionId: required(payload.versionId, "versionId"), boundary: boundary(payload.boundary) }, options(request));
export const createDesktopDatasetVersionReproduceSuccessResponse = (value: { reproduction: DatasetVersionReproduction }, request?: { requestId?: string; correlationId?: string }): DesktopDatasetVersionReproduceResponse => createIpcSuccessResponse(DESKTOP_DATASET_VERSION_REPRODUCE_RESPONSE_CHANNEL, value, options(request));
export const createDesktopDatasetVersionPublishRequest = (payload: DesktopDatasetVersionPublishPayload, request?: { requestId?: string; correlationId?: string }): DesktopDatasetVersionPublishRequest => createIpcRequest(DESKTOP_DATASET_VERSION_PUBLISH_REQUEST_CHANNEL, { versionId: required(payload.versionId, "versionId"), repositoryId: required(payload.repositoryId, "repositoryId"), visibility: payload.visibility, ...(payload.createRepository ? { createRepository: true } : {}), ...(payload.publicAccessConfirmed ? { publicAccessConfirmed: true } : {}), boundary: boundary(payload.boundary) }, options(request));
export const createDesktopDatasetVersionPublishSuccessResponse = (value: { publication: DatasetVersionPublicationRecord }, request?: { requestId?: string; correlationId?: string }): DesktopDatasetVersionPublishResponse => createIpcSuccessResponse(DESKTOP_DATASET_VERSION_PUBLISH_RESPONSE_CHANNEL, value, options(request));
