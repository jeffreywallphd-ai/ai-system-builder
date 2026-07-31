import type {
  AssetImplementationReleaseSummary,
  AssetImplementationResolutionRequest,
  AssetImplementationResolutionResult,
} from "../asset-implementation";
import { createTransportOperation } from "../transport";
import { createIpcChannel } from "./ipc-channel";
import { createIpcRequest, type IpcRequest } from "./ipc-request";
import type { IpcResponse } from "./ipc-response";

export const DESKTOP_ASSET_IMPLEMENTATION_RELEASES_LIST_OPERATION =
  createTransportOperation("asset-implementation", "releases-list");
export const DESKTOP_ASSET_IMPLEMENTATION_RESOLVE_OPERATION =
  createTransportOperation("asset-implementation", "resolve");

export const DESKTOP_ASSET_IMPLEMENTATION_RELEASES_LIST_REQUEST_CHANNEL =
  createIpcChannel(
    DESKTOP_ASSET_IMPLEMENTATION_RELEASES_LIST_OPERATION,
    "request",
  );
export const DESKTOP_ASSET_IMPLEMENTATION_RELEASES_LIST_RESPONSE_CHANNEL =
  createIpcChannel(
    DESKTOP_ASSET_IMPLEMENTATION_RELEASES_LIST_OPERATION,
    "response",
  );
export const DESKTOP_ASSET_IMPLEMENTATION_RESOLVE_REQUEST_CHANNEL =
  createIpcChannel(DESKTOP_ASSET_IMPLEMENTATION_RESOLVE_OPERATION, "request");
export const DESKTOP_ASSET_IMPLEMENTATION_RESOLVE_RESPONSE_CHANNEL =
  createIpcChannel(DESKTOP_ASSET_IMPLEMENTATION_RESOLVE_OPERATION, "response");

export type DesktopAssetImplementationReleasesListRequest = IpcRequest<
  { readonly workspaceId: string },
  typeof DESKTOP_ASSET_IMPLEMENTATION_RELEASES_LIST_OPERATION,
  Record<string, never>,
  typeof DESKTOP_ASSET_IMPLEMENTATION_RELEASES_LIST_REQUEST_CHANNEL.value
>;
export type DesktopAssetImplementationResolveRequest = IpcRequest<
  AssetImplementationResolutionRequest,
  typeof DESKTOP_ASSET_IMPLEMENTATION_RESOLVE_OPERATION,
  Record<string, never>,
  typeof DESKTOP_ASSET_IMPLEMENTATION_RESOLVE_REQUEST_CHANNEL.value
>;
export type DesktopAssetImplementationReleasesListResponse = IpcResponse<
  readonly AssetImplementationReleaseSummary[],
  Record<string, unknown>,
  typeof DESKTOP_ASSET_IMPLEMENTATION_RELEASES_LIST_OPERATION,
  Record<string, never>,
  typeof DESKTOP_ASSET_IMPLEMENTATION_RELEASES_LIST_RESPONSE_CHANNEL.value
>;
export type DesktopAssetImplementationResolveResponse = IpcResponse<
  AssetImplementationResolutionResult,
  Record<string, unknown>,
  typeof DESKTOP_ASSET_IMPLEMENTATION_RESOLVE_OPERATION,
  Record<string, never>,
  typeof DESKTOP_ASSET_IMPLEMENTATION_RESOLVE_RESPONSE_CHANNEL.value
>;

export const createDesktopAssetImplementationReleasesListRequest = (
  workspaceId: string,
  context?: { requestId?: string; correlationId?: string },
): DesktopAssetImplementationReleasesListRequest =>
  createIpcRequest(
    DESKTOP_ASSET_IMPLEMENTATION_RELEASES_LIST_REQUEST_CHANNEL,
    { workspaceId },
    context,
  );

export const createDesktopAssetImplementationResolveRequest = (
  request: AssetImplementationResolutionRequest,
  context?: { requestId?: string; correlationId?: string },
): DesktopAssetImplementationResolveRequest =>
  createIpcRequest(
    DESKTOP_ASSET_IMPLEMENTATION_RESOLVE_REQUEST_CHANNEL,
    request,
    context,
  );
