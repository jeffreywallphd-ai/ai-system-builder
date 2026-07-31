import type { AssetRegistryDefinitionReadPort } from "../../../../application/ports/asset";
import { sanitizeAssetViewValue } from "../../../../application/services/asset/asset-safe-metadata";
import {
  DESKTOP_ASSET_DEFINITIONS_LIST_REQUEST_CHANNEL,
  DESKTOP_ASSET_DEFINITIONS_LIST_RESPONSE_CHANNEL,
  DESKTOP_ASSET_DEFINITION_READ_REQUEST_CHANNEL,
  DESKTOP_ASSET_DEFINITION_READ_RESPONSE_CHANNEL,
  DESKTOP_ASSET_DEFINITION_VERSION_READ_REQUEST_CHANNEL,
  DESKTOP_ASSET_DEFINITION_VERSION_READ_RESPONSE_CHANNEL,
  DESKTOP_ASSET_RESOURCE_BACKED_VIEW_READ_REQUEST_CHANNEL,
  DESKTOP_ASSET_RESOURCE_BACKED_VIEW_READ_RESPONSE_CHANNEL,
  DESKTOP_ASSET_RESOURCE_BACKED_VIEWS_LIST_REQUEST_CHANNEL,
  DESKTOP_ASSET_RESOURCE_BACKED_VIEWS_LIST_RESPONSE_CHANNEL,
  createDesktopAssetDefinitionReadSuccessResponse,
  createDesktopAssetDefinitionVersionReadSuccessResponse,
  createDesktopAssetDefinitionsListSuccessResponse,
  createDesktopAssetResourceBackedViewReadSuccessResponse,
  createDesktopAssetResourceBackedViewsListSuccessResponse,
  createIpcError,
  createIpcFailureResponse,
  type DesktopAssetDefinitionReadRequest,
  type DesktopAssetDefinitionReadRequestPayload,
  type DesktopAssetDefinitionReadResponse,
  type DesktopAssetDefinitionVersionReadRequest,
  type DesktopAssetDefinitionVersionReadResponse,
  type DesktopAssetDefinitionsListRequest,
  type DesktopAssetDefinitionsListRequestPayload,
  type DesktopAssetDefinitionsListResponse,
  type DesktopAssetResourceBackedViewReadRequest,
  type DesktopAssetResourceBackedViewReadRequestPayload,
  type DesktopAssetResourceBackedViewReadResponse,
  type DesktopAssetResourceBackedViewsListRequest,
  type DesktopAssetResourceBackedViewsListRequestPayload,
  type DesktopAssetResourceBackedViewsListResponse,
} from "../../../../contracts/ipc";
import {
  parseAssetRegistryDefinitionListInput,
  parseAssetRegistryDefinitionReadInput,
  parseAssetRegistryResourceBackedViewListInput,
  parseAssetRegistryResourceBackedViewReadInput,
  toAssetRegistryDefinitionReference,
  toAssetRegistryFacadeListQuery,
  toAssetRegistryResourceBackedViewListQuery,
  toAssetRegistryResourceBackedViewReadOptions,
  toAssetRegistryReadOptions,
} from "../../asset-registry/assetRegistryReadInputMapper";
import type { IpcMainHandlePort } from "../ipcMainHandlePort";

export interface RegisterAssetRegistryIpcDependencies {
  readonly ipcMain: IpcMainHandlePort;
  readonly assetRegistryRead: AssetRegistryDefinitionReadPort;
}

