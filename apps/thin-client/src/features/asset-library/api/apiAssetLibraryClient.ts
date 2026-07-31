import {
  type AssetLibraryClient,
  type AssetLibraryClientResult,
  type AssetLibraryDefinitionCard,
  type AssetLibraryDefinitionDetail,
  type AssetLibraryDefinitionExpansion,
  type AssetLibraryDetailOptions,
  type AssetLibraryListResult,
  type AssetLibraryQuery,
  type AssetLibraryResourceBackedViewCard,
  type AssetLibraryResourceBackedViewDetail,
  type AssetLibraryResourceBackedViewDetailOptions,
  type AssetLibraryResourceBackedViewExpansion,
  type AssetLibraryResourceBackedViewQuery,
} from "../../../../../../modules/ui/shared/asset-library";
import {
  mapAssetDefinitionDetail,
  mapAssetDefinitionListResult,
  mapAssetResourceBackedViewDetail,
  mapAssetResourceBackedViewListResult,
  mapTransportEnvelopeError,
  mapTransportEnvelopeSuccess,
} from "../../../../../../modules/ui/shared/asset-library/assetLibraryMappers";
import {
  mapAssetMutationTransportFailure,
  sanitizeAssetMutationResult,
} from "../../../../../../modules/ui/shared/asset-library/assetLibraryActions";
import type {
  AssetMutationResult,
  FinalizeGeneratedOutputCommand,
  ImportExternalRepositoryObjectCommand,
  LocalizeExternalRepositoryObjectCommand,
  RegisterResourceBackedViewCommand,
} from "../../../../../../modules/contracts/asset";
import { parseApiEnvelope } from "../../../security/apiErrorEnvelope";
import { secureFetch } from "../../../security/secureFetch";

export interface CreateApiAssetLibraryClientOptions {
  readonly apiBaseUrl?: string;
}

function createApiUrl(apiBaseUrl: string, suffix: string): string {
  return `${apiBaseUrl.trim().replace(/\/+$/, "") || "/api"}${suffix}`;
}

function appendCsv(query: URLSearchParams, key: string, values: readonly string[] | undefined): void {
  if (values && values.length > 0) query.set(key, values.join(","));
}

function appendBoolean(query: URLSearchParams, key: string, value: boolean | undefined): void {
  if (value !== undefined) query.set(key, value ? "true" : "false");
}

function queryStringForList(query: AssetLibraryQuery): string {
  const params = new URLSearchParams();
  if (query.searchText) params.set("q", query.searchText);
  appendCsv(params, "assetType", query.assetTypes);
  appendCsv(params, "assetFamily", query.assetFamilies);
  appendCsv(params, "lifecycleStatus", query.lifecycleStatuses);
  if (query.builtIn) params.set("builtIn", query.builtIn);
  if (query.limit !== undefined) params.set("limit", String(query.limit));
  if (query.cursor) params.set("cursor", query.cursor);
  if (query.workspaceId) params.set("workspaceId", query.workspaceId);
  const serialized = params.toString();
  return serialized ? `?${serialized}` : "";
}

function queryStringForResourceBackedList(query: AssetLibraryResourceBackedViewQuery): string {
  const params = new URLSearchParams();
  if (query.searchText) params.set("q", query.searchText);
  appendCsv(params, "assetType", query.assetTypes);
  appendCsv(params, "assetFamily", query.assetFamilies);
  appendCsv(params, "lifecycleStatus", query.lifecycleStatuses);
  appendCsv(params, "viewKind", query.viewKinds);
  if (query.limit !== undefined) params.set("limit", String(query.limit));
  if (query.cursor) params.set("cursor", query.cursor);
  if (query.workspaceId) params.set("workspaceId", query.workspaceId);
  const serialized = params.toString();
  return serialized ? `?${serialized}` : "";
}

function queryStringForDetail(options: AssetLibraryDetailOptions): string {
  const params = new URLSearchParams();
  appendCsv(params, "expand", options.expand as readonly AssetLibraryDefinitionExpansion[] | undefined);
  appendBoolean(params, "includeValidation", options.includeValidation);
  if (options.workspaceId) params.set("workspaceId", options.workspaceId);
  const serialized = params.toString();
  return serialized ? `?${serialized}` : "";
}

function queryStringForResourceBackedDetail(options: AssetLibraryResourceBackedViewDetailOptions): string {
  const params = new URLSearchParams();
  appendCsv(params, "expand", options.expand as readonly AssetLibraryResourceBackedViewExpansion[] | undefined);
  appendBoolean(params, "includeValidation", options.includeValidation);
  if (options.workspaceId) params.set("workspaceId", options.workspaceId);
  const serialized = params.toString();
  return serialized ? `?${serialized}` : "";
}

