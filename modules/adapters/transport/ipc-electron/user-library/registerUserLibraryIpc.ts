import type { AssetRegistryDefinitionReadPort } from "../../../../application/ports/asset";
import type { UserLibraryAssetRepositoryPort, WorkspaceUserLibraryLinkRepositoryPort } from "../../../../application/ports/user-library";
import type { CopyUserLibraryAssetToWorkspaceUseCase, ImportWorkspaceAssetToWorkspaceUseCase, LinkUserLibraryAssetToWorkspaceUseCase, PromoteWorkspaceAssetToUserLibraryUseCase } from "../../../../application/use-cases/user-library";
import {
  DESKTOP_USER_LIBRARY_ASSET_LIST_REQUEST_CHANNEL,
  DESKTOP_USER_LIBRARY_ASSET_LIST_RESPONSE_CHANNEL,
  DESKTOP_USER_LIBRARY_ASSET_READ_REQUEST_CHANNEL,
  DESKTOP_USER_LIBRARY_ASSET_READ_RESPONSE_CHANNEL,
  DESKTOP_USER_LIBRARY_COPY_REQUEST_CHANNEL,
  DESKTOP_USER_LIBRARY_COPY_RESPONSE_CHANNEL,
  DESKTOP_USER_LIBRARY_IMPORT_REQUEST_CHANNEL,
  DESKTOP_USER_LIBRARY_IMPORT_RESPONSE_CHANNEL,
  DESKTOP_USER_LIBRARY_LINK_LIST_REQUEST_CHANNEL,
  DESKTOP_USER_LIBRARY_LINK_LIST_RESPONSE_CHANNEL,
  DESKTOP_USER_LIBRARY_LINK_READ_REQUEST_CHANNEL,
  DESKTOP_USER_LIBRARY_LINK_READ_RESPONSE_CHANNEL,
  DESKTOP_USER_LIBRARY_LINK_REQUEST_CHANNEL,
  DESKTOP_USER_LIBRARY_LINK_RESPONSE_CHANNEL,
  DESKTOP_USER_LIBRARY_PROMOTE_REQUEST_CHANNEL,
  DESKTOP_USER_LIBRARY_PROMOTE_RESPONSE_CHANNEL,
  DESKTOP_WORKSPACE_EFFECTIVE_ASSET_SOURCE_LIST_REQUEST_CHANNEL,
  DESKTOP_WORKSPACE_EFFECTIVE_ASSET_SOURCE_LIST_RESPONSE_CHANNEL,
  createDesktopUserLibraryFailureResponse,
  createDesktopUserLibraryOperationSuccessResponse,
  type DesktopUserLibraryAssetListRequest,
  type DesktopUserLibraryAssetReadRequest,
  type DesktopUserLibraryCopyRequest,
  type DesktopUserLibraryImportRequest,
  type DesktopUserLibraryLinkRequest,
  type DesktopUserLibraryPromoteRequest,
  type DesktopWorkspaceEffectiveAssetSourceListRequest,
  type DesktopWorkspaceUserLibraryLinkListRequest,
  type DesktopWorkspaceUserLibraryLinkReadRequest,
} from "../../../../contracts/ipc";
import { createWorkspaceId } from "../../../../contracts/workspace";
import type { IpcMainHandlePort } from "../ipcMainHandlePort";

export interface RegisterUserLibraryIpcDependencies {
  readonly ipcMain: IpcMainHandlePort;
  readonly promoteUseCase?: PromoteWorkspaceAssetToUserLibraryUseCase;
  readonly linkUseCase?: LinkUserLibraryAssetToWorkspaceUseCase;
  readonly copyUseCase?: CopyUserLibraryAssetToWorkspaceUseCase;
  readonly importUseCase?: ImportWorkspaceAssetToWorkspaceUseCase;
  readonly userLibraryAssetRepository?: UserLibraryAssetRepositoryPort;
  readonly workspaceUserLibraryLinkRepository?: WorkspaceUserLibraryLinkRepositoryPort;
  readonly assetRegistryRead?: AssetRegistryDefinitionReadPort;
}