export function createDesktopAssetResourceBackedViewsListIpcHandler(
  dependencies: Pick<RegisterAssetRegistryIpcDependencies, "assetRegistryRead">,
) {
  return async (
    _event: unknown,
    request: DesktopAssetResourceBackedViewsListRequest,
  ): Promise<DesktopAssetResourceBackedViewsListResponse> => {
    const context = requestContext(request);
    let query;
    try {
      query = toAssetRegistryResourceBackedViewListQuery(parseResourceBackedViewsListPayload(request.payload));
    } catch {
      return failure(DESKTOP_ASSET_RESOURCE_BACKED_VIEWS_LIST_RESPONSE_CHANNEL, "validation", "Invalid asset resource-backed views query.", context);
    }
    if (!dependencies.assetRegistryRead.listResourceBackedViewCards) {
      return failure(DESKTOP_ASSET_RESOURCE_BACKED_VIEWS_LIST_RESPONSE_CHANNEL, "unavailable", "Asset resource-backed views are unavailable.", context);
    }

    try {
      const result = await dependencies.assetRegistryRead.listResourceBackedViewCards(query);
      return createDesktopAssetResourceBackedViewsListSuccessResponse(sanitizeAssetViewValue(result), context);
    } catch (error) {
      return workspaceReadFailure(DESKTOP_ASSET_RESOURCE_BACKED_VIEWS_LIST_RESPONSE_CHANNEL, error, context, "Unable to read asset resource-backed views.");
    }
  };
}

export function createDesktopAssetResourceBackedViewReadIpcHandler(
  dependencies: Pick<RegisterAssetRegistryIpcDependencies, "assetRegistryRead">,
) {
  return async (
    _event: unknown,
    request: DesktopAssetResourceBackedViewReadRequest,
  ): Promise<DesktopAssetResourceBackedViewReadResponse> => {
    const context = requestContext(request);
    let payload;
    try {
      payload = parseResourceBackedViewReadPayload(request.payload);
    } catch {
      return failure(DESKTOP_ASSET_RESOURCE_BACKED_VIEW_READ_RESPONSE_CHANNEL, "validation", "Invalid asset resource-backed view read request.", context);
    }
    if (!dependencies.assetRegistryRead.readResourceBackedViewDetail) {
      return failure(DESKTOP_ASSET_RESOURCE_BACKED_VIEW_READ_RESPONSE_CHANNEL, "unavailable", "Asset resource-backed views are unavailable.", context);
    }

    try {
      const detail = await dependencies.assetRegistryRead.readResourceBackedViewDetail(
        payload.viewId,
        toAssetRegistryResourceBackedViewReadOptions(payload),
      );
      if (!detail) {
        return failure(DESKTOP_ASSET_RESOURCE_BACKED_VIEW_READ_RESPONSE_CHANNEL, "not-found", "Asset resource-backed view was not found.", context);
      }
      return createDesktopAssetResourceBackedViewReadSuccessResponse(sanitizeAssetViewValue(detail), context);
    } catch (error) {
      return workspaceReadFailure(DESKTOP_ASSET_RESOURCE_BACKED_VIEW_READ_RESPONSE_CHANNEL, error, context, "Unable to read asset resource-backed view.");
    }
  };
}

export function createDesktopAssetDefinitionsListIpcHandler(
  dependencies: Pick<RegisterAssetRegistryIpcDependencies, "assetRegistryRead">,
) {
  return async (
    _event: unknown,
    request: DesktopAssetDefinitionsListRequest,
  ): Promise<DesktopAssetDefinitionsListResponse> => {
    const context = requestContext(request);
    let query;
    try {
      query = toAssetRegistryFacadeListQuery(parseListPayload(request.payload));
    } catch {
      return failure(DESKTOP_ASSET_DEFINITIONS_LIST_RESPONSE_CHANNEL, "validation", "Invalid asset definitions query.", context);
    }

    try {
      const result = await dependencies.assetRegistryRead.listDefinitionCards(query);
      return createDesktopAssetDefinitionsListSuccessResponse(sanitizeAssetViewValue(result), context);
    } catch (error) {
      return workspaceReadFailure(DESKTOP_ASSET_DEFINITIONS_LIST_RESPONSE_CHANNEL, error, context, "Unable to read asset definitions.");
    }
  };
}

