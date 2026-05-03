import type { ImageGenerationRequest } from "../image-generation";
import type { CancelRuntimeTaskResult, RuntimeTaskRecord, StartRuntimeTaskResult } from "../runtime";
import { createTransportOperation } from "../transport";
import { createIpcChannel } from "./ipc-channel";
import { createIpcRequest, type IpcRequest } from "./ipc-request";
import { createIpcSuccessResponse, type IpcResponse } from "./ipc-response";

export const DESKTOP_IMAGE_GENERATION_START_OPERATION = createTransportOperation("image-generation", "start");
export const DESKTOP_IMAGE_GENERATION_READ_OPERATION = createTransportOperation("image-generation", "read");
export const DESKTOP_IMAGE_GENERATION_CANCEL_OPERATION = createTransportOperation("image-generation", "cancel");
export const DESKTOP_IMAGE_GENERATION_FINALIZE_OPERATION = createTransportOperation("image-generation", "finalize-if-completed");

export const DESKTOP_IMAGE_GENERATION_START_REQUEST_CHANNEL = createIpcChannel(DESKTOP_IMAGE_GENERATION_START_OPERATION, "request");
export const DESKTOP_IMAGE_GENERATION_START_RESPONSE_CHANNEL = createIpcChannel(DESKTOP_IMAGE_GENERATION_START_OPERATION, "response");
export const DESKTOP_IMAGE_GENERATION_READ_REQUEST_CHANNEL = createIpcChannel(DESKTOP_IMAGE_GENERATION_READ_OPERATION, "request");
export const DESKTOP_IMAGE_GENERATION_READ_RESPONSE_CHANNEL = createIpcChannel(DESKTOP_IMAGE_GENERATION_READ_OPERATION, "response");
export const DESKTOP_IMAGE_GENERATION_CANCEL_REQUEST_CHANNEL = createIpcChannel(DESKTOP_IMAGE_GENERATION_CANCEL_OPERATION, "request");
export const DESKTOP_IMAGE_GENERATION_CANCEL_RESPONSE_CHANNEL = createIpcChannel(DESKTOP_IMAGE_GENERATION_CANCEL_OPERATION, "response");
export const DESKTOP_IMAGE_GENERATION_FINALIZE_REQUEST_CHANNEL = createIpcChannel(DESKTOP_IMAGE_GENERATION_FINALIZE_OPERATION, "request");
export const DESKTOP_IMAGE_GENERATION_FINALIZE_RESPONSE_CHANNEL = createIpcChannel(DESKTOP_IMAGE_GENERATION_FINALIZE_OPERATION, "response");

export interface DesktopImageGenerationReadRequestPayload { requestId: string; }
export interface DesktopImageGenerationCancelRequestPayload { requestId: string; }
export interface DesktopImageGenerationFinalizeRequestPayload { requestId: string; }
export interface DesktopImageGenerationFinalizeResult { finalized: boolean; assets?: Array<{ assetId: string; artifactId: string }>; reason?: string; }

