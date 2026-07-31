import type {
  AssetMutationFailureCode,
  AssetMutationOperation,
  AssetMutationResult,
  FinalizeGeneratedOutputCommand,
  ImportExternalRepositoryObjectCommand,
  LocalizeExternalRepositoryObjectCommand,
  RegisterResourceBackedViewCommand,
  AssetFamily,
  AssetLifecycleStatus,
  AssetReference,
  AssetResourceBackedViewKind,
  AssetType,
} from "../asset";
import { normalizeAssetId, normalizeAssetVersion } from "../asset";
import { createTransportOperation } from "../transport";
import type {
  AssetDefinitionCard,
  AssetDefinitionDetail,
  AssetRegistryListResult,
  AssetRegistryReadOptions,
  AssetRegistryResourceBackedViewCard,
  AssetRegistryResourceBackedViewDetail,
} from "../../application/services/asset/asset-registry-read-facade.types";
import { createApiError } from "./api-error";
import { createApiRequest, type ApiRequest } from "./api-request";
import {
  createApiFailureResponse,
  createApiSuccessResponse,
  type ApiResponse,
} from "./api-response";

export const API_ASSET_DEFINITIONS_LIST_OPERATION = createTransportOperation("asset", "definitions-list");
export const API_ASSET_DEFINITION_READ_OPERATION = createTransportOperation("asset", "definition-read");
export const API_ASSET_DEFINITION_VERSION_READ_OPERATION = createTransportOperation("asset", "definition-version-read");
export const API_ASSET_RESOURCE_BACKED_VIEWS_LIST_OPERATION = createTransportOperation("asset", "resource-backed-views-list");
export const API_ASSET_RESOURCE_BACKED_VIEW_READ_OPERATION = createTransportOperation("asset", "resource-backed-view-read");
export const API_ASSET_REGISTER_RESOURCE_BACKED_VIEW_OPERATION =
  createTransportOperation("asset", "register-resource-backed-view") as "asset.register-resource-backed-view";
export const API_ASSET_FINALIZE_GENERATED_OUTPUT_OPERATION =
  createTransportOperation("asset", "finalize-generated-output") as "asset.finalize-generated-output";
export const API_ASSET_IMPORT_EXTERNAL_REPOSITORY_OBJECT_OPERATION =
  createTransportOperation("asset", "import-external-repository-object") as "asset.import-external-repository-object";
export const API_ASSET_LOCALIZE_EXTERNAL_REPOSITORY_OBJECT_OPERATION =
  createTransportOperation("asset", "localize-external-repository-object") as "asset.localize-external-repository-object";

export const API_ASSET_MUTATION_ROUTES = {
  registerResourceBackedView: {
    method: "POST",
    path: "/api/assets/register-resource-backed-view",
    operation: API_ASSET_REGISTER_RESOURCE_BACKED_VIEW_OPERATION,
  },
  finalizeGeneratedOutput: {
    method: "POST",
    path: "/api/assets/finalize-generated-output",
    operation: API_ASSET_FINALIZE_GENERATED_OUTPUT_OPERATION,
  },
  importExternalRepositoryObject: {
    method: "POST",
    path: "/api/assets/import-external-repository-object",
    operation: API_ASSET_IMPORT_EXTERNAL_REPOSITORY_OBJECT_OPERATION,
  },
  localizeExternalRepositoryObject: {
    method: "POST",
    path: "/api/assets/localize-external-repository-object",
    operation: API_ASSET_LOCALIZE_EXTERNAL_REPOSITORY_OBJECT_OPERATION,
  },
} as const;

export type ApiAssetBuiltInFilter = "all" | "built-in" | "custom";

export interface ApiAssetDefinitionsListRequestPayload {
  readonly q?: string;
  readonly assetType?: readonly AssetType[];
  readonly assetFamily?: readonly AssetFamily[];
  readonly lifecycleStatus?: readonly AssetLifecycleStatus[];
  readonly builtIn?: ApiAssetBuiltInFilter;
  readonly limit?: number;
  readonly cursor?: string;
  readonly includeMetadata?: boolean;
  readonly workspaceId?: string;
}

