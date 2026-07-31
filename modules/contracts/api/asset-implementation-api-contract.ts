import type {
  AssetImplementationReleaseSummary,
  AssetImplementationResolutionRequest,
  AssetImplementationResolutionResult,
} from "../asset-implementation";
import { createTransportOperation } from "../transport";
import type { ApiRequest } from "./api-request";
import type { ApiResponse } from "./api-response";

export const API_ASSET_IMPLEMENTATION_RELEASES_LIST_OPERATION =
  createTransportOperation("asset-implementation", "releases-list");
export const API_ASSET_IMPLEMENTATION_RESOLVE_OPERATION =
  createTransportOperation("asset-implementation", "resolve");

export type ApiAssetImplementationReleasesListRequest = ApiRequest<
  { readonly workspaceId: string },
  typeof API_ASSET_IMPLEMENTATION_RELEASES_LIST_OPERATION,
  Record<string, never>
>;
export type ApiAssetImplementationResolveRequest = ApiRequest<
  AssetImplementationResolutionRequest,
  typeof API_ASSET_IMPLEMENTATION_RESOLVE_OPERATION,
  Record<string, never>
>;
export type ApiAssetImplementationReleasesListResponse = ApiResponse<
  readonly AssetImplementationReleaseSummary[],
  Record<string, unknown>,
  typeof API_ASSET_IMPLEMENTATION_RELEASES_LIST_OPERATION,
  Record<string, never>
>;
export type ApiAssetImplementationResolveResponse = ApiResponse<
  AssetImplementationResolutionResult,
  Record<string, unknown>,
  typeof API_ASSET_IMPLEMENTATION_RESOLVE_OPERATION,
  Record<string, never>
>;
