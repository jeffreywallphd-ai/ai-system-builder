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
import { createIpcChannel, type IpcChannel, type IpcChannelValue } from "./ipc-channel";
import { createIpcRequest, type IpcRequest } from "./ipc-request";
import { createIpcSuccessResponse, type IpcResponse } from "./ipc-response";

export const DESKTOP_ASSET_DEFINITIONS_LIST_OPERATION = createTransportOperation("asset", "definitions-list");
export const DESKTOP_ASSET_DEFINITION_READ_OPERATION = createTransportOperation("asset", "definition-read");
export const DESKTOP_ASSET_DEFINITION_VERSION_READ_OPERATION = createTransportOperation("asset", "definition-version-read");
export const DESKTOP_ASSET_RESOURCE_BACKED_VIEWS_LIST_OPERATION = createTransportOperation("asset", "resource-backed-views-list");
export const DESKTOP_ASSET_RESOURCE_BACKED_VIEW_READ_OPERATION = createTransportOperation("asset", "resource-backed-view-read");
export const DESKTOP_ASSET_REGISTER_RESOURCE_BACKED_VIEW_OPERATION =
  createTransportOperation("asset", "register-resource-backed-view") as "asset.register-resource-backed-view";
export const DESKTOP_ASSET_FINALIZE_GENERATED_OUTPUT_OPERATION =
  createTransportOperation("asset", "finalize-generated-output") as "asset.finalize-generated-output";
export const DESKTOP_ASSET_IMPORT_EXTERNAL_REPOSITORY_OBJECT_OPERATION =
  createTransportOperation("asset", "import-external-repository-object") as "asset.import-external-repository-object";
export const DESKTOP_ASSET_LOCALIZE_EXTERNAL_REPOSITORY_OBJECT_OPERATION =
  createTransportOperation("asset", "localize-external-repository-object") as "asset.localize-external-repository-object";

export const DESKTOP_ASSET_DEFINITIONS_LIST_REQUEST_CHANNEL = createIpcChannel(DESKTOP_ASSET_DEFINITIONS_LIST_OPERATION, "request");
export const DESKTOP_ASSET_DEFINITIONS_LIST_RESPONSE_CHANNEL = createIpcChannel(DESKTOP_ASSET_DEFINITIONS_LIST_OPERATION, "response");
export const DESKTOP_ASSET_DEFINITION_READ_REQUEST_CHANNEL = createIpcChannel(DESKTOP_ASSET_DEFINITION_READ_OPERATION, "request");
export const DESKTOP_ASSET_DEFINITION_READ_RESPONSE_CHANNEL = createIpcChannel(DESKTOP_ASSET_DEFINITION_READ_OPERATION, "response");
export const DESKTOP_ASSET_DEFINITION_VERSION_READ_REQUEST_CHANNEL = createIpcChannel(DESKTOP_ASSET_DEFINITION_VERSION_READ_OPERATION, "request");
export const DESKTOP_ASSET_DEFINITION_VERSION_READ_RESPONSE_CHANNEL = createIpcChannel(DESKTOP_ASSET_DEFINITION_VERSION_READ_OPERATION, "response");
export const DESKTOP_ASSET_RESOURCE_BACKED_VIEWS_LIST_REQUEST_CHANNEL = createIpcChannel(DESKTOP_ASSET_RESOURCE_BACKED_VIEWS_LIST_OPERATION, "request");
export const DESKTOP_ASSET_RESOURCE_BACKED_VIEWS_LIST_RESPONSE_CHANNEL = createIpcChannel(DESKTOP_ASSET_RESOURCE_BACKED_VIEWS_LIST_OPERATION, "response");
export const DESKTOP_ASSET_RESOURCE_BACKED_VIEW_READ_REQUEST_CHANNEL = createIpcChannel(DESKTOP_ASSET_RESOURCE_BACKED_VIEW_READ_OPERATION, "request");
export const DESKTOP_ASSET_RESOURCE_BACKED_VIEW_READ_RESPONSE_CHANNEL = createIpcChannel(DESKTOP_ASSET_RESOURCE_BACKED_VIEW_READ_OPERATION, "response");
export const DESKTOP_ASSET_REGISTER_RESOURCE_BACKED_VIEW_REQUEST_CHANNEL = createIpcChannel(DESKTOP_ASSET_REGISTER_RESOURCE_BACKED_VIEW_OPERATION, "request");
export const DESKTOP_ASSET_REGISTER_RESOURCE_BACKED_VIEW_RESPONSE_CHANNEL = createIpcChannel(DESKTOP_ASSET_REGISTER_RESOURCE_BACKED_VIEW_OPERATION, "response");
export const DESKTOP_ASSET_FINALIZE_GENERATED_OUTPUT_REQUEST_CHANNEL = createIpcChannel(DESKTOP_ASSET_FINALIZE_GENERATED_OUTPUT_OPERATION, "request");
export const DESKTOP_ASSET_FINALIZE_GENERATED_OUTPUT_RESPONSE_CHANNEL = createIpcChannel(DESKTOP_ASSET_FINALIZE_GENERATED_OUTPUT_OPERATION, "response");
export const DESKTOP_ASSET_IMPORT_EXTERNAL_REPOSITORY_OBJECT_REQUEST_CHANNEL = createIpcChannel(DESKTOP_ASSET_IMPORT_EXTERNAL_REPOSITORY_OBJECT_OPERATION, "request");
export const DESKTOP_ASSET_IMPORT_EXTERNAL_REPOSITORY_OBJECT_RESPONSE_CHANNEL = createIpcChannel(DESKTOP_ASSET_IMPORT_EXTERNAL_REPOSITORY_OBJECT_OPERATION, "response");
export const DESKTOP_ASSET_LOCALIZE_EXTERNAL_REPOSITORY_OBJECT_REQUEST_CHANNEL = createIpcChannel(DESKTOP_ASSET_LOCALIZE_EXTERNAL_REPOSITORY_OBJECT_OPERATION, "request");
export const DESKTOP_ASSET_LOCALIZE_EXTERNAL_REPOSITORY_OBJECT_RESPONSE_CHANNEL = createIpcChannel(DESKTOP_ASSET_LOCALIZE_EXTERNAL_REPOSITORY_OBJECT_OPERATION, "response");

