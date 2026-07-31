import type { AssetReference } from "../asset";
import { createWorkspaceId, type WorkspaceId } from "../workspace";
import type {
  CopyUserLibraryAssetToWorkspaceCommand,
  CopyUserLibraryAssetToWorkspaceResult,
  ImportWorkspaceAssetToWorkspaceCommand,
  ImportWorkspaceAssetToWorkspaceResult,
  LinkUserLibraryAssetToWorkspaceCommand,
  LinkUserLibraryAssetToWorkspaceResult,
  PromoteWorkspaceAssetToUserLibraryCommand,
  PromoteWorkspaceAssetToUserLibraryResult,
  UserLibraryAssetId,
  UserLibraryAssetRecord,
  UserLibraryAssetRecordStatus,
  UserLibraryAssetVersion,
  UserLibraryEffectiveSourceSummary,
  UserLibraryLinkId,
  UserLibraryPropagationPolicy,
  UserLibrarySourceKind,
  WorkspaceUserLibraryLinkRecord,
  WorkspaceUserLibraryLinkStatus,
} from "../user-library";
import { createTransportOperation } from "../transport";
import { createApiError } from "./api-error";
import { createApiRequest, type ApiRequest } from "./api-request";
import { createApiFailureResponse, createApiSuccessResponse, type ApiResponse } from "./api-response";

export const API_USER_LIBRARY_PROMOTE_OPERATION = createTransportOperation("user-library", "promote-workspace-asset");
export const API_USER_LIBRARY_LINK_OPERATION = createTransportOperation("user-library", "link-asset-to-workspace");
export const API_USER_LIBRARY_COPY_OPERATION = createTransportOperation("user-library", "copy-asset-to-workspace");
export const API_USER_LIBRARY_IMPORT_OPERATION = createTransportOperation("user-library", "import-workspace-asset");
export const API_USER_LIBRARY_ASSET_LIST_OPERATION = createTransportOperation("user-library", "list-assets");
export const API_USER_LIBRARY_ASSET_READ_OPERATION = createTransportOperation("user-library", "read-asset");
export const API_USER_LIBRARY_LINK_LIST_OPERATION = createTransportOperation("user-library", "list-workspace-links");
export const API_USER_LIBRARY_LINK_READ_OPERATION = createTransportOperation("user-library", "read-workspace-link");
export const API_WORKSPACE_EFFECTIVE_ASSET_SOURCE_LIST_OPERATION = createTransportOperation("user-library", "list-workspace-effective-sources");

export interface ApiUserLibraryAssetListRequestPayload {
  readonly text?: string; readonly status?: UserLibraryAssetRecordStatus; readonly sourceWorkspaceId?: WorkspaceId; readonly sourceAssetReference?: AssetReference; readonly sourceKind?: UserLibrarySourceKind; readonly limit?: number; readonly cursor?: string;
}
export interface ApiUserLibraryAssetReadRequestPayload { readonly userLibraryAssetId: UserLibraryAssetId; readonly version?: UserLibraryAssetVersion; }
export interface ApiWorkspaceUserLibraryLinkListRequestPayload { readonly workspaceId: WorkspaceId; readonly status?: WorkspaceUserLibraryLinkStatus; readonly propagationPolicy?: UserLibraryPropagationPolicy; readonly userLibraryAssetReference?: { readonly assetId: UserLibraryAssetId; readonly version: UserLibraryAssetVersion; readonly label?: string; }; readonly text?: string; readonly limit?: number; readonly cursor?: string; }
export interface ApiWorkspaceUserLibraryLinkReadRequestPayload { readonly workspaceId: WorkspaceId; readonly linkId: UserLibraryLinkId; }
export interface ApiWorkspaceEffectiveAssetSourceListRequestPayload { readonly workspaceId: WorkspaceId; readonly assetReference?: AssetReference; readonly limit?: number; readonly cursor?: string; }

export type ApiUserLibraryPromoteRequest = ApiRequest<PromoteWorkspaceAssetToUserLibraryCommand, typeof API_USER_LIBRARY_PROMOTE_OPERATION, Record<string, never>>;
export type ApiUserLibraryLinkRequest = ApiRequest<LinkUserLibraryAssetToWorkspaceCommand, typeof API_USER_LIBRARY_LINK_OPERATION, Record<string, never>>;
export type ApiUserLibraryCopyRequest = ApiRequest<CopyUserLibraryAssetToWorkspaceCommand, typeof API_USER_LIBRARY_COPY_OPERATION, Record<string, never>>;
export type ApiUserLibraryImportRequest = ApiRequest<ImportWorkspaceAssetToWorkspaceCommand, typeof API_USER_LIBRARY_IMPORT_OPERATION, Record<string, never>>;
export type ApiUserLibraryAssetListRequest = ApiRequest<ApiUserLibraryAssetListRequestPayload, typeof API_USER_LIBRARY_ASSET_LIST_OPERATION, Record<string, never>>;
export type ApiUserLibraryAssetReadRequest = ApiRequest<ApiUserLibraryAssetReadRequestPayload, typeof API_USER_LIBRARY_ASSET_READ_OPERATION, Record<string, never>>;
export type ApiWorkspaceUserLibraryLinkListRequest = ApiRequest<ApiWorkspaceUserLibraryLinkListRequestPayload, typeof API_USER_LIBRARY_LINK_LIST_OPERATION, Record<string, never>>;
export type ApiWorkspaceUserLibraryLinkReadRequest = ApiRequest<ApiWorkspaceUserLibraryLinkReadRequestPayload, typeof API_USER_LIBRARY_LINK_READ_OPERATION, Record<string, never>>;
export type ApiWorkspaceEffectiveAssetSourceListRequest = ApiRequest<ApiWorkspaceEffectiveAssetSourceListRequestPayload, typeof API_WORKSPACE_EFFECTIVE_ASSET_SOURCE_LIST_OPERATION, Record<string, never>>;