type RequestContext = { requestId?: string; correlationId?: string };
type UserLibraryFailureCode = "validation" | "internal" | "not-found" | "unavailable";

export function registerUserLibraryIpc(dependencies: RegisterUserLibraryIpcDependencies): void {
  dependencies.ipcMain.handle(DESKTOP_USER_LIBRARY_PROMOTE_REQUEST_CHANNEL.value, async (_event, request: DesktopUserLibraryPromoteRequest) => {
    const context = contextFrom(request);
    if (!dependencies.promoteUseCase) return unavailable(DESKTOP_USER_LIBRARY_PROMOTE_RESPONSE_CHANNEL, "user-library.promote-workspace-asset", "User-library promotion is unavailable.", context);
    if (!hasText(request.payload?.sourceWorkspaceId)) return failure(DESKTOP_USER_LIBRARY_PROMOTE_RESPONSE_CHANNEL, "user-library.promote-workspace-asset", "validation", "sourceWorkspaceId is required.", context);
    try {
      const result = await dependencies.promoteUseCase.execute({ ...request.payload, sourceWorkspaceId: createWorkspaceId(request.payload.sourceWorkspaceId) });
      if (!result.ok) return failure(DESKTOP_USER_LIBRARY_PROMOTE_RESPONSE_CHANNEL, "user-library.promote-workspace-asset", "validation", "User-library promotion request failed.", context);
      return createDesktopUserLibraryOperationSuccessResponse(DESKTOP_USER_LIBRARY_PROMOTE_RESPONSE_CHANNEL, sanitizeForTransport(result), context);
    } catch {
      return failure(DESKTOP_USER_LIBRARY_PROMOTE_RESPONSE_CHANNEL, "user-library.promote-workspace-asset", "internal", "Unable to promote workspace asset to the user library.", context);
    }
  });

  dependencies.ipcMain.handle(DESKTOP_USER_LIBRARY_LINK_REQUEST_CHANNEL.value, async (_event, request: DesktopUserLibraryLinkRequest) => {
    const context = contextFrom(request);
    if (!dependencies.linkUseCase) return unavailable(DESKTOP_USER_LIBRARY_LINK_RESPONSE_CHANNEL, "user-library.link-asset-to-workspace", "User-library linking is unavailable.", context);
    if (!hasText(request.payload?.targetWorkspaceId)) return failure(DESKTOP_USER_LIBRARY_LINK_RESPONSE_CHANNEL, "user-library.link-asset-to-workspace", "validation", "targetWorkspaceId is required.", context);
    try {
      const result = await dependencies.linkUseCase.execute({ ...request.payload, targetWorkspaceId: createWorkspaceId(request.payload.targetWorkspaceId) });
      if (!result.ok) return failure(DESKTOP_USER_LIBRARY_LINK_RESPONSE_CHANNEL, "user-library.link-asset-to-workspace", "validation", "User-library link request failed.", context);
      return createDesktopUserLibraryOperationSuccessResponse(DESKTOP_USER_LIBRARY_LINK_RESPONSE_CHANNEL, sanitizeForTransport(result), context);
    } catch {
      return failure(DESKTOP_USER_LIBRARY_LINK_RESPONSE_CHANNEL, "user-library.link-asset-to-workspace", "internal", "Unable to link user-library asset into workspace.", context);
    }
  });

  dependencies.ipcMain.handle(DESKTOP_USER_LIBRARY_COPY_REQUEST_CHANNEL.value, async (_event, request: DesktopUserLibraryCopyRequest) => {
    const context = contextFrom(request);
    if (!dependencies.copyUseCase) return unavailable(DESKTOP_USER_LIBRARY_COPY_RESPONSE_CHANNEL, "user-library.copy-asset-to-workspace", "User-library detached copy is unavailable.", context);
    if (!hasText(request.payload?.targetWorkspaceId)) return failure(DESKTOP_USER_LIBRARY_COPY_RESPONSE_CHANNEL, "user-library.copy-asset-to-workspace", "validation", "targetWorkspaceId is required.", context);
    try {
      const result = await dependencies.copyUseCase.execute({ ...request.payload, targetWorkspaceId: createWorkspaceId(request.payload.targetWorkspaceId) });
      if (!result.ok) return failure(DESKTOP_USER_LIBRARY_COPY_RESPONSE_CHANNEL, "user-library.copy-asset-to-workspace", "validation", "User-library copy request failed.", context);
      return createDesktopUserLibraryOperationSuccessResponse(DESKTOP_USER_LIBRARY_COPY_RESPONSE_CHANNEL, sanitizeForTransport(result), context);
    } catch {
      return failure(DESKTOP_USER_LIBRARY_COPY_RESPONSE_CHANNEL, "user-library.copy-asset-to-workspace", "internal", "Unable to copy user-library asset into workspace.", context);
    }
  });

  dependencies.ipcMain.handle(DESKTOP_USER_LIBRARY_IMPORT_REQUEST_CHANNEL.value, async (_event, request: DesktopUserLibraryImportRequest) => {
    const context = contextFrom(request);
    if (!dependencies.importUseCase) return unavailable(DESKTOP_USER_LIBRARY_IMPORT_RESPONSE_CHANNEL, "user-library.import-workspace-asset", "Workspace asset import is unavailable.", context);
    if (!hasText(request.payload?.sourceWorkspaceId)) return failure(DESKTOP_USER_LIBRARY_IMPORT_RESPONSE_CHANNEL, "user-library.import-workspace-asset", "validation", "sourceWorkspaceId is required.", context);
    if (!hasText(request.payload?.targetWorkspaceId)) return failure(DESKTOP_USER_LIBRARY_IMPORT_RESPONSE_CHANNEL, "user-library.import-workspace-asset", "validation", "targetWorkspaceId is required.", context);
    try {
      const result = await dependencies.importUseCase.execute({ ...request.payload, sourceWorkspaceId: createWorkspaceId(request.payload.sourceWorkspaceId), targetWorkspaceId: createWorkspaceId(request.payload.targetWorkspaceId) });
      if (!result.ok) return failure(DESKTOP_USER_LIBRARY_IMPORT_RESPONSE_CHANNEL, "user-library.import-workspace-asset-to-workspace", "validation", "Workspace import request failed.", context);
      return createDesktopUserLibraryOperationSuccessResponse(DESKTOP_USER_LIBRARY_IMPORT_RESPONSE_CHANNEL, sanitizeForTransport(result), context);
    } catch {
      return failure(DESKTOP_USER_LIBRARY_IMPORT_RESPONSE_CHANNEL, "user-library.import-workspace-asset", "internal", "Unable to import workspace asset into target workspace.", context);
    }
  });

  dependencies.ipcMain.handle(DESKTOP_USER_LIBRARY_ASSET_LIST_REQUEST_CHANNEL.value, async (_event, request: DesktopUserLibraryAssetListRequest) => {
    const context = contextFrom(request);
    if (!dependencies.userLibraryAssetRepository) return unavailable(DESKTOP_USER_LIBRARY_ASSET_LIST_RESPONSE_CHANNEL, "user-library.list-assets", "User-library asset reads are unavailable.", context);
    try {
      const result = await dependencies.userLibraryAssetRepository.listUserLibraryAssetRecords(request.payload);
      return createDesktopUserLibraryOperationSuccessResponse(DESKTOP_USER_LIBRARY_ASSET_LIST_RESPONSE_CHANNEL, sanitizeForTransport(result), context);
    } catch {
      return failure(DESKTOP_USER_LIBRARY_ASSET_LIST_RESPONSE_CHANNEL, "user-library.list-assets", "internal", "Unable to list user-library assets.", context);
    }
  });

  dependencies.ipcMain.handle(DESKTOP_USER_LIBRARY_ASSET_READ_REQUEST_CHANNEL.value, async (_event, request: DesktopUserLibraryAssetReadRequest) => {
    const context = contextFrom(request);
    if (!dependencies.userLibraryAssetRepository) return unavailable(DESKTOP_USER_LIBRARY_ASSET_READ_RESPONSE_CHANNEL, "user-library.read-asset", "User-library asset reads are unavailable.", context);
    if (!hasText(request.payload?.userLibraryAssetId)) return failure(DESKTOP_USER_LIBRARY_ASSET_READ_RESPONSE_CHANNEL, "user-library.read-asset", "validation", "userLibraryAssetId is required.", context);
    try {
      const result = await dependencies.userLibraryAssetRepository.readUserLibraryAssetRecordById(request.payload.userLibraryAssetId, request.payload.version);
      if (!result) return failure(DESKTOP_USER_LIBRARY_ASSET_READ_RESPONSE_CHANNEL, "user-library.read-asset", "not-found", "User-library asset was not found.", context);
      return createDesktopUserLibraryOperationSuccessResponse(DESKTOP_USER_LIBRARY_ASSET_READ_RESPONSE_CHANNEL, sanitizeForTransport(result), context);
    } catch {
      return failure(DESKTOP_USER_LIBRARY_ASSET_READ_RESPONSE_CHANNEL, "user-library.read-asset", "internal", "Unable to read user-library asset.", context);
    }
  });

  dependencies.ipcMain.handle(DESKTOP_USER_LIBRARY_LINK_LIST_REQUEST_CHANNEL.value, async (_event, request: DesktopWorkspaceUserLibraryLinkListRequest) => {
    const context = contextFrom(request);
    if (!dependencies.workspaceUserLibraryLinkRepository) return unavailable(DESKTOP_USER_LIBRARY_LINK_LIST_RESPONSE_CHANNEL, "user-library.list-workspace-links", "Workspace user-library link reads are unavailable.", context);
    if (!hasText(request.payload?.workspaceId)) return failure(DESKTOP_USER_LIBRARY_LINK_LIST_RESPONSE_CHANNEL, "user-library.list-workspace-links", "validation", "workspaceId is required.", context);
    try {
      const result = await dependencies.workspaceUserLibraryLinkRepository.listWorkspaceUserLibraryLinkRecords({ ...request.payload, targetWorkspaceId: createWorkspaceId(request.payload.workspaceId) });
      return createDesktopUserLibraryOperationSuccessResponse(DESKTOP_USER_LIBRARY_LINK_LIST_RESPONSE_CHANNEL, sanitizeForTransport(result), context);
    } catch {
      return failure(DESKTOP_USER_LIBRARY_LINK_LIST_RESPONSE_CHANNEL, "user-library.list-workspace-links", "internal", "Unable to list workspace user-library links.", context);
    }
  });

  dependencies.ipcMain.handle(DESKTOP_USER_LIBRARY_LINK_READ_REQUEST_CHANNEL.value, async (_event, request: DesktopWorkspaceUserLibraryLinkReadRequest) => {
    const context = contextFrom(request);
    if (!dependencies.workspaceUserLibraryLinkRepository) return unavailable(DESKTOP_USER_LIBRARY_LINK_READ_RESPONSE_CHANNEL, "user-library.read-workspace-link", "Workspace user-library link reads are unavailable.", context);
    if (!hasText(request.payload?.workspaceId)) return failure(DESKTOP_USER_LIBRARY_LINK_READ_RESPONSE_CHANNEL, "user-library.read-workspace-link", "validation", "workspaceId is required.", context);
    if (!hasText(request.payload?.linkId)) return failure(DESKTOP_USER_LIBRARY_LINK_READ_RESPONSE_CHANNEL, "user-library.read-workspace-link", "validation", "linkId is required.", context);
    try {
      const result = await dependencies.workspaceUserLibraryLinkRepository.readWorkspaceUserLibraryLinkRecord(createWorkspaceId(request.payload.workspaceId), request.payload.linkId);
      if (!result) return failure(DESKTOP_USER_LIBRARY_LINK_READ_RESPONSE_CHANNEL, "user-library.read-workspace-link", "not-found", "Workspace user-library link was not found.", context);
      return createDesktopUserLibraryOperationSuccessResponse(DESKTOP_USER_LIBRARY_LINK_READ_RESPONSE_CHANNEL, sanitizeForTransport(result), context);
    } catch {
      return failure(DESKTOP_USER_LIBRARY_LINK_READ_RESPONSE_CHANNEL, "user-library.read-workspace-link", "internal", "Unable to read workspace user-library link.", context);
    }
  });

  dependencies.ipcMain.handle(DESKTOP_WORKSPACE_EFFECTIVE_ASSET_SOURCE_LIST_REQUEST_CHANNEL.value, async (_event, request: DesktopWorkspaceEffectiveAssetSourceListRequest) => {
    const context = contextFrom(request);
    if (!dependencies.assetRegistryRead) return unavailable(DESKTOP_WORKSPACE_EFFECTIVE_ASSET_SOURCE_LIST_RESPONSE_CHANNEL, "user-library.list-workspace-effective-sources", "Effective asset source reads are unavailable.", context);
    if (!hasText(request.payload?.workspaceId)) return failure(DESKTOP_WORKSPACE_EFFECTIVE_ASSET_SOURCE_LIST_RESPONSE_CHANNEL, "user-library.list-workspace-effective-sources", "validation", "workspaceId is required.", context);
    try {
      const result = await dependencies.assetRegistryRead.listDefinitionCards({ workspaceId: createWorkspaceId(request.payload.workspaceId), limit: request.payload.limit, cursor: request.payload.cursor });
      return createDesktopUserLibraryOperationSuccessResponse(DESKTOP_WORKSPACE_EFFECTIVE_ASSET_SOURCE_LIST_RESPONSE_CHANNEL, sanitizeForTransport({ items: result.items.map((item) => item.effectiveSourceSummary).filter(Boolean), nextCursor: result.nextCursor }), context);
    } catch {
      return failure(DESKTOP_WORKSPACE_EFFECTIVE_ASSET_SOURCE_LIST_RESPONSE_CHANNEL, "user-library.list-workspace-effective-sources", "internal", "Unable to read effective asset sources.", context);
    }
  });
}

function contextFrom(request: { requestId?: string; correlationId?: string } | undefined): RequestContext {
  return { requestId: request?.requestId, correlationId: request?.correlationId };
}

function failure(responseChannel: Parameters<typeof createDesktopUserLibraryFailureResponse>[0], operation: string, code: UserLibraryFailureCode, message: string, context: RequestContext) {
  return createDesktopUserLibraryFailureResponse(responseChannel, operation, code, message, context);
}

function unavailable(responseChannel: Parameters<typeof createDesktopUserLibraryFailureResponse>[0], operation: string, message: string, context: RequestContext) {
  return failure(responseChannel, operation, "unavailable", message, context);
}

function hasText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

const UNSAFE_TRANSPORT_FIELD = /(path|storage|providerPayload|payload|prompt|workflow|token|stack|command|env|base64|blob|bytes|secret|signedUrl|url|locator)/i;

function sanitizeForTransport<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => sanitizeForTransport(item)) as T;
  if (!value || typeof value !== "object") return value;
  const sanitized: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (UNSAFE_TRANSPORT_FIELD.test(key)) continue;
    sanitized[key] = sanitizeForTransport(nested);
  }
  return sanitized as T;
}