export type DesktopAssetBuiltInFilter = "all" | "built-in" | "custom";

export interface DesktopAssetRegistryBoundaryContext {
  readonly host: "desktop";
  readonly source: string;
}

export interface DesktopAssetDefinitionsListRequestPayload {
  readonly searchText?: string;
  readonly assetTypes?: readonly AssetType[];
  readonly assetFamilies?: readonly AssetFamily[];
  readonly lifecycleStatuses?: readonly AssetLifecycleStatus[];
  readonly builtIn?: DesktopAssetBuiltInFilter;
  readonly limit?: number;
  readonly cursor?: string;
  readonly includeMetadata?: boolean;
  readonly workspaceId?: string;
  readonly boundary: DesktopAssetRegistryBoundaryContext;
}

export interface DesktopAssetResourceBackedViewsListRequestPayload {
  readonly searchText?: string;
  readonly assetTypes?: readonly AssetType[];
  readonly assetFamilies?: readonly AssetFamily[];
  readonly lifecycleStatuses?: readonly AssetLifecycleStatus[];
  readonly viewKinds?: readonly AssetResourceBackedViewKind[];
  readonly limit?: number;
  readonly cursor?: string;
  readonly includeMetadata?: boolean;
  readonly workspaceId?: string;
  readonly boundary: DesktopAssetRegistryBoundaryContext;
}

export type DesktopAssetDefinitionExpansion =
  | "aiContext"
  | "configurationSchema"
  | "ports"
  | "requirements"
  | "provenance"
  | "metadata";

export type DesktopAssetResourceBackedViewExpansion =
  | "metadata"
  | "resourceBackings"
  | "validation";

export interface DesktopAssetDefinitionReadRequestPayload {
  readonly definitionId: string;
  readonly version?: string;
  readonly expand?: readonly DesktopAssetDefinitionExpansion[];
  readonly includeValidation?: boolean;
  readonly workspaceId?: string;
  readonly boundary: DesktopAssetRegistryBoundaryContext;
}