async function getJson(endpoint: string): Promise<{ status: number; envelope: unknown }> {
  const response = await secureFetch(endpoint, { method: "GET" });
  return {
    status: response.status,
    envelope: parseApiEnvelope(await response.json()),
  };
}

async function postJson(endpoint: string, body: unknown): Promise<{ status: number; envelope: unknown }> {
  const response = await secureFetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return {
    status: response.status,
    envelope: parseApiEnvelope(await response.json()),
  };
}

async function toClientResult<T>(
  endpoint: string,
  mapper: (payload: unknown) => T,
  fallbackMessage: string,
): Promise<AssetLibraryClientResult<T>> {
  try {
    const { status, envelope } = await getJson(endpoint);
    const success = mapTransportEnvelopeSuccess(envelope, mapper);
    if (success) return success;
    return { ok: false, error: mapTransportEnvelopeError(envelope, { status, fallbackMessage }) };
  } catch {
    return {
      ok: false,
      error: {
        code: "internal",
        message: fallbackMessage,
      },
    };
  }
}

async function toMutationClientResult(
  endpoint: string,
  command: RegisterResourceBackedViewCommand | FinalizeGeneratedOutputCommand | ImportExternalRepositoryObjectCommand | LocalizeExternalRepositoryObjectCommand,
): Promise<AssetLibraryClientResult<AssetMutationResult>> {
  try {
    const { envelope } = await postJson(endpoint, command);
    const success = mapTransportEnvelopeSuccess(envelope, sanitizeAssetMutationResult);
    if (success) return success;
    return { ok: true, value: mapAssetMutationTransportFailure(envelope, command.operation) };
  } catch {
    return {
      ok: false,
      error: {
        code: "internal",
        message: "Unable to complete this asset action.",
      },
    };
  }
}

export function createApiAssetLibraryClient(
  options: CreateApiAssetLibraryClientOptions = {},
): AssetLibraryClient {
  const apiBaseUrl = options.apiBaseUrl ?? "/api";

  return {
    async listAssetDefinitions(query = {}) {
      return toClientResult<AssetLibraryListResult<AssetLibraryDefinitionCard>>(
        createApiUrl(apiBaseUrl, `/assets/definitions${queryStringForList(query)}`),
        mapAssetDefinitionListResult,
        "Unable to read asset definitions.",
      );
    },

    async readAssetDefinition(input, detailOptions = {}) {
      return toClientResult<AssetLibraryDefinitionDetail>(
        createApiUrl(
          apiBaseUrl,
          `/assets/definitions/${encodeURIComponent(input.definitionId)}${queryStringForDetail(detailOptions)}`,
        ),
        mapAssetDefinitionDetail,
        "Unable to read asset definition.",
      );
    },

    async readAssetDefinitionVersion(input, detailOptions = {}) {
      return toClientResult<AssetLibraryDefinitionDetail>(
        createApiUrl(
          apiBaseUrl,
          `/assets/definitions/${encodeURIComponent(input.definitionId)}/versions/${encodeURIComponent(input.version)}${queryStringForDetail(detailOptions)}`,
        ),
        mapAssetDefinitionDetail,
        "Unable to read asset definition version.",
      );
    },

    async listAssetResourceBackedViews(query = {}) {
      return toClientResult<AssetLibraryListResult<AssetLibraryResourceBackedViewCard>>(
        createApiUrl(apiBaseUrl, `/assets/resource-backed-views${queryStringForResourceBackedList(query)}`),
        mapAssetResourceBackedViewListResult,
        "Unable to read asset resource-backed views.",
      );
    },

    async readAssetResourceBackedView(input, detailOptions = {}) {
      return toClientResult<AssetLibraryResourceBackedViewDetail>(
        createApiUrl(
          apiBaseUrl,
          `/assets/resource-backed-views/${encodeURIComponent(input.viewId)}${queryStringForResourceBackedDetail(detailOptions)}`,
        ),
        mapAssetResourceBackedViewDetail,
        "Unable to read asset resource-backed view.",
      );
    },

    async registerResourceBackedViewAsAsset(command) {
      return toMutationClientResult(createApiUrl(apiBaseUrl, "/assets/register-resource-backed-view"), command);
    },

    async finalizeGeneratedOutputAsAsset(command) {
      return toMutationClientResult(createApiUrl(apiBaseUrl, "/assets/finalize-generated-output"), command);
    },

    async importExternalRepositoryObjectAsAsset(command) {
      return toMutationClientResult(createApiUrl(apiBaseUrl, "/assets/import-external-repository-object"), command);
    },

    async localizeExternalRepositoryObjectAsAsset(command) {
      return toMutationClientResult(createApiUrl(apiBaseUrl, "/assets/localize-external-repository-object"), command);
    },
  };
}
