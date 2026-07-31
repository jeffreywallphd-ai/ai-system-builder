import { createTransportOperation } from "../transport";
import { createIpcChannel } from "./ipc-channel";
import { createIpcRequest, type IpcRequest } from "./ipc-request";
import { createIpcSuccessResponse, type IpcResponse } from "./ipc-response";

export type DesktopFeatureLifecyclePolicy = "always-resident" | "retained" | "disposable" | "explicit-unload-only";

export interface DesktopFeatureLifecycleStateEntry {
  readonly featureKey: string;
  readonly policy: DesktopFeatureLifecyclePolicy;
  readonly loaded: boolean;
  readonly idle: boolean;
  readonly idleTimeoutScheduled: boolean;
}

export interface DesktopFeatureLifecycleBoundaryContext {
  readonly host: "desktop";
  readonly source: string;
}

export interface DesktopFeatureLifecycleStateReadRequestPayload {
  readonly boundary: DesktopFeatureLifecycleBoundaryContext;
}

export interface DesktopFeatureLifecycleIdleDisposeRequestPayload {
  readonly boundary: DesktopFeatureLifecycleBoundaryContext;
}

export interface DesktopFeatureLifecycleIdleDisposeResult {
  readonly featureKey: string;
  readonly disposed: boolean;
  readonly policy?: DesktopFeatureLifecyclePolicy;
  readonly alreadyDisposed?: boolean;
  readonly blockedReason?: string;
  readonly activeTaskCount?: number;
}

export const DESKTOP_FEATURE_LIFECYCLE_STATE_READ_OPERATION = createTransportOperation("diagnostics", "feature-lifecycle-state-read");
export const DESKTOP_FEATURE_LIFECYCLE_IDLE_DISPOSE_OPERATION = createTransportOperation("diagnostics", "feature-lifecycle-idle-dispose");

export const DESKTOP_FEATURE_LIFECYCLE_STATE_READ_REQUEST_CHANNEL = createIpcChannel(DESKTOP_FEATURE_LIFECYCLE_STATE_READ_OPERATION, "request");
export const DESKTOP_FEATURE_LIFECYCLE_STATE_READ_RESPONSE_CHANNEL = createIpcChannel(DESKTOP_FEATURE_LIFECYCLE_STATE_READ_OPERATION, "response");
export const DESKTOP_FEATURE_LIFECYCLE_IDLE_DISPOSE_REQUEST_CHANNEL = createIpcChannel(DESKTOP_FEATURE_LIFECYCLE_IDLE_DISPOSE_OPERATION, "request");
export const DESKTOP_FEATURE_LIFECYCLE_IDLE_DISPOSE_RESPONSE_CHANNEL = createIpcChannel(DESKTOP_FEATURE_LIFECYCLE_IDLE_DISPOSE_OPERATION, "response");

export type DesktopFeatureLifecycleStateReadRequest = IpcRequest<DesktopFeatureLifecycleStateReadRequestPayload, typeof DESKTOP_FEATURE_LIFECYCLE_STATE_READ_OPERATION, Record<string, never>, typeof DESKTOP_FEATURE_LIFECYCLE_STATE_READ_REQUEST_CHANNEL.value>;
export type DesktopFeatureLifecycleStateReadResponse = IpcResponse<{ entries: DesktopFeatureLifecycleStateEntry[] }, Record<string, unknown>, typeof DESKTOP_FEATURE_LIFECYCLE_STATE_READ_OPERATION, Record<string, never>, typeof DESKTOP_FEATURE_LIFECYCLE_STATE_READ_RESPONSE_CHANNEL.value>;
export type DesktopFeatureLifecycleIdleDisposeRequest = IpcRequest<DesktopFeatureLifecycleIdleDisposeRequestPayload, typeof DESKTOP_FEATURE_LIFECYCLE_IDLE_DISPOSE_OPERATION, Record<string, never>, typeof DESKTOP_FEATURE_LIFECYCLE_IDLE_DISPOSE_REQUEST_CHANNEL.value>;
export type DesktopFeatureLifecycleIdleDisposeResponse = IpcResponse<{ results: DesktopFeatureLifecycleIdleDisposeResult[] }, Record<string, unknown>, typeof DESKTOP_FEATURE_LIFECYCLE_IDLE_DISPOSE_OPERATION, Record<string, never>, typeof DESKTOP_FEATURE_LIFECYCLE_IDLE_DISPOSE_RESPONSE_CHANNEL.value>;

function normalizeSource(source: string): string {
  const normalized = source.trim();
  if (!normalized) throw new Error("boundary.source must be a non-empty, trimmed string.");
  return normalized;
}

function normalizeBoundary(boundary: DesktopFeatureLifecycleBoundaryContext): DesktopFeatureLifecycleBoundaryContext {
  return { host: "desktop", source: normalizeSource(boundary.source) };
}

export function createDesktopFeatureLifecycleStateReadRequest(payload: DesktopFeatureLifecycleStateReadRequestPayload, options?: { requestId?: string; correlationId?: string }): DesktopFeatureLifecycleStateReadRequest {
  return createIpcRequest(DESKTOP_FEATURE_LIFECYCLE_STATE_READ_REQUEST_CHANNEL, { boundary: normalizeBoundary(payload.boundary) }, options);
}

export function createDesktopFeatureLifecycleStateReadSuccessResponse(entries: DesktopFeatureLifecycleStateEntry[], options?: { requestId?: string; correlationId?: string }): DesktopFeatureLifecycleStateReadResponse {
  return createIpcSuccessResponse(DESKTOP_FEATURE_LIFECYCLE_STATE_READ_RESPONSE_CHANNEL, { entries }, options);
}

export function createDesktopFeatureLifecycleIdleDisposeRequest(payload: DesktopFeatureLifecycleIdleDisposeRequestPayload, options?: { requestId?: string; correlationId?: string }): DesktopFeatureLifecycleIdleDisposeRequest {
  return createIpcRequest(DESKTOP_FEATURE_LIFECYCLE_IDLE_DISPOSE_REQUEST_CHANNEL, { boundary: normalizeBoundary(payload.boundary) }, options);
}

export function createDesktopFeatureLifecycleIdleDisposeSuccessResponse(results: DesktopFeatureLifecycleIdleDisposeResult[], options?: { requestId?: string; correlationId?: string }): DesktopFeatureLifecycleIdleDisposeResponse {
  return createIpcSuccessResponse(DESKTOP_FEATURE_LIFECYCLE_IDLE_DISPOSE_RESPONSE_CHANNEL, { results }, options);
}