export interface DesktopAssetResourceBackedViewReadRequestPayload {
  readonly viewId: string;
  readonly expand?: readonly DesktopAssetResourceBackedViewExpansion[];
  readonly includeValidation?: boolean;
  readonly workspaceId?: string;
  readonly boundary: DesktopAssetRegistryBoundaryContext;
}

export type DesktopAssetDefinitionsListRequest = IpcRequest<
  DesktopAssetDefinitionsListRequestPayload,
  typeof DESKTOP_ASSET_DEFINITIONS_LIST_OPERATION,
  Record<string, never>,
  typeof DESKTOP_ASSET_DEFINITIONS_LIST_REQUEST_CHANNEL.value
>;

export type DesktopAssetDefinitionReadRequest = IpcRequest<
  DesktopAssetDefinitionReadRequestPayload,
  typeof DESKTOP_ASSET_DEFINITION_READ_OPERATION,
  Record<string, never>,
  typeof DESKTOP_ASSET_DEFINITION_READ_REQUEST_CHANNEL.value
>;

export type DesktopAssetDefinitionVersionReadRequest = IpcRequest<
  Required<Pick<DesktopAssetDefinitionReadRequestPayload, "definitionId" | "version">> & Omit<DesktopAssetDefinitionReadRequestPayload, "definitionId" | "version">,
  typeof DESKTOP_ASSET_DEFINITION_VERSION_READ_OPERATION,
  Record<string, never>,
  typeof DESKTOP_ASSET_DEFINITION_VERSION_READ_REQUEST_CHANNEL.value
>;

export type DesktopAssetResourceBackedViewsListRequest = IpcRequest<
  DesktopAssetResourceBackedViewsListRequestPayload,
  typeof DESKTOP_ASSET_RESOURCE_BACKED_VIEWS_LIST_OPERATION,
  Record<string, never>,
  typeof DESKTOP_ASSET_RESOURCE_BACKED_VIEWS_LIST_REQUEST_CHANNEL.value
>;

export type DesktopAssetResourceBackedViewReadRequest = IpcRequest<
  DesktopAssetResourceBackedViewReadRequestPayload,
  typeof DESKTOP_ASSET_RESOURCE_BACKED_VIEW_READ_OPERATION,
  Record<string, never>,
  typeof DESKTOP_ASSET_RESOURCE_BACKED_VIEW_READ_REQUEST_CHANNEL.value
>;

export type DesktopAssetRegisterResourceBackedViewRequest = IpcRequest<
  RegisterResourceBackedViewCommand,
  typeof DESKTOP_ASSET_REGISTER_RESOURCE_BACKED_VIEW_OPERATION,
  Record<string, never>,
  typeof DESKTOP_ASSET_REGISTER_RESOURCE_BACKED_VIEW_REQUEST_CHANNEL.value
>;

export type DesktopAssetFinalizeGeneratedOutputRequest = IpcRequest<
  FinalizeGeneratedOutputCommand,
  typeof DESKTOP_ASSET_FINALIZE_GENERATED_OUTPUT_OPERATION,
  Record<string, never>,
  typeof DESKTOP_ASSET_FINALIZE_GENERATED_OUTPUT_REQUEST_CHANNEL.value
>;

export type DesktopAssetImportExternalRepositoryObjectRequest = IpcRequest<
  ImportExternalRepositoryObjectCommand,
  typeof DESKTOP_ASSET_IMPORT_EXTERNAL_REPOSITORY_OBJECT_OPERATION,
  Record<string, never>,
  typeof DESKTOP_ASSET_IMPORT_EXTERNAL_REPOSITORY_OBJECT_REQUEST_CHANNEL.value
>;

export type DesktopAssetLocalizeExternalRepositoryObjectRequest = IpcRequest<
  LocalizeExternalRepositoryObjectCommand,
  typeof DESKTOP_ASSET_LOCALIZE_EXTERNAL_REPOSITORY_OBJECT_OPERATION,
  Record<string, never>,
  typeof DESKTOP_ASSET_LOCALIZE_EXTERNAL_REPOSITORY_OBJECT_REQUEST_CHANNEL.value
>;