export function createDesktopAssetDefinitionReadIpcHandler(
  dependencies: Pick<RegisterAssetRegistryIpcDependencies, "assetRegistryRead">,
) {
  return async (
    _event: unknown,
    request: DesktopAssetDefinitionReadRequest,
  ): Promise<DesktopAssetDefinitionReadResponse> => {
    const context = requestContext(request);
    let payload;
    try {
      payload = parseDefinitionReadPayload(request.payload, false);
    } catch {
      return failure(DESKTOP_ASSET_DEFINITION_READ_RESPONSE_CHANNEL, "validation", "Invalid asset definition read request.", context);
    }

    try {
      const detail = await dependencies.assetRegistryRead.readDefinitionDetail(
        toAssetRegistryDefinitionReference(payload),
        toAssetRegistryReadOptions(payload),
      );
      if (!detail) {
        return failure(DESKTOP_ASSET_DEFINITION_READ_RESPONSE_CHANNEL, "not-found", "Asset definition was not found.", context);
      }
      return createDesktopAssetDefinitionReadSuccessResponse(sanitizeAssetViewValue(detail), context);
    } catch (error) {
      return workspaceReadFailure(DESKTOP_ASSET_DEFINITION_READ_RESPONSE_CHANNEL, error, context, "Unable to read asset definition.");
    }
  };
}

export function createDesktopAssetDefinitionVersionReadIpcHandler(
  dependencies: Pick<RegisterAssetRegistryIpcDependencies, "assetRegistryRead">,
) {
  return async (
    _event: unknown,
    request: DesktopAssetDefinitionVersionReadRequest,
  ): Promise<DesktopAssetDefinitionVersionReadResponse> => {
    const context = requestContext(request);
    let payload;
    try {
      payload = parseDefinitionReadPayload(request.payload, true);
    } catch {
      return failure(DESKTOP_ASSET_DEFINITION_VERSION_READ_RESPONSE_CHANNEL, "validation", "Invalid asset definition version read request.", context);
    }

    try {
      const detail = await dependencies.assetRegistryRead.readDefinitionDetail(
        toAssetRegistryDefinitionReference(payload),
        toAssetRegistryReadOptions(payload),
      );
      if (!detail) {
        return failure(DESKTOP_ASSET_DEFINITION_VERSION_READ_RESPONSE_CHANNEL, "not-found", "Asset definition version was not found.", context);
      }
      return createDesktopAssetDefinitionVersionReadSuccessResponse(sanitizeAssetViewValue(detail), context);
    } catch (error) {
      return workspaceReadFailure(DESKTOP_ASSET_DEFINITION_VERSION_READ_RESPONSE_CHANNEL, error, context, "Unable to read asset definition version.");
    }
  };
}

export function registerAssetRegistryIpc(dependencies: RegisterAssetRegistryIpcDependencies): void {
  dependencies.ipcMain.handle(
    DESKTOP_ASSET_DEFINITIONS_LIST_REQUEST_CHANNEL.value,
    createDesktopAssetDefinitionsListIpcHandler({ assetRegistryRead: dependencies.assetRegistryRead }),
  );
  dependencies.ipcMain.handle(
    DESKTOP_ASSET_DEFINITION_READ_REQUEST_CHANNEL.value,
    createDesktopAssetDefinitionReadIpcHandler({ assetRegistryRead: dependencies.assetRegistryRead }),
  );
  dependencies.ipcMain.handle(
    DESKTOP_ASSET_DEFINITION_VERSION_READ_REQUEST_CHANNEL.value,
    createDesktopAssetDefinitionVersionReadIpcHandler({ assetRegistryRead: dependencies.assetRegistryRead }),
  );
  dependencies.ipcMain.handle(
    DESKTOP_ASSET_RESOURCE_BACKED_VIEWS_LIST_REQUEST_CHANNEL.value,
    createDesktopAssetResourceBackedViewsListIpcHandler({ assetRegistryRead: dependencies.assetRegistryRead }),
  );
  dependencies.ipcMain.handle(
    DESKTOP_ASSET_RESOURCE_BACKED_VIEW_READ_REQUEST_CHANNEL.value,
    createDesktopAssetResourceBackedViewReadIpcHandler({ assetRegistryRead: dependencies.assetRegistryRead }),
  );
}

function requestContext(request: { requestId?: string; correlationId?: string }) {
  return {
    requestId: request.requestId,
    correlationId: request.correlationId,
  };
}