export interface ApiAssetDefinitionReadRequestPayload {
  readonly definitionId: string;
  readonly version?: string;
  readonly expand?: readonly ApiAssetDefinitionExpansion[];
  readonly includeValidation?: boolean;
  readonly workspaceId?: string;
}

export type ApiAssetDefinitionExpansion =
  | "aiContext"
  | "configurationSchema"
  | "ports"
  | "requirements"
  | "provenance"
  | "metadata";

export interface ApiAssetResourceBackedViewsListRequestPayload {
  readonly q?: string;
  readonly assetType?: readonly AssetType[];
  readonly assetFamily?: readonly AssetFamily[];
  readonly lifecycleStatus?: readonly AssetLifecycleStatus[];
  readonly viewKind?: readonly AssetResourceBackedViewKind[];
  readonly limit?: number;
  readonly cursor?: string;
  readonly includeMetadata?: boolean;
  readonly workspaceId?: string;
}

export type ApiAssetResourceBackedViewExpansion =
  | "metadata"
  | "resourceBackings"
  | "validation";

export interface ApiAssetResourceBackedViewReadRequestPayload {
  readonly viewId: string;
  readonly expand?: readonly ApiAssetResourceBackedViewExpansion[];
  readonly includeValidation?: boolean;
  readonly workspaceId?: string;
}

export type ApiAssetDefinitionsListRequest = ApiRequest<
  ApiAssetDefinitionsListRequestPayload,
  typeof API_ASSET_DEFINITIONS_LIST_OPERATION,
  Record<string, never>
>;

export type ApiAssetDefinitionReadRequest = ApiRequest<
  ApiAssetDefinitionReadRequestPayload,
  typeof API_ASSET_DEFINITION_READ_OPERATION,
  Record<string, never>
>;

export type ApiAssetDefinitionVersionReadRequest = ApiRequest<
  Required<Pick<ApiAssetDefinitionReadRequestPayload, "definitionId" | "version">> & Omit<ApiAssetDefinitionReadRequestPayload, "definitionId" | "version">,
  typeof API_ASSET_DEFINITION_VERSION_READ_OPERATION,
  Record<string, never>
>;

export type ApiAssetResourceBackedViewsListRequest = ApiRequest<
  ApiAssetResourceBackedViewsListRequestPayload,
  typeof API_ASSET_RESOURCE_BACKED_VIEWS_LIST_OPERATION,
  Record<string, never>
>;

export type ApiAssetResourceBackedViewReadRequest = ApiRequest<
  ApiAssetResourceBackedViewReadRequestPayload,
  typeof API_ASSET_RESOURCE_BACKED_VIEW_READ_OPERATION,
  Record<string, never>
>;

export type ApiAssetRegisterResourceBackedViewRequest = ApiRequest<
  RegisterResourceBackedViewCommand,
  typeof API_ASSET_REGISTER_RESOURCE_BACKED_VIEW_OPERATION,
  Record<string, never>
>;

export type ApiAssetFinalizeGeneratedOutputRequest = ApiRequest<
  FinalizeGeneratedOutputCommand,
  typeof API_ASSET_FINALIZE_GENERATED_OUTPUT_OPERATION,
  Record<string, never>
>;

export type ApiAssetImportExternalRepositoryObjectRequest = ApiRequest<
  ImportExternalRepositoryObjectCommand,
  typeof API_ASSET_IMPORT_EXTERNAL_REPOSITORY_OBJECT_OPERATION,
  Record<string, never>
>;

export type ApiAssetLocalizeExternalRepositoryObjectRequest = ApiRequest<
  LocalizeExternalRepositoryObjectCommand,
  typeof API_ASSET_LOCALIZE_EXTERNAL_REPOSITORY_OBJECT_OPERATION,
  Record<string, never>
>;

export type ApiAssetDefinitionsListResponse = ApiResponse<
  AssetRegistryListResult<AssetDefinitionCard>,
  Record<string, unknown>,
  typeof API_ASSET_DEFINITIONS_LIST_OPERATION,
  Record<string, never>