export type DesktopAssetDefinitionsListResponse = IpcResponse<
  AssetRegistryListResult<AssetDefinitionCard>,
  Record<string, unknown>,
  typeof DESKTOP_ASSET_DEFINITIONS_LIST_OPERATION,
  Record<string, never>,
  typeof DESKTOP_ASSET_DEFINITIONS_LIST_RESPONSE_CHANNEL.value
>;

export type DesktopAssetDefinitionReadResponse = IpcResponse<
  AssetDefinitionDetail,
  Record<string, unknown>,
  typeof DESKTOP_ASSET_DEFINITION_READ_OPERATION,
  Record<string, never>,
  typeof DESKTOP_ASSET_DEFINITION_READ_RESPONSE_CHANNEL.value
>;

export type DesktopAssetDefinitionVersionReadResponse = IpcResponse<
  AssetDefinitionDetail,
  Record<string, unknown>,
  typeof DESKTOP_ASSET_DEFINITION_VERSION_READ_OPERATION,
  Record<string, never>,
  typeof DESKTOP_ASSET_DEFINITION_VERSION_READ_RESPONSE_CHANNEL.value
>;

export type DesktopAssetResourceBackedViewsListResponse = IpcResponse<
  AssetRegistryListResult<AssetRegistryResourceBackedViewCard>,
  Record<string, unknown>,
  typeof DESKTOP_ASSET_RESOURCE_BACKED_VIEWS_LIST_OPERATION,
  Record<string, never>,
  typeof DESKTOP_ASSET_RESOURCE_BACKED_VIEWS_LIST_RESPONSE_CHANNEL.value
>;

export type DesktopAssetResourceBackedViewReadResponse = IpcResponse<
  AssetRegistryResourceBackedViewDetail,
  Record<string, unknown>,
  typeof DESKTOP_ASSET_RESOURCE_BACKED_VIEW_READ_OPERATION,
  Record<string, never>,
  typeof DESKTOP_ASSET_RESOURCE_BACKED_VIEW_READ_RESPONSE_CHANNEL.value
>;

export type DesktopAssetMutationResponse<
  TOperation extends AssetMutationOperation = AssetMutationOperation,
  TChannel extends IpcChannelValue<TOperation, "response"> = IpcChannelValue<TOperation, "response">,
> = IpcResponse<
  AssetMutationResult,
  Record<string, unknown> & { mutationFailureCode?: AssetMutationFailureCode },
  TOperation,
  Record<string, never>,
  TChannel
>;

export type DesktopAssetRegisterResourceBackedViewResponse = DesktopAssetMutationResponse<
  typeof DESKTOP_ASSET_REGISTER_RESOURCE_BACKED_VIEW_OPERATION,
  typeof DESKTOP_ASSET_REGISTER_RESOURCE_BACKED_VIEW_RESPONSE_CHANNEL.value
>;
export type DesktopAssetFinalizeGeneratedOutputResponse = DesktopAssetMutationResponse<
  typeof DESKTOP_ASSET_FINALIZE_GENERATED_OUTPUT_OPERATION,
  typeof DESKTOP_ASSET_FINALIZE_GENERATED_OUTPUT_RESPONSE_CHANNEL.value
>;
export type DesktopAssetImportExternalRepositoryObjectResponse = DesktopAssetMutationResponse<
  typeof DESKTOP_ASSET_IMPORT_EXTERNAL_REPOSITORY_OBJECT_OPERATION,
  typeof DESKTOP_ASSET_IMPORT_EXTERNAL_REPOSITORY_OBJECT_RESPONSE_CHANNEL.value
>;
export type DesktopAssetLocalizeExternalRepositoryObjectResponse = DesktopAssetMutationResponse<
  typeof DESKTOP_ASSET_LOCALIZE_EXTERNAL_REPOSITORY_OBJECT_OPERATION,
  typeof DESKTOP_ASSET_LOCALIZE_EXTERNAL_REPOSITORY_OBJECT_RESPONSE_CHANNEL.value
>;

function normalizeRequiredTextField(value: string, fieldName: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new Error(`${fieldName} must be a non-empty, trimmed string.`);
  }
  return normalized;
}

function normalizeBoundary(boundary: DesktopAssetRegistryBoundaryContext): DesktopAssetRegistryBoundaryContext {
  return {
    host: "desktop",
    source: normalizeRequiredTextField(boundary.source, "boundary.source"),
  };
}