function failure<TResponseChannel extends typeof DESKTOP_ASSET_DEFINITIONS_LIST_RESPONSE_CHANNEL | typeof DESKTOP_ASSET_DEFINITION_READ_RESPONSE_CHANNEL | typeof DESKTOP_ASSET_DEFINITION_VERSION_READ_RESPONSE_CHANNEL | typeof DESKTOP_ASSET_RESOURCE_BACKED_VIEWS_LIST_RESPONSE_CHANNEL | typeof DESKTOP_ASSET_RESOURCE_BACKED_VIEW_READ_RESPONSE_CHANNEL>(
  channel: TResponseChannel,
  code: "validation" | "internal" | "not-found" | "unavailable",
  message: string,
  context: { requestId?: string; correlationId?: string },
  details?: Record<string, unknown>,
): any {
  return createIpcFailureResponse(createIpcError(channel, code, message, {
    details,
    requestId: context.requestId,
    correlationId: context.correlationId,
  }));
}

function workspaceReadFailure<TResponseChannel extends typeof DESKTOP_ASSET_DEFINITIONS_LIST_RESPONSE_CHANNEL | typeof DESKTOP_ASSET_DEFINITION_READ_RESPONSE_CHANNEL | typeof DESKTOP_ASSET_DEFINITION_VERSION_READ_RESPONSE_CHANNEL | typeof DESKTOP_ASSET_RESOURCE_BACKED_VIEWS_LIST_RESPONSE_CHANNEL | typeof DESKTOP_ASSET_RESOURCE_BACKED_VIEW_READ_RESPONSE_CHANNEL>(
  channel: TResponseChannel,
  error: unknown,
  context: { requestId?: string; correlationId?: string },
  fallback: string,
): any {
  return failure(channel, workspaceReadErrorCode(error), workspaceReadErrorMessage(error, fallback), context);
}

function workspaceReadErrorCode(error: unknown): "validation" | "internal" | "not-found" | "unavailable" {
  const code = typeof error === "object" && error && "code" in error ? String((error as { code?: unknown }).code) : "";
  if (code === "workspace-required" || code === "workspace-invalid") return "validation";
  if (code === "workspace-not-found" || code === "workspace-asset-not-in-effective-view") return "not-found";
  if (code === "workspace-unavailable" || code === "workspace-resource-backed-view-deferred" || code === "workspace-system-pack-activation-unavailable") return "unavailable";
  return "internal";
}

function workspaceReadErrorMessage(error: unknown, fallback: string): string {
  const code = typeof error === "object" && error && "code" in error ? String((error as { code?: unknown }).code) : "";
  return code.startsWith("workspace-") && error instanceof Error && error.message ? error.message : fallback;
}

function parseListPayload(payload: unknown): DesktopAssetDefinitionsListRequestPayload {
  const record = requireRecord(payload);
  return {
    ...parseAssetRegistryDefinitionListInput(record, "ipc-payload"),
    boundary: parseBoundary(record.boundary),
  };
}

function parseDefinitionReadPayload(payload: unknown, requireVersion: boolean): DesktopAssetDefinitionReadRequestPayload {
  const record = requireRecord(payload);
  return {
    ...parseAssetRegistryDefinitionReadInput(record, "ipc-payload", { requireVersion }),
    boundary: parseBoundary(record.boundary),
  };
}

function parseResourceBackedViewsListPayload(payload: unknown): DesktopAssetResourceBackedViewsListRequestPayload {
  const record = requireRecord(payload);
  return {
    ...parseAssetRegistryResourceBackedViewListInput(record, "ipc-payload"),
    boundary: parseBoundary(record.boundary),
  };
}

function parseResourceBackedViewReadPayload(payload: unknown): DesktopAssetResourceBackedViewReadRequestPayload {
  const record = requireRecord(payload);
  return {
    ...parseAssetRegistryResourceBackedViewReadInput(record, "ipc-payload"),
    boundary: parseBoundary(record.boundary),
  };
}

function requireRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("payload must be an object");
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, fieldName: string): string {
  if (typeof value !== "string") throw new Error(`${fieldName} must be a string`);
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${fieldName} must be non-empty`);
  return trimmed;
}

function parseBoundary(value: unknown): DesktopAssetDefinitionsListRequestPayload["boundary"] {
  const record = requireRecord(value);
  if (record.host !== "desktop") throw new Error("boundary.host must be desktop");
  return {
    host: "desktop",
    source: requiredString(record.source, "boundary.source"),
  };
}