>;

export type ApiAssetDefinitionReadResponse = ApiResponse<
  AssetDefinitionDetail,
  Record<string, unknown>,
  typeof API_ASSET_DEFINITION_READ_OPERATION,
  Record<string, never>
>;

export type ApiAssetDefinitionVersionReadResponse = ApiResponse<
  AssetDefinitionDetail,
  Record<string, unknown>,
  typeof API_ASSET_DEFINITION_VERSION_READ_OPERATION,
  Record<string, never>
>;

export type ApiAssetResourceBackedViewsListResponse = ApiResponse<
  AssetRegistryListResult<AssetRegistryResourceBackedViewCard>,
  Record<string, unknown>,
  typeof API_ASSET_RESOURCE_BACKED_VIEWS_LIST_OPERATION,
  Record<string, never>
>;

export type ApiAssetResourceBackedViewReadResponse = ApiResponse<
  AssetRegistryResourceBackedViewDetail,
  Record<string, unknown>,
  typeof API_ASSET_RESOURCE_BACKED_VIEW_READ_OPERATION,
  Record<string, never>
>;

export type ApiAssetMutationResponse<
  TOperation extends AssetMutationOperation = AssetMutationOperation,
> = ApiResponse<
  AssetMutationResult,
  Record<string, unknown>,
  TOperation,
  Record<string, never>
>;

export type ApiAssetRegisterResourceBackedViewResponse =
  ApiAssetMutationResponse<typeof API_ASSET_REGISTER_RESOURCE_BACKED_VIEW_OPERATION>;
export type ApiAssetFinalizeGeneratedOutputResponse =
  ApiAssetMutationResponse<typeof API_ASSET_FINALIZE_GENERATED_OUTPUT_OPERATION>;
export type ApiAssetImportExternalRepositoryObjectResponse =
  ApiAssetMutationResponse<typeof API_ASSET_IMPORT_EXTERNAL_REPOSITORY_OBJECT_OPERATION>;
export type ApiAssetLocalizeExternalRepositoryObjectResponse =
  ApiAssetMutationResponse<typeof API_ASSET_LOCALIZE_EXTERNAL_REPOSITORY_OBJECT_OPERATION>;

export function createApiAssetDefinitionsListRequest(
  payload: ApiAssetDefinitionsListRequestPayload = {},
  options?: { requestId?: string; correlationId?: string },
): ApiAssetDefinitionsListRequest {
  return createApiRequest(API_ASSET_DEFINITIONS_LIST_OPERATION, payload, options);
}

export function createApiAssetDefinitionReadRequest(
  payload: ApiAssetDefinitionReadRequestPayload,
  options?: { requestId?: string; correlationId?: string },
): ApiAssetDefinitionReadRequest {
  return createApiRequest(API_ASSET_DEFINITION_READ_OPERATION, normalizeDefinitionReadPayload(payload), options);
}

export function createApiAssetDefinitionVersionReadRequest(
  payload: Required<Pick<ApiAssetDefinitionReadRequestPayload, "definitionId" | "version">> & Omit<ApiAssetDefinitionReadRequestPayload, "definitionId" | "version">,
  options?: { requestId?: string; correlationId?: string },
): ApiAssetDefinitionVersionReadRequest {
  return createApiRequest(API_ASSET_DEFINITION_VERSION_READ_OPERATION, normalizeDefinitionReadPayload(payload) as ApiAssetDefinitionVersionReadRequest["payload"], options);
}

export function createApiAssetResourceBackedViewsListRequest(
  payload: ApiAssetResourceBackedViewsListRequestPayload = {},
  options?: { requestId?: string; correlationId?: string },
): ApiAssetResourceBackedViewsListRequest {
  return createApiRequest(API_ASSET_RESOURCE_BACKED_VIEWS_LIST_OPERATION, payload, options);
}