function normalizeDefinitionReadPayload<T extends DesktopAssetDefinitionReadRequestPayload>(payload: T): T {
  return {
    ...payload,
    definitionId: normalizeAssetId(payload.definitionId),
    ...(payload.version ? { version: normalizeAssetVersion(payload.version) } : {}),
    boundary: normalizeBoundary(payload.boundary),
  };
}

export function createDesktopAssetDefinitionsListRequest(
  payload: DesktopAssetDefinitionsListRequestPayload,
  options?: { requestId?: string; correlationId?: string },
): DesktopAssetDefinitionsListRequest {
  return createIpcRequest(
    DESKTOP_ASSET_DEFINITIONS_LIST_REQUEST_CHANNEL,
    { ...payload, boundary: normalizeBoundary(payload.boundary) },
    options,
  );
}

export function createDesktopAssetResourceBackedViewsListRequest(
  payload: DesktopAssetResourceBackedViewsListRequestPayload,
  options?: { requestId?: string; correlationId?: string },
): DesktopAssetResourceBackedViewsListRequest {
  return createIpcRequest(
    DESKTOP_ASSET_RESOURCE_BACKED_VIEWS_LIST_REQUEST_CHANNEL,
    { ...payload, boundary: normalizeBoundary(payload.boundary) },
    options,
  );
}

export function createDesktopAssetDefinitionReadRequest(
  payload: DesktopAssetDefinitionReadRequestPayload,
  options?: { requestId?: string; correlationId?: string },
): DesktopAssetDefinitionReadRequest {
  return createIpcRequest(
    DESKTOP_ASSET_DEFINITION_READ_REQUEST_CHANNEL,
    normalizeDefinitionReadPayload(payload),
    options,
  );
}

export function createDesktopAssetDefinitionVersionReadRequest(
  payload: Required<Pick<DesktopAssetDefinitionReadRequestPayload, "definitionId" | "version">> & Omit<DesktopAssetDefinitionReadRequestPayload, "definitionId" | "version">,
  options?: { requestId?: string; correlationId?: string },
): DesktopAssetDefinitionVersionReadRequest {
  return createIpcRequest(
    DESKTOP_ASSET_DEFINITION_VERSION_READ_REQUEST_CHANNEL,
    normalizeDefinitionReadPayload(payload) as DesktopAssetDefinitionVersionReadRequest["payload"],
    options,
  );
}

export function createDesktopAssetResourceBackedViewReadRequest(
  payload: DesktopAssetResourceBackedViewReadRequestPayload,
  options?: { requestId?: string; correlationId?: string },
): DesktopAssetResourceBackedViewReadRequest {
  return createIpcRequest(
    DESKTOP_ASSET_RESOURCE_BACKED_VIEW_READ_REQUEST_CHANNEL,
    {
      ...payload,
      viewId: normalizeRequiredTextField(payload.viewId, "viewId"),
      boundary: normalizeBoundary(payload.boundary),
    },
    options,
  );
}

export function createDesktopAssetRegisterResourceBackedViewRequest(
  payload: RegisterResourceBackedViewCommand,
  options?: { requestId?: string; correlationId?: string },
): DesktopAssetRegisterResourceBackedViewRequest {
  return createIpcRequest(DESKTOP_ASSET_REGISTER_RESOURCE_BACKED_VIEW_REQUEST_CHANNEL, payload, options);
}

export function createDesktopAssetFinalizeGeneratedOutputRequest(
  payload: FinalizeGeneratedOutputCommand,
  options?: { requestId?: string; correlationId?: string },
): DesktopAssetFinalizeGeneratedOutputRequest {
  return createIpcRequest(DESKTOP_ASSET_FINALIZE_GENERATED_OUTPUT_REQUEST_CHANNEL, payload, options);
}

export function createDesktopAssetImportExternalRepositoryObjectRequest(
  payload: ImportExternalRepositoryObjectCommand,
  options?: { requestId?: string; correlationId?: string },
): DesktopAssetImportExternalRepositoryObjectRequest {
  return createIpcRequest(DESKTOP_ASSET_IMPORT_EXTERNAL_REPOSITORY_OBJECT_REQUEST_CHANNEL, payload, options);
}