export type DesktopImageGenerationStartRequest = IpcRequest<ImageGenerationRequest, typeof DESKTOP_IMAGE_GENERATION_START_OPERATION, Record<string, never>, typeof DESKTOP_IMAGE_GENERATION_START_REQUEST_CHANNEL.value>;
export type DesktopImageGenerationStartResponse = IpcResponse<StartRuntimeTaskResult, Record<string, unknown>, typeof DESKTOP_IMAGE_GENERATION_START_OPERATION, Record<string, never>, typeof DESKTOP_IMAGE_GENERATION_START_RESPONSE_CHANNEL.value>;
export type DesktopImageGenerationReadRequest = IpcRequest<DesktopImageGenerationReadRequestPayload, typeof DESKTOP_IMAGE_GENERATION_READ_OPERATION, Record<string, never>, typeof DESKTOP_IMAGE_GENERATION_READ_REQUEST_CHANNEL.value>;
export type DesktopImageGenerationReadResponse = IpcResponse<RuntimeTaskRecord, Record<string, unknown>, typeof DESKTOP_IMAGE_GENERATION_READ_OPERATION, Record<string, never>, typeof DESKTOP_IMAGE_GENERATION_READ_RESPONSE_CHANNEL.value>;
export type DesktopImageGenerationCancelRequest = IpcRequest<DesktopImageGenerationCancelRequestPayload, typeof DESKTOP_IMAGE_GENERATION_CANCEL_OPERATION, Record<string, never>, typeof DESKTOP_IMAGE_GENERATION_CANCEL_REQUEST_CHANNEL.value>;
export type DesktopImageGenerationCancelResponse = IpcResponse<CancelRuntimeTaskResult, Record<string, unknown>, typeof DESKTOP_IMAGE_GENERATION_CANCEL_OPERATION, Record<string, never>, typeof DESKTOP_IMAGE_GENERATION_CANCEL_RESPONSE_CHANNEL.value>;
export type DesktopImageGenerationFinalizeRequest = IpcRequest<DesktopImageGenerationFinalizeRequestPayload, typeof DESKTOP_IMAGE_GENERATION_FINALIZE_OPERATION, Record<string, never>, typeof DESKTOP_IMAGE_GENERATION_FINALIZE_REQUEST_CHANNEL.value>;
export type DesktopImageGenerationFinalizeResponse = IpcResponse<DesktopImageGenerationFinalizeResult, Record<string, unknown>, typeof DESKTOP_IMAGE_GENERATION_FINALIZE_OPERATION, Record<string, never>, typeof DESKTOP_IMAGE_GENERATION_FINALIZE_RESPONSE_CHANNEL.value>;

const n = (v: string) => v.trim();

export const createDesktopImageGenerationStartRequest = (payload: ImageGenerationRequest, options?: { requestId?: string; correlationId?: string }): DesktopImageGenerationStartRequest => createIpcRequest(DESKTOP_IMAGE_GENERATION_START_REQUEST_CHANNEL, payload, options);
export const createDesktopImageGenerationStartSuccessResponse = (value: StartRuntimeTaskResult, options?: { requestId?: string; correlationId?: string }): DesktopImageGenerationStartResponse => createIpcSuccessResponse(DESKTOP_IMAGE_GENERATION_START_RESPONSE_CHANNEL, value, options);
export const createDesktopImageGenerationReadRequest = (payload: DesktopImageGenerationReadRequestPayload, options?: { requestId?: string; correlationId?: string }): DesktopImageGenerationReadRequest => createIpcRequest(DESKTOP_IMAGE_GENERATION_READ_REQUEST_CHANNEL, { requestId: n(payload.requestId) }, options);
export const createDesktopImageGenerationReadSuccessResponse = (value: RuntimeTaskRecord, options?: { requestId?: string; correlationId?: string }): DesktopImageGenerationReadResponse => createIpcSuccessResponse(DESKTOP_IMAGE_GENERATION_READ_RESPONSE_CHANNEL, value, options);
export const createDesktopImageGenerationCancelRequest = (payload: DesktopImageGenerationCancelRequestPayload, options?: { requestId?: string; correlationId?: string }): DesktopImageGenerationCancelRequest => createIpcRequest(DESKTOP_IMAGE_GENERATION_CANCEL_REQUEST_CHANNEL, { requestId: n(payload.requestId) }, options);
export const createDesktopImageGenerationCancelSuccessResponse = (value: CancelRuntimeTaskResult, options?: { requestId?: string; correlationId?: string }): DesktopImageGenerationCancelResponse => createIpcSuccessResponse(DESKTOP_IMAGE_GENERATION_CANCEL_RESPONSE_CHANNEL, value, options);
export const createDesktopImageGenerationFinalizeRequest = (payload: DesktopImageGenerationFinalizeRequestPayload, options?: { requestId?: string; correlationId?: string }): DesktopImageGenerationFinalizeRequest => createIpcRequest(DESKTOP_IMAGE_GENERATION_FINALIZE_REQUEST_CHANNEL, { requestId: n(payload.requestId) }, options);
export const createDesktopImageGenerationFinalizeSuccessResponse = (value: DesktopImageGenerationFinalizeResult, options?: { requestId?: string; correlationId?: string }): DesktopImageGenerationFinalizeResponse => createIpcSuccessResponse(DESKTOP_IMAGE_GENERATION_FINALIZE_RESPONSE_CHANNEL, value, options);