export type ApiUserLibraryPromoteResponse = ApiResponse<PromoteWorkspaceAssetToUserLibraryResult, Record<string, unknown>, typeof API_USER_LIBRARY_PROMOTE_OPERATION, Record<string, never>>;
export type ApiUserLibraryLinkResponse = ApiResponse<LinkUserLibraryAssetToWorkspaceResult, Record<string, unknown>, typeof API_USER_LIBRARY_LINK_OPERATION, Record<string, never>>;
export type ApiUserLibraryCopyResponse = ApiResponse<CopyUserLibraryAssetToWorkspaceResult, Record<string, unknown>, typeof API_USER_LIBRARY_COPY_OPERATION, Record<string, never>>;
export type ApiUserLibraryImportResponse = ApiResponse<ImportWorkspaceAssetToWorkspaceResult, Record<string, unknown>, typeof API_USER_LIBRARY_IMPORT_OPERATION, Record<string, never>>;
export type ApiUserLibraryAssetListResponse = ApiResponse<{ readonly assets: readonly UserLibraryAssetRecord[]; readonly nextCursor?: string }, Record<string, unknown>, typeof API_USER_LIBRARY_ASSET_LIST_OPERATION, Record<string, never>>;
export type ApiUserLibraryAssetReadResponse = ApiResponse<UserLibraryAssetRecord, Record<string, unknown>, typeof API_USER_LIBRARY_ASSET_READ_OPERATION, Record<string, never>>;
export type ApiWorkspaceUserLibraryLinkListResponse = ApiResponse<{ readonly links: readonly WorkspaceUserLibraryLinkRecord[]; readonly nextCursor?: string }, Record<string, unknown>, typeof API_USER_LIBRARY_LINK_LIST_OPERATION, Record<string, never>>;
export type ApiWorkspaceUserLibraryLinkReadResponse = ApiResponse<WorkspaceUserLibraryLinkRecord, Record<string, unknown>, typeof API_USER_LIBRARY_LINK_READ_OPERATION, Record<string, never>>;
export type ApiWorkspaceEffectiveAssetSourceListResponse = ApiResponse<{ readonly items: readonly UserLibraryEffectiveSourceSummary[]; readonly nextCursor?: string }, Record<string, unknown>, typeof API_WORKSPACE_EFFECTIVE_ASSET_SOURCE_LIST_OPERATION, Record<string, never>>;

export const createApiUserLibraryAssetListRequest = (payload: ApiUserLibraryAssetListRequestPayload = {}, options?: { requestId?: string; correlationId?: string }) => createApiRequest(API_USER_LIBRARY_ASSET_LIST_OPERATION, payload, options);
export const createApiUserLibraryAssetReadRequest = (payload: ApiUserLibraryAssetReadRequestPayload, options?: { requestId?: string; correlationId?: string }) => createApiRequest(API_USER_LIBRARY_ASSET_READ_OPERATION, payload, options);
export const createApiWorkspaceUserLibraryLinkListRequest = (payload: ApiWorkspaceUserLibraryLinkListRequestPayload, options?: { requestId?: string; correlationId?: string }) => createApiRequest(API_USER_LIBRARY_LINK_LIST_OPERATION, { ...payload, workspaceId: createWorkspaceId(payload.workspaceId) }, options);
export const createApiWorkspaceUserLibraryLinkReadRequest = (payload: ApiWorkspaceUserLibraryLinkReadRequestPayload, options?: { requestId?: string; correlationId?: string }) => createApiRequest(API_USER_LIBRARY_LINK_READ_OPERATION, { ...payload, workspaceId: createWorkspaceId(payload.workspaceId) }, options);
export const createApiWorkspaceEffectiveAssetSourceListRequest = (payload: ApiWorkspaceEffectiveAssetSourceListRequestPayload, options?: { requestId?: string; correlationId?: string }) => createApiRequest(API_WORKSPACE_EFFECTIVE_ASSET_SOURCE_LIST_OPERATION, { ...payload, workspaceId: createWorkspaceId(payload.workspaceId) }, options);

export const createApiUserLibraryFailureResponse = (operation: string, code: "validation"|"internal"|"not-found"|"unavailable", message: string, options?: { requestId?: string; correlationId?: string; details?: Record<string, unknown> }) => createApiFailureResponse(createApiError(operation as never, code, message, options), options);
export const createApiUserLibraryOperationSuccessResponse = <TOperation extends string, TValue>(operation: TOperation, value: TValue, options?: { requestId?: string; correlationId?: string }) => createApiSuccessResponse(operation as never, value, options);