export function createDesktopAssetLocalizeExternalRepositoryObjectRequest(
  payload: LocalizeExternalRepositoryObjectCommand,
  options?: { requestId?: string; correlationId?: string },
): DesktopAssetLocalizeExternalRepositoryObjectRequest {
  return createIpcRequest(DESKTOP_ASSET_LOCALIZE_EXTERNAL_REPOSITORY_OBJECT_REQUEST_CHANNEL, payload, options);
}

export function createDesktopAssetDefinitionsListSuccessResponse(
  value: AssetRegistryListResult<AssetDefinitionCard>,
  options?: { requestId?: string; correlationId?: string },
): DesktopAssetDefinitionsListResponse {
  return createIpcSuccessResponse(DESKTOP_ASSET_DEFINITIONS_LIST_RESPONSE_CHANNEL, value, options);
}

export function createDesktopAssetDefinitionReadSuccessResponse(
  value: AssetDefinitionDetail,
  options?: { requestId?: string; correlationId?: string },
): DesktopAssetDefinitionReadResponse {
  return createIpcSuccessResponse(DESKTOP_ASSET_DEFINITION_READ_RESPONSE_CHANNEL, value, options);
}

export function createDesktopAssetDefinitionVersionReadSuccessResponse(
  value: AssetDefinitionDetail,
  options?: { requestId?: string; correlationId?: string },
): DesktopAssetDefinitionVersionReadResponse {
  return createIpcSuccessResponse(DESKTOP_ASSET_DEFINITION_VERSION_READ_RESPONSE_CHANNEL, value, options);
}

export function createDesktopAssetResourceBackedViewsListSuccessResponse(
  value: AssetRegistryListResult<AssetRegistryResourceBackedViewCard>,
  options?: { requestId?: string; correlationId?: string },
): DesktopAssetResourceBackedViewsListResponse {
  return createIpcSuccessResponse(DESKTOP_ASSET_RESOURCE_BACKED_VIEWS_LIST_RESPONSE_CHANNEL, value, options);
}

export function createDesktopAssetResourceBackedViewReadSuccessResponse(
  value: AssetRegistryResourceBackedViewDetail,
  options?: { requestId?: string; correlationId?: string },
): DesktopAssetResourceBackedViewReadResponse {
  return createIpcSuccessResponse(DESKTOP_ASSET_RESOURCE_BACKED_VIEW_READ_RESPONSE_CHANNEL, value, options);
}

export function createDesktopAssetMutationSuccessResponse<
  TOperation extends AssetMutationOperation,
  TChannel extends IpcChannelValue<TOperation, "response">,
>(
  channel: IpcChannel<TOperation, "response", TChannel>,
  value: AssetMutationResult,
  options?: { requestId?: string; correlationId?: string },
): DesktopAssetMutationResponse<TOperation, TChannel> {
  return createIpcSuccessResponse(channel, value, options);
}

export function desktopAssetDefinitionReference(payload: Pick<DesktopAssetDefinitionReadRequestPayload, "definitionId" | "version">): AssetReference {
  return {
    kind: "asset-definition",
    id: normalizeAssetId(payload.definitionId),
    ...(payload.version ? { version: normalizeAssetVersion(payload.version) } : {}),
  };
}