export function createApiAssetResourceBackedViewReadRequest(
  payload: ApiAssetResourceBackedViewReadRequestPayload,
  options?: { requestId?: string; correlationId?: string },
): ApiAssetResourceBackedViewReadRequest {
  return createApiRequest(API_ASSET_RESOURCE_BACKED_VIEW_READ_OPERATION, { ...payload, viewId: payload.viewId.trim() }, options);
}

export function createApiAssetRegisterResourceBackedViewRequest(
  payload: RegisterResourceBackedViewCommand,
  options?: { requestId?: string; correlationId?: string },
): ApiAssetRegisterResourceBackedViewRequest {
  return createApiRequest(API_ASSET_REGISTER_RESOURCE_BACKED_VIEW_OPERATION, payload, options);
}

export function createApiAssetFinalizeGeneratedOutputRequest(
  payload: FinalizeGeneratedOutputCommand,
  options?: { requestId?: string; correlationId?: string },
): ApiAssetFinalizeGeneratedOutputRequest {
  return createApiRequest(API_ASSET_FINALIZE_GENERATED_OUTPUT_OPERATION, payload, options);
}

export function createApiAssetImportExternalRepositoryObjectRequest(
  payload: ImportExternalRepositoryObjectCommand,
  options?: { requestId?: string; correlationId?: string },
): ApiAssetImportExternalRepositoryObjectRequest {
  return createApiRequest(API_ASSET_IMPORT_EXTERNAL_REPOSITORY_OBJECT_OPERATION, payload, options);
}

export function createApiAssetLocalizeExternalRepositoryObjectRequest(
  payload: LocalizeExternalRepositoryObjectCommand,
  options?: { requestId?: string; correlationId?: string },
): ApiAssetLocalizeExternalRepositoryObjectRequest {
  return createApiRequest(API_ASSET_LOCALIZE_EXTERNAL_REPOSITORY_OBJECT_OPERATION, payload, options);
}

export function createApiAssetDefinitionsListSuccessResponse(
  value: AssetRegistryListResult<AssetDefinitionCard>,
  options?: { requestId?: string; correlationId?: string },
): ApiAssetDefinitionsListResponse {
  return createApiSuccessResponse(API_ASSET_DEFINITIONS_LIST_OPERATION, value, options);
}

export function createApiAssetDefinitionReadSuccessResponse(
  value: AssetDefinitionDetail,
  options?: { requestId?: string; correlationId?: string },
): ApiAssetDefinitionReadResponse {
  return createApiSuccessResponse(API_ASSET_DEFINITION_READ_OPERATION, value, options);
}

export function createApiAssetDefinitionVersionReadSuccessResponse(
  value: AssetDefinitionDetail,
  options?: { requestId?: string; correlationId?: string },
): ApiAssetDefinitionVersionReadResponse {
  return createApiSuccessResponse(API_ASSET_DEFINITION_VERSION_READ_OPERATION, value, options);
}

export function createApiAssetResourceBackedViewsListSuccessResponse(
  value: AssetRegistryListResult<AssetRegistryResourceBackedViewCard>,
  options?: { requestId?: string; correlationId?: string },
): ApiAssetResourceBackedViewsListResponse {
  return createApiSuccessResponse(API_ASSET_RESOURCE_BACKED_VIEWS_LIST_OPERATION, value, options);
}

export function createApiAssetResourceBackedViewReadSuccessResponse(
  value: AssetRegistryResourceBackedViewDetail,
  options?: { requestId?: string; correlationId?: string },
): ApiAssetResourceBackedViewReadResponse {
  return createApiSuccessResponse(API_ASSET_RESOURCE_BACKED_VIEW_READ_OPERATION, value, options);
}

export function createApiAssetMutationSuccessResponse<TOperation extends AssetMutationOperation>(
  operation: TOperation,
  value: AssetMutationResult,
  options?: { requestId?: string; correlationId?: string },
): ApiAssetMutationResponse<TOperation> {
  return createApiSuccessResponse(operation, value, options);
}

export function createApiAssetDefinitionsListFailureResponse(
  code: "validation" | "internal" | "not-found" | "unavailable",
  message: string,
  options?: { details?: Record<string, unknown>; requestId?: string; correlationId?: string },
): ApiAssetDefinitionsListResponse {
  return createApiFailureResponse(createApiError(API_ASSET_DEFINITIONS_LIST_OPERATION, code, message, options), options);
}

