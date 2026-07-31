import type {
  ListAssetImplementationReleasesUseCase,
  ResolveAssetImplementationUseCase,
} from "../../../../application/use-cases/asset-implementation";
import { normalizeAssetImplementationResolutionRequest } from "../../../../contracts/asset-implementation";
import {
  createIpcError,
  createIpcFailureResponse,
  createIpcSuccessResponse,
  DESKTOP_ASSET_IMPLEMENTATION_RELEASES_LIST_REQUEST_CHANNEL,
  DESKTOP_ASSET_IMPLEMENTATION_RELEASES_LIST_RESPONSE_CHANNEL,
  DESKTOP_ASSET_IMPLEMENTATION_RESOLVE_REQUEST_CHANNEL,
  DESKTOP_ASSET_IMPLEMENTATION_RESOLVE_RESPONSE_CHANNEL,
  type DesktopAssetImplementationReleasesListRequest,
  type DesktopAssetImplementationResolveRequest,
} from "../../../../contracts/ipc";
import { createWorkspaceId } from "../../../../contracts/workspace";
import type { IpcMainHandlePort } from "../ipcMainHandlePort";

export interface RegisterAssetImplementationIpcDependencies {
  readonly ipcMain: IpcMainHandlePort;
  readonly listReleases: Pick<
    ListAssetImplementationReleasesUseCase,
    "execute"
  >;
  readonly resolve: Pick<ResolveAssetImplementationUseCase, "execute">;
}

const errorMessage = (error: unknown): string =>
  error instanceof Error &&
  /required|invalid|must|supported/i.test(error.message)
    ? error.message
    : "Asset implementation request could not be completed.";

export function registerAssetImplementationIpc(
  dependencies: RegisterAssetImplementationIpcDependencies,
): void {
  dependencies.ipcMain.handle(
    DESKTOP_ASSET_IMPLEMENTATION_RELEASES_LIST_REQUEST_CHANNEL.value,
    async (_event, request: DesktopAssetImplementationReleasesListRequest) => {
      const responseContext = {
        requestId: request?.requestId,
        correlationId: request?.correlationId,
      };
      try {
        const workspaceId = createWorkspaceId(request?.payload?.workspaceId);
        return createIpcSuccessResponse(
          DESKTOP_ASSET_IMPLEMENTATION_RELEASES_LIST_RESPONSE_CHANNEL,
          await dependencies.listReleases.execute(workspaceId),
          responseContext,
        );
      } catch (error) {
        return createIpcFailureResponse(
          createIpcError(
            DESKTOP_ASSET_IMPLEMENTATION_RELEASES_LIST_RESPONSE_CHANNEL,
            "validation",
            errorMessage(error),
            responseContext,
          ),
          responseContext,
        );
      }
    },
  );

  dependencies.ipcMain.handle(
    DESKTOP_ASSET_IMPLEMENTATION_RESOLVE_REQUEST_CHANNEL.value,
    async (_event, request: DesktopAssetImplementationResolveRequest) => {
      const responseContext = {
        requestId: request?.requestId,
        correlationId: request?.correlationId,
      };
      try {
        const normalized = normalizeAssetImplementationResolutionRequest(
          request?.payload,
        );
        return createIpcSuccessResponse(
          DESKTOP_ASSET_IMPLEMENTATION_RESOLVE_RESPONSE_CHANNEL,
          await dependencies.resolve.execute(normalized),
          responseContext,
        );
      } catch (error) {
        return createIpcFailureResponse(
          createIpcError(
            DESKTOP_ASSET_IMPLEMENTATION_RESOLVE_RESPONSE_CHANNEL,
            "validation",
            errorMessage(error),
            responseContext,
          ),
          responseContext,
        );
      }
    },
  );
}