export function desktopAssetDefinitionReadOptions(payload: Pick<DesktopAssetDefinitionReadRequestPayload, "expand" | "includeValidation">): AssetRegistryReadOptions {
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

export function getDesktopAssetDefinitionsListChannel(
  kind: "request",
): IpcChannel<typeof DESKTOP_ASSET_DEFINITIONS_LIST_OPERATION, "request", IpcChannelValue<typeof DESKTOP_ASSET_DEFINITIONS_LIST_OPERATION, "request">>;
export function getDesktopAssetDefinitionsListChannel(
  kind: "response",
): IpcChannel<typeof DESKTOP_ASSET_DEFINITIONS_LIST_OPERATION, "response", IpcChannelValue<typeof DESKTOP_ASSET_DEFINITIONS_LIST_OPERATION, "response">>;
export function getDesktopAssetDefinitionsListChannel(kind: "request" | "response") {
  return kind === "request" ? DESKTOP_ASSET_DEFINITIONS_LIST_REQUEST_CHANNEL : DESKTOP_ASSET_DEFINITIONS_LIST_RESPONSE_CHANNEL;
}

export function getDesktopAssetDefinitionReadChannel(
  kind: "request",
): IpcChannel<typeof DESKTOP_ASSET_DEFINITION_READ_OPERATION, "request", IpcChannelValue<typeof DESKTOP_ASSET_DEFINITION_READ_OPERATION, "request">>;
export function getDesktopAssetDefinitionReadChannel(
  kind: "response",
): IpcChannel<typeof DESKTOP_ASSET_DEFINITION_READ_OPERATION, "response", IpcChannelValue<typeof DESKTOP_ASSET_DEFINITION_READ_OPERATION, "response">>;
export function getDesktopAssetDefinitionReadChannel(kind: "request" | "response") {
  return kind === "request" ? DESKTOP_ASSET_DEFINITION_READ_REQUEST_CHANNEL : DESKTOP_ASSET_DEFINITION_READ_RESPONSE_CHANNEL;
}

export function getDesktopAssetDefinitionVersionReadChannel(
  kind: "request",
): IpcChannel<typeof DESKTOP_ASSET_DEFINITION_VERSION_READ_OPERATION, "request", IpcChannelValue<typeof DESKTOP_ASSET_DEFINITION_VERSION_READ_OPERATION, "request">>;
export function getDesktopAssetDefinitionVersionReadChannel(
  kind: "response",
): IpcChannel<typeof DESKTOP_ASSET_DEFINITION_VERSION_READ_OPERATION, "response", IpcChannelValue<typeof DESKTOP_ASSET_DEFINITION_VERSION_READ_OPERATION, "response">>;
export function getDesktopAssetDefinitionVersionReadChannel(kind: "request" | "response") {
  return kind === "request" ? DESKTOP_ASSET_DEFINITION_VERSION_READ_REQUEST_CHANNEL : DESKTOP_ASSET_DEFINITION_VERSION_READ_RESPONSE_CHANNEL;
}

export function getDesktopAssetResourceBackedViewsListChannel(
  kind: "request",
): IpcChannel<typeof DESKTOP_ASSET_RESOURCE_BACKED_VIEWS_LIST_OPERATION, "request", IpcChannelValue<typeof DESKTOP_ASSET_RESOURCE_BACKED_VIEWS_LIST_OPERATION, "request">>;
export function getDesktopAssetResourceBackedViewsListChannel(
  kind: "response",
): IpcChannel<typeof DESKTOP_ASSET_RESOURCE_BACKED_VIEWS_LIST_OPERATION, "response", IpcChannelValue<typeof DESKTOP_ASSET_RESOURCE_BACKED_VIEWS_LIST_OPERATION, "response">>;
export function getDesktopAssetResourceBackedViewsListChannel(kind: "request" | "response") {
  return kind === "request" ? DESKTOP_ASSET_RESOURCE_BACKED_VIEWS_LIST_REQUEST_CHANNEL : DESKTOP_ASSET_RESOURCE_BACKED_VIEWS_LIST_RESPONSE_CHANNEL;
}

export function getDesktopAssetResourceBackedViewReadChannel(
  kind: "request",
): IpcChannel<typeof DESKTOP_ASSET_RESOURCE_BACKED_VIEW_READ_OPERATION, "request", IpcChannelValue<typeof DESKTOP_ASSET_RESOURCE_BACKED_VIEW_READ_OPERATION, "request">>;
export function getDesktopAssetResourceBackedViewReadChannel(
  kind: "response",
): IpcChannel<typeof DESKTOP_ASSET_RESOURCE_BACKED_VIEW_READ_OPERATION, "response", IpcChannelValue<typeof DESKTOP_ASSET_RESOURCE_BACKED_VIEW_READ_OPERATION, "response">>;
export function getDesktopAssetResourceBackedViewReadChannel(kind: "request" | "response") {
  return kind === "request" ? DESKTOP_ASSET_RESOURCE_BACKED_VIEW_READ_REQUEST_CHANNEL : DESKTOP_ASSET_RESOURCE_BACKED_VIEW_READ_RESPONSE_CHANNEL;
}