export function createApiAssetDefinitionReadFailureResponse(
  code: "validation" | "internal" | "not-found" | "unavailable",
  message: string,
  options?: { details?: Record<string, unknown>; requestId?: string; correlationId?: string },
): ApiAssetDefinitionReadResponse {
  return createApiFailureResponse(createApiError(API_ASSET_DEFINITION_READ_OPERATION, code, message, options), options);
}

export function createApiAssetDefinitionVersionReadFailureResponse(
  code: "validation" | "internal" | "not-found" | "unavailable",
  message: string,
  options?: { details?: Record<string, unknown>; requestId?: string; correlationId?: string },
): ApiAssetDefinitionVersionReadResponse {
  return createApiFailureResponse(createApiError(API_ASSET_DEFINITION_VERSION_READ_OPERATION, code, message, options), options);
}

export function createApiAssetResourceBackedViewsListFailureResponse(
  code: "validation" | "internal" | "not-found" | "unavailable",
  message: string,
  options?: { details?: Record<string, unknown>; requestId?: string; correlationId?: string },
): ApiAssetResourceBackedViewsListResponse {
  return createApiFailureResponse(createApiError(API_ASSET_RESOURCE_BACKED_VIEWS_LIST_OPERATION, code, message, options), options);
}

export function createApiAssetResourceBackedViewReadFailureResponse(
  code: "validation" | "internal" | "not-found" | "unavailable",
  message: string,
  options?: { details?: Record<string, unknown>; requestId?: string; correlationId?: string },
): ApiAssetResourceBackedViewReadResponse {
  return createApiFailureResponse(createApiError(API_ASSET_RESOURCE_BACKED_VIEW_READ_OPERATION, code, message, options), options);
}

export function createApiAssetMutationFailureResponse<TOperation extends AssetMutationOperation>(
  operation: TOperation,
  code: "validation" | "internal" | "not-found" | "unavailable" | "forbidden" | "conflict",
  message: string,
  options?: {
    details?: Record<string, unknown> & { mutationFailureCode?: AssetMutationFailureCode };
    requestId?: string;
    correlationId?: string;
  },
): ApiAssetMutationResponse<TOperation> {
  return createApiFailureResponse(createApiError(operation, code, message, options), options);
}

export function apiAssetDefinitionReference(payload: Pick<ApiAssetDefinitionReadRequestPayload, "definitionId" | "version">): AssetReference {
  return {
    kind: "asset-definition",
    id: normalizeAssetId(payload.definitionId),
    ...(payload.version ? { version: normalizeAssetVersion(payload.version) } : {}),
  };
}

export function apiAssetDefinitionReadOptions(payload: Pick<ApiAssetDefinitionReadRequestPayload, "expand" | "includeValidation">): AssetRegistryReadOptions {
  const expand = new Set(payload.expand ?? []);
  return {
    includeValidation: payload.includeValidation,
    includeAiContext: expand.has("aiContext"),
    includeConfigurationSchema: expand.has("configurationSchema"),
    includePorts: expand.has("ports"),
    includeRequirements: expand.has("requirements"),
    includeMetadata: expand.has("metadata"),
  };
}

export function apiAssetResourceBackedViewReadOptions(payload: Pick<ApiAssetResourceBackedViewReadRequestPayload, "expand" | "includeValidation">): AssetRegistryReadOptions {
  const expand = new Set(payload.expand ?? []);
  return {
    includeValidation: payload.includeValidation || expand.has("validation"),
    includeMetadata: expand.has("metadata"),
    includeResourceBackings: expand.has("resourceBackings"),
  };
}

function normalizeDefinitionReadPayload<T extends ApiAssetDefinitionReadRequestPayload>(payload: T): T {
  return {
    ...payload,
    definitionId: normalizeAssetId(payload.definitionId),
    ...(payload.version ? { version: normalizeAssetVersion(payload.version) } : {}),
  };
}
